/**
 * Playwright's `tests/page/eval-on-selector-all.spec.ts`: `page.$$eval`, which runs a function on every element a
 * selector matches and returns its result. Strider has no selector strings: the port's matches are locators, and
 * `$$eval` is `locator.evaluateAll`, or `locator.count` where the original only counts what matched.
 *
 * What the port changes:
 * - A count (`$$eval(…, els => els.length)`) is `locator.count`, a read that runs in no world. The matches are the same.
 * - A selector string's engine prefixes and combinators become chained locators, as eval-on-selector's port does:
 *   `css=` and auto-detected CSS are the CSS locator, `text="x"` is `getByText("x", { exact: true })`, and `a >> b` is
 *   `a.locator(b)`. ES-028's `text="beautiful"` compares the element's whole text rather than its own text-node runs;
 *   the fixture's divs hold only that text, so both match the same elements.
 * - `*` marks the element a chain returns. `*css=div >> "b"` is the div that holds the exact text "b", as
 *   `locator("div").filter({ has })` expresses it, and `section >> *` is every element under a section. Those are the
 *   same matches as eval-on-selector's ES-019.
 * - ES-029 tests the `xpath=` engine, which Strider doesn't have, so it's in the ledger as `needsFeature`.
 * - ES-034 and ES-035 return or read a result through `evaluateAll`, which runs in the isolated world, so stock WebKit
 *   fails them as Unsupported; the ledger says so.
 * - ES-035's `Array.from` override is a page-level change, made in the main world as the original's `page.evaluate`
 *   makes it. It shows that `evaluateAll`'s function runs in the isolated world, where the page's override doesn't reach.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("ES-027", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div><div>beautiful</div><div>world!</div>")
      assert.strictEqual(yield* page.locator("div").count, 3)
    }))

  test("ES-028", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div><div>beautiful</div><div>beautiful</div><div>world!</div>")
      assert.strictEqual(yield* page.getByText("beautiful", { exact: true }).count, 2)
    }))

  test("ES-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div><div>beautiful</div><div>world!</div>")
      assert.strictEqual(yield* page.locator("div").count, 3)
    }))

  test("ES-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<div><span>hello</span></div><div>beautiful</div><div><span>wo</span><span>rld!</span></div><span>Not this one</span>"
      )
      // `css=div >> css=span`: the spans inside a div, not the span outside them
      assert.strictEqual(yield* page.locator("div").locator("span").count, 3)
    }))

  test("ES-032", ({ page }) =>
    Effect.gen(function*() {
      // `*css=div >> "b"` is the div that holds the exact text "b"; `section >> *css=div >> "b"` is the same, within a section
      const holdsB = Locator.relative.getByText("b", { exact: true })
      yield* page.setContent(
        "<section><div><span>a</span></div></section><section><div><span>b</span></div></section>"
      )
      assert.strictEqual(yield* page.locator("div").filter({ has: holdsB }).count, 1)
      assert.strictEqual(yield* page.locator("section").locator("div").filter({ has: holdsB }).count, 1)
      // `section >> *` is every element under a section: a div and a span in each
      assert.strictEqual(yield* page.locator("section").locator("*").count, 4)

      const holdsA = Locator.relative.getByText("a", { exact: true })
      yield* page.setContent("<section><div><span>a</span><span>a</span></div></section>")
      assert.strictEqual(yield* page.locator("div").filter({ has: holdsA }).count, 1)
      assert.strictEqual(yield* page.locator("section").locator("div").filter({ has: holdsA }).count, 1)

      yield* page.setContent(
        "<div><span>a</span></div><div><span>a</span></div><section><div><span>a</span></div></section>"
      )
      assert.strictEqual(yield* page.locator("div").filter({ has: holdsA }).count, 3)
      assert.strictEqual(yield* page.locator("section").locator("div").filter({ has: holdsA }).count, 1)
    }))

  test("ES-033", ({ page }) =>
    Effect.gen(function*() {
      // `*css=div >> span` is the divs that hold a span: the outer and the inner div of the first page, and both divs of the second
      const holdsSpan = Locator.relative.locator("span")
      yield* page.setContent("<div><div><span></span></div></div><div></div>")
      assert.strictEqual(yield* page.locator("div").filter({ has: holdsSpan }).count, 2)
      yield* page.setContent("<div><div><span></span></div><span></span><span></span></div><div></div>")
      assert.strictEqual(yield* page.locator("div").filter({ has: holdsSpan }).count, 2)
    }))

  test("ES-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div><div>beautiful</div><div>world!</div>")
      const texts = yield* page.locator("div").evaluateAll((divs) => divs.map((div) => div.textContent))
      assert.deepStrictEqual(texts, ["hello", "beautiful", "world!"])
    }))

  test("ES-035", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div><div>beautiful</div><div>world!</div>")
      // The page replaces `Array.from` in its main world; the locator's function runs in the isolated world and sees
      // the real one
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(Array, "from", () => [])
      })
      assert.strictEqual(yield* page.locator("div").evaluateAll((divs) => divs.length), 3)
    }))
})
