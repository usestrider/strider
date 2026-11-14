/**
 * Playwright's `tests/library/browsercontext-credentials.spec.ts`: HTTP authentication, the credentials a context gives
 * a page for a server's `401` challenge, by origin, and what the page's own `Authorization` header does.
 *
 * What the port changes:
 * - Playwright's `browser.newContext` and `context.close()` are `Browser.newContext` in a scope, which each test runs
 *   in: the contexts the original closes end their scopes.
 * - A context's `httpCredentials` takes one pair, optionally for one origin (the decision on context HTTP
 *   credentials), and auth routes select pairs for other origins. Where an array's point is the credentials each origin
 *   gets, the port writes it that way: AU-003 is two auth routes, AU-007 is its one pair, AU-008 is the pair for the
 *   first origin and an auth route for the second, and AU-009 is the origin-less pair and an auth route for the second
 *   origin, which runs before the configured pair. AU-010 tests which entry of an ordered array wins, which Strider has
 *   no array for, so it is `differentByDesign`.
 * - `page.goto` and `page.reload` resolve at commit, and the original's `status()` is the navigation's response status:
 *   `statusOf` reads it, and each navigation names `waitUntil: "load"` where Playwright waits for `load`.
 * - Chromium's `failsOn401`. Playwright's Chromium with a full browser fails a navigation to a `401` with
 *   `net::ERR_INVALID_AUTH_CREDENTIALS`, and its headless shell commits it. Strider's Chromium commits a document at the
 *   server's `401` (the `Route.provideCredentials` gotchas, `network.challenges`), so the port asserts the `401` in every
 *   branch the original has, and not the error.
 * - `setHTTPCredentials` (AU-002) is a context `auth` route that answers with `Route.provideCredentials`, registered
 *   after the first navigation, as the matrix row for `setHTTPCredentials` describes. It applies to any URL, as the
 *   original's does without an origin, and stays until the test's scope ends.
 * - AU-006 reads the response body, which Strider collects through `NetworkResponse.next` with a body decoder, subscribed
 *   before the navigation as the original's listener is.
 * - AU-016's `fetch` with the page's own `Authorization` header runs in the main world, through
 *   `page.evaluateInMainWorld`, as Playwright's `page.evaluate` does.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkResponse, PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { upstream } from "../../harness/upstream.ts"

/** The status of a navigation's response, which Playwright's `response.status()` reads. */
const statusOf = (navigation: PageNavigation.PageNavigation): number | undefined =>
  navigation._tag === "Committed" || navigation._tag === "NoContent"
    ? Option.getOrUndefined(Option.map(navigation.response, (response) => response.status))
    : undefined

/** One `httpCredentials` pair, with the origin the original gives it, if any. */
const pair = (username: string, password: string, origin?: string) => ({
  username,
  password: Redacted.make(password),
  origin
})

upstream(import.meta.filename, {}, (test) => {
  test("AU-001", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      // A challenge no route answers gets the server's 401, which the navigation commits with
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 401)
    })))

  test("AU-002", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 401)
      // `setHTTPCredentials`: an auth route answers the next challenge with the pair
      yield* context.route(
        "**",
        () => Route.provideCredentials({ username: "user", password: Redacted.make("pass") }),
        { phase: "auth" }
      )
      assert.strictEqual(statusOf(yield* page.reload({ waitUntil: "load" })), 200)
    })))

  test("AU-003", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user1", "pass1")
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      // `setHTTPCredentials` with two origins is two auth routes
      yield* context.route(
        server.PREFIX + "/**",
        () => Route.provideCredentials({ username: "user1", password: Redacted.make("pass1") }),
        { phase: "auth" }
      )
      yield* context.route(
        server.CROSS_PROCESS_PREFIX + "/**",
        () => Route.provideCredentials({ username: "user2", password: Redacted.make("pass2") }),
        { phase: "auth" }
      )
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
      // Wrong credentials are picked for the other origin.
      assert.strictEqual(
        statusOf(yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })),
        401
      )
    })))

  test("AU-004", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass") })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
    })))

  test("AU-005", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const context = yield* Browser.newContext({ httpCredentials: pair("foo", "bar") })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 401)
    })))

  test("AU-006", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/playground.html", "user", "pass")
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass") })
      const page = yield* context.newPage
      // The original reads the body from the response, so the subscription is in place before the navigation
      const body = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/playground.html",
        body: (message) => message.text
      })
      const navigation = yield* page.goto(server.PREFIX + "/playground.html", { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(yield* page.title, "Playground")
      assert.include((yield* body).body, "Playground")
    })))

  test("AU-007", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      // The original's array holds one pair
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass") })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
    })))

  test("AU-008", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user1", "pass1")
      // The pair for the first origin is the context's, and the second origin's is an auth route
      const context = yield* Browser.newContext({ httpCredentials: pair("user1", "pass1", server.PREFIX) })
      yield* context.route(
        server.CROSS_PROCESS_PREFIX + "/**",
        () => Route.provideCredentials({ username: "user2", password: Redacted.make("pass2") }),
        { phase: "auth" }
      )
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
      // Wrong credentials are picked for the other origin.
      assert.strictEqual(
        statusOf(yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })),
        401
      )
    })))

  test("AU-009", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      // The pair without an origin is the context's; the second origin's own credentials are an auth route
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass") })
      yield* context.route(
        server.CROSS_PROCESS_PREFIX + "/**",
        () => Route.provideCredentials({ username: "user2", password: Redacted.make("pass2") }),
        { phase: "auth" }
      )
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
      // The origin's own credentials are used, not the fallback, so they are wrong for this server.
      assert.strictEqual(
        statusOf(yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })),
        401
      )
    })))

  test("AU-011", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass", server.PREFIX) })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
    })))

  test("AU-012", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      // The origin is upper case; its scheme, host, and port are the same
      const context = yield* Browser.newContext({
        httpCredentials: pair("user", "pass", server.PREFIX.toUpperCase())
      })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
    })))

  test("AU-013", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      // The origin's scheme is https, so the http page gets no credentials
      const context = yield* Browser.newContext({
        httpCredentials: pair("user", "pass", server.PREFIX.replace("http://", "https://"))
      })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 401)
    })))

  test("AU-014", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const hostname = new URL(server.PREFIX).hostname
      const origin = server.PREFIX.replace(hostname, "mismatching-hostname")
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass", origin) })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 401)
    })))

  test("AU-015", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      const origin = server.PREFIX.replace(server.PORT.toString(), (server.PORT + 1).toString())
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass", origin) })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 401)
    })))

  test("AU-016", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setAuth("/empty.html", "user", "pass")
      server.setRoute("/echo-auth", (request, response) => {
        response.end(request.headers["authorization"] || "<none>")
      })
      const context = yield* Browser.newContext({ httpCredentials: pair("user", "pass") })
      const page = yield* context.newPage
      assert.strictEqual(statusOf(yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), 200)
      // The page's own header is sent, not the context's credentials
      const received = yield* page.evaluateInMainWorld(async () => {
        const response = await fetch("/echo-auth", { headers: { "Authorization": "Bearer my-own-app-token" } })
        return await response.text()
      })
      assert.strictEqual(received, "Bearer my-own-app-token")
    })))
})
