/**
 * Playwright's `tests/page/page-request-fulfill.spec.ts`: a route answers a request with `route.fulfill`, from a status,
 * headers, a body (a string, bytes, a file, or JSON), or a response fetched from the server and then changed.
 *
 * What the port changes:
 * - `route.fulfill({ status, headers, contentType, body })` is `Route.fulfill` over an `HttpServerResponse` built from
 *   the same parts: `HttpServerResponse.text` for a string, `uint8Array` for bytes, and `jsonUnsafe` for `json`. A
 *   handler returns its decision, so the original's `void route.fulfill(…)` is returned from the handler.
 * - RO-099 checks that the `fulfill` call didn't throw. A Strider decision is applied after its handler returns, and a
 *   refusal is logged rather than raised to the handler, so that check has no counterpart. The port checks what the page
 *   received instead: the unassigned status and its status text, which a refused fulfill would not give.
 * - RO-100's `route.fulfill` after the page cancels the request is a decision on a request that has ended, so its
 *   no-throw step isn't observable. The cancellation assertions are kept, as in page-request-continue (RO-064).
 * - `route.fetch()` then `route.fulfill({ response })` (RO-110, RO-112, RO-117) is a response-phase route: Strider reads
 *   the paused response's body (`responseBody`) and fulfills with its status and headers, so the page gets the server's
 *   response from the one request, as download's DO-032 does. Those routes run on Chromium only, where a response can
 *   be read and fulfilled at that phase (see the ledger). `servedBy` is checked as `"route"`, which tells a fulfilled
 *   response from one that passed through, since the handler's failure would otherwise leave the default to continue.
 * - RO-107, RO-108, and RO-109 fulfill with a response fetched for another URL through an API request context
 *   (`playwright.request`, `page.request`). Strider has no request client, so the handler fetches it with the test
 *   process's own `fetch` and fulfills with that response's status, headers and body, as `fulfill({ response })` does. The
 *   context's cookies and storage, which `page.request` shares, play no part in the original's assertions.
 * - RO-101 and RO-102 compare a golden screenshot of the image (`toMatchSnapshot`). The port keeps what the golden
 *   shows that the bytes can show: the element's screenshot is the image's size, read from its PNG header
 *   (`pngSize`), as page-screenshot does.
 * - RO-103's `path` option is the file read by the caller, as page-screenshot does for `path`. Playwright takes the
 *   content type from the file's extension and ignores `contentType`, so the port passes the type the extension gives.
 * - RO-114 reads the HAR with the original's lookup. RO-115, RO-116, RO-118, and RO-119 read the response they wait for
 *   from `NetworkResponse`: its headers, or its body when the wait gives a `body` decoder, which is what the original's
 *   `response.body()` reads.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A `waitForFunction` is
 *   `Expect.that` over a read (RO-115), as in page-request-continue. `page.title()` is `page.title`.
 * - RO-113 is `it.fail` on Chromium upstream, and its WebKit skip is about Playwright's own validation, so it's ported on
 *   every browser and its body runs as written.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, NetworkRequest, NetworkResponse, PageNavigation, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import { HttpClientRequest, HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import type * as http from "node:http"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

const responseOfNavigation = (navigation: PageNavigation.PageNavigation): NetworkResponse.NetworkResponse =>
  Option.getOrThrow(responseOf(navigation))

const statusOf = (navigation: PageNavigation.PageNavigation): number | undefined =>
  Option.getOrUndefined(Option.map(responseOf(navigation), (response) => response.status))

const encode = (text: string) => new TextEncoder().encode(text)

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** A PNG's width and height, from its header. */
const pngSize = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  assert.deepStrictEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const pptrPng = new Uint8Array(fs.readFileSync(assetPath("playwright", "pptr.png")))

/**
 * Playwright's `route.request().headers()` sent back as they are: the request's own headers, which `continue` takes.
 * Used by RO-105 to show a continuation with the request's headers changes nothing the server receives.
 */
const withOwnHeaders = (request: NetworkRequest.NetworkRequest) =>
  Route.continueWith(HttpClientRequest.setHeaders(request.headers))

/**
 * Playwright's `route.fetch()` then `route.fulfill({ response })` on the page's own paused response: the response's body
 * is read, and the page gets its status and headers with that body, without a second request.
 */
const fulfillWithOwnResponse = Effect.fnUntraced(function*({ response, responseBody }: Route.ResponsePhase) {
  const bytes = yield* responseBody
  return yield* Route.fulfill(HttpServerResponse.uint8Array(bytes, {
    status: response.status,
    headers: response.headers
  }))
})

/** The response the test process's own `fetch` gets for `url`: what the original's API request context returns. */
const fetched = (url: string) =>
  Effect.promise(async () => {
    const response = await fetch(url)
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: new Uint8Array(await response.arrayBuffer())
    }
  })

/** A HAR entry, as far as the HAR lookup reads it. */
interface HarEntry {
  readonly request: { readonly url: string }
  readonly response: {
    readonly status: number
    readonly redirectURL: string
    readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
    readonly content: { readonly text?: string | undefined; readonly encoding?: string | undefined }
  }
}

const har = JSON.parse(fs.readFileSync(assetPath("playwright", "har-fulfill.har"), "utf-8")) as {
  readonly log: { readonly entries: ReadonlyArray<HarEntry> }
}

/** Playwright's `findResponse`: follows redirects in the HAR to the last entry, which is the response served. */
const findResponse = (url: string): HarEntry["response"] => {
  let entry: HarEntry | undefined
  const originalUrl = url
  let current = url
  while (current.trim()) {
    entry = har.log.entries.find((candidate) => candidate.request.url === current)
    current = entry?.response.redirectURL ?? ""
  }
  assert.isDefined(entry, originalUrl)
  return entry.response
}

upstream(import.meta.filename, {}, (test) => {
  test("RO-096", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("Yo, page!", {
          status: 201,
          headers: { foo: "bar" },
          contentType: "text/html"
        })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.status, 201)
      assert.strictEqual(response.headers["foo"], "bar")
      assert.strictEqual(yield* page.locator("body").readText, "Yo, page!")
    }))

  test("RO-097", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.uint8Array(encode("Yo, page!"), {
          status: 200,
          contentType: "text/plain"
        })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(yield* page.locator("body").readText, "Yo, page!")
    }))

  test("RO-098", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 422 })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.status, 422)
      assert.strictEqual(response.statusText, "Unprocessable Entity")
      assert.strictEqual(yield* page.locator("body").readText, "Yo, page!")
    }))

  test("RO-099", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's `fulfill` error is `undefined`. A refused fulfill is logged, not raised to the handler, so the
      // check is that the page received the unassigned status and its status text.
      yield* page.route("**/data.json", () => Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 430 })))
      yield* page.goto(server.EMPTY_PAGE)
      const response = yield* page.evaluateInMainWorld(async (url) => {
        const { status, statusText } = await fetch(url)
        return { status, statusText }
      }, server.PREFIX + "/data.json")
      assert.strictEqual(response.status, 430)
      assert.strictEqual(response.statusText, "Unknown")
    }))

  // @see https://github.com/microsoft/playwright/issues/28490
  test("RO-100", ({ page, server }) =>
    Effect.gen(function*() {
      const reached = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      // The original keeps the route and fulfills it after the page cancels the request
      yield* page.route("**/data.json", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(reached, undefined)
          yield* Deferred.await(released)
          // The original's `route.fulfill` after the cancellation: a decision on a request that has ended
          return yield* Route.fulfill(HttpServerResponse.empty({ status: 200 }))
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

  test("RO-101", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route(
        "**/*",
        () => Route.fulfill(HttpServerResponse.uint8Array(pptrPng, { contentType: "image/png" }))
      )
      yield* page.evaluateInMainWorld(async (prefix) => {
        const img = document.createElement("img")
        img.src = prefix + "/does-not-exist.png"
        document.body.appendChild(img)
        await new Promise((resolve) => img.onload = resolve)
      }, server.PREFIX)
      // The original's golden image: its size is what the bytes can show
      const screenshot = yield* page.screenshot({ area: { element: page.locator("img") } })
      assert.deepStrictEqual(pngSize(screenshot), pngSize(pptrPng))
    }))

  test("RO-102", ({ page, server }) =>
    Effect.gen(function*() {
      const svg =
        "<svg width=\"50\" height=\"50\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"10\" y=\"10\" width=\"30\" height=\"30\" stroke=\"black\" fill=\"transparent\" stroke-width=\"5\"/></svg>"
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text(svg, { contentType: "image/svg+xml ; charset=utf-8" })))
      yield* page.evaluateInMainWorld(async (prefix) => {
        const img = document.createElement("img")
        img.src = prefix + "/does-not-exist.svg"
        document.body.appendChild(img)
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
        })
      }, server.PREFIX)
      // The original's golden image: the SVG's own size, 50 by 50, is what the bytes can show
      const screenshot = yield* page.screenshot({ area: { element: page.locator("img") } })
      assert.deepStrictEqual(pngSize(screenshot), { width: 50, height: 50 })
    }))

  test("RO-103", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `path` takes the content type from the file's extension, and `contentType` is ignored
      yield* page.route(
        "**/*",
        () => Route.fulfill(HttpServerResponse.uint8Array(pptrPng, { contentType: "image/png" }))
      )
      yield* page.evaluateInMainWorld(async (prefix) => {
        const img = document.createElement("img")
        img.src = prefix + "/does-not-exist.png"
        document.body.appendChild(img)
        await new Promise((resolve) => img.onload = resolve)
      }, server.PREFIX)
      const screenshot = yield* page.screenshot({ area: { element: page.locator("img") } })
      assert.deepStrictEqual(pngSize(screenshot), pngSize(pptrPng))
    }))

  test("RO-104", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 200, headers: { foo: "true" } })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.headers["foo"], "true")
      assert.strictEqual(yield* page.locator("body").readText, "Yo, page!")
    }))

  test("RO-105", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      const interceptedRequests: Array<http.IncomingMessage> = []
      // The original's no-op route only enables interception, which disables caching in chromium. Strider's route
      // must decide, so it continues the request for a URL the test never fetches.
      yield* page.route(server.PREFIX + "/unused", () => Route.continue)
      server.setRoute("/something", (request, response) => {
        interceptedRequests.push(request)
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" })
        response.end("done")
      })
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url)
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      assert.strictEqual(text, "done")

      yield* page.route(server.CROSS_PROCESS_PREFIX + "/something", ({ request }) => withOwnHeaders(request))
      const textAfterRoute = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url)
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      assert.strictEqual(textAfterRoute, "done")

      assert.strictEqual(interceptedRequests.length, 2)
      assert.deepStrictEqual(interceptedRequests[1]?.headers, interceptedRequests[0]?.headers)
    }))

  test("RO-106", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html")
      const seen: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route(server.CROSS_PROCESS_PREFIX + "/something", ({ request }) =>
        Effect.gen(function*() {
          seen.push(request)
          return yield* Route.fulfill(HttpServerResponse.text("done", {
            contentType: "text/plain",
            headers: { "Access-Control-Allow-Origin": "*" }
          }))
        }))
      const text = yield* page.evaluateInMainWorld(async (url) => {
        const data = await fetch(url)
        return data.text()
      }, server.CROSS_PROCESS_PREFIX + "/something")
      assert.strictEqual(text, "done")
      assert.strictEqual(seen[0]?.headers["origin"], server.PREFIX)
    }))

  test("RO-107", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's `playwright.request.newContext()` is a fetch of the test process
      yield* page.route("**/*", () =>
        Effect.gen(function*() {
          const response = yield* fetched(server.PREFIX + "/simple.json")
          return yield* Route.fulfill(HttpServerResponse.uint8Array(response.body, {
            status: response.status,
            headers: response.headers
          }))
        }))
      const responded = yield* NetworkResponse.next(page, { url: server.EMPTY_PAGE, body: (message) => message.json })
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(statusOf(navigation), 200)
      assert.deepStrictEqual((yield* responded).body, { foo: "bar" })
    }))

  test("RO-108", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's `page.request.get` shares the context's cookies; a fetch of the test process has none, which the
      // assertions don't read
      yield* page.route("**/*", () =>
        Effect.gen(function*() {
          const response = yield* fetched(server.PREFIX + "/simple.json")
          return yield* Route.fulfill(HttpServerResponse.uint8Array(response.body, {
            status: response.status,
            headers: response.headers
          }))
        }))
      const responded = yield* NetworkResponse.next(page, { url: server.EMPTY_PAGE, body: (message) => message.json })
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(statusOf(navigation), 200)
      assert.deepStrictEqual((yield* responded).body, { foo: "bar" })
    }))

  test("RO-109", ({ page, server }) =>
    Effect.gen(function*() {
      // `headers` replaces the fetched response's own, so the status and these headers are what the page gets; the
      // original notes that the case of `Content-Type` matters
      yield* page.route("**/*", () =>
        Effect.gen(function*() {
          const response = yield* fetched(server.PREFIX + "/simple.json")
          return yield* Route.fulfill(HttpServerResponse.uint8Array(response.body, {
            status: 201,
            headers: { "Content-Type": "application/json", "foo": "bar" }
          }))
        }))
      const responded = yield* NetworkResponse.next(page, { url: server.EMPTY_PAGE, body: (message) => message.json })
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const navigated = responseOfNavigation(navigation)
      assert.strictEqual(navigated.status, 201)
      assert.strictEqual(navigated.headers["foo"], "bar")
      assert.deepStrictEqual((yield* responded).body, { foo: "bar" })
    }))

  test("RO-110", ({ page, server }) =>
    Effect.gen(function*() {
      // The original fetches the request again and fulfills with that response. Strider's response phase fulfills the
      // page's own paused response, which is the same response (the download's DO-032 pattern).
      yield* page.route("**/*", fulfillWithOwnResponse, { phase: "response" })
      const navigation = yield* page.goto(server.PREFIX + "/title.html")
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(responseOfNavigation(navigation).servedBy, "route")
      assert.strictEqual(yield* page.title, "Woof-Woof")
    }))

  test("RO-111", ({ page, server }) =>
    Effect.gen(function*() {
      const cookies = ["a=b", "c=d"]
      // Playwright joins the cookies with a newline and splits them again. A header's value is one string, so an array
      // for `Set-Cookie` would be joined with commas into one cookie: the response's own cookies, one `Set-Cookie` each,
      // are how a response carries several.
      yield* page.route("**/multiple-set-cookie.html", () =>
        Route.fulfill(
          HttpServerResponse.empty({
            status: 200,
            headers: { "X-Header-1": "v1", "X-Header-2": "v2" }
          }).pipe(HttpServerResponse.setCookiesUnsafe([["a", "b"], ["c", "d"]]))
        ))
      const navigation = yield* page.goto(server.PREFIX + "/multiple-set-cookie.html")
      const cookie = yield* page.evaluateInMainWorld(() => document.cookie)
      assert.deepStrictEqual(cookie.split(";").map((s) => s.trim()).sort(), cookies)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.headers["x-header-1"], "v1")
      assert.strictEqual(response.headers["x-header-2"], "v2")
    }))

  test("RO-112", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("Set-Cookie", ["a=b", "c=d"])
        response.setHeader("Content-Type", "text/html")
        response.end()
      })
      // The original fetches the request through an API context and fulfills with it: the page's own paused response
      yield* page.route("**/empty.html", fulfillWithOwnResponse, { phase: "response" })
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(responseOfNavigation(navigation).servedBy, "route")
      const cookie = yield* page.evaluateInMainWorld(() => document.cookie)
      assert.deepStrictEqual(cookie.split(";").map((s) => s.trim()).sort(), ["a=b", "c=d"])
    }))

  test("RO-113", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/empty.html", () =>
        Route.fulfill(HttpServerResponse.empty({ status: 200, headers: { "Set-Cookie": "a=b" } })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(responseOfNavigation(navigation).headers["set-cookie"], "a=b")
    }))

  test("RO-114", ({ page }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ request }) =>
        Effect.gen(function*() {
          const response = findResponse(request.url)
          const headers: Record<string, string> = {}
          for (const { name, value } of response.headers) headers[name] = value
          const encoding = (response.content.encoding ?? "utf-8") as BufferEncoding
          return yield* Route.fulfill(HttpServerResponse.uint8Array(
            new Uint8Array(Buffer.from(response.content.text ?? "", encoding)),
            { status: response.status, headers }
          ))
        }))
      yield* page.goto("http://no.playwright/")
      // The HAR contains a redirect for the script
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "value")), "foo")
      // The HAR contains a POST for the css file, but the lookup ignores the method, so the file is served
      yield* Expect.toHaveCSS(page.locator("body"), "background-color", "rgb(0, 255, 255)")
    }))

  test("RO-115", ({ page, server }) =>
    Effect.gen(function*() {
      const state = { intercepted: false }
      yield* page.route("**/one-style.css", () =>
        Effect.sync(() => {
          state.intercepted = true
        }).pipe(Effect.andThen(Route.fulfill(HttpServerResponse.text("body { background-color: green; }", {
          contentType: "text/css; charset=utf-8",
          headers: { "cache-control": "no-cache, no-store", custom: "value" }
        })))))
      const responded = yield* NetworkResponse.next(page, { url: "**/one-style.css" })
      yield* page.goto(server.PREFIX + "/preload.html")
      const response = yield* responded
      assert.strictEqual(response.headers["custom"], "value")
      // Playwright's `page.waitForFunction`: polled in the main world until the page sets the flag
      yield* Expect.that(
        page.evaluateInMainWorld(() => Reflect.get(window, "preloadedStyles")),
        Condition.make("truthy", (value) => Boolean(value))
      )
      assert.isTrue(state.intercepted)
      const color = yield* page.evaluateInMainWorld(() => window.getComputedStyle(document.body).backgroundColor)
      assert.strictEqual(color, "rgb(0, 128, 0)")
    }))

  test("RO-116", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/data.json", () =>
        Route.fulfill(HttpServerResponse.jsonUnsafe({ bar: "baz" }, { status: 201, headers: { foo: "bar" } })))
      // Playwright's `Promise.all` of `waitForResponse` and the fetch: the wait starts first
      const responded = yield* NetworkResponse.next(page, { url: "**/*" })
      const body = yield* page.evaluateInMainWorld(() =>
        fetch("./data.json").then((r) => r.text())
      )
      const response = yield* responded
      assert.strictEqual(response.status, 201)
      assert.strictEqual(response.headers["content-type"], "application/json")
      assert.strictEqual(body, JSON.stringify({ bar: "baz" }))
    }))

  // @see https://github.com/microsoft/playwright/issues/29261
  test("RO-117", ({ page, server }) =>
    Effect.gen(function*() {
      server.enableGzip("/one-style.html")
      const seen = { encoding: undefined as string | undefined }
      yield* page.route("**/one-style.html", (paused) =>
        Effect.gen(function*() {
          // The original's `route.fetch()` response, whose `content-encoding` is checked before it's fulfilled
          seen.encoding = paused.response.headers["content-encoding"]
          return yield* fulfillWithOwnResponse(paused)
        }), { phase: "response" })
      const captured = yield* NetworkResponse.next(page, {
        url: "**/one-style.html",
        body: (message) => message.text
      })
      const navigation = yield* page.goto(server.PREFIX + "/one-style.html")
      const served = yield* captured
      assert.strictEqual(seen.encoding, "gzip")
      assert.strictEqual(responseOfNavigation(navigation).servedBy, "route")
      yield* Expect.toHaveText(page.locator("div"), "hello, world!")
      yield* Expect.toHaveCSS(page.locator("body"), "background-color", "rgb(255, 192, 203)")
      assert.include(served.body, "<div>hello, world!</div>")
    }))

  test("RO-118", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/one-style.css", () =>
        Route.fulfill(HttpServerResponse.text("Not Found! (mocked)", { status: 404, contentType: "text/plain" })))
      let serverHit = false
      server.setRoute("/one-style.css", (_request, response) => {
        serverHit = true
        response.setHeader("Content-Type", "text/css")
        response.end("body { background-color: green; }")
      })
      const responded = yield* NetworkResponse.next(page, {
        url: "**/one-style.css",
        body: (message) =>
          message.text
      })
      yield* page.goto(server.PREFIX + "/one-style.html")
      const response = yield* responded
      assert.strictEqual(response.body, "Not Found! (mocked)")
      assert.isFalse(serverHit)
    }))

  test("RO-119", ({ page, server }) =>
    Effect.gen(function*() {
      for (const status of [100, 200, 404, 500]) {
        // The original's `it.step` per status, with its route removed after it (`page.unrouteAll()`)
        const bodyOverride = `Custom body ${status}`
        const registration = yield* page.route("**/one-style.css", () =>
          Route.fulfill(HttpServerResponse.text(bodyOverride, { status, contentType: "text/plain" })))
        const responded = yield* NetworkResponse.next(page, {
          url: "**/one-style.css",
          body: (message) =>
            message.text
        })
        yield* page.goto(server.PREFIX + "/one-style.html")
        const response = yield* responded
        assert.strictEqual(response.body, bodyOverride)
        yield* registration.remove
      }
    }))
})
