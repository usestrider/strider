/**
 * Puppeteer's `test/src/browser.test.ts`: the browser's version and user agent, its connection and process, its screens
 * and windows, and the console, request, and network events its pages report.
 *
 * What the port changes:
 * - `browser.version()` is `browser.info.version`, and `browser.userAgent()` is the browser's own `navigator.userAgent`,
 *   read in a page: `Browser` has `info` (product, version, protocol, revision) and no user agent. Puppeteer's name and
 *   engine checks name Chrome, Firefox, or Gecko, and Puppeteer has no WebKit product, so those tests run on Chromium and
 *   Firefox only (`browsers`), and the ledger says why for stock WebKit.
 * - "should keep connected after the last page is closed" launches its own browser, as browsertype-launch.test.ts does,
 *   and closes its first tab through `control`. Puppeteer's `browser.connected` has no counterpart: `Browser` has no
 *   connected flag (matrix row method-browser-isconnected), so the port checks what the original's second half checks, a
 *   new page opening and evaluating in the same browser.
 * - Puppeteer's browser-level event listeners (`browser.on('console' | 'request' | 'response')`) have no Strider
 *   counterpart: events belong to a page or a context. Where the test's point is that a page's messages and requests reach
 *   a listener wider than the page, attributed to that page (or to a worker with no page), the port listens at the
 *   context, the widest scope Strider has, and the browser-level leg is dropped, named in each test's comment. Where the
 *   point is the browser listener itself (replay to a later connection, the order of two emitters, the same events from
 *   two levels), the test isn't ported and the ledger says why.
 * - Puppeteer's `page.evaluate` runs in the main world, so the port reads `page.evaluateInMainWorld`.
 * - "should report console messages from dedicated workers" keeps its page-level and context-level legs (each sees the
 *   message once, from the worker); its browser-level leg is dropped, which leaves the original's point that each level
 *   delivers a worker's message once, for the two levels Strider has.
 * - "should report console messages from service workers" subscribes at the context, which holds the service worker, where
 *   the original subscribes at the browser; the message and its worker origin are the same.
 * - `isInterceptResolutionHandled()` is Puppeteer's bookkeeping of its own request interception, not a browser behavior, so
 *   "should not interfere with request interception" checks the response and the request count without it.
 * - "should report requests from dedicated workers" reads the worker's request from the context's subscription, where it
 *   arrives with the worker as its initiator and no page.
 * - Puppeteer's `waitEvent` on `requestfailed` is `NetworkRequest.next` for the request, then `NetworkRequest.failure`,
 *   polled as a condition with `Expect.that`, since the failure is recorded after the request is seen.
 * - The screen, window-bounds, browser-target, and process tests aren't ported, and neither are the tests that need
 *   Puppeteer's request, response, and finished events on the browser or the request-finished event on a page; the ledger
 *   says why each is.
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  BrowserWorker,
  Condition,
  ConsoleMessage,
  Deadline,
  Expect,
  NetworkRequest,
  NetworkResponse,
  Page,
  PageNavigation,
  Route
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import { backend } from "../harness/browsers.ts"
import { upstream } from "../harness/upstream.ts"

/** The page's own user agent: the browser's, since nothing in these tests emulates one. */
const userAgentOf = (page: Page.Page) => page.evaluateInMainWorld(() => navigator.userAgent)

/** The request was started by the page's main document, so the page is its page and the main frame its frame. */
const isPageRequest = (request: NetworkRequest.NetworkRequest, page: Page.Page) =>
  request.initiator._tag === "Document" && request.initiator.navigable === page.id

/** The request was started by the worker's realm: Puppeteer's `request.worker()`, which names no page or frame. */
const isWorkerRequest = (request: NetworkRequest.NetworkRequest, worker: BrowserWorker.BrowserWorker) =>
  request.initiator._tag === "Worker" && request.initiator.realm === worker.realm

/** The status a navigation's response carried, when it had one. */
const statusOf = (navigation: PageNavigation.PageNavigation): Option.Option<number> => {
  const response = navigation._tag === "Committed" || navigation._tag === "NoContent"
    ? navigation.response
    : Option.none<NetworkResponse.NetworkResponse>()
  return Option.map(response, (each) => each.status)
}

/** Starts a launched browser of its own, in a scope the test closes, as Puppeteer's `launch` does. */
const launchOwn = Effect.fnUntraced(function*(browserName: Parameters<typeof backend>[0]) {
  const scope = yield* Scope.make()
  const services = yield* Layer.buildWithScope(backend(browserName, undefined), scope)
  return { scope, services }
})

upstream(import.meta.filename, {}, (test) => {
  test(
    "Browser specs Browser.version should return version",
    { browsers: ["chromium", "firefox"] },
    ({ browserName }) =>
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const version = browser.info.version
        assert.isAbove(version.length, 0)
        // Strider's Info gives the product and version; the original checks the version names the browser
        assert.match(
          `${browser.info.product} ${version}`.toLowerCase(),
          browserName === "chromium" ? /chrom/ : /firefox/
        )
      })
  )

  test(
    "Browser specs Browser.userAgent should include Browser engine",
    { browsers: ["chromium", "firefox"] },
    ({ browserName, page }) =>
      Effect.gen(function*() {
        const userAgent = yield* userAgentOf(page)
        assert.isAbove(userAgent.length, 0)
        assert.include(userAgent, browserName === "chromium" ? "WebKit" : "Gecko")
      })
  )

  test(
    "Browser specs Browser.userAgent should include Browser name",
    { browsers: ["chromium", "firefox"] },
    ({ browserName, page }) =>
      Effect.gen(function*() {
        const userAgent = yield* userAgentOf(page)
        assert.isAbove(userAgent.length, 0)
        assert.include(userAgent, browserName === "chromium" ? "Chrome" : "Firefox")
      })
  )

  test(
    "Browser specs Browser.process should keep connected after the last page is closed",
    { page: false },
    ({ browserName }) =>
      Effect.gen(function*() {
        const { scope, services } = yield* launchOwn(browserName)
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          // Puppeteer closes every page the browser has. The first tab of a launched browser is observed, and `control`
          // gives the page the scope to close it with.
          for (const observed of yield* browser.pages) {
            const page = yield* observed.control
            yield* page.close()
          }
          // Strider has no connected flag. A browser that closed with its last page would not open another one.
          const page = yield* Browser.newPage()
          assert.isTrue(yield* page.evaluateInMainWorld(() => true))
        }).pipe(Effect.provideContext(services), Effect.ensuring(Scope.close(scope, Exit.void)))
      })
  )

  test("Browser specs Browser.on(\"console\") should report console messages from pages", ({ page }) =>
    Effect.gen(function*() {
      // The context is the widest scope Strider has; it must attribute the message to the page that logged it
      const logged = yield* ConsoleMessage.next(page.context, { text: /^from-page$/ })
      yield* page.evaluateInMainWorld(() => {
        console.log("from-page")
      })
      const message = yield* logged
      assert.strictEqual(message.level, "log")
      assert.strictEqual(message.origin._tag, "Page")
      assert.strictEqual(message.origin._tag === "Page" && message.origin.page, page.id)
    }))

  test("Browser specs Browser.on(\"console\") should report console messages from dedicated workers", ({ page }) =>
    Effect.gen(function*() {
      // The browser-level listener is dropped: the page's and the context's logs must each hold the message once.
      const created = yield* BrowserWorker.next(page)
      const done = yield* ConsoleMessage.next(page.context, { text: /^done$/ })
      yield* page.evaluateInMainWorld(() => {
        void new Worker(`data:text/javascript,console.log('from-worker');console.log('done')`)
      })
      const worker = yield* created
      // `done` is logged after `from-worker`, so by the time it arrives every delivery of `from-worker` has been made
      yield* done
      const onPage = yield* ConsoleMessage.history(page, { text: /^from-worker$/ })
      const onContext = yield* ConsoleMessage.history(page.context, { text: /^from-worker$/ })
      assert.strictEqual(onPage.entries.length, 1)
      assert.strictEqual(onContext.entries.length, 1)
      assert.deepStrictEqual(onContext.entries[0], onPage.entries[0])
      const [message] = onPage.entries
      assert.strictEqual(message!.origin._tag, "Worker")
      assert.strictEqual(message!.origin._tag === "Worker" && message!.origin.realm, worker.realm)
    }))

  test("Browser specs Browser.on(\"console\") should report console messages from service workers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html")
      // The service worker is the context's; Puppeteer's 3000 ms wait for it is the deadline here
      const workers = yield* page.context.workers.waitFor((workers) => workers.some((each) => each.kind === "service"))
        .pipe(
          Deadline.within("3 seconds")
        )
      const worker = workers.find((each) => each.kind === "service")!
      const logged = yield* ConsoleMessage.next(page.context, { text: /^from-service-worker$/ })
      yield* worker.evaluate(() => {
        console.log("from-service-worker")
      })
      const message = yield* logged
      assert.strictEqual(message.origin._tag, "Worker")
      assert.strictEqual(message.origin._tag === "Worker" && message.origin.realm, worker.realm)
    }))

  test("Browser specs Browser.on(\"request\") should report requests from pages", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page.context, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE)
      const request = yield* requested
      assert.isTrue(isPageRequest(request, page))
    }))

  test("Browser specs Browser.on(\"request\") should report requests from dedicated workers", ({ page, server }) =>
    Effect.gen(function*() {
      // The browser-level listener is dropped: the context's subscription sees a worker's request too
      const created = yield* BrowserWorker.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      const requested = yield* NetworkRequest.next(page.context, { url: server.PREFIX + "/one-style.css" })
      yield* worker.evaluate((url: string) => {
        void fetch(url)
      }, server.PREFIX + "/one-style.css")
      const request = yield* requested
      assert.isTrue(isWorkerRequest(request, worker))
      // A request from a worker names no page, so Puppeteer's `request.page()` is null
      assert.isFalse(isPageRequest(request, page))
    }))

  test("Browser specs Browser.on(\"request\") should not interfere with request interception", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.fallthrough)
      const response = yield* page.goto(server.EMPTY_PAGE).pipe(Effect.map(statusOf))
      assert.strictEqual(Option.getOrUndefined(response), 200)
      const history = yield* NetworkRequest.history(page.context)
      assert.strictEqual(history.dropped, 0)
      const requests = history.entries.filter((request) => request.url === server.EMPTY_PAGE)
      assert.strictEqual(requests.length, 1)
      assert.isTrue(isPageRequest(requests[0]!, page))
    }))

  test("Browser specs Browser network events should report responses from pages", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page.context, { url: server.EMPTY_PAGE })
      const responded = yield* NetworkResponse.next(page.context, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE)
      const request = yield* requested
      const response = yield* responded
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.hop, request.hop)
      assert.isTrue(isPageRequest(request, page))
    }))

  test("Browser specs Browser network events should report failed requests from pages", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ request }) => request.url.endsWith("css") ? Route.abort() : Route.fallthrough)
      const failed = yield* NetworkRequest.next(page.context, { url: "**/one-style.css" })
      yield* page.goto(server.PREFIX + "/one-style.html")
      const request = yield* failed
      assert.isTrue(isPageRequest(request, page))
      const responded = yield* NetworkRequest.response(page.context, request)
      assert.isTrue(Option.isNone(yield* responded))
      yield* Expect.that(
        NetworkRequest.failure(page.context, request),
        Condition.make(
          "the request to have failed",
          (failure: Option.Option<NetworkRequest.Failure>) => Option.isSome(failure)
        )
      )
    }))
})
