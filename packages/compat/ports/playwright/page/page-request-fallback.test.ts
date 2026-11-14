/**
 * Playwright's `tests/page/page-request-fallback.spec.ts`: what `route.fallback()` does when several routes match a
 * request, which route is asked first, and what a route that has already decided leaves for the others.
 *
 * What the port changes:
 * - `route.fallback()` is `Route.fallthrough`, which passes the request to the next route and runs no change. Each
 *   route records its number in the order it's asked, as the original's `intercepted` array does.
 * - The async routes (RO-122) wait 100 ms before they fall through, as the original does: the wait is the original's own,
 *   so it's ported as written.
 * - A route the original never calls (RO-123's first route, RO-124's first route) returns a decision that continues
 *   and sets its flag, so the test checks that it's never reached, as the original's `failed` flag does.
 * - RO-123 reads the body the page received, not `response.body()`: on Chromium a body a route fulfilled can't be read back
 *   through the navigation's response, so the page's text is what's checked.
 * - `page.goto` rejects with Strider's typed failure where the original's `.catch(e => e)` gets the error (RO-124): the
 *   failure is asserted to exist with `failureOf`.
 * - Not ported, in the ledger: RO-125 (a fulfill that throws on an invalid response), RO-126 (`times`), RO-127 to RO-133
 *   (the overrides `route.fallback` takes: headers, method, URL and post data, which `Route.fallthrough` doesn't take).
 */
import { assert } from "@effect/vitest"
import { type Page, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * A handler that records its number and passes the request on, as the original's `route.fallback()` does. The number is
 * the order in which the routes are asked.
 */
const passing = (intercepted: Array<number>, n: number) => () =>
  Effect.sync(() => {
    intercepted.push(n)
  }).pipe(Effect.andThen(Route.fallthrough))

/** The page's text, as the body it received: `page.locator("body")` read as text. */
const receivedText = (page: Page.Page) => page.locator("body").readText

upstream(import.meta.filename, {}, (test) => {
  test("RO-120", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.fallthrough)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
    }))

  test("RO-121", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<number> = []
      yield* page.route("**/empty.html", passing(intercepted, 1))
      yield* page.route("**/empty.html", passing(intercepted, 2))
      yield* page.route("**/empty.html", passing(intercepted, 3))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [3, 2, 1])
    }))

  test("RO-122", ({ page, server }) =>
    Effect.gen(function*() {
      const intercepted: Array<number> = []
      // The original's handlers wait 100 ms before they fall back: the wait is the original's own, ported as written
      const waiting = (n: number) => () =>
        Effect.sync(() => {
          intercepted.push(n)
        }).pipe(Effect.andThen(Effect.sleep("100 millis")), Effect.andThen(Route.fallthrough))
      yield* page.route("**/empty.html", waiting(1))
      yield* page.route("**/empty.html", waiting(2))
      yield* page.route("**/empty.html", waiting(3))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(intercepted, [3, 2, 1])
    }))

  test("RO-123", ({ page, server }) =>
    Effect.gen(function*() {
      let failed = false
      // The first route is never reached: the second fulfills the request, and the third falls back to it
      yield* page.route("**/empty.html", () =>
        Effect.sync(() => {
          failed = true
        }).pipe(Effect.andThen(Route.fallthrough)))
      yield* page.route("**/empty.html", () => Route.fulfill(HttpServerResponse.text("fulfilled")))
      yield* page.route("**/empty.html", () => Route.fallthrough)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Strider's Chromium can't read a fulfilled body back through the navigation's response, so the
      // page's text is what the page received
      assert.strictEqual(yield* receivedText(page), "fulfilled")
      assert.isFalse(failed)
    }))

  test("RO-124", ({ page, server }) =>
    Effect.gen(function*() {
      let failed = false
      // The first route is never reached: the second aborts the request, and the third falls back to it
      yield* page.route("**/empty.html", () =>
        Effect.sync(() => {
          failed = true
        }).pipe(Effect.andThen(Route.fallthrough)))
      yield* page.route("**/empty.html", () => Route.abort())
      yield* page.route("**/empty.html", () => Route.fallthrough)
      yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the navigation")
      assert.isFalse(failed)
    }))
})
