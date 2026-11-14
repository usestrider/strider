/**
 * Playwright's `tests/page/page-network-sizes.spec.ts`: a request's and a response's byte counts (its body, its headers,
 * and its transfer), for requests that succeed, redirect, fail, or come back with a status.
 *
 * What the port changes:
 * - Strider reports sizes only for a context that opts in (`requestSizes`), so each test opens its own page with it;
 *   Playwright reports them always. The sizes are read with `NetworkRequest.sizes` after the request, which reads what
 *   the browser has observed so far, where Playwright's `request.sizes()` waits for the response to finish. Each test
 *   has finished its request before reading, as the original's `await` does.
 * - A count Strider reports is an `Option`: a count the browser doesn't give is `None`, never zero. `known` asserts the
 *   count is there and returns it. The browsers' columns are in `NetworkRequest.Sizes`, and on Chromium the request
 *   counts, the header counts, and the transferred body are `None`, so the tests that read them are in the ledger for
 *   Chromium as `needsFeature` (matrix row `method-request-sizes`); Firefox's request counts are `None` too.
 * - A redirect's successor is `NetworkRequest.redirects`' `to`, where Playwright's `redirectedTo()` is the next request.
 * - A failed request's `sizes()` is a `RequestError` with a typed reason, where Playwright's rejects with its message;
 *   NE-066 asserts that the error is a `RequestError`.
 * - `page.evaluate` is `page.evaluateInMainWorld`, which runs the original's `fetch` in the page's main world.
 * - Playwright's `waitForRequest` and `waitForEvent` are the arming of a `NetworkRequest.next` or `NetworkResponse.next`
 *   before the action, which is how a Strider wait is started.
 * - Each `it.fixme` and `it.skip` in the original is kept as a comment where it applies. They are conditions for the
 *   upstream's other browsers and platforms, so each test runs on every browser (`it.fixme` on Chromium for NE-068 and
 *   NE-069, on Firefox and non-macOS WebKit for NE-063), and the ledger records the Chromium and Firefox gaps.
 * - NE-063's chunked response is written with the same flush-per-chunk waits; NE-064 gzips the vendored file with
 *   `zlib.gzipSync`, which gives the same bytes as the original's stream.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import * as zlib from "node:zlib"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A page in a fresh context that collects the byte counts of its requests. */
const sizedPage = () => Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } }, requestSizes: true })

/** A count the browser reports. Strider reports `None` for a count it can't give, which the original never does. */
const known = (count: Option.Option<number>, name: string): number => {
  if (Option.isNone(count)) throw new Error(`${name} is unavailable`)
  return count.value
}

upstream(import.meta.filename, {}, (test) => {
  test("NE-058", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page: Page.Page = yield* sizedPage()
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: "**/get" })
      yield* page.evaluateInMainWorld(() => fetch("./get", { method: "POST", body: "12345" }).then((r) => r.text()))
      const request = yield* sent
      const sizes = yield* NetworkRequest.sizes(page, request)
      assert.strictEqual(known(sizes.requestBodySize, "requestBodySize"), 5)
      assert.isAtLeast(known(sizes.requestHeadersSize, "requestHeadersSize"), 250)
    }))

  test("NE-059", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: "**/get" })
      yield* page.evaluateInMainWorld(() => fetch("./get").then((r) => r.text()))
      const request = yield* sent
      const sizes = yield* NetworkRequest.sizes(page, request)
      assert.strictEqual(known(sizes.requestBodySize, "requestBodySize"), 0)
      assert.isAtLeast(known(sizes.requestHeadersSize, "requestHeadersSize"), 190)
    }))

  test("NE-060", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      server.setRoute("/get", (_req, res) => {
        // In Firefox, |fetch| will be hanging until it receives |Content-Type| header
        // from server.
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.end("abc134")
      })
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: "**/get" })
      const serverSaw = yield* server.waitForRequest("/get")
      yield* page.evaluateInMainWorld(() => fetch("./get").then((r) => r.text()))
      const request = yield* sent
      yield* serverSaw
      const sizes = yield* NetworkRequest.sizes(page, request)
      assert.strictEqual(known(sizes.responseBodySize, "responseBodySize"), 6)
      assert.isAtLeast(known(sizes.responseHeadersSize, "responseHeadersSize"), 100)
    }))

  test("NE-061", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      const sent = yield* NetworkRequest.next(page, { url: "**/empty.html" })
      yield* page.goto(server.EMPTY_PAGE)
      const request = yield* sent
      const sizes = yield* NetworkRequest.sizes(page, request)
      assert.strictEqual(known(sizes.responseBodySize, "responseBodySize"), 0)
      assert.isAtLeast(known(sizes.responseHeadersSize, "responseHeadersSize"), 150)
    }))

  test("NE-062", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      const sent = yield* NetworkRequest.next(page, { url: "**/simplezip.json" })
      yield* page.goto(server.PREFIX + "/simplezip.json")
      const request = yield* sent
      const sizes = yield* NetworkRequest.sizes(page, request)
      assert.strictEqual(
        known(sizes.responseBodySize, "responseBodySize"),
        fs.statSync(assetPath("playwright", "simplezip.json")).size
      )
    }))

  test("NE-063", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      // it.fixme on Firefox, and on WebKit off macOS: the original's conditions for those browsers, kept as the port runs everywhere
      const page = yield* sizedPage()
      const content = fs.readFileSync(assetPath("playwright", "simplezip.json"))
      const AMOUNT_OF_CHUNKS = 10
      const CHUNK_SIZE = Math.ceil(content.length / AMOUNT_OF_CHUNKS)
      server.setRoute("/chunked-simplezip.json", async (_req, resp) => {
        resp.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Transfer-Encoding": "chunked" })
        for (let start = 0; start < content.length; start += CHUNK_SIZE) {
          const end = Math.min(start + CHUNK_SIZE, content.length)
          // Wait for each chunk to be flushed, otherwise Node 26 merges synchronous writes into a single chunk.
          await new Promise<void>((f) => resp.write(content.slice(start, end), () => f()))
        }
        resp.end()
      })
      const sent = yield* NetworkRequest.next(page, { url: "**/chunked-simplezip.json" })
      yield* page.goto(server.PREFIX + "/chunked-simplezip.json")
      const request = yield* sent
      const sizes = yield* NetworkRequest.sizes(page, request)
      // The actual file size is 5100 bytes. The extra 75 bytes are coming from the chunked encoding headers and end bytes.
      const size = known(sizes.responseBodySize, "responseBodySize")
      if (browserName === "webkit") {
        // WebKit on macOS reports 5173 with the legacy CFNetwork loader (builds <= 2346) and the
        // correct 5175 with NWLoader. TODO: expect 5175 once the NWLoader-based build ships.
        assert.isTrue([5173, 5175].includes(size), `responseBodySize is ${size}`)
      } else assert.strictEqual(size, 5175)
    }))

  test("NE-064", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      server.enableGzip("/simplezip.json")
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: "**/simplezip.json" })
      yield* page.evaluateInMainWorld(() => fetch("./simplezip.json").then((r) => r.text()))
      const request = yield* sent
      const sizes = yield* NetworkRequest.sizes(page, request)
      const gzipped = zlib.gzipSync(fs.readFileSync(assetPath("playwright", "simplezip.json")))
      assert.strictEqual(known(sizes.responseBodySize, "responseBodySize"), gzipped.length)
    }))

  test("NE-065", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      server.setRedirect("/foo", "/bar")
      server.setRoute("/bar", (_req, resp) => resp.end("bar"))
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: "**/foo" })
      yield* page.evaluateInMainWorld(() =>
        fetch("/foo", {
          method: "POST",
          body: "12345"
        }).then((r) => r.text())
      )
      const request = yield* sent
      assert.strictEqual(known((yield* NetworkRequest.sizes(page, request)).requestBodySize, "requestBodySize"), 5)
      const links = yield* NetworkRequest.redirects(page)
      const successor = yield* links.to(request)
      if (Option.isNone(successor)) throw new Error("the redirect has no successor")
      const newSizes = yield* NetworkRequest.sizes(page, successor.value)
      assert.strictEqual(known(newSizes.responseBodySize, "responseBodySize"), 3)
    }))

  test("NE-066", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* sizedPage()
      server.setRoute("/one-style.css", (_req, res) => {
        res.setHeader("Content-Type", "text/css")
        const conn = res.connection
        if (conn === null) throw new Error("the response has no socket")
        conn.destroy()
      })
      yield* page.goto(server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: "**/one-style.css" })
      yield* page.goto(server.PREFIX + "/one-style.html")
      const request = yield* sent
      const failure = yield* NetworkRequest.failure(page, request)
      assert.isTrue(Option.isSome(failure), "the request has no failure")
      // Playwright's `request.sizes()` rejects with "Unable to fetch sizes for failed request"; Strider's reason is typed
      const error = yield* Effect.flip(NetworkRequest.sizes(page, request))
      assert.strictEqual(error._tag, "RequestError")
    }))

  for (const statusCode of [200, 401, 404, 500]) {
    test("NE-067", { variant: String(statusCode) }, ({ server }) =>
      Effect.gen(function*() {
        const page = yield* sizedPage()
        server.setRoute("/foo", (_req, resp) => {
          resp.writeHead(statusCode, {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Length": "3"
          })
          resp.end("bar")
        })
        yield* page.goto(server.EMPTY_PAGE)
        const sent = yield* NetworkRequest.next(page, { url: "**/foo" })
        const arrived = yield* NetworkResponse.next(page, { url: "**/foo" })
        yield* page.evaluateInMainWorld(() =>
          fetch("/foo", {
            method: "POST",
            body: "12345"
          }).then((r) => r.text())
        )
        const request = yield* sent
        const response = yield* arrived
        assert.strictEqual(response.status, statusCode)
        const sizes = yield* NetworkRequest.sizes(page, request)
        assert.strictEqual(known(sizes.requestBodySize, "requestBodySize"), 5)
        assert.strictEqual(known(sizes.responseBodySize, "responseBodySize"), 3)
      }))
  }

  test("NE-068", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // it.fixme on Chromium: the original's condition for that browser, kept as the port runs everywhere
      const page = yield* sizedPage()
      server.setRoute("/broken-image.png", (_req, resp) => {
        resp.writeHead(404)
        resp.end(`<p>this should have a non-negative size</p>`)
      })
      server.setRoute("/page-with-404-image.html", (_req, resp) => {
        resp.end(`
    <!DOCTYPE html>
    <html>
      <head><title>Page with Broken Image</title></head>
      <body>
        <img src="/broken-image.png" />
      </body>
    </html>
    `)
      })
      const sent = yield* NetworkRequest.next(page, { url: "**/broken-image.png" })
      yield* page.goto(server.PREFIX + "/page-with-404-image.html")
      const request = yield* sent
      const { responseBodySize } = yield* NetworkRequest.sizes(page, request)
      assert.isAtLeast(known(responseBodySize, "responseBodySize"), 0)
    }))

  test("NE-069", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // it.fixme on Chromium: the original's condition for that browser, kept as the port runs everywhere
      const page = yield* sizedPage()
      server.setRoute("/has-abandoned-fetch", (_req, resp) => {
        resp.end(`
    <!DOCTYPE html>
    <html>
      <head><title>t</title></head>
      <body>
        <script>
          fetch("./404");
        </script>
      </body>
    </html>
    `)
      })
      const sent = yield* NetworkRequest.next(page, { url: "**/404" })
      const navigated = yield* Effect.forkChild(page.goto(server.PREFIX + "/has-abandoned-fetch"))
      const request = yield* sent
      yield* Fiber.join(navigated)
      // Returns without hanging: the original's only assertion is that its `req.sizes()` resolves
      yield* NetworkRequest.sizes(page, request)
    }))
})
