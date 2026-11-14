/**
 * Playwright's `tests/library/browsercontext-add-init-script.spec.ts`: context-wide init scripts, their order against a
 * page's own, popups, a script from a file, and removing a script with its scope.
 *
 * What the port changes:
 * - Each test makes its own context in `Effect.scoped` (`page: false`), as the original's `context` fixture does, and
 *   `context.newPage` is the original's `context.newPage()`.
 * - `context.addInitScript(fn)` is `context.addInitScript(fn)`, and `page.addInitScript(fn)` is the page's. A script
 *   added to a page that's already loaded runs from its next document, which is where each test navigates.
 * - `dispose()` on the registration is the end of the scope the script was added in: `Scope.make`, the script added
 *   `Scope.provide`d into it, and `Scope.close` where the original disposes it. Strider has no `dispose` method.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - IS-026 and IS-035 open a popup with `window.open` from a script, which runs as a user gesture under Strider's popup
 *   blocking (`Page.withUserGesture`). The popup is read from `Popup.next`, subscribed before the script runs, and it's
 *   waited on at `about:blank` before its document is read, as popup.test.ts does.
 * - IS-027's `{ path }` script is the vendored `injectedfile.js`, read when the script is added.
 * - IS-025 needs `context.exposeFunction`, and IS-031 through IS-034 need `addInitScript`'s `exposeFunctions` option with
 *   an argument carrying the functions. Strider has neither, and each test's point is a Node-side function the page
 *   calls (or the exposure's lifetime), so inlining the function into the script would check nothing: they aren't ported
 *   (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `popup.waitForEvent` settles at the popup's first committed address: this waits for the same. */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

upstream(import.meta.filename, {}, (test) => {
  test("IS-024", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.addInitScript(() => {
        ;(window as any).temp = 123
      })
      const page = yield* context.newPage
      yield* page.addInitScript(() => {
        ;(window as any).injected = (window as any).temp
      })
      yield* page.goto(server.PREFIX + "/tamperable.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    })))

  test("IS-026", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.addInitScript(() => {
        ;(window as any).temp = 123
      })
      const page = yield* context.newPage
      // `Promise.all([page.waitForEvent("popup"), page.evaluate(...)])`: the wait is subscribed before the script runs
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).win = window.open()
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, "about:blank")
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => (window as any).temp), 123)
    })))

  test("IS-027", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.addInitScript({ path: assetPath("playwright", "injectedfile.js") })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/tamperable.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    })))

  test("IS-028", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* context.addInitScript(() => {
        ;(window as any).temp = 123
      })
      yield* page.addInitScript(() => {
        ;(window as any).injected = (window as any).temp
      })
      yield* page.goto(server.PREFIX + "/tamperable.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    })))

  test("IS-029", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      // `disposable.dispose()`: the script lives in its own scope, which closing removes it from
      const scope = yield* Scope.make()
      yield* context.addInitScript(() => {
        ;(window as any).temp = 123
      }).pipe(Scope.provide(scope))
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/tamperable.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).temp), 123)

      yield* Scope.close(scope, Exit.void)
      yield* page.goto(server.PREFIX + "/tamperable.html")
      assert.isUndefined(yield* page.evaluateInMainWorld(() => (window as any).temp))
    })))

  test("IS-030", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const scope = yield* Scope.make()
      yield* context.addInitScript(() => {
        ;(window as any).temp = 123
      }).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/tamperable.html")
      assert.isUndefined(yield* page.evaluateInMainWorld(() => (window as any).temp))
    })))

  test("IS-035", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.addInitScript(() => {
        ;(window as any).callCount = ((window as any).callCount || 0) + 1
      })
      const page = yield* context.newPage
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, "about:blank")
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => (window as any).callCount), 1)
    })))
})
