/**
 * Playwright's `tests/page/expect-timeout.spec.ts`: an expectation's timeout and its failure messages (EX-244 to
 * EX-252) and the expectations' cancellation (EX-253 to EX-257) are ported. EX-258 is `needsFeature` for an AbortSignal
 * that is aborted before the expectation starts (see the ledger).
 *
 * What the port changes:
 * - `{ timeout }` is `Deadline.within` around the expectation. Playwright's default expectation timeout is 5 seconds, so
 *   an expectation the original doesn't time runs under `expectDeadline`, as in locator-convenience.
 * - A `.catch(e => e)` of a failing expectation is `expectationFailure`, which asserts the failure is an
 *   `ExpectationFailed`. The failure's `condition` is the matcher's own words, and `observedValues` are what it saw,
 *   where Playwright's message prints "Expected", "Received", and "Timeout". Its message is `Expected <subject>
 *   <condition>`, not Playwright's report, so the port doesn't compare the report's text.
 * - Where the original reads an element's text, Strider observes the text (`readText`); where the element is missing,
 *   it observes `{ matches: 0 }`, as in expect-to-have-text.
 * - EX-248's `waitForSelector` with a timeout is a `toBeVisible` expectation: the default state of `waitForSelector` is
 *   `visible`. Its error name `TimeoutError` is Playwright's; Strider's failure is an `ExpectationFailed` with the
 *   condition `to be visible`.
 * - EX-249's `expect(...)` promise is `startWaiting`, which runs it at once; the original's navigation and `setContent`
 *   happen between its start and its join.
 * - EX-250 and EX-251 register a locator handler first. A handler's trigger that shows (EX-251's `div`) holds the
 *   expectation until it is hidden, so the expectation runs out its 3 seconds; the port asserts Strider's
 *   `ExpectationFailed` of the matcher, and that its message names the locator handler, where Playwright's message
 *   says "locator handler has finished, waiting for locator('div') to be hidden" in its call log.
 * - EX-252's `window.builtins.setTimeout` is Playwright's own timer; the port schedules the same callback with
 *   `window.setTimeout`, in the main world.
 * - EX-246 and EX-247 run an expectation under a 1 ms deadline. Strider's expectation sends its first check to the page
 *   within the deadline, so one that is already over ends with an empty history and no observed value, where Playwright's
 *   always makes one check and quotes what it saw. The port asserts the original's observations, so these two fail.
 * - EX-253 to EX-257 cancel an expectation with `controller.abort(...)`: here the expectation runs in a child fiber
 *   (`startWaiting`), which the port interrupts after the original's own wait (`page.waitForTimeout(500)` or `(300)`,
 *   kept as `Effect.sleep`), the way Strider cancels any operation. The port asserts that the interruption ends the
 *   expectation, as an interruption, long before its 5-second deadline. Playwright's abort fails the expectation with a
 *   message holding the signal's reason; Strider's interruption fails with nothing, so the message's text, and the
 *   "not an AbortError" name check, have no counterpart to assert.
 */
import { assert } from "@effect/vitest"
import { AriaPattern, Deadline, Expect } from "@usestrider/browser"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { expectationFailure, observedValues, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default expectation timeout, which an expectation the original doesn't time runs under. */
const expectDeadline = Deadline.within("5 seconds")

/**
 * The original's `controller.abort(...)` after a wait, as Strider cancels: the expectation runs in a child fiber, and
 * the port interrupts it after `delay`. The expectation must have been still waiting, and must end interrupted.
 */
const interruptedMidAssertion = Effect.fnUntraced(function*(
  expectation: Effect.Effect<void, unknown>,
  delay: Duration.Input
) {
  const waiting = yield* startWaiting(expectation)
  yield* Effect.sleep(delay)
  assert.isFalse(yield* waiting.done, "the expectation ended before it was aborted")
  yield* Fiber.interrupt(waiting.fiber)
  const exit = yield* Fiber.await(waiting.fiber)
  assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the expectation was interrupted, got ${String(exit)}`)
})

upstream(import.meta.filename, {}, (test) => {
  test("EX-244", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("no-such-thing").pipe(Expect.toHaveText("hey"), Deadline.within("1 second"))
      )
      // Playwright: "Locator: locator('no-such-thing')", "Expected: \"hey\"", "Error: element(s) not found"
      assert.strictEqual(failure.condition, "to have the text \"hey\"")
      assert.deepStrictEqual(observedValues(failure).at(0), { matches: 0 })
    }))

  test("EX-245", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveText("hey"), Deadline.within("1 second"))
      )
      // Playwright: "Expected: \"hey\"", "Received: \"Text content\""
      assert.strictEqual(failure.condition, "to have the text \"hey\"")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-246", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("no-such-thing").pipe(Expect.toHaveText("hey"), Deadline.within("1 millis"))
      )
      assert.strictEqual(failure.condition, "to have the text \"hey\"")
      assert.deepStrictEqual(observedValues(failure).at(0), { matches: 0 })
    }))

  test("EX-247", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveText("hey"), Deadline.within("1 millis"))
      )
      assert.strictEqual(failure.condition, "to have the text \"hey\"")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-248", ({ page }) =>
    Effect.gen(function*() {
      // The original's `waitForSelector` defaults to `visible`, which is `toBeVisible` here. Its `TimeoutError` name is
      // Playwright's; a timeout is Strider's `ExpectationFailed`.
      const failure = yield* expectationFailure(
        Expect.toBeVisible(page.locator("#not-found")).pipe(Deadline.within("1 millis"))
      )
      assert.strictEqual(failure.condition, "to be visible")
    }))

  test("EX-249", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>hello</div>`)
      const waiting = yield* startWaiting(
        page.locator("div").pipe(Expect.toHaveText("bye"), expectDeadline)
      )
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<div>bye</div>`)
      yield* Fiber.join(waiting.fiber)
    }))

  test("EX-250", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addLocatorHandler(page.locator("span"), () => Effect.void)
      yield* page.setContent(`<div>hello</div>`)
      const waiting = yield* startWaiting(
        page.locator("div").pipe(Expect.toHaveText("bye"), expectDeadline)
      )
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<div>bye</div>`)
      yield* Fiber.join(waiting.fiber)
    }))

  test("EX-251", ({ page }) =>
    Effect.gen(function*() {
      yield* page.addLocatorHandler(page.locator("div"), () => Effect.void)
      yield* page.setContent(`<div>hello</div><span>bye</span>`)
      const failure = yield* expectationFailure(
        page.locator("span").pipe(Expect.toHaveText("bye"), Deadline.within("3 seconds"))
      )
      // Playwright: "Expected: \"bye\"", "Received: \"\"", and the call log's "locator handler has finished, waiting for
      // locator('div') to be hidden"
      assert.strictEqual(failure.condition, "to have the text \"bye\"")
      assert.include(failure.message, "locator handler")
    }))

  test("EX-252", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id="target" style="display:none">content</div>`)
      // The original's `window.builtins.setTimeout` is Playwright's own timer; this is the same callback on the page's.
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          document.getElementById("target")!.style.display = "block"
        }, 1500)
      })
      yield* page.locator("#target").pipe(Expect.toBeVisible, Deadline.within("1800 millis"))
    }))

  test("EX-253", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>content</div>")
      yield* interruptedMidAssertion(
        page.locator("span").pipe(Expect.toBeVisible, Deadline.within("5 seconds")),
        "500 millis"
      )
    }))

  test("EX-254", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>content</div>")
      yield* interruptedMidAssertion(
        page.locator("span").pipe(Expect.toHaveText("missing"), Deadline.within("5 seconds")),
        "300 millis"
      )
    }))

  test("EX-255", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>content</div>")
      yield* interruptedMidAssertion(
        page.locator("span").pipe(Expect.toHaveCount(3), Deadline.within("5 seconds")),
        "300 millis"
      )
    }))

  test("EX-256", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>content</div>")
      // The original's snapshot is `- list`, which the body doesn't hold; any name matches here.
      yield* interruptedMidAssertion(
        page.locator("body").pipe(
          Expect.toMatchAria(AriaPattern.node("list", /.*/, AriaPattern.unchecked)),
          Deadline.within("5 seconds")
        ),
        "300 millis"
      )
    }))

  test("EX-257", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>content</div>")
      yield* interruptedMidAssertion(
        Expect.toHaveURL(page, "https://example.com/").pipe(Deadline.within("5 seconds")),
        "500 millis"
      )
    }))
})
