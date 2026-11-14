/**
 * Playwright's `tests/library/browsercontext-cookies.spec.ts`: the cookies a context lists, from the page's `document.cookie`
 * and from the context's own list, filtered by URL, with their attributes.
 *
 * What the port changes:
 * - `context.cookies()` is `cookies.list`, and `context.cookies(url)` is `cookies.listFor(url)`, which takes one URL. CO-009
 *   and CO-010 ask for several URLs and read each one's cookies, in the order the original lists them. `addCookies([...])`
 *   is one `cookies.set` per cookie, and `context.newPage()` is `context.newPage`.
 * - Strider's cookie has a `Redacted` value, `expires` as an `Option` (None for a session cookie, where the original reads
 *   -1), and `sameSite` as an `Option` of lowercase words. `asPlaywright` reads a cookie in the original's shape, so the
 *   expectations are the original's, with Strider's sameSite words.
 * - A cookie that names no SameSite is reported with none: Strider's API says a cookie that didn't say is read as no
 *   `sameSite`. The original expects Chromium's default, `Lax`, for such a cookie, so CO-002, CO-003, CO-008, and CO-017
 *   assert `undefined`, as browsercontext-route's RO-169 does. A cookie that `cookies.set` writes without a sameSite
 *   is `lax`, Strider's documented default, and CO-011 expects that for its cookies.
 * - `expires` is Strider's epoch milliseconds, where the original's are seconds: CO-004 and CO-015 give `expires` in
 *   milliseconds, and the reads are converted to seconds by `asPlaywright`. The rollover and negative cases of CO-015 take
 *   the same values the original does, in milliseconds.
 * - Playwright derives `secure` from the cookie's URL (`rewriteCookies`: Secure when the URL is https), and Strider doesn't:
 *   its `secure` is false unless the caller asks. CO-009's cookies for `https://` URLs fail where the original expects
 *   `secure: true`, as the add-cookies port's CO-036 and CO-038 do. Chromium drops a `SameSite=None` cookie that isn't
 *   Secure, though `cookies.set` succeeds, so CO-009's `doggo` and CO-015's cookie are never stored and those tests fail
 *   there.
 * - CO-014 fails on Chromium for both hosts because of `listFor`: `cookies.list` holds the Secure cookie set for
 *   `127.0.0.1` or `[::1]`, which Chromium stores, but `listFor("http://127.0.0.1/")` leaves it out, as its filter sends a
 *   Secure cookie only to an https URL. Playwright's filter (`cookieMatchesURL`) also sends it to a local host over http,
 *   as Chromium does for `localhost`, `*.localhost`, `127.0.0.0/8` and `[::1]`.
 * - `server.HOSTNAME` is `localhost`, the host of `server.PREFIX`.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A `page.goto` waits for `load` here
 *   as the original's does, and each names `waitUntil: "load"`.
 * - CO-016's frame reads (`frame.evaluate`) are `locator.evaluate` on the frame's `body`, which runs in the frame's isolated
 *   world: the DOM is the frame's, but stock WebKit has no isolated worlds, so CO-016 fails there with `Unsupported`, as
 *   selectors-frame's SE-106 does. CO-016 is ported for Firefox and stock WebKit only (the original skips Chromium).
 * - CO-014 runs once per host, registered with `{ variant }`, as the original's loop does.
 * - Routes are `page.route`, and `Route.fulfill(HttpServerResponse.text(...))` carries a fulfilled document's headers.
 * - `frameLocator("iframe").locator("body")` is `page.frame(page.locator("iframe")).locator("body")`.
 * - `Secure` cookies: CO-013's and CO-015's `secure` comes from the original's own argument, and so does CO-010's.
 * - CO-004's `expires` upper bound is the original's in seconds, converted from the milliseconds it's given in.
 * - CO-017's `expires` is Chromium's or WebKit's own date for a Max-Age this large, so the port asserts only that it is a
 *   number, as the original's `expect.any(Number)` does. The rest of the cookie is the original's.
 * - CO-018's cookie is set by a fulfilled response, and its frame is the page's `iframe`.
 */
import { assert } from "@effect/vitest"
import { CookieJar, Expect, Route, type UserContext } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
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

/** A cookie's attributes without its expiry, for the tests that check the expiry on its own. */
const withoutExpires = ({ expires: _expires, ...rest }: PlaywrightCookie) => rest

/** The cookies a context lists for several URLs: each URL's cookies, in the order they were asked for. */
const listForAll = (context: UserContext.UserContext, urls: ReadonlyArray<string>) =>
  Effect.map(Effect.forEach(urls, (url) => context.cookies.listFor(url)), (lists) => lists.flat())

upstream(import.meta.filename, {}, (test) => {
  test("CO-001", ({ page }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* page.context.cookies.list, [])
    }))

  test("CO-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const documentCookie = yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
        return document.cookie
      })
      assert.strictEqual(documentCookie, "username=John Doe")
      assert.deepStrictEqual((yield* page.context.cookies.list).map(asPlaywright), [{
        name: "username",
        value: "John Doe",
        domain: HOSTNAME,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        // The page's cookie names no SameSite, so Strider reads none; the original expects Chromium's default, `Lax`
        sameSite: undefined
      }])
    }))

  test("CO-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // @see https://en.wikipedia.org/wiki/Year_2038_problem
      const date = +(new Date("1/1/2038"))
      const documentCookie = yield* page.evaluateInMainWorld((timestamp) => {
        const date = new Date(timestamp)
        document.cookie = `username=John Doe;expires=${date.toUTCString()}`
        return document.cookie
      }, date)
      assert.strictEqual(documentCookie, "username=John Doe")
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      const [cookie] = cookies
      assert.isTrue(Option.isSome(cookie!.expires))
      assert.deepStrictEqual(withoutExpires(asPlaywright(cookie!)), {
        name: "username",
        value: "John Doe",
        domain: HOSTNAME,
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: undefined
      })
      // Browsers start to cap cookies with 400 days max expires value.
      // See https://github.com/httpwg/http-extensions/pull/1732
      // Chromium patch: https://chromium.googlesource.com/chromium/src/+/aaa5d2b55478eac2ee642653dcd77a50ac3faff6
      // We want to make sure that expires date is at least 400 days in future.
      const FOUR_HUNDRED_DAYS = 1000 * 60 * 60 * 24 * 400
      const FIVE_MINUTES = 1000 * 60 * 5 // relax condition a bit to make sure test is not flaky.
      assert.isAbove(asPlaywright(cookie!).expires, (Date.now() + FOUR_HUNDRED_DAYS - FIVE_MINUTES) / 1000)
    }))

  test("CO-004", ({ page }) =>
    Effect.gen(function*() {
      // Browsers start to cap cookies with 400 days max expires value.
      // See https://github.com/httpwg/http-extensions/pull/1732
      // Chromium patch: https://chromium.googlesource.com/chromium/src/+/aaa5d2b55478eac2ee642653dcd77a50ac3faff6
      // Playwright's `Date.now() / 1000 + 401 days` in seconds, here in Strider's milliseconds
      const expire = Date.now() + 401 * 24 * 3600 * 1000
      yield* page.context.cookies.set({
        name: "username",
        value: "John Doe",
        scope: { domain: HOSTNAME, path: "/" },
        expires: expire,
        httpOnly: false,
        secure: false,
        sameSite: "lax"
      })
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      const [cookie] = cookies
      assert.deepStrictEqual(
        { name: cookie!.name, value: Redacted.value(cookie!.value), domain: cookie!.domain, path: cookie!.path },
        { name: "username", value: "John Doe", domain: HOSTNAME, path: "/" }
      )
      const expires = asPlaywright(cookie!).expires
      assert.isAbove(expires, 0)
      assert.isAtMost(expires, expire / 1000)
    }))

  test("CO-005", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "name=value;HttpOnly; Path=/")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      assert.isTrue(cookies[0]!.httpOnly)
    }))

  test("CO-006", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "name=value;SameSite=Strict")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      assert.strictEqual(Option.getOrUndefined(cookies[0]!.sameSite), "strict")
    }))

  test("CO-007", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "name=value;SameSite=Lax")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      assert.strictEqual(Option.getOrUndefined(cookies[0]!.sameSite), "lax")
    }))

  test("CO-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const documentCookie = yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
        document.cookie = "password=1234"
        return document.cookie.split("; ").sort().join("; ")
      })
      const cookies = (yield* page.context.cookies.list).map(asPlaywright).sort(byName)
      assert.strictEqual(documentCookie, "password=1234; username=John Doe")
      assert.deepStrictEqual(cookies, [
        {
          name: "password",
          value: "1234",
          domain: HOSTNAME,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          // Cookies the page names no SameSite for read with none (see CO-002)
          sameSite: undefined
        },
        {
          name: "username",
          value: "John Doe",
          domain: HOSTNAME,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: undefined
        }
      ])
    }))

  test("CO-009", ({ page }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.cookies.set({ scope: { url: "https://foo.com" }, name: "doggo", value: "woofs", sameSite: "none" })
      yield* context.cookies.set({ scope: { url: "https://bar.com" }, name: "catto", value: "purrs", sameSite: "lax" })
      yield* context.cookies.set({ scope: { url: "https://baz.com" }, name: "birdo", value: "tweets", sameSite: "lax" })
      // The original asks for two URLs in one call; `listFor` takes one, so the two are read and joined
      const cookies = (yield* listForAll(context, ["https://foo.com", "https://baz.com"])).map(asPlaywright).sort(
        byName
      )
      assert.deepStrictEqual(cookies, [{
        name: "birdo",
        value: "tweets",
        domain: "baz.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "lax"
      }, {
        name: "doggo",
        value: "woofs",
        domain: "foo.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "none"
      }])
    }))

  test("CO-010", ({ page }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.cookies.set({
        scope: { domain: ".foo.com", path: "/" },
        name: "doggo",
        value: "woofs",
        sameSite: "lax",
        secure: true
      })
      const expected: ReadonlyArray<PlaywrightCookie> = [{
        name: "doggo",
        value: "woofs",
        domain: ".foo.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "lax"
      }]
      assert.deepStrictEqual((yield* context.cookies.listFor("https://foo.com")).map(asPlaywright), expected)
      assert.deepStrictEqual((yield* context.cookies.listFor("https://sub.foo.com")).map(asPlaywright), expected)
    }))

  test("CO-011", ({ page }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.cookies.set({ name: "hostonly", value: "v", scope: { domain: "foo.com", path: "/api" } })
      yield* context.cookies.set({ name: "subdomains", value: "v", scope: { domain: ".foo.com", path: "/api" } })
      yield* context.cookies.set({ name: "slash", value: "v", scope: { domain: "foo.com", path: "/foo/" } })
      const names = (url: string) =>
        context.cookies.listFor(url).pipe(Effect.map((cookies) => cookies.map((cookie) => cookie.name).sort()))
      assert.deepStrictEqual(yield* names("http://foo.com/api"), ["hostonly", "subdomains"])
      assert.deepStrictEqual(yield* names("http://foo.com/api/x"), ["hostonly", "subdomains"])
      assert.deepStrictEqual(yield* names("http://foo.com/apiv2"), [])
      assert.deepStrictEqual(yield* names("http://sub.foo.com/api"), ["subdomains"])
      assert.deepStrictEqual(yield* names("http://notfoo.com/api"), [])
      assert.deepStrictEqual(yield* names("http://foo.com/foo"), [])
      assert.deepStrictEqual(yield* names("http://foo.com/foo/"), ["slash"])
      assert.deepStrictEqual(yield* names("http://foo.com/foo/bar"), ["slash"])
    }))

  test("CO-012", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "name=;Path=/")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const cookies = yield* page.context.cookies.list
      assert.deepStrictEqual(cookies.map((cookie) => ({ name: cookie.name, value: Redacted.value(cookie.value) })), [
        { name: "name", value: "" }
      ])
    }))

  test("CO-013", ({ page }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.cookies.set({
        scope: { url: "https://foo.com" },
        name: "doggo",
        value: "woofs",
        sameSite: "lax",
        secure: true
      })
      yield* context.cookies.set({
        scope: { url: "http://foo.com" },
        name: "catto",
        value: "purrs",
        sameSite: "lax",
        secure: false
      })
      const secureList = (yield* context.cookies.listFor("https://foo.com")).map(asPlaywright).sort(byName)
      assert.deepStrictEqual(secureList, [{
        name: "catto",
        value: "purrs",
        domain: "foo.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "lax"
      }, {
        name: "doggo",
        value: "woofs",
        domain: "foo.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "lax"
      }])
      assert.deepStrictEqual((yield* context.cookies.listFor("http://foo.com/")).map(asPlaywright), [{
        name: "catto",
        value: "purrs",
        domain: "foo.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "lax"
      }])
    }))

  for (const host of ["127.0.0.1", "[::1]"]) {
    test("CO-014", { variant: host }, ({ page }) =>
      Effect.gen(function*() {
        yield* page.context.cookies.set({ name: "a", value: "v", scope: { domain: host, path: "/" }, secure: true })
        const names = (yield* page.context.cookies.listFor(`http://${host}/`)).map((cookie) => cookie.name)
        assert.deepStrictEqual(names, ["a"])
      }))
  }

  test("CO-015", ({ page }) =>
    Effect.gen(function*() {
      const context = page.context
      // Playwright's expiry is in seconds; Strider's is in milliseconds
      const expires = Math.floor(Date.now() / 1000) + 3600
      yield* context.cookies.set({
        scope: { url: "https://foo.com" },
        name: "doggo",
        value: "woofs",
        sameSite: "none",
        expires: expires * 1000
      })
      const cookies = yield* context.cookies.listFor("https://foo.com")
      assert.strictEqual(cookies.length, 1)
      assert.deepStrictEqual(cookies.map(asPlaywright), [{
        name: "doggo",
        value: "woofs",
        domain: "foo.com",
        path: "/",
        expires,
        httpOnly: false,
        secure: true,
        sameSite: "none"
      }])
      {
        // Rollover to 5-digit year
        yield* context.cookies.set({
          scope: { url: "https://foo.com" },
          name: "doggo",
          value: "woofs",
          sameSite: "none",
          expires: 253402300799 * 1000 // Fri, 31 Dec 9999 23:59:59 +0000 (UTC)
        })
        const failure = yield* Effect.flip(context.cookies.set({
          scope: { url: "https://foo.com" },
          name: "doggo",
          value: "woofs",
          sameSite: "none",
          expires: 253402300800 * 1000 // Sat,  1 Jan 1000 00:00:00 +0000 (UTC)
        }))
        assert(CookieJar.isCookieJarError(failure), `expected a CookieJarError, got ${String(failure)}`)
        assert(
          failure.reason._tag === "InvalidInput",
          `expected InvalidInput, got ${failure.reason._tag}`
        )
        assert.strictEqual(failure.reason.input, "expires")
      }
      const negative = yield* Effect.flip(context.cookies.set({
        scope: { url: "https://foo.com" },
        name: "doggo",
        value: "woofs",
        sameSite: "none",
        expires: -42 * 1000
      }))
      assert(CookieJar.isCookieJarError(negative), `expected a CookieJarError, got ${String(negative)}`)
      assert(
        negative.reason._tag === "InvalidInput",
        `expected InvalidInput, got ${negative.reason._tag}`
      )
      assert.strictEqual(negative.reason.input, "expires")
    }))

  test(
    "CO-016",
    { browsers: ["firefox", "webkit"] },
    ({ page, server, browserName }) =>
      Effect.gen(function*() {
        server.setRoute("/set-cookie.html", (_req, res) => {
          res.setHeader("Set-Cookie", "name=value; Path=/")
          res.end()
        })
        // Navigate once to the domain as top level.
        yield* page.goto(server.CROSS_PROCESS_PREFIX + "/set-cookie.html", { waitUntil: "load" })
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.setContent(`<iframe src="${server.CROSS_PROCESS_PREFIX + "/empty.html"}"></iframe>`)
        // The original's `frame` is the page's iframe, and its `frame.evaluate` runs in the frame's isolated world here
        const frame = page.frame(page.locator("iframe")).locator("body")
        // The original's `Promise.all` of the server's wait and the frame's fetch: the wait is listening before the fetch
        const requestTitle = Effect.fnUntraced(function*() {
          const received = yield* server.waitForRequest("/title.html")
          yield* frame.evaluate(() => fetch("/title.html").then(() => undefined))
          return yield* received
        })
        if (browserName === "firefox") {
          assert.isTrue(yield* frame.evaluate(() => document.hasStorageAccess()))
          {
            const serverRequest = yield* requestTitle()
            assert.strictEqual(serverRequest.headers.cookie, "name=value")
          }
        } else {
          // Stock WebKit runs on Linux only, so the original's Linux expectations are the ones that apply
          assert.isTrue(yield* frame.evaluate(() => document.hasStorageAccess()))
          {
            const serverRequest = yield* requestTitle()
            assert.notOk(serverRequest.headers.cookie)
          }
          assert.isTrue(
            yield* frame.evaluate(() => document.requestStorageAccess().then(() => true, () => false))
          )
          assert.isTrue(yield* frame.evaluate(() => document.hasStorageAccess()))
          {
            const serverRequest = yield* requestTitle()
            assert.isUndefined(serverRequest.headers.cookie)
          }
        }
      })
  )

  test("CO-017", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/foobar", (_req, res) => {
        res.setHeader("set-cookie", [
          "cookie1=value1; Path=/; Expires=Thu, 08 Sep 2270 15:06:12 GMT; Max-Age=7776000000"
        ])
        res.statusCode = 200
        res.end()
      })
      yield* page.goto(server.PREFIX + "/foobar", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "cookie1=value1")
      const cookies = (yield* page.context.cookies.list).map(asPlaywright)
      assert.strictEqual(cookies.length, 1)
      const [cookie] = cookies
      assert.isNumber(cookie!.expires)
      assert.deepStrictEqual(withoutExpires(cookie!), {
        name: "cookie1",
        value: "value1",
        domain: HOSTNAME,
        path: "/",
        httpOnly: false,
        secure: false,
        // Read as none, as CO-002 explains
        sameSite: undefined
      })
    }))

  test("CO-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", (intercepted) => {
        if (intercepted.request.url.includes("sub.example.test")) {
          return Route.fulfill(HttpServerResponse.text(
            `
            <p id="result"></p>
            <script>document.getElementById('result').textContent = document.cookie || 'no cookies';</script>
        `,
            { contentType: "text/html" }
          ))
        }
        return Route.fulfill(HttpServerResponse.text(
          `
          <p id="result"></p>
          <script>document.getElementById('result').textContent = document.cookie || 'no cookies';</script>
          <iframe src="http://sub.example.test"></iframe>
      `,
          {
            contentType: "text/html",
            headers: { "Set-Cookie": "testCookie=value; SameSite=Lax; Domain=example.test" }
          }
        ))
      })
      yield* page.goto("http://example.test", { waitUntil: "load" })
      yield* Expect.toContainText(page.locator("body"), "testCookie=value")
      yield* Expect.toContainText(page.frame(page.locator("iframe")).locator("body"), "testCookie=value")
    }))
})
