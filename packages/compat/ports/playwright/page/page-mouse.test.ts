/**
 * Playwright's `tests/page/page-mouse.spec.ts`: pointer input at coordinates, and the mouse events it makes.
 *
 * What the port changes:
 * - `page.mouse.click(x, y)` is `page.mouse.click({ x, y })`, and `page.mouse.move(x, y, { steps })` is `move` with a
 *   point. `page.mouse.dblclick(x, y)` is `click` with `clickCount: 2`, which is what Playwright's `dblclick` sends.
 * - `page.mouse.down(…)` and `page.mouse.up(…)` are a held button: `page.mouse.hold(button)` returns a handle, whose
 *   `release` is `up`. A hold is scoped, so a button the test leaves down is released when its scope closes. MO-005
 *   holds the middle and then the left button and releases the middle first, as the original does.
 * - `page.evaluate` runs in the page's main world, where `window` and the page's listeners are, so it's
 *   `page.evaluateInMainWorld`. The listeners the tests install are the test's own, as in the original, and keep their
 *   events in `window`.
 * - `page.goto(url)` returns at commit in Strider, so each navigation waits for `load`, which is Playwright's default.
 * - `page.hover(sel)`, `page.focus(sel)`, and `page.click(sel)` are the same actions on `page.locator(sel)`, and
 *   `page.keyboard.type` is `page.keyboard.pressSequentially`.
 * - MO-009 hovers a disabled button with Strider's default checks, and fails: Playwright's hover doesn't wait for the
 *   element to be enabled, where Strider's does. Playwright's `timeout: 5000` is a deadline of five seconds on the hover.
 * - MO-011 holds each modifier as a key with `page.keyboard.hold`, so the click carries it, as Playwright's
 *   `keyboard.down` does. Playwright deletes Meta from its list except on macOS, where Firefox has it; the port reads
 *   the host's platform the same way.
 * - MO-016's `expect.poll(log).toEqual(…)` is `Expect.that` on the log, which is checked again until it matches or the
 *   expectation's deadline passes.
 * - The `it.skip(!headless, …)` on MO-008 to MO-010, MO-012, and MO-016 doesn't apply: Strider's launches are headless.
 *   `it.skip(isAndroid, …)` on MO-012 doesn't apply either.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { isDeepStrictEqual } from "node:util"
import { rafraf } from "../../harness/playwright.ts"
import { type Fixtures, upstream } from "../../harness/upstream.ts"

/** The textarea's position and size in the page, as Playwright's `dimensions` reads it. */
function dimensions() {
  const rect = document.querySelector("textarea")!.getBoundingClientRect()
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  }
}

/** A condition that a value is deeply equal to `expected`, for `Expect.that`. */
const equalTo = <A>(expected: A) =>
  Condition.make(`equal to ${JSON.stringify(expected)}`, (value: A) => isDeepStrictEqual(value, expected))

/**
 * The modifiers Playwright holds in MO-011. The original deletes Meta outside macOS on Firefox, where Firefox has the
 * modifier only there.
 */
const modifiersFor = (browserName: Fixtures["browserName"]): Record<string, string> => {
  const modifiers: Record<string, string> = { Shift: "shiftKey", Control: "ctrlKey", Alt: "altKey", Meta: "metaKey" }
  if (browserName === "firefox" && process.platform !== "darwin") delete modifiers["Meta"]
  return modifiers
}

upstream(import.meta.filename, {}, (test) => {
  test("MO-001", ({ page }) =>
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

  test("MO-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='width: 100px; height: 100px;'>Click me</div>`)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(
          window,
          "dblclickPromise",
          new Promise((resolve) => {
            document.querySelector("div")!.addEventListener("dblclick", (event) => {
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
      // Playwright's `dblclick` is a click with a click count of 2
      yield* page.mouse.click({ x: 50, y: 60 }, { clickCount: 2 })
      const event = yield* page.evaluateInMainWorld(() => Reflect.get(window, "dblclickPromise"))
      assert.strictEqual(event.type, "dblclick")
      assert.strictEqual(event.detail, 2)
      assert.strictEqual(event.clientX, 50)
      assert.strictEqual(event.clientY, 60)
      assert.isTrue(event.isTrusted)
      assert.strictEqual(event.button, 0)
    }))

  test("MO-003", ({ page }) =>
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
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* Effect.scoped(Effect.gen(function*() {
        const button = yield* page.mouse.hold("left")
        yield* button.release
      }))
      const event = yield* page.evaluateInMainWorld(() => Reflect.get(window, "clickPromise"))
      assert.strictEqual(event.type, "click")
      assert.strictEqual(event.detail, 1)
      assert.strictEqual(event.clientX, 50)
      assert.strictEqual(event.clientY, 60)
      assert.isTrue(event.isTrusted)
      assert.strictEqual(event.button, 0)
    }))

  test("MO-004", ({ page, browserName }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div style='width: 100px; height: 100px;'>Click me</div>`)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(
          window,
          "pointerdownPromise",
          new Promise((resolve) => {
            document.querySelector("div")!.addEventListener("pointerdown", (event) => {
              resolve({
                type: event.type,
                detail: event.detail,
                clientX: event.clientX,
                clientY: event.clientY,
                isTrusted: event.isTrusted,
                button: event.button,
                buttons: event.buttons,
                pointerId: event.pointerId
              })
            })
          })
        )
      })
      yield* page.mouse.click({ x: 50, y: 60 }, { button: "middle" })
      const event = yield* page.evaluateInMainWorld(() => Reflect.get(window, "pointerdownPromise"))
      assert.strictEqual(event.type, "pointerdown")
      assert.strictEqual(event.detail, browserName === "webkit" ? 1 : 0)
      assert.strictEqual(event.clientX, 50)
      assert.strictEqual(event.clientY, 60)
      assert.isTrue(event.isTrusted)
      assert.strictEqual(event.button, 1)
      assert.strictEqual(event.buttons, 4)
      assert.strictEqual(event.pointerId, browserName === "firefox" ? 0 : 1)
    }))

  test("MO-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const events: Array<{ type: string; button: number; buttons: number }> = []
        Reflect.set(window, "__EVENTS", events)
        const handler = (event: MouseEvent) => {
          events.push({ type: event.type, button: event.button, buttons: event.buttons })
        }
        window.addEventListener("mousedown", handler, false)
        window.addEventListener("mouseup", handler, false)
      })
      yield* page.mouse.move({ x: 50, y: 60 })
      // Holds stack: the left button is held while the middle one is, and the middle one is released first
      yield* Effect.scoped(Effect.gen(function*() {
        const middle = yield* page.mouse.hold("middle")
        const left = yield* page.mouse.hold("left")
        yield* middle.release
        yield* left.release
      }))
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__EVENTS")), [
        { type: "mousedown", button: 1, buttons: 4 },
        { type: "mousedown", button: 0, buttons: 5 },
        { type: "mouseup", button: 1, buttons: 1 },
        { type: "mouseup", button: 0, buttons: 0 }
      ])
    }))

  test("MO-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.mouse.move({ x: 50, y: 60 })
      yield* page.evaluateInMainWorld(() => {
        const events: Array<{ type: string; pointerType: string }> = []
        Reflect.set(window, "__EVENTS", events)
        const handler = (event: PointerEvent) => {
          events.push({ type: event.type, pointerType: event.pointerType })
        }
        window.addEventListener("pointerdown", handler, false)
        window.addEventListener("pointermove", handler, false)
        window.addEventListener("pointerup", handler, false)
      })
      yield* page.mouse.move({ x: 60, y: 50 })
      yield* Effect.scoped(Effect.gen(function*() {
        const button = yield* page.mouse.hold("left")
        yield* button.release
      }))
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "__EVENTS")), [
        { type: "pointermove", pointerType: "mouse" },
        { type: "pointerdown", pointerType: "mouse" },
        { type: "pointerup", pointerType: "mouse" }
      ])
    }))

  test("MO-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      const text = "This is the text that we are going to try to select. Let's see how it goes."
      yield* page.keyboard.pressSequentially(text)
      // Firefox needs an extra frame here after typing or it will fail to set the scrollTop
      yield* rafraf(page)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("textarea")!.scrollTop = 0
      })
      const { x, y } = yield* page.evaluateInMainWorld(dimensions)
      yield* page.mouse.move({ x: x + 2, y: y + 2 })
      yield* Effect.scoped(Effect.gen(function*() {
        const button = yield* page.mouse.hold("left")
        yield* page.mouse.move({ x: 200, y: 200 })
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

  test("MO-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      const hoveredId = () => page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id)
      yield* page.locator("#button-6").hover()
      assert.strictEqual(yield* hoveredId(), "button-6")
      yield* page.locator("#button-2").hover()
      assert.strictEqual(yield* hoveredId(), "button-2")
      yield* page.locator("#button-91").hover()
      assert.strictEqual(yield* hoveredId(), "button-91")
    }))

  test("MO-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("#button-6") as HTMLButtonElement).disabled = true
      })
      // Playwright's hover doesn't wait for the element to be enabled; Strider's does, so with the default checks this
      // times out. The port keeps the default: turning the check off would make it pass without Strider's hover working
      yield* page.locator("#button-6").hover().pipe(Deadline.within("5 seconds"))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id),
        "button-6"
      )
    }))

  test("MO-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "Node")
      })
      yield* page.locator("#button-6").hover()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id),
        "button-6"
      )
    }))

  test("MO-011", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#button-3")!.addEventListener("mousedown", (event) => {
          Reflect.set(window, "lastEvent", event)
        }, true)
      })
      const modifiers = modifiersFor(browserName)
      for (const [modifier, property] of Object.entries(modifiers)) {
        yield* Effect.scoped(Effect.gen(function*() {
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

  test("MO-012", ({ page, browserName }) =>
    Effect.gen(function*() {
      // The test becomes flaky on WebKit without this frame
      if (browserName === "webkit") {
        yield* page.evaluateInMainWorld(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
      }
      yield* page.mouse.move({ x: 100, y: 100 })
      yield* page.evaluateInMainWorld(() => {
        const result: Array<[number, number, number, number]> = []
        Reflect.set(window, "result", result)
        document.addEventListener("mousemove", (event) => {
          result.push([event.clientX, event.clientY, event.movementX, event.movementY])
        })
      })
      yield* page.mouse.move({ x: 200, y: 300 }, { steps: 5 })
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), [
        [120, 140, 20, 40],
        [140, 180, 20, 40],
        [160, 220, 20, 40],
        [180, 260, 20, 40],
        [200, 300, 20, 40]
      ])
    }))

  test("MO-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        document.addEventListener("mousedown", (event) => {
          Reflect.set(window, "result", [event.clientX, event.clientY])
        })
      })
      yield* page.mouse.click({ x: 50.1, y: 50.9 })
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), [50, 50])
    }))

  test("MO-014", ({ page }) =>
    Effect.gen(function*() {
      // Do not show contextmenu on right click since it is poorly supported.
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener("contextmenu", (event) => event.preventDefault(), false)
      })
      // The original holds each button down without releasing it, so the holds stay in one scope and are released
      // together when it closes
      yield* Effect.scoped(Effect.gen(function*() {
        for (const button of ["left", "middle", "right"] as const) {
          yield* page.mouse.move({ x: 50, y: 50 })
          yield* page.mouse.hold(button)
          yield* page.mouse.move({ x: 100, y: 100 })
        }
      }))
    }))

  test("MO-015", ({ page }) =>
    Effect.gen(function*() {
      // The original waits for the contextmenu event's value; the port resolves with nothing, as the event isn't
      // serializable, and only its arrival matters to the test
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(
          window,
          "contextMenuPromise",
          new Promise<void>((resolve) => {
            window.addEventListener("contextmenu", () => resolve(), false)
          })
        )
      })
      const CX = 100
      const CY = 100
      yield* page.mouse.move({ x: CX, y: CY })
      yield* Effect.scoped(Effect.gen(function*() {
        yield* page.mouse.hold("right")
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "contextMenuPromise"))
        const N = 20
        for (const radius of [10, 30, 60, 90]) {
          for (let i = 0; i < N; ++i) {
            const angle = 2 * Math.PI * i / N
            const x = CX + Math.round(radius * Math.cos(angle))
            const y = CY + Math.round(radius * Math.sin(angle))
            yield* page.mouse.move({ x, y })
          }
        }
      }))
    }))

  test("MO-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html { margin: 0; padding: 0; }
      #parentBox { position: absolute; left: 10px; top: 10px; width: 100px; height: 100px; }
      iframe { position: absolute; left: 200px; top: 10px; width: 200px; height: 200px; border: none; }
    </style>
    <div id="parentBox"></div>
    <iframe srcdoc="
      <style>body, html { margin: 0; padding: 0; } #childBox { width: 180px; height: 180px; }</style>
      <div id='childBox'></div>
      <script>
        const box = document.querySelector('#childBox');
        box.addEventListener('mouseenter', () => window.top.__log.push('child:enter'));
        box.addEventListener('mouseleave', () => window.top.__log.push('child:leave'));
      </script>
    "></iframe>
    <script>
      window.__log = [];
      const box = document.querySelector('#parentBox');
      box.addEventListener('mouseenter', () => window.__log.push('parent:enter'));
      box.addEventListener('mouseleave', () => window.__log.push('parent:leave'));
    </script>
  `)
      yield* Expect.toBeAttached(page.locator("iframe"))
      yield* Expect.toBeAttached(page.frame(page.locator("iframe")).locator("#childBox"))
      const readLog = page.evaluateInMainWorld(() => Reflect.get(window, "__log") as Array<string>)
      const parentBox = Option.getOrThrow(yield* page.locator("#parentBox").boundingBox)
      const iframeBox = Option.getOrThrow(yield* page.locator("iframe").boundingBox)
      const parentCenter = { x: parentBox.x + parentBox.width / 2, y: parentBox.y + parentBox.height / 2 }
      const childCenter = { x: iframeBox.x + 90, y: iframeBox.y + 90 }

      yield* page.mouse.move(parentCenter)
      yield* Expect.that(readLog, equalTo(["parent:enter"]))

      // Crossing into the iframe leaves the parent element and enters the child.
      yield* page.mouse.move(childCenter)
      yield* Expect.that(readLog, equalTo(["parent:enter", "parent:leave", "child:enter"]))

      // Crossing back out leaves the child element and re-enters the parent.
      yield* page.mouse.move(parentCenter)
      yield* Expect.that(
        readLog,
        equalTo(["parent:enter", "parent:leave", "child:enter", "child:leave", "parent:enter"])
      )
    }))
})
