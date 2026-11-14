/**
 * Playwright's `tests/page/queryselector.spec.ts`: `page.$` and `page.$$`, which find elements by a selector string,
 * with CSS, text, and XPath selectors, and the auto-detection of each form.
 *
 * What the port changes:
 * - Strider has no selector strings: a match is a locator, and `page.$(s)` is `count` above zero (or zero, for null).
 *   `page.$$(s)`'s elements are `locator.nth(i)`, and `$$(...).length` is `count`.
 * - A selector's engine prefix is dropped where the form is CSS (`css=section` is `locator("section")`), and a quoted
 *   text selector is `getByText(x, { exact: true })`, which is what Playwright's quoted `"test"` and `text="test"` match.
 * - XPath has no Strider form (the matrix row for XPath and Playwright's selector DSL is missing), so QS-004, QS-006,
 *   QS-007, QS-014, QS-015, and QS-016 are in the ledger as `needsFeature`, not ported with a CSS path. QS-008's
 *   `..` is a parent step, which Strider's locators don't have either, so it's in that row as well.
 * - QS-001's non-string selector has no Strider counterpart: a locator is a value built by a typed call, not a string
 *   parsed at run time, so it's `notApplicable`.
 * - QS-017 replaces `Array.from` in the main world, then counts what `$$` finds, so Strider's engine, which runs among
 *   the page's scripts where there is no isolated world, must not depend on the page's `Array.from`. The port keeps that
 *   (`evaluateInMainWorld`, then `count`). It drops the last assertion, that the first handle is the element the page's
 *   own script returned (`elements[0].evaluate((div, div1) => div === div1, div1)`): a locator hands no element handle
 *   across, so it reads the first match's text instead, `hello`.
 * - `page.evaluate(e => e.textContent, element)` over each element is `locator.nth(i).readText`, which reads the same
 *   text for these elements.
 * - `page.goto` waits for `load` in Playwright and returns at commit in Strider, so QS-013 names `waitUntil: "load"`.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("QS-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>test</section>")
      // `css=section` is a CSS locator, and a match is a count above zero
      assert.isAbove(yield* page.locator("section").count, 0)
    }))

  test("QS-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>test</section>")
      // `text="test"` matches the whole text of an element, which is `exact`
      assert.isAbove(yield* page.getByText("test", { exact: true }).count, 0)
    }))

  test("QS-005", ({ page }) =>
    Effect.gen(function*() {
      // `page.$` returns null when nothing matches, which is a count of zero
      assert.strictEqual(yield* page.locator("non-existing-element").count, 0)
    }))

  test("QS-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>test</section>")
      // A quoted selector with no engine is text matched exactly, as `text="test"` is
      assert.isAbove(yield* page.getByText("test", { exact: true }).count, 0)
    }))

  test("QS-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>test</section>")
      // A bare selector with no engine is CSS
      assert.isAbove(yield* page.locator("section").count, 0)
    }))

  test("QS-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section><div>test</div></section>")
      // `css=section >> css=div` is a descendant chain
      assert.isAbove(yield* page.locator("section").locator("div").count, 0)
    }))

  test("QS-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>A</div><br/><div>B</div>")
      const divs = page.locator("div")
      assert.strictEqual(yield* divs.count, 2)
      // Each element's text, in document order, as the original reads it from each handle
      assert.deepStrictEqual(
        [yield* divs.nth(0).readText, yield* divs.nth(1).readText],
        ["A", "B"]
      )
    }))

  test("QS-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div><div></div>")
      yield* page.evaluateInMainWorld(() => {
        Array.from = () => []
      })
      const divs = page.locator("div")
      assert.strictEqual(yield* divs.count, 2)
      // The original's identity check needs a handle, so this reads the first match instead
      assert.strictEqual(yield* divs.nth(0).readText, "hello")
    }))

  test("QS-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.locator("div").count, 0)
    }))
})
