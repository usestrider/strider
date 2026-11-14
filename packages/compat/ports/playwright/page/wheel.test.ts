/**
 * Playwright's `tests/page/wheel.spec.ts`: wheel input at the pointer, the wheel events the page sees, the modifiers they
 * carry, and the scroll they cause.
 *
 * What the port changes:
 * - `page.mouse.wheel(deltaX, deltaY)` is `page.mouse.wheel({ x, y })`, sent at the pointer's position as the original's
 *   is. Strider's wheel has no modifiers of its own: a key held with `page.keyboard.hold` is carried by the wheel, as it
 *   is by a click, so MO-021 holds Shift that way, where the original holds it with `keyboard.down`.
 * - `page.evaluate` runs in the page's main world, so the listeners the tests install and the `window.lastEvent` they
 *   read are `page.evaluateInMainWorld`. The listener is the test's own, as in the original, and records the events it
 *   sees in `window`; the page's scripts are not changed.
 * - `page.waitForFunction("…")` is `Expect.that` on the same read, polled until its condition holds. `expect.poll` for
 *   `window.lastEvent` is the same poll, reading the event once it is there.
 * - `page.goto(url)` returns at commit in Strider, so MO-020 waits for `load`, which is Playwright's default.
 * - MO-018 opens a popup from a script. Strider keeps the browser's popup blocking, so `window.open` runs as a user
 *   gesture (`Page.withUserGesture`), and `waitForEvent("popup")` is `Popup.next`, subscribed before the call.
 * - The original's `ignoreDelta` (Chromium on macOS reports deltas scaled by the host's device scale factor) applies
 *   here as written, keyed on the host's platform, though this harness runs on Linux.
 * - `it.skip(isAndroid)` doesn't apply: Strider has no Android.
 * - `it.info().annotations` (MO-019's issue link) is the file's reference, not an assertion, and is dropped.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { rafraf } from "../../harness/playwright.ts"
import { type Fixtures, upstream } from "../../harness/upstream.ts"

/** The fields of a wheel event the original's `listenForWheelEvents` records. */
interface WheelRecord {
  readonly deltaX: number
  readonly deltaY: number
  readonly clientX: number
  readonly clientY: number
  readonly deltaMode: number
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

/** The events of the original's `wheel` listener, as the test's own listener in the page's main world records them. */
const listenForWheelEvents = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld((selector) => {
    document.querySelector(selector)!.addEventListener("wheel", (event) => {
      const e = event as WheelEvent
      Reflect.set(window, "lastEvent", {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey
      })
    }, { passive: false })
  }, selector)

const lastEvent = (page: Page.Page) =>
  page.evaluateInMainWorld(() => Reflect.get(window, "lastEvent") as WheelRecord | undefined)

const scrollY = (page: Page.Page) => page.evaluateInMainWorld(() => window.scrollY)
const scrollX = (page: Page.Page) => page.evaluateInMainWorld(() => window.scrollX)

/** Playwright's `ignoreDelta`: Chromium on macOS reports deltas scaled by the host's device scale factor. */
const ignoreDeltaOn = (browserName: Fixtures["browserName"]) =>
  browserName === "chromium" && process.platform === "darwin"

/** The comparison of an event with its deltas dropped where the original drops them. */
const compared = (ignoreDelta: boolean, event: Partial<WheelRecord>): Partial<WheelRecord> => {
  if (!ignoreDelta) return event
  return Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== "deltaX" && key !== "deltaY")
  ) as Partial<WheelRecord>
}

/**
 * Playwright's `expectEvent`: waits until a wheel event is recorded (`expect.poll` … `toBeTruthy()`), then checks it
 * equals `expected`.
 */
const expectEvent = Effect.fnUntraced(function*(
  page: Page.Page,
  expected: WheelRecord,
  ignoreDelta: boolean
) {
  yield* Expect.that(
    lastEvent(page),
    Condition.make("a recorded wheel event", (event: WheelRecord | undefined) => Boolean(event))
  )
  const received = yield* lastEvent(page)
  assert.deepStrictEqual(compared(ignoreDelta, received ?? {}), compared(ignoreDelta, expected))
})

const pageOfDivs = `<div style="width: 5000px; height: 5000px;"></div>`

upstream(import.meta.filename, {}, (test) => {
  test("MO-017", ({ page, browserName }) =>
    Effect.gen(function*() {
      const ignoreDelta = ignoreDeltaOn(browserName)
      yield* page.setContent(pageOfDivs)
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* listenForWheelEvents(page, "div")
      yield* page.mouse.wheel({ x: 0, y: 100 })
      yield* Expect.that(scrollY(page), Condition.make("100", (y: number) => y === 100))
      yield* expectEvent(page, {
        deltaX: 0,
        deltaY: 100,
        clientX: 50,
        clientY: 60,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      }, ignoreDelta)
    }))

  test("MO-018", ({ page, browserName }) =>
    Effect.gen(function*() {
      const ignoreDelta = ignoreDeltaOn(browserName)
      yield* page.setContent(pageOfDivs)
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* listenForWheelEvents(page, "div")
      // Playwright's `Promise.all([waitForEvent("popup"), evaluate(window.open(""))])`: the subscription first, then
      // the call that opens the popup, as a user gesture
      const popups = yield* Popup.next(page)
      // The popup's window isn't returned: a window doesn't cross by value, and the original discards it too
      yield* page.evaluateInMainWorld(() => {
        window.open("")
      }).pipe(Page.withUserGesture)
      yield* popups
      yield* page.mouse.wheel({ x: 0, y: 100 })
      yield* Expect.that(scrollY(page), Condition.make("100", (y: number) => y === 100))
      yield* expectEvent(page, {
        deltaX: 0,
        deltaY: 100,
        clientX: 50,
        clientY: 60,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      }, ignoreDelta)
    }))

  test("MO-019", ({ page, browserName }) =>
    Effect.gen(function*() {
      const ignoreDelta = ignoreDeltaOn(browserName)
      yield* page.setContent(`
    <body>
      <svg class="scroll-box"></svg>
    </body>
    <style>
      .scroll-box {
        position: absolute;
        top: 0px;
        left: 0px;
        background-color: brown;
        width: 200px;
        height: 200px;
      }
    </style>`)
      yield* listenForWheelEvents(page, "svg")
      yield* page.mouse.move({ x: 100, y: 100 })
      yield* page.mouse.wheel({ x: 0, y: 100 })
      yield* Expect.that(
        lastEvent(page),
        Condition.make("a recorded wheel event", (event: WheelRecord | undefined) => Boolean(event))
      )
      yield* expectEvent(page, {
        deltaX: 0,
        deltaY: 100,
        clientX: 100,
        clientY: 100,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      }, ignoreDelta)
    }))

  test("MO-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* page.mouse.wheel({ x: 0, y: 100 })
      yield* Expect.that(scrollY(page), Condition.make("100", (y: number) => y === 100))
    }))

  test("MO-021", ({ page, browserName }) =>
    Effect.gen(function*() {
      const ignoreDelta = ignoreDeltaOn(browserName)
      yield* page.setContent(pageOfDivs)
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* listenForWheelEvents(page, "div")
      // Playwright's `keyboard.down("Shift")` is a held key, which the wheel event carries; it's released when the
      // test's scope closes, as the original leaves it down until the page is closed
      yield* Effect.scoped(Effect.gen(function*() {
        yield* page.keyboard.hold("Shift")
        yield* page.mouse.wheel({ x: 0, y: 100 })
        yield* expectEvent(page, {
          deltaX: 0,
          deltaY: 100,
          clientX: 50,
          clientY: 60,
          deltaMode: 0,
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
          metaKey: false
        }, ignoreDelta)
      }))
    }))

  test("MO-022", ({ page, browserName }) =>
    Effect.gen(function*() {
      const ignoreDelta = ignoreDeltaOn(browserName)
      yield* page.setContent(pageOfDivs)
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* listenForWheelEvents(page, "div")
      yield* page.mouse.wheel({ x: 100, y: 0 })
      yield* expectEvent(page, {
        deltaX: 100,
        deltaY: 0,
        clientX: 50,
        clientY: 60,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      }, ignoreDelta)
      yield* Expect.that(scrollX(page), Condition.make("100", (x: number) => x === 100))
    }))

  test("MO-023", ({ page, browserName }) =>
    Effect.gen(function*() {
      const ignoreDelta = ignoreDeltaOn(browserName)
      yield* page.setContent(pageOfDivs)
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* listenForWheelEvents(page, "div")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.addEventListener("wheel", (event) => event.preventDefault())
      })
      // Give wheel listener a chance to propagate through all the layers in Firefox.
      yield* rafraf(page, 10)
      yield* page.mouse.wheel({ x: 0, y: 100 })
      yield* expectEvent(page, {
        deltaX: 0,
        deltaY: 100,
        clientX: 50,
        clientY: 60,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
      }, ignoreDelta)
      // Give the page a chance to scroll.
      yield* Expect.that(
        lastEvent(page),
        Condition.make("a recorded wheel event", (event: WheelRecord | undefined) => Boolean(event))
      )
      // Ensure that it did not.
      assert.strictEqual(yield* scrollY(page), 0)
    }))
})
