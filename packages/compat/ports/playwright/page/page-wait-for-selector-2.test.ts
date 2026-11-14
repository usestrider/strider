/**
 * Playwright's `tests/page/page-wait-for-selector-2.spec.ts`: waiting for a selector to reach a state (attached,
 * detached, visible, or hidden), and that the wait survives navigations, frames, and DOM changes.
 *
 * What the port changes:
 * - `page.waitForSelector(selector, { state })` is the locator's matcher for the state: `visible` is `Expect.toBeVisible`,
 *   `hidden` is `Expect.toBeHidden` (which also passes when nothing matches), `attached` is `Expect.toBeAttached`, and
 *   `detached` is `Expect.toBeDetached`. Playwright's default state is `visible`, so a wait with no state is
 *   `Expect.toBeVisible`. A wait the original holds across steps is `startWaiting`, and its `done` is the original's
 *   `let done = false` flag.
 * - A wait returns no handle, so the `null` that a hidden or detached wait resolves with (WA-052, WA-063) has no
 *   counterpart to check: the wait passing is the check. Where the original reads the element a wait returned
 *   (WA-056, WA-062, WA-069, WA-070), the port reads the locator the wait matched, after the wait. Locators re-resolve
 *   rather than keep that element, so these reads rely on nothing changing the element between the wait and the read,
 *   which these tests don't do. WA-062 reads the element's `outerHTML` for its tag, since `tagName` is a JSHandle read.
 * - `timeout` is `Deadline.within`. A timed-out wait is an `ExpectationFailed`, which records its elapsed time and its
 *   condition; the port asserts both where the original checks Playwright's `Timeout <ms>ms exceeded` message and its
 *   `TimeoutError` class.
 * - `page.evaluate` and `$eval` are `page.evaluateInMainWorld`, so the page's own script state is changed where the
 *   original changes it. `page.textContent(sel)` is `readText`, which is the engine's text. WA-071 relies on
 *   `readText` matching inside an open shadow root, as the locator does.
 * - `page.waitForTimeout(ms)` is the original's own fixed wait, ported as `Effect.sleep` with the same duration.
 * - `page.mainFrame()` is the page: its locators are the main frame's. `page.frames()[1]` is the frame
 *   `attachFrame` returns.
 * - XPath has no Strider counterpart (the matrix row for XPath is missing). WA-065 (`normalize-space`) and WA-070 (an
 *   absolute path) are about XPath's own evaluation, so a CSS selector would not test them: they are in the ledger as
 *   needing XPath. WA-066 to WA-069 only use XPath as the selector of a wait whose behavior is not XPath's (a timeout,
 *   a frame, a detached frame, an element that arrives later); they are ported with the CSS selector for the same
 *   element, and their XPath form stays untested.
 * - WA-057 checks Playwright's `Error.stack` for the name of the wait. Strider's failure is a typed value with no stack;
 *   the port checks the condition its message names, `to be attached`.
 * - WA-067's `ownerFrame()` has no counterpart on a locator, which is scoped to frame2 by construction. The port checks
 *   what "run in the specified frame" means: frame2's wait stays pending when frame1 gets a matching element, and
 *   resolves when frame2 does. It navigates the page to the server first, so that the page's main world can write
 *   into the frames (the original's blank page cannot reach them, and its isolated-world write is missing on stock
 *   WebKit).
 * - WA-068 expects Playwright's `Frame was detached`, as Strider's `TargetGone` with the reason `FrameDetached`. Strider
 *   doesn't give it: a frame locator enters its iframe by element on every attempt, and an iframe element that is gone
 *   is an element not there yet, which an expectation keeps waiting for until its deadline (API.md, "Frames are entered,
 *   not held"). The test fails with an `ExpectationFailed` after the deadline.
 * - WA-045 and WA-047 start their wait before the element's page exists, as the original does.
 * - WA-075 and WA-076 wait on a selector inside a handle. The port scopes the locator to the button, so it finds the
 *   same descendants; the button's removal leaves nothing to match, which is what those waits pass on.
 * - WA-058 to WA-061 check Playwright's runtime refusal of a string `state` and of a `visibility` option. Strider has no
 *   state option: each state is its own matcher, so a wrong one doesn't compile. They are in the ledger, not ported.
 * - WA-072 and WA-073 use Playwright's `__testHookBeforeAdoptNode` and its `mode` fixture. They are in the ledger.
 * - WA-074 waits on a handle whose element is then removed, and expects the wait to throw. A locator re-resolves, so
 *   the wait keeps looking; it's in the ledger as needing a handle bound to one element.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Page, Target } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { attachFrame, failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * The original's `addElement`, run in the page's main world. It returns nothing: the node it appends can't cross back
 * by value, and the original doesn't use the return.
 */
const addElement = (tag: string) => {
  document.body.appendChild(document.createElement(tag))
}

/**
 * A wait that timed out after `millis` (Playwright's `Timeout <millis>ms exceeded`): an `ExpectationFailed` whose
 * elapsed time is about the deadline, since the deadline is what ended it.
 */
const timedOutAfter = (error: unknown, millis: number): Expect.ExpectationFailed => {
  assert(Expect.isExpectationFailed(error), String(error))
  assert.isAtLeast(Duration.toMillis(error.elapsed), millis - 100)
  assert.isAtMost(Duration.toMillis(error.elapsed), millis + 500)
  return error
}

/**
 * The original's `frame.evaluate(addElement, tag)` for the frame `id` of a same-origin page: appended to the frame's
 * body from the page's main world, through the iframe's `contentDocument`, which every backend has.
 */
const addToFrame = (page: Page.Page, id: string, tag: string) =>
  page.evaluateInMainWorld(
    (id, tag) => {
      const document = (window.document.getElementById(id) as HTMLIFrameElement).contentDocument!
      document.body.appendChild(document.createElement(tag))
    },
    id,
    tag
  )

upstream(import.meta.filename, {}, (test) => {
  test("WA-044", ({ page, server }) =>
    Effect.gen(function*() {
      // grid.html has 200 `.box` elements and Playwright's wait takes the first; an expectation wants exactly one match
      const box = page.locator(".box").first
      const waiting = yield* startWaiting(Expect.toBeVisible(box))
      yield* page.goto(server.EMPTY_PAGE)
      assert.isFalse(yield* waiting.done)
      yield* page.reload()
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/grid.html")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-045", ({ page }) =>
    Effect.gen(function*() {
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeVisible(div))
      yield* page.setContent(`<div style='display: none; visibility: hidden;'>1</div>`)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.removeProperty("display"))
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.removeProperty("visibility"))
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-046", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='width: 0; height: 0;'>1</div>`)
      const div = page.locator("div")
      const first = yield* failureOf(Expect.toBeVisible(div).pipe(Deadline.within("1 second")), "the wait")
      timedOutAfter(first, 1000)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.width = "10px")
      const second = yield* failureOf(Expect.toBeVisible(div).pipe(Deadline.within("1 second")), "the wait")
      timedOutAfter(second, 1000)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.height = "10px")
      yield* Expect.toBeVisible(div).pipe(Deadline.within("1 second"))
    }))

  test("WA-047", ({ page }) =>
    Effect.gen(function*() {
      const inner = page.locator("div#inner")
      const waiting = yield* startWaiting(Expect.toBeVisible(inner))
      yield* page.setContent(`<div style='display: none; visibility: hidden;'><div id="inner">hi</div></div>`)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.removeProperty("display"))
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.removeProperty("visibility"))
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-048", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      .cover {
        position: fixed;
        left: 0;
        top: 0;
        width: 100px;
        height: 100px;
        background-color: red;
        transform: translateX(-200px);
      }
    </style>
    <div class="cover">cover</div>
  `)
      const cover = page.locator(".cover")
      // cover.waitFor({ state: 'visible' }), then expect(cover).toBeVisible(): both are the same check
      yield* Expect.toBeVisible(cover)
      yield* Expect.toBeVisible(cover)
    }))

  test("WA-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='display: block;'>content</div>`)
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeHidden(div))
      // page.waitForSelector('div') does a round trip: the element is visible, so the wait resolves
      yield* Expect.toBeVisible(div)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.setProperty("visibility", "hidden"))
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-050", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='display: block;'>content</div>`)
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeHidden(div))
      yield* Expect.toBeVisible(div)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.style.setProperty("display", "none"))
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-051", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>content</div>`)
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeHidden(div))
      yield* Expect.toBeVisible(div)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.remove())
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-052", ({ page }) =>
    Effect.gen(function*() {
      // Playwright resolves this with null. A Strider wait resolves with nothing, so the wait passing is the check.
      yield* Expect.toBeHidden(page.locator("non-existing"))
    }))

  test("WA-053", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        Expect.toBeAttached(page.locator("div")).pipe(Deadline.within("3 seconds")),
        "the wait"
      )
      const failure = timedOutAfter(error, 3000)
      assert.include(failure.message, "to be attached")
      assert.include(failure.message, "div")
    }))

  test("WA-054", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>content</div>`)
      const error = yield* failureOf(
        Expect.toBeHidden(page.locator("div")).pipe(Deadline.within("1 second")),
        "the wait"
      )
      const failure = timedOutAfter(error, 1000)
      assert.include(failure.message, "to be hidden")
      assert.include(failure.message, "div")
    }))

  test("WA-055", ({ page }) =>
    Effect.gen(function*() {
      const zombo = page.locator(".zombo")
      const waiting = yield* startWaiting(Expect.toBeAttached(zombo))
      yield* page.setContent(`<div class='notZombo'></div>`)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.className = "zombo")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-056", ({ page }) =>
    Effect.gen(function*() {
      const zombo = page.locator(".zombo")
      const waiting = yield* startWaiting(Expect.toBeVisible(zombo))
      yield* page.setContent(`<div class='zombo'>anything</div>`)
      yield* Fiber.join(waiting.fiber)
      // The original reads the text of the element the wait returned; this reads the one the locator matched
      assert.strictEqual(yield* zombo.readText, "anything")
    }))

  test("WA-057", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* failureOf(
        Expect.toBeAttached(page.locator(".zombo")).pipe(Deadline.within("10 millis")),
        "the wait"
      )
      assert(Expect.isExpectationFailed(error), String(error))
      // Playwright checks that the stack names the wait; Strider's failure names its condition
      assert.include(error.message, "to be attached")
    }))

  test("WA-062", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // `css=div >> css=span` is the chain of two locators
      const span = page.locator("div").locator("span")
      const watchdog = yield* startWaiting(Expect.toBeAttached(span))
      yield* page.evaluateInMainWorld(addElement, "br")
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.appendChild(document.createElement("span"))
      })
      yield* Fiber.join(watchdog.fiber)
      // The original checks the returned handle's tagName; the matched span's outerHTML names the same tag
      assert.strictEqual(yield* span.readHtml, "<span></span>")
    }))

  test("WA-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      // Playwright resolves this with null, and so has no counterpart to check: the wait passing is the check
      yield* Expect.toBeDetached(page.locator("div"))
    }))

  test("WA-064", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\"><div>43543</div></section>")
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeDetached(div))
      assert.isFalse(yield* waiting.done)
      yield* Expect.toBeAttached(page.locator("section"))
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.remove())
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-066", ({ page }) =>
    Effect.gen(function*() {
      // The original's XPath `//div` is the CSS `div`: the test is the timeout, which Strider applies the same way
      const error = yield* failureOf(
        Expect.toBeAttached(page.locator("div")).pipe(Deadline.within("3 seconds")),
        "the wait"
      )
      const failure = timedOutAfter(error, 3000)
      assert.include(failure.message, "to be attached")
      assert.include(failure.message, "div")
    }))

  test("WA-067", ({ page, server }) =>
    Effect.gen(function*() {
      // The page is on the server too, so its main world reaches the frames' documents; the original's page is blank
      yield* page.goto(server.EMPTY_PAGE)
      const frame1 = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame2 = yield* attachFrame(page, "frame2", server.EMPTY_PAGE)
      const div = frame2.locator("div")
      const waiting = yield* startWaiting(Expect.toBeAttached(div))
      yield* addToFrame(page, "frame1", "div")
      // frame2's wait ignores the element added to frame1: frame1's engine has seen it, and the wait is still pending
      yield* Expect.toBeAttached(frame1.locator("div"))
      assert.isFalse(yield* waiting.done)
      yield* addToFrame(page, "frame2", "div")
      yield* Fiber.join(waiting.fiber)
      // The original checks the handle's ownerFrame, which a locator scoped to frame2 has by construction
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-068", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const waiting = yield* startWaiting(
        failureOf(Expect.toBeVisible(frame.locator("[class=\"box\"]")), "the wait")
      )
      yield* page.evaluateInMainWorld(() => document.getElementById("frame1")!.remove())
      const error = yield* Fiber.join(waiting.fiber)
      assert(Target.isTargetGone(error), String(error))
      assert.strictEqual(error.reason._tag, "FrameDetached")
    }))

  test("WA-069", ({ page }) =>
    Effect.gen(function*() {
      const zombo = page.locator("[class=\"zombo\"]")
      const waiting = yield* startWaiting(Expect.toBeVisible(zombo))
      yield* page.setContent(`<div class='zombo'>anything</div>`)
      yield* Fiber.join(waiting.fiber)
      // As in WA-056, the text of the element the locator matched stands for the returned handle's
      assert.strictEqual(yield* zombo.readText, "anything")
    }))

  test("WA-071", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <x-host hidden></x-host>
    <script>
      const host = document.querySelector('x-host');
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host([hidden]) { display: none; }';
      root.appendChild(style);
      const child = document.createElement('div');
      child.textContent = 'Find me';
      root.appendChild(child);
    </script>
  `)
      assert.strictEqual(yield* page.locator("div").readText, "Find me")
      yield* Expect.toBeHidden(page.locator("div"))
    }))

  test("WA-075", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button>hello</button>`)
      // button.waitForSelector('something', { state: 'hidden' }), with the button as the scope
      const something = page.locator("button").locator("something")
      const waiting = yield* startWaiting(Expect.toBeHidden(something))
      // The original's own fixed wait, page.waitForTimeout(1000)
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => document.body.innerText = "")
      yield* Fiber.join(waiting.fiber)
    }))

  test("WA-076", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button>hello</button>`)
      // button.waitForSelector('something', { state: 'detached' }), with the button as the scope
      const something = page.locator("button").locator("something")
      const waiting = yield* startWaiting(Expect.toBeDetached(something))
      // The original's own fixed wait, page.waitForTimeout(1000)
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => document.body.innerText = "")
      yield* Fiber.join(waiting.fiber)
    }))
})
