/**
 * Playwright's `tests/page/page-click-timeout-1.spec.ts`: a click that waits on a disabled, inert, or modal-covered
 * element until its timeout.
 *
 * What the port changes:
 * - `page.click("text=…", { timeout })` is `page.getByText(…).click()` under `Deadline.within`; `getByText` matches
 *   case-insensitively as a substring, as `text=` does. The timed-out click's error is a `Deadline.Timeout`: its
 *   budget, its phase, and the reason it last observed are asserted on the typed error.
 * - Playwright's error message names the reason in its own words. Strider's `Timeout.message` names only the
 *   operation and phase, and the reason is in `last` and `hint`, so the port also asserts the reason in Strider's
 *   words on `message`, as the original does on its message. That check fails until the message says it.
 * - `page.evaluate("window.__CLICKED")` reads the page's own global, so it runs in the main world, as Playwright's
 *   `page.evaluate` does, through `evaluateInMainWorld`.
 * - CL-110 uses Playwright's `__testHookBeforePointerAction` and its `mode`, so it isn't ported (see the ledger).
 * - CL-113: Playwright reports an element outside a modal dialog as inert. Strider's reason is more specific,
 *   `BlockedByModal`, naming the dialog, and the port asserts that.
 */
import { assert } from "@effect/vitest"
import { Deadline, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string; readonly by?: string; readonly dialog?: string }

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

const clicked = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { __CLICKED?: boolean }).__CLICKED)

upstream(import.meta.filename, {}, (test) => {
  test("CL-111", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<button onclick="javascript:window.__CLICKED=true;" disabled><span>Click target</span></button>`
      )
      const error = yield* clickFailure(page.getByText("Click target").click().pipe(Deadline.within("3 seconds")))
      assert.strictEqual(yield* clicked(page), undefined)
      const timeout = clickTimeout(error, 3000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Disabled")
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.include(timeout.message, "The element is disabled")
    }))

  test("CL-112", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div inert><button onclick="javascript:window.__CLICKED=true;">Click target</button></div>`
      )
      const error = yield* clickFailure(page.getByText("Click target").click().pipe(Deadline.within("3 seconds")))
      assert.strictEqual(yield* clicked(page), undefined)
      const timeout = clickTimeout(error, 3000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Inert")
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.include(timeout.message, "The element is inert")
    }))

  test("CL-113", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button onclick="javascript:window.__CLICKED=true;">Click target</button>
    <dialog id=dialog><button>Inside</button></dialog>
    <script>
      document.getElementById('dialog').showModal();
    </script>
  `)
      const error = yield* clickFailure(page.getByText("Click target").click().pipe(Deadline.within("3 seconds")))
      assert.strictEqual(yield* clicked(page), undefined)
      const timeout = clickTimeout(error, 3000)
      // Playwright says the element is inert; Strider names the modal dialog that makes it so
      assert.deepStrictEqual(reasonOf(timeout), { _tag: "BlockedByModal", dialog: `dialog#dialog "Inside"` })
      assert.include(timeout.message, `A modal dialog, dialog#dialog "Inside", blocks the element`)
    }))
})
