/**
 * Playwright's `tests/page/locator-misc-2.spec.ts`: a locator's keyboard and selection actions, its scrolling and box
 * reads, `waitFor`, the visibility filter, and the locator-argument form of `locator()`.
 *
 * What the port changes:
 * - `locator.press`, `locator.pressSequentially`, `locator.selectText`, `locator.fill`, and `locator.click` are the same
 *   methods. The reads that check what they did are Strider's non-evaluating reads (`readValue`).
 * - `locator.type(text)` (LO-144) is Playwright's alias for focusing the element and then pressing each character, which
 *   is `focus()` then `pressSequentially()` here. The matrix row `method-locator-type` says Strider has no alias on
 *   purpose, so the port makes the two calls the alias makes, as `page-screenshot` does for `div.type`.
 * - `locator.scrollIntoViewIfNeeded()` is `scrollIntoView` with `checks: { visible: false }`. Playwright's scroll waits only
 *   for the element to be stable, not visible, so a zero-sized element (LO-142) scrolls; Strider's `visible` check
 *   would refuse it, so that check is off and `stable` stays on.
 * - `locator.evaluate(…)` reads and writes a page element in an isolated world, which stock WebKit doesn't have. Where
 *   the original runs its function in the page, the port uses `page.evaluateInMainWorld` with `document.querySelector`
 *   (the same element), and where it reads a rectangle it reads `boundingBox`, which is Strider's read of the element's
 *   border box. Strider's `boundingBox` is an immediate read: it doesn't wait for a missing element.
 * - `page.setViewportSize` is `page.emulate({ viewport })`, whose registration lives while the test's scope does.
 * - `waitFor()` (LO-148) and `waitFor({ state: "hidden" })` (LO-149) hold the wait the original holds across steps with
 *   `startWaiting`: `Expect.toBeVisible` and `Expect.toBeHidden` are the named expectations of those states, which
 *   the matrix row `method-locator-waitfor` names. The wait's fiber is joined where the original awaits its promise.
 * - The selector strings `.item >> visible=true` (LO-150) and `visible()` (LO-152) are `filter({ visible: true })`
 *   (`method-locator-visible`). A `>> text=…` or `getByText` chained to a locator searches inside it, so a chained text
 *   that the original can match on the element itself is `and(page.getByText(…))`, which keeps that element.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - LO-146 is a golden comparison of an element capture, against Playwright's own images and fonts, and is not ported
 *   (see the ledger).
 * - LO-154 passes a locator to `locator()` and `frameLocator().locator()`. Strider's `locator` takes a CSS string only
 *   (the matrix row says so), so the test is `needsFeature` (see the ledger).
 * - LO-153's `it.info().annotations` is Playwright's issue metadata, which the port doesn't carry.
 * - LO-141's `it.fixme(isAndroid)` doesn't apply to this Linux harness, so the test runs.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A locator's border box as plain numbers, asserting that it has one. */
const boxOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const box = yield* locator.boundingBox
  assert(Option.isSome(box), "the element has no layout box")
  const { x, y, width, height } = box.value
  return { x, y, width, height }
})

/** The distance from an element's right edge to the viewport's right edge, which the original computes in the page. */
const rightOverViewport = Effect.fnUntraced(function*(page: Page.Page, locator: Locator.ReadonlyLocator) {
  const box = yield* boxOf(locator)
  const innerWidth = yield* page.evaluateInMainWorld(() => window.innerWidth)
  return box.x + box.width - innerWidth
})

upstream(import.meta.filename, {}, (test) => {
  test("LO-140", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' />`)
      yield* page.locator("input").press("h")
      assert.strictEqual(yield* page.locator("input").readValue, "h")
    }))

  test("LO-141", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/offscreenbuttons.html", { waitUntil: "load" })
      for (let i = 0; i < 11; ++i) {
        const button = page.locator("#btn" + i)
        const before = yield* rightOverViewport(page, button)
        assert.strictEqual(before, 10 * i)
        yield* button.scrollIntoView({ checks: { visible: false } })
        const after = yield* rightOverViewport(page, button)
        assert.isTrue(after <= 0)
        yield* page.evaluateInMainWorld(() => window.scrollTo(0, 0))
      }
    }))

  test("LO-142", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      html,body { margin: 0; padding: 0; }
      ::-webkit-scrollbar { display: none; }
      * { scrollbar-width: none; }
    </style>
    <div style="height: 2000px; text-align: center; border: 10px solid blue;">
      <h1>SCROLL DOWN</h1>
    </div>
    <div id=lazyload style="font-size:75px; background-color: green;"></div>
    <script>
      const lazyLoadElement = document.querySelector('#lazyload');
      const observer = new IntersectionObserver((entries) => {
        if (entries.some(entry => entry.isIntersecting)) {
          lazyLoadElement.textContent = 'LAZY LOADED CONTENT';
          lazyLoadElement.style.height = '20px';
          observer.disconnect();
        }
      });
      observer.observe(lazyLoadElement);
    </script>
  `)
      const lazyLoad = page.locator("#lazyload")
      assert.deepStrictEqual(yield* boxOf(lazyLoad), { x: 0, y: 2020, width: 1280, height: 0 })
      // Playwright's scrollIntoViewIfNeeded doesn't require the zero-sized element to be visible
      yield* lazyLoad.scrollIntoView({ checks: { visible: false } })
      yield* Expect.toHaveText(lazyLoad, "LAZY LOADED CONTENT")
      assert.deepStrictEqual(yield* boxOf(lazyLoad), { x: 0, y: 720, width: 1280, height: 20 })
    }))

  test("LO-143", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      // The original sets the value from the page's own script; the port sets it in the main world
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("textarea") as HTMLTextAreaElement).value = "some value"
      })
      yield* page.locator("textarea").selectText()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.getSelection()?.toString()), "some value")
    }))

  test("LO-144", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' />`)
      const input = page.locator("input")
      // Playwright's `type` focuses the element, then types it (see the header)
      yield* input.focus()
      yield* input.pressSequentially("hello")
      assert.strictEqual(yield* input.readValue, "hello")
    }))

  test("LO-145", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' />`)
      yield* page.locator("input").pressSequentially("hello")
      assert.strictEqual(yield* page.locator("input").readValue, "hello")
    }))

  test("LO-147", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 500, height: 500 } })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      assert.deepStrictEqual(yield* boxOf(page.locator(".box:nth-of-type(13)")), {
        x: 100,
        y: 50,
        width: 50,
        height: 50
      })
    }))

  test("LO-148", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div></div>`)
      const locator = page.locator("span")
      // The original's `waitFor()` is the named expectation of its default state, visible
      const waiting = yield* startWaiting(Expect.toBeVisible(locator))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.innerHTML = "<span>target</span>"
      })
      yield* Fiber.join(waiting.fiber)
      yield* Expect.toHaveText(locator, "target")
    }))

  test("LO-149", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><span>target</span></div>`)
      const locator = page.locator("span")
      const waiting = yield* startWaiting(Expect.toBeHidden(locator))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.innerHTML = ""
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("LO-150", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>
  <div class="item" style="display: none">Hidden data0</div>
  <div class="item">visible data1</div>
  <div class="item" style="display: none">Hidden data1</div>
  <div class="item">visible data2</div>
  <div class="item" style="display: none">Hidden data1</div>
  <div class="item">visible data3</div>
  </div>`)
      // `.item >> visible=true` is the visible items; `>> text=data3` keeps the item that has that text
      const visibleItems = page.locator(".item").filter({ visible: true })
      yield* Expect.toHaveText(visibleItems.nth(1), "visible data2")
      yield* Expect.toHaveText(visibleItems.and(page.getByText("data3")), "visible data3")
    }))

  test("LO-151", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>
    <div class="item" style="display: none">Hidden data0</div>
    <div class="item">visible data1</div>
    <div class="item" style="display: none">Hidden data1</div>
    <div class="item">visible data2</div>
    <div class="item" style="display: none">Hidden data2</div>
    <div class="item">visible data3</div>
    </div>
  `)
      const visibleItems = page.locator(".item").filter({ visible: true })
      yield* Expect.toHaveText(visibleItems.nth(1), "visible data2")
      yield* Expect.toHaveText(visibleItems.and(page.getByText("data3")), "visible data3")
      yield* Expect.toHaveText(
        page.locator(".item").filter({ visible: false }).and(page.getByText("data1")),
        "Hidden data1"
      )
    }))

  test("LO-152", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>
    <div class="item" style="display: none">Hidden data0</div>
    <div class="item">visible data1</div>
    <div class="item" style="display: none">Hidden data1</div>
    <div class="item">visible data2</div>
    <div class="item" style="display: none">Hidden data2</div>
    <div class="item">visible data3</div>
    </div>
  `)
      // Playwright's `visible()` is `filter({ visible: true })`, the matrix row's form
      const visibleItems = page.locator(".item").filter({ visible: true })
      yield* Expect.toHaveText(visibleItems.nth(1), "visible data2")
      yield* Expect.toHaveText(visibleItems.and(page.getByText("data3")), "visible data3")
      yield* Expect.toHaveCount(visibleItems, 3)
    }))

  test("LO-153", ({ page }) =>
    Effect.gen(function*() {
      // The original replaces the page's `Map` in the main world; the engine must not depend on it
      yield* page.evaluateInMainWorld(() => {
        ;(globalThis as unknown as Record<string, unknown>)["Map"] = 1
      })
      const rows = page.locator("#searchResultTableDiv .x-grid3-row")
      yield* rows.count
      yield* Expect.toHaveCount(rows, 0)
    }))

  test("LO-155", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>Enable</button>
    <form>
      <textarea id="text" disabled></textarea>
    </form>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.querySelector('#text').disabled = false;
      });
    </script>
  `)
      yield* page.locator("button").click()
      yield* page.locator("#text").fill("Hello")
      yield* Expect.toHaveValue(page.locator("#text"), "Hello")
    }))

  test("LO-156", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type='text' value='hello' />`)
      const locator = page.getByRole("textbox")
      for (const key of ["NotARealKey", "ё", "😊"]) {
        const failure = yield* failureOf(locator.press(key), `press(${key})`)
        assert(Locator.isLocatorError(failure), String(failure))
        assert.strictEqual(failure.reason._tag, "InvalidInput")
      }
    }))
})
