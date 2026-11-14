/**
 * Playwright's `tests/page/page-click-timeout-2.spec.ts`: a click that waits on an element hidden by `display: none`
 * or `visibility: hidden` until its timeout.
 *
 * What the port changes:
 * - `page.$eval("button", …)` is a `page.evaluateInMainWorld` over `document.querySelector("button")`: Playwright's
 *   `$eval` runs in the main world, and the DOM it changes is the same either way.
 * - `page.click("button", { timeout })` is `page.locator("button").click()` under `Deadline.within`. The timed-out
 *   click's error is a `Deadline.Timeout`: its budget, its phase, and the reason it last observed are asserted on the
 *   typed error.
 * - Playwright's error message says "waiting for element to be visible, enabled and stable", which is its call log's
 *   header. Strider's `Timeout` doesn't list its checks; the port asserts that the message says it was waiting for a
 *   condition, which its phase is.
 * - Playwright's error message names the reason in its own words. Strider's `Timeout.message` doesn't carry the
 *   reason, so the port also asserts it in Strider's words on `message`. That check fails until the message says it.
 */
import { assert } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string; readonly by?: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The error of a click that Playwright's test expects to time out (its `.catch(e => e)`); a click that succeeds fails. */
const clickFailure = Effect.fnUntraced(function*(click: Effect.Effect<void, unknown>) {
  const result = yield* Effect.result(click)
  assert(Result.isFailure(result), "the click succeeded, where Playwright's click times out")
  return result.failure
})

/** Playwright's `page.click: Timeout <budget>ms exceeded.`, as a `Timeout` of the click with that budget. */
const clickTimeout = (error: unknown, budget: number): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  // Strider names the operation `Locator.click`
  assert.strictEqual(error.operation, "Locator.click")
  // Strider's budget counts from when the click starts: the timeout less the moments before then
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  return error
}

upstream(import.meta.filename, {}, (test) => {
  test("CL-114", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.display = "none"
      })
      const error = yield* clickFailure(page.locator("button").click().pipe(Deadline.within("5 seconds")))
      const timeout = clickTimeout(error, 5000)
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.strictEqual(reasonOf(timeout)?._tag, "NotVisible")
      assert.include(timeout.message, "waitingForCondition")
      assert.include(timeout.message, "The element isn't visible")
    }))

  test("CL-115", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.visibility = "hidden"
      })
      const error = yield* clickFailure(page.locator("button").click().pipe(Deadline.within("5 seconds")))
      const timeout = clickTimeout(error, 5000)
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.strictEqual(reasonOf(timeout)?._tag, "NotVisible")
      assert.include(timeout.message, "waitingForCondition")
      assert.include(timeout.message, "The element isn't visible")
    }))
})
