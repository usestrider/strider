/**
 * Playwright's `tests/page/expect-to-have-accessible.spec.ts`: the accessible name, description, and error message
 * matchers, and `toHaveRole`. EX-259 and EX-273 are ported for what Strider's matchers express; EX-260 to EX-272 are
 * `needsFeature` (see the ledger): Strider has no accessible description or error message matcher or read.
 *
 * What the port changes:
 * - Strider's matchers have no `.not`, and there is no read of an accessible name or a role to put in a negated
 *   `Condition`. A `not.toHaveAccessibleName(x)` is a role locator with that name, `exact` for a string, expected to
 *   match nothing (`toHaveCount(0)`): a role locator's name is the same computed accessible name, so the element has the
 *   name exactly when the locator finds it. Each negation follows a positive check of the same element, so "nothing
 *   matched" can't be an element that isn't there. A negated `toHaveRole` is the same, with the role locator.
 * - Each expectation runs under `expectDeadline`: Playwright's default expectation timeout, so a failure ends the expectation
 *   after five seconds, as it does there, and not at the end of the test.
 * - `{ ignoreCase: true }` on `toHaveAccessibleName` is Strider's own option.
 * - EX-273's regular expression argument, which Playwright rejects at run time with `"role" argument in toHaveRole must
 *   be a string`, isn't a call Strider accepts: `toHaveRole` takes a string only, and its type refuses the expression,
 *   so there is no runtime refusal to assert.
 */
import { Deadline, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default expectation timeout, which every expectation here runs under, as in expect-timeout. */
const expectDeadline = Deadline.within("5 seconds")

upstream(import.meta.filename, {}, (test) => {
  test("EX-259", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div role="button" aria-label="Hello"></div>
  `)
      const div = page.locator("div")
      yield* div.pipe(Expect.toHaveAccessibleName("Hello"), expectDeadline)
      // not.toHaveAccessibleName("hello"): no button is named "hello", case-sensitively
      yield* page.getByRole("button", { name: "hello", exact: true }).pipe(Expect.toHaveCount(0), expectDeadline)
      yield* div.pipe(Expect.toHaveAccessibleName("hello", { ignoreCase: true }), expectDeadline)
      yield* div.pipe(Expect.toHaveAccessibleName(/ell\w/), expectDeadline)
      // not.toHaveAccessibleName(/hello/)
      yield* page.getByRole("button", { name: /hello/ }).pipe(Expect.toHaveCount(0), expectDeadline)
      yield* div.pipe(Expect.toHaveAccessibleName(/hello/, { ignoreCase: true }), expectDeadline)

      yield* page.setContent(`<button>foo&nbsp;bar\nbaz</button>`)
      yield* page.locator("button").pipe(Expect.toHaveAccessibleName("foo bar baz"), expectDeadline)

      yield* page.setContent(`
    <select>
      <option>&nbsp;HTML</option>
    </select>
  `)
      yield* page.locator("option").pipe(Expect.toHaveAccessibleName("HTML"), expectDeadline)
    }))

  test("EX-273", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role="button">Button!</div>`)
      yield* page.locator("div").pipe(Expect.toHaveRole("button"), expectDeadline)
      // not.toHaveRole("checkbox"): nothing on the page has the role
      yield* page.getByRole("checkbox").pipe(Expect.toHaveCount(0), expectDeadline)
    }))
})
