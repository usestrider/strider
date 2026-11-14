/**
 * Playwright's `tests/page/page-wait-for-function.spec.ts`: `page.waitForFunction`, which polls a predicate in the page
 * until it returns a truthy value.
 *
 * What the port changes:
 * - A wait on a page predicate is `Expect.that` over a read of the page's main world (`evaluateInMainWorld`), with a
 *   `Condition` for the truthy value. The polling is Expect's, not the page's: it checks once, then again each
 *   `Expect.CheckInterval` (100 ms unless `Expect.withCheckInterval` sets it). It does not check on animation frames,
 *   which is `polling: 'raf'`, so the tests about that mode aren't ported (see the ledger).
 * - Expect returns nothing, where the original's wait resolves with the value its predicate returned. Where the
 *   original reads that handle (WA-014), the port reads the value instead: `holding` keeps the value the condition
 *   accepted, which is the value the wait ended on. WA-015's window and WA-016's element don't cross by value, so
 *   their subjects are `page.evaluateHandle` handles, which run in the isolated world stock WebKit lacks (see the
 *   ledger). The handle stays bound to its element where a locator would look again, as the original's does.
 * - A predicate that throws fails the read, and Expect fails with that read's error at once, as the original's wait
 *   does. A read that fails is not retried, so WA-008 to WA-010 and WA-025 check the error the read raised.
 * - WA-018's `page.setDefaultTimeout(1)` is `Deadline.withDefaultBudget("1 millis")`, and WA-019's `timeout: 0` an
 *   endless default budget. A default budget applies only where no deadline encloses the call, and the harness
 *   encloses every test in one, so both waits run with `Deadline.CurrentDeadline` cleared.
 * - `page.waitForTimeout(42)` is Strider's `Effect.sleep` (matrix `method-page-waitfortimeout`), so WA-001 sleeps as the
 *   original does.
 * - `page.evaluate(…)` runs in the main world, so it's `page.evaluateInMainWorld`. A `page.addInitScript` is ported as
 *   written.
 * - WA-011's `server.setCSP` is `server.setExtraHeaders` with the same header (as page-evaluate does).
 * - A frame's wait (WA-026) reads the frame's body with `readText`, not an evaluation: a frame has no main-world
 *   evaluation, and stock WebKit has no isolated world for a frame's locator to evaluate in. The predicate never holds,
 *   as the original's `() => false` doesn't, so the wait ends only when the frame does.
 * - `page.on("console")` and the messages it collects are `ConsoleMessage.history(page)`, which is the page's log.
 * - WA-004's `polling: 100` is `Expect.withCheckInterval(100)`, which is also Expect's default, so the port can't tell
 *   the option from the default. WA-002 and WA-022 pass a string, and WA-006, WA-007, WA-012 and WA-013 use
 *   `polling` values Strider doesn't take; see the ledger.
 * - `detachFrame` is local to this port.
 */
import { assert } from "@effect/vitest"
import { Condition, ConsoleMessage, Deadline, Expect, Locator, Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { attachFrame, expectationFailure, failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's predicate returning a truthy value; the wait ends on the first observation that holds. */
const holds = Condition.make("to be true", (value: unknown) => value === true)

/**
 * A condition that also keeps the value it accepted. The original's wait resolves with that value, and Expect returns
 * nothing, so the test reads it from `held`.
 */
const holding = (description: string, predicate: (value: unknown) => boolean) => {
  const held: { value?: unknown } = {}
  const condition = Condition.make(description, (value: unknown) => {
    if (!predicate(value)) return false
    held.value = value
    return true
  })
  return { condition, held }
}

/** Playwright's `detachFrame(page, id)`: removes the iframe from the page's document. */
const detachFrame = (page: Page.Page, id: string) =>
  page.evaluateInMainWorld((id) => document.getElementById(id)!.remove(), id)

/** The polling interval of WA-004, which the original sets with `polling`. */
const polling = 100

upstream(import.meta.filename, {}, (test) => {
  test("WA-001", { page: false }, () =>
    Effect.gen(function*() {
      const startTime = Date.now()
      const timeout = 42
      // The original's `page.waitForTimeout`: Strider's `Effect.sleep`, the sleep the test is about
      yield* Effect.sleep(timeout)
      assert.isAtLeast(Date.now() - startTime, timeout / 2)
    }))

  test("WA-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(() => {
        Reflect.set(window, "__RELOADED", true)
      })
      // The read reloads the page on its first run and holds on the next, when the reload has landed. The read that
      // reloads may fail with the context it ran in, which the port surfaces as its failure.
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          if (!Reflect.get(window, "__RELOADED")) window.location.reload()
          return true
        }),
        holds
      )
    }))

  test("WA-004", ({ page }) =>
    Effect.gen(function*() {
      // The interval is `Expect.withCheckInterval`, the polling of an effect Expect re-runs. The page measures time
      // since its first check, as the original's `window.builtins.Date` does; the port calls `Date.now`, since this page
      // runs no injected copy.
      const { condition, held } = holding("a time since the first check", (value) => Boolean(value))
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          if (!Reflect.get(window, "__startTime")) {
            Reflect.set(window, "__startTime", Date.now())
            return false
          }
          return Date.now() - Reflect.get(window, "__startTime")
        }),
        condition
      ).pipe(Expect.withCheckInterval(polling))
      assert.isAtLeast(Number(held.value), polling)
    }))

  test("WA-005", ({ page }) =>
    Effect.gen(function*() {
      // The original counts the console messages each check logs, from a listener on the page
      const logged = Effect.map(ConsoleMessage.history(page), (history) => history.entries.length)
      const never = Condition.make("never", (_value: unknown) => false)
      const failure = yield* expectationFailure(
        Expect.that(
          page.evaluateInMainWorld(() => {
            Reflect.set(window, "counter", (Reflect.get(window, "counter") ?? 0) + 1)
            console.log(Reflect.get(window, "counter"))
            return false
          }),
          never
        ).pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "never")
      const savedCounter = yield* logged
      // The original's fixed wait: time for the check to produce more logs if it were to keep running
      yield* Effect.sleep("2 seconds")
      assert.strictEqual(yield* logged, savedCounter)
    }))

  test("WA-008", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        Expect.that(
          page.evaluateInMainWorld(() => {
            throw new Error("oh my")
          }),
          holds
        )
      )
      assert(Page.isPageError(error), String(error))
      assert.include(error.message, "oh my")
    }))

  test("WA-009", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        Expect.that(
          page.evaluateInMainWorld(() => {
            Reflect.set(window, "counter", (Reflect.get(window, "counter") ?? 0) + 1)
            if (Reflect.get(window, "counter") === 3) throw new Error("Bad counter!")
            return Reflect.get(window, "counter") === 5 ? "result" : false
          }),
          Condition.make("to be result", (value: unknown) => value === "result")
        )
      )
      assert(Page.isPageError(error), String(error))
      assert.include(error.message, "Bad counter!")
    }))

  test("WA-010", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        Expect.that(
          page.evaluateInMainWorld(() =>
            // @ts-expect-error globalVar is declared in no script of this page
            globalVar === 123
          ),
          holds
        )
      )
      assert(Page.isPageError(error), String(error))
      assert.include(error.message, "globalVar")
    }))

  test("WA-011", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `setCSP` sets this header, as page-evaluate's port does. The read runs as a Chrome DevTools command,
      // which the policy doesn't govern; the original's raf polling is Expect's interval here.
      server.setExtraHeaders("/empty.html", { "Content-Security-Policy": "script-src " + server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE)
      const waiting = yield* startWaiting(
        Expect.that(page.evaluateInMainWorld(() => Reflect.get(window, "__FOO") === "hit"), holds)
      )
      // The original's fixed wait, so the predicate has run and failed to hold before the write
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__FOO", "hit")
      })
      // The original's `.catch(e => error = e)` and `expect(error).toBe(null)`
      const result = yield* Effect.result(Fiber.join(waiting.fiber))
      assert.isTrue(Result.isSuccess(result))
    }))

  test("WA-014", ({ page }) =>
    Effect.gen(function*() {
      // The original reads the value through its handle, `jsonValue()`. The port reads the value the wait held for.
      const { condition, held } = holding("truthy", (value) => Boolean(value))
      yield* Expect.that(page.evaluateInMainWorld(() => 5), condition)
      assert.strictEqual(held.value, 5)
    }))

  test("WA-015", ({ page }) =>
    Effect.gen(function*() {
      // The window doesn't cross by value, so the wait's subject is a handle to it, which is what the original's wait
      // resolves with. The condition accepts any handle, as `toBeTruthy` does: a handle is a value the page kept.
      // `evaluateHandle` runs in the isolated world, which stock WebKit lacks (see the ledger).
      const { condition, held } = holding("truthy", (value) => Boolean(value))
      yield* Expect.that(page.evaluateHandle(() => window), condition)
      assert.isTrue(Boolean(held.value))
    }))

  test("WA-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      // The original's element handle: a handle stays bound to this element, where a locator would look again
      const div = yield* page.evaluateHandle(() => document.querySelector("div")!)
      const waiting = yield* startWaiting(Expect.that(div.evaluate((element) => !element.parentElement), holds))
      assert.isFalse(yield* waiting.done)
      yield* div.evaluate((element) => {
        element.remove()
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-017", ({ page }) =>
    Effect.gen(function*() {
      // The original's `timeout: 10`: a deadline around the wait. Strider's failure is an ExpectationFailed, not a
      // TimeoutError, and the port asserts that failure.
      const failure = yield* expectationFailure(
        Expect.that(page.evaluateInMainWorld(() => false), holds).pipe(Deadline.within("10 millis"))
      )
      assert.strictEqual(failure.condition, "to be true")
    }))

  test("WA-018", ({ page }) =>
    Effect.gen(function*() {
      // `page.setDefaultTimeout(1)` is a one-millisecond default budget, which a call gets when no deadline encloses it.
      // The harness encloses every test in one, so the wait runs outside it.
      const failure = yield* failureOf(
        Expect.that(page.evaluateInMainWorld(() => false), holds).pipe(
          Deadline.withDefaultBudget("1 millis"),
          Effect.provideService(Deadline.CurrentDeadline, Option.none())
        ),
        "the wait"
      )
      assert(Expect.isExpectationFailed(failure), String(failure))
      assert.strictEqual(failure.condition, "to be true")
    }))

  test("WA-019", ({ page }) =>
    Effect.gen(function*() {
      // `timeout: 0` is a wait with no deadline: an endless default budget, outside the harness's deadline. The wait
      // polls every 10 ms, as the original's `polling: 10`.
      const watchdog = yield* startWaiting(
        Expect.that(
          page.evaluateInMainWorld(() => {
            Reflect.set(window, "__counter", (Reflect.get(window, "__counter") ?? 0) + 1)
            return Boolean(Reflect.get(window, "__injected"))
          }),
          holds
        ).pipe(
          Expect.withCheckInterval(10),
          Deadline.withDefaultBudget(Duration.infinity),
          Effect.provideService(Deadline.CurrentDeadline, Option.none())
        )
      )
      yield* Expect.that(
        page.evaluateInMainWorld(() => Reflect.get(window, "__counter") > 10),
        holds
      )
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__injected", true)
      })
      yield* Fiber.join(watchdog.fiber)
    }))

  test("WA-020", ({ page, server }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(
        Expect.that(page.evaluateInMainWorld(() => Reflect.get(window, "__FOO") === 1), holds)
      )
      yield* page.goto(server.EMPTY_PAGE)
      assert.isFalse(yield* waiting.done)
      yield* page.reload()
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/grid.html")
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__FOO", 1)
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-021", ({ page, server }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(
        Expect.that(
          page.evaluateInMainWorld(() => Boolean(Reflect.get(window, "__done"))),
          Condition.make("to be set", (value: unknown) => value === true)
        )
      )
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.goto(server.PREFIX + "/consolelog.html")
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__done", true)
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("WA-023", ({ page }) =>
    Effect.gen(function*() {
      yield* Expect.that(
        page.evaluateInMainWorld(({ arg1, arg2 }: { arg1: number; arg2: number }) => arg1 + arg2 === 3, {
          arg1: 1,
          arg2: 2
        }),
        holds
      )
    }))

  test("WA-024", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          console.log("waitForFunction1")
          return true
        }),
        holds
      )
      yield* page.reload()
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          console.log("waitForFunction2")
          return true
        }),
        holds
      )
      yield* page.reload()
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          console.log("waitForFunction3")
          return true
        }),
        holds
      )
      const history = yield* ConsoleMessage.history(page)
      const messages = history.entries.map((message) => message.text).filter((text) =>
        text.startsWith("waitForFunction")
      )
      assert.strictEqual(messages.join("|"), "waitForFunction1|waitForFunction2|waitForFunction3")
    }))

  test("WA-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The original's `.catch(e => null)`: each wait's error is expected and ignored
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          console.log("waitForFunction1")
          throw new Error("waitForFunction1")
        }),
        holds
      ).pipe(Effect.ignore)
      yield* page.reload()
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          console.log("waitForFunction2")
          throw new Error("waitForFunction2")
        }),
        holds
      ).pipe(Effect.ignore)
      yield* page.reload()
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          console.log("waitForFunction3")
          throw new Error("waitForFunction3")
        }),
        holds
      ).pipe(Effect.ignore)
      const history = yield* ConsoleMessage.history(page)
      const messages = history.entries.map((message) => message.text).filter((text) =>
        text.startsWith("waitForFunction")
      )
      assert.strictEqual(messages.join("|"), "waitForFunction1|waitForFunction2|waitForFunction3")
    }))

  test("WA-026", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      // The frame's predicate never holds, as the original's `() => false` doesn't
      const waiting = yield* startWaiting(
        Expect.that(frame.locator("body").readText, Condition.make("never", (_text: string) => false))
      )
      yield* detachFrame(page, "frame1")
      // Strider's frame locator finds no iframe once it's detached, which is its NoMatch, as frame-evaluate's port asserts
      const error = yield* failureOf(Fiber.join(waiting.fiber), "the wait")
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason instanceof Locator.NoMatch, String(error.reason))
    }))
})
