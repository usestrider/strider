/**
 * Playwright's `tests/library/browsercontext-viewport-mobile.spec.ts`: a mobile viewport and touch, the hover and pointer
 * media features, orientation, and scrolling and clicking on a mobile page.
 *
 * What the port changes:
 * - Each test makes its own contexts and pages (`page: false`), as the original does through its `browser` fixture.
 *   The original closes a context where its test ends; here a context closes with the test's scope, and each of these
 *   tests does nothing after its last close.
 * - Playwright's `devices['iPhone 6']`, `'iPhone 6 landscape'`, and `'iPhone 12'` are written out, as the values their
 *   device table holds: Strider has no device table (`property-playwright-devices`). The viewports, pixel ratios,
 *   mobile and touch flags are those of the table in the Playwright installed on this host, since the pinned checkout
 *   ships none; the user agents' Safari version (26.4) is not that table's (27.2), and no test here reads a user agent. Strider
 *   has no screen size to emulate, so the descriptors' `screen` is left out.
 * - `browser.newContext({ ...device })` and `browser.newPage({ ...device })` take the device's settings as
 *   `Browser.newContext({ emulation })` and `Browser.newPage({ emulation })`.
 * - `page.setViewportSize(size)` is `page.emulate({ viewport })`. Strider's emulate replaces the viewport as a whole, so
 *   the port restates the mobile flag and the device pixel ratio that Playwright keeps from the device.
 * - Each `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - DV-019's `page.waitForEvent("console")` is `ConsoleMessage.next`, subscribed before the viewport change it waits for.
 * - DV-024's `page.waitForFunction('window.scrollY === 100')` is an `Expect` over a main-world read, and its
 *   `mouse.wheel(...).catch(...)` is `Effect.result`. The original asserts the wheel's refusal only on WebKit, and this
 *   port does the same.
 * - DV-026's route fulfills the page's `button.html` with `Route.fulfill`, and its `{ force: true }` click is
 *   `forceChecks`. `boundingBox()` is an `Option`, which the port asserts is present.
 * - DV-017 and DV-018 skip themselves on Playwright's frozen WebKit builds. Those are not the stock browsers Strider drives,
 *   so the port runs them everywhere.
 * - Firefox and stock WebKit can't emulate a mobile viewport or touch (`emulation.viewport.mobile` and `emulation.touch`),
 *   so every test here is ledgered for them (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, Condition, ConsoleMessage, Emulation, Expect, Mouse, Page, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { forceChecks } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `devices['iPhone 6']`, the emulation of Playwright's device table (see the header). */
const iPhone6: Emulation.Emulation = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.4 Mobile/15A372 Safari/604.1",
  viewport: { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
  touch: true
}

/** Playwright's `devices['iPhone 6 landscape']`. */
const iPhone6Landscape: Emulation.Emulation = {
  userAgent: iPhone6.userAgent,
  viewport: { width: 667, height: 375, deviceScaleFactor: 2, mobile: true },
  touch: true
}

/** Playwright's `devices['iPhone 12']`. */
const iPhone12: Emulation.Emulation = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 664, deviceScaleFactor: 3, mobile: true },
  touch: true
}

/** The page's `dispatchTouch`: a touch the page's handler receives, and a value its own promise settles with. */
function dispatchTouch() {
  let fulfill!: (s: string) => void
  const promise = new Promise<string>((x) => fulfill = x)
  window.ontouchstart = () => {
    fulfill("Received touch")
  }
  window.dispatchEvent(new Event("touchstart"))

  fulfill("Did not receive touch")

  return promise
}

const holds = Condition.make("to be true", (value: unknown) => value === true)

/** A page's `matchMedia(query).matches`, in its main world. */
const matches = (page: Page.Page, query: string) =>
  page.evaluateInMainWorld((query) => matchMedia(query).matches, query)

upstream(import.meta.filename, {}, (test) => {
  test("DV-011", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), 375)
      // The device's mobile flag and pixel ratio stay with the page, as Playwright's setViewportSize keeps them
      yield* page.emulate({ viewport: { width: 400, height: 300, deviceScaleFactor: 2, mobile: true } })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), 400)
    }))

  test("DV-012", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
      assert.strictEqual(yield* page.evaluateInMainWorld(dispatchTouch), "Received touch")
    }))

  test("DV-013", { page: false }, () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      assert.isTrue(yield* page.evaluateInMainWorld(() => "ontouchstart" in window || !!window.TouchEvent))
    }))

  test("DV-014", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 800, height: 600 }, touch: true }
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => "ontouchstart" in window || !!window.TouchEvent))
    }))

  test("DV-015", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context1 = yield* Browser.newContext({ emulation: iPhone6 })
      const page1 = yield* context1.newPage
      yield* page1.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.isFalse(yield* matches(page1, "(orientation: landscape)"))
      const context2 = yield* Browser.newContext({ emulation: iPhone6Landscape })
      const page2 = yield* context2.newPage
      assert.isTrue(yield* matches(page2, "(orientation: landscape)"))
    }))

  test("DV-016", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 300, height: 400, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.orientation), 0)
      yield* page.emulate({ viewport: { width: 400, height: 300, mobile: true } })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.orientation), 90)
    }))

  test("DV-017", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 400, height: 300, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.orientation), 90)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.orientation), 90)
    }))

  test("DV-018", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 300, height: 400, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.orientation.type), "portrait-primary")
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.screen.orientation.type), "portrait-primary")
    }))

  test("DV-019", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 300, height: 400, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        let counter = 0
        window.addEventListener("orientationchange", () => console.log(++counter))
      })

      const event1 = yield* ConsoleMessage.next(page)
      yield* page.emulate({ viewport: { width: 400, height: 300, mobile: true } })
      assert.strictEqual((yield* event1).text, "1")

      const event2 = yield* ConsoleMessage.next(page)
      yield* page.emulate({ viewport: { width: 300, height: 400, mobile: true } })
      assert.strictEqual((yield* event2).text, "2")
    }))

  test("DV-020", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 320, height: 480, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), 980)
    }))

  test("DV-021", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 320, height: 480, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), 320)
    }))

  test("DV-022", { page: false }, () =>
    Effect.gen(function*() {
      const mobilepage = yield* Browser.newPage({ emulation: iPhone6 })
      assert.isFalse(yield* matches(mobilepage, "(hover: hover)"))
      assert.isTrue(yield* matches(mobilepage, "(hover: none)"))
      assert.isFalse(yield* matches(mobilepage, "(any-hover: hover)"))
      assert.isTrue(yield* matches(mobilepage, "(any-hover: none)"))
      assert.isTrue(yield* matches(mobilepage, "(pointer: coarse)"))
      assert.isFalse(yield* matches(mobilepage, "(pointer: fine)"))
      assert.isTrue(yield* matches(mobilepage, "(any-pointer: coarse)"))
      assert.isFalse(yield* matches(mobilepage, "(any-pointer: fine)"))

      const desktopPage = yield* Browser.newPage()
      assert.isFalse(yield* matches(desktopPage, "(hover: none)"))
      assert.isTrue(yield* matches(desktopPage, "(hover: hover)"))
      assert.isFalse(yield* matches(desktopPage, "(any-hover: none)"))
      assert.isTrue(yield* matches(desktopPage, "(any-hover: hover)"))
      assert.isFalse(yield* matches(desktopPage, "(pointer: coarse)"))
      assert.isTrue(yield* matches(desktopPage, "(pointer: fine)"))
      assert.isFalse(yield* matches(desktopPage, "(any-pointer: coarse)"))
      assert.isTrue(yield* matches(desktopPage, "(any-pointer: fine)"))
    }))

  test("DV-023", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // @see https://crbug.com/929806
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 360, height: 640, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/mobile.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.addEventListener("click", (event) => {
          Reflect.set(window, "result", { x: event.clientX, y: event.clientY })
        })
      })

      yield* page.mouse.click({ x: 30, y: 40 })

      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), { x: 30, y: 40 })
    }))

  test("DV-024", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 1000, height: 600, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.mouse.move({ x: 50, y: 60 })
      const wheel = yield* Effect.result(page.mouse.wheel({ x: 0, y: 100 }))
      if (browserName === "webkit") {
        // Stock WebKit's refusal of a wheel on a mobile viewport, which Strider reports as a MouseError
        if (Result.isSuccess(wheel)) throw new Error("the wheel succeeded, where mobile WebKit refuses it")
        if (!Mouse.isMouseError(wheel.failure)) throw new Error(`expected a MouseError, got ${String(wheel.failure)}`)
        assert.strictEqual(wheel.failure.reason._tag, "Unsupported")
      } else {
        yield* Expect.that(page.evaluateInMainWorld(() => window.scrollY === 100), holds)
      }
    }))

  test("DV-025", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone12 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/background-fixed.html", { waitUntil: "load" })
      yield* page.getByRole("button").click()
      assert.isAbove(yield* page.evaluateInMainWorld(() => window.scrollY), 1000)
    }))

  test("DV-026", { page: false }, () =>
    Effect.gen(function*() {
      // @see https://github.com/microsoft/playwright/issues/26876
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 390, height: 664, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(
        `data:text/html,<meta name='viewport' content='device-width, initial-scale=1'><button>Mobile Viewport</button>`,
        { waitUntil: "load" }
      )
      yield* page.route("**/button.html", () =>
        Route.fulfill(HttpServerResponse.html(`<body>
          <button>Click me</button>
          <script>
            window.clicks = [];
            document.addEventListener('click', e => {
              const dot = document.createElement('div');
              dot.style.position = 'absolute';
              dot.style.width = '10px';
              dot.style.height = '10px';
              dot.style.borderRadius = '5px';
              dot.style.backgroundColor = 'red';
              dot.style.left = e.pageX + 'px';
              dot.style.top = e.pageY + 'px';
              dot.textContent = 'x: ' + e.pageX + ' y: ' + e.pageY;
              document.body.appendChild(dot);
              window.clicks.push({ x: e.pageX, y: e.pageY });
            });
          </script>
        </body>`)))
      yield* page.goto("http://localhost/button.html", { waitUntil: "load" })
      yield* page.getByText("Click me").click({ checks: forceChecks })
      const box = yield* page.locator("button").boundingBox
      assert.isTrue(Option.isSome(box), "the button has no box")
      const clicks = yield* page.evaluateInMainWorld(() =>
        Reflect.get(window, "clicks") as Array<{ x: number; y: number }>
      )
      assert.strictEqual(clicks.length, 1)
      const [click] = clicks
      assert.isDefined(click)
      if (click === undefined || Option.isNone(box)) return
      const { x, y } = click
      const isClickInsideButton = box.value.x <= x && x <= box.value.x + box.value.width &&
        box.value.y <= y && y <= box.value.y + box.value.height
      assert.isTrue(isClickInsideButton)
    }))
})
