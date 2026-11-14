/**
 * Playwright's `tests/page/page-dispatchevent.spec.ts`: dispatching one untrusted DOM event on an element, with its
 * constructor and init, and what the page sees of it.
 *
 * What the port changes:
 * - `page.dispatchEvent(selector, type, init)` and `elementHandle.dispatchEvent(type, init)` are
 *   `page.locator(selector).dispatchEvent(type, options)`. Strider has no page-level dispatch or ElementHandle
 *   (`method-page-dispatchevent`, `method-elementhandle-dispatchevent`). A locator must match exactly one element where
 *   Playwright's page call takes the first match; every selector these tests use matches one element.
 * - Playwright picks an event's constructor from its name. Strider's is `Event` unless `eventClass` names one, so the
 *   wheel and device events name theirs: `WheelEvent`, `DeviceOrientationEvent`, and `DeviceMotionEvent`. Their init is
 *   the original's, by value.
 * - `page.evaluate("name")` reads a page global, so it's `global(page, "name")`, a read of `window[name]` in the main
 *   world, where Playwright's `page.evaluate` runs.
 * - `page.$eval` and `page.evaluate` steps that change the page run in the main world with `evaluateInMainWorld`, so
 *   expandos and listeners land where the page's own scripts see them.
 * - DE-008's `page.dispatchEvent` starts before its span exists, so it's a child fiber started at once and joined where
 *   the original awaits it. Its `page.waitForTimeout(100)` is the original's own, so it's a sleep, with its comment.
 * - DE-014 to DE-016 skip only on Android in the original. Strider drives no Android, so they run.
 * - DE-013's `console.log` of each event is kept as the original has it.
 * - Not ported (see the ledger): DE-009 registers a custom selector engine (`method-selectors-register`); DE-010 and
 *   DE-011 pass a `DataTransfer` as event init, which Strider's init can't carry (`method-locator-dispatchevent`);
 *   DE-017 passes a handle from another frame's context, which Strider has no form of (`notApplicable`).
 */
import { assert } from "@effect/vitest"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { upstream } from "../../harness/upstream.ts"

/** A page global, as Playwright's `page.evaluate("name")` reads it: in the main world. */
const global = (page: Page.Page, name: string) => page.evaluateInMainWorld((name) => Reflect.get(window, name), name)

upstream(import.meta.filename, {}, (test) => {
  test("DE-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("DE-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      // The button's listener records the event's flags on `window`
      assert.isOk(yield* global(page, "bubbles"))
      assert.isOk(yield* global(page, "cancelable"))
      assert.isOk(yield* global(page, "composed"))
    }))

  test("DE-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <svg height="100" width="100">
      <circle onclick="javascript:window.__CLICKED=42" cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />
    </svg>
  `)
      yield* page.locator("circle").dispatchEvent("click")
      assert.strictEqual(yield* global(page, "__CLICKED"), 42)
    }))

  test("DE-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
    span::before {
      content: 'q';
    }
    </style>
    <span onclick='javascript:window.CLICKED=42'></span>
  `)
      yield* page.locator("span").dispatchEvent("click")
      assert.strictEqual(yield* global(page, "CLICKED"), 42)
    }))

  test("DE-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("DE-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("DE-007", ({ page }) =>
    Effect.gen(function*() {
      // The button is covered by a div that takes no pointer events until hovered. Dispatch runs no hit test.
      yield* page.setContent(`<style>
    container { display: block; position: relative; width: 200px; height: 50px; }
    div, button { position: absolute; left: 0; top: 0; bottom: 0; right: 0; }
    div { pointer-events: none; }
    container:hover div { pointer-events: auto; background: red; }
  </style>
  <container>
    <button onclick="window.clicked=true">Click me</button>
    <div></div>
  </container>`)
      yield* page.locator("button").dispatchEvent("click")
      assert.isOk(yield* global(page, "clicked"))
    }))

  test("DE-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // Playwright starts the dispatch at once, and it waits for the span to appear
      const watchdog = yield* Effect.forkChild(page.locator("span").dispatchEvent("click"), {
        startImmediately: true
      })
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.attachShadow({ mode: "open" })
        document.body.appendChild(div)
      })
      // The original's own fixed wait, which lets the dispatch start before the span is added
      yield* Effect.sleep("100 millis")
      yield* page.evaluateInMainWorld(() => {
        const span = document.createElement("span")
        span.textContent = "Hello from shadow"
        span.addEventListener("click", () => Reflect.set(window, "clicked", true))
        document.querySelector("div")!.shadowRoot!.appendChild(span)
      })
      yield* Fiber.join(watchdog)
      assert.strictEqual(yield* global(page, "clicked"), true)
    }))

  test("DE-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").dispatchEvent("click")
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("DE-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html")
      // The body's listener keeps each event in the main world, where Playwright's `eventsHandle` lives
      yield* page.evaluateInMainWorld(() => {
        const events: Array<WheelEvent> = []
        Reflect.set(window, "__wheelEvents", events)
        document.body.addEventListener("wheel", (event) => {
          events.push(event)
          console.log(event)
        })
      })
      yield* page.locator("body").dispatchEvent("wheel", {
        eventClass: "WheelEvent",
        init: { deltaX: 100, deltaY: 200 }
      })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (Reflect.get(window, "__wheelEvents") as Array<WheelEvent>).length),
        1
      )
      assert.isTrue(
        yield* page.evaluateInMainWorld(() =>
          (Reflect.get(window, "__wheelEvents") as Array<WheelEvent>)[0] instanceof WheelEvent
        )
      )
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => {
          const [event] = Reflect.get(window, "__wheelEvents") as Array<WheelEvent>
          return { deltaX: event!.deltaX, deltaY: event!.deltaY }
        }),
        { deltaX: 100, deltaY: 200 }
      )
    }))

  test("DE-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/device-orientation.html")
      yield* page.locator("html").dispatchEvent("deviceorientation", {
        eventClass: "DeviceOrientationEvent",
        init: { alpha: 10, beta: 20, gamma: 30 }
      })
      assert.strictEqual(yield* global(page, "result"), "Oriented")
      assert.strictEqual(yield* global(page, "alpha"), 10)
      assert.strictEqual(yield* global(page, "beta"), 20)
      assert.strictEqual(yield* global(page, "gamma"), 30)
      assert.isNotOk(yield* global(page, "absolute"))
    }))

  test("DE-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/device-orientation.html")
      yield* page.locator("html").dispatchEvent("deviceorientationabsolute", {
        eventClass: "DeviceOrientationEvent",
        init: { alpha: 10, beta: 20, gamma: 30, absolute: true }
      })
      assert.strictEqual(yield* global(page, "result"), "Oriented")
      assert.strictEqual(yield* global(page, "alpha"), 10)
      assert.strictEqual(yield* global(page, "beta"), 20)
      assert.strictEqual(yield* global(page, "gamma"), 30)
      assert.isOk(yield* global(page, "absolute"))
    }))

  test("DE-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/device-motion.html")
      yield* page.locator("html").dispatchEvent("devicemotion", {
        eventClass: "DeviceMotionEvent",
        init: {
          acceleration: { x: 10, y: 20, z: 30 },
          accelerationIncludingGravity: { x: 15, y: 25, z: 35 },
          rotationRate: { alpha: 5, beta: 10, gamma: 15 },
          interval: 16
        }
      })
      assert.strictEqual(yield* global(page, "result"), "Moved")
      // The page's own globals, read as numbers inside the page: the motion objects are DOM objects
      const motion = yield* page.evaluateInMainWorld(() => {
        const a = Reflect.get(window, "acceleration") as { x: number; y: number; z: number }
        const g = Reflect.get(window, "accelerationIncludingGravity") as { x: number; y: number; z: number }
        const r = Reflect.get(window, "rotationRate") as { alpha: number; beta: number; gamma: number }
        return {
          acceleration: [a.x, a.y, a.z],
          accelerationIncludingGravity: [g.x, g.y, g.z],
          rotationRate: [r.alpha, r.beta, r.gamma],
          interval: Reflect.get(window, "interval") as number
        }
      })
      assert.deepStrictEqual(motion.acceleration, [10, 20, 30])
      assert.deepStrictEqual(motion.accelerationIncludingGravity, [15, 25, 35])
      assert.deepStrictEqual(motion.rotationRate, [5, 10, 15])
      assert.strictEqual(motion.interval, 16)
    }))
})
