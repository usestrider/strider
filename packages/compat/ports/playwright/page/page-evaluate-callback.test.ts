/**
 * Playwright's `tests/page/page-evaluate-callback.spec.ts`: a function passed as an argument to an evaluation, which the
 * page calls back, with the `exposeFunctions` option Playwright's evaluations take.
 *
 * What the port changes:
 * - Strider has no `exposeFunctions` option, and an evaluation's arguments cross by value only. EV-112 is the one test
 *   whose point is that a function argument without the option doesn't work, so it is ported and asserts Strider's
 *   typed reason and path, where the original asserts Playwright's message. Strider doesn't refuse a function inside an
 *   object argument: it leaves the member out, as `JSHandle.Serialized` does, so the page's `cb` is undefined and the
 *   call fails inside the page. The port keeps the original's assertion, which fails on that.
 * - Every other test passes a function the page calls back, through `exposeFunctions: true`, and the page then calls
 *   it and gets its result. Strider has no such callback and no `exposeFunction` or `exposeBinding` either, so those
 *   tests are `needsFeature` in the ledger, each naming its matrix row, and are not ported.
 */
import { assert } from "@effect/vitest"
import { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("EV-112", ({ page }) =>
    Effect.gen(function*() {
      // Playwright rejects a function argument without `exposeFunctions`, at the position "cb". Strider's refusal, if it
      // had one, would be NotSerializable at `args[0].cb`, the argument's path.
      const error = yield* failureOf(
        page.evaluate(({ cb }: { cb: () => void }) => cb(), { cb: () => {} }),
        "the evaluation"
      )
      assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
      assert(error.reason._tag === "NotSerializable", `expected NotSerializable, got ${error.reason._tag}`)
      assert.strictEqual(error.reason.path, "args[0].cb")
    }))
})
