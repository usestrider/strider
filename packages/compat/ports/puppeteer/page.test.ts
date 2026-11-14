/**
 * Puppeteer's `test/src/page.test.ts`, the first 84 tests (through "Page.setUserAgent should emulate device user-agent"):
 * a page's close and what it does to the waits on it, its load and DOMContentLoaded events, the event handlers added and
 * removed, popups, geolocation, offline emulation and `navigator.onLine`, and `waitForRequest` and `waitForResponse`.
 * Its tests 85 to 126 add the user agent's restore, `setContent` (and the content it writes, read back), and the `console`
 * warnings of a script run through `document.write`. Puppeteer's `setBypassCSP`, `addScriptTag`, `addStyleTag` and
 * `setUserAgent` with metadata are not ported (see the ledger). Its tests 127 to 168 add the page's URL and title, the
 * JavaScript emulation and its timers, `reload` and the cache, `pdf`, `select`, the close events, the context and the
 * tab, `bringToFront`, and `page.record`, and the ones Strider has no form for are in the ledger.
 *
 * What the port changes:
 * - Puppeteer's runner gives every test a fresh context (`getTestState`). Tests that make pages with `context.newPage()`
 *   make their own context in the test, and end it with the test's scope, instead of using the harness's page.
 * - Puppeteer's `goto`, `setContent`, and `click` wait for `load` or the click itself; Strider's `goto` waits for `commit`
 *   by default, so each `goto` here passes `waitUntil: "load"`. `setContent` already defaults to `load`.
 * - Puppeteer's `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. Its `$eval` does too.
 * - Puppeteer's `html` tag (`test/src/utils.ts`) is the harness's `html` function of the body.
 * - Puppeteer's `context.newPage({ type: "window" })`, its `windowBounds`, and `background` aren't options Strider has, so
 *   those tests aren't ported (see the ledger).
 * - `page.close({ runBeforeUnload: true })` is Strider's `page.close({ runBeforeUnload: true })`, with the same meaning.
 *   Puppeteer's beforeunload dialog is held by a handler until the test has checked it, then accepted: Strider's
 *   `Dialog.handle` holds the prompt the same way, and `Dialog.acceptAll` leaves a `BeforeUnload` prompt. Strider's
 *   `BeforeUnload` carries no message, so the port asserts that absence, where Puppeteer asserts Chrome's empty message
 *   and Firefox's non-empty one. Its kind and absent `defaultValue` are asserted as Puppeteer's type and default value are.
 * - A closed page fails its waits and actions with Strider's `TargetGone`, whose reason is `PageClosed`. Where Puppeteer
 *   checks an error's message ("Protocol error", "Target closed", not "Timeout"), the port checks that reason, and that the
 *   error isn't a `Deadline.Timeout`, which the reason already implies.
 * - Puppeteer's `page.waitForRequest` and `page.waitForResponse` are `NetworkRequest.next` and `NetworkResponse.next`,
 *   subscribed before the action that sends the requests and read after it, as their buffered wait allows. Strider's
 *   filter takes a URL, and a predicate is the wait's `where`, with the URL glob `**`. A URL filter is an exact URL here,
 *   as Puppeteer's string is. Puppeteer's timeout is `Deadline.within`, and its default timeout is `defaultTimeout`.
 *   Cancellation is interrupting the wait's fiber, as Strider's cancellation is.
 * - Puppeteer's `waitEvent(page, "dialog")` and the `page.on` listeners of the event tests are Strider's subscriptions:
 *   `NetworkRequest.stream` and `NetworkResponse.stream` in a scope, which `page.off` closes. Node's `off` removes the
 *   most recent registration of a listener, so the port's listeners are a stack, popped the same way.
 * - Puppeteer's `load` and `domcontentloaded` events are `PageNavigation.next` waits for the navigation's `load` and
 *   `domContentLoaded` states, subscribed before the `goto`.
 * - "Page.Events.error should throw when page crashes" waits for the page's `closed` reason, which is `PageCrashed`, and
 *   triggers the crash with the navigation Puppeteer's own test uses for each browser. The navigation isn't awaited, and
 *   its failure is ignored, as the original's `catch` does.
 * - Puppeteer's popup tests open their popups with `window.open` or a click. A script that opens a popup runs as a
 *   user gesture (`Page.withUserGesture`) because Strider keeps the browser's popup blocking, where Puppeteer's runner
 *   turns it off. A popup is read once it has committed its URL (`popup.url`), as Playwright's popup event implies.
 * - "Page.setGeolocation" tests use `page.emulate` for Puppeteer's page-level `setGeolocation`, and `page.context.grant`
 *   for its `overridePermissions`. `setGeolocation(null)` removes the emulation: its registration's scope ends.
 * - "Page.setOfflineMode" uses `page.emulate({ network: "offline" })` for the offline mode, held for a scope.
 * - Puppeteer's `pageerror` and `exception` events are Strider's one `UncaughtException`. Its structured stack frames are read
 *   from the stack text, its rendered text is the name and message, and its location is the first frame. The tests that
 *   need the event's remote handle, or the location of a syntax error, which has no stack, aren't ported (see the ledger).
 * - "Page.metrics" tests aren't ported: Strider has no page metrics (see the ledger).
 * - Puppeteer's "should work with no timeout" uses `timeout: 0`. Strider's wait has no deadline of its own, so it has the
 *   harness's 30-second budget for the test, as the Playwright port of the same test does.
 * - `page.setDefaultTimeout(1)` is `defaultTimeout("1 millis")`, which applies a default budget to one call.
 * - Puppeteer's fixture files come from its assets; the port's fixture server serves the vendored ones.
 * - Puppeteer's `setJavaScriptEnabled` is a scoped `emulate({ javaScript: "disabled" })`: the scope holds scripts disabled,
 *   and closing it enables them again. Puppeteer's `isJavaScriptEnabled()` reads its own flag, which Strider doesn't keep,
 *   so the port checks what the page does instead.
 * - Puppeteer's `page.select` is `locator.selectOption`. Strider's `selectOption` returns nothing, so the tests that check
 *   the values it returns are in the ledger. The ones that check the page's events and selections are ported as written.
 * - Puppeteer's `pdf({ path })` writes the file in the port, from the bytes `pdf` returns (the matrix's path row). Its
 *   `createPDFStream` and `waitForFonts` aren't options Strider has.
 * - Puppeteer's `page.record` is Strider's `Capability.Video`, acquired in a scope; the file is read after the scope closes.
 * - Puppeteer's `browserContext()` is checked by the context's id, for a page Strider makes in a context of the test's own.
 * - The waits the port makes itself are bounded by `bounded`, so a failure names what it waited for.
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  Capability,
  ConsoleMessage,
  Deadline,
  Declaration,
  Dialog,
  Locator,
  NetworkRequest,
  NetworkResponse,
  Page,
  PageNavigation,
  Popup,
  Reason,
  Target,
  UncaughtException
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { attachFrame, defaultTimeout, failureOf, frameCount, startWaiting } from "../harness/playwright.ts"
import { html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/**
 * Whether a frame of the tree, the main frame included, satisfies `where`: Puppeteer's `waitForFrame` predicate sees every
 * frame, not only the main frame's children.
 */
const someFrame = (tree: Page.FrameTree, where: (frame: Page.FrameTree) => boolean): boolean =>
  where(tree) || tree.children.some((child) => someFrame(child, where))

/**
 * The user agent Puppeteer's `KnownDevices["iPhone 6"]` carries. Strider has no device table, so the string is written out
 * here, as the Playwright port of `page.setUserAgent` does for its device list.
 */
const IPHONE_6_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"

/**
 * The frames of an uncaught exception's stack text: Puppeteer's structured call sites, read from Strider's text. A frame is
 * a line `at name (location)` or `at location`.
 */
const stackFrames = (exception: UncaughtException.UncaughtException) =>
  (Option.getOrUndefined(exception.stack) ?? "").split("\n").flatMap((line) => {
    const named = /^\s*at (.+?) \((.*)\)\s*$/.exec(line)
    if (named !== null) return [{ functionName: named[1] ?? "", location: named[2] ?? "" }]
    const bare = /^\s*at (.+?)\s*$/.exec(line)
    return bare === null ? [] : [{ functionName: "", location: bare[1] ?? "" }]
  })

/** Puppeteer's `isFavicon`: the browser's own favicon request, which the event tests ignore. */
const isFavicon = (url: string) => url.includes("favicon.ico")

/** A wait of the port's own, bounded so that a failure says what it waited for, instead of riding the test's budget. */
const bounded = (what: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeoutOrElse({
    duration: "10 seconds",
    orElse: () => Effect.die(new Error(`timed out waiting for ${what}`))
  }))

/**
 * Asserts a failed call's page closed by `by`: Strider's `TargetGone` with a `PageClosed` reason. A timeout is not one, so
 * a closed page is never mistaken for a wait that ran out of time.
 */
const closedFailure = (failure: unknown, by: "command" | "script" = "command") => {
  assert(Target.isTargetGone(failure), `the error isn't a closed target: ${String(failure)}`)
  assert(
    failure.reason._tag === "PageClosed" && failure.reason.by === by,
    `the page closed for another reason: ${failure.reason._tag}`
  )
}

/** Asserts a call's result is a failure because its page closed, as `closedFailure` does. */
const closedResult = (result: Result.Result<unknown, unknown>, by: "command" | "script" = "command") => {
  assert(Result.isFailure(result), "the call succeeded, where Puppeteer's rejects with its page closed")
  closedFailure(result.failure, by)
}

/** Waits until the popup has committed `url`, as Playwright's popup event means the popup has loaded it. */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => String(current) === url)

/** The position `navigator.geolocation` reports in the page's main world, as Puppeteer's `page.evaluate` reads it. */
const currentPosition = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    new Promise<{ latitude: number; longitude: number; accuracy: number }>((resolve) =>
      navigator.geolocation.getCurrentPosition((position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        })
      })
    )
  )

/** `navigator.onLine` in the page's main world. */
const onLine = (page: Page.Page) => page.evaluateInMainWorld(() => window.navigator.onLine)

/**
 * A `sinon.spy()`: counts calls. Strider's subscription delivers to a forked consumer, which may not have run when the
 * navigation that caused the event returns, so `reached(n)` waits, bounded, for the count to reach `n` before it's read.
 */
const spy = () => {
  const waiting: Array<[number, Deferred.Deferred<void>]> = []
  const self = {
    calls: 0,
    handler: () => {
      self.calls++
      for (const entry of waiting.slice()) {
        if (self.calls >= entry[0]) {
          waiting.splice(waiting.indexOf(entry), 1)
          Deferred.doneUnsafe(entry[1], Effect.void)
        }
      }
    },
    reached: (n: number) =>
      Effect.suspend(() => {
        if (self.calls >= n) return Effect.void
        const latch = Deferred.makeUnsafe<void>()
        waiting.push([n, latch])
        return Deferred.await(latch)
      }).pipe(bounded(`${n} calls`))
  }
  return self
}

/**
 * A `page.on("request", handler)` listener: a subscription that counts the page's requests, ignoring the favicon, until
 * its scope closes. Strider's subscription is set up when this returns, so the listener sees every request after it.
 */
const onRequests = Effect.fnUntraced(function*(page: Page.Page, handler: () => void) {
  const scope = yield* Scope.make()
  const requests = yield* NetworkRequest.stream(page).pipe(Scope.provide(scope))
  yield* requests.pipe(
    Stream.runForEach((request) =>
      Effect.sync(() => {
        if (!isFavicon(String(request.url))) handler()
      })
    ),
    Effect.forkIn(scope)
  )
  return scope
})

/** A `page.on("response", handler)` listener, as `onRequests` is for requests. */
const onResponses = Effect.fnUntraced(function*(page: Page.Page, handler: () => void) {
  const scope = yield* Scope.make()
  const responses = yield* NetworkResponse.stream(page).pipe(Scope.provide(scope))
  yield* responses.pipe(
    Stream.runForEach((response) =>
      Effect.sync(() => {
        if (!isFavicon(String(response.url))) handler()
      })
    ),
    Effect.forkIn(scope)
  )
  return scope
})

/** The globals `input/select.html` defines, which the select tests read and call in the main world. */
interface SelectPage {
  readonly result: Record<"onInput" | "onChange" | "onBubblingInput" | "onBubblingChange", unknown>
  makeMultiple(): void
}

/** Puppeteer's `input/select.html`, which the select tests run against. */
const selectPage = (page: Page.Page, server: { readonly PREFIX: string }) =>
  page.goto(server.PREFIX + "/input/select.html", { waitUntil: "load" })

/** What the select page recorded for one of its listeners (`page.evaluate` in Puppeteer), read in the main world. */
const recorded = (page: Page.Page, key: keyof SelectPage["result"]) =>
  page.evaluateInMainWorld((name) => (window as unknown as SelectPage).result[name], key)

/** The select page's `makeMultiple()`, which sets the `multiple` attribute on its `<select>`. */
const makeMultiple = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as SelectPage).makeMultiple())

/** The values of the options the page's `<select>` has selected, in document order, read in the main world. */
const selectedValues = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    Array.from((document.querySelector("select") as HTMLSelectElement).options)
      .filter((option) => option.selected)
      .map((option) => option.value)
  )

/** A page whose script would define `something`, which the JavaScript tests run with scripts disabled and then enabled. */
const FORBIDDEN_PAGE = `data:text/html, <script>var something = "forbidden"</script>`

/** The `setInterval` counter the JavaScript tests keep in the page, read in the main world. */
const intervalCounter = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (globalThis as unknown as { intervalCounter?: number }).intervalCounter)

/** The `setTimeout` counter the JavaScript tests keep in the page, read in the main world. */
const timeoutCounter = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (globalThis as unknown as { timeoutCounter?: number }).timeoutCounter)

/** `document.visibilityState` in the page's main world. */
const visibilityState = (page: Page.Page) => page.evaluateInMainWorld(() => document.visibilityState)

upstream(import.meta.filename, {}, (test) => {
  test(
    "Page Page.close should reject all promises when page is closed",
    { page: false },
    () =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        const [evaluation] = yield* Effect.all([
          Effect.result(newPage.evaluateInMainWorld(() => new Promise<void>(() => {}))),
          newPage.close()
        ], { concurrency: "unbounded" })
        // Puppeteer's rejection says "Protocol error (...): Target closed", from the page going away under the call. The
        // port asserts Strider's reason for it: the page closed by the command
        closedResult(evaluation)
      }))
  )

  test(
    "Page Page.close should not be visible in browser.pages",
    { page: false },
    () =>
      Effect.scoped(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        assert.isTrue((yield* browser.pages).some((tab) => tab.id === newPage.id))
        yield* newPage.close()
        assert.isFalse((yield* browser.pages).some((tab) => tab.id === newPage.id))
      }))
  )

  test(
    "Page Page.close should close child iframes",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        yield* newPage.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
        assert.strictEqual(yield* frameCount(newPage), 2)
        yield* newPage.close()
        assert.isFalse((yield* context.pages).some((tab) => tab.id === newPage.id))
      }))
  )

  test(
    "Page Page.close should run beforeunload if asked for",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        yield* newPage.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
        // The page has to be interacted with for its `beforeunload` handler to fire
        yield* newPage.locator("body").click()
        // The prompt is held by the handler until the test has checked it, then the handler leaves the page, as
        // Puppeteer's `dialog.accept()` does; `Dialog.acceptAll` is `leave` for a `BeforeUnload` prompt
        const seen = yield* Deferred.make<Dialog.Pending>()
        const decided = yield* Deferred.make<void>()
        yield* Dialog.handle(newPage, (dialog) =>
          Effect.andThen(
            Deferred.succeed(seen, dialog),
            Effect.andThen(Deferred.await(decided), Dialog.acceptAll(dialog))
          ))
        const closing = yield* Effect.forkChild(newPage.close({ runBeforeUnload: true }), { startImmediately: true })
        const dialog = yield* Deferred.await(seen).pipe(bounded("the beforeunload prompt"))
        assert.strictEqual(dialog._tag, "BeforeUnload")
        // `dialog.defaultValue()` is `""` in Puppeteer; a `BeforeUnload` prompt has no default value
        assert.notProperty(dialog, "defaultValue")
        // Puppeteer's `dialog.message()` is empty on Chrome and not on Firefox; Strider's `BeforeUnload` has no message
        assert.notProperty(dialog, "message")
        yield* Deferred.succeed(decided, undefined)
        yield* Fiber.join(closing).pipe(bounded("the page to close"))
        assert.isFalse((yield* context.pages).some((tab) => tab.id === newPage.id))
      }))
  )

  test(
    "Page Page.close should *not* run beforeunload by default",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        yield* newPage.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
        // The page has to be interacted with for its `beforeunload` handler to fire
        yield* newPage.locator("body").click()
        yield* newPage.close()
      }))
  )

  test("Page Page.close should set the page close state", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const newPage = yield* context.newPage
      assert.strictEqual((yield* newPage.status)._tag, "Open")
      yield* newPage.close()
      assert.strictEqual((yield* newPage.status)._tag, "Closed")
    })))

  test(
    "Page Page.close should terminate network waiters",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        // Each wait is subscribed before the close, as Puppeteer's `waitForRequest` and `waitForResponse` are called before it
        const request = yield* NetworkRequest.next(newPage, { url: server.EMPTY_PAGE })
        const response = yield* NetworkResponse.next(newPage, { url: server.EMPTY_PAGE })
        const [requestResult, responseResult] = yield* Effect.all([
          Effect.result(request),
          Effect.result(response),
          newPage.close()
        ], { concurrency: "unbounded" })
        closedResult(requestResult)
        closedResult(responseResult)
      }))
  )

  test("Page Page.Events.Load should fire when expected", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer waits for the `load` event of the navigation it starts; Strider's navigation wait ends at `load`
      const loaded = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* Effect.all([loaded, page.goto("about:blank", { waitUntil: "load" })], { concurrency: "unbounded" })
    }))

  test("Page removing and adding event handlers should correctly fire event handlers as they are added and then removed", ({ page, server }) =>
    Effect.gen(function*() {
      const handler = spy()
      // `page.on('response', onResponse)`, then `page.off`, then `page.on` again: each one ends or starts a subscription
      let listener = yield* onResponses(page, handler.handler)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* handler.reached(1)
      assert.strictEqual(handler.calls, 1)
      yield* Scope.close(listener, Exit.void)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Still one because the handler was removed
      assert.strictEqual(handler.calls, 1)
      listener = yield* onResponses(page, handler.handler)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Two now because the handler was added back
      yield* handler.reached(2)
      assert.strictEqual(handler.calls, 2)
      yield* Scope.close(listener, Exit.void)
    }))

  test("Page removing and adding event handlers should correctly added and removed request events", ({ page, server }) =>
    Effect.gen(function*() {
      const handler = spy()
      // Node's `off` removes the most recent registration of a listener, so the listeners are a stack, popped the same way
      const listeners: Array<Scope.Closeable> = []
      const on = Effect.fnUntraced(function*() {
        listeners.push(yield* onRequests(page, handler.handler))
      })
      const off = Effect.fnUntraced(function*() {
        const last = listeners.pop()
        if (last !== undefined) yield* Scope.close(last, Exit.void)
      })
      // The same handler is added twice, so each request counts twice
      yield* on()
      yield* on()
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* handler.reached(2)
      assert.strictEqual(handler.calls, 2)
      yield* off()
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Still one because one registration was removed
      yield* handler.reached(3)
      assert.strictEqual(handler.calls, 3)
      yield* off()
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(handler.calls, 3)
      yield* on()
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Two now because the handler was added back
      yield* handler.reached(4)
      assert.strictEqual(handler.calls, 4)
      yield* Effect.forEach(listeners.splice(0), (listener) => Scope.close(listener, Exit.void))
    }))

  test("Page Page.Events.error should throw when page crashes", ({ page, browserName }) =>
    Effect.gen(function*() {
      // Puppeteer crashes Chrome with `chrome://crash` and Firefox with `about:crashcontent`. The navigation isn't awaited,
      // and its failure is ignored, as the original's `catch` does
      const url = browserName === "firefox" ? "about:crashcontent" : "chrome://crash"
      const [reason] = yield* Effect.all([
        page.closed,
        page.goto(url, { waitUntil: "load" }).pipe(Effect.ignore)
      ], { concurrency: "unbounded" }).pipe(bounded("the page to crash"))
      // Puppeteer's `error` event says "Page crashed!"; Strider's close reason for a crash is `PageCrashed`
      assert.strictEqual(reason._tag, "PageCrashed")
    }))

  test("Page Page.Events.Popup should work", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      // `window.open` from a script is a user gesture only in Page.withUserGesture, under Strider's popup blocking
      yield* page.evaluateInMainWorld(() => {
        window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, "about:blank")
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!window.opener))
      assert.isTrue(yield* popup.evaluateInMainWorld(() => !!window.opener))
    }))

  test("Page Page.Events.Popup should work with noopener", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.open("about:blank", undefined, "noopener")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, "about:blank")
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!window.opener))
      assert.isFalse(yield* popup.evaluateInMainWorld(() => !!window.opener))
    }))

  test("Page Page.Events.Popup should work with clicking target=_blank and without rel=opener", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(html(`<a target="_blank" href="/one-style.html">yo</a>`))
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!window.opener))
      assert.isFalse(yield* popup.evaluateInMainWorld(() => !!window.opener))
    }))

  test("Page Page.Events.Popup should work with clicking target=_blank and with rel=opener", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(html(`<a target="_blank" rel="opener" href="/one-style.html">yo</a>`))
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!window.opener))
      assert.isTrue(yield* popup.evaluateInMainWorld(() => !!window.opener))
    }))

  test("Page Page.Events.Popup should work with fake-clicking target=_blank and rel=noopener", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(html(`<a target="_blank" rel="noopener" href="/one-style.html">yo</a>`))
      const opened = yield* Popup.next(page)
      // Puppeteer's `$eval` runs its script in the main world, where its runner's popup blocking is off; a script's click
      // opens the popup only as a user gesture under Strider's popup blocking
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("a") as HTMLAnchorElement).click()
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!window.opener))
      assert.isFalse(yield* popup.evaluateInMainWorld(() => !!window.opener))
    }))

  test("Page Page.Events.Popup should work with clicking target=_blank and rel=noopener", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(html(`<a target="_blank" rel="noopener" href="/one-style.html">yo</a>`))
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/one-style.html")
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!window.opener))
      assert.isFalse(yield* popup.evaluateInMainWorld(() => !!window.opener))
    }))

  test("Page Page.setGeolocation should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["geolocation"], { origin: server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.emulate({ geolocation: { longitude: 10, latitude: 10 } })
      assert.deepStrictEqual(yield* currentPosition(page), { latitude: 10, longitude: 10, accuracy: 0 })
    }))

  test("Page Page.setGeolocation should remove the override when called with null", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["geolocation"], { origin: server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `setGeolocation(position)` is an emulation that lasts while its registration does; `setGeolocation(null)` ends it
      const override = yield* Scope.make()
      yield* page.emulate({ geolocation: { longitude: 10, latitude: 10 } }).pipe(Scope.provide(override))
      yield* Scope.close(override, Exit.void)
      const geolocation = yield* page.evaluateInMainWorld(() =>
        new Promise<unknown>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            (position) => {
              resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude })
            },
            () => {
              resolve("no position")
            },
            { timeout: 1000 }
          )
        )
      )
      assert.notDeepEqual(geolocation, { latitude: 10, longitude: 10 })
    }))

  test("Page Page.setGeolocation should throw when invalid longitude", ({ page }) =>
    Effect.gen(function*() {
      const failure = yield* failureOf(
        page.emulate({ geolocation: { longitude: 200, latitude: 10 } }),
        "the emulation"
      )
      // Puppeteer validates the range itself: 'Invalid longitude "200"'. Strider passes the position to Chromium, which
      // refuses it as "Invalid geolocation" without naming the longitude, and the emulation reports a `DeclarationError`
      assert(Declaration.isDeclarationError(failure), String(failure))
      assert(failure.message.includes("longitude"), failure.message)
    }))

  test("Page Page.setOfflineMode should work", ({ page, server }) =>
    Effect.gen(function*() {
      const offline = yield* Scope.make()
      yield* page.emulate({ network: "offline" }).pipe(Scope.provide(offline))
      yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the navigation")
      yield* Scope.close(offline, Exit.void)
      const navigation = yield* page.reload({ waitUntil: "load" })
      assert(navigation._tag === "Committed", `the reload didn't commit a document: ${navigation._tag}`)
      assert.strictEqual(Option.getOrUndefined(Option.map(navigation.response, (response) => response.status)), 200)
    }))

  test("Page Page.setOfflineMode should emulate navigator.onLine", ({ page }) =>
    Effect.gen(function*() {
      assert.isTrue(yield* onLine(page))
      const offline = yield* Scope.make()
      yield* page.emulate({ network: "offline" }).pipe(Scope.provide(offline))
      assert.isFalse(yield* onLine(page))
      yield* Scope.close(offline, Exit.void)
      assert.isTrue(yield* onLine(page))
    }))

  test("Page Page.Events.DOMContentLoaded should fire when expected", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer waits for the `domcontentloaded` event of the navigation it starts; Strider's wait ends at that state
      const parsed = yield* PageNavigation.next(page, { waitUntil: "domContentLoaded" })
      yield* Effect.all([parsed, page.goto("about:blank")], { concurrency: "unbounded" })
    }))

  // Page.metrics ("should get metrics from a page" and "metrics event fired on console.timeStamp") isn't ported: Strider
  // has no page metrics, and the ledger says why.

  test("Page Page.waitForRequest should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* NetworkRequest.next(page, { url: server.PREFIX + "/digits/2.png" })
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForRequest should work with predicate", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Strider's URL filter is a glob, so the predicate does the matching against every request
      const request = yield* NetworkRequest.next(page, { url: "**" }, (request) =>
        Effect.succeed(request.url === server.PREFIX + "/digits/2.png"))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForRequest should work with async predicate", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* NetworkRequest.next(page, { url: "**" }, (request) =>
        Effect.promise(async () =>
          request.url === server.PREFIX + "/digits/2.png"
        ))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForRequest should respect timeout", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        NetworkRequest.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 millis")
        ),
        "the wait"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.waitForRequest should respect default timeout", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `page.setDefaultTimeout(1)` applies to a wait given no timeout of its own
      const error = yield* failureOf(
        defaultTimeout("1 millis")(
          NetworkRequest.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
            Effect.flatMap((wait) => wait)
          )
        ),
        "the wait"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.waitForRequest should work with no timeout", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `timeout: 0` waits without a limit of its own; the wait has the test's budget, which the test finishes well within
      const request = yield* NetworkRequest.next(page, { url: server.PREFIX + "/digits/2.png" })
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          void fetch("/digits/1.png")
          void fetch("/digits/2.png")
          void fetch("/digits/3.png")
        }, 50)
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForRequest should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The subscription is made here, and the wait is what gets cancelled, by interrupting its fiber, as the original's
      // `AbortController.abort()` cancels its wait
      const wait = yield* NetworkRequest.next(page, { url: server.PREFIX + "/abortme" })
      const fiber = yield* Effect.forkChild(wait, { startImmediately: true })
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the wait was interrupted, got ${String(exit)}`)
    }))

  test("Page Page.waitForResponse should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/digits/2.png" })
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForResponse should respect timeout", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        NetworkResponse.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 millis")
        ),
        "the wait"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.waitForResponse should respect default timeout", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        defaultTimeout("1 millis")(
          NetworkResponse.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
            Effect.flatMap((wait) => wait)
          )
        ),
        "the wait"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.waitForResponse should work with predicate", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: "**" }, (response) =>
        Effect.succeed(response.url === server.PREFIX + "/digits/2.png"))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForResponse should work with async predicate", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: "**" }, (response) =>
        Effect.promise(async () =>
          response.url === server.PREFIX + "/digits/2.png"
        ))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForResponse should work with no timeout", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `timeout: 0` waits without a limit of its own; the wait has the test's budget, which the test finishes well within
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/digits/2.png" })
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          void fetch("/digits/1.png")
          void fetch("/digits/2.png")
          void fetch("/digits/3.png")
        }, 50)
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))

  test("Page Page.waitForResponse should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The subscription is made here, and the wait is what gets cancelled, by interrupting its fiber, as the original's
      // `AbortController.abort()` cancels its wait
      const wait = yield* NetworkResponse.next(page, { url: server.PREFIX + "/abortme" })
      const fiber = yield* Effect.forkChild(wait, { startImmediately: true })
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the wait was interrupted, got ${String(exit)}`)
    }))

  test("Page Page.waitForFrame should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The wait is listening before the frame is attached, as Puppeteer's `Promise.all` has it
      const waited = yield* Effect.forkChild(
        page.frames.waitFor((tree) => someFrame(tree, (frame) => String(frame.url).endsWith("/title.html"))),
        { startImmediately: true }
      )
      yield* attachFrame(page, "frame2", server.PREFIX + "/title.html")
      const tree = yield* bounded("a frame at /title.html")(Fiber.join(waited))
      // Puppeteer's `parentFrame()` is the main frame: the frame is a child of the tree's root, which is the main frame
      assert.isTrue(tree.children.some((child) => String(child.url) === server.PREFIX + "/title.html"))
    }))

  test("Page Page.waitForFrame should work with a URL predicate", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const waited = yield* Effect.forkChild(
        page.frames.waitFor((tree) => someFrame(tree, (frame) => String(frame.url) === server.PREFIX + "/title.html")),
        { startImmediately: true }
      )
      yield* attachFrame(page, "frame2", server.PREFIX + "/title.html")
      const tree = yield* bounded("a frame at /title.html")(Fiber.join(waited))
      assert.isTrue(tree.children.some((child) => String(child.url) === server.PREFIX + "/title.html"))
    }))

  test("Page Page.waitForFrame should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const wait = page.frames.waitFor((tree) => someFrame(tree, (frame) => String(frame.url).endsWith("/title.html")))
      const fiber = yield* Effect.forkChild(wait, { startImmediately: true })
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the wait was interrupted, got ${String(exit)}`)
    }))

  test("Page Page.Events.PageError should fire", ({ page, server }) =>
    Effect.gen(function*() {
      // The subscription is made before the navigation, as Puppeteer's `waitEvent` is
      const thrown = yield* UncaughtException.next(page, { message: "Fancy" })
      yield* page.goto(server.PREFIX + "/error.html", { waitUntil: "load" })
      const error = yield* bounded("the uncaught Fancy error")(thrown)
      assert.include(error.message, "Fancy")
      // The stack's last line is the outermost frame, which is the script's own location
      const stack = Option.getOrUndefined(error.stack) ?? ""
      assert.include(stack.split("\n").at(-1) ?? "", "error.html:3:1")
    }))

  test("Page Page.Events.PageError should fire for all value types", ({ page, server }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      // The page throws `undefined`. Puppeteer's `pageerror` hands over that value, undefined. Strider reports the typed
      // exception, whose message is the thrown value's text: a thrown `undefined` has none, so the message is empty and
      // there is no stack. A thrown empty string would read the same, which is as far as the exception tells them apart.
      yield* page.goto(server.PREFIX + "/error-primitive.html", { waitUntil: "load" })
      const error = yield* bounded("the uncaught primitive error")(thrown)
      assert.strictEqual(error.kind, "thrown")
      assert.strictEqual(error.message, "")
      assert.isTrue(Option.isNone(error.stack), "a thrown primitive has no stack")
    }))

  test("Page Page.Events.Exception should fire", ({ page, server }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.goto(server.PREFIX + "/error.html", { waitUntil: "load" })
      const exception = yield* bounded("the uncaught Fancy error")(thrown)
      assert.include(exception.message, "Fancy error!")
      assert.strictEqual(exception.name, "Error")
      // Puppeteer's structured frames are the lines of Strider's stack text
      const frames = stackFrames(exception)
      assert.deepStrictEqual(frames.slice(0, 3).map((frame) => frame.functionName), ["c", "b", "a"])
      // The location is the first frame; Puppeteer's line number is 0-based, so line 13 there is line 14 here
      assert.include(frames[0]?.location ?? "", "error.html:14:")
    }))

  test("Page Page.Events.Exception should fire together with pageerror", ({ page, server }) =>
    Effect.gen(function*() {
      // Strider has one event for what Puppeteer reports twice, as `pageerror` and `exception`. The page's and its
      // context's subscriptions both get it, as both are the feeds an uncaught error is reported to.
      const onPage = yield* UncaughtException.next(page)
      const onContext = yield* UncaughtException.next(page.context)
      yield* page.goto(server.PREFIX + "/error.html", { waitUntil: "load" })
      const error = yield* bounded("the page's uncaught error")(onPage)
      const exception = yield* bounded("the context's uncaught error")(onContext)
      assert.include(error.message, "Fancy error!")
      assert.include(exception.message, "Fancy error!")
    }))

  test("Page Page.Events.Exception should fire for primitive values", ({ page, server }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.goto(server.PREFIX + "/error-primitive.html", { waitUntil: "load" })
      const exception = yield* bounded("the uncaught primitive")(thrown)
      // Puppeteer's name is '' on CDP and its handle undefined. Strider's exception has no handle; a thrown primitive reads
      // as an `Error` with no stack, whose message is the value's text.
      assert.strictEqual(exception.name, "Error")
      assert.isTrue(Option.isNone(exception.stack), "a thrown primitive has no stack")
    }))

  test("Page Page.Events.Exception should report the name and text as rendered by the browser", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `text` is the name and message as the browser renders them: `Name: message`, or just the name when
      // there is no message, and the browser's own rendering for a value that isn't an `Error`. Strider's exception has the
      // name and the message separately, so the rendered text is read from the two.
      const cases = [
        {
          code: `const error = new Error('x'); error.name = 'AbortError'; throw error;`,
          name: "AbortError",
          text: "AbortError: x"
        },
        { code: `throw new DOMException('bad', 'AbortError');`, name: "AbortError", text: "AbortError: bad" },
        {
          code: `class ValidationError extends Error {} throw new ValidationError('v');`,
          name: "ValidationError",
          text: "ValidationError: v"
        },
        { code: `throw new Error();`, name: "Error", text: "Error" },
        { code: `throw new Error('line1\\nline2');`, name: "Error", text: "Error: line1\nline2" },
        { code: `throw {code: 1};`, name: "", text: "Object" },
        { code: `throw Symbol('s');`, name: "", text: "Symbol(s)" }
      ]
      for (const { code, name, text } of cases) {
        const thrown = yield* UncaughtException.next(page)
        yield* page.setContent(html(`<script>\n${code};\n</script>`))
        const exception = yield* bounded(`the uncaught error of ${code}`)(thrown)
        // A value that isn't an `Error` has no name in Puppeteer; Strider's name is then the class's, or `Error`
        const rendered = name === "" ? exception.message : exception.message === ""
          ? exception.name
          : `${exception.name}: ${exception.message}`
        assert.deepStrictEqual({ name: name === "" ? "" : exception.name, text: rendered }, { name, text }, code)
      }
    }))

  test("Page Page.setUserAgent should work", ({ page, server }) =>
    Effect.gen(function*() {
      assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "Mozilla")
      yield* page.emulate({ userAgent: "foobar" })
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* bounded("the request for /empty.html")(request)
      assert.strictEqual(received.headers["user-agent"], "foobar")
    }))

  test("Page Page.setUserAgent should work with options parameter", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `setUserAgent({ userAgent })` is the same emulation as its string form, so the port is the same as the one above
      assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "Mozilla")
      yield* page.emulate({ userAgent: "foobar" })
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* bounded("the request for /empty.html")(request)
      assert.strictEqual(received.headers["user-agent"], "foobar")
    }))

  test("Page Page.setUserAgent should work for subframes", ({ page, server }) =>
    Effect.gen(function*() {
      assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "Mozilla")
      yield* page.emulate({ userAgent: "foobar" })
      const request = yield* server.waitForRequest("/empty.html")
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const received = yield* bounded("the subframe's request for /empty.html")(request)
      assert.strictEqual(received.headers["user-agent"], "foobar")
    }))

  test("Page Page.setUserAgent should emulate device user-agent", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.notInclude(yield* page.evaluateInMainWorld(() => navigator.userAgent), "iPhone")
      yield* page.emulate({ userAgent: IPHONE_6_USER_AGENT })
      assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "iPhone")
    }))

  test("Page Page.setUserAgent should restore original", ({ page, server }) =>
    Effect.gen(function*() {
      const userAgent = yield* page.evaluateInMainWorld(() => navigator.userAgent)
      // `setUserAgent("foobar")` is an emulation held in a scope, and `setUserAgent("")` puts the original back: closing the
      // scope is that removal
      const override = yield* Scope.make()
      yield* page.emulate({ userAgent: "foobar" }).pipe(Scope.provide(override))
      const withOverride = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requestWithOverride = yield* bounded("the request with the override")(withOverride)
      assert.strictEqual(requestWithOverride.headers["user-agent"], "foobar")
      yield* Scope.close(override, Exit.void)
      const restored = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* bounded("the request after the override")(restored)
      assert.strictEqual(request.headers["user-agent"], userAgent)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.userAgent), userAgent)
    }))

  test("Page Page.setContent should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>")
      // Puppeteer's `content()` is the document's serialized HTML, which Strider's `readHtml` gives
      assert.strictEqual(yield* page.readHtml, "<html><head></head><body><div>hello</div></body></html>")
    }))

  test("Page Page.setContent should work with doctype", ({ page }) =>
    Effect.gen(function*() {
      const doctype = "<!DOCTYPE html>"
      yield* page.setContent(`${doctype}<div>hello</div>`)
      assert.strictEqual(
        yield* page.readHtml,
        `${doctype}<html><head></head><body><div>hello</div></body></html>`
      )
    }))

  test("Page Page.setContent should work with HTML 4 doctype", ({ page }) =>
    Effect.gen(function*() {
      const doctype = "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\" \"http://www.w3.org/TR/html4/strict.dtd\">"
      yield* page.setContent(`${doctype}<div>hello</div>`)
      assert.strictEqual(
        yield* page.readHtml,
        `${doctype}<html><head></head><body><div>hello</div></body></html>`
      )
    }))

  test("Page Page.setContent should respect timeout", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      // stall for image: the request is never answered, so the content waits for the image's load until the deadline
      server.setRoute(imgPath, () => {})
      const error = yield* failureOf(
        page.setContent(html(`<img src="${server.PREFIX + imgPath}"></img>`)).pipe(Deadline.within("1 millis")),
        "the setContent"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.setContent should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      // stall for image
      server.setRoute(imgPath, () => {})
      const request = yield* server.waitForRequest(imgPath)
      const content = yield* Effect.forkChild(
        page.setContent(html(`<img src="${server.PREFIX + imgPath}"></img>`)),
        { startImmediately: true }
      )
      yield* bounded(`a request for ${imgPath}`)(request)
      // Puppeteer's `AbortController.abort()` cancels the call; Strider's cancellation is interrupting its fiber
      yield* Fiber.interrupt(content)
      const exit = yield* Fiber.await(content)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the call was interrupted, got ${String(exit)}`)
    }))

  test("Page Page.setContent should respect default navigation timeout", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      // stall for image
      server.setRoute(imgPath, () => {})
      const error = yield* failureOf(
        defaultTimeout("1 millis")(page.setContent(html(`<img src="${server.PREFIX + imgPath}"></img>`))),
        "the setContent"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.setContent should await resources to load", ({ page, server }) =>
    Effect.gen(function*() {
      const imgPath = "/img.png"
      // The image's response is held by the route, and the test ends it once it has checked the content hasn't loaded
      let imgResponse = undefined as { end(): void } | undefined
      server.setRoute(imgPath, (_req, res) => {
        imgResponse = res
      })
      const request = yield* server.waitForRequest(imgPath)
      const content = yield* startWaiting(page.setContent(html(`<img src="${server.PREFIX + imgPath}"></img>`)))
      yield* bounded(`a request for ${imgPath}`)(request)
      assert.isFalse(yield* content.done)
      if (imgResponse === undefined) return yield* Effect.die(new Error("the route didn't answer the image's request"))
      imgResponse.end()
      yield* bounded("the content to load")(Fiber.join(content.fiber))
    }))

  test("Page Page.setContent should work fast enough", ({ page }) =>
    Effect.gen(function*() {
      for (let i = 0; i < 20; ++i) {
        yield* page.setContent(html(`<div>yo</div>`))
      }
    }))

  test("Page Page.setContent should work with tricky content", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `$eval` reads `textContent`; the locator's read is the same text, whitespace collapsed, which is all
      // there is to this content
      yield* page.setContent(html("<div>hello world</div>\x7F"))
      assert.strictEqual(yield* page.locator("div").readText, "hello world")
    }))

  test("Page Page.setContent should work with accents", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html("<div>aberración</div>"))
      assert.strictEqual(yield* page.locator("div").readText, "aberración")
    }))

  test("Page Page.setContent should work with emojis", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html("<div>🐥</div>"))
      assert.strictEqual(yield* page.locator("div").readText, "🐥")
    }))

  test("Page Page.setContent should work with newline", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>\n</div>")
      // A newline is whitespace, which the locator's read collapses, so `textContent` is read in the main world, as
      // Puppeteer's `$eval` reads it
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("div")?.textContent), "\n")
    }))

  test("Page Page.setContent should work with comments outside HTML tag", ({ page }) =>
    Effect.gen(function*() {
      const comment = "<!-- Comment -->"
      yield* page.setContent(`${comment}<div>hello</div>`)
      assert.strictEqual(yield* page.readHtml, `${comment}<html><head></head><body><div>hello</div></body></html>`)
    }))

  test("Page Page.setContent should not run a cross-origin script through document.write", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Puppeteer's `console` listener for warnings, a subscription held in a scope until the test has checked it
      const warnings: Array<string> = []
      const listening = yield* Scope.make()
      const messages = yield* ConsoleMessage.stream(page, { level: "warning" }).pipe(Scope.provide(listening))
      yield* messages.pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            warnings.push(message.text)
          })
        ),
        Effect.forkIn(listening)
      )
      yield* page.setContent(html(`<script src="${server.CROSS_PROCESS_PREFIX + "/injectedfile.js"}"></script>`), {
        waitUntil: "load"
      })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (globalThis as unknown as { __injected?: number }).__injected),
        42
      )
      assert.deepStrictEqual(warnings.filter((warning) => warning.includes("document.write")), [])
      yield* Scope.close(listening, Exit.void)
    }))

  test("Page Page.url should work", ({ page, server }) =>
    Effect.gen(function*() {
      assert.strictEqual(String(yield* page.url), "about:blank")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(String(yield* page.url), server.EMPTY_PAGE)
    }))

  test("Page Page.setJavaScriptEnabled should work", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `setJavaScriptEnabled(false)` is a scoped emulation here: the scope holds scripts disabled, and closing
      // it enables them again. Puppeteer's `isJavaScriptEnabled()` reads its own flag, so the port checks the page instead
      const disabled = yield* Scope.make()
      yield* page.emulate({ javaScript: "disabled" }).pipe(Scope.provide(disabled))
      yield* page.goto(FORBIDDEN_PAGE, { waitUntil: "load" })
      // The script that defines `something` never ran, so evaluating the name fails, as Puppeteer's evaluation of the string
      // `'something'` does. The name is evaluated as the string is, which is what `eval` does here
      // oxlint-disable-next-line no-eval -- Puppeteer evaluates the expression `something` as a string, and the test needs its ReferenceError
      const failure = yield* failureOf(page.evaluateInMainWorld(() => eval("something")), "the evaluation")
      assert.instanceOf(failure, Page.PageError)
      assert.instanceOf(failure.reason, Reason.EvaluationThrown)
      assert.include(failure.reason.exception.message, "something is not defined")
      yield* Scope.close(disabled, Exit.void)
      yield* page.goto(FORBIDDEN_PAGE, { waitUntil: "load" })
      // oxlint-disable-next-line no-eval -- as above, with the script having run
      assert.strictEqual(yield* page.evaluateInMainWorld(() => eval("something")), "forbidden")
    }))

  test("Page Page.setJavaScriptEnabled setInterval should pause", ({ page }) =>
    Effect.gen(function*() {
      // Set up an interval that increments a counter every 0ms, which queues tasks as fast as possible
      yield* page.evaluateInMainWorld(() =>
        setInterval(() => {
          const counters = globalThis as unknown as { intervalCounter?: number }
          counters.intervalCounter = (counters.intervalCounter ?? 0) + 1
        }, 0)
      )
      // Disable JavaScript execution on the page. This should pause timers.
      const disabled = yield* Scope.make()
      yield* page.emulate({ javaScript: "disabled" }).pipe(Scope.provide(disabled))
      const counter = yield* intervalCounter(page)
      // Puppeteer's 100 ms wait in Node: the page's event loop would have run the interval during it, if it weren't paused
      yield* Effect.sleep("100 millis")
      assert.strictEqual(yield* intervalCounter(page), counter)
      yield* Scope.close(disabled, Exit.void)
      // Puppeteer's wait for another task in the page, long enough for the interval to resume if it can
      yield* page.evaluateInMainWorld(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))
      assert.isAbove((yield* intervalCounter(page)) ?? 0, counter ?? 0, "the interval resumed")
    }))

  test("Page Page.setJavaScriptEnabled setTimeout should stop", ({ page }) =>
    Effect.gen(function*() {
      // Set up a recursive setTimeout chain, which increments a counter and schedules itself again
      yield* page.evaluateInMainWorld(() => {
        const counters = globalThis as unknown as { timeoutCounter?: number }
        const task = () => {
          counters.timeoutCounter = (counters.timeoutCounter ?? 0) + 1
          setTimeout(task, 0)
        }
        task()
      })
      // Disable JavaScript, which should pause the timeout chain
      const disabled = yield* Scope.make()
      yield* page.emulate({ javaScript: "disabled" }).pipe(Scope.provide(disabled))
      const counter = yield* timeoutCounter(page)
      yield* Effect.sleep("100 millis")
      assert.strictEqual(yield* timeoutCounter(page), counter)
      // Re-enable JavaScript. The chain doesn't resume upon re-enabling, so the counter stays where it was
      yield* Scope.close(disabled, Exit.void)
      yield* page.evaluateInMainWorld(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))
      assert.strictEqual(yield* timeoutCounter(page), counter)
    }))

  test("Page Page.setJavaScriptEnabled then should not pause", ({ page }) =>
    Effect.gen(function*() {
      // Disable JavaScript execution on the page
      const disabled = yield* Scope.make()
      yield* page.emulate({ javaScript: "disabled" }).pipe(Scope.provide(disabled))
      // Microtasks continue to work even when page scripts are disabled
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Promise.resolve().then(() => 42)), 42)
      yield* Scope.close(disabled, Exit.void)
    }))

  test("Page Page.reload should enable or disable the cache based on reload params", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/cached/one-style.html", { waitUntil: "load" })
      // Each request is subscribed before the reload that sends it, as Puppeteer's `Promise.all` has it
      const cached = yield* server.waitForRequest("/cached/one-style.html")
      yield* page.reload({ waitUntil: "load" })
      // Rely on "if-modified-since" caching in our test server.
      const cachedRequest = yield* bounded("the reload's request")(cached)
      assert.notStrictEqual(cachedRequest.headers["if-modified-since"], undefined)
      const nonCached = yield* server.waitForRequest("/cached/one-style.html")
      yield* page.reload({ bypassCache: true, waitUntil: "load" })
      const nonCachedRequest = yield* bounded("the bypassing reload's request")(nonCached)
      assert.strictEqual(nonCachedRequest.headers["if-modified-since"], undefined)
    }))

  test("Page Page.pdf can print to PDF and save to file", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/pdf.html", { waitUntil: "load" })
      // Strider's `pdf` returns the bytes, and the file is written here, as Puppeteer's `path` option writes it
      const bytes = yield* page.pdf()
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pptr-pdf-"))
      try {
        const file = path.join(directory, "output.pdf")
        fs.writeFileSync(file, bytes)
        assert.isAbove(fs.readFileSync(file).byteLength, 0)
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }))

  test("Page Page.pdf should accept page ranges without spaces", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        html(`
        <div style="break-after: page">1</div>
        <div style="break-after: page">2</div>
        <div>3</div>
      `)
      )
      const pdf = yield* page.pdf({ pageRanges: "1-2,3" })
      assert.isAbove(pdf.byteLength, 0)
    }))

  test("Page Page.pdf should respect timeout", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/pdf.html", { waitUntil: "load" })
      // Puppeteer's `pdf({ timeout: 1 })` rejects with a TimeoutError; Strider's deadline is the call's own
      const error = yield* failureOf(page.pdf().pipe(Deadline.within("1 millis")), "the pdf")
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Page Page.title should return the page title", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/title.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Woof-Woof")
    }))

  test("Page Page.select should select single option", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      // Puppeteer's `page.select(selector, value)` is `locator.selectOption` with a value
      yield* page.locator("select").selectOption({ value: "blue" })
      assert.deepStrictEqual(yield* recorded(page, "onInput"), ["blue"])
      assert.deepStrictEqual(yield* recorded(page, "onChange"), ["blue"])
    }))

  test("Page Page.select should select only first option", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      // Puppeteer chooses only the first of these on a select without `multiple`; Strider's apply selects every listed option
      // (see the Playwright port of SO-010), so this is ported as written and fails on that
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "green" }, { value: "red" }])
      assert.deepStrictEqual(yield* recorded(page, "onInput"), ["blue"])
      assert.deepStrictEqual(yield* recorded(page, "onChange"), ["blue"])
    }))

  test("Page Page.select should not throw when select causes navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      // The select's input listener navigates the page, as Puppeteer's `$eval` adds it in the main world
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("select")?.addEventListener("input", () => {
          window.location.href = "/empty.html"
        })
      })
      // The navigation's wait is subscribed before the selection, which it follows, as Puppeteer's `waitForNavigation` is
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* Effect.all([
        page.locator("select").selectOption({ value: "blue" }),
        bounded("the navigation the selection causes")(navigated)
      ], { concurrency: "unbounded" })
      assert.include(String(yield* page.url), "empty.html")
    }))

  test("Page Page.select should select multiple options", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      yield* makeMultiple(page)
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "green" }, { value: "red" }])
      assert.deepStrictEqual(yield* recorded(page, "onInput"), ["blue", "green", "red"])
      assert.deepStrictEqual(yield* recorded(page, "onChange"), ["blue", "green", "red"])
    }))

  test("Page Page.select should respect event bubbling", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      yield* page.locator("select").selectOption({ value: "blue" })
      assert.deepStrictEqual(yield* recorded(page, "onBubblingInput"), ["blue"])
      assert.deepStrictEqual(yield* recorded(page, "onBubblingChange"), ["blue"])
    }))

  test("Page Page.select should throw when element is not a <select>", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      const error = yield* failureOf(page.locator("body").selectOption({ value: "" }), "the selection")
      // Puppeteer's message says "Element is not a <select> element."; Strider's typed `WrongElement` names the same expectation
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason._tag === "WrongElement", error.reason._tag)
      assert.strictEqual(error.reason.expected, "a <select>")
    }))

  test("Page Page.select should deselect all options when passed no values for a multiple select", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      yield* makeMultiple(page)
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "black" }, { value: "magenta" }])
      // Puppeteer's `page.select('select')` with no values deselects every option
      yield* page.locator("select").selectOption([])
      assert.deepStrictEqual(yield* selectedValues(page), [])
    }))

  test(
    "Page Page.select should deselect all options when passed no values for a select without multiple",
    ({ page, server }) =>
      Effect.gen(function*() {
        yield* selectPage(page, server)
        yield* page.locator("select").selectOption([{ value: "blue" }, { value: "black" }, { value: "magenta" }])
        yield* page.locator("select").selectOption([])
        // Puppeteer's first selected option is the empty one, as the browser picks it again
        assert.strictEqual((yield* selectedValues(page))[0], "")
      })
  )

  test("Page Page.select should work when re-defining top-level Event class", ({ page, server }) =>
    Effect.gen(function*() {
      yield* selectPage(page, server)
      // Puppeteer's `window.Event = undefined` (issue 3327), in the main world where the page's own globals are
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { Event: unknown }).Event = undefined
      })
      yield* page.locator("select").selectOption({ value: "blue" })
      assert.deepStrictEqual(yield* recorded(page, "onInput"), ["blue"])
      assert.deepStrictEqual(yield* recorded(page, "onChange"), ["blue"])
    }))

  test("Page Page.Events.Close should work with window.close", ({ page }) =>
    Effect.gen(function*() {
      const opened = yield* Popup.next(page)
      // `window.open` from a script is a user gesture only in Page.withUserGesture, under Strider's popup blocking
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { newPage: Window | null }).newPage = window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const newPage = yield* bounded("the popup")(opened)
      // The close is subscribed before the script closes the popup, as Puppeteer's `waitEvent` is
      const closed = yield* Effect.forkChild(newPage.closed, { startImmediately: true })
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { newPage: Window }).newPage.close()
      })
      yield* bounded("the popup to close")(Fiber.join(closed))
    }))

  test(
    "Page Page.Events.Close should work with page.close",
    { page: false },
    () =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        const closed = yield* Effect.forkChild(newPage.closed, { startImmediately: true })
        yield* newPage.close()
        yield* bounded("the page to close")(Fiber.join(closed))
      }))
  )

  test(
    "Page Page.browserContext should return the correct browser context instance",
    { page: false },
    () =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const newPage = yield* context.newPage
        // Puppeteer's `page.browserContext()` is the context the page was made in, which Strider's page names by its id
        assert.strictEqual(newPage.context.id, context.id)
      }))
  )

  test("Page Page.bringToFront should work", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page1 = yield* context.newPage
      const page2 = yield* context.newPage
      // Strider's `activate` is Puppeteer's `bringToFront`, which sends the same `Page.bringToFront`. Puppeteer's pages are tabs
      // of one window, so bringing one forward hides the other; Strider's default `focus: "system"` opens each page in a window
      // of its own (`newWindow`), where both stay visible, and `focus: "emulated"` makes every page visible too
      yield* page1.activate
      assert.strictEqual(yield* visibilityState(page1), "visible")
      assert.strictEqual(yield* visibilityState(page2), "hidden")
      yield* page2.activate
      assert.strictEqual(yield* visibilityState(page1), "hidden")
      assert.strictEqual(yield* visibilityState(page2), "visible")
    })))

  test("Page Page.record should record page", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `page.record` writes a video of the page while its recording lasts, which Strider's `Video` capability
      // does: the recording lasts with its scope, and its file is read once the scope has closed
      const recording = yield* Effect.scoped(Effect.gen(function*() {
        const video = yield* page.capability(Capability.Video)
        yield* page.goto("data:text/html,<input>", { waitUntil: "load" })
        // Puppeteer's `input.type('ab', { delay: 100 })`
        yield* page.locator("input").pressSequentially("ab", { delay: "100 millis" })
        return video
      }))
      const file = yield* bounded("the recording's file")(recording.file)
      assert.isAbove(fs.statSync(String(file)).size, 0)
    }))
})
