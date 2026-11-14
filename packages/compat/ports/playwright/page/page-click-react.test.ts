/**
 * Playwright's `tests/page/page-click-react.spec.ts`: clicks on React components that change or recycle their elements
 * on hover, and a click that opens an alert.
 *
 * What the port changes:
 * - `react.html` loads React 16.13.1 from the vendored assets (`react/react@16.13.1.production.min.js`), and the
 *   components it renders are the original's, through `renderComponent`, `e`, and `MyButton` page globals.
 * - `page.click("text=button1")` is `page.getByText("button1").click()`, which matches the same case-insensitive text.
 *   `page.click("div")` is `page.locator("div").click()`.
 * - `page.evaluate` runs in the main world, so the render and the reads are `page.evaluateInMainWorld`.
 * - CL-106's `page.waitForEvent("dialog")` holds the alert until the test dismisses it, as Playwright's listener does.
 *   A handler that waits holds it the same way; the handler records the dialog, so the test can read it and dismiss it.
 *   The click's timeout is a `Deadline.Timeout` whose budget and operation are asserted; Strider's message names the
 *   operation and phase, not Playwright's `page.click: Timeout …` wording.
 */
import { assert } from "@effect/vitest"
import { Deadline, Dialog, type Page } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The React helpers the fixture page defines as globals. */
declare const renderComponent: (component: unknown) => void
declare const e: (...args: Array<unknown>) => unknown
declare const MyButton: unknown

/** A page global, read in the main world. */
const global = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name) => (window as unknown as Record<string, unknown>)[name], name)

upstream(import.meta.filename, {}, (test) => {
  test("CL-106", ({ page }) =>
    Effect.gen(function*() {
      // The dialog is held until the test decides it, as Playwright's `dialog` listener holds the alert open
      const shown = yield* Deferred.make<Dialog.Dialog>()
      const released = yield* Deferred.make<void>()
      yield* Dialog.handle(page, (dialog) =>
        Deferred.succeed(shown, dialog).pipe(
          Effect.andThen(Deferred.await(released)),
          Effect.andThen(Dialog.dismissAll(dialog))
        ))
      yield* page.setContent(`<div onclick='window.alert(123)'>Click me</div>`)
      const error = yield* failureOf(
        page.locator("div").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.click")
      // Strider's budget counts from when the click starts: the timeout less the moments before then
      assert.isAtMost(Duration.toMillis(error.budget), 3000)
      assert.isAbove(Duration.toMillis(error.budget), 3000 - 500)
      const dialog = yield* Deferred.await(shown)
      assert.propertyVal(dialog, "message", "123")
      yield* Deferred.succeed(released, undefined)
    }))

  test("CL-107", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/react.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        renderComponent(
          e("div", {}, [e(MyButton, { name: "button1", renameOnHover: true }), e(MyButton, { name: "button2" })])
        )
      })
      yield* page.getByText("button1").click()
      assert.strictEqual(yield* global(page, "button1"), true)
      assert.strictEqual(yield* global(page, "button2"), undefined)
    }))

  test("CL-108", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/react.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const shuffle = () => {
          renderComponent(e("div", {}, [e(MyButton, { name: "button2" }), e(MyButton, { name: "button1" })]))
        }
        renderComponent(
          e("div", {}, [e(MyButton, { name: "button1", onHover: shuffle }), e(MyButton, { name: "button2" })])
        )
      })
      yield* page.getByText("button1").click()
      assert.strictEqual(yield* global(page, "button1"), undefined)
      assert.strictEqual(yield* global(page, "button2"), true)
    }))
})
