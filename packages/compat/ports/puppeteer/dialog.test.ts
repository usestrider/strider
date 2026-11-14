/**
 * Puppeteer's `test/src/dialog.test.ts`: the dialogs a page opens (`alert`, `prompt`), decided by a handler, and seen
 * by a second connection.
 *
 * What the port changes:
 * - A dialog's handler is `Dialog.handle`, and its decision is what the handler returns, as `dialog-page`'s ports do.
 *   Puppeteer's `page.on("dialog", …)` handler is the same handler; the port records each dialog it is given and
 *   asserts on the record in the test body, where a failure fails the test.
 * - Strider's `Dialog` is typed by kind. An alert has no default value (Puppeteer's `defaultValue()` is `""`), so the
 *   port asserts the field is absent. Stock WebKit doesn't say which kind a dialog is, so every dialog there is
 *   `Unknown`, as `page-dialog` asserts.
 * - `page.evaluate` runs page code in the main world, so each is `page.evaluateInMainWorld`.
 * - "should see dialogs handled by other connections" is `needsFeature` in the ledger: it reads the dialog's `handled`
 *   flag from a second connection's dialog, which Strider has no `dialogclosed` for.
 */
import { assert } from "@effect/vitest"
import { Dialog } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { type Fixtures, upstream } from "../harness/upstream.ts"

/** The kind Strider reports for a dialog that Puppeteer calls `kind`. Stock WebKit reports every dialog as `Unknown`. */
const kindOf = (browserName: Fixtures["browserName"], kind: Dialog.Kind): Dialog.Kind =>
  browserName === "webkit" ? "Unknown" : kind

upstream(import.meta.filename, {}, (test) => {
  test("Page.Events.Dialog should fire", ({ page, browserName }) =>
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
      assert.propertyVal(dialog, "message", "yo")
      // An alert has no default value, where Puppeteer's `defaultValue()` is the empty string
      assert.notProperty(dialog, "defaultValue")
    }))

  test("Page.Events.Dialog should allow accepting prompts", ({ page, browserName }) =>
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

  test("Page.Events.Dialog should dismiss the prompt", ({ page }) =>
    Effect.gen(function*() {
      yield* Dialog.handle(page, Dialog.dismissAll)
      const result = yield* page.evaluateInMainWorld(() => prompt("question?"))
      assert.strictEqual(result, null)
    }))
})
