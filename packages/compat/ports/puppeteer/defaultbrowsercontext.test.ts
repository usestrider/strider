/**
 * Puppeteer's `test/src/defaultbrowsercontext.test.ts`: a page's cookies, read, set, and deleted in the context its test
 * creates.
 *
 * What the port changes:
 * - Puppeteer's hooks create a browser context for each test (`createBrowserContext`) and open its page there, so the
 *   name is Puppeteer's; the port makes the same context with `Browser.newContext()` and opens its page in it.
 * - `page.cookies()` is the context's `cookies.list`, which lists every cookie in the context; the test's context holds
 *   only the cookies it sets, as the original's does.
 * - `page.setCookie({ name, value })` has no URL, so it takes the page's: `cookies.set` names the page's URL in its scope.
 * - `page.deleteCookie({ name })` takes the page's domain and path. Strider's `cookies.remove` names the domain, `localhost`.
 * - Puppeteer's cookie `size` is the name's and the value's lengths together, which the port computes. `session` is
 *   whether the cookie has an expiry. Strider doesn't report `sourceScheme`, so the port doesn't compare it.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`.
 */
import { assert } from "@effect/vitest"
import { Browser, type CookieJar } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { upstream } from "../harness/upstream.ts"

/** The host of the fixture server's pages, which Puppeteer's cookies report as `domain`. */
const DOMAIN = "localhost"

/** A cookie in Puppeteer's shape: `expires` is -1 for a session cookie, as Puppeteer reports it. */
const asPuppeteer = (cookie: CookieJar.Cookie) => {
  const value = Redacted.value(cookie.value)
  return {
    name: cookie.name,
    value,
    domain: cookie.domain,
    path: cookie.path,
    expires: Option.match(cookie.expires, {
      onNone: () => -1,
      onSome: (when) => DateTime.toEpochMillis(when) / 1000
    }),
    size: cookie.name.length + value.length,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: Option.isNone(cookie.expires)
  }
}

/** The `username` cookie a page sets, in the shape the original expects. */
const username = {
  name: "username",
  value: "John Doe",
  domain: DOMAIN,
  path: "/",
  expires: -1,
  size: 16,
  httpOnly: false,
  secure: false,
  session: true
}

upstream(import.meta.filename, {}, (test) => {
  test(
    "DefaultBrowserContext page.cookies() should work",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(() => {
          document.cookie = "username=John Doe"
        })
        assert.deepStrictEqual((yield* context.cookies.list).map(asPuppeteer), [username])
      }))
  )

  test(
    "DefaultBrowserContext page.setCookie() should work",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* context.cookies.set({ name: "username", value: "John Doe", scope: { url: server.EMPTY_PAGE } })
        assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "username=John Doe")
        assert.deepStrictEqual((yield* context.cookies.list).map(asPuppeteer), [username])
      }))
  )

  test(
    "DefaultBrowserContext page.deleteCookie() should work",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* context.cookies.set({ name: "cookie1", value: "1", scope: { url: server.EMPTY_PAGE } })
        yield* context.cookies.set({ name: "cookie2", value: "2", scope: { url: server.EMPTY_PAGE } })
        assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "cookie1=1; cookie2=2")
        yield* context.cookies.remove({ name: "cookie2", domain: DOMAIN })
        assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "cookie1=1")
        assert.deepStrictEqual((yield* context.cookies.list).map(asPuppeteer), [
          { ...username, name: "cookie1", value: "1", size: 8 }
        ])
      }))
  )
})
