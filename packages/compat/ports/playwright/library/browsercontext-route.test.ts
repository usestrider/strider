/**
 * Playwright's `tests/library/browsercontext-route.spec.ts`: routes a context declares, which intercept the requests of
 * every page and worker in it, and how they meet a page's own routes: which is asked first, falling through to the next
 * route, fallback chains, removing a route, and the cookies and bodies a route's response carries.
 *
 * What the port changes:
 * - The original's `browser.newContext()` and `context.newPage()` are the harness's page and its context, `page.context`,
 *   fresh for each test. RO-172 names its own context, as CO-041 does, because it needs one that accepts the TLS server's
 *   certificate.
 * - `context.route(…)` is `page.context.route(…)`, and its registration lasts as long as the test. Removing one is
 *   `registration.remove`, as `unroute` removes by registration, not by pattern.
 * - A handler is an Effect that returns one decision: `route.continue()` is `Route.continue`, `route.fulfill(…)` is
 *   `Route.fulfill(HttpServerResponse…)`, `route.fallback()` is `Route.fallthrough`, `route.abort()` is `Route.abort()`, and
 *   `route.continue({ postData: "" })` is `Route.continueWith(withPostData(…))`, as page-request-continue's port does.
 * - A handler that asserts inside the original's listener records what it saw, and the test body asserts on the record
 *   (RO-165), where a failure fails the test: a Strider handler's failure is logged and the default continues.
 * - A handler the original never calls, or leaves undecided (RO-179, RO-180), returns a decision that continues, and the
 *   test checks that it is never reached, which is what the original's `failed` flag checks.
 * - `route.request()` is the handler's `request`, the one request the route was given.
 * - The original's `response.text()` and `response.body()` on a navigation's response are `NetworkResponse.next` with a
 *   `body` decoder, listened for before the navigation that makes the response, since Strider's navigation result has no
 *   body to read.
 * - `page.waitForResponse` (RO-183) is `NetworkResponse.next`, and the original's `page.evaluate` is
 *   `page.evaluateInMainWorld`. RO-183's `it.step` is not ported: each iteration is the loop's body.
 * - The cookies a context lists are `cookies.list`, read in the original's shape by `asPlaywright`. The original's
 *   `defaultSameSiteCookieValue` is `Lax` on Chromium, because Playwright reports a cookie whose `Set-Cookie` names no
 *   SameSite as `Lax`. Strider reports what the browser stored, which is no `sameSite` (the cookie "didn't say", as the
 *   API states), so RO-169 and RO-171 expect `undefined` there.
 * - RO-166's `RegExp` pattern has no Strider form (see page-route's RO-002), so it's the glob that matches the same
 *   requests here. RO-166 is ported on that basis, and its unroute removes by registration.
 * - RO-182's 100 ms waits, which the original makes itself, are ported as written, with a comment where they happen.
 * - RO-170 is `it.fixme` for WebKit off Mac; it's ported on every browser, as upstream's own skips aren't ours.
 * - RO-172 is ported for Firefox and stock WebKit only: Chromium refuses `acceptInsecureCerts`, so the ledger marks it there.
 * - RO-184's `route.fetch()` then `route.fulfill({ response, body })` is a response-phase route that fulfills the popup's
 *   own paused response with the body, as page-request-fulfill's RO-110 does; it runs on Chromium only (the ledger marks
 *   the others). The popup is `Popup.next` on the opener, listened for before the click.
 * - Not ported, in the ledger: RO-173 to RO-175 (`times`), RO-178 (a fallback with a new URL), RO-185 (URLPattern's
 *   `ignoreCase`).
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  CookieJar,
  Expect,
  NetworkRequest,
  NetworkResponse,
  type Page,
  PageNavigation,
  Popup,
  Route
} from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { HttpBody, HttpClientRequest, HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type * as http from "node:http"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `server.HOSTNAME`: the host of `server.PREFIX`. */
const HOSTNAME = "localhost"

/**
 * A cookie in the original's shape, as the cookie-jar port reads it: `expires` is -1 for a session cookie, and `value` is
 * the plain string. `sameSite` is Strider's word for it.
 */
interface PlaywrightCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly expires: number
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: "lax" | "strict" | "none" | undefined
}

const asPlaywright = (cookie: CookieJar.Cookie): PlaywrightCookie => ({
  name: cookie.name,
  value: Redacted.value(cookie.value),
  domain: cookie.domain,
  path: cookie.path,
  expires: Option.match(cookie.expires, {
    onNone: () => -1,
    onSome: (when) => DateTime.toEpochMillis(when) / 1000
  }),
  httpOnly: cookie.httpOnly,
  secure: cookie.secure,
  sameSite: Option.getOrUndefined(cookie.sameSite)
})

/** The response a navigation carried, when it had one: a navigation to a `data:` URL has none. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

const statusOf = (navigation: PageNavigation.PageNavigation): number | undefined =>
  Option.getOrUndefined(Option.map(responseOf(navigation), (response) => response.status))

const isOk = (navigation: PageNavigation.PageNavigation): boolean => {
  const status = statusOf(navigation)
  return status !== undefined && status >= 200 && status <= 299
}

/** A navigation request, which is a document's request for its own navigation. */
const isNavigation = (request: NetworkRequest.NetworkRequest): boolean =>
  request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)

/**
 * Playwright's `postData` override: the body replaced with `bytes`, with no content type of its own, so the request keeps
 * the one it has.
 */
const withPostData = (bytes: Uint8Array) => (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientRequest.setBody(HttpBody.raw(bytes, { contentType: request.headers["content-type"] }))(request)

/**
 * The body of the next response to `url`, read as text as Playwright's `response.text()` reads it. Listen before the
 * navigation or request that makes the response.
 */
const nextText = (page: Page.Page, url: string) => NetworkResponse.next(page, { url, body: (message) => message.text })

/**
 * A handler that records its number and passes the request on, as the original's `route.fallback()` does. The
 * number is the order in which the routes are asked.
 */
const passing = (intercepted: Array<number>, n: number) => () =>
  Effect.sync(() => {
    intercepted.push(n)
  }).pipe(Effect.andThen(Route.fallthrough))

upstream(import.meta.filename, {}, (test) => {
  test("RO-165", ({ page, server }) =>
    Effect.gen(function*() {
      // Each request's details are read in the handler, where the page's frame tree is current
      const seen: Array<{ request: NetworkRequest.NetworkRequest; body: Option.Option<Uint8Array>; frameUrl: string }> =
        []
      const main = yield* page.frames
      yield* page.context.route("**/empty.html", ({ request, requestBody }) =>
        Effect.gen(function*() {
          const body = yield* requestBody
          seen.push({ request, body, frameUrl: (yield* page.frames).url })
          return yield* Route.continue
        }))
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(isOk(navigation))
      const [first] = seen
      assert.isDefined(first)
      const { request, body, frameUrl } = first
      assert.include(request.url, "empty.html")
      assert.isTrue(Boolean(request.headers["user-agent"]))
      assert.strictEqual(request.method, "GET")
      assert.isTrue(Option.isNone(body))
      assert.isTrue(isNavigation(request))
      assert.strictEqual(request.resourceType, "document")
      // `request.frame() === page.mainFrame()`: the request's document is the page's main frame
      assert.strictEqual(request.initiator._tag === "Document" && request.initiator.navigable, main.id)
      assert.strictEqual(frameUrl, "about:blank")
    }))

  test("RO-166", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      const intercepted: Array<number> = []
      yield* context.route("**/*", passing(intercepted, 1))
      const second = yield* context.route("**/empty.html", passing(intercepted, 2))
      const third = yield* context.route("**/empty.html", passing(intercepted, 3))
      // Playwright's `/empty.html/` regular expression, as the glob that matches the same requests (see page-route's RO-002)
      const fourth = yield* context.route("**/empty.html", passing(intercepted, 4))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [4, 3, 2, 1])

      intercepted.length = 0
      yield* fourth.remove
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [3, 2, 1])

      intercepted.length = 0
      // `unroute("**/empty.html")` removes every route with that pattern; Strider removes each by its registration
      yield* second.remove
      yield* third.remove
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [1])
    }))

  test("RO-167", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**/empty.html", () => Route.fulfill(HttpServerResponse.text("context")))
      yield* page.route("**/empty.html", () => Route.fulfill(HttpServerResponse.text("page")))
      const text = yield* nextText(page, server.EMPTY_PAGE)
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(isOk(navigation))
      assert.strictEqual((yield* text).body, "page")
    }))

  test("RO-168", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**/empty.html", () => Route.fulfill(HttpServerResponse.text("context")))
      yield* page.route("**/non-empty.html", () => Route.fulfill(HttpServerResponse.text("page")))
      const text = yield* nextText(page, server.EMPTY_PAGE)
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(isOk(navigation))
      assert.strictEqual((yield* text).body, "context")
    }))

  test("RO-169", ({ page }) =>
    Effect.gen(function*() {
      yield* page.route("https://example.com/", () =>
        Route.fulfill(HttpServerResponse.text("done", {
          contentType: "text/html",
          headers: { "Set-Cookie": "name=value; domain=.example.com; Path=/" }
        })))
      yield* page.goto("https://example.com/", { waitUntil: "load" })
      assert.deepStrictEqual((yield* page.context.cookies.list).map(asPlaywright), [{
        // The cookie names no SameSite, and Strider reports none (Playwright reports Chromium's default, `Lax`)
        sameSite: undefined,
        name: "name",
        value: "value",
        domain: ".example.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false
      }])
    }))

  // Playwright's `it.fixme` for WebKit off Mac is ported as written, on every browser
  test("RO-170", ({ page }) =>
    Effect.gen(function*() {
      yield* page.route("http://example.com/", () =>
        Route.fulfill(HttpServerResponse.text("done", {
          contentType: "text/html",
          headers: { "Set-Cookie": "name=value; domain=.example.com; Path=/; Secure" }
        })))
      yield* page.goto("http://example.com/", { waitUntil: "load" })
      assert.deepStrictEqual((yield* page.context.cookies.list).map(asPlaywright), [])
    }))

  test("RO-171", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route(server.EMPTY_PAGE, () =>
        Route.fulfill(HttpServerResponse.text("done", {
          contentType: "text/html",
          headers: { "Set-Cookie": "name=value" }
        })))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual((yield* page.context.cookies.list).map(asPlaywright), [{
        // The cookie names no SameSite, and Strider reports none (Playwright reports Chromium's default, `Lax`)
        sameSite: undefined,
        name: "name",
        value: "value",
        domain: HOSTNAME,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false
      }])

      let cookie = ""
      server.setRoute("/foo.html", (req, res) => {
        cookie = req.headers.cookie ?? ""
        res.end()
      })
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      assert.strictEqual(cookie, "name=value")
    }))

  // Chromium refuses `acceptInsecureCerts`, so the context that accepts the TLS server's certificate exists on the
  // other two browsers only (the ledger marks it on Chromium)
  test(
    "RO-172",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        yield* page.route("**/*", () => Route.continue)
        const navigation = yield* page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" })
        assert.strictEqual(statusOf(navigation), 200)
      }))
  )

  test("RO-176", ({ page, server }) =>
    Effect.gen(function*() {
      // The route overwrites the post body with the empty string, so the server receives none
      yield* page.context.route("**/empty.html", () => Route.continueWith(withPostData(new Uint8Array())))
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.setContent(`
      <script>
        (async () => {
            await fetch('${server.EMPTY_PAGE}', {
              method: 'POST',
              body: 'original',
            });
        })()
      </script>
    `)
      const request = yield* received
      assert.strictEqual(request.body.toString(), "")
    }))

  test("RO-177", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<number> = []
      yield* page.context.route("**/empty.html", passing(intercepted, 1))
      yield* page.context.route("**/empty.html", passing(intercepted, 2))
      yield* page.context.route("**/empty.html", passing(intercepted, 3))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [3, 2, 1])
    }))

  test("RO-179", ({ page, server }) =>
    Effect.gen(function*() {
      // The first route is never reached, so its handler continues and the test checks it wasn't called
      let failed = false
      yield* page.context.route("**/empty.html", () =>
        Effect.sync(() => {
          failed = true
        }).pipe(Effect.andThen(Route.continue)))
      yield* page.context.route("**/empty.html", () => Route.fulfill(HttpServerResponse.text("fulfilled")))
      yield* page.context.route("**/empty.html", () => Route.fallthrough)
      const text = yield* nextText(page, server.EMPTY_PAGE)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual((yield* text).body, "fulfilled")
      assert.isFalse(failed)
    }))

  test("RO-180", ({ page, server }) =>
    Effect.gen(function*() {
      // The first route is never reached, as in RO-179
      let failed = false
      yield* page.context.route("**/empty.html", () =>
        Effect.sync(() => {
          failed = true
        }).pipe(Effect.andThen(Route.continue)))
      yield* page.context.route("**/empty.html", () => Route.abort())
      yield* page.context.route("**/empty.html", () => Route.fallthrough)
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE), "the navigation")
      assert.isDefined(error)
      assert.isFalse(failed)
    }))

  test("RO-181", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<number> = []
      yield* page.context.route("**/empty.html", passing(intercepted, 1))
      yield* page.context.route("**/empty.html", passing(intercepted, 2))
      yield* page.context.route("**/empty.html", passing(intercepted, 3))
      yield* page.route("**/empty.html", passing(intercepted, 4))
      yield* page.route("**/empty.html", passing(intercepted, 5))
      yield* page.route("**/empty.html", passing(intercepted, 6))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [6, 5, 4, 3, 2, 1])
    }))

  test("RO-182", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<number> = []
      // Each handler waits 100 ms before it passes the request on, as the original's `setTimeout` does
      const passingAfterWait = (n: number) => () =>
        Effect.sync(() => {
          intercepted.push(n)
        }).pipe(Effect.andThen(Effect.sleep("100 millis")), Effect.andThen(Route.fallthrough))
      yield* page.context.route("**/empty.html", passingAfterWait(1))
      yield* page.context.route("**/empty.html", passingAfterWait(2))
      yield* page.context.route("**/empty.html", passingAfterWait(3))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [3, 2, 1])
    }))

  test("RO-183", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**/api*", () => Route.continue)
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      const requests: Array<http.IncomingMessage> = []
      server.setRoute("/api", (req, res) => {
        requests.push(req)
        res.statusCode = 200
        res.setHeader("content-type", "text/plain")
        res.setHeader("cache-control", "public, max-age=31536000")
        res.end("Hello")
      })
      // Playwright's `it.step` per iteration: each iteration is the loop's body
      for (let i = 0; i < 3; i++) {
        const received = yield* NetworkResponse.next(page, { url: "**/api" })
        yield* page.evaluateInMainWorld(async () => {
          const response = await fetch("/api")
          return response.status
        })
        const response = yield* received
        assert.strictEqual(response.status, 200)
        assert.strictEqual(requests.length, i + 1)
      }
    }))

  test("RO-184", { browsers: ["chromium"] }, ({ page, server }) =>
    Effect.gen(function*() {
      // The original fetches the request again and fulfills with that response and its own body. Strider's response phase
      // fulfills the paused response with the body; the length is the body's, so the server's is left out.
      yield* page.context.route("**/*", ({ response }) => {
        const { "content-length": _length, ...headers } = response.headers
        return Route.fulfill(HttpServerResponse.text("hello", { status: response.status, headers }))
      }, { phase: "response" })
      yield* page.setContent(`<a target=_blank href="${server.EMPTY_PAGE}">click me</a>`)
      const opened = yield* Popup.next(page)
      yield* page.getByText("click me").click()
      const popup = yield* opened
      yield* Expect.toHaveText(popup.locator("body"), "hello")
    }))
})
