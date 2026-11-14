/**
 * Playwright's `tests/library/page-event-crash.spec.ts`: a crashed page's close, its failed actions and waits, and what
 * closing its context or page does afterwards.
 *
 * What the port changes:
 * - Strider has no crash API, and the public API offers no way to send `Page.crash` to a page. The only trigger the
 *   port uses is Chromium's `chrome://crash` navigation, which the original uses on Chromium. So each test runs on
 *   Chromium only, and the ledger marks Firefox and WebKit needsFeature. The original's `page.goto('chrome://crash')`
 *   isn't awaited, so `crash` starts it and ignores its failure.
 * - `page.on('crash')` and `page.waitForEvent('crash')` are the page's `closed` signal, which gives the reason the page
 *   ended. A crash's reason is `PageCrashed`.
 * - Where the original checks an error's message for "crashed", the port checks Strider's typed failure: a
 *   `TargetGone` whose reason is `PageCrashed`.
 * - `page.waitForNavigation({ waitUntil: 'domcontentloaded' })` is the page's status once the new document, not the
 *   one it replaces, has parsed.
 * - `expect(locator).toBeVisible()`, not awaited, is `Expect.toBeVisible`, started before the crash. `waitForEvent('response')`
 *   and the navigation are started before the crash, as the original's promises are.
 * - ER-019 closes its context by ending the scope that holds it, and checks the context has ended.
 * - ER-020 keeps the original's fixed three-second wait. Strider ends a crashed page with its crash as the reason, so
 *   where the original checks that the page isn't closed, the port checks the reason is the crash and not a close by a
 *   command. It asserts, as the original does, that the context still lists the crashed page and that `close()` then
 *   empties the list.
 * - ER-021's worker is the page's dedicated worker: `page.workers` is watched for it, and its `closed` signal and
 *   `evaluate` are the worker's. Chromium may detach the worker before reporting the crash, so the failure may also be
 *   a close, as the original's message allows.
 * - The original skips Chromium on Ubuntu 24.04 and WebKit on Debian 13 for hosts that never dispatch the crash event.
 *   The port runs on the pinned environment, which is neither host, so those skips don't apply.
 */
import { assert } from "@effect/vitest"
import { Browser, Expect, NetworkResponse, Page, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * The original's `page.goto('chrome://crash').catch(e => {})` on Chromium: started without waiting for it. It's detached,
 * so the test doesn't wait for the navigation to end; the page closing ends it.
 */
const crash = (page: Page.Page) => Effect.forkDetach(page.goto("chrome://crash").pipe(Effect.ignore))

/** The original's `expect(error.message).toContain('crashed')`: a failure of a page that crashed, by its reason. */
const crashedFailure = (failure: unknown) => {
  assert(Target.isTargetGone(failure), `the failure isn't a closed target: ${String(failure)}`)
  assert.strictEqual(failure.reason._tag, "PageCrashed")
}

/** The page's status once the document at `url` has parsed: `page.waitForNavigation({ waitUntil: 'domcontentloaded' })`. */
const parsedAt = (url: string) => (status: Page.Status) =>
  status._tag === "Open" && status.url === url && status.document.readiness !== "loading"

upstream(import.meta.filename, {}, (test) => {
  test("ER-014", { browsers: ["chromium"] }, ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>This page should crash</div>`)
      yield* crash(page)
      // `new Promise(f => page.on('crash', f))`: the page the crash event carries is the one the test holds
      const reason = yield* page.closed
      assert.strictEqual(reason._tag, "PageCrashed")
    }))

  test("ER-015", { browsers: ["chromium"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>This page should crash</div>`)
      yield* crash(page)
      yield* page.closed
      crashedFailure(yield* failureOf(page.evaluateInMainWorld(() => {}), "the evaluate"))
      crashedFailure(yield* failureOf(page.goto(server.EMPTY_PAGE), "the goto"))
      crashedFailure(yield* failureOf(page.reload(), "the reload"))
    }))

  test("ER-016", { browsers: ["chromium"] }, ({ page }) =>
    Effect.gen(function*() {
      // `expect(page.getByText('child')).toBeVisible()` isn't awaited; the crash ends it
      const expectation = yield* startWaiting(Expect.toBeVisible(page.getByText("child")))
      const t0 = Date.now()
      yield* crash(page)
      const result = yield* Fiber.join(expectation.fiber).pipe(Effect.result)
      console.log("PROBE expect ended", Date.now() - t0, JSON.stringify(result).slice(0, 500))
      assert.isTrue(Result.isFailure(result), "the expectation succeeded after the page crashed")
    }))

  test("ER-017", { browsers: ["chromium"] }, ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>This page should crash</div>`)
      // `page.waitForEvent('response').catch(e => e)`
      const response = yield* NetworkResponse.next(page, { url: "**/*" })
      const waiting = yield* startWaiting(Effect.result(response))
      yield* crash(page)
      const result = yield* Fiber.join(waiting.fiber)
      assert(Result.isFailure(result), "the response wait succeeded after the page crashed")
      crashedFailure(result.failure)
    }))

  test("ER-018", { browsers: ["chromium"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>This page should crash</div>`)
      // The stylesheet never answers, so the navigation waits on it
      server.setRoute("/one-style.css", () => {})
      const navigation = yield* startWaiting(Effect.result(page.goto(server.PREFIX + "/one-style.html", {
        waitUntil: "load"
      })))
      yield* page.status.waitFor(parsedAt(server.PREFIX + "/one-style.html"))
      yield* crash(page)
      const result = yield* Fiber.join(navigation.fiber)
      assert(Result.isFailure(result), "the navigation succeeded after the page crashed")
      crashedFailure(result.failure)
    }))

  test("ER-019", { browsers: ["chromium"], page: false }, () =>
    Effect.gen(function*() {
      // The original's `page.context().close()` is the end of the scope that holds the context, closed here by the test
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      const page = yield* context.newPage.pipe(Scope.provide(scope))
      yield* page.setContent(`<div>This page should crash</div>`)
      yield* crash(page)
      yield* page.closed
      yield* Scope.close(scope, Exit.void)
      // The context has ended, as it does when `context.close()` resolves
      const reason = yield* context.closed
      assert.strictEqual(reason._tag, "UserContextRemoved")
    }))

  test("ER-020", { browsers: ["chromium"] }, ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>This page should crash</div>`)
      yield* crash(page)
      yield* page.closed
      // Give the browser a chance to erroneously "close" the crashed page: the original's own wait, as written.
      yield* Effect.sleep("3 seconds")
      const reason = yield* page.closed
      assert.strictEqual(reason._tag, "PageCrashed")
      assert.isTrue((yield* page.context.pages).some((each) => each.id === page.id))
      yield* page.close()
      assert.lengthOf(yield* page.context.pages, 0)
    }))

  test("ER-021", { browsers: ["chromium"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `page.waitForEvent('worker')` with the worker created by the page's own script
      const created = yield* startWaiting(page.workers.waitFor((workers) => workers.length === 1))
      yield* page.evaluateInMainWorld(() => {
        new Worker(URL.createObjectURL(
          new Blob(["self.onmessage = () => {}"], { type: "application/javascript" })
        ))
      })
      const worker = (yield* Fiber.join(created.fiber))[0]!
      const closed = yield* startWaiting(worker.closed)
      // `worker.evaluate(() => new Promise(() => {})).catch(e => e)`: never resolves in the worker
      const evaluation = yield* startWaiting(
        Effect.result(worker.evaluate(() => new Promise(() => {})))
      )
      yield* crash(page)
      const result = yield* Fiber.join(evaluation.fiber)
      assert(Result.isFailure(result), "the worker's evaluate succeeded after the page crashed")
      // Chromium may detach the worker before it reports the crash, so a close is accepted too
      assert(Target.isTargetGone(result.failure), `the failure isn't a closed target: ${String(result.failure)}`)
      assert.isTrue(
        result.failure.reason._tag === "PageCrashed" || result.failure.reason._tag === "PageClosed",
        `the worker ended for another reason: ${result.failure.reason._tag}`
      )
      yield* Fiber.join(closed.fiber)
      assert.lengthOf(yield* page.workers, 0)
    }))
})
