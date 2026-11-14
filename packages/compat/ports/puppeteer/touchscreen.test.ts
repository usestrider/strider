/**
 * Puppeteer's `test/src/touchscreen.test.ts`: the touch events and pointer events of taps and of touch moves, which the
 * page records in its own listeners.
 *
 * What the port changes:
 * - Only the tap test is ported. `page.tap('button')` is `page.locator("button").tap()`: a touch start and end at the
 *   button's centre, with the same checks and guard as `click`. The page records the same events the original's does,
 *   and the test asserts the same sequence.
 * - Puppeteer's `page.evaluate` reads `globalThis.waitForEvents`, which the page's own script defines and resolves. It runs
 *   in the page's main world, so the port reads it with `page.evaluateInMainWorld`.
 * - The other tests drive the touchscreen directly: `page.touchscreen.touchStart`, `touchMove`, and `touchEnd`, and the
 *   handles they return. Strider has no touchscreen; `property-page-touchscreen` is missing, so those tests are not ported.
 *   Its only touch input is `Locator.tap`, which sends one tap and can't hold a touch down or move it.
 * - Puppeteer runs the original on Chromium, which emulates no touch device for these: the port needs none either.
 * - Stock WebKit has no touch input (`input.touch`), so the tap test is `needsFeature` there, and the ledger marks it.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

upstream(import.meta.filename, {}, (test) => {
  test("Touchscreen Touchscreen.prototype.tap should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/touchscreen.html", load)

      yield* page.locator("button").tap()

      const events = yield* page.evaluateInMainWorld(async () => {
        return await (globalThis as unknown as { waitForEvents: Promise<unknown> }).waitForEvents
      })
      // The original's `toMatchObject` over these objects: the page records exactly these fields for each event, so the
      // whole objects are compared
      assert.deepStrictEqual(events, [
        {
          type: "pointerdown",
          x: 5,
          y: 5,
          width: 1,
          height: 1,
          altitudeAngle: Math.PI / 2,
          azimuthAngle: 0,
          pressure: 0.5,
          pointerType: "touch",
          twist: 0,
          tiltX: 0,
          tiltY: 0
        },
        {
          type: "touchstart",
          changedTouches: [
            { clientX: 5, clientY: 5, radiusX: 0.5, radiusY: 0.5, force: 0.5 }
          ],
          activeTouches: [
            { clientX: 5, clientY: 5, radiusX: 0.5, radiusY: 0.5, force: 0.5 }
          ]
        },
        {
          type: "pointerup",
          x: 5,
          y: 5,
          width: 1,
          height: 1,
          altitudeAngle: Math.PI / 2,
          azimuthAngle: 0,
          pressure: 0,
          pointerType: "touch",
          twist: 0,
          tiltX: 0,
          tiltY: 0
        },
        {
          type: "touchend",
          changedTouches: [
            { clientX: 5, clientY: 5, radiusX: 0.5, radiusY: 0.5, force: 0.5 }
          ],
          activeTouches: []
        },
        {
          type: "click",
          x: 5,
          y: 5,
          width: 1,
          height: 1,
          altitudeAngle: Math.PI / 2,
          azimuthAngle: 0,
          pressure: 0,
          pointerType: "touch",
          twist: 0,
          tiltX: 0,
          tiltY: 0
        }
      ])
    }))
})
