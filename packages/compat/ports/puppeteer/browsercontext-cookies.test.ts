/**
 * Puppeteer's `test/src/browsercontext-cookies.test.ts`: `BrowserContext.cookies`, `setCookie`, `deleteCookies`, and
 * `deleteMatchingCookies`, which read, set, and remove the cookies a context holds.
 *
 * What the port changes:
 * - The context's methods are its cookie jar: `context.cookies()` is `context.cookies.list`, `context.setCookie` is
 *   `context.cookies.set`, and `context.deleteCookie` and `context.deleteMatchingCookies` are `context.cookies.remove`.
 *   The helpers `setContextCookies` and `contextCookies` take Puppeteer's arguments and make these calls.
 * - `browser.createBrowserContext()` is `Browser.newContext()`, scoped to its test. That test opens no page.
 * - A cookie is read in Puppeteer's words by `asPuppeteer`: `expires` is -1 for a session cookie, and `session` is
 *   Puppeteer's flag. Strider's cookie has no `size` or `sourceScheme`, so those two fields of the original's expectations
 *   are not checked; "should find cookie created in page" asserts the rest.
 * - A `scope` is a domain and a path, as Strider's `CookieJar.Input` takes it, so a setCookie with a domain and no path
 *   gets the path `/`, which Puppeteer's default is. Puppeteer's `remove` by URL is Strider's `remove` by the URL's host and
 *   path: `remove` matches a domain and a path, not a URL, so `{ url, name }` removes the cookies of that host and path.
 * - Puppeteer's `partitionKey` is a `{ sourceOrigin, hasCrossSiteAncestor }` object. Strider's is a `Partitioned` value
 *   with the top-level site and an optional cross-site flag, which `partitioned` builds. The original's Chrome branch
 *   sets a partition and its other browsers don't; the port does the same by browser name. Firefox and stock WebKit
 *   can't set a partitioned cookie (`cookies.partitioned`), so the tests that set one are ledgered there.
 * - "should find partitioned cookie" asserts Strider's typed partition: `Partitioned` with the site and `crossSiteAncestor`
 *   as `Option.some(false)`, where the original compares Chrome's object.
 * - `Default` sameSite: Puppeteer's `sameSite: "Default"` is the browser's own default, which Strider's default is, so the
 *   port leaves `sameSite` out. The original accepts `Default`, `Lax`, or nothing; Strider reports `lax`, one of them.
 * - `page.evaluate('document.cookie')` is `page.evaluateInMainWorld`, which reads the page's own cookies.
 * - The `deleteMatchingCookies` loops are one key each, registered with `{ variant }` as the original's loop runs them.
 *   The partition filter in the first loop (`{ name, partitionKey }`) is not registered: it removes by a partition key,
 *   which Strider's `remove` lacks, and the ledger can't mark one variant of a key, so the key shows four variants.
 * - "should set cookie with a partition key" and the three `deleteMatchingCookies` tests that remove by partition key are
 *   not ported; the ledger says why. "should set cookie with a partition key" also needs the fixture server's self-signed
 *   certificate on a secure page, which Chromium doesn't accept per context.
 */
import { assert } from "@effect/vitest"
import { Browser, type CookieJar, type Page, Url, type UserContext } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** A cookie in Puppeteer's words, from the fields Strider's cookie has. */
const asPuppeteer = (cookie: CookieJar.Cookie) => ({
  name: cookie.name,
  value: Redacted.value(cookie.value),
  domain: cookie.domain,
  path: cookie.path,
  expires: Option.match(cookie.expires, { onNone: () => -1, onSome: (at) => DateTime.toEpochMillis(at) / 1000 }),
  httpOnly: cookie.httpOnly,
  secure: cookie.secure,
  session: Option.isNone(cookie.expires)
})

/** The cookies a context holds, in Puppeteer's words: `context.cookies()`. */
const contextCookies = (context: UserContext.UserContext) =>
  context.cookies.list.pipe(Effect.map((list) => list.map(asPuppeteer)))

/** A cookie to set, in Puppeteer's words. `path` is `/` where the original leaves it to its default. */
interface CookieParam {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly httpOnly?: boolean | undefined
  readonly secure?: boolean | undefined
  readonly partitionKey?: CookieJar.PartitionKey | undefined
}

/** Puppeteer's `context.setCookie(...cookies)`, one cookie after another. */
const setContextCookies = (context: UserContext.UserContext, cookies: ReadonlyArray<CookieParam>) =>
  Effect.forEach(cookies, (cookie) =>
    context.cookies.set({
      name: cookie.name,
      value: cookie.value,
      scope: { domain: cookie.domain, path: cookie.path },
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      partitionKey: cookie.partitionKey
    }), { discard: true })

/** Puppeteer's `{ sourceOrigin, hasCrossSiteAncestor }` partition key, as Strider's `Partitioned` value. */
const partitioned = (topLevelSite: string, crossSiteAncestor?: boolean): CookieJar.PartitionKey => ({
  _tag: "Partitioned",
  topLevelSite: Url.Site.make(topLevelSite),
  crossSiteAncestor: crossSiteAncestor === undefined ? Option.none() : Option.some(crossSiteAncestor)
})

/** A filter for `deleteMatchingCookies`, in Puppeteer's words. */
interface Filter {
  readonly name: string
  readonly url?: string
  readonly domain?: string
  readonly path?: string
}

/**
 * Puppeteer's filter as Strider's `remove` match: `remove` takes a domain and a path, so a URL stands for its host and
 * path.
 */
const matchOf = (filter: Filter): CookieJar.Match => {
  const url = filter.url === undefined ? undefined : new URL(filter.url)
  return {
    name: filter.name,
    domain: filter.domain ?? url?.hostname,
    path: filter.path ?? url?.pathname
  }
}

/** `document.cookie` in the page's main world, as Puppeteer's `page.evaluate` reads it. */
const documentCookie = (page: Page.Page) => page.evaluateInMainWorld(() => document.cookie)

/** Puppeteer's `deleteMatchingCookies` filters, as the loop runs them, minus the one that removes by partition key. */
const filters: ReadonlyArray<Filter> = [
  { name: "cookie1" },
  { url: "https://example.test/test", name: "cookie1" },
  { domain: "example.test", name: "cookie1" },
  { path: "/test", name: "cookie1" }
]

/** Puppeteer's narrowing filters: each removes one of two cookies that share a name. */
const narrowingFilters: ReadonlyArray<Filter> = [
  { url: "https://example.test/test", name: "cookie1" },
  { domain: "example.test", name: "cookie1" },
  { path: "/test", name: "cookie1" }
]

upstream(import.meta.filename, {}, (test) => {
  test(
    "BrowserContext cookies BrowserContext.cookies should find no cookies in new context",
    { page: false },
    () =>
      Effect.scoped(Effect.gen(function*() {
        // Puppeteer's `browser.createBrowserContext()`, closed when the test ends
        const context = yield* Browser.newContext()
        assert.deepStrictEqual(yield* context.cookies.list, [])
      }))
  )

  test("BrowserContext cookies BrowserContext.cookies should find cookie created in page", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* page.evaluateInMainWorld(() => {
        document.cookie = "infoCookie = secret"
      })
      assert.deepStrictEqual(yield* contextCookies(page.context), [
        {
          name: "infoCookie",
          value: "secret",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          session: true
        }
      ])
    }))

  test("BrowserContext cookies BrowserContext.cookies should find partitioned cookie", ({ page }) =>
    Effect.gen(function*() {
      const topLevelSite = "https://example.test"
      yield* setContextCookies(page.context, [
        {
          name: "infoCookie",
          value: "secret",
          domain: new URL(topLevelSite).hostname,
          path: "/",
          httpOnly: false,
          secure: true,
          partitionKey: partitioned(topLevelSite, false)
        }
      ])
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      // Strider's partition is typed: the site, and whether a cross-site frame is above the cookie's one
      assert.deepStrictEqual(cookies[0]!.partitionKey, partitioned(topLevelSite, false))
    }))

  test("BrowserContext cookies BrowserContext.cookies should properly report \"Default\" sameSite cookie", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      const name = "defaultSameSite"
      // Puppeteer's sameSite "Default" is the browser's own default, which Strider's is when the call names none
      yield* setContextCookies(page.context, [{ name, value: "b", domain: "localhost", path: "/" }])
      const cookie = (yield* page.context.cookies.list).find((each) => each.name === name)
      assert.isDefined(cookie)
      // Different browsers have different sameSite values for the "Default" sameSite
      assert.include(["lax", undefined], Option.getOrUndefined(cookie!.sameSite))
      yield* page.context.cookies.remove({ name, domain: "localhost" })
    }))

  test("BrowserContext cookies BrowserContext.setCookie should set with undefined partition key", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setContextCookies(page.context, [
        { name: "infoCookie", value: "secret", domain: "localhost", path: "/", httpOnly: false, secure: false }
      ])
      yield* page.goto(server.EMPTY_PAGE, load)
      assert.strictEqual(yield* documentCookie(page), "infoCookie=secret")
    }))

  test("BrowserContext cookies BrowserContext.deleteCookies should delete cookies", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* setContextCookies(page.context, [
        { name: "cookie1", value: "1", domain: "localhost", path: "/", httpOnly: false, secure: false },
        { name: "cookie2", value: "2", domain: "localhost", path: "/", httpOnly: false, secure: false }
      ])
      assert.strictEqual(yield* documentCookie(page), "cookie1=1; cookie2=2")
      yield* page.context.cookies.remove({ name: "cookie1", domain: "localhost", path: "/" })
      assert.strictEqual(yield* documentCookie(page), "cookie2=2")
    }))

  test("BrowserContext cookies BrowserContext.deleteCookies should be able to delete \"Default\" sameSite cookie", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      const name = "deleteDefaultSameSite"
      yield* setContextCookies(page.context, [{ name, value: "b", domain: "localhost", path: "/" }])
      const cookies = yield* page.context.cookies.list
      assert.isDefined(cookies.find((cookie) => cookie.name === name))
      yield* page.context.cookies.remove({ name, domain: "localhost" })
      const cookiesAfter = yield* page.context.cookies.list
      assert.isUndefined(cookiesAfter.find((cookie) => cookie.name === name))
    }))

  for (const filter of filters) {
    test(
      "BrowserContext cookies BrowserContext.deleteMatchingCookies should delete cookies matching ${JSON.stringify(filter)}",
      { variant: JSON.stringify(filter) },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* page.goto(server.EMPTY_PAGE, load)
          assert.strictEqual((yield* page.context.cookies.list).length, 0)
          const topLevelSite = "https://example.test"
          // Puppeteer partitions these cookies on Chrome alone, where it can read the partition back
          const partition = browserName === "chromium" ? partitioned(topLevelSite, false) : undefined
          yield* setContextCookies(page.context, [
            {
              name: "cookie1",
              value: "secret",
              domain: new URL(topLevelSite).hostname,
              path: "/test",
              httpOnly: false,
              secure: true,
              partitionKey: partition
            },
            {
              name: "cookie2",
              value: "secret",
              domain: new URL(topLevelSite).hostname,
              path: "/test",
              httpOnly: false,
              secure: true,
              partitionKey: partition
            }
          ])
          assert.strictEqual((yield* page.context.cookies.list).length, 2)
          yield* page.context.cookies.remove(matchOf(filter))
          const cookies = yield* page.context.cookies.list
          assert.strictEqual(cookies.length, 1)
          assert.strictEqual(cookies[0]!.name, "cookie2")
        })
    )
  }

  for (const filter of narrowingFilters) {
    test(
      "BrowserContext cookies BrowserContext.deleteMatchingCookies should only delete cookies matching ${JSON.stringify(filter)}",
      { variant: JSON.stringify(filter) },
      ({ page, server }) =>
        Effect.gen(function*() {
          yield* page.goto(server.EMPTY_PAGE, load)
          yield* setContextCookies(page.context, [
            { name: "cookie1", value: "secret", domain: "example.test", path: "/test", httpOnly: false, secure: true },
            { name: "cookie1", value: "secret", domain: "other.test", path: "/other", httpOnly: false, secure: true }
          ])
          assert.strictEqual((yield* page.context.cookies.list).length, 2)
          yield* page.context.cookies.remove(matchOf(filter))
          const cookies = yield* page.context.cookies.list
          assert.strictEqual(cookies.length, 1)
          assert.strictEqual(cookies[0]!.domain, "other.test")
        })
    )
  }
})
