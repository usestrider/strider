/**
 * Playwright's `tests/library/page-close.spec.ts`: what a page's close does to the operations and waits on it.
 *
 * What the port changes:
 * - Playwright's `page.close()` runs no `beforeunload` handler unless asked; Strider's is the same, with
 *   `page.close({ runBeforeUnload: true })` to ask.
 * - A failed operation on a closed page says so as Strider's typed `TargetGone`, whose reason is `PageClosed` with `by`
 *   saying who closed the page. Where the original checks Playwright's `kTargetClosedErrorMessage` in the message,
 *   `closedBy` asserts that reason; where it checks that the message isn't a timeout, the port checks that the error
 *   isn't a `Deadline.Timeout`, which the reason already implies.
 * - Playwright's `page.waitForRequest`, `waitForResponse`, `waitForEvent('download')`, and `waitForEvent('dialog')` are
 *   the event modules' waits, `NetworkRequest.next`, `NetworkResponse.next`, `Download.next`, and `Dialog.next`,
 *   subscribed before the action that causes the event, as the original does.
 * - Playwright's `page.on('close')` and `page.waitForEvent('close')` are the `closed` signal. It gives the reason the
 *   page closed rather than the page, so the port asserts the reason, and the page is the one the test holds.
 * - `page.isClosed()` is the page's status: `Open` or `Closed`.
 * - Playwright's `page.evaluate` runs in the main world, which is `page.evaluateInMainWorld`. A frame has no main-world
 *   evaluation, so PA-042 evaluates in the frame's isolated world, as `locator.evaluate` does.
 * - Playwright's `kTargetClosedErrorMessage` and `window.builtins` (its own copy of `setTimeout`) have no Strider
 *   counterpart. The page here runs its own `window.setTimeout`, where the original calls `builtins.setTimeout`.
 * - Strider's `route` decides a paused request by the handler's return value, after the handler's effects have run.
 *   PA-055 therefore runs the close and the continue concurrently and returns the decision once both are done, where
 *   the original starts `route.continue()` and `page.close()` together without waiting for either. The close's
 *   outcome is read after the navigation, as the original's `await done` does.
 * - PA-051 asserts Playwright's rejection of `allHeaders()` on Chromium and WebKit, which Strider's `headersSent` ends
 *   differently by design (see the ledger).
 * - PA-041, PA-047, PA-053, and PA-054 aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Dialog, Download, Expect, NetworkRequest, NetworkResponse, Popup, Route, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Asserts a failed call's error says its page closed, and by which `by`: Strider's `TargetGone` with a `PageClosed`
 * reason. A timeout fails this too, so a closed page is never mistaken for an expectation that ran out of time.
 */
const closedFailure = (failure: unknown, by: "command" | "script") => {
  assert(Target.isTargetGone(failure), `the error isn't a closed target: ${String(failure)}`)
  assert(
    failure.reason._tag === "PageClosed" && failure.reason.by === by,
    `the page closed for another reason: ${failure.reason._tag}`
  )
}

/** Asserts a call failed because its page closed, as `closedFailure` does. */
const closedBy = (result: Result.Result<unknown, unknown>, by: "command" | "script") => {
  assert(Result.isFailure(result), "the call succeeded, where Playwright's rejects with its page closed")
  closedFailure(result.failure, by)
}

upstream(import.meta.filename, {}, (test) => {
  test("PA-039", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `evaluate` here makes its own `builtins` available; Strider has none, so this runs as a step with
      // no effect on the page
      yield* page.evaluateInMainWorld(() => "trigger builtins.setTimeout")
      yield* page.setContent(
        `<button onclick="window.setTimeout(() => alert(1))">alert</button>`
      )
      // The dialog is subscribed before the click, and a handler that never decides holds it open, as the original's
      // `dialog` listener does; without one, the page's default policy would decide it
      const dialog = yield* Dialog.next(page)
      yield* Dialog.handle(page, () => Effect.never)
      // `void page.click('button').catch(() => {})`: the click isn't awaited, and its failure is ignored
      yield* startWaiting(page.locator("button").click().pipe(Effect.ignore))
      yield* dialog
      yield* page.close()
    }))

  test("PA-040", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      // The original's `timeout: 100000` is not carried over: the close ends the expectation before any timeout could
      const [error] = yield* Effect.all([
        Effect.result(Expect.toHaveText(page.locator("div"), "hey")),
        page.close()
      ], { concurrency: "unbounded" })
      closedBy(error, "command")
    }))

  test("PA-042", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/hang", () => {})
      const requested = yield* server.waitForRequest("/hang")
      yield* page.setContent(`<iframe src="${server.PREFIX}/hang"></iframe>`, { waitUntil: "domContentLoaded" })
      yield* requested
      // `page.frames()[1].evaluate(...)`: the frame's evaluation, started before the close and read after it
      const frameError = yield* startWaiting(
        Effect.result(
          page.frame(page.locator("iframe")).locator(":root").evaluate(() => new Promise<void>(() => {}))
        )
      )
      const [pageError] = yield* Effect.all([
        Effect.result(page.evaluateInMainWorld(() => new Promise<void>(() => {}))),
        page.close()
      ], { concurrency: "unbounded" })
      closedBy(pageError, "command")
      closedBy(yield* Fiber.join(frameError.fiber), "command")
    }))

  test("PA-043", ({ page }) =>
    Effect.gen(function*() {
      assert.strictEqual((yield* page.status)._tag, "Open")
      yield* page.close()
      assert.strictEqual((yield* page.status)._tag, "Closed")
    }))

  test("PA-044", ({ page }) =>
    Effect.gen(function*() {
      // `waitForEvent('close')` hands over the page; the page's `closed` hands over why it closed
      const [reason] = yield* Effect.all([page.closed, page.close()], { concurrency: "unbounded" })
      assert(reason._tag === "PageClosed" && reason.by === "command", `closed for another reason: ${reason._tag}`)
    }))

  test("PA-045", ({ page, server }) =>
    Effect.gen(function*() {
      const request = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      const response = yield* NetworkResponse.next(page, { url: server.EMPTY_PAGE })
      const [requestResult, responseResult] = yield* Effect.all([
        Effect.result(request),
        Effect.result(response),
        page.close()
      ], { concurrency: "unbounded" })
      closedBy(requestResult, "command")
      closedBy(responseResult, "command")
    }))

  test("PA-046", ({ page }) =>
    Effect.gen(function*() {
      yield* Effect.all([page.close(), page.close()], { concurrency: "unbounded" })
      yield* page.close()
    }))

  test("PA-048", ({ page }) =>
    Effect.gen(function*() {
      const download = yield* Download.next(page)
      yield* page.close()
      closedBy(yield* Effect.result(download), "command")
    }))

  test("PA-049", ({ page }) =>
    Effect.gen(function*() {
      // As PA-044: the close signal gives the reason
      const [reason] = yield* Effect.all([page.closed, page.close()], { concurrency: "unbounded" })
      assert(reason._tag === "PageClosed" && reason.by === "command", `closed for another reason: ${reason._tag}`)
    }))

  test("PA-050", ({ page }) =>
    Effect.gen(function*() {
      // `.catch(e => {})` on both: the test passes when neither failure escapes
      yield* Effect.all([
        Effect.ignore(page.close()),
        Effect.ignore(page.mouse.click({ x: 1, y: 2 }))
      ], { concurrency: "unbounded" })
    }))

  test("PA-051", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      server.setRoute("/one-style.css", (_req, res) => {
        res.setHeader("Content-Type", "text/css")
      })
      const requested = yield* NetworkRequest.next(page, { url: "**/one-style.css" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "domContentLoaded" })
      const request = yield* requested
      // `req.response()` and `req.allHeaders()`: both are started before the close, and their failures are read after it
      const responseWait = yield* NetworkRequest.response(page, request)
      const headers = yield* startWaiting(Effect.result(NetworkRequest.headersSent(page, request)))
      yield* page.close()
      const responseError = yield* Effect.result(responseWait)
      assert(
        Result.isFailure(responseError),
        "the response resolved, where Playwright's rejects with its target closed"
      )
      const failure = responseError.failure
      assert(
        failure._tag === "RequestError" && failure.reason._tag === "ResponseUnavailable" &&
          failure.reason.why === "targetClosed",
        `the response wait failed for another reason: ${String(failure)}`
      )
      const headersResult = yield* Fiber.join(headers.fiber)
      // All headers are the same as "provisional" headers in Firefox.
      if (browserName === "firefox") {
        assert.isTrue(Result.isSuccess(headersResult) && headersResult.success["user-agent"] !== undefined)
      } else {
        // Playwright's `allHeaders()` rejects when the page closes before the raw headers arrive. Strider's
        // `headersSent` doesn't fail then: it gives the request event's headers (see the ledger)
        closedBy(headersResult, "command")
      }
    }))

  test("PA-052", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a target=_blank rel=noopener href="/one-style.html">yo</a>`)
      const popups = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* popups
      yield* popup.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      // The original listens for popups from here on; Strider's history of the page's popups shows whether one came
      // after the first, which would make a second entry
      const history = yield* Popup.history(page)
      assert.strictEqual(history.entries.length, 1)
      yield* page.close()
    }))

  test("PA-055", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's `await done` fails the test when the close or the continue throws; the handler hands over its
      // close's outcome, which is read after the navigation
      const closed = yield* Deferred.make<Result.Result<void, unknown>>()
      yield* page.route("**/*", () =>
        Effect.all([Effect.result(page.close()), Route.continue], { concurrency: "unbounded" }).pipe(
          Effect.tap(([result]) =>
            Deferred.succeed(closed, result)
          ),
          Effect.map(([, decision]) => decision)
        ))
      // The original doesn't check the navigation's result; a failed goto is the closed page's
      yield* Effect.ignore(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      const result = yield* Deferred.await(closed)
      assert(Result.isSuccess(result), `the close failed while a request was continuing: ${String(result)}`)
    }))

  test("PA-056", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Effect.andThen(page.close(), Route.continue))
      const error = yield* Effect.result(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }))
      // `toBeInstanceOf(Error)`: the navigation fails with the page's closed target, by the test's own close
      closedBy(error, "command")
    }))
})
