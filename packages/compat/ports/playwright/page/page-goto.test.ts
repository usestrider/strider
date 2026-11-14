/**
 * Playwright's `tests/page/page-goto.spec.ts`: what `page.goto` loads, what it returns, and how it fails.
 *
 * What the port changes:
 * - `page.goto` resolves at commit in Strider and at `load` in Playwright, so each `goto` the original relies on the
 *   default for passes `waitUntil: "load"`. A `goto` that names its own `waitUntil` keeps it.
 * - A `goto` returns a `PageNavigation`, not a response. `Committed` carries the document's response as an `Option`
 *   (`None` for `about:blank` and `data:` URLs), `NoContent` and `BecameDownload` are the outcomes a 204 and a download
 *   become, and a failure is a `PageError` whose reason says why: `NavigationFailed` with the browser's `netError`,
 *   `NavigationSuperseded`, `NoContent`, `InvalidInput`. The checks on Playwright's messages become checks on those
 *   reasons. `Strider`'s reason is more specific than Playwright's message wherever it says so.
 * - `response.ok()` is `status >= 200 && status <= 299`, and `response.frame()` is the navigation's `frame`, which is
 *   where the navigation happened; `response.request()`'s redirect is `NetworkRequest.redirects(...).from(...)`.
 * - A request the original sees through `page.on("request")` is `NetworkRequest.next` subscribed before the `goto`, or
 *   `NetworkRequest.history` read after it when the page has been fresh the whole time; a body is a `NetworkResponse`
 *   subscription with a body decoder (`arrayBuffer`), subscribed before the `goto`, as the original's `response.body()`
 *   reads it.
 * - Playwright's `response.finished()` (NA-007) and `response.request().failure()` have no direct form: waiting for
 *   `load` is what `finished()` waited for, and `NetworkRequest.failure` is the failure read.
 * - NA-008, NA-010 and NA-011 check the order of `request`, `response`, and `requestfinished` events. Strider has no
 *   `requestfinished` event (matrix row `event-page-requestfinished`), so the port checks the order of `request` and
 *   `response` (each hop's request before its response, one hop for a Cross-Origin-Opener-Policy page, two after a
 *   redirect), that the request didn't fail, and the redirect's first hop. What it can't check is where
 *   `requestfinished` falls.
 * - `page.evaluate` runs in the page's main world, so each page global read or page script is `evaluateInMainWorld`.
 * - Timeouts are `Deadline.within`. A timed-out `goto` is a `Deadline.Timeout` whose operation is `Page.goto`.
 *   NA-030 also checks that its message names the URL, as Playwright's does; Strider's does not, so that check fails.
 * - NA-036's `timeout: 0` has no Strider equivalent: a call with no deadline around it gets `Deadline.DefaultBudget`
 *   (30 seconds), the test's own budget, and the navigation is awaited under it.
 * - The original's fixed waits are ported as written: NA-039's one-second wait, NA-062's two one-second waits, and
 *   NA-063's 500 ms wait. Server-side delays (NA-061's `/slow.js`) run in the fixture
 *   server's own handler, as they do in the original.
 * - NA-038 and NA-039 retry their event checks, as the original's `toPass` does, with `Expect.that` on the event log.
 * - NA-037 and NA-056 start their second navigation from the test body once the first one's request has arrived,
 *   where the original starts it inside the server's route handler.
 * - NA-063 asserts the first navigation's status as the original does: a navigation a second one replaces still
 *   resolves with its committed document.
 * - NA-005 passes a URL with no scheme, to which Playwright adds `http://`. Strider takes the URL as given, so
 *   `localhost:<port>/empty.html` parses with the scheme `localhost:` and reaches the browser: the port fails.
 * - The HTTPS tests (NA-024, NA-025, NA-026, NA-050) use the fixture server's HTTPS origin (`server.https`), whose
 *   certificate is self-signed. The original's context doesn't accept it, and neither does the port's, so each
 *   navigation fails on it: `NavigationFailed`, whose `netError` is matched against the browser's text as
 *   `expectedSSLError` does.
 * - NA-027 is Playwright's undocumented `networkidle0` alias, in the ledger. NA-028 passes an unknown `waitUntil` that
 *   doesn't type-check, as the original's `@ts-expect-error` does, and expects the call to fail naming `waitUntil`.
 * - NA-029's Windows branch uses the platform the test runs on, and the others the browser's error text.
 * - Chromium is the browser these ports were run on. The Firefox and WebKit branches follow the original, with
 *   Strider's reasons as the adapters report them; they run on the CI browsers.
 */
import { assert } from "@effect/vitest"
import {
  Condition,
  Deadline,
  Expect,
  NetworkRequest,
  NetworkResponse,
  Page,
  PageNavigation,
  Route
} from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type { ServerResponse } from "node:http"
import { pathToFileURL } from "node:url"
import { assetPath, failureOf, frameCount, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

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

/** The reason of a `PageError`, which every failed `goto` is. */
const pageReasonOf = (error: unknown) => {
  assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
  return error.reason
}

/** Playwright's `response.ok()`. */
const ok = (response: NetworkResponse.NetworkResponse) => response.status >= 200 && response.status <= 299

/** The frame a request was made in, when a navigation or a document made it. */
const navigableOf = (request: NetworkRequest.NetworkRequest) =>
  request.initiator._tag === "Document" ? request.initiator.navigable : undefined

/** What `expectedSSLError` expects of the browser's text for a certificate it refuses, and Strider's reason for it. */
const assertSslFailure = (error: unknown, browserName: string) => {
  const reason = pageReasonOf(error)
  assert(reason._tag === "NavigationFailed", `expected NavigationFailed, got ${reason._tag}`)
  const expected = browserName === "chromium"
    ? /net::(ERR_CERT_AUTHORITY_INVALID|ERR_CERT_INVALID)/
    : browserName === "webkit"
    ? /Unacceptable TLS certificate|Operation was cancelled/
    : /MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT/
  assert.match(reason.netError, expected)
}

/**
 * The `request` and `response` events a page fires from now on, in the order they arrive, as the original's
 * `page.on("request")` and `page.on("response")` log them, with the hop each one belongs to. Strider has no
 * `requestfinished` event, so that event isn't logged.
 */
const watchNetwork = Effect.fnUntraced(function*(page: Page.Page) {
  const events: Array<string> = []
  const hops = new Set<string>()
  const requests = yield* NetworkRequest.stream(page)
  const responses = yield* NetworkResponse.stream(page)
  yield* Effect.forkScoped(Stream.runForEach(requests, (request) =>
    Effect.sync(() => {
      events.push("request")
      hops.add(request.hop)
    })))
  yield* Effect.forkScoped(Stream.runForEach(responses, (response) =>
    Effect.sync(() => {
      events.push("response")
      hops.add(response.hop)
    })))
  return { events, hops }
})

/** The page the Cross-Origin-Opener-Policy tests serve. */
const openerPolicyRoute = (res: ServerResponse) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
  // Note: without 'onload', Firefox sometimes does not fire the load event
  // over the protocol. The reason is unclear.
  res.end(`
      <div>Hello there!</div>
      <script>window.onload = () => console.log('onload')</script>
    `)
}

/** The first request the page made, which the original's `response.request()` is. */
const firstRequestOf = Effect.fnUntraced(function*(page: Page.Page) {
  const entries = yield* requestsOf(page)
  return entries[0]!
})

/** The events a page's test server logged, in the order they happened, as the original's `expect.toPass` waits for. */
const eventsAre = (expected: ReadonlyArray<string>) =>
  Condition.make<ReadonlyArray<string>>(
    `the events ${JSON.stringify(expected)}`,
    (events) => JSON.stringify(events) === JSON.stringify(expected)
  )

/** Every request the page has made since it was created, which the original's `page.on("request")` collects. */
const requestsOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries
})

/** The `transaction` the original's service-worker test runs in the page's main world. */
const transaction = async (value: string | null) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("roundtrip", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("items")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite")
    const request = tx.objectStore("items").get("name")
    request.onsuccess = () => {
      if (value) tx.objectStore("items").put(value, "name")
    }
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

upstream(import.meta.filename, {}, (test) => {
  test("NA-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  test("NA-002", ({ page }) =>
    Effect.gen(function*() {
      const fileurl = pathToFileURL(assetPath("playwright", "empty.html")).href
      yield* page.goto(fileurl, { waitUntil: "load" })
      assert.strictEqual((yield* page.url).toLowerCase(), fileurl.toLowerCase())
      assert.strictEqual(yield* frameCount(page), 1)
    }))

  test("NA-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto(pathToFileURL(assetPath("playwright", "empty.html")).href, { waitUntil: "load" })
      yield* page.goto("about:blank", { waitUntil: "load" })
    }))

  test("NA-004", ({ page }) =>
    Effect.gen(function*() {
      const fileurl = pathToFileURL(assetPath("playwright", "frames/two-frames.html")).href
      yield* page.goto(fileurl, { waitUntil: "load" })
      assert.strictEqual((yield* page.url).toLowerCase(), fileurl.toLowerCase())
      assert.strictEqual(yield* frameCount(page), 3)
    }))

  test("NA-005", ({ page, server }) =>
    Effect.gen(function*() {
      // A URL with no scheme: Playwright adds `http://`. Strider's `goto` takes an absolute URL, and a scheme-less one
      // such as `localhost:<port>/empty.html` parses with the scheme `localhost:`
      yield* page.goto(server.EMPTY_PAGE.substring("http://".length), { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  test("NA-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      const url = server.CROSS_PROCESS_PREFIX + "/empty.html"
      const sent = yield* NetworkRequest.next(page, { url })
      const navigation = committedOf(yield* page.goto(url, { waitUntil: "load" }))
      assert.strictEqual(yield* page.url, url)
      const mainFrame = (yield* page.frames).id
      // Playwright's `response.frame()`: the frame the navigation happened in
      assert.strictEqual(navigation.frame, mainFrame)
      // Playwright's `requestFrame`
      assert.strictEqual(navigableOf(yield* sent), mainFrame)
      assert.strictEqual(responseOf(navigation).url, url)
    }))

  test("NA-007", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (req) => {
        req.socket.destroy()
      })
      // The original awaits `response1.finished()`, which is the load of the page
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/title.html", { waitUntil: "load" })
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the second goto")
      assert.strictEqual(pageReasonOf(error)._tag, "NavigationFailed")
    }))

  test("NA-008", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => openerPolicyRoute(res))
      const { events, hops } = yield* watchNetwork(page)
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      // The original also expects `requestfinished` last, which Strider has no event for (matrix row
      // `event-page-requestfinished`): the order here is `request`, `response`
      yield* Expect.that(Effect.sync(() => [...events]), eventsAre(["request", "response"]))
      assert.strictEqual(hops.size, 1)
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, yield* firstRequestOf(page))))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("NA-010", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => openerPolicyRoute(res))
      const { events, hops } = yield* watchNetwork(page)
      yield* page.route("**/*", () => Effect.andThen(Effect.sleep("100 millis"), Route.continue))
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      // As NA-008, without the `requestfinished` Strider has no event for
      yield* Expect.that(Effect.sync(() => [...events]), eventsAre(["request", "response"]))
      assert.strictEqual(hops.size, 1)
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, yield* firstRequestOf(page))))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("NA-011", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect", "/empty.html")
      server.setRoute("/empty.html", (_req, res) => openerPolicyRoute(res))
      const { events, hops } = yield* watchNetwork(page)
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/redirect", { waitUntil: "load" }))
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      // The original also expects a `requestfinished` after each response, which Strider has no event for (matrix row
      // `event-page-requestfinished`): the order here is `request`, `response` for each of the two hops
      yield* Expect.that(Effect.sync(() => [...events]), eventsAre(["request", "response", "request", "response"]))
      assert.strictEqual(hops.size, 2)
      const history = yield* requestsOf(page)
      const last = history[history.length - 1]!
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, last)))
      const redirects = yield* NetworkRequest.redirects(page)
      const first = yield* redirects.from(last)
      assert(Option.isSome(first), "the document request has no earlier hop")
      assert.strictEqual(first.value.url, server.PREFIX + "/redirect")
      assert.strictEqual(responseOf(navigation).url, server.EMPTY_PAGE)
    }))

  for (const crossOriginEmbedderPolicy of [undefined, "require-corp"]) {
    test(
      "NA-009",
      { variant: crossOriginEmbedderPolicy === undefined ? "COOP" : "COOP and COEP" },
      ({ page, server }) =>
        Effect.gen(function*() {
          server.setRoute("/empty.html", (_req, res) => {
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
            if (crossOriginEmbedderPolicy) res.setHeader("Cross-Origin-Embedder-Policy", crossOriginEmbedderPolicy)
            res.end(`
        <!doctype html>
        <h1>hello</h1>
        <script type="module">history.replaceState({ key: 1 }, '', location.href);</script>
      `)
          })
          const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
          assert.strictEqual(responseOf(navigation).status, 200)
          assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() => history.state),
            { key: 1 }
          )
          yield* Expect.toHaveText(page.locator("h1"), "hello")
        })
    )
  }

  test("NA-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: server.PREFIX + "/frames/frame.html" })
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" }))
      assert.strictEqual(yield* page.url, server.PREFIX + "/frames/one-frame.html")
      assert.strictEqual(navigation.frame, (yield* page.frames).id)
      assert.strictEqual(responseOf(navigation).url, server.PREFIX + "/frames/one-frame.html")
      assert.strictEqual(yield* frameCount(page), 2)
      // Playwright's `requestFrame` is `page.frames()[1]`, the child frame
      assert.strictEqual(navigableOf(yield* sent), (yield* page.frames).children[0]!.id)
    }))

  test("NA-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      const sent = yield* NetworkRequest.next(page, { url: server.CROSS_PROCESS_PREFIX + "/frames/frame.html" })
      const navigation = committedOf(
        yield* page.goto(server.CROSS_PROCESS_PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      )
      assert.strictEqual(yield* page.url, server.CROSS_PROCESS_PREFIX + "/frames/one-frame.html")
      assert.strictEqual(navigation.frame, (yield* page.frames).id)
      assert.strictEqual(responseOf(navigation).url, server.CROSS_PROCESS_PREFIX + "/frames/one-frame.html")
      assert.strictEqual(yield* frameCount(page), 2)
      assert.strictEqual(navigableOf(yield* sent), (yield* page.frames).children[0]!.id)
    }))

  test("NA-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      yield* page.goto(server.EMPTY_PAGE + "#foo", { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#foo")
      yield* page.goto(server.EMPTY_PAGE + "#bar", { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#bar")
    }))

  test("NA-015", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/empty.html")
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/redirect/1.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  test("NA-016", ({ page }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto("about:blank", { waitUntil: "load" }))
      // Playwright's `null` response: a document with no response behind it
      assert.isTrue(Option.isNone(navigation.response))
    }))

  test("NA-017", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/historyapi.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("NA-018", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frames/frame.html", (_req, res) => {
        res.statusCode = 204
        res.end()
      })
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
    }))

  test("NA-019", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frames/frame.html", (_req, res) => {
        res.statusCode = 204
        res.end()
      })
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "domContentLoaded" })
    }))

  test("NA-020", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.statusCode = 204
        res.end()
      })
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the goto")
      // Playwright's message names the browser's abort; Strider's reason is the page's answer of no content
      assert.strictEqual(pageReasonOf(error)._tag, "NoContent")
    }))

  test("NA-021", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "domContentLoaded" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("NA-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener(
          "beforeunload",
          () => history.replaceState(null, "initial", window.location.href),
          false
        )
      })
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("NA-023", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(page.goto("asdfasdf"), "the goto")
      assert.strictEqual(pageReasonOf(error)._tag, "InvalidInput")
    }))

  // The original's `httpsServer` has a self-signed certificate that its context doesn't accept, so each navigation fails
  // on it. The page's context here doesn't accept insecure certificates either.
  test("NA-024", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // Make sure that network events do not emit 'undefined'.
      const requests = yield* NetworkRequest.stream(page)
      const seen: Array<unknown> = []
      yield* requests.pipe(Stream.runForEach((request) => Effect.sync(() => seen.push(request))), Effect.forkScoped)
      const error = yield* failureOf(page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" }), "the goto")
      assertSslFailure(error, browserName)
      assert.isTrue(seen.every((request) => request !== undefined))
    }))

  test("NA-025", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/empty.html")
      const error = yield* failureOf(
        page.goto(server.https.PREFIX + "/redirect/1.html", { waitUntil: "load" }),
        "the goto"
      )
      assertSslFailure(error, browserName)
    }))

  test("NA-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      // The original swallows the failure: the test is that the browser survives it
      yield* Effect.result(page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" }))
    }))

  test("NA-028", ({ page, server }) =>
    Effect.gen(function*() {
      // @ts-expect-error networkidle2 is not allowed
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "networkidle2" }), "the goto")
      assert.include(String((error as Error).message), "waitUntil")
    }))

  test("NA-029", ({ page, browserName }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(page.goto("http://localhost:44123/non-existing-url"), "the goto")
      const reason = pageReasonOf(error)
      assert(reason._tag === "NavigationFailed", `expected NavigationFailed, got ${reason._tag}`)
      if (browserName === "chromium") {
        assert.include(reason.netError, "net::ERR_CONNECTION_REFUSED")
      } else if (browserName === "webkit") {
        assert.include(
          reason.netError,
          process.platform === "win32" ? "Could not connect to server" : "Could not connect"
        )
      } else {
        assert.include(reason.netError, "NS_ERROR_CONNECTION_REFUSED")
      }
    }))

  test("NA-030", ({ page, server }) =>
    Effect.gen(function*() {
      // Hang for request to the empty.html
      server.setRoute("/empty.html", () => {})
      const url = server.PREFIX + "/empty.html"
      const error = yield* failureOf(page.goto(url).pipe(Deadline.within(Duration.millis(1))), "the goto")
      assert(Deadline.isTimeout(error), `expected a Timeout, got ${String(error)}`)
      assert.strictEqual(error.operation, "Page.goto")
      assert.isAtMost(Duration.toMillis(error.budget), 1)
      // Playwright's message names the URL; Strider's Timeout names its operation and phase
      assert.include(error.message, url)
    }))

  // NA-031 to NA-035: Strider has no default navigation or context timeouts, see the ledger

  test("NA-036", ({ page, server }) =>
    Effect.gen(function*() {
      // Strider has no `timeout: 0`: the call has no deadline around it, so it gets `Deadline.DefaultBudget`, 30 s
      const loaded = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* loaded
    }))

  test("NA-037", ({ page, server }) =>
    Effect.gen(function*() {
      // The original starts the second navigation from the route that hangs the first, once its request has arrived
      const arrived = yield* server.waitForRequest("/empty.html")
      server.setRoute("/empty.html", () => {
        // Hang request to empty.html.
      })
      const first = yield* Effect.forkChild(page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" }), {
        startImmediately: true
      })
      yield* arrived
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const error = yield* failureOf(Fiber.join(first), "the first navigation")
      assert.strictEqual(pageReasonOf(error)._tag, "NavigationSuperseded")
    }))

  test("NA-038", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      server.setRoute("/a", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`
        <body>
          <script>
            setTimeout(() => {
              window.location.pathname = '/c';
            }, 1000);
          </script>
        </body>
      `)
      })
      const events: Array<string> = []
      server.setRoute("/b", async (_req, res) => {
        events.push("started b")
        await new Promise((f) => setTimeout(f, 2000))
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`BBB`)
        events.push("finished b")
      })
      server.setRoute("/c", async (_req, res) => {
        events.push("started c")
        await new Promise((f) => setTimeout(f, 2000))
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`CCC`)
        events.push("finished c")
      })
      yield* page.goto(server.PREFIX + "/a", { waitUntil: "load" })
      const outcome = yield* Effect.result(page.goto(server.PREFIX + "/b", { waitUntil: "load" }))
      const expectEvents = (browserName === "chromium") ?
        ["started b", "finished b"] :
        ["started b", "started c", "finished b", "finished c"]
      yield* Expect.that(Effect.sync(() => [...events]), eventsAre(expectEvents))
      assert.deepStrictEqual(events, expectEvents)
      if (browserName === "chromium") {
        // Chromium prioritizes the url bar navigation over the js redirect.
        assert(Result.isSuccess(outcome), "the url bar navigation failed")
        yield* Expect.toHaveURL(page, server.PREFIX + "/b")
      } else if (browserName === "webkit") {
        assert(Result.isFailure(outcome), "the url bar navigation succeeded")
        assert.strictEqual(pageReasonOf(outcome.failure)._tag, "NavigationSuperseded")
        yield* Expect.toHaveURL(page, server.PREFIX + "/c")
      } else if (browserName === "firefox") {
        // Firefox reports the aborted navigation as a failure with the browser's abort text
        assert(Result.isFailure(outcome), "the url bar navigation succeeded")
        const reason = pageReasonOf(outcome.failure)
        assert(reason._tag === "NavigationFailed", `expected NavigationFailed, got ${reason._tag}`)
        assert.include(reason.netError, "navigation aborted")
        yield* Expect.toHaveURL(page, server.PREFIX + "/c")
      }
    }))

  test("NA-039", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/a", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`
      <body>
        <script>
          setTimeout(() => {
            window.location.pathname = '/c';
          }, 10);
        </script>
      </body>
    `)
      })
      const events: Array<string> = []
      server.setRoute("/b", async (_req, res) => {
        events.push("started b")
        await new Promise((f) => setTimeout(f, 2000))
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`BBB`)
        events.push("finished b")
      })
      server.setRoute("/c", async (_req, res) => {
        events.push("started c")
        await new Promise((f) => setTimeout(f, 2000))
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`CCC`)
        events.push("finished c")
      })
      yield* page.goto(server.PREFIX + "/a", { waitUntil: "load" })
      // The original's own fixed wait, so the redirect to /c is under way before /b starts
      yield* Effect.sleep("1 second")
      const outcome = yield* Effect.result(page.goto(server.PREFIX + "/b", { waitUntil: "load" }))
      const expectEvents = ["started c", "started b", "finished c", "finished b"]
      yield* Expect.that(Effect.sync(() => [...events]), eventsAre(expectEvents)).pipe(
        Deadline.within("5 seconds")
      )
      assert.deepStrictEqual(events, expectEvents)
      assert(Result.isSuccess(outcome), "the url bar navigation failed")
      assert.strictEqual(yield* page.url, server.PREFIX + "/b")
    }))

  test("NA-040", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      assert.isTrue(ok(responseOf(navigation)))
    }))

  test("NA-041", ({ page }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto("data:text/html,hello", { waitUntil: "load" }))
      assert.isTrue(Option.isNone(navigation.response))
    }))

  test("NA-042", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/not-found", { waitUntil: "load" }))
      assert.isFalse(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).status, 404)
    }))

  test("NA-043", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/redirect/3.html")
      server.setRedirect("/redirect/3.html", server.EMPTY_PAGE)
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/redirect/1.html", { waitUntil: "load" }))
      assert.isTrue(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).url, server.EMPTY_PAGE)
    }))

  test("NA-044", ({ page, server }) =>
    Effect.gen(function*() {
      let warning: unknown = null
      const warningHandler = (w: unknown) => warning = w
      process.on("warning", warningHandler)
      for (let i = 0; i < 20; ++i) yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      process.off("warning", warningHandler)
      assert.strictEqual(warning, null)
    }))

  test("NA-045", ({ page }) =>
    Effect.gen(function*() {
      let warning: unknown = null
      const warningHandler = (w: unknown) => warning = w
      process.on("warning", warningHandler)
      for (let i = 0; i < 20; ++i) yield* Effect.result(page.goto("asdf"))
      process.off("warning", warningHandler)
      assert.strictEqual(warning, null)
    }))

  test("NA-046", ({ page, server }) =>
    Effect.gen(function*() {
      let warning: unknown = null
      const warningHandler = (w: unknown) => warning = w
      process.on("warning", warningHandler)
      const waits = yield* Effect.all(
        Array.from({ length: 20 }, () => PageNavigation.next(page, { waitUntil: "load" }))
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* Effect.all(waits)
      process.off("warning", warningHandler)
      assert.strictEqual(warning, null)
    }))

  test("NA-047", ({ page }) =>
    Effect.gen(function*() {
      const dataURL = "data:text/html,<div>yo</div>"
      const navigation = committedOf(yield* page.goto(dataURL, { waitUntil: "load" }))
      assert.isTrue(Option.isNone(navigation.response))
      assert.strictEqual((yield* requestsOf(page)).length, 0)
    }))

  test("NA-048", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE + "#hash", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
      assert.strictEqual(responseOf(navigation).url, server.EMPTY_PAGE)
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]!.url, server.EMPTY_PAGE)
    }))

  test("NA-049", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/self-request.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
      assert.include(responseOf(navigation).url, "self-request.html")
    }))

  test("NA-050", ({ page, server }) =>
    Effect.gen(function*() {
      const url = server.https.PREFIX + "/redirect/1.html"
      const error = yield* failureOf(page.goto(url, { waitUntil: "load" }), "the goto")
      assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
      assert.include(error.message, url)
    }))

  test("NA-051", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      // The original's promise resolves with an `Event`, which doesn't cross by value: wait for it and return nothing
      yield* page.evaluateInMainWorld(async () => {
        await (window as unknown as { activationPromise: Promise<unknown> }).activationPromise
      })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      yield* Expect.that(
        page.evaluateInMainWorld(() => !!navigator.serviceWorker.controller),
        Condition.make("the page is controlled by its service worker", (controlled: boolean) => controlled)
      )
      yield* page.evaluateInMainWorld(transaction, "value")
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      yield* page.back({ waitUntil: "load" })
      yield* Expect.that(
        page.evaluateInMainWorld(() => !!navigator.serviceWorker.controller),
        Condition.make("the page is controlled by its service worker", (controlled: boolean) => controlled)
      )
      assert.strictEqual(yield* page.evaluateInMainWorld(transaction, null), "value")
    }))

  // NA-052 to NA-055: Strider's goto has no referer option, see the ledger

  test("NA-056", ({ page, server }) =>
    Effect.gen(function*() {
      const arrived = yield* server.waitForRequest("/one-style.html")
      server.setRoute("/one-style.html", () => {
        // Hang the navigation, so the next one cancels it
      })
      const failed = yield* Effect.forkChild(page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" }), {
        startImmediately: true
      })
      yield* arrived
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      const error = yield* failureOf(Fiber.join(failed), "the first navigation")
      assert.strictEqual(pageReasonOf(error)._tag, "NavigationSuperseded")
    }))

  test("NA-057", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/lazy-frame.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
    }))

  test("NA-058", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.statusCode = 200
        res.end(Buffer.from("Ü (lowercase ü)", "utf-8"))
      })
      const captured = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/empty.html",
        body: (message) => message.arrayBuffer
      })
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      const response = yield* captured
      assert.strictEqual(Buffer.from(response.body).toString(), "Ü (lowercase ü)")
    }))

  test("NA-059", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(page.goto("https://www.youtube Panel Title.com/"), "the goto")
      assert.strictEqual(pageReasonOf(error)._tag, "InvalidInput")
      assert(Page.isPageError(error))
      assert.include(error.message, "Panel Title")
    }))

  test("NA-060", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/rtc.html", (_, res) => {
        res.end(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            window.RTCPeerConnection && new window.RTCPeerConnection({
              iceServers: []
            });
          </script>
        </body>
      </html>
`)
      })
      yield* page.goto(server.PREFIX + "/rtc.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        // RTCPeerConnection is not present on WebKit Linux
        if (window.RTCPeerConnection) void new window.RTCPeerConnection({ iceServers: [] })
      })
    }))

  test("NA-061", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/slow.js", async (_req, res) => {
        await new Promise((x) => setTimeout(x, 100))
        res.writeHead(200, { "Content-Type": "application/javascript" })
        res.end(`window.results.push('slow module');export const foo = 'slow';`)
      })
      yield* page.goto(server.PREFIX + "/load-event/load-event.html", { waitUntil: "load" })
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { results: Array<string> }).results),
        [
          "script tag after after module",
          "slow module",
          "module",
          "DOMContentLoaded",
          "load"
        ]
      )
    }))

  test("NA-062", ({ page, server }) =>
    Effect.gen(function*() {
      const held: { response?: ServerResponse } = {}
      server.setRoute("/module.js", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/javascript" })
        held.response = res
      })
      // Listen before the goto sends the request
      const arrived = yield* server.waitForRequest("/module.js")
      const navigation = yield* startWaiting(page.goto(server.PREFIX + "/window-stop.html", { waitUntil: "load" }))
      yield* arrived
      assert.isFalse(yield* navigation.done)
      // The original's own fixed wait, to give it time to resolve erroneously
      yield* Effect.sleep("1 second")
      assert(held.response !== undefined, "the module request wasn't answered yet")
      held.response.end("")
      // The original's own fixed wait, to give it more time to resolve erroneously
      yield* Effect.sleep("1 second")
      assert.isFalse(yield* navigation.done)
    }))

  test("NA-063", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/slow.js", async () => void 0)
      const navigation = yield* startWaiting(
        page.goto(server.PREFIX + "/load-event/load-event.html", { waitUntil: "load" })
      )
      // The original's own fixed wait
      yield* Effect.sleep("500 millis")
      assert.isFalse(yield* navigation.done)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original expects the first navigation's response, status 200
      const first = yield* Fiber.join(navigation.fiber)
      assert.strictEqual(responseOf(committedOf(first)).status, 200)
    }))

  test("NA-064", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/script.js", () => {})
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("content-type", "text/html")
        res.end("<title>Hello</title><script src=\"script.js\"></script>")
      })
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "commit" }))
      assert.strictEqual(responseOf(navigation).status, 200)
      assert.strictEqual(yield* page.title, "Hello")
    }))

  test("NA-065", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`
      <body>
        <script>
          const iframe = document.createElement('iframe');
          iframe.src = './iframe.html';
          document.body.appendChild(iframe);
          setTimeout(() => iframe.remove(), 1000);
        </script>
      </body>
    `)
      })
      server.setRoute("/iframe.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(`
      <link rel="stylesheet" href="./style2.css">
    `)
      })
      // Stall the css so that 'load' does not fire.
      server.setRoute("/style2.css", () => {})
      // The iframe's detaching is the frame tree's change from one child to none, after it attached
      const frameDetached = yield* startWaiting(
        page.frames.changes.pipe(
          Stream.map((tree) => tree.children.length),
          Stream.dropWhile((count) => count === 0),
          Stream.dropWhile((count) => count > 0),
          Stream.runHead
        )
      )
      const done = yield* startWaiting(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      yield* Fiber.join(frameDetached.fiber) // Make sure that iframe is gone.
      yield* Fiber.join(done.fiber)
      assert.strictEqual(yield* page.locator("iframe").count, 0)
    }))

  test("NA-066", ({ page, server }) =>
    Effect.gen(function*() {
      const url = `http://admin:admin@localhost:${server.PORT}/empty.html`
      yield* page.goto(url, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, url)
    }))
})
