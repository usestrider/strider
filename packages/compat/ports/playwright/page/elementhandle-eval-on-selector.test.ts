/**
 * Playwright's `tests/page/elementhandle-eval-on-selector.spec.ts`: `elementHandle.$eval` and `$$eval`, which run a
 * function on the elements a selector finds inside an element.
 *
 * What the port changes:
 * - The element handle is the locator it was found by: `page.$('#myId')` is `page.locator("#myId")`, and
 *   `elementHandle.$eval('.a', f)` is that locator's `.locator(".a")` read with `readText`. Strider has no fixed element
 *   handle to call `$eval` on, and a locator scopes its search to the element it names, as `$eval` does.
 * - `innerText` is read with `readText`, which is the text content with whitespace collapsed, not `innerText`
 *   (`method-elementhandle-innertext`). Each element here holds plain text, where the two agree.
 * - `$eval` with no match rejects with "Failed to find element matching selector"; a locator's read fails `NoMatch` at
 *   once, which EH-041 asserts, with the selector in its message.
 * - `$$eval`'s array is `count` and `nth(i)`, read in document order.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The reason of a locator's failure, as its typed `_tag`. */
const reasonOf = (error: unknown) => Locator.isLocatorError(error) ? error.reason._tag : undefined

upstream(import.meta.filename, {}, (test) => {
  test("EH-039", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html><body><div class=\"tweet\"><div class=\"like\">100</div><div class=\"retweets\">10</div></div></body></html>"
      )
      const content = yield* page.locator(".tweet").locator(".like").first.readText
      assert.strictEqual(content, "100")
    }))

  test("EH-040", ({ page }) =>
    Effect.gen(function*() {
      const htmlContent =
        "<div class=\"a\">not-a-child-div</div><div id=\"myId\"><div class=\"a\">a-child-div</div></div>"
      yield* page.setContent(htmlContent)
      // `.a` inside `#myId` only: the first `.a` is outside it
      const content = yield* page.locator("#myId").locator(".a").first.readText
      assert.strictEqual(content, "a-child-div")
    }))

  test("EH-041", ({ page }) =>
    Effect.gen(function*() {
      const htmlContent = "<div class=\"a\">not-a-child-div</div><div id=\"myId\"></div>"
      yield* page.setContent(htmlContent)
      // Playwright's `$eval` rejects with "elementHandle.$eval: Failed to find element matching selector \".a\"": a read
      // fails once with `NoMatch`, and the message names the selector
      const error = yield* failureOf(page.locator("#myId").locator(".a").first.readText, "the read")
      assert.strictEqual(reasonOf(error), "NoMatch")
      assert.include(Locator.isLocatorError(error) ? error.message : String(error), ".a")
    }))

  test("EH-042", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html><body><div class=\"tweet\"><div class=\"like\">100</div><div class=\"like\">10</div></div></body></html>"
      )
      const likes = page.locator(".tweet").locator(".like")
      const count = yield* likes.count
      const content: Array<string> = []
      for (let i = 0; i < count; i++) content.push(yield* likes.nth(i).readText)
      assert.deepStrictEqual(content, ["100", "10"])
    }))

  test("EH-043", ({ page }) =>
    Effect.gen(function*() {
      const htmlContent =
        "<div class=\"a\">not-a-child-div</div><div id=\"myId\"><div class=\"a\">a1-child-div</div><div class=\"a\">a2-child-div</div></div>"
      yield* page.setContent(htmlContent)
      const found = page.locator("#myId").locator(".a")
      const count = yield* found.count
      const content: Array<string> = []
      for (let i = 0; i < count; i++) content.push(yield* found.nth(i).readText)
      assert.deepStrictEqual(content, ["a1-child-div", "a2-child-div"])
    }))

  test("EH-044", ({ page }) =>
    Effect.gen(function*() {
      const htmlContent = "<div class=\"a\">not-a-child-div</div><div id=\"myId\"></div>"
      yield* page.setContent(htmlContent)
      // `$$eval` with no match resolves with an empty array: a count of zero
      assert.strictEqual(yield* page.locator("#myId").locator(".a").count, 0)
    }))
})
