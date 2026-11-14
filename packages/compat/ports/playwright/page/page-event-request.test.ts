/**
 * Playwright's `tests/page/page-event-request.spec.ts`: which requests a page reports, for navigations, frames, fetches,
 * XHRs, and `<picture>` images, and what their type, navigation bit, and response say.
 *
 * What the port changes:
 * - `page.on("request")` collects every request a page makes from the listener's registration on. A page is fresh for
 *   each test and each listener is registered before its action, so the page's request history is what the listener
 *   collected: `requestsOf` reads it, and its `dropped` count must be 0. The history has the browser's own
 *   `/favicon.ico` request when Chromium sends one, which Playwright never reports, so `requestsOf` leaves it out (the
 *   same as page-network-request's). A subscription (`NetworkRequest.stream`) would deliver the same requests later,
 *   so counting its deliveries races with the test's own read.
 * - `page.waitForEvent("request")` is `NetworkRequest.next` with the URL the original's request has, subscribed before
 *   the action, and `request.isNavigationRequest()` is `Option.isNone` of the `Document` initiator's `navigation`.
 * - `page.evaluate(() => fetch(…))` returns a `Response`, which doesn't cross by value, so each fetch is awaited inside
 *   its evaluation, as page-network-request's are; `page.evaluate` is `page.evaluateInMainWorld`.
 * - `response.text()` and `response.request()` on NE-099's navigation are a `NetworkResponse.next` with a `body`
 *   decoder, and the `NetworkRequest.next` for the same URL: Strider's navigation result has no body, and a response
 *   has no request (matrix rows `method-response-text` and `method-response-request`), so the port matches the two by
 *   hop. `response.finished()` is not ported as a call: the body decoder resolves once the body has ended, which is the
 *   same wait.
 * - `request.failure()` is `NetworkRequest.failure`, which reads the request's original observation immediately.
 * - `requestfailed`, `requestfinished`, and `serviceWorker()`-based tests are in the ledger: Strider has no request
 *   failure or finish event (matrix rows `event-page-requestfailed` and `event-page-requestfinished`).
 * - NE-104's image is the fixture server's `/pptr.png` instead of Wikipedia's logo, so the port doesn't depend on the
 *   internet; the `<picture>` markup and the type check are the original's, and the wait is for that exact URL.
 * - NE-105 and NE-106 expect Playwright's browser-side CORS preflight handling. On Chromium the route sees the `OPTIONS`
 *   request of a cross-origin POST (matrix note on `route`), but the page's request event doesn't. `isBidi` in the
 *   original is Strider's Firefox, which speaks BiDi, so the branch names Chromium and Firefox. NE-106 uses `expect.soft`,
 *   which runs both checks and fails on either, so `soft` collects both before it fails.
 * - Upstream's `it.skip` for browsers other than Chromium (NE-100) is `{ browsers: ["chromium"] }`, and NE-100 is
 *   in the ledger for its `requestfailed`.
 * - NE-107 is in the ledger: `page.requests()` keeps a bounded set of requests whose responses' bodies stay readable,
 *   and Strider's history keeps no response bodies.
 */
import { assert } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, type Page, PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attachFrame } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Every request the page has made since it was created, except the browser's own request for `/favicon.ico`, which
 * Playwright never reports.
 */
const requestsOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => new URL(request.url).pathname !== "/favicon.ico")
})

/** The response a navigation carried, when it had one. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

/** A navigation request, which is a document's request for its own navigation. */
const isNavigation = (request: NetworkRequest.NetworkRequest): boolean =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/**
 * Playwright's `expect.soft`: every check runs, and the first failure fails the test after all of them ran.
 */
const soft = (...checks: ReadonlyArray<() => void>) => {
  const failures = checks.flatMap((check) => {
    try {
      check()
      return []
    } catch (error) {
      return [error]
    }
  })
  if (failures.length > 0) throw failures[0]
}

upstream(import.meta.filename, {}, (test) => {
  test("NE-091", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual((yield* requestsOf(page)).length, 1)
    }))

  test("NE-092", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual((yield* requestsOf(page)).length, 2)
    }))

  test("NE-093", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/empty.html")
      })
      assert.strictEqual((yield* requestsOf(page)).length, 2)
    }))

  test("NE-094", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/empty.html", { keepalive: true })
      })
      assert.strictEqual((yield* requestsOf(page)).length, 2)
    }))

  test("NE-099", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        // Note: without 'onload', Firefox sometimes does not fire the load event over the protocol.
        response.end(`
      <div>Hello there!</div>
      <script>window.onload = () => console.log('onload')</script>
    `)
      })
      // The request and the body are listened for before the navigation that makes them
      const sent = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      const bodySent = yield* NetworkResponse.next(page, {
        url: server.EMPTY_PAGE,
        body: (message) => message.text
      })
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      const response = Option.getOrThrow(responseOf(navigation))
      const captured = yield* bodySent
      // The body decoder resolves once the body has ended: that is the original's `response.finished()`
      assert.strictEqual(captured.hop, response.hop)
      const request = yield* sent
      assert.strictEqual(request.hop, response.hop)
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, request)))
      assert.include(captured.body, "Hello there!")
    }))

  test("NE-101", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.evaluateInMainWorld(() => {
        const x = new XMLHttpRequest()
        x.open("GET", location.href, false)
        x.send()
      })
      const request = yield* sent
      assert.isFalse(isNavigation(request))
      assert.strictEqual(request.resourceType, "xhr")
    }))

  test("NE-104", ({ page, server }) =>
    Effect.gen(function*() {
      const imageUrl = server.PREFIX + "/pptr.png"
      const sent = yield* NetworkRequest.next(page, { url: imageUrl })
      yield* page.setContent(`
      <picture>
        <source>
          <img src="${imageUrl}">
        </source>
      </picture>
    `)
      const request = yield* sent
      assert.strictEqual(request.resourceType, "image")
    }))

  // Chromium: requestWillBeSentEvent.frameId is undefined for OPTIONS.
  // WebKit: no requestWillBeSent event in the protocol for OPTIONS (at least on Mac).
  // Firefox: OPTIONS request can be dispatched.
  test("NE-105", ({ page, server }) =>
    Effect.gen(function*() {
      const serverRequests: Array<string> = []
      server.setRoute("/cors", (req, res) => {
        serverRequests.push(`${req.method} ${req.url}`)
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "*"
          })
          res.end()
          return
        }
        res.writeHead(200, { "Content-type": "text/plain", "Access-Control-Allow-Origin": "*" })
        res.end("Hello there!")
      })
      const response = yield* page.evaluateInMainWorld(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          body: "",
          headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "test-value"
          }
        })
        return await response.text()
      }, server.CROSS_PROCESS_PREFIX + "/cors").pipe(Effect.orElseSucceed(() => undefined))
      assert.strictEqual(response, "Hello there!")
      assert.deepStrictEqual(serverRequests, ["OPTIONS /cors", "POST /cors"])
      const clientRequests = (yield* requestsOf(page)).map((request) => `${request.method} ${request.url}`)
      assert.deepStrictEqual(clientRequests, [`POST ${server.CROSS_PROCESS_PREFIX}/cors`])
    }))

  // Chromium: requestWillBeSentEvent.frameId is undefined for OPTIONS.
  // WebKit: no requestWillBeSent event in the protocol for OPTIONS (at least on Mac).
  // Firefox: OPTIONS request can be dispatched.
  test("NE-106", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const serverRequests: Array<string> = []
      server.setRoute("/cors", (req, res) => {
        serverRequests.push(`${req.method} ${req.url}`)
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "*"
          })
          res.end()
          return
        }
        res.writeHead(200, { "Content-type": "text/plain", "Access-Control-Allow-Origin": "*" })
        res.end("Hello there!")
      })
      yield* page.route("**/*", () => Route.continue)
      const response = yield* page.evaluateInMainWorld(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          body: "",
          headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "test-value"
          }
        })
        return await response.text()
      }, server.CROSS_PROCESS_PREFIX + "/cors").pipe(Effect.orElseSucceed(() => undefined))
      assert.strictEqual(response, "Hello there!")
      const clientRequests = (yield* requestsOf(page)).map((request) => `${request.method} ${request.url}`)
      // Chromium and Firefox's BiDi (Strider's Firefox, which Playwright's `isBidi` names) don't pass the preflight on
      soft(
        () =>
          assert.deepStrictEqual(
            serverRequests,
            [
              ...(browserName === "chromium" || browserName === "firefox" ? [] : ["OPTIONS /cors"]),
              "POST /cors"
            ]
          ),
        () => assert.deepStrictEqual(clientRequests, [`POST ${server.CROSS_PROCESS_PREFIX}/cors`])
      )
    }))
})
