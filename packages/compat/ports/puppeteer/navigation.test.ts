/**
 * Puppeteer's `test/src/navigation.test.ts`, in file order: `Page.goto`, `Page.waitForNavigation`, `Page.goBack`,
 * `Frame.goto`, `Frame.waitForNavigation`, `Page.reload`, and the suite with network events disabled.
 *
 * What the port changes:
 * - `page.goto` resolves at commit in Strider and at `load` in Puppeteer, so each `goto` the original relies on the
 *   default for passes `waitUntil: "load"`. A `goto` that names its own `waitUntil` keeps it.
 * - A `goto` returns a `PageNavigation`, not a response. `Committed` carries the document's response as an `Option`
 *   (`None` for `about:blank` and `data:` URLs), `NoContent` and `NavigationFailed` are the outcomes a 204 and a failed
 *   load become, and a failure is a `PageError` whose reason says why. `response.ok()` is `status` in 200 through 299,
 *   which the port checks with `ok` below.
 * - "should work when navigating to data url": Puppeteer's `data:` navigation has a response, which is `ok()`. Strider
 *   documents no response for a `data:` URL (`PageNavigation`'s `Committed.response` is `None` there), so the port
 *   checks that, as Playwright's NA-041 does. Chromium's adapter reports the `data:` document's own response, so the
 *   test fails there, as NA-041 does; that is Strider's behavior, not the port's.
 * - Puppeteer's `TimeoutError` is Strider's `Deadline.Timeout`, and the original's `timeout` option is
 *   `Deadline.within`. The port checks the timeout's operation (`Page.goto`) and its budget, not Puppeteer's message:
 *   Strider's message names the operation and phase instead of the milliseconds.
 * - "should remove its listeners when the navigation times out" counts the `FrameDetached` listeners on Puppeteer's
 *   `Frame` object. Strider's frames expose no listener count, so the port keeps the timeout the test starts with and
 *   drops the count, as the Oopif port does for its `boundingBox` checks.
 * - "should be cancellable" uses Puppeteer's `AbortSignal`. Strider has no signal option: interrupting the fiber that
 *   runs `goto` is the cancellation (`Fiber.interrupt`), and the port checks that the `goto` was interrupted.
 * - "should settle when the page navigates again while loading" fakes Puppeteer's clock, which `sinon` drives. Strider's
 *   deadlines read the browser's clock, so the port runs the 10-second deadline for real. The original's `loaded`
 *   wait is the `load` the `goto` already waits for.
 * - "should fail when exceeding default maximum navigation timeout" and "…default maximum timeout" call
 *   `page.setDefaultNavigationTimeout` and `page.setDefaultTimeout`, which set a default for every call. The port
 *   applies the one budget to its `goto` with `defaultTimeout` (the harness's helper). "should prioritize default
 *   navigation timeout over default timeout" sets two defaults and checks which one wins: Strider has one default
 *   per call, so it's ledgered.
 * - "should disable timeout when its set to 0" passes `timeout: 0`. Strider has no such option: the `goto` has no
 *   timeout of its own and runs under the test's budget.
 * - Puppeteer's `page.evaluate` runs in the page's main world, so each page script is `evaluateInMainWorld`.
 * - "should be cancellable", "should settle…", and the timeouts wait on the fixture server or on a `goto` the port
 *   started, bounded by `waiting`, so a failure names what it waited for.
 * - The `https` tests use the fixture server's HTTPS origin (`server.https`), whose certificate is self-signed. The
 *   original's context doesn't accept it, and neither does the port's, so each navigation fails with a
 *   `NavigationFailed` whose `netError` is matched as Puppeteer's `EXPECTED_SSL_CERT_MESSAGE_REGEX` is, with
 *   WebKit's text added for stock WebKit.
 * - "should fail when navigating to bad SSL" checks Puppeteer's `request`, `requestfailed` order. Strider has no
 *   `requestfailed` event: the port reads the page's requests after the failure, which should be the one request (not
 *   counting the `data:` icon of Chromium's certificate error page), and that request's failure
 *   (`NetworkRequest.failure`).
 * - "should fail when main resources failed to load" and "…bad url" check Strider's reason for the failure, and the
 *   net error text the browser gives, as Playwright's NA-029 does.
 * - The `networkidle0` and `networkidle2` tests and "should return response when page replaces its state during
 *   load" wait for a network-idle state Strider doesn't have: they are in the ledger, not ported.
 * - Same-document navigations (a fragment click, `pushState`, `replaceState`, and the History API's `back` and `forward`)
 *   are `PageNavigation.SameDocument`, with `via` the port asserts. Each wait is `PageNavigation.next`, subscribed before
 *   the action, as Puppeteer's `waitForNavigation` is. Stock WebKit reports no same-document navigation (QUIRKS.md,
 *   Q200), so on it these waits don't settle.
 * - `page.goBack` and `goForward` are `page.back` and `forward`, which give `None` where there is no history entry
 *   instead of Puppeteer's error; the port asserts the `None`. A traversal between History API entries is asserted to
 *   be `SameDocument` without its `via`, which the original doesn't check and Chromium reports as `"fragment"`.
 * - "Page.goBack should work" turns the HTTP cache off in the original; Strider has no such setting, so the port
 *   accepts a `Committed` (with an `ok` response) or a `Restored` document, and checks the URL of each.
 * - 404 and 500 responses with an empty body, and the `Frame.waitForNavigation` detach test, fail on Chromium on
 *   Strider's behavior (see the tests' comments), not the port's.
 * - `Frame.waitForNavigation` is `PageNavigation.next` with `frames: "all"` and a predicate on the frame's id (the
 *   matrix's `method-frame-waitfornavigation`). A frame's script runs as `evaluateInMainWorld` in its same-origin
 *   `contentWindow`, since Strider has no frame evaluation.
 * - `page.waitForNavigation({ signal })` is cancelled by interrupting its wait (`option-page-waitfornavigation-signal`);
 *   the test of the signal's own `abort` listeners is ledgered.
 * - The leak tests collect the Node process's `warning` events while their navigations run, as the original does.
 * - The browser branches (net errors, SSL text) follow the original's, with WebKit's text added for stock WebKit, and
 *   Strider's reasons as the adapters report them. The port is run on Chromium here; CI covers the others.
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
  Target
} from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type * as http from "node:http"
import { defaultTimeout, failureOf, startWaiting } from "../harness/playwright.ts"
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

/** The reason of a `PageError`, which every failed `goto` is. */
const pageReasonOf = (error: unknown) => {
  assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
  return error.reason
}

/** Puppeteer's `response.ok()`: a status in 200 through 299. */
const ok = (response: NetworkResponse.NetworkResponse) => response.status >= 200 && response.status <= 299

/**
 * What the original's `EXPECTED_SSL_CERT_MESSAGE_REGEX` expects of the browser's text for a certificate it refuses. The
 * regex's `SSL_ERROR_UNKNOWN` and WebKit's text are the browsers' own; Strider's reason carries the text.
 */
const assertSslFailure = (error: unknown, browserName: string) => {
  const reason = pageReasonOf(error)
  assert(reason._tag === "NavigationFailed", `expected NavigationFailed, got ${reason._tag}`)
  assert.match(
    reason.netError,
    browserName === "webkit"
      ? /Unacceptable TLS certificate|Operation was cancelled/
      : /net::ERR_CERT_INVALID|net::ERR_CERT_AUTHORITY_INVALID|MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT|SSL_ERROR_UNKNOWN/
  )
}

/** Every request the page has made since it was created, which the original's `page.on("request")` collects. */
const requestsOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries
})

/**
 * Bounds a wait of the port's own, so a failure says what it waited for rather than riding the test's budget. The
 * waits here are on the fixture server or on a navigation the port started.
 */
const waiting = <A, E, R>(what: string, wait: Effect.Effect<A, E, R>, duration: Duration.Input = "10 seconds") =>
  wait.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.die(new Error(`timed out waiting for ${what}`)) }))

/**
 * A navigation a same-document change made, which the original's `waitForNavigation` resolves to `null`. `via` names
 * the change: a fragment, or the History API.
 */
const sameDocumentOf = (navigation: PageNavigation.PageNavigation, via: "fragment" | "historyApi") => {
  assert(navigation._tag === "SameDocument", `the navigation is ${navigation._tag}, not SameDocument`)
  assert.strictEqual(navigation.via, via)
  return navigation
}

/**
 * The navigation a traversal between History API entries made, which the original resolves to `null`. `back` and
 * `forward` give `None` when there is no entry to go to. `via` isn't checked: the original doesn't, the documentation
 * doesn't say what a traversal reports, and Chromium reports `"fragment"` for one.
 */
const traversedOf = (navigation: Option.Option<PageNavigation.PageNavigation>) => {
  assert(Option.isSome(navigation), "the traversal found no history entry to go to")
  assert(navigation.value._tag === "SameDocument", `the traversal is ${navigation.value._tag}, not SameDocument`)
  return navigation.value
}

/**
 * A traversal to a document: a committed one with an `ok` response, as the original expects, or one restored whole from
 * the back-forward cache, which has no response.
 */
const assertDocumentOf = (navigation: PageNavigation.PageNavigation, url: string) => {
  if (navigation._tag === "Committed") assert.isTrue(ok(responseOf(navigation)))
  else assert(navigation._tag === "Restored", `the traversal is ${navigation._tag}, not Committed or Restored`)
  assert.include(navigation.url, url)
}

/** Puppeteer's `isFavicon`: the favicon requests its listeners leave out. */
const isFavicon = (request: { readonly url: string }) => request.url.includes("favicon.ico")

/** The first child frame of the page's main frame: Puppeteer's `page.frames()[1]`. */
const firstChildFrame = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const frame = (yield* page.frames).children[0]
  assert(frame !== undefined, "the page has no child frame")
  return frame
})

/**
 * The warnings the Node process emits while `effect` runs: Puppeteer's `process.on("warning")` check, which removes its
 * listener once the navigations are done.
 */
const warningsDuring = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const warnings: Array<Error> = []
  const handler = (warning: Error) => {
    warnings.push(warning)
  }
  process.on("warning", handler)
  yield* effect.pipe(Effect.ensuring(Effect.sync(() => process.removeListener("warning", handler))))
  return warnings
})

upstream(import.meta.filename, {}, (test) => {
  test("navigation Page.goto should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  test("navigation Page.goto should work with anchor navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      yield* page.goto(server.EMPTY_PAGE + "#foo", { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#foo")
      yield* page.goto(server.EMPTY_PAGE + "#bar", { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#bar")
    }))

  test("navigation Page.goto should work with redirects", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/empty.html")
      yield* page.goto(server.PREFIX + "/redirect/1.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  test("navigation Page.goto should navigate to about:blank", ({ page }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto("about:blank", { waitUntil: "load" }))
      // Puppeteer's `null` response: a document with no response behind it
      assert.isTrue(Option.isNone(navigation.response))
    }))

  test("navigation Page.goto should return response when page changes its URL after load", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/historyapi.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  // "should return response when page replaces its state during load" waits for `networkidle2`, a load state Strider
  // doesn't have (ledger: navigation-networkidle).

  test("navigation Page.goto should work with subframes return 204", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frames/frame.html", (_req, res) => {
        res.statusCode = 204
        res.end()
      })
      // The subframe's 204 doesn't fail the page's navigation
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
    }))

  test("navigation Page.goto should fail when server returns 204", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.statusCode = 204
        res.end()
      })
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the goto")
      // Puppeteer's message names the browser's abort (`net::ERR_ABORTED`); Strider's reason is the 204 itself
      assert.strictEqual(pageReasonOf(error)._tag, "NoContent")
    }))

  test("navigation Page.goto should navigate to empty page with domcontentloaded", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "domContentLoaded" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("navigation Page.goto should navigate successfully after encountering network error", ({ page, server }) =>
    Effect.gen(function*() {
      // Destroy the connection to simulate a network error. This will open about:neterror on Firefox.
      server.setRoute("/network-error", (req) => {
        req.socket.destroy()
      })
      const error = yield* failureOf(page.goto(server.PREFIX + "/network-error", { waitUntil: "load" }), "the goto")
      assert.strictEqual(pageReasonOf(error)._tag, "NavigationFailed")
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("navigation Page.goto should work when page calls history API in beforeunload", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener(
          "beforeunload",
          () => {
            return history.replaceState(null, "initial", window.location.href)
          },
          false
        )
      })
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
    }))

  test("navigation Page.goto should work when reload causes history API in beforeunload", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener(
          "beforeunload",
          () => {
            return history.replaceState(null, "initial", window.location.href)
          },
          false
        )
      })
      yield* page.reload({ waitUntil: "load" })
      // Evaluate still works.
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1), 1)
    }))

  // The `networkidle0` and `networkidle2` tests wait for network-idle load states, which Strider doesn't have
  // (ledger: navigation-networkidle).

  test("navigation Page.goto should fail when navigating to bad url", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(page.goto("asdfasdf"), "the goto")
      // Puppeteer's message is `invalid argument` (or Firefox's `Cannot navigate to invalid URL`)
      assert.strictEqual(pageReasonOf(error)._tag, "InvalidInput")
    }))

  test("navigation Page.goto should fail when navigating to bad SSL", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" }), "the goto")
      assertSslFailure(error, browserName)
      // The original's requests: one `request`, then its `requestfailed`, and no `undefined` event. Chromium's
      // certificate error page loads its own icon as a `data:` URL, which Strider's history lists as a request and
      // the original's two events (and Playwright's) leave out, so the count is of the requests that aren't `data:` URLs.
      const requests = (yield* requestsOf(page)).filter((request) => !request.url.startsWith("data:"))
      assert.deepStrictEqual(requests.map((request) => `${request.method} ${request.url}`), [
        `GET ${server.https.EMPTY_PAGE}`
      ])
      assert.isTrue(Option.isSome(yield* NetworkRequest.failure(page, requests[0]!)))
    }))

  test("navigation Page.goto should fail when navigating to bad SSL after redirects", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/empty.html")
      const error = yield* failureOf(
        page.goto(server.https.PREFIX + "/redirect/1.html", { waitUntil: "load" }),
        "the goto"
      )
      assertSslFailure(error, browserName)
    }))

  test("navigation Page.goto should fail when main resources failed to load", ({ page, browserName }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(page.goto("http://localhost:44123/non-existing-url"), "the goto")
      const reason = pageReasonOf(error)
      assert(reason._tag === "NavigationFailed", `expected NavigationFailed, got ${reason._tag}`)
      if (browserName === "chromium") {
        assert.include(reason.netError, "net::ERR_CONNECTION_REFUSED")
      } else if (browserName === "webkit") {
        assert.include(reason.netError, "Could not connect")
      } else {
        assert.include(reason.netError, "NS_ERROR_CONNECTION_REFUSED")
      }
    }))

  test("navigation Page.goto should fail when exceeding maximum navigation timeout", ({ page, server }) =>
    Effect.gen(function*() {
      // Hang for request to the empty.html
      server.setRoute("/empty.html", () => {})
      const error = yield* failureOf(
        page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" }).pipe(Deadline.within(Duration.millis(1))),
        "the goto"
      )
      assert(Deadline.isTimeout(error), `expected a Timeout, got ${String(error)}`)
      assert.strictEqual(error.operation, "Page.goto")
      assert.isAtMost(Duration.toMillis(error.budget), 1)
    }))

  test("navigation Page.goto should remove its listeners when the navigation times out", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's count of the `FrameDetached` listeners on its `Frame` object has no Strider counterpart: the port
      // keeps the timeout the test starts with
      server.setRoute("/empty.html", () => {})
      const error = yield* failureOf(
        page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" }).pipe(Deadline.within(Duration.millis(1))),
        "the goto"
      )
      assert(Deadline.isTimeout(error), `expected a Timeout, got ${String(error)}`)
    }))

  test("navigation Page.goto should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      // Hang for request to the empty.html
      server.setRoute("/empty.html", () => {})
      const arrived = yield* server.waitForRequest("/empty.html")
      const navigation = yield* Effect.forkChild(
        page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" }),
        { startImmediately: true }
      )
      yield* waiting("the request for /empty.html", arrived)
      // Puppeteer's `abortController.abort()` rejects the `goto` with `aborted`. Interrupting its fiber is the cancellation
      yield* Fiber.interrupt(navigation)
      const exit = yield* Fiber.await(navigation)
      assert.isTrue(Exit.hasInterrupts(exit), "the goto ended without being interrupted")
    }))

  test("navigation Page.goto should settle when the page navigates again while loading", ({ page, server }) =>
    Effect.gen(function*() {
      // The document loads, then navigates again from its own load handler.
      server.setRoute("/navigate-on-load.html", (_, res) => {
        res.end(`<html><body onload="location.href='/hang.html'">ok</body></html>`)
      })
      // Hang for the request the page navigates to.
      server.setRoute("/hang.html", () => {})
      const hangRequested = yield* server.waitForRequest("/hang.html")
      const goto = yield* Effect.forkChild(
        page.goto(server.PREFIX + "/navigate-on-load.html", { waitUntil: "load" }).pipe(
          Deadline.within("10 seconds"),
          Effect.result
        ),
        { startImmediately: true }
      )
      // Only once the first document is done and the second navigation is in flight is the deadline the thing goto is
      // waiting on. Resolving and timing out are both fine; never settling is not, so the wait is bounded.
      yield* waiting("the request for /hang.html", hangRequested)
      yield* waiting("the goto to settle", Fiber.join(goto), "15 seconds")
    }))

  test("navigation Page.goto should fail when exceeding default maximum navigation timeout", ({ page, server }) =>
    Effect.gen(function*() {
      // Hang for request to the empty.html
      server.setRoute("/empty.html", () => {})
      const error = yield* failureOf(
        page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" }).pipe(defaultTimeout("1 millis")),
        "the goto"
      )
      assert(Deadline.isTimeout(error), `expected a Timeout, got ${String(error)}`)
      assert.strictEqual(error.operation, "Page.goto")
    }))

  test("navigation Page.goto should fail when exceeding default maximum timeout", ({ page, server }) =>
    Effect.gen(function*() {
      // Hang for request to the empty.html
      server.setRoute("/empty.html", () => {})
      const error = yield* failureOf(
        page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" }).pipe(defaultTimeout("1 millis")),
        "the goto"
      )
      assert(Deadline.isTimeout(error), `expected a Timeout, got ${String(error)}`)
      assert.strictEqual(error.operation, "Page.goto")
    }))

  // "should prioritize default navigation timeout over default timeout" sets two defaults and checks that the navigation
  // one wins. Strider has one default per call, so it's ledgered as differentByDesign.

  test("navigation Page.goto should disable timeout when its set to 0", ({ page, server }) =>
    Effect.gen(function*() {
      const loaded = yield* PageNavigation.next(page, { waitUntil: "load" })
      // `timeout: 0` turns off the call's own timeout. The `goto` has none of its own, so it runs under the test's budget.
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* loaded
    }))

  test("navigation Page.goto should work when navigating to valid url", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      assert.isTrue(ok(responseOf(navigation)))
    }))

  test("navigation Page.goto should work when navigating to a URL with a client redirect", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/client-redirect.html", { waitUntil: "load" }))
      assert.isTrue(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).url, server.PREFIX + "/client-redirect.html")
    }))

  test("navigation Page.goto should work when a page redirects on DOMContentLoaded", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(
        yield* page.goto(server.PREFIX + "/client-redirect-DOMContentLoaded.html", { waitUntil: "load" })
      )
      assert.isTrue(ok(responseOf(navigation)))
    }))

  test("navigation Page.goto should work when navigating to data url", ({ page }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto("data:text/html,hello", { waitUntil: "load" }))
      // Puppeteer's `data:` response is `ok()`; Strider gives a `data:` document no response
      assert.isTrue(Option.isNone(navigation.response))
    }))

  test("navigation Page.goto should work when navigating to 404", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/not-found", { waitUntil: "load" }))
      assert.isFalse(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).status, 404)
    }))

  test("navigation Page.goto should not throw an error for a 404 response with an empty body", ({ page, server }) =>
    Effect.gen(function*() {
      // Fails on Chromium: it reports the empty-body error status as `net::ERR_HTTP_RESPONSE_CODE_FAILURE`, which
      // Strider's `goto` fails with, though the document's response carried the status and the docs say a 404 commits
      server.setRoute("/404-error", (_req, res) => {
        res.statusCode = 404
        // The original's route answers after 50 ms, as this one does
        setTimeout(() => {
          res.end()
        }, 50)
      })
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/404-error", { waitUntil: "load" }))
      assert.isFalse(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).status, 404)
    }))

  test("navigation Page.goto should not throw an error for a 500 response with an empty body", ({ page, server }) =>
    Effect.gen(function*() {
      // Fails on Chromium, as the 404 case does
      server.setRoute("/500-error", (_req, res) => {
        res.statusCode = 500
        // The original's route answers after 50 ms, as this one does
        setTimeout(() => {
          res.end()
        }, 50)
      })
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/500-error", { waitUntil: "load" }))
      assert.isFalse(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).status, 500)
    }))

  test("navigation Page.goto should return last response in redirect chain", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/redirect/1.html", "/redirect/2.html")
      server.setRedirect("/redirect/2.html", "/redirect/3.html")
      server.setRedirect("/redirect/3.html", server.EMPTY_PAGE)
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/redirect/1.html", { waitUntil: "load" }))
      assert.isTrue(ok(responseOf(navigation)))
      assert.strictEqual(responseOf(navigation).url, server.EMPTY_PAGE)
    }))

  // "should wait for network idle to succeed navigation" waits with `networkidle0` (ledger: navigation-networkidle).

  test("navigation Page.goto should not leak listeners during navigation", ({ page, server }) =>
    Effect.gen(function*() {
      const warnings = yield* warningsDuring(
        Effect.gen(function*() {
          for (let i = 0; i < 20; ++i) {
            yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          }
        })
      )
      assert.isEmpty(warnings)
    }))

  test("navigation Page.goto should not leak listeners during bad navigation", ({ page }) =>
    Effect.gen(function*() {
      const warnings = yield* warningsDuring(
        Effect.gen(function*() {
          for (let i = 0; i < 20; ++i) {
            // The original swallows each navigation error
            yield* page.goto("asdf").pipe(Effect.ignore)
          }
        })
      )
      assert.isEmpty(warnings)
    }))

  test("navigation Page.goto should not leak listeners during navigation of 11 pages", ({ page, server }) =>
    Effect.gen(function*() {
      // The original opens 20 pages at once in the test's context, as this does, and closes each after its navigation
      const warnings = yield* warningsDuring(
        Effect.forEach(
          Array.from({ length: 20 }),
          () =>
            Effect.scoped(
              Effect.gen(function*() {
                const newPage = yield* page.context.newPage
                yield* newPage.goto(server.EMPTY_PAGE, { waitUntil: "load" })
                yield* newPage.close()
              })
            ),
          { concurrency: "unbounded", discard: true }
        )
      )
      assert.isEmpty(warnings)
    }))

  test("navigation Page.goto should navigate to dataURL and fire dataURL requests", ({ page }) =>
    Effect.gen(function*() {
      const dataURL = "data:text/html,<div>yo</div>"
      const navigation = committedOf(yield* page.goto(dataURL, { waitUntil: "load" }))
      // A data: document has no response in Strider (see "should work when navigating to data url"), where the original's
      // has status 200
      assert.isTrue(Option.isNone(navigation.response))
      const requests = (yield* requestsOf(page)).filter((request) => !isFavicon(request))
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]!.url, dataURL)
    }))

  test("navigation Page.goto should navigate to URL with hash and fire requests without hash", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.EMPTY_PAGE + "#hash", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
      // Puppeteer's `response.url()` is the request's URL with its fragment. A `NetworkResponse`'s URL is the HTTP
      // one, with none; the URL the navigation went to is where the fragment is kept
      assert.strictEqual(navigation.url, server.EMPTY_PAGE + "#hash")
      const requests = (yield* requestsOf(page)).filter((request) => !isFavicon(request))
      assert.strictEqual(requests.length, 1)
      // Puppeteer's `request.url()` appends the fragment CDP reports apart; a `NetworkRequest`'s URL is the one sent,
      // which the test's title says has none
      assert.strictEqual(requests[0]!.url, server.EMPTY_PAGE)
    }))

  test("navigation Page.goto should work with self requesting page", ({ page, server }) =>
    Effect.gen(function*() {
      const navigation = committedOf(yield* page.goto(server.PREFIX + "/self-request.html", { waitUntil: "load" }))
      assert.strictEqual(responseOf(navigation).status, 200)
      assert.include(responseOf(navigation).url, "self-request.html")
    }))

  test("navigation Page.goto should fail when navigating and show the url at the error message", ({ page, server }) =>
    Effect.gen(function*() {
      const url = server.https.PREFIX + "/redirect/1.html"
      const error = yield* failureOf(page.goto(url, { waitUntil: "load" }), "the goto")
      assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
      assert.include(error.message, url)
    }))

  // "should send referer" and "should send referer policy" pass a `referer` and a `referrerPolicy` to `goto`, which
  // Strider's `goto` doesn't take (ledger: option-page-goto-referer).

  test("navigation Page.waitForNavigation should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Subscribed before the navigation starts, as the original's `waitForNavigation` is
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.evaluateInMainWorld((url: string) => {
        window.location.href = url
      }, server.PREFIX + "/grid.html")
      const navigation = committedOf(yield* navigated)
      assert.isTrue(ok(responseOf(navigation)))
      assert.include(responseOf(navigation).url, "grid.html")
    }))

  test("navigation Page.waitForNavigation should work with both domcontentloaded and load", ({ page, server }) =>
    Effect.gen(function*() {
      // The stylesheet's response is held until the test ends it, so `load` waits for it
      const held: { response?: http.ServerResponse } = {}
      server.setRoute("/one-style.css", (_req, res) => {
        held.response = res
      })
      const stylesheet = yield* server.waitForRequest("/one-style.css")
      // The original's `goto` waits for `load` by default, so the port passes it too
      const navigation = yield* Effect.forkChild(
        page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" }),
        { startImmediately: true }
      )
      const domContentLoaded = yield* PageNavigation.next(page, { waitUntil: "domContentLoaded" })
      const loaded = yield* startWaiting(yield* PageNavigation.next(page, { waitUntil: "load" }))
      yield* waiting("the domcontentloaded navigation", domContentLoaded)
      assert.isFalse(yield* loaded.done)
      yield* waiting("the request for /one-style.css", stylesheet)
      assert(held.response !== undefined, "the stylesheet request arrived without its response")
      held.response.end()
      yield* waiting("the load navigation", Fiber.join(loaded.fiber))
      yield* waiting("the goto", Fiber.join(navigation))
    }))

  test("navigation Page.waitForNavigation should work with clicking on anchor links", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href="#foobar">foobar</a>`)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.locator("a").click()
      sameDocumentOf(yield* navigated, "fragment")
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#foobar")
    }))

  test("navigation Page.waitForNavigation should work with history.pushState()", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
        <a onclick="javascript:pushState()">SPA</a>
        <script>
          function pushState() {
            history.pushState({}, '', 'wow.html');
          }
        </script>
      `)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.locator("a").click()
      sameDocumentOf(yield* navigated, "historyApi")
      assert.strictEqual(yield* page.url, server.PREFIX + "/wow.html")
    }))

  test("navigation Page.waitForNavigation should work with history.replaceState()", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
        <a onclick="javascript:replaceState()">SPA</a>
        <script>
          function replaceState() {
            history.replaceState({}, '', '/replaced.html');
          }
        </script>
      `)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.locator("a").click()
      sameDocumentOf(yield* navigated, "historyApi")
      assert.strictEqual(yield* page.url, server.PREFIX + "/replaced.html")
    }))

  test("navigation Page.waitForNavigation should work with DOM history.back()/history.forward()", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
        <a
          id="back"
          onclick="javascript:goBack()"
          >back</a
        >
        <a
          id="forward"
          onclick="javascript:goForward()"
          >forward</a
        >
        <script>
          function goBack() {
            history.back();
          }
          function goForward() {
            history.forward();
          }
          history.pushState({}, '', '/first.html');
          history.pushState({}, '', '/second.html');
        </script>
      `)
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")
      const back = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.locator("a#back").click()
      traversedOf(Option.some(yield* back))
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")
      const forward = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.locator("a#forward").click()
      traversedOf(Option.some(yield* forward))
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")
    }))

  test("navigation Page.waitForNavigation should work when subframe issues window.stop()", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frames/style.css", () => {})
      const navigation = yield* Effect.forkChild(
        page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" }),
        { startImmediately: true }
      )
      // The original waits for `frameattached`; Strider has no frame events, so the wait is for the frame in the tree
      yield* Expect.that(
        page.frames,
        Condition.make("has a child frame", (tree) => tree.children.length > 0)
      )
      // The original's `frame.evaluate` runs in the frame's main world, which the same-origin frame's window is
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")?.contentWindow?.stop()
      })
      yield* waiting("the goto", Fiber.join(navigation))
    }))

  test("navigation Page.waitForNavigation should be cancellable", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `AbortSignal` rejects the wait with `aborted`. Strider cancels a wait by interrupting it.
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      const task = yield* Effect.forkChild(navigated, { startImmediately: true })
      yield* Fiber.interrupt(task)
      const exit = yield* Fiber.await(task)
      assert.isTrue(Exit.hasInterrupts(exit), "the wait ended without being interrupted")
    }))

  test("navigation Page.goBack should work", ({ page, server }) =>
    Effect.gen(function*() {
      // The original turns the HTTP cache off first, so each traversal reaches the server. Strider has no such setting
      // (and a back-forward cache restore, a `Restored` navigation, has no response), so the port accepts either
      // outcome of a traversal and checks the document it went to
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })

      const back = yield* page.back({ waitUntil: "load" })
      assert(Option.isSome(back), "back found no history entry")
      assertDocumentOf(back.value, server.EMPTY_PAGE)

      const forward = yield* page.forward({ waitUntil: "load" })
      assert(Option.isSome(forward), "forward found no history entry")
      assertDocumentOf(forward.value, server.PREFIX + "/grid.html")
    }))

  test("navigation Page.goBack should error if no history is found", ({ page }) =>
    Effect.gen(function*() {
      // Strider's `back` gives `None` where there is no entry, a typed result in place of the original's error
      const back = yield* page.back()
      assert.isTrue(Option.isNone(back))
    }))

  test("navigation Page.goBack should work with HistoryAPI", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/first.html")
        history.pushState({}, "", "/second.html")
      })
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")

      traversedOf(yield* page.back())
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")
      traversedOf(yield* page.back())
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
      traversedOf(yield* page.forward())
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")
    }))

  // The `Frame.goto` tests navigate a frame with `frame.goto`, which Strider has no counterpart of (ledger:
  // method-frame-goto).

  test("navigation Frame.waitForNavigation should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      const frame = yield* firstChildFrame(page)
      // The frame's navigations, subscribed before the navigation starts
      const navigated = yield* PageNavigation.next(
        page,
        { frames: "all", waitUntil: "load" },
        (navigation) => Effect.succeed(navigation.frame === frame.id)
      )
      yield* page.evaluateInMainWorld((url: string) => {
        const frameWindow = document.querySelector("iframe")?.contentWindow
        if (frameWindow) frameWindow.location.href = url
      }, server.PREFIX + "/grid.html")
      const navigation = committedOf(yield* navigated)
      assert.isTrue(ok(responseOf(navigation)))
      assert.include(responseOf(navigation).url, "grid.html")
      assert.strictEqual(navigation.frame, frame.id)
      assert.include(yield* page.url, "/frames/one-frame.html")
    }))

  test("navigation Frame.waitForNavigation should fail when frame detaches", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      const frame = yield* firstChildFrame(page)
      server.setRoute("/empty.html", () => {})
      const navigated = yield* PageNavigation.next(
        page,
        { frames: "all", waitUntil: "load" },
        (navigation) => Effect.succeed(navigation.frame === frame.id)
      )
      // The original's wait is started now, and its error is read after the frame is removed. Strider's wait doesn't
      // end when its frame detaches, so the port's own bound (15 seconds) ends the test
      const outcome = yield* startWaiting(navigated)
      const hangRequested = yield* server.waitForRequest("/empty.html")
      yield* page.evaluateInMainWorld(() => {
        const frameWindow = document.querySelector("iframe")?.contentWindow
        if (frameWindow) frameWindow.location.href = "/empty.html"
      })
      yield* waiting("the request for /empty.html", hangRequested)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")?.remove()
      })
      const result = yield* waiting("the wait to end", Effect.result(Fiber.join(outcome.fiber)), "15 seconds")
      assert(Result.isFailure(result), "the wait succeeded, where the original's rejects")
      const error = result.failure
      assert(Target.isTargetGone(error), `expected TargetGone, got ${String(error)}`)
      assert.strictEqual(error.reason._tag, "FrameDetached")
    }))

  test("navigation Page.reload should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => Reflect.set(globalThis, "_foo", 10))
      yield* page.reload({ waitUntil: "load" })
      assert.isUndefined(yield* page.evaluateInMainWorld(() => Reflect.get(globalThis, "_foo")))
    }))

  // "with network events disabled should work" is ledgered (notApplicable): Puppeteer's `networkEnabled` is a BiDi
  // connector setting, and the test expects a `goto` with no response.
})
