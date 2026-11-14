/**
 * Playwright's `tests/page/page-route.spec.ts`: routes that intercept a page's requests, and what a route handler sees
 * and does with each one: continuing it, changing it, fulfilling it, aborting it, and removing the route.
 *
 * What the port changes:
 * - A route's handler is an Effect that returns one decision: `route.continue()` is `Route.continue`,
 *   `route.continue({ headers })` is `Route.continueWith` over the headers' changes, `route.fallback()` is
 *   `Route.fallthrough`, `route.fulfill(…)` is `Route.fulfill(HttpServerResponse…)`, and `route.abort(reason)` is
 *   `Route.abort(reason)`. A handler that asserts inside the original's listener records what it saw, and the test
 *   body asserts on the record, where a failure fails the test: a Strider handler's failure is logged and the default
 *   continues, so it would hide the failure.
 * - `route.request()` is the handler's `request`, which is the one request the route was given, so the original's
 *   identity check holds by construction and isn't repeated.
 * - `page.route(…)` returns a registration, and removing it is `page.unroute`. Strider removes by registration, not by
 *   pattern, so removing every route with one pattern means removing each of them. A RegExp handler has no counterpart
 *   (see RO-002).
 * - RegExp patterns (RO-002, RO-015) have no Strider form: a glob that matches the same requests, in this test's
 *   fixture server, stands in, and the test's point is unchanged. URLPattern's `ignoreCase` has no Strider option, so
 *   RO-056 isn't ported (see the ledger).
 * - `page.content()` is `page.readHtml`, `page.evaluate` is `page.evaluateInMainWorld`, and
 *   `page.setExtraHTTPHeaders` is `page.emulate({ extraHTTPHeaders })`, whose registration lasts as long as the test.
 * - `page.waitForRequest`, `page.waitForResponse`, and `page.on("requestfailed")` are `NetworkRequest.next`,
 *   `NetworkResponse.next`, and `NetworkRequest.failure` read after the action; a request's `response()` is
 *   `NetworkRequest.response`, its redirects are `NetworkRequest.redirects`, and `request.postData()` is the handler's
 *   `requestBody`. A response's `headerValue(name)` is its `headers[name]`.
 * - A request's headers are the ones its event gives, which on Chromium and WebKit leave out `Cookie`: the route
 *   can't read the headers the network will add until it continues the request. A request's headers after it
 *   completes, `NetworkRequest.headersSent`, are what Playwright's `allHeaders()` gives, and RO-049 and RO-050 read
 *   them that way. RO-009 reads `allHeaders()` inside the route to check the cookie the page set before it overrides
 *   it; that read has no counterpart while the request is paused, so the port checks the other half, that the server
 *   still receives the original cookie, and leaves the first `expect.soft` out.
 * - Playwright answers every CORS preflight a route could see itself, and Strider shows it to a route that matches it
 *   on Chromium (API.md, "What the backends do differs"). The tests that fetch across origins (RO-035 to RO-037, RO-039
 *   to RO-041, RO-043, RO-044) register their handler through `answeringPreflights`, which answers a preflight with
 *   the headers Playwright's does and gives every other request to the test's handler, so each test exercises the
 *   fulfilled response and not the preflight. Playwright also adds `Access-Control-Allow-Origin` to a fulfilled
 *   cross-origin response that has none; RO-035 and RO-036 check that header and are left as Strider reports it.
 * - RO-055 and RO-202 wait for `window.activationPromise`, which resolves with an `Event`, and return nothing: an `Event`
 *   doesn't cross by value, and neither test reads it.
 * - A held route (RO-012, RO-013, RO-017) is a handler that waits on a Deferred until the test releases it, as the
 *   original keeps the route object and calls `route.continue()` itself. The original's 500 ms waits are ported as
 *   written.
 * - `route.continue()`, `route.abort()`, and `route.fallback()` that the original calls after the page has handled
 *   the request (RO-017) return their decision from the handler, which Strider applies and doesn't raise to the test.
 *   RO-017's cancellation assertions are kept; the no-throw step isn't observable here.
 * - Popups: none here. Strider's `window.open` isn't used.
 * - `expect.soft` checks run to the end and then fail the test together (page-focus's convention).
 * - `Expect`-style waits aren't used here: the original's checks are plain reads after each action.
 *
 * The original's `it.fixme(webkit)` tests (RO-011, RO-012, RO-013, RO-032) are ported on every browser, as upstream's
 * own skips aren't ours. Its `it.fail` on Chromium (RO-050) is ported as written, and Strider's result stands.
 */
import { assert } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, PageNavigation, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { HttpClientRequest, HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import type * as http from "node:http"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one: a navigation to a `data:` URL has none. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

const statusOf = (navigation: PageNavigation.PageNavigation): number | undefined =>
  Option.getOrUndefined(Option.map(responseOf(navigation), (response) => response.status))

const isOk = (navigation: PageNavigation.PageNavigation): boolean => {
  const status = statusOf(navigation)
  return status !== undefined && status >= 200 && status <= 299
}

/** A navigation request, which is a document's request for its own navigation. */
const isNavigation = (request: NetworkRequest.NetworkRequest): boolean =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/** A handler that records each request it's given, then continues it: Playwright's `requests.push(route.request())`. */
const recording = (seen: Array<NetworkRequest.NetworkRequest>) => ({ request }: Route.RequestPhase) =>
  Effect.sync(() => {
    seen.push(request)
  }).pipe(Effect.andThen(Route.continue))

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Playwright's `expect.soft`: every check runs, and any mismatch fails the test once they have all run. */
const softly = (checks: ReadonlyArray<() => void>): Effect.Effect<void> =>
  Effect.sync(() => {
    const mismatches: Array<string> = []
    for (const check of checks) {
      try {
        check()
      } catch (error) {
        mismatches.push(messageOf(error))
      }
    }
    assert.deepStrictEqual(mismatches, [])
  })

/** The headers whose names start with `sec-fetch-`, as RO-050 compares them. */
const secFetch = (headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase().startsWith("sec-fetch-")))

const allowCors = (request: http.IncomingMessage, response: http.ServerResponse) => {
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin || "*")
  response.setHeader("Access-Control-Allow-Credentials", "true")
  response.setHeader("Access-Control-Allow-Headers", "x-app-version")
  if (request.method !== "OPTIONS") return false
  response.writeHead(204)
  response.end()
  return true
}

/** A CORS preflight: an `OPTIONS` request that asks which method the page's real request may use. */
const isPreflight = (request: NetworkRequest.NetworkRequest): boolean =>
  request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined

/**
 * A route handler that answers a CORS preflight as Playwright's own does for every route (crNetworkManager: it accepts
 * every preflight, echoing the origin, method and headers, with credentials allowed), and gives every other request to
 * `handler`. Playwright's browsers answer the preflight themselves; Strider shows it to a route that matches it, on
 * Chromium, so a handler has to.
 */
const answeringPreflights = <E, R>(handler: Route.Handler<E, R>): Route.Handler<E, R> => (paused) => {
  const { request } = paused
  if (!isPreflight(request)) return handler(paused)
  const requested = request.headers["access-control-request-headers"]
  return Route.fulfill(HttpServerResponse.empty({
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": request.headers["origin"] ?? "*",
      "Access-Control-Allow-Methods": request.headers["access-control-request-method"] ?? "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Credentials": "true",
      ...(requested === undefined ? {} : { "Access-Control-Allow-Headers": requested })
    }
  }))
}

upstream(import.meta.filename, {}, (test) => {
  test("RO-001", ({ page, server }) =>
    Effect.gen(function*() {
      // Each request's details are read in the handler, where the page's frame tree is current
      const seen: Array<{ request: NetworkRequest.NetworkRequest; body: Option.Option<Uint8Array>; frameUrl: string }> =
        []
      const main = yield* page.frames
      yield* page.route("**/empty.html", ({ request, requestBody }) =>
        Effect.gen(function*() {
          const body = yield* requestBody
          seen.push({ request, body, frameUrl: (yield* page.frames).url })
          return yield* Route.continue
        }))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.isTrue(isOk(navigation))
      assert.isAbove(seen.length, 0)
      const [first] = seen
      assert.isDefined(first)
      const { request, body, frameUrl } = first
      assert.include(request.url, "empty.html")
      assert.isTrue(Boolean(request.headers["user-agent"]))
      assert.strictEqual(request.method, "GET")
      assert.isTrue(Option.isNone(body))
      assert.isTrue(isNavigation(request))
      assert.strictEqual(request.resourceType, "document")
      assert.strictEqual(
        request.initiator._tag === "Document" && request.initiator.navigable,
        main.id
      )
      assert.strictEqual(frameUrl, "about:blank")
    }))

  test("RO-002", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<number> = []
      const handler = (n: number) => () =>
        Effect.sync(() => {
          intercepted.push(n)
        }).pipe(Effect.andThen(Route.fallthrough))
      yield* page.route("**/*", handler(1))
      const second = yield* page.route("**/empty.html", handler(2))
      const third = yield* page.route("**/empty.html", handler(3))
      // Playwright's `/empty.html/` regular expression, as the glob that matches the same requests
      const fourth = yield* page.route("**/empty.html", handler(4))
      yield* page.goto(server.EMPTY_PAGE)
      assert.deepStrictEqual(intercepted, [4, 3, 2, 1])

      intercepted.length = 0
      yield* fourth.remove
      yield* page.goto(server.EMPTY_PAGE)
      assert.deepStrictEqual(intercepted, [3, 2, 1])

      intercepted.length = 0
      // `unroute("**/empty.html")` removes every route with that pattern; Strider removes each by its registration
      yield* second.remove
      yield* third.remove
      yield* page.goto(server.EMPTY_PAGE)
      assert.deepStrictEqual(intercepted, [1])
    }))

  test("RO-003", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/index", (_req, res) => res.end("index-no-hello"))
      server.setRoute("/index123hello", (_req, res) => res.end("index123hello"))
      server.setRoute("/index?hello", (_req, res) => res.end("index?hello"))
      server.setRoute("/index1hello", (_req, res) => res.end("index1hello"))

      yield* page.route("**/index?hello", () => Route.fulfill(HttpServerResponse.text("intercepted any character")))
      yield* page.route(
        "**/index\\?hello",
        () => Route.fulfill(HttpServerResponse.text("intercepted question mark"))
      )

      yield* page.goto(server.PREFIX + "/index?hello")
      assert.include(yield* page.readHtml, "intercepted question mark")

      yield* page.goto(server.PREFIX + "/index")
      assert.include(yield* page.readHtml, "index-no-hello")

      yield* page.goto(server.PREFIX + "/index1hello")
      assert.include(yield* page.readHtml, "index1hello")

      yield* page.goto(server.PREFIX + "/index123hello")
      assert.include(yield* page.readHtml, "index123hello")
    }))

  test("RO-004", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rredirect", "/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continue)
      yield* page.setContent(`
    <form action='/rredirect' method='post'>
      <input type="hidden" id="foo" name="foo" value="FOOBAR">
    </form>
  `)
      // `page.waitForNavigation()` waits for the load, which `waitUntil` says here
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => (document.querySelector("form") as HTMLFormElement).submit())
      yield* navigated
    }))

  // @see https://github.com/GoogleChrome/puppeteer/issues/3973
  test("RO-005", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rrredirect", "/empty.html")
      // Playwright passes every header back, with `foo` added; Strider's change adds `foo` and sends the rest as they were
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeader("foo", "bar")))
      yield* page.goto(server.PREFIX + "/rrredirect")
    }))

  // @see https://github.com/GoogleChrome/puppeteer/issues/4743
  test("RO-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.removeHeader("foo")))

      const received = yield* server.waitForRequest("/title.html")
      yield* page.evaluateInMainWorld(async (url) => {
        await fetch(url, { headers: { foo: "bar" } })
      }, server.PREFIX + "/title.html")
      const serverRequest = yield* received
      assert.isUndefined(serverRequest.headers.foo)
    }))

  test("RO-007", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      yield* page.goto(server.PREFIX + "/one-style.html")
      const css = requests.at(1)
      assert.isDefined(css)
      assert.include(css.url, "/one-style.css")
      assert.include(css.headers.referer, "/one-style.html")
    }))

  test("RO-008", ({ page, server }) =>
    Effect.gen(function*() {
      // Setup cookie.
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.context.cookies.set({ name: "foo", value: "bar", scope: { url: server.EMPTY_PAGE } })

      // Setup request interception.
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.reload()
      assert.strictEqual(statusOf(navigation), 200)
    }))

  test("RO-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "original=value"
      })
      // The original reads the cookie from `allHeaders()` inside the route, then continues with every header it read and
      // `cookie` overridden. Strider's change sets the one header
      yield* page.route("**", () => Route.continueWith(HttpClientRequest.setHeader("cookie", "overridden=value")))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.headers["cookie"], "original=value")
    }))

  test("RO-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.isTrue(isOk(navigation))
      assert.isAbove(requests.length, 0)
      for (const request of requests) assert.strictEqual(request.headers.foo, "bar")
    }))

  // @see https://github.com/GoogleChrome/puppeteer/issues/4337
  test("RO-011", ({ page, server }) =>
    Effect.gen(function*() {
      // `it.fixme` on WebKit upstream: ported on every browser
      yield* page.goto(server.EMPTY_PAGE)
      server.setRedirect("/logo.png", "/pptr.png")
      const seen: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(seen))
      const status = yield* page.evaluateInMainWorld(() => {
        const request = new XMLHttpRequest()
        request.open("GET", "/logo.png", false) // `false` makes the request synchronous
        request.send(null)
        return request.status
      })
      assert.strictEqual(status, 200)
      // The original's `continuePromise` is truthy when its route was called
      assert.isAbove(seen.length, 0)
    }))

  test("RO-012", ({ page, server }) =>
    Effect.gen(function*() {
      // `it.fixme` on WebKit upstream: ported on every browser
      yield* page.goto(server.EMPTY_PAGE)
      const reached = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      // The route is held until the test releases it, as the original calls `route.continue()` itself
      yield* page.route("**/global-var.html", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(released)
          return yield* Route.continue
        }))
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(
          window,
          "__statusPromise",
          new Promise((resolve) =>
            setTimeout(() => {
              // The synchronous request blocks the page, so it is started from a timer
              const request = new XMLHttpRequest()
              request.open("GET", "/global-var.html", false) // `false` makes the request synchronous
              request.send(null)
              resolve(request.status)
            }, 0)
          )
        )
      })
      yield* Deferred.await(reached)
      // Check that intercepted request is actually paused. The original's 500 ms wait is kept.
      yield* Effect.sleep("500 millis")
      // The original's `requestfinished` listener: a paused request has no response yet
      const finished = yield* NetworkResponse.history(page, { url: "**/global-var.html" })
      assert.strictEqual(finished.entries.length, 0)
      yield* Deferred.succeed(released, undefined)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__statusPromise")), 200)
    }))

  test("RO-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const reached = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      yield* page.route("**/global-var.html", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(released)
          return yield* Route.continue
        }))
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__fetchFinished", false)
        Reflect.set(
          window,
          "__statusPromise",
          fetch("/global-var.html").then((response) => {
            Reflect.set(window, "__fetchFinished", true)
            return response.status
          })
        )
      })
      yield* Deferred.await(reached)
      // Check that intercepted request is actually paused. The original's 500 ms wait is kept.
      yield* Effect.sleep("500 millis")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__fetchFinished")), false)
      yield* Deferred.succeed(released, undefined)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__statusPromise")), 200)
    }))

  test("RO-014", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's Chromium before 154 repeats the referer; the pinned Chromium is 155, so every browser's is the one value
      yield* page.emulate({ extraHTTPHeaders: { referer: server.EMPTY_PAGE } })
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.isTrue(isOk(navigation))
      assert.isAbove(requests.length, 0)
      for (const request of requests) assert.strictEqual(request.headers.referer, server.EMPTY_PAGE)
    }))

  test("RO-015", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `/\.css$/`, as the glob that matches the same requests
      yield* page.route("**/*.css", () => Route.abort())
      const documentRequest = yield* NetworkRequest.next(page, { url: server.PREFIX + "/one-style.html" })
      const stylesheet = yield* NetworkRequest.next(page, { url: server.PREFIX + "/one-style.css" })
      const navigation = yield* page.goto(server.PREFIX + "/one-style.html")
      assert.isTrue(isOk(navigation))
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, yield* documentRequest)))
      assert.isTrue(Option.isSome(yield* NetworkRequest.failure(page, yield* stylesheet)))
    }))

  test("RO-016", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.abort("internetDisconnected"))
      const sent = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE).pipe(Effect.ignore)
      const failure = yield* NetworkRequest.failure(page, yield* sent)
      assert(Option.isSome(failure), "the request reported no failure")
      // Firefox and WebKit can't abort with a reason (`interception.abortReason`), so they're ledgered as needsFeature
      if (browserName === "webkit") assert.strictEqual(failure.value.errorText, "Blocked by Web Inspector")
      else if (browserName === "firefox") assert.strictEqual(failure.value.errorText, "NS_ERROR_OFFLINE")
      else assert.strictEqual(failure.value.errorText, "net::ERR_INTERNET_DISCONNECTED")
    }))

  test("RO-017", ({ page, server }) =>
    Effect.gen(function*() {
      const reached = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      yield* page.route("**/data.json", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(released)
          // The original's `route.abort()` after the page cancelled the request: a decision, which doesn't throw here
          return yield* Route.abort()
        }))
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: server.PREFIX + "/data.json" })
      yield* page.evaluateInMainWorld((url) => {
        Reflect.set(globalThis, "controller", new AbortController())
        const controller = Reflect.get(globalThis, "controller") as AbortController
        fetch(url, { signal: controller.signal }).catch(() => {})
      }, server.PREFIX + "/data.json")
      yield* Deferred.await(reached)
      const request = yield* sent
      // The request's end, which has no response, is the wait the original does with `requestfailed`
      const endWait = yield* NetworkRequest.response(page, request)
      yield* page.evaluateInMainWorld(() => (Reflect.get(globalThis, "controller") as AbortController).abort())
      assert.isTrue(Option.isNone(yield* endWait))
      const failure = yield* NetworkRequest.failure(page, request)
      assert(Option.isSome(failure), "the cancelled request reported no failure")
      assert.match(failure.value.errorText, /cancelled|aborted/i)
      yield* Deferred.succeed(released, undefined)
    }))

  test("RO-018", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { referer: "http://google.com/" } })
      yield* page.route("**/*", () => Route.continue)
      const received = yield* server.waitForRequest("/grid.html")
      yield* page.goto(server.PREFIX + "/grid.html")
      const request = yield* received
      assert.strictEqual(request.headers["referer"], "http://google.com/")
    }))

  test("RO-019", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.abort())
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE), "the navigation")
      // Strider's navigation error carries the network error, as Playwright's message does
      const expected = browserName === "webkit"
        ? "Blocked by Web Inspector"
        : browserName === "firefox"
        ? "NS_ERROR_ABORT"
        : "net::ERR_FAILED"
      assert.include(messageOf(error), expected)
    }))

  test("RO-020", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(intercepted))
      server.setRedirect("/non-existing-page.html", "/non-existing-page-2.html")
      server.setRedirect("/non-existing-page-2.html", "/non-existing-page-3.html")
      server.setRedirect("/non-existing-page-3.html", "/non-existing-page-4.html")
      server.setRedirect("/non-existing-page-4.html", "/empty.html")

      const first = yield* NetworkRequest.next(page, { url: server.PREFIX + "/non-existing-page.html" })
      const navigation = yield* page.goto(server.PREFIX + "/non-existing-page.html")
      assert.strictEqual(statusOf(navigation), 200)
      const response = Option.getOrThrow(responseOf(navigation))
      assert.include(response.url, "empty.html")

      assert.strictEqual(intercepted.length, 1)
      const [only] = intercepted
      assert.isDefined(only)
      assert.strictEqual(only.resourceType, "document")
      assert.isTrue(isNavigation(only))
      assert.include(only.url, "/non-existing-page.html")

      // Playwright walks back from the response's request; Strider walks forward from the first hop, which is the same chain
      const redirects = yield* NetworkRequest.redirects(page)
      const firstHop = yield* first
      assert.isTrue(Option.isNone(yield* redirects.from(firstHop)))
      const chain: Array<NetworkRequest.NetworkRequest> = [firstHop]
      for (;;) {
        const last = chain[chain.length - 1]
        assert.isDefined(last)
        const next = yield* redirects.to(last)
        if (Option.isNone(next)) break
        chain.push(next.value)
      }
      assert.strictEqual(chain.length, 5)
      const urls = chain.map((request) => new URL(request.url).pathname)
      assert.deepStrictEqual(urls, [
        "/non-existing-page.html",
        "/non-existing-page-2.html",
        "/non-existing-page-3.html",
        "/non-existing-page-4.html",
        "/empty.html"
      ])
      for (const request of chain) assert.isTrue(isNavigation(request))
    }))

  test("RO-022", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(intercepted))
      server.setRedirect("/one-style.css", "/two-style.css")
      server.setRedirect("/two-style.css", "/three-style.css")
      server.setRedirect("/three-style.css", "/four-style.css")
      server.setRoute("/four-style.css", (_req, res) => res.end("body {box-sizing: border-box; }"))

      const navigation = yield* page.goto(server.PREFIX + "/one-style.html")
      assert.strictEqual(statusOf(navigation), 200)
      assert.include(Option.getOrThrow(responseOf(navigation)).url, "one-style.html")

      assert.strictEqual(intercepted.length, 2)
      const [documentRequest, stylesheet] = intercepted
      assert.isDefined(documentRequest)
      assert.isDefined(stylesheet)
      assert.strictEqual(documentRequest.resourceType, "document")
      assert.include(documentRequest.url, "one-style.html")

      const redirects = yield* NetworkRequest.redirects(page)
      let hop: NetworkRequest.NetworkRequest | undefined = stylesheet
      for (const url of ["/one-style.css", "/two-style.css", "/three-style.css", "/four-style.css"]) {
        assert.isDefined(hop)
        assert.strictEqual(hop.resourceType, "stylesheet")
        assert.include(hop.url, url)
        hop = Option.getOrUndefined(yield* redirects.to(hop))
      }
      assert.isUndefined(hop)
    }))

  test("RO-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      let responseCount = 1
      server.setRoute("/zzz", (_req, res) => res.end(String((responseCount++) * 11)))

      let spinner = false
      // Cancel 2nd request.
      yield* page.route("**/*", () => {
        const decision: Effect.Effect<Route.Decision<"request">> = spinner ? Route.abort() : Route.continue
        spinner = !spinner
        return decision
      })
      const results: Array<string> = []
      for (let i = 0; i < 3; i++) {
        results.push(
          yield* page.evaluateInMainWorld(() => fetch("/zzz").then((response) => response.text()).catch(() => "FAILED"))
        )
      }
      assert.deepStrictEqual(results, ["11", "FAILED", "22"])
    }))

  test("RO-024", ({ page }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const dataURL = "data:text/html,<div>yo</div>"
      const navigation = yield* page.goto(dataURL)
      assert.isTrue(Option.isNone(responseOf(navigation)))
      assert.strictEqual(requests.length, 0)
    }))

  test("RO-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const dataURL = "data:text/html,<div>yo</div>"
      const text = yield* page.evaluateInMainWorld((url) => fetch(url).then((response) => response.text()), dataURL)
      assert.strictEqual(text, "<div>yo</div>")
      assert.strictEqual(requests.length, 0)
    }))

  test("RO-026", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const navigation = yield* page.goto(server.EMPTY_PAGE + "#hash")
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(Option.getOrThrow(responseOf(navigation)).url, server.EMPTY_PAGE)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, server.EMPTY_PAGE)
    }))

  test("RO-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.goto(server.PREFIX + "/some nonexisting page")
      assert.strictEqual(statusOf(navigation), 404)
    }))

  test("RO-028", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/malformed?rnd=%911", (_req, res) => res.end())
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.goto(server.PREFIX + "/malformed?rnd=%911")
      assert.strictEqual(statusOf(navigation), 200)
    }))

  test("RO-029", ({ page, server }) =>
    Effect.gen(function*() {
      // The requestWillBeSent will report URL as-is, whereas interception will report encoded URL for stylesheet.
      yield* page.goto(server.EMPTY_PAGE)
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      yield* page.setContent(`<link rel="stylesheet" href="${server.PREFIX}/fonts?helvetica|arial"/>`)
      assert.strictEqual(requests.length, 1)
      const [stylesheet] = requests
      assert.isDefined(stylesheet)
      const response = yield* (yield* NetworkRequest.response(page, stylesheet))
      assert.strictEqual(Option.getOrUndefined(Option.map(response, (r) => r.status)), 404)
    }))

  // RO-030 ("Invalid Interception Id"): see the ledger. Its `route.continue()` after the frame was removed is a decision
  // a handler returns, not a call that can throw.

  test("RO-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      let intercepted = false
      yield* page.route(server.CROSS_PROCESS_PREFIX + "/empty.html", () =>
        Effect.sync(() => {
          intercepted = true
        }).pipe(Effect.andThen(Route.continue)))
      const navigation = yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html")
      assert.isTrue(isOk(navigation))
      assert.isTrue(intercepted)
    }))

  test("RO-032", ({ page, server }) =>
    Effect.gen(function*() {
      // `it.fixme` on WebKit upstream: ported on every browser
      yield* page.goto(server.PREFIX + "/title.html")
      server.setRoute("/final", (_req, res) => res.end("foo"))
      yield* page.route("**/*", ({ request }): Effect.Effect<Route.Decision<"request">> =>
        request.url !== server.PREFIX + "/redirect_this"
          ? Route.continue
          : Route.fulfill(HttpServerResponse.empty({ status: 301, headers: { location: "/final" } })))

      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url)
        return data.text()
      }, server.PREFIX + "/redirect_this")
      assert.strictEqual(text, "foo")
    }))

  // RO-033 (a fulfilled redirect status is refused on WebKit): see the ledger.

  test("RO-034", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/cars*", ({ request }) =>
        Route.fulfill(HttpServerResponse.jsonUnsafe(["electric", "gas"], {
          headers: { "access-control-allow-origin": request.url.endsWith("allow") ? "*" : "none" }
        })))
      {
        // Should succeed
        const resp = yield* page.evaluateInMainWorld(async () => {
          const response = await fetch("https://example.com/cars?allow", { mode: "cors" })
          return response.json()
        })
        assert.deepStrictEqual(resp, ["electric", "gas"])
      }
      {
        // Should be rejected: the in-page error's text, as Playwright's `error.message`
        const error = String(
          yield* page.evaluateInMainWorld(() =>
            fetch("https://example.com/cars?reject", { mode: "cors" })
              .then((response) => response.json())
              .catch((e) => String(e))
          )
        )
        if (browserName === "chromium") assert.include(error, "Failed")
        if (browserName === "webkit") assert.include(error, "TypeError")
        if (browserName === "firefox") assert.include(error, "NetworkError")
      }
    }))

  test("RO-035", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route(
        "**/cars",
        answeringPreflights(() => Route.fulfill(HttpServerResponse.jsonUnsafe(["electric", "gas"])))
      )

      const received = yield* NetworkResponse.next(page, { url: "https://example.com/cars" })
      const result = yield* page.evaluateInMainWorld(async () => {
        const response = await fetch("https://example.com/cars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({ number: 1 })
        })
        return response.json()
      })
      const response = yield* received
      assert.deepStrictEqual(result, ["electric", "gas"])
      assert.strictEqual(response.headers["access-control-allow-origin"], server.PREFIX)
    }))

  test("RO-036", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route(
        "**/something",
        answeringPreflights(() => Route.fulfill(HttpServerResponse.text("done", { contentType: "text/plain" })))
      )

      const received = yield* NetworkResponse.next(page, { url: server.CROSS_PROCESS_PREFIX + "/something" })
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, { method: "GET", headers: { "X-PINGOTHER": "pingpong" } })
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      const response = yield* received
      assert.strictEqual(text, "done")
      assert.strictEqual(response.headers["access-control-allow-origin"], "null")
    }))

  test("RO-037", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      server.setRoute("/something", (request, response) => {
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-cache"
          })
          response.end()
          return
        }
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" })
        response.end("NOT FOUND")
      })
      // Fetch request should fail when CORS header doesn't include the origin.
      yield* page.route(
        "**/something",
        answeringPreflights(() =>
          Route.fulfill(HttpServerResponse.text("done", {
            contentType: "text/plain",
            headers: { "Access-Control-Allow-Origin": "http://non-existent" }
          }))
        )
      )

      // The fetch's rejection, as Playwright's `error.message`, per browser
      const error = String(
        yield* page.evaluateInMainWorld(
          (url) =>
            fetch(url, { method: "GET", headers: { "X-PINGOTHER": "pingpong" } })
              .then((response) => response.text())
              .catch((e) => String(e)),
          server.CROSS_PROCESS_PREFIX + "/something"
        )
      )
      if (browserName === "chromium") assert.include(error, "Failed to fetch")
      else if (browserName === "webkit") assert.include(error, "Load failed")
      else if (browserName === "firefox") assert.include(error, "NetworkError when attempting to fetch resource.")
    }))

  // @see https://github.com/microsoft/playwright/issues/20469
  test("RO-038", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)

      let requests: Array<string> = []
      server.setRoute("/something", (request, response) => {
        requests.push(request.method + ":" + request.url)
        if (request.method === "OPTIONS") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-cache"
          })
          response.end(`Hello`)
          return
        }
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("World")
      })

      // Without interception.
      {
        requests = []
        const [text1, text2] = yield* page.evaluateInMainWorld(async (url) => {
          const response1 = await fetch(url, { method: "OPTIONS" })
          const text1 = await response1.text()
          const response2 = await fetch(url, { method: "GET" })
          const text2 = await response2.text()
          return [text1, text2]
        }, server.CROSS_PROCESS_PREFIX + "/something")
        yield* softly([
          () => assert.strictEqual(text1, "Hello"),
          () => assert.strictEqual(text2, "World"),
          // Preflight for OPTIONS, then OPTIONS, then GET without preflight.
          () => assert.deepStrictEqual(requests, ["OPTIONS:/something", "OPTIONS:/something", "GET:/something"])
        ])
      }
    }))

  // Make sure this runs in a new context as preflight results could be cached.
  // @see https://github.com/microsoft/playwright/issues/20469
  test("RO-039", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)

      let requests: Array<string> = []
      server.setRoute("/something", (request, response) => {
        requests.push(request.method + ":" + request.url)
        if (request.method === "OPTIONS") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-cache"
          })
          response.end(`Hello`)
          return
        }
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("World")
      })

      // With interception.
      {
        yield* page.route("**/something", answeringPreflights(() => Route.continue))

        requests = []
        const [text1, text2] = yield* page.evaluateInMainWorld(async (url) => {
          const response1 = await fetch(url, { method: "OPTIONS" })
          const text1 = await response1.text()
          const response2 = await fetch(url, { method: "GET" })
          const text2 = await response2.text()
          return [text1, text2]
        }, server.CROSS_PROCESS_PREFIX + "/something")
        // Preflight for OPTIONS is auto-fulfilled, then OPTIONS, then GET without preflight. Firefox is BiDi, as Chromium.
        const expected = browserName === "chromium" || browserName === "firefox"
          ? ["OPTIONS:/something", "GET:/something"]
          : ["OPTIONS:/something", "OPTIONS:/something", "GET:/something"]
        yield* softly([
          () => assert.strictEqual(text1, "Hello"),
          () => assert.strictEqual(text2, "World"),
          () => assert.deepStrictEqual(requests, expected)
        ])
      }
    }))

  test("RO-040", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route(
        "**/cars",
        answeringPreflights(() =>
          Route.fulfill(HttpServerResponse.jsonUnsafe(["electric", "gas"], {
            headers: { "Access-Control-Allow-Origin": "*" }
          }))
        )
      )
      const resp = yield* page.evaluateInMainWorld(async () => {
        const response = await fetch("https://example.com/cars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({ number: 1 })
        })
        return response.json()
      })
      assert.deepStrictEqual(resp, ["electric", "gas"])
    }))

  test("RO-041", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route(
        "**/cars",
        answeringPreflights(() =>
          Route.fulfill(HttpServerResponse.jsonUnsafe(["electric", "gas"], {
            headers: {
              "Access-Control-Allow-Origin": server.PREFIX,
              "Access-Control-Allow-Credentials": "true"
            }
          }))
        )
      )
      const resp = yield* page.evaluateInMainWorld(async () => {
        const response = await fetch("https://example.com/cars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({ number: 1 }),
          credentials: "include"
        })
        return response.json()
      })
      assert.deepStrictEqual(resp, ["electric", "gas"])
    }))

  test("RO-042", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/download", (request, response) => {
        if (allowCors(request, response)) return
        response.writeHead(302, { location: `${server.PREFIX}/file` })
        response.end()
      })
      server.setRoute("/file", (request, response) => {
        if (allowCors(request, response)) return
        response.end("file contents")
      })

      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/never-matches", () => Route.continue)
      const result = yield* page.evaluateInMainWorld(async (url) => {
        const response = await fetch(url, { credentials: "include", headers: { "X-App-Version": "1.2.3" } })
        return `${response.status} ${await response.text()}`
      }, server.CROSS_PROCESS_PREFIX + "/download")
      assert.strictEqual(result, "200 file contents")
    }))

  test("RO-043", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route(
        "**/cars",
        answeringPreflights(() =>
          // Playwright's original leaves out `Access-Control-Allow-Credentials`, so the credentialed fetch must fail
          Route.fulfill(HttpServerResponse.jsonUnsafe(["electric", "gas"], {
            headers: { "Access-Control-Allow-Origin": server.PREFIX }
          }))
        )
      )
      yield* failureOf(
        page.evaluateInMainWorld(async () => {
          const response = await fetch("https://example.com/cars", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            mode: "cors",
            body: JSON.stringify({ number: 1 }),
            credentials: "include"
          })
          return response.json()
        }),
        "the fetch"
      )
    }))

  test("RO-044", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route(
        "**/cars",
        answeringPreflights(({ request }) =>
          Route.fulfill(HttpServerResponse.jsonUnsafe([request.method, "electric", "gas"], {
            headers: { "Access-Control-Allow-Origin": "*" }
          }))
        )
      )
      // First POST
      {
        const resp = yield* page.evaluateInMainWorld(async () => {
          const response = await fetch("https://example.com/cars", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            mode: "cors",
            body: JSON.stringify({ number: 1 })
          })
          return response.json()
        })
        assert.deepStrictEqual(resp, ["POST", "electric", "gas"])
      }
      // Then DELETE
      {
        const resp = yield* page.evaluateInMainWorld(async () => {
          const response = await fetch("https://example.com/cars", {
            method: "DELETE",
            headers: {},
            mode: "cors",
            body: ""
          })
          return response.json()
        })
        assert.deepStrictEqual(resp, ["DELETE", "electric", "gas"])
      }
    }))

  // RO-045, RO-046, RO-047, RO-048: `times`, which Strider's routes don't have. See the ledger.

  test("RO-049", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      yield* page.goto(server.PREFIX + "/empty.html")
      const [request] = requests
      assert.isDefined(request)
      // The original reads `allHeaders()` in the route; Strider's raw headers are those sent, readable once it completes
      assert.isTrue(Boolean((yield* NetworkRequest.headersSent(page, request))["accept"]))
    }))

  // @see https://github.com/microsoft/playwright/issues/42620
  test("RO-050", ({ page, server }) =>
    Effect.gen(function*() {
      // `it.fail` on Chromium upstream: ported as written, and Strider's result stands
      const modes = ["cors", "no-cors", "same-origin"]
      yield* page.goto(server.EMPTY_PAGE)

      const routed = new Map<string, NetworkRequest.NetworkRequest>()
      yield* page.route("**/probe-*", ({ request }) =>
        Effect.sync(() => {
          routed.set(new URL(request.url).pathname, request)
        }).pipe(Effect.andThen(Route.continue)))

      const waits = yield* Effect.forEach(modes, (mode) => server.waitForRequest(`/probe-${mode}`))
      yield* page.evaluateInMainWorld(async (modes) => {
        for (const mode of modes) await (await fetch(`/probe-${mode}`, { mode: mode as RequestMode })).text()
      }, modes)
      const serverRequests = yield* Effect.all(waits)

      for (let i = 0; i < modes.length; i++) {
        const path = `/probe-${modes[i]}`
        const serverRequest = serverRequests[i]
        assert.isDefined(serverRequest)
        const onServer = secFetch(serverRequest.headers)
        const request = routed.get(path)
        assert.isDefined(request)
        // The server does receive the browser-computed Fetch Metadata.
        assert.deepStrictEqual(onServer, {
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": modes[i],
          "sec-fetch-dest": "empty"
        }, `${path} on server`)
        // The route handler should see the same headers.
        assert.deepStrictEqual(secFetch(request.headers), onServer, `${path} route.request().headers()`)
        // Playwright's `allHeaders()` is what was sent, which Strider reads once the request has completed.
        assert.deepStrictEqual(
          secFetch(yield* NetworkRequest.headersSent(page, request)),
          onServer,
          `${path} route.request().allHeaders()`
        )
      }
    }))

  test("RO-051", ({ page, server }) =>
    Effect.gen(function*() {
      const seen: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(seen))
      yield* page.goto(server.PREFIX + "/empty.html")
      const [request] = seen
      assert.isDefined(request)
      const response = yield* (yield* NetworkRequest.response(page, request))
      assert(Option.isSome(response), "the request has no response")
      assert.isTrue(Boolean(response.value.headers["content-type"]))
    }))

  test("RO-052", ({ page, server }) =>
    Effect.gen(function*() {
      const seen: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          seen.push(request)
        }).pipe(Effect.andThen(Route.fulfill(HttpServerResponse.text("Hello", { contentType: "text/html" })))))
      yield* page.goto(server.PREFIX + "/empty.html")
      const [request] = seen
      assert.isDefined(request)
      const response = yield* (yield* NetworkRequest.response(page, request))
      assert(Option.isSome(response), "the request has no response")
      assert.isTrue(Boolean(response.value.headers["content-type"]))
    }))

  // RO-053 (`route.${method}` throws when called twice): see the ledger.

  test("RO-054", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const posted: Array<string | undefined> = []
      const POST_BODY = "0".repeat(2 * 1024 * 1024) // 2MB
      yield* page.route("**/404.html", ({ requestBody }) =>
        Effect.gen(function*() {
          const body = yield* requestBody
          posted.push(
            Option.match(body, { onNone: () => undefined, onSome: (bytes) => new TextDecoder().decode(bytes) })
          )
          return yield* Route.abort()
        }))
      yield* page.evaluateInMainWorld(async (POST_BODY) => {
        await fetch("/404.html", { method: "POST", body: POST_BODY }).catch(() => {})
      }, POST_BODY)
      assert.deepStrictEqual(posted, [POST_BODY])
    }))

  test("RO-055", ({ page, server }) =>
    Effect.gen(function*() {
      let interceptions = 0
      const URL = server.PREFIX + "/serviceworkers/bug-33561/index.html"
      yield* page.route(URL, () =>
        Effect.sync(() => {
          interceptions++
        }).pipe(Effect.andThen(Route.continue)))

      yield* page.goto(URL)
      // The original's promise resolves with an `Event`, which doesn't cross by value: wait for it and return nothing
      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })
      yield* page.goto(URL)
      assert.strictEqual(interceptions, 2)
    }))

  // RO-056 (URLPattern's `ignoreCase`): see the ledger.

  test("RO-202", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/serviceworkers/slow-fallback/sw.html")
      // The original's promise resolves with an `Event`, which doesn't cross by value: wait for it and return nothing
      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })

      const handler = () => Route.fulfill(HttpServerResponse.text("mocked"))
      const first = yield* page.route("**/never-requested", handler)
      yield* first.remove
      // The service worker holds the request, so it reaches the network after interception is enabled again.
      const requested = yield* NetworkRequest.next(page, { url: "**/simple.json" })
      const body = yield* startWaiting(
        page.evaluateInMainWorld(() => fetch("/simple.json").then((response) => response.text()))
      )
      yield* requested
      yield* page.route("**/never-requested", handler)
      assert.strictEqual(yield* Fiber.join(body.fiber), "{\"foo\": \"bar\"}\n")
    }))
})
