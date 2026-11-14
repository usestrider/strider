/**
 * Playwright's `tests/page/page-wait-for-request.spec.ts`: waiting for a request by its URL, by a predicate, or by a
 * regular expression, and what a wait reports when it times out.
 *
 * What the port changes:
 * - `page.waitForRequest(url)` and `page.waitForEvent("request", predicate)` are `NetworkRequest.next`, subscribed before
 *   the action that sends the requests, and read after it. A wait is buffered until its first match, so reading it after
 *   the action is what the original's `Promise.all` does.
 * - Strider's URL filter is a glob, a `URLPattern`, or an exact URL, and takes no regular expression. A wait with a
 *   predicate uses the glob `**`, which matches every request, and the predicate does the matching. WA-127 and WA-132's
 *   regular expressions are applied this way.
 * - A timeout is `Deadline.within` around the wait, and `page.setDefaultTimeout` is `defaultTimeout`. Strider's `Timeout`
 *   names the operation and the phase it timed out in, and carries its budget, so WA-123 and WA-124 check those, where
 *   Playwright's checks its error class and its JavaScript stack, which names this file. Its message names neither the
 *   pattern nor the URL, and nothing else on it does (its hint is empty for an event wait that saw no request before
 *   the deadline), so WA-125 asserts that the hint names the URL, as the original's message does, and fails on it.
 * - `timeout: 0` means no timeout in Playwright. The wait here has the harness's 30-second budget for the test instead, since
 *   no deadline of its own is set.
 * - `window.builtins.setTimeout` is the page's own `setTimeout`, which does the same wait in the page's main world.
 * - Playwright's `page.evaluate` is `page.evaluateInMainWorld`.
 * - The browser's own `/favicon.ico` request is reported by Strider and not by Playwright, so a predicate that counts
 *   requests leaves it out (WA-122's and WA-127's waits filter on the URL and aren't affected).
 * - WA-128 passes a regular expression made in another JavaScript realm, which Playwright recognizes by its own check.
 *   Strider's URL filter takes no regular expression, so there is no realm check to run; it's in the ledger.
 */
import { assert } from "@effect/vitest"
import { Deadline, NetworkRequest } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { defaultTimeout, failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A wait for a request that Playwright's test expects to time out: its timeout as Strider's `Timeout`, for `operation`. */
const waitTimeout = (error: unknown, operation: string): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, operation)
  assert.strictEqual(error.phase, "waitingForEvent")
  return error
}

/** What a timeout says the wait was for: Strider's `Timeout` has no field for the filter, so this is its hint. */
const waitedFor = (timeout: Deadline.Timeout) => Option.getOrElse(timeout.hint, () => "")

upstream(import.meta.filename, {}, (test) => {
  test("WA-121", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* NetworkRequest.next(page, { url: server.PREFIX + "/digits/2.png" })
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("WA-122", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* NetworkRequest.next(page, { url: "**" }, (request) =>
        Effect.succeed(request.url === server.PREFIX + "/digits/2.png"))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("WA-123", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        NetworkRequest.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 millis")
        ),
        "the wait"
      )
      waitTimeout(error, "NetworkRequest.next")
    }))

  test("WA-124", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `setDefaultTimeout(1)` applies to a wait given no timeout of its own
      const error = yield* failureOf(
        defaultTimeout("1 millis")(
          NetworkRequest.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
            Effect.flatMap((wait) => wait)
          )
        ),
        "the wait"
      )
      waitTimeout(error, "NetworkRequest.next")
    }))

  test("WA-125", ({ page }) =>
    Effect.gen(function*() {
      const pattern = "long-long-long-long-long-long-long-long-long-long-long-long-long-long.css"
      const error = yield* failureOf(
        NetworkRequest.next(page, { url: pattern }).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 second")
        ),
        "the wait"
      )
      const timeout = waitTimeout(error, "NetworkRequest.next")
      // The original's message names the URL it waited for, truncated: `waiting for request "long-long-…"`. Strider's
      // `Timeout` carries no filter, so the closest check is that its hint names the URL
      assert.include(waitedFor(timeout), pattern)
    }))

  test("WA-126", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `timeout: 0` waits without a limit; this wait has the test's own budget, which the test finishes well within
      const request = yield* NetworkRequest.next(page, { url: server.PREFIX + "/digits/2.png" })
      // Playwright's `window.builtins.setTimeout`, a copy of the page's own timer: the page's `setTimeout` here
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          void fetch("/digits/1.png")
          void fetch("/digits/2.png")
          void fetch("/digits/3.png")
        }, 50)
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/2.png")
    }))

  test("WA-127", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original's regular expression, applied to each request's URL
      const request = yield* NetworkRequest.next(page, { url: "**" }, (request) =>
        Effect.succeed(/digits\/\d\.png/.test(request.url)))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
      })
      assert.strictEqual((yield* request).url, server.PREFIX + "/digits/1.png")
    }))
})
