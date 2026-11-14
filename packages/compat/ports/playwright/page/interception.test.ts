/**
 * Playwright's `tests/page/interception.spec.ts`: which requests a page route sees and how it answers them, through
 * service workers, workers, navigations, and the invalid patterns it refuses.
 *
 * What the port changes:
 * - A route's handler returns one decision. `route.continue()` is `Route.continue`, and `route.fulfill({ … })` is
 *   `Route.fulfill(HttpServerResponse…)`. A handler that records each request in the original does so in an
 *   `Effect.sync` before its decision, and the test body asserts on the record, where a failure fails the test.
 * - RO-151's `request.isNavigationRequest()` is the request's initiator: a document's navigation, with its navigation
 *   set, which is what Strider reports for the navigation's request.
 * - Playwright's `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A call that the original
 *   awaits and then doesn't return a value from (RO-152's `activationPromise`) returns nothing, since an `Event` doesn't
 *   cross by value. `page.waitForEvent("console")` and `waitForEvent("worker")` are `ConsoleMessage.next` and
 *   `BrowserWorker.next`, listening before the action that sends the message, as the original does with `Promise.all`.
 * - RO-152's `route.request()`, `request.url()`, and the fulfilled `text/css` answer are the handler's request and
 *   response. Its headers check reads the service worker's echo of the headers the page sent.
 * - RO-152 runs unconditionally where the original skips Playwright's Firefox with Juggler: Strider drives Firefox over
 *   WebDriver BiDi only, so the original's `browserName !== "firefox" || isBidi` is true for every browser here.
 * - RO-155: an invalid pattern fails with Strider's `InvalidInput` (API.md, "Network"), where Playwright rejects with
 *   its message. The port checks the typed reason, and that the message names the `{` the original names.
 * - RO-164 is WebKit-only upstream (`it.skip(browserName !== "webkit")`), so it runs on stock WebKit alone. Its
 *   `page.on("console", …)` logs the page's messages and asserts nothing, so the port leaves it out.
 * - A fixed wait the original makes itself, none here, is ported as written, with a comment where it happens.
 * - RO-160 and RO-161 pass a RegExp, which Strider's routes don't accept (the pattern is a string), so they aren't ported
 *   (see the ledger). RO-153 and RO-154 test Playwright's internal glob compiler, which Strider doesn't export.
 */
import { assert } from "@effect/vitest"
import { BrowserWorker, ConsoleMessage, Expect, NetworkRequest, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `request.isNavigationRequest()`: a document's navigation, not a subresource of one. */
const isNavigationRequest = (request: NetworkRequest.NetworkRequest) =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/** The last path segment of a URL: the key the original records its requests under. */
const lastSegment = (url: string) => url.split("/").pop() ?? ""

upstream(import.meta.filename, {}, (test) => {
  test("RO-151", ({ page, server }) =>
    Effect.gen(function*() {
      const requests = new Map<string, NetworkRequest.NetworkRequest>()
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          requests.set(lastSegment(request.url), request)
        }).pipe(Effect.andThen(Route.continue)))
      server.setRedirect("/rrredirect", "/frames/one-frame.html")
      yield* page.goto(server.PREFIX + "/rrredirect")
      const navigation = (name: string) => {
        const request = requests.get(name)
        assert.isDefined(request, `the route saw no request for ${name}`)
        return isNavigationRequest(request!)
      }
      assert.isTrue(navigation("rrredirect"))
      assert.isTrue(navigation("frame.html"))
      assert.isFalse(navigation("script.js"))
      assert.isFalse(navigation("style.css"))
    }))

  test("RO-152", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/serviceworkers/fetchdummy/sw.html")
      // The original awaits `window.activationPromise`, which resolves with an Event, and reads nothing from it
      yield* page.evaluateInMainWorld(async () => {
        await (window as unknown as { activationPromise: Promise<unknown> }).activationPromise
      })
      const fetchDummy = (name: string) =>
        page.evaluateInMainWorld(
          (name) => (window as unknown as { fetchDummy: (name: string) => Promise<string> }).fetchDummy(name),
          name
        )

      // Sanity check
      assert.strictEqual(yield* fetchDummy("foo"), "responseFromServiceWorker:foo")

      yield* page.route("**/foo", ({ request }) =>
        Route.fulfill(HttpServerResponse.text("responseFromInterception:" + lastSegment(request.url), {
          contentType: "text/css"
        })))

      // Page route is applied after service worker fetch event
      assert.strictEqual(yield* fetchDummy("foo"), "responseFromServiceWorker:foo")

      const headers = {
        "cache-control": "max-age=12345",
        "accept-language": "fr-CH",
        "accept": "application/custom"
      }
      const received = (yield* page.evaluateInMainWorld(async (headers) => {
        const response = await fetch("headers", { headers })
        return response.json()
      }, headers)) as unknown as Record<string, string>
      for (const [name, value] of Object.entries(headers)) {
        assert.strictEqual(received[name], value)
      }

      // Page route is not applied to service worker initiated fetch
      assert.strictEqual(yield* fetchDummy("passthrough"), "FAILURE: Not Found")

      // Page route is not applied to service worker initiated fetch with redirect. The original skips this on
      // Playwright's Firefox with Juggler only; Strider's Firefox is WebDriver BiDi, so it runs on every browser here.
      server.setRedirect("/serviceworkers/fetchdummy/passthrough", "/simple.json")
      assert.strictEqual(yield* fetchDummy("passthrough"), "{\"foo\": \"bar\"}\n")
    }))

  test("RO-155", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        page.route("http://*/foo{", () => Route.continue),
        "page.route with an invalid glob"
      )
      assert(Route.isRouteError(error), String(error))
      assert.strictEqual(error.reason._tag, "InvalidInput")
      assert.include(error.message, "{")
    }))

  test("RO-156", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("http://localhos**?*oo", () => Route.fulfill(HttpServerResponse.text("intercepted")))
      const result = yield* page.evaluateInMainWorld(
        (url) => fetch(url).then((response) => response.text()),
        server.PREFIX + "/?foo"
      )
      assert.strictEqual(result, "intercepted")
    }))

  test("RO-157", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      server.setRoute("/data_for_worker", (_request, response) => response.end("failed to intercept"))
      const url = server.PREFIX + "/data_for_worker"
      yield* page.route(url, () => Route.fulfill(HttpServerResponse.text("intercepted")))
      // The original's `page.waitForEvent("console")` runs alongside the evaluate that starts the worker
      const message = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld((url) => {
        new Worker(URL.createObjectURL(
          new Blob([`
          fetch("${url}").then(response => response.text()).then(console.log);
        `], { type: "application/javascript" })
        ))
      }, url)
      assert.strictEqual((yield* message).text, "intercepted")
    }))

  test("RO-158", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      server.setRoute("/data_for_worker", (_request, response) => response.end("failed to intercept"))
      const url = server.PREFIX + "/data_for_worker"
      const worker = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld((url) => {
        ;(window as unknown as { w: Worker }).w = new Worker(URL.createObjectURL(
          new Blob([`
          onmessage = function(e) {
            fetch("${url}").then(response => response.text()).then(console.log);
          };
        `], { type: "application/javascript" })
        ))
      }, url)
      yield* worker
      // Install the route after the worker has been created
      yield* page.route(url, () => Route.fulfill(HttpServerResponse.text("intercepted")))
      const message = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { w: Worker }).w.postMessage("")
      })
      assert.strictEqual((yield* message).text, "intercepted")
    }))

  test("RO-159", ({ page, server }) =>
    Effect.gen(function*() {
      const url = server.PREFIX + "/worker/worker.js"
      yield* page.route(url, () =>
        Route.fulfill(HttpServerResponse.text("console.log(\"intercepted\");", {
          contentType: "application/javascript"
        })))
      const message = yield* ConsoleMessage.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      assert.strictEqual((yield* message).text, "intercepted")
    }))

  test("RO-162", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**", () => Route.continue)
      yield* page.goto(server.PREFIX + "/worker/worker-http-import.html")
      // The original waits for `#status:has-text('finished')`, which is the element that shows the text
      yield* Expect.toBeVisible(page.locator("#status").filter({ hasText: "finished" }))
    }))

  test("RO-163", ({ page, server }) =>
    Effect.gen(function*() {
      let intercepted = 0
      yield* page.route("**/page.html", () =>
        Effect.sync(() => {
          intercepted++
        }).pipe(Effect.andThen(Route.fulfill(HttpServerResponse.text("success")))))
      yield* page.goto(server.PREFIX + "/page.html")
      assert.include(yield* page.locator("body").readText, "success")
      yield* page.goto(server.EMPTY_PAGE)
      yield* Expect.toHaveURL(page, server.EMPTY_PAGE)
      assert.strictEqual(intercepted, 1)
      yield* page.back()
      yield* Expect.toHaveURL(page, server.PREFIX + "/page.html")
      assert.strictEqual(intercepted, 2)
    }))

  test("RO-164", { browsers: ["webkit"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.text("intercepted")))
      const response = yield* page.evaluateInMainWorld(async () => {
        const blobUrl = URL.createObjectURL(new Blob(["failed to intercept"], { type: "text/plain" }))
        return await fetch(blobUrl).then((response) => response.text())
      })
      assert.strictEqual(response, "intercepted")
    }))
})
