/**
 * Playwright's `tests/library/browsercontext-add-cookies.spec.ts`: cookies a context is given and read back, in the page
 * through `document.cookie` and through the context's own list, with their attributes.
 *
 * What the port changes:
 * - `context.addCookies([…])` is one `context.cookies.set` per cookie, and `context.cookies()` is `cookies.list`,
 *   `context.cookies(url)` is `cookies.listFor(url)`, and `context.clearCookies()` is `cookies.clear`. Strider's `set` acts
 *   once and isn't validated as a batch, so where the original rejects a whole batch (CO-034, CO-035), the first cookie
 *   of the batch is set and the second fails.
 * - Strider's cookie has a `Redacted` value, `expires` as an `Option` (None for a session cookie, where the original
 *   reads -1), and `sameSite` as an `Option` of lowercase words. `asPlaywright` reads a cookie in the original's shape,
 *   so the expectations are the original's, and only the sameSite words are Strider's.
 * - Strider's `set` writes `sameSite` when the caller doesn't give one, as `lax`, the value its API states (`@default
 *   "lax"`). The original's `defaultSameSiteCookieValue` is the browser's default, which is `Lax` on Chromium and
 *   differs elsewhere, so CO-022 and CO-032 assert Strider's `lax`. They can't check that an unset SameSite is left to
 *   the browser, because Strider's `set` has no way to leave it unset.
 * - CO-023 re-adds the cookies it read. The page set the cookie without SameSite, which Strider reads as no `sameSite`
 *   (`None` option), and `set` of that gives `lax`, so the round trip changes `sameSite` and the test fails there.
 * - `server.HOSTNAME` is `localhost`, the host of `server.PREFIX`.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. The original's `page.evaluate` of a
 *   string (`'document.cookie'`) is the same read as a function. A frame's `document.cookie` (CO-039) is read through the
 *   same-origin iframe's `contentDocument`, from the page's main world.
 * - `page.goto` waits for `load` by default and Strider's waits for `commit`, so each `goto` here names `waitUntil: "load"`.
 * - Route `fulfill` is `Route.fulfill(HttpServerResponse.html(…))`.
 * - `context.newPage()` is `context.newPage`, and `browser.newContext()` is `Browser.newContext()`, scoped so each
 *   context closes when its block ends, as the original's `close()` does.
 * - `expect.soft` (CO-040) is an ordinary assertion here: a failed one ends the test, where the original's soft checks
 *   let the rest run.
 * - CO-029's `browserType.launch()` is the harness's `backend` layer, launched twice in turn. Its `it.slow()` is not
 *   ported, so the test keeps Playwright's 30 seconds.
 * - CO-036 and CO-038 expect Secure on a cookie for an https URL, which Playwright sets from the scheme and Strider
 *   doesn't (its `secure` is false unless the caller asks). They are ported with the original's expectation, unchanged,
 *   and fail there.
 * - CO-041 is ported for Firefox and stock WebKit only: Chromium refuses `acceptInsecureCerts`, so the ledger marks it
 *   there.
 * - CO-034 and CO-035 assert a `CookieJarError` with the reason `InvalidInput`, not the original's message. Strider
 *   doesn't check the scope URL of `about:blank` or a `data:` URL: the browser refuses it and the failure arrives as
 *   `BackendFailure`, so both fail on the reason.
 * - CO-040 fails at its first step: Strider's `set` refuses an empty name as `InvalidInput`, where the browsers keep
 *   an unnamed cookie.
 */
import { assert } from "@effect/vitest"
import { Browser, CookieJar, NetworkResponse, Route, type UserContext } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { backend } from "../../harness/browsers.ts"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `server.HOSTNAME`: the host of `server.PREFIX`. */
const HOSTNAME = "localhost"

/**
 * A cookie in the original's shape: `expires` is -1 for a session cookie, as Playwright reports it, and `value` is the
 * plain string. `sameSite` is Strider's word for it.
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

const byName = (a: { readonly name: string }, b: { readonly name: string }) => a.name.localeCompare(b.name)

/**
 * Playwright's `addCookies(cookies)` for cookies read from the jar: each is set again with the attributes it was read
 * with, which Strider's `set` takes as they are.
 */
const readd = (context: UserContext.UserContext, cookies: ReadonlyArray<CookieJar.Cookie>) =>
  Effect.forEach(cookies, (cookie) =>
    context.cookies.set({
      name: cookie.name,
      value: cookie.value,
      scope: { domain: cookie.domain, path: cookie.path },
      expires: Option.getOrUndefined(cookie.expires),
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: Option.getOrUndefined(cookie.sameSite),
      partitionKey: cookie.partitionKey
    }), { discard: true })

/** A new context of the test's browser, closed when the body ends. */
const withContext = <A, E, R>(body: (context: UserContext.UserContext) => Effect.Effect<A, E, R>) =>
  Effect.scoped(Browser.newContext().pipe(Effect.flatMap(body)))

upstream(import.meta.filename, {}, (test) => {
  test("CO-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.cookies.set({ name: "password", value: "123456", scope: { url: server.EMPTY_PAGE } })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "password=123456")
    }))

  test("CO-020", ({ page }) =>
    Effect.gen(function*() {
      // `expires: -1` is a session cookie, which is Strider's default when no expiry is given
      yield* page.context.cookies.set({
        name: "username",
        value: "John Doe",
        scope: { domain: "www.example.com", path: "/" },
        httpOnly: false,
        secure: false,
        sameSite: "lax"
      })
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.html("<html></html>")))
      yield* page.goto("https://www.example.com", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "username=John Doe")
    }))

  test("CO-021", ({ page }) =>
    Effect.gen(function*() {
      yield* page.context.cookies.set({
        name: "marker",
        value: "",
        scope: { domain: "www.example.com", path: "/" },
        httpOnly: false,
        secure: false,
        sameSite: "lax"
      })
      yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.html("<html></html>")))
      yield* page.goto("https://www.example.com", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "marker=")
    }))

  test("CO-022", ({ page }) =>
    Effect.gen(function*() {
      const context = page.context
      // The original's unset SameSite is the browser's default, which Strider's `set` writes as `lax`. Chromium, stock
      // WebKit on Linux, and Firefox's BiDi all drop SameSite=None without Secure, as the original's expectations do on
      // every browser Strider drives on Linux, so same-site-none is never in the list.
      yield* context.cookies.set({ name: "same-site-unset", value: "1", scope: { domain: "foo.com", path: "/" } })
      yield* context.cookies.set({
        name: "same-site-none",
        value: "1",
        scope: { domain: "foo.com", path: "/" },
        sameSite: "none"
      })
      yield* context.cookies.set({
        name: "same-site-lax",
        value: "1",
        scope: { domain: "foo.com", path: "/" },
        sameSite: "lax"
      })
      yield* context.cookies.set({
        name: "same-site-strict",
        value: "1",
        scope: { domain: "foo.com", path: "/" },
        sameSite: "strict"
      })
      const cookies = (yield* context.cookies.listFor("https://foo.com")).map(asPlaywright).sort(byName)
      assert.deepStrictEqual(cookies, [
        {
          name: "same-site-lax",
          value: "1",
          domain: "foo.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "lax"
        },
        {
          name: "same-site-strict",
          value: "1",
          domain: "foo.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "strict"
        },
        {
          name: "same-site-unset",
          value: "1",
          domain: "foo.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "lax"
        }
      ])
    }))

  test("CO-023", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // @see https://en.wikipedia.org/wiki/Year_2038_problem
      const date = +(new Date("1/1/2038"))
      const documentCookie = yield* page.evaluateInMainWorld((timestamp) => {
        const date = new Date(timestamp)
        document.cookie = `username=John Doe;expires=${date.toUTCString()}`
        return document.cookie
      }, date)
      assert.strictEqual(documentCookie, "username=John Doe")
      const cookies = yield* context.cookies.list
      yield* context.cookies.clear
      assert.deepStrictEqual(yield* context.cookies.list, [])
      yield* readd(context, cookies)
      // Slightly different rounding on chromium win.
      const normalized = (cookies: ReadonlyArray<CookieJar.Cookie>) =>
        cookies.map((cookie) => {
          const plain = asPlaywright(cookie)
          return { ...plain, expires: Math.floor(plain.expires) }
        })
      assert.deepStrictEqual(normalized(yield* context.cookies.list), normalized(cookies))
    }))

  test("CO-024", ({ page, server }) =>
    Effect.gen(function*() {
      let cookie = ""
      server.setRoute("/empty.html", (req, res) => {
        cookie = req.headers.cookie ?? ""
        res.end()
      })
      yield* page.context.cookies.set({ name: "cookie", value: "value", scope: { url: server.EMPTY_PAGE } })
      const other = yield* page.context.newPage
      yield* other.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(cookie, "cookie=value")
    }))

  test("CO-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* withContext((another) =>
        Effect.gen(function*() {
          const context = page.context
          yield* context.cookies.set({
            name: "isolatecookie",
            value: "page1value",
            scope: { url: server.EMPTY_PAGE }
          })
          yield* another.cookies.set({
            name: "isolatecookie",
            value: "page2value",
            scope: { url: server.EMPTY_PAGE }
          })
          const cookies1 = yield* context.cookies.list
          const cookies2 = yield* another.cookies.list
          assert.strictEqual(cookies1.length, 1)
          assert.strictEqual(cookies2.length, 1)
          assert.strictEqual(cookies1[0]?.name, "isolatecookie")
          assert.strictEqual(cookies1[0] && Redacted.value(cookies1[0].value), "page1value")
          assert.strictEqual(cookies2[0]?.name, "isolatecookie")
          assert.strictEqual(cookies2[0] && Redacted.value(cookies2[0].value), "page2value")
        })
      )
    }))

  test("CO-026", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      server.setRoute("/setcookie.html", (_req, res) => {
        res.setHeader("Set-Cookie", "session=value")
        res.end()
      })
      {
        const opened = yield* context.newPage
        yield* opened.goto(server.PREFIX + "/setcookie.html", { waitUntil: "load" })
      }
      {
        const opened = yield* context.newPage
        yield* opened.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        const cookies = yield* context.cookies.list
        assert.strictEqual(cookies.length, 1)
        assert.strictEqual(cookies.map((cookie) => Redacted.value(cookie.value)).join(","), "value")
      }
      yield* withContext((context2) =>
        Effect.gen(function*() {
          const opened = yield* context2.newPage
          yield* opened.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const cookies = yield* context2.cookies.list
          // The original reads `cookies[0] && cookies[0].name`: no cookie, so no name
          assert.isUndefined(cookies[0]?.name)
        })
      )
    }))

  test("CO-027", ({ page, server }) =>
    Effect.gen(function*() {
      const context1 = page.context
      server.setRoute("/setcookie.html", (_req, res) => {
        res.setHeader("Set-Cookie", "persistent=persistent-value; max-age=3600")
        res.end()
      })
      const opened = yield* context1.newPage
      yield* opened.goto(server.PREFIX + "/setcookie.html", { waitUntil: "load" })
      yield* withContext((context2) =>
        Effect.gen(function*() {
          const [page1, page2] = yield* Effect.all([context1.newPage, context2.newPage], {
            concurrency: "unbounded"
          })
          yield* Effect.all([
            page1.goto(server.EMPTY_PAGE, { waitUntil: "load" }),
            page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          ], { concurrency: "unbounded" })
          const [cookies1, cookies2] = yield* Effect.all([context1.cookies.list, context2.cookies.list], {
            concurrency: "unbounded"
          })
          assert.strictEqual(cookies1.length, 1)
          assert.strictEqual(cookies1[0]?.name, "persistent")
          assert.strictEqual(cookies1[0] && Redacted.value(cookies1[0].value), "persistent-value")
          assert.strictEqual(cookies2.length, 0)
        })
      )
    }))

  test("CO-028", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      let cookie = ""
      server.setRoute("/empty.html", (req, res) => {
        cookie = req.headers.cookie ?? ""
        res.end()
      })
      yield* context.cookies.set({ name: "sendcookie", value: "value", scope: { url: server.EMPTY_PAGE } })
      {
        const opened = yield* context.newPage
        yield* opened.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        assert.strictEqual(cookie, "sendcookie=value")
      }
      yield* withContext((context2) =>
        Effect.gen(function*() {
          const opened = yield* context2.newPage
          yield* opened.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          assert.strictEqual(cookie, "")
        })
      )
    }))

  test("CO-029", { page: false }, ({ browserName, server }) =>
    Effect.gen(function*() {
      // Playwright's `it.slow()` isn't ported: the test keeps the 30 seconds every test has here.
      // Each launch is a browser of its own, with its own profile: the first sets a cookie that lasts, then closes.
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        yield* context.cookies.set({
          name: "cookie-in-context-1",
          value: "value",
          scope: { url: server.EMPTY_PAGE },
          // Playwright's `Date.now() / 1000 + 10000` seconds from now, in Strider's milliseconds
          expires: Date.now() + 10_000_000
        })
      })).pipe(Effect.provide(backend(browserName, undefined)))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        assert.deepStrictEqual(yield* context.cookies.list, [])
      })).pipe(Effect.provide(backend(browserName, undefined)))
    }))

  test("CO-030", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* context.cookies.set({ name: "multiple-1", value: "123456", scope: { url: server.EMPTY_PAGE } })
      yield* context.cookies.set({ name: "multiple-2", value: "bar", scope: { url: server.EMPTY_PAGE } })
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => {
          const cookies = document.cookie.split(";")
          return cookies.map((cookie) => cookie.trim()).sort()
        }),
        ["multiple-1=123456", "multiple-2=bar"]
      )
    }))

  test("CO-031", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.cookies.set({ name: "expires", value: "123456", scope: { url: server.EMPTY_PAGE } })
      const [cookie] = yield* context.cookies.list
      assert.isDefined(cookie)
      // Strider's `expires` is None for a session cookie, where the original reads -1
      assert.isTrue(Option.isNone(cookie.expires))
    }))

  test("CO-032", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.cookies.set({ name: "defaults", value: "123456", scope: { url: server.EMPTY_PAGE } })
      const cookies = (yield* context.cookies.list).map(asPlaywright).sort(byName)
      // The original's `defaultSameSiteCookieValue` is `lax` here: Strider's `set` writes the `lax` its API states
      assert.deepStrictEqual(cookies, [
        {
          name: "defaults",
          value: "123456",
          domain: HOSTNAME,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "lax"
        }
      ])
    }))

  test("CO-033", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* context.cookies.set({
        name: "gridcookie",
        value: "GRID",
        scope: { domain: HOSTNAME, path: "/grid.html" },
        sameSite: "lax"
      })
      assert.deepStrictEqual((yield* context.cookies.list).map(asPlaywright), [
        {
          name: "gridcookie",
          value: "GRID",
          domain: HOSTNAME,
          path: "/grid.html",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "lax"
        }
      ])
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "gridcookie=GRID")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "")
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "gridcookie=GRID")
    }))

  test("CO-034", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      // Playwright validates the batch and sets neither cookie. Strider sets one at a time, so the first is set.
      yield* context.cookies.set({ name: "example-cookie", value: "best", scope: { url: server.EMPTY_PAGE } })
      const failure = yield* failureOf(
        context.cookies.set({ name: "example-cookie-blank", value: "best", scope: { url: "about:blank" } }),
        "the cookie for a blank page"
      )
      assert(CookieJar.isCookieJarError(failure), `expected a CookieJarError, got ${String(failure)}`)
      assert.strictEqual(failure.reason._tag, "InvalidInput")
    }))

  test("CO-035", ({ page }) =>
    Effect.gen(function*() {
      const failure = yield* failureOf(
        page.context.cookies.set({
          name: "example-cookie",
          value: "best",
          scope: { url: "data:,Hello%2C%20World!" }
        }),
        "the cookie for a data URL page"
      )
      assert(CookieJar.isCookieJarError(failure), `expected a CookieJarError, got ${String(failure)}`)
      assert.strictEqual(failure.reason._tag, "InvalidInput")
    }))

  test("CO-036", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const SECURE_URL = "https://example.com"
      yield* page.context.cookies.set({ name: "foo", value: "bar", scope: { url: SECURE_URL } })
      // The original's cookie is Secure, because its URL is https: Strider's `secure` is false unless the caller asks
      const [cookie] = yield* page.context.cookies.listFor(SECURE_URL)
      assert.isDefined(cookie)
      assert.strictEqual(cookie.secure, true)
    }))

  test("CO-037", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const HTTP_URL = "http://example.com"
      yield* context.cookies.set({ name: "foo", value: "bar", scope: { url: HTTP_URL } })
      const [cookie] = yield* context.cookies.listFor(HTTP_URL)
      assert.isDefined(cookie)
      assert.strictEqual(cookie.secure, false)
    }))

  test("CO-038", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* context.cookies.set({
        name: "example-cookie",
        value: "best",
        scope: { url: "https://www.example.com" },
        sameSite: "lax"
      })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "")
      // The original's cookie is Secure, because its URL is https: Strider's `secure` is false unless the caller asks
      assert.deepStrictEqual((yield* context.cookies.listFor("https://www.example.com")).map(asPlaywright), [
        {
          name: "example-cookie",
          value: "best",
          domain: "www.example.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: "lax"
        }
      ])
    }))

  test("CO-039", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.cookies.set({ name: "frame-cookie", value: "value", scope: { url: server.PREFIX } })
      yield* page.evaluateInMainWorld((src) =>
        new Promise<void>((resolve) => {
          const iframe = document.createElement("iframe")
          document.body.appendChild(iframe)
          iframe.onload = () => resolve()
          iframe.src = src
        }), server.PREFIX + "/grid.html")
      // The iframe is same-origin with the page, so the page's main world reads its document
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("iframe")?.contentDocument?.cookie),
        "frame-cookie=value"
      )
    }))

  test("CO-040", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const context = page.context
      server.setRoute("/cookies", (req, res) => {
        res.write(req.headers.cookie ?? "undefined-on-server")
        res.end()
      })
      yield* context.cookies.set({ name: "", value: "unnamed-via-add-cookies", scope: { url: server.EMPTY_PAGE } })
      // Round-trip behavior. Firefox's BiDi drops an unnamed cookie, as the original's firefox-with-BiDi branch expects;
      // stock WebKit on Linux keeps it, as the original's other branch does.
      const dropsUnnamed = browserName === "firefox"
      const captured = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/cookies",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/cookies", { waitUntil: "load" })
      const response = yield* captured
      assert.strictEqual(response.body, dropsUnnamed ? "undefined-on-server" : "unnamed-via-add-cookies")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.cookie),
        dropsUnnamed ? "" : "unnamed-via-add-cookies"
      )
      // Within PW behavior
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "=unnamed-via-js;"
      })
      yield* readd(context, yield* context.cookies.list)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.cookie),
        dropsUnnamed ? "" : "unnamed-via-js"
      )
    }))

  test(
    "CO-041",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        // Chromium refuses `acceptInsecureCerts` (the ledger), so this runs where the context can accept the TLS server's
        // self-signed certificate.
        const connected = yield* server.waitForWebSocket
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        yield* page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" })
        yield* context.cookies.set({
          name: "foo",
          value: "bar",
          scope: { domain: HOSTNAME, path: "/" },
          secure: true
        })
        yield* page.evaluateInMainWorld((url) => {
          new WebSocket(url)
        }, server.https.PREFIX.replace("https://", "wss://") + "/ws")
        const peer = yield* connected
        assert.strictEqual(peer.request.headers.cookie, "foo=bar")
      }))
  )
})
