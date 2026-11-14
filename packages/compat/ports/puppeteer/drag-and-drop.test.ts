/**
 * Puppeteer's `test/src/drag-and-drop.test.ts`: HTML drag-and-drop with the mouse, and Puppeteer's element-handle drag
 * API, on a page whose drop zone records each drag event in a counter.
 *
 * What the port changes:
 * - Puppeteer's `ElementHandle.drag`, `drop`, and `dragAndDrop` without drag interception are the mouse: the source is
 *   hovered, the button is pressed, the target is hovered, and `drop` hovers the target again and releases the button.
 *   The port sends those same steps with `locator.hover()`, `page.mouse.hold("left")`, and `button.release`, so the
 *   page sees the pointer events the original's do. Strider's `dragTo` is the browser's own drag, which the port doesn't
 *   use here.
 * - `page.$eval('#drag-state', …)` is a read of the element's text, which Strider reads without evaluating.
 * - Puppeteer's `page.goto` waits for `load`, as the original's does.
 * - The legacy tests need drag interception (`page.setDragInterception`, and `dragEnter`, `dragOver`, and `drop` with the
 *   drag data the interception hands over). Strider has no drag interception, so they aren't ported; the ledger names the
 *   nearest matrix row.
 * - "should release the mouse button when the drop fails" drops from an element handle whose element the page replaced
 *   during the drag, and expects the drop to fail. Strider's locators find the element again, so no drop fails in
 *   that way; the test isn't ported, and the ledger says why.
 * - The file runs on every browser the harness selects. Stock WebKit's launched Automation has simulated input, so the
 *   mouse drags run there too.
 */
import { assert } from "@effect/vitest"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** Puppeteer's `getDragState`: the drop zone's counter, read as a number. */
const dragState = (page: Page.Page) => Effect.map(page.locator("#drag-state").readText, (text) => parseInt(text, 10))

upstream(import.meta.filename, {}, (test) => {
  test("Drag n' Drop should drop", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/drag-and-drop.html", load)

      // The original's `dropzone.drop(draggable)`: the draggable is dragged to the drop zone with the mouse, and released
      yield* page.locator("#drag").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#drop").hover()
      yield* button.release

      assert.strictEqual(yield* dragState(page), 1234)
    })))

  test("Drag n' Drop should drop using mouse", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/drag-and-drop.html", load)

      yield* page.locator("#drag").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#drop").hover()

      assert.strictEqual(yield* dragState(page), 123)

      yield* button.release
      assert.strictEqual(yield* dragState(page), 1234)
    })))

  test("Drag n' Drop should drag and drop", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/drag-and-drop.html", load)

      // The original's `draggable.drag(dropzone)`, then `dropzone.drop(draggable)`: the second call finds the button
      // already down, so it only moves to the drop zone again before releasing.
      yield* page.locator("#drag").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#drop").hover()
      yield* page.locator("#drop").hover()
      yield* button.release

      assert.strictEqual(yield* dragState(page), 1234)
    })))
})
