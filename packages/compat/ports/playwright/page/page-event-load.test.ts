/**
 * Playwright's `tests/page/page-event-load.spec.ts`: a page's `load` event fires once, including when a form in a frame
 * submits.
 *
 * What the port changes:
 * - Playwright's `page.on('load', …)` counts the page's `load` events. Strider has no load event: its page status
 *   reports readiness as it changes, so a second `load` in the same document wouldn't show. The port counts the
 *   events where they happen, with an init script that adds a `load` listener to the top window and counts it. It
 *   runs in the page's main world before the page's own scripts, and does nothing else to the page.
 * - `page.waitForTimeout(1000)` is the original's own fixed wait, so it's an `Effect.sleep` of the same length.
 * - NA-088's `Promise.race([waitForEvent('load'), waitForTimeout(1000)])` is the count before the click and the count
 *   after the wait: a `load` in the second would make it 'loadfired'.
 * - NA-088's `expect.soft` assertions are collected and asserted together at the end, so a failing one doesn't stop
 *   the steps after it, as Playwright's soft assertions don't.
 * - `page.frameLocator('[name=tracker]')` is `page.frame(page.locator("[name=tracker]"))`, and its `:scope` is
 *   `:root`, the frame's own root.
 * - `page.evaluate(() => window['eventLog'])` is `page.evaluateInMainWorld`.
 */
import { assert } from "@effect/vitest"
import { Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/**
 * Counts the `load` events of the top window, in the page's main world: `window.__loadCount`. Installed before each
 * document's own scripts, so it sees the document's `load`.
 */
const countLoads = () => {
  if (window !== window.top) return
  const counted = window as unknown as { __loadCount: number }
  counted.__loadCount = 0
  window.addEventListener("load", () => {
    counted.__loadCount += 1
  })
}

upstream(import.meta.filename, {}, (test) => {
  test("NA-087", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(countLoads)
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      // The original's own fixed wait: a second `load` would have fired within it
      yield* Effect.sleep("1 second")
      const count = yield* page.evaluateInMainWorld(() => (window as unknown as { __loadCount: number }).__loadCount)
      assert.strictEqual(count, 1)
    }))

  test("NA-088", ({ page, server }) =>
    Effect.gen(function*() {
      let requestCount = 0
      server.setRoute("/tracker", (_request, response) => {
        response.write(`request count: ${++requestCount}`)
        response.end()
      })
      server.setRoute("/home", (_request, response) => {
        response.write(`
      <!DOCTYPE html>
      <html>
        <head>
        </head>
        <body>
          <script>
            window.eventLog = [];
            window.addEventListener('load', () => {
              window.eventLog.push('load');
            });
          </script>
          <form id="trackerForm" action="/tracker" method="post" target="tracker">
            <input type="submit">
          </form>
          <iframe name="tracker" src="/tracker">
        </body>
      </html>
    `)
        response.end()
      })
      yield* page.addInitScript(countLoads)
      yield* page.goto(server.PREFIX + "/home", { waitUntil: "load" })
      const trackingFrame = page.frame(page.locator("[name=tracker]")).locator(":root")
      yield* Expect.toContainText(trackingFrame, "request count: 1")

      const failures: Array<string> = []
      const loadCount = () => page.evaluateInMainWorld(() => (window as unknown as { __loadCount: number }).__loadCount)
      const before = yield* loadCount()
      yield* page.locator("input[type=submit]").click()
      // The original's `waitForTimeout(1000)` in its race: a `load` in that second would have been 'loadfired'
      yield* Effect.sleep("1 second")
      const loadFired = (yield* loadCount()) !== before
      if (loadFired) failures.push("a load fired on the page after the frame's form submitted")
      const count = yield* loadCount()
      if (count !== 1) failures.push(`the page's load fired ${count} times, not once`)
      assert.deepStrictEqual(failures, [])

      const eventLog = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { eventLog: Array<string> }).eventLog
      )
      assert.deepStrictEqual(eventLog, ["load"])
    }))
})
