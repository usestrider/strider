/**
 * Playwright's `tests/page/elementhandle-press.spec.ts`: a key pressed in an input, with the caret where the input's
 * selection leaves it.
 *
 * What the port changes:
 * - The original's `page.press(selector, key)` is `page.locator(selector).press(key)`, which focuses the element and
 *   sends the key, as the original's press does.
 * - `page.$eval(selector, fn)` is a read or write of the element in the page's main world, by selector:
 *   `page.evaluateInMainWorld`. The value read afterwards is `locator.readValue`, a read that runs no script.
 * - EH-066 and EH-111 are `it.fail` on WebKit upstream, where the original expects the test to fail. The port runs the
 *   same assertion on every browser and adds no expectation for WebKit, so a run reports what Strider does there.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("EH-062", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' />`)
      yield* page.locator("input").press("h")
      assert.strictEqual(yield* page.locator("input").readValue, "h")
    }))

  test("EH-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' />`)
      yield* page.locator("input").press("w")
      assert.strictEqual(yield* page.locator("input").readValue, "whello")
    }))

  test("EH-064", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' /><div tabIndex=2>text</div>`)
      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input")!
        input.selectionStart = 2
        input.selectionEnd = 4
        document.querySelector("div")!.focus()
      })
      yield* page.locator("input").press("w")
      assert.strictEqual(yield* page.locator("input").readValue, "whello")
    }))

  test("EH-065", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' />`)
      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input")!
        input.focus()
        input.selectionStart = 2
        input.selectionEnd = 4
      })
      yield* page.locator("input").press("w")
      assert.strictEqual(yield* page.locator("input").readValue, "hewo")
    }))

  test("EH-066", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='number' value=2 />`)
      yield* page.locator("input").press("1")
      assert.strictEqual(yield* page.locator("input").readValue, "12")
    }))
})
