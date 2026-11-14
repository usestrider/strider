/**
 * Playwright's `tests/page/page-strict.spec.ts`: a selector that matches several elements fails in strict mode, in the
 * page's reads, actions and dispatches.
 *
 * What the port changes:
 * - Strider's locators are strict everywhere: a read or an action on several matches fails at once with
 *   `StrictViolation`, so Playwright's `strict: true` option has no counterpart and the default is what's tested. Each
 *   method maps to the locator call that reads the same element: `page.textContent` is `readText`, `getAttribute` is
 *   `readAttribute`, `fill` is `fill`, and `dispatchEvent` is `dispatchEvent`. SM-004 (`page.$`, which returns a handle)
 *   has no Strider form, since a locator returns values, not handles; see the ledger.
 * - Playwright's message lists each match as "aka <locator>" and counts them. Strider's `StrictViolation` carries each
 *   match as a `candidates` entry and says "N matches" in its message, so the port asserts two candidates and that
 *   count in the message. The text of Playwright's suggested locators (`aka getByText('span1')`) is its rendering and isn't carried over.
 * - SM-005 (`waitForSelector`) isn't ported. Strider has no `waitForSelector`, and its expectations retry several
 *   matches until the deadline rather than failing at once; see the ledger's `differentByDesign` entry.
 * - SM-007, SM-008 and SM-010 check which elements the failure reports, as Playwright's messages do with a selector for
 *   each. Strider describes a match as a candidate (its tag, classes, or text), so the port asserts those, in place of
 *   Playwright's `body > div:nth-child(2)` path and its escaped class name text. SM-010's `text=..loading` engine is
 *   `getByText("..loading")`, since Strider's selectors have no engine prefixes.
 * - SM-009 is a `toBeVisible` expectation that fails at once on several matches in Playwright; Strider's retries; see
 *   the ledger.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * The failure of a call on `matches` elements: Strider's `StrictViolation`, with a candidate for each match. Its message
 * counts them, as Playwright's "strict mode violation" message lists them.
 */
const strictViolationOf = (error: unknown, matches: number) => {
  assert(
    Locator.isLocatorError(error) && error.reason._tag === "StrictViolation",
    `failed for another reason: ${String(error)}`
  )
  assert.strictEqual(error.reason.candidates.length, matches)
  assert.include(error.message, `${matches} matches`)
  return error.reason.candidates.map((candidate) => candidate.description)
}

upstream(import.meta.filename, {}, (test) => {
  test("SM-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<span>span1</span><div><span>target</span></div>`)
      strictViolationOf(yield* failureOf(page.locator("span").readText, "textContent"), 2)
    }))

  test("SM-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<span>span1</span><div><span>target</span></div>`)
      strictViolationOf(yield* failureOf(page.locator("span").readAttribute("id"), "getAttribute"), 2)
    }))

  test("SM-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input></input><div><input></input></div>`)
      strictViolationOf(yield* failureOf(page.locator("input").fill("text"), "fill"), 2)
    }))

  test("SM-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<span></span><div><span></span></div>`)
      strictViolationOf(yield* failureOf(page.locator("span").dispatchEvent("click"), "dispatchEvent"), 2)
    }))

  test("SM-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
  <div>
    <div>
    </div>
    <div>
      <div>
      </div>
      <div>
      </div>
    </div>
  </div>
  <div>
    <div class='foo'>
    </div>
    <div class='foo'>
    </div>
  </div>
  `)
      const descriptions = strictViolationOf(yield* failureOf(page.locator(".foo").hover(), "hover"), 2)
      assert.deepStrictEqual(descriptions, ["div.foo", "div.foo"])
    }))

  test("SM-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
  <div>
    <div></div>
    <div>
      <div></div>
      <div></div>
    </div>
  </div>
  <div>
    <div class='foo bar:0'>
    </div>
    <div class='foo bar:1'>
    </div>
  </div>
  `)
      const descriptions = strictViolationOf(yield* failureOf(page.locator(".foo").hover(), "hover"), 2)
      assert.deepStrictEqual(descriptions, ["div.foo.bar:0", "div.foo.bar:1"])
    }))

  test("SM-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>..loading</div><div>..loading</div>`)
      const descriptions = strictViolationOf(yield* failureOf(page.getByText("..loading").hover(), "hover"), 2)
      assert.deepStrictEqual(descriptions, [`div "..loading"`, `div "..loading"`])
    }))
})
