/**
 * Playwright's `tests/library/tap.spec.ts`: tapping an element, the touch and mouse events a tap sends, and waiting
 * for a tapped element to be visible.
 *
 * What the port changes:
 * - `it.use({ hasTouch: true })` is `page.emulate({ touch: true })`, which tells the page it has a touch screen. Strider
 *   applies it through Chromium's touch emulation only (`emulation.touch`), so on Firefox and WebKit the port's first
 *   step fails with Strider's `Unsupported`, and the file runs on every browser to show it. The touch state reaches a
 *   page's next document, so each test moves to a fresh empty page after emulating, as the original's context option
 *   applies it from the first one.
 * - `page.tap(selector)` is `page.locator(selector).tap()`. Strider's tap sends a touch start and end at the action point
 *   with the same checks as a click; it needs no touch emulation of its own.
 * - `trackEvents(handle)` attaches its listeners in the main world and keeps the recorded types in a `window` array the
 *   test reads back, where the original keeps them in a handle. The listeners are the test's, not the page's.
 * - `handle.evaluate(…)` and `page.evaluate(…)` run in the main world, so they are `page.evaluateInMainWorld`.
 * - A promise the page's script resolves later (`altKeyPromise`) is a forked evaluation, joined where the original
 *   awaits it.
 * - TA-002's trial and TA-004 are ported as written. Strider's trial dispatches nothing, and Playwright's trial still
 *   sends the pointer's hover events the expected list names, so TA-002 is expected to fail on the list.
 * - TA-005 waits for the route's request, as the original's promise does, and taps while the navigation stays pending.
 * - TA-007 uses `page.touchscreen.tap(x, y)` at page coordinates, which Strider doesn't have, so it isn't ported; see
 *   the ledger.
 * - TA-008's `page.evaluateHandle` creates the button and its visibility changes are main-world evaluations. Its
 *   `div.textContent()` is `readText`.
 */
import { assert } from "@effect/vitest"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `it.use({ hasTouch: true })`: the page is told it has a touch screen, from a fresh document. */
const touchScreen = Effect.fnUntraced(function*(page: Page.Page, emptyPage: string) {
  yield* page.emulate({ touch: true })
  yield* page.goto(emptyPage, { waitUntil: "load" })
})

/** Playwright's `trackEvents`: records the type of each event the element gets, in an array the test reads back. */
const trackEvents = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld((selector) => {
    const events: Array<string> = []
    const target = document.querySelector(selector) as HTMLElement
    for (
      const event of [
        "mousedown",
        "mouseenter",
        "mouseleave",
        "mousemove",
        "mouseout",
        "mouseover",
        "mouseup",
        "click",
        "pointercancel",
        "pointerdown",
        "pointerenter",
        "pointerleave",
        "pointermove",
        "pointerout",
        "pointerover",
        "pointerup",
        "touchstart",
        "touchend",
        "touchmove",
        "touchcancel"
      ]
    ) {
      target.addEventListener(event, () => events.push(event), false)
    }
    ;(window as unknown as { __tapEvents: Array<string> }).__tapEvents = events
  }, selector)

const recordedEvents = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { __tapEvents: Array<string> }).__tapEvents)

const clearEvents = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    ;(window as unknown as { __tapEvents: Array<string> }).__tapEvents.length = 0
  })

upstream(import.meta.filename, {}, (test) => {
  test("TA-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent(`
  <div id="a" style="background: lightblue; width: 50px; height: 50px">a</div>
  <div id="b" style="background: pink; width: 50px; height: 50px">b</div>
`)
      yield* page.locator("#a").tap()
      yield* trackEvents(page, "#b")
      yield* page.locator("#b").tap()
      // webkit doesn't send pointerenter or pointerleave or mouseout
      assert.deepStrictEqual(yield* recordedEvents(page), [
        "pointerover",
        "pointerenter",
        "pointerdown",
        "touchstart",
        "pointerup",
        "pointerout",
        "pointerleave",
        "touchend",
        "mouseover",
        "mouseenter",
        "mousemove",
        "mousedown",
        "mouseup",
        "click"
      ])

      yield* clearEvents(page)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#b")!.addEventListener("pointerdown", (event) => event.preventDefault(), {
          once: true
        })
      })
      yield* page.locator("#b").tap()
      const events = (yield* recordedEvents(page)).filter((event) =>
        ["pointerdown", "pointerup", "mousedown", "mouseup", "click"].includes(event)
      )
      assert.deepStrictEqual(events, ["pointerdown", "pointerup", "click"])
    }))

  test("TA-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent(`
    <div id="a" style="background: lightblue; width: 50px; height: 50px">a</div>
    <div id="b" style="background: pink; width: 50px; height: 50px">b</div>
  `)
      yield* page.locator("#a").tap()
      yield* trackEvents(page, "#b")
      yield* page.locator("#b").tap({ trial: true })
      const expected = ["pointerover", "pointerenter", "pointerout", "pointerleave"]
      assert.deepStrictEqual(yield* recordedEvents(page), expected)
    }))

  test("TA-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent(`<div style="width: 50px; height: 50px; background: red">`)
      yield* page.evaluateInMainWorld(() => {
        // touchstart is not cancelable unless passive is false
        document.addEventListener("touchstart", (t) => t.preventDefault(), { passive: false })
      })
      yield* trackEvents(page, "div")
      yield* page.locator("div").tap()
      assert.deepStrictEqual(yield* recordedEvents(page), [
        "pointerover",
        "pointerenter",
        "pointerdown",
        "touchstart",
        "pointerup",
        "pointerout",
        "pointerleave",
        "touchend"
      ])
    }))

  test("TA-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent(`<div style="width: 50px; height: 50px; background: red">`)
      yield* page.evaluateInMainWorld(() => {
        document.addEventListener("touchend", (t) => t.preventDefault())
      })
      yield* trackEvents(page, "div")
      yield* page.locator("div").tap()
      assert.deepStrictEqual(yield* recordedEvents(page), [
        "pointerover",
        "pointerenter",
        "pointerdown",
        "touchstart",
        "pointerup",
        "pointerout",
        "pointerleave",
        "touchend"
      ])
    }))

  test("TA-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href="/intercept-this.html">link</a>;`)
      // The route never answers, so the navigation the tap starts stays pending; the tap must still return
      server.setRoute("/intercept-this.html", () => {})
      const requested = yield* server.waitForRequest("/intercept-this.html")
      yield* Effect.all([requested, page.locator("a").tap()], { concurrency: "unbounded" })
    }))

  test("TA-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent("hello world")
      const altKey = yield* Effect.forkChild(
        page.evaluateInMainWorld(() =>
          new Promise<boolean>((resolve) => {
            document.addEventListener("touchstart", (event) => resolve(event.altKey), { passive: false })
          })
        ),
        { startImmediately: true }
      )
      // make sure the evals hit the page
      yield* page.evaluateInMainWorld(() => undefined)
      yield* page.locator("body").tap({ modifiers: ["Alt"] })
      assert.isTrue(yield* Fiber.join(altKey))
    }))

  test("TA-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent("<style>html, body { margin: 0; height: 100% }</style>")
      const touchesOf = (type: string) =>
        page.evaluateInMainWorld((type) =>
          new Promise<Array<Record<string, number>>>((resolve) => {
            document.addEventListener(type, (event) => {
              resolve(
                [...(event as TouchEvent).touches].map((t) => {
                  const touch = t as unknown as Record<string, number>
                  return {
                    identifier: t.identifier,
                    clientX: t.clientX,
                    clientY: t.clientY,
                    pageX: t.pageX,
                    pageY: t.pageY,
                    radiusX: "radiusX" in t ? touch["radiusX"]! : touch["webkitRadiusX"]!,
                    radiusY: "radiusY" in t ? touch["radiusY"]! : touch["webkitRadiusY"]!,
                    rotationAngle: "rotationAngle" in t ? touch["rotationAngle"]! : touch["webkitRotationAngle"]!,
                    force: "force" in t ? touch["force"]! : touch["webkitForce"]!
                  }
                })
              )
            }, false)
          }), type)
      const touchstart = yield* Effect.forkChild(touchesOf("touchstart"), { startImmediately: true })
      const touchend = yield* Effect.forkChild(touchesOf("touchend"), { startImmediately: true })
      // make sure the evals hit the page
      yield* page.evaluateInMainWorld(() => undefined)
      yield* page.locator("body").tap({ position: { x: 40, y: 60 } })
      assert.deepStrictEqual(yield* Fiber.join(touchstart), [{
        clientX: 40,
        clientY: 60,
        force: 1,
        identifier: 0,
        pageX: 40,
        pageY: 60,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0
      }])
      assert.deepStrictEqual(yield* Fiber.join(touchend), [])
    }))

  test("TA-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.evaluateInMainWorld(() => {
        const button = document.createElement("button")
        button.textContent = "not clicked"
        document.body.appendChild(button)
        button.style.display = "none"
      })
      const tapping = yield* Effect.forkChild(page.locator("button").tap(), { startImmediately: true })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.onclick = () => {
          button.textContent = "clicked"
        }
      })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.display = "block"
      })
      yield* Fiber.join(tapping)
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("TA-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* touchScreen(page, server.EMPTY_PAGE)
      yield* page.setContent(`
      <div id="a" style="background: lightblue; width: 50px; height: 50px">a</div>
      <div id="b" style="background: pink; width: 50px; height: 50px">b</div>
    `)
      yield* page.locator("#a").tap()
      yield* page.locator("#b").tap()
    }))
})
