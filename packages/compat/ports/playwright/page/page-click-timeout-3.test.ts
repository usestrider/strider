/**
 * Playwright's `tests/page/page-click-timeout-3.spec.ts`: a click whose hit target is covered by another element.
 *
 * What the port changes:
 * - `page.$("button")` is a locator, `page.locator("button")`, which re-resolves on each attempt where Playwright's
 *   element handle is pinned. The fixture has one button, so the two name the same element.
 * - `button.click({ timeout })` is `button.click()` under `Deadline.within`. The timed-out click's error is a
 *   `Deadline.Timeout`: its budget, its phase, and the reason it last observed are asserted on the typed error.
 * - `covered by` names the covering element as Strider describes it: `div#blocker`, where Playwright's `<div id="blocker"></div>`.
 * - CL-117's "waiting 500ms" is Playwright's backoff in its call log. Strider retries on each animation frame and has
 *   no interval to report, so the port asserts the retry itself, which is the `waitingForCondition` phase. Playwright's
 *   "retrying click action" is asserted the same way.
 * - CL-118 is Playwright's `force: true`, which Strider doesn't have: there's no blanket force. The port turns off the
 *   four checks that Playwright's force skips (visible, enabled, stable, and the hit target), by name, and keeps the
 *   others. The original asserts only that the click doesn't throw.
 * - CL-119's "from <div id=blocker>…</div> subtree" names the blocking element's ancestor. Strider's `covered by`
 *   names only the element at the action point, so the port asserts that element.
 * - Playwright's error message names the reason in its own words. Strider's `Timeout.message` doesn't carry the
 *   reason, so the port also asserts it in Strider's words on `message`. That check fails until the message says it.
 * - CL-116 uses Playwright's `__testHookBeforeHitTarget` and its `mode`, so it isn't ported (see the ledger).
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

/** Playwright's `elementHandle.click: Timeout <budget>ms exceeded.`, as a `Timeout` of the click with that budget. */
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
  test("CL-117", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const button = page.locator("button")
      yield* page.evaluateInMainWorld(() => {
        document.body.style.position = "relative"
        const blocker = document.createElement("div")
        blocker.id = "blocker"
        blocker.style.position = "absolute"
        blocker.style.width = "400px"
        blocker.style.height = "20px"
        blocker.style.left = "0"
        blocker.style.top = "0"
        document.body.appendChild(blocker)
      })
      const error = yield* clickFailure(button.click().pipe(Deadline.within("5 seconds")))
      const timeout = clickTimeout(error, 5000)
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, "div#blocker")
      assert.include(timeout.message, "Another element covers the element's action point: div#blocker")
    }))

  test("CL-118", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const button = page.locator("button")
      yield* page.evaluateInMainWorld(() => {
        document.body.style.position = "relative"
        const blocker = document.createElement("div")
        blocker.id = "blocker"
        blocker.style.position = "absolute"
        blocker.style.width = "400px"
        blocker.style.height = "200px"
        blocker.style.left = "0"
        blocker.style.top = "0"
        document.body.appendChild(blocker)
      })
      // Playwright's `force: true`: the checks it skips are off by name; inViewport and notInert stay on
      yield* button.click({
        checks: { visible: false, enabled: false, stable: false, receivesPointer: false }
      })
    }))

  test("CL-119", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const button = page.locator("button")
      yield* page.evaluateInMainWorld(() => {
        document.body.style.position = "relative"

        const blocker = document.createElement("div")
        blocker.id = "blocker"
        blocker.style.position = "absolute"
        blocker.style.width = "400px"
        blocker.style.height = "20px"
        blocker.style.left = "0"
        blocker.style.top = "0"
        document.body.appendChild(blocker)

        const inner = document.createElement("div")
        inner.id = "inner"
        inner.style.position = "absolute"
        inner.style.left = "0"
        inner.style.top = "0"
        inner.style.right = "0"
        inner.style.bottom = "0"
        blocker.appendChild(inner)
      })
      const error = yield* clickFailure(button.click().pipe(Deadline.within("5 seconds")))
      const timeout = clickTimeout(error, 5000)
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, "div#inner")
      assert.include(timeout.message, "Another element covers the element's action point: div#inner")
    }))
})
