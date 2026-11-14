/**
 * Playwright's `tests/page/retarget.spec.ts`: an action or a state check on a label, or on a child of a button, a link,
 * or a control, applies to the element the check names, as Playwright retargets it.
 *
 * What the port changes:
 * - Strider has no ElementHandle, so each `page.$(selector)` handle is the locator that found it. A handle's
 *   `waitForElementState(state)` is the matching `Expect` matcher on that locator, and its reads are the locator's.
 * - Playwright's `page.isVisible`, `page.isEnabled`, `page.check`, and their kin are the locator's, on
 *   `page.locator(selector)`. Strider's locator is strict, where Playwright's page call takes the first match; every
 *   selector these tests use matches one element.
 * - `isHidden()` and `isDisabled()` are the inverse of `isVisible` and `isEnabled`, as the matrix maps them
 *   (`method-locator-ishidden`, `method-locator-isdisabled`). `not.toBeVisible`, `not.toBeEnabled`, and their kin are
 *   `toBeHidden` and `toBeDisabled`, the inverse matchers; `not.toBeEditable`, `not.toBeChecked`, and `not.toBeFocused`
 *   have no inverse matcher, so they're `Expect.that` over the read, waiting for it to be false (`property-locatorassertions-not`).
 * - `page.setInputFiles` and `page.selectOption` are the locator's `setInputFiles` and `selectOption` with
 *   `FileInput.local` and `{ value }`, where Playwright takes a path string and a value string.
 * - `innerText()` and `textContent()` are `readText`, the engine's whitespace-collapsed text, which these plain
 *   `content` elements read the same way.
 * - `locator.setChecked(false)` is `uncheck()`: Strider has no `setChecked` alias (`method-locator-setchecked`).
 * - `toHaveId` is `toHaveAttribute("id", …)`, the check it stands for. `toHaveJSProperty` has no Strider matcher
 *   (`method-locatorassertions-tohavejsproperty`); RE-013 expresses it as `Expect.that` over a main-world read of the
 *   property, which waits for the value as the matcher does.
 * - `page.$eval` and `page.evaluate` steps that change the page or read its globals run in the main world with
 *   `evaluateInMainWorld`, and so do reads of `window.getSelection()`.
 * - `rafraf(page, 5)` is the harness's `rafraf` with the same count.
 * - A check the original holds across steps (`const promise = handle.waitForElementState(…).then(() => done = true)`)
 *   is a child fiber started at once, joined where the original awaits it.
 * - RE-006 loads `file-to-upload.txt` from the vendored assets: `FileInput.local` takes its path on the host.
 * - RE-007 to RE-014 run their cases in a loop with `it.step`'s description as the label; a failing case fails the test,
 *   as a failing step does.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, FileInput, type Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { assetPath, rafraf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The vendored `file-to-upload.txt`, which the original's `asset()` names under `tests/assets`. */
const fileToUpload = assetPath("playwright", "file-to-upload.txt")

/**
 * The locator for a case's selector. `option >> nth=0` is Playwright's selector string for the first option, which is
 * the locator's `nth(0)`.
 */
const locatorOf = (page: Page.Page, selector: string): Locator.Locator =>
  selector === "option >> nth=0" ? page.locator("option").nth(0) : page.locator(selector)

/** Playwright's `giveItAChanceToResolve(page)`: `rafraf(page, 5)`. */
const giveItAChanceToResolve = (page: Page.Page) => rafraf(page, 5)

/**
 * Playwright's `expect(x).not.toBeX()` for a boolean read that has no inverse matcher: waits for the read to be false.
 */
const notHolding = <E, R>(read: Effect.Effect<boolean, E, R>, state: string) =>
  Expect.that(read, Condition.make(`not ${state}`, (value: boolean) => !value))

type Options = { disabled?: boolean; hidden?: boolean; readonly?: boolean }
const optionsToAttributes = (options: Options | undefined) =>
  ` ${options?.disabled ? "disabled" : ""} ${options?.hidden ? "hidden" : ""} ${options?.readonly ? "readonly" : ""} `
const domInLabel = (dom: string, options?: Options) => `<label ${optionsToAttributes(options)}>Text ${dom}</label>`
const domLabelFor = (dom: string, options?: Options) =>
  `<label ${optionsToAttributes(options)} for="target"><h1>Text</h1></label>${dom}`
const domStandalone = (dom: string) => dom
const domInButton = (dom: string, options?: Options) => `<button ${optionsToAttributes(options)}>Button ${dom}</button>`
const domInLink = (dom: string, options?: Options) => `<button ${optionsToAttributes(options)}>Button ${dom}</button>`

/** Whether the page's one `div` has focus, read in the main world: `document.activeElement` is that element. */
const focusedIsDiv = (page: Page.Page) =>
  page.evaluateInMainWorld(() => document.activeElement === document.querySelector("div"))

upstream(import.meta.filename, {}, (test) => {
  test("RE-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <label>
      Click me
      <input disabled style="width:0;height:0;padding:0;margin:0;border:0;">
    </label>
  `)
      // Visible checks the label. `text=Click me` is `getByText`, which matches the label as a substring.
      const label = page.getByText("Click me")
      assert.isTrue(yield* label.isVisible)
      // isHidden is the inverse of isVisible (method-locator-ishidden)
      assert.isFalse(!(yield* label.isVisible))

      // Enabled checks the input.
      assert.isFalse(yield* label.isEnabled)
      // isDisabled is the inverse of isEnabled (method-locator-isdisabled)
      assert.isTrue(!(yield* label.isEnabled))
    }))

  test("RE-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button><span>Target</span></button>")
      const span = page.getByText("Target")
      const waiting = yield* startWaiting(Expect.toBeDisabled(span))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("span")!.parentElement as HTMLButtonElement).disabled = true
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("RE-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<fieldset disabled=true><button><span>Target</span></button></div>")
      const span = page.getByText("Target")
      const waiting = yield* startWaiting(Expect.toBeEnabled(span))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("span")!.parentElement!.parentElement as HTMLFieldSetElement).disabled = false
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("RE-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button disabled><span>Target</span></button>")
      const span = page.getByText("Target")
      const waiting = yield* startWaiting(Expect.toBeEnabled(span))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("span")!.parentElement as HTMLButtonElement).disabled = false
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("RE-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      yield* page.evaluateInMainWorld(() => {
        const div = document.querySelector("div")!
        const root = div.attachShadow({ mode: "open" })
        const label = document.createElement("label")
        label.setAttribute("for", "target")
        label.textContent = "Click me"
        root.appendChild(label)
        const input = document.createElement("input")
        input.setAttribute("type", "checkbox")
        input.setAttribute("id", "target")
        root.appendChild(input)
      })
      yield* page.locator("label").check()
      // The original reads `input.checked` through `$eval`, which pierces the open shadow root; the locator does too
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("RE-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label for=target>Choose a file</label><input id=target type=file>`)
      yield* page.getByText("Choose a file").setInputFiles(FileInput.local(fileToUpload))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (document.querySelector("input") as HTMLInputElement).files!.length),
        1
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (document.querySelector("input") as HTMLInputElement).files?.[0]?.name),
        "file-to-upload.txt"
      )
    }))

  test("RE-007", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domInLabel(`<input id=target>`), enabled: true, locator: "label" },
        { dom: domLabelFor(`<input id=target>`), enabled: true, locator: "label" },
        { dom: domStandalone(`<input id=target>`), enabled: true, locator: "input" },
        { dom: domInButton(`<input id=target>`), enabled: true, locator: "input" },
        { dom: domInLink(`<input id=target>`), enabled: true, locator: "input" },
        { dom: domInButton(`<input id=target>`, { disabled: true }), enabled: true, locator: "input" },
        { dom: domInLabel(`<li role=menuitem id=target aria-disabled=false></li>`), enabled: true, locator: "li" },

        { dom: domInLabel(`<input id=target disabled>`), enabled: false, locator: "label" },
        { dom: domLabelFor(`<input id=target disabled>`), enabled: false, locator: "label" },
        { dom: domStandalone(`<input id=target disabled>`), enabled: false, locator: "input" },
        { dom: domInButton(`<input id=target disabled>`), enabled: false, locator: "input" },
        { dom: domInLink(`<input id=target disabled>`), enabled: false, locator: "input" },
        { dom: domInButton(`<input id=target disabled>`, { disabled: true }), enabled: false, locator: "input" },
        { dom: domInLabel(`<li role=menuitem id=target aria-disabled=true></li>`), enabled: false, locator: "li" },
        {
          dom: domInLabel(`<select><option disabled>Other employees</option><option>Alex</option></select>`),
          enabled: false,
          locator: "option >> nth=0"
        },
        {
          dom: domInLabel(
            `<select><optgroup disabled label="Other employees"><option>Alex</option></optgroup></select>`
          ),
          enabled: false,
          locator: "optgroup"
        }
      ]
      for (const { dom, enabled, locator } of cases) {
        // Each case is one `it.step`: a failing case fails the test
        yield* page.setContent(dom)
        const target = locatorOf(page, locator)
        assert.strictEqual(yield* target.isEnabled, enabled)
        // isDisabled is the inverse of isEnabled (method-locator-isdisabled)
        assert.strictEqual(!(yield* target.isEnabled), !enabled)
        // `not.toBeDisabled` is `toBeEnabled`, and `not.toBeEnabled` is `toBeDisabled`, their inverse matchers. The
        // handle's waitForElementState is the same matcher on the same locator.
        if (enabled) {
          yield* Expect.toBeEnabled(target)
          yield* Expect.toBeEnabled(target)
          yield* Expect.toBeEnabled(target)
        } else {
          yield* Expect.toBeDisabled(target)
          yield* Expect.toBeDisabled(target)
          yield* Expect.toBeDisabled(target)
        }
      }
    }))

  test("RE-008", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domInLabel(`<span id=target>content</span>`), visible: true, locator: "label" },
        { dom: domInLabel(`<span id=target hidden>content</span>`), visible: true, locator: "label" },
        { dom: domLabelFor(`<span id=target>content</span>`), visible: true, locator: "label" },
        { dom: domLabelFor(`<span id=target hidden>content</span>`), visible: true, locator: "label" },
        { dom: domStandalone(`<span id=target>content</span>`), visible: true, locator: "span" },
        { dom: domInButton(`<span id=target>content</span>`), visible: true, locator: "span" },
        { dom: domInLink(`<span id=target>content</span>`), visible: true, locator: "span" },

        { dom: domInLabel(`<span id=target>content</span>`, { hidden: true }), visible: false, locator: "label" },
        { dom: domLabelFor(`<span id=target>content</span>`, { hidden: true }), visible: false, locator: "label" },
        { dom: domStandalone(`<span id=target hidden>content</span>`), visible: false, locator: "span" },
        { dom: domInButton(`<span id=target hidden>content</span>`), visible: false, locator: "span" },
        { dom: domInButton(`<span id=target>content</span>`, { hidden: true }), visible: false, locator: "span" },
        { dom: domInLink(`<span id=target hidden>content</span>`), visible: false, locator: "span" },
        { dom: domInLink(`<span id=target>content</span>`, { hidden: true }), visible: false, locator: "span" }
      ]
      for (const { dom, visible, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)
        assert.strictEqual(yield* target.isVisible, visible)
        // isHidden is the inverse of isVisible (method-locator-ishidden)
        assert.strictEqual(!(yield* target.isVisible), !visible)
        // `not.toBeHidden` is `toBeVisible`, and `not.toBeVisible` is `toBeHidden`; the handle's wait is the same matcher
        if (visible) {
          yield* Expect.toBeVisible(target)
          yield* Expect.toBeVisible(target)
          yield* Expect.toBeVisible(target)
        } else {
          yield* Expect.toBeHidden(target)
          yield* Expect.toBeHidden(target)
          yield* Expect.toBeHidden(target)
        }
      }
    }))

  test("RE-009", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domInLabel(`<input id=target>`), editable: true, locator: "label" },
        { dom: domLabelFor(`<input id=target>`), editable: true, locator: "label" },
        { dom: domStandalone(`<input id=target>`), editable: true, locator: "input" },
        { dom: domInButton(`<input id=target>`), editable: true, locator: "input" },
        { dom: domInLink(`<input id=target>`), editable: true, locator: "input" },
        { dom: domInButton(`<input id=target>`, { readonly: true }), editable: true, locator: "input" },

        { dom: domInLabel(`<input id=target readonly>`), editable: false, locator: "label" },
        { dom: domLabelFor(`<input id=target readonly>`), editable: false, locator: "label" },
        { dom: domStandalone(`<input id=target readonly>`), editable: false, locator: "input" },
        { dom: domInButton(`<input id=target readonly>`), editable: false, locator: "input" },
        { dom: domInLink(`<input id=target readonly>`), editable: false, locator: "input" },
        { dom: domInButton(`<input id=target readonly>`, { readonly: true }), editable: false, locator: "input" }
      ]
      for (const { dom, editable, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)
        assert.strictEqual(yield* target.isEditable, editable)
        if (editable) {
          yield* Expect.toBeEditable(target)
          yield* Expect.toBeEditable(target)
        } else {
          yield* notHolding(target.isEditable, "editable")
        }
      }
    }))

  test("RE-010", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domInLabel(`<input id=target>`), locator: "label" },
        { dom: domLabelFor(`<input id=target>`), locator: "label" },
        { dom: domStandalone(`<input id=target>`), locator: "input" },
        { dom: domInButton(`<input id=target>`), locator: "input" },
        { dom: domInLink(`<input id=target>`), locator: "input" },
        { dom: domInButton(`<input id=target>`), locator: "input" }
      ]
      for (const { dom, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)

        assert.strictEqual(yield* target.readValue, "")
        assert.strictEqual(yield* target.readValue, "")
        yield* Expect.toHaveValue(target, "")

        yield* target.fill("foo")
        assert.strictEqual(yield* target.readValue, "foo")
        assert.strictEqual(yield* target.readValue, "foo")
        yield* Expect.toHaveValue(target, "foo")

        yield* page.evaluateInMainWorld(() => {
          ;(document.querySelector("#target") as HTMLInputElement).value = "bar"
        })
        assert.strictEqual(yield* target.readValue, "bar")
        assert.strictEqual(yield* target.readValue, "bar")
        yield* Expect.toHaveValue(target, "bar")

        yield* target.selectText()
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() => window.getSelection()!.toString()),
          "bar"
        )
      }
    }))

  test("RE-011", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domStandalone(`<div contenteditable id=target>content</div>`), locator: "div" },
        { dom: domInButton(`<div contenteditable id=target>content</div>`), locator: "div" },
        { dom: domInLink(`<div contenteditable id=target>content</div>`), locator: "div" },
        { dom: domInButton(`<div contenteditable id=target>content</div>`), locator: "div" }
      ]
      for (const { dom, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)

        assert.isTrue(yield* target.isEditable)
        assert.isTrue(yield* target.isEditable)
        yield* Expect.toHaveText(page.locator("#target"), "content")

        yield* target.fill("foo")
        yield* Expect.toHaveText(page.locator("#target"), "foo")

        yield* target.selectText()
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() => window.getSelection()!.toString()),
          "foo"
        )
      }
    }))

  test("RE-012", ({ page }) =>
    Effect.gen(function*() {
      const options =
        `<select id=target multiple><option value=dog selected>Dog</option><option value=cat>Cat</option></select>`
      const cases = [
        { dom: domInLabel(options), locator: "label" },
        { dom: domLabelFor(options), locator: "label" },
        { dom: domStandalone(options), locator: "select" },
        { dom: domInButton(options), locator: "select" },
        { dom: domInLink(options), locator: "select" },
        { dom: domInButton(options), locator: "select" }
      ]
      for (const { dom, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)

        assert.strictEqual(yield* target.readValue, "dog")
        assert.strictEqual(yield* target.readValue, "dog")
        yield* Expect.toHaveValue(target, "dog")
        yield* Expect.toHaveValues(target, ["dog"])

        yield* target.selectOption({ value: "cat" })
        assert.strictEqual(yield* target.readValue, "cat")
        assert.strictEqual(yield* target.readValue, "cat")
        yield* Expect.toHaveValue(target, "cat")
        yield* Expect.toHaveValues(target, ["cat"])
      }
    }))

  test("RE-013", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domInLabel(`<div>content</div><input id=target value=oh>`), locator: "div" },
        { dom: domLabelFor(`<div>content</div><input id=target value=oh>`), locator: "div" },
        { dom: domStandalone(`<div>content</div>`), locator: "div" },
        { dom: domInButton(`<div>content</div>`), locator: "div" },
        { dom: domInLink(`<div>content</div>`), locator: "div" },
        { dom: domInButton(`<div>content</div>`), locator: "div" }
      ]
      for (const { dom, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)

        // innerText and textContent are both readText, the engine's text, which reads these plain strings alike
        assert.strictEqual(yield* target.readText, "content")
        assert.strictEqual(yield* target.readText, "content")
        yield* Expect.toHaveText(target, "content")
        yield* Expect.toContainText(target, "content")
        yield* notHolding(focusedIsDiv(page), "focused")
        yield* Expect.toHaveCount(target, 1)

        yield* page.evaluateInMainWorld(() => {
          ;(document.querySelector("div") as unknown as { foo?: string }).foo = "bar"
        })
        // toHaveJSProperty has no Strider matcher (method-locatorassertions-tohavejsproperty). The property is read in
        // the main world, where the page set it, and Expect.that waits for it to hold, as the matcher does.
        yield* Expect.that(
          page.evaluateInMainWorld(() => Reflect.get(document.querySelector("div")!, "foo") as unknown),
          Condition.make("foo is bar", (value) => value === "bar")
        )

        yield* page.evaluateInMainWorld(() => {
          document.querySelector("div")!.classList.add("cls")
        })
        yield* Expect.toHaveClass(target, "cls")

        yield* page.evaluateInMainWorld(() => {
          document.querySelector("div")!.id = "myid"
        })
        // toHaveId is the attribute check it stands for
        yield* Expect.toHaveAttribute(target, "id", "myid")
        yield* Expect.toHaveAttribute(target, "id", "myid")
        assert.deepStrictEqual(yield* target.readAttribute("id"), Option.some("myid"))
      }
    }))

  test("RE-014", ({ page }) =>
    Effect.gen(function*() {
      const cases = [
        { dom: domInLabel(`<input type=checkbox id=target>`), locator: "label" },
        { dom: domLabelFor(`<input type=checkbox id=target>`), locator: "label" },
        { dom: domStandalone(`<input type=checkbox id=target>`), locator: "input" },
        { dom: domInButton(`<input type=checkbox id=target>`), locator: "input" },
        { dom: domInLink(`<input type=checkbox id=target>`), locator: "input" },
        { dom: domInButton(`<input type=checkbox id=target>`), locator: "input" }
      ]
      for (const { dom, locator } of cases) {
        yield* page.setContent(dom)
        const target = page.locator(locator)
        assert.isFalse(yield* target.isChecked)
        yield* notHolding(target.isChecked, "checked")
        yield* notHolding(target.isChecked, "checked")

        yield* page.evaluateInMainWorld(() => {
          ;(document.querySelector("input") as HTMLInputElement).checked = true
        })
        assert.isTrue(yield* target.isChecked)
        yield* Expect.toBeChecked(target)
        yield* Expect.toBeChecked(target)

        yield* target.uncheck()
        assert.isFalse(yield* page.locator("input").isChecked)

        yield* target.check()
        assert.isTrue(yield* page.locator("input").isChecked)

        // setChecked(false) is uncheck (method-locator-setchecked)
        yield* target.uncheck()
        assert.isFalse(yield* page.locator("input").isChecked)
      }
    }))

  test("RE-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <label disabled>Text<a href='#' onclick='window.__clicked=1'>Target</a></label>
  `)
      yield* page.locator("a").click()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__clicked")), 1)

      yield* page.setContent(`
    <input type="radio" id="input-id" checked disabled />
    <label for="input-id">Text<a href='#' onclick='window.__clicked=2'>Target</a></label>
  `)
      yield* page.locator("a").click()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__clicked")), 2)
    }))
})
