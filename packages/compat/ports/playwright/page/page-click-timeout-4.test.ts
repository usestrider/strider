/**
 * Playwright's `tests/page/page-click-timeout-4.spec.ts`: a click whose element keeps moving, and a click behind a
 * fixed header after the page scrolls.
 *
 * What the port changes:
 * - `button.evaluate(…)` and `page.evaluate(…)` run in the main world, as Playwright's do, through
 *   `evaluateInMainWorld` over `document.querySelector("button")`; the DOM they change is the same either way.
 * - `page.$("button")` is a locator, `page.locator("button")`, which re-resolves on each attempt.
 * - `rafraf` is Playwright's helper, which runs `page.evaluate` in the main world; the port inlines it so it runs there.
 *   The harness's `rafraf` runs in Strider's isolated world, which WebKit doesn't have.
 * - `button.click({ timeout })` and `page.click(…, { timeout })` are the same calls under `Deadline.within`. Each
 *   timed-out click's error is a `Deadline.Timeout`: its budget, its phase, and the reason it last observed are
 *   asserted on the typed error.
 * - Playwright's "waiting for element to be visible, enabled and stable" is its call log's header. Strider's
 *   `Timeout` doesn't list its checks; the port asserts that the message says it was waiting for a condition, which
 *   its phase is.
 * - CL-122's message check comes last, after its clicked and scroll checks, so that a failed message check doesn't
 *   hide them; Playwright's order checks the message first.
 * - Playwright's error message names the reason in its own words. Strider's `Timeout.message` doesn't carry the
 *   reason, so the port also asserts it in Strider's words on `message`. That check fails until the message says it.
 * - CL-122's `page.setViewportSize` is `page.emulate({ viewport })`.
 * - CL-121 uses Playwright's `__testHookBeforePointerAction` and its `mode`, so it isn't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Deadline, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string; readonly by?: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The error of a click that Playwright's test expects to time out (its `.catch(e => e)`); a click that succeeds fails. */
const clickFailure = Effect.fnUntraced(function*(click: Effect.Effect<void, unknown>) {
  const result = yield* Effect.result(click)
  assert(Result.isFailure(result), "the click succeeded, where Playwright's click times out")
  return result.failure
})

/** Playwright's `<kind>.click: Timeout <budget>ms exceeded.`, as a `Timeout` of the click with that budget. */
const clickTimeout = (error: unknown, budget: number): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  // Strider names the operation `Locator.click`
  assert.strictEqual(error.operation, "Locator.click")
  // Strider's budget counts from when the click starts: the timeout less the moments before then
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  return error
}

/** Playwright's `rafraf`: two animation frames in the page's main world, so what it drew has been painted. */
const rafraf = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  )

upstream(import.meta.filename, {}, (test) => {
  test("CL-120", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const button = page.locator("button")
      yield* page.evaluateInMainWorld(() => {
        const element = document.querySelector("button")!
        element.style.transition = "margin 5s linear 0s"
        element.style.marginLeft = "200px"
      })
      // rafraf for Firefox to kick in the animation.
      yield* rafraf(page)
      const error = yield* clickFailure(button.click().pipe(Deadline.within("3 seconds")))
      const timeout = clickTimeout(error, 3000)
      assert.strictEqual(timeout.phase, "waitingForCondition")
      assert.strictEqual(reasonOf(timeout)?._tag, "NotStable")
      assert.include(timeout.message, "waitingForCondition")
      assert.include(timeout.message, "The element kept moving")
    }))

  test("CL-122", ({ page }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 240 } })
      yield* page.setContent(`
    <style>
    * {
      padding: 0;
      margin: 0;
    }
    li {
      height: 80px;
      border: 1px solid black;
    }
    ol {
      padding-top: 160px;
    }
    div.fixed {
      position: fixed;
      z-index: 1001;
      width: 100%;
      background: rgba(255, 0, 0, 0.2);
      height: 2000px;
    }
    </style>

    <div class=fixed></div>

    <ol>
    <li>hi1</li><li>hi2</li><li>hi3</li><li>hi4</li><li>hi5</li><li>hi6</li><li>hi7</li><li>hi8</li>
    <li id=target onclick="window.__clicked = true">hi9</li>
    <li>hi10</li><li>hi11</li><li>hi12</li><li>hi13</li><li id=li14>hi14</li>
    </ol>

    <script>
      window.scrollTops = [];
      window.addEventListener('scroll', () => {
        window.scrollTops.push(window.scrollY);
      });
    </script>
  `)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#li14")!.scrollIntoView()
      })
      const error = yield* clickFailure(page.locator("#target").click().pipe(Deadline.within("3.5 seconds")))
      const timeout = clickTimeout(error, 3500)
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, "div.fixed")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { __clicked?: boolean }).__clicked),
        undefined
      )
      const scrollTops = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { scrollTops: Array<number> }).scrollTops
      )
      // At least three different scroll positions
      assert.isAbove(new Set(scrollTops).size, 2)
      assert.include(timeout.message, "Another element covers the element's action point: div.fixed")
    }))
})
