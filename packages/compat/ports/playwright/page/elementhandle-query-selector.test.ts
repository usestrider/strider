/**
 * Playwright's `tests/page/elementhandle-query-selector.spec.ts`: `elementHandle.$` and `$$`, which find the elements
 * inside an element, with CSS and XPath selectors.
 *
 * What the port changes:
 * - An element handle's `$(s)` is the locator chain that reaches the same elements: `html.$('.second')` is
 *   `page.locator("html").locator(".second")`. A null result is a count of zero, and `$$` is `count` and `nth(i)`.
 * - Where the original reads the text of a handle with `page.evaluate(e => e.textContent, handle)`, the port reads the
 *   locator's `readText`, which is the same text for these elements.
 * - EH-069 keeps a handle through an adoption: a `div` the test made is moved into a popup, and the original's handle
 *   still finds its `span` there. A locator re-finds its elements by selector each time it's read, and after the move
 *   the page no longer has the `div`, so the port holds the element in a `JSHandle` (`page.evaluateHandle`), whose
 *   `evaluate` runs on the element itself, as the handle's `$` and `$eval` do.
 * - EH-072 and EH-073 are XPath, which Strider doesn't have (the matrix row for XPath and Playwright's selector DSL), so
 *   they're in the ledger.
 * - `page.goto` waits for `load` in Playwright and returns at commit in Strider, so EH-067 names `waitUntil: "load"`.
 * - The popup is opened by a script, so it runs as a user gesture under Strider's popup blocking (`Page.withUserGesture`).
 *   Strider reports a popup before it loads, so the port waits for its URL, then for its document to be parsed, where the
 *   original waits for `domcontentloaded`.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `popup.waitForEvent` settles at the popup's first committed address: this waits for the same. */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

upstream(import.meta.filename, {}, (test) => {
  test("EH-067", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/playground.html", { waitUntil: "load" })
      yield* page.setContent("<html><body><div class=\"second\"><div class=\"inner\">A</div></div></body></html>")
      const inner = page.locator("html").locator(".second").locator(".inner")
      assert.strictEqual(yield* inner.readText, "A")
    }))

  test("EH-068", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<html><body><div class=\"second\"><div class=\"inner\">B</div></div></body></html>")
      // `html.$('.third')` is null: nothing matches
      assert.strictEqual(yield* page.locator("html").locator(".third").count, 0)
    }))

  test("EH-069", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `Promise.all([page.waitForEvent('popup'), page.evaluate(...)])`: the wait is subscribed before the script runs
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        ;(window as any).__popup = window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      const divHandle = yield* page.evaluateHandle(() => {
        const div = document.createElement("div")
        document.body.appendChild(div)
        const span = document.createElement("span")
        span.textContent = "hello"
        div.appendChild(span)
        return div
      })
      assert.isTrue(yield* divHandle.evaluate((div) => div.querySelector("span") !== null))
      assert.strictEqual(yield* divHandle.evaluate((div) => div.querySelector("span")?.textContent), "hello")

      // `popup.waitForLoadState('domcontentloaded')`: the popup's document is parsed, so it has a body to move into
      yield* Expect.that(
        popup.evaluateInMainWorld(() => document.readyState !== "loading"),
        Condition.make("the popup's document is parsed", (parsed) => parsed === true)
      )
      yield* page.evaluateInMainWorld(() => {
        const div = document.querySelector("div")
        ;(window as any).__popup.document.body.appendChild(div)
      })
      assert.isTrue(yield* divHandle.evaluate((div) => div.querySelector("span") !== null))
      assert.strictEqual(yield* divHandle.evaluate((div) => div.querySelector("span")?.textContent), "hello")
    }))

  test("EH-070", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<html><body><div>A</div><br/><div>B</div></body></html>")
      const divs = page.locator("html").locator("div")
      assert.strictEqual(yield* divs.count, 2)
      assert.deepStrictEqual([yield* divs.nth(0).readText, yield* divs.nth(1).readText], ["A", "B"])
    }))

  test("EH-071", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<html><body><span>A</span><br/><span>B</span></body></html>")
      assert.strictEqual(yield* page.locator("html").locator("div").count, 0)
    }))
})
