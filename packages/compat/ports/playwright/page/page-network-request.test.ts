/**
 * Playwright's `tests/page/page-network-request.spec.ts`: what a request reports (its frame, method, headers, post data,
 * navigation bit, resource type, redirect chain, and failure), and what its response and sent headers report.
 *
 * What the port changes:
 * - `page.on("request" | "response")` is read from the page's request and response histories. A page is fresh for each
 *   test, so its history is the whole of what the original's listener saw, and a read after a mark (`requestsSince`)
 *   gives the requests an action sent. Where the original waits for the next request of a URL, the port subscribes with
 *   `NetworkRequest.next` before the action.
 * - Strider reports a request per redirect hop, so a redirect's target is a request of its own (NE-004, NE-025). A route
 *   is asked about each hop its pattern matches, and WebKit pauses only a redirect's first hop (API.md, "What the
 *   backends do differs"). NE-005 keeps the original's count of what the route received, so it fails on Chromium and
 *   Firefox, where the route is asked about the redirect's target too.
 * - `request.frame()` is the request's initiator: a `Document` initiator names the navigable it was sent from, and
 *   `page.frames` gives each frame's id. Strider has no frame object that can fail to resolve, so NE-027 compares the
 *   initiator with the popup's id where the original expects `frame()` to throw while the popup's frame is unknown
 *   (matrix row `method-request-frame`).
 * - `request.headers()` is the request's `headers`, the headers its event gives, which leave out what the network adds
 *   (`Cookie` on Chromium and WebKit). `request.allHeaders()` is `NetworkRequest.headersSent`, the headers the request was
 *   sent with, which waits until the browser can attribute them. A response's `allHeaders()` is its `headers`.
 * - `request.postData()` is `NetworkRequest.next` with `body: (message) => message.text`, read from the captured body.
 *   `postDataBuffer()` is the body's `arrayBuffer`, `postDataJSON()` its `json`, and a form's `postDataJSON()` its
 *   `urlParamsBody` as a record (`UrlParams.toRecord`). A request without a body reads `None`, where Playwright's
 *   `postData()` is `null`.
 * - `page.goto`, `page.reload`, and `page.setContent` wait for `load` in Playwright and resolve at commit in Strider, so
 *   each one the original relies on the default for passes `waitUntil: "load"`.
 * - `page.evaluate` is `page.evaluateInMainWorld`, and a fetch's `Response` doesn't cross by value, so each fetch ends
 *   inside its evaluation.
 * - `page.route(…)` handlers return one decision as an Effect: `route.continue()` is `Route.continue`, and
 *   `route.continue({ headers })` is `Route.continueWith` over the header change. NE-014's `postData` argument, the body
 *   as it was sent, has no counterpart: a change that sets only a header leaves the body as sent. NE-010's cross-origin
 *   preflights are answered by `answeringPreflights`, as in page-route, since Chromium shows a route the preflight of a
 *   request it matches, where Playwright answers preflights itself.
 * - NE-013's `page.route("/post", …)` is the original's pattern as written. A glob with no wildcard matches only that
 *   exact string, so no request matches it in either library, and the test checks the requests alone.
 * - NE-020's `multipart/form-data` body is read on Firefox only. Chromium refuses a multipart body, since a file's
 *   completeness can't be established from its native report, and WebKit refuses it too (see the ledger).
 * - NE-027: `page.context().waitForEvent("request")` is `NetworkRequest.next` on the context, filtered to the popup's URL,
 *   and `waitForEvent("page")` is `Popup.next` on the page. The original's `response.finished()` is a
 *   `NetworkResponse.next` with a body, which resolves once the body has been read. The popup opens from a click, so it
 *   is a user gesture and needs no `Page.withUserGesture`.
 * - NE-029's font is `webfont/iconfont.woff2`, the vendored font. The original loads `webfont/iconfont2.woff`, which the
 *   pinned Playwright checkout doesn't contain. Whether the font is blocked as mixed content doesn't depend on its bytes.
 *   The original's `it.skip` for Firefox and WebKit isn't ours, so it runs on all three; Playwright's failure text is the
 *   event's `errorText` or else Chromium's `blockedReason`, and Strider reports the `errorText` alone.
 *   The `requestfailed` wait is `NetworkRequest.response`, which ends with no response for a request that failed, and the
 *   failure is then read with `NetworkRequest.failure`.
 * - Upstream's own `it.skip` and `it.fixme` aren't ours: NE-025 and NE-029 run on every browser, including the ones
 *   Playwright skips them on. NE-028's `it.fixme` for Firefox without BiDi doesn't apply, since Strider's Firefox is BiDi.
 * - NE-024's `request.headersArray()` is `NetworkRequest.headersSent`, compared with the server's raw headers by
 *   lower-cased name. Strider's headers are one Effect `Headers` value per name, lower-cased, so the case of the names
 *   the browser sent, which `headersArray()` keeps, isn't checked; the original sorts the pairs, so their order isn't
 *   checked either, and the browser sends the repeated `header-a` as one combined value. `headerValue(name)` is the
 *   header by name, `undefined` where Playwright's is `null` (matrix row `method-request-headersarray`).
 * - Playwright's `request.frame()`, `page.on("request")` and the like never report the browser's own `/favicon.ico`
 *   request; Strider reports every request, so the histories here leave that one out (`requestsOf`).
 */
import { assert } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, type Page, PageNavigation, Popup, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { HttpClientRequest, HttpServerResponse, UrlParams } from "effect/http"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import type * as http from "node:http"
import { assetPath, attachFrame, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

const statusOf = (navigation: PageNavigation.PageNavigation): number | undefined =>
  Option.getOrUndefined(Option.map(responseOf(navigation), (response) => response.status))

/** A navigation request, which is a document's request for its own navigation. */
const isNavigation = (request: NetworkRequest.NetworkRequest): boolean =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/** The navigable a request was sent from, when a document sent it: Playwright's `request.frame()`. */
const frameOf = (request: NetworkRequest.NetworkRequest): string | undefined =>
  request.initiator._tag === "Document" ? request.initiator.navigable : undefined

/** The ids of every frame in a frame tree, the page's own first and depth first: Playwright's `page.frames()` order. */
interface FrameIds {
  readonly id: string
  readonly children: ReadonlyArray<FrameIds>
}
const allFrameIds = (
  tree: FrameIds
): ReadonlyArray<string> => [tree.id, ...tree.children.flatMap((child) => allFrameIds(child))]

/**
 * Every request the page has made since it was created, which the original's `page.on("request")` collects, except the
 * browser's own request for `/favicon.ico`: Playwright never reports one, and the Chromium Strider launches sends it
 * some time after a page loads, so a count of the requests would depend on when the read happens.
 */
const requestsOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => new URL(request.url).pathname !== "/favicon.ico")
})

/** The requests a page has made since it had `mark` of them: those an action since then sent. */
const requestsSince = Effect.fnUntraced(function*(page: Page.ReadonlyPage, mark: number) {
  return (yield* requestsOf(page)).slice(mark)
})

/** Playwright's `allHeaders()` returns a plain object; Strider's headers are Effect `Headers`. */
const plain = (headers: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(headers))

/** Firefox doesn't send the `priority` header, so the server's copy of it is dropped for Firefox. */
const adjustServerHeaders = (headers: Record<string, unknown>, browserName: string) => {
  if (browserName === "firefox") delete headers["priority"]
  return headers
}

/** A handler that records each request it's given, then continues it: Playwright's `requests.push(route.request())`. */
const recording = (seen: Array<NetworkRequest.NetworkRequest>) => ({ request }: Route.RequestPhase) =>
  Effect.sync(() => {
    seen.push(request)
  }).pipe(Effect.andThen(Route.continue))

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
  test("NE-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(frameOf(requests[0]!), (yield* page.frames).id)
    }))

  test("NE-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const mark = (yield* requestsOf(page)).length
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const requests = yield* requestsSince(page, mark)
      assert.strictEqual(requests.length, 1)
      // Playwright's `page.frames()[1]`: the main frame's first child, in the tree's order
      assert.strictEqual(frameOf(requests[0]!), allFrameIds(yield* page.frames)[1])
    }))

  test("NE-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const mark = (yield* requestsOf(page)).length
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/digits/1.png")
      })
      const requests = yield* requestsSince(page, mark)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(frameOf(requests[0]!), (yield* page.frames).id)
    }))

  test("NE-004", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo.html", "/empty.html")
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      // A redirect is one request per hop, so the redirect's target is a request of its own
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]!.url, server.PREFIX + "/foo.html")
      assert.strictEqual(requests[1]!.url, server.PREFIX + "/empty.html")
    }))

  // https://github.com/microsoft/playwright/issues/3993
  test("NE-005", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo.html", "/empty.html")
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**", recording(requests))
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })

      assert.strictEqual(yield* page.url, server.PREFIX + "/empty.html")

      // The original's route is called for the first hop only. Strider's route is asked about the redirect's target too
      // on Chromium and Firefox, so this count fails there; WebKit pauses only the first hop, as the original does.
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]!.url, server.PREFIX + "/foo.html")
    }))

  test("NE-006", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The navigation's request, whose `headers` are the ones its event gives: Playwright's `headers()`
      const [request] = yield* requestsOf(page)
      assert.isDefined(request)
      const userAgent = request.headers["user-agent"] ?? ""
      if (browserName === "chromium") assert.include(userAgent, "Chrome")
      else if (browserName === "firefox") assert.include(userAgent, "Firefox")
      else if (browserName === "webkit") assert.include(userAgent, "WebKit")
    }))

  test("NE-007", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      let serverRequest: http.IncomingMessage | undefined
      server.setRoute("/empty.html", (request, response) => {
        serverRequest = request
        response.end("done")
      })
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      const [request] = yield* requestsOf(page)
      assert.isDefined(request)
      // Playwright's `allHeaders()`: the headers the request was sent with
      const headers = yield* NetworkRequest.headersSent(page, request)
      assert.isDefined(serverRequest)
      assert.deepStrictEqual(plain(headers), adjustServerHeaders({ ...serverRequest.headers }, browserName))
    }))

  test("NE-008", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      let serverRequest: http.IncomingMessage | undefined
      server.setRoute("/empty.html", async (request, response) => {
        serverRequest = request
        response.writeHead(200, { "foo": "bar" })
        await new Promise((resolve) => setTimeout(resolve, 3000))
        response.end("done")
      })

      // The original calls `request.allHeaders()` and `response.allHeaders()` when the request and the response are
      // seen, and awaits their promises after the navigation. Strider's `headersSent` is an effect, so each wait starts
      // when its event is read and is joined after the navigation.
      const requestWait = yield* NetworkRequest.next(page, { url: server.PREFIX + "/empty.html" })
      const responseWait = yield* NetworkResponse.next(page, { url: server.PREFIX + "/empty.html" })
      const requestHeaders = yield* startWaiting(
        Effect.gen(function*() {
          return yield* NetworkRequest.headersSent(page, yield* requestWait)
        })
      )
      const responseHeaders = yield* startWaiting(responseWait)

      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      const headers = yield* Fiber.join(requestHeaders.fiber)
      assert.isDefined(serverRequest)
      assert.deepStrictEqual(plain(headers), adjustServerHeaders({ ...serverRequest.headers }, browserName))

      const response = yield* Fiber.join(responseHeaders.fiber)
      assert.strictEqual(response.headers["foo"], "bar")
    }))

  test("NE-009", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      let serverRequest: http.IncomingMessage | undefined
      server.setRoute("/something", (request, response) => {
        serverRequest = request
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("done")
      })
      const requestWait = yield* NetworkRequest.next(page, { url: server.CROSS_PROCESS_PREFIX + "/something" })
      const responseWait = yield* NetworkResponse.next(page, { url: server.CROSS_PROCESS_PREFIX + "/something" })
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url)
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      assert.strictEqual(text, "done")
      yield* responseWait
      const headers = yield* NetworkRequest.headersSent(page, yield* requestWait)
      assert.isDefined(serverRequest)
      assert.deepStrictEqual(plain(headers), adjustServerHeaders({ ...serverRequest.headers }, browserName))
    }))

  test("NE-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })

      const requests: Array<string> = []
      server.setRoute("/something", (request, response) => {
        requests.push(request.method ?? "")
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
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("done")
      })
      // First check the browser will send preflight request when interception is OFF.
      {
        const text = yield* page.evaluateInMainWorld(async (url) => {
          const data = await fetch(url, {
            method: "DELETE",
            headers: { "X-PINGOTHER": "pingpong" }
          })
          return data.text()
        }, server.CROSS_PROCESS_PREFIX + "/something")
        assert.strictEqual(text, "done")
        assert.deepStrictEqual(requests, ["OPTIONS", "DELETE"])
      }

      // Now check the browser will NOT send preflight request when interception is ON. Firefox here is WebDriver BiDi, so
      // the original's Firefox-without-BiDi expectation doesn't apply, and every browser sends only the DELETE.
      {
        requests.length = 0
        const routed: Array<string> = []
        yield* page.route(
          "**/something",
          answeringPreflights(({ request }: Route.RequestPhase) =>
            Effect.sync(() => {
              routed.push(request.method)
            }).pipe(Effect.andThen(Route.continue))
          )
        )

        const text = yield* page.evaluateInMainWorld(async (url) => {
          const data = await fetch(url, {
            method: "DELETE",
            headers: { "X-PINGOTHER": "pingpong" }
          })
          return data.text()
        }, server.CROSS_PROCESS_PREFIX + "/something")
        assert.strictEqual(text, "done")
        // Check that there was no preflight (OPTIONS) request.
        assert.deepStrictEqual(routed, ["DELETE"])
        assert.deepStrictEqual(requests, ["DELETE"])
      }
    }))

  test("NE-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => res.end())
      const posted = yield* NetworkRequest.next(page, { url: server.PREFIX + "/post", body: (message) => message.text })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: JSON.stringify({ foo: "bar" }) })
      })
      const request = yield* posted
      assert.strictEqual(Option.getOrThrow(request.body), "{\"foo\":\"bar\"}")
    }))

  test("NE-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => res.end())
      const posted = yield* NetworkRequest.next(page, {
        url: server.PREFIX + "/post",
        body: (message) => message.arrayBuffer
      })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: new Uint8Array(Array.from(Array(256).keys())) })
      })
      const request = yield* posted
      const buffer = new Uint8Array(Option.getOrThrow(request.body))
      assert.strictEqual(buffer.length, 256)
      for (let i = 0; i < 256; ++i) assert.strictEqual(buffer[i], i)
    }))

  test("NE-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => res.end())
      // The original's pattern is `/post`, a glob with no wildcard, which matches no request; kept as written
      yield* page.route("/post", () => Route.continue)
      const posted = yield* NetworkRequest.next(page, {
        url: server.PREFIX + "/post",
        body: (message) => message.arrayBuffer
      })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: new Uint8Array(Array.from(Array(256).keys())) })
      })
      const request = yield* posted
      const buffer = new Uint8Array(Option.getOrThrow(request.body))
      assert.strictEqual(buffer.length, 256)
      for (let i = 0; i < 256; ++i) assert.strictEqual(buffer[i], i)
    }))

  test("NE-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      let received: http.IncomingMessage | undefined
      server.setRoute("/post", (req, res) => {
        received = req
        res.end()
      })
      // The original also passes `postData: request.postData()`, the body as sent; a change that sets a header leaves the
      // body as it was sent, so that argument has no counterpart.
      yield* page.route(
        "**/post",
        () =>
          Route.continueWith(
            HttpClientRequest.setHeader("content-type", "application/x-www-form-urlencoded; charset=UTF-8")
          )
      )
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: "foo=bar" })
      })
      assert.isDefined(received)
      assert.strictEqual(received.headers["content-type"], "application/x-www-form-urlencoded; charset=UTF-8")
    }))

  test("NE-015", ({ page, server }) =>
    Effect.gen(function*() {
      const posted = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE, body: (message) => message.text })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* posted
      assert.isTrue(Option.isNone(request.body))
    }))

  test("NE-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => res.end())
      const posted = yield* NetworkRequest.next(page, { url: server.PREFIX + "/post", body: (message) => message.json })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: JSON.stringify({ foo: "bar" }) })
      })
      const request = yield* posted
      assert.deepStrictEqual(Option.getOrThrow(request.body), { foo: "bar" })
    }))

  test("NE-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => res.end())
      const posted = yield* NetworkRequest.next(page, {
        url: server.PREFIX + "/post",
        body: (message) => message.urlParamsBody
      })
      yield* page.setContent(
        `<form method='POST' action='/post'><input type='text' name='foo' value='bar'><input type='number' name='baz' value='123'><input type='submit'></form>`,
        { waitUntil: "load" }
      )
      yield* page.locator("input[type=submit]").click()
      const request = yield* posted
      assert.deepStrictEqual(UrlParams.toRecord(Option.getOrThrow(request.body)), { foo: "bar", baz: "123" })
    }))

  test("NE-018", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const posted = yield* NetworkRequest.next(page, { url: "**/post", body: (message) => message.urlParamsBody })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: "foo=bar&baz=123"
        })
      })
      const request = yield* posted
      assert.deepStrictEqual(UrlParams.toRecord(Option.getOrThrow(request.body)), { foo: "bar", baz: "123" })
    }))

  test("NE-019", ({ page, server }) =>
    Effect.gen(function*() {
      const posted = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE, body: (message) => message.json })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* posted
      assert.isTrue(Option.isNone(request.body))
    }))

  test("NE-020", { browsers: ["firefox"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => res.end())
      yield* page.route("**/*", () => Route.continue)
      const posted = yield* NetworkRequest.next(page, { url: "**/post", body: (message) => message.text })
      yield* page.evaluateInMainWorld(async () => {
        const body = new FormData()
        body.set("name1", "value1")
        body.set("file", new File(["file-value"], "foo.txt"))
        body.set("name2", "value2")
        body.append("name2", "another-value2")
        await fetch("/post", { method: "POST", body })
      })
      const request = yield* posted
      const contentType = (yield* NetworkRequest.headersSent(page, request))["content-type"]
      const re = /^multipart\/form-data; boundary=(.*)$/
      const match = re.exec(contentType ?? "")
      assert.isNotNull(match, `the content type ${contentType} isn't multipart/form-data`)
      const b = match[1]!
      const expected =
        `--${b}\r\nContent-Disposition: form-data; name="name1"\r\n\r\nvalue1\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="foo.txt"\r\nContent-Type: application/octet-stream\r\n\r\nfile-value\r\n--${b}\r\nContent-Disposition: form-data; name="name2"\r\n\r\nvalue2\r\n--${b}\r\nContent-Disposition: form-data; name="name2"\r\n\r\nanother-value2\r\n--${b}--\r\n`
      assert.strictEqual(Option.getOrThrow(request.body), expected)
    }))

  test("NE-021", ({ page, server }) =>
    Effect.gen(function*() {
      const SSE_MESSAGE = { foo: "bar" }
      // 1. Setup server-sent events on server that immediately sends a message to the client.
      server.setRoute("/sse", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Connection": "keep-alive",
          "Cache-Control": "no-cache"
        })
        res.write(`data: ${JSON.stringify(SSE_MESSAGE)}\n\n`)
      })
      // 2. Subscribe to page request events.
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const mark = (yield* requestsOf(page)).length
      // 3. Connect to EventSource in browser and return first message.
      const message = yield* page.evaluateInMainWorld(() => {
        const eventSource = new EventSource("/sse")
        return new Promise((resolve) => {
          eventSource.onmessage = (e) => resolve(JSON.parse(e.data))
        })
      })
      assert.deepStrictEqual(message, SSE_MESSAGE)
      const requests = yield* requestsSince(page, mark)
      assert.strictEqual(requests[0]!.resourceType, "eventSource")
    }))

  test("NE-022", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rrredirect", "/frames/one-frame.html")
      yield* page.goto(server.PREFIX + "/rrredirect", { waitUntil: "load" })
      // The original keeps the last request of each file name, which is what the Map does here too
      const requests = new Map<string, NetworkRequest.NetworkRequest>()
      for (const request of yield* requestsOf(page)) requests.set(request.url.split("/").pop() ?? "", request)
      const named = (name: string) => {
        const request = requests.get(name)
        assert.isDefined(request, `no request for ${name}`)
        return request
      }
      assert.isTrue(isNavigation(named("rrredirect")))
      assert.isTrue(isNavigation(named("one-frame.html")))
      assert.isTrue(isNavigation(named("frame.html")))
      assert.isFalse(isNavigation(named("script.js")))
      assert.isFalse(isNavigation(named("style.css")))
    }))

  test("NE-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/pptr.png", { waitUntil: "load" })
      const [request] = yield* requestsOf(page)
      assert.isDefined(request)
      assert.isTrue(isNavigation(request))
    }))

  test("NE-024", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      let expectedHeaders: Record<string, string> = {}
      server.setRoute("/headers", (req, res) => {
        expectedHeaders = {}
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const name = req.rawHeaders[i]!.toLowerCase()
          const previous = expectedHeaders[name]
          expectedHeaders[name] = previous === undefined
            ? req.rawHeaders[i + 1]!
            : `${previous}, ${req.rawHeaders[i + 1]!}`
        }
        if (browserName === "firefox") delete expectedHeaders["priority"]
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, { url: server.PREFIX + "/headers" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/headers", {
          headers: [
            ["header-a", "value-a"],
            ["header-b", "value-b"],
            ["header-a", "value-a-1"],
            ["header-a", "value-a-2"]
          ]
        })
      })
      const headers = yield* NetworkRequest.headersSent(page, yield* sent)
      assert.deepStrictEqual(plain(headers), expectedHeaders)
      assert.strictEqual(headers["header-a"], "value-a, value-a-1, value-a-2")
      assert.isUndefined(headers["not-there"])
    }))

  test("NE-025", ({ page, server }) =>
    Effect.gen(function*() {
      server.setExtraHeaders("/redirect/1.html", { "sec-test-header": "1.html" })
      server.setExtraHeaders("/redirect/2.html", { "sec-test-header": "2.html" })
      server.setExtraHeaders("/empty.html", { "sec-test-header": "empty.html" })
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/empty.html")

      const expectedUrls = ["/redirect/1.html", "/redirect/2.html", "/empty.html"].map((s) => server.PREFIX + s)
      const expectedHeaders = ["1.html", "2.html", "empty.html"]

      yield* page.goto(server.PREFIX + "/redirect/1.html", { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      // The navigation's request is the chain's last hop; `redirects.from` walks back through the earlier hops
      const last = requests.at(-1)
      assert.isDefined(last)
      const redirects = yield* NetworkRequest.redirects(page)
      const redirectChain: Array<string> = []
      const headersChain: Array<string | undefined> = []
      let hop: NetworkRequest.NetworkRequest | undefined = last
      while (hop !== undefined) {
        redirectChain.unshift(hop.url)
        const response = Option.getOrThrow(yield* (yield* NetworkRequest.response(page, hop)))
        headersChain.unshift(response.headers["sec-test-header"])
        hop = Option.getOrUndefined(yield* redirects.from(hop))
      }

      assert.deepStrictEqual(redirectChain, expectedUrls)
      assert.deepStrictEqual(headersChain, expectedHeaders)
    }))

  test("NE-026", { browsers: ["chromium", "firefox"] }, ({ page, server }) =>
    Effect.gen(function*() {
      // The original's `/headers` route is never requested, since the test loads only the empty page, so it's left out.
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "myCookie=myValue"
        document.cookie = "myOtherCookie=myOtherValue"
      })
      const sent = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* sent
      const headers = yield* NetworkRequest.headersSent(page, request)
      assert.strictEqual(headers["cookie"], "myCookie=myValue; myOtherCookie=myOtherValue")
    }))

  test("NE-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<a target=_blank href="${server.EMPTY_PAGE}">click me</a>`)
      const requestWait = yield* NetworkRequest.next(page.context, { url: server.EMPTY_PAGE })
      const responseWait = yield* NetworkResponse.next(page.context, {
        url: server.EMPTY_PAGE,
        body: (message) => message.text
      })
      const popupWait = yield* Popup.next(page)
      const clicked = yield* startWaiting(page.getByText("click me").click())
      const request = yield* requestWait

      assert.isTrue(isNavigation(request))
      // Strider's initiator names the navigable the request was sent from, where Playwright's `frame()` throws until the
      // popup's frame is known. The popup is that navigable.
      const popup = yield* popupWait
      assert.strictEqual(frameOf(request), popup.id)

      yield* responseWait
      yield* Fiber.join(clicked.fiber)
    }))

  test("NE-028", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      let requestNumber = 0
      server.setRoute("/test.html", (_req, res) => {
        ++requestNumber
        const headers = {
          "cf-cache-status": "DYNAMIC",
          "Content-Type": "text/html;charset=UTF-8",
          "Last-Modified": "Fri, 05 Jan 2024 01:56:20 GMT",
          "Vary": "Access-Control-Request-Headers"
        }
        if (requestNumber === 1) res.writeHead(200, headers)
        else res.writeHead(304, "Not Modified", headers)
        res.write(`<div>Test</div>`)
        res.end()
      })
      const navigation1 = yield* page.goto(server.PREFIX + "/test.html", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation1), 200)
      // The reload's response, with its body: the original's `response2.text()`
      const reloaded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/test.html",
        body: (message) => message.text
      })
      yield* page.reload({ waitUntil: "load" })
      const response2 = yield* reloaded
      assert.strictEqual(requestNumber, 2)
      if (browserName === "chromium") {
        assert.strictEqual(response2.status, 200)
        assert.strictEqual(response2.statusText, "OK")
        assert.strictEqual(response2.body, "<div>Test</div>")
      } else {
        assert.strictEqual(response2.status, 304)
        assert.strictEqual(response2.statusText, "Not Modified")
      }
    }))

  test("NE-029", ({ page }) =>
    Effect.gen(function*() {
      yield* page.route("**/mixedcontent.html", () =>
        Route.fulfill(HttpServerResponse.text(
          `
        <!doctype html>
        <meta charset="utf-8">
        <style>
        @font-face {
          font-family: 'pwtest-iconfont';
          src: url('http://another.com/iconfont.woff2') format('woff2');
        }
        body {
          font-family: 'pwtest-iconfont';
        }
        </style>
        <span>+-</span>
    `,
          { status: 200, contentType: "text/html" }
        )))
      // The original's font is `webfont/iconfont2.woff`, which the pinned checkout lacks; the vendored font stands in.
      yield* page.route("**/iconfont.woff2", () =>
        Effect.gen(function*() {
          const body = yield* Effect.promise(() =>
            fs.promises.readFile(assetPath("playwright", "webfont/iconfont.woff2"))
          )
          return yield* Route.fulfill(HttpServerResponse.uint8Array(new Uint8Array(body)))
        }))

      const requestWait = yield* NetworkRequest.next(page, { url: "**/iconfont.woff2" })
      const navigation = yield* startWaiting(page.goto("https://example.com/mixedcontent.html", { waitUntil: "load" }))
      const request = yield* requestWait
      yield* Fiber.join(navigation.fiber)
      // A request that failed ends without a response: the wait the original's `requestfailed` event stands for
      assert.isTrue(Option.isNone(yield* (yield* NetworkRequest.response(page, request))))
      const headers = yield* NetworkRequest.headersSent(page, request)
      assert.isTrue(Boolean(headers["origin"]))
      const failure = yield* NetworkRequest.failure(page, request)
      assert(Option.isSome(failure), "the blocked request reported no failure")
      assert.strictEqual(failure.value.errorText, "mixed-content")
    }))
})
