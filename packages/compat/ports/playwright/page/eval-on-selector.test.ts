/**
 * Playwright's `tests/page/eval-on-selector.spec.ts`: `page.$eval`, which runs a function on the first element a
 * selector matches, with arguments, and fails when nothing matches. Strider has no selector strings: the port's
 * matches are locators, and `$eval`'s function is `locator.first.evaluate`.
 *
 * What the port changes:
 * - `$eval`'s first match is `locator.first`. Strider's `evaluate` takes the one match and fails `StrictViolation`
 *   on several, so every `$eval` here names `.first`, which is document order, as `$eval` picks.
 * - A selector string's engine prefixes and combinators become chained locators. `css=` and auto-detected CSS are
 *   the CSS locator. `id=x` is `#x`; `data-test=foo` is `[data-test="foo"]` (Strider has no such engine); `data-testid=foo`
 *   is `getByTestId("foo")`; `text="x"` is `getByText("x", { exact: true })`; unquoted `text=x` is `getByText("x")`,
 *   which matches as a case-insensitive substring as Playwright's does. `a >> b` is `a.locator(b)`, and a quoted
 *   string after `>>` is a text query inside its scope.
 * - ES-007 tests the `xpath=` engine, which Strider doesn't have, so it isn't ported: it's `needsFeature` against the
 *   matrix row for XPath. ES-016 tests chaining different engines; its `xpath=/html/body/section` step is
 *   `html > body > section`, so it still chains CSS into text, and the XPath step is the part it doesn't check.
 * - `*` marks the element a chain returns. Strider's chains return their last match, so `*css=div >> "b"` (the div
 *   that holds "b") is `locator("div").filter({ has: … })`, and `css=div >> *text="b"`, whose capture is already the
 *   last segment, is the plain chain.
 * - The `id` that `$eval(…, e => e.id)` reads is an attribute, so ES-001 to ES-011 read it with `readAttribute`, which
 *   runs without an isolated world (stock WebKit has none). The others keep `locator.evaluate`, since their point is
 *   the function, its arguments, its result, or a handle.
 * - Strider's `evaluate` and `evaluateAll` run in the isolated world. None of these functions reads a page global or
 *   a property a page script set, so the world doesn't change any result. Stock WebKit has no isolated world, so the
 *   tests that evaluate are `needsFeature` on it (the ledger's `webkit` entries).
 * - ES-013's element handle is `page.evaluateHandle`, which arrives in the function as its element; the signature
 *   types it as the handle, hence the cast (as EV-060 does).
 * - ES-014 asserts Strider's typed reason `NoMatch`, and that its message names the selector, as Playwright's does: the
 *   message is the operation and the locator's description, which is the selector's CSS.
 * - `page.waitForSelector` waits for `visible`, its default state, so it's `Expect.toBeVisible`. ES-024 and ES-025 start
 *   that wait before the page has the element, as the original holds its promise, with `startWaiting`.
 * - `page.$(…)` is a truthy or null read, which is `count` above zero or zero.
 * - ES-020 and ES-021 test Playwright's selector string errors (its `*`-capture rules and its unknown engine), which
 *   Strider doesn't parse, so they're in the ledger as `notApplicable`.
 * - `page.setContent` and `page.goto` name `waitUntil: "load"` where Playwright waits for `load`; ES-017 navigates
 *   to the shadow fixture with it.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The id `$eval(…, e => e.id)` reads, as the attribute: the one match's `id`, which the test requires to be set. */
const idOf = (locator: Locator.Locator) => locator.readAttribute("id").pipe(Effect.map(Option.getOrUndefined))

/** The reason of a locator's failure, as its typed `_tag`. */
const reasonOf = (error: unknown) => Locator.isLocatorError(error) ? error.reason._tag : undefined

upstream(import.meta.filename, {}, (test) => {
  test("ES-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      assert.strictEqual(yield* idOf(page.locator("section").first), "testAttribute")
    }))

  test("ES-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      // Playwright's `id=` engine is the CSS id selector
      assert.strictEqual(yield* idOf(page.locator("#testAttribute").first), "testAttribute")
    }))

  test("ES-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section data-test=foo id=\"testAttribute\">43543</section>")
      // Playwright's `data-test=` engine, which Strider doesn't have, is an attribute selector
      assert.strictEqual(yield* idOf(page.locator("[data-test=\"foo\"]").first), "testAttribute")
    }))

  test("ES-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section data-testid=foo id=\"testAttribute\">43543</section>")
      assert.strictEqual(yield* idOf(page.getByTestId("foo").first), "testAttribute")
    }))

  test("ES-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section data-test-id=foo id=\"testAttribute\">43543</section>")
      // Playwright's `data-test-id=` is an attribute selector here, as its `data-test=` is
      assert.strictEqual(yield* idOf(page.locator("[data-test-id=\"foo\"]").first), "testAttribute")
    }))

  test("ES-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      assert.strictEqual(yield* idOf(page.getByText("43543", { exact: true }).first), "testAttribute")
    }))

  test("ES-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      // Unquoted `text=` matches a case-insensitive substring, which `getByText` does by default
      assert.strictEqual(yield* idOf(page.getByText("43543").first), "testAttribute")
    }))

  test("ES-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      assert.strictEqual(yield* idOf(page.locator("section").first), "testAttribute")
    }))

  test("ES-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      assert.strictEqual(yield* idOf(page.locator("section[id=\"testAttribute\"]").first), "testAttribute")
    }))

  test("ES-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div foo=bar><section>43543<span>Hello<div id=target></div></span></section></div>")
      // `div[foo=bar] > section >> "Hello" >> div`: the span whose text is exactly "Hello", then the div inside it
      const target = page.locator("div[foo=bar] > section")
        .getByText("Hello", { exact: true })
        .locator("div")
        .first
      assert.strictEqual(yield* idOf(target), "target")
    }))

  test("ES-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>hello</section>")
      const text = yield* page.locator("section").first.evaluate((e, suffix) => e.textContent + suffix, " world!")
      assert.strictEqual(text, "hello world!")
    }))

  test("ES-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>hello</section><div> world</div>")
      const divHandle = yield* page.evaluateHandle(() => document.querySelector("div"))
      // A handle argument arrives as its element, which the signature types as the handle, hence the cast
      const text = yield* page.locator("section").first.evaluate(
        (e, div) => e.textContent + (div as unknown as Element | null)?.textContent,
        divHandle
      )
      assert.strictEqual(text, "hello world")
    }))

  test("ES-014", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `$eval` rejects with "Failed to find element matching selector"; a locator's evaluation reads
      // once and fails with `NoMatch`, which is what the port asserts
      const error = yield* failureOf(page.locator("section").first.evaluate((e) => e.id))
      assert.strictEqual(reasonOf(error), "NoMatch")
      assert.include(Locator.isLocatorError(error) ? error.message : String(error), "section")
    }))

  test("ES-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section><div>hello</div></section>")
      const text = yield* page.locator("section").locator("div").first.evaluate(
        (e, suffix) => e.textContent + suffix,
        " world!"
      )
      assert.strictEqual(text, "hello world!")
    }))

  test("ES-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section><div><span>hello</span></div></section>")
      // `xpath=/html/body/section >> css=div >> text="hello"`, with the XPath step as the CSS path to the same element
      const text = yield* page.locator("html > body > section")
        .locator("div")
        .getByText("hello", { exact: true })
        .first
        .evaluate((e, suffix) => e.textContent + suffix, " world!")
      assert.strictEqual(text, "hello world!")
    }))

  test("ES-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html", { waitUntil: "load" })
      // The original's selector is ' css = div >>css=div>>css   = span  ': the spaces are the selector's, and the
      // three chained divs and spans reach into open shadow roots. The first match in document order is the span
      // in root2, and its text is what Playwright's `$eval` reads, so the port reads text from the first match.
      const text = yield* page.locator("div").locator("div").locator("span").first.readText
      assert.strictEqual(text, "Hello from root2")
    }))

  test("ES-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span>Next</span><button>Previous</button><button>Next</button></div>")
      // `button >> "Next"` matches the button by its own text, which a child query can't (it searches descendants), so
      // the button is filtered by text, exactly "Next", as `text="Next"` matches
      const html = yield* page.locator("button").filter({ hasText: /^Next$/ }).first.evaluate((e) => e.outerHTML)
      assert.strictEqual(html, "<button>Next</button>")
    }))

  test("ES-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<section><div><span>a</span></div></section><section><div><span>b</span></div></section>"
      )
      // The div that holds the exact text "b", as `*` captures it
      const holdsB = Locator.relative.getByText("b", { exact: true })
      assert.strictEqual(
        yield* page.locator("div").filter({ has: holdsB }).first.evaluate((e) => e.outerHTML),
        "<div><span>b</span></div>"
      )
      assert.strictEqual(
        yield* page.locator("section").locator("div").filter({ has: holdsB }).first.evaluate((e) => e.outerHTML),
        "<div><span>b</span></div>"
      )
      // The capture is the last segment, which is the chain's own result
      assert.strictEqual(
        yield* page.locator("div").getByText("b", { exact: true }).first.evaluate((e) => e.outerHTML),
        "<span>b</span>"
      )
      // `page.$("*")` finds an element; the page has several
      assert.isAbove(yield* page.locator("*").count, 0)
    }))

  test("ES-022", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><input placeholder=\"Select date\"></div>")
      // `page.waitForSelector` waits for `visible`, which the input is
      const found = [
        page.locator(`[placeholder="Select date"]`),
        page.locator(`[placeholder='Select date']`),
        page.locator(`input[placeholder="Select date"]`),
        page.locator(`input[placeholder='Select date']`)
      ]
      for (const input of found) yield* Expect.toBeVisible(input)
      // `page.$`: the input is there
      for (const input of found) assert.isAbove(yield* input.count, 0)
      // `$eval`, with each selector's `css=` prefix dropped, and the two `div >>` chains
      const outer = "<input placeholder=\"Select date\">"
      const evaluated = [
        page.locator(`[placeholder="Select date"]`),
        page.locator(`[placeholder='Select date']`),
        page.locator(`input[placeholder="Select date"]`),
        page.locator(`input[placeholder='Select date']`),
        page.locator(`[placeholder="Select date"]`),
        page.locator(`[placeholder='Select date']`),
        page.locator(`input[placeholder="Select date"]`),
        page.locator(`input[placeholder='Select date']`),
        page.locator("div").locator(`[placeholder="Select date"]`),
        page.locator("div").locator(`[placeholder='Select date']`)
      ]
      for (const input of evaluated) {
        assert.strictEqual(yield* input.first.evaluate((e) => e.outerHTML), outer)
      }
    }))

  test("ES-023", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><input placeholder=\"Select&quot;date\"></div>")
      assert.isAbove(yield* page.locator(`[placeholder="Select\\"date"]`).count, 0)
      assert.isAbove(yield* page.locator(`[placeholder='Select"date']`).count, 0)
      yield* page.setContent("<div><input placeholder=\"Select &quot; date\"></div>")
      assert.isAbove(yield* page.locator(`[placeholder="Select \\" date"]`).count, 0)
      assert.isAbove(yield* page.locator(`[placeholder='Select " date']`).count, 0)
      yield* page.setContent("<div><input placeholder=\"Select&apos;date\"></div>")
      assert.isAbove(yield* page.locator(`[placeholder="Select'date"]`).count, 0)
      assert.isAbove(yield* page.locator(`[placeholder='Select\\'date']`).count, 0)
      yield* page.setContent("<div><input placeholder=\"Select &apos; date\"></div>")
      assert.isAbove(yield* page.locator(`[placeholder="Select ' date"]`).count, 0)
      assert.isAbove(yield* page.locator(`[placeholder='Select \\' date']`).count, 0)
    }))

  test("ES-024", ({ page }) =>
    Effect.gen(function*() {
      // The original starts its wait for `visible` before the input exists, and awaits it after the content is set
      const input = yield* startWaiting(Expect.toBeVisible(page.locator(`[placeholder="Select date"]`)))
      assert.strictEqual(yield* page.locator(`[placeholder="Select date"]`).count, 0)
      yield* page.setContent("<div><input placeholder=\"Select date\"></div>")
      yield* Fiber.join(input.fiber)
    }))

  test("ES-025", ({ page }) =>
    Effect.gen(function*() {
      const input = yield* startWaiting(Expect.toBeVisible(page.locator(`[placeholder="Select\\"date"]`)))
      assert.strictEqual(yield* page.locator(`[placeholder="Select\\"date"]`).count, 0)
      yield* page.setContent("<div><input placeholder=\"Select&quot;date\"></div>")
      yield* Fiber.join(input.fiber)
    }))

  test("ES-026", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      // The complex value comes back by value, as `$eval` returns it
      const value = yield* page.locator("section").first.evaluate((e) => [{ id: e.id }])
      assert.deepStrictEqual(value, [{ id: "testAttribute" }])
    }))
})
