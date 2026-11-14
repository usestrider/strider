/**
 * Puppeteer's `test/src/requestinterception-experimental.test.ts` (cooperative interception), in file order.
 *
 * Cooperative interception lets several handlers vote on a request with priorities. Strider's route handler returns one
 * decision, so the votes have no counterpart. Most of this file's tests, though, check the plain behavior of a single
 * handler that continues, aborts, or fulfills a request: Puppeteer's `continue({}, 0)` with one handler resolves as a
 * plain `continue()` does. Those are ported as `requestinterception.test.ts` ports them, with the priority argument
 * dropped. The tests whose point is the priority, or the state another handler left, are ledgered.
 *
 * What the port changes:
 * - Puppeteer's `continue(overrides, 0)`, `abort(reason, 0)`, and `respond(response, 0)` are `page.route` handlers that
 *   return their decision: `Route.continue`, `Route.continueWith` over the changes, `Route.abort`, or `Route.fulfill`.
 *   Each test body asserts on what the handler recorded and on what the server or page received.
 * - "should work when header manipulation headers with redirect" reads back `request.continueRequestOverrides()` in the
 *   original: the overrides its own handler just returned. The port asserts what the server received, which is the
 *   browser's effect of the change; the readback is not ported.
 * - "should normalize Headers instances for cooperative interception", "should throw if interception is not enabled",
 *   and "should stringify intercepted request response headers" are ledgered as not applicable, as their plain
 *   counterparts are in `requestinterception.test.ts`.
 * - "should be able to access the error reason", "should be able to access the response", and "should indicate
 *   already-handled if an intercept has been handled" read another handler's pending decision (`abortErrorReason`,
 *   `responseForRequest`, `interceptResolutionState`), which Strider has no way to show a handler, so they're ledgered.
 * - "should cooperatively ${expectedAction} by priority" ranks several handlers' votes. Ledgered.
 * - Puppeteer's `page.setExtraHTTPHeaders(…)` is `page.emulate({ extraHTTPHeaders })`, which lasts as long as the test.
 * - `page.waitForRequest` and `page.waitForResponse` are `NetworkRequest.next` and `NetworkResponse.next`, subscribed before
 *   the action, with a bounded wait (`waiting`). `server.waitForRequest` is the fixture server's, listened for before the
 *   action.
 * - Puppeteer's `page.evaluate` runs in the main world: `page.evaluateInMainWorld`. `page.$eval(…)` is an evaluation in
 *   the main world, since the original only runs its script.
 * - Puppeteer's `page.goto`, `page.reload`, and `page.waitForNavigation` wait for `load`, so each one passes
 *   `waitUntil: "load"`.
 * - Puppeteer's `request.redirectChain()` is `redirectChainOf`, as in `requestinterception.test.ts`.
 * - Puppeteer's `page.on("request")` collects the history (`requestsOf`), and its `requestfailed` count reads each
 *   request's failure once the request has ended (`failureOnceEnded`).
 * - The `data:` tests read the request from the history: Strider's routes are asked only about requests the browser
 *   pauses, and `data:` requests aren't paused.
 * - Puppeteer's `setCacheEnabled(true)` is Strider's default, so the port doesn't call it. A cache hit is a response whose
 *   `servedBy` is `"cache"`, in place of the `requestservedfromcache` event.
 * - "should amend post data" and "should amend both post data and method on navigation" send `doggo` and `birdy` as the
 *   original does, rather than the emoji `requestinterception.test.ts` uses.
 * - "Request.respond should allow mocking binary responses" reads the image's size, which is what the original's golden
 *   image shows.
 * - "should be abortable with custom error codes" reads the navigation request's failure, which Strider takes a reason for
 *   only on Chromium, so it's ledgered for Firefox and WebKit, as in `requestinterception.test.ts`.
 * - "should fail navigation when aborting main resource" checks Strider's error message for each browser's network error.
 * - "should not throw \"Invalid Interception Id\" if the request was cancelled" holds the iframe's request until the test
 *   releases it, and doesn't check the no-throw step, as in `requestinterception.test.ts`.
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage, NetworkRequest, NetworkResponse, type Page, PageNavigation, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import { HttpClientRequest, HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import { pathToFileURL } from "node:url"
import { assetPath, failureOf } from "../harness/playwright.ts"
import { pngSize } from "../harness/png.ts"
import { html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

type Navigation = PageNavigation.PageNavigation

/** The response a navigation carried, when it had one: a navigation to a `data:` URL has none. */
const responseOf = (navigation: Navigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

const statusOf = (navigation: Navigation): number | undefined =>
  Option.getOrUndefined(Option.map(responseOf(navigation), (response) => response.status))

const isOk = (navigation: Navigation): boolean => {
  const status = statusOf(navigation)
  return status !== undefined && status >= 200 && status <= 299
}

/** A navigation request, which is a document's request for its own navigation. */
const isNavigation = (request: NetworkRequest.NetworkRequest): boolean =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/** Puppeteer's `isFavicon`: the browser's own request for the site's icon, which the original's listeners skip. */
const isFavicon = (request: NetworkRequest.NetworkRequest): boolean => String(request.url).includes("favicon.ico")

/** The value an Option holds, asserted present: Chai's `isTrue` doesn't narrow the type. */
const valueOf = <A>(option: Option.Option<A>, what: string): A => {
  assert(Option.isSome(option), `${what} is none`)
  return option.value
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Bounds a wait of the port's own, so a failure says what it waited for rather than riding the test's budget. The waits
 * here are on the fixture server, or on a request or response the port subscribed to before its action.
 */
const waiting = <A, E, R>(what: string, wait: Effect.Effect<A, E, R>, duration: Duration.Input = "10 seconds") =>
  wait.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.die(new Error(`timed out waiting for ${what}`)) }))

/** Every request the page has made since it was created, which the original's `page.on("request")` collects. */
const requestsOf = Effect.fnUntraced(function*(page: Page.ObservedPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => !isFavicon(request))
})

/**
 * Puppeteer's `request.redirectChain()`. Puppeteer keeps one array for every hop of a redirect and fills it as each hop
 * redirects, so each hop's chain is the hops that redirected: all of them but the chain's last hop. The chain is found by
 * walking Strider's redirect links from `hop` to its first hop, then forward again.
 */
const redirectChainOf = Effect.fnUntraced(function*(
  page: Page.ObservedPage,
  hop: NetworkRequest.NetworkRequest
) {
  const redirects = yield* NetworkRequest.redirects(page)
  let first = hop
  for (;;) {
    const previous = yield* redirects.from(first)
    if (Option.isNone(previous)) break
    first = previous.value
  }
  const hops = [first]
  for (;;) {
    const next = yield* redirects.to(hops[hops.length - 1]!)
    if (Option.isNone(next)) break
    hops.push(next.value)
  }
  return hops.slice(0, -1)
})

/** The index of `hop` in `hops`, by the hop it is: Puppeteer's `indexOf` on the request objects. */
const indexOfHop = (hops: ReadonlyArray<NetworkRequest.NetworkRequest>, hop: NetworkRequest.NetworkRequest) =>
  hops.findIndex((candidate) => candidate.hop === hop.hop)

/** A handler that records each request it's given, then continues it: Puppeteer's `page.on("request")` and `continue()`. */
const recording = (seen: Array<NetworkRequest.NetworkRequest>) => ({ request }: Route.RequestPhase) =>
  Effect.sync(() => {
    seen.push(request)
  }).pipe(Effect.andThen(Route.continue))

/** As `recording`, without the browser's icon request, which the original's listeners skip with `isFavicon`. */
const recordingPage = (seen: Array<NetworkRequest.NetworkRequest>) => ({ request }: Route.RequestPhase) =>
  Effect.sync(() => {
    if (!isFavicon(request)) seen.push(request)
  }).pipe(Effect.andThen(Route.continue))

/**
 * What Strider reports of a request once it has ended. `NetworkRequest.failure` doesn't wait, so a failure the browser
 * reports after the page's own script has settled has to be waited for: the response read resolves when the request has
 * ended, and gives none for a request that failed.
 */
const failureOnceEnded = Effect.fnUntraced(function*(page: Page.ObservedPage, request: NetworkRequest.NetworkRequest) {
  yield* waiting(`the end of ${String(request.url)}`, yield* NetworkRequest.response(page, request))
  return yield* NetworkRequest.failure(page, request)
})

/** Every response the page has had since it was created, without the browser's icon request: Puppeteer's `response` events. */
const responsesOf = Effect.fnUntraced(function*(page: Page.ObservedPage) {
  const history = yield* NetworkResponse.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((response) => !String(response.url).includes("favicon.ico"))
})

/** The page's PNG, read once: the bytes the binary-response test fulfills with. */
const pptrPng = new Uint8Array(fs.readFileSync(assetPath("puppeteer", "pptr.png")))

/** The two cached resources, each with the page that references it, as the cache tests load them. */
const cacheCases = [
  { url: "/cached/one-style.html", cachedResourceUrl: "/cached/one-style.css", resourceType: "stylesheet" },
  { url: "/cached/one-script.html", cachedResourceUrl: "/cached/one-script.js", resourceType: "script" }
] as const

upstream(import.meta.filename, {}, (test) => {
  test("cooperative request interception Page.setRequestInterception should intercept", ({ page, server }) =>
    Effect.gen(function*() {
      const seen: Array<{ request: NetworkRequest.NetworkRequest; frameUrl: string; mainId: string }> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.gen(function*() {
          if (!isFavicon(request)) {
            const main = yield* page.frames
            seen.push({ request, frameUrl: String(main.url), mainId: main.id })
          }
          return yield* Route.continue
        }))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original's listener sees the navigation request; a handler that was never asked would check nothing
      assert.isAtLeast(seen.length, 1)
      for (const { request, frameUrl, mainId } of seen) {
        assert.include(String(request.url), "empty.html")
        assert.isTrue(Boolean(request.headers["user-agent"]))
        assert.strictEqual(request.method, "GET")
        assert.isTrue(isNavigation(request))
        // Puppeteer's `request.frame() === page.mainFrame()`, and the main frame's URL when the request is paused
        assert.isTrue(request.initiator._tag === "Document" && request.initiator.navigable === mainId)
        assert.strictEqual(frameUrl, "about:blank")
      }
      assert.isTrue(isOk(navigation))
    }))

  test("cooperative request interception Page.setRequestInterception should work when POST is redirected with 302", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rredirect", "/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.route("**/*", () => Route.continue)
      yield* page.setContent(html(`
    <form action="/rredirect" method="post">
      <input type="hidden" id="foo" name="foo" value="FOOBAR" />
    </form>
  `))
      // Puppeteer's `Promise.all([page.$eval('form', form => form.submit()), page.waitForNavigation()])`: the navigation is
      // subscribed before the submit
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => (document.querySelector("form") as HTMLFormElement).submit())
      yield* navigated
    }))

  // @see https://github.com/puppeteer/puppeteer/issues/3973
  test("cooperative request interception Page.setRequestInterception should work when header manipulation headers with redirect", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rrredirect", "/empty.html")
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeader("foo", "bar")))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/rrredirect", { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /empty.html", received)
      assert.strictEqual(serverRequest.headers["foo"], "bar")
    }))

  // @see https://github.com/puppeteer/puppeteer/issues/4743
  test("cooperative request interception Page.setRequestInterception should be able to remove headers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.continueWith((request) =>
          pipe(
            request,
            HttpClientRequest.setHeader("foo", "bar"),
            HttpClientRequest.removeHeader("origin") // remove "origin" header
          )
        ))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /empty.html", received)
      assert.isUndefined(serverRequest.headers.origin)
    }))

  test("cooperative request interception Page.setRequestInterception should contain referer header", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.include(String(requests[1]!.url), "/one-style.css")
      assert.include(requests[1]!.headers.referer, "/one-style.html")
    }))

  test("cooperative request interception Page.setRequestInterception should properly return navigation response when URL has cookies", ({ page, server }) =>
    Effect.gen(function*() {
      // Setup cookie.
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.cookies.set({ name: "foo", value: "bar", scope: { url: server.EMPTY_PAGE } })

      // Setup request interception.
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.reload({ waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
    }))

  test("cooperative request interception Page.setRequestInterception should stop intercepting", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `once("request")` continues the first request, then `setRequestInterception(false)` stops
      // interception; this handler continues every request, and the removed route is checked to be no longer asked.
      const interception = yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const asked = yield* interception.hits
      yield* interception.remove
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* interception.hits, asked)
    }))

  test("cooperative request interception Page.setRequestInterception should show custom HTTP headers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isAtLeast(requests.length, 1)
      for (const request of requests) assert.strictEqual(request.headers["foo"], "bar")
      assert.isTrue(isOk(navigation))
    }))

  // @see https://github.com/puppeteer/puppeteer/issues/4337
  test("cooperative request interception Page.setRequestInterception should work with redirect inside sync XHR", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRedirect("/logo.png", "/pptr.png")
      yield* page.route("**/*", () => Route.continue)
      const status = yield* page.evaluateInMainWorld(async () => {
        const request = new XMLHttpRequest()
        request.open("GET", "/logo.png", false) // `false` makes the request synchronous
        request.send(null)
        return request.status
      })
      assert.strictEqual(status, 200)
    }))

  test("cooperative request interception Page.setRequestInterception should work with custom referer headers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { referer: server.EMPTY_PAGE } })
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recording(requests))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Puppeteer's `request` is the last one its listener saw
      const request = requests.at(-1)
      assert.isDefined(request)
      assert.strictEqual(request.headers["referer"], server.EMPTY_PAGE)
      assert.isTrue(isOk(navigation))
    }))

  test("cooperative request interception Page.setRequestInterception should be abortable", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ request }) => String(request.url).endsWith(".css") ? Route.abort() : Route.continue)
      const navigation = yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.isTrue(isOk(navigation))
      const requests = yield* requestsOf(page)
      // Puppeteer counts `requestfailed` events; a failed request is one with a failure
      let failedRequests = 0
      for (const request of requests) {
        if (Option.isSome(yield* failureOnceEnded(page, request))) failedRequests++
      }
      const document = requests.find((request) => isNavigation(request))
      assert.isDefined(document)
      assert.isTrue(Option.isNone(yield* failureOnceEnded(page, document)))
      assert.strictEqual(failedRequests, 1)
    }))

  test("cooperative request interception Page.setRequestInterception should be abortable with custom error codes", ({ page, server }) =>
    Effect.gen(function*() {
      // Only Chromium takes a reason (method-route-abort); Firefox and WebKit report one failure for every reason
      yield* page.route("**/*", () => Route.abort("internetDisconnected"))
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the navigation")
      assert.isDefined(error)
      const requests = yield* requestsOf(page)
      const document = requests.find((request) => isNavigation(request) && String(request.url) === server.EMPTY_PAGE)
      assert.isDefined(document)
      const failure = yield* failureOnceEnded(page, document)
      const failureValue = valueOf(failure, "failure")
      assert.strictEqual(failureValue.errorText, "net::ERR_INTERNET_DISCONNECTED")
    }))

  test("cooperative request interception Page.setRequestInterception should send referer", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { referer: "http://google.com/" } })
      yield* page.route("**/*", () => Route.continue)
      const received = yield* server.waitForRequest("/grid.html")
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /grid.html", received)
      assert.strictEqual(serverRequest.headers["referer"], "http://google.com/")
    }))

  test("cooperative request interception Page.setRequestInterception should fail navigation when aborting main resource", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.abort())
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the navigation")
      // The network error each browser reports, as the Playwright port of this test reads it
      const expected = browserName === "webkit"
        ? "Blocked by Web Inspector"
        : browserName === "firefox"
        ? "NS_ERROR_ABORT"
        : "net::ERR_FAILED"
      assert.include(messageOf(error), expected)
    }))

  test("cooperative request interception Page.setRequestInterception should work with redirects", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      server.setRedirect("/non-existing-page.html", "/non-existing-page-2.html")
      server.setRedirect("/non-existing-page-2.html", "/non-existing-page-3.html")
      server.setRedirect("/non-existing-page-3.html", "/non-existing-page-4.html")
      server.setRedirect("/non-existing-page-4.html", "/empty.html")
      const navigation = yield* page.goto(server.PREFIX + "/non-existing-page.html", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      const response = responseOf(navigation)
      const responseValue = valueOf(response, "response")
      assert.include(responseValue.url, "empty.html")
      assert.strictEqual(requests.length, 5)
      // Check redirect chain: the final hop's chain, then each hop's chain, where each hop sits at its own position
      const hops = yield* requestsOf(page)
      const final = hops.find((request) => String(request.url).includes("empty.html"))
      assert.isDefined(final)
      const redirectChain = yield* redirectChainOf(page, final)
      assert.strictEqual(redirectChain.length, 4)
      assert.include(String(redirectChain[0]!.url), "/non-existing-page.html")
      assert.include(String(redirectChain[2]!.url), "/non-existing-page-3.html")
      for (let i = 0; i < redirectChain.length; ++i) {
        const request = redirectChain[i]!
        assert.isTrue(isNavigation(request))
        assert.strictEqual(indexOfHop(yield* redirectChainOf(page, request), request), i)
      }
    }))

  test("cooperative request interception Page.setRequestInterception should work with redirects for subresources", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      server.setRedirect("/one-style.css", "/two-style.css")
      server.setRedirect("/two-style.css", "/three-style.css")
      server.setRedirect("/three-style.css", "/four-style.css")
      server.setRoute("/four-style.css", (_req, res) => {
        return res.end("body {box-sizing: border-box; }")
      })
      const navigation = yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      const response = responseOf(navigation)
      const responseValue = valueOf(response, "response")
      assert.include(responseValue.url, "one-style.html")
      assert.strictEqual(requests.length, 5)
      // Puppeteer's `requests[1]` is the stylesheet's first hop, whose chain is the three hops that redirected
      const hops = yield* requestsOf(page)
      const stylesheet = hops.find((request) => String(request.url).endsWith("/one-style.css"))
      assert.isDefined(stylesheet)
      const redirectChain = yield* redirectChainOf(page, stylesheet)
      assert.strictEqual(redirectChain.length, 3)
      assert.include(String(redirectChain[0]!.url), "/one-style.css")
      assert.include(String(redirectChain[2]!.url), "/three-style.css")
    }))

  test("cooperative request interception Page.setRequestInterception should be able to abort redirects", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.route(
        "**/*",
        ({ request }) => String(request.url).includes("non-existing-2") ? Route.abort() : Route.continue
      )
      server.setRedirect("/non-existing.json", "/non-existing-2.json")
      server.setRedirect("/non-existing-2.json", "/simple.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // A fetch that succeeds would return a `Response`, which doesn't cross by value; this one fails, and its message returns
      const result = yield* page.evaluateInMainWorld(async () => {
        try {
          return await fetch("/non-existing.json").then(() => "resolved")
        } catch (error) {
          return (error as Error).message
        }
      })
      if (browserName === "chromium") {
        assert.include(result, "Failed to fetch")
      } else {
        assert.include(result, "NetworkError")
      }
    }))

  test("cooperative request interception Page.setRequestInterception should work with equal requests", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      let responseCount = 1
      server.setRoute("/zzz", (_req, res) => {
        return res.end(responseCount++ * 11 + "")
      })

      let spinner = false
      // Cancel 2nd request.
      yield* page.route("**/*", ({ request }) => {
        if (isFavicon(request)) return Route.continue
        const decision = spinner ? Route.abort() : Route.continue
        spinner = !spinner
        return decision
      })
      const results = yield* page.evaluateInMainWorld(() => {
        return Promise.all([
          fetch("/zzz")
            .then((response) => {
              return response.text()
            })
            .catch(() => {
              return "FAILED"
            }),
          fetch("/zzz")
            .then((response) => {
              return response.text()
            })
            .catch(() => {
              return "FAILED"
            }),
          fetch("/zzz")
            .then((response) => {
              return response.text()
            })
            .catch(() => {
              return "FAILED"
            })
        ])
      })
      assert.deepStrictEqual(results, ["11", "FAILED", "22"])
    }))

  test("cooperative request interception Page.setRequestInterception should navigate to dataURL and fire dataURL requests", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's interception doesn't pause `data:` URLs (the browser doesn't offer them to its fetch interception), and
      // its `request` event reports them anyway, as an observation that `continue()` doesn't affect. Strider's routes are
      // asked about paused requests only, so the observation is the request history.
      yield* page.route("**/*", () => Route.continue)
      const dataURL = "data:text/html,<div>yo</div>"
      const navigation = yield* page.goto(dataURL, { waitUntil: "load" })
      // The original checks the response's 200; a `data:` navigation has no response here, so its committed outcome is checked
      assert.strictEqual(navigation._tag, "Committed")
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(String(requests[0]!.url), dataURL)
    }))

  test("cooperative request interception Page.setRequestInterception should be able to fetch dataURL and fire dataURL requests", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // As above, the `data:` request is read from the history, from the requests that came after the interception
      const before = (yield* requestsOf(page)).length
      yield* page.route("**/*", () => Route.continue)
      const dataURL = "data:text/html,<div>yo</div>"
      const text = yield* page.evaluateInMainWorld((url) => {
        return fetch(url).then((r) => {
          return r.text()
        })
      }, dataURL)
      assert.strictEqual(text, "<div>yo</div>")
      const requests = (yield* requestsOf(page)).slice(before)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(String(requests[0]!.url), dataURL)
    }))

  test("cooperative request interception Page.setRequestInterception should navigate to URL with hash and fire requests without hash", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      const navigation = yield* page.goto(server.EMPTY_PAGE + "#hash", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      // Puppeteer's `response.url()` is the request's URL with its fragment. A `NetworkResponse`'s URL is the HTTP one, with
      // none; the URL the navigation went to is where the fragment is kept
      assert.strictEqual(navigation.url, server.EMPTY_PAGE + "#hash")
      assert.strictEqual(requests.length, 1)
      // Puppeteer's `request.url()` appends the fragment CDP reports apart; a `NetworkRequest`'s URL is the one sent,
      // which the test's title says has none
      assert.strictEqual(String(requests[0]!.url), server.EMPTY_PAGE)
    }))

  test("cooperative request interception Page.setRequestInterception should work with encoded server", ({ page, server }) =>
    Effect.gen(function*() {
      // The requestWillBeSent will report encoded URL, whereas interception will report URL as-is. @see crbug.com/759388
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.goto(server.PREFIX + "/some nonexisting page", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 404)
    }))

  test("cooperative request interception Page.setRequestInterception should work with badly encoded server", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      server.setRoute("/malformed", (_req, res) => {
        return res.end()
      })
      const navigation = yield* page.goto(server.PREFIX + "/malformed?rnd=%911", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
    }))

  test("cooperative request interception Page.setRequestInterception should work with missing stylesheets", ({ page, server }) =>
    Effect.gen(function*() {
      // The requestWillBeSent will report URL as-is, whereas interception will report encoded URL for stylesheet.
      // @see crbug.com/759388
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      const navigation = yield* page.goto(server.PREFIX + "/style-404.html", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(requests.length, 2)
      const hops = yield* requestsOf(page)
      const stylesheet = hops[1]
      assert.isDefined(stylesheet)
      const response = yield* waiting("the stylesheet's response", yield* NetworkRequest.response(page, stylesheet))
      const responseValue = valueOf(response, "response")
      assert.strictEqual(responseValue.status, 404)
    }))

  test("cooperative request interception Page.setRequestInterception should not throw \"Invalid Interception Id\" if the request was cancelled", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(html("<iframe></iframe>"))
      // Puppeteer's listener doesn't continue the request: it's held until the test continues it
      const paused = yield* Deferred.make<NetworkRequest.NetworkRequest>()
      const release = yield* Deferred.make<void>()
      yield* page.route("**/empty.html", ({ request }) =>
        Deferred.succeed(paused, request).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Route.continue)
        ))
      yield* page.evaluateInMainWorld((url) => {
        ;(document.querySelector("iframe") as HTMLIFrameElement).src = url
      }, server.EMPTY_PAGE)
      // Wait for request interception.
      const request = yield* waiting("the iframe's request", Deferred.await(paused))
      assert.include(String(request.url), "empty.html")
      // Delete frame to cause request to be canceled.
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("iframe") as HTMLIFrameElement).remove()
      })
      // Puppeteer's `request.continue()` doesn't throw here. A Strider decision for the cancelled request is applied to
      // nothing, and a failure is logged rather than raised to the handler, so the port releases the held request and does
      // not check the no-throw step (as RO-017 of the Playwright port).
      yield* Deferred.succeed(release, undefined)
    }))

  test("cooperative request interception Page.setRequestInterception should work with file URLs", ({ page }) =>
    Effect.gen(function*() {
      const urls = new Set<string | undefined>()
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          urls.add(String(request.url).split("/").pop())
        }).pipe(Effect.andThen(Route.continue)))
      yield* page.goto(pathToFileURL(assetPath("puppeteer", "one-style.html")).href, { waitUntil: "load" })
      assert.strictEqual(urls.size, 2)
      assert.isTrue(urls.has("one-style.html"))
      assert.isTrue(urls.has("one-style.css"))
    }))

  // Puppeteer's `setCacheEnabled(true)` is the default here, so the port doesn't call it. A cache hit is a response whose
  // `servedBy` is "cache", where Puppeteer reads its `requestservedfromcache` event.
  for (const { cachedResourceUrl, resourceType, url } of cacheCases) {
    test(
      "cooperative request interception Page.setRequestInterception should cache ${resourceType} if cache enabled",
      { variant: resourceType },
      ({ page, server }) =>
        Effect.gen(function*() {
          // Load and re-load to make sure it's cached.
          yield* page.goto(server.PREFIX + url, { waitUntil: "load" })
          const seen: Array<NetworkRequest.NetworkRequest> = []
          yield* page.route("**/*", recordingPage(seen))
          yield* page.reload({ waitUntil: "load" })
          assert.isAtLeast(seen.length, 1)
          const cached = (yield* responsesOf(page)).filter((response) => response.servedBy === "cache")
          assert.strictEqual(cached.length, 1)
          assert.strictEqual(String(cached[0]!.url), server.PREFIX + cachedResourceUrl)
        })
    )
  }

  test("cooperative request interception Page.setRequestInterception should load fonts if cache enabled", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      // Puppeteer's `waitForResponse` is subscribed before the navigation. The fixture has no `one-style.woff`, so the
      // response is the server's 404, which the original's wait accepts as well.
      const font = yield* NetworkResponse.next(page, { url: "**/one-style.woff" })
      yield* page.goto(server.PREFIX + "/cached/one-style-font.html", { waitUntil: "load" })
      yield* waiting("the font's response", font)
    }))

  test("cooperative request interception Request.continue should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
    }))

  test("cooperative request interception Request.continue should amend HTTP headers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeader("FOO", "bar")))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz")
      })
      assert.strictEqual((yield* waiting("the request to /sleep.zzz", received)).headers["foo"], "bar")
    }))

  test("cooperative request interception Request.continue should redirect in a way non-observable to page", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ request }) =>
        String(request.url).includes("/empty.html")
          ? Route.continueWith(HttpClientRequest.setUrl(server.PREFIX + "/consolelog.html"))
          : Route.continue)
      // Puppeteer's `waitEvent(page, "console")` is subscribed before the navigation
      const message = yield* ConsoleMessage.next(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const consoleMessage = yield* waiting("the console message", message)
      assert.strictEqual(String(yield* page.url), server.EMPTY_PAGE)
      assert.strictEqual(consoleMessage.text, "yellow")
    }))

  test("cooperative request interception Request.continue should amend method", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setMethod("POST")))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz")
      })
      assert.strictEqual((yield* waiting("the request to /sleep.zzz", received)).method, "POST")
    }))

  test("cooperative request interception Request.continue should amend post data", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.bodyText("doggo")))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "POST", body: "birdy" })
      })
      assert.strictEqual(
        yield* waiting("the request to /sleep.zzz", received).pipe(
          Effect.map((serverRequest) => serverRequest.body.toString("utf8"))
        ),
        "doggo"
      )
    }))

  test("cooperative request interception Request.continue should amend both post data and method on navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route(
        "**/*",
        () =>
          Route.continueWith((request) =>
            pipe(request, HttpClientRequest.setMethod("POST"), HttpClientRequest.bodyText("doggo"))
          )
      )
      // Puppeteer's `Promise.all` subscribes to the request before the navigation starts
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /empty.html", received)
      assert.strictEqual(serverRequest.method, "POST")
      assert.strictEqual(serverRequest.body.toString("utf8"), "doggo")
    }))

  test("cooperative request interception Request.respond should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 201, headers: { foo: "bar" } })))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(response.status, 201)
      assert.strictEqual(response.headers["foo"], "bar")
      // The body is read from the page: a fulfilled body can't be read back through NetworkResponse on Chromium (ROOK-540)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          document.body.textContent
        ),
        "Yo, page!"
      )
    }))

  test("cooperative request interception Request.respond should work with status code 422", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 422 })))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(response.status, 422)
      assert.strictEqual(response.statusText, "Unprocessable Entity")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.body.textContent), "Yo, page!")
    }))

  test("cooperative request interception Request.respond should redirect", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", ({ request }) =>
        String(request.url).includes("rrredirect")
          ? Route.fulfill(HttpServerResponse.empty({ status: 302, headers: { location: server.EMPTY_PAGE } }))
          : Route.continue)
      const navigation = yield* page.goto(server.PREFIX + "/rrredirect", { waitUntil: "load" })
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(String(response.url), server.EMPTY_PAGE)
      // Puppeteer's `response.request().redirectChain()` is the one hop before the final request
      const final = (yield* requestsOf(page)).find((request) =>
        isNavigation(request) && String(request.url) === server.EMPTY_PAGE
      )
      assert.isDefined(final)
      const chain = yield* redirectChainOf(page, final)
      assert.strictEqual(chain.length, 1)
      assert.strictEqual(String(chain[0]!.url), server.PREFIX + "/rrredirect")
    }))

  test("cooperative request interception Request.respond should allow mocking binary responses", ({ page, server }) =>
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

  test("cooperative request interception Request.resourceType should work for document type", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isAtLeast(requests.length, 1)
      // Puppeteer's `response.request()` is the navigation's own request
      const request = (yield* requestsOf(page)).find((candidate) =>
        isNavigation(candidate) && String(candidate.url) === server.EMPTY_PAGE
      )
      assert.isDefined(request)
      assert.strictEqual(request.resourceType, "document")
    }))

  test("cooperative request interception Request.resourceType should work for stylesheets", ({ page, server }) =>
    Effect.gen(function*() {
      const cssRequests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          if (String(request.url).endsWith("css")) cssRequests.push(request)
        }).pipe(Effect.andThen(Route.continue)))
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.strictEqual(cssRequests.length, 1)
      const request = cssRequests[0]!
      assert.include(String(request.url), "one-style.css")
      assert.strictEqual(request.resourceType, "stylesheet")
    }))
})
