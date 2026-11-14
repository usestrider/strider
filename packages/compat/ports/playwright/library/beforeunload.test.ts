/**
 * Playwright's `tests/library/beforeunload.spec.ts`: a page's `beforeunload` handler when the page is closed, its
 * context or browser is closed, or it navigates away.
 *
 * What the port changes:
 * - `page.close({ runBeforeUnload: true })` is `page.close({ runBeforeUnload: true })`, and its prompt is a dialog
 *   decided by `Dialog.handle`. Playwright's close resolves once the prompt shows, and a dismissed prompt keeps the
 *   page open without an error. Strider's close waits for the decision: a `stay` fails it with `CloseCanceled` and the
 *   page stays usable, so the port asserts that failure where the original dismisses. The prompt is an
 *   `event-page-dialog` decision, and `Dialog.dismissAll` on a `BeforeUnload` is `stay`.
 * - Without a handler, a context's default `dialogs` policy decides a prompt (`dismiss`, the default for owned
 *   contexts, leaves on a `beforeunload`), so BU-003 and BU-004 need no handler.
 * - `browserType.launch()` and `browser.close()` (BU-001) are a browser this test launches inside a scope, from the
 *   same backend the harness uses; closing it is that scope's end, which closes without running `beforeunload`.
 *   `browser.close()` as a call on the shared browser isn't available to a test. BU-002's `context.close()` is the end
 *   of a context the test owns, `Browser.newContext`, in a scope.
 * - `page.click("body")` is `page.locator("body").click()`, and each page is opened with `waitUntil: "load"`, the
 *   original's `goto` default. The click is what lets the browser prompt (QUIRKS.md, Q150, and API.md "Pages").
 * - `page.evaluate(…)` runs in the main world, so it's `page.evaluateInMainWorld`.
 * - BU-007's `Promise.all([waitForEvent('dialog').then(dismiss), evaluate(reload)])` is a dialog subscribed before the
 *   reload, with a handler that stays on the page registered before it, as the original's listener is.
 * - BU-008's `click({ noWaitAfter: true })` is a click, since Strider's click doesn't wait for a navigation it starts.
 *   Its `click({ timeout: 5000 })` is that click under `Deadline.within("5 seconds")`.
 * - BU-012's `page.close({ runBeforeUnload: true })` is refused with `CloseCanceled`, as BU-006 says, and its route
 *   handler is `Route.fulfill`.
 * - BU-005 isn't ported (see the ledger): the prompt's message and default value aren't reported for a `BeforeUnload`.
 */
import { assert } from "@effect/vitest"
import { Browser, Deadline, Dialog, Expect, Page, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Result from "effect/Result"
import { backend } from "../../harness/browsers.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Asserts a close a handler's `stay` refused: Strider's `CloseCanceled`, which leaves the page open. Playwright's
 * dismissed close resolves, so this is the refusal the original's dismissal implies.
 */
const assertRefused = (result: Result.Result<void, unknown>) => {
  assert(Result.isFailure(result), "the close ran, where a dismissed beforeunload keeps the page open")
  assert(Page.isPageError(result.failure), `expected a PageError, got ${String(result.failure)}`)
  assert.strictEqual(result.failure.reason._tag, "CloseCanceled")
}

upstream(import.meta.filename, {}, (test) => {
  test("BU-001", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      // `browserType.launch()`, a browser of the test's own, closed when its scope ends
      yield* Effect.scoped(
        Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
          yield* page.locator("body").click()
        }).pipe(Effect.provide(backend(browserName, undefined)))
      )
    }))

  test("BU-002", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // `context.close()`: a context the test owns ends with its scope, which closes without running beforeunload
      yield* Effect.scoped(
        Effect.gen(function*() {
          const context = yield* Browser.newContext()
          const page = yield* context.newPage
          yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
          yield* page.locator("body").click()
        })
      )
    }))

  test("BU-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* page.locator("body").click()
      // The context's policy accepts the prompt, so the navigation leaves the page
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
    }))

  test("BU-004", ({ page, server }) =>
    Effect.gen(function*() {
      const newPage = yield* page.context.newPage
      yield* newPage.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* newPage.locator("body").click()
      yield* newPage.close()
    }))

  test("BU-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* page.locator("body").click()
      const dialogs: Array<Dialog.Pending> = []
      yield* Dialog.handle(page, (dialog) => {
        dialogs.push(dialog)
        return Dialog.dismissAll(dialog)
      })
      assertRefused(yield* Effect.result(page.close({ runBeforeUnload: true })))
      assert.strictEqual(dialogs.length, 1)
      // The page is still usable: its main world answers
      yield* page.evaluateInMainWorld(() => document.title)
    }))

  test("BU-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* page.locator("body").click()
      yield* Dialog.handle(page, Dialog.dismissAll)
      // The reload's prompt is subscribed before the reload, and the evaluation returns without waiting for it
      const dialog = yield* Dialog.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.location.reload()
      })
      yield* dialog
    }))

  test("BU-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href="${server.PREFIX}/frames/one-frame.html">click me</a>`)
      yield* page.evaluateInMainWorld(() => {
        window.onbeforeunload = () => false
      })
      yield* Dialog.handle(page, Dialog.dismissAll)
      yield* page.getByRole("link").click()
      yield* page.evaluateInMainWorld(() => {
        window.onbeforeunload = null
      })
      // This line should not time out
      yield* page.getByRole("link").click().pipe(Deadline.within("5 seconds"))
      yield* Expect.toHaveURL(page, server.PREFIX + "/frames/one-frame.html")
    }))

  test("BU-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* page.locator("body").click()
      const dialogs: Array<Dialog.Pending> = []
      yield* Dialog.handle(page, (dialog) => {
        dialogs.push(dialog)
        return Dialog.dismissAll(dialog)
      })
      assertRefused(yield* Effect.result(page.close({ runBeforeUnload: true })))
      assertRefused(yield* Effect.result(page.close({ runBeforeUnload: true })))
      assert.strictEqual(dialogs.length, 2)
    }))

  test("BU-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* page.locator("body").click()
      yield* Dialog.handle(page, Dialog.dismissAll)
      assertRefused(yield* Effect.result(page.close({ runBeforeUnload: true })))
      yield* page.close()
      assert.strictEqual((yield* page.status)._tag, "Closed")
    }))

  test("BU-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
      yield* page.locator("body").click()
      // Accepting the prompt leaves, so the close completes and the page closes by the command
      yield* Dialog.handle(page, Dialog.acceptAll)
      const [reason] = yield* Effect.all([page.closed, page.close({ runBeforeUnload: true })], {
        concurrency: "unbounded"
      })
      assert(reason._tag === "PageClosed" && reason.by === "command", `closed for another reason: ${reason._tag}`)
      assert.strictEqual((yield* page.status)._tag, "Closed")
    }))

  test("BU-012", ({ page, server }) =>
    Effect.gen(function*() {
      // `server.HELLO_WORLD` has no vendored asset, so the server answers it with a 404, as an unknown path
      yield* page.goto(server.PREFIX + "/hello-world", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener("beforeunload", (event) => {
          event.preventDefault()
        })
      })
      yield* Dialog.handle(page, Dialog.dismissAll)
      yield* page.locator("body").click()
      yield* page.route("**/api", () => Route.fulfill(HttpServerResponse.text("ok")))
      yield* page.evaluateInMainWorld(async () => {
        await fetch(new URL("/api", window.location.href))
      })
      assertRefused(yield* Effect.result(page.close({ runBeforeUnload: true })))
      yield* page.evaluateInMainWorld(async () => {
        await fetch(new URL("/api", window.location.href))
      })
    }))
})
