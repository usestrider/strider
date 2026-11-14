/**
 * Playwright's `tests/library/browsercontext-clearcookies.spec.ts`: clearing a context's cookies, all of them or those
 * matching a name, a domain, or a path, and checking what the page still sees.
 *
 * What the port changes:
 * - `context.clearCookies()` is `cookies.clear`, and `context.cookies()` is `cookies.list`. `context.addCookies([...])` is
 *   one `cookies.set` per cookie: a `{ url }` cookie is `scope: { url }`, and one with a domain and path is
 *   `scope: { domain, path }`.
 * - `context.clearCookies({ name })` is `cookies.remove({ name })`, which is Strider's filtered removal. Its `Match`
 *   takes a name, and optionally a domain and a path, and removes only the cookies that match. Strider's `name` is
 *   exact, so the regular expression of CO-045 has no form and is ledgered, and CO-046 and CO-047 (domain and path
 *   alone) are ledgered too, because `Match` requires a name.
 * - `page.evaluate('document.cookie')` is `page.evaluateInMainWorld`, which reads the page's own cookies. A
 *   `page.goto` names `waitUntil: "load"`, Playwright's default. `page.reload()` is `page.reload`.
 * - `browser.newContext()` is `Browser.newContext()`, scoped with `Effect.scoped` so the second context closes with the
 *   test's own steps, as the original's `anotherContext.close()` does. CO-043 and CO-051 open no page: the contexts
 *   are their own.
 * - CO-049's `cookieStore` listener and its events are the page's, read back by `Expect.that` over a read, since
 *   Playwright's `jsonValue` of a handle reads the same array: the listener stores its events in a page global
 *   (`__cookieEvents`), which only this test reads. Playwright's `evaluateHandle` runs in the main world, where this
 *   listener is installed.
 * - CO-049's `isFrozenWebkit` skip is Playwright's frozen WebKit build, which Strider doesn't drive, so it isn't
 *   ported as a skip. Its Windows skip doesn't apply to any browser Strider runs.
 * - CO-050 is ledgered: its context accepts the fixture's self-signed certificate with `acceptInsecureCerts`, which
 *   Chromium refuses per context, and removal by name here has no partition key in `Match`.
 * - CO-051 sets a cookie with an empty name. Strider's `set` refuses an empty name as `InvalidInput` (the browser
 *   accepts it), so the port fails at its setup. It's ported as written and not ledgered; the failure is the test's
 *   result.
 */
import { assert } from "@effect/vitest"
import { Browser, Condition, Expect, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** The hostname of a fixture server URL, as Playwright's `new URL(server.PREFIX).hostname` reads it. */
const hostOf = (url: string) => new URL(url).hostname

/** `document.cookie` in the page's main world. */
const documentCookie = (page: Page.Page) => page.evaluateInMainWorld(() => document.cookie)

upstream(import.meta.filename, {}, (test) => {
  test("CO-042", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.cookies.set({ name: "cookie1", value: "1", scope: { url: server.EMPTY_PAGE } })
      assert.strictEqual(yield* documentCookie(page), "cookie1=1")
      yield* page.context.cookies.clear
      assert.deepStrictEqual(yield* page.context.cookies.list, [])
      yield* page.reload({ waitUntil: "load" })
      assert.strictEqual(yield* documentCookie(page), "")
    }))

  test("CO-043", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const anotherContext = yield* Browser.newContext()
      yield* context.cookies.set({ name: "page1cookie", value: "page1value", scope: { url: server.EMPTY_PAGE } })
      yield* anotherContext.cookies.set({ name: "page2cookie", value: "page2value", scope: { url: server.EMPTY_PAGE } })

      assert.strictEqual((yield* context.cookies.list).length, 1)
      assert.strictEqual((yield* anotherContext.cookies.list).length, 1)

      yield* context.cookies.clear
      assert.strictEqual((yield* context.cookies.list).length, 0)
      assert.strictEqual((yield* anotherContext.cookies.list).length, 1)

      yield* anotherContext.cookies.clear
      assert.strictEqual((yield* context.cookies.list).length, 0)
      assert.strictEqual((yield* anotherContext.cookies.list).length, 0)
    })))

  test("CO-044", ({ page, server }) =>
    Effect.gen(function*() {
      const domain = hostOf(server.PREFIX)
      yield* page.context.cookies.set({ name: "cookie1", value: "1", scope: { domain, path: "/" } })
      yield* page.context.cookies.set({ name: "cookie2", value: "2", scope: { domain, path: "/" } })
      yield* page.goto(server.PREFIX, { waitUntil: "load" })
      assert.strictEqual(yield* documentCookie(page), "cookie1=1; cookie2=2")
      yield* page.context.cookies.remove({ name: "cookie1" })
      assert.strictEqual(yield* documentCookie(page), "cookie2=2")
    }))

  test("CO-048", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.cookies.set({
        name: "cookie1",
        value: "1",
        scope: { domain: hostOf(server.PREFIX), path: "/" }
      })
      yield* page.context.cookies.set({
        name: "cookie1",
        value: "1",
        scope: { domain: hostOf(server.CROSS_PROCESS_PREFIX), path: "/" }
      })
      yield* page.goto(server.PREFIX, { waitUntil: "load" })
      assert.strictEqual(yield* documentCookie(page), "cookie1=1")
      yield* page.context.cookies.remove({ name: "cookie1", domain: hostOf(server.PREFIX) })
      assert.strictEqual(yield* documentCookie(page), "")
      yield* page.goto(server.CROSS_PROCESS_PREFIX, { waitUntil: "load" })
      assert.strictEqual(yield* documentCookie(page), "cookie1=1")
    }))

  test("CO-049", ({ page, server }) =>
    Effect.gen(function*() {
      const domain = hostOf(server.PREFIX)
      yield* page.context.cookies.set({ name: "keep_me", value: "1", scope: { domain, path: "/" } })
      yield* page.context.cookies.set({ name: "delete_me", value: "2", scope: { domain, path: "/" } })
      yield* page.goto(server.PREFIX, { waitUntil: "load" })

      // The original's `evaluateHandle` listener, in the main world, with its events kept in a page global
      yield* page.evaluateInMainWorld(() => {
        const events: Array<string> = []
        ;(window as unknown as { __cookieEvents: Array<string> }).__cookieEvents = events
        cookieStore.addEventListener("change", (event) => {
          for (const changed of event.changed) events.push(`changed ${changed.name}`)
          for (const deleted of event.deleted) events.push(`deleted ${deleted.name}`)
        })
      })

      yield* page.context.cookies.remove({ name: "delete_me" })
      // `expect.poll(() => eventsHandle.jsonValue())`: the events, read again until they're the expected ones
      yield* Expect.that(
        page.evaluateInMainWorld(() => (window as unknown as { __cookieEvents: Array<string> }).__cookieEvents),
        Condition.make(
          `equal ${JSON.stringify(["deleted delete_me"])}`,
          (value) => JSON.stringify(value) === JSON.stringify(["deleted delete_me"])
        )
      )
      assert.strictEqual(yield* documentCookie(page), "keep_me=1")
    }))

  test("CO-051", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.cookies.set({ name: "", value: "nameless", scope: { domain: "example.com", path: "/" } })
      yield* context.cookies.set({ name: "session", value: "secret", scope: { domain: "example.com", path: "/" } })
      yield* context.cookies.remove({ name: "" })
      assert.deepStrictEqual((yield* context.cookies.list).map((cookie) => cookie.name), ["session"])
    })))
})
