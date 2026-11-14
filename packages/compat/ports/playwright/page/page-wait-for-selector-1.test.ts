/**
 * Playwright's `tests/page/page-wait-for-selector-1.spec.ts`: waiting for a selector on a page, a frame, and an element
 * handle: the states it waits for, what it resolves with, and the errors and logs of a wait that times out or is cut
 * short.
 *
 * What the port changes:
 * - `page.waitForSelector(selector, { state })` and `frame.waitForSelector` are the locator's matcher for the state, as
 *   page-wait-for-selector-2's port says: `visible` (the default) is `Expect.toBeVisible`, `hidden` is `Expect.toBeHidden`,
 *   `attached` is `Expect.toBeAttached`. A wait the original holds across steps is `startWaiting`. A wait returns no
 *   handle, so where the original reads the element it returned (WA-035, WA-056, WA-069), the port reads the locator
 *   after the wait, as page-wait-for-selector-2's port does.
 * - `page.mainFrame()` is the page. `page.frames()[1]` and `page.frames()[2]` are the frames `attachFrame` returns.
 * - `frame.evaluate(addElement, tag)` and `page.evaluate` are `page.evaluateInMainWorld`. Where the original adds an
 *   element to a same-origin frame, `addToFrame` appends it through the iframe's `contentDocument`, from the page's
 *   main world. The page is navigated to the fixture server first (WA-041, WA-042), so that its main world can reach the
 *   frames' documents; the original's blank page can't.
 * - `timeout` is `Deadline.within`. A timed-out wait is an `ExpectationFailed`, which records its elapsed time, and the
 *   port asserts both: Playwright's `Timeout <ms>ms exceeded` and its `TimeoutError` have no counterpart.
 * - `page.waitForTimeout(ms)` is the original's own fixed wait, ported as `Effect.sleep` with the same duration.
 * - WA-027 and WA-028 pass Playwright's undocumented `waitFor` option, which Strider doesn't have: they are in the
 *   ledger. WA-033 waits on a handle that Playwright throws for on navigation; WA-038 expects Playwright's non-strict
 *   click, which Strider's strictness differs from by design, so those are in the ledger too.
 * - WA-036 and WA-037 check the call log Playwright appends to a timed-out wait, which describes each element the
 *   selector resolved to (tag, id, class, text) and its state. A timed-out expectation reports its last observation
 *   instead, a count of matches and of visible ones, so the port asserts that and the condition, which names the state
 *   waited for. The element descriptions and the earlier states of the log have no counterpart. The `rafraf`s are the
 *   original's `giveItTimeToLog`.
 * - WA-041's `ownerFrame()` has no counterpart on a locator, which is scoped to the main frame by construction, as
 *   page-wait-for-selector-2's WA-067 notes. WA-042 checks what "run in the specified frame" means: frame2's wait stays
 *   pending when frame1 gets a match, and resolves when frame2 does.
 * - WA-043 expects Playwright's `Frame was detached`, as Strider's `TargetGone` with the reason `FrameDetached`. A frame
 *   locator has no such failure: its iframe element is gone, which an expectation keeps waiting for until its deadline,
 *   as page-wait-for-selector-2's WA-068 notes. The port asserts the original's error, so it fails.
 * - WA-039's `page.waitForTimeout(100)` is the original's own fixed wait, ported as written.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Page, Target } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { attachFrame, failureOf, observedValues, rafraf, startWaiting } from "../../harness/playwright.ts"
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
 * body from the page's main world, through the iframe's `contentDocument`.
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
  test("WA-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // frame.waitForSelector('*') takes the default state, visible, of the first match
      yield* Expect.toBeVisible(page.locator("*").first)
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Expect.toBeAttached(page.locator("div"))
    }))

  test("WA-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<span>extra</span><div><span>target</span></div>`)
      // div.waitForSelector('span') searches inside the div, so the span is the one in it
      const span = page.locator("div").locator("span")
      yield* Expect.toBeAttached(span)
      assert.strictEqual(yield* span.readText, "target")
    }))

  test("WA-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div></div>`)
      const span = page.locator("div").locator("span")
      const waiting = yield* startWaiting(Expect.toBeAttached(span))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.innerHTML = "<span>target</span>"
      })
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* span.readText, "target")
    }))

  test("WA-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div></div>`)
      const span = page.locator("div").locator("span")
      // The default state is visible
      const error = yield* failureOf(
        Expect.toBeVisible(span).pipe(Deadline.within("100 millis")),
        "the wait"
      )
      const failure = timedOutAfter(error, 100)
      assert.include(failure.message, "to be visible")
      assert.include(failure.message, "span")
    }))

  test("WA-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        delete (window as { MutationObserver?: unknown }).MutationObserver
      })
      const zombo = page.locator(".zombo")
      // Promise.all: the wait starts before the content that satisfies it is set
      const waiting = yield* startWaiting(Expect.toBeVisible(zombo))
      yield* page.setContent(`<div class='zombo'>anything</div>`)
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* zombo.readText, "anything")
    }))

  test("WA-035", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const div = page.locator("div")
      const waiting = yield* startWaiting(Expect.toBeAttached(div))
      yield* page.evaluateInMainWorld(addElement, "br")
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Fiber.join(waiting.fiber)
      // The original reads the returned handle's tagName; the matched element's outerHTML names the same tag
      assert.strictEqual(yield* div.readHtml, "<div></div>")
    }))

  test("WA-036", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const waiting = yield* startWaiting(
        failureOf(Expect.toBeVisible(page.locator("div")).pipe(Deadline.within("5 seconds")), "the wait")
      )
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.className = "foo bar"
        div.id = "mydiv"
        div.setAttribute("style", "display: none")
        div.setAttribute("foo", "123456789012345678901234567890123456789012345678901234567890")
        div.textContent = "abcdefghijklmnopqrstuvwyxzabcdefghijklmnopqrstuvwyxzabcdefghijklmnopqrstuvwyxz"
        document.body.appendChild(div)
      })
      yield* rafraf(page, 2)
      yield* page.evaluateInMainWorld(() => document.querySelector("div")!.remove())
      yield* rafraf(page, 2)
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.className = "another"
        div.style.display = "none"
        document.body.appendChild(div)
      })
      yield* rafraf(page, 2)
      const error = yield* Fiber.join(waiting.fiber)
      const failure = timedOutAfter(error, 5000)
      assert.include(failure.message, "to be visible")
      // Playwright's log describes each hidden div it resolved to; Strider's observation counts them: one match, none visible
      assert.deepStrictEqual(observedValues(failure).at(-1), { matches: 1, visible: 0 })
    }))

  test("WA-037", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.className = "foo bar"
        div.id = "mydiv"
        div.textContent = "hello"
        document.body.appendChild(div)
      })
      const waiting = yield* startWaiting(
        failureOf(Expect.toBeHidden(page.locator("div")).pipe(Deadline.within("5 seconds")), "the wait")
      )
      yield* rafraf(page, 2)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.remove()
        const div = document.createElement("div")
        div.className = "another"
        div.textContent = "hello"
        document.body.appendChild(div)
      })
      yield* rafraf(page, 2)
      const error = yield* Fiber.join(waiting.fiber)
      const failure = timedOutAfter(error, 5000)
      assert.include(failure.message, "to be hidden")
      // Playwright's log describes each visible div it resolved to; Strider's observation counts them: one match, visible
      assert.deepStrictEqual(observedValues(failure).at(-1), { matches: 1, visible: 1 })
    }))

  test("WA-039", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const span = page.locator("span")
      const waiting = yield* startWaiting(Expect.toBeVisible(span))
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.attachShadow({ mode: "open" })
        document.body.appendChild(div)
      })
      // The original's own fixed wait, page.waitForTimeout(100)
      yield* Effect.sleep("100 millis")
      yield* page.evaluateInMainWorld(() => {
        const span = document.createElement("span")
        span.textContent = "Hello from shadow"
        document.querySelector("div")!.shadowRoot!.appendChild(span)
      })
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* span.readText, "Hello from shadow")
    }))

  test("WA-040", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const waiting = yield* startWaiting(Expect.toBeAttached(page.locator("h3 div")))
      yield* page.evaluateInMainWorld(addElement, "span")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("span")!.innerHTML = "<h3><div></div></h3>"
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("WA-041", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const waiting = yield* startWaiting(Expect.toBeAttached(page.locator("div")))
      yield* addToFrame(page, "frame1", "div")
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Fiber.join(waiting.fiber)
      // The original checks the handle's ownerFrame is the main frame. A page's locator is the main frame's by
      // construction, so the element it matched is in the main frame.
    }))

  test("WA-042", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame2 = yield* attachFrame(page, "frame2", server.EMPTY_PAGE)
      const waiting = yield* startWaiting(Expect.toBeAttached(frame2.locator("div")))
      yield* addToFrame(page, "frame1", "div")
      // frame2's wait ignores the element added to frame1: it stays pending until frame2 gets one
      assert.isFalse(yield* waiting.done)
      yield* addToFrame(page, "frame2", "div")
      yield* Fiber.join(waiting.fiber)
      // The original checks the handle's ownerFrame is frame2, which a locator scoped to frame2 has by construction
      assert.isTrue(yield* waiting.done)
    }))

  test("WA-043", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const waiting = yield* startWaiting(
        failureOf(Expect.toBeVisible(frame.locator(".box")), "the wait")
      )
      yield* page.evaluateInMainWorld(() => document.getElementById("frame1")!.remove())
      const error = yield* Fiber.join(waiting.fiber)
      assert(Target.isTargetGone(error), String(error))
      assert.strictEqual(error.reason._tag, "FrameDetached")
    }))
})
