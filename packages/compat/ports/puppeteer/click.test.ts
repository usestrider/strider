/**
 * Puppeteer's `test/src/click.test.ts`: `page.click` on buttons, checkboxes, links, frames, and offscreen or covered
 * elements, and the events the page sees of each click.
 *
 * What the port changes:
 * - `page.click(selector)` and `ElementHandle.click()` are `page.locator(selector).click()`, a locator click, which waits
 *   for the element as Strider's actions do. Puppeteer's `page.$(selector)` handles are locators too.
 * - `page.evaluate` runs in the main world, so the port reads and writes the page's globals with
 *   `page.evaluateInMainWorld`. A same-origin frame's globals are read through its element's `contentWindow`, as
 *   `frameGlobal` does.
 * - The page is the harness's 1280x720, not Puppeteer's 800x600 default, and `page.setViewport` is `page.emulate`, whose
 *   registration lasts as long as the test does.
 * - "should not hang with touch-enabled viewports": the iPhone 6 device is its viewport, mobile, touch-enabled, and at
 *   device scale 2, as Puppeteer's `KnownDevices` gives. `mouse.down` and `mouse.up` are a held button in a scope.
 * - `page.on("console")` messages are `ConsoleMessage.history` at the level Puppeteer's `msg.type() === "log"` names. A
 *   message arrives after the click it logs, so the port polls the history, as the original waits on the event.
 * - "should click on a span …", "should click offscreen buttons", and the rest keep Puppeteer's assertions; the page's
 *   own globals are read with `evaluateInMainWorld`.
 * - "should click half-offscreen elements": Strider has no `clickablePoint`, so that assertion is dropped, as the
 *   OOPIF port drops its `clickablePoint` and `boxModel` ones; `boundingBox` is kept as the original checks it.
 * - "should click the button if window.Node is removed" removes the page's `Node` in the main world, as the original does.
 * - "should click with disabled javascript" and "should scroll and click with disabled javascript" wait on
 *   `PageNavigation.next` started before the click, as Puppeteer's `waitForNavigation` is. The click is a fragment
 *   link, so the navigation it makes is a same-document one, which Strider reports as `SameDocument`.
 * - "should fail to click a missing button": Puppeteer's click fails at once, but Strider's locator click waits for the
 *   element, so the port asserts its `Deadline.Timeout` of two seconds, in the phase the click waits in, with the reason
 *   it last saw (`NoMatch`).
 * - "should not throw UnhandledPromiseRejection when page closes" is `Effect.result` on both calls, so a failure of
 *   either is a value rather than a thrown error, as Puppeteer's `.catch` makes it.
 * - The tests that need features Strider lacks aren't ported; the ledger says why each is.
 */
import { assert } from "@effect/vitest"
import {
  Condition,
  ConsoleMessage,
  Deadline,
  Expect,
  type Locator,
  type Page,
  PageNavigation
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { attachFrame, failureOf, startWaiting } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** A same-origin iframe's global, read in the page's main world through its element, as Puppeteer's `frame.evaluate`. */
const frameGlobal = (page: Page.Page, selector: string, name: string) =>
  page.evaluateInMainWorld(
    (selector: string, name: string) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement
      return (frame.contentWindow as unknown as Record<string, unknown>)[name]
    },
    selector,
    name
  )

/**
 * Marks the frame's button on its first click, from the frame's isolated world, which the frame's own page script
 * doesn't share. Puppeteer reads the page script's `result` in the frame's main world; a frame cross-origin to the page
 * can't be read from the page's main world, and its main world isn't reachable here, but its DOM is the same in both.
 */
const markClicks = (frame: Locator.ReadonlyFrameLocator) =>
  frame.locator("button").evaluate((button) => {
    button.addEventListener("click", () => button.setAttribute("data-clicked", "yes"))
  })

/** Waits for the frame's button to carry the mark `markClicks` sets on its click. */
const clickedIn = (frame: Locator.ReadonlyFrameLocator) =>
  frame.locator("button").pipe(Expect.toHaveAttribute("data-clicked", "yes"))

/** A global of the page, read in its main world, as Puppeteer's `page.evaluate(() => globalThis.name)`. */
const pageGlobal = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name: string) => (window as unknown as Record<string, unknown>)[name], name)

/** The page's `log` messages so far, as Puppeteer's `page.on("console")` collects them. */
const logMessages = (page: Page.Page) =>
  Effect.map(
    ConsoleMessage.history(page, { level: "log" }),
    (history) => history.entries.map((message) => message.text)
  )

/** Waits until the page's `log` messages equal `expected`. */
const pollLogs = (page: Page.Page, expected: ReadonlyArray<string>) =>
  Expect.that(
    logMessages(page),
    Condition.make(`logs equal ${JSON.stringify(expected)}`, (actual: ReadonlyArray<string>) =>
      JSON.stringify(actual) === JSON.stringify(expected))
  )

/** The page's `result` global, which its checkbox script fills with the checked state and the events it saw. */
const resultOf = Effect.fnUntraced(function*(page: Page.Page) {
  return (yield* pageGlobal(page, "result")) as {
    readonly check: boolean | null
    readonly events: ReadonlyArray<string>
  }
})

upstream(import.meta.filename, {}, (test) => {
  test("Page.click should click the button", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("Page.click should click svg", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `
        <svg height="100" width="100">
          <circle onclick="javascript:window.__CLICKED=42" cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />
        </svg>
      `,
        { waitUntil: "load" }
      )
      yield* page.locator("circle").click()
      assert.strictEqual(yield* pageGlobal(page, "__CLICKED"), 42)
    }))

  test("Page.click should click the button if window.Node is removed", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        delete (window as unknown as Record<string, unknown>)["Node"]
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("Page.click should click on a span with an inline element inside", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer issue 4281: a span with a ::before pseudo-element still takes the click
      yield* page.setContent(
        `
        <style>
          span::before {
            content: 'q';
          }
        </style>
        <span onclick="javascript:window.CLICKED=42"></span>
      `,
        { waitUntil: "load" }
      )
      yield* page.locator("span").click()
      assert.strictEqual(yield* pageGlobal(page, "CLICKED"), 42)
    }))

  test("Page.click should not throw UnhandledPromiseRejection when page closes", ({ page }) =>
    Effect.gen(function*() {
      const newPage = yield* page.context.newPage
      // Puppeteer's Promise.all(...).catch(() => {}): each call's failure is a value, not an unhandled error
      yield* Effect.all([
        Effect.result(newPage.close()),
        Effect.result(newPage.mouse.click({ x: 1, y: 2 }))
      ], { concurrency: "unbounded" })
    }))

  test("Page.click should click the button after navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("Page.click should click with disabled javascript", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ javaScript: "disabled" })
      yield* page.goto(server.PREFIX + "/wrappedlink.html", { waitUntil: "load" })
      // Puppeteer's Promise.all([click, waitForNavigation]): the navigation is listened for before the click
      const navigated = yield* startWaiting(yield* PageNavigation.next(page, { waitUntil: "load" }))
      yield* page.locator("a").click()
      const navigation = yield* Fiber.join(navigated.fiber)
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(String(yield* page.url), server.PREFIX + "/wrappedlink.html#clicked")
    }))

  test("Page.click should scroll and click with disabled javascript", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ javaScript: "disabled" })
      yield* page.goto(server.PREFIX + "/wrappedlink.html", { waitUntil: "load" })
      yield* page.locator("body").pipe(Expect.toBeAttached)
      // body.evaluate in Puppeteer runs in the main world
      yield* page.evaluateInMainWorld(() => {
        document.body.style.paddingTop = "3000px"
      })
      const navigated = yield* startWaiting(yield* PageNavigation.next(page, { waitUntil: "load" }))
      yield* page.locator("a").click()
      const navigation = yield* Fiber.join(navigated.fiber)
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(String(yield* page.url), server.PREFIX + "/wrappedlink.html#clicked")
    }))

  test("Page.click should click when one of inline box children is outside of viewport", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `
        <style>
          i {
            position: absolute;
            top: -1000px;
          }
        </style>
        <span onclick="javascript:window.CLICKED = 42;"><i>woof</i><b>doggo</b></span>
      `,
        { waitUntil: "load" }
      )
      yield* page.locator("span").click()
      assert.strictEqual(yield* pageGlobal(page, "CLICKED"), 42)
    }))

  test("Page.click should click offscreen buttons", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", { waitUntil: "load" })
      for (let i = 0; i < 11; ++i) {
        // We might've scrolled to click a button - reset to (0, 0).
        yield* page.evaluateInMainWorld(() => window.scrollTo(0, 0))
        yield* page.locator(`#btn${i}`).click()
        // The console event can arrive after the click resolves
        yield* Expect.that(
          logMessages(page),
          Condition.make(`has button #${i}`, (messages: ReadonlyArray<string>) =>
            messages.includes(`button #${i} clicked`))
        )
      }
      yield* pollLogs(
        page,
        Array.from({ length: 11 }, (_, i) =>
          `button #${i} clicked`)
      )
    }))

  test("Page.click should click half-offscreen elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<!DOCTYPE html>
        <style>
          body {
            overflow: hidden;
          }
          #target {
            width: 200px;
            height: 200px;
            background: red;
            position: fixed;
            left: -150px;
            top: -150px;
          }
        </style>
        <div id="target" onclick="window.CLICKED=true;"></div>`,
        { waitUntil: "load" }
      )
      yield* page.locator("#target").click()
      assert.strictEqual(yield* pageGlobal(page, "CLICKED"), true)
      const box = yield* page.locator("#target").boundingBox
      assert.deepStrictEqual(Option.getOrUndefined(box), { height: 200, width: 200, x: -150, y: -150 })
      // Puppeteer's element.clickablePoint() has no Strider counterpart; its { x: 25, y: 25 } is not checked here
    }))

  test("Page.click should click wrapped links", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/wrappedlink.html", { waitUntil: "load" })
      yield* page.locator("a").click()
      assert.strictEqual(yield* pageGlobal(page, "__clicked"), true)
    }))

  test("Page.click should click on checkbox input and toggle", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/checkbox.html", { waitUntil: "load" })
      assert.strictEqual((yield* resultOf(page)).check, null)
      yield* page.locator("input#agree").click()
      assert.strictEqual((yield* resultOf(page)).check, true)
      assert.deepStrictEqual((yield* resultOf(page)).events, [
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
      assert.strictEqual((yield* resultOf(page)).check, false)
    }))

  test("Page.click should click on checkbox label and toggle", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/checkbox.html", { waitUntil: "load" })
      assert.strictEqual((yield* resultOf(page)).check, null)
      yield* page.locator("label[for=\"agree\"]").click()
      assert.strictEqual((yield* resultOf(page)).check, true)
      assert.deepStrictEqual((yield* resultOf(page)).events, ["click", "input", "change"])
      yield* page.locator("label[for=\"agree\"]").click()
      assert.strictEqual((yield* resultOf(page)).check, false)
    }))

  test("Page.click should fail to click a missing button", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const error = yield* failureOf(
        page.locator("button.does-not-exist").click().pipe(Deadline.within("2 seconds")),
        "the click"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.click")
      assert.strictEqual(error.phase, "resolving")
      const reason = Option.getOrUndefined(
        Option.map(error.last, (observed) => (observed.value as { _tag: string })._tag)
      )
      assert.strictEqual(reason, "NoMatch")
    }))

  test("Page.click should not hang with touch-enabled viewports", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's KnownDevices['iPhone 6'].viewport: 375x667 at device scale 2, mobile, touch-enabled
      yield* page.emulate({
        viewport: { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
        touch: true
      })
      yield* Effect.scoped(Effect.gen(function*() {
        yield* page.mouse.hold("left")
        yield* page.mouse.move({ x: 100, y: 10 })
      }))
    }))

  test("Page.click should scroll and click the button", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-5").click()
      assert.strictEqual(yield* page.locator("#button-5").readText, "clicked")
      yield* page.locator("#button-80").click()
      assert.strictEqual(yield* page.locator("#button-80").readText, "clicked")
    }))

  test("Page.click should double click the button", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const global = globalThis as unknown as Record<string, unknown>
        global["double"] = false
        document.querySelector("button")!.addEventListener("dblclick", () => {
          global["double"] = true
        })
      })
      yield* page.locator("button").dblclick()
      assert.strictEqual(yield* pageGlobal(page, "double"), true)
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("Page.click should double multiple times", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const global = globalThis as unknown as Record<string, unknown>
        global["count"] = 0
        document.querySelector("button")!.addEventListener("dblclick", () => {
          global["count"] = (global["count"] as number) + 1
        })
      })
      yield* page.locator("button").dblclick()
      yield* page.locator("button").dblclick()
      assert.strictEqual(yield* pageGlobal(page, "count"), 2)
    }))

  test("Page.click should click a partially obscured button", ({ page, server }) =>
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

  test("Page.click should click a rotated button", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/rotatedButton.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("Page.click should fire contextmenu event on right click", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-8").click({ button: "right" })
      assert.strictEqual(yield* page.locator("#button-8").readText, "context menu")
    }))

  test("Page.click should fire aux event on middle click", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-8").click({ button: "middle" })
      assert.strictEqual(yield* page.locator("#button-8").readText, "aux click")
    }))

  test("Page.click should click links which cause navigation", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer issue 206: this click's await must not hang
      yield* page.setContent(`<a href="${server.EMPTY_PAGE}">empty.html</a>`, { waitUntil: "load" })
      yield* page.locator("a").click()
    }))

  test("Page.click should click the button inside an iframe", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<div style="width:100px;height:100px">spacer</div>`, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "button-test", server.PREFIX + "/input/button.html")
      yield* frame.locator("button").click()
      assert.strictEqual(yield* frameGlobal(page, "#button-test", "result"), "Clicked")
    }))

  test("Page.click should select the text by triple clicking", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      const text = "This is the text that we are going to try to select. Let's see how it goes."
      yield* page.keyboard.pressSequentially(text)
      yield* page.evaluateInMainWorld(() => {
        const global = window as unknown as Record<string, unknown>
        global["clicks"] = []
        window.addEventListener("click", (event) => {
          ;(global["clicks"] as Array<number>).push(event.detail)
        })
      })
      // A locator click has no click count, so the click is the mouse's, at the center of the textarea
      const box = Option.getOrThrow(yield* page.locator("textarea").boundingBox)
      yield* page.mouse.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { clickCount: 3 })
      const clicks = (yield* pageGlobal(page, "clicks")) as ReadonlyArray<number>
      assert.deepStrictEqual(clicks.slice(0, 3), [1, 2, 3])
      const selected = yield* page.evaluateInMainWorld(() => {
        const textarea = document.querySelector("textarea")!
        return textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
      })
      assert.strictEqual(selected, text)
    }))

  test("Page.click should click the button with fixed position inside an iframe", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.setContent(`<div style="width:100px;height:2000px">spacer</div>`, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "button-test", server.CROSS_PROCESS_PREFIX + "/input/button.html")
      yield* frame.locator("button").evaluate((button) =>
        (button as HTMLElement).style.setProperty("position", "fixed")
      )
      yield* markClicks(frame)
      yield* frame.locator("button").click()
      yield* clickedIn(frame)
    }))

  test("Page.click should click the button with deviceScaleFactor set", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 400, height: 400, deviceScaleFactor: 5 } })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.devicePixelRatio), 5)
      yield* page.setContent(`<div style="width:100px;height:100px">spacer</div>`, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "button-test", server.PREFIX + "/input/button.html")
      yield* markClicks(frame)
      yield* frame.locator("button").click()
      yield* clickedIn(frame)
    }))

  // Not ported, see the ledger: the back and forward buttons, which Strider's mouse doesn't have.
})
