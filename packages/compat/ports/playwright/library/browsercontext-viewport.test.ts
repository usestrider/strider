/**
 * Playwright's `tests/library/browsercontext-viewport.spec.ts`: the default viewport, setting it, the page's screen and
 * media queries that follow it, touch and tap, device scale factor, an orientation angle, and a Windows-only WebKit check.
 *
 * What the port changes:
 * - `page.setViewportSize(size)` is `page.emulate({ viewport })`, which holds until the test's scope closes. Strider's
 *   emulate replaces the viewport as a whole, so the port restates the mobile flag where the original keeps it.
 * - `page.viewportSize()` is `page.viewportSize`, an `Option`; the port asserts it is present where the original reads
 *   its width and height. VP-013 asserts it is absent.
 * - Each `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - `verifyViewport` is the original's helper with Strider's viewport read and main-world `innerWidth`/`innerHeight`.
 * - VP-009's `page.tap('div')` and `page.locator('div').tap()` are the same call in Strider, `page.locator("div").tap()`.
 *   Strider's tap sends a touch start and end without touch emulation (API.md, "What each action sends"), so the
 *   original's refusal has nothing to fail on: the test is expected to fail on that tap.
 * - VP-010's `viewport: null` is a context with no viewport declaration: Strider has no null viewport, and an unset
 *   viewport is the window's own size, as Playwright's null is (`viewportSize` is None, VP-013).
 * - VP-011's issue annotation is reporting metadata, which the harness doesn't carry.
 * - VP-014's `browser.newPage({ deviceScaleFactor: 2 })` is `Browser.newPage` with the viewport's device scale factor. Its
 *   page closes with the test's scope, as the original's `page.close()` does at the same point.
 * - VP-014's `page.hover`, `page.mouse.down`, and `page.mouse.up` are `locator.hover` and `page.mouse.hold` held
 *   across the move and released with `held.release`.
 * - VP-016 and VP-017 load `/index.html`, which Playwright's test server doesn't have either (its 404 page). The port
 *   loads the vendored empty page: none of these assertions reads the page's content.
 * - VP-017's `devices['iPhone 14']` is written out from the Playwright installed on this host's device table, as the
 *   mobile port does; no test here reads its user agent, which is the table's own (Safari 27.2).
 * - VP-004 reads Playwright's device table, and VP-012 sets a screen size; neither is ported (see the ledger).
 * - VP-015 is Playwright's Windows-only, headed WebKit check and isn't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, type Emulation, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `devices['iPhone 14']`, the emulation of Playwright's device table (see the header). */
const iPhone14: Emulation.Emulation = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 664, deviceScaleFactor: 3, mobile: true },
  touch: true
}

/** Playwright's `verifyViewport(page, width, height)`. */
const verifyViewport = Effect.fnUntraced(function*(page: Page.Page, width: number, height: number) {
  assert.deepStrictEqual(Option.getOrThrow(yield* page.viewportSize), { width, height })
  assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), width)
  assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerHeight), height)
})

/** Playwright's `page.setViewportSize({ width, height })`: an emulation that holds for the test's scope. */
const setViewportSize = Effect.fnUntraced(function*(page: Page.Page, width: number, height: number) {
  yield* page.emulate({ viewport: { width, height } })
})

/** A page's `matchMedia(query).matches`, in its main world. */
const matches = (page: Page.Page, query: string) =>
  page.evaluateInMainWorld((query) => matchMedia(query).matches, query)

upstream(import.meta.filename, {}, (test) => {
  test("VP-001", ({ page }) =>
    Effect.gen(function*() {
      yield* verifyViewport(page, 1280, 720)
    }))

  test("VP-002", ({ page }) =>
    Effect.gen(function*() {
      yield* verifyViewport(page, 1280, 720)
      yield* setViewportSize(page, 345, 456)
      yield* verifyViewport(page, 345, 456)
    }))

  test("VP-003", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewportSize(page, 410, 420)
      const size = yield* page.evaluateInMainWorld(() => {
        return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight
        }
      })
      assert.strictEqual(size.innerWidth, 410)
      assert.strictEqual(size.innerHeight, 420)
      assert.isTrue(size.outerWidth >= size.innerWidth)
      assert.isTrue(size.outerHeight >= size.innerHeight)
    }))

  test("VP-005", ({ page }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(Option.getOrThrow(yield* page.viewportSize), { width: 1280, height: 720 })
      yield* setViewportSize(page, 300, 300)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.width), 300)
      assert.isTrue(yield* matches(page, "(min-device-width: 200px)"))
      assert.isFalse(yield* matches(page, "(min-device-width: 400px)"))
      assert.isFalse(yield* matches(page, "(max-device-width: 200px)"))
      assert.isTrue(yield* matches(page, "(max-device-width: 400px)"))
      assert.isFalse(yield* matches(page, "(device-width: 600px)"))
      assert.isTrue(yield* matches(page, "(device-width: 300px)"))
      yield* setViewportSize(page, 500, 500)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.width), 500)
      assert.isTrue(yield* matches(page, "(min-device-width: 400px)"))
      assert.isFalse(yield* matches(page, "(min-device-width: 600px)"))
      assert.isFalse(yield* matches(page, "(max-device-width: 400px)"))
      assert.isTrue(yield* matches(page, "(max-device-width: 600px)"))
      assert.isFalse(yield* matches(page, "(device-width: 200px)"))
      assert.isTrue(yield* matches(page, "(device-width: 500px)"))
    }))

  test("VP-006", ({ page }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(Option.getOrThrow(yield* page.viewportSize), { width: 1280, height: 720 })
      yield* setViewportSize(page, 300, 300)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.height), 300)
      assert.isTrue(yield* matches(page, "(min-device-height: 200px)"))
      assert.isFalse(yield* matches(page, "(min-device-height: 400px)"))
      assert.isFalse(yield* matches(page, "(max-device-height: 200px)"))
      assert.isTrue(yield* matches(page, "(max-device-height: 400px)"))
      assert.isFalse(yield* matches(page, "(device-height: 600px)"))
      assert.isTrue(yield* matches(page, "(device-height: 300px)"))
      yield* setViewportSize(page, 500, 500)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.height), 500)
      assert.isTrue(yield* matches(page, "(min-device-height: 400px)"))
      assert.isFalse(yield* matches(page, "(min-device-height: 600px)"))
      assert.isFalse(yield* matches(page, "(max-device-height: 400px)"))
      assert.isTrue(yield* matches(page, "(max-device-height: 600px)"))
      assert.isFalse(yield* matches(page, "(device-height: 200px)"))
      assert.isTrue(yield* matches(page, "(device-height: 500px)"))
    }))

  test("VP-007", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewportSize(page, 500, 600)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.availWidth), 500)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.availHeight), 600)
    }))

  test("VP-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/mobile.html")
      assert.isFalse(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
    }))

  test("VP-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>a</div>")
      // `page.tap('div')` is the same call as the locator's in Strider
      const error = yield* failureOf(page.locator("div").tap(), "tap")
      assert.include(String(error), "The page does not support tap")
      const second = yield* failureOf(page.locator("div").tap(), "tap")
      assert.include(String(second), "The page does not support tap")
    }))

  test("VP-010", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      // `viewport: null` is a context with no viewport declaration (see the header)
      const context = yield* Browser.newContext({ emulation: { touch: true } })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html")
      assert.isTrue(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
    })))

  test("VP-011", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 393, height: 727 }, touch: true }
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<div id="tall" style="height:3000px">tall</div>`)
      const probe = () =>
        page.evaluateInMainWorld(() => ({
          ontouchstart: "ontouchstart" in window,
          maxTouchPoints: navigator.maxTouchPoints,
          coarse: matchMedia("(pointer: coarse)").matches
        }))
      const expected = yield* probe()
      assert.isTrue(expected.ontouchstart)
      yield* page.screenshot({ area: "fullPage" })
      assert.deepStrictEqual(yield* probe(), expected)
      // `page.locator('#tall').screenshot()`
      yield* page.screenshot({ area: { element: page.locator("#tall") } })
      assert.deepStrictEqual(yield* probe(), expected)
      yield* page.goto(server.EMPTY_PAGE)
      assert.deepStrictEqual(yield* probe(), expected)
    })))

  test("VP-013", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      assert.isTrue(Option.isNone(yield* page.viewportSize))
    })))

  test("VP-014", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({
        emulation: { viewport: { width: 1280, height: 720, deviceScaleFactor: 2 } }
      })
      yield* page.goto(server.PREFIX + "/drag-n-drop.html")
      yield* page.locator("#source").hover()
      const held = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* held.release
      // `page.$eval('#target', target => target.contains(document.querySelector('#source')))`
      assert.isTrue(
        yield* page.evaluateInMainWorld(() =>
          (document.querySelector("#target") as Element).contains(document.querySelector("#source"))
        ),
        "could not find source in target"
      )
    })))

  test("VP-016", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 300, height: 400, mobile: false } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.orientation.angle), 0)
      yield* page.emulate({ viewport: { width: 400, height: 300, mobile: false } })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.orientation.angle), 0)
    })))

  test("VP-017", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone14 })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.orientation.type), "portrait-primary")
    })))
})
