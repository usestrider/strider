/**
 * Playwright's `tests/page/expect-to-have-value.spec.ts`: `toHaveValue` over a text field, a label, and a regular
 * expression, its failure's observed value, and `toHaveValues` over a multiple select.
 *
 * What the port changes:
 * - `page.setContent`, `locator.fill`, and `locator.selectOption` are the same calls. Playwright's `selectOption(["R", "G"])`
 *   selects by value, which is `[{ value: "R" }, { value: "G" }]` in Strider.
 * - Playwright's `text=Pick a Color` is `page.getByText("Pick a Color")`: a label's text, matched as a substring.
 * - Playwright's `expect(...).toHaveValue(...)` failure message quotes "Received"; the port asserts the matcher's own
 *   condition and the observed value (`observedValues`). `stripAnsi` isn't needed: nothing is colored.
 * - Strider's `toHaveValues` observes the selected values as a list, and an element that can't be checked observes the
 *   reason, so EX-308's diff lines (`-   "R"`, `+   "RR"`) are the expected and observed lists, and EX-310's
 *   `+   "B"` is the observed list.
 * - A promise the original raises as a `.catch(e => e)` is `expectationFailure`: the test fails if the expectation passes.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { expectationFailure, observedValues } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The multiple select of EX-306 to EX-310: Red, Green, and Blue. */
const colors = `
      <select multiple>
        <option value="R">Red</option>
        <option value="G">Green</option>
        <option value="B">Blue</option>
      </select>
    `

upstream(import.meta.filename, {}, (test) => {
  test("EX-302", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input id=node></input>")
      const locator = page.locator("#node")
      yield* locator.fill("Text content")
      yield* Expect.toHaveValue(locator, "Text content")
    }))

  test("EX-303", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<label><input></input></label>")
      yield* page.locator("label input").fill("Text content")
      yield* Expect.toHaveValue(page.locator("label"), "Text content")
    }))

  test("EX-304", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input id=node></input>")
      const locator = page.locator("#node")
      yield* locator.fill("Text content")
      yield* Expect.toHaveValue(locator, /Text/)
    }))

  test("EX-305", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input id=node></input>")
      const locator = page.locator("#node")
      yield* locator.fill("Text content")
      const failure = yield* expectationFailure(
        locator.pipe(Expect.toHaveValue(/Text2/), Deadline.within("1 second"))
      )
      assert.include(failure.condition, "/Text2/")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-306", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(colors)
      const locator = page.locator("select")
      yield* locator.selectOption([{ value: "R" }, { value: "G" }])
      yield* Expect.toHaveValues(locator, ["R", "G"])
    }))

  test("EX-307", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <label for="colors">Pick a Color</label>
      <select id="colors" multiple>
        <option value="R">Red</option>
        <option value="G">Green</option>
        <option value="B">Blue</option>
      </select>
    `)
      const locator = page.getByText("Pick a Color")
      yield* locator.selectOption([{ value: "R" }, { value: "G" }])
      yield* Expect.toHaveValues(locator, ["R", "G"])
    }))

  test("EX-308", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <select multiple>
        <option value="RR">Red</option>
        <option value="GG">Green</option>
      </select>
    `)
      const locator = page.locator("select")
      yield* locator.selectOption([{ value: "RR" }, { value: "GG" }])
      const failure = yield* expectationFailure(
        locator.pipe(Expect.toHaveValues(["R", "G"]), Deadline.within("1 second"))
      )
      assert.include(failure.condition, "[\"R\", \"G\"]")
      assert.deepStrictEqual(observedValues(failure), [["RR", "GG"]])
    }))

  test("EX-309", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(colors)
      const locator = page.locator("select")
      yield* locator.selectOption([{ value: "R" }, { value: "G" }])
      yield* Expect.toHaveValues(locator, [/R/, /G/])
    }))

  test("EX-310", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(colors)
      const locator = page.locator("select")
      yield* locator.selectOption([{ value: "B" }])
      const failure = yield* expectationFailure(
        locator.pipe(Expect.toHaveValues([/R/, /G/]), Deadline.within("1 second"))
      )
      assert.deepStrictEqual(observedValues(failure), [["B"]])
    }))

  test("EX-311", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <select>
        <option value="R">Red</option>
        <option value="G">Green</option>
        <option value="B">Blue</option>
      </select>
    `)
      const locator = page.locator("select")
      yield* locator.selectOption([{ value: "B" }])
      const failure = yield* expectationFailure(
        locator.pipe(Expect.toHaveValues([/R/, /G/]), Deadline.within("1 second"))
      )
      // Strider observes the reason as its lowercase text, where Playwright's message capitalizes it
      assert.deepStrictEqual(observedValues(failure), ["not a select element with a multiple attribute"])
    }))

  test("EX-312", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <input value="foo" />
    `)
      const failure = yield* expectationFailure(
        page.locator("input").pipe(Expect.toHaveValues([/R/, /G/]), Deadline.within("1 second"))
      )
      assert.deepStrictEqual(observedValues(failure), ["not a select element with a multiple attribute"])
    }))
})
