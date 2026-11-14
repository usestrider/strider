/**
 * Playwright's `tests/page/page-check.spec.ts`: checking and unchecking checkboxes, radios, and ARIA checkables, and the
 * refusals around that.
 *
 * What the port changes:
 * - `page.check(selector)` and `page.uncheck(selector)` are `page.locator(selector).check()` and `.uncheck()`. Each
 *   read of `checked` is Strider's `isChecked`, which reads the element's own checked state, and an ARIA role's
 *   `aria-checked` is `readAttribute`, which returns an `Option`.
 * - Strider has no `setChecked`. The matrix row says to branch on the boolean and call `check` or `uncheck`, which is
 *   what CH-016 does.
 * - A refusal is a `LocatorError` whose typed reason is asserted, not its message: CH-010 and CH-011 are `WrongElement`
 *   (not a checkbox), and CH-017 is `WrongElement` (a checked radio can't be unchecked, and its state is unchanged).
 * - CH-012's `page.$("input")` gives an ElementHandle, which Strider doesn't keep (the matrix row says so). The port
 *   reads the same element through its locator, as the handle's `isChecked` does.
 * - CH-013 checks the label at a point relative to its own box. Strider follows the label to its control, as the
 *   matrix and API.md describe.
 * - The ARIA-role loops (CH-008, CH-009) run every role inside one test, as the original does, and each role that fails
 *   is named in the one failure. Strider refuses `option` and `treeitem` with no `aria-checked` before any input
 *   (`WrongElement`, decisions.md, "Checked and selected are independent states"), so CH-008 fails on those roles.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The reason of a locator operation's typed failure. */
const reasonOf = (error: unknown) => {
  assert(Locator.isLocatorError(error), String(error))
  return error.reason
}

/**
 * Runs each case of an upstream loop, then fails once, naming each case that failed and its first error line, so one
 * failing case doesn't hide the rest.
 */
const eachCase = <T, R>(
  cases: ReadonlyArray<T>,
  name: (value: T) => string,
  run: (value: T) => Effect.Effect<void, unknown, R>
): Effect.Effect<void, unknown, R> =>
  Effect.gen(function*() {
    const failed: Array<string> = []
    for (const value of cases) {
      const exit = yield* Effect.exit(run(value))
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        const line = error instanceof Error ? error.message.split("\n")[0] : String(error)
        failed.push(`${name(value)}: ${line}`)
      }
    }
    assert.deepStrictEqual(failed, [], "the cases that failed")
  })

const roles = ["checkbox", "menuitemcheckbox", "option", "radio", "switch", "menuitemradio", "treeitem"]

upstream(import.meta.filename, {}, (test) => {
  test("CH-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("CH-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' checked></input>`)
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("CH-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' checked></input>`)
      yield* page.locator("input").uncheck()
      assert.isFalse(yield* page.locator("input").isChecked)
    }))

  test("CH-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      yield* page.locator("input").uncheck()
      assert.isFalse(yield* page.locator("input").isChecked)
    }))

  test("CH-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input type='radio'>one</input>
    <input id='two' type='radio'>two</input>
    <input type='radio'>three</input>`)
      yield* page.locator("#two").check()
      assert.isTrue(yield* page.locator("#two").isChecked)
    }))

  test("CH-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role='radio' id='checkbox'>CHECKBOX</div>
    <script>
      checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'true'));
    </script>`)
      yield* page.locator("div").check()
      assert.deepStrictEqual(yield* page.locator("div").readAttribute("aria-checked"), Option.some("true"))
    }))

  test("CH-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role='radio' id='checkbox' aria-checked="true">CHECKBOX</div>
    <script>
      checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'false'));
    </script>`)
      yield* page.locator("div").uncheck()
      assert.deepStrictEqual(yield* page.locator("div").readAttribute("aria-checked"), Option.some("false"))
    }))

  test("CH-008", ({ page }) =>
    Effect.gen(function*() {
      yield* eachCase(roles, (role) => `role=${role}`, (role) =>
        Effect.gen(function*() {
          yield* page.setContent(`<div role='${role}' id='checkbox'>CHECKBOX</div>
        <script>
          checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'true'));
        </script>`)
          yield* page.locator("div").check()
          assert.deepStrictEqual(yield* page.locator("div").readAttribute("aria-checked"), Option.some("true"))
        }))
    }))

  test("CH-009", ({ page }) =>
    Effect.gen(function*() {
      yield* eachCase(roles, (role) => `role=${role}`, (role) =>
        Effect.gen(function*() {
          yield* page.setContent(`<div role='${role}' id='checkbox' aria-checked="true">CHECKBOX</div>
        <script>
          checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', 'false'));
        </script>`)
          yield* page.locator("div").uncheck()
          assert.deepStrictEqual(yield* page.locator("div").readAttribute("aria-checked"), Option.some("false"))
        }))
    }))

  test("CH-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Check me</div>`)
      const error = yield* failureOf(page.locator("div").check(), "the check")
      assert.strictEqual(reasonOf(error)._tag, "WrongElement")
    }))

  test("CH-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role=button>Check me</div>`)
      const error = yield* failureOf(page.locator("div").check(), "the check")
      assert.strictEqual(reasonOf(error)._tag, "WrongElement")
    }))

  test("CH-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role='button'><input type='checkbox'></div>`)
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("input").isChecked)
      // Playwright's `page.isChecked` and its `ElementHandle.isChecked` read the same element: Strider's locator does
      assert.isTrue(yield* page.locator("input").isChecked)
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("CH-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id='checkbox' type='checkbox' style='width: 5px; height: 5px;'>
    <label for='checkbox'>
      <a href=${
        JSON.stringify(server.EMPTY_PAGE)
      }>I am a long link that goes away so that nothing good will happen if you click on me</a>
      Click me
    </label>`)
      const box = Option.getOrUndefined(yield* page.getByText("Click me").boundingBox)
      assert(box !== undefined, "the label has a box")
      yield* page.getByText("Click me").check({ position: { x: box.width - 10, y: 2 } })
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("CH-014", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      yield* page.locator("input").check({ trial: true })
      assert.isFalse(yield* page.locator("input").isChecked)
    }))

  test("CH-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' checked></input>`)
      yield* page.locator("input").uncheck({ trial: true })
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("CH-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      // Playwright's setChecked(true) and setChecked(false) are check and uncheck: Strider has no setChecked alias
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("input").isChecked)
      yield* page.locator("input").uncheck()
      assert.isFalse(yield* page.locator("input").isChecked)
    }))

  test("CH-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='radio' name='test' checked id='radio'>`)
      const error = yield* failureOf(page.locator("#radio").uncheck(), "the uncheck")
      assert.strictEqual(reasonOf(error)._tag, "WrongElement")
      assert.isTrue(yield* page.locator("#radio").isChecked)
    }))
})
