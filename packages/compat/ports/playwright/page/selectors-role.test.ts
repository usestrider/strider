/**
 * Playwright's `tests/page/selectors-role.spec.ts`: `getByRole` and its options (`name`, `exact`, `checked`, `pressed`,
 * `selected`, `expanded`, `level`, `disabled`, `includeHidden`), the roles of native and ARIA elements, what's hidden,
 * inert, or outside a modal dialog, and the names roles get. SE-062 (the `role=` selector string's errors) and SE-069
 * and SE-070 (Playwright's environment switches for its own in-process server) are `notApplicable` (see the ledger).
 *
 * What the port changes:
 * - `role=button[pressed]` and `page.getByRole("button", { pressed: true })` are one call in Strider, so each pair of the
 *   original is one call here. `role=x[attr=value]` takes the same options as `getByRole`, so each attribute of the
 *   selector string is its option: `[selected]` and `[selected=true]` are `{ selected: true }`, and `[name="…"]` is
 *   `{ name, exact: true }` where the quoted name must match whole, while the unquoted `[name=Hello]` is a
 *   case-insensitive substring, which is `{ name }` alone.
 * - `name*="all"` is a case-sensitive substring in Playwright. Strider's `name` string is a case-insensitive substring, so
 *   the port passes the regular expression `/all/`, which is case-sensitive.
 * - The `role=…` count and `evaluateAll(els => els.map(e => e.outerHTML))` reads are `htmlOf`: each match's `readHtml` in
 *   document order, which is the element's outer HTML.
 * - `expect(locator)` is `Expect` with `Deadline.within("5 seconds")`, Playwright's default. `expect.soft` runs each check to
 *   the end, and the test fails with every mismatch (`softly`), as role-utils does.
 * - `expect(checkbox).not.toBeEditable()` is `Expect.that` over `isEditable` with a negated condition: the matcher's
 *   inverse, polled to the same deadline. `not.toBeDisabled()` is `Expect.toBeEnabled`.
 * - `locator.evaluate(el => …)` and `page.$eval(…)` that change the page run in the main world with
 *   `page.evaluateInMainWorld`, which every backend has. `ariaLabelledByElements` is set the same way.
 * - `toMatchAriaSnapshot` of the body is `Expect.toMatchAria` with the four nodes' roles and names. An aria snapshot's
 *   states (`[checked]`, `[pressed]`, `[expanded]`) aren't part of an `AriaPattern`, so each is checked as the
 *   `getByRole` filter with that node's name, which is the same condition. `- button "Save"`, with no state, has none
 *   to check.
 * - The `mixed` value of `checked` and `pressed` (`role=checkbox[checked="mixed"]`, `role=button[pressed="mixed"]`)
 *   can't be selected, which is a missing feature: `getByRole`'s `checked` and `pressed` take a boolean, a mixed element
 *   matches neither `true` nor `false`, and `AriaPattern` has no state either. Those assertions (SE-052's `[checked="mixed"]`
 *   and `[checked=mixed]` selections, SE-053's `[pressed="mixed"]`) are left out. What is left is tested: the
 *   mixed elements still appear in the unfiltered `getByRole` lists and in neither boolean list, and SE-052's closing
 *   steps set `aria-checked` and `aria-pressed` to `Mixed` and check the same of them. The `checked` gap is the matrix
 *   row `option-page-getbyrole-checked-value-mixed`. `option-page-getbyrole-pressed` has no mixed row, though its
 *   option has the same gap, and it says Strider has the option in full.
 * - Several tests run their checks as `expect.soft` does (`softly`), so one failing step doesn't hide the steps after it.
 *   Each still fails the test with every mismatch.
 * - SE-060's `Hello` and `Hallo` and the regular expressions are `name` as given. `name=" \n Hello "` is passed as the
 *   original writes it, with its whitespace.
 * - The `isMissingAriaLabelledByElements` check is for Chromium before 135. The pinned Chromium is 155, so the test runs
 *   without the check.
 * - Playwright's `getByRole("option", { name: "HTML" })` is `Expect.toHaveCount` with the same name.
 * - SE-069 and SE-070 set `process.env` for Playwright's in-process server, and skip on every `mode` but `default`.
 *   Strider has no such switch, so they are `notApplicable`.
 */
import { assert } from "@effect/vitest"
import { AriaPattern, Condition, Deadline, Expect, type Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default for `expect`, which waits 5 seconds; a Strider expectation otherwise runs to the test's deadline. */
const expectDeadline = Deadline.within("5 seconds")

/** Each match's outer HTML in document order: Playwright's `evaluateAll(els => els.map(e => e.outerHTML))`. */
const htmlOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  return yield* Effect.forEach(matches, (each) => each.readHtml)
})

/**
 * Playwright's `expect.soft`: each check runs to the end, and a mismatch fails the test once they have all run, with
 * every mismatch listed.
 */
const softly = () => {
  const mismatches: Array<string> = []
  return {
    expectation: Effect.fnUntraced(function*(what: string, check: Effect.Effect<void, unknown>) {
      const result = yield* Effect.result(check)
      if (Result.isFailure(result)) mismatches.push(`${what}: ${String(result.failure)}`)
    }),
    /** A mismatch of two values, recorded the same way. */
    same: (actual: unknown, expected: unknown) => {
      try {
        assert.deepStrictEqual(actual, expected)
      } catch (error) {
        mismatches.push(`check ${mismatches.length + 1}: ${String(error)}`)
      }
    },
    done: () => {
      if (mismatches.length > 0) {
        assert.fail(`${mismatches.length} mismatches:\n${mismatches.join("\n")}`)
      }
    }
  }
}

/** Playwright's `not.toBeEditable()`: the inverse of `isEditable`, polled to the deadline like the matcher. */
const notEditable = (locator: Locator.ReadonlyLocator) =>
  Expect.that(locator.isEditable, Condition.make("false", (editable: boolean) => !editable))

upstream(import.meta.filename, {}, (test) => {
  test("SE-050", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>Hello</button>
    <select multiple="" size="2"></select>
    <select></select>
    <h3>Heading</h3>
    <details><summary>Hello</summary></details>
    <div role="dialog">I am a dialog</div>
  `)
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button")), [`<button>Hello</button>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("listbox")), [`<select multiple="" size="2"></select>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("combobox")), [`<select></select>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("heading")), [`<h3>Heading</h3>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("group")), [`<details><summary>Hello</summary></details>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("dialog")), [`<div role="dialog">I am a dialog</div>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("menuitem")), [])
    }))

  test("SE-051", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <select>
      <option>Hi</option>
      <option selected>Hello</option>
    </select>
    <div>
      <div role="option" aria-selected="true">Hi</div>
      <div role="option" aria-selected="false">Hello</div>
    </div>
  `)
      soft.same(yield* htmlOf(page.getByRole("option", { selected: true })), [
        `<option selected="">Hello</option>`,
        `<div role="option" aria-selected="true">Hi</div>`
      ])
      soft.same(yield* htmlOf(page.getByRole("option", { selected: false })), [
        `<option>Hi</option>`,
        `<div role="option" aria-selected="false">Hello</div>`
      ])
      soft.done()
    }))

  test("SE-052", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input type=checkbox>
    <input type=checkbox checked>
    <input type=checkbox indeterminate>
    <div role=checkbox aria-checked="true">Hi</div>
    <div role=checkbox aria-checked="false">Hello</div>
    <div role=checkbox>Unknown</div>
  `)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("[indeterminate]") as HTMLInputElement).indeterminate = true
      })

      assert.deepStrictEqual(yield* htmlOf(page.getByRole("checkbox", { checked: true })), [
        `<input type="checkbox" checked="">`,
        `<div role="checkbox" aria-checked="true">Hi</div>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("checkbox", { checked: false })), [
        `<input type="checkbox">`,
        `<div role="checkbox" aria-checked="false">Hello</div>`,
        `<div role="checkbox">Unknown</div>`
      ])
      // `role=checkbox[checked="mixed"]` is left out: a `checked` filter takes a boolean (see the header).
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("checkbox")), [
        `<input type="checkbox">`,
        `<input type="checkbox" checked="">`,
        `<input type="checkbox" indeterminate="">`,
        `<div role="checkbox" aria-checked="true">Hi</div>`,
        `<div role="checkbox" aria-checked="false">Hello</div>`,
        `<div role="checkbox">Unknown</div>`
      ])

      yield* page.setContent(`
    <div role="checkbox" aria-checked="True" aria-readonly="True"
      onclick="this.setAttribute('aria-checked', String(this.getAttribute('aria-checked').toLowerCase() !== 'true'))">Remember me</div>
    <button aria-pressed="True">Bold</button>
    <button aria-expanded="True">Menu</button>
    <div role="Button" tabindex="0">Save</div>
  `)
      const soft = softly()
      const checkbox = page.getByRole("checkbox")
      soft.same(yield* page.getByRole("checkbox", { checked: true }).count, 1)
      soft.same(yield* page.getByRole("button", { pressed: true }).count, 1)
      soft.same(yield* page.getByRole("button", { expanded: true }).count, 1)
      soft.same(yield* page.getByRole("button", { name: "Save" }).count, 1)
      yield* soft.expectation("SE-052", Expect.toBeChecked(checkbox).pipe(expectDeadline))
      yield* soft.expectation("SE-052", notEditable(checkbox).pipe(expectDeadline))

      // The aria snapshot of the body: the roles and names of its four nodes. Their states are the filters below.
      const body = page.locator("body")
      yield* soft.expectation(
        "SE-052",
        body.pipe(Expect.toMatchAria(
          AriaPattern.node(
            "generic",
            "",
            AriaPattern.including(
              AriaPattern.node("checkbox", "Remember me", AriaPattern.unchecked),
              AriaPattern.node("button", "Bold", AriaPattern.unchecked),
              AriaPattern.node("button", "Menu", AriaPattern.unchecked),
              AriaPattern.node("button", "Save", AriaPattern.unchecked)
            )
          )
        )).pipe(expectDeadline)
      )
      soft.same(yield* page.getByRole("checkbox", { name: "Remember me", checked: true }).count, 1)
      soft.same(yield* page.getByRole("button", { name: "Bold", pressed: true }).count, 1)
      soft.same(yield* page.getByRole("button", { name: "Menu", expanded: true }).count, 1)

      yield* checkbox.check()
      yield* soft.expectation("SE-052", Expect.toHaveAttribute(checkbox, "aria-checked", "True").pipe(expectDeadline))

      // The original ends by setting `aria-checked` and `aria-pressed` to `Mixed` and selecting them with
      // `role=checkbox[checked=mixed]` and `role=button[pressed=mixed]`. A boolean filter can't select them (see the
      // header), so this checks what Strider documents of a mixed element: it keeps its role and matches neither boolean.
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("[role=checkbox]")!.setAttribute("aria-checked", "Mixed")
        document.querySelector("button[aria-pressed]")!.setAttribute("aria-pressed", "Mixed")
      })
      soft.same(yield* page.getByRole("checkbox").count, 1)
      soft.same(yield* page.getByRole("checkbox", { checked: true }).count, 0)
      soft.same(yield* page.getByRole("checkbox", { checked: false }).count, 0)
      soft.same(yield* page.getByRole("button", { name: "Bold" }).count, 1)
      soft.same(yield* page.getByRole("button", { name: "Bold", pressed: true }).count, 0)
      soft.same(yield* page.getByRole("button", { name: "Bold", pressed: false }).count, 0)
      soft.done()
    }))

  test("SE-053", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>Hi</button>
    <button aria-pressed="true">Hello</button>
    <button aria-pressed="false">Bye</button>
    <button aria-pressed="mixed">Mixed</button>
  `)
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { pressed: true })), [
        `<button aria-pressed="true">Hello</button>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { pressed: false })), [
        `<button>Hi</button>`,
        `<button aria-pressed="false">Bye</button>`
      ])
      // `role=button[pressed="mixed"]` is left out: a `pressed` filter takes a boolean (see the header).
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button")), [
        `<button>Hi</button>`,
        `<button aria-pressed="true">Hello</button>`,
        `<button aria-pressed="false">Bye</button>`,
        `<button aria-pressed="mixed">Mixed</button>`
      ])
    }))

  test("SE-054", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div role="treeitem">Hi</div>
    <div role="treeitem" aria-expanded="true">Hello</div>
    <div role="treeitem" aria-expanded="false">Bye</div>
  `)
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("treeitem")), [
        `<div role="treeitem">Hi</div>`,
        `<div role="treeitem" aria-expanded="true">Hello</div>`,
        `<div role="treeitem" aria-expanded="false">Bye</div>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("treeitem", { expanded: true })), [
        `<div role="treeitem" aria-expanded="true">Hello</div>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("treeitem", { expanded: false })), [
        `<div role="treeitem" aria-expanded="false">Bye</div>`
      ])

      // Workaround for expanded="none": an attribute selector, which is CSS
      assert.deepStrictEqual(yield* htmlOf(page.locator(`[role=treeitem]:not([aria-expanded])`)), [
        `<div role="treeitem">Hi</div>`
      ])
    }))

  test("SE-055", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <button>Hi</button>
    <button disabled>Bye</button>
    <button aria-disabled="true">Hello</button>
    <button aria-disabled="false">Oh</button>
    <fieldset disabled>
      <button>Yay</button>
    </fieldset>
    <select>
      <optgroup disabled>
        <option>one</option>
      </optgroup>
      <optgroup>
        <option>two</option>
      </optgroup>
      <option disabled>three</option>
    </select>
  `)
      soft.same(yield* htmlOf(page.getByRole("button", { disabled: true })), [
        `<button disabled="">Bye</button>`,
        `<button aria-disabled="true">Hello</button>`,
        `<button>Yay</button>`
      ])
      soft.same(yield* htmlOf(page.getByRole("button", { disabled: false })), [
        `<button>Hi</button>`,
        `<button aria-disabled="false">Oh</button>`
      ])
      soft.same(yield* htmlOf(page.getByRole("option", { disabled: true })), [
        `<option>one</option>`,
        `<option disabled="">three</option>`
      ])
      soft.same(yield* htmlOf(page.getByRole("option", { disabled: false })), [
        `<option>two</option>`
      ])
      soft.same(yield* htmlOf(page.getByRole("option")), [
        `<option>one</option>`,
        `<option>two</option>`,
        `<option disabled="">three</option>`
      ])
      soft.done()
    }))

  test("SE-056", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <span aria-disabled="true">
      <button>Click me!</button>
    </span>
  `)
      yield* Expect.toBeDisabled(page.locator("button")).pipe(expectDeadline)

      yield* page.setContent(`
    <span aria-disabled="true">
      <h1>Heading</h1>
    </span>
  `)
      yield* Expect.toBeEnabled(page.locator("h1")).pipe(expectDeadline)
    }))

  test("SE-057", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <fieldset disabled>
      <input></input>
      <button data-testid="inside-fieldset-element">x</button>
      <legend>
        <button data-testid="inside-legend-element">legend</button>
      </legend>
    </fieldset>

    <fieldset disabled>
      <legend>
        <div>
          <button data-testid="nested-inside-legend-element">x</button>
        </div>
      </legend>
    </fieldset>

    <fieldset disabled>
      <div></div>
      <legend>
        <button data-testid="first-legend-element">x</button>
      </legend>
      <legend>
        <button data-testid="second-legend-element">x</button>
      </legend>
    </fieldset>

    <fieldset disabled>
      <fieldset>
        <button data-testid="deep-button">x</button>
      </fieldset>
    </fieldset>
  `)
      const soft = softly()
      yield* soft.expectation(
        "inside-legend-element",
        Expect.toBeEnabled(page.getByTestId("inside-legend-element")).pipe(expectDeadline)
      )
      yield* soft.expectation(
        "nested-inside-legend-element",
        Expect.toBeEnabled(page.getByTestId("nested-inside-legend-element")).pipe(expectDeadline)
      )
      yield* soft.expectation(
        "first-legend-element",
        Expect.toBeEnabled(page.getByTestId("first-legend-element")).pipe(expectDeadline)
      )
      yield* soft.expectation(
        "second-legend-element",
        Expect.toBeDisabled(page.getByTestId("second-legend-element")).pipe(expectDeadline)
      )
      yield* soft.expectation(
        "deep-button",
        Expect.toBeDisabled(page.getByTestId("deep-button")).pipe(expectDeadline)
      )
      soft.done()
    }))

  test("SE-058", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Hello</h1>
    <h3>Hi</h3>
    <div role="heading" aria-level="5">Bye</div>
  `)
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("heading", { level: 1 })), [`<h1>Hello</h1>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("heading", { level: 3 })), [`<h3>Hi</h3>`])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("heading", { level: 5 })), [
        `<div role="heading" aria-level="5">Bye</div>`
      ])
    }))

  test("SE-059", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <button>Hi</button>
    <button hidden>Hello</button>
    <button aria-hidden="true">Yay</button>
    <button aria-hidden="false">Nay</button>
    <button style="visibility:hidden">Bye</button>
    <div style="visibility:hidden">
      <button>Oh</button>
    </div>
    <div style="visibility:hidden">
      <button style="visibility:visible">Still here</button>
    </div>
    <button style="display:none">Never</button>
    <div id=host1></div>
    <div id=host2 style="display:none"></div>

    <input name="one">
    <details>
      <summary>Open form</summary>
      <label>
         Label
         <input name="two">
      </label>
    </details>

    <select>
      <option style="visibility:hidden">One</option>
      <option style="display:none">Two</option>
      <option>Three</option>
    </select>

    <script>
      function addButton(host, text) {
        const root = host.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        button.textContent = text;
        root.appendChild(button);
      }
      addButton(document.getElementById('host1'), 'Shadow1');
      addButton(document.getElementById('host2'), 'Shadow2');
    </script>
  `)
      soft.same(yield* htmlOf(page.getByRole("button")), [
        `<button>Hi</button>`,
        `<button aria-hidden="false">Nay</button>`,
        `<button style="visibility:visible">Still here</button>`,
        `<button>Shadow1</button>`
      ])
      soft.same(yield* htmlOf(page.getByRole("button", { includeHidden: true })), [
        `<button>Hi</button>`,
        `<button hidden="">Hello</button>`,
        `<button aria-hidden="true">Yay</button>`,
        `<button aria-hidden="false">Nay</button>`,
        `<button style="visibility:hidden">Bye</button>`,
        `<button>Oh</button>`,
        `<button style="visibility:visible">Still here</button>`,
        `<button style="display:none">Never</button>`,
        `<button>Shadow1</button>`,
        `<button>Shadow2</button>`
      ])
      soft.same(yield* htmlOf(page.getByRole("button", { includeHidden: false })), [
        `<button>Hi</button>`,
        `<button aria-hidden="false">Nay</button>`,
        `<button style="visibility:visible">Still here</button>`,
        `<button>Shadow1</button>`
      ])
      soft.same(yield* htmlOf(page.getByRole("textbox")), [`<input name="one">`])
      soft.same(yield* htmlOf(page.getByRole("option")), [
        `<option style="visibility:hidden">One</option>`,
        `<option>Three</option>`
      ])
      soft.done()
    }))

  test("SE-060", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div role="button" aria-label=" Hello "></div>
    <div role="button" aria-label="Hallo"></div>
    <div role="button" aria-label="Hello" aria-hidden="true"></div>
    <div role="button" aria-label="123" aria-hidden="true"></div>
    <div role="button" aria-label='foo"bar' aria-hidden="true"></div>

    <span id="title">Chosen name</span>
    <div role="group" aria-labelledby="title"></div>
  `)

      const group = page.getByRole("group")
      yield* Expect.toHaveAccessibleName(group, "Chosen name").pipe(expectDeadline)

      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: "Hello", exact: true })), [
        `<div role="button" aria-label=" Hello "></div>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: " \n Hello ", exact: true })), [
        `<div role="button" aria-label=" Hello "></div>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: "Hello" })), [
        `<div role="button" aria-label=" Hello "></div>`
      ])

      // `role=button[name*="all"]`: a case-sensitive substring, which a regular expression is (see the header)
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: /all/ })), [
        `<div role="button" aria-label="Hallo"></div>`
      ])

      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: /^H[ae]llo$/ })), [
        `<div role="button" aria-label=" Hello "></div>`,
        `<div role="button" aria-label="Hallo"></div>`
      ])

      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: /h.*o/i })), [
        `<div role="button" aria-label=" Hello "></div>`,
        `<div role="button" aria-label="Hallo"></div>`
      ])

      assert.deepStrictEqual(
        yield* htmlOf(page.getByRole("button", { name: "Hello", exact: true, includeHidden: true })),
        [
          `<div role="button" aria-label=" Hello "></div>`,
          `<div role="button" aria-label="Hello" aria-hidden="true"></div>`
        ]
      )
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: "hello", includeHidden: true })), [
        `<div role="button" aria-label=" Hello "></div>`,
        `<div role="button" aria-label="Hello" aria-hidden="true"></div>`
      ])

      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: "Hello" })), [
        `<div role="button" aria-label=" Hello "></div>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { name: "123", includeHidden: true })), [
        `<div role="button" aria-label="123" aria-hidden="true"></div>`
      ])

      // The pinned Chromium (155) has `ariaLabelledByElements`, so the original's version check doesn't skip this.
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("div[role=group]") as HTMLElement & { ariaLabelledByElements: Array<Element> })
          .ariaLabelledByElements = [document.querySelector("#title")!]
      })
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("group", { name: "Chosen name", exact: true })), [
        `<div role="group" aria-labelledby=""></div>`
      ])
    }))

  test("SE-061", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select>
      <option value="html">&nbsp;HTML</option>
    </select>
  `)
      yield* Expect.toHaveCount(page.getByRole("option", { name: "HTML" }), 1).pipe(expectDeadline)
    }))

  // SE-062 (the `role=` selector string's parse errors: an empty role, unknown attributes, a `level` or `checked` value
  // of the wrong type, an attribute with no value) is notApplicable: see the ledger.

  test("SE-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div make-hidden>
      <button>hidden1</button>
    </div>
    <div make-hidden>
      <span><button>hidden2</button></v>
    </div>
    <div>
      <button>visible1</button>
    </div>
    <div>
      <span><button>visible2</button></span>
    </div>
    <script>
      for (const div of document.querySelectorAll('div')) {
        const hidden = div.hasAttribute('make-hidden');
        div.attachShadow({ mode: 'open' }).innerHTML = hidden ? 'nothing to see here' : '<slot></slot>';
      }
    </script>
  `)
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button")), [
        `<button>visible1</button>`,
        `<button>visible2</button>`
      ])
      assert.deepStrictEqual(yield* htmlOf(page.getByRole("button", { includeHidden: true })), [
        `<button>hidden1</button>`,
        `<button>hidden2</button>`,
        `<button>visible1</button>`,
        `<button>visible2</button>`
      ])
    }))

  test("SE-064", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label>Output1<output>output</output></label>`)
      yield* Expect.toBeVisible(page.getByRole("status", { name: "Output1" })).pipe(expectDeadline)
    }))

  test("SE-065", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li aria-label="Parent list">
        Parent list
        <ul>
          <li>child 1</li>
          <li>child 2</li>
        </ul>
      </li>
    </ul>
  `)
      const children = page.getByRole("listitem", { name: "Parent list" }).getByRole("listitem")
      yield* Expect.toHaveCount(children, 2).pipe(expectDeadline)
      yield* Expect.toHaveText(children, ["child 1", "child 2"]).pipe(expectDeadline)
    }))

  test("SE-066", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <button>Hi</button>
    <button inert>Hello</button>
    <div inert id=container>
      <button>Yay</button>
      <div><button>Nay</button></div>
    </div>
    <button><span inert>Save</span></button>
    <div id=host></div>
    <div inert id=inert-host></div>
    <script>
      function addButton(host, text) {
        const root = host.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        button.textContent = text;
        root.appendChild(button);
      }
      addButton(document.getElementById('host'), 'Shadow1');
      addButton(document.getElementById('inert-host'), 'Shadow2');
    </script>
  `)
      soft.same(yield* htmlOf(page.getByRole("button")), [
        `<button>Hi</button>`,
        `<button><span inert="">Save</span></button>`,
        `<button>Shadow1</button>`
      ])
      soft.same(yield* htmlOf(page.getByRole("button", { includeHidden: true })), [
        `<button>Hi</button>`,
        `<button inert="">Hello</button>`,
        `<button>Yay</button>`,
        `<button>Nay</button>`,
        `<button><span inert="">Save</span></button>`,
        `<button>Shadow1</button>`,
        `<button>Shadow2</button>`
      ])
      yield* soft.expectation(
        "SE-066",
        Expect.toHaveCount(page.getByRole("button", { name: "Yay" }), 0).pipe(expectDeadline)
      )
      yield* soft.expectation(
        "SE-066",
        Expect.toHaveCount(page.getByRole("button", { name: "Yay", includeHidden: true }), 1).pipe(expectDeadline)
      )

      // Inert content does not contribute to the accessible name.
      yield* soft.expectation(
        "SE-066",
        Expect.toHaveCount(page.getByRole("button", { name: "Save" }), 0).pipe(expectDeadline)
      )
      yield* soft.expectation(
        "SE-066",
        Expect.toHaveCount(page.getByRole("button", { name: "Save", includeHidden: true }), 1).pipe(expectDeadline)
      )

      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#container")!.removeAttribute("inert")
      })
      soft.same(yield* htmlOf(page.getByRole("button")), [
        `<button>Hi</button>`,
        `<button>Yay</button>`,
        `<button>Nay</button>`,
        `<button><span inert="">Save</span></button>`,
        `<button>Shadow1</button>`
      ])
      soft.done()
    }))

  test("SE-067", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <button>Outside</button>
    <dialog id=dialog>
      <button>Inside</button>
      <div inert><button>Inert inside</button></div>
    </dialog>
    <dialog id=non-modal><button>Non-modal</button></dialog>
    <script>
      document.getElementById('dialog').showModal();
      document.getElementById('non-modal').show();
    </script>
  `)
      soft.same(yield* htmlOf(page.getByRole("button")), [`<button>Inside</button>`])
      soft.same(yield* htmlOf(page.getByRole("button", { includeHidden: true })), [
        `<button>Outside</button>`,
        `<button>Inside</button>`,
        `<button>Inert inside</button>`,
        `<button>Non-modal</button>`
      ])
      yield* soft.expectation("SE-067", Expect.toHaveCount(page.getByRole("dialog"), 1).pipe(expectDeadline))
      yield* soft.expectation(
        "SE-067",
        Expect.toHaveCount(page.getByRole("button", { name: "Outside" }), 0).pipe(expectDeadline)
      )

      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("#dialog") as HTMLDialogElement).close()
      })
      soft.same(yield* htmlOf(page.getByRole("button")), [
        `<button>Outside</button>`,
        `<button>Non-modal</button>`
      ])
      soft.done()
    }))

  test("SE-068", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <button>Outside</button>
    <dialog id=outer>
      <button>Outer</button>
      <dialog id=inner><button>Inner</button></dialog>
    </dialog>
    <div inert>
      <dialog id=escaping><button>Escaping</button></dialog>
    </div>
    <script>
      document.getElementById('outer').showModal();
      document.getElementById('inner').showModal();
    </script>
  `)
      soft.same(yield* htmlOf(page.getByRole("button")), [`<button>Inner</button>`])

      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("#inner") as HTMLDialogElement).close()
      })
      soft.same(yield* htmlOf(page.getByRole("button")), [`<button>Outer</button>`])

      // Modal dialog inside an inert subtree is not inert.
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("#outer") as HTMLDialogElement).close()
        ;(document.querySelector("#escaping") as HTMLDialogElement).showModal()
      })
      soft.same(yield* htmlOf(page.getByRole("button")), [`<button>Escaping</button>`])
      soft.done()
    }))

  // SE-069 (PLAYWRIGHT_SKIP_INERT_CHECK) and SE-070 (PLAYWRIGHT_SKIP_DIALOG_CHECK) set environment variables that
  // Playwright's in-process server reads, and skip on every mode but `default`: they are notApplicable (see the ledger).
})
