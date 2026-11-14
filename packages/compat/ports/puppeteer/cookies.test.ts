/**
 * Puppeteer's `test/src/cookies.test.ts`: `page.cookies`, `page.setCookie`, and `page.deleteCookie`, which read, set, and
 * remove the cookies a page's context holds.
 *
 * What the port changes:
 * - The three page methods are the context's cookie jar. `page.cookies(...urls)` is `context.cookies.listFor(url)` over
 *   each URL, and with no URL it is the page's URL, as Puppeteer's is. `page.setCookie` is `context.cookies.set`, and
 *   `page.deleteCookie` is `context.cookies.remove`. The helpers `cookiesOf`, `setCookies`, and `deleteCookies` below take
 *   Puppeteer's arguments and make these calls.
 * - Puppeteer's cookie is read in its own words by `asPuppeteer`: `expires` is -1 for a session cookie, `session` is
 *   Puppeteer's flag, `sameSite` is `Strict`, `Lax`, or `None`, and `partitionKey` is the top-level site. Strider's cookie
 *   has no `size` or `sourceScheme`, so those two fields of the original's expectations are not checked. Puppeteer's
 *   `expectCookieEquals` compares them on Chrome, so every test that expects them asserts less here than the original.
 * - A cookie set without a URL or domain takes the page's URL, as Puppeteer's `setCookie` does. Strider's scope is a URL,
 *   or a domain and a path, never both: a `url` with a `domain` or `path` becomes that domain (the URL's host when it
 *   names none) and that path. That drops the URL's scheme, which only matters for domain-matching tests that never read
 *   `secure`. Separately, Strider never derives `secure` from an `https` URL, as Puppeteer's `setCookie` does: `secure`
 *   is `false` unless the call says so (`CookieJar.Input.secure`, `@default false`). "should default to setting secure
 *   cookie for HTTPS websites" and the `secure: true` expectation in "should set secure same-site cookies from a frame"
 *   depend on that, and no translation is involved: the first passes a bare `url`.
 * - Strider's `sameSite` default is `lax`, so Puppeteer's `"Default"` is left out of the call. A cookie that names no
 *   SameSite reads as none, which is the browser's default: the Firefox check in "Default" sameSite when not specified
 *   expects that.
 * - `page.deleteCookie({ url, name })` removes by the URL's host, as `remove` matches a domain and a path, not a URL.
 *   A cookie in another partition is removed too: `remove` takes no partition key, so "should delete cookie with partition
 *   key if partition key is specified" isn't ported (see the ledger, which names the gap).
 * - `partitionKey` is a `Url.Site`, a scheme and host with no port. Puppeteer passes the origin, and Chromium stores the
 *   site without the port, which is the value the original expects on Chrome. Partitioned cookies are unsupported on
 *   Firefox and stock WebKit (`cookies.partitioned`), which the ledger records for the two tests that set one.
 * - `setCookie` takes a list in Puppeteer and checks every cookie before setting any. Strider sets them in turn, so a
 *   refused cookie comes after the ones before it. "should not set a cookie with blank page URL" asserts the refusal only.
 * - A refused URL (`about:blank`, a `data:` page) is Strider's `InvalidInput` on the scope, not Puppeteer's wording. The
 *   assertions check the reason and that the message names the URL.
 * - `page.goto` names `waitUntil: "load"`, as Puppeteer's default waits for load.
 * - `page.evaluate` runs in the page's main world, so it is `page.evaluateInMainWorld`. "should set secure same-site cookies
 *   from a frame" reads the frame's `document.cookie` (Puppeteer's `page.frames()[1].evaluate`) through the frame's
 *   isolated world, `locator("body").evaluate`, since that frame is cross-site and its document is out of the main world's
 *   reach. Stock WebKit has no isolated worlds, so the ledger names that test there.
 * - "should set secure same-site cookies from a frame" launches Puppeteer's browser with `acceptInsecureCerts`. Chromium
 *   refuses that per context, so the test is ported for Firefox and stock WebKit alone, as the Playwright
 *   browsercontext-cookies-third-party port does.
 * - "should delete cookie with partition key if partition key is specified" isn't ported, for the reason above.
 * - "should isolate cookies in browser contexts" creates Puppeteer's second context as `Browser.newContext()`, scoped so it
 *   closes after the test.
 */
import { assert } from "@effect/vitest"
import { Browser, CookieJar, type Page, Url } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** Puppeteer's cookie, in its own words, from the fields Strider's cookie has. */
interface PuppeteerCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly expires: number
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly session: boolean
  readonly sameSite: "Strict" | "Lax" | "None" | undefined
  readonly partitionKey: string | undefined
}

const sameSiteWords = { strict: "Strict", lax: "Lax", none: "None" } as const

/** Puppeteer's SameSite word, as Strider's `sameSite` takes it. */
const sameSiteOf = { Strict: "strict", Lax: "lax", None: "none" } as const

const asPuppeteer = (cookie: CookieJar.Cookie): PuppeteerCookie => {
  const expires = Option.getOrUndefined(cookie.expires)
  return {
    name: cookie.name,
    value: Redacted.value(cookie.value),
    domain: cookie.domain,
    path: cookie.path,
    expires: expires === undefined ? -1 : DateTime.toEpochMillis(expires) / 1000,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: Option.isNone(cookie.expires),
    sameSite: Option.match(cookie.sameSite, { onNone: () => undefined, onSome: (word) => sameSiteWords[word] }),
    partitionKey: cookie.partitionKey._tag === "Partitioned" ? cookie.partitionKey.topLevelSite : undefined
  }
}

/**
 * Puppeteer's `expectCookieEquals`: the same number of cookies, and each one matches its expectation's fields, as
 * `toMatchObject` does.
 */
const expectCookies = (actual: ReadonlyArray<PuppeteerCookie>, expected: ReadonlyArray<Partial<PuppeteerCookie>>) => {
  assert.strictEqual(actual.length, expected.length)
  expected.forEach((want, index) => {
    const got = actual[index]!
    for (const key of Object.keys(want) as Array<keyof PuppeteerCookie>) {
      assert.deepStrictEqual(got[key], want[key], `cookie ${index}, ${key}`)
    }
  })
}

/** Puppeteer's `page.cookies(...urls)`: the cookies a request to each URL would send, or to the page's URL alone. */
const cookiesOf = Effect.fnUntraced(function*(page: Page.Page, urls: ReadonlyArray<string>) {
  const targets = urls.length === 0 ? [yield* page.url] : urls
  const lists = yield* Effect.forEach(targets, (url) => page.context.cookies.listFor(url))
  return lists.flat().map(asPuppeteer)
})

/** A cookie to set, in Puppeteer's words. `sameSite: "Default"` is the browser's own default, which Strider's default is. */
interface CookieParam {
  readonly name: string
  readonly value: string
  readonly url?: string | undefined
  readonly domain?: string | undefined
  readonly path?: string | undefined
  readonly httpOnly?: boolean | undefined
  readonly secure?: boolean | undefined
  readonly sameSite?: "Strict" | "Lax" | "None" | "Default" | undefined
  readonly partitionKey?: Url.Site | undefined
}

/**
 * Puppeteer's `page.setCookie(...cookies)`. A cookie with no URL takes the page's, as Puppeteer's does, and a domain or path
 * makes a scope of that domain and path, the URL's host when it names no domain.
 */
const setCookies = (page: Page.Page, cookies: ReadonlyArray<CookieParam>) =>
  Effect.forEach(cookies, (cookie) =>
    Effect.gen(function*() {
      const url = cookie.url ?? (yield* page.url)
      const scope: CookieJar.Input["scope"] = cookie.domain === undefined && cookie.path === undefined
        ? { url }
        : { domain: cookie.domain ?? new URL(url).hostname, path: cookie.path ?? "/" }
      yield* page.context.cookies.set({
        name: cookie.name,
        value: cookie.value,
        scope,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === undefined || cookie.sameSite === "Default"
          ? undefined
          : sameSiteOf[cookie.sameSite],
        partitionKey: cookie.partitionKey === undefined
          ? undefined
          : { _tag: "Partitioned", topLevelSite: cookie.partitionKey, crossSiteAncestor: Option.some(false) }
      })
    }), { discard: true })

/** A cookie to delete: by name, for its URL's host (the page's when it names none), or for the domain and path it gives. */
interface DeleteParam {
  readonly name: string
  readonly url?: string | undefined
  readonly domain?: string | undefined
  readonly path?: string | undefined
}

/** Puppeteer's `page.deleteCookie(...cookies)`. */
const deleteCookies = (page: Page.Page, cookies: ReadonlyArray<DeleteParam>) =>
  Effect.forEach(cookies, (cookie) =>
    Effect.gen(function*() {
      const url = cookie.url ?? (yield* page.url)
      yield* page.context.cookies.remove({
        name: cookie.name,
        domain: cookie.domain ?? new URL(url).hostname,
        path: cookie.path
      })
    }), { discard: true })

/** `document.cookie` in the page's main world, as Puppeteer's `page.evaluate('document.cookie')` reads it. */
const documentCookie = (page: Page.Page) => page.evaluateInMainWorld(() => document.cookie)

/** The site of a URL, as Strider names a partition: its scheme and host, with no port. */
const siteOf = (url: URL) => Url.Site.make(`${url.protocol}//${url.hostname}`)

/** A refused cookie operation's reason, when it is a `CookieJarError`. */
const refusal = (error: unknown) => CookieJar.isCookieJarError(error) ? error.reason._tag : undefined

/** The message of a refused cookie operation, which names what it refused. */
const messageOf = (error: unknown) => CookieJar.isCookieJarError(error) ? error.message : String(error)

upstream(import.meta.filename, {}, (test) => {
  test("Cookie specs Page.cookies should return no cookies in pristine browser context", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      expectCookies(yield* cookiesOf(page, []), [])
    }))

  test("Cookie specs Page.cookies should get a cookie", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
      })
      expectCookies(yield* cookiesOf(page, []), [
        {
          name: "username",
          value: "John Doe",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.cookies should properly report httpOnly cookie", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "a=b; HttpOnly; Path=/")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, load)
      const cookies = yield* cookiesOf(page, [])
      assert.strictEqual(cookies.length, 1)
      assert.isTrue(cookies[0]!.httpOnly)
    }))

  test("Cookie specs Page.cookies should properly report \"Strict\" sameSite cookie", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "a=b; SameSite=Strict")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, load)
      const cookies = yield* cookiesOf(page, [])
      assert.strictEqual(cookies.length, 1)
      assert.strictEqual(cookies[0]!.sameSite, "Strict")
    }))

  test("Cookie specs Page.cookies should properly report \"Lax\" sameSite cookie", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "a=b; SameSite=Lax")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, load)
      const cookies = yield* cookiesOf(page, [])
      assert.strictEqual(cookies.length, 1)
      assert.strictEqual(cookies[0]!.sameSite, "Lax")
    }))

  test("Cookie specs Page.cookies should properly report \"Default\" sameSite cookie", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [{ name: "a", value: "b", sameSite: "Default" }])
      const cookies = yield* cookiesOf(page, [])
      assert.strictEqual(cookies.length, 1)
      assert.strictEqual(cookies[0]!.name, "a")
      // Different browsers have different sameSite values for the "Default" sameSite.
      assert.include(["Default", "Lax", undefined], cookies[0]!.sameSite)
    }))

  test("Cookie specs Page.cookies should be able to delete \"Default\" sameSite cookie", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [{ name: "a", value: "b", sameSite: "Default" }])
      const cookies = yield* cookiesOf(page, [])
      assert.isDefined(cookies.find((cookie) => cookie.name === "a"))
      yield* deleteCookies(page, cookies)
      assert.strictEqual((yield* cookiesOf(page, [])).length, 0)
    }))

  test("Cookie specs Page.cookies should report \"Default\" sameSite cookie when not specified", ({ browserName, page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "a=b")
        res.end()
      })
      yield* page.goto(server.EMPTY_PAGE, load)
      const cookies = yield* cookiesOf(page, [])
      assert.strictEqual(cookies.length, 1)
      // Firefox reports a cookie that names no SameSite as the browser's default, which Strider reads as none. Chromium's
      // is `Lax`, and the original checks Firefox alone.
      if (browserName === "firefox") assert.isUndefined(cookies[0]!.sameSite)
    }))

  test("Cookie specs Page.cookies should get multiple cookies", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "username=John Doe"
        document.cookie = "password=1234"
      })
      const cookies = yield* cookiesOf(page, [])
      cookies.sort((a, b) => a.name.localeCompare(b.name))
      expectCookies(cookies, [
        {
          name: "password",
          value: "1234",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        },
        {
          name: "username",
          value: "John Doe",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.cookies should get cookies from multiple urls", ({ page }) =>
    Effect.gen(function*() {
      yield* setCookies(page, [
        { url: "https://foo.com", name: "doggo", value: "woofs" },
        { url: "https://bar.com", name: "catto", value: "purrs" },
        { url: "https://baz.com", name: "birdo", value: "tweets" }
      ])
      const cookies = yield* cookiesOf(page, ["https://foo.com", "https://baz.com"])
      cookies.sort((a, b) => a.name.localeCompare(b.name))
      expectCookies(cookies, [
        {
          name: "birdo",
          value: "tweets",
          domain: "baz.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          session: true
        },
        {
          name: "doggo",
          value: "woofs",
          domain: "foo.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.cookies should get cookies from subdomain if the domain field allows it", ({ page }) =>
    Effect.gen(function*() {
      yield* setCookies(page, [{
        url: "https://base_domain.com",
        domain: ".base_domain.com",
        name: "doggo",
        value: "woofs"
      }])
      const cookies = yield* cookiesOf(page, ["https://sub_domain.base_domain.com"])
      assert.strictEqual(cookies.length, 1)
    }))

  test(
    "Cookie specs Page.cookies should get cookies from the domain itself if the domain field allows subdomains",
    ({ page }) =>
      Effect.gen(function*() {
        yield* setCookies(page, [{
          url: "https://base_domain.com",
          domain: ".base_domain.com",
          name: "doggo",
          value: "woofs"
        }])
        const cookies = yield* cookiesOf(page, ["https://base_domain.com"])
        assert.strictEqual(cookies.length, 1)
      })
  )

  test(
    "Cookie specs Page.cookies should not get cookies from subdomain if the cookie is for top-level domain",
    ({ page }) =>
      Effect.gen(function*() {
        yield* setCookies(page, [{
          url: "https://base_domain.com",
          domain: "base_domain.com",
          name: "doggo",
          value: "woofs"
        }])
        const cookies = yield* cookiesOf(page, ["https://sub_domain.base_domain.com"])
        assert.strictEqual(cookies.length, 0)
      })
  )

  test("Cookie specs Page.cookies should get cookies from nested path", ({ page }) =>
    Effect.gen(function*() {
      yield* setCookies(page, [{
        url: "https://foo.com",
        path: "/some_path",
        name: "doggo",
        value: "woofs"
      }])
      const cookies = yield* cookiesOf(page, ["https://foo.com/some_path/nested_path"])
      assert.strictEqual(cookies.length, 1)
    }))

  test("Cookie specs Page.cookies should not get cookies from not nested path", ({ page }) =>
    Effect.gen(function*() {
      yield* setCookies(page, [{
        url: "https://foo.com",
        path: "/some_path",
        name: "doggo",
        value: "woofs"
      }])
      const cookies = yield* cookiesOf(page, ["https://foo.com/some_path_looks_like_nested"])
      assert.strictEqual(cookies.length, 0)
    }))

  test("Cookie specs Page.setCookie should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [{ name: "password", value: "123456" }])
      assert.strictEqual(yield* documentCookie(page), "password=123456")
    }))

  test("Cookie specs Page.setCookie should isolate cookies in browser contexts", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      // Puppeteer's `browser.createBrowserContext()` and `anotherContext.newPage()`
      const anotherContext = yield* Browser.newContext()
      const anotherPage = yield* anotherContext.newPage

      yield* page.goto(server.EMPTY_PAGE, load)
      yield* anotherPage.goto(server.EMPTY_PAGE, load)

      yield* setCookies(page, [{ name: "page1cookie", value: "page1value" }])
      yield* setCookies(anotherPage, [{ name: "page2cookie", value: "page2value" }])

      const cookies1 = yield* cookiesOf(page, [])
      const cookies2 = yield* cookiesOf(anotherPage, [])
      assert.strictEqual(cookies1.length, 1)
      assert.strictEqual(cookies2.length, 1)
      assert.strictEqual(cookies1[0]!.name, "page1cookie")
      assert.strictEqual(cookies1[0]!.value, "page1value")
      assert.strictEqual(cookies2[0]!.name, "page2cookie")
      assert.strictEqual(cookies2[0]!.value, "page2value")
    })))

  test("Cookie specs Page.setCookie should set multiple cookies", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [
        { name: "password", value: "123456" },
        { name: "foo", value: "bar" }
      ])
      const cookieStrings = yield* page.evaluateInMainWorld(() => {
        const cookies = document.cookie.split(";")
        return cookies
          .map((cookie) => cookie.trim())
          .sort()
      })
      assert.deepStrictEqual(cookieStrings, ["foo=bar", "password=123456"])
    }))

  test("Cookie specs Page.setCookie should have |expires| set to |-1| for session cookies", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [{ name: "password", value: "123456" }])
      const cookies = yield* cookiesOf(page, [])
      assert.isTrue(cookies[0]!.session)
      assert.strictEqual(cookies[0]!.expires, -1)
    }))

  test("Cookie specs Page.setCookie should set cookie with reasonable defaults", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [{ name: "password", value: "123456" }])
      const cookies = yield* cookiesOf(page, [])
      expectCookies(cookies.sort((a, b) => a.name.localeCompare(b.name)), [
        {
          name: "password",
          value: "123456",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.setCookie should set cookie with all available properties", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      // `expires: -1` is Puppeteer's session cookie, which leaves `expires` unset here. `sourceScheme: "Unset"` is a
      // Chromium-only input, which Strider's cookie doesn't take, so the call leaves it out.
      yield* setCookies(page, [{
        name: "password",
        value: "123456",
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false
      }])
      const cookies = yield* cookiesOf(page, [])
      expectCookies(cookies.sort((a, b) => a.name.localeCompare(b.name)), [
        {
          name: "password",
          value: "123456",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.setCookie should set a cookie with a path", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/grid.html", load)
      yield* setCookies(page, [{ name: "gridcookie", value: "GRID", path: "/grid.html" }])
      expectCookies(yield* cookiesOf(page, []), [
        {
          name: "gridcookie",
          value: "GRID",
          domain: "localhost",
          path: "/grid.html",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
      assert.strictEqual(yield* documentCookie(page), "gridcookie=GRID")
      yield* page.goto(server.EMPTY_PAGE, load)
      expectCookies(yield* cookiesOf(page, []), [])
      assert.strictEqual(yield* documentCookie(page), "")
      yield* page.goto(server.PREFIX + "/grid.html", load)
      assert.strictEqual(yield* documentCookie(page), "gridcookie=GRID")
    }))

  test("Cookie specs Page.setCookie should set a cookie with a partitionKey", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      const url = new URL(yield* page.url)
      const site = siteOf(url)
      yield* setCookies(page, [{
        url: url.toString(),
        name: "partitionCookie",
        value: "partition",
        secure: true,
        partitionKey: site
      }])
      expectCookies(yield* cookiesOf(page, []), [
        {
          name: "partitionCookie",
          value: "partition",
          domain: url.hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: true,
          session: true,
          partitionKey: site
        }
      ])
    }))

  test("Cookie specs Page.setCookie should not set a cookie on a blank page", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("about:blank", load)
      const error = yield* failureOf(setCookies(page, [{ name: "example-cookie", value: "best" }]))
      assert.strictEqual(refusal(error), "InvalidInput")
      assert.include(messageOf(error), "about:blank")
    }))

  test("Cookie specs Page.setCookie should not set a cookie with blank page URL", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      // Puppeteer checks both cookies before setting either. Strider sets the first, then refuses the second.
      const error = yield* failureOf(setCookies(page, [
        { name: "example-cookie", value: "best" },
        { url: "about:blank", name: "example-cookie-blank", value: "best" }
      ]))
      assert.strictEqual(refusal(error), "InvalidInput")
      assert.include(messageOf(error), "about:blank")
    }))

  test("Cookie specs Page.setCookie should not set a cookie on a data URL page", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:,Hello%2C%20World!", load)
      const error = yield* failureOf(setCookies(page, [{ name: "example-cookie", value: "best" }]))
      assert.strictEqual(refusal(error), "InvalidInput")
      assert.include(messageOf(error), "data:")
    }))

  test("Cookie specs Page.setCookie should default to setting secure cookie for HTTPS websites", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      const SECURE_URL = "https://example.com"
      yield* setCookies(page, [{ url: SECURE_URL, name: "foo", value: "bar" }])
      const [cookie] = yield* cookiesOf(page, [SECURE_URL])
      assert.isTrue(cookie!.secure)
    }))

  test("Cookie specs Page.setCookie should be able to set insecure cookie for HTTP website", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      const HTTP_URL = "http://example.com"
      yield* setCookies(page, [{ url: HTTP_URL, name: "foo", value: "bar" }])
      const [cookie] = yield* cookiesOf(page, [HTTP_URL])
      assert.isFalse(cookie!.secure)
    }))

  test("Cookie specs Page.setCookie should set a cookie on a different domain", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [{ url: "https://www.example.com", name: "example-cookie", value: "best" }])
      assert.strictEqual(yield* documentCookie(page), "")
      expectCookies(yield* cookiesOf(page, []), [])
      expectCookies(yield* cookiesOf(page, ["https://www.example.com"]), [
        {
          name: "example-cookie",
          value: "best",
          domain: "www.example.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.setCookie should set cookies from a frame", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/grid.html", load)
      yield* setCookies(page, [{ name: "localhost-cookie", value: "best" }])
      yield* page.evaluateInMainWorld((src: string) => {
        let fulfill!: () => void
        const promise = new Promise<void>((x) => fulfill = x)
        const iframe = document.createElement("iframe")
        document.body.appendChild(iframe)
        iframe.onload = fulfill
        iframe.src = src
        return promise
      }, server.CROSS_PROCESS_PREFIX)
      yield* setCookies(page, [{ name: "127-cookie", value: "worst", url: server.CROSS_PROCESS_PREFIX }])
      assert.strictEqual(yield* documentCookie(page), "localhost-cookie=best")

      expectCookies(yield* cookiesOf(page, []), [
        {
          name: "localhost-cookie",
          value: "best",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])

      expectCookies(yield* cookiesOf(page, [server.CROSS_PROCESS_PREFIX]), [
        {
          name: "127-cookie",
          value: "worst",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  // Chromium refuses `acceptInsecureCerts`, so the test runs on Firefox and stock WebKit alone (the ledger names Chromium).
  test(
    "Cookie specs Page.setCookie should set secure same-site cookies from a frame",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        yield* page.goto(server.https.PREFIX + "/grid.html", load)
        yield* page.evaluateInMainWorld((src: string) => {
          let fulfill!: () => void
          const promise = new Promise<void>((x) => fulfill = x)
          const iframe = document.createElement("iframe")
          document.body.appendChild(iframe)
          iframe.onload = fulfill
          iframe.src = src
          return promise
        }, server.https.CROSS_PROCESS_PREFIX)
        yield* setCookies(page, [{
          name: "127-same-site-cookie",
          value: "best",
          url: server.https.CROSS_PROCESS_PREFIX,
          sameSite: "None"
        }])

        // Puppeteer's `page.frames()[1].evaluate("document.cookie")`: the frame's document, through its isolated world
        const frameCookie = yield* page.frame(page.locator("iframe")).locator("body").evaluate((body) =>
          body.ownerDocument.cookie
        )
        assert.strictEqual(frameCookie, "127-same-site-cookie=best")
        expectCookies(yield* cookiesOf(page, [server.https.CROSS_PROCESS_PREFIX]), [
          {
            name: "127-same-site-cookie",
            value: "best",
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: false,
            sameSite: "None",
            secure: true,
            session: true
          }
        ])
      }))
  )

  test("Cookie specs Page.deleteCookie should delete cookie", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setCookies(page, [
        { name: "cookie1", value: "1" },
        { name: "cookie2", value: "2" },
        { name: "cookie3", value: "3" }
      ])
      assert.strictEqual(yield* documentCookie(page), "cookie1=1; cookie2=2; cookie3=3")
      yield* deleteCookies(page, [{ name: "cookie2" }])
      assert.strictEqual(yield* documentCookie(page), "cookie1=1; cookie3=3")
    }))

  test("Cookie specs Page.deleteCookie should not delete cookie for different domain", ({ page, server }) =>
    Effect.gen(function*() {
      const COOKIE_DESTINATION_URL = "https://example.com"
      const COOKIE_NAME = "some_cookie_name"

      yield* page.goto(server.EMPTY_PAGE, load)
      // Set a cookie for the current page.
      yield* setCookies(page, [{ name: COOKIE_NAME, value: "local page cookie value" }])
      assert.strictEqual((yield* cookiesOf(page, [])).length, 1)

      // Set a cookie for different domain.
      yield* setCookies(page, [{
        url: COOKIE_DESTINATION_URL,
        name: COOKIE_NAME,
        value: "COOKIE_DESTINATION_URL cookie value"
      }])
      assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 1)

      yield* deleteCookies(page, [{ name: COOKIE_NAME }])

      // Verify the cookie is deleted for the current page.
      assert.strictEqual((yield* cookiesOf(page, [])).length, 0)

      // Verify the cookie is not deleted for different domain.
      expectCookies(yield* cookiesOf(page, [COOKIE_DESTINATION_URL]), [
        {
          name: COOKIE_NAME,
          value: "COOKIE_DESTINATION_URL cookie value",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          session: true
        }
      ])
    }))

  test("Cookie specs Page.deleteCookie should delete cookie for specified URL", ({ page, server }) =>
    Effect.gen(function*() {
      const COOKIE_DESTINATION_URL = "https://example.com"
      const COOKIE_NAME = "some_cookie_name"

      yield* page.goto(server.EMPTY_PAGE, load)
      // Set a cookie for the current page.
      yield* setCookies(page, [{ name: COOKIE_NAME, value: "some_cookie_value" }])
      assert.strictEqual((yield* cookiesOf(page, [])).length, 1)

      // Set a cookie for specified URL.
      yield* setCookies(page, [{
        url: COOKIE_DESTINATION_URL,
        name: COOKIE_NAME,
        value: "another_cookie_value"
      }])
      assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 1)

      // Delete the cookie for specified URL.
      yield* deleteCookies(page, [{ url: COOKIE_DESTINATION_URL, name: COOKIE_NAME }])

      // Verify the cookie is deleted for specified URL.
      assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 0)

      // Verify the cookie is not deleted for the current page.
      expectCookies(yield* cookiesOf(page, []), [
        {
          name: COOKIE_NAME,
          value: "some_cookie_value",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  test(
    "Cookie specs Page.deleteCookie should delete cookie for specified URL regardless of the current page",
    ({ page, server }) =>
      Effect.gen(function*() {
        // Depending on the cookie partitioning implementation, this test doesn't pass if the source origin is in the
        // default cookie partition, as Puppeteer's own note says.
        const COOKIE_DESTINATION_URL = "https://example.com"
        const COOKIE_NAME = "some_cookie_name"
        const URL_1 = server.EMPTY_PAGE
        const URL_2 = server.CROSS_PROCESS_PREFIX + "/empty.html"

        yield* page.goto(URL_1, load)
        // Set a cookie for the COOKIE_DESTINATION from URL_1.
        yield* setCookies(page, [{
          url: COOKIE_DESTINATION_URL,
          name: COOKIE_NAME,
          value: "Cookie from URL_1"
        }])
        assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 1)

        yield* page.goto(URL_2, load)
        // Set a cookie for the COOKIE_DESTINATION from URL_2.
        yield* setCookies(page, [{
          url: COOKIE_DESTINATION_URL,
          name: COOKIE_NAME,
          value: "Cookie from URL_2"
        }])
        assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 1)

        // Delete the cookie for the COOKIE_DESTINATION from URL_2.
        yield* deleteCookies(page, [{ name: COOKIE_NAME, url: COOKIE_DESTINATION_URL }])

        // Expect the cookie for the COOKIE_DESTINATION from URL_2 is deleted.
        assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 0)

        // Navigate back to the URL_1.
        yield* page.goto(server.EMPTY_PAGE, load)
        // Expect the cookie for the COOKIE_DESTINATION from URL_1 is deleted.
        assert.strictEqual((yield* cookiesOf(page, [COOKIE_DESTINATION_URL])).length, 0)
      })
  )

  test(
    "Cookie specs Page.deleteCookie should only delete cookie from the default partition if partitionkey is not specified",
    ({ page, server }) =>
      Effect.gen(function*() {
        const url = new URL(server.EMPTY_PAGE)
        yield* page.goto(url.toString(), load)
        yield* setCookies(page, [{
          url: url.toString(),
          name: "partitionCookie",
          value: "partition",
          secure: true,
          partitionKey: siteOf(url)
        }])
        assert.strictEqual((yield* cookiesOf(page, [])).length, 1)
        yield* deleteCookies(page, [{ url: url.toString(), name: "partitionCookie" }])
        assert.strictEqual((yield* cookiesOf(page, [])).length, 0)
      })
  )
})
