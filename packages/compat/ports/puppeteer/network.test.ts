/**
 * Puppeteer's `test/src/network.test.ts`, its first 39 tests in file order: the `request` events, `Request.frame`,
 * `Request.page`, `Request.worker`, the request headers and cookies, `Response.headers`, `Request.initiator`, the cache
 * and service-worker flags, `Request.fetchPostData` and `Request.content`, and `Response.text`, `json`, and `buffer`.
 * Three of them aren't ported (see the last bullet and the ledger).
 *
 * What the port changes:
 * - Puppeteer's listeners see each request and response from the moment they're added. The port reads the page's request
 *   and response histories, which hold what the page sent since it was created. A test that adds its listener after a
 *   navigation takes the history's length at that point as its mark (`requestsSince`). A history that dropped entries
 *   fails the port, since a missing entry would prove nothing.
 * - Chromium's own `/favicon.ico` request is left out, as Puppeteer's `isFavicon` leaves it out.
 * - `page.goto`, `page.reload`, and `page.waitForNavigation` wait for `load` in Puppeteer. Strider's `goto` resolves at
 *   commit, so each one the original relies on the default for passes `waitUntil: "load"`.
 * - Puppeteer's `response.request()` has no counterpart: a Strider response doesn't name its request. The port subscribes
 *   to the request with `NetworkRequest.next` before the action, and reads the response from `goto`'s `Committed` outcome.
 * - `request.headers()` is the event's headers with what the network sent merged in (Puppeteer's
 *   `requestWillBeSentExtraInfo`), which is `NetworkRequest.headersSent`. The event's own `headers` leave out what the
 *   network adds (`Host`, `Cookie`, and the rest on Chromium and WebKit), so the header and cookie tests read the sent headers.
 * - A Strider request has no `page()`. The `request.page()` tests check ownership by Strider's own rule (`assertOwnedBy`):
 *   the page that reported the request can read it, and another page is refused it as a foreign request.
 * - `request.worker()` is `null` for a navigation. Strider's `Initiator` is more specific, so the port asserts the
 *   navigation's initiator is its `Document`, not a worker's realm.
 * - `response.fromCache()` is `servedBy`, and `fromServiceWorker()` is `servedBy === "serviceWorker"`. The port asserts
 *   Strider's `ServedBy` value, which is more specific than the boolean: `fromCache() === false` becomes `"network"`.
 *   Firefox reports a cache hit as `cacheOrServiceWorker`, so the cached-stylesheet and cached-script expansions fail
 *   there, which is what Strider reports.
 * - `request.hasPostData()` is `Option.isSome(request.body)`. `fetchPostData()` and `content()` are body decoders (`text`,
 *   `arrayBuffer`) declared before the request. The intercepted-form test keeps its route, which continues each request,
 *   and reads the body through the subscription, which captures it as the request goes out.
 * - `response.text()`, `json()`, and `buffer()` are response body decoders declared before the request. Stock WebKit
 *   refuses exact-byte reads (`arrayBuffer`), so the two `buffer` tests and the binary `content` test are ledgered for it.
 * - "Request.headers should report all headers sent to the server on requestfailed" listens for `requestfailed`, which
 *   Strider doesn't have. The port waits for the request to end (`NetworkRequest.response` gives none for a request that
 *   failed), reads its failure (`NetworkRequest.failure`), and checks its headers.
 * - The parser and script initiators, cooperative interception, and streamed body tests aren't ported: each needs a
 *   Strider feature that's absent, and the ledger names it. "Response.text should wait until response completes" is
 *   ported without its `requestfinished` assertion, which Strider has no event for; the full text it reads is the proof.
 * - "Response.fromServiceWorker" loads with `load` where the original uses `networkidle2`, which Strider has no
 *   counterpart for; the original's next step, awaiting the page's `activationPromise`, is what readies the worker.
 * - Puppeteer's `page.evaluate` runs in the page's main world, so each script is `evaluateInMainWorld`.
 * - The fixture server's `waitForRequest` is listened for before the action that sends the request. Each wait is bounded
 *   by `waiting`, so a failure names what it waited for.
 * - "Response.fromCache should work for ${type}" runs once per variant, named by its `type`.
 *
 * The rest of the file, from "Response.statusText" on, is ported after them, with these changes:
 * - Puppeteer's `page.on('response')` and `requestservedfromcache` listeners read the response and request histories.
 *   The `requestservedfromcache` tests read `servedBy` on each response after the reload, which is where Strider says a
 *   resource came from the cache.
 * - Puppeteer's `requestfinished` and `requestfailed` events have no Strider counterpart. A finished request is read
 *   once its response is known, and a failed one is read from `NetworkRequest.failure` after the load. The event-order
 *   test checks the order of requests and responses, which Strider's histories carry as observation times.
 * - `response.encodedDataLength()` is `NetworkRequest.sizes`' transfer size, and `response.timing()` is
 *   `NetworkRequest.timing`'s response-header time. Both are collected only by a context that opts in
 *   (`requestSizes`, `requestTiming`), so those tests make their own page. Bodies are read as text where the original
 *   reads a buffer, since the bodies are ASCII and stock WebKit decodes only text.
 * - A cache-served response's size can be unavailable in Strider, so the cached-size test accepts a known zero or no
 *   value, and never a positive count.
 * - `page.setExtraHTTPHeaders` is `page.emulate({ extraHTTPHeaders })`, and `page.authenticate` is an auth-phase route
 *   (`Route.provideCredentials`). Ending the credentials is ending that route's scope. Stock WebKit refuses auth-phase
 *   routes, so the authentication tests are ledgered for it.
 * - "Cross-origin set-cookie" uses `acceptInsecureCerts`, which Chromium refuses per context, so it runs on Firefox and
 *   WebKit only, and is ledgered for Chromium.
 * - `page.setBypassServiceWorker`, `Response.stream`, and `Response.remoteAddress` aren't ported: each needs a Strider
 *   feature that's absent, and the ledger names it.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse, type Page, PageNavigation, Route } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import type * as http from "node:http"
import * as zlib from "node:zlib"
import { assetPath, attachFrame, failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

type Committed = Extract<PageNavigation.PageNavigation, { readonly _tag: "Committed" }>

/** The navigation a `goto` committed, which the original's `goto` resolves to. */
const committedOf = (navigation: PageNavigation.PageNavigation): Committed => {
  assert(navigation._tag === "Committed", `the navigation is ${navigation._tag}, not Committed`)
  return navigation
}

/** The response of a committed navigation: a document's, which `about:blank` and `data:` URLs don't have. */
const responseOf = (navigation: Committed): NetworkResponse.NetworkResponse => {
  assert(Option.isSome(navigation.response), "the navigation carried no response")
  return navigation.response.value
}

/** Puppeteer's `isFavicon`: the browser's own request for the site's icon, which the original's listeners skip. */
const isFavicon = (url: string) => new URL(url).pathname === "/favicon.ico"

/**
 * Bounds a wait of the port's own, so a failure says what it waited for rather than riding the test's budget. The waits
 * here are on the fixture server or on a request or response the port subscribed to before its action.
 */
const waiting = <A, E, R>(what: string, wait: Effect.Effect<A, E, R>, duration: Duration.Input = "10 seconds") =>
  wait.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.die(new Error(`timed out waiting for ${what}`)) }))

/** Every request the page has made since it was created, which the original's `page.on("request")` collects. */
const requestsOf = Effect.fnUntraced(function*(page: Page.ObservedPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => !isFavicon(request.url))
})

/** The requests a page has made since it had `mark` of them: those an action since then sent. */
const requestsSince = Effect.fnUntraced(function*(page: Page.ObservedPage, mark: number) {
  return (yield* requestsOf(page)).slice(mark)
})

/** Every response the page has received since it was created, which the original's `page.on("response")` collects. */
const responsesOf = Effect.fnUntraced(function*(page: Page.ObservedPage) {
  const history = yield* NetworkResponse.history(page)
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((response) => !isFavicon(response.url))
})

/**
 * Puppeteer's `responses.set(url.split('/').pop(), response)`: each response by its last path segment, the last one kept
 * when a URL repeats, so a reload's `304` replaces the first load's `200`.
 */
const responsesByName = (responses: ReadonlyArray<NetworkResponse.NetworkResponse>) => {
  const byName = new Map<string, NetworkResponse.NetworkResponse>()
  for (const response of responses) byName.set(new URL(response.url).pathname.split("/").pop() ?? "", response)
  return byName
}

/** Headers as a plain object, as Puppeteer's `headers()` gives them; Strider's are Effect `Headers`. */
const plain = (headers: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(headers))

/** The navigable a request was sent from, when a document sent it: Puppeteer's `request.frame()`. */
const frameOf = (request: NetworkRequest.NetworkRequest): string | undefined =>
  request.initiator._tag === "Document" ? request.initiator.navigable : undefined

/** A navigation request, which is a document's request for its own navigation. */
const isNavigation = (request: NetworkRequest.NetworkRequest): boolean =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/** The ids of every frame in a frame tree, the page's own first and depth first: Puppeteer's `page.frames()` order. */
const allFrameIds = (tree: Page.FrameTree): ReadonlyArray<string> => [
  tree.id,
  ...tree.children.flatMap((child) => allFrameIds(child))
]

/**
 * Puppeteer's `request.page()`. A Strider request has no page to return, so the port checks Strider's rule for it: the
 * page that reported the request reads it, and another page is refused it as a foreign request (`RequestUnavailable`,
 * `foreignTarget`).
 */
const assertOwnedBy = Effect.fnUntraced(function*(
  page: Page.ObservedPage,
  request: NetworkRequest.NetworkRequest,
  other: Page.ObservedPage
) {
  yield* NetworkRequest.failure(page, request)
  const refused = yield* failureOf(NetworkRequest.failure(other, request), "a read of the request from another page")
  assert(refused.reason._tag === "RequestUnavailable", `expected RequestUnavailable, got ${refused.reason._tag}`)
  assert.strictEqual(refused.reason.why, "foreignTarget")
})

/** A form or script's POST to `url`, with its body decoded as text. The subscription comes before the action. */
const postedText = (page: Page.Page, url: string) =>
  NetworkRequest.next(page, { url, method: "POST", body: (message) => message.text })

/** The two cached resources `Response.fromCache` loads, each with the page that references it. */
const cacheCases = [
  { html: "one-style.html", resource: "one-style.css", type: "stylesheet" },
  { html: "one-script.html", resource: "one-script.js", type: "script" }
] as const

/** The name a URL ends in, which the original's `url().split('/').pop()` keys its maps by. */
const nameOf = (url: string) => new URL(url).pathname.split("/").pop() ?? ""

/** Each request by its last path segment, the last one kept when a URL repeats: Puppeteer's `requests.set(...)`. */
const requestsByName = (requests: ReadonlyArray<NetworkRequest.NetworkRequest>) => {
  const byName = new Map<string, NetworkRequest.NetworkRequest>()
  for (const request of requests) byName.set(nameOf(request.url), request)
  return byName
}

/** Puppeteer's `page.authenticate`: an auth-phase route that answers every challenge with these credentials. */
const authenticate = (page: Page.Page, username: string, password: string) =>
  page.route("**", () => Route.provideCredentials({ username, password: Redacted.make(password) }), { phase: "auth" })

/**
 * What the original's `request` and `response` listeners logged: each request and each response, in the order Strider
 * observed them. Strider's two histories are separate, so the order comes from their observation times.
 */
const timelineOf = Effect.fnUntraced(function*(page: Page.ObservedPage) {
  const requests = (yield* requestsOf(page)).map((request) => ({
    at: request.at,
    kind: "request" as const,
    line: `${request.method} ${request.url}`
  }))
  const responses = (yield* responsesOf(page)).map((response) => ({
    at: response.at,
    kind: "response" as const,
    line: `${response.status} ${response.url}`
  }))
  return [...requests, ...responses].sort((a, b) => a.at - b.at)
})

/** The requests the page made that ended in a failure, with each failure: what the original's `requestfailed` collected. */
const failedOf = Effect.fnUntraced(function*(page: Page.ObservedPage) {
  const failed: Array<{ readonly request: NetworkRequest.NetworkRequest; readonly failure: NetworkRequest.Failure }> =
    []
  for (const request of yield* requestsOf(page)) {
    // `NetworkRequest.failure` doesn't wait. A request whose failure the browser reports after the page's own script has
    // settled has to have ended first, which the response read waits for (and gives none for a failed request)
    yield* waiting(`the end of ${request.url}`, yield* NetworkRequest.response(page, request))
    const failure = yield* NetworkRequest.failure(page, request)
    if (Option.isSome(failure)) failed.push({ request, failure: failure.value })
  }
  return failed
})

upstream(import.meta.filename, {}, (test) => {
  test("network Page.Events.Request should fire for navigation requests", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual((yield* requestsOf(page)).length, 1)
    }))

  test("network Page.Events.Request should fire for iframes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual((yield* requestsOf(page)).length, 2)
    }))

  test("network Page.Events.Request should fire for fetches", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/empty.html")
      })
      assert.strictEqual((yield* requestsOf(page)).length, 2)
    }))

  test("network Request.frame should work for main frame navigation request", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(frameOf(requests[0]!), (yield* page.frames).id)
    }))

  test("network Request.frame should work for subframe navigation request", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const mark = (yield* requestsOf(page)).length
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const requests = yield* requestsSince(page, mark)
      assert.strictEqual(requests.length, 1)
      // Puppeteer's `page.frames()[1]`: the main frame's first child, in the tree's order
      assert.strictEqual(frameOf(requests[0]!), allFrameIds(yield* page.frames)[1])
    }))

  test("network Request.frame should work for fetch requests", ({ page, server }) =>
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

  test("network Request.page should work for main frame navigation request", ({ page, server }) =>
    Effect.gen(function*() {
      const other = yield* Browser.newPage()
      // Puppeteer's `page.waitForRequest`: subscribed before the navigation
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* assertOwnedBy(page, yield* waiting("the request for the empty page", requested), other)
    }))

  test("network Request.page should work for subframe navigation request", ({ page, server }) =>
    Effect.gen(function*() {
      const other = yield* Browser.newPage()
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const request = yield* waiting("the request for the frame", requested)
      // Puppeteer's `request.frame()` is the attached frame, the page's second frame in tree order
      assert.strictEqual(frameOf(request), allFrameIds(yield* page.frames)[1])
      yield* assertOwnedBy(page, request, other)
    }))

  test("network Request.page should work for fetch requests", ({ page, server }) =>
    Effect.gen(function*() {
      const other = yield* Browser.newPage()
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/digits/1.png" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/digits/1.png")
      })
      yield* assertOwnedBy(page, yield* waiting("the request for the image", requested), other)
    }))

  test("network Request.worker should return null for page navigation requests", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request for the empty page", requested)
      // `worker()` is null: a navigation's initiator is its document, not a worker's realm
      assert.strictEqual(request.initiator._tag, "Document")
      assert.isTrue(isNavigation(request))
    }))

  test("network Request.headers should define Browser in user agent header", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request for the empty page", requested)
      const userAgent = request.headers["user-agent"] ?? ""
      if (browserName === "chromium") assert.include(userAgent, "Chrome")
      else if (browserName === "firefox") assert.include(userAgent, "Firefox")
      else assert.include(userAgent, "WebKit")
    }))

  test("network Request.headers should report all headers sent to the server on response.request()", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `setRequestInterception(true)` with every request continued
      yield* page.route("**", () => Route.continue)
      const serverWait = yield* server.waitForRequest("/empty.html")
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request for the empty page", requested)
      const sent = yield* NetworkRequest.headersSent(page, request)
      const serverRequest = yield* waiting("the request the server received", serverWait)
      assert.deepStrictEqual(plain(sent), { ...serverRequest.headers })
    }))

  test("network Request.headers should report all headers sent to the server on requestfailed", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/fail.html", (req) => {
        req.socket.destroy()
      })
      yield* page.route("**", () => Route.continue)
      const serverWait = yield* server.waitForRequest("/fail.html")
      const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/fail.html" })
      // The original's `.catch(() => {})`: the navigation fails, and the test doesn't look at why
      yield* page.goto(server.PREFIX + "/fail.html", { waitUntil: "load" }).pipe(Effect.ignore)
      const request = yield* waiting("the failed request", requested)
      // Strider has no `requestfailed` event. The request has ended without a response, so its failure is reported by now
      const responded = yield* NetworkRequest.response(page, request)
      assert.isTrue(Option.isNone(yield* responded))
      assert.isTrue(Option.isSome(yield* NetworkRequest.failure(page, request)))
      const sent = yield* NetworkRequest.headersSent(page, request)
      const serverRequest = yield* waiting("the request the server received", serverWait)
      assert.deepStrictEqual(plain(sent), { ...serverRequest.headers })
    }))

  test("network Request.headers cookie header should show Cookie header", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
      })
      const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/title.html" })
      yield* page.goto(server.PREFIX + "/title.html", { waitUntil: "load" })
      const request = yield* waiting("the request for title.html", requested)
      // The network adds `Cookie`, which `headers` leaves out on Chromium and WebKit: the headers as sent carry it
      const headers = yield* NetworkRequest.headersSent(page, request)
      assert.include(headers["cookie"] ?? "", "username=John Doe")
    }))

  test("network Request.headers cookie header should show Cookie header for redirect", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRedirect("/foo.html", "/title.html")
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
      })
      const mark = (yield* requestsOf(page)).length
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      const hops = yield* requestsSince(page, mark)
      assert.strictEqual(hops.length, 2)
      const first = hops[0]!
      const last = hops[1]!
      // Puppeteer's `redirectChain()[0]`: the hop the final request was redirected from
      const redirects = yield* NetworkRequest.redirects(page)
      const predecessor = Option.getOrThrow(yield* redirects.from(last))
      assert.strictEqual(predecessor.url, first.url)
      const cookie1 = (yield* NetworkRequest.headersSent(page, predecessor))["cookie"] ?? ""
      assert.include(cookie1, "username=John Doe")
      const cookie2 = (yield* NetworkRequest.headersSent(page, last))["cookie"] ?? ""
      assert.include(cookie2, "username=John Doe")
    }))

  test("network Request.headers cookie header should show Cookie header for fetch request", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
      })
      const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/title.html" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/title.html")
      })
      const request = yield* waiting("the fetch of title.html", requested)
      const headers = yield* NetworkRequest.headersSent(page, request)
      assert.include(headers["cookie"] ?? "", "username=John Doe")
    }))

  test("network Response.headers should work", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("foo", "bar")
        res.end()
      })
      const response = responseOf(committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })))
      assert.strictEqual(response.headers["foo"], "bar")
    }))

  test("network Response.fromCache should return |false| for non-cached content", ({ page, server }) =>
    Effect.gen(function*() {
      const response = responseOf(committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })))
      // `fromCache()` is `false`: the network answered, which is more specific than the boolean
      assert.strictEqual(response.servedBy, "network")
    }))

  for (const { html, resource, type } of cacheCases) {
    test(
      "network Response.fromCache should work for ${type}",
      { variant: type },
      ({ page, server }) =>
        Effect.gen(function*() {
          // Load and re-load to make sure it's cached. Firefox reports a cache hit as `cacheOrServiceWorker`, so its
          // `cache` assertion fails here, as Strider's typed value says it must.
          yield* page.goto(server.PREFIX + "/cached/" + html, { waitUntil: "load" })
          yield* page.reload({ waitUntil: "load" })
          const responses = responsesByName(yield* responsesOf(page))
          assert.strictEqual(responses.size, 2)
          const cached = responses.get(resource)!
          assert.strictEqual(cached.status, 200)
          assert.strictEqual(cached.servedBy, "cache")
          const revalidated = responses.get(html)!
          assert.strictEqual(revalidated.status, 304)
          assert.strictEqual(revalidated.servedBy, "network")
        })
    )
  }

  test("network Response.fromServiceWorker should return |false| for non-service-worker content", ({ page, server }) =>
    Effect.gen(function*() {
      const response = responseOf(committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })))
      assert.strictEqual(response.servedBy, "network")
    }))

  test("network Response.fromServiceWorker Response.fromServiceWorker", ({ page, server }) =>
    Effect.gen(function*() {
      // Load and re-load to make sure the service worker is installed and running. The original loads with
      // `networkidle2`, which Strider has no counterpart for; its wait for the worker to take control is the
      // `activationPromise` the page exposes, which the original awaits next and the port awaits as well.
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        // The original returns the `controllerchange` event, which Puppeteer serializes; Strider's result must be a value
        await (globalThis as unknown as { activationPromise: Promise<unknown> }).activationPromise
      })
      yield* page.reload({ waitUntil: "load" })
      const responses = responsesByName(yield* responsesOf(page))
      assert.strictEqual(responses.size, 2)
      assert.strictEqual(responses.get("sw.html")!.status, 200)
      assert.strictEqual(responses.get("sw.html")!.servedBy, "serviceWorker")
      assert.strictEqual(responses.get("style.css")!.status, 200)
      assert.strictEqual(responses.get("style.css")!.servedBy, "serviceWorker")
    }))

  test("network Request.fetchPostData should work for intercepted form submissions", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => {
        res.end()
      })
      // Puppeteer's `setRequestInterception(true)` with every request continued. The body is captured as the request is
      // sent, and the route continues it, so the subscription reads what the route let go.
      yield* page.route("**", () => Route.continue)
      const posted = yield* postedText(page, server.PREFIX + "/post")
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const form = document.createElement("form")
        form.method = "POST"
        form.action = "/post"
        const input = document.createElement("input")
        input.name = "foo"
        input.value = "bar"
        form.append(input)
        document.body.append(form)
        form.submit()
      })
      yield* waiting("the form's navigation", navigated)
      const request = yield* waiting("the form's POST", posted)
      assert.strictEqual(Option.getOrThrow(request.body), "foo=bar")
    }))

  test("network Request.fetchPostData should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => {
        res.end()
      })
      const posted = yield* postedText(page, server.PREFIX + "/post")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          body: JSON.stringify({ foo: "bar" })
        })
      })
      const request = yield* waiting("the POST", posted)
      assert.isTrue(Option.isSome(request.body))
      assert.strictEqual(Option.getOrThrow(request.body), "{\"foo\":\"bar\"}")
    }))

  test("network Request.fetchPostData should be |undefined| when there is no post data", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE, body: (message) => message.text })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request for the empty page", requested)
      // `hasPostData()` is false, and `fetchPostData()` is `undefined`: a request with no payload has `None`
      assert.isTrue(Option.isNone(request.body))
    }))

  test("network Request.fetchPostData should work with blobs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => {
        res.end()
      })
      const posted = yield* postedText(page, server.PREFIX + "/post")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          body: new Blob([JSON.stringify({ foo: "bar" })], { type: "application/json" })
        })
      })
      const request = yield* waiting("the POST", posted)
      assert.isTrue(Option.isSome(request.body))
      assert.strictEqual(Option.getOrThrow(request.body), "{\"foo\":\"bar\"}")
    }))

  test("network Request.fetchPostData should work with binary post data", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => {
        res.end()
      })
      const posted = yield* postedText(page, server.PREFIX + "/post")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          body: new Uint8Array([104, 101, 108, 108, 111, 0, 255])
        })
      })
      const request = yield* waiting("the POST", posted)
      assert.isTrue(Option.isSome(request.body))
      // Invalid UTF-8 is replaced with U+FFFD, as the text decoder does
      assert.strictEqual(Option.getOrThrow(request.body), "hello\x00�")
    }))

  test("network Request.content should work with binary post data", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/post", (_req, res) => {
        res.end()
      })
      const posted = yield* NetworkRequest.next(page, {
        url: server.PREFIX + "/post",
        method: "POST",
        body: (message) => message.arrayBuffer
      })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          body: new Uint8Array([0, 255, 128, 10, 200, 1])
        })
      })
      const request = yield* waiting("the POST", posted)
      assert.isTrue(Option.isSome(request.body))
      assert.deepStrictEqual(new Uint8Array(Option.getOrThrow(request.body)), new Uint8Array([0, 255, 128, 10, 200, 1]))
    }))

  test("network Request.content should be |undefined| when there is no post data", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page, {
        url: server.EMPTY_PAGE,
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request for the empty page", requested)
      assert.isTrue(Option.isNone(request.body))
    }))

  test("network Response.text should work", ({ page, server }) =>
    Effect.gen(function*() {
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/simple.json",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/simple.json", { waitUntil: "load" })
      const response = yield* waiting("the response for simple.json", responded)
      assert.strictEqual(response.body.trimEnd(), "{\"foo\": \"bar\"}")
    }))

  test("network Response.text should return uncompressed text", ({ page, server }) =>
    Effect.gen(function*() {
      server.enableGzip("/simple.json")
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/simple.json",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/simple.json", { waitUntil: "load" })
      const response = yield* waiting("the response for simple.json", responded)
      assert.strictEqual(response.headers["content-encoding"], "gzip")
      assert.strictEqual(response.body.trimEnd(), "{\"foo\": \"bar\"}")
    }))

  test("network Response.text should throw when requesting body of redirected response", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo.html", "/empty.html")
      // The redirect's own response, with a body decoder: a redirect has no body to read
      const redirected = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/foo.html",
        body: (message) => message.text
      })
      const mark = (yield* requestsOf(page)).length
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      const hops = yield* requestsSince(page, mark)
      assert.strictEqual(hops.length, 2)
      const first = hops[0]!
      // Puppeteer's `redirectChain()` has one request: the first hop has no predecessor, the final one has the first
      const redirects = yield* NetworkRequest.redirects(page)
      assert.isTrue(Option.isSome(yield* redirects.from(hops[1]!)))
      assert.isTrue(Option.isNone(yield* redirects.from(first)))
      const responded = yield* NetworkRequest.response(page, first)
      assert.strictEqual(Option.getOrThrow(yield* responded).status, 302)
      const error = yield* failureOf(waiting("the redirect's body", redirected), "reading the redirect's body")
      assert(NetworkResponse.isResponseError(error), `expected a ResponseError, got ${String(error)}`)
      assert(
        error.reason._tag === "BodyUnavailable" && error.reason.why === "redirect",
        `expected BodyUnavailable (redirect), got ${error.reason._tag}`
      )
      assert.include(error.message, "redirect")
    }))

  test("network Response.text should wait until response completes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Setup server to trap request.
      let serverResponse: http.ServerResponse | undefined
      server.setRoute("/get", (_req, res) => {
        serverResponse = res
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.write("hello ")
      })
      // The body decoder reads the text once the response has completed, so the response arrives only then. The original
      // also asserts that `requestfinished` hasn't fired while the body streams; Strider has no such event, so that
      // assertion isn't ported, and the full text below is what shows the read waited for the end.
      const serverWait = yield* server.waitForRequest("/get")
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/get",
        body: (message) => message.text
      })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./get", { method: "GET" })
      })
      yield* waiting("the request the server received", serverWait)
      assert.isDefined(serverResponse)
      // Write part of the response and wait for it to be flushed.
      yield* Effect.callback<void>((resume) => {
        serverResponse!.write("wor", () => resume(Effect.void))
      })
      // Finish response.
      yield* Effect.callback<void>((resume) => {
        serverResponse!.end("ld!", () => resume(Effect.void))
      })
      const response = yield* waiting("the response for /get", responded)
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.body, "hello world!")
    }))

  test("network Response.json should work", ({ page, server }) =>
    Effect.gen(function*() {
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/simple.json",
        body: (message) => message.json
      })
      yield* page.goto(server.PREFIX + "/simple.json", { waitUntil: "load" })
      const response = yield* waiting("the response for simple.json", responded)
      assert.deepStrictEqual(response.body, { foo: "bar" })
    }))

  test("network Response.buffer should work", ({ page, server }) =>
    Effect.gen(function*() {
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/pptr.png",
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.PREFIX + "/pptr.png", { waitUntil: "load" })
      const response = yield* waiting("the response for pptr.png", responded)
      const imageBuffer = fs.readFileSync(assetPath("puppeteer", "pptr.png"))
      assert.isTrue(Buffer.from(response.body).equals(imageBuffer))
    }))

  test("network Response.buffer should work with compression", ({ page, server }) =>
    Effect.gen(function*() {
      server.enableGzip("/pptr.png")
      const responded = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/pptr.png",
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.PREFIX + "/pptr.png", { waitUntil: "load" })
      const response = yield* waiting("the response for pptr.png", responded)
      const imageBuffer = fs.readFileSync(assetPath("puppeteer", "pptr.png"))
      assert.isTrue(Buffer.from(response.body).equals(imageBuffer))
    }))

  test("network Response.buffer should throw if the response does not have a body", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      server.setRoute("/test.html", (_req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Headers", "x-ping")
        res.end("Hello World")
      })
      const url = server.CROSS_PROCESS_PREFIX + "/test.html"
      // The preflight the page's cross-origin POST sends: an OPTIONS response, which has no body to read
      const preflight = yield* NetworkResponse.next(page, {
        url,
        method: "OPTIONS",
        body: (message) => message.arrayBuffer
      })
      yield* page.evaluateInMainWorld(async (src) => {
        await fetch(src, { method: "POST", headers: { "x-ping": "pong" } })
      }, url)
      // The original's message says the body is unavailable for a preflight. Strider's reason is `BodyUnavailable`, and
      // its message says why the body is unavailable, without the original's wording.
      const error = yield* failureOf(waiting("the preflight's response", preflight), "reading the preflight's body")
      assert(NetworkResponse.isResponseError(error), `expected a ResponseError, got ${String(error)}`)
      assert.strictEqual(error.reason._tag, "BodyUnavailable")
    }))

  test("network Response.statusText should work", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/cool", (_req, res) => {
        res.writeHead(200, "cool!")
        res.end()
      })
      const response = responseOf(committedOf(yield* page.goto(server.PREFIX + "/cool", { waitUntil: "load" })))
      assert.strictEqual(response.statusText, "cool!")
    }))

  test("network Response.statusText handles missing status text", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/nostatus", (_req, res) => {
        res.writeHead(200, "")
        res.end()
      })
      const response = responseOf(committedOf(yield* page.goto(server.PREFIX + "/nostatus", { waitUntil: "load" })))
      assert.strictEqual(response.statusText, "")
    }))

  test("network Response.timing returns timing information", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // Puppeteer's `receiveHeadersEnd` is read from the request's timing, which a context collects only when it opts in
      const page = yield* Browser.newPage({ requestTiming: true })
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual((yield* responsesOf(page)).length, 1)
      const request = yield* waiting("the request for the empty page", requested)
      const timing = yield* NetworkRequest.timing(page, request)
      // The response-header boundary: Strider's `responseStart`, the closest native phase to `receiveHeadersEnd`
      assert.isTrue(Option.isSome(timing.responseStart), "the browser reported no response-header time")
      assert.isTrue(Option.getOrThrow(timing.responseStart) > 0)
    }))

  test(
    "network Response.encodedDataLength should return the encoded transfer size",
    { page: false },
    ({ server }) =>
      Effect.gen(function*() {
        // Puppeteer's `encodedDataLength` is Strider's transfer size, which a context collects only when it opts in
        const page = yield* Browser.newPage({ requestSizes: true })
        const raw = Array.from({ length: 1000 }, (_, i) => `line-number-${i}-some-repeated-text`).join("\n")
        const compressed = zlib.gzipSync(raw)
        server.setRoute("/compressible", (_req, res) => {
          res.setHeader("Content-Type", "text/plain")
          res.setHeader("Content-Encoding", "gzip")
          res.end(compressed)
        })
        const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/compressible" })
        // The original reads the body as a buffer. The body here is ASCII, so its text has the buffer's length, and text
        // is what stock WebKit can decode
        const responded = yield* NetworkResponse.next(page, {
          url: server.PREFIX + "/compressible",
          body: (message) => message.text
        })
        yield* page.goto(server.PREFIX + "/compressible", { waitUntil: "load" })
        const response = yield* waiting("the response for compressible", responded)
        assert.strictEqual(response.body.length, raw.length)
        const request = yield* waiting("the request for compressible", requested)
        const sizes = yield* NetworkRequest.sizes(page, request)
        assert.isTrue(Option.isSome(sizes.responseTransferSize), "the browser reported no transfer size")
        const transfer = Option.getOrThrow(sizes.responseTransferSize)
        assert.isTrue(transfer >= compressed.length)
        assert.isTrue(transfer < raw.length)
      })
  )

  test(
    "network Response.encodedDataLength should return 0 for cached responses",
    { page: false },
    ({ server }) =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage({ requestSizes: true })
        server.setRoute("/cached-encoded-length", (_req, res) => {
          res.setHeader("Cache-Control", "public, max-age=3600")
          res.setHeader("Content-Type", "text/plain")
          res.end("cached-content-".repeat(100))
        })
        const url = server.PREFIX + "/cached-encoded-length"
        const firstRequested = yield* NetworkRequest.next(page, { url })
        const firstResponded = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
        yield* page.goto(url, { waitUntil: "load" })
        const first = yield* waiting("the first request", firstRequested)
        // `firstResponse.fromCache()` is false: the first load came from the network
        assert.strictEqual((yield* waiting("the first response", firstResponded)).servedBy, "network")
        const firstSizes = yield* NetworkRequest.sizes(page, first)
        assert.isTrue(Option.isSome(firstSizes.responseTransferSize), "the first load reported no transfer size")
        assert.isTrue(Option.getOrThrow(firstSizes.responseTransferSize) > 1500)
        const cachedRequested = yield* NetworkRequest.next(page, { url })
        const cachedResponded = yield* NetworkResponse.next(page, { url })
        yield* page.goto(url, { waitUntil: "load" })
        const cached = yield* waiting("the cached request", cachedRequested)
        // `cachedResponse.fromCache()` is true
        assert.strictEqual((yield* waiting("the cached response", cachedResponded)).servedBy, "cache")
        const cachedSizes = yield* NetworkRequest.sizes(page, cached)
        // A cached response's sizes can be unavailable, and Strider never replaces a missing count with zero. The
        // original's `0` is a known zero, which is the only value a served-from-cache size may take here.
        assert.isTrue(
          Option.isNone(cachedSizes.responseTransferSize) || Option.getOrThrow(cachedSizes.responseTransferSize) === 0
        )
      })
  )

  test(
    "network Response.encodedDataLength should not return a negative value for data: URLs",
    { page: false },
    () =>
      Effect.gen(function*() {
        // Puppeteer's point: Chromium reports -1 for a data: URL when the response arrives, and a response's size must not
        // expose that unknown value. Strider's transfer size is collected only by a context that opts in.
        const page = yield* Browser.newPage({ requestSizes: true })
        yield* page.goto("data:text/plain,hello", { waitUntil: "load" })
        // The original checks the size of the data: URL's response when one is reported, and nothing when none is
        const dataRequests = (yield* requestsOf(page)).filter((request) => request.url === "data:text/plain,hello")
        for (const request of dataRequests) {
          const response = yield* NetworkRequest.response(page, request)
          if (Option.isNone(yield* response)) continue
          const sizes = yield* NetworkRequest.sizes(page, request)
          // An unknown size is `None`; a known one is never negative
          if (Option.isSome(sizes.responseTransferSize)) assert.isTrue(sizes.responseTransferSize.value >= 0)
        }
      })
  )

  test("network Network Events Page.Events.Request", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      const request = requests[0]!
      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.strictEqual(request.method, "GET")
      // `request.response()` is truthy: the response has arrived
      assert.isTrue(Option.isSome(yield* (yield* NetworkRequest.response(page, request))))
      // `request.frame() === page.mainFrame()`, and that frame's URL is the empty page
      const main = yield* page.frames
      assert.strictEqual(frameOf(request), main.id)
      assert.strictEqual(main.url, server.EMPTY_PAGE)
    }))

  // Run this cache test both with a stylesheet and a script.
  for (const { html, resource, type } of cacheCases) {
    test(
      "network Network Events Page.Events.RequestServedFromCache for ${type}",
      { variant: type },
      ({ page, server }) =>
        Effect.gen(function*() {
          yield* page.goto(server.PREFIX + "/cached/" + html, { waitUntil: "load" })
          const servedFromCache = (responses: ReadonlyArray<NetworkResponse.NetworkResponse>) =>
            responses.filter((response) => response.servedBy === "cache").map((response) => nameOf(response.url))
          assert.deepStrictEqual(servedFromCache(yield* responsesOf(page)), [])
          // The original waits a second so the cache has the resource before the reload
          yield* Effect.sleep("1 second")
          yield* page.reload({ waitUntil: "load" })
          assert.deepStrictEqual(servedFromCache(yield* responsesOf(page)), [resource])
        })
    )
  }

  test("network Network Events Page.Events.Response", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const responses = yield* responsesOf(page)
      assert.strictEqual(responses.length, 1)
      const response = responses[0]!
      assert.strictEqual(response.url, server.EMPTY_PAGE)
      assert.strictEqual(response.status, 200)
      // `response.ok()`: a status from 200 to 299
      assert.isTrue(response.status >= 200 && response.status <= 299)
      // `response.request()` is truthy: the response belongs to a request the page made
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.find((request) => request.hop === response.hop)?.url, server.EMPTY_PAGE)
    }))

  test("network Network Events Page.Events.RequestFailed", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // Puppeteer's `setRequestInterception(true)`: the stylesheet is aborted, and every other request continues
      yield* page.route("**", (intercepted) => intercepted.request.url.endsWith("css") ? Route.abort() : Route.continue)
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      // Strider has no `requestfailed` event: the load has ended the stylesheet's request, so its failure is read now
      const failed = yield* failedOf(page)
      assert.strictEqual(failed.length, 1)
      const { request, failure } = failed[0]!
      assert.include(request.url, "one-style.css")
      const responded = yield* NetworkRequest.response(page, request)
      assert.isTrue(Option.isNone(yield* responded))
      assert.isTrue(frameOf(request) !== undefined)
      // The original's error text is the browser's, `net::ERR_FAILED` on Chromium and `NS_ERROR_ABORT` on Firefox; the
      // port checks those two, and stock WebKit's text is whatever it reports
      if (browserName !== "webkit") {
        assert.strictEqual(failure.errorText, browserName === "chromium" ? "net::ERR_FAILED" : "NS_ERROR_ABORT")
      } else {
        assert.isTrue(failure.errorText.length > 0)
      }
    }))

  test("network Network Events Page.Events.RequestFailed for blocked requests", ({ page, server }) =>
    Effect.gen(function*() {
      // The page's Content-Security-Policy blocks the script the original adds with `addScriptTag`
      server.setExtraHeaders("/empty.html", { "content-security-policy": "default-src 'none'" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original's `addScriptTag({ url }).catch(() => {})`: the page adds the script element and the load or the
      // error settles it. Strider has no `addScriptTag`, and this step is only what starts the blocked request.
      yield* page.evaluateInMainWorld(
        (src) =>
          new Promise<void>((resolve) => {
            const script = document.createElement("script")
            script.src = src
            script.onload = () => resolve()
            script.onerror = () => resolve()
            document.head.append(script)
          }),
        server.PREFIX + "/one-script.js"
      )
      const failed = yield* failedOf(page)
      assert.strictEqual(failed.length, 1)
      // Puppeteer names the block `csp`. Strider reports the browser's own error text, so this checks only that there is
      // one: Chromium reports the block as an empty text (its `blockedReason` isn't carried), which this fails on
      assert.isTrue(failed[0]!.failure.errorText.length > 0)
    }))

  test("network Network Events Page.Events.RequestFinished", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Strider has no `requestfinished` event. A request that has finished has its response, so the port reads it once
      // the load has ended, and checks the same fields the original does.
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      const request = requests[0]!
      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.isTrue(Option.isSome(yield* (yield* NetworkRequest.response(page, request))))
      const main = yield* page.frames
      assert.strictEqual(frameOf(request), main.id)
      assert.strictEqual(main.url, server.EMPTY_PAGE)
    }))

  test("network Network Events should fire events in proper order", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original's third event, `requestfinished`, isn't observable in Strider (see the test above), so the order
      // checked is the request's, then the response's.
      const timeline = yield* timelineOf(page)
      assert.deepStrictEqual(timeline.slice(0, 2).map((entry) => entry.kind), ["request", "response"])
    }))

  test("network Network Events should support redirects", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo.html", "/empty.html")
      const FOO_URL = server.PREFIX + "/foo.html"
      yield* page.goto(FOO_URL, { waitUntil: "load" })
      // The original's `DONE` lines are `requestfinished`, which Strider has no event for; the requests and responses
      // are in the order they were observed
      assert.deepStrictEqual((yield* timelineOf(page)).map((entry) => entry.line), [
        `GET ${FOO_URL}`,
        `302 ${FOO_URL}`,
        `GET ${server.EMPTY_PAGE}`,
        `200 ${server.EMPTY_PAGE}`
      ])
      // Check redirect chain: the final request was redirected from `/foo.html`, and that hop has no predecessor
      const last = (yield* requestsOf(page)).at(-1)!
      const redirects = yield* NetworkRequest.redirects(page)
      const predecessor = Option.getOrThrow(yield* redirects.from(last))
      assert.include(predecessor.url, "/foo.html")
      assert.isTrue(Option.isNone(yield* redirects.from(predecessor)))
    }))

  test(
    "network Network Events should treat a redirect status without a Location header as a final response",
    ({ page, server }) =>
      Effect.gen(function*() {
        server.setRoute("/no-location.html", (_req, res) => {
          res.statusCode = 302
          res.end("final response")
        })
        const url = server.PREFIX + "/no-location.html"
        const navigation = yield* page.goto(url, { waitUntil: "load" })
        // As with the redirect test, `requestfinished` isn't observable, so the port checks the request and response order
        assert.deepStrictEqual((yield* timelineOf(page)).map((entry) => entry.line), [`GET ${url}`, `302 ${url}`])
        assert.strictEqual(responseOf(committedOf(navigation)).status, 302)
        const [request] = yield* requestsOf(page)
        assert.strictEqual(request!.url, url)
        // `redirectChain()` is empty: a 302 without a Location is the final response, with no hop before it
        assert.isTrue(Option.isNone(yield* (yield* NetworkRequest.redirects(page)).from(request!)))
      })
  )

  test("network Request.isNavigationRequest should work", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/rrredirect", "/frames/one-frame.html")
      yield* page.goto(server.PREFIX + "/rrredirect", { waitUntil: "load" })
      const requests = requestsByName(yield* requestsOf(page))
      assert.isTrue(isNavigation(requests.get("rrredirect")!))
      assert.isTrue(isNavigation(requests.get("one-frame.html")!))
      assert.isTrue(isNavigation(requests.get("frame.html")!))
      assert.isFalse(isNavigation(requests.get("script.js")!))
      assert.isFalse(isNavigation(requests.get("style.css")!))
    }))

  test("network Request.isNavigationRequest should work with request interception", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `setRequestInterception(true)` with every request continued
      yield* page.route("**", () => Route.continue)
      server.setRedirect("/rrredirect", "/frames/one-frame.html")
      yield* page.goto(server.PREFIX + "/rrredirect", { waitUntil: "load" })
      const requests = requestsByName(yield* requestsOf(page))
      assert.isTrue(isNavigation(requests.get("rrredirect")!))
      assert.isTrue(isNavigation(requests.get("one-frame.html")!))
      assert.isTrue(isNavigation(requests.get("frame.html")!))
      assert.isFalse(isNavigation(requests.get("script.js")!))
      assert.isFalse(isNavigation(requests.get("style.css")!))
    }))

  test("network Request.isNavigationRequest should work when navigating to image", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's first `request` event is the image's own navigation
      const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/pptr.png" })
      yield* page.goto(server.PREFIX + "/pptr.png", { waitUntil: "load" })
      assert.isTrue(isNavigation(yield* waiting("the request for the image", requested)))
    }))

  test("network Page.setExtraHTTPHeaders should work", ({ page, server }) =>
    Effect.gen(function*() {
      // Strider's page emulation sends these headers with every request the page makes
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const serverWait = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request the server received", serverWait)
      assert.strictEqual(request.headers["foo"], "bar")
    }))

  test("network Page.setExtraHTTPHeaders should throw for non-string header values", ({ page }) =>
    Effect.gen(function*() {
      // The original's `@ts-expect-error` input: Strider types the headers as strings, so this is refused at run time
      // only because the input is cast past the type
      const error = yield* failureOf(
        page.emulate({ extraHTTPHeaders: { foo: 1 as unknown as string } }),
        "setting a non-string header"
      )
      // Strider's reason is the declaration's `InvalidInput` on `extraHTTPHeaders`, not the original's message
      assert(error._tag === "DeclarationError", `expected a DeclarationError, got ${error._tag}`)
      assert(error.reason._tag === "InvalidInput", `expected InvalidInput, got ${error.reason._tag}`)
      assert.strictEqual(error.reason.input, "extraHTTPHeaders")
    }))

  test("network Page.authenticate should work", ({ page, server }) =>
    Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      yield* authenticate(page, "user", "pass")
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(navigation)).status, 200)
    }))

  test("network Page.authenticate should work with interception", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `setRequestInterception(true)` with every request continued
      yield* page.route("**", () => Route.continue)
      server.setAuth("/empty.html", "user", "pass")
      yield* authenticate(page, "user", "pass")
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(navigation)).status, 200)
    }))

  test("network Page.authenticate should error if authentication is required but not enabled", ({ page, server }) =>
    Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      // Headless, the challenge's `401` is the response; the original's error branch is for headful runs
      const first = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(first)).status, 401)
      yield* authenticate(page, "user", "pass")
      const reloaded = yield* page.reload({ waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(reloaded)).status, 200)
    }))

  test("network Page.authenticate should fail if wrong credentials", ({ page, server }) =>
    Effect.gen(function*() {
      // Use unique user/password since Chrome caches credentials per origin.
      server.setAuth("/empty.html", "user2", "pass2")
      yield* authenticate(page, "foo", "bar")
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(navigation)).status, 401)
    }))

  test("network Page.authenticate should allow disable authentication", ({ page, server }) =>
    Effect.gen(function*() {
      // Use unique user/password since Chrome caches credentials per origin.
      server.setAuth("/empty.html", "user3", "pass3")
      // Puppeteer's `authenticate(null)` ends the credentials: here the route's scope closes, which removes it
      const scope = yield* Scope.make()
      yield* authenticate(page, "user3", "pass3").pipe(Scope.provide(scope))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(navigation)).status, 200)
      yield* Scope.close(scope, Exit.void)
      // Navigate to a different origin to bust Chrome's credential caching.
      const cross = yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(responseOf(committedOf(cross)).status, 401)
    }))

  // Run this cache test both with a stylesheet and a script.
  for (const { html, resource, type } of cacheCases) {
    test(
      "network Page.authenticate should not disable caching for ${type}",
      { variant: type },
      ({ page, server }) =>
        Effect.gen(function*() {
          // Use unique user/password since Chrome caches credentials per origin.
          const user = `user4-${type};`
          const pass = `pass4-${type};`
          server.setAuth("/cached/" + resource, user, pass)
          server.setAuth("/cached/" + html, user, pass)
          yield* authenticate(page, user, pass)
          // Load and re-load to make sure it's cached.
          yield* page.goto(server.PREFIX + "/cached/" + html, { waitUntil: "load" })
          yield* page.reload({ waitUntil: "load" })
          const responses = responsesByName(yield* responsesOf(page))
          const cached = responses.get(resource)!
          assert.strictEqual(cached.status, 200)
          assert.strictEqual(cached.servedBy, "cache")
          const revalidated = responses.get(html)!
          assert.strictEqual(revalidated.status, 304)
          assert.strictEqual(revalidated.servedBy, "network")
        })
    )
  }

  test("network raw network headers Same-origin set-cookie navigation", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("set-cookie", "foo=bar")
        res.end("hello world")
      })
      const response = responseOf(committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })))
      assert.strictEqual(response.headers["set-cookie"], "foo=bar")
    }))

  test("network raw network headers Same-origin set-cookie subresource", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/foo", (_req, res) => {
        res.setHeader("set-cookie", "foo=bar")
        res.end("hello world")
      })
      // The original takes the first response after the XHR, which is the response to `/foo`
      const responded = yield* NetworkResponse.next(page, { url: server.PREFIX + "/foo" })
      yield* page.evaluateInMainWorld(() => {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", "/foo")
        xhr.send()
      })
      const response = yield* waiting("the XHR's response", responded)
      assert.strictEqual(response.headers["set-cookie"], "foo=bar")
    }))

  test(
    "network raw network headers Cross-origin set-cookie",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.gen(function*() {
        // Chromium refuses `acceptInsecureCerts` (the ledger), so this runs where the context accepts the TLS server's
        // self-signed certificate.
        const page = yield* Browser.newPage({ acceptInsecureCerts: true })
        yield* page.goto(server.https.PREFIX + "/empty.html", { waitUntil: "load" })
        server.setRoute("/setcookie.html", (_req, res) => {
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("set-cookie", "hello=world")
          res.end()
        })
        yield* page.goto(server.https.PREFIX + "/setcookie.html", { waitUntil: "load" })
        const url = server.https.CROSS_PROCESS_PREFIX + "/setcookie.html"
        const responded = yield* NetworkResponse.next(page, { url })
        yield* page.evaluateInMainWorld((src) => {
          const xhr = new XMLHttpRequest()
          xhr.open("GET", src)
          xhr.send()
        }, url)
        const response = yield* waiting("the cross-origin XHR's response", responded)
        assert.strictEqual(response.headers["set-cookie"], "hello=world")
      })
  )

  test("network Request.resourceType should work for document type", ({ page, server }) =>
    Effect.gen(function*() {
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* waiting("the request for the empty page", requested)
      assert.strictEqual(request.resourceType, "document")
    }))

  test("network Request.resourceType should work for stylesheets", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const cssRequests = (yield* requestsOf(page)).filter((request) => request.url.endsWith("css"))
      assert.strictEqual(cssRequests.length, 1)
      const request = cssRequests[0]!
      assert.include(request.url, "one-style.css")
      assert.strictEqual(request.resourceType, "stylesheet")
    }))
})
