/**
 * Playwright's `tests/page/elementhandle-type.spec.ts`: text typed into an input, one key at a time, with the caret where
 * the input's selection leaves it.
 *
 * What the port changes:
 * - The original's `page.type(selector, text)` is `page.locator(selector).pressSequentially(text)`, which focuses the
 *   element and types the text key by key, as the original's type does.
 * - `page.$eval(selector, fn)` is a read or write of the element in the page's main world, by selector:
 *   `page.evaluateInMainWorld`. The value read afterwards is `locator.readValue`, a read that runs no script.
 * - EH-111 is `it.fail` on WebKit upstream, where the original expects the test to fail. The port runs the same
 *   assertion on every browser and adds no expectation for WebKit, so a run reports what Strider does there.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("EH-107", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' />`)
      yield* page.locator("input").pressSequentially("hello")
      assert.strictEqual(yield* page.locator("input").readValue, "hello")
    }))

  test("EH-108", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' />`)
      yield* page.locator("input").pressSequentially("world")
      assert.strictEqual(yield* page.locator("input").readValue, "worldhello")
    }))

  test("EH-109", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' /><div tabIndex=2>text</div>`)
      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input")!
        input.selectionStart = 2
        input.selectionEnd = 4
        document.querySelector("div")!.focus()
      })
      yield* page.locator("input").pressSequentially("world")
      assert.strictEqual(yield* page.locator("input").readValue, "worldhello")
    }))

  test("EH-110", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' />`)
      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input")!
        input.focus()
        input.selectionStart = 2
        input.selectionEnd = 4
      })
      yield* page.locator("input").pressSequentially("world")
      assert.strictEqual(yield* page.locator("input").readValue, "heworldo")
    }))

  test("EH-111", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='number' value=2 />`)
      yield* page.locator("input").pressSequentially("13")
      assert.strictEqual(yield* page.locator("input").readValue, "132")
    }))
})
