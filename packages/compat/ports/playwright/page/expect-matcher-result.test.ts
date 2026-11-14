/**
 * Playwright's `tests/page/expect-matcher-result.spec.ts`: what a failed expectation reports, its matcher result and
 * its text. EX-176 to EX-178 are ported against Strider's `ExpectationFailed`. EX-179 and EX-180 are in the ledger.
 *
 * What the port changes:
 * - A failed expectation's `matcherResult` is Playwright's object, with `actual`, `expected`, `name`, `pass`, `log`,
 *   `timeout`, and an `ariaSnapshot`. Strider's `ExpectationFailed` has what it observed (`observedValues`), the
 *   condition it was checked against (`condition`), its subject, the time it took (`elapsed`), and its checks. The
 *   port asserts those, and the failure's `message` for the subject it names. `name`, `log`, and `ariaSnapshot` have no
 *   counterpart, and the report's own text (`toString()`, with its "Call log") is not compared.
 * - `{ timeout: 1 }` is `Deadline.within("1 second")` around the expectation, as expect-timeout does.
 * - `expect(locator).not.toHaveText(/Text/)` is `Expect.that` over the locator's `readText` with the negated condition,
 *   which Strider's API offers for a negation (`property-locatorassertions-not`). `not.toBeVisible` is `Expect.toBeHidden`,
 *   the inverse matcher, and `not.toHaveCount(1)` is `Expect.that` over `count` with the negated condition, as
 *   expect-misc's EX-187 does.
 * - `page.setContent` is Strider's setContent, which waits for readiness, as the original's default does.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { expectationFailure, observedValues } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** `not 1`: the count is anything but one, the negated condition of the original's `not.toHaveCount(1)`. */
const notOne = Condition.not(Condition.make("1", (count: number) => count === 1))

/** `not /Text/`: the text doesn't match the pattern, the negated condition of the original's `not.toHaveText`. */
const notText = Condition.not(Condition.make("/Text/", (text: string) => /Text/.test(text)))

upstream(import.meta.filename, {}, (test) => {
  test("EX-176", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const locator = page.locator("#node")

      {
        const failure = yield* expectationFailure(
          locator.pipe(Expect.toHaveText(/Text2/), Deadline.within("1 second"))
        )
        // The matcher result's `actual` and `expected`: what was read, and the pattern it was checked against
        assert.include(observedValues(failure), "Text content")
        assert.include(failure.condition, "Text2")
        assert.include(failure.message, "#node")
      }

      {
        // `expect(locator).not.toHaveText(/Text/)` fails because the text matches
        const failure = yield* expectationFailure(
          Expect.that(locator.readText, notText).pipe(Deadline.within("1 second"))
        )
        assert.include(observedValues(failure), "Text content")
        assert.include(failure.condition, "Text")
      }
    }))

  test("EX-177", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")

      {
        const failure = yield* expectationFailure(
          page.locator("#node2").pipe(Expect.toBeVisible, Deadline.within("1 second"))
        )
        assert.include(failure.condition, "visible")
        assert.include(failure.message, "#node2")
        // Playwright's report says "element(s) not found"; Strider's observation is that the locator matched nothing
        assert.deepInclude(observedValues(failure), { matches: 0, visible: 0 })
      }

      {
        // `expect(locator).not.toBeVisible()` on a visible element is Strider's inverse matcher, `toBeHidden`
        const failure = yield* expectationFailure(
          page.locator("#node").pipe(Expect.toBeHidden, Deadline.within("1 second"))
        )
        assert.include(failure.condition, "hidden")
        assert.include(failure.message, "#node")
      }
    }))

  test("EX-178", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")

      {
        const failure = yield* expectationFailure(
          page.locator("#node2").pipe(Expect.toHaveCount(1), Deadline.within("1 second"))
        )
        // The matcher result's `actual` is the count of matches, 0
        assert.include(observedValues(failure), 0)
        assert.include(failure.condition, "1")
        assert.include(failure.message, "#node2")
      }

      {
        const failure = yield* expectationFailure(
          Expect.that(page.locator("#node").count, notOne).pipe(Deadline.within("1 second"))
        )
        assert.include(observedValues(failure), 1)
        assert.include(failure.condition, "not 1")
      }
    }))
})
