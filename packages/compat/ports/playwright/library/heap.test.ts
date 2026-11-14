/**
 * Playwright's `tests/library/heap.spec.ts`: the objects Playwright's client and server keep alive, counted in the V8
 * heap. LE-007 to LE-013 count Playwright's own classes, and LE-005 and LE-006 are fixture setup with no assertion, so
 * the ledger holds them. LE-014 is ported: it checks each element's text, not what the heap holds.
 *
 * What the port changes:
 * - The original counts `Runtime.queryObjects` results for Playwright's classes; Strider has no such classes to count.
 * - LE-014's `page.$$('div')` element handles are `page.locator("div").all`, a list of lazy locators, and each
 *   `div.$('span')` is `div.locator("span")`. A locator holds no node, so there is nothing to collect as the original's
 *   handles are: the port checks the text each span reads.
 * - The original asserts nothing about how many divs it finds, so a page with none would pass vacuously. The port
 *   asserts the count of 2000 first, a check the original doesn't make.
 * - The original skips LE-014 under Playwright's `trace: "on"` option, which records a snapshot per action. The harness
 *   doesn't record Playwright's snapshots, so the port runs the test under every trace setting.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("LE-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<div><span>hi</span></div>`.repeat(2000))
      const divs = yield* page.locator("div").all
      assert.strictEqual(divs.length, 2000)
      for (const div of divs) {
        assert.strictEqual(yield* div.locator("span").readText, "hi")
      }
    }))
})
