/**
 * Puppeteer's `test/src/elementhandle.test.ts`: the element handle's geometry, visibility, clicks, hover, viewport
 * intersection, and its waits on selectors.
 *
 * What the port changes:
 * - An `ElementHandle` is a locator here: Strider's locators are lazy and re-resolve their element, so a `page.$(…)` in
 *   the original is `page.locator(…)`, and `handle.boundingBox()`, `isVisible`, `click`, and `hover` are the same calls
 *   on it. A held element that goes stale is the difference the lazy-locator design makes (docs/decisions.md).
 * - `page.setViewport` is `page.emulate`, whose registration lasts as long as the test does. The harness's page is
 *   1280x720; the tests that depend on the layout at 500x500 emulate that size, as the original does.
 * - `page.evaluate` runs in the main world, as Puppeteer's does, so the port reads and writes the page's globals with
 *   `page.evaluateInMainWorld`. A handle passed as an argument is the element the locator selects.
 * - `ElementHandle.boundingBox` is `Locator.boundingBox`, an `Option`: `null` for an element that isn't rendered is
 *   `Option.none()`. Its values are the same rectangles the original asserts.
 * - `ElementHandle.isHidden` is the inverse of `isVisible`, which the matrix row for it names, since Strider has no
 *   `isHidden`. `ElementHandle.contentFrame` is `page.frame(locator)`, which enters the frame by its element. The
 *   frame's identity is checked by a marker written into the frame's document and read back through the frame
 *   locator, since the original's Frame object has no counterpart.
 * - `ElementHandle.click` and `hover` are the locator's pointer actions. The click events are recorded in the page's
 *   main world (a `window.clicks` array the test's own listener fills), where the original exposes a function.
 *   Puppeteer's `click({ offset })` is Strider's `position`, which is measured from the padding box; the element has no
 *   border, so its padding box starts where the original's offset does.
 * - The four "throw" clicks (detached, hidden, recursively hidden, `<br>`) wait for the element to be clickable, as
 *   Strider's actions do, and fail at the deadline with the reason they last saw. The port asserts that `Timeout`
 *   and its reason, and that no click landed. The original's immediate error has no counterpart.
 * - `ElementHandle.isIntersectingViewport({ threshold })` is `Expect.toBeInViewport({ ratio })`, which measures the same
 *   intersection ratio, and requires a positive ratio even at zero, as Puppeteer's observer does. A `false` is the
 *   matcher's inverse (`inViewport: false`), which passes when the ratio is below the threshold. Each is a matcher that
 *   passes at once when its state holds, not a read, so a wrong state waits until the deadline and fails.
 * - `Element.waitForSelector` on an element is a locator chained from the first element's locator, which re-resolves
 *   the inner match after `innerHTML` changes, as the original's wait does. Both waits start before the page changes,
 *   as the original's do.
 * - The tests that need features Strider lacks aren't ported; the ledger says why each is: the box model and the click
 *   point (quads and their coordinates), the touchscreen, handles that are text nodes, custom query handlers, XPath,
 *   the handle's `toElement`, and the disposal protocol (`Symbol.dispose`, `Symbol.asyncDispose`, `move`). Only
 *   `dispose` of the cached isolated handle tests Puppeteer's own bookkeeping, which has no counterpart.
 * - On stock WebKit, pointer actions need `input.native`, which it refuses, so the click and hover tests are
 *   `needsFeature` there, and the ledger marks them.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, type Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { attachFrame, failureOf, frameCount, startWaiting } from "../harness/playwright.ts"
import { html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** A global of the page, read in its main world, as Puppeteer's `page.evaluate(() => globalThis.name)`. */
const pageGlobal = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name: string) => (window as unknown as Record<string, unknown>)[name], name)

/** A locator's bounding box, which the original asserts as an object; the element must be rendered. */
const boxOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const box = yield* locator.boundingBox
  assert(Option.isSome(box), "the element has no bounding box")
  return box.value
})

/** The reason a timed-out click last observed, as Strider records it. */
const reasonOf = (timeout: Deadline.Timeout): string | undefined =>
  Option.getOrUndefined(
    Option.map(timeout.last, (observed) => (observed.value as { readonly _tag: string })._tag)
  )

/** The `Timeout` of a click that the original expects to fail at once, on the operation the click names. */
const clickTimeout = (error: unknown): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, "Locator.click")
  return error
}

/** The click positions the test's own listener recorded on the page, as the original's `reportClick` collected them. */
const recordedClicks = (page: Page.Page) =>
  Effect.map(
    pageGlobal(page, "clicks"),
    (clicks) => clicks as ReadonlyArray<readonly [number, number]>
  )

upstream(import.meta.filename, {}, (test) => {
  test("ElementHandle specs ElementHandle.boundingBox should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.goto(server.PREFIX + "/grid.html", load)
      const box = yield* boxOf(page.locator(".box:nth-of-type(13)"))
      assert.deepStrictEqual(box, { x: 100, y: 50, width: 50, height: 50 })
    }))

  test("ElementHandle specs ElementHandle.boundingBox should handle nested frames", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.goto(server.PREFIX + "/frames/nested-frames.html", load)
      // frames()[1] is the page's `2frames` frame, and its childFrames()[1] is `dos`
      const outer = page.frame(page.locator("iframe[name=\"2frames\"]"))
      const nested = outer.frame(outer.locator("iframe[name=\"dos\"]"))
      const box = yield* boxOf(nested.locator("div"))
      assert.deepStrictEqual(box, { x: 28, y: 182, width: 300, height: 18 })
    }))

  test("ElementHandle specs ElementHandle.boundingBox should return null for invisible elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div style="display:none">hi</div>`), load)
      assert.isTrue(Option.isNone(yield* page.locator("div").boundingBox))
    }))

  test("ElementHandle specs ElementHandle.boundingBox should force a layout", ({ page }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.setContent(html(`<div style="width: 100px; height: 100px">hello</div>`), load)
      // The original sets the height on the handle's element; the page's own div is the one the locator selects.
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.height = "200px"
      })
      const box = yield* boxOf(page.locator("div"))
      assert.deepStrictEqual(box, { x: 8, y: 8, width: 100, height: 200 })
    }))

  test("ElementHandle specs ElementHandle.boundingBox should work with SVG nodes", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        html(`
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="500"
          height="500"
        >
          <rect
            id="theRect"
            x="30"
            y="50"
            width="200"
            height="300"
          ></rect>
        </svg>
      `),
        load
      )
      const pptrBoundingBox = yield* boxOf(page.locator("#theRect"))
      const webBoundingBox = yield* page.evaluateInMainWorld(() => {
        const rect = document.getElementById("theRect")!.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
      assert.deepStrictEqual(pptrBoundingBox, webBoundingBox)
    }))

  test("ElementHandle specs ElementHandle.contentFrame should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual(yield* frameCount(page), 2)
      // The element's content frame is the page's second frame. A marker written into that frame's document is read
      // back through the frame locator, which only finds it there.
      const contentFrame = page.frame(page.locator("#frame1"))
      yield* page.evaluateInMainWorld(() => {
        const frame = document.getElementById("frame1") as HTMLIFrameElement
        frame.contentDocument!.body.innerHTML = `<div id="marker">in frame1</div>`
      })
      assert.strictEqual(yield* contentFrame.locator("#marker").readText, "in frame1")
    }))

  test("ElementHandle specs ElementHandle.isVisible and ElementHandle.isHidden should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div style="display: none">text</div>`), load)
      const element = page.locator("div")
      yield* Expect.toBeAttached(element)
      // Strider has no isHidden: the element is hidden exactly when it isn't visible
      assert.isFalse(yield* element.isVisible)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.removeProperty("display")
      })
      assert.isTrue(yield* element.isVisible)
    }))

  test("ElementHandle specs ElementHandle.click should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", load)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("ElementHandle specs ElementHandle.click should return Point data", ({ page }) =>
    Effect.gen(function*() {
      // The original's reportClick is an exposed function; the page's own listener records the same points here.
      yield* page.evaluateInMainWorld(() => {
        const w = window as unknown as { clicks: Array<[number, number]> }
        w.clicks = []
        document.body.style.padding = "0"
        document.body.style.margin = "0"
        document.body.innerHTML = `
          <div style="cursor: pointer; width: 120px; height: 60px; margin: 30px; padding: 15px;"></div>
        `
        document.body.addEventListener("click", (e) => {
          w.clicks.push([e.clientX, e.clientY])
        })
      })

      yield* page.locator("div").click()
      yield* page.locator("div").click({ position: { x: 10, y: 15 } })
      // Puppeteer's offset is measured from the element's top left, which the padding box starts at here (no border)
      yield* Expect.that(
        recordedClicks(page),
        Condition.make("two clicks recorded", (clicks: ReadonlyArray<readonly [number, number]>) => clicks.length >= 2)
      )
      assert.deepStrictEqual(yield* recordedClicks(page), [
        [45 + 60, 45 + 30], // margin + middle point offset
        [30 + 10, 30 + 15] // margin + offset
      ])
    }))

  test("ElementHandle specs ElementHandle.click should work for Shadow DOM v1", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/shadow.html", load)
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "clicked"), true)
    }))

  test("ElementHandle specs ElementHandle.click should throw for detached nodes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", load)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.remove()
      })
      // The locator re-resolves the button, finds none, and waits for it until the deadline. Nothing is clicked.
      const error = yield* failureOf(
        page.locator("button").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(reasonOf(clickTimeout(error)), "NoMatch")
      // The page starts with `result` set to "Was not clicked", which a click would replace
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("ElementHandle specs ElementHandle.click should throw for hidden nodes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", load)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.display = "none"
      })
      const error = yield* failureOf(
        page.locator("button").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(reasonOf(clickTimeout(error)), "NotVisible")
      // The page starts with `result` set to "Was not clicked", which a click would replace
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("ElementHandle specs ElementHandle.click should throw for recursively hidden nodes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", load)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.parentElement!.style.display = "none"
      })
      const error = yield* failureOf(
        page.locator("button").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(reasonOf(clickTimeout(error)), "NotVisible")
      // The page starts with `result` set to "Was not clicked", which a click would replace
      assert.strictEqual(yield* pageGlobal(page, "result"), "Was not clicked")
    }))

  test("ElementHandle specs ElementHandle.click should throw for <br> elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`hello<br />goodbye`), load)
      // A line break has no box, so it is never rendered and the click waits for it until the deadline
      const error = yield* failureOf(
        page.locator("br").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(reasonOf(clickTimeout(error)), "NotVisible")
    }))

  test("ElementHandle specs ElementHandle.hover should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", load)
      yield* page.locator("#button-6").hover()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")!.id),
        "button-6"
      )
    }))

  test("ElementHandle specs ElementHandle.isIntersectingViewport should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", load)
      // All but the last button are visible; with a threshold of zero, a positive ratio is required, as the observer's is
      for (let i = 0; i < 11; ++i) {
        const button = page.locator(`#btn${i}`)
        if (i < 10) yield* button.pipe(Expect.toBeInViewport({ ratio: 0 }))
        else yield* button.pipe(Expect.toBeInViewport({ ratio: 0, inViewport: false }))
      }
    }))

  test("ElementHandle specs ElementHandle.isIntersectingViewport should work with threshold", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", load)
      // A button almost cannot be seen: its ratio is below the threshold
      yield* page.locator("#btn11").pipe(Expect.toBeInViewport({ ratio: 0.001, inViewport: false }))
    }))

  test("ElementHandle specs ElementHandle.isIntersectingViewport should work with threshold of 1", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", load)
      yield* page.locator("#btn0").pipe(Expect.toBeInViewport({ ratio: 1 }))
    }))

  test("ElementHandle specs ElementHandle.isIntersectingViewport should work with svg elements", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/inline-svg.html", load)
      const circle = page.locator("circle")
      const svg = page.locator("svg")
      yield* circle.pipe(Expect.toBeInViewport({ ratio: 1 }))
      yield* circle.pipe(Expect.toBeInViewport({ ratio: 0 }))
      yield* svg.pipe(Expect.toBeInViewport({ ratio: 1 }))
      yield* svg.pipe(Expect.toBeInViewport({ ratio: 0 }))

      // The elements inside the hidden `div` don't intersect the viewport at either threshold
      const invisibleCircle = page.locator("div circle")
      const invisibleSvg = page.locator("div svg")
      yield* invisibleCircle.pipe(Expect.toBeInViewport({ ratio: 1, inViewport: false }))
      yield* invisibleCircle.pipe(Expect.toBeInViewport({ ratio: 0, inViewport: false }))
      yield* invisibleSvg.pipe(Expect.toBeInViewport({ ratio: 1, inViewport: false }))
      yield* invisibleSvg.pipe(Expect.toBeInViewport({ ratio: 0, inViewport: false }))
    }))

  test("ElementHandle specs Element.waitForSelector should wait correctly with waitForSelector on an element", ({ page }) =>
    Effect.gen(function*() {
      // The wait starts before the page has the element, as the original's does
      const outer = yield* startWaiting(Expect.toBeAttached(page.locator(".foo")))
      yield* page.setContent(
        html(`<div id="not-foo"></div>
          <div class="bar">bar2</div>
          <div class="foo">Foo1</div>`),
        load
      )
      yield* Fiber.join(outer.fiber)

      // Its inner wait starts before the element's content changes, and is over when the match appears in it
      const inner = page.locator(".foo").locator(".bar")
      const innerWait = yield* startWaiting(Expect.toBeAttached(inner))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector(".foo")!.innerHTML = "<div class=\"bar\">bar1</div>"
      })
      yield* Fiber.join(innerWait.fiber)
      assert.strictEqual(yield* inner.readText, "bar1")
    }))
})
