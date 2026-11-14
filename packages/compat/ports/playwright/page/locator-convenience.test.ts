/**
 * Playwright's `tests/page/locator-convenience.spec.ts`: a locator's reads (`getAttribute`, `inputValue`, `innerHTML`,
 * `innerText`, `textContent`, `isEnabled`, `isEditable`, `isChecked`, `allTextContents`, `allInnerTexts`), and its
 * `description`, `page()`, and `toString()`. LO-058 to LO-061, LO-063 to LO-065, and LO-067 to LO-070 are ported. LO-057, LO-062, and
 * LO-071 to LO-078 are `needsFeature`, and LO-066 is `differentByDesign` (see the ledger): Strider has no locator read that returns raw text, `page()`,
 * `description()`, or a `toString()` of the Playwright form.
 *
 * What the port changes:
 * - `getAttribute`, `isEnabled`, `inputValue`, `isChecked`, and `isEditable` are Strider's `readAttribute` (an `Option`),
 *   `isEnabled`, `readValue`, `isChecked`, and `isEditable`. Page-level calls (`page.getAttribute`, `page.inputValue`,
 *   `page.isChecked`, …) are the same reads on `page.locator`, which Strider's page has no other form of.
 * - Strider has no `isDisabled` read. The matrix row says to read it as the inverse of `isEnabled`, so LO-065 does.
 * - Playwright's `innerHTML`, `innerText`, `textContent`, and the `all…Texts` reads have no Strider form: `readText`
 *   collapses whitespace, and `readHtml` is the outer HTML. Each is `locator.evaluate` of the element's property, which
 *   runs in an isolated world; stock WebKit has none, so these are `needsFeature` there. The matrix rows name this path.
 * - LO-063's `innerText` waits for the element for its timeout, with Playwright's log. Strider's reads fail with
 *   `NoMatch` at once and don't wait, so the port asserts that typed reason and not the wait or its log.
 * - Playwright's errors are checked by Strider's typed reason, and its message is checked for what the original's says.
 * - `page.$eval`, `page.evaluate`, and element handles that change the page run in the main world:
 *   `page.evaluateInMainWorld`. A `locator.evaluate` that the original runs for its own handle, `element.evaluate`, is
 *   the locator's `evaluate` again.
 * - LO-066 is not ported: Playwright's `isEditable` throws for an unsupported kind (a button) and reads an ARIA-only
 *   textbox as editable, while Strider's reads return false for both, as its editing rules do. The ledger records that
 *   as a difference by design.
 * - `:text("…")` is `getByText`, which matches the smallest element whose text contains the string, case-insensitively.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default for `expect`, which waits 5 seconds; a Strider expectation otherwise runs to the test's deadline. */
const expectDeadline = Deadline.within("5 seconds")

/** An attribute's value, or `undefined` when the element doesn't have it, as Playwright's `null` reads. */
const attributeOf = (locator: Locator.ReadonlyLocator, name: string) =>
  Effect.map(locator.readAttribute(name), Option.getOrUndefined)

/** `isEnabled` inverted: Strider has no `isDisabled` read, and the matrix row maps it this way. */
const isDisabled = (locator: Locator.ReadonlyLocator) => Effect.map(locator.isEnabled, (enabled) => !enabled)

upstream(import.meta.filename, {}, (test) => {
  test("LO-058", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      const locator = page.locator("#outer")
      assert.strictEqual(yield* attributeOf(locator, "name"), "value")
      assert.strictEqual(yield* attributeOf(locator, "foo"), undefined)
      assert.strictEqual(yield* attributeOf(page.locator("#outer"), "name"), "value")
      assert.strictEqual(yield* attributeOf(page.locator("#outer"), "foo"), undefined)
    }))

  test("LO-059", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")

      yield* page.locator("#select").selectOption({ value: "foo" })
      assert.strictEqual(yield* page.locator("#select").readValue, "foo")

      yield* page.locator("#textarea").fill("text value")
      assert.strictEqual(yield* page.locator("#textarea").readValue, "text value")

      yield* page.locator("#input").fill("input value")
      assert.strictEqual(yield* page.locator("#input").readValue, "input value")
      const locator = page.locator("#input")
      assert.strictEqual(yield* locator.readValue, "input value")

      // Playwright: "Node is not an <input>, <textarea> or <select> element"
      const failure = yield* Effect.flip(page.locator("#inner").readValue)
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "WrongElement")
      assert(
        failure.reason.message.includes("an input, a textarea, or a select"),
        failure.reason.message
      )
      const locator2 = page.locator("#inner")
      const failure2 = yield* Effect.flip(locator2.readValue)
      assert(Locator.isLocatorError(failure2), String(failure2))
      assert.strictEqual(failure2.reason._tag, "WrongElement")
    }))

  test("LO-060", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      const locator = page.locator("#outer")
      // Strider's `readHtml` is the outer HTML, so the inner markup is read as the element's `innerHTML` property.
      assert.strictEqual(
        yield* locator.evaluate((element) => element.innerHTML),
        "<div id=\"inner\">Text,\nmore text</div>"
      )
      assert.strictEqual(
        yield* page.locator("#outer").evaluate((element) => element.innerHTML),
        "<div id=\"inner\">Text,\nmore text</div>"
      )
    }))

  test("LO-061", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      const locator = page.locator("#inner")
      assert.strictEqual(
        yield* locator.evaluate((element) => (element as HTMLElement).innerText),
        "Text, more text"
      )
      assert.strictEqual(
        yield* page.locator("#inner").evaluate((element) => (element as HTMLElement).innerText),
        "Text, more text"
      )
    }))

  test("LO-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Hello</div>`)
      // The original waits 1 second for the span, with Playwright's log. Strider's reads fail with NoMatch at once;
      // `readText` is the read that does, since no element is there to evaluate on, and it runs on stock WebKit.
      const failure = yield* Effect.flip(page.locator("span").readText)
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "NoMatch")
    }))

  test("LO-064", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      const locator = page.locator("#inner")
      assert.strictEqual(yield* locator.evaluate((element) => element.textContent), "Text,\nmore text")
      assert.strictEqual(
        yield* page.locator("#inner").evaluate((element) => element.textContent),
        "Text,\nmore text"
      )
    }))

  test("LO-065", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button disabled>button1</button>
    <button>button2</button>
    <div>div</div>
  `)
      const div = page.locator("div")
      assert.strictEqual(yield* div.isEnabled, true)
      assert.strictEqual(yield* isDisabled(div), false)
      assert.strictEqual(yield* page.locator("div").isEnabled, true)
      assert.strictEqual(yield* isDisabled(page.locator("div")), false)
      const button1 = page.getByText("button1")
      assert.strictEqual(yield* button1.isEnabled, false)
      assert.strictEqual(yield* isDisabled(button1), true)
      assert.strictEqual(yield* page.getByText("button1").isEnabled, false)
      assert.strictEqual(yield* isDisabled(page.getByText("button1")), true)
      const button2 = page.getByText("button2")
      assert.strictEqual(yield* button2.isEnabled, true)
      assert.strictEqual(yield* isDisabled(button2), false)
      assert.strictEqual(yield* page.getByText("button2").isEnabled, true)
      assert.strictEqual(yield* isDisabled(page.getByText("button2")), false)
    }))

  test("LO-067", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='checkbox' checked><div>Not a checkbox</div>`)
      const element = page.locator("input")
      assert.strictEqual(yield* element.isChecked, true)
      assert.strictEqual(yield* page.locator("input").isChecked, true)
      // The original sets `checked` on the element from the page; the port sets it in the main world.
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).checked = false
      })
      assert.strictEqual(yield* element.isChecked, false)
      assert.strictEqual(yield* page.locator("input").isChecked, false)
      // Playwright: "Not a checkbox or radio button"
      const failure = yield* Effect.flip(page.locator("div").isChecked)
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "WrongElement")
      assert(
        failure.reason.message.includes("a checkbox, a radio, or an ARIA checkable"),
        failure.reason.message
      )
    }))

  test("LO-068", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="checkbox" checked>`)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).indeterminate = true
      })

      assert.strictEqual(yield* page.locator("input").isChecked, true)
      yield* Expect.toBeChecked(page.locator("input")).pipe(expectDeadline)

      yield* page.locator("input").uncheck()

      assert.strictEqual(yield* page.locator("input").isChecked, false)
      yield* Expect.that(
        page.locator("input").isChecked,
        Condition.make("unchecked", (checked: boolean) => checked === false)
      ).pipe(expectDeadline)
    }))

  test("LO-069", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>A</div><div>B</div><div>C</div>`)
      const divs = yield* page.locator("div").all
      const texts = yield* Effect.forEach(divs, (div) => div.evaluate((element) => element.textContent))
      assert.deepStrictEqual(texts, ["A", "B", "C"])
    }))

  test("LO-070", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>A</div><div>B</div><div>C</div>`)
      const divs = yield* page.locator("div").all
      const texts = yield* Effect.forEach(
        divs,
        (div) => div.evaluate((element) => (element as HTMLElement).innerText)
      )
      assert.deepStrictEqual(texts, ["A", "B", "C"])
    }))
})
