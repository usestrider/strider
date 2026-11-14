/**
 * Playwright's `tests/library/browsercontext-strict.spec.ts`: a strict context fails a call that matches several elements,
 * and a non-strict one reads the first.
 *
 * What the port changes:
 * - Playwright's `strictSelectors` context option is the legacy selector API's mode. Strider's locators are strict in
 *   every context, so the two strict-mode tests (SM-012, SM-013) read Strider's default: a locator that matches several
 *   elements fails `StrictViolation` for its read and for its click. The context option has no counterpart to set, so
 *   the port has nothing to set for it.
 * - `page.textContent(selector)` is `page.locator(selector).readText`, and `page.click(selector)` is the locator's
 *   `click`. A strict violation is a `LocatorError` whose reason is `StrictViolation`; the port checks that reason
 *   instead of Playwright's message.
 * - SM-011 and SM-014 read the first match of a selector with several matches by `strict: false`. Strider has no
 *   per-call strictness option; its way to take one of several matches is `locator.first`, which is what they read
 *   here. The test's observable point, that a read can return the first of several matches rather than fail, is
 *   kept; the opt-out flag itself has no counterpart (`option-browser-newcontext-strictselectors` is missing in the
 *   matrix), and SM-012 and SM-013 check that the same locator without `.first` fails.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("SM-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<span>span1</span><div><span>target</span></div>")
      assert.strictEqual(yield* page.locator("span").first.readText, "span1")
    }))

  test("SM-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<span>span1</span><div><span>target</span></div>")
      const error = yield* failureOf(page.locator("span").readText, "the read")
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason._tag === "StrictViolation", String(error.reason))
      assert.strictEqual(error.reason.candidates.length, 2)
    }))

  test("SM-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>button1</button><button>target</button>")
      const error = yield* failureOf(page.locator("button").click(), "the click")
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason._tag === "StrictViolation", String(error.reason))
      assert.strictEqual(error.reason.candidates.length, 2)
    }))

  test("SM-014", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<span>span1</span><div><span>target</span></div>")
      assert.strictEqual(yield* page.locator("span").first.readText, "span1")
    }))
})
