/**
 * Playwright's `tests/page/page-dialog.spec.ts`: the dialogs a page opens (`alert`, `confirm`, `prompt`) and how they
 * are decided, by a handler or by the context's default policy.
 *
 * What the port changes:
 * - A dialog's handler is `Dialog.handle`, and its decision is what the handler returns: `dialog.accept` and
 *   `dialog.dismiss` are `Dialog.acceptAll` and `Dialog.dismissAll` where the test has one kind of dialog, and
 *   `dialog.accept(text)` is `dialog.respond(text)`. A dialog is held until its handler decides, so each handler is
 *   registered before the action that opens the dialog, as the original does.
 * - Playwright's handlers assert inside the listener. A Strider handler that fails leaves the dialog to the policy
 *   and logs its failure, so the port records each dialog it is given and asserts on the record in the test body,
 *   where a failure fails the test. DI-001 and DI-005 also assert that exactly one dialog arrived: the original's
 *   listener checks pass vacuously when none does, and fail on any dialog that breaks them.
 * - Strider's `Dialog` is typed by kind. Its alert has no default value, where Playwright's `defaultValue()` is
 *   `""`, so the port asserts the field is absent. Stock WebKit doesn't say which kind a dialog is, so every dialog
 *   there is `Unknown`, which has no default value either (`prompts.kind`; API.md, "Dialogs, downloads, storage,
 *   permissions"). On WebKit the port asserts Strider's `Unknown` where the original asserts `alert`, `prompt`, or
 *   `confirm`; on the other browsers it asserts the kind.
 * - `page.evaluate(…)` runs page code in the main world, where the page's own `alert`, `prompt`, and `window` globals
 *   are, so it's `page.evaluateInMainWorld`.
 * - DI-009's `window.builtins.setTimeout` is Playwright's injected copy of `setTimeout`, which its tests use so a page
 *   can't replace it. The page here runs no script of its own, so the port calls `window.setTimeout`.
 * - `page.setContent`, `page.textContent("p")`, and `page.click("div")` are `page.setContent`,
 *   `page.locator("p").readText`, and `page.locator("div").click()`.
 * - The original's `it.skip(isElectron, …)` on DI-005, DI-006, and DI-012 doesn't apply: Strider isn't Electron, and
 *   `prompt()` works in every browser it drives, so those tests run.
 * - DI-002 and DI-003 wait for `dialogclosed`, which Strider doesn't have, so they aren't ported (see the ledger).
 * - DI-004 waits for `dialogclosed` on an alert its context dismissed by default. Strider has no `dialogclosed`, but a
 *   dialog that nothing decides is reported as an `AutoResolution` carrying its message, so the port waits for that
 *   instead, and asserts the decision was the policy's dismissal.
 */
import { assert } from "@effect/vitest"
import { AutoResolution, Dialog } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { type Fixtures, upstream } from "../../harness/upstream.ts"

/**
 * The kind Strider reports for a dialog that Playwright calls `kind`. Stock WebKit doesn't say which kind a dialog is,
 * so every dialog there is `Unknown`.
 */
const kindOf = (browserName: Fixtures["browserName"], kind: Dialog.Kind): Dialog.Kind =>
  browserName === "webkit" ? "Unknown" : kind

upstream(import.meta.filename, {}, (test) => {
  test("DI-001", ({ page, browserName }) =>
    Effect.gen(function*() {
      const seen: Array<Dialog.Dialog> = []
      yield* Dialog.handle(page, (dialog) => {
        seen.push(dialog)
        return Dialog.acceptAll(dialog)
      })
      yield* page.evaluateInMainWorld(() => alert("yo"))
      assert.strictEqual(seen.length, 1)
      const [dialog] = seen
      assert.isDefined(dialog)
      assert.strictEqual(dialog._tag, kindOf(browserName, "Alert"))
      // An alert has no default value, where Playwright's `defaultValue()` is `""`
      assert.notProperty(dialog, "defaultValue")
      assert.propertyVal(dialog, "message", "yo")
    }))

  test("DI-004", ({ page, browserName }) =>
    Effect.gen(function*() {
      // Strider has no `dialogclosed`: the report of a dialog its policy decided stands in, with its message
      const decided = yield* AutoResolution.next(page, { subject: "Dialog" })
      yield* page.evaluateInMainWorld(() => alert("yo"))
      const resolution = yield* decided
      assert.strictEqual(resolution.decision, "dismiss")
      assert.deepStrictEqual(resolution.policy, { _tag: "ContextOption", name: "dialogs", value: "dismiss" })
      assert.deepStrictEqual(resolution.subject, {
        _tag: "Dialog",
        kind: kindOf(browserName, "Alert"),
        message: "yo"
      })
    }))

  test("DI-005", ({ page, browserName }) =>
    Effect.gen(function*() {
      const seen: Array<Dialog.Dialog> = []
      yield* Dialog.handle(page, (dialog) => {
        seen.push(dialog)
        return dialog._tag === "Prompt" || dialog._tag === "Unknown"
          ? dialog.respond("answer!")
          : Dialog.dismissAll(dialog)
      })
      const result = yield* page.evaluateInMainWorld(() => prompt("question?", "yes."))
      assert.strictEqual(seen.length, 1)
      const [dialog] = seen
      assert.isDefined(dialog)
      assert.strictEqual(dialog._tag, kindOf(browserName, "Prompt"))
      assert.propertyVal(dialog, "message", "question?")
      if (dialog._tag === "Prompt") assert.strictEqual(dialog.defaultValue, "yes.")
      else assert.notProperty(dialog, "defaultValue")
      assert.strictEqual(result, "answer!")
    }))

  test("DI-006", ({ page }) =>
    Effect.gen(function*() {
      yield* Dialog.handle(page, Dialog.dismissAll)
      const result = yield* page.evaluateInMainWorld(() => prompt("question?"))
      assert.strictEqual(result, null)
    }))

  test("DI-007", ({ page }) =>
    Effect.gen(function*() {
      yield* Dialog.handle(page, Dialog.acceptAll)
      const result = yield* page.evaluateInMainWorld(() => confirm("boolean?"))
      assert.strictEqual(result, true)
    }))

  test("DI-008", ({ page }) =>
    Effect.gen(function*() {
      yield* Dialog.handle(page, Dialog.dismissAll)
      const result = yield* page.evaluateInMainWorld(() => confirm("boolean?"))
      assert.strictEqual(result, false)
    }))

  test("DI-009", ({ page }) =>
    Effect.gen(function*() {
      // In Playwright, any `dialog` listener, `waitForEvent`'s included, keeps the alert open, so the test ends and its
      // context closes with the alert still showing. Waiting with `Dialog.next` doesn't hold a dialog, and the policy
      // would dismiss it, so a handler that never decides holds it open instead
      const alertPromise = yield* Dialog.next(page)
      yield* Dialog.handle(page, () => Effect.never)
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => alert("hello"), 0)
      })
      yield* alertPromise
    }))

  test("DI-010", ({ page }) =>
    Effect.gen(function*() {
      yield* Dialog.handle(page, Dialog.acceptAll)
      yield* page.setContent(`
    <p>Hello World</p>
    <script>
      alert('Please dismiss this dialog');
      alert('Please dismiss this dialog');
      alert('Please dismiss this dialog');
    </script>
  `)
      assert.strictEqual(yield* page.locator("p").readText, "Hello World")
    }))

  test("DI-011", ({ page }) =>
    Effect.gen(function*() {
      yield* Dialog.handle(page, Dialog.acceptAll)
      yield* page.setContent(`
    <p>Hello World</p>
    <script>
      confirm('Please confirm me?');
      confirm('Please confirm me?');
      confirm('Please confirm me?');
    </script>
  `)
      assert.strictEqual(yield* page.locator("p").readText, "Hello World")
    }))

  test("DI-012", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => prompt("question?"))
      assert.strictEqual(result, null)
    }))

  test("DI-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div onclick="window.alert(123); window._clicked=true">Click me</div>`)
      yield* page.locator("div").click()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { _clicked?: boolean })._clicked),
        true
      )
    }))
})
