/**
 * Playwright's `tests/page/page-drag.spec.ts`: drags with the mouse, and HTML drag-and-drop with its events, in the page
 * and in frames.
 *
 * What the port changes:
 * - `page.hover(sel)` is `page.locator(sel).hover()`. `page.mouse.down()` is `page.mouse.hold("left")`, whose handle's
 *   `release` is `page.mouse.up()`; the handle is released when the test's scope closes if the test stops before that.
 * - `page.dragAndDrop(a, b, options)` and `locator.dragTo(target, options)` are `Locator.dragTo` on the source locator,
 *   with `sourcePosition` as `position` and `targetPosition` as `targetPosition`. DD-014 runs the same translation for
 *   both of its variants, since Strider has one drag; the matrix row `method-page-draganddrop` says `has`, through
 *   `Locator.dragTo`.
 * - `dragTo` makes an HTML drag (an element that's `draggable`) with the browser's own drag on Chromium, `html:
 *   "native"`, its default. Firefox and stock WebKit have no drag that can drop, so an HTML drag fails there as
 *   Strider reports it. The mouse-only drags here (`mouse.hold`, `mouse.move`) are not `dragTo`: they send the
 *   pointer's events as the original does.
 * - `page.$eval` and `element.evaluate` run in the page's main world through `page.evaluateInMainWorld`. A frame's
 *   document is its `iframe` element's `contentDocument`, read in the main world, as the original reads the frame's
 *   own `document`.
 * - `trackEvents` installs the original's listeners in the page's main world, on the body, the `html` element, or a
 *   frame's element, and stores what they record under a key the test gives it. The test reads the record back. Strider
 *   has no element handle for an element the page's script keeps, so the element is found by its selector each time.
 * - DD-014 waits for its events with `Expect.that`, as Playwright's `expect.poll` does, since the events may arrive
 *   after the drag returns. DD-015 reads its events once after the drag, as the original does.
 * - DD-012's `page.route` holds the frame's request until the test has released the mouse; the route then aborts it, as
 *   the original's `route.abort()` does. The frame's attach is left running with `startWaiting`, as the original leaves
 *   its promise unawaited.
 * - Playwright's `window.builtins.requestAnimationFrame` is its copy of `requestAnimationFrame`, kept so a page can't
 *   replace it. The page here runs no script of its own, so the port calls `requestAnimationFrame`.
 * - Playwright's `it.fixme` tests run on every browser, since the fixme is what upstream expects to fail: DD-003 (on
 *   non-Chromium browsers), DD-006 and DD-007 (the iframe describe), DD-008 and DD-028 (WebKit on Linux, headed), and
 *   DD-019 (WebKit on Windows). Their expectations are the original's.
 * - The original's `headless`, `isLinux`, and Chromium-version guards are not applied: Strider's runs are headless, and
 *   its Chromium is recent.
 * - DD-016 locator, DD-013 helper, and DD-014's variants are the same translation as the rest; no test here needs a
 *   Strider feature Playwright has and this doesn't.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, Page, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import { attachFrame, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Playwright's `trackEvents(target)`: records each mouse and drag event on the element `selector` finds, in the page, or
 * in the frame element `frame` names. The events are stored in the page under `key`.
 */
const trackEvents = (page: Page.Page, key: string, selector: string, frame?: string) =>
  page.evaluateInMainWorld(
    (key: string, selector: string, frame: string | undefined) => {
      const root = frame === undefined
        ? document
        : (document.querySelector(frame) as HTMLIFrameElement).contentDocument!
      const target = root.querySelector(selector)!
      const events: Array<string> = []
      const globals = window as unknown as { __tracked?: Record<string, Array<string>> }
      globals.__tracked = { ...globals.__tracked, [key]: events }
      for (
        const event of [
          "mousedown",
          "mousemove",
          "mouseup",
          "dragstart",
          "dragend",
          "dragover",
          "dragenter",
          "dragleave",
          "dragexit",
          "drop"
        ]
      ) {
        target.addEventListener(event, (e) => {
          const pe = e as PointerEvent
          // Browsers are all over the place with dragend position.
          if (event === "dragend") events.push("dragend")
          else events.push(`${event} at ${pe.clientX};${pe.clientY}`)
        }, false)
      }
    },
    key,
    selector,
    frame
  )

/** The events `trackEvents` recorded under `key`. */
const tracked = (page: Page.Page, key: string) =>
  page.evaluateInMainWorld(
    (key: string) => (window as unknown as { __tracked: Record<string, Array<string>> }).__tracked[key],
    key
  )

/**
 * Whether `#target` contains `#source` in the page, or in the frame element `frame` names: the original's
 * `target.contains(document.querySelector('#source'))`, evaluated in the document it names.
 */
const sourceInTarget = (page: Page.Page, frame?: string) =>
  page.evaluateInMainWorld((frame: string | undefined) => {
    const root = frame === undefined
      ? document
      : (document.querySelector(frame) as HTMLIFrameElement).contentDocument!
    return root.querySelector("#target")!.contains(root.querySelector("#source"))
  }, frame)

/** Makes an iframe's size and position, as the original's `page.$eval("iframe", …)` does. */
const placeFrame = (page: Page.Page, style: { width: string; height: string; marginLeft: string; marginTop: string }) =>
  page.evaluateInMainWorld((style) => {
    const iframe = document.querySelector("iframe")!
    iframe.style.width = style.width
    iframe.style.height = style.height
    iframe.style.marginLeft = style.marginLeft
    iframe.style.marginTop = style.marginTop
  }, style)

/** Playwright's `expect.poll`'s equality of two JSON values, for `Expect.that`'s condition. */
const equalTo = <A>(description: string, expected: A) =>
  Condition.make<A>(
    `${description} ${JSON.stringify(expected)}`,
    (value) => JSON.stringify(value) === JSON.stringify(expected)
  )

/** `page.dragAndDrop(source, target)`: a drag from one locator to another, with Strider's `dragTo`. */
const dragAndDrop = (page: Page.Page, source: string, target: string) =>
  page.locator(source).dragTo(page.locator(target))

/** A mouse event as DD-014 and DD-015 record it: its type and its page or offset position. */
interface MouseRecord {
  readonly type: string
  readonly x: number
  readonly y: number
}

/** DD-014's body, which both of its variants run: a drag with tweened mouse movement, with its events polled. */
const drag14 = Effect.fnUntraced(function*(page: Page.Page) {
  yield* page.setContent(`
        <body style="margin: 0; padding: 0;">
          <div style="width:100px;height:100px;background:red;" id="red"></div>
          <div style="width:300px;height:100px;background:blue;" id="blue"></div>
        </body>
      `)
  yield* page.evaluateInMainWorld(() => {
    const events: Array<{ type: string; x: number; y: number }> = []
    ;(window as unknown as { __events: typeof events }).__events = events
    for (const type of ["mousedown", "mouseup", "mousemove"] as const) {
      document.addEventListener(type, (event: MouseEvent) => {
        events.push({ type, x: event.pageX, y: event.pageY })
      })
    }
  })
  yield* page.locator("#red").dragTo(page.locator("#blue"), { steps: 4 })
  yield* Expect.that(
    page.evaluateInMainWorld(() => (window as unknown as { __events: Array<MouseRecord> }).__events),
    equalTo<ReadonlyArray<MouseRecord>>("the events", [
      { type: "mousemove", x: 50, y: 50 },
      { type: "mousedown", x: 50, y: 50 },
      { type: "mousemove", x: 75, y: 75 },
      { type: "mousemove", x: 100, y: 100 },
      { type: "mousemove", x: 125, y: 125 },
      { type: "mousemove", x: 150, y: 150 },
      { type: "mouseup", x: 150, y: 150 }
    ])
  )
})

upstream(import.meta.filename, {}, (test) => {
  test("DD-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* button.release
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page))
    }))

  test("DD-002", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* trackEvents(page, "body", "body")
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* button.release
      assert.deepStrictEqual(yield* tracked(page, "body"), [
        "mousemove at 120;86",
        "mousedown at 120;86",
        browserName === "firefox" ? "dragstart at 120;86" : "mousemove at 240;350",
        browserName === "firefox" ? "mousemove at 240;350" : "dragstart at 120;86",
        "dragenter at 240;350",
        "dragover at 240;350",
        "drop at 240;350",
        "dragend"
      ])
    }))

  test("DD-003", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* trackEvents(page, "body", "body")
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      // No release: the events so far, with the button still down
      assert.deepStrictEqual(yield* tracked(page, "body"), [
        "mousemove at 120;86",
        "mousedown at 120;86",
        browserName === "firefox" ? "dragstart at 120;86" : "mousemove at 240;350",
        browserName === "firefox" ? "mousemove at 240;350" : "dragstart at 120;86",
        "dragenter at 240;350"
      ])
      yield* button.release
    }))

  test("DD-004", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "myframe", server.PREFIX + "/drag-n-drop.html")
      yield* placeFrame(page, { width: "500px", height: "600px", marginLeft: "80px", marginTop: "60px" })
      yield* trackEvents(page, "page", "body")
      yield* trackEvents(page, "frame", "body", "#myframe")
      yield* frame.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* frame.locator("#target").hover()
      yield* button.release
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page, "#myframe"))
      assert.deepStrictEqual(yield* tracked(page, "frame"), [
        "mousemove at 120;86",
        "mousedown at 120;86",
        browserName === "firefox" ? "dragstart at 120;86" : "mousemove at 240;350",
        browserName === "firefox" ? "mousemove at 240;350" : "dragstart at 120;86",
        "dragenter at 240;350",
        "dragover at 240;350",
        "drop at 240;350",
        "dragend"
      ])
      assert.deepStrictEqual(yield* tracked(page, "page"), [])
    }))

  test("DD-005", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* trackEvents(page, "body", "body")
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* page.keyboard.press("Escape")
      yield* button.release
      // found source in target
      assert.isFalse(yield* sourceInTarget(page))
      assert.deepStrictEqual(
        yield* tracked(page, "body"),
        [
          "mousemove at 120;86",
          "mousedown at 120;86",
          browserName === "firefox" ? "dragstart at 120;86" : "mousemove at 240;350",
          browserName === "firefox" ? "mousemove at 240;350" : "dragstart at 120;86",
          "dragenter at 240;350",
          browserName === "chromium" ? undefined : "dragover at 240;350",
          "dragend",
          "mouseup at 240;350"
        ].filter((event): event is string => event !== undefined)
      )
    }))

  test("DD-006", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      const frame = yield* attachFrame(page, "oopif", server.PREFIX + "/drag-n-drop.html")
      yield* placeFrame(page, { width: "500px", height: "600px", marginLeft: "500px", marginTop: "60px" })
      yield* trackEvents(page, "page", "body")
      yield* trackEvents(page, "frame", "body", "#oopif")
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* frame.locator("#target").hover()
      yield* button.release
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page, "#oopif"))
      assert.deepStrictEqual(yield* tracked(page, "page"), [
        "mousemove",
        "mousedown",
        browserName === "firefox" ? "dragstart" : "mousemove",
        browserName === "firefox" ? "mousemove" : "dragstart"
      ])
      assert.deepStrictEqual(yield* tracked(page, "frame"), ["dragenter", "dragover", "drop"])
    }))

  test("DD-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      const frame = yield* attachFrame(page, "oopif", server.PREFIX + "/drag-n-drop.html")
      yield* trackEvents(page, "page", "body")
      yield* trackEvents(page, "frame", "body", "#oopif")
      yield* frame.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* button.release
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page))
      assert.deepStrictEqual(yield* tracked(page, "frame"), ["mousemove", "mousedown", "dragstart", "dragend"])
      assert.deepStrictEqual(yield* tracked(page, "page"), ["dragenter", "dragover", "drop"])
    }))

  test("DD-008", ({ page }) =>
    Effect.gen(function*() {
      const testIfDropped = Effect.fnUntraced(function*(effectAllowed: string, dropEffect: string) {
        yield* page.setContent(`
        <div draggable="true">drag target</div>
        <drop-target>this is the drop target</drop-target>
      `)
        yield* page.evaluateInMainWorld(({ effectAllowed, dropEffect }) => {
          const globals = window as unknown as { dropped: boolean }
          globals.dropped = false

          document.querySelector("div")!.addEventListener("dragstart", (event) => {
            event.dataTransfer!.effectAllowed = effectAllowed as DataTransfer["effectAllowed"]
            event.dataTransfer!.setData("text/plain", "drag data")
          })

          const dropTarget = document.querySelector("drop-target") as HTMLElement
          dropTarget.addEventListener("dragover", (event) => {
            event.dataTransfer!.dropEffect = dropEffect as DataTransfer["dropEffect"]
            event.preventDefault()
          })
          dropTarget.addEventListener("drop", () => {
            globals.dropped = true
          })
        }, { effectAllowed, dropEffect })
        yield* page.locator("div").hover()
        const button = yield* page.mouse.hold("left")
        yield* page.locator("drop-target").hover()
        yield* button.release
        return yield* page.evaluateInMainWorld(() => (window as unknown as { dropped: boolean }).dropped)
      })

      assert.isTrue(yield* testIfDropped("copy", "copy"))
      assert.isFalse(yield* testIfDropped("copy", "move"))
      assert.isTrue(yield* testIfDropped("all", "link"))
      assert.isFalse(yield* testIfDropped("all", "none"))

      assert.isTrue(yield* testIfDropped("copyMove", "copy"))
      assert.isTrue(yield* testIfDropped("copyLink", "copy"))
      assert.isFalse(yield* testIfDropped("linkMove", "copy"))

      assert.isFalse(yield* testIfDropped("copyMove", "link"))
      assert.isTrue(yield* testIfDropped("copyLink", "link"))
      assert.isTrue(yield* testIfDropped("linkMove", "link"))

      assert.isTrue(yield* testIfDropped("copyMove", "move"))
      assert.isFalse(yield* testIfDropped("copyLink", "move"))
      assert.isTrue(yield* testIfDropped("linkMove", "move"))

      assert.isTrue(yield* testIfDropped("uninitialized", "copy"))
    }))

  test("DD-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.body.addEventListener("dragstart", (event) => {
          event.preventDefault()
        }, false)
      })
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* button.release
      // Canceled, so the source stays where it was
      assert.isFalse(yield* sourceInTarget(page))
    }))

  test("DD-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.body.addEventListener("dragstart", (event) => {
          event.stopImmediatePropagation()
        }, false)
      })
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* button.release
      assert.isTrue(yield* sourceInTarget(page))
    }))

  test("DD-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      yield* trackEvents(page, "html", "html", "iframe")
      yield* page.mouse.move({ x: 30, y: 30 })
      const button = yield* page.mouse.hold("left")
      yield* page.mouse.move({ x: 60, y: 60 })
      yield* button.release
      assert.deepStrictEqual(yield* tracked(page, "html"), [
        "mousemove at 20;20",
        "mousedown at 20;20",
        "mousemove at 50;50",
        "mouseup at 50;50"
      ])
    }))

  test("DD-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      // The route holds the frame's request until the test answers it, after the drag
      const captured = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      yield* page.route(
        "**/empty.html",
        () =>
          Deferred.succeed(captured, undefined).pipe(
            Effect.andThen(Deferred.await(released)),
            Effect.andThen(Route.abort())
          )
      )
      // Playwright doesn't await the attach, so it runs in the background while the drag happens
      yield* startWaiting(attachFrame(page, "frame", server.EMPTY_PAGE))
      yield* Deferred.await(captured)
      yield* page.locator("#source").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("#target").hover()
      yield* button.release
      yield* Deferred.succeed(released, undefined)
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page))
    }))

  test("DD-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* dragAndDrop(page, "#source", "#target")
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page))
    }))

  test("DD-014", { variant: "dragAndDrop" }, ({ page }) => drag14(page))
  test("DD-014", { variant: "dragTo" }, ({ page }) => drag14(page))

  test("DD-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <div style="width:100px;height:100px;background:red;" id="red">
      </div>
      <div style="width:100px;height:100px;background:blue;" id="blue">
      </div>
    `)
      yield* page.evaluateInMainWorld(() => {
        const events: Array<{ type: string; x: number; y: number }> = []
        ;(window as unknown as { __events: typeof events }).__events = events
        document.getElementById("red")!.addEventListener("mousedown", (event) => {
          events.push({ type: "mousedown", x: event.offsetX, y: event.offsetY })
        })
        document.getElementById("blue")!.addEventListener("mouseup", (event) => {
          events.push({ type: "mouseup", x: event.offsetX, y: event.offsetY })
        })
      })
      yield* page.locator("#red").dragTo(page.locator("#blue"), {
        position: { x: 34, y: 7 },
        targetPosition: { x: 10, y: 20 }
      })
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { __events: Array<MouseRecord> }).__events),
        [
          { type: "mousedown", x: 34, y: 7 },
          { type: "mouseup", x: 10, y: 20 }
        ]
      )
    }))

  test("DD-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/drag-n-drop.html", { waitUntil: "load" })
      yield* page.locator("#source").dragTo(page.locator("#target"))
      // could not find source in target
      assert.isTrue(yield* sourceInTarget(page))
    }))

  test("DD-017", ({ page }) =>
    Effect.gen(function*() {
      yield* trackEvents(page, "html", "html")
      yield* page.mouse.move({ x: 50, y: 50 })
      const button = yield* page.mouse.hold("left")
      yield* page.mouse.move({ x: 100, y: 100 })
      yield* button.release
      assert.deepStrictEqual(yield* tracked(page, "html"), [
        "mousemove at 50;50",
        "mousedown at 50;50",
        "mousemove at 100;100",
        "mouseup at 100;100"
      ])
    }))

  test("DD-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(async () => {
        const div = document.createElement("div")
        document.body.appendChild(div)
        div.style.width = "200px"
        div.style.height = "200px"
        div.style.backgroundColor = "blue"
        const logs: Array<{ type: string; buttons: number }> = []
        ;(window as unknown as { __logs: typeof logs }).__logs = logs
        const onEvent = (event: MouseEvent) => {
          logs.push({ type: event.type, buttons: event.buttons })
        }
        div.addEventListener("mousedown", onEvent)
        div.addEventListener("mousemove", onEvent, { passive: false })
        div.addEventListener("mouseup", onEvent)
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
      yield* page.mouse.move({ x: 20, y: 20 })
      const button = yield* page.mouse.hold("left")
      yield* page.mouse.move({ x: 40, y: 40 })
      yield* button.release
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { __logs: Array<unknown> }).__logs),
        [
          { type: "mousemove", buttons: 0 },
          { type: "mousedown", buttons: 1 },
          { type: "mousemove", buttons: 1 },
          { type: "mouseup", buttons: 0 }
        ]
      )
    }))

  test("DD-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button draggable="true">Draggable</button>`)
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { __result: Promise<unknown> }).__result = new Promise((resolve) => {
          document.addEventListener("dragstart", (event) => {
            event.dataTransfer!.setData("custom-type", "Hello World")
          }, false)

          document.addEventListener("dragenter", (event) => {
            event.preventDefault()
          }, false)
          document.addEventListener("dragover", (event) => {
            event.preventDefault()
          }, false)

          document.addEventListener("drop", (event) => {
            event.preventDefault()
            resolve({
              types: event.dataTransfer!.types,
              data: event.dataTransfer!.getData("custom-type")
            })
          }, false)
        })
      })

      yield* page.locator("[draggable=\"true\"]").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.mouse.move({ x: 100, y: 100 })
      yield* button.release

      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { __result: Promise<unknown> }).__result),
        { types: ["custom-type"], data: "Hello World" }
      )
    }))

  test("DD-020", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button draggable="true">Draggable</button>
    <div id=target>drop here</div>
  `)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#target")!.addEventListener("dragover", () => {
          document.querySelector("button")?.remove()
        }, false)

        document.querySelector("#target")!.addEventListener("drop", () => {
          document.querySelector("#target")!.textContent = "dropped"
        }, false)
      })

      yield* page.locator("button").dragTo(page.locator("div"))
      yield* Expect.toHaveText(page.locator("div"), "drop here")
    }))

  test("DD-028", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <div draggable="true">drag target</div>
      <drop-target>this is the drop target</drop-target>
    `)
      yield* page.evaluateInMainWorld(() => {
        const globals = window as unknown as { dropEffect: string }
        globals.dropEffect = "none"

        document.querySelector("div")!.addEventListener("dragstart", (event) => {
          event.dataTransfer!.effectAllowed = "copyMove"
          event.dataTransfer!.setData("text/plain", "drag data")
        })
        document.querySelector("div")!.addEventListener("dragend", (event) => {
          globals.dropEffect = event.dataTransfer!.dropEffect
        })

        // The target accepts the drag without setting dropEffect.
        document.querySelector("drop-target")!.addEventListener("dragover", (event) => {
          event.preventDefault()
        })
      })
      yield* page.locator("div").hover()
      const button = yield* page.mouse.hold("left")
      yield* page.locator("drop-target").hover()
      yield* button.release
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { dropEffect: string }).dropEffect),
        "move"
      )
    }))
})
