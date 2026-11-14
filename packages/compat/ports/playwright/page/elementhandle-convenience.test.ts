/**
 * Playwright's `tests/page/elementhandle-convenience.spec.ts`: an element handle's reads (`getAttribute`, `inputValue`,
 * `innerHTML`, `innerText`, `textContent`, `isVisible`, `isHidden`, `isEnabled`, `isDisabled`, `isEditable`, and
 * `isChecked`) and the handle's `String()` preview. EH-026 to EH-031 and EH-033 to EH-038 are ported. EH-024, EH-025,
 * and EH-032 are `needsFeature` (see the ledger): Strider has no handle to print and no handle to a shadow root.
 *
 * What the port changes:
 * - Element handles are lazy locators, as in locator-convenience: `page.$(sel)` is `page.locator(sel)`, and each read
 *   re-resolves the element. `page.getAttribute`, `page.inputValue`, and the other page-level reads are the same reads
 *   on `page.locator`.
 * - `getAttribute` is Strider's `readAttribute` (an `Option`), so a missing attribute is `undefined`, as in
 *   locator-convenience. `isHidden` and `isDisabled` are the inverses of `isVisible` and `isEnabled`, as the matrix rows
 *   map them.
 * - EH-029's `innerText` is `readText`, Strider's whitespace-normalized text: for this element it's the same string as the
 *   original's `innerText`, and `readText` runs without an isolated-world evaluation, which stock WebKit lacks.
 * - EH-030's `innerText` is `readText`, asserted to fail with `WrongElement` on an SVG element, as Playwright's does. Strider's
 *   `readText` has no such refusal, so the test is expected to fail.
 * - EH-031's `textContent` keeps the newline the original asserts. `readText` would collapse it, so the port reads the
 *   element's `textContent` property in the main world (`page.evaluateInMainWorld`, which stock WebKit runs, where
 *   `locator.evaluate` needs an isolated world).
 * - EH-028's `innerHTML` is the `innerHTML` property read the same way, since `readHtml` is the outer HTML.
 * - Playwright's `page.$eval` and `handle.evaluate` run in the page's main world: `page.evaluateInMainWorld`.
 * - Playwright's error messages are checked by Strider's typed reason (`WrongElement`), and the message is checked
 *   for what the original's says, as in locator-convenience.
 * - EH-034's `page.evaluate` sets up the page's own `requestAnimationFrame` loop; the port runs the same script in the
 *   main world.
 * - `:text("…")` is `page.getByText`, as in locator-convenience.
 * - EH-038's `handle.evaluate` sets `checked` on the element in the main world, as the original does.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** An attribute's value, or `undefined` when the element doesn't have it, as Playwright's `null` reads. */
const attributeOf = (locator: Locator.ReadonlyLocator, name: string) =>
  Effect.map(locator.readAttribute(name), Option.getOrUndefined)

/** `isVisible` inverted: Strider has no `isHidden` read, and the matrix row maps it this way. */
const isHidden = (locator: Locator.ReadonlyLocator) => Effect.map(locator.isVisible, (visible) => !visible)

/** `isEnabled` inverted: Strider has no `isDisabled` read, and the matrix row maps it this way. */
const isDisabled = (locator: Locator.ReadonlyLocator) => Effect.map(locator.isEnabled, (enabled) => !enabled)

upstream(import.meta.filename, {}, (test) => {
  test("EH-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      const handle = page.locator("#outer")
      assert.strictEqual(yield* attributeOf(handle, "name"), "value")
      assert.strictEqual(yield* attributeOf(handle, "foo"), undefined)
      assert.strictEqual(yield* attributeOf(page.locator("#outer"), "name"), "value")
      assert.strictEqual(yield* attributeOf(page.locator("#outer"), "foo"), undefined)
    }))

  test("EH-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")

      yield* page.locator("#select").selectOption({ value: "foo" })
      assert.strictEqual(yield* page.locator("#select").readValue, "foo")

      yield* page.locator("#textarea").fill("text value")
      assert.strictEqual(yield* page.locator("#textarea").readValue, "text value")

      yield* page.locator("#input").fill("input value")
      assert.strictEqual(yield* page.locator("#input").readValue, "input value")
      const handle = page.locator("#input")
      assert.strictEqual(yield* handle.readValue, "input value")

      // Playwright: "Node is not an <input>, <textarea> or <select> element"
      const failure = yield* Effect.flip(page.locator("#inner").readValue)
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "WrongElement")
      assert(failure.reason.message.includes("an input, a textarea, or a select"), failure.reason.message)
      const handle2 = page.locator("#inner")
      const failure2 = yield* Effect.flip(handle2.readValue)
      assert(Locator.isLocatorError(failure2), String(failure2))
      assert.strictEqual(failure2.reason._tag, "WrongElement")
    }))

  test("EH-028", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      // `readHtml` is the outer HTML, so the inner markup is the element's `innerHTML` property, read in the main world.
      const innerHtml = page.evaluateInMainWorld(() => document.querySelector("#outer")!.innerHTML)
      assert.strictEqual(yield* innerHtml, "<div id=\"inner\">Text,\nmore text</div>")
      assert.strictEqual(yield* innerHtml, "<div id=\"inner\">Text,\nmore text</div>")
    }))

  test("EH-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      // Playwright's innerText is "Text, more text" here; `readText` gives that same string, whitespace-normalized.
      assert.strictEqual(yield* page.locator("#inner").readText, "Text, more text")
      assert.strictEqual(yield* page.locator("#inner").readText, "Text, more text")
    }))

  test("EH-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<svg>text</svg>`)
      // Playwright's `innerText` throws "Node is not an HTMLElement" for an SVG element. Strider's `readText` is its
      // counterpart, and it is not specified to refuse a non-HTML element: the port asserts the refusal, so it fails
      // wherever `readText` reads the SVG's text.
      const failure = yield* failureOf(page.locator("svg").readText, "readText of an SVG")
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "WrongElement")
      const handle = page.locator("svg")
      const failure2 = yield* failureOf(handle.readText, "readText of an SVG handle")
      assert(Locator.isLocatorError(failure2), String(failure2))
      assert.strictEqual(failure2.reason._tag, "WrongElement")
    }))

  test("EH-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dom.html")
      // `readText` collapses the newline, so the original's `textContent` is the element's property, read in the main world.
      const textContent = page.evaluateInMainWorld(() => document.querySelector("#inner")!.textContent)
      assert.strictEqual(yield* textContent, "Text,\nmore text")
      assert.strictEqual(yield* textContent, "Text,\nmore text")
    }))

  test("EH-033", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Hi</div><span></span>`)

      const div = page.locator("div")
      assert.strictEqual(yield* div.isVisible, true)
      assert.strictEqual(yield* isHidden(div), false)
      assert.strictEqual(yield* page.locator("div").isVisible, true)
      assert.strictEqual(yield* isHidden(page.locator("div")), false)

      const span = page.locator("span")
      assert.strictEqual(yield* span.isVisible, false)
      assert.strictEqual(yield* isHidden(span), true)
      assert.strictEqual(yield* page.locator("span").isVisible, false)
      assert.strictEqual(yield* isHidden(page.locator("span")), true)

      // A missing element is not visible, so it is hidden
      assert.strictEqual(yield* page.locator("no-such-element").isVisible, false)
      assert.strictEqual(yield* isHidden(page.locator("no-such-element")), true)
    }))

  test("EH-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id="root"></div>`)
      // The original's page.evaluate starts the loop; the port runs the same script in the main world.
      yield* page.evaluateInMainWorld(() => {
        function insert() {
          document.getElementById("root")!.innerHTML = "<div id=\"problem\">Problem</div>"
          window.requestAnimationFrame(remove)
        }
        function remove() {
          const node = document.getElementById("problem")
          node?.parentNode?.removeChild(node)
          window.requestAnimationFrame(insert)
        }
        window.requestAnimationFrame(insert)
      })

      for (let i = 0; i < 10; i++) {
        yield* page.locator("#problem").isVisible
      }
    }))

  test("EH-035", ({ page }) =>
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

  test("EH-036", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select name="select">
      <option id="enabled1" value="1">Enabled</option>
      <option id="disabled1" value="2" disabled>Disabled</option>
      <optgroup label="Foo1">
        <option value="mercedes">Mercedes</option>
      </optgroup>
      <optgroup label="Foo2" disabled>
        <option value="mercedes">Mercedes</option>
      </optgroup>
    </select>
  `)
      assert.strictEqual(yield* page.locator("#enabled1").isEnabled, true)
      assert.strictEqual(yield* isDisabled(page.locator("#enabled1")), false)
      assert.strictEqual(yield* page.locator("#disabled1").isEnabled, false)
      assert.strictEqual(yield* isDisabled(page.locator("#disabled1")), true)
      assert.strictEqual(yield* page.locator("optgroup").nth(0).isEnabled, true)
      assert.strictEqual(yield* isDisabled(page.locator("optgroup").nth(0)), false)
      assert.strictEqual(yield* page.locator("optgroup").nth(1).isEnabled, false)
      assert.strictEqual(yield* isDisabled(page.locator("optgroup").nth(1)), true)
    }))

  test("EH-037", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id=input1 disabled><textarea></textarea><input id=input2>`)
      // The original's `page.$eval` sets `readOnly` in the main world.
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("textarea") as HTMLTextAreaElement).readOnly = true
      })
      assert.strictEqual(yield* page.locator("#input1").isEditable, false)
      assert.strictEqual(yield* page.locator("#input1").isEditable, false)
      assert.strictEqual(yield* page.locator("#input2").isEditable, true)
      assert.strictEqual(yield* page.locator("#input2").isEditable, true)
      assert.strictEqual(yield* page.locator("textarea").isEditable, false)
      assert.strictEqual(yield* page.locator("textarea").isEditable, false)
    }))

  test("EH-038", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='checkbox' checked><div>Not a checkbox</div>`)
      const handle = page.locator("input")
      assert.strictEqual(yield* handle.isChecked, true)
      assert.strictEqual(yield* page.locator("input").isChecked, true)
      // The original's `handle.evaluate` runs in the main world.
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).checked = false
      })
      assert.strictEqual(yield* handle.isChecked, false)
      assert.strictEqual(yield* page.locator("input").isChecked, false)
      // Playwright: "Not a checkbox or radio button"
      const failure = yield* Effect.flip(page.locator("div").isChecked)
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "WrongElement")
      assert(failure.reason.message.includes("a checkbox, a radio, or an ARIA checkable"), failure.reason.message)
    }))
})
