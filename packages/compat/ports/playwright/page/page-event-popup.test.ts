/**
 * Playwright's `tests/page/page-event-popup.spec.ts`: the popups a page opens, with their opener and how they are opened
 * (`window.open`, a click on a `target=_blank` link, a link with `noopener`).
 *
 * What the port changes:
 * - `page.waitForEvent("popup")` is `Popup.next(page)`, subscribed before the action that opens the popup, and the popup
 *   is read from the wait it returns once the action has run.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`, and `popup.evaluate` likewise.
 * - Strider keeps the browser's popup blocking, so a script that opens a popup runs as a user gesture
 *   (`Page.withUserGesture`). A click from a real pointer (PO-012) needs none.
 * - `window.open(url, null, "noopener")`: the original passes `null` as the target, which the browser reads as the name
 *   `"null"`; the port passes the same value.
 * - `popup.url()` is Strider's `popup.url`, a watchable read with `yield*`.
 * - PO-013's `page.frames()[1]` is the first iframe of the page, which is the first child of the frame tree. Its
 *   `window.open` runs from that iframe's window, read through `contentWindow` in the main world.
 * - A popup that navigates is waited on until it has committed its address (`committed`), as Playwright's popup event
 *   implies, before the port reads its document.
 * - PO-005: `context.waitForEvent("dialog")` has no counterpart (Dialog takes one page, and a dialog nothing has
 *   a handler for is decided at once by the context's policy), so the port reads the popup's `Dialog.history`, which
 *   holds the alert's message, and the policy dismisses it where the original's `dialog.dismiss()` does.
 * - PO-010 leaves out `popup.mainFrame().page()` being the popup: Strider's frames have no link back to their page,
 *   and a popup's frame tree is read from the popup itself.
 */
import { assert } from "@effect/vitest"
import { Dialog, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/**
 * Playwright reports a popup only once its first navigation has committed (Chromium's `reportAsNew` waits for it),
 * so a test that reads a popup's document after `waitForEvent("popup")` finds it loaded. Strider reports a popup as
 * soon as it appears, so the port waits for the committed address the original's event implies.
 */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

upstream(import.meta.filename, {}, (test) => {
  test("PO-001", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).__popup = window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), true)
    }))

  test("PO-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).__popup = window.open(
          window.location.href,
          "Title",
          "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=780,height=200,top=0,left=0"
        )
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), true)
    }))

  test("PO-003", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        const win = window.open("about:blank")
        win?.close()
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      assert.isOk(popup)
    }))

  test("PO-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        const win = window.open(window.location.href)
        win?.close()
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      assert.isOk(popup)
    }))

  test("PO-005", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      // The alert runs in the script that opens the popup, so nothing can hold it: the context's policy dismisses it
      // (`dialogs` defaults to `"dismiss"`), where the original dismisses it by hand, and the script then returns.
      yield* page.evaluateInMainWorld(() => {
        const win = window.open("")
        win?.alert("hello")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      // The dialog belongs to the popup: `dialog.page()` is the popup in the original, and here it is the popup's own log
      const dialogs = yield* Dialog.history(popup)
      assert.deepStrictEqual(
        dialogs.entries.map((dialog) => dialog._tag === "BeforeUnload" ? undefined : dialog.message),
        [
          "hello"
        ]
      )
    }))

  test("PO-006", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).__popup = window.open("")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), true)
    }))

  test("PO-007", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).__popup = window.open(undefined, null as unknown as string, "noopener")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      // Chromium reports `about:blank#blocked` here.
      assert.strictEqual(((yield* popup.url) as string).split("#")[0], "about:blank")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), false)
    }))

  test("PO-008", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).__popup = window.open("about:blank", null as unknown as string, "noopener")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), false)
    }))

  test("PO-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        ;(window as any).__popup = window.open(url, null as unknown as string, "noopener")
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), false)
    }))

  test("PO-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<a target=_blank rel=\"opener\" href=\"/one-style.html\">yo</a>")
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), true)
      // `popup.mainFrame().page()` being the popup isn't asserted: Strider's frames have no `page` (matrix row method-frame-page)
    }))

  test("PO-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<a target=_blank rel=noopener href=\"/one-style.html\">yo</a>")
      const opened = yield* Popup.next(page)
      // A script's click on the link: it isn't a user's, so Strider's popup blocking needs the gesture
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("a")?.click()
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), false)
    }))

  test("PO-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<a target=_blank rel=noopener href=\"/one-style.html\">yo</a>")
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => !!window.opener), false)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => !!window.opener), false)
    }))

  test("PO-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/two-frames.html")
      // `page.frames()[1]`: the first iframe, the first child of the frame tree
      const tree = yield* page.frames
      assert.isOk(tree.children[0])
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")?.contentWindow?.open("")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      assert.isOk(popup)
    }))
})
