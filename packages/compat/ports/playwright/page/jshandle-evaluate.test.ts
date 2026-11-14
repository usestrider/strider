/**
 * Playwright's `tests/page/jshandle-evaluate.spec.ts`: evaluating a function on a handle to the page's window.
 *
 * What the port changes:
 * - `windowHandle.evaluate(fn)` is `JSHandle.evaluate`, which runs the function in the handle's realm. The handle comes
 *   from `page.evaluateHandle`, so the global the first function sets and the one the second reads are in the same
 *   isolated world, as in the original's main world.
 * - JH-006 evaluates the source string `window.foo`, which Strider doesn't accept (its evaluated functions cross into the
 *   page as their own source). The port evaluates a function that reads the same expression, `window.foo`, from the
 *   realm's global rather than from an argument, which is what the string form does.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("JH-005", ({ page }) =>
    Effect.gen(function*() {
      const windowHandle = yield* page.evaluateHandle(() => {
        ;(window as unknown as { foo: number[] }).foo = [1, 2]
        return window
      })
      const foo = yield* windowHandle.evaluate((w) => (w as unknown as { foo: number[] }).foo)
      assert.deepEqual(foo, [1, 2])
    }))

  test("JH-006", ({ page }) =>
    Effect.gen(function*() {
      const windowHandle = yield* page.evaluateHandle(() => {
        ;(window as unknown as { foo: number[] }).foo = [1, 2]
        return window
      })
      const foo = yield* windowHandle.evaluate(() => (window as unknown as { foo: number[] }).foo)
      assert.deepEqual(foo, [1, 2])
    }))
})
