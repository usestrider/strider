/**
 * Playwright's `tests/page/elementhandle-misc.spec.ts`: an element handle's hover, fill, check, uncheck, select, and focus,
 * and disposing a handle twice. EH-045 to EH-054 are ported.
 *
 * What the port changes:
 * - Element handles are lazy locators, as in elementhandle-convenience: `page.$(sel)` is `page.locator(sel)`, and each
 *   action re-resolves its element. An action on a handle whose node was removed (EH-046, EH-048) retargets the same way.
 * - `window.result`, `window.Node`, and `document.activeElement` are page state, so the port reads and deletes them in
 *   the main world with `page.evaluateInMainWorld`. The reads that check an element's state are Strider's non-evaluating
 *   reads (`isChecked`).
 * - Playwright's `page.evaluate('checkbox.checked')` is `isChecked` on the locator: the native checked property, which
 *   stock WebKit reads without an isolated world.
 * - EH-050's `setChecked(true)` and `setChecked(false)` are `check()` and `uncheck()`: Strider has no `setChecked`, and the
 *   matrix row for it maps it this way, so each call keeps Strider's own actionability checks.
 * - EH-052's `selectOption('blue')` names the option by value, `{ value: "blue" }`, where Playwright's string matches a
 *   value or a label. Strider's `selectOption` takes one form per option, so the port names the form.
 * - EH-053's `button.evaluate(button => document.activeElement === button)` compares `document.activeElement` with the
 *   button in the main world, since Strider's element evaluation runs in an isolated world stock WebKit lacks.
 * - EH-054's element handle is a `JSHandle` from `page.evaluateHandle`, and `dispose()` is `release`, which the matrix row
 *   `method-jshandle-dispose` maps. Releasing twice does nothing, as the original expects.
 * - EH-046 and EH-048 remove `window.Node` in the main world with `Reflect.deleteProperty`, as the original does: the
 *   point is that Strider's actions don't depend on the page's globals.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("EH-045", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html")
      yield* page.locator("#button-6").hover()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")!.id),
        "button-6"
      )
    }))

  test("EH-046", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html")
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "Node")
      })
      yield* page.locator("#button-6").hover()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")!.id),
        "button-6"
      )
    }))

  test("EH-047", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), "some value")
    }))

  test("EH-048", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "Node")
      })
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), "some value")
    }))

  test("EH-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("#checkbox").isChecked)
    }))

  test("EH-050", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      const checkbox = page.locator("#checkbox")
      // setChecked(true) and setChecked(false) are check() and uncheck(), as the matrix row maps them
      yield* page.locator("input").check()
      assert.isTrue(yield* checkbox.isChecked)
      yield* page.locator("input").uncheck()
      assert.isFalse(yield* checkbox.isChecked)
    }))

  test("EH-051", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' checked></input>`)
      yield* page.locator("input").uncheck()
      assert.isFalse(yield* page.locator("#checkbox").isChecked)
    }))

  test("EH-052", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/select.html")
      yield* page.locator("select").selectOption({ value: "blue" })
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "result").onInput),
        ["blue"]
      )
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "result").onChange),
        ["blue"]
      )
    }))

  test("EH-053", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      const isFocused = page.evaluateInMainWorld(() => document.activeElement === document.querySelector("button"))
      assert.isFalse(yield* isFocused)
      yield* page.locator("button").focus()
      assert.isTrue(yield* isFocused)
    }))

  test("EH-054", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>39</section>")
      const element = yield* page.evaluateHandle(() => document.querySelector("section"))
      assert.isTrue(yield* element.evaluate((section) => section !== null && section.tagName === "SECTION"))
      yield* element.release
      yield* element.release
    }))
})
