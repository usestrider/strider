/**
 * Playwright's `tests/page/page-wait-for-response.spec.ts`: waiting for a response by its URL, by a predicate (sync or
 * async, the async one reading the body), and by a regular expression, and what a wait reports when it times out.
 *
 * What the port changes:
 * - `page.waitForResponse(url)` and `page.waitForEvent("response", predicate)` are `NetworkResponse.next`, subscribed
 *   before the action that causes the responses, and read after it. A wait keeps what arrives until its first match, so
 *   reading it after the action is what the original's `Promise.all` does.
 * - A predicate that reads the body is a `NetworkResponse.next` with a `body` decoder, whose `where` predicate reads
 *   `response.body`. Playwright's `response.text()` is that decoder's text (WA-134).
 * - Strider's URL filter is a glob, a `URLPattern`, or an exact URL, and takes no regular expression. A wait with a
 *   predicate uses the glob `**`, and the predicate does the matching. WA-132's second regular expression, which is
 *   case-insensitive, is applied the same way.
 * - A timeout is `Deadline.within` around the wait, and `page.setDefaultTimeout` is `defaultTimeout`. Strider's `Timeout`
 *   names the operation and the phase it timed out in, and carries its budget. WA-130 and WA-131 check those, where
 *   Playwright checks its error class, and WA-131 its JavaScript stack, which names this file. Its message names neither
 *   the pattern nor the URL, and nothing else on it does, so WA-132 asserts that the hint names the URL, as the
 *   original's message does, and fails on it. For the second wait, whose filter is a predicate, it asserts the hint
 *   names the glob the predicate was given.
 * - `timeout: 0` means no timeout in Playwright. The wait here has the harness's 30-second budget for the test instead.
 * - `window.builtins.setTimeout` is the page's own `setTimeout`, which does the same wait in the page's main world.
 * - Playwright's `page.evaluate` is `page.evaluateInMainWorld`.
 * - The browser's own `/favicon.ico` response is reported by Strider and not by Playwright. WA-135 counts the responses its
 *   predicate sees, so it leaves that one out of the count.
 */
import { assert } from "@effect/vitest"
import { Deadline, NetworkResponse } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { defaultTimeout, failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A wait for a response that Playwright's test expects to time out: its timeout as Strider's `Timeout`, for `operation`. */
const waitTimeout = (error: unknown, operation: string): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, operation)
  assert.strictEqual(error.phase, "waitingForEvent")
  return error
}

/** What a timeout says the wait was for: Strider's `Timeout` has no field for the filter, so this is its hint. */
const waitedFor = (timeout: Deadline.Timeout) => Option.getOrElse(timeout.hint, () => "")

upstream(import.meta.filename, {}, (test) => {
  test("WA-129", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/digits/2.png" })
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))

  test("WA-130", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        NetworkResponse.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 millis")
        ),
        "the wait"
      )
      waitTimeout(error, "NetworkResponse.next")
    }))

  test("WA-131", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `setDefaultTimeout(1)` applies to a wait given no timeout of its own
      const error = yield* failureOf(
        defaultTimeout("1 millis")(
          NetworkResponse.next(page, { url: "**" }, () => Effect.succeed(false)).pipe(
            Effect.flatMap((wait) => wait)
          )
        ),
        "the wait"
      )
      waitTimeout(error, "NetworkResponse.next")
    }))

  test("WA-132", ({ page }) =>
    Effect.gen(function*() {
      const error1 = yield* failureOf(
        NetworkResponse.next(page, { url: "foo.css" }).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 second")
        ),
        "the first wait"
      )
      const timeout1 = waitTimeout(error1, "NetworkResponse.next")
      // Strider's `Timeout` carries no filter, so the closest check is that its hint names the URL
      assert.include(waitedFor(timeout1), "foo.css")
      const error2 = yield* failureOf(
        NetworkResponse.next(page, { url: "**" }, (response) => Effect.succeed(/foo.css/i.test(response.url))).pipe(
          Effect.flatMap((wait) => wait),
          Deadline.within("1 second")
        ),
        "the second wait"
      )
      const timeout2 = waitTimeout(error2, "NetworkResponse.next")
      // A predicate has no text to name, so the closest check is that the hint names the URL filter the wait was given
      assert.include(waitedFor(timeout2), "**")
    }))

  test("WA-133", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: "**" }, (response) =>
        Effect.succeed(response.url === server.PREFIX + "/digits/2.png"))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/digits/1.png")
        void fetch("/digits/2.png")
        void fetch("/digits/3.png")
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))

  test("WA-134", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Each wait reads the body before its predicate, as the original's `response.text()` does
      const fileResponse = yield* NetworkResponse.next(page, {
        url: "**",
        body: (message) => message.text
      }, (response) => Effect.succeed(response.body.includes("contents of the file")))
      const jsonResponse = yield* NetworkResponse.next(page, {
        url: "**",
        body: (message) => message.text
      }, (response) => Effect.succeed(response.body.includes("bar")))
      yield* page.evaluateInMainWorld(() => {
        void fetch("/simple.json").then((r) => r.json())
        void fetch("/file-to-upload.txt").then((r) => r.text())
      })
      assert.strictEqual((yield* fileResponse).url, server.PREFIX + "/file-to-upload.txt")
      assert.strictEqual((yield* jsonResponse).url, server.PREFIX + "/simple.json")
    }))

  test("WA-135", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      let counter = 0
      const response = yield* NetworkResponse.next(page, { url: "**" }, (response) =>
        Effect.sync(() => {
          // The browser's own `/favicon.ico` isn't a response Playwright reports, so it isn't counted
          if (new URL(response.url).pathname !== "/favicon.ico") ++counter
          return response.url === server.PREFIX + "/digits/1.png"
        }))
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/digits/1.png")
        await fetch("/digits/2.png")
        await fetch("/digits/3.png")
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/1.png")
      assert.strictEqual(counter, 1)
    }))

  test("WA-136", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `timeout: 0` waits without a limit; this wait has the test's own budget, which the test finishes well within
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/digits/2.png" })
      // Playwright's `window.builtins.setTimeout`, a copy of the page's own timer: the page's `setTimeout` here
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          void fetch("/digits/1.png")
          void fetch("/digits/2.png")
          void fetch("/digits/3.png")
        }, 50)
      })
      assert.strictEqual((yield* response).url, server.PREFIX + "/digits/2.png")
    }))
})
