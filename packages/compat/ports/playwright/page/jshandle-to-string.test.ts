/**
 * Playwright's `tests/page/jshandle-to-string.spec.ts`: how a JS handle's `toString()` describes what it holds. Strider's
 * `JSHandle` has no string preview, so only the one test that reads the page's console is ported here (JH-020); the
 * others, which assert the preview's text, are in the ledger.
 *
 * What the port changes:
 * - JH-020 doesn't use the handle: the original's `page.evaluateHandle` returns `undefined`, and the test reads the
 *   console message the script logs. The script is `page.evaluateInMainWorld`, as Playwright's `evaluate` runs in the
 *   main world, and the console wait is subscribed before it, as `waitForEvent('console')` is.
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("JH-020", ({ page, browserName }) =>
    Effect.gen(function*() {
      // `Promise.all([page.waitForEvent('console'), page.evaluateHandle(...)])`
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        const a: Array<number> = []
        a[1] = 1
        a[10] = 2
        a[100] = 3
        console.log(a)
      })
      const message = yield* logged
      // Strider's `text` writes an object as its browser describes it (`ConsoleMessage`'s documentation), so on Chromium
      // the array reads `Array(101)`, not Playwright's rendering of its holes; this assertion is Playwright's
      if (browserName === "firefox") {
        assert.strictEqual(message.text, "Array")
      } else {
        assert.strictEqual(message.text, "[empty, 1, empty x 8, 2, empty x 89, 3]")
      }
    }))
})
