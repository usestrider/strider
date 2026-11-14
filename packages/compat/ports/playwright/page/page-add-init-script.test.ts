/**
 * Playwright's `tests/page/page-add-init-script.spec.ts`: a page's init scripts, from a function, a file, or source;
 * their order; CSP; a cross-origin navigation; removal with a scope; and the frames they run in.
 *
 * What the port changes:
 * - `page.addInitScript(fn)` is the same call. Strider's scripts take no argument, and the original's `{ content }` is
 *   `{ source }`, so `addInitScript({ content })` is `{ source }`.
 * - Strider's scripts have no `dispose()`: a script lives in the scope it was added in, so `dispose()` is `Scope.close`
 *   on the scope the script was `Scope.provide`d into (as browsercontext-add-init-script's port does).
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. IS-005's `page.evaluate("secret")`
 *   is a read of the global `secret`, so it's a function that returns `window.secret`.
 * - IS-002's `asset("injectedfile.js")` is the vendored file, read by `{ path }` when the script is added.
 * - IS-004 is not ported (see the ledger): Strider's `Source` is a function, `{ source }`, or `{ path }`, so an object with
 *   neither doesn't type-check, and there is no runtime check to test.
 * - IS-007's `server.setCSP` is `server.setExtraHeaders` with the same `Content-Security-Policy` header. Playwright's
 *   `page.addScriptTag({ content })` appends a script element to the document's head, which is what the port does with
 *   `evaluateInMainWorld`; the original ignores its failure, and so does the port, because the assertion is that
 *   `window.e` stays undefined.
 * - IS-011's `page.on("console")` listener is `ConsoleMessage.history`, read after the navigation has loaded, as the
 *   original's listener has collected every message by then. Strider's Firefox is WebDriver BiDi, so the original's
 *   non-BiDi Firefox branch (`no url yet`) doesn't apply: the init script sees `/frames/frame.html` on every browser.
 * - IS-011's `it.info().annotations` links an issue, which the port doesn't reproduce; the issue is in the index.
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("IS-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(() => {
        ;(window as any).injected = 123
      })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    }))

  test("IS-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript({ path: assetPath("playwright", "injectedfile.js") })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    }))

  test("IS-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript({ source: "window[\"injected\"] = 123" })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    }))

  test("IS-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.addInitScript({ source: "// comment" })
      yield* page.addInitScript({ source: "window.secret = 42;" })
      yield* page.goto("data:text/html,<html></html>", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).secret), 42)
    }))

  test("IS-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(() => {
        ;(window as any).script1 = 1
      })
      yield* page.addInitScript(() => {
        ;(window as any).script2 = 2
      })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).script1), 1)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).script2), 2)
    }))

  test("IS-007", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `server.setCSP` sets this header and no other
      server.setExtraHeaders("/empty.html", { "Content-Security-Policy": "script-src " + server.PREFIX })
      yield* page.addInitScript(() => {
        ;(window as any).injected = 123
      })
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).injected), 123)

      // Make sure CSP works: a script element added after load doesn't run under the policy
      yield* page.evaluateInMainWorld(() => {
        const script = document.createElement("script")
        script.textContent = "window.e = 10;"
        ;(document.head || document.documentElement).appendChild(script)
      })
      assert.isUndefined(yield* page.evaluateInMainWorld(() => (window as any).e))
    }))

  test("IS-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.CROSS_PROCESS_PREFIX, { waitUntil: "load" })
      yield* page.addInitScript(() => {
        ;(window as any).injected = 123
      })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)
    }))

  test("IS-009", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      // `disposable.dispose()`: the script lives in its own scope, which closing removes it from
      const scope = yield* Scope.make()
      yield* page.addInitScript(() => {
        ;(window as any).injected = 123
      }).pipe(Scope.provide(scope))
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), 123)

      yield* Scope.close(scope, Exit.void)
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.isUndefined(yield* page.evaluateInMainWorld(() => (window as any).result))
    })))

  test("IS-010", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const scope = yield* Scope.make()
      yield* page.addInitScript(() => {
        ;(window as any).script1 = 1
      }).pipe(Scope.provide(scope))
      yield* page.addInitScript(() => {
        ;(window as any).script2 = 2
      })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).script1), 1)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).script2), 2)

      yield* Scope.close(scope, Exit.void)
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.isUndefined(yield* page.evaluateInMainWorld(() => (window as any).script1))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).script2), 2)
    })))

  test("IS-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(() => console.log("init script:", location.pathname || "no url yet"))
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      const history = yield* ConsoleMessage.history(page)
      const messages = history.entries.map((message) => message.text).filter((text) => text.startsWith("init script:"))
      // Strider's Firefox is BiDi, so the frame's script sees its own path on every browser
      assert.deepStrictEqual(messages, [
        "init script: /frames/one-frame.html",
        "init script: /frames/frame.html"
      ])
    }))
})
