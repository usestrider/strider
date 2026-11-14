/**
 * Playwright's `tests/page/page-request-intercept.spec.ts`: a route fulfills, fetches, or changes a request, and what the
 * page gets from it: a fetched response with its status and headers, a body, a file's bytes, or a request's upload body.
 *
 * What the port changes:
 * - `route.fetch()` then `route.fulfill({ response })` (RO-134, RO-135, RO-138, RO-139, RO-140, RO-142) is a response-phase
 *   route: the paused response is the response the original's fetch returns, so the handler fulfills with its status,
 *   headers, and body as served, without a second request (the download's DO-032 pattern, as page-request-fulfill's
 *   RO-110). The original's overrides are the fulfill's own (`status`, `headers`, `contentType`, `body`). These routes run
 *   on Chromium only, where a response can be read and fulfilled at that phase.
 * - `page.request.fetch(route.request())` whose result RO-136's route doesn't use is kept as a fetch of the test process,
 *   the same request the original makes, since Strider has no request client (as RO-107 of page-request-fulfill).
 * - A fetch whose response the route fulfills with (RO-137) or whose redirect the route reads (RO-144) is the test
 *   process's `fetch`, as RO-107 uses it. RO-144 doesn't follow redirects, so the 302 and its `location` are what the
 *   server sent.
 * - RO-139 holds the route, as the original holds `routeCallback`: the handler publishes the paused response and waits,
 *   so the test reads its status, headers, and URL while the page's fetch still waits, then releases the route. Its
 *   `content-type` check reads the value only: Strider's header record doesn't keep a name's original case, which
 *   the original's `headersArray` check reads.
 * - RO-140 likewise reads the paused body (`responseBody`) while the page waits, then fulfills with those bytes.
 * - RO-141 is `it.fixme` for every browser but Firefox upstream. It runs on every browser the file covers, as the original
 *   does. Its route is registered before the click rather than alongside it, and the request is answered with an empty
 *   `200`, since a route has to decide the request it holds.
 * - RO-143 (`route.fetch({ timeout })`), RO-145 (`route.fetch({ url })`), and RO-146 (`route.fetch({ postData })`) aren't
 *   ported: Strider has no `route.fetch` or its options (see the ledger).
 * - RO-147 reads the request's body (`requestBody`) inside the route, where Playwright's `request.postData()` is.
 * - Playwright's `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. `page.content()` is
 *   `page.readHtml`.
 * - RO-148's `await new Promise(f => setTimeout(f, 1000))` is a fixed wait the original makes itself, ported as written.
 * - A navigation's `response.text()` is what the page got: its body's text (RO-135, RO-136, RO-137), since the body a
 *   fulfilled request answers with can't be read back from `NetworkResponse` on Chromium (`Network.getResponseBody` has no
 *   data for it). The response-phase routes' pages (RO-138) read `NetworkResponse` with a body decoder, as page-request-fulfill's
 *   RO-116 does.
 */
import { assert } from "@effect/vitest"
import { FileInput, NetworkResponse, PageNavigation, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import { assetPath, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one. */
const responseOfNavigation = (navigation: PageNavigation.PageNavigation) => {
  const response = navigation._tag === "Committed" || navigation._tag === "NoContent"
    ? navigation.response
    : Option.none()
  return Option.getOrThrow(response)
}

const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

/** The response the test process's own `fetch` gets for `url`, with its status, headers, and body. */
const fetched = (url: string, init?: RequestInit) =>
  Effect.promise(async () => {
    const response = await fetch(url, init)
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: new Uint8Array(await response.arrayBuffer())
    }
  })

/** Playwright's `route.fulfill({ response })` for a response-phase route: the paused response, as the server sent it. */
const fulfillWithOwnResponse = Effect.fnUntraced(function*({ response, responseBody }: Route.ResponsePhase) {
  const bytes = yield* responseBody
  return yield* Route.fulfill(HttpServerResponse.uint8Array(bytes, {
    status: response.status,
    headers: response.headers
  }))
})

upstream(import.meta.filename, {}, (test) => {
  test("RO-134", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ response }) =>
        Route.fulfill(HttpServerResponse.text("Yo, page!", {
          status: 201,
          headers: { ...response.headers, foo: "bar" },
          contentType: "text/plain"
        })), { phase: "response" })
      const navigation = yield* page.goto(server.PREFIX + "/empty.html")
      const served = responseOfNavigation(navigation)
      assert.strictEqual(served.status, 201)
      assert.strictEqual(served.headers["foo"], "bar")
      assert.strictEqual(served.headers["content-type"], "text/plain")
      assert.strictEqual(yield* page.locator("body").readText, "Yo, page!")
    }))

  test("RO-135", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ response }) =>
        Route.fulfill(HttpServerResponse.empty({
          status: 201,
          headers: { ...response.headers, "content-length": "0" }
        })), { phase: "response" })
      const navigation = yield* page.goto(server.PREFIX + "/title.html")
      assert.strictEqual(responseOfNavigation(navigation).status, 201)
      // The original's `response.text()` is the body the page got
      assert.strictEqual(yield* page.locator("body").readText, "")
    }))

  test("RO-136", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("foo", "bar")
        response.end("my content")
      })
      // The original's `page.request.fetch(route.request())` is a request of its own; the route's answer doesn't use it
      const seen: Array<number> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.gen(function*() {
          const fetchedResponse = yield* fetched(String(request.url))
          seen.push(fetchedResponse.status)
          return yield* Route.fulfill(HttpServerResponse.empty({ status: 201 }))
        }))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.status, 201)
      // The original's `response.text()` is the body the page got
      assert.strictEqual(yield* page.locator("body").readText, "")
      // Chromium gives no headers for a response fulfilled with none
      assert.deepStrictEqual({ ...response.headers }, {})
      assert.include(seen, 200)
    }))

  test("RO-137", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/sample", (_request, response) => {
        response.setHeader("foo", "bar")
        response.end("Woo-hoo")
      })
      // The original's `page.request.get` is a request of the test process
      const sample = yield* fetched(server.PREFIX + "/sample")
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.uint8Array(sample.body, {
          status: 201,
          headers: sample.headers,
          contentType: "text/plain"
        })))
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.status, 201)
      // The original's `response.text()` is the body the page got
      assert.strictEqual(yield* page.locator("body").readText, "Woo-hoo")
      assert.strictEqual(response.headers["foo"], "bar")
    }))

  test("RO-138", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* server.waitForRequest("/title.html")
      yield* page.route("**", fulfillWithOwnResponse, { phase: "response" })
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/title.html",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/title.html")
      const request = yield* requested
      assert.strictEqual(request.path, "/title.html")
      const original = fs.readFileSync(assetPath("playwright", "title.html"), "utf8")
      assert.strictEqual((yield* responded).body, original)
    }))

  test("RO-139", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const captured = yield* Deferred.make<NetworkResponse.NetworkResponse>()
      const released = yield* Deferred.make<void>()
      yield* page.route("**/title.html", (paused) =>
        Effect.gen(function*() {
          yield* Deferred.succeed(captured, paused.response)
          // The original holds the route until its test has read the response
          yield* Deferred.await(released)
          return yield* fulfillWithOwnResponse(paused)
        }), { phase: "response" })
      const evaluated = yield* startWaiting(
        page.evaluateInMainWorld(async (url) => {
          await fetch(url)
        }, server.PREFIX + "/title.html")
      )
      const response = yield* Deferred.await(captured)
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.statusText, "OK")
      assert.isTrue(response.status >= 200 && response.status <= 299)
      assert.isTrue(String(response.url).endsWith("/title.html"))
      assert.strictEqual(response.headers["content-type"], "text/html; charset=utf-8")
      yield* Deferred.succeed(released, undefined)
      yield* Fiber.join(evaluated.fiber)
    }))

  test("RO-140", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const captured = yield* Deferred.make<Uint8Array>()
      const released = yield* Deferred.make<void>()
      yield* page.route("**/simple.json", (paused) =>
        Effect.gen(function*() {
          const bytes = yield* paused.responseBody
          yield* Deferred.succeed(captured, bytes)
          yield* Deferred.await(released)
          return yield* Route.fulfill(HttpServerResponse.uint8Array(bytes, {
            status: paused.response.status,
            headers: paused.response.headers
          }))
        }), { phase: "response" })
      const evaluated = yield* startWaiting(
        page.evaluateInMainWorld(async (url) => {
          await fetch(url)
        }, server.PREFIX + "/simple.json")
      )
      const bytes = yield* Deferred.await(captured)
      assert.strictEqual(decode(bytes), "{\"foo\": \"bar\"}\n")
      yield* Deferred.succeed(released, undefined)
      // The original's `evalPromise` ends with `.catch(() => {})`, so a failed fetch is not the test's
      yield* Fiber.join(evaluated.fiber).pipe(Effect.ignore)
    }))

  test("RO-141", ({ page, server }) =>
    Effect.gen(function*() {
      // `it.fixme` for every browser but Firefox upstream; it runs on each browser here, as the original's body does
      yield* page.goto(server.PREFIX + "/input/fileupload.html")
      const filePath = assetPath("playwright", "file-to-upload.txt")
      yield* page.locator("input[type=file]").setInputFiles(FileInput.local(filePath))
      const posted = yield* Deferred.make<{ readonly method: string; readonly body: Uint8Array | undefined }>()
      yield* page.route("**/upload", ({ request, requestBody }) =>
        Effect.gen(function*() {
          const body = yield* requestBody
          yield* Deferred.succeed(posted, { method: request.method, body: Option.getOrUndefined(body) })
          return yield* Route.fulfill(HttpServerResponse.empty({ status: 200 }))
        }))
      // The original's `noWaitAfter` doesn't wait for the navigation; Strider's click has no such option
      yield* page.locator("input[type=submit]").click()
      const request = yield* Deferred.await(posted)
      assert.strictEqual(request.method, "POST")
      assert.include(decode(request.body), fs.readFileSync(filePath, "utf8"))
    }))

  test("RO-142", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", fulfillWithOwnResponse, { phase: "response" })
      const navigation = yield* page.goto(server.EMPTY_PAGE)
      const response = responseOfNavigation(navigation)
      assert.strictEqual(response.status, 200)
      assert.include(response.headers["content-type"], "text/html")
    }))

  // RO-143 (route.fetch's `timeout`) isn't ported: see the ledger.

  test("RO-144", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo", "/empty.html")
      // The original's `route.fetch({ maxRedirects: 0 })` doesn't follow the redirect: a fetch of the test process that
      // doesn't follow it (`redirect: "manual"`) gives the 302 and its `location`
      const seen: Array<{ readonly status: number; readonly headers: Record<string, string> }> = []
      yield* page.route("**/*", () =>
        Effect.gen(function*() {
          const hop = yield* fetched(server.PREFIX + "/foo", { redirect: "manual" })
          seen.push({ status: hop.status, headers: hop.headers })
          return yield* Route.fulfill(HttpServerResponse.text("hello"))
        }))
      yield* page.goto(server.PREFIX + "/foo")
      assert.strictEqual(seen[0]?.headers["location"], "/empty.html")
      assert.strictEqual(seen[0]?.status, 302)
      assert.include(yield* page.readHtml, "hello")
    }))

  // RO-145 (route.fetch's `url`) and RO-146 (route.fetch's `postData`) aren't ported: see the ledger.

  test("RO-147", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`
<script>
  function doStuff() {
    const formData = new FormData();
    formData.append('file', new Blob(["hello"], { type: "text/plain" }));
    fetch('/upload', {
      method: 'POST',
      body: formData
    });
  }
</script>
<body>
<button onclick="doStuff()" data-testid="click-me">Click me!</button>
</body>`)
      const posted = yield* Deferred.make<{ readonly method: string; readonly body: Uint8Array | undefined }>()
      yield* page.route(server.PREFIX + "/upload", ({ request, requestBody }) =>
        Effect.gen(function*() {
          const body = yield* requestBody
          yield* Deferred.succeed(posted, { method: request.method, body: Option.getOrUndefined(body) })
          return yield* Route.fulfill(HttpServerResponse.text("ok", { status: 200 }))
        }))
      yield* page.getByTestId("click-me").click()
      const request = yield* Deferred.await(posted)
      assert.strictEqual(request.method, "POST")
      const postData = decode(request.body)
      assert.include(postData, "Content-Disposition: form-data; name=\"file\"; filename=\"blob\"")
      assert.include(postData, "\r\nhello\r\n")
    }))

  test("RO-148", ({ page, server }) =>
    Effect.gen(function*() {
      const count = { value: 0 }
      server.setRoute("/favicon.ico", (_request, response) => {
        count.value++
        response.setHeader("content-type", "text/plain")
        response.end("my content")
      })
      // Intercept all requests.
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.text("Hello, world!", { status: 200 })))
      yield* page.goto(server.EMPTY_PAGE)
      const result = yield* page.evaluateInMainWorld(() =>
        fetch("/favicon.ico").then((r) => r.text()).catch(() => "load failed")
      )
      assert.strictEqual(result, "load failed")
      // Browsers can send favicon requests in the background, so the original waits a second before it looks
      yield* Effect.sleep("1 second")
      assert.strictEqual(count.value, 0)
    }))
})
