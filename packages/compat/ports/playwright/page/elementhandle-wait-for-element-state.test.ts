/**
 * Playwright's `tests/page/elementhandle-wait-for-element-state.spec.ts`: waiting for an element to reach a state:
 * visible, hidden, enabled, disabled, editable, or stable.
 *
 * What the port changes:
 * - Strider has no ElementHandle. `page.$("div")` is `page.locator("div")`, and `handle.waitForElementState(state)` is
 *   the matching `Expect` matcher on that locator: `toBeVisible`, `toBeHidden`, `toBeEnabled`, `toBeDisabled`, and
 *   `toBeEditable`. A handle stays on the element it was given, where a locator finds its match again, so the tests
 *   that remove the element (EH-115, EH-118, EH-119) differ; see the ledger.
 * - `handle.evaluate(el => …)` steps that change the page run in the main world with `evaluateInMainWorld`, against the
 *   same element, since the page's own state is what the test changes.
 * - A wait the original holds across steps (`const promise = handle.waitForElementState(…).then(() => done = true)`) is
 *   a child fiber started at once, joined where the original awaits it.
 * - `giveItAChanceToResolve(page)` is the harness's `rafraf(page, 5)`.
 * - EH-122's `waitForElementState('stable')` has no state matcher. `scrollIntoView` runs no check but stability, so it
 *   waits on the same condition: it stays pending while the button animates and returns once the box holds still.
 * - EH-114 checks Playwright's `Timeout 1000ms exceeded` message. Strider's wait fails with an `ExpectationFailed`
 *   that records its elapsed time and checks; the port asserts that typed failure, and that it took the one second.
 * - `page.evaluate` runs in the main world, so the page's own state is read there.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { failureOf, rafraf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `giveItAChanceToResolve(page)`: `rafraf(page, 5)`. */
const giveItAChanceToResolve = (page: Page.Page) => rafraf(page, 5)

upstream(import.meta.filename, {}, (test) => {
  test("EH-112", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='display:none'>content</div>`)
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeVisible(div))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("div") as HTMLElement).style.display = "block"
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("EH-113", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>content</div>`)
      yield* Expect.toBeVisible(page.locator("div"))
    }))

  test("EH-114", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='display:none'>content</div>`)
      const div = page.locator("div")
      // Playwright's `timeout: 1000` is the deadline on the wait
      const error = yield* failureOf(Expect.toBeVisible(div).pipe(Deadline.within("1 second")), "the wait")
      assert(Expect.isExpectationFailed(error), String(error))
      // Strider's wait records how long it ran, which is the one second the deadline allowed
      assert.isAtLeast(Duration.toMillis(error.elapsed), 900)
      assert.isAtMost(Duration.toMillis(error.elapsed), 1500)
    }))

  test("EH-116", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>content</div>`)
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeHidden(div))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("div") as HTMLElement).style.display = "none"
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("EH-117", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div></div>`)
      yield* Expect.toBeHidden(page.locator("div"))
    }))

  // EH-118 is ported: a hidden wait on an element that is removed passes, since no match is visible.
  test("EH-118", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>content</div>`)
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeHidden(div))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.remove()
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("EH-120", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button aria-disabled=true><span>Target</span></button>")
      const span = page.getByText("Target")
      const waiting = yield* startWaiting(Expect.toBeEnabled(span))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("span")!.parentElement!.setAttribute("aria-disabled", "false")
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("EH-121", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role="group" aria-disabled=true><button><span>Target</span></button></div>`)
      const span = page.getByText("Target")
      const waiting = yield* startWaiting(Expect.toBeEnabled(span))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("span")!.parentElement!.parentElement!.setAttribute("aria-disabled", "false")
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("EH-122", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      const button = page.locator("button")
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.style.transition = "margin 10000ms linear 0s"
        button.style.marginLeft = "20000px"
      })
      // The original's rafraf, for Firefox to kick in the animation
      yield* rafraf(page)
      // scrollIntoView checks stability and nothing else, so it waits for the animation to stop
      const waiting = yield* startWaiting(button.scrollIntoView())
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.transition = ""
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("EH-123", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input readonly>")
      const input = page.locator("input")
      const waiting = yield* startWaiting(Expect.toBeEditable(input))
      yield* giveItAChanceToResolve(page)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).readOnly = false
      })
      yield* Fiber.join(waiting.fiber)
    }))
})
