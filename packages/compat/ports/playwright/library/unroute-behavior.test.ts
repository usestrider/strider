/**
 * Playwright's `tests/library/unroute-behavior.spec.ts`: removing routes while their handlers are still running, and
 * closing a page or context whose routes are waiting on a request.
 *
 * What the port changes:
 * - `unroute(pattern, handler)` removes a route by its registration, as `registration.remove` does (the matrix's
 *   `method-page-unroute` and `method-browsercontext-unroute`). `unrouteAll()` removes each registration the test holds.
 * - RO-186's second handler counts only the request for the page itself: Chromium also asks for `/favicon.ico`, which a
 *   context's routes (not a page's) see, and counting it passes the test while the navigation's handler never ran.
 * - Strider's `remove` interrupts a handler still running, where Playwright's `unroute` leaves it to finish. RO-186 and
 *   RO-192 keep the original's assertion that the removed handler's `route.fallback()` reaches the next route, so they
 *   fail on Strider: the handler is interrupted at `remove`, and the request continues by default.
 * - A handler that returns no decision (the original's `route.continue()`, `route.fallback()`, or `route.abort()`) returns
 *   the matching decision: `Route.continue`, `Route.fallthrough`, or `Route.abort()`. A handler that only sets a flag, or
 *   only signals, returns `Route.fallthrough` after it, since a Strider handler that returns nothing is a failure.
 * - Playwright's `page.goto` and `context.newPage` wait for `load` by default; Strider's default is `commit`, so each
 *   navigation the original awaits passes `waitUntil: "load"`.
 * - The original's `new Promise(f => routeCallback = f)` pairs are `Deferred`s: the handler signals, and the test awaits.
 *   A handler the original leaves pending on a promise that never settles is `Effect.never` after its signal.
 * - Playwright's `page.goto(...)` and `page.evaluate(...)` that the original forks are `Effect.forkChild`, joined where the
 *   original awaits them.
 * - RO-191's `context.close()` is the end of the scope that owns the context (`Browser.newContext` in `Effect.scoped`).
 * - Strider has no `unrouteAll({ behavior })` option, and removing a registration never waits for its handler. RO-189 and
 *   RO-195 (`ignoreErrors`) are ported for that: both registrations are removed while a handler is pending, the removal
 *   doesn't wait, and the handler's later failure and the removed handlers don't matter. (Strider interrupts the handler at
 *   `remove`, so its failure never happens.) RO-188, RO-194, RO-200, and RO-201 (`wait`) aren't ported (see the ledger).
 * - RO-197 to RO-199 hold a route's handler, close the page, then let the handler decide `Route.continue`,
 *   `Route.fallthrough`, or `Route.fulfill(...)`, where the original calls the method on the route it kept. A decision that
 *   can't be applied to the closed page mustn't fail anything, which is all the original asserts too.
 * - The original's `RegExp` patterns are the globs that match the same requests, as in browsercontext-route's RO-166.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkResponse, Page, PageNavigation, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** The response a navigation carried, when it had one. */
const responseOf = (navigation: PageNavigation.PageNavigation): Option.Option<NetworkResponse.NetworkResponse> =>
  navigation._tag === "Committed" || navigation._tag === "NoContent" ? navigation.response : Option.none()

/** Whether a navigation's response was 2xx, as Playwright's `response.ok()` reports it. */
const isOk = (navigation: PageNavigation.PageNavigation): boolean =>
  Option.match(responseOf(navigation), {
    onNone: () => false,
    onSome: (response) => response.status >= 200 && response.status <= 299
  })

/** A handler that records that it ran, then passes the request on, as the original's `route.fallback()` does. */
const passingAfter = (mark: () => void) => Effect.sync(mark).pipe(Effect.andThen(Route.fallthrough))

/**
 * A handler the test holds on `release`, which decides `decision` once released: the original keeps the route and calls
 * `route.continue()`, `route.fallback()`, or `route.fulfill()` after its page closed. `decided` is signalled as the decision
 * is handed back.
 */
const decidingLater = Effect.fnUntraced(function*(
  seen: Deferred.Deferred<void>,
  release: Deferred.Deferred<void>,
  decided: Deferred.Deferred<void>,
  decision: Effect.Effect<Route.Decision<"request">>
) {
  yield* Deferred.succeed(seen, undefined)
  yield* Deferred.await(release)
  const chosen = yield* decision
  yield* Deferred.succeed(decided, undefined)
  return chosen
})

/**
 * RO-197 to RO-199: the page closes while its route's handler holds the request, then the handler decides. A decision that
 * can't be applied to a closed page must not fail anything, so the test ends cleanly with the navigation's own failure
 * ignored, as the original's `.catch(() => {})`.
 */
const decidesAfterClose =
  (decision: Effect.Effect<Route.Decision<"request">>) =>
  ({ page, server }: { readonly page: Page.Page; readonly server: { readonly EMPTY_PAGE: string } }) =>
    Effect.gen(function*() {
      const seen = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const decided = yield* Deferred.make<void>()
      yield* page.route("**/*", () => decidingLater(seen, release, decided, decision))
      yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.ignore), {
        startImmediately: true
      })
      yield* Deferred.await(seen)
      yield* page.close()
      // The original's `route.continue()` / `fallback()` / `fulfill()`, once the page has closed: "should not throw"
      yield* Deferred.succeed(release, undefined)
      yield* Deferred.await(decided)
    })

upstream(import.meta.filename, {}, (test) => {
  test("RO-186", ({ page, server }) =>
    Effect.gen(function*() {
      // Chromium also asks for `/favicon.ico`, which only a context's routes see: the second handler counts only the
      // navigation's own request, so a request it saw for something else can't stand in for it
      let secondHandlerCalled = false
      yield* page.context.route("**/*", (route) =>
        Effect.sync(() => {
          if (route.request.url === server.EMPTY_PAGE) secondHandlerCalled = true
        }).pipe(Effect.andThen(Route.continue)))
      const routeSeen = yield* Deferred.make<void>()
      const barrier = yield* Deferred.make<void>()
      const registration = yield* page.context.route("**/*", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(routeSeen, undefined)
          yield* Deferred.await(barrier)
          return yield* Route.fallthrough
        }))
      const navigation = yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), {
        startImmediately: true
      })
      yield* Deferred.await(routeSeen)
      // `context.unroute(…, handler)`: the handler is still running when its registration is removed
      yield* registration.remove
      yield* Deferred.succeed(barrier, undefined)
      yield* Fiber.join(navigation)
      assert.isTrue(secondHandlerCalled)
    }))

  test("RO-187", ({ page, server }) =>
    Effect.gen(function*() {
      const first = yield* page.context.route("**/*", () => Route.abort())
      const second = yield* page.context.route("**/empty.html", () => Route.abort())
      // `context.unrouteAll()` removes each registration
      yield* first.remove
      yield* second.remove
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
    }))

  test("RO-189", ({ page, server }) =>
    Effect.gen(function*() {
      // Chromium also asks for `/favicon.ico`, which only a context's routes see: only the navigation's request counts
      let secondHandlerCalled = false
      const second = yield* page.context.route("**/*", (route) =>
        Effect.sync(() => {
          if (route.request.url === server.EMPTY_PAGE) secondHandlerCalled = true
        }).pipe(Effect.andThen(Route.abort())))
      const routeSeen = yield* Deferred.make<void>()
      const barrier = yield* Deferred.make<void>()
      const pending = yield* page.context.route("**/*", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(routeSeen, undefined)
          yield* Deferred.await(barrier)
          return yield* Effect.fail("Handler error")
        }))
      const navigation = yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), {
        startImmediately: true
      })
      yield* Deferred.await(routeSeen)
      // `context.unrouteAll({ behavior: 'ignoreErrors' })`: removing the registrations doesn't wait for the handler
      yield* pending.remove
      yield* second.remove
      yield* Deferred.succeed(barrier, undefined)
      yield* Effect.exit(Fiber.join(navigation))
      // The error in the removed handler is silently dropped, and the removed handlers aren't called
      assert.isFalse(secondHandlerCalled)
    }))

  test("RO-190", ({ page, server }) =>
    Effect.gen(function*() {
      const routeSeen = yield* Deferred.make<void>()
      // The context's handler is still pending when the page closes: it signals, then never decides
      yield* page.context.route("**/*", () => Deferred.succeed(routeSeen, undefined).pipe(Effect.andThen(Effect.never)))
      // The page's own route falls back to the context's
      yield* page.route("**/*", () => Route.fallthrough)
      yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.ignore), {
        startImmediately: true
      })
      yield* Deferred.await(routeSeen)
      // Completing is the check: a close that waited for the pending handler would run out of the test's deadline
      yield* page.close()
    }))

  test("RO-191", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const routeSeen = yield* Deferred.make<void>()
      // The context is closed when this scope ends, as `context.close()` is. Its page's route is still pending then.
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.route("**/*", () => Deferred.succeed(routeSeen, undefined).pipe(Effect.andThen(Effect.never)))
        yield* page.route("**/*", () => Route.fallthrough)
        yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.ignore), {
          startImmediately: true
        })
        yield* Deferred.await(routeSeen)
      }))
    }))

  test("RO-192", ({ page, server }) =>
    Effect.gen(function*() {
      let secondHandlerCalled = false
      yield* page.route("**/*", () =>
        Effect.sync(() => {
          secondHandlerCalled = true
        }).pipe(Effect.andThen(Route.continue)))
      const routeSeen = yield* Deferred.make<void>()
      const barrier = yield* Deferred.make<void>()
      const registration = yield* page.route("**/*", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(routeSeen, undefined)
          yield* Deferred.await(barrier)
          return yield* Route.fallthrough
        }))
      const navigation = yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), {
        startImmediately: true
      })
      yield* Deferred.await(routeSeen)
      // `page.unroute(…, handler)`: the handler is still running when its registration is removed
      yield* registration.remove
      yield* Deferred.succeed(barrier, undefined)
      yield* Fiber.join(navigation)
      assert.isTrue(secondHandlerCalled)
    }))

  test("RO-193", ({ page, server }) =>
    Effect.gen(function*() {
      const first = yield* page.route("**/*", () => Route.abort())
      const second = yield* page.route("**/empty.html", () => Route.abort())
      // `page.unrouteAll()` removes each registration
      yield* first.remove
      yield* second.remove
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(isOk(navigation))
    }))

  test("RO-195", ({ page, server }) =>
    Effect.gen(function*() {
      let secondHandlerCalled = false
      const second = yield* page.route("**/*", () =>
        Effect.sync(() => {
          secondHandlerCalled = true
        }).pipe(Effect.andThen(Route.abort())))
      const routeSeen = yield* Deferred.make<void>()
      const barrier = yield* Deferred.make<void>()
      const pending = yield* page.route("**/*", () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(routeSeen, undefined)
          yield* Deferred.await(barrier)
          return yield* Effect.fail("Handler error")
        }))
      const navigation = yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), {
        startImmediately: true
      })
      yield* Deferred.await(routeSeen)
      // `page.unrouteAll({ behavior: 'ignoreErrors' })`: removing the registrations doesn't wait for the handler
      yield* pending.remove
      yield* second.remove
      yield* Deferred.succeed(barrier, undefined)
      yield* Effect.exit(Fiber.join(navigation))
      // The error in the removed handler is silently dropped, and the removed handlers aren't called
      assert.isFalse(secondHandlerCalled)
    }))

  test("RO-196", ({ page, server }) =>
    Effect.gen(function*() {
      let secondHandlerCalled = false
      // The original's listener returns its flag, which Playwright ignores; a Strider handler returns the fallthrough
      yield* page.route("**/*", () =>
        passingAfter(() => {
          secondHandlerCalled = true
        }))
      const routeSeen = yield* Deferred.make<void>()
      yield* page.route("**/*", () => Deferred.succeed(routeSeen, undefined).pipe(Effect.andThen(Effect.never)))
      yield* Effect.forkChild(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.ignore), {
        startImmediately: true
      })
      yield* Deferred.await(routeSeen)
      yield* page.close()
      // The original's own 500 ms wait, ported as written
      yield* Effect.sleep("500 millis")
      assert.isFalse(secondHandlerCalled)
    }))

  test("RO-197", decidesAfterClose(Route.continue))

  test("RO-198", decidesAfterClose(Route.fallthrough))

  test("RO-199", decidesAfterClose(Route.fulfill(HttpServerResponse.empty())))
})
