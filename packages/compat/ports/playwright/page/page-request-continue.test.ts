/**
 * Playwright's `tests/page/page-request-continue.spec.ts`: what a route's continuation changes about a request (its
 * headers, method, URL and body), and what the browser sends on from there, including across redirects.
 *
 * What the port changes:
 * - `route.continue()` is `Route.continue`. `route.continue({ headers })` is `Route.continueWith` over the header
 *   changes: a header set is `HttpClientRequest.setHeader`, a header deleted (`undefined`) is `removeHeader`, and a
 *   headers object that is the request's own, sent back as it is, is `withOwnHeaders`. `method` is `setMethod`, `url` is
 *   `setUrl` (Firefox refuses it, see the ledger), and `postData` is `withPostData`. That sets the body with the request's
 *   own content type, as Playwright's does: `HttpClientRequest.setBody` drops the request's content type where the body
 *   has none, and Strider's `bodyUint8Array` would set `application/octet-stream`.
 * - A handler returns its decision when it runs. The original holds a route for later where it keeps the route object
 *   (RO-064), and that's the only place a route waits; the others decide at once, because nothing happens between
 *   getting the route and continuing it.
 * - Playwright calls a route once per request, and for a redirect only its first hop. Strider calls the route for each
 *   hop its pattern matches, and WebKit pauses only a redirect's first hop. Where the original reads what its route
 *   received, the port reads the first call, which is the one Playwright's route received (RO-094).
 * - Playwright re-applies a `continue` override to each redirect hop, so a header it set reaches the redirect's target
 *   (RO-083, RO-084, RO-085, RO-086, RO-090). Strider calls a route for each hop its pattern matches and applies a
 *   decision to that hop only, and these routes match only the first, so the tests are ported as written and expected
 *   to fail (see the ledger). RO-085's `route.fallback({ headers })` is `Route.continueWith` of those headers, as with
 *   no other route the two continue the request alike: Strider's `fallthrough` takes no changes.
 * - A paused request's headers can carry the `Cookie` the browser had when it paused the request (Chromium's do, RO-080),
 *   so a route that sends its request's headers back sends that value, not the cookie store's current one.
 * - Playwright's `request.headers()`, after a route's override, is the overridden headers. Strider's request is the
 *   one that was paused, so RO-060 reads the headers the request was sent with, `NetworkRequest.headersSent`, once it
 *   has completed. RO-062 reads the response's hop from the request history. RO-075's read of the
 *   request's `Origin` inside the route is left out, as the paused request has none (the network adds it).
 * - Playwright's `page.evaluate` runs in the page's main world: `page.evaluateInMainWorld`. A fetch's `Response` doesn't
 *   cross by value, so each evaluation ends with the fetch, or reads the body as text.
 * - `page.on("request" | "response" | "requestfailed" | "requestfinished")` (RO-074) has no Strider stream with those
 *   names. The request and response histories give the one request and the one response of the URL, joined by hop and
 *   ordered by their monotonic instants; the response's body, delivered once its hop has ended, is `response.finished()`,
 *   and the request's failure, read after it, is `requestfailed`.
 * - `page.waitForURL` is `Expect.toHaveURL`, started before the click it waits on (RO-091). `page.waitForFunction` is
 *   `Expect.that` over a read in the main world (RO-076). `page.locator(…).textContent()` is `readText`.
 * - A Strider handler's failure is logged and the default continues, so a route's `expect` would hide the failure. The
 *   handler records what it sees, and the test body asserts on the record (RO-094).
 * - RO-064's and RO-017's (in page-route) cancellation: the decision that follows the page's cancellation is applied to
 *   a request that has ended, so its no-throw step isn't observable, and the port keeps the cancellation assertions.
 * - RO-063: Playwright's `route.continue` refuses a protocol change with an error its handler sees. A Strider decision
 *   is applied after its handler returns, so the port asserts the refusal's effect, the page loading the request's
 *   own URL.
 * - RO-074 is `it.fail` on WebKit upstream: it's ported on every browser and its body runs as written, so Strider's
 *   result stands. RO-092's one-second wait and RO-075's are ported as written, with a comment at each.
 * - No CORS preflight reaches a route in this file (each route's pattern matches a request the page makes without
 *   one), so page-route's `answeringPreflights` isn't needed here.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, NetworkRequest, NetworkResponse, PageNavigation, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { pipe } from "effect/Function"
import { HttpBody, HttpClientRequest } from "effect/http"
import * as Option from "effect/Option"
import type * as http from "node:http"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

const statusOf = (navigation: PageNavigation.PageNavigation): number | undefined =>
  Option.getOrUndefined(Option.map(responseOf(navigation), (response) => response.status))

/** Playwright's `expect.soft`: every check runs, and any mismatch fails the test once they have all run. */
const softly = (checks: ReadonlyArray<() => void>): Effect.Effect<void> =>
  Effect.sync(() => {
    const mismatches: Array<string> = []
    for (const check of checks) {
      try {
        check()
      } catch (error) {
        mismatches.push(error instanceof Error ? error.message : String(error))
      }
    }
    assert.deepStrictEqual(mismatches, [])
  })

const encode = (text: string) => new TextEncoder().encode(text)

/**
 * Playwright's `route.continue({ headers: route.request().headers() })`: the request's own headers, sent back as they
 * are.
 */
const withOwnHeaders = (request: NetworkRequest.NetworkRequest) =>
  Route.continueWith(HttpClientRequest.setHeaders(request.headers))

/**
 * Playwright's `postData` override: the body replaced with `bytes`, with no content type of its own, so the request
 * keeps the one it has.
 */
const withPostData = (bytes: Uint8Array) => (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientRequest.setBody(HttpBody.raw(bytes, { contentType: request.headers["content-type"] }))(request)

upstream(import.meta.filename, {}, (test) => {
  test("RO-057", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.EMPTY_PAGE)
    }))

  test("RO-058", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright passes every header back with FOO added; Strider's change adds FOO and sends the rest as they were
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeader("FOO", "bar")))
      yield* page.goto(server.EMPTY_PAGE)
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz")
      })
      const request = yield* received
      assert.strictEqual(request.headers["foo"], "bar")
    }))

  test("RO-059", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeaders({ host: "bar", trailer: "baz" })))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      const serverRequest = yield* received
      assert.isUndefined(serverRequest.headers["trailer"])
      assert.strictEqual(serverRequest.headers["host"], new URL(server.EMPTY_PAGE).host)
    }))

  test("RO-060", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      server.setRoute("/something", (_request, response) => {
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("done")
      })
      const intercepted: Array<NetworkRequest.NetworkRequest> = []
      // The original's `request.allHeaders()` read only builds the headers the removal then drops, so no read is needed
      yield* page.route(server.PREFIX + "/something", ({ request }) =>
        Effect.sync(() => {
          intercepted.push(request)
        }).pipe(Effect.andThen(Route.continueWith(HttpClientRequest.removeHeader("foo")))))

      const received = yield* server.waitForRequest("/something")
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, { headers: { foo: "a", bar: "b" } })
        return data.text()
      }, server.PREFIX + "/something")
      const serverRequest = yield* received
      assert.strictEqual(text, "done")
      // The original reads the overridden headers from the request; Strider reads what was sent, once it has completed
      const [interceptedRequest] = intercepted
      assert.isDefined(interceptedRequest)
      const sent = yield* NetworkRequest.headersSent(page, interceptedRequest)
      assert.isUndefined(sent["foo"])
      assert.notOk(serverRequest.headers.foo)
      assert.strictEqual(serverRequest.headers.bar, "b")
    }))

  test("RO-061", ({ page, server }) =>
    Effect.gen(function*() {
      const sRequest = yield* server.waitForRequest("/sleep.zzz")
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setMethod("POST")))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz")
      })
      const request = yield* received
      assert.strictEqual(request.method, "POST")
      assert.strictEqual((yield* sRequest).method, "POST")
    }))

  test("RO-062", ({ page, server }) =>
    Effect.gen(function*() {
      const serverRequest = yield* server.waitForRequest("/global-var.html")
      yield* page.route(
        "**/foo",
        () => Route.continueWith(HttpClientRequest.setUrl(server.PREFIX + "/global-var.html"))
      )
      const navigation = yield* page.goto(server.PREFIX + "/foo")
      const response = Option.getOrThrow(responseOf(navigation))
      // Playwright's `response.request().url()` and `response.url()` are both the overridden URL: the request is the
      // response's hop, read from the history
      const hops = (yield* NetworkRequest.history(page, { url: "**/foo" })).entries
      assert.strictEqual(hops.find((hop) => hop.hop === response.hop)?.url, server.PREFIX + "/global-var.html")
      assert.strictEqual(response.url, server.PREFIX + "/global-var.html")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "globalVar")), 123)
      assert.strictEqual((yield* serverRequest).method, "GET")
    }))

  test("RO-063", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `route.continue` refuses a URL with another protocol, which its handler sees as an error. A Strider
      // decision is applied after the handler returns, so nothing raises to it: the refusal shows as the request going on
      // to its own URL, where a decision the browser accepted would send the page to `file:///tmp/foo`.
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setUrl("file:///tmp/foo")))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(navigation.url, server.EMPTY_PAGE)
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  // @see https://github.com/microsoft/playwright/issues/28490
  test("RO-064", ({ page, server }) =>
    Effect.gen(function*() {
      const reached = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      // The original keeps the route and continues it after the page cancels the request
      yield* page.route("**/data.json", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(released)
          // The original's `route.continue()` after the cancellation: a decision, which doesn't throw here
          return yield* Route.continue
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

  test("RO-065", ({ page, server }) =>
    Effect.gen(function*() {
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.route("**/foo", () =>
        Route.continueWith((self) =>
          pipe(self, HttpClientRequest.setUrl(server.EMPTY_PAGE), HttpClientRequest.setMethod("POST"))
        ))
      yield* page.goto(server.PREFIX + "/foo")
      assert.strictEqual((yield* request).method, "POST")
    }))

  test("RO-066", ({ page, server }) =>
    Effect.gen(function*() {
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setMethod("POST")))
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual((yield* request).method, "POST")
    }))

  test("RO-067", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continueWith(withPostData(encode("doggo"))))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "POST", body: "birdy" })
      })
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.body.toString("utf8"), "doggo")
    }))

  // @see https://github.com/microsoft/playwright/issues/16027
  test("RO-068", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const data = "a".repeat(7500)
      yield* page.route("**/*", () =>
        Route.continueWith((self) =>
          pipe(self, HttpClientRequest.setHeader("content-type", "application/json"), withPostData(encode(data)))
        ))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "PATCH", body: "birdy" })
      })
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.body.toString("utf8"), data)
      assert.strictEqual(serverRequest.headers["content-length"], String(data.length))
      assert.strictEqual(serverRequest.headers["content-type"], "application/json")
    }))

  test("RO-069", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () =>
        Route.continueWith((self) => pipe(self, HttpClientRequest.setMethod("POST"), withPostData(encode("doggo")))))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "GET" })
      })
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.method, "POST")
      assert.strictEqual(serverRequest.body.toString("utf8"), "doggo")
    }))

  test("RO-070", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continueWith(withPostData(encode("пушкин"))))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "POST", body: "birdy" })
      })
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.method, "POST")
      assert.strictEqual(serverRequest.body.toString("utf8"), "пушкин")
    }))

  test("RO-071", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continueWith(withPostData(encode("doggo-is-longer-than-birdy"))))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "POST", body: "birdy" })
      })
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.method, "POST")
      assert.strictEqual(serverRequest.body.toString("utf8"), "doggo-is-longer-than-birdy")
    }))

  test("RO-072", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const arr = Uint8Array.from({ length: 256 }, (_, i) => i)
      yield* page.route("**/*", () => Route.continueWith(withPostData(arr)))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "POST", body: "birdy" })
      })
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.method, "POST")
      const buffer = serverRequest.body
      assert.strictEqual(buffer.length, arr.length)
      for (let i = 0; i < arr.length; ++i) assert.strictEqual(arr[i], buffer[i])
    }))

  // @see https://github.com/microsoft/playwright/issues/16736
  test("RO-073", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route(`${server.PREFIX}/title.html`, () => Route.continueWith(withPostData(encode("{\"b\":2}"))))
      const received = yield* server.waitForRequest("/title.html")
      yield* page.evaluateInMainWorld(async (url) => {
        await fetch(url, {
          method: "POST",
          body: "{\"a\":1}",
          headers: { "content-type": "application/json" }
        })
      }, `${server.PREFIX}/title.html`)
      const request = yield* received
      assert.strictEqual(request.headers["content-type"], "application/json")
      assert.strictEqual(request.body.toString("utf-8"), "{\"b\":2}")
    }))

  // @see https://github.com/microsoft/playwright/issues/8796
  test("RO-074", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // `it.fail` on WebKit upstream: ported on every browser, and its body runs as written, so Strider's result stands
      let serverHeaders: http.IncomingHttpHeaders | undefined
      const serverRequests: Array<string> = []
      server.setRoute("/empty.html", (req, res) => {
        serverRequests.push(req.url ?? "")
        serverHeaders ??= req.headers
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        // Note: without 'onload', Firefox sometimes does not fire the load event over the protocol. The reason is unclear.
        res.end(`
      <div>Hello there!</div>
      <script>window.onload = () => console.log('onload')</script>
    `)
      })

      const intercepted: Array<string> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          intercepted.push(request.url)
        }).pipe(Effect.andThen(Route.continueWith(HttpClientRequest.setHeader("foo", "bar")))))
      // The original's `response.finished()` and its `requestfinished` listener: the response's body, read once its hop ends
      const finished = yield* NetworkResponse.next(page, { url: server.EMPTY_PAGE, body: (message) => message.text })
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.deepStrictEqual(intercepted, [server.EMPTY_PAGE])
      // There should be only one request to the server.
      if (browserName === "webkit") assert.deepStrictEqual(serverRequests, ["/empty.html", "/empty.html"])
      else assert.deepStrictEqual(serverRequests, ["/empty.html"])
      assert.strictEqual(serverHeaders?.["foo"], "bar")
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      const response = Option.getOrThrow(responseOf(navigation))
      yield* finished
      // The original's `events` are request, response, requestfinished: one request, answered after it was sent, that
      // finished and didn't fail, which the request and response histories and the request's failure say
      const requests = (yield* NetworkRequest.history(page, { url: server.EMPTY_PAGE })).entries
      const responses = (yield* NetworkResponse.history(page, { url: server.EMPTY_PAGE })).entries
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(responses.length, 1)
      const [request] = requests
      const [answer] = responses
      assert.isTrue(request!.at <= answer!.at)
      assert.strictEqual(request!.hop, answer!.hop)
      assert.strictEqual(response.hop, request!.hop)
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, request!)))
    }))

  test("RO-075", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      server.setRoute("/something", (_request, response) => {
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("done")
      })
      // The original deletes `origin` from the headers it read; Strider's removal of `origin` is the same change. Its
      // `interceptedOrigin` read of `allHeaders()` has no counterpart while the request is paused (the paused request
      // has no `Origin`: the network adds it), so that check is left out and the server's is kept
      yield* page.route(server.CROSS_PROCESS_PREFIX + "/something", () =>
        Route.continueWith(HttpClientRequest.removeHeader("origin")))

      const received = yield* server.waitForRequest("/something")
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url)
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      const serverRequest = yield* received
      assert.strictEqual(text, "done")
      assert.strictEqual(serverRequest.headers.origin, server.PREFIX)
    }))

  // @see https://github.com/microsoft/playwright/issues/16745
  test("RO-076", ({ page, server }) =>
    Effect.gen(function*() {
      let intercepted = false
      yield* page.route("**/one-style.css", () =>
        Effect.sync(() => {
          intercepted = true
        }).pipe(Effect.andThen(Route.continueWith(HttpClientRequest.setHeader("custom", "value")))))
      const received = yield* server.waitForRequest("/one-style.css")
      yield* page.goto(server.PREFIX + "/preload.html")
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.headers["custom"], "value")
      // Playwright's `page.waitForFunction`: polled in the main world until the page sets the flag
      yield* Expect.that(
        page.evaluateInMainWorld(() => Reflect.get(window, "preloadedStyles")),
        Condition.make("truthy", (value) => Boolean(value))
      )
      assert.isTrue(intercepted)
      const color = yield* page.evaluateInMainWorld(() => window.getComputedStyle(document.body).backgroundColor)
      assert.strictEqual(color, "rgb(255, 192, 203)")
    }))

  test("RO-077", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<a href=\"/set-cookie-redirect\">Set cookie</a>")
      server.setRoute("/set-cookie-redirect", (_request, response) => {
        response.writeHead(302, {
          "set-cookie": "foo=bar;  max-age=36000",
          "location": "/empty.html"
        })
        response.end()
      })
      yield* page.route("**/set-cookie-redirect", ({ request }) => withOwnHeaders(request))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/set-cookie-redirect")
      const serverRequest = yield* received
      const cookie = yield* page.evaluateInMainWorld(() => document.cookie)
      yield* softly([
        () => assert.strictEqual(serverRequest.headers["cookie"], "foo=bar"),
        () => assert.strictEqual(cookie, "foo=bar")
      ])
    }))

  test("RO-078", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/set-cookie", (_request, response) => {
        response.writeHead(200, { "Set-Cookie": "foo=bar;" })
        response.end()
      })
      yield* page.goto(server.PREFIX + "/set-cookie")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "foo=bar")
      server.setRedirect("/redirect", server.PREFIX + "/empty.html")
      yield* page.route("**/redirect", () => Route.continueWith(HttpClientRequest.setHeader("cookie", "override")))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/redirect")
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.headers["cookie"], "foo=bar")
    }))

  test("RO-079", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/set-cookie", (_request, response) => {
        response.writeHead(200, { "Set-Cookie": "foo=bar;" })
        response.end()
      })
      yield* page.goto(server.PREFIX + "/set-cookie")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "foo=bar")
      yield* page.route("**", () =>
        Route.continueWith((self) =>
          pipe(self, HttpClientRequest.setHeader("cookie", "override"), HttpClientRequest.setHeader("custom", "value"))
        ))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      const serverRequest = yield* received
      // Original cookie from the browser's cookie jar should be sent.
      assert.strictEqual(serverRequest.headers["cookie"], "foo=bar")
      assert.strictEqual(serverRequest.headers["custom"], "value")
    }))

  // @see https://github.com/microsoft/playwright/issues/41428
  test("RO-080", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/set-cookie", (_request, response) => {
        response.writeHead(200, { "Set-Cookie": "foo=v1;" })
        response.end()
      })
      yield* page.goto(server.PREFIX + "/set-cookie")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "foo=v1")

      yield* page.route("**/empty.html", ({ request }) =>
        Effect.gen(function*() {
          // Cookie store changes between interception and continuation.
          yield* page.context.cookies.set({ name: "foo", value: "v2", scope: { url: server.PREFIX } })
          return yield* withOwnHeaders(request)
        }))

      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      const serverRequest = yield* received
      // The fresh cookie from the browser cookie store should be sent, not the stale captured value.
      assert.strictEqual(serverRequest.headers["cookie"], "foo=v2")
    }))

  // @see https://github.com/microsoft/playwright/issues/41428
  test("RO-081", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/set-cookie", (_request, response) => {
        response.writeHead(200, { "Set-Cookie": "foo=v1;" })
        response.end()
      })
      yield* page.goto(server.PREFIX + "/set-cookie")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "foo=v1")

      // The redirect updates the cookie before bouncing to the final destination.
      server.setRoute("/redirect", (_request, response) => {
        response.writeHead(302, { "Set-Cookie": "foo=v2;", "location": server.PREFIX + "/empty.html" })
        response.end()
      })

      yield* page.route("**/redirect", ({ request }) => withOwnHeaders(request))

      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/redirect")
      const serverRequest = yield* received
      // The redirected request should carry the cookie updated by the redirect, not the stale captured value.
      assert.strictEqual(serverRequest.headers["cookie"], "foo=v2")
    }))

  // @see https://github.com/microsoft/playwright/issues/35168
  test("RO-082", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/set-cookie", (_request, response) => {
        response.writeHead(200, { "Set-Cookie": "foo=bar;" })
        response.end()
      })
      yield* page.goto(server.PREFIX + "/set-cookie")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "foo=bar")

      server.setRoute("/delete-cookie", (_request, response) => {
        response.writeHead(200, { "Set-Cookie": "foo=bar; expires=Thu, 01 Jan 1970 00:00:00 GMT" })
        response.end()
      })
      server.setRedirect("/redirect", "/delete-cookie")
      yield* page.route("**/redirect", ({ request }) => withOwnHeaders(request))
      yield* page.goto(server.PREFIX + "/redirect")
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      const serverRequest = yield* received
      assert.notOk(serverRequest.headers["cookie"])
    }))

  test("RO-083", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect", "/empty.html")
      yield* page.route("**/redirect", ({ request }) =>
        Route.continueWith((self) =>
          pipe(self, HttpClientRequest.setHeaders(request.headers), HttpClientRequest.setHeader("custom", "value"))
        ))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/redirect")
      const serverRequest = yield* received
      assert.strictEqual(serverRequest.headers["custom"], "value")
    }))

  // @see https://github.com/microsoft/playwright/issues/36029
  test("RO-084", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)

      server.setRedirect("/redirect", "/empty.html")
      yield* page.route("**/redirect", ({ request }) =>
        Route.continueWith((self) =>
          pipe(self, HttpClientRequest.setHeaders(request.headers), HttpClientRequest.setHeader("custom", "value"))
        ))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.evaluateInMainWorld(async (url) => {
        await fetch(url, { method: "POST", body: "foo" })
      }, server.PREFIX + "/redirect")
      const serverRequest = yield* received
      yield* softly([
        () =>
          assert.strictEqual(serverRequest.method, "GET"),
        () =>
          assert.isUndefined(serverRequest.headers["content-length"]),
        () => assert.isUndefined(serverRequest.headers["content-type"]),
        () => assert.strictEqual(serverRequest.headers["custom"], "value")
      ])
    }))

  test("RO-085", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect", "/empty.html")
      // `route.fallback({ headers })` with no other route continues the request with those headers
      yield* page.route("**/redirect", ({ request }) =>
        Route.continueWith((self) =>
          pipe(self, HttpClientRequest.setHeaders(request.headers), HttpClientRequest.setHeader("custom", "value"))
        ))

      const received = yield* server.waitForRequest("/empty.html")
      const navigation = yield* page.goto(server.PREFIX + "/redirect")
      const serverRequest = yield* received
      const response = Option.getOrThrow(responseOf(navigation))
      assert.strictEqual(serverRequest.headers["custom"], "value")
      // `response.request()` is the request of the response's hop: the redirect's target
      assert.strictEqual(response.url, server.EMPTY_PAGE)
      const hops = (yield* NetworkRequest.history(page, { url: server.EMPTY_PAGE })).entries
      const request = hops.find((hop) =>
        hop.hop === response.hop
      )
      assert.isDefined(request)
      assert.strictEqual(request.headers["custom"], "value")
      assert.strictEqual((yield* NetworkRequest.headersSent(page, request))["custom"], "value")
    }))

  // @see https://github.com/microsoft/playwright/issues/13106
  test("RO-086", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      server.setRoute("/something", (_request, response) => {
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("done")
      })
      server.setRedirect("/redirect", "/something")
      yield* page.route("**/redirect", () => Route.continueWith(HttpClientRequest.removeHeader("foo")))
      const received = yield* server.waitForRequest("/something")
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, { headers: { foo: "a" } })
        return data.text()
      }, server.PREFIX + "/redirect")
      const serverRequest = yield* received
      assert.strictEqual(text, "done")
      assert.notOk(serverRequest.headers.foo)
    }))

  test("RO-090", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // Playwright re-applies the route's `authorization` to the cross-origin redirect's hop, so Chromium and Firefox
      // send it; WebKit's redirect hop isn't paused, so its native behavior stands. Ledgered for Chromium and Firefox.
      yield* page.goto(server.PREFIX + "/empty.html")
      let resolve: (request: http.IncomingMessage) => void = () => {}
      const serverRequestPromise = new Promise<http.IncomingMessage>((f) => resolve = f)
      server.setRoute("/something", (request, response) => {
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Origin": server.PREFIX,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "authorization,cookie,custom"
          })
          response.end()
          return
        }
        resolve(request)
        response.writeHead(200, {
          "Access-Control-Allow-Origin": server.PREFIX,
          "Access-Control-Allow-Credentials": "true"
        })
        response.end("done")
      })
      server.setRoute("/redirect", (_request, response) => {
        response.writeHead(301, { location: `${server.CROSS_PROCESS_PREFIX}/something` })
        response.end()
      })
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "a=b"
      })
      yield* page.route("**/redirect", ({ request }) =>
        Route.continueWith((self) =>
          pipe(
            self,
            HttpClientRequest.setHeaders(request.headers),
            HttpClientRequest.setHeader("authorization", "credentials"),
            HttpClientRequest.setHeader("custom", "foo")
          )
        ))
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, {
          headers: { authorization: "none" },
          credentials: "include"
        })
        return data.text()
      }, server.PREFIX + "/redirect")
      assert.strictEqual(text, "done")
      const serverRequest = yield* Effect.promise(() => serverRequestPromise)
      yield* softly([
        () => {
          if (browserName === "webkit") assert.notOk(serverRequest.headers["authorization"])
          else assert.strictEqual(serverRequest.headers["authorization"], "credentials")
        },
        () => assert.notOk(serverRequest.headers["cookie"]),
        () => assert.strictEqual(serverRequest.headers["custom"], "foo")
      ])
    }))

  test("RO-087", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      let resolve: (request: http.IncomingMessage) => void = () => {}
      const serverRequestPromise = new Promise<http.IncomingMessage>((f) => resolve = f)
      server.setRoute("/something", (request, response) => {
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Origin": server.PREFIX,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "authorization,cookie,custom"
          })
          response.end()
          return
        }
        resolve(request)
        response.writeHead(200, {})
        response.end("done")
      })
      server.setRedirect("/redirect", "/something")
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "a=b"
      })
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, {
          headers: { authorization: "credentials", custom: "foo" },
          credentials: "include"
        })
        return data.text()
      }, server.PREFIX + "/redirect")
      assert.strictEqual(text, "done")
      const serverRequest = yield* Effect.promise(() => serverRequestPromise)
      yield* softly([
        () => assert.strictEqual(serverRequest.headers["authorization"], "credentials"),
        () => assert.strictEqual(serverRequest.headers["cookie"], "a=b"),
        () => assert.strictEqual(serverRequest.headers["custom"], "foo")
      ])
    }))

  test("RO-088", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      let resolve: (request: http.IncomingMessage) => void = () => {}
      const serverRequestPromise = new Promise<http.IncomingMessage>((f) => resolve = f)
      server.setRoute("/something", (request, response) => {
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Origin": server.PREFIX,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "authorization,custom"
          })
          response.end()
          return
        }
        resolve(request)
        response.writeHead(200, {
          "Access-Control-Allow-Origin": server.PREFIX,
          "Access-Control-Allow-Credentials": "true"
        })
        response.end("done")
      })
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, {
          headers: { authorization: "credentials", custom: "foo" },
          credentials: "include"
        })
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      assert.strictEqual(text, "done")
      const serverRequest = yield* Effect.promise(() => serverRequestPromise)
      yield* softly([
        () => assert.strictEqual(serverRequest.headers["authorization"], "credentials"),
        () => assert.strictEqual(serverRequest.headers["custom"], "foo")
      ])
    }))

  test("RO-089", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      let resolve: (request: http.IncomingMessage) => void = () => {}
      const serverRequestPromise = new Promise<http.IncomingMessage>((f) => resolve = f)
      server.setRoute("/something", (request, response) => {
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Origin": server.PREFIX,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "authorization,cookie,custom"
          })
          response.end()
          return
        }
        resolve(request)
        response.writeHead(200, {
          "Access-Control-Allow-Origin": server.PREFIX,
          "Access-Control-Allow-Credentials": "true"
        })
        response.end("done")
      })
      server.setRoute("/redirect", (_request, response) => {
        response.writeHead(301, { location: `${server.CROSS_PROCESS_PREFIX}/something` })
        response.end()
      })
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "a=b"
      })
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url, {
          headers: { authorization: "credentials", custom: "foo" },
          credentials: "include"
        })
        return data.text()
      }, server.PREFIX + "/redirect")
      assert.strictEqual(text, "done")
      const serverRequest = yield* Effect.promise(() => serverRequestPromise)
      // Authorization header not propagated to cross-origin redirect.
      yield* softly([
        () => assert.notOk(serverRequest.headers["authorization"]),
        () => assert.notOk(serverRequest.headers["cookie"]),
        () => assert.strictEqual(serverRequest.headers["custom"], "foo")
      ])
    }))

  test("RO-091", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/final", (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" })
        response.end("<!doctype html><title>final</title><p>ok</p>")
      })
      // Cross-origin 307 redirect that preserves the POST method.
      server.setRoute("/redirect307", (_request, response) => {
        response.writeHead(307, { location: `${server.PREFIX}/final` })
        response.end()
      })

      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.setContent(`
    <form id="f" method="POST" action="${server.CROSS_PROCESS_PREFIX}/redirect307">
      <input type="submit">
    </form>`)

      yield* page.route("**/*", () => Route.continue)
      // Playwright's `waitForURL` runs alongside the click, so it starts first
      const arrived = yield* startWaiting(Expect.toHaveURL(page, `${server.PREFIX}/final`))
      yield* page.locator("input").click()
      yield* Fiber.join(arrived.fiber)
      yield* Expect.toHaveText(page.locator("p"), "ok")
    }))

  // @see https://github.com/microsoft/playwright/issues/19158
  test("RO-092", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/test.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(`
    <style>
      @keyframes JNDzq {
        0% { background-position: 0 0 }
        to { background-position: 100 0 }
      }
      div {
        --background: url(/pptr.png);
        background-image: var(--background);
        animation: JNDzq 1s linear infinite;
      }
    </style>
    <div>Yo!</div>`)
      })
      const intercepted = yield* Deferred.make<void>()
      let interceptedRequests = 0
      yield* page.route(server.PREFIX + "/pptr.png", () =>
        Effect.sync(() => {
          interceptedRequests++
        }).pipe(Effect.andThen(Deferred.succeed(intercepted, undefined)), Effect.andThen(Route.continue)))
      yield* page.goto(server.PREFIX + "/test.html")
      assert.strictEqual(yield* page.locator("div").readText, "Yo!")
      yield* Deferred.await(intercepted)
      // The original's `page.waitForTimeout(1000)`, as written
      yield* Effect.sleep("1 second")
      assert.strictEqual(interceptedRequests, 1)
    }))

  // @see https://github.com/microsoft/playwright/issues/19158
  test("RO-093", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      server.setRoute("/upload", (_request, response) => {
        response.writeHead(200, { "Content-Type": "text/plain" })
        response.end("done")
      })
      const sendFormData = Effect.gen(function*() {
        const received = yield* server.waitForRequest("/upload")
        const status = yield* page.evaluateInMainWorld(async () => {
          const newFile = new File(["file content"], "file.txt")
          const formData = new FormData()
          formData.append("file", newFile)
          const response = await fetch("/upload", {
            method: "POST",
            credentials: "include",
            body: formData
          })
          return response.status
        })
        const request = yield* received
        assert.strictEqual(status, 200)
        return request
      })
      const reqBefore = yield* sendFormData
      yield* page.route("**/*", () => Route.continue)
      const reqAfter = yield* sendFormData
      const fileContent = [
        "Content-Disposition: form-data; name=\"file\"; filename=\"file.txt\"",
        "Content-Type: application/octet-stream",
        "",
        "file content",
        "------"
      ].join("\r\n")
      yield* softly([
        () => assert.include(reqBefore.body.toString("utf8"), fileContent),
        () => assert.include(reqAfter.body.toString("utf8"), fileContent)
      ])
    }))

  // @see https://github.com/microsoft/playwright/issues/36719
  test("RO-094", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const redirectTargetPath = "/final"
      const redirectSourcePath = "/redirect"

      let redirectedHost: string | undefined
      server.setRoute(redirectTargetPath, (req, res) => {
        redirectedHost = req.headers["host"]
        res.end("OK")
      })

      let firstHost: string | undefined
      server.setRoute(redirectSourcePath, (req, res) => {
        firstHost = req.headers["host"]
        res.writeHead(302, { location: `${server.CROSS_PROCESS_PREFIX}${redirectTargetPath}` })
        res.end()
      })

      // The route's headers are recorded; the test asserts on the first call, which is Playwright's one call. Strider's
      // route is also called for the redirect's hop, which Playwright's isn't.
      const seen: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          seen.push(request)
        }).pipe(Effect.andThen(withOwnHeaders(request))))

      const response = yield* page.goto(server.PREFIX + redirectSourcePath)
      const [first] = seen
      assert.isDefined(first)
      if (browserName === "firefox") assert.isDefined(first.headers["host"])
      else assert.isUndefined(first.headers["host"])
      assert.strictEqual(statusOf(response), 200)
      assert.strictEqual(firstHost, new URL(server.PREFIX).host)
      assert.strictEqual(redirectedHost, new URL(server.CROSS_PROCESS_PREFIX).host)
    }))

  // @see https://github.com/microsoft/playwright/issues/36719
  test("RO-095", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.continueWith(withPostData(new Uint8Array())))
      const sent = yield* NetworkRequest.next(page, { url: "**", body: (message) => message.text })
      yield* page.evaluateInMainWorld(async (url) => {
        await fetch(url, { method: "POST", body: "original" })
      }, server.PREFIX + "/sleep.zzz")
      const request = yield* sent
      assert.deepStrictEqual(request.body, Option.some(""))
    }))
})
