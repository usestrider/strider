/**
 * Playwright's `tests/page/elementhandle-bounding-box.spec.ts`: an element's box in the main frame's viewport, through
 * frames, with scrolling and layout.
 *
 * What the port changes:
 * - Strider has no ElementHandle. `page.$(selector)` is `page.locator(selector)`, and `handle.boundingBox()` is
 *   `locator.boundingBox`, an immediate read of the element's box in main-frame viewport CSS pixels. Its `Option` is
 *   `null` where Playwright's box is `null`, so the port reads the `Option` with `Option.getOrNull`.
 * - `page.setViewportSize(…)` is `page.emulate({ viewport })`, which holds while the test's scope does.
 * - `page.frameLocator(…).frameLocator(…).locator(…)` is `page.frame(…).frame(…).locator(…)`: frames are entered by
 *   their iframe elements.
 * - EH-006 waits for the button as `waitForSelector('button')` does by default, which is `Expect.toBeVisible`. Its
 *   inner rectangle is read with `locator.evaluate`, in Strider's isolated world. That world is what reaches a
 *   cross-origin frame's element, and stock WebKit has none, so the test fails there with `Unsupported`.
 * - `handle.evaluate(…)` and `page.evaluate(…)` run in the main world, so they are `page.evaluateInMainWorld` with the
 *   element found by a selector inside the page.
 * - EH-007's `page.evaluate(element => …, handle)` takes the element by selector, since a locator can't be passed into
 *   the page.
 */
import { assert } from "@effect/vitest"
import { Expect, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** The main-world rectangle of the element a selector finds, as `getBoundingClientRect` reports it. */
const rectOf = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld((selector) => {
    const rect = (document.querySelector(selector) as Element).getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, selector)

upstream(import.meta.filename, {}, (test) => {
  test("EH-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const box = page.locator(".box:nth-of-type(13)").boundingBox
      assert.deepStrictEqual(Option.getOrNull(yield* box), { x: 100, y: 50, width: 50, height: 50 })
    }))

  test("EH-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 616, height: 500 } })
      yield* page.goto(server.PREFIX + "/frames/nested-frames.html", { waitUntil: "load" })
      const outer = page.frame(page.locator("[name=\"2frames\"]"))
      const nested = outer.frame(outer.locator("[name=dos]"))
      const box = nested.locator("div").boundingBox
      assert.deepStrictEqual(Option.getOrNull(yield* box), { x: 24, y: 224, width: 268, height: 18 })
    }))

  test("EH-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 250, height: 250 } })
      yield* page.setContent(`<style>
  body {
      display: flex;
      height: 500px;
      margin: 0px;
  }
  body iframe {
      flex-shrink: 1;
      border: 0;
      background-color: green;
  }
  </style>
  <iframe></iframe>
  `)
      const box = page.locator("iframe").boundingBox
      assert.deepStrictEqual(Option.getOrNull(yield* box), { x: 0, y: 0, width: 300, height: 500 })
    }))

  test("EH-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>* { margin: 0; padding: 0; }</style>
    <div style="width:8000px; height:8000px;">
      <div id=target style="width:20px; height:20px; margin-left:230px; margin-top:340px;"
        onclick="window.__clicked = true">
      </div>
    </div>
  `)
      const target = page.locator("#target")
      const box1 = Option.getOrNull(yield* target.boundingBox)
      yield* page.evaluateInMainWorld(() => window.scrollBy(200, 300))
      const box2 = Option.getOrThrow(yield* target.boundingBox)
      assert.deepStrictEqual(box1, { x: 230, y: 340, width: 20, height: 20 })
      assert.deepStrictEqual(box2, { x: 30, y: 40, width: 20, height: 20 })
      yield* page.mouse.click({ x: box2.x + 10, y: box2.y + 10 })
      const clicked = yield* page.evaluateInMainWorld(() => (window as unknown as { __clicked?: boolean }).__clicked)
      assert.strictEqual(clicked, true)
    }))

  test("EH-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"display:none\">hi</div>")
      const box = page.locator("div").boundingBox
      // Playwright's `null` is an empty Option: an element with no layout box has none
      assert.isNull(Option.getOrNull(yield* box))
    }))

  test("EH-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <div style="height:120px"></div>
    <iframe style="border:0;margin-left:30px;width:300px;height:200px" src="${server.CROSS_PROCESS_PREFIX}/input/button.html"></iframe>
  `)
      const frame = page.frame(page.locator("iframe"))
      const button = frame.locator("button")
      // `frame.waitForSelector('button')` waits for the element to be visible, which is the default
      yield* Expect.toBeVisible(button)
      const iframeBox = Option.getOrThrow(yield* page.locator("iframe").boundingBox)
      const inner = yield* button.evaluate((b) => {
        const r = b.getBoundingClientRect()
        return { x: r.left, y: r.top }
      })
      const box = Option.getOrThrow(yield* button.boundingBox)
      assert.strictEqual(Math.round(box.x), Math.round(iframeBox.x + inner.x))
      assert.strictEqual(Math.round(box.y), Math.round(iframeBox.y + inner.y))
    }))

  test("EH-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.setContent("<div style=\"width: 100px; height: 100px\">hello</div>")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("div") as HTMLElement).style.height = "200px"
      })
      const box = page.locator("div").boundingBox
      assert.deepStrictEqual(Option.getOrNull(yield* box), { x: 8, y: 8, width: 100, height: 200 })
    }))

  test("EH-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">
        <rect id="theRect" x="30" y="50" width="200" height="300"></rect>
      </svg>
    `)
      const pwBoundingBox = Option.getOrNull(yield* page.locator("#therect").boundingBox)
      const webBoundingBox = yield* rectOf(page, "#therect")
      assert.deepStrictEqual(pwBoundingBox, webBoundingBox)
    }))

  test("EH-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <style>
      i {
        position: absolute;
        top: -1000px;
      }
      body {
        margin: 0;
        font-size: 12px;
      }
      </style>
      <span><i>woof</i><b>doggo</b></span>
    `)
      const box = Option.getOrThrow(yield* page.locator("span").boundingBox)
      const webBoundingBox = yield* rectOf(page, "span")
      const round = (box: { x: number; y: number; width: number; height: number }) => ({
        x: Math.round(box.x * 100),
        y: Math.round(box.y * 100),
        width: Math.round(box.width * 100),
        height: Math.round(box.height * 100)
      })
      assert.deepStrictEqual(round(box), round(webBoundingBox))
    }))
})
