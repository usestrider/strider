/**
 * Playwright's `tests/page/page-set-content.spec.ts`: replacing a page's HTML with `setContent`, what the page's content
 * reads back as, and how the call waits and times out.
 *
 * What the port changes:
 * - `page.setContent(html)` is `page.setContent(html)`, whose default readiness is `load`, as Playwright's is. Its
 *   `waitUntil` values are `commit`, `domContentLoaded`, and `load` (`PageNavigation.LoadState`); `networkidle` has no
 *   Strider state (`option-page-setcontent-waituntil-value-networkidle`).
 * - `page.content()` is `page.readHtml`: the doctype and the root's `outerHTML`, which is what Playwright's returns.
 * - `page.$eval("div", div => div.textContent)` is `page.locator("div").readText`. `readText` collapses whitespace, so
 *   PA-033 reads the div's `outerHTML` instead: `<div>\n</div>` is that element only when its text is one newline.
 * - PA-026's `timeout: 1` is `Deadline.within("1 millis")`. Its error is Strider's `Deadline.Timeout`, which Playwright's
 *   `TimeoutError` is the counterpart of. PA-028 starts the setContent first and listens for the image request before
 *   it, as the harness asks, so the request can't be missed.
 * - PA-034's `page.goto` is not awaited in the original, so it's a fiber started at once and joined after the read. Its
 *   `page.waitForTimeout(timeout)` is the original's own, so it's a sleep, with its comment. Playwright's `goto` waits for
 *   `load` by default, so the port passes `waitUntil: "load"`.
 * - PA-034's content check is the original's: the read is either the page's content or the empty document, and a read
 *   that fails must fail with Playwright's navigation message. Strider's reads have no such message, so a failed read
 *   fails the test.
 * - PA-035's `page.frames().length` is `frameCount`, and `page.frames()[1].content()` is the iframe's `html` element's
 *   `readHtml`, which is its outer HTML with no doctype.
 * - Playwright's `page.evaluate` and `$eval` run in the page's main world: `page.evaluateInMainWorld`.
 * - PA-029's twenty replacements and PA-030 to PA-033's text checks are as written.
 * - PA-027's `page.setDefaultNavigationTimeout(1)` is `Deadline.withDefaultBudget("1 millis")`: Strider has no mutable
 *   per-page default, and the default budget is what a call gets when no deadline encloses it.
 * - PA-025 checks the shadow roots `page.content({ includeShadow: true })` serializes, which Strider's `readHtml` doesn't
 *   take (`option-page-content-includeshadow`), so it's not ported.
 * - PA-036 and PA-037 hook Playwright's utility world, where Playwright runs its own content writes, through its internal
 *   `toImpl`. They're not ported (see the ledger).
 * - The original's `it.fixme` for WebKit in PA-035 isn't carried over: the port runs on the pinned browsers, and a WebKit
 *   run is an upstream skip the port doesn't make.
 */
import { assert } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import type { ServerResponse } from "node:http"
import { defaultTimeout, failureOf, frameCount, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

const expectedOutput = "<html><head></head><body><div>hello</div></body></html>"
const emptyOutput = "<html><head></head><body></body></html>"

upstream(import.meta.filename, {}, (test) => {
  test("PA-020", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>")
      assert.strictEqual(yield* page.readHtml, expectedOutput)
    }))

  test("PA-021", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>", { waitUntil: "domContentLoaded" })
      assert.strictEqual(yield* page.readHtml, expectedOutput)
    }))

  test("PA-022", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>", { waitUntil: "commit" })
      assert.strictEqual(yield* page.readHtml, expectedOutput)
    }))

  test("PA-023", ({ page }) =>
    Effect.gen(function*() {
      const doctype = "<!DOCTYPE html>"
      yield* page.setContent(`${doctype}<div>hello</div>`)
      assert.strictEqual(yield* page.readHtml, `${doctype}${expectedOutput}`)
    }))

  test("PA-024", ({ page }) =>
    Effect.gen(function*() {
      const doctype = "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\" " +
        "\"http://www.w3.org/TR/html4/strict.dtd\">"
      yield* page.setContent(`${doctype}<div>hello</div>`)
      assert.strictEqual(yield* page.readHtml, `${doctype}${expectedOutput}`)
    }))

  test("PA-026", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      // stall for image
      server.setRoute(imgPath, () => {})
      // `timeout: 1` is a one-millisecond deadline around the call
      const error = yield* failureOf(
        page.setContent(`<img src="${server.PREFIX + imgPath}"></img>`).pipe(Deadline.within("1 millis")),
        "the setContent"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("PA-027", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      // stall for image
      server.setRoute(imgPath, () => {})
      // `setDefaultNavigationTimeout(1)` is a one-millisecond default budget, for a call that sets no deadline
      const error = yield* failureOf(
        page.setContent(`<img src="${server.PREFIX + imgPath}"></img>`).pipe(defaultTimeout("1 millis")),
        "the setContent"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Page.setContent")
    }))

  test("PA-028", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      const image: { response?: ServerResponse } = {}
      server.setRoute(imgPath, (_req, res) => {
        image.response = res
      })
      // Listen before the call that makes the request, so the request can't come first
      const requested = yield* server.waitForRequest(imgPath)
      const content = yield* startWaiting(page.setContent(`<img src="${server.PREFIX + imgPath}"></img>`))
      yield* requested
      assert.isFalse(yield* content.done)
      assert.isDefined(image.response)
      image.response.end()
      yield* Fiber.join(content.fiber)
    }))

  test("PA-029", ({ page }) =>
    Effect.gen(function*() {
      for (let i = 0; i < 20; ++i) yield* page.setContent("<div>yo</div>")
    }))

  test("PA-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello world</div>\x7F")
      assert.strictEqual(yield* page.locator("div").readText, "hello world")
    }))

  test("PA-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>aberración</div>")
      assert.strictEqual(yield* page.locator("div").readText, "aberración")
    }))

  test("PA-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>🐥</div>")
      assert.strictEqual(yield* page.locator("div").readText, "🐥")
    }))

  test("PA-033", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>\n</div>")
      // `readText` collapses whitespace, so the newline is read from the element's outer HTML
      assert.strictEqual(yield* page.locator("div").readHtml, "<div>\n</div>")
    }))

  test("PA-034", ({ page, server }) =>
    Effect.gen(function*() {
      for (let timeout = 0; timeout < 200; timeout += 20) {
        yield* page.setContent("<div>hello</div>")
        // The original starts this navigation without awaiting it, and its `goto` waits for `load`
        const navigation = yield* startWaiting(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
        // The original's own `page.waitForTimeout(timeout)`, a fixed wait ported as written
        yield* Effect.sleep(Duration.millis(timeout))
        const read = yield* Effect.result(page.readHtml)
        yield* Fiber.join(navigation.fiber)
        if (Result.isSuccess(read)) {
          assert.include([expectedOutput, emptyOutput], read.success)
        } else {
          assert.include(
            read.failure.message,
            "Unable to retrieve content because the page is navigating and changing the content."
          )
        }
      }
    }))

  test("PA-035", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<iframe src="javascript:console.log(1)"></iframe>`)
      assert.strictEqual(yield* frameCount(page), 2)
      assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("html").readHtml, emptyOutput)
    }))
})
