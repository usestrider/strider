/**
 * Playwright's `tests/page/page-autowaiting-no-hang.spec.ts`: actions that don't hang when the page navigates, stops a
 * navigation, opens a popup, or never settles.
 *
 * What the port changes:
 * - `page.goto(url)` and `page.goBack()` wait for `load` in Playwright; Strider's default is `commit`, so the port
 *   passes `waitUntil: "load"` to each, as the original's default is.
 * - `page.evaluate(…)` runs in the main world, so it's `page.evaluateInMainWorld`. A function's arguments are passed
 *   to it as arguments, where the original passes them inside a string or as trailing arguments.
 * - `page.click("body")` is `page.locator("body").click()`, and `page.goto(…).catch(() => {})` a forked navigation whose
 *   failure is ignored, as the original ignores it.
 * - A request the original awaits through a promise (`stallPromise`) is `server.waitForRequest`, listening before the
 *   action that sends the request. The route that holds the request keeps it, so the test can end it later, where the
 *   original's route awaits an `abortPromise` or `commitPromise`.
 * - `page.waitForTimeout(1000)` is the original's own fixed wait, so it's an `Effect.sleep` of the same length.
 * - AW-019's `page.waitForEvent("popup")` is `Popup.next(page)`: the subscription is made before the action that opens
 *   the popup, and its wait is joined after.
 * - AW-013's `httpsServer.EMPTY_PAGE` is `server.https.EMPTY_PAGE`, the harness's self-signed HTTPS origin. The
 *   original's context doesn't ignore certificate errors either, so the link's navigation fails on the certificate
 *   and the click is still expected to return.
 * - AW-018 and AW-019 open a popup from an evaluation. Playwright launches Chromium with its popup blocker off, where
 *   Strider's launch leaves it on, so a `window.open` outside a user gesture returns `null`. The port runs these
 *   evaluations with `Page.withUserGesture`, which Strider documents for a page that needs one to open a popup.
 * - AW-022 reads `page.url()` as `page.url`, which is a watchable value.
 */
import { assert } from "@effect/vitest"
import { Expect, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type { IncomingMessage, ServerResponse } from "node:http"
import { upstream } from "../../harness/upstream.ts"

/** A stalled navigation's request and response, held by its route until the test ends them. */
interface Held {
  readonly request: IncomingMessage
  readonly response: ServerResponse
}

upstream(import.meta.filename, {}, (test) => {
  test("AW-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href='${server.https.EMPTY_PAGE}'>foobar</a>`)
      yield* page.locator("a").click()
    }))

  test("AW-014", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", () => {})
      yield* page.evaluateInMainWorld((url) => {
        window.location.href = url
        setTimeout(() => window.stop(), 100)
      }, server.EMPTY_PAGE)
    }))

  test("AW-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld((url) => {
        window.location.href = url
        window.stop()
      }, server.EMPTY_PAGE)
    }))

  test("AW-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.location.href = "about:blank"
      })
    }))

  test("AW-017", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", () => {})
      yield* page.evaluateInMainWorld((url) => {
        window.location.href = url
        window.location.href = "about:blank"
      }, server.EMPTY_PAGE)
    }))

  test("AW-018", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Strider keeps the browser's popup blocking on, where Playwright launches Chromium with it off: a script opens
      // a popup only as a user gesture
      yield* page.evaluateInMainWorld(() => {
        const popup = window.open(window.location.href)!
        popup.close()
      }).pipe(Page.withUserGesture)
    }))

  test("AW-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Strider keeps the browser's popup blocking on, where Playwright launches Chromium with it off: a script opens
      // a popup only as a user gesture
      // Playwright's `Promise.all([waitForEvent('popup'), evaluate(…)])`: the wait is subscribed before the popup opens
      const popup = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => window.open(window.location.href) && 1).pipe(Page.withUserGesture)
      yield* popup
    }))

  test("AW-020", ({ page, server }) =>
    Effect.gen(function*() {
      let held: Held | undefined
      server.setRoute("/stall.html", (request, response) => {
        held = { request, response }
      })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const stalled = yield* server.waitForRequest("/stall.html")
      yield* Effect.forkChild(
        page.goto(server.PREFIX + "/stall.html", { waitUntil: "load" }).pipe(Effect.ignore),
        { startImmediately: true }
      )
      yield* stalled
      const clicking = yield* Effect.forkChild(page.locator("body").click(), { startImmediately: true })
      // Playwright's own fixed wait, so the click is in flight when the navigation aborts
      yield* Effect.sleep("1 second")
      assert.isDefined(held)
      held.request.socket.destroy()
      yield* Fiber.join(clicking)
    }))

  test("AW-021", ({ page, server }) =>
    Effect.gen(function*() {
      let held: Held | undefined
      server.setRoute("/stall.html", (request, response) => {
        held = { request, response }
      })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const stalled = yield* server.waitForRequest("/stall.html")
      yield* Effect.forkChild(
        page.goto(server.PREFIX + "/stall.html", { waitUntil: "load" }).pipe(Effect.ignore),
        { startImmediately: true }
      )
      yield* stalled
      const clicking = yield* Effect.forkChild(page.locator("body").click(), { startImmediately: true })
      // Playwright's own fixed wait, so the click is in flight when the navigation commits
      yield* Effect.sleep("1 second")
      assert.isDefined(held)
      held.response.writeHead(200, { "Content-Type": "text/html" })
      held.response.end("hello world")
      yield* Fiber.join(clicking)
      yield* Expect.toContainText(page.locator("body"), "hello world")
    }))

  test("AW-022", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/intercept.html", (_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html" })
        response.end(`
      <a id="go" href="/other">go</a>
      <p id="status">initial</p>
      <script>
        navigation.addEventListener('navigate', event => {
          if (!event.canIntercept)
            return;
          event.intercept({
            handler: async () => {
              const dest = new URL(event.destination.url).pathname;
              document.getElementById('status').textContent = 'intercepted:' + dest;
            },
          });
        });
      </script>
    `)
      })
      yield* page.goto(server.PREFIX + "/intercept.html", { waitUntil: "load" })
      yield* Expect.toHaveText(page.locator("#status"), "initial")

      // Should not hang waiting for the same-document navigation to commit.
      yield* page.locator("#go").click()

      yield* Expect.toHaveText(page.locator("#status"), "intercepted:/other")
      assert.strictEqual(new URL(String(yield* page.url)).pathname, "/other")
    }))

  test("AW-023", ({ page, server }) =>
    Effect.gen(function*() {
      let held: Held | undefined
      server.setRoute("/stall.html", (request, response) => {
        held = { request, response }
      })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const stalled = yield* server.waitForRequest("/stall.html")
      yield* Effect.forkChild(
        page.goto(server.PREFIX + "/stall.html", { waitUntil: "load" }).pipe(Effect.ignore),
        { startImmediately: true }
      )
      yield* stalled
      // `page.goBack().catch(() => {})`: Playwright's goBack waits for `load`, and its failure is ignored
      const goingBack = yield* Effect.forkChild(page.back({ waitUntil: "load" }).pipe(Effect.ignore), {
        startImmediately: true
      })
      // Playwright's own fixed wait, so the goBack is in flight when the navigation commits
      yield* Effect.sleep("1 second")
      assert.isDefined(held)
      held.response.writeHead(200, { "Content-Type": "text/html" })
      held.response.end("hello world")
      yield* Fiber.join(goingBack)
    }))
})
