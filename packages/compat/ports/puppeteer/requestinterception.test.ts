/**
 * Puppeteer's `test/src/requestinterception.test.ts`, in file order: its first 29 tests, through "should emit
 * requestfailed for requests aborted right after they start", then the rest.
 *
 * What the port changes:
 * - `page.setRequestInterception(true)` with `page.on("request", …)` and `request.continue()`, `request.abort()`, and
 *   `request.respond()` is `page.route` with a handler that returns its decision: `Route.continue`, `Route.continueWith`
 *   over the header changes, or `Route.abort`. A handler's failure is logged and the default continues, so a check made
 *   inside a handler would hide its failure. Each handler records what it saw, and the test body asserts on the record.
 * - `page.setRequestInterception(false)` is removing the route's registration. Puppeteer's `page.once("request", …)`
 *   continues the first request only; the port's handler continues every request, and the test checks that the removed
 *   route is no longer asked (its `hits` stop counting), which the original's second `goto` only shows by not hanging.
 * - `page.setExtraHTTPHeaders(…)` is `page.emulate({ extraHTTPHeaders })`, whose registration lasts as long as the test.
 * - Puppeteer's `request.headers()`, `frame()`, `isNavigationRequest()`, `method()`, and `url()` are a Strider request's
 *   fields and its initiator. A request's `frame()` is the navigable its initiator names.
 * - `page.on("request")` and `page.on("requestfailed")` with `request.failure()` are the request history
 *   (`NetworkRequest.history`) read after the action, and `NetworkRequest.failure` on each request. Puppeteer's
 *   `request.redirectChain()` is `redirectChainOf` below: Puppeteer's chain is one array shared by every hop of a
 *   redirect, filled as each hop redirects, so every hop of the chain sees the same list of the hops that redirected.
 *   `response.request()` is the response's hop, found in the history by its URL.
 * - `page.waitForRequest` and `page.waitForResponse` (with `timeout: 1000`) are `NetworkRequest.next` and
 *   `NetworkResponse.next`, subscribed before the action, and a one-second bound on each wait (`waiting`).
 * - `server.waitForRequest` is the fixture server's, listened for before the action, as the other ports do.
 * - Puppeteer's `page.evaluate` runs in the main world: `page.evaluateInMainWorld`. `page.$eval(…)` becomes an evaluation
 *   in the main world, since the original only runs its script and waits for nothing it returns.
 * - `page.waitForNetworkIdle({ idleTime, timeout })` has no Strider counterpart. The port waits, on a condition, until no
 *   request of the page is pending, which is what the original's idle wait gives the terminal events a chance to arrive
 *   for. A pending request is one with no failure and no response in the history; Strider has no `requestfinished` event,
 *   so a request whose response arrived counts as finished.
 * - Puppeteer's `page.goto`, `page.reload`, and `page.waitForNavigation` wait for `load`, and Strider's `goto` resolves at
 *   commit, so each one the original relies on the default for passes `waitUntil: "load"`.
 * - Puppeteer's `isFavicon` skips the browser's `/favicon.ico` request, which the port's listeners skip the same way.
 * - Puppeteer's `html` tagged template is the harness's `html` function, and `waitEvent` is a subscription before the
 *   action, read with `Deferred`.
 * - "should work with redirects" and "should work with redirects for subresources" read their chains from the hops the
 *   browser reported, walking Strider's redirect links (`NetworkRequest.redirects`) from the first hop. Strider reports
 *   each hop as its own request, so `requests[1]` of the subresource test is the stylesheet's first hop, whose chain
 *   Puppeteer's shared array gives as the three hops before the last.
 * - "should be able to abort redirects" returns the fetch's message. A fetch that succeeds would return a `Response`,
 *   which doesn't cross by value, so a success returns `"resolved"` in its place; the original expects the fetch to fail.
 * - "should navigate to dataURL and fire dataURL requests" checks the navigation's `Committed` outcome in place of the
 *   response's 200 status: a navigation to a `data:` URL has no response in Strider (`responseOf`), so the outcome is what
 *   the original's status check reads.
 * - "should be abortable" counts the failed requests in the history, where Puppeteer counts `requestfailed` events, and
 *   reads each request's failure from `NetworkRequest.failure` once the request has ended (`failureOnceEnded`: the read
 *   itself doesn't wait).
 * - The two `data:` tests read the request from the history. Puppeteer doesn't pause `data:` requests in its interception,
 *   and reports them through its `request` event; Strider's routes are asked only about requests the browser pauses, which
 *   `data:` requests aren't (Chromium's fetch interception doesn't offer them).
 * - "should be abortable with custom error codes" reads the failure of the navigation request, after `goto` fails, as
 *   Puppeteer reads the `requestfailed` event's `failure().errorText`. Strider's `abort` takes a reason only on Chromium
 *   (method-route-abort); Firefox and WebKit ignore it and let the navigation load, so the test is ledgered for them.
 * - "should fail navigation when aborting main resource" checks Strider's navigation error message for each browser's
 *   network error, as the Playwright port of this test does.
 * - "should not throw \"Invalid Interception Id\" if the request was cancelled" holds the iframe's request in its handler
 *   until the test releases it, as Puppeteer's listener leaves the request paused. The frame is removed meanwhile, which
 *   cancels the request. The original's `request.continue()` then doesn't throw; a Strider decision for a request that
 *   has ended is applied to nothing and its failure is logged, not raised to the handler, so the port keeps the
 *   cancellation and releases the held request, and that no-throw step isn't observable here (as RO-017 of the Playwright
 *   port).
 * - "should work with requests without networkId" runs on Chromium only, since the original's session is CDP's. Puppeteer's
 *   `page.createCDPSession()` is a connection of the port's own to the browser's debugging port (the file's Chromium
 *   launches with `--remote-debugging-port` and Puppeteer's runner arguments), with a session attached to the page's
 *   target, as `cdp/CDPSession.test.ts` does. The test's point is that a request Chromium makes with no network id still
 *   reaches the route, so the route is the one the page declares.
 * - "should emit requestfailed for requests aborted right after they start" reads Puppeteer's pending set from the
 *   history, and checks the same terminal state for each request. Its loop runs as written, 50 times.
 * - The second half's notes:
 *   - "should work with file URLs" is a `file:` navigation of the vendored `one-style.html`.
 *   - The cache tests: Puppeteer's `setCacheEnabled(true)` is Strider's default, so the port doesn't call it. A cache hit
 *     is a response whose `servedBy` is `"cache"`, in place of the `requestservedfromcache` event. The
 *     "should not cache ${resourceType} if cache disabled" tests are ledgered, since Strider has no page-level cache switch.
 *   - "should emit a single request for a font Chrome restarts" reads the font's request from the history: one request,
 *     a response that ended (`NetworkRequest.response`), and no failure. Strider has no `requestfinished` event.
 *   - "should work with worker" waits on `page.workers` in place of `workercreated`.
 *   - Puppeteer's `request.continue({ url })` is `HttpClientRequest.setUrl`, which Firefox refuses (`interception.continueUrl`),
 *     so the redirect test is ledgered for Firefox. `method` and `postData` are `setMethod` and `bodyText`.
 *   - `request.continue({ headers })` takes a change to the request, not a headers argument, so Puppeteer's `Headers`
 *     instance form has no counterpart there and is ledgered as not applicable. `request.respond` takes its headers as
 *     Effect's header input, which accepts a `Headers` instance, so that test is ported.
 *   - A decision the browser refuses (an invalid header value) is applied after its handler returned, so the refusal
 *     isn't raised to the call that produced it: the two "should fail if the header value is invalid" tests are ledgered
 *     as differing by design.
 *   - Puppeteer's `request.respond` stringifies a non-string header value (`foo: true`). Strider's header input is
 *     typed as strings and refuses anything else at compile time, so the stringifying test is not applicable.
 *   - The binary and content-length tests read the image's size and the body's length the way the Playwright port of the
 *     same tests does (`pngSize`, the page's text). A fulfilled body isn't read back through `NetworkResponse` on Chromium
 *    , so the page's text stands for it.
 *   - "should report correct encoding from page when content-type is set" reads the page's `innerText`, as the original does.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import {
  Condition,
  ConsoleMessage,
  Expect,
  NetworkRequest,
  NetworkResponse,
  type Page,
  PageNavigation,
  Route
} from "@usestrider/browser"
import { CSS, DOM, Target } from "@usestrider/browser/cdp"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { pipe } from "effect/Function"
import { HttpClientRequest, HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as fs from "node:fs"
import { pathToFileURL } from "node:url"
import { assetPath, failureOf, startWaiting } from "../harness/playwright.ts"
import { pngSize } from "../harness/png.ts"
import { html, runnerChromiumArgs } from "../harness/puppeteer.ts"
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

/** The page's PNG, read once: the bytes the binary-response tests fulfill with. */
const pptrPng = new Uint8Array(fs.readFileSync(assetPath("puppeteer", "pptr.png")))

/** The two cached resources, each with the page that references it, as the cache tests load them. */
const cacheCases = [
  { url: "/cached/one-style.html", cachedResourceUrl: "/cached/one-style.css", resourceType: "stylesheet" },
  { url: "/cached/one-script.html", cachedResourceUrl: "/cached/one-script.js", resourceType: "script" }
] as const

/** The debugging port the browser listens on, for the one test that needs a CDP session of the page's own. */
const debuggingPort = 9453

/** Runs `body` on a raw CDP connection to the browser's debugging port, closed when the body ends. */
const withBrowserConnection = <A, E, R>(body: (cdp: CdpConnection.CdpConnection) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.gen(function*() {
    const json = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) => response.json() as Promise<unknown>)
    )
    const { webSocketDebuggerUrl } = Schema.decodeUnknownSync(Schema.Struct({ webSocketDebuggerUrl: Schema.String }))(
      json
    )
    const transport = yield* Transport.webSocket(webSocketDebuggerUrl)
    const cdp = yield* CdpConnection.make(transport)
    return yield* body(cdp)
  })).pipe(Effect.provide(NodeSocket.layerWebSocketConstructor))

/** The original's `page.createCDPSession()`: a session on the target of the page that shows `url`. */
const sessionFor = Effect.fnUntraced(function*(cdp: CdpConnection.CdpConnection, url: string) {
  const { targetInfos } = yield* Target.getTargets().pipe(Protocol.on(cdp.browser))
  const target = targetInfos.find((info) => info.type === "page" && info.url === url)
  assert.isDefined(target, `no page target shows ${url}`)
  const { sessionId } = yield* Target.attachToTarget({ targetId: target!.targetId, flatten: true }).pipe(
    Protocol.on(cdp.browser)
  )
  return yield* cdp.session(sessionId)
})

upstream(import.meta.filename, {
  launch: { chromium: { args: [...runnerChromiumArgs, `--remote-debugging-port=${debuggingPort}`] } }
}, (test) => {
  test("request interception Page.setRequestInterception should intercept", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should work when POST is redirected with 302", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should work with keep alive redirects", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/rredirect", (_req, res) => {
        res.writeHead(302, { location: "/target" })
        res.end()
      })
      server.setRoute("/target", (_req, res) => {
        res.end("Hello World")
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.route("**/*", () => Route.continue)
      // Puppeteer's `page.waitForRequest` and `page.waitForResponse`, each with a one-second timeout, subscribed before
      // the fetch the test starts
      const redirectRequest = yield* NetworkRequest.next(page, { url: "**/rredirect" })
      const targetResponse = yield* NetworkResponse.next(page, { url: "**/target" })
      yield* page.evaluateInMainWorld(async (url) => {
        void fetch(url, {
          method: "POST",
          body: JSON.stringify({ test: "test" }),
          mode: "no-cors",
          keepalive: true
        }).then(async (res) => {
          console.log(await res.text())
        })
      }, server.PREFIX + "/rredirect")
      yield* waiting("the request to /rredirect", redirectRequest, "1 second")
      yield* waiting("the response from /target", targetResponse, "1 second")
    }))

  // @see https://github.com/puppeteer/puppeteer/issues/3973
  test("request interception Page.setRequestInterception should work when header manipulation headers with redirect", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rrredirect", "/empty.html")
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeader("foo", "bar")))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/rrredirect", { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /empty.html", received)
      assert.strictEqual(serverRequest.headers["foo"], "bar")
    }))

  // @see https://github.com/puppeteer/puppeteer/issues/4743
  test("request interception Page.setRequestInterception should be able to remove headers", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should contain referer header", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", recordingPage(requests))
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.include(String(requests[1]!.url), "/one-style.css")
      assert.include(requests[1]!.headers.referer, "/one-style.html")
    }))

  test("request interception Page.setRequestInterception should not allow mutating request headers", ({ page, server }) =>
    Effect.gen(function*() {
      const requests: Array<NetworkRequest.NetworkRequest> = []
      yield* page.route("**/*", ({ request }) =>
        Effect.sync(() => {
          if (!isFavicon(request)) requests.push(request)
          // Puppeteer changes the object `request.headers()` returns and continues with it. The change is to a copy here,
          // which a Strider decision doesn't send: `Route.continue` sends the request as it was.
          const headers = { ...request.headers }
          headers["test"] = "test"
        }).pipe(Effect.andThen(Route.continue)))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.notInclude(Object.keys(requests[0]!.headers), "test")
    }))

  test(
    "request interception Page.setRequestInterception should work with requests without networkId",
    { browsers: ["chromium"] },
    ({ page, server }) =>
      withBrowserConnection((cdp) =>
        Effect.gen(function*() {
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const urls: Array<string> = []
          const interception = yield* page.route("**/*", ({ request }) =>
            Effect.sync(() => {
              if (!isFavicon(request)) urls.push(String(request.url))
            }).pipe(Effect.andThen(Route.continue)))
          const session = yield* sessionFor(cdp, server.EMPTY_PAGE)
          yield* DOM.enable().pipe(Protocol.on(session))
          // This causes network requests without networkId.
          yield* CSS.enable().pipe(Protocol.on(session))
          // Puppeteer's interception has seen the request when the command's reply arrives; Strider's route is asked on its
          // own connection, so the reply doesn't order them, and the test waits for the route to have been asked
          yield* interception.hits.waitFor((hits) => hits > 0)
          assert.deepStrictEqual(urls, [server.EMPTY_PAGE])
        })
      )
  )

  test("request interception Page.setRequestInterception should properly return navigation response when URL has cookies", ({ page, server }) =>
    Effect.gen(function*() {
      // Setup cookie.
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.cookies.set({ name: "foo", value: "bar", scope: { url: server.EMPTY_PAGE } })

      // Setup request interception.
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.reload({ waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
    }))

  test("request interception Page.setRequestInterception should stop intercepting", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should show custom HTTP headers", ({ page, server }) =>
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
  test("request interception Page.setRequestInterception should work with redirect inside sync XHR", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should work with custom referer headers", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should be abortable", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should be abortable with custom error codes", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should send referer", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { referer: "http://google.com/" } })
      yield* page.route("**/*", () => Route.continue)
      const received = yield* server.waitForRequest("/grid.html")
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /grid.html", received)
      assert.strictEqual(serverRequest.headers["referer"], "http://google.com/")
    }))

  test("request interception Page.setRequestInterception should fail navigation when aborting main resource", ({ page, server, browserName }) =>
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

  test("request interception Page.setRequestInterception should work with redirects", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should work with redirects for subresources", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should be able to abort redirects", ({ page, server, browserName }) =>
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

  test("request interception Page.setRequestInterception should work with equal requests", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should navigate to dataURL and fire dataURL requests", ({ page }) =>
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

  test("request interception Page.setRequestInterception should be able to fetch dataURL and fire dataURL requests", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should navigate to URL with hash and fire requests without hash", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should work with encoded server", ({ page, server }) =>
    Effect.gen(function*() {
      // The requestWillBeSent will report encoded URL, whereas interception will report URL as-is. @see crbug.com/759388
      yield* page.route("**/*", () => Route.continue)
      const navigation = yield* page.goto(server.PREFIX + "/some nonexisting page", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 404)
    }))

  test("request interception Page.setRequestInterception should work with badly encoded server", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      server.setRoute("/malformed", (_req, res) => {
        return res.end()
      })
      const navigation = yield* page.goto(server.PREFIX + "/malformed?rnd=%911", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
    }))

  test("request interception Page.setRequestInterception should work with missing stylesheets", ({ page, server }) =>
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

  test("request interception Page.setRequestInterception should not throw \"Invalid Interception Id\" if the request was cancelled", ({ page, server }) =>
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

  // @see https://github.com/puppeteer/puppeteer/issues/15575
  test("request interception Page.setRequestInterception should emit requestfailed for requests aborted right after they start", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)

      // Chrome sometimes delivers Network.loadingFailed before Fetch.requestPaused for such requests. The order is racy,
      // so the scenario is repeated to make it likely to show up at least once. The fetch is cross-origin (about:blank to
      // the test server); with a same-origin fetch the abort usually wins before the request is paused.
      for (let i = 0; i < 50; i++) {
        yield* page.setContent(html(`<div>${i}</div>`))
        yield* page.evaluateInMainWorld(
          async (url, abortSync) => {
            const controller = new AbortController()
            const promise = fetch(url, { signal: controller.signal })
            if (abortSync) {
              controller.abort()
            } else {
              setTimeout(() => {
                controller.abort()
              }, 0)
            }
            await promise.catch(() => {})
          },
          `${server.PREFIX}/abort-${i}`,
          i % 2 === 0
        )
      }

      // Puppeteer's `page.waitForNetworkIdle({ idleTime: 100, timeout: 2000 })` gives the terminal events a chance to
      // arrive. Strider has no idle wait, so the port waits on the condition the idle wait stands for: no request pending.
      const pending = Effect.gen(function*() {
        const requests = yield* requestsOf(page)
        const responses = yield* NetworkResponse.history(page)
        assert.strictEqual(responses.dropped, 0)
        const urls: Array<string> = []
        for (const request of requests) {
          if (Option.isSome(yield* NetworkRequest.failure(page, request))) continue
          if (responses.entries.some((response) => response.hop === request.hop)) continue
          urls.push(String(request.url))
        }
        return urls
      })
      yield* Expect.that(
        pending,
        Condition.make("no request is pending", (urls: ReadonlyArray<string>) => urls.length === 0)
      )

      assert.deepStrictEqual(yield* pending, [])
    }))

  test("request interception Page.setRequestInterception should work with file URLs", ({ page }) =>
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
      "request interception Page.setRequestInterception should cache ${resourceType} if cache enabled",
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

  test("request interception Page.setRequestInterception should load fonts if cache enabled", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      // Puppeteer's `waitForResponse` is subscribed before the navigation. The fixture has no `one-style.woff`, so the
      // response is the server's 404, which the original's wait accepts as well.
      const font = yield* NetworkResponse.next(page, { url: "**/one-style.woff" })
      yield* page.goto(server.PREFIX + "/cached/one-style-font.html", { waitUntil: "load" })
      yield* waiting("the font's response", font)
    }))

  // @see https://crbug.com/1196004
  test(
    "request interception Page.setRequestInterception should emit a single request for a font Chrome restarts",
    ({ page, server }) =>
      Effect.gen(function*() {
        const requests: Array<NetworkRequest.NetworkRequest> = []
        yield* page.route("**/*", recordingPage(requests))
        yield* page.goto(server.PREFIX + "/font-face.html", { waitUntil: "load" })
        // Puppeteer's events for the font are one `request`, then `requestfinished`, and no `requestfailed`
        const fonts = (yield* requestsOf(page)).filter((request) => String(request.url).endsWith(".ttf"))
        assert.strictEqual(fonts.length, 1)
        const font = fonts[0]!
        assert.isTrue(Option.isSome(yield* waiting("the font's end", yield* NetworkRequest.response(page, font))))
        assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, font)))
      })
  )

  test("request interception Page.setRequestInterception should work with worker", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `workercreated` is subscribed before the navigation that creates the worker
      const created = yield* startWaiting(page.workers.waitFor((workers) => workers.length === 1))
      yield* page.goto(server.PREFIX + "/worker/worker.html", { waitUntil: "load" })
      yield* waiting("the page's worker", Fiber.join(created.fiber))
      yield* page.route("**/*", () => Route.continue)
    }))

  test(
    "request interception Page.setRequestInterception should intercept parallel fetches from a dedicated worker",
    ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.route(
          "**/*",
          ({ request }) => String(request.url).includes("abort") ? Route.abort() : Route.continue
        )
        const settled = yield* page.evaluateInMainWorld(() => {
          const source = `onmessage = async ({data: url}) => {
          const results = await Promise.allSettled(
            Array.from({length: 20}, (_, i) => {
              return fetch(url + (i % 2 ? '?abort=' : '?continue=') + i);
            }),
          );
          postMessage(results.length);
        };`
          const worker = new Worker(
            URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
          )
          return new Promise((resolve) => {
            worker.onmessage = (event) => {
              resolve(event.data)
            }
            worker.postMessage(location.href)
          })
        })
        assert.strictEqual(settled, 20)
      })
  )

  test("request interception Request.continue should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
    }))

  test("request interception Request.continue should amend HTTP headers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setHeader("FOO", "bar")))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz")
      })
      assert.strictEqual((yield* waiting("the request to /sleep.zzz", received)).headers["foo"], "bar")
    }))

  test("request interception Request.continue should redirect in a way non-observable to page", ({ page, server }) =>
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

  test("request interception Request.continue should amend method", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.setMethod("POST")))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz")
      })
      assert.strictEqual((yield* waiting("the request to /sleep.zzz", received)).method, "POST")
    }))

  test("request interception Request.continue should amend post data", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.route("**/*", () => Route.continueWith(HttpClientRequest.bodyText("🐶")))
      const received = yield* server.waitForRequest("/sleep.zzz")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/sleep.zzz", { method: "POST", body: "🐦" })
      })
      assert.strictEqual(
        yield* waiting("the request to /sleep.zzz", received).pipe(
          Effect.map((serverRequest) => serverRequest.body.toString("utf8"))
        ),
        "🐶"
      )
    }))

  test("request interception Request.continue should amend both post data and method on navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route(
        "**/*",
        () =>
          Route.continueWith((request) =>
            pipe(request, HttpClientRequest.setMethod("POST"), HttpClientRequest.bodyText("🐶"))
          )
      )
      // Puppeteer's `Promise.all` subscribes to the request before the navigation starts
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const serverRequest = yield* waiting("the request to /empty.html", received)
      assert.strictEqual(serverRequest.method, "POST")
      assert.strictEqual(serverRequest.body.toString("utf8"), "🐶")
    }))

  test("request interception Request.respond should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 201, headers: { foo: "bar" } })))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(response.status, 201)
      assert.strictEqual(response.headers["foo"], "bar")
      // The body is read from the page: a fulfilled body can't be read back through NetworkResponse on Chromium
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          document.body.textContent
        ),
        "Yo, page!"
      )
    }))

  test("request interception Request.respond should work with headers given as a Headers instance", ({ page, server }) =>
    Effect.gen(function*() {
      // Effect's header input takes a Headers instance, as Puppeteer's option does
      yield* page.route(
        "**/*",
        () => Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 201, headers: new Headers({ foo: "bar" }) }))
      )
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(response.status, 201)
      assert.strictEqual(response.headers["foo"], "bar")
    }))

  test("request interception Request.respond should work with status code 422", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.text("Yo, page!", { status: 422 })))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(response.status, 422)
      assert.strictEqual(response.statusText, "Unprocessable Entity")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.body.textContent), "Yo, page!")
    }))

  test("request interception Request.respond should redirect", ({ page, server }) =>
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

  test("request interception Request.respond should allow mocking multiple headers with same key", ({ page, server }) =>
    Effect.gen(function*() {
      // Effect's header input joins an array into one field, so two `Set-Cookie` fields are the response's cookies
      yield* page.route("**/*", () =>
        Route.fulfill(
          HttpServerResponse.text("Hello 🌐", { status: 200, headers: { foo: "bar", arr: ["1", "2"] } }).pipe(
            HttpServerResponse.setCookiesUnsafe([["first", "1"], ["second", "2"]])
          )
        ))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const cookies = yield* page.context.cookies.list
      const firstCookie = cookies.find((cookie) => cookie.name === "first")
      const secondCookie = cookies.find((cookie) => cookie.name === "second")
      const response = valueOf(responseOf(navigation), "response")
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.headers["foo"], "bar")
      assert.strictEqual(response.headers["arr"], "1, 2")
      assert.isDefined(firstCookie)
      assert.isDefined(secondCookie)
      assert.strictEqual(Redacted.value(firstCookie.value), "1")
      assert.strictEqual(Redacted.value(secondCookie.value), "2")
    }))

  test("request interception Request.respond should allow mocking binary responses", ({ page, server }) =>
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

  test("request interception Request.respond should report correct content-length header with string", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.text("Correct length 📏?", { status: 200 })))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(valueOf(responseOf(navigation), "response").headers["content-length"], "20")
    }))

  test("request interception Request.respond should report correct content-length header with buffer", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route(
        "**/*",
        () =>
          // `raw` carries no content type, as Puppeteer's `Buffer` body doesn't; `uint8Array` would add `application/octet-stream`
          Route.fulfill(HttpServerResponse.raw(new TextEncoder().encode("Correct length 📏?"), { status: 200 }))
      )
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(valueOf(responseOf(navigation), "response").headers["content-length"], "20")
    }))

  test(
    "request interception Request.respond should report correct encoding from page when content-type is set",
    ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.route("**/*", () =>
          Route.fulfill(HttpServerResponse.uint8Array(new TextEncoder().encode("Correct length 📏?"), {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })))
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() =>
            document.documentElement.innerText
          ),
          "Correct length 📏?"
        )
      })
  )

  test("request interception Request.resourceType should work for document type", ({ page, server }) =>
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

  test("request interception Request.resourceType should work for stylesheets", ({ page, server }) =>
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
