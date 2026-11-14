/**
 * Playwright's `tests/page/page-click.spec.ts`: clicks on elements that are hidden, moved, covered, disabled, inside
 * frames and shadow roots, with offsets, modifiers, and trial runs, and what the page sees of each.
 *
 * What the port changes:
 * - `page.click(selector)` and `page.dblclick(selector)` are `page.locator(selector).click()` and `.dblclick()`. Strider's
 *   locators are strict, so a selector that matches several elements in the original is `.first` here, as Playwright's
 *   page methods take the first match.
 * - `page.click("text=…")` is `page.getByText(…)`, which matches a case-insensitive substring, as `text=` does.
 * - `{ force: true }` is `{ checks: forceChecks }` (`Locator.Checks`), since Strider has no blanket `force`: the checks
 *   Playwright's force skips (visible, enabled, stable, non-inert, hit target) are off, and `inViewport` stays on, since
 *   Playwright's force still scrolls and fails for a point outside the viewport.
 * - `{ timeout }` is `Deadline.within(…)` on the click. `{ timeout: 0 }` is no deadline: the test's own 30 seconds bound it.
 * - `{ trial: true }` is `{ trial: true }`. A timed-out click's error is a `Deadline.Timeout`, and the port asserts its
 *   budget, its phase, and the reason it last observed on the typed error.
 * - `{ position }` and `{ modifiers }` are the same options. `{ button: "right" }` is `{ button: "right" }`.
 * - `page.dblclick` is `dblclick`. `{ clickCount: 3 }` (CL-016) has no Strider option, so CL-016 isn't ported (see the
 *   ledger).
 * - `page.$eval`, `page.$$eval`, `page.evaluate`, and `handle.evaluate` that change the page's DOM or read its globals
 *   run in the main world: `page.evaluateInMainWorld`. Strider's `locator.evaluate` is the isolated world, which stock
 *   WebKit doesn't have, and a global the page set isn't visible from it.
 * - `page.evaluate("result")` and the other globals the fixtures set are `pageGlobal`, a main-world read of `window`.
 *   A frame's globals are `frameGlobal`, a read of its `contentWindow` from the page, which works for same-origin frames
 *   only.
 * - A click the original keeps a promise of (`const clicked = page.click(…).then(() => done = true)`) is a child fiber
 *   started at once, which sets a flag when it completes, and is joined where the original awaits it.
 * - `giveItAChanceToClick` is Playwright's `rafraf(page, 5)`: the harness's `rafraf` (two animation frames) five times.
 * - `page.addStyleTag` (CL-027) appends the page's own `<style>` element in the main world, which is what it does.
 * - `page.setViewportSize` is `page.emulate({ viewport })`, whose registration lasts as long as the test does.
 * - `attachFrame` is the harness's, which appends the iframe in the main world and waits for its load.
 * - `page.on("console")` and the messages it collects are `ConsoleMessage.history(page)`. A message arrives after the
 *   click it logs in, so the port polls the history with `Expect.that`, as `expect.poll` does.
 * - `page.mouse.down()` and `page.mouse.up()` are a held button in a scope: `hold("left")`, released by closing the
 *   scope. `page.keyboard.down()` and `up()` are the same with `keyboard.hold`.
 * - `{ signal }` and `controller.abort()` (CL-090, CL-092) are a click in a child fiber and `Fiber.interrupt`, which is how
 *   Strider cancels a call (matrix row option-locator-click-signal). The port asserts the click ends interrupted, and
 *   that an already-interrupted click clicks nothing; Playwright's `AbortError`, its `cause`, and its call log have no
 *   counterpart, so CL-091 and CL-093, which only check a string reason's wrapping, aren't ported (see the ledger).
 *   `page.waitForTimeout(500)` (CL-090) is the original's own step, which lets the action start before the abort: a sleep.
 * - `window.builtins.setTimeout` is Playwright's copy of `setTimeout`, which its tests use so a page can't replace it.
 *   The page here doesn't replace `setTimeout`, so the port calls `window.setTimeout`.
 * - Playwright issue annotations (`it.info().annotations`, `annotation:`) aren't kept: the harness has no place for them.
 * - CL-035 and CL-089 are described in their own comments.
 * - Playwright's `it.skip(isFrozenWebkit, …)`, `it.skip(isAndroid, …)`, and `it.fixme(isAndroid, …)` don't apply to
 *   Strider, which isn't Android, and whose WebKit is stock WebKit: the Playwright conditions that skip the WebKit
 *   builds are ported and run on stock WebKit. `it.fixme(browserName === "chromium")` in CL-035 is ported and run on
 *   every browser, as the file's other fixmes are.
 * - `isWindows` in CL-083 is `process.platform === "win32"`, which is false on the Linux runs.
 * - The tests that Playwright's internal hooks drive (`__testHookBeforeStable`, `mode`, `requestGC`) and the abort
 *   reasons (CL-091, CL-093) aren't ported; see the ledger.
 */
import { assert } from "@effect/vitest"
import { Condition, ConsoleMessage, Deadline, Expect, Locator, Page, Popup } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import { attachFrame, rafraf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

interface CheckboxResult {
  readonly check: boolean | null
  readonly events: ReadonlyArray<string>
}

/** The page globals the fixtures' scripts define, called or read by the tests that use them. */
interface PageFunctions {
  readonly addButton: () => void
  readonly stopButton: (remove: boolean) => void
}

/** A global the page's own scripts set (`window.result`, `window.__CLICKED`, and the like), read in the main world. */
const pageGlobal = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name: string) => (window as unknown as Record<string, unknown>)[name], name)

/** A global of a same-origin frame, found by its element's selector, read in the main world. */
const frameGlobal = (page: Page.Page, selector: string, name: string) =>
  page.evaluateInMainWorld(
    (selector: string, name: string) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement
      return (frame.contentWindow as unknown as Record<string, unknown>)[name]
    },
    selector,
    name
  )

/** Playwright's `giveItAChanceToClick`: `rafraf(page, 5)`, five times two animation frames in the page. */
const giveItAChanceToClick = Effect.fnUntraced(function*(page: Page.Page) {
  for (let i = 0; i < 5; i++) yield* rafraf(page)
})

/**
 * Playwright's `force: true`. Its click then skips the visible, enabled, stable, non-inert, and hit-target checks, and the
 * action pre-checks, but still scrolls the element into view and fails where no point of it is within the viewport
 * ("Element is not visible", "Element is outside of the viewport"). That is every check off but `inViewport`; `rendered`
 * is Strider's own wait for a drawn frame, which Playwright's click has no counterpart of.
 */
const forceChecks: Locator.Checks = {
  rendered: false,
  visible: false,
  enabled: false,
  notInert: false,
  receivesPointer: false,
  stable: false
}

/**
 * Playwright's `page.click(…)` that the test holds across steps. The click starts at once, and `done` reports whether
 * it has completed, as `.then(() => done = true)` does; its failure is the test's, where the original awaits it.
 */
const startClick = Effect.fnUntraced(function*<E, R>(click: Effect.Effect<void, E, R>) {
  const finished = yield* Ref.make(false)
  const fiber = yield* Effect.forkChild(click.pipe(Effect.andThen(Ref.set(finished, true))), {
    startImmediately: true
  })
  return { fiber, done: Ref.get(finished) }
})

/** The error of a call that Playwright's test expects to fail (its `.catch(e => e)`); a call that succeeds fails. */
const failureOf = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the call succeeded, where Playwright's call fails")
  return result.failure
})

/** A `Deadline.Timeout` from a click that Playwright's test expects to time out, with its budget and operation. */
const clickTimeout = (error: unknown, budget: number): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  // Strider names the operation `Locator.click`
  assert.strictEqual(error.operation, "Locator.click")
  // Strider's budget counts from when the click starts: the timeout less the moments before then
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  return error
}

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string; readonly by?: string; readonly dialog?: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The messages of the page's console, as text, in the order they were logged. */
const consoleTexts = (page: Page.Page) =>
  Effect.map(ConsoleMessage.history(page), (history) => history.entries.map((message) => message.text))

/** Polls `subject` until it holds `expected`, as Playwright's `expect.poll(…).toEqual(…)` does. */
const pollEqual = (subject: Effect.Effect<ReadonlyArray<string>, unknown, never>, expected: ReadonlyArray<string>) =>
  Expect.that(
    subject,
    Condition.make(
      `equal ${JSON.stringify(expected)}`,
      (actual: ReadonlyArray<string>) => JSON.stringify(actual) === JSON.stringify(expected)
    )
  )

/** Playwright's `expect.arrayContaining(expected)` on an array of arrays. */
const expectArrayContaining = (actual: ReadonlyArray<unknown>, expected: ReadonlyArray<unknown>) => {
  for (const entry of expected) assert.deepInclude(actual as Array<unknown>, entry)
}

/** The state of `input/checkbox.html`, which its script keeps in `window.result`. */
const checkboxResult = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { result: CheckboxResult }).result)

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

upstream(import.meta.filename, {}, (test) => {
  test("CL-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/frameset.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("frame") as HTMLFrameElement).src = "/input/button.html"
      })
      // The frameset has four frames, so the first one, as Playwright's `page.$("frame")` takes
      const frame = page.frame(page.locator("frame").first)
      yield* frame.locator("button").click()
      assert.strictEqual(yield* frameGlobal(page, "frame", "result"), "Clicked")
    }))

  test("CL-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/counter.html", { waitUntil: "load" })
      // The popup's listener starts before the `window.open` that opens it, as Playwright's `waitForEvent` does
      const popups = yield* Popup.next(page)
      // Playwright's browsers let a script open a popup; Strider's don't without a user gesture, so the call runs with one
      yield* page.evaluateInMainWorld(() => {
        window.open("/counter.html")
      }).pipe(Page.withUserGesture)
      const popup = yield* popups
      const clicks: Array<Effect.Effect<void, unknown>> = []
      for (let i = 0; i < 21; ++i) {
        if (i % 3 === 0) clicks.push(popup.locator("button").click())
        else clicks.push(page.locator("button").click())
      }
      yield* Effect.all(clicks, { concurrency: "unbounded" })
      assert.strictEqual(yield* pageGlobal(page, "count"), 14)
      assert.strictEqual(yield* pageGlobal(popup, "count"), 7)
    }))

  test("CL-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <svg height="100" width="100">
      <circle onclick="window.__CLICKED=42" cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />
    </svg>
  `)
      yield* page.locator("circle").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), 42)
    }))

  test("CL-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        delete (window as unknown as { Node?: unknown }).Node
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  // @see https://github.com/GoogleChrome/puppeteer/issues/4281
  test("CL-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
    span::before {
      content: 'q';
    }
    </style>
    <span onclick='window.CLICKED=42'></span>
  `)
      yield* page.locator("span").click()
      assert.strictEqual(yield* pageGlobal(page, "CLICKED"), 42)
    }))

  test("CL-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style="width: 1px; height: 1px;" onclick="window.__clicked = true"></div>`)
      yield* page.locator("div").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div style="margin-left: 20.5px; margin-top: 11.5px; width: 1px; height: 1px;" onclick="window.__clicked = true"></div>`
      )
      yield* page.locator("div").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div style="margin-left: 20.23px; margin-top: 11.65px; width: 1px; height: 1px;" onclick="window.__clicked = true"></div>`
      )
      yield* page.locator("div").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div style="margin-left: 20.68px; margin-top: 11.13px; width: 1px; height: 1px;" onclick="window.__clicked = true"></div>`
      )
      yield* page.locator("div").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div style="margin-left: 20.68px; margin-top: 11.52px; width: 1px; height: 1px;" onclick="window.__clicked = true"></div>`
      )
      yield* page.locator("div").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div style="margin-left: 20.15px; margin-top: 11.24px; width: 1px; height: 1px;" onclick="window.__clicked = true"></div>`
      )
      yield* page.locator("div").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
    i {
      position: absolute;
      top: -1000px;
    }
    </style>
    <span onclick='window.CLICKED = 42;'><i>woof</i><b>doggo</b></span>
  `)
      yield* page.locator("span").click()
      assert.strictEqual(yield* pageGlobal(page, "CLICKED"), 42)
    }))

  test("CL-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", { waitUntil: "load" })
      for (let i = 0; i < 11; ++i) {
        // We might've scrolled to click a button - reset to (0, 0).
        yield* page.evaluateInMainWorld(() => window.scrollTo(0, 0))
        yield* page.locator(`#btn${i}`).click()
      }
      assert.deepStrictEqual(yield* consoleTexts(page), [
        "button #0 clicked",
        "button #1 clicked",
        "button #2 clicked",
        "button #3 clicked",
        "button #4 clicked",
        "button #5 clicked",
        "button #6 clicked",
        "button #7 clicked",
        "button #8 clicked",
        "button #9 clicked",
        "button #10 clicked"
      ])
    }))

  test("CL-018", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.display = "none"
      })
      // Playwright's `force` skips the visibility check but still needs a point to click, and a `display: none` button has none
      const error = yield* failureOf(page.locator("button").click({ checks: forceChecks }))
      assert.include(messageOf(error), "visible")
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("CL-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.display = "none"
      })
      const clicked = yield* startClick(page.locator("button").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.display = "block"
      })
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-021", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.visibility = "hidden"
      })
      const clicked = yield* startClick(page.locator("button").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.visibility = "visible"
      })
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button")!.parentElement as HTMLElement).style.display = "none"
      })
      const clicked = yield* startClick(page.locator("button").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button")!.parentElement as HTMLElement).style.display = "block"
      })
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/wrappedlink.html", { waitUntil: "load" })
      yield* page.locator("a").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-024", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/checkbox.html", { waitUntil: "load" })
      assert.strictEqual((yield* checkboxResult(page)).check, null)
      yield* page.locator("input#agree").click()
      assert.strictEqual((yield* checkboxResult(page)).check, true)
      // The original drops mouseout and mouseleave when it runs headful. Strider runs these browsers headless, so
      // every event the page logs is kept.
      const events = (yield* checkboxResult(page)).events
      assert.deepStrictEqual(events, [
        "mouseover",
        "mouseenter",
        "mousemove",
        "mousedown",
        "mouseup",
        "click",
        "input",
        "change"
      ])
      yield* page.locator("input#agree").click()
      assert.strictEqual((yield* checkboxResult(page)).check, false)
    }))

  test("CL-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/checkbox.html", { waitUntil: "load" })
      assert.strictEqual((yield* checkboxResult(page)).check, null)
      yield* page.locator(`label[for="agree"]`).click()
      assert.strictEqual((yield* checkboxResult(page)).check, true)
      assert.deepStrictEqual((yield* checkboxResult(page)).events, ["click", "input", "change"])
      yield* page.locator(`label[for="agree"]`).click()
      assert.strictEqual((yield* checkboxResult(page)).check, false)
    }))

  test("CL-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-5").click()
      assert.strictEqual(yield* page.locator("#button-5").readText, "clicked")
      yield* page.locator("#button-80").click()
      assert.strictEqual(yield* page.locator("#button-80").readText, "clicked")
    }))

  test("CL-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      // Playwright's `addStyleTag` appends a `<style>` element to the page; this does the same in the main world
      yield* page.evaluateInMainWorld(() => {
        const style = document.createElement("style")
        style.textContent = "html { scroll-behavior: smooth; }"
        document.head.appendChild(style)
      })
      for (let i = 0; i < 5; i++) {
        yield* page.locator("#button-80").click()
        assert.strictEqual(yield* page.locator("#button-80").readText, "clicked")
        yield* page.locator("#button-20").click()
        assert.strictEqual(yield* page.locator("#button-20").readText, "clicked")
      }
    }))

  test("CL-028", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as Record<string, unknown>)["double"] = false
        const button = document.querySelector("button")!
        button.addEventListener("dblclick", () => {
          ;(window as unknown as Record<string, unknown>)["double"] = true
        })
      })
      yield* page.locator("button").dblclick()
      assert.strictEqual(yield* pageGlobal(page, "double"), true)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.textContent = "Some really long text that will go offscreen"
        button.style.position = "absolute"
        button.style.left = "368px"
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-030", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/rotatedButton.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-8").click({ button: "right" })
      assert.strictEqual(yield* page.locator("#button-8").readText, "context menu")
    }))

  test("CL-032", ({ page, server }) =>
    Effect.gen(function*() {
      // @see https://github.com/GoogleChrome/puppeteer/issues/206
      yield* page.setContent(`<a href="${server.EMPTY_PAGE}">empty.html</a>`)
      // This click should not hang.
      yield* page.locator("a").click()
    }))

  test("CL-033", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/204", (_request, response) => {
        response.statusCode = 204
        response.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href="${server.PREFIX}/204">link</a>`)
      yield* page.locator("a").click().pipe(Deadline.within("5 seconds"))
      assert.strictEqual(String(yield* page.url), server.EMPTY_PAGE)
    }))

  test("CL-034", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<div style="width:100px;height:100px">spacer</div>`)
      const frame = yield* attachFrame(page, "button-test", server.PREFIX + "/input/button.html")
      yield* frame.locator("button").click()
      assert.strictEqual(yield* frameGlobal(page, "#button-test", "result"), "Clicked")
    }))

  test("CL-035", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.setContent(`<div style="width:100px;height:2000px">spacer</div>`)
      const frame = yield* attachFrame(page, "button-test", server.CROSS_PROCESS_PREFIX + "/input/button.html")
      const button = frame.locator("button")
      // The frame is cross-origin, so the page can't read its `result`. Its click is observed from the frame's own
      // isolated world instead: a listener there sets `data-clicked`, which the port reads. The style change is the
      // original's `frame.$eval`, which the page can't reach in a cross-origin frame's main world either.
      yield* button.evaluate((element) => {
        const html = element as HTMLElement
        html.style.setProperty("position", "fixed")
        html.addEventListener("click", () => html.setAttribute("data-clicked", "true"))
      })
      yield* button.click()
      assert.deepStrictEqual(yield* button.readAttribute("data-clicked"), Option.some("true"))
    }))

  test("CL-036", ({ page }) =>
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
      background: red;
      height: 160px;
    }
    </style>

    <div class=fixed></div>

    <ol>
    <li>hi1</li><li>hi2</li><li>hi3</li><li>hi4</li><li>hi5</li><li>hi6</li><li>hi7</li><li>hi8</li>
    <li id=target onclick="window.__clicked = true">hi9</li>
    <li>hi10</li><li>hi11</li><li>hi12</li><li>hi13</li><li id=li14>hi14</li>
    </ol>
  `)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#li14")!.scrollIntoView()
      })
      yield* page.locator("#target").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-037", ({ page }) =>
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
      height: 100vh;
      overflow: scroll;
      padding-top: 160px;
    }
    body {
      position: relative;
    }
    div.fixed {
      position: absolute;
      top: 0;
      z-index: 1001;
      width: 100%;
      background: red;
      height: 160px;
    }
    </style>

    <ol>
    <li>hi1</li><li>hi2</li><li>hi3</li><li>hi4</li><li>hi5</li><li>hi6</li><li>hi7</li><li>hi8</li>
    <li id=target onclick="window.__clicked = true">hi9</li>
    <li>hi10</li><li>hi11</li><li>hi12</li><li>hi13</li><li id=li14>hi14</li>
    </ol>

    <div class=fixed>Overlay</div>
  `)
      yield* page.evaluateInMainWorld(() => {
        const ol = document.querySelector("ol")!
        const target = document.querySelector("#target") as HTMLElement
        ol.scrollTo({ top: target.offsetTop, behavior: "instant" })
      })
      yield* page.locator("#target").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-038", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.borderWidth = "8px"
      })
      yield* page.locator("button").click({ position: { x: 20, y: 10 } })
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
      // Safari reports border-relative offsetX/offsetY.
      assert.strictEqual(yield* pageGlobal(page, "offsetX"), 20)
      assert.strictEqual(yield* pageGlobal(page, "offsetY"), 10)
    }))

  test("CL-039", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.borderWidth = "2em"
      })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.fontSize = "12px"
      })
      yield* page.locator("button").click({ position: { x: 20, y: 10 } })
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
      // Safari reports border-relative offsetX/offsetY.
      assert.strictEqual(yield* pageGlobal(page, "offsetX"), 20)
      assert.strictEqual(yield* pageGlobal(page, "offsetY"), 10)
    }))

  test("CL-040", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.borderWidth = "8px"
      })
      yield* page.evaluateInMainWorld(() => {
        const style = (document.querySelector("button") as HTMLElement).style
        style.height = style.width = "2000px"
      })
      yield* page.locator("button").click({ position: { x: 1900, y: 1910 } })
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
      // Safari reports border-relative offsetX/offsetY.
      assert.strictEqual(yield* pageGlobal(page, "offsetX"), 1900)
      assert.strictEqual(yield* pageGlobal(page, "offsetY"), 1910)
    }))

  test("CL-041", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        const container = document.createElement("div")
        container.style.overflow = "auto"
        container.style.width = "200px"
        container.style.height = "200px"
        button.parentElement!.insertBefore(container, button)
        container.appendChild(button)
        button.style.height = "2000px"
        button.style.width = "2000px"
        button.style.borderWidth = "8px"
      })
      yield* page.locator("button").click({ position: { x: 1900, y: 1910 } })
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
      // Safari reports border-relative offsetX/offsetY.
      assert.strictEqual(yield* pageGlobal(page, "offsetX"), 1900)
      assert.strictEqual(yield* pageGlobal(page, "offsetY"), 1910)
    }))

  test("CL-042", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button") as HTMLElement
        button.style.transition = "margin 500ms linear 0s"
        button.style.marginLeft = "200px"
        button.style.borderWidth = "0"
        button.style.width = "200px"
        button.style.height = "20px"
        // Set display to "block" - otherwise Firefox layouts with non-even
        // values on Linux.
        button.style.display = "block"
        document.body.style.margin = "0"
      })
      // rafraf for Firefox to kick in the animation.
      yield* rafraf(page)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
      assert.strictEqual(yield* pageGlobal(page, "pageX"), 300)
      assert.strictEqual(yield* pageGlobal(page, "pageY"), 10)
    }))

  test("CL-043", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button") as HTMLElement
        button.style.borderWidth = "0"
        button.style.width = "200px"
        button.style.height = "20px"
        document.body.style.margin = "0"
        document.body.style.position = "relative"
        const flyOver = document.createElement("div")
        flyOver.className = "flyover"
        flyOver.style.position = "absolute"
        flyOver.style.width = "400px"
        flyOver.style.height = "20px"
        flyOver.style.left = "-200px"
        flyOver.style.top = "0"
        flyOver.style.background = "red"
        document.body.appendChild(flyOver)
      })
      const clicked = yield* startClick(page.locator("button").click())
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector(".flyover") as HTMLElement).style.left = "0"
      })
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector(".flyover") as HTMLElement).style.left = "200px"
      })
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-044", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button") as HTMLElement
        button.style.borderWidth = "0"
        button.style.width = "200px"
        button.style.height = "20px"
        document.body.style.margin = "0"
        document.body.style.position = "relative"
        const flyOver = document.createElement("div")
        flyOver.className = "flyover"
        flyOver.style.position = "absolute"
        flyOver.style.width = "400px"
        flyOver.style.height = "20px"
        flyOver.style.left = "-200px"
        flyOver.style.top = "0"
        flyOver.style.background = "red"
        document.body.appendChild(flyOver)
      })
      const clicked = yield* startClick(page.locator("button").click({ trial: true }))
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector(".flyover") as HTMLElement).style.left = "0"
      })
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector(".flyover") as HTMLElement).style.left = "200px"
      })
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      // Should not actually click.
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("CL-045", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLButtonElement).disabled = true
      })
      const error = yield* failureOf(page.locator("button").click({ trial: true }).pipe(Deadline.within("2 seconds")))
      // Playwright's message names the trial run; Strider's timeout names the click and the reason it last saw
      const timeout = clickTimeout(error, 2000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Disabled")
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("CL-046", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click({ trial: true })
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("CL-047", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as Record<string, unknown>)["double"] = false
        const button = document.querySelector("button")!
        button.addEventListener("dblclick", () => {
          ;(window as unknown as Record<string, unknown>)["double"] = true
        })
      })
      yield* page.locator("button").dblclick({ trial: true })
      assert.strictEqual(yield* pageGlobal(page, "double"), false)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("CL-048", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const button = page.locator("button")
      yield* page.evaluateInMainWorld(() => {
        document.body.style.position = "relative"
        const blocker = document.createElement("div")
        blocker.style.position = "absolute"
        blocker.style.width = "400px"
        blocker.style.height = "20px"
        blocker.style.left = "0"
        blocker.style.top = "0"
        document.body.appendChild(blocker)
      })
      yield* button.click({ checks: forceChecks })
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("CL-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<button onclick="window.__CLICKED=true;" disabled><span>Click target</span></button>`
      )
      const clicked = yield* startClick(page.getByText("Click target").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => document.querySelector("button")!.removeAttribute("disabled"))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-050", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div inert id=container><button onclick="window.__CLICKED=true;"><span>Click target</span></button></div>`
      )
      const clicked = yield* startClick(page.getByText("Click target").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => document.getElementById("container")!.removeAttribute("inert"))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-051", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button onclick="window.__CLICKED=true;">Click target</button>
    <dialog id=dialog><button onclick="window.__DIALOG_CLICKED=true;">Inside</button></dialog>
    <script>
      document.getElementById('dialog').showModal();
    </script>
  `)
      yield* page.getByText("Inside").click()
      assert.strictEqual(yield* pageGlobal(page, "__DIALOG_CLICKED"), true)

      const clicked = yield* startClick(page.getByText("Click target").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => (document.getElementById("dialog") as HTMLDialogElement).close())
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-052", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input onclick="window.__CLICKED=true;" disabled>`)
      const clicked = yield* startClick(page.locator("input").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => document.querySelector("input")!.removeAttribute("disabled"))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-053", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select disabled><option selected>Hello</option></select>
    <script>
      document.querySelector('select').addEventListener('mousedown', event => {
        window.__CLICKED=true;
        event.preventDefault();
      });
    </script>
  `)
      const clicked = yield* startClick(page.locator("select").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => document.querySelector("select")!.removeAttribute("disabled"))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-054", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div onclick="window.__CLICKED=true" disabled>Click target</div>`)
      yield* page.getByText("Click target").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-055", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<button onclick="window.__CLICKED=true" style="pointer-events:none"><span>Click target</span></button>`
      )
      const clicked = yield* startClick(page.getByText("Click target").click())
      yield* giveItAChanceToClick(page)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      assert.strictEqual(yield* clicked.done, false)
      yield* page.evaluateInMainWorld(() => document.querySelector("button")!.style.removeProperty("pointer-events"))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-056", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<label onclick="window.__CLICKED=true" style="pointer-events:none"><span>Click target</span></label>`
      )
      const clicked = yield* startClick(page.getByText("Click target").click())
      // Do a few roundtrips to the page.
      for (let i = 0; i < 5; ++i) {
        assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
      }
      // remove `pointer-events: none` css from button.
      yield* page.evaluateInMainWorld(() => document.querySelector("label")!.style.removeProperty("pointer-events"))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-057", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click({ modifiers: ["Shift"] })
      assert.strictEqual(yield* pageGlobal(page, "shiftKey"), true)
      yield* page.locator("button").click({ modifiers: [] })
      assert.strictEqual(yield* pageGlobal(page, "shiftKey"), false)

      // `keyboard.down` holds the key until its scope closes, which is `keyboard.up`
      const shift = yield* Scope.make()
      yield* page.keyboard.hold("Shift").pipe(Scope.provide(shift))
      yield* page.locator("button").click({ modifiers: [] })
      assert.strictEqual(yield* pageGlobal(page, "shiftKey"), false)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "shiftKey"), true)
      yield* Scope.close(shift, Exit.void)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "shiftKey"), false)
    }))

  test("CL-058", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="border: 1px solid black; height: 500px; overflow: auto; width: 500px; scroll-behavior: smooth">
    <button style="margin-top: 2000px" onClick="window.clicked = true">hi</button>
    </div>
  `)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "clicked"), true)
    }))

  test("CL-061", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/animating-button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => (window as unknown as PageFunctions).addButton())
      const clicked = yield* startClick(page.locator("button").click())
      assert.strictEqual(yield* clicked.done, false)
      assert.strictEqual(yield* pageGlobal(page, "clicked"), undefined)
      yield* page.evaluateInMainWorld(() => (window as unknown as PageFunctions).stopButton(true))
      yield* page.evaluateInMainWorld(() => (window as unknown as PageFunctions).addButton())
      assert.strictEqual(yield* clicked.done, false)
      assert.strictEqual(yield* pageGlobal(page, "clicked"), undefined)
      yield* page.evaluateInMainWorld(() => (window as unknown as PageFunctions).stopButton(true))
      yield* page.evaluateInMainWorld(() => (window as unknown as PageFunctions).addButton())
      assert.strictEqual(yield* clicked.done, false)
      assert.strictEqual(yield* pageGlobal(page, "clicked"), undefined)
      yield* page.evaluateInMainWorld(() => (window as unknown as PageFunctions).stopButton(false))
      yield* Fiber.join(clicked.fiber)
      assert.strictEqual(yield* clicked.done, true)
      assert.strictEqual(yield* pageGlobal(page, "clicked"), true)
    }))

  test("CL-062", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<style>
    @keyframes move {
      from { left: -300px; }
      to { left: 0; }
    }
    button {
      position: absolute;
      left: -300px;
      top: 0;
      bottom: 0;
      width: 200px;
    }
    button.animated {
      animation: 1s linear 1s move forwards;
    }
    </style>
    <div style="position: relative; width: 300px; height: 300px;">
      <button onclick="window.clicked=true"></button>
    </div>
  `)
      const promise = yield* startClick(page.locator("button").click())
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.className = "animated"
      })
      yield* Fiber.join(promise.fiber)
      assert.strictEqual(yield* pageGlobal(page, "clicked"), true)
    }))

  test("CL-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<style>
    @keyframes move {
      from { left: -300px; }
      to { left: 0; }
    }
    button {
      position: absolute;
      left: -300px;
      top: 0;
      bottom: 0;
      width: 200px;
    }
    button.animated {
      animation: 1s linear 1s move forwards;
    }
    </style>
    <div style="position: relative; width: 300px; height: 300px;">
      <button onclick="window.clicked=true"></button>
    </div>
  `)
      const promise = yield* startClick(page.locator("button").click({ checks: forceChecks }))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.className = "animated"
      })
      const error = yield* failureOf(Fiber.join(promise.fiber))
      assert.strictEqual(yield* pageGlobal(page, "clicked"), undefined)
      assert.include(messageOf(error), "outside of the viewport")
    }))

  test("CL-064", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button id=button>Click me</button>
    <script>
      let mutationCount = 0;
      const observer = new MutationObserver((mutationsList, observer) => {
        for(let mutation of mutationsList)
          ++mutationCount;
      });
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      button.addEventListener('mousedown', () => {
        mutationCount = 0;
        document.body.appendChild(document.createElement('div'));
      });
      button.addEventListener('mouseup', () => {
        window['result'] = mutationCount;
      });
    </script>
  `)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), 1)
    }))

  test("CL-065", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        Object.defineProperty(window, "innerWidth", { value: 0 })
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("CL-066", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <label>
      Click me
      <input onclick="window.__clicked=true" style="width:0;height:0;padding:0;margin:0;border:0;">
    </label>
  `)
      yield* page.getByText("Click me").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("CL-070", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<button onclick="window.__CLICKED=true;"><label style="pointer-events:none">Click target</label></button>`
      )
      yield* page.getByText("Click target").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-071", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div role=button onclick="window.__CLICKED=true;"><div style="pointer-events:none"><span><div>Click target</div></span></div>`
      )
      yield* page.getByText("Click target").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-072", ({ page }) =>
    Effect.gen(function*() {
      // For Firefox its not allowed to return anything: https://bugzilla.mozilla.org/show_bug.cgi?id=1392046
      // Note the intermediate div - it is necessary, otherwise <a><non-clickable/></a> is not recognized as a clickable link.
      yield* page.setContent(
        `<a href="#" onclick="window.__CLICKED=true" id="outer"><div id="intermediate"><div id="inner" style="pointer-events: none">Inner</div></div></a>`
      )
      yield* page.locator("#inner").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-073", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div role=link onclick="window.__CLICKED=true" id="outer"><div id="inner" style="pointer-events: none">Inner</div></div>`
      )
      yield* page.locator("#inner").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), true)
    }))

  test("CL-074", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; box-sizing: border-box; }
      iframe { border: 4px solid black; background: gray; margin-left: 33px; margin-top: 24px; width: 400px; height: 400px; }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { margin-left: 10px; margin-top: 20px; width: 2px; height: 2px; }
      </style>
      <div>Target</div>
      <script>
        document.querySelector('div').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      const locator = page.frame(page.locator("iframe")).locator("div")
      yield* locator.click()
      assert.strictEqual(yield* pageGlobal(page, "_clicked"), true)
    }))

  test("CL-075", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; }
      iframe { border: 4px solid black; background: gray; margin-left: 33px; margin-top: 24px; width: 400px; height: 400px; }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { margin-left: 10px; margin-top: 20px; width: 2px; height: 2px; }
      </style>
      <div>Target</div>
      <script>
        document.querySelector('div').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      const locator = page.frame(page.locator("iframe")).locator("div")
      yield* locator.click()
      assert.strictEqual(yield* pageGlobal(page, "_clicked"), true)
    }))

  test("CL-077", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; }
      iframe {
        border: 4px solid black;
        background: gray;
        margin-left: 33px;
        margin-top: 24px;
        width: 400px;
        height: 400px;
        transform: translate(100px, 100px) scale(1.2) rotate3d(1, 1, 1, 25deg);
      }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { margin-left: 10px; margin-top: 20px; width: 2px; height: 2px; }
      </style>
      <div>Target</div>
      <script>
        document.querySelector('div').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      const locator = page.frame(page.locator("iframe")).locator("div")
      yield* locator.click()
      assert.strictEqual(yield* pageGlobal(page, "_clicked"), true)
    }))

  test("CL-078", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <style>body, html { padding: 0; margin: 0; }</style>
    <script type='text/javascript'>
      window.addEventListener('DOMContentLoaded', () => {
        // Viewport filled with buttons.
        for (let i = 0; i < 100; ++i) {
          const button = document.createElement('button');
          button.textContent = i;
          button.style.setProperty('width', '50px');
          button.style.setProperty('height', '50px');
          document.body.append(button);
        }
      }, false);
    </script>
  `)
      // Issue a geolocation request. This should show a browser popup.
      // NOTE: this is a bit racy since we can't wait for the geolocation
      // popup to be shown.
      yield* page.evaluateInMainWorld(() => {
        navigator.geolocation.getCurrentPosition(() => {})
      })
      // If popup blocks the click, then some of the `page.click` calls below will hang.
      for (let i = 0; i < 30; ++i) {
        // `text=` takes the first match, which `.first` does too
        yield* page.getByText(String(i)).first.click()
      }
    }))

  test("CL-079", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; }
      iframe { background: gray; margin-left: 33px; margin-top: 24px; width: 400px; height: 400px; transform: translate(-40px, -40px) scale(0.8); }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { margin-left: 10px; margin-top: 20px; width: 2px; height: 2px; }
      </style>
      <div>Target</div>
      <script>
        document.querySelector('div').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      const locator = page.frame(page.locator("iframe")).locator("div")
      yield* locator.click({ checks: forceChecks })
      assert.strictEqual(yield* pageGlobal(page, "_clicked"), true)
    }))

  test("CL-080", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; box-sizing: border-box; }
      iframe { border: 1px solid black; background: gray; margin-left: 33px; margin-top: 24px; width: 400px; height: 400px; transform: scale(0.8); }
    </style>
    <iframe srcdoc="
      <style>
        body, html, iframe { margin: 0; padding: 0; box-sizing: border-box; }
        iframe { border: 3px solid black; background: gray; margin-left: 18px; margin-top: 14px; width: 200px; height: 200px; transform: scale(0.7); }
      </style>
      <iframe srcdoc='
        <style>
          div { margin-left: 10px; margin-top: 20px; width: 2px; height: 2px; }
        </style>
        <div>Target</div>
      '></iframe>
    "></iframe>
  `)
      const outer = page.frame(page.locator("iframe"))
      const locator = outer.frame(outer.locator("iframe")).locator("div")
      yield* Expect.toBeAttached(locator)
      // The original's `locator.evaluate` runs in the main world, and sets `window.top` there. Strider's `evaluate` is
      // the isolated world, where the same listener would set the isolated world's `window.top`, so the port sets it
      // from the main world, on the same nested document.
      yield* page.evaluateInMainWorld(() => {
        const nested = (document.querySelector("iframe") as HTMLIFrameElement).contentDocument!
          .querySelector("iframe") as HTMLIFrameElement
        const div = nested.contentDocument!.querySelector("div")!
        div.addEventListener("click", () => {
          ;(window.top as unknown as Record<string, unknown>)["_clicked"] = true
        })
      })
      yield* locator.click()
      assert.strictEqual(yield* pageGlobal(page, "_clicked"), true)
    }))

  test("CL-081", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div id="outer" style="background: #d4d4d4; width: 60px; height: 60px;">
      <div id="inner" style="background: #adadad; width: 46px; height: 46px;"></div>
    </div>
  `)
      yield* page.evaluateInMainWorld(() => {
        function onClick(name: string) {
          console.log(`click ${name}`)

          // `window.setTimeout`, where Playwright's own copy is `window.builtins.setTimeout`
          window.setTimeout(function() {
            console.log(`timeout ${name}`)
          }, 0)

          void Promise.resolve().then(function() {
            console.log(`promise ${name}`)
          })
        }

        document.getElementById("inner")!.addEventListener("click", () => onClick("inner"))
        document.getElementById("outer")!.addEventListener("click", () => onClick("outer"))
      })

      // Click on the inner div element
      yield* page.locator("#inner").click()

      yield* pollEqual(consoleTexts(page), [
        "click inner",
        "promise inner",
        "click outer",
        "promise outer",
        "timeout inner",
        "timeout outer"
      ])
    }))

  test("CL-082", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <select>
        <option>very long text #1</option>
        <option>very long text #2</option>
        <option>very long text #3</option>
        <option>very long text #4</option>
        <option>very long text #5</option>
        <option>very long text #6</option>
      </select>
    </div>
    <div>
      <button onclick="window.__CLICKED=42">clickme</button>
    </div>
  `)
      yield* page.locator("select").click()
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), 42)
    }))

  test("CL-083", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <button id="target">Click me</button>
  `)
      yield* page.evaluateInMainWorld(() => {
        const logEvent = (e: Event) => console.log(e.type)
        document.addEventListener("mousedown", logEvent)
        document.addEventListener("mouseup", logEvent)
        document.addEventListener("contextmenu", logEvent)
      })
      yield* page.getByRole("button", { name: "Click me" }).click({ button: "right" })
      const expected = process.platform === "win32" && browserName === "chromium"
        ? ["mousedown", "mouseup", "contextmenu"]
        : ["mousedown", "contextmenu", "mouseup"]
      yield* pollEqual(consoleTexts(page), expected)
    }))

  test("CL-084", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>Click me</button>
    <script>
      const button = document.querySelector('button');
      button.addEventListener('click', () => button.textContent = 'Clicked!');
    </script>
  `)
      yield* page.getByRole("button").click({ button: "right" })
      yield* page.getByRole("button").click()
      yield* Expect.toHaveText(page.getByRole("button"), "Clicked!")
    }))

  test("CL-085", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button id="target">Click me</button>
    <script>
      window['pressures'] = [];
      document.addEventListener('pointerdown', e => window['pressures'].push(['pointerdown', e.pressure]));
      document.addEventListener('pointerup', e => window['pressures'].push(['pointerup', e.pressure]));
    </script>
  `)
      yield* page.locator("button").click()
      const pressures = (yield* pageGlobal(page, "pressures")) as ReadonlyArray<unknown>
      expectArrayContaining(pressures, [
        ["pointerdown", 0.5],
        ["pointerup", 0]
      ])
    }))

  test("CL-086", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <body style="margin: 0; padding: 0;">
      <div id="target" style="width: 500px; height: 500px; background-color: red;"></div>
      <script>
        window['pressures'] = [];
        document.addEventListener('pointermove', e => window['pressures'].push([e.pressure, e.clientX, e.clientY]));
      </script>
    </body>
  `)
      yield* page.locator("div#target").click()
      yield* page.mouse.move({ x: 10, y: 10 })
      // `mouse.down` holds the button until its scope closes, which is `mouse.up`
      const held = yield* Scope.make()
      yield* page.mouse.hold("left").pipe(Scope.provide(held))
      yield* page.mouse.move({ x: 250, y: 250 })
      yield* Scope.close(held, Exit.void)
      yield* page.mouse.move({ x: 50, y: 50 })
      const pressures = (yield* pageGlobal(page, "pressures")) as ReadonlyArray<unknown>
      expectArrayContaining(pressures, [
        [0, 250, 250],
        [0, 10, 10],
        [0.5, 250, 250],
        [0, 50, 50]
      ])
    }))

  test("CL-087", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <my-button>
      <template shadowrootmode="open">
        <button><slot></slot></button>
      </template>
      <div>Foo</div>
    </my-button>
  `)
      yield* page.getByRole("button", { name: "Foo" }).click()
    }))

  test("CL-088", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <my-button>
      <template shadowrootmode="open">
        <button><slot></slot></button>
      </template>
      <div>Foo</div>
    </my-button>
  `)
      yield* page.locator("my-button").click()
    }))

  test("CL-089", ({ page, browserName }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <body style="margin: 0; padding: 0; height: 500px; width: 500px;">
      <div style="position: relative; top: 280px; left: 150px; width: 100px; height: 40px">Click me</div>
    </body>
  `)

      // The test becomes flaky on WebKit without next line.
      if (browserName === "webkit") {
        yield* page.evaluateInMainWorld(() => new Promise(requestAnimationFrame))
      }
      yield* page.mouse.move({ x: 100, y: 100 })
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as Record<string, unknown>)["result"] = []
        document.addEventListener("mousemove", (event) => {
          ;((window as unknown as Record<string, unknown>)["result"] as Array<[number, number]>).push([
            event.clientX,
            event.clientY
          ])
        })
      })
      // Centerpoint at 150 + 100/2, 280 + 40/2 = 200, 300. Playwright's `click({ steps: 5 })` moves the pointer to the
      // point in five steps, then clicks; Strider's click has no steps, so the move is made first, with the steps.
      yield* page.mouse.move({ x: 200, y: 300 }, { steps: 5 })
      yield* page.locator("div").click()
      assert.deepStrictEqual(yield* pageGlobal(page, "result"), [
        [120, 140],
        [140, 180],
        [160, 220],
        [180, 260],
        [200, 300]
      ])
    }))

  test("CL-090", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button style="display:none">click me</button>`)
      // `{ signal, timeout: 0 }` is a click with no deadline, cancelled by interrupting its fiber
      const fiber = yield* Effect.forkChild(page.locator("button").click(), { startImmediately: true })
      // Give the action time to start before the interruption, as the original's `page.waitForTimeout(500)` does.
      yield* Effect.sleep("500 millis")
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the click was interrupted, got ${String(exit)}`)
    }))

  test("CL-092", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button onclick="window.__CLICKED=true">click me</button>`)
      // An already-aborted signal is a click interrupted before it starts
      const fiber = yield* Effect.forkChild(page.locator("button").click())
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the click was interrupted, got ${String(exit)}`)
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), undefined)
    }))
})
