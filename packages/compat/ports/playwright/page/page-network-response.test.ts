/**
 * Playwright's `tests/page/page-network-response.spec.ts`: what a response reports (its status, status text, HTTP
 * version, headers, and body, decoded as text, JSON, or bytes), its end and the request it answers, and what a body
 * read does once the browser no longer holds the response.
 *
 * What the port changes:
 * - A navigation's response is `goto`'s `PageNavigation.response`, which has no body. A test that reads a navigation's
 *   body subscribes with a `body` decoder before the navigation, and `goto` resolves at commit, so the port waits for
 *   the subscription after it. A body is delivered once it has loaded, so a test that reads a response's status before
 *   its body subscribes to the same response without one, which is delivered on arrival.
 * - Strider's response headers are one `Headers` value per name, lower-cased, with no list of separate values (matrix
 *   row `method-response-headersarray`). NE-031 and NE-045 assert what the original asserts of `headers()`, a repeated
 *   header's values joined with a comma, so they fail where Strider reports another form. NE-043 reads
 *   `headersArray()`, the values one by one, which Strider can't give: it is in the ledger, not ported. NE-044 checks
 *   Playwright's own `headerValue('set-cookie')`, which joins the cookie lines with a newline; its `headersArray()` and
 *   `headerValues()` checks read the same lines by splitting that value. NE-045's `headers()` and `allHeaders()` are one
 *   accessor in Strider, so their equality isn't a separate check.
 * - Strider reports a response's `httpVersion` as the browser names it (`http/1.1`), where Playwright says `HTTP/1.1`.
 * - `response.request()` has no counterpart on a response. A response and its request share a hop, so NE-054 finds the
 *   request by its hop and reads the response back from it with `NetworkRequest.response`.
 * - A redirect hop has no body. NE-036 reads the 302 with `NetworkRequest.response` and the body with a body
 *   subscription, which fails with `BodyUnavailable` reason `redirect`: the typed reason is what the port asserts.
 * - Strider's responses carry their body from the moment they're delivered, so a body read can't follow a navigation
 *   that left its response behind. NE-057 is in the ledger (matrix row `method-response-body`), not ported.
 * - `response.finished()` isn't a Strider call. NE-037 reads whether the response has ended from
 *   `NetworkRequest.timing`'s `responseEnd`, which is set only after a successful transfer, on a page whose context asks
 *   for timing. Playwright's `requestfinished` listener has no Strider counterpart.
 * - `page.evaluate` is `page.evaluateInMainWorld`. A fetch that the original awaits as a response is awaited in the page
 *   the same way, and its body is read through the subscription, not through the fetch's `Response`.
 * - NE-047's `it.fail` on Chromium and WebKit is the original's expectation that it fails there (Playwright issue
 *   11035); the port asserts the original's check as written, so a failure on Chromium is that known issue, reported as
 *   it is.
 * - The fixture server's brotli is a route that sends the vendored file compressed. `server.setRoute` takes the place of
 *   the asset for that path, until the next test. Its gzip is the fixture server's own `server.enableGzip`.
 * - a route for every URL fulfils a navigation with `HttpServerResponse.text`, which carries the headers the original
 *   sets with `headers`.
 * - Playwright's `it.skip` and `it.fixme` on other browsers and platforms aren't ours: each test runs on every browser
 *   the file names, and a skip or fixme condition is for another platform or browser build.
 * - NE-049's service worker is the vendored `serviceworkers/fetch` page, which waits for its activation promise in the
 *   page's main world. The worker answers `example.txt` itself, so no file is needed under that name.
 * - NE-050's `prefetch.html` is vendored. The original's `page.waitForResponse` and `page.goto` run together, and the
 *   port starts its body subscription before the navigation.
 * - NE-052's `page.frame({ url })` is the one `iframe` on `one-frame.html`, and its `fetch` runs in that frame's window
 *   through `contentWindow`, the same main world as the original's frame evaluation.
 * - NE-053 reads the response log for the request's answer before the response is sent, where Playwright's
 *   `existingResponse()` returns `null`: Strider's `NetworkRequest.response` waits for the answer, so it can't report
 *   "not yet". The answer appears in `NetworkResponse.history` only once the server has responded.
 * - NE-056 tests the page's own `Response.formData()`, not Playwright's, and runs in the page's main world as the
 *   original does.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse, type Page, type PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import type * as http from "node:http"
import { pathToFileURL } from "node:url"
import * as zlib from "node:zlib"
import { assetPath, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

/** The response of a navigation that has one, where the test expects one. */
const responseFrom = (navigation: PageNavigation.PageNavigation): NetworkResponse.NetworkResponse => {
  const response = responseOf(navigation)
  assert.isTrue(Option.isSome(response), "the navigation has no response")
  return Option.getOrThrow(response)
}

/**
 * Every request the page has made since it was created, except the browser's own request for `/favicon.ico`, which
 * Playwright never reports and the Chromium Strider launches sends after a page loads.
 */
const requestsOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => new URL(request.url).pathname !== "/favicon.ico")
})

/** Playwright's `allHeaders()` returns a plain object; Strider's headers are Effect `Headers`. */
const plain = (headers: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(headers))

/** The body of a response as bytes, for comparing with a Node `Buffer`. */
const bytesOf = (body: ArrayBuffer): Buffer => Buffer.from(body)

upstream(import.meta.filename, {}, (test) => {
  test("NE-030", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("foo", "bar")
        res.setHeader("BaZ", "bAz")
        res.end()
      })
      const response = responseFrom(yield* page.goto(server.EMPTY_PAGE))
      assert.strictEqual(response.headers["foo"], "bar")
      assert.strictEqual(response.headers["baz"], "bAz")
      // Strider's header names are lower-cased, so the mixed-case name isn't there
      assert.isUndefined(response.headers["BaZ"])
    }))

  test("NE-031", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/headers", (_req, res) => {
        // Headers array is only supported since Node v14.14.0 so we write directly to the socket.
        const conn = res.connection
        if (conn === null) throw new Error("the response has no socket")
        conn.write("HTTP/1.1 200 OK\r\n")
        conn.write("Name-A: v1\r\n")
        conn.write("Name-a: v2\r\n")
        conn.write("name-A: v3\r\n")
        conn.write("\r\n")
        conn.uncork()
        conn.end()
      })
      const response = responseFrom(yield* page.goto(`${server.PREFIX}/headers`))
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.headers["name-a"], "v1, v2, v3")
    }))

  test("NE-032", ({ page, server }) =>
    Effect.gen(function*() {
      const text = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/simple.json",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/simple.json")
      assert.strictEqual((yield* text).body, "{\"foo\": \"bar\"}\n")
    }))

  test("NE-033", ({ page, server }) =>
    Effect.gen(function*() {
      server.enableGzip("/simple.json")
      const text = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/simple.json",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/simple.json")
      const response = yield* text
      assert.strictEqual(response.headers["content-encoding"], "gzip")
      assert.strictEqual(response.body, "{\"foo\": \"bar\"}\n")
    }))

  test("NE-034", ({ page, server }) =>
    Effect.gen(function*() {
      const text = "{\"foo\": \"bar\"}\n"
      const compressed = zlib.brotliCompressSync(Buffer.from(text))
      server.setRoute("/brotli.json", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Encoding": "br"
        })
        res.end(compressed)
      })
      const body = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/brotli.json",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/brotli.json")
      const response = yield* body
      assert.strictEqual(response.headers["content-encoding"], "br")
      assert.strictEqual(response.body, text)
    }))

  test("NE-035", ({ page, server }) =>
    Effect.gen(function*() {
      const text = "<div>hello</div>"
      server.setRoute("/identity.html", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Encoding": "Identity"
        })
        res.end(text)
      })
      const body = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/identity.html",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/identity.html")
      const response = yield* body
      assert.strictEqual(response.headers["content-encoding"], "Identity")
      assert.strictEqual(response.body, text)
    }))

  test("NE-036", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo.html", "/empty.html")
      // The body read of the redirect's response, subscribed before the navigation that produces it
      const redirectBody = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/foo.html",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/foo.html")
      // The request the navigation ended with, and the request it was redirected from
      const requests = yield* requestsOf(page)
      const last = requests.at(-1)
      assert.isDefined(last)
      const redirects = yield* NetworkRequest.redirects(page)
      const from = yield* redirects.from(last)
      const source = Option.getOrThrow(from)
      assert.strictEqual(source.url, server.PREFIX + "/foo.html")
      const redirected = Option.getOrThrow(yield* (yield* NetworkRequest.response(page, source)))
      assert.strictEqual(redirected.status, 302)
      // A redirect's response has no body, so its body read fails with the typed reason
      const error = yield* Effect.flip(redirectBody)
      assert(NetworkResponse.isResponseError(error), String(error))
      assert(error.reason instanceof NetworkResponse.BodyUnavailable, error.message)
      assert.strictEqual(error.reason.why, "redirect")
      assert.include(error.message, "redirect")
    }))

  test("NE-037", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // The page's context asks for request timing, so the request's end can be read
      const page = yield* Browser.newPage({
        emulation: { viewport: { width: 1280, height: 720 } },
        requestTiming: true
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Setup server to trap request. The response's first chunk goes out now and the rest when the test writes it.
      const held: Array<http.ServerResponse> = []
      server.setRoute("/get", (_req, res) => {
        held.push(res)
        // In Firefox, |fetch| will be hanging until it receives |Content-Type| header
        // from server.
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.write("hello ")
      })
      // The request, the response's status and headers (delivered on arrival), and its body (delivered once loaded)
      const sent = yield* NetworkRequest.next(page, { url: "**/get" })
      const arrived = yield* NetworkResponse.next(page, { url: "**/get" })
      const bodied = yield* NetworkResponse.next(page, { url: "**/get", body: (message) => message.text })
      // Setup page to trap response: wait for the server to see the request, as the original does
      const serverSaw = yield* server.waitForRequest("/get")
      // send request and wait for server response
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./get", { method: "GET" })
      })
      const request = yield* sent
      yield* serverSaw
      const pageResponse = yield* arrived
      const responseText = yield* startWaiting(bodied)

      assert.strictEqual(held.length, 1)
      assert.strictEqual(pageResponse.status, 200)
      // The request hasn't finished: its response hasn't ended, so its timing has no end yet
      const timing = yield* NetworkRequest.timing(page, request)
      assert.isTrue(Option.isNone(timing.responseEnd))

      // Write part of the response and wait for it to be flushed.
      const response = held[0]!
      yield* Effect.promise(() => new Promise<void>((resolve) => response.write("wor", () => resolve())))
      // Finish response.
      yield* Effect.promise(() => new Promise<void>((resolve) => response.end("ld!", () => resolve())))
      const body = yield* Fiber.join(responseText.fiber)
      assert.strictEqual(body.body, "hello world!")
    }))

  test("NE-038", ({ page, server }) =>
    Effect.gen(function*() {
      const json = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/simple.json",
        body: (message) => message.json
      })
      yield* page.goto(server.PREFIX + "/simple.json")
      assert.deepStrictEqual((yield* json).body, { foo: "bar" })
    }))

  test("NE-039", ({ page, server }) =>
    Effect.gen(function*() {
      const body = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/pptr.png",
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.PREFIX + "/pptr.png")
      const imageBuffer = fs.readFileSync(assetPath("playwright", "pptr.png"))
      assert.isTrue(bytesOf((yield* body).body).equals(imageBuffer))
    }))

  test("NE-040", ({ page, server }) =>
    Effect.gen(function*() {
      server.enableGzip("/pptr.png")
      const body = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/pptr.png",
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.PREFIX + "/pptr.png")
      const imageBuffer = fs.readFileSync(assetPath("playwright", "pptr.png"))
      assert.isTrue(bytesOf((yield* body).body).equals(imageBuffer))
    }))

  test("NE-041", ({ page, server }) =>
    Effect.gen(function*() {
      // Binary data with bytes that are invalid UTF-8.
      const bytes = [0x80, 0x81, 0x82, 0xFF, 0xFE, 0x00, 0x01, 0x02]
      const buffer = Buffer.from(bytes)
      server.setRoute("/binary-as-text", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/plain;charset=UTF-8",
          "Content-Length": buffer.length
        })
        res.end(buffer)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const body = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/binary-as-text",
        body: (message) => message.arrayBuffer
      })
      const bytesReceived = yield* page.evaluateInMainWorld(
        (url) => fetch(url).then(async (response) => Array.from(await response.bytes())),
        server.PREFIX + "/binary-as-text"
      )
      const response = yield* body
      assert.isTrue(bytesOf(response.body).equals(buffer))
      assert.deepStrictEqual(bytesReceived, bytes)
    }))

  test("NE-042", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/cool", (_req, res) => {
        res.writeHead(200, "cool!")
        res.end()
      })
      const response = responseFrom(yield* page.goto(server.PREFIX + "/cool"))
      assert.strictEqual(response.statusText, "cool!")
    }))

  test("NE-044", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/headers", (_req, res) => {
        res.writeHead(200, {
          "Set-Cookie": ["a=b", "c=d"]
        })
        res.write("\r\n")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const arrived = yield* NetworkResponse.next(page, { url: "**/*" })
      yield* page.evaluateInMainWorld(() => fetch("/headers").then(() => undefined))
      const response = yield* arrived
      // Strider joins a response's Set-Cookie values with newlines, one value per cookie line
      const cookies = response.headers["set-cookie"]?.split("\n")
      assert.deepStrictEqual(cookies, ["a=b", "c=d"])
      assert.isUndefined(response.headers["not-there"])
      assert.strictEqual(response.headers["set-cookie"], "a=b\nc=d")
    }))

  test("NE-045", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      server.setRoute("/headers", (_req, res) => {
        const headers: Record<string, string | Array<string>> = {
          "Set-Cookie": ["a=b", "c=d"],
          "header-a": ["a=b", "c=d"],
          "Name-A": "v1",
          "name-b": "v4",
          "Name-a": "v2",
          "name-A": "v3"
        }
        // Chromium does not report set-cookie headers immediately, so they are missing from .headers()
        if (browserName === "chromium") delete headers["Set-Cookie"]

        res.writeHead(200, headers)
        res.write("\r\n")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const arrived = yield* NetworkResponse.next(page, { url: "**/*" })
      yield* page.evaluateInMainWorld(() => fetch("/headers").then(() => undefined))
      const response = yield* arrived
      // Strider has one view of the headers, so Playwright's headers() and allHeaders() are the same value here
      const allHeaders = plain(response.headers)
      assert.strictEqual(allHeaders["header-a"], "a=b, c=d")
      assert.strictEqual(allHeaders["name-a"], "v1, v2, v3")
      assert.strictEqual(allHeaders["name-b"], "v4")
    }))

  test("NE-046", ({ page, browserName }) =>
    Effect.gen(function*() {
      const fileurl = pathToFileURL(assetPath("playwright", "frames/two-frames.html")).href
      const navigation = yield* page.goto(fileurl)
      if (browserName === "chromium") {
        // A file URL's response has a status and is OK
        const response = responseFrom(navigation)
        assert.strictEqual(response.status, 200)
      } else {
        // Playwright reports status 0 for a file URL here: no HTTP response at all
        assert.isTrue(Option.isNone(responseOf(navigation)))
      }
    }))

  test("NE-047", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's it.fail for Chromium and WebKit (issue 11035): asserted as written
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("", {
          status: 200,
          contentType: "text/plain",
          headers: { "set-cookie": "a=b" }
        })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseFrom(navigation)
      assert.strictEqual(response.headers["set-cookie"], "a=b")
    }))

  test("NE-048", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("done", {
          status: 200,
          contentType: "text/plain",
          headers: { "foo": "bar", "content-language": "en" }
        })))
      const response = responseFrom(yield* page.goto(server.EMPTY_PAGE))
      assert.deepStrictEqual(plain(response.headers), {
        "foo": "bar",
        "content-type": "text/plain",
        "content-length": "4",
        "content-language": "en"
      })
    }))

  test("NE-049", ({ page, server }) =>
    Effect.gen(function*() {
      const first = responseFrom(yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html"))
      assert.notStrictEqual(first.servedBy, "serviceWorker")
      // Wait for the worker to take control, as the original does
      yield* page.evaluateInMainWorld(async () => {
        await (globalThis as unknown as { activationPromise?: Promise<unknown> }).activationPromise
      })
      const arrived = yield* NetworkResponse.next(page, { url: "**/example.txt" })
      yield* page.evaluateInMainWorld(() => fetch("/example.txt").then(() => undefined))
      const response = yield* arrived
      assert.strictEqual(response.servedBy, "serviceWorker")
    }))

  test("NE-050", ({ page, server }) =>
    Effect.gen(function*() {
      const body = yield* NetworkResponse.next(page, {
        url: "**/prefetch.js",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/prefetch.html")
      assert.strictEqual((yield* body).body, "// Scripts will be pre-fetched")
    }))

  test("NE-051", ({ page, server }) =>
    Effect.gen(function*() {
      // A truncated 1x1 gif; Chromium evicts its body
      const imageBase64 = "R0lGODlhAQABAAAAACw="
      server.setRoute("/pixel.gif", (_req, res) => {
        res.setHeader("content-type", "image/gif")
        res.end(Buffer.from(imageBase64, "base64"))
      })
      server.setRoute("/page.html", (_req, res) => {
        res.setHeader("content-type", "text/html")
        res.end("<html><body><img src=\"/pixel.gif\"></body></html>")
      })
      const body = yield* NetworkResponse.next(page, {
        url: "**/pixel.gif",
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.PREFIX + "/page.html")
      const response = yield* body
      assert.strictEqual(bytesOf(response.body).toString("base64"), imageBase64)
    }))

  test("NE-052", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      // Playwright's route with the request continued: the page's requests go through the interception
      yield* page.route("**/api*", () => Route.continue)
      {
        const requests: Array<http.IncomingMessage> = []
        server.setRoute("/api", (req, res) => {
          requests.push(req)
          res.statusCode = 200
          res.setHeader("content-type", "text/plain")
          res.setHeader("cache-control", "public, max-age=31536000")
          res.end("Hello")
        })
        // Each iteration is one of the original's steps
        for (let i = 0; i < 3; i++) {
          const arrived = yield* NetworkResponse.next(page, { url: "**/api" })
          const status = yield* page.evaluateInMainWorld(async () => {
            const response = await fetch("/api")
            return response.status
          })
          const response = yield* arrived
          assert.strictEqual(status, 200)
          assert.strictEqual(response.status, 200)
          assert.strictEqual(requests.length, i + 1, `main frame iteration ${i}`)
        }
      }

      {
        const requests: Array<http.IncomingMessage> = []
        server.setRoute("/frame/api", (req, res) => {
          requests.push(req)
          res.statusCode = 200
          res.setHeader("content-type", "text/plain")
          res.setHeader("cache-control", "public, max-age=31536000")
          res.end("Hello")
        })
        // The one iframe of the page, whose window makes the request in its own document
        for (let i = 0; i < 3; i++) {
          const arrived = yield* NetworkResponse.next(page, { url: "**/frame/api" })
          const status = yield* page.evaluateInMainWorld(async () => {
            const frame = document.querySelector("iframe")?.contentWindow
            if (frame === null || frame === undefined) throw new Error("the page has no iframe")
            const response = await frame.fetch("/frame/api")
            return response.status
          })
          const response = yield* arrived
          assert.strictEqual(status, 200)
          assert.strictEqual(response.status, 200)
          assert.strictEqual(requests.length, i + 1, `subframe iteration ${i}`)
        }
      }
    }))

  test("NE-053", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const held: Array<http.ServerResponse> = []
      server.setRoute("/get", (_req, res) => {
        // Don't end the response yet
        held.push(res)
      })

      const sent = yield* NetworkRequest.next(page, { url: "**/get" })
      const serverSaw = yield* server.waitForRequest("/get")
      yield* page.evaluateInMainWorld(() => {
        void fetch("./get", { method: "GET" })
      })
      const request = yield* sent
      yield* serverSaw

      // The response hasn't been received yet, so the response log has no answer for the request
      const before = yield* NetworkResponse.history(page, { url: "**/get" })
      assert.strictEqual(before.entries.length, 0)

      const answered = yield* NetworkResponse.next(page, { url: "**/get" })
      // Now send the response
      const serverResponse = held[0]!
      serverResponse.setHeader("Content-Type", "text/plain; charset=utf-8")
      serverResponse.end("done")
      yield* answered

      // After the response is received, the request's response is there
      const existing = Option.getOrThrow(yield* (yield* NetworkRequest.response(page, request)))
      assert.strictEqual(existing.status, 200)
      assert.strictEqual(existing.hop, request.hop)
    }))

  test("NE-054", ({ page, server }) =>
    Effect.gen(function*() {
      const response = responseFrom(yield* page.goto(server.EMPTY_PAGE))
      // A response and its request share a hop, so the request is the one with the response's hop
      const requests = yield* requestsOf(page)
      const request = requests.find((candidate) => candidate.hop === response.hop)
      assert.isDefined(request)
      const existing = Option.getOrThrow(yield* (yield* NetworkRequest.response(page, request)))
      assert.strictEqual(existing.hop, response.hop)
      assert.strictEqual(existing.status, response.status)
    }))

  test("NE-055", ({ page, server }) =>
    Effect.gen(function*() {
      const response = responseFrom(yield* page.goto(server.EMPTY_PAGE))
      // Strider names the protocol as the browser does, where Playwright writes it in upper case
      assert.strictEqual(Option.getOrUndefined(response.httpVersion), "http/1.1")
    }))

  test("NE-056", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The page's own Response parses the body, in the page
      const result = yield* page.evaluateInMainWorld(async () => {
        const boundary = "----WebKitFormBoundary1234"
        const body = [
          `--${boundary}`,
          "Content-Disposition: form-data; name=\"field1\"",
          "",
          "value1",
          `--${boundary}`,
          "Content-Disposition: form-data; name=\"file1\"; filename=\"test.txt\"",
          "Content-Type: text/plain",
          "",
          "hello",
          `--${boundary}--`
        ].join("\r\n")
        const response = new Response(body, {
          headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }
        })
        const fd = await response.formData()
        const file = fd.get("file1")
        return {
          field1: fd.get("field1"),
          filename: file instanceof File ? file.name : null,
          fileContent: file instanceof File ? await file.text() : null
        }
      })
      assert.strictEqual(result.field1, "value1")
      assert.strictEqual(result.filename, "test.txt")
      assert.strictEqual(result.fileContent, "hello")
    }))
})

// NE-043 (`headersArray()`, a repeated header's values one by one) is in the ledger, not ported.
// NE-057 (a body read after navigating away, which Strider never performs: a body is loaded before its response is
// delivered) is in the ledger, not ported.
