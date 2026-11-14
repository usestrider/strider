/**
 * Playwright's `tests/page/locator-is-visible.spec.ts`: what counts as visible, for a read and for an expectation.
 *
 * What the port changes:
 * - `isHidden()` is the boolean inverse of `isVisible`, as the matrix rows `method-locator-ishidden` and
 *   `method-page-ishidden` say: a read has no `isHidden`, and no match is not visible. `expect(x).not.toBeVisible()`
 *   and `waitFor({ state: "hidden" })` are `Expect.toBeHidden`, which waits for the element to be hidden.
 * - `page.isVisible("div")` and its siblings are `page.locator("div").isVisible`. A read is strict: `isVisible` on a
 *   selector with no match is `false`, as the original's is.
 * - `filter({ hasText })` takes the place of Playwright's `hasText` option of `locator(selector, options)`, and
 *   `getByRole("button")` with `count` stands for `toHaveCount(0)`.
 * - `page.evaluate` isn't used here. The setContent scripts run in the page as written.
 * - LO-124 ignores the `setContent` failure as the original does, since a scheduled navigation can end its replacement.
 * - LO-116 is in the ledger, not ported: Strider counts an element with `opacity: 0` as hidden.
 * - LO-125's selector is invalid CSS (`div[`), since Strider has no selector engines to name unknown. It asserts the
 *   typed refusal, `LocatorError` with the reason `InvalidInput` for `selector`, where the original checks Playwright's
 *   message for the unknown engine.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/**
 * The boolean inverse of `isVisible`, which is Playwright's `isHidden`: a read has no `isHidden`, and no match is not
 * visible, so it is hidden.
 */
const isHidden = (locator: Locator.ReadonlyLocator) => Effect.map(locator.isVisible, (visible) => !visible)

upstream(import.meta.filename, {}, (test) => {
  test("LO-115", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Hi</div><span></span>`)

      const div = page.locator("div")
      assert.isTrue(yield* div.isVisible)
      assert.isFalse(yield* isHidden(div))
      assert.isTrue(yield* page.locator("div").isVisible)
      assert.isFalse(yield* isHidden(page.locator("div")))

      const span = page.locator("span")
      assert.isFalse(yield* span.isVisible)
      assert.isTrue(yield* isHidden(span))
      assert.isFalse(yield* page.locator("span").isVisible)
      assert.isTrue(yield* isHidden(page.locator("span")))

      assert.isFalse(yield* page.locator("no-such-element").isVisible)
      assert.isTrue(yield* isHidden(page.locator("no-such-element")))
    }))

  test("LO-117", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style="position: absolute; left: -1000px">Hi</div>`)
      yield* page.locator("div").pipe(Expect.toBeVisible)
    }))

  test("LO-118", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<details>
    <summary>click to open</summary>
      <ul>
        <li>hidden item 1</li>
        <li>hidden item 2</li>
        <li>hidden item 3</li>
      </ul
  </details>`)
      yield* page.locator("ul").pipe(Expect.toBeHidden)
    }))

  test("LO-119", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<details>
    <summary>outer</summary>
    <details open>
      <summary>inner</summary>
      <button>hidden button</button>
    </details>
  </details>`)
      yield* page.locator("summary").filter({ hasText: "outer" }).pipe(Expect.toBeVisible)
      yield* page.locator("summary").filter({ hasText: "inner" }).pipe(Expect.toBeHidden)
      yield* page.locator("button").pipe(Expect.toBeHidden)
      assert.strictEqual(yield* page.getByRole("button").count, 0)
    }))

  test("LO-120", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div id=unslotted><span>hidden 1</span><div><span>hidden 2</span></div></div>
    <div id=slotted><span>visible</span></div>
    <script>
      unslotted.attachShadow({ mode: 'open' }).innerHTML = 'nothing to see here';
      slotted.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
    </script>
  `)
      yield* page.locator("span").filter({ hasText: "hidden 1" }).pipe(Expect.toBeHidden)
      yield* page.locator("span").filter({ hasText: "hidden 2" }).pipe(Expect.toBeHidden)
      yield* page.locator("span").filter({ hasText: "visible" }).pipe(Expect.toBeVisible)
    }))

  test("LO-121", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select multiple>
      <option>visible 1</option>
      <optgroup label="group"><option>visible 2</option></optgroup>
      <option hidden>hidden 1</option>
      <optgroup label="hidden group" style="display:none"><option>hidden 2</option></optgroup>
    </select>
    <select size=3><option>visible 3</option></select>
    <select multiple style="display:none"><option>hidden 3</option></select>
  `)
      for (const name of ["visible 1", "visible 2", "visible 3"]) {
        yield* page.getByRole("option", { name, exact: true }).pipe(Expect.toBeVisible)
      }
      for (const text of ["hidden 1", "hidden 2", "hidden 3"]) {
        yield* page.locator("option").filter({ hasText: text }).pipe(Expect.toBeHidden)
      }
    }))

  test("LO-122", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button><span></span>a button</button>`)
      const span = page.locator("span")
      assert.isFalse(yield* span.isVisible)
      assert.isTrue(yield* isHidden(span))
      assert.isFalse(yield* page.locator("span").isVisible)
      assert.isTrue(yield* isHidden(page.locator("span")))
      yield* span.pipe(Expect.toBeHidden)
      yield* span.pipe(Expect.toBeHidden)
      yield* span.pipe(Expect.toBeHidden)
      yield* page.locator("button").pipe(Expect.toBeVisible)
    }))

  test("LO-123", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role=button><span></span>a button</div>`)
      const span = page.locator("span")
      assert.isFalse(yield* span.isVisible)
      assert.isTrue(yield* isHidden(span))
      assert.isFalse(yield* page.locator("span").isVisible)
      assert.isTrue(yield* isHidden(page.locator("span")))
      yield* span.pipe(Expect.toBeHidden)
      yield* span.pipe(Expect.toBeHidden)
      yield* span.pipe(Expect.toBeHidden)
      yield* page.locator("[role=button]").pipe(Expect.toBeVisible)
    }))

  test("LO-124", ({ page, server }) =>
    Effect.gen(function*() {
      for (let i = 0; i < 20; i++) {
        // Avoid page.setContent throwing because of scheduled navigation, as the original does.
        yield* page.setContent(`
      <script>
        setTimeout(() => {
          window.location.href = ${JSON.stringify(server.EMPTY_PAGE)};
        }, Math.random(50));
      </script>
    `).pipe(Effect.ignore)
        assert.isFalse(yield* page.locator("div").isVisible)
      }
    }))
  test("LO-125", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(page.locator("div[").isVisible)
      assert(Locator.isLocatorError(error), String(error))
      assert.strictEqual(error.reason._tag, "InvalidInput")
      assert.strictEqual(error.reason._tag === "InvalidInput" ? error.reason.input : undefined, "selector")
    }))
})
