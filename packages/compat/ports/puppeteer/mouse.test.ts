/**
 * Puppeteer's `test/src/mouse.test.ts`: pointer input at coordinates, the events the page sees of it, hover, and the wheel.
 *
 * What the port changes:
 * - `page.mouse.click(x, y)` is `page.mouse.click({ x, y })`, and `page.mouse.move(x, y, { steps })` is `move` with a point.
 *   `page.mouse.down()` and `page.mouse.up()` are a held button: `page.mouse.hold(button)`, whose `release` is `up`, in a
 *   scope, so a button the test leaves down is released when its scope closes.
 * - `page.mouse.wheel({ deltaY })` is `page.mouse.wheel({ x, y })`, with `x: 0`.
 * - `page.evaluate` runs in the page's main world, where `window` and the page's listeners are, so it is
 *   `page.evaluateInMainWorld`. The page globals the original reads (`clickPromise`, `result`, `clicks`) are set and read in
 *   the main world, as the original's are.
 * - `page.hover(sel)`, `page.click(sel)`, and `page.focus(sel)` are the same actions on `page.locator(sel)`, and
 *   `page.$('div')` is `page.locator("div").first`. `page.keyboard.down` and `up` are `page.keyboard.hold`, and
 *   `page.keyboard.type` is `page.keyboard.pressSequentially`.
 * - `page.goto(url)` returns at commit in Strider, so each navigation waits for `load`, which Puppeteer's default also
 *   does.
 * - "should select the text with mouse" waits on a handle whose textarea has the typed value (`filterHandle`, then
 *   `waitHandle`). The port waits with `Expect.toHaveValue` on the same textarea, which is the same wait.
 * - "should evaluate before mouse event" uses Puppeteer's `clickablePoint`, which Strider doesn't have. The port clicks the
 *   center of the button's bounding box, which is the point `clickablePoint` gives for an element nothing covers or
 *   transforms, and the page is that. `waitForSelector('button')` is `Expect.toBeAttached`, since the original waits for
 *   the element without visibility.
 * - The original's promises that outlive a step (`page.evaluate(() => new Promise(...))` awaited after an action) start
 *   with `startWaiting`, and each join is bounded by `waiting`, so a failure names what it waited for.
 * - "should work with mobile viewports and cross process navigations" sets the viewport with `page.emulate`, whose
 *   `mobile` flag is what Puppeteer's `setViewport({ isMobile })` sets. Firefox and stock WebKit can't emulate a mobile
 *   viewport, so the ledger marks it there.
 * - "should not throw if buttons are pressed twice" holds the left button twice in one scope. Strider's scope releases both
 *   holds when the test ends, where the original leaves the buttons down.
 * - "should not throw if clicking in parallel" starts both clicks with `Effect.all` at unbounded concurrency, as
 *   `Promise.all` starts them together. Strider sends input to one page in order, one gesture at a time.
 * - The `toMatchObject` assertions on the event lists are `deepStrictEqual` on the same fields: each recorded event has
 *   exactly the seven fields the expectation names.
 * - "should reset properly" has no `mouse.reset()` in Strider: the three holds are in one scope, and closing it releases the
 *   buttons, last pressed first, which is the order the original expects. The pointer stays where it is. The original's
 *   Chrome and other-browser branches are both kept, chosen by browser name.
 */
import { assert } from "@effect/vitest"
import { Expect, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { startWaiting } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

interface ClickData {
  readonly type: string
  readonly detail: number
  readonly clientX: number
  readonly clientY: number
  readonly isTrusted: boolean
  readonly button: number
  readonly buttons: number
}

/** The textarea's position and size in the page, as Puppeteer's `dimensions` reads it. */
function dimensions() {
  const rect = document.querySelector("textarea")!.getBoundingClientRect()
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  }
}

/** Waits for what a step started, bounded, so a failure says what it waited for. */
const waiting = <A, E, R>(what: string, wait: Effect.Effect<A, E, R>, duration: Duration.Input = "10 seconds") =>
  wait.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.die(new Error(`timed out waiting for ${what}`)) }))

/**
 * Puppeteer's `addMouseDataListeners`: records each mouse event on the document in `window.clicks`, with the move events
 * too when `includeMove` is set.
 */
const addMouseDataListeners = (page: Page.Page, options: { readonly includeMove?: boolean } = {}) =>
  page.evaluateInMainWorld(({ includeMove }) => {
    const clicks: Array<ClickData> = []
    const mouseEventListener = (event: MouseEvent) => {
      clicks.push({
        type: event.type,
        detail: event.detail,
        clientX: event.clientX,
        clientY: event.clientY,
        isTrusted: event.isTrusted,
        button: event.button,
        buttons: event.buttons
      })
    }
    document.addEventListener("mousedown", mouseEventListener)
    if (includeMove) {
      document.addEventListener("mousemove", mouseEventListener)
    }
    document.addEventListener("mouseup", mouseEventListener)
    document.addEventListener("click", mouseEventListener)
    document.addEventListener("auxclick", mouseEventListener)
    Reflect.set(window, "clicks", clicks)
  }, options)

/** The events the page recorded in `window.clicks`. */
const recordedClicks = (page: Page.Page) =>
  page.evaluateInMainWorld(() => Reflect.get(window, "clicks") as Array<ClickData>)

/** Modifiers held in "should set modifier keys on click", by the property each sets on the event. */
const modifiersFor = (browserName: "chromium" | "firefox" | "webkit"): Record<string, string> => {
  const modifiers: Record<string, string> = { Shift: "shiftKey", Control: "ctrlKey", Alt: "altKey", Meta: "metaKey" }
  // In Firefox, the Meta modifier only exists on Mac
  if (browserName === "firefox" && process.platform !== "darwin") delete modifiers["Meta"]
  return modifiers
}

upstream(import.meta.filename, {}, (test) => {
  test("Mouse should click the document", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(
          window,
          "clickPromise",
          new Promise((resolve) => {
            document.addEventListener("click", (event) => {
              resolve({
                type: event.type,
                detail: event.detail,
                clientX: event.clientX,
                clientY: event.clientY,
                isTrusted: event.isTrusted,
                button: event.button
              })
            })
          })
        )
      })
      yield* page.mouse.click({ x: 50, y: 60 })
      const event = yield* page.evaluateInMainWorld(() => Reflect.get(window, "clickPromise"))
      assert.strictEqual(event.type, "click")
      assert.strictEqual(event.detail, 1)
      assert.strictEqual(event.clientX, 50)
      assert.strictEqual(event.clientY, 60)
      assert.isTrue(event.isTrusted)
      assert.strictEqual(event.button, 0)
    }))

  test("Mouse should resize the textarea", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", load)
      const { x, y, width, height } = yield* page.evaluateInMainWorld(dimensions)
      yield* Effect.scoped(Effect.gen(function*() {
        yield* page.mouse.move({ x: x + width - 4, y: y + height - 4 })
        // Puppeteer's `mouse.down()` and `mouse.up()`
        const button = yield* page.mouse.hold("left")
        yield* page.mouse.move({ x: x + width + 100, y: y + height + 100 })
        yield* button.release
      }))
      const newDimensions = yield* page.evaluateInMainWorld(dimensions)
      assert.strictEqual(newDimensions.width, Math.round(width + 104))
      assert.strictEqual(newDimensions.height, Math.round(height + 104))
    }))

  test("Mouse should select the text with mouse", ({ page, server }) =>
    Effect.gen(function*() {
      const text = "This is the text that we are going to try to select. Let's see how it goes."
      yield* page.goto(`${server.PREFIX}/input/textarea.html`, load)
      yield* page.locator("textarea").focus()
      yield* page.keyboard.pressSequentially(text)
      // The original waits for a handle to a textarea whose value is the text, which is this wait
      yield* Expect.toHaveValue(page.locator("textarea"), text)
      const { x, y } = yield* page.evaluateInMainWorld(dimensions)
      yield* Effect.scoped(Effect.gen(function*() {
        yield* page.mouse.move({ x: x + 2, y: y + 2 })
        const button = yield* page.mouse.hold("left")
        yield* page.mouse.move({ x: 100, y: 100 })
        yield* button.release
      }))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => {
          const textarea = document.querySelector("textarea")!
          return textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
        }),
        text
      )
    }))

  test("Mouse should trigger hover state", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", load)
      const hoveredId = () => page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id)
      yield* page.locator("#button-6").hover()
      assert.strictEqual(yield* hoveredId(), "button-6")
      yield* page.locator("#button-2").hover()
      assert.strictEqual(yield* hoveredId(), "button-2")
      yield* page.locator("#button-91").hover()
      assert.strictEqual(yield* hoveredId(), "button-91")
    }))

  test("Mouse should trigger hover state with removed window.Node", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", load)
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "Node")
      })
      yield* page.locator("#button-6").hover()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id),
        "button-6"
      )
    }))

  test("Mouse should set modifier keys on click", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", load)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#button-3")!.addEventListener("mousedown", (event) => {
          Reflect.set(window, "lastEvent", event)
        }, true)
      })
      const modifiers = modifiersFor(browserName)
      for (const [modifier, property] of Object.entries(modifiers)) {
        yield* Effect.scoped(Effect.gen(function*() {
          // Puppeteer's `keyboard.down(modifier)`
          yield* page.keyboard.hold(modifier)
          yield* page.locator("#button-3").click()
          assert.isTrue(
            yield* page.evaluateInMainWorld(
              (name: string) => Reflect.get(Reflect.get(window, "lastEvent"), name),
              property
            ),
            `${property} should be true`
          )
        }))
      }
      yield* page.locator("#button-3").click()
      for (const property of Object.values(modifiers)) {
        assert.isFalse(
          yield* page.evaluateInMainWorld(
            (name: string) => Reflect.get(Reflect.get(window, "lastEvent"), name),
            property
          ),
          `${property} should be false`
        )
      }
    }))

  test("Mouse should send mouse wheel events", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/wheel.html", load)
      const elem = page.locator("div").first
      const boundingBoxBefore = Option.getOrThrow(yield* elem.boundingBox)
      assert.strictEqual(boundingBoxBefore.width, 115)
      assert.strictEqual(boundingBoxBefore.height, 115)

      yield* page.mouse.move({
        x: boundingBoxBefore.x + boundingBoxBefore.width / 2,
        y: boundingBoxBefore.y + boundingBoxBefore.height / 2
      })

      yield* page.mouse.wheel({ x: 0, y: -100 })
      const boundingBoxAfter = Option.getOrThrow(yield* elem.boundingBox)
      assert.strictEqual(boundingBoxAfter.width, 230)
      assert.strictEqual(boundingBoxAfter.height, 230)
    }))

  test("Mouse should set ctrlKey on the wheel event", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      const ctrlKey = yield* startWaiting(
        page.evaluateInMainWorld(() =>
          new Promise<boolean>((resolve) => {
            window.addEventListener("wheel", (event) => resolve(event.ctrlKey), { once: true })
          })
        )
      )
      yield* Effect.scoped(Effect.gen(function*() {
        // Puppeteer's `keyboard.down("Control")`, released when the scope closes (its `keyboard.up`)
        yield* page.keyboard.hold("Control")
        yield* page.mouse.wheel({ x: 0, y: -100 })
        // Scroll back to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1901211.
        if (browserName === "firefox") {
          yield* page.mouse.wheel({ x: 0, y: 100 })
        }
      }))
      assert.isTrue(yield* waiting("the wheel event's ctrlKey", Fiber.join(ctrlKey.fiber)))
    }))

  test("Mouse should tween mouse movement", ({ page }) =>
    Effect.gen(function*() {
      yield* page.mouse.move({ x: 100, y: 100 })
      yield* page.evaluateInMainWorld(() => {
        const result: Array<[number, number]> = []
        Reflect.set(window, "result", result)
        document.addEventListener("mousemove", (event) => {
          result.push([event.clientX, event.clientY])
        })
      })
      yield* page.mouse.move({ x: 200, y: 300 }, { steps: 5 })
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "result") as Array<[number, number]>),
        [
          [120, 140],
          [140, 180],
          [160, 220],
          [180, 260],
          [200, 300]
        ]
      )
    }))

  // @see https://crbug.com/929806
  test("Mouse should work with mobile viewports and cross process navigations", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* page.emulate({ viewport: { width: 360, height: 640, mobile: true } })
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/mobile.html", load)
      yield* page.evaluateInMainWorld(() => {
        document.addEventListener("click", (event) => {
          Reflect.set(window, "result", { x: event.clientX, y: event.clientY })
        })
      })

      yield* page.mouse.click({ x: 30, y: 40 })

      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), { x: 30, y: 40 })
    }))

  // Puppeteer's CdpMouse throws on a second down() and BidiMouse doesn't. The original expects CDP to fail, and the port
  // runs the same two presses.
  test("Mouse should not throw if buttons are pressed twice", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* Effect.scoped(Effect.gen(function*() {
        // Puppeteer's `mouse.down()` twice, each a held left button
        yield* page.mouse.hold("left")
        yield* page.mouse.hold("left")
      }))
    }))

  test("Mouse should not throw if clicking in parallel", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* addMouseDataListeners(page)

      yield* Effect.all([page.mouse.click({ x: 0, y: 5 }), page.mouse.click({ x: 6, y: 10 })], {
        concurrency: "unbounded"
      })

      const data = yield* recordedClicks(page)
      const commonAttrs = {
        isTrusted: true,
        detail: 1,
        clientY: 5,
        clientX: 0,
        button: 0
      }
      assert.deepStrictEqual(data.splice(0, 3), [
        { type: "mousedown", buttons: 1, ...commonAttrs },
        { type: "mouseup", buttons: 0, ...commonAttrs },
        { type: "click", buttons: 0, ...commonAttrs }
      ])
      const second = { ...commonAttrs, clientX: 6, clientY: 10 }
      assert.deepStrictEqual(data, [
        { type: "mousedown", buttons: 1, ...second },
        { type: "mouseup", buttons: 0, ...second },
        { type: "click", buttons: 0, ...second }
      ])
    }))

  // Puppeteer's `mouse.reset()` releases the pressed buttons and the test checks the events the page sees of it. Strider has
  // no reset: closing the scope of the holds releases them, last pressed first.
  test("Mouse should reset properly", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* page.mouse.move({ x: 5, y: 5 })
      yield* Effect.scoped(Effect.gen(function*() {
        // Puppeteer's three `mouse.down({ button })` calls in a `Promise.all`
        yield* Effect.all([page.mouse.hold("left"), page.mouse.hold("middle"), page.mouse.hold("right")], {
          concurrency: "unbounded"
        })
        yield* addMouseDataListeners(page, { includeMove: true })
        // `mouse.reset()` is the scope closing here
      }))
      const data = yield* recordedClicks(page)
      const commonAttrs = { isTrusted: true, clientY: 5, clientX: 5 }
      assert.deepStrictEqual(data.slice(0, 2), [
        { ...commonAttrs, button: 2, buttons: 5, detail: 1, type: "mouseup" },
        { ...commonAttrs, button: 2, buttons: 5, detail: 1, type: "auxclick" }
      ])
      // TODO(crbug/1485040) in the original: Chrome's second and third events don't align with Firefox's
      if (browserName === "chromium") {
        assert.deepStrictEqual(data.slice(2), [
          { ...commonAttrs, button: 1, buttons: 1, detail: 0, type: "mouseup" },
          { ...commonAttrs, button: 0, buttons: 0, detail: 0, type: "mouseup" }
        ])
        return
      }
      assert.deepStrictEqual(data.slice(2), [
        { ...commonAttrs, button: 1, buttons: 1, detail: 1, type: "mouseup" },
        { ...commonAttrs, button: 1, buttons: 1, detail: 1, type: "auxclick" },
        { ...commonAttrs, button: 0, buttons: 0, detail: 1, type: "mouseup" },
        { ...commonAttrs, button: 0, buttons: 0, detail: 1, type: "click" }
      ])
    }))

  test("Mouse should evaluate before mouse event", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/input/button.html", load)

      // The original waits for the element, not for it to be visible
      yield* Expect.toBeAttached(page.locator("button"))
      // Puppeteer's `clickablePoint()`: the button's center, where nothing covers or transforms it
      const box = Option.getOrThrow(yield* page.locator("button").boundingBox)
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

      const clicked = yield* startWaiting(
        page.evaluateInMainWorld(() =>
          new Promise<void>((resolve) => {
            document.querySelector("button")?.addEventListener("click", () => resolve(), { once: true })
          })
        )
      )
      yield* page.mouse.click(point)
      yield* waiting("the page's click listener on the button", Fiber.join(clicked.fiber))
    }))
})
