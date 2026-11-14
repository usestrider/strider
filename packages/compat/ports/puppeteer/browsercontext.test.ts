/**
 * Puppeteer's `test/src/browsercontext.test.ts`: a browser's contexts, which pages and workers belong to which context,
 * the storage and cookies each context isolates, the permissions a context grants, and the console and request events a
 * context reports for its own pages.
 *
 * What the port changes:
 * - A Puppeteer `BrowserContext` is Strider's `UserContext`: `browser.createBrowserContext()` is `Browser.newContext()`, a
 *   context lives while its scope does, and `context.close()` is the end of that scope. `context.pages()` is
 *   `context.pages` read with `yield*`. `browser.pages()` is `browser.pages`, every page of the browser.
 * - `browser.defaultBrowserContext()` is `browser.defaultContext`; it has no `close`, so "should not be able to close
 *   default context" has no call to refuse (the ledger says so). "should have default context" is only the browser's
 *   context count (`browserContexts().length >= 1`), so it's with the other count tests in the ledger.
 * - Puppeteer's `context.targets()` and `context.waitForTarget` are the context's pages: `context.pages`, and the wait for a
 *   page whose URL is the empty page is `page.url.waitFor`. Puppeteer's target-event listeners
 *   (`targetcreated`, `targetchanged`, `targetdestroyed`) are a CDP target model Strider doesn't expose, so
 *   "should fire target events" isn't ported; the ledger says why.
 * - The original counts the browser's contexts (`browser.browserContexts()`), which Strider's `Browser` has no list of
 *   (matrix row method-browser-contexts). The tests whose point is that count aren't ported. Where a count only brackets an
 *   isolation check, the port drops the count and keeps the isolation check, and the comment says so.
 * - `context.overridePermissions(origin, names)` is `context.grant(names, { origin })`, which adds grants for a scope.
 *   Puppeteer's `clearPermissionOverrides` is the end of that scope. Strider has no denied or prompt state to set, so the
 *   tests that deny a permission are in the ledger.
 * - `page.evaluate` runs in the main world, so the port reads `page.evaluateInMainWorld`. A `window.open` runs as a user
 *   gesture (`Page.withUserGesture`), since Strider keeps the browser's popup blocking. The popup is found in the
 *   context's `pages`, which every browser reports, not with `Popup.next`, which WebKit doesn't support.
 * - Context-level console and request events are read from the context's histories after the original's own wait, as
 *   browsercontext-network-event.test.ts reads them: the histories hold the same events, and each read comes after the
 *   message or request it checks. A request that is a favicon is skipped, as the original does.
 * - The browser-level `console` event and the context's `requestfinished`, `requestfailed`, and cache events aren't in
 *   Strider; the tests that need them are in the ledger.
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  BrowserWorker,
  ConsoleMessage,
  Deadline,
  Declaration,
  NetworkRequest,
  Page,
  type UserContext
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { failureOf, startWaiting } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** `navigator.permissions.query({ name })`'s state, read in the page's main world, as the original's `page.evaluate` does. */
const getPermission = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld(
    (name) => navigator.permissions.query({ name: name as PermissionName }).then((result) => result.state),
    name
  )

/** The non-favicon URLs of a context's request history: Puppeteer's `request.url()` for the requests the listener saw. */
const requestUrlsOf = Effect.fnUntraced(function*(context: UserContext.UserContext) {
  const history = yield* NetworkRequest.history(context)
  assert.strictEqual(history.dropped, 0)
  return history.entries.map((request) => request.url).filter((url) => new URL(url).pathname !== "/favicon.ico")
})

upstream(import.meta.filename, {}, (test) => {
  test(
    "BrowserContext should close all belonging targets once closing context",
    { page: false },
    () =>
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assert.strictEqual((yield* browser.pages).length, 1)
        const scope = yield* Scope.make()
        const context = yield* Browser.newContext().pipe(Scope.provide(scope))
        yield* context.newPage.pipe(Scope.provide(scope))
        assert.strictEqual((yield* browser.pages).length, 2)
        assert.strictEqual((yield* context.pages).length, 1)
        // Closing the context closes its pages, and the browser keeps its own first tab
        yield* Scope.close(scope, Exit.void)
        assert.strictEqual((yield* browser.pages).length, 1)
      })
  )

  test("BrowserContext window.open should use parent tab context", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The popup is a page of the parent's context: it appears in that context's pages, not the browser's default
      const opened = yield* startWaiting(page.context.pages.waitFor((pages) => pages.length === 2))
      yield* page.evaluateInMainWorld((url) => {
        void window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const pages = yield* Fiber.join(opened.fiber)
      const popup = pages.find((each) => each.id !== page.id)
      assert.isDefined(popup)
      assert.strictEqual(popup!.context.id, page.context.id)
    }))

  test("BrowserContext should wait for a target", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      // The original's wait for a target at the empty page is the wait for this page's URL to be it. The page starts at
      // about:blank, so the wait hasn't resolved yet.
      const target = yield* startWaiting(page.url.waitFor((url) => url === server.EMPTY_PAGE))
      assert.isFalse(yield* target.done)
      yield* page.goto(server.EMPTY_PAGE)
      yield* Fiber.join(target.fiber)
      assert.strictEqual((yield* context.pages)[0]!.id, page.id)
    }))

  test(
    "BrowserContext should timeout waiting for a non-existent target",
    { page: false },
    () =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        // A new context has no page, so no target: the wait for one (`length > 0`) times out at once
        const error = yield* failureOf(
          context.pages.waitFor((pages) => pages.length > 0).pipe(Deadline.within("1 millis")),
          "the wait for a target"
        )
        assert(Deadline.isTimeout(error), String(error))
      })
  )

  test(
    "BrowserContext should isolate localStorage and cookies",
    { page: false },
    ({ server }) =>
      Effect.gen(function*() {
        // The browser's context count, which the original brackets this check with, is Strider's missing list of contexts
        // (matrix row method-browser-contexts), so the port drops it and keeps the isolation check.
        const context1 = yield* Browser.newContext()
        const context2 = yield* Browser.newContext()
        assert.strictEqual((yield* context1.pages).length, 0)
        assert.strictEqual((yield* context2.pages).length, 0)

        const page1 = yield* context1.newPage
        yield* page1.goto(server.EMPTY_PAGE)
        yield* page1.evaluateInMainWorld(() => {
          localStorage.setItem("name", "page1")
          document.cookie = "name=page1"
        })
        assert.strictEqual((yield* context1.pages).length, 1)
        assert.strictEqual((yield* context2.pages).length, 0)

        const page2 = yield* context2.newPage
        yield* page2.goto(server.EMPTY_PAGE)
        yield* page2.evaluateInMainWorld(() => {
          localStorage.setItem("name", "page2")
          document.cookie = "name=page2"
        })
        assert.strictEqual((yield* context1.pages)[0]!.id, page1.id)
        assert.strictEqual((yield* context2.pages)[0]!.id, page2.id)

        // Make sure pages don't share localstorage or cookies
        assert.strictEqual(yield* page1.evaluateInMainWorld(() => localStorage.getItem("name")), "page1")
        assert.strictEqual(yield* page1.evaluateInMainWorld(() => document.cookie), "name=page1")
        assert.strictEqual(yield* page2.evaluateInMainWorld(() => localStorage.getItem("name")), "page2")
        assert.strictEqual(yield* page2.evaluateInMainWorld(() => document.cookie), "name=page2")
      })
  )

  test("BrowserContext BrowserContext.overridePermissions should be prompt by default", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
    }))

  test("BrowserContext BrowserContext.overridePermissions should fail when bad permission is given", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const failure = yield* failureOf(
        page.context.grant(["foo"], { origin: server.EMPTY_PAGE }),
        "granting an unknown permission"
      )
      // Puppeteer's wording is "Unknown permission: foo". Strider's typed reason says the name is the caller's to fix, and
      // the hint names it.
      assert(failure instanceof Declaration.DeclarationError, String(failure))
      assert.strictEqual(failure.reason._tag, "InvalidInput")
      assert.include(failure.reason.hint, "foo")
    }))

  test("BrowserContext BrowserContext.overridePermissions should grant permission when listed", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.context.grant(["geolocation"], { origin: server.EMPTY_PAGE })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
    }))

  test("BrowserContext BrowserContext.overridePermissions should reset permissions", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The grant lasts for its scope: ending the scope is Puppeteer's `clearPermissionOverrides`
      const scope = yield* Scope.make()
      yield* page.context.grant(["geolocation"], { origin: server.EMPTY_PAGE }).pipe(Scope.provide(scope))
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
    }))

  test("BrowserContext BrowserContext.overridePermissions should grant persistent-storage", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      assert.notStrictEqual(yield* getPermission(page, "persistent-storage"), "granted")
      yield* page.context.grant(["persistent-storage"], { origin: server.EMPTY_PAGE })
      assert.strictEqual(yield* getPermission(page, "persistent-storage"), "granted")
    }))

  test("BrowserContext BrowserContext.on(\"console\") should only report console messages from its own pages", ({ page }) =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const other = yield* browser.newContext()
      const otherPage = yield* other.newPage
      yield* otherPage.evaluateInMainWorld(() => {
        console.log("from-other-context")
      })
      const logged = yield* ConsoleMessage.next(page.context, { text: /^from-own-context$/ })
      yield* page.evaluateInMainWorld(() => {
        console.log("from-own-context")
      })
      const message = yield* logged
      assert.strictEqual(message.origin._tag, "Page")
      assert.strictEqual(message.origin._tag === "Page" && message.origin.page, page.id)
      // The context's log holds only its own page's messages, since it was made
      const history = yield* ConsoleMessage.history(page.context)
      assert.strictEqual(history.dropped, 0)
      assert.deepStrictEqual(history.entries.map((each) => each.text), ["from-own-context"])
    }))

  test("BrowserContext BrowserContext.on(\"console\") should only report console messages from workers of its own pages", ({ page }) =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const other = yield* browser.newContext()
      const otherPage = yield* other.newPage
      const otherDone = yield* ConsoleMessage.next(other, { text: /^other-done$/ })
      yield* otherPage.evaluateInMainWorld(() => {
        void new Worker(`data:text/javascript,console.log('from-other-worker');console.log('other-done')`)
      })
      yield* otherDone

      const created = yield* BrowserWorker.next(page)
      const ownDone = yield* ConsoleMessage.next(page.context, { text: /^own-done$/ })
      yield* page.evaluateInMainWorld(() => {
        void new Worker(`data:text/javascript,console.log('from-own-worker');console.log('own-done')`)
      })
      const worker = yield* created
      yield* ownDone

      const history = yield* ConsoleMessage.history(page.context)
      assert.strictEqual(history.dropped, 0)
      assert.deepStrictEqual(history.entries.map((each) => each.text), ["from-own-worker", "own-done"])
      const [first] = history.entries
      assert.strictEqual(first!.origin._tag, "Worker")
      assert.strictEqual(first!.origin._tag === "Worker" && first!.origin.realm, worker.realm)
    }))

  test("BrowserContext BrowserContext.on(\"request\") should only report requests from its own pages", ({ page, server }) =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const other = yield* browser.newContext()
      const otherPage = yield* other.newPage
      yield* otherPage.goto(server.PREFIX + "/one-style.html")
      const requested = yield* NetworkRequest.next(page.context, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE)
      const request = yield* requested
      assert.strictEqual(request.initiator._tag === "Document" && request.initiator.navigable, page.id)
      // The other context's requests aren't in this context's log, so only the page's own request is
      assert.deepStrictEqual(yield* requestUrlsOf(page.context), [server.EMPTY_PAGE])
    }))
})
