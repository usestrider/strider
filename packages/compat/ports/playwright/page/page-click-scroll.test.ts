/**
 * Playwright's `tests/page/page-click-scroll.spec.ts`: clicking, hovering, and scrolling elements into view, in nested
 * scroll containers, `display: contents` elements, and iframes.
 *
 * What the port changes:
 * - `page.click("text=…")` is `page.getByText(…).click()` under `Deadline.within`, which is how a test's timeout is
 *   stated (`page-click-timeout-1` has the same mapping). `getByText` matches case-insensitively as a substring, as
 *   `text=` does. Its clicks use the default checks, which scroll an element into view.
 * - `page.evaluate("window._clicked")` and the other page globals are `page.evaluateInMainWorld`, which runs in the
 *   page's own world as `page.evaluate` does.
 * - `scroll: "none"` (CL-101 to CL-104) is `checks: { inViewport: false }`: Strider scrolls an element into view only
 *   when its `inViewport` check is on, so turning the check off is the same as not scrolling. Where the original
 *   expects a click that doesn't scroll to fail, the port asserts Strider's `Timeout`, its phase, and its last reason,
 *   `OutsideViewport`. The message check comes last, with the original's wording, and fails until Strider's timeout message
 *   says the reason (`page-click-timeout-1` has the same check).
 * - CL-098's `force: true` skips every check. Strider has no blanket force (the matrix's `option-locator-click-force`
 *   row), so the port turns off each of the click's checks. A hidden input has no point to click then, so the click
 *   waits for its deadline and fails with a `Timeout`, which is the error the original expects where it must not crash.
 * - `scrollIntoViewIfNeeded` is `locator.scrollIntoView`, which the matrix row `method-locator-scrollintoviewifneeded`
 *   maps to.
 * - `frameLocator("iframe")` is `page.frame(page.locator("iframe"))`, which enters the iframe by its element.
 * - CL-095 and CL-096 skip on Chromium before version 105, and CL-097 and CL-099 and CL-100 are `it.fixme` on the
 *   browsers that run here or for Android. The skips and fixmes don't apply to the browser this port runs on, so the
 *   tests run as written; CL-097 is a `fixme` on Chromium, so it is expected to fail there.
 */
import { assert } from "@effect/vitest"
import { Deadline, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The error of a click or hover that Playwright's test expects to fail; one that succeeds fails the test. */
const actionFailure = Effect.fnUntraced(function*(action: Effect.Effect<void, unknown>) {
  const result = yield* Effect.result(action)
  assert(Result.isFailure(result), "the action succeeded, where the original's expects it to fail")
  return result.failure
})

/** A `Timeout` of the action named `operation`, with the budget the original gives it. */
const actionTimeout = (error: unknown, operation: string, budget: number): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, operation)
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  return error
}

const clicked = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { _clicked?: boolean })._clicked)

const scrollY = (page: Page.Page) => page.evaluateInMainWorld(() => window.scrollY)

upstream(import.meta.filename, {}, (test) => {
  test("CL-094", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      .categories { width: 180px; display: flex; overflow-x: scroll; }
      button { flex: none; height: 28px; }
    </style>
    <div class="categories">
      <button>One</button>
      <button>Two</button>
      <button>Three</button>
      <button>Story</button>
      <button>More</button>
      <button>Items</button>
      <button>Here</button>
    </div>
    `)
      yield* page.getByText("Story").click().pipe(Deadline.within("2 seconds"))
    }))

  test("CL-095", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="background:red;height:2000px">filler</div>
    <div>
      Example text, and button here:
      <button style="display: contents" onclick="window._clicked=true;">click me</button>
    </div>
  `)
      yield* page.getByText("click me").click().pipe(Deadline.within("5 seconds"))
      assert.strictEqual(yield* clicked(page), true)
    }))

  test("CL-096", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="background:red;height:2000px">filler</div>
    Example text, and button here:
    <button style="display: contents" onclick="window._clicked=true;"><div>click me</div></button>
  `)
      yield* page.getByText("click me").click().pipe(Deadline.within("5 seconds"))
      assert.strictEqual(yield* clicked(page), true)
    }))

  test("CL-097", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="background:red;height:2000px">filler</div>
    <div>
      Example text, and button here:
      <button style="display: contents" onclick="window._clicked=true;">click me</button>
    </div>
  `)
      yield* page.getByText("click me").click({ position: { x: 5, y: 5 } }).pipe(Deadline.within("5 seconds"))
      assert.strictEqual(yield* clicked(page), true)
    }))

  test("CL-098", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=hidden>`)
      const error = yield* actionFailure(
        page.locator("input").click({
          checks: {
            rendered: false,
            visible: false,
            stable: false,
            enabled: false,
            notInert: false,
            inViewport: false,
            receivesPointer: false
          }
        }).pipe(Deadline.within("2 seconds"))
      )
      actionTimeout(error, "Locator.click", 2000)
    }))

  test("CL-099", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div id=big style="height: 10000px;"></div>
    <span id=small>foo</span>
  `)
      yield* page.locator("#small").scrollIntoView()
      assert.isAbove(yield* scrollY(page), 9000)
    }))

  test("CL-100", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`
    <div id=big style="height: 10000px;"></div>
    <iframe src='${server.CROSS_PROCESS_PREFIX}/input/button.html'></iframe>
  `)
      yield* page.frame(page.locator("iframe")).getByRole("button").click().pipe(Deadline.within("5 seconds"))
    }))

  test("CL-101", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="height: 2000px;"></div>
    <button onclick="window._clicked=true">click me</button>
  `)
      // `scroll: "none"`: the button is below the viewport and nothing scrolls it into view, so the click waits and fails
      const error = yield* actionFailure(
        page.locator("button").click({ checks: { inViewport: false } }).pipe(Deadline.within("2 seconds"))
      )
      const timeout = actionTimeout(error, "Locator.click", 2000)
      assert.strictEqual(reasonOf(timeout)?._tag, "OutsideViewport")
      assert.notOk(yield* clicked(page))
      assert.strictEqual(yield* scrollY(page), 0)
      assert.include(timeout.message, "outside of the viewport")
    }))

  test("CL-102", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button onclick="window._clicked=true">click me</button>
    <div style="height: 2000px;"></div>
  `)
      yield* page.locator("button").click({ checks: { inViewport: false } }).pipe(Deadline.within("2 seconds"))
      assert.strictEqual(yield* clicked(page), true)
      assert.strictEqual(yield* scrollY(page), 0)
    }))

  test("CL-103", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="height: 100px; width: 100px; overflow-y: scroll;">
      <div style="height: 50px;">A</div>
      <div style="height: 50px;">B</div>
      <button style="height: 50px; width: 100px;" onclick="window._clicked=true">C</button>
    </div>
  `)
      const button = page.locator("button")
      // The button is scrolled out of the nested overflow container, and the click without scrolling fails
      const error = yield* Effect.result(
        button.click({ checks: { inViewport: false } }).pipe(Deadline.within("2 seconds"))
      )
      assert(Result.isFailure(error))
      assert.notOk(yield* clicked(page))
      // Default behavior scrolls the nested container into view and succeeds
      yield* button.click().pipe(Deadline.within("2 seconds"))
      assert.strictEqual(yield* clicked(page), true)
    }))

  test("CL-104", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="height: 2000px;"></div>
    <div onmouseover="window._hovered=true" style="width: 50px; height: 50px;">hover me</div>
  `)
      const error = yield* actionFailure(
        page.getByText("hover me").hover({ checks: { inViewport: false } }).pipe(Deadline.within("2 seconds"))
      )
      const timeout = actionTimeout(error, "Locator.hover", 2000)
      assert.strictEqual(reasonOf(timeout)?._tag, "OutsideViewport")
      assert.notOk(yield* page.evaluateInMainWorld(() => (window as unknown as { _hovered?: boolean })._hovered))
      assert.strictEqual(yield* scrollY(page), 0)
      assert.include(timeout.message, "outside of the viewport")
    }))

  test("CL-105", ({ page }) =>
    Effect.gen(function*() {
      // The fixed header covers everything but the bottom strip of the viewport. The first attempt centers the button
      // under the header, so the click is retried with a different scroll alignment using the native scrollIntoView().
      yield* page.setContent(`
    <style>
      html { scroll-behavior: smooth; }
      body { margin: 0; }
      .spacer { height: 2000px; }
      #header { position: fixed; top: 0; left: 0; right: 0; bottom: 50px; background: rgba(0, 0, 0, 0.1); }
      button { height: 30px; }
    </style>
    <div id="header"></div>
    <div class="spacer"></div>
    <button onclick="window.clicked = true">Target</button>
    <div class="spacer"></div>
    <script>
      window.scrolls = [];
      addEventListener('scroll', () => window.scrolls.push(window.scrollY));
    </script>
  `)
      yield* page.locator("button").click()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { clicked?: boolean }).clicked),
        true
      )
      // Every scroll performed should be a single instant jump, and never a smooth animation that fires a scroll event
      // per frame.
      const scrolls = yield* page.evaluateInMainWorld(() => (window as unknown as { scrolls: Array<number> }).scrolls)
      assert.isAtMost(scrolls.length, 2)
    }))
})
