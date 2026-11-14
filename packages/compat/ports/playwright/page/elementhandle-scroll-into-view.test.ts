/**
 * Playwright's `tests/page/elementhandle-scroll-into-view.spec.ts`: scrolling an element into view, and waiting for it
 * to be visible and stable first.
 *
 * What the port changes:
 * - Strider has no ElementHandle. `page.$(selector)` is `page.locator(selector)`, and `handle.scrollIntoViewIfNeeded()`
 *   is `locator.scrollIntoView()`, which checks that the element is visible and stable before it scrolls, as the
 *   original's waits do. Its timeout is `Deadline.within`.
 * - A wait the original holds across steps (`const promise = div.scrollIntoViewIfNeeded().then(() => done = true)`) is
 *   a child fiber started at once, joined where the original awaits it.
 * - `page.waitForTimeout(1000)` in `testWaiting` is the original's own fixed wait, so it's an `Effect.sleep` of the
 *   same length.
 * - `handle.evaluate(…)` and `page.evaluate(…)` run in the main world, so they are `page.evaluateInMainWorld`, with
 *   the element found by a selector in the page.
 * - EH-094 removes the element through its handle, and the original's scroll then throws about the detached node.
 *   Strider's locator finds its match again on each attempt, so the scroll would wait for a match rather than throw;
 *   it's in the ledger.
 * - EH-096's version skip doesn't apply: the pinned Chromium is past version 105.
 * - EH-097 and EH-098 scroll an element that is hidden or has no size. Strider's scroll checks that the element is
 *   visible (CSS visibility and a nonempty box), so its scroll waits where Playwright's does not; the port asserts
 *   the original's outcome as written and fails there.
 * - EH-101's timeout is `Deadline.within("3 seconds")`. Its message says Playwright's wording, "element is not
 *   visible" and "retrying scroll into view action"; Strider's timeout names the operation and phase, and records
 *   the reason it last observed as `NotVisible`, which the port asserts.
 */
import { assert } from "@effect/vitest"
import { Deadline, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Playwright's `testWaiting`: a scroll of the `div` waits while the element is hidden or moving, and passes once `change`
 * makes it scrollable.
 */
const testWaiting = Effect.fnUntraced(function*<A, E, R>(page: Page.Page, change: Effect.Effect<A, E, R>) {
  const scroll = yield* startWaiting(page.locator("div").scrollIntoView())
  // Playwright's own fixed wait: the scroll has time to start and must still be waiting
  yield* Effect.sleep("1 second")
  assert.isFalse(yield* scroll.done)
  yield* change
  yield* Fiber.join(scroll.fiber)
  assert.isTrue(yield* scroll.done)
})

/** The distance an element's right edge sticks out past the window's right edge, in the main world. */
const overflowOf = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld((selector) => {
    const element = document.querySelector(selector) as HTMLElement
    return element.getBoundingClientRect().right - window.innerWidth
  }, selector)

const scrollTopOf = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld((selector) => (document.querySelector(selector) as HTMLElement).scrollTop, selector)

const setDisplay = (page: Page.Page, selector: string, display: string) =>
  page.evaluateInMainWorld(
    (selector, display) => {
      ;(document.querySelector(selector) as HTMLElement).style.display = display
    },
    selector,
    display
  )

upstream(import.meta.filename, {}, (test) => {
  test("EH-093", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", { waitUntil: "load" })
      for (let i = 0; i < 11; ++i) {
        const button = page.locator("#btn" + i)
        const before = yield* overflowOf(page, "#btn" + i)
        assert.strictEqual(before, 10 * i)
        yield* button.scrollIntoView()
        const after = yield* overflowOf(page, "#btn" + i)
        assert.isTrue(after <= 0)
        yield* page.evaluateInMainWorld(() => window.scrollTo(0, 0))
      }
    }))

  test("EH-095", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"display:none\">Hello</div>")
      yield* testWaiting(page, setDisplay(page, "div", "block"))
    }))

  test("EH-096", ({ page }) =>
    Effect.gen(function*() {
      // Playwright skips this before Chromium 105; the pinned Chromium is later, so it runs
      yield* page.setContent(`
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
      ::-webkit-scrollbar { display: none; }
      * { scrollbar-width: none; }
    </style>
    <div id=container style="width:200px;height:200px;overflow:scroll;border:1px solid black;">
      <div style="margin-top:500px;background:red;">
        <div style="height:50px;width:100px;background:cyan;">
          <div id=target style="display:contents">Hello</div>
        </div>
      <div>
    </div>
  `)
      yield* page.locator("#target").scrollIntoView()
      const scrollTop = yield* scrollTopOf(page, "#container")
      // On Android the value is not exact due to various scale conversions.
      assert.isBelow(Math.abs(scrollTop - 350), 1)
    }))

  test("EH-124", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
      ::-webkit-scrollbar { display: none; }
      * { scrollbar-width: none; }
    </style>
    <div id=container style="width:200px;height:200px;overflow:scroll;border:1px solid black;">
      <div style="margin-top:500px;background:red;">
        <div id=outer style="display:contents"><div style="display:contents"><div id=target style="height:50px;width:100px;background:cyan;">Hello</div></div><div style="height:2000px;"></div><div>Sibling</div></div>
      </div>
    </div>
  `)
      yield* page.locator("#outer").scrollIntoView()
      // The first box in the flattened subtree of #outer is #target, two levels down, not the tall sibling. No
      // whitespace text nodes inside #outer: in Firefox they get boxes of their own, which would hide a fallback that
      // only looks one level down.
      const targetIsVisible = yield* page.evaluateInMainWorld(() => {
        const container = document.getElementById("container")!.getBoundingClientRect()
        const rect = document.getElementById("target")!.getBoundingClientRect()
        return rect.top >= container.top && rect.bottom <= container.bottom
      })
      assert.isTrue(targetIsVisible)
    }))

  test("EH-097", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"visibility:hidden\">Hello</div>")
      yield* page.locator("div").scrollIntoView()
    }))

  test("EH-098", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"height:0\">Hello</div>")
      yield* page.locator("div").scrollIntoView()
    }))

  test("EH-099", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<span style=\"display:none\"><div>Hello</div></span>")
      yield* testWaiting(
        page,
        page.evaluateInMainWorld(() => {
          ;(document.querySelector("div")!.parentElement as HTMLElement).style.display = "block"
        })
      )
    }))

  test("EH-100", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      @keyframes move {
        from { margin-left: 0; }
        to { margin-left: 200px; }
      }
      div.animated {
        animation: 2s linear 0s infinite alternate move;
      }
    </style>
    <div class=animated>moving</div>
    `)
      yield* testWaiting(
        page,
        page.evaluateInMainWorld(() => document.querySelector("div")!.classList.remove("animated"))
      )
    }))

  test("EH-101", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"display:none\">Hello</div>")
      const error = yield* failureOf(
        page.locator("div").scrollIntoView().pipe(Deadline.within("3 seconds")),
        "the scroll"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.scrollIntoView")
      assert.strictEqual(error.phase, "waitingForCondition")
      // Strider's budget counts from when the scroll starts: the three seconds less the moments before then
      assert.isAtMost(Duration.toMillis(error.budget), 3000)
      assert.isAbove(Duration.toMillis(error.budget), 2500)
      assert.strictEqual((Option.getOrUndefined(error.last)?.value as { _tag: string } | undefined)?._tag, "NotVisible")
    }))
})
