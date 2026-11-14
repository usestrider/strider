/**
 * Playwright's `tests/library/browser.spec.ts`: a browser's version, and what closing it does to its pages.
 *
 * What the port changes:
 * - `browser.version()` is `browser.info.version`. Chromium's version has four numbers, as Playwright's check says; the other
 *   browsers' have at least two. Stock WebKit reports `unknown` (API.md, "Stock WebKit attaches for looking"), which
 *   BR-004 does not check on WebKit, so it runs on Chromium and Firefox here.
 * - BR-005 launches its own browser, as browsertype-launch.test.ts's BT-004 does: `browser.close()` is ending the scope the
 *   browser was built in. Its page's `close` event is the page's `closed` effect, which gives the reason, and its
 *   evaluation rejects with `TargetGone`, the reason `BrowserClosed`.
 * - BR-001 (`browser.browserType()`), BR-002 (`browser.contexts()`), BR-006 (the browser's `context` event), and BR-007's
 *   `__testHookBeforeSetStorageState` are not ported; the ledger says why. BR-003 is in the ledger too.
 */
import { assert } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { backend, type BrowserName } from "../../harness/browsers.ts"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `browserType.launch()` for a test that closes its own browser, in a scope the test ends. */
const launchOwn = Effect.fnUntraced(function*(browserName: BrowserName) {
  const scope = yield* Scope.make()
  const services = yield* Layer.buildWithScope(backend(browserName, undefined), scope)
  return { scope, services }
})

upstream(import.meta.filename, {}, (test) => {
  test("BR-004", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const version = browser.info.version
      if (browserName === "chromium") assert.match(version, /^\d+\.\d+\.\d+\.\d+$/)
      else assert.match(version, /^\d+\.\d+/)
    }))

  test("BR-005", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const { scope, services } = yield* launchOwn(browserName)
      // The page's context is left to the browser: closing the browser is what ends it
      const pageScope = yield* Scope.make()
      const page = yield* Browser.newPage().pipe(Effect.provideContext(services), Scope.provide(pageScope))
      const closed = yield* startWaiting(page.closed)
      const neverResolves = yield* startWaiting(page.evaluateInMainWorld(() => new Promise(() => {})))
      // The original's evaluation is in flight before the close: one round trip to the page first
      yield* page.evaluateInMainWorld(() => new Promise((resolve) => setTimeout(resolve, 0)))
      yield* Scope.close(scope, Exit.void)
      const reason = yield* Fiber.join(closed.fiber)
      assert.strictEqual(reason._tag, "BrowserClosed")
      const error = yield* failureOf(Fiber.join(neverResolves.fiber), "the evaluation")
      assert(Target.isTargetGone(error), String(error))
      assert.strictEqual(error.reason._tag, "BrowserClosed")
    }))
})
