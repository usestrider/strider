/**
 * Playwright's `tests/page/locator-list.spec.ts`: `locator.all()` gives a locator for each matching element, in order.
 *
 * What the port changes:
 * - `div >> p` is a descendant chain, which Strider writes as nested locators: `page.locator("div").locator("p")`.
 * - `locator.all()` is a property in Strider, and its elements are read with `readText`, which is the text content
 *   with whitespace collapsed (Playwright's `textContent()` is the raw text). The three paragraphs have no whitespace
 *   to collapse, so the same values come back.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("LO-126", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><p>A</p><p>B</p><p>C</p></div>`)
      const paragraphs = yield* page.locator("div").locator("p").all
      const texts = yield* Effect.forEach(paragraphs, (paragraph) => paragraph.readText)
      assert.deepStrictEqual(texts, ["A", "B", "C"])
    }))
})
