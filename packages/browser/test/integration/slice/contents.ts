/**
 * The sixth slice: a page's contents, through the public API on every backend's layer. Evaluation and
 * handles, frames, snapshots and `toMatchAria` (call site 16), captures, and storage with call site 1 to the end,
 * and `Unsupported` wherever a backend can't do something.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  AriaPattern,
  Browser,
  CookieJar,
  Deadline,
  Expect,
  JSHandle,
  Locator,
  Page,
  Pixels,
  Snapshot,
  StorageState,
  Url
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Tracer from "effect/Tracer"
import * as zlib from "node:zlib"
import { vi } from "vitest"
import { LocatorImpl } from "../../../src/internal/locator.ts"
import * as Runtime from "../../../src/internal/runtime.ts"
import * as Protocol from "../../../src/protocol/Protocol.ts"
import { pngRegion } from "../../pngRegion.ts"
import { site } from "../adapter/harness.ts"
import { fullySupports, supports } from "./capabilities.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** A page's failure reason, or a defect: what an expected failure gave. */
const reasonOf = <A, E>(exit: Exit.Exit<A, E>) => {
  assert.isTrue(Exit.isFailure(exit), "expected a failure")
  const error = Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined
  return error as { readonly _tag: string; readonly reason?: { readonly _tag: string } } | undefined
}

/** A documented frame-mapping refusal is distinct from an element without a rect. */
const frameRectRefused = Effect.fnUntraced(function*(read: Effect.Effect<unknown, unknown, Scope.Scope>) {
  if (yield* fullySupports("boundingBox.frameTransforms")) return false
  const error = yield* Effect.scoped(Effect.flip(read))
  assert.deepInclude((error as { readonly reason: unknown }).reason, {
    _tag: "Unsupported",
    capability: "Locator.boundingBox"
  })
  assert.include((error as { readonly reason: { readonly hint: string } }).reason.hint, "frame")
  return true
})

/** A frame's document: a counter button, a text input and what was typed. */
const counter = (label: string) =>
  `<body style="margin:0"><h1>${label}</h1><button style="margin:20px" onclick="document.getElementById('count').textContent = String(Number(document.getElementById('count').textContent) + 1)">Add</button><span id="count">0</span><input aria-label="Name"></body>`

/** A clip in CSS pixels. */
const cssRect = (rect: { x: number; y: number; width: number; height: number }) => ({
  x: Pixels.Css.make(rect.x),
  y: Pixels.Css.make(rect.y),
  width: Pixels.Css.make(rect.width),
  height: Pixels.Css.make(rect.height)
})

/** A PNG's size, from its header. */
const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** The alpha of a PNG's first pixel: 255 without an alpha channel. Row 0's first pixel is its raw bytes, whatever the filter. */
const firstAlpha = (png: Uint8Array): number => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const colorType = png[25]
  if (colorType !== 6) return 255
  const chunks: Array<Uint8Array> = []
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at)
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8))
    if (type === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  return raw[4]!
}

/** A small page for snapshots: landmarks, controls, an inferred control, hidden content, a list and text. */
const shop =
  `<title>Shop</title><h1>Shop</h1><nav aria-label="Main"><a href="#orders">Orders</a></nav><a id="gone" href="#gone">Gone</a>
<button onclick="log('save')">Save</button>
<div id="add" style="cursor:pointer;display:inline-block" onclick="log('add')">Add</div>
<input aria-label="Email" placeholder="you@example.com">
<input type="checkbox" checked aria-label="Agree">
<ul><li>One</li><li>Two</li></ul>
<div aria-hidden="true"><button>Hidden</button></div>
<p>Hello <b>world</b></p>
<pre id="log"></pre><script>function log(word) { const out = document.getElementById('log'); out.textContent = (out.textContent + ' ' + word).trim() }</script>`

/**
 * Where the backend makes no world of its own, a caller's function never moves to the page's: `evaluate`, its
 * handles and a locator's are refused, naming the capability. Whether it was.
 */
const isolatedRefused = Effect.fnUntraced(function*(refused: Effect.Effect<unknown, unknown, Scope.Scope>) {
  if (yield* supports("isolatedWorlds")) return false
  const error = yield* Effect.scoped(Effect.flip(refused))
  assert.deepInclude((error as { readonly reason: unknown }).reason, {
    _tag: "Unsupported",
    capability: "isolatedWorlds"
  })
  return true
})

/** The isolated world's `evaluate`, or the page's world's where the backend makes none. */
const evaluator = Effect.fnUntraced(function*(page: Page.Page) {
  const isolated = yield* supports("isolatedWorlds")
  return <Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args) =>
    isolated ? page.evaluate(fn, ...args) : page.evaluateInMainWorld(fn, ...args)
})

export const contents = (
  name: "Chromium" | "Firefox" | "WebKit",
  backend: Layer.Layer<Browser.Browser, unknown>
) =>
  describe(`${name} contents`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("releases the requesting viewport round when its fiber is interrupted", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(
              fixtureUrl(
                origin,
                `<div id="target" style="position:absolute;top:100000px;width:100px;height:100px"></div>`
              )
            )
            const target = page.locator("#target")
            assert(target instanceof LocatorImpl)
            const adapter = target.owner.runtime.model.adapter
            const original = adapter.evaluate
            const entered = yield* Deferred.make<void>()
            const released = yield* Deferred.make<void>()
            let token: string | undefined
            const hook = vi.spyOn(adapter, "evaluate").mockImplementation((realm, options) => {
              const argument = options.arguments[0]
              const request = argument?._tag === "Value" && argument.value.type === "string"
                ? JSON.parse(argument.value.value) as { op?: string; token?: string }
                : undefined
              const result = original(realm, options)
              if (request?.op === "expect" && request.token !== undefined) {
                token = request.token
                return Deferred.succeed(entered, undefined).pipe(Effect.andThen(result))
              }
              if (request?.op === "expectStop") {
                assert.strictEqual(request.token, token)
                return result.pipe(Effect.tap(() => Deferred.succeed(released, undefined)))
              }
              return result
            })
            yield* Effect.addFinalizer(() => Effect.sync(() => hook.mockRestore()))
            const pending = yield* page.locator("#target").pipe(Expect.toBeInViewport(), Effect.forkChild)
            yield* Deferred.await(entered)
            yield* Fiber.interrupt(pending)
            yield* Deferred.await(released)
          }))
        }), timeout)

      it.effect("measures viewport intersection of a cross-site frame's match against the top-level viewport", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const child = fixtureUrl(
            crossSite,
            `<style>body{margin:0}</style><div id="target" style="position:absolute;top:50px;width:100px;height:100px"></div>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<style>body{margin:0}iframe{border:0;display:block;width:200px;height:100px}</style>
<iframe id="clipped" src="${child}"></iframe><div style="height:3000px"></div><iframe id="below" src="${child}"></iframe>`
            ))
            // The iframe clips the match to its top half
            const clipped = page.frame(page.locator("#clipped")).locator("#target")
            yield* clipped.pipe(Expect.toBeInViewport({ ratio: 0.5 }))
            yield* clipped.pipe(Expect.toBeInViewport({ ratio: 0.6, inViewport: false }))
            // Inside its own frame's viewport, but the frame is below the page's fold
            yield* page.frame(page.locator("#below")).locator("#target").pipe(
              Expect.toBeInViewport({ inViewport: false })
            )
          }))
        }), timeout)

      it.effect("checks viewport intersection while the page clock is controlled", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
            yield* page.goto(fixtureUrl(
              origin,
              `<div id="target" style="position:absolute;top:2000px;width:100px;height:100px"></div>
<button style="position:fixed;top:0" onclick="window.scrollTo(0,2000)">Scroll</button>`
            ))
            yield* page.locator("#target").pipe(Expect.toBeInViewport({ inViewport: false }))
            yield* Effect.all([
              page.locator("#target").pipe(Expect.toBeInViewport({ ratio: 1 })),
              page.getByRole("button").click()
            ], { concurrency: "unbounded" })
          }))
        }), timeout)

      it.effect("setContent waits for guarded native insertion before replacing the document", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const child = fixtureUrl(crossSite, `<p id="target">old</p><script>document.designMode="on";</script>`)
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, `<input id="other" value="other"><iframe src="${child}"></iframe>`))
          yield* page.activate
          const target = page.frame(page.locator("iframe")).locator("#target")
          assert(target instanceof LocatorImpl)
          const adapter = target.owner.runtime.model.adapter
          const original = adapter.dispatchInput
          const ready = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let held = false
          const dispatchInput: typeof original = Effect.fnUntraced(function*(...args: Parameters<typeof original>) {
            if (!held) {
              held = true
              yield* Deferred.succeed(ready, undefined)
              yield* Deferred.await(release)
            }
            return yield* original(...args)
          })
          const replacement = `<input id="other" value="replacement"><script>
            const other = document.getElementById("other"); other.focus(); other.setSelectionRange(11, 11);
          </script>`
          yield* Effect.acquireUseRelease(
            Effect.sync(() =>
              Object.assign(adapter, { dispatchInput })
            ),
            () =>
              Effect.gen(function*() {
                const fill = yield* target.fill("new").pipe(Deadline.within("2 seconds"), Effect.forkScoped)
                yield* Deferred.await(ready).pipe(Deadline.within("2 seconds"))
                const replaced = yield* page.setContent(replacement).pipe(Deadline.within("250 millis"), Effect.exit)
                yield* Deferred.succeed(release, undefined)
                const filled = yield* Fiber.await(fill).pipe(Deadline.within("2 seconds"))
                const value = yield* page.locator("#other").readValue
                assert(
                  Exit.isFailure(replaced),
                  `replacement must wait for native insertion; parent value was ${value}`
                )
                assert(Exit.isSuccess(filled), "the prepared native fill must complete before replacement")
                assert.strictEqual(value, "other")
                assert.strictEqual(yield* target.readText, "new")
                yield* page.setContent(replacement)
                assert.strictEqual(yield* page.locator("#other").readValue, "replacement")
                const pending = yield* page.setContent("<input id=\"while-loading\"><img src=\"/pending-image\">").pipe(
                  Effect.forkScoped
                )
                yield* page.locator("#while-loading").fill("still usable").pipe(Deadline.within("2 seconds"))
                assert.strictEqual(pending.pollUnsafe(), undefined, "resource readiness must still be pending")
                yield* Fiber.interrupt(pending).pipe(Deadline.within("2 seconds"))
                assert.strictEqual(yield* page.locator("#while-loading").readValue, "still usable")
              }),
            () =>
              Deferred.succeed(release, undefined).pipe(
                Effect.andThen(Effect.sync(() =>
                  Object.assign(adapter, { dispatchInput: original })
                ))
              )
          )
        }), timeout)

      it.effect("setContent replaces markup repeatedly without navigating and executes parser scripts", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.setContent("<title>Fresh</title>")
          assert.strictEqual(yield* page.title, "Fresh")
          yield* page.goto(fixtureUrl(origin, "<title>Before</title><p>Old</p>"), { waitUntil: "load" })
          const before = yield* page.evaluateInMainWorld(() => {
            Reflect.set(window, "originalDocument", document)
            return { url: location.href, history: history.length }
          })
          const status = yield* page.status
          yield* page.setContent(
            "<!doctype html><title>After</title><p>New</p><script>document.querySelector(\"p\").textContent += \" script\"</script>"
          )
          assert.strictEqual(yield* page.title, "After")
          assert.strictEqual(yield* page.getByText("New script").readText, "New script")
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() => ({
              url: location.href,
              history: history.length
            })),
            before
          )
          assert.isTrue(
            yield* page.evaluateInMainWorld(() =>
              Reflect.get(window, "originalDocument") === document
            )
          )
          const after = yield* page.status
          assert.strictEqual(after._tag, status._tag)
          if (after._tag === "Open" && status._tag === "Open") {
            assert.strictEqual(after.document.id, status.document.id)
          }
          yield* page.setContent("<title>Again</title><button>Again</button>")
          assert.strictEqual(yield* page.getByRole("button").readText, "Again")
          assert.strictEqual(yield* page.getByText("New script").count, 0)
          yield* page.setContent("")
          assert.strictEqual(yield* page.title, "")
        }), timeout)

      it.effect("setContent waits for resources by default and supports domcontentloaded", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>Base</title>"), { waitUntil: "load" })
          const child = fixtureUrl(origin, "<img src=\"/slow-image\">")
          yield* page.setContent(`<img src="/slow-image"><iframe src="${child}"></iframe>`)
          assert.isTrue(
            yield* page.evaluateInMainWorld(() => {
              const child = document.querySelector("iframe")!.contentDocument!
              return child.readyState === "complete" && child.querySelector("img")!.complete
            })
          )
          assert.isTrue(
            yield* page.evaluateInMainWorld(() =>
              document.images[0]!.complete
            )
          )
          yield* page.setContent(
            "<img src=\"/pending-image\"><script defer src=\"/set-content-deferred.js\"></script>",
            {
              waitUntil: "domContentLoaded"
            }
          )
          assert.strictEqual(yield* page.title, "Deferred")
          assert.isFalse(
            yield* page.evaluateInMainWorld(() =>
              document.images[0]!.complete
            )
          )
        }), timeout)

      it.effect("setContent deadline stops waiting and permits a subsequent replacement", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>Base</title>"), { waitUntil: "load" })
          const error = yield* page.setContent("<img src=\"/pending-image\">").pipe(
            Deadline.within("500 millis"),
            Effect.flip
          )
          assert.isTrue(Deadline.isTimeout(error))
          if (Deadline.isTimeout(error)) {
            assert.strictEqual(error.operation, "Page.setContent")
            assert.strictEqual(error.phase, "postcondition")
            assert.strictEqual(error.diagnostics.cleanup._tag, "Completed")
          }
          yield* page.setContent("<title>Recovered</title>", { waitUntil: "domContentLoaded" })
          assert.strictEqual(yield* page.title, "Recovered")
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() =>
              Object.keys(globalThis).filter((key) =>
                key.startsWith("__strider_setContent_")
              )
            ),
            []
          )
        }), timeout)

      it.effect("setContent commit skips readiness and interruption leaves the page reusable", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>Base</title>"), { waitUntil: "load" })
          yield* page.setContent("<img src=\"/pending-image\">", { waitUntil: "commit" })
          assert.isFalse(
            yield* page.evaluateInMainWorld(() =>
              document.images[0]!.complete
            )
          )
          const replacing = yield* page.setContent("<h1>Waiting</h1><img src=\"/pending-image\">").pipe(
            Effect.forkScoped
          )
          yield* page.getByRole("heading", { name: "Waiting" }).pipe(Expect.toBeVisible)
          assert.isUndefined(replacing.pollUnsafe())
          yield* Fiber.interrupt(replacing)
          yield* page.setContent("<title>After interruption</title>", { waitUntil: "domContentLoaded" })
          assert.strictEqual(yield* page.title, "After interruption")
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() =>
              Object.keys(globalThis).filter((key) => key.startsWith("__strider_setContent_"))
            ),
            []
          )
        }), timeout)

      it.effect("selects only nonnegative nth positions and keeps first and last distinct in diagnostics", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<ul><li>One</li><li>Two</li><li>Three</li></ul>"))
          const items = page.getByRole("listitem")
          assert.strictEqual(yield* items.nth(0).readText, "One")
          assert.strictEqual(yield* items.nth(1).readText, "Two")
          assert.strictEqual(yield* items.nth(2).readText, "Three")
          assert.strictEqual(yield* items.first.readText, "One")
          assert.strictEqual(yield* items.last.readText, "Three")
          for (const index of [-1, -2, -4, 3, 4]) {
            assert.strictEqual(yield* items.nth(index).count, 0, `nth(${index}) is out of range`)
            const error = reasonOf(yield* Effect.exit(items.nth(index).readText)) as Locator.LocatorError
            assert.strictEqual(error.reason._tag, "NoMatch")
            assert.strictEqual(error.locator, `page.getByRole("listitem").nth(${index})`)
          }
          const empty = page.getByRole("button")
          for (
            const [locator, suffix] of [
              [empty.nth(0), "nth(0)"],
              [empty.nth(-1), "nth(-1)"],
              [empty.first, "first"],
              [empty.last, "last"]
            ] as const
          ) {
            assert.strictEqual(yield* locator.count, 0)
            const error = reasonOf(yield* Effect.exit(locator.readText)) as Locator.LocatorError
            assert.strictEqual(error.reason._tag, "NoMatch")
            assert.strictEqual(error.locator, `page.getByRole("button").${suffix}`)
          }
        }), timeout)

      it.effect("reads bounding boxes without visibility checks, scrolling or input", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0;height:3000px">
            <input id="focus"><div id="box" style="position:absolute;left:30px;top:40px;width:20px;height:10px;transform:translate(5px,7px) scale(2);transform-origin:0 0"></div>
            <div id="hidden" style="display:none"></div>
            <div id="contents" style="display:contents"><span>child</span></div>
            <div id="invisible" style="visibility:hidden;width:20px;height:10px"></div>
            <div id="transparent" style="opacity:0;width:20px;height:10px"></div>
            <div id="zero" style="width:0;height:0"></div></body>`
            ),
            { waitUntil: "load" }
          )
          yield* page.evaluateInMainWorld(() =>
            document.querySelector("input")!.focus()
          )
          assert.deepStrictEqual(
            yield* page.locator("#box").boundingBox,
            Option.some({ x: 35, y: 47, width: 40, height: 20 })
          )
          for (const id of ["hidden", "contents"]) {
            assert.deepStrictEqual(yield* page.locator(`#${id}`).boundingBox, Option.none())
          }
          for (const id of ["invisible", "transparent", "zero"]) {
            assert.isTrue(Option.isSome(yield* page.locator(`#${id}`).boundingBox))
          }
          assert.strictEqual(
            reasonOf(yield* Effect.exit(page.locator("#missing").boundingBox))?.reason?._tag,
            "NoMatch"
          )
          assert.strictEqual(
            reasonOf(yield* Effect.exit(page.locator("div").boundingBox))?.reason?._tag,
            "StrictViolation"
          )
          yield* page.evaluateInMainWorld(() =>
            window.scrollTo(0, 200)
          )
          assert.deepStrictEqual(
            yield* page.locator("#box").boundingBox,
            Option.some({ x: 35, y: -153, width: 40, height: 20 })
          )
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() => ({ scroll: scrollY, focus: document.activeElement?.id })),
            { scroll: 200, focus: "focus" }
          )
          const expired = reasonOf(yield* Effect.exit(page.locator("#box").boundingBox.pipe(Deadline.within(0))))
          assert.strictEqual(expired?._tag, "Timeout")
        }), timeout)

      it.effect("adds nested cross-site frame content origins including borders and padding", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const page = yield* Browser.newPage()
          const child = fixtureUrl(
            crossSite,
            `<body style="margin:0"><div id="target" style="position:absolute;left:11px;top:13px;width:20px;height:30px"></div></body>`
          )
          const middle = fixtureUrl(
            origin,
            `<body style="margin:0"><iframe id="inner" style="position:absolute;left:17px;top:19px;border:3px solid;padding:4px" src="${child}"></iframe></body>`
          )
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><iframe id="outer" style="position:absolute;left:23px;top:29px;border:5px solid;padding:6px" src="${
                middle.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")
              }"></iframe></body>`
            ),
            { waitUntil: "load" }
          )
          const outer = page.frame(page.locator("#outer"))
          const target = outer.frame(outer.locator("#inner")).locator("#target")
          assert.deepStrictEqual(yield* target.boundingBox, Option.some({ x: 69, y: 79, width: 20, height: 30 }))
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() =>
              scrollY
            ),
            0
          )
          yield* page.evaluateInMainWorld(() => {
            document.body.style.height = "3000px"
            window.scrollTo(0, 100)
          })
          assert.deepStrictEqual(yield* target.boundingBox, Option.some({ x: 69, y: -21, width: 20, height: 30 }))
          const expected = yield* page.evaluateInMainWorld(() => {
            const reference = document.createElement("div")
            reference.style.cssText = "position:absolute;left:69px;top:79px;width:20px;height:30px"
            document.body.append(reference)
            document.body.style.transform = "scale(2)"
            const r = reference.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })
          const transformed = Option.getOrThrow(yield* target.boundingBox)
          for (const key of ["x", "y", "width", "height"] as const) {
            assert.closeTo(transformed[key], expected[key], .05, key)
          }
          yield* page.evaluateInMainWorld(() => {
            document.body.style.transform = "none"
            document.querySelector<HTMLElement>("#outer")!.style.display = "none"
          })
          assert.deepStrictEqual(yield* target.boundingBox, Option.none())
        }), timeout)

      it.effect("maps frame geometry scaled by a shadow wrapper around a slotted frame", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          const child = fixtureUrl(
            origin,
            `<body style="margin:0"><div id="target" style="position:absolute;left:10px;top:10px;width:20px;height:20px"></div></body>`
          )
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><div id="host"><iframe id="slotted" style="border:0" src="${child}"></iframe></div></body>`
            ),
            { waitUntil: "load" }
          )
          yield* page.evaluateInMainWorld(() => {
            document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
              `<div style="position:absolute;left:0;top:0;transform:scale(2);transform-origin:0 0"><slot></slot></div>`
          })
          const target = page.frame(page.locator("#slotted")).locator("#target")
          // The frame's content is drawn at (20, 20) and 40px wide; adding the iframe's origin alone gives (10, 10).
          assert.deepStrictEqual(yield* target.boundingBox, Option.some({ x: 20, y: 20, width: 40, height: 40 }))
        }), timeout)

      it.effect("maps slotted frame geometry scaled and zoomed inside a closed shadow root", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          const child = fixtureUrl(
            origin,
            `<body style="margin:0"><div id="target" style="position:absolute;left:10px;top:10px;width:20px;height:20px;background:rgb(255,0,0)"></div></body>`
          )
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><div id="host"><iframe id="slotted" style="border:0" src="${child}"></iframe></div></body>`
            ),
            { waitUntil: "load" }
          )
          yield* page.evaluateInMainWorld(() => {
            document.querySelector("#host")!.attachShadow({ mode: "closed" }).innerHTML =
              `<div style="position:absolute;left:0;top:0;zoom:1.25;transform:scale(2);transform-origin:0 0"><slot></slot></div>`
          })
          const target = page.frame(page.locator("#slotted")).locator("#target")
          const box = Option.getOrThrow(yield* target.boundingBox)
          const region = pngRegion(yield* page.screenshot(), { x: 0, y: 0, width: 100, height: 100 })
          const red = region.flatMap((pixel, index) =>
            pixel[0]! > 240 && pixel[1]! < 10 && pixel[2]! < 10 ? [{ x: index % 100, y: Math.floor(index / 100) }] : []
          )
          const painted = {
            x: Math.min(...red.map((p) =>
              p.x
            )),
            y: Math.min(...red.map((p) =>
              p.y
            )),
            width: Math.max(...red.map((p) =>
              p.x
            )) - Math.min(...red.map((p) => p.x)) +
              1,
            height: Math.max(...red.map((p) => p.y)) - Math.min(...red.map((p) => p.y)) + 1
          }
          // Stock WebKit paints iframe contents differently from coincident slotted light-DOM boxes.
          // Native paint is the reference here; rasterized edges may differ by one pixel.
          assert.isAbove(red.length, 0)
          for (const key of ["x", "y", "width", "height"] as const) {
            assert.closeTo(box[key], painted[key], key === "x" || key === "y" ? 1 : .0001, key)
          }
        }), timeout)

      it.effect("maps or refuses browser rects through a rotated closed-slot frame", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          const child = fixtureUrl(
            origin,
            `<body style="margin:0"><div id="target" style="position:absolute;left:10px;top:20px;width:30px;height:40px"></div></body>`
          )
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><div id="host"><iframe id="frame" style="border:0" src="${child}"></iframe></div></body>`
            ),
            { waitUntil: "load" }
          )
          yield* page.evaluateInMainWorld(() => {
            document.querySelector("#host")!.attachShadow({ mode: "closed" }).innerHTML =
              `<div style="position:absolute;left:100px;top:100px;transform:rotate(90deg);transform-origin:0 0"><slot></slot></div>`
          })
          const target = page.frame(page.locator("#frame")).locator("#target")
          if (yield* frameRectRefused(target.boundingBox)) {
            return
          }
          const box = Option.getOrThrow(yield* target.boundingBox)
          for (const [key, expected] of Object.entries({ x: 40, y: 110, width: 40, height: 30 })) {
            assert.closeTo(box[key as keyof typeof box], expected, .05, key)
          }
        }), timeout)

      for (
        const rule of [
          { name: "scaling", css: "transform:scale(2,3)", world: "" },
          { name: "rotation and skew", css: "transform:rotate(31deg) skew(17deg,-8deg)", world: "" },
          { name: "nested CSS zoom", css: "zoom:1.5;transform:scale(.8,1.2)", world: "zoom:1.25" },
          { name: "reflection", css: "transform:scale(-1,1)", world: "" },
          {
            name: "auto-rotating motion path",
            css: "offset-path:path('M 0 0 L 100 100');offset-distance:50%;offset-rotate:auto;offset-anchor:0 0",
            world: ""
          },
          {
            name: "3D and perspective",
            css: "transform:rotateY(35deg) rotateX(20deg) translateZ(25px)",
            world: "perspective:600px;perspective-origin:0 0"
          },
          {
            name: "zoomed preserved 3D",
            css: "zoom:1.5;transform:rotateY(35deg) rotateX(20deg) translateZ(25px)",
            world:
              "zoom:1.25;transform:rotateY(20deg);transform-style:preserve-3d;perspective:600px;perspective-origin:0 0"
          },
          {
            name: "zoomed preserved 3D across camera plane",
            css: "zoom:1.25;transform:translateZ(120px) rotateY(75deg)",
            world: "transform-style:preserve-3d;perspective:100px;perspective-origin:0 0"
          },
          {
            name: "grouped 3D flattening",
            css: "transform:rotateY(35deg) rotateX(20deg) translateZ(25px)",
            world:
              "transform:rotateY(20deg);transform-style:preserve-3d;opacity:.8;perspective:600px;perspective-origin:0 0"
          }
        ]
      ) {
        it.effect(`composes browser rects through frame ${rule.name}`, () =>
          Effect.gen(function*() {
            const { origin, crossSite } = yield* site
            const page = yield* Browser.newPage()
            const targetStyle = "position:absolute;left:10px;top:20px;width:30px;height:40px"
            const child = fixtureUrl(
              crossSite,
              `<body style="margin:0"><div id="target" style="${targetStyle}"></div></body>`
            )
            const boxStyle =
              `position:absolute;left:40px;top:60px;width:200px;height:150px;border:3px solid;padding:4px;box-sizing:content-box;transform-origin:0 0;${rule.css}`
            yield* page.goto(
              fixtureUrl(
                origin,
                `<body style="margin:0;width:3000px;height:3000px"><div style="position:absolute;left:20px;top:30px;width:800px;height:800px;${rule.world}"><iframe id="frame" style="${boxStyle}" src="${child}"></iframe><div style="${boxStyle};pointer-events:none"><div style="position:relative;width:200px;height:150px"><div id="expected" style="${targetStyle}"></div></div></div></div></body>`
              ),
              { waitUntil: "load" }
            )
            const target = page.frame(page.locator("#frame")).locator("#target")
            for (const scrolled of [false, true]) {
              if (scrolled) {
                yield* page.evaluateInMainWorld(() =>
                  scrollTo(80, 70)
                )
              }
              // The reference is rendered by the browser in the same parent transform, without a frame boundary.
              // The rect contract reads the browser rect, including its camera clipping convention.
              const expected = yield* page.evaluateInMainWorld(() => {
                const r = document.querySelector("#expected")!.getBoundingClientRect()
                return { x: r.x, y: r.y, width: r.width, height: r.height }
              })
              const direct = Option.getOrThrow(yield* page.locator("#expected").boundingBox)
              for (const key of ["x", "y", "width", "height"] as const) {
                assert.closeTo(direct[key], expected[key], .05, `direct ${rule.name} ${key}, scrolled=${scrolled}`)
              }
              if (
                !["scaling", "nested CSS zoom"].includes(rule.name) &&
                (yield* frameRectRefused(target.boundingBox))
              ) continue
              const box = Option.getOrThrow(yield* target.boundingBox)
              for (const key of ["x", "y", "width", "height"] as const) {
                assert.closeTo(box[key], expected[key], .05, `${rule.name} ${key}, scrolled=${scrolled}`)
              }
            }
          }), timeout)
      }

      it.effect("composes a child browser rect through nested cross-origin counter-rotations", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const page = yield* Browser.newPage()
          const targetStyle =
            "position:absolute;left:10px;top:20px;width:30px;height:40px;transform:rotate(12deg);transform-origin:0 0"
          const child = fixtureUrl(
            origin,
            `<body style="margin:0"><div id="target" style="${targetStyle}"></div></body>`
          )
          const innerStyle =
            "position:absolute;left:30px;top:40px;width:100px;height:80px;border:2px solid;padding:3px;transform:rotate(-25deg) scale(1.2,.8);transform-origin:0 0;box-sizing:content-box"
          const middle = fixtureUrl(
            crossSite,
            `<body style="margin:0"><iframe id="inner" style="${innerStyle}" src="${child}"></iframe></body>`
          )
          const outerStyle =
            "position:absolute;left:300px;top:200px;width:300px;height:250px;border:3px solid;padding:4px;transform:rotate(25deg) scale(.7,1.3);transform-origin:0 0;box-sizing:content-box"
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><iframe id="outer" style="${outerStyle}" src="${
                middle.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")
              }"></iframe><div style="${outerStyle};pointer-events:none"><div style="position:relative;width:300px;height:250px"><div style="${innerStyle}"><div style="position:relative;width:100px;height:80px"><div id="expected" style="${targetStyle}"></div></div></div></div></div></body>`
            ),
            { waitUntil: "load" }
          )
          const outer = page.frame(page.locator("#outer"))
          const target = outer.frame(outer.locator("#inner")).locator("#target")
          if (yield* frameRectRefused(target.boundingBox)) {
            return
          }
          // Replace the reference element by its child-document rect before the frame transforms.
          const childRect = yield* page.evaluateInMainWorld((css) => {
            const el = document.createElement("div")
            el.style.cssText = css
            document.body.append(el)
            const r = el.getBoundingClientRect()
            el.remove()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          }, targetStyle)
          yield* page.evaluateInMainWorld((r) => {
            const el = document.querySelector<HTMLElement>("#expected")!
            Object.assign(el.style, {
              left: `${r.x}px`,
              top: `${r.y}px`,
              width: `${r.width}px`,
              height: `${r.height}px`,
              transform: "none"
            })
          }, childRect)
          const expected = yield* page.evaluateInMainWorld(() => {
            const r = document.querySelector("#expected")!.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })
          const box = Option.getOrThrow(yield* target.boundingBox)
          for (const key of ["x", "y", "width", "height"] as const) {
            assert.closeTo(box[key], expected[key], .05, key)
          }
        }), timeout)

      it.effect("maps fractional inline bounding geometry through a rotated cross-origin frame", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const page = yield* Browser.newPage()
          const text = "<span id=\"target\" style=\"font:13.3px serif\">fractional glyphs</span>"
          const child = fixtureUrl(crossSite, `<body style="margin:0">${text}</body>`)
          const style =
            "position:absolute;left:70px;top:90px;width:200px;height:150px;border:3px solid;padding:4px;box-sizing:content-box;transform:rotate(33deg) skew(9deg);transform-origin:0 0"
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><iframe id="frame" style="${style}" src="${child}"></iframe><div style="${style}"><div style="position:relative;width:200px;height:150px">${
                text.replace("id=\"target\"", "id=\"expected\"")
              }</div></div></body>`
            ),
            { waitUntil: "load" }
          )
          const target = page.frame(page.locator("#frame")).locator("#target")
          if (yield* frameRectRefused(target.boundingBox)) {
            return
          }
          const expected = yield* page.evaluateInMainWorld(() => {
            const r = document.querySelector("#expected")!.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })
          const box = Option.getOrThrow(yield* page.frame(page.locator("#frame")).locator("#target").boundingBox)
          for (const key of ["x", "y", "width", "height"] as const) {
            assert.closeTo(box[key], expected[key], .05, key)
          }
        }), timeout)

      it.effect("composes the SVG browser rect through a transformed frame", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const page = yield* Browser.newPage()
          const svg =
            "<svg width=\"200\" height=\"150\"><rect id=\"target\" x=\"13\" y=\"17\" width=\"30\" height=\"20\" transform=\"rotate(23 13 17)\" fill=\"red\"/></svg>"
          const child = fixtureUrl(crossSite, `<body style="margin:0">${svg}</body>`)
          const style =
            "position:absolute;left:80px;top:90px;width:200px;height:150px;border:3px solid;padding:4px;box-sizing:content-box;transform:rotate(-17deg) scale(.8,1.2);transform-origin:0 0"
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><iframe id="frame" style="${style}" src="${child}"></iframe><div style="${style}"><div style="position:relative;width:200px;height:150px">${
                svg.replace("id=\"target\"", "id=\"expected\"")
              }</div></div></body>`
            ),
            { waitUntil: "load" }
          )
          const target = page.frame(page.locator("#frame")).locator("#target")
          if (yield* frameRectRefused(target.boundingBox)) {
            return
          }
          const childRect = yield* page.evaluateInMainWorld((url: string) => {
            // A same-document SVG copy supplies the browser's own rect, before frame composition.
            const container = document.createElement("div")
            container.style.cssText = "position:absolute;left:0;top:0"
            container.innerHTML = url
            document.body.append(container)
            const r = container.querySelector("#target")!.getBoundingClientRect()
            container.remove()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          }, svg)
          yield* page.evaluateInMainWorld((r) => {
            const el = document.querySelector("#expected")!
            const box = document.createElement("div")
            box.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`
            el.closest("svg")!.replaceWith(box)
            box.id = "expected"
          }, childRect)
          const expected = yield* page.evaluateInMainWorld(() => {
            const r = document.querySelector("#expected")!.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })
          const box = Option.getOrThrow(yield* page.frame(page.locator("#frame")).locator("#target").boundingBox)
          for (const key of ["x", "y", "width", "height"] as const) {
            assert.closeTo(box[key], expected[key], .05, key)
          }
        }), timeout)

      it.effect("reads the browser rect of an auto-rotating motion-path target", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(
            fixtureUrl(
              origin,
              `<body style="margin:0"><div id="target" style="position:absolute;left:200px;top:100px;width:30px;height:20px;offset-path:path('M 0 0 L 100 100');offset-distance:50%;offset-rotate:auto;offset-anchor:0 0"></div></body>`
            ),
            { waitUntil: "load" }
          )
          const expected = yield* page.evaluateInMainWorld(() => {
            const r = document.querySelector("#target")!.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })
          assert.deepStrictEqual(yield* page.locator("#target").boundingBox, Option.some(expected))
        }), timeout)

      // ── Evaluation and handles ──

      it.effect("evaluates by value in the isolated world, and in the main world when asked", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<script>window.secret = 42</script><p id="x">hello</p>`))
            if (
              yield* isolatedRefused(page.evaluate(() =>
                1
              ))
            ) {
              assert.strictEqual(
                yield* page.evaluateInMainWorld(() =>
                  (window as unknown as { secret: number }).secret
                ),
                42
              )
              return
            }
            const value = yield* page.evaluate(() => ({
              n: 1,
              when: new Date(0),
              set: new Set([1, 2]),
              map: new Map([["a", 1]]),
              big: 10n,
              nan: NaN,
              nested: { list: [1, "two", null] }
            }))
            assert.strictEqual(value.n, 1)
            assert.instanceOf(value.when, Date)
            assert.strictEqual(value.when.getTime(), 0)
            assert.deepStrictEqual([...value.set], [1, 2])
            assert.strictEqual(value.map.get("a"), 1)
            assert.strictEqual(value.big, 10n)
            assert.isNaN(value.nan)
            assert.deepStrictEqual(value.nested, { list: [1, "two", null] })
            assert.strictEqual(
              yield* page.evaluate(
                (a: number, b: number) =>
                  a + b,
                1,
                2
              ),
              3
            )
            // The isolated world doesn't see the page's globals; the main world does
            assert.strictEqual(
              yield* page.evaluate(() =>
                typeof (window as unknown as { secret?: number }).secret
              ),
              "undefined"
            )
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() =>
                (window as unknown as { secret: number }).secret
              ),
              42
            )
            // Both worlds share the document
            assert.strictEqual(yield* page.evaluate(() => document.getElementById("x")!.textContent), "hello")
          }))
        }), timeout)

      it.effect("fails with what was thrown, and with the path to what can't cross", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<p>hi</p>`))
            const evaluate = yield* evaluator(page)
            const thrown = reasonOf(
              yield* Effect.exit(evaluate(() => {
                throw new TypeError("boom")
              }))
            )
            assert.strictEqual(thrown?._tag, "PageError")
            const reason = (thrown as unknown as Page.PageError).reason
            assert.strictEqual(reason._tag, "EvaluationThrown")
            if (reason._tag === "EvaluationThrown") {
              assert.strictEqual(reason.exception.name, "TypeError")
              assert.strictEqual(reason.exception.message, "boom")
            }
            const rejected = reasonOf(
              yield* Effect.exit(evaluate(() =>
                Promise.reject(new Error("later"))
              ))
            )
            assert.strictEqual((rejected as unknown as Page.PageError).reason._tag, "EvaluationThrown")
            const argument = reasonOf(
              yield* Effect.exit(evaluate((value: unknown) => value, { fn: () => 1, nested: [Symbol("s")] }))
            )
            assert.deepInclude((argument as unknown as Page.PageError).reason, { _tag: "NotSerializable" })
            const node = reasonOf(yield* Effect.exit(evaluate(() => document.body as unknown)))
            const nodeReason = (node as unknown as Page.PageError).reason
            assert.strictEqual(nodeReason._tag, "NotSerializable")
          }))
        }), timeout)

      it.effect("hands out handles the scope releases, which end with their realm", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<p id="x">hello</p>`))
            if (yield* isolatedRefused(page.evaluateHandle(() => document.body))) return
            const body = yield* page.evaluateHandle(() => document.body)
            assert.isTrue(JSHandle.isJSHandle(body))
            assert.strictEqual(yield* body.evaluate((element) => element.tagName), "BODY")
            assert.strictEqual(
              yield* body.evaluate((element, id: string) => element.querySelector(`#${id}`)!.textContent, "x"),
              "hello"
            )
            const paragraph = yield* body.evaluateHandle((element) => element.querySelector("p")!)
            assert.strictEqual(yield* paragraph.evaluate((element) => element.id), "x")
            const data = yield* page.evaluateHandle(() => ({ a: 1, list: [1, 2] }))
            assert.deepStrictEqual(yield* data.read, { a: 1, list: [1, 2] })
            // A handle passed as an argument crosses as itself
            assert.strictEqual(
              yield* page.evaluate((value: { a: number }) => value.a + 1, data as unknown as { a: number }),
              2
            )
            const primitive = yield* page.evaluateHandle(() => 7)
            assert.strictEqual(yield* primitive.read, 7)
            yield* data.release
            yield* data.release
            // A new document ends the realm, and the handle with it
            yield* page.goto(fixtureUrl(origin, `<p>next</p>`))
            const gone = reasonOf(yield* Effect.exit(body.evaluate((element) => element.tagName)))
            assert.strictEqual(gone?._tag, "TargetGone")
          }))
        }), timeout)

      it.effect("releases a scope's handles in a realm in one command, and one released alone by itself", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const spans: Array<Tracer.NativeSpan> = []
          const tracer = Tracer.make({
            span(options) {
              const span = new Tracer.NativeSpan(options)
              spans.push(span)
              return span
            }
          })
          const worlds = yield* supports("isolatedWorlds")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<p>a</p><p>b</p><p>c</p>`))
            if (
              yield* isolatedRefused(page.evaluateHandle(() =>
                document.body
              ))
            ) return
            yield* Effect.scoped(Effect.gen(function*() {
              const paragraphs = yield* Effect.forEach(
                [0, 1, 2],
                (index) => page.evaluateHandle((at: number) => document.querySelectorAll("p")[at]!, index)
              )
              assert.strictEqual(yield* paragraphs[1]!.evaluate((element) => element.textContent), "b")
              yield* paragraphs[2]!.release
            })).pipe(Effect.provideService(Browser.TraceProtocolCommands, true))
          })).pipe(Effect.withTracer(tracer))
          const released = spans.flatMap((span) => {
            const method = span.attributes.get("browser.protocol.method")
            return typeof method === "string" && /^Runtime\.release|^script\.disown/.test(method) ? [method] : []
          })
          // The one released alone, then the other two together as the scope closed
          if (!worlds) return
          assert.deepStrictEqual(
            released,
            name === "Firefox"
              ? ["script.disown", "script.disown"]
              : ["Runtime.releaseObject", "Runtime.releaseObjectGroup"]
          )
        }), timeout)

      it.effect("evaluates with the locator's one match first, in the isolated world", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<p id="x" data-n="3">hello</p><p>a</p><p>b</p>`))
            if (
              yield* isolatedRefused(
                page.locator("#x").evaluate((element) =>
                  element.id
                )
              )
            ) return
            assert.strictEqual(
              yield* page.locator("#x").evaluate((element, suffix: string) => element.textContent + suffix, "!"),
              "hello!"
            )
            assert.strictEqual(
              yield* page.locator("#x").evaluate((element) => Number((element as HTMLElement).dataset["n"]) * 2),
              6
            )
            const missing = reasonOf(yield* Effect.exit(page.locator("#nothing").evaluate((element) => element.id)))
            assert.strictEqual((missing as unknown as Locator.LocatorError).reason._tag, "NoMatch")
            const several = reasonOf(yield* Effect.exit(page.locator("p").evaluate((element) => element.id)))
            assert.strictEqual((several as unknown as Locator.LocatorError).reason._tag, "StrictViolation")
          }))
        }), timeout)

      it.effect("evaluates all current locator matches once, including none", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<section><p>a</p><p>b</p></section>`))
            if (yield* isolatedRefused(page.locator("p").evaluateAll((elements) => elements.length))) return
            assert.deepStrictEqual(
              yield* page.locator("section").locator("p").evaluateAll(
                async (elements, suffixes: { suffix: string }) => {
                  elements[0]!.remove()
                  await Promise.resolve()
                  return {
                    texts: elements.map((element) => element.textContent + suffixes.suffix),
                    date: new Date(0)
                  }
                },
                { suffix: "!" }
              ),
              { texts: ["a!", "b!"], date: new Date(0) }
            )
            assert.strictEqual(yield* page.locator("#absent").evaluateAll((elements) => elements.length), 0)
            const thrown = reasonOf(
              yield* Effect.exit(
                page.locator("p").evaluateAll(async () => {
                  throw new Error("all failed")
                })
              )
            ) as Locator.LocatorError
            assert.strictEqual(thrown.reason._tag, "EvaluationThrown")
            const synchronous = reasonOf(
              yield* Effect.exit(
                page.locator("p").evaluateAll(() => {
                  throw new Error("sync failed")
                })
              )
            ) as Locator.LocatorError
            assert.strictEqual(synchronous.reason._tag, "EvaluationThrown")
            const invalid = reasonOf(
              yield* Effect.exit(page.locator("[").evaluateAll((elements) => elements.length))
            ) as Locator.LocatorError
            assert.strictEqual(invalid.reason._tag, "InvalidInput")
            const bad = reasonOf(
              yield* Effect.exit(
                page.locator("p").evaluateAll(
                  (_elements, value: unknown) => value,
                  Symbol("bad")
                )
              )
            ) as Locator.LocatorError
            assert.strictEqual(bad.reason._tag, "NotSerializable")
            const node = reasonOf(
              yield* Effect.exit(page.locator("p").evaluateAll((elements) => elements))
            ) as Locator.LocatorError
            assert.strictEqual(node.reason._tag, "NotSerializable")
          }))
        }), timeout)

      it.effect("evaluates snapshot matches detached between query and callback", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<p>a</p><p>b</p>`))
            if (yield* isolatedRefused(page.locator("p").evaluateAll((elements) => elements.length))) return
            const original = Runtime.elements
            let queries = 0
            const hook = vi.spyOn(Runtime, "elements").mockImplementation((...args) =>
              original(...args).pipe(
                Effect.tap(() =>
                  Effect.gen(function*() {
                    queries++
                    yield* page.evaluateInMainWorld(() => {
                      const matches = Array.from(document.querySelectorAll("p"))
                      // Keep detached nodes reachable, so this probes detachment rather than garbage collection.
                      Object.assign(window, { detachedMatches: matches })
                      for (const match of matches) match.remove()
                    }).pipe(Effect.orDie)
                  })
                )
              )
            )
            yield* Effect.addFinalizer(() => Effect.sync(() => hook.mockRestore()))
            assert.deepStrictEqual(
              yield* page.locator("p").evaluateAll((elements) =>
                elements.map((element) => ({
                  text: element.textContent,
                  connected: element.isConnected
                }))
              ),
              [{ text: "a", connected: false }, { text: "b", connected: false }]
            )
            assert.strictEqual(queries, 1)
            assert.strictEqual(yield* page.locator("p").count, 0)
          }))
        }), timeout)

      it.effect(
        "evaluates all current matches with a pending promise and releases its late result after interruption",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(fixtureUrl(origin, `<p>a</p><p>b</p>`))
              if (
                yield* isolatedRefused(
                  page.locator("p").evaluateAll((elements) => elements.length)
                )
              ) {
                return
              }
              const cleaned = yield* Deferred.make<void>()
              const lateMethods: Array<string> = []
              const waiting = yield* page.locator("p").evaluateAll((elements) =>
                new Promise<Array<string | null>>((resolve) => {
                  document.addEventListener(
                    "finish-evaluation",
                    () => resolve(elements.map((element) => element.textContent)),
                    { once: true }
                  )
                  document.body.setAttribute("data-evaluation-started", "yes")
                })
              ).pipe(
                Protocol.withLateReplyHandler((reply) => {
                  lateMethods.push(reply.method)
                  if (name !== "Firefox") {
                    const raw = reply.result as { result?: { objectId?: string } }
                    assert.strictEqual(typeof raw.result?.objectId, "string")
                  }

                  // Await the real protocol release acknowledgments before reporting cleanup complete.
                  return reply.release.pipe(Effect.andThen(Deferred.succeed(cleaned, undefined)))
                }),
                Effect.forkChild
              )
              yield* page.locator("body").pipe(Expect.toHaveAttribute("data-evaluation-started", "yes"))
              yield* Fiber.interrupt(waiting)
              assert.deepStrictEqual(lateMethods, [])
              yield* page.evaluateInMainWorld(() => document.dispatchEvent(new Event("finish-evaluation")))
              yield* Deferred.await(cleaned)
              assert.deepStrictEqual(lateMethods, [
                name === "Firefox" ? "script.callFunction" : "Runtime.callFunctionOn"
              ])
            }))
          }),
        timeout
      )

      it.effect("grants user activation to main-world evaluation inside withUserGesture", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<p>hi</p>`))
            const active = () => navigator.userActivation.isActive
            assert.isFalse(yield* page.evaluateInMainWorld(active))
            assert.isTrue(yield* Page.withUserGesture(page.evaluateInMainWorld(active)))
          }))
        }), timeout)

      // ── Frames ──

      it.effect("reads, acts and expects inside a same-origin and a cross-site frame", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<body style="margin:0"><iframe id="same" style="position:absolute;left:30px;top:40px;width:300px;height:200px;border:7px solid #ccc;padding:5px" src="${
                fixtureUrl(origin, counter("Same"))
              }"></iframe><iframe id="cross" style="position:absolute;left:400px;top:60px;width:300px;height:200px;border:3px solid #ccc" src="${
                fixtureUrl(crossSite, counter("Cross"))
              }"></iframe></body>`
            ))
            for (const id of ["same", "cross"]) {
              const frame = page.frame(page.locator(`#${id}`))
              const add = frame.getByRole("button", { name: "Add" })
              yield* add.click()
              yield* add.click()
              yield* frame.locator("#count").pipe(Expect.toHaveText("2"))
              assert.isTrue(yield* frame.getByLabel("Name").isEditable)
              yield* frame.getByLabel("Name").fill(`typed in ${id}`)
              assert.strictEqual(yield* frame.getByLabel("Name").readValue, `typed in ${id}`)
              assert.strictEqual(yield* frame.getByRole("heading").readText, id === "same" ? "Same" : "Cross")
              assert.strictEqual(yield* frame.locator("button").count, 1)
              if (yield* supports("isolatedWorlds")) {
                assert.deepStrictEqual(
                  yield* frame.locator("button").evaluateAll((elements) =>
                    elements.map((element) => element.ownerDocument.location.origin)
                  ),
                  [id === "same" ? origin : crossSite]
                )
                assert.strictEqual(
                  yield* frame.getByRole("heading").evaluate((element) => element.ownerDocument.location.origin),
                  id === "same" ? origin : crossSite
                )
              }
            }
            // The page's own document has no button
            assert.strictEqual(yield* page.locator("button").count, 0)
            // A frame locator's owner is the iframe
            assert.deepStrictEqual(
              yield* page.frame(page.locator("#cross")).owner.readAttribute("id"),
              Option.some("cross")
            )
          }))
        }), timeout)

      it.effect("enters nested frames, follows a frame that navigates, and waits for one not there yet", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const inner = fixtureUrl(origin, counter("Inner"))
            const middle = fixtureUrl(
              crossSite,
              `<body style="margin:0"><p>middle</p><iframe id="inner" style="margin:15px;width:260px;height:150px" src="${inner}"></iframe></body>`
            )
            yield* page.goto(fixtureUrl(
              origin,
              `<body style="margin:0"><div style="height:30px"></div><iframe id="outer" style="width:400px;height:300px" src="${middle}"></iframe></body>`
            ))
            const outer = page.frame(page.locator("#outer"))
            const nested = outer.frame(outer.locator("#inner"))
            yield* nested.getByRole("button", { name: "Add" }).click()
            yield* nested.locator("#count").pipe(Expect.toHaveText("1"))
            // The frame navigates: the locator follows it
            yield* page.evaluateInMainWorld(() => {
              ;(document.getElementById("outer") as HTMLIFrameElement).src = "/fixture?html=" +
                encodeURIComponent("<h1>Replaced</h1>")
            })
            yield* outer.getByRole("heading").pipe(Expect.toHaveText("Replaced"))
            // An iframe added later is waited for
            yield* page.evaluateInMainWorld((url: string) => {
              setTimeout(() => {
                const frame = document.createElement("iframe")
                frame.id = "late"
                frame.src = url
                document.body.append(frame)
              }, 300)
            }, fixtureUrl(origin, counter("Late")))
            const late = page.frame(page.locator("#late"))
            yield* late.getByRole("heading").pipe(Expect.toHaveText("Late"))
            yield* late.getByRole("button", { name: "Add" }).click()
            yield* late.locator("#count").pipe(Expect.toHaveText("1"))
            // A frame that isn't there is no match: a read says so at once
            const missing = reasonOf(yield* Effect.exit(page.frame(page.locator("#none")).locator("p").readText))
            assert.strictEqual((missing as unknown as Locator.LocatorError).reason._tag, "NoMatch")
          }))
        }), timeout)

      it.effect("scrolls an iframe into view, and finds it covered in its parent", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<body style="margin:0"><div style="height:2000px"></div><div style="position:relative;width:300px;height:200px"><iframe id="far" style="width:300px;height:200px;border:0" src="${
                fixtureUrl(crossSite, counter("Far"))
              }"></iframe><div id="cover" style="position:absolute;left:0;top:0;width:200px;height:150px;display:none;background:rgba(0,0,0,.2)"></div></div><div style="height:2000px"></div></body>`
            ))
            const far = page.frame(page.locator("#far"))
            yield* far.getByRole("button", { name: "Add" }).click()
            yield* far.locator("#count").pipe(Expect.toHaveText("1"))
            // Covered in the parent: the click waits, and says what covers it
            yield* page.evaluateInMainWorld(() => {
              document.getElementById("cover")!.style.display = "block"
            })
            const covered = reasonOf(
              yield* Effect.exit(
                far.getByRole("button", { name: "Add" }).click().pipe(Deadline.within("1 second"))
              )
            )
            assert.strictEqual(covered?._tag, "Timeout")
            assert.include(
              String((covered as unknown as Deadline.Timeout).hint.pipe(Option.getOrUndefined)),
              "div#cover"
            )
          }))
        }), timeout)

      // ── Snapshots ──

      it.effect("reports invalid state and native validation message after a required select blocks submission", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(
              fixtureUrl(
                origin,
                `<form onsubmit="event.preventDefault(); document.querySelector('output').textContent = 'submitted'">
<label>How did you hear about this job? * <select required id="source"><option value="">Choose one</option><option value="friend">Friend</option></select></label>
<button type="submit">Apply</button><output>not submitted</output></form>`
              )
            )
            yield* page.getByRole("button", { name: "Apply" }).click()
            const native = yield* page.evaluateInMainWorld(() => {
              const select = document.querySelector("select")!
              return {
                submitted: document.querySelector("output")!.textContent,
                focused: document.activeElement === select,
                valid: select.validity.valid,
                message: select.validationMessage
              }
            })
            assert.strictEqual(native.submitted, "not submitted")
            assert.isTrue(native.focused)
            assert.isFalse(native.valid)
            assert.isNotEmpty(native.message)
            const snapshot = yield* page.snapshot()
            assert.include(snapshot.text, "[focused]")
            assert.deepStrictEqual(
              {
                invalid: snapshot.text.includes("[invalid]"),
                message: snapshot.text.includes(native.message)
              },
              { invalid: true, message: true },
              JSON.stringify({ native, snapshot: snapshot.text })
            )
          }))
        }), timeout)

      it.effect("reads constraint invalidity without events or focus changes and diffs messages and clearing", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(
              fixtureUrl(
                origin,
                `<button autofocus>Stay</button><label>Entry<input required></label><label>Disabled<input required disabled></label><label>Readonly<input required readonly></label><output>0</output><script>document.addEventListener("invalid", () => { document.querySelector("output").textContent = String(Number(document.querySelector("output").textContent) + 1) }, true)</script>`
              )
            )
            yield* page.getByRole("button", { name: "Stay" }).focus()
            yield* page.evaluateInMainWorld(() =>
              document.querySelector("input")!.setCustomValidity("First \"message\"")
            )
            const before = yield* page.snapshot()
            assert.include(before.text, "[invalid]")
            assert.include(before.text, JSON.stringify("First \"message\""))
            yield* page.evaluateInMainWorld(() =>
              document.querySelector("input")!.setCustomValidity("Second message")
            )
            const after = yield* page.snapshot()
            const diff = yield* after.diff(before)
            assert.strictEqual(diff.changed.length, 1)
            assert.include(diff.text, "Second message")
            assert.isFalse(diff.text.includes("First"))
            yield* page.evaluateInMainWorld(() => {
              const input = document.querySelector("input")!
              input.setCustomValidity("")
              input.value = "valid"
            })
            const cleared = yield* page.snapshot()
            assert.isFalse(cleared.text.includes("[invalid]"))
            assert.isFalse(cleared.text.includes("message"))
            const clearing = yield* cleared.diff(after)
            assert.strictEqual(clearing.changed.length, 1)
            assert.isFalse(clearing.text.includes("[invalid]"))
            const observed = yield* page.evaluateInMainWorld(() => ({
              events: document.querySelector("output")!.textContent,
              focus: document.activeElement!.textContent
            }))
            assert.deepStrictEqual(observed, { events: "0", focus: "Stay" })
          }))
        }), timeout)

      it.effect("takes the accessibility tree, with interactivity inferred and tagged", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, shop))
            const snapshot = yield* page.snapshot()
            assert.isTrue(Snapshot.isSnapshot(snapshot))
            assert.deepStrictEqual(snapshot.root.role, { _tag: "Aria", role: "document" })
            const text = snapshot.text
            assert.match(text, /^- document "Shop":/)
            assert.match(text, /- heading "Shop" \[ref=e\d+\]/)
            assert.match(text, /- navigation "Main" \[ref=e\d+\]:\n {4}- link "Orders" \[ref=e\d+\]/)
            assert.match(text, /- button "Save" \[ref=e\d+\]/)
            assert.match(
              text,
              /- clickable "Add" \[ref=e\d+\] \[inferred: cursorPointer, onclickAttribute\] \[name from: text\]/
            )
            assert.match(text, /- checkbox "Agree" \[checked\] \[ref=e\d+\]/)
            assert.match(text, /- textbox "Email" \[ref=e\d+\]/)
            assert.match(text, /- paragraph \[ref=e\d+\]:\n {4}- text: "Hello world"/)
            assert.notInclude(text, "Hidden")
            // Text that only repeats its node's name isn't a node
            assert.notInclude(text, `text: "Save"`)
            // The accessibility tree alone infers nothing
            const aria = yield* page.snapshot({ sources: "aria" })
            assert.notInclude(aria.text, "clickable")
            // Narrowed explicitly
            const interactive = yield* page.snapshot({ interactiveOnly: true })
            assert.notInclude(interactive.text, "heading")
            assert.include(interactive.text, `button "Save"`)
            const shallow = yield* page.snapshot({ depth: 1 })
            assert.include(shallow.text, "- list")
            assert.notInclude(shallow.text, "listitem")
            // One element's subtree
            const nav = yield* page.getByRole("navigation").snapshot()
            assert.deepStrictEqual(nav.root.role, { _tag: "Aria", role: "navigation" })
            assert.match(nav.text, /^- navigation "Main" \[ref=e\d+\]:\n {2}- link "Orders"/)
            // Refs are data: every node with one, by ref
            const save = [...snapshot.refs.values()].find((node) =>
              node.role._tag === "Aria" && node.role.role === "button" && node.name._tag === "Accessible" &&
              node.name.value === "Save"
            )
            assert.isDefined(save)
          }))
        }), timeout)

      it.effect("acts on refs, which go stale rather than rebind", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, shop))
            const snapshot = yield* page.snapshot()
            const refOf = (role: string, name: string) =>
              [...snapshot.refs].find(([, node]) =>
                node.role.role === role && node.name._tag !== "None" && node.name.value === name
              )![0]
            yield* snapshot.ref(refOf("button", "Save")).click()
            yield* snapshot.ref(refOf("clickable", "Add")).click()
            yield* page.locator("#log").pipe(Expect.toHaveText("save add"))
            assert.strictEqual(yield* snapshot.ref(refOf("textbox", "Email")).readValue, "")
            yield* snapshot.ref(refOf("textbox", "Email")).fill("me@example.com")
            // The same node keeps its ref
            const again = yield* page.snapshot()
            assert.isTrue(again.refs.has(refOf("button", "Save")))
            // A removed node's ref is stale
            yield* page.evaluateInMainWorld(() =>
              [...document.querySelectorAll("button")].find((button) =>
                button.textContent === "Save"
              )!.remove()
            )
            const detached = reasonOf(yield* Effect.exit(snapshot.ref(refOf("button", "Save")).click()))
            assert.deepInclude((detached as unknown as Locator.LocatorError).reason, {
              _tag: "StaleRef",
              why: "Detached"
            })
            // A ref no snapshot gave
            const unknown = reasonOf(yield* Effect.exit(snapshot.ref(Snapshot.RefId.make("e99999")).readText))
            assert.deepInclude((unknown as unknown as Locator.LocatorError).reason, {
              _tag: "StaleRef",
              why: "OtherSnapshot"
            })
            // A new document: every ref of the old one is stale
            yield* page.goto(fixtureUrl(origin, shop))
            const replaced = reasonOf(yield* Effect.exit(snapshot.ref(refOf("clickable", "Add")).click()))
            assert.deepInclude((replaced as unknown as Locator.LocatorError).reason, {
              _tag: "StaleRef",
              why: "Replaced"
            })
          }))
        }), timeout)

      it.effect("diffs snapshots of one document by ref, and refuses another's", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, shop))
            const before = yield* page.snapshot()
            yield* page.getByRole("checkbox", { name: "Agree" }).uncheck()
            yield* page.evaluateInMainWorld(() => {
              const button = document.createElement("button")
              button.textContent = "Later"
              document.body.append(button)
              document.getElementById("gone")!.remove()
            })
            const after = yield* page.snapshot()
            const diff = yield* after.diff(before)
            assert.isTrue(diff.added.some((node) =>
              node.name._tag === "Accessible" && node.name.value === "Later"
            ))
            assert.isTrue(
              diff.changed.some((node) =>
                node.role.role === "checkbox" && !node.states.has("checked")
              )
            )
            assert.strictEqual(diff.removed.length, 1)
            assert.match(diff.text, /\+ button "Later" \[ref=e\d+\]/)
            assert.match(diff.text, /~ checkbox "Agree" (\[focused\] )?\[ref=e\d+\]/)
            assert.match(diff.text, /- link "Gone" \[ref=e\d+\]/)
            yield* page.goto(fixtureUrl(origin, shop))
            const other = yield* page.snapshot()
            const differs = reasonOf(yield* Effect.exit(other.diff(before)))
            assert.strictEqual(differs?._tag, "SnapshotError")
          }))
        }), timeout)

      it.effect("stitches a frame's tree under its iframe, with refs that act in it", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<h1>Outer</h1><iframe id="cross" title="Payment" src="${
                fixtureUrl(crossSite, counter("Inner"))
              }"></iframe>`
            ))
            yield* page.frame(page.locator("#cross")).getByRole("heading").pipe(Expect.toHaveText("Inner"))
            const snapshot = yield* page.snapshot()
            assert.match(
              snapshot.text,
              /- iframe "Payment" \[ref=e\d+\]:\n {4}- heading "Inner" \[ref=f1e\d+\]\n {4}- button "Add" \[ref=f1e\d+\]/
            )
            const add = [...snapshot.refs].find(([ref, node]) =>
              ref.startsWith("f1") && node.role.role === "button"
            )!
            yield* snapshot.ref(add[0]).click()
            yield* page.frame(page.locator("#cross")).locator("#count").pipe(Expect.toHaveText("1"))
          }))
        }), timeout)

      it.effect("matches structure with toMatchAria, waiting in the page (call site 16)", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, shop))
            // 16. Structure, matched explicitly
            yield* page.getByRole("navigation").pipe(Expect.toMatchAria(
              AriaPattern.node(
                "navigation",
                "Main",
                AriaPattern.including(
                  AriaPattern.node("link", "Orders", AriaPattern.unchecked)
                )
              )
            ))
            // A list item's name doesn't come from its content: its text is a child
            yield* page.getByRole("list").pipe(Expect.toMatchAria(
              AriaPattern.node(
                "list",
                "",
                AriaPattern.exactly(
                  AriaPattern.node("listitem", "", AriaPattern.exactly(AriaPattern.text("One"))),
                  AriaPattern.node("listitem", "", AriaPattern.exactly(AriaPattern.text(/^Tw/)))
                )
              )
            ))
            yield* page.locator("p").pipe(Expect.toMatchAria(
              AriaPattern.node("paragraph", "", AriaPattern.exactly(AriaPattern.text("Hello world")))
            ))
            // It waits for the page to change
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => {
                const item = document.createElement("li")
                item.textContent = "Three"
                document.querySelector("ul")!.append(item)
              }, 300)
            })
            yield* page.getByRole("list").pipe(Expect.toMatchAria(
              AriaPattern.node(
                "list",
                "",
                AriaPattern.including(AriaPattern.node("listitem", "", AriaPattern.exactly(AriaPattern.text("Three"))))
              )
            ))
            // What it saw is the subtree's text
            const failed = reasonOf(
              yield* Effect.exit(
                page.getByRole("navigation").pipe(
                  Expect.toMatchAria(AriaPattern.node("navigation", "Main", AriaPattern.exactly())),
                  Deadline.within("500 millis")
                )
              )
            )
            assert.strictEqual(failed?._tag, "ExpectationFailed")
            const last = (failed as unknown as Expect.ExpectationFailed).last
            assert.match(
              String(Option.getOrThrow(last).value),
              /- navigation "Main" \[ref=e\d+\]:\n {2}- link "Orders"/
            )
          }))
        }), timeout)

      it.effect("says what is near when nothing matches, and suggests close names", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, shop))
            const failed = reasonOf(
              yield* Effect.exit(
                page.getByRole("navigation").getByRole("link", { name: "Ordres", exact: true }).pipe(
                  Expect.toBeVisible,
                  Deadline.within("500 millis")
                )
              )
            )
            const error = failed as unknown as Expect.ExpectationFailed
            assert.match(Option.getOrThrow(error.nearest), /^- navigation "Main" \[ref=e\d+\]:\n {2}- link "Orders"/)
            assert.deepStrictEqual(error.suggestions, [
              `page.getByRole("navigation").getByRole("link", { name: "Orders", exact: true })`
            ])
            // Something matched: nothing to explain
            const present = reasonOf(
              yield* Effect.exit(
                page.getByRole("button", { name: "Save" }).pipe(Expect.toBeDisabled, Deadline.within("300 millis"))
              )
            )
            assert.isTrue(Option.isNone((present as unknown as Expect.ExpectationFailed).nearest))
          }))
        }), timeout)

      // ── Captures ──

      it.effect("captures fresh pixels after mutation, replacement and opening another window", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const url = (color: string) =>
              fixtureUrl(
                origin,
                `<body style="margin:0;background:${color}"><div id="color" style="height:1400px;background:inherit"></div></body>`
              )
            const pixel = (png: Uint8Array) =>
              Effect.sync(() => {
                const pixels = pngRegion(png, { x: 4, y: 4, width: 8, height: 8 })
                for (const value of pixels) {
                  assert.deepStrictEqual(value, pixels[0])
                }
                return pixels[0]
              })
            yield* page.goto(url("rgb(200,40,60)"), { waitUntil: "load" })
            assert.deepStrictEqual(yield* pixel(yield* page.screenshot()), [200, 40, 60, 255])
            yield* page.evaluateInMainWorld(() => {
              document.body.style.background = "rgb(30,170,90)"
            })
            assert.deepStrictEqual(yield* pixel(yield* page.screenshot()), [30, 170, 90, 255])
            assert.deepStrictEqual(
              yield* pixel(
                yield* page.screenshot({
                  area: { clip: cssRect({ x: 20, y: 20, width: 20, height: 20 }) }
                })
              ),
              [30, 170, 90, 255]
            )
            yield* page.goto(url("rgb(50,80,220)"), { waitUntil: "load" })
            assert.deepStrictEqual(yield* pixel(yield* page.screenshot()), [50, 80, 220, 255])
            const other = yield* Browser.newPage()
            yield* other.goto(url("black"), { waitUntil: "load" })
            assert.deepStrictEqual(yield* pixel(yield* page.screenshot()), [50, 80, 220, 255])
          }))
        }), timeout)

      it.effect("captures the viewport, a clip, an element and the full page, in device pixels", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<body style="margin:0"><div style="height:1500px"></div><div id="box" style="width:120px;height:80px;background:red"></div><iframe id="frame" style="border:0;width:300px;height:200px" src="${
                fixtureUrl(
                  crossSite,
                  `<body style="margin:0"><div id="inner" style="margin:20px;width:50px;height:40px;background:blue"></div></body>`
                )
              }"></iframe><div style="height:1000px"></div></body>`
            ))
            const { height, ratio, width } = yield* page.evaluateInMainWorld(() => ({
              width: innerWidth,
              height: innerHeight,
              ratio: devicePixelRatio
            }))
            const viewport = pngSize(yield* page.screenshot())
            assert.deepStrictEqual(viewport, { width: Math.round(width * ratio), height: Math.round(height * ratio) })
            const clip = pngSize(
              yield* page.screenshot({
                area: { clip: cssRect({ x: 10, y: 2000, width: 100, height: 50 }) }
              })
            )
            assert.deepStrictEqual(clip, { width: 100 * ratio, height: 50 * ratio })
            const box = pngSize(yield* page.screenshot({ area: { element: page.locator("#box") } }))
            assert.deepStrictEqual(box, { width: 120 * ratio, height: 80 * ratio })
            const frame = page.frame(page.locator("#frame"))
            yield* frame.locator("#inner").pipe(Expect.toBeVisible)
            const inner = pngSize(
              yield* page.screenshot({ area: { element: frame.locator("#inner") } })
            )
            assert.deepStrictEqual(inner, { width: 50 * ratio, height: 40 * ratio })
            const full = pngSize(yield* page.screenshot({ area: "fullPage" }))
            assert.strictEqual(full.height, (1500 + 80 + 200 + 1000) * ratio + (full.height % ratio))
            const jpeg = yield* Effect.exit(page.screenshot({ format: "jpeg", quality: 50 }))
            if (yield* fullySupports("screenshot.format")) {
              assert(Exit.isSuccess(jpeg), String(jpeg))
              assert.deepStrictEqual([...jpeg.value.subarray(0, 2)], [0xff, 0xd8])
            } else {
              // A backend that writes PNG only says so: stock WebKit's `snapshotRect`
              assert.deepInclude((reasonOf(jpeg) as unknown as Page.PageError).reason, {
                _tag: "Unsupported",
                capability: "screenshot.format"
              })
            }
            const missing = reasonOf(
              yield* Effect.exit(page.screenshot({ area: { element: page.locator("#none") } }))
            )
            // A capture never waits: an element that isn't there is the locator's NoMatch (QUIRKS.md, Q126)
            assert.strictEqual((missing as unknown as Page.PageError).reason._tag, "NoMatch")
          }))
        }), timeout)

      it.effect("captures a clip in the viewport below a short page's content", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            // No doctype: in quirks mode the root element is only as tall as its content (QUIRKS.md, Q114)
            yield* page.goto(fixtureUrl(origin, `<p>hi</p>`))
            const ratio = yield* page.evaluateInMainWorld(() =>
              devicePixelRatio
            )
            const clip = pngSize(
              yield* page.screenshot({ area: { clip: cssRect({ x: 0, y: 200, width: 20, height: 20 }) } })
            )
            assert.deepStrictEqual(clip, { width: 20 * ratio, height: 20 * ratio })
          }))
        }), timeout)

      it.effect("captures in CSS pixels and without a background where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<!DOCTYPE html><p>hi</p>`))
            const width = yield* page.evaluateInMainWorld(() =>
              innerWidth
            )
            const css = yield* Effect.exit(page.screenshot({ scale: "css" }))
            const clear = yield* Effect.exit(
              page.screenshot({
                omitBackground: true,
                area: { clip: cssRect({ x: 0, y: 200, width: 20, height: 20 }) }
              })
            )
            if (yield* supports("screenshot.cssScale")) {
              assert.isTrue(Exit.isSuccess(css) && pngSize(css.value).width === width)
            } else {
              assert.deepInclude((reasonOf(css) as unknown as Page.PageError).reason, {
                _tag: "Unsupported",
                capability: "screenshot.cssScale"
              })
            }
            if (yield* supports("screenshot.omitBackground")) {
              assert.isTrue(Exit.isSuccess(clear))
              if (Exit.isSuccess(clear)) {
                assert.strictEqual(firstAlpha(clear.value), 0)
              }
            } else {
              assert.deepInclude((reasonOf(clear) as unknown as Page.PageError).reason, {
                _tag: "Unsupported",
                capability: "screenshot.omitBackground"
              })
            }
            // The background is back afterwards
            const after = yield* page.screenshot({
              area: { clip: cssRect({ x: 0, y: 200, width: 20, height: 20 }) }
            })
            assert.strictEqual(firstAlpha(after), 255)
          }))
        }), timeout)

      it.effect("prints a PDF where the backend can, and reads the document's HTML", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<!DOCTYPE html><title>Doc</title><h1>Printed</h1>`))
            const html = yield* page.readHtml
            assert.match(
              html,
              /^<!DOCTYPE html><html><head><title>Doc<\/title><\/head><body><h1>Printed<\/h1><\/body><\/html>$/
            )
            const printed = yield* Effect.exit(page.pdf({
              paper: "a4",
              landscape: true,
              margins: { top: { value: 1, unit: "cm" } },
              background: true
            }))
            const headed = yield* Effect.exit(page.pdf({ header: "<span class=title></span>" }))
            if (name === "WebKit") {
              assert.deepInclude((reasonOf(printed) as unknown as Page.PageError).reason, {
                _tag: "Unsupported",
                capability: "pdf"
              })
            } else {
              assert.isTrue(Exit.isSuccess(printed))
              if (Exit.isSuccess(printed)) {
                assert.strictEqual(new TextDecoder().decode(printed.value.subarray(0, 5)), "%PDF-")
              }
              // A browser that prints says so in its table (QUIRKS.md, Q247)
              const capabilities = yield* (yield* Browser.Browser).capabilities
              assert.strictEqual(
                capabilities.entries.find((each) =>
                  each.name === "pdf"
                )?.status,
                "supported"
              )
              if (name === "Firefox") {
                assert.deepInclude((reasonOf(headed) as unknown as Page.PageError).reason, {
                  _tag: "Unsupported",
                  capability: "pdf.headerFooter"
                })
              } else {
                assert.isTrue(Exit.isSuccess(headed))
              }
            }
            const scale = reasonOf(yield* Effect.exit(page.pdf({ scale: 5 })))
            assert.strictEqual((scale as unknown as Page.PageError).reason._tag, "InvalidInput")
          }))
        }), timeout)

      // ── Storage ──

      it.effect("reads, sets and removes a context's cookies, and lists what a request would send", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, `<script>document.cookie = "plain=1; path=/"</script><p>hi</p>`))
            const jar = page.context.cookies
            if (!(yield* fullySupports("cookies"))) {
              // Where a context's list is the cookies its pages are sent (QUIRKS.md, Q225), one shows once a page is
              const listed = Effect.map(jar.list, (cookies) =>
                cookies.map((cookie) =>
                  cookie.name
                ).sort())
              yield* jar.set({
                name: "token",
                value: Redacted.make("secret"),
                scope: { url: `${origin}/app/page` }
              })
              assert.deepStrictEqual(yield* listed, ["plain"])
              yield* page.goto(`${origin}/app/page`)
              const token = (yield* jar.list).find((cookie) =>
                cookie.name === "token"
              )
              assert.isDefined(token)
              assert.strictEqual(Redacted.value(token.value), "secret")
              assert.strictEqual(token.path, "/app")
              yield* jar.remove({ name: "token" })
              assert.deepStrictEqual(yield* listed, ["plain"])
              yield* jar.clear
              assert.deepStrictEqual(yield* listed, [])
              return
            }
            yield* jar.set({
              name: "token",
              value: Redacted.make("secret"),
              scope: { url: `${origin}/app/page` }
            })
            yield* jar.set({
              name: "other",
              value: "2",
              scope: { domain: new URL(crossSite).hostname, path: "/" },
              sameSite: "strict"
            })
            const all = yield* jar.list
            const token = all.find((cookie) =>
              cookie.name === "token"
            )!
            assert.strictEqual(Redacted.value(token.value), "secret")
            assert.strictEqual(token.path, "/app")
            assert.deepStrictEqual(token.sameSite, Option.some("lax"))
            assert.deepStrictEqual(token.partitionKey, { _tag: "Unpartitioned" })
            assert.deepStrictEqual(CookieJar.toCookie(token).value, "secret")
            const plain = all.find((cookie) => cookie.name === "plain")!
            // A cookie that didn't say: WebKit reports Lax, the others nothing (QUIRKS.md)
            assert.deepStrictEqual(plain.sameSite, name === "WebKit" ? Option.some("lax") : Option.none())
            assert.strictEqual(Option.isSome(plain.priority), name === "Chromium")
            const names = (cookies: ReadonlyArray<CookieJar.Cookie>) => cookies.map((cookie) => cookie.name).sort()
            assert.deepStrictEqual(names(yield* jar.listFor(`${origin}/app/x`)), ["plain", "token"])
            assert.deepStrictEqual(names(yield* jar.listFor(`${origin}/other`)), ["plain"])
            assert.deepStrictEqual(names(yield* jar.listFor(crossSite)), ["other"])
            yield* page.reload()
            assert.include(yield* page.evaluateInMainWorld(() => document.cookie), "plain=1")
            yield* jar.remove({ name: "token" })
            assert.deepStrictEqual(names(yield* jar.list), ["other", "plain"])
            const partitioned = yield* Effect.exit(jar.set({
              name: "chip",
              value: "1",
              scope: { url: "https://shop.example/" },
              secure: true,
              sameSite: "none",
              partitionKey: {
                _tag: "Partitioned",
                topLevelSite: Url.Site.make("https://news.example"),
                crossSiteAncestor: Option.none()
              }
            }))
            if (name === "Chromium") {
              assert.isTrue(Exit.isSuccess(partitioned))
              const chip = (yield* jar.list).find((cookie) => cookie.name === "chip")!
              assert.strictEqual(chip.partitionKey._tag, "Partitioned")
              if (chip.partitionKey._tag === "Partitioned") {
                assert.strictEqual(chip.partitionKey.topLevelSite, "https://news.example")
              }
            } else {
              assert.deepInclude((reasonOf(partitioned) as unknown as CookieJar.CookieJarError).reason, {
                _tag: "Unsupported",
                capability: "cookies.partitioned"
              })
            }
            yield* jar.clear
            assert.deepStrictEqual(yield* jar.list, [])
            const invalid = reasonOf(
              yield* Effect.exit(jar.set({ name: "a b", value: "1", scope: { url: origin } }))
            )
            assert.strictEqual((invalid as unknown as CookieJar.CookieJarError).reason._tag, "InvalidInput")
          }))
        }), timeout)

      it.effect("reads and writes the current origin's storage from the isolated world", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(
              fixtureUrl(origin, `<script>localStorage.setItem("a", "1"); sessionStorage.setItem("s", "x")</script>`)
            )
            assert.deepStrictEqual(yield* page.localStorage.get("a"), Option.some("1"))
            assert.deepStrictEqual(yield* page.localStorage.get("missing"), Option.none())
            yield* page.localStorage.set("b", Redacted.make("2"))
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() =>
                localStorage.getItem("b")
              ),
              "2"
            )
            assert.deepStrictEqual(
              [...(yield* page.localStorage.entries)].sort(([a], [b]) => a.localeCompare(b)),
              [["a", "1"], ["b", "2"]]
            )
            assert.deepStrictEqual(yield* page.sessionStorage.entries, [["s", "x"]])
            yield* page.localStorage.remove("a")
            assert.deepStrictEqual(yield* page.localStorage.entries, [["b", "2"]])
            yield* page.localStorage.clear
            assert.deepStrictEqual(yield* page.localStorage.entries, [])
            assert.deepStrictEqual(yield* page.sessionStorage.get("s"), Option.some("x"))
          }))
        }), timeout)

      it.effect("logs in once and reuses the session, IndexedDB and a partitioned frame's storage (call site 1)", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          const widget = fixtureUrl(
            crossSite,
            `<pre id="out"></pre><script>if (new URLSearchParams(location.search).has("write")) localStorage.setItem("widget", "w1"); document.getElementById("out").textContent = localStorage.getItem("widget") ?? "none"</script>`
          )
          const login =
            `<!DOCTYPE html><form id="form"><label>Email <input id="email"></label><label>Password <input id="password" type="password"></label><button>Sign in</button></form><p id="welcome" hidden>Welcome</p><pre id="db"></pre>
<iframe id="widget" src="${widget}&write"></iframe>
<script>
document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault()
  document.cookie = "session=s3cret; path=/"
  localStorage.setItem("user", document.getElementById("email").value)
  const open = indexedDB.open("app", 3)
  open.onupgradeneeded = () => {
    const db = open.result
    const items = db.createObjectStore("items", { keyPath: "id", autoIncrement: true })
    items.createIndex("byName", "name", { unique: false })
    db.createObjectStore("plain")
  }
  open.onsuccess = () => {
    const db = open.result
    const tx = db.transaction(["items", "plain"], "readwrite")
    tx.objectStore("items").put({ name: "first", when: new Date(0), tags: new Set(["a"]), bytes: new Uint8Array([1, 2, 3]), $weird: 1 })
    tx.objectStore("plain").put("value", ["k", 1])
    tx.oncomplete = () => {
      db.close()
      document.getElementById("welcome").hidden = false
    }
  }
})
</script>`
          const json = yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(origin, login))
            yield* page.frame(page.locator("#widget")).locator("#out").pipe(Expect.toHaveText("w1"))
            yield* page.getByLabel("Email").fill("me@example.com")
            yield* page.getByLabel("Password").fill(Redacted.make("hunter2"))
            yield* page.getByRole("button", { name: "Sign in" }).click()
            yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
            const state = yield* page.context.exportStorageState
            assert.isTrue(state.cookies.some((cookie) =>
              cookie.name === "session"
            ))
            const own = state.origins.find((each) => each.origin === origin)!
            assert.deepStrictEqual(own.partition, { _tag: "Unpartitioned" })
            assert.deepStrictEqual(own.localStorage.map(([key, value]) => [key, Redacted.value(value)]), [[
              "user",
              "me@example.com"
            ]])
            const app = own.indexedDb.find((database) => database.name === "app")!
            assert.strictEqual(app.version, 3)
            const items = app.stores.find((store) => store.name === "items")!
            assert.deepStrictEqual(items.keyPath, Option.some("id"))
            assert.isTrue(items.autoIncrement)
            assert.deepStrictEqual(items.indexes, [{
              name: "byName",
              keyPath: "name",
              unique: false,
              multiEntry: false
            }])
            assert.strictEqual(items.records.length, 1)
            const frame = state.origins.find((each) => each.origin === crossSite)!
            assert.strictEqual(frame.partition._tag, "Partitioned")
            assert.deepStrictEqual(frame.localStorage.map(([key, value]) => [key, Redacted.value(value)]), [[
              "widget",
              "w1"
            ]])
            // 1. Log in once, reuse the session: the persistence boundary writes the secrets out
            return yield* Schema.encodeEffect(StorageState.Json)(state)
          }))
          assert.include(json, "s3cret")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage({ storageState: yield* Schema.decodeEffect(StorageState.Json)(json) })
            yield* page.goto(fixtureUrl(
              origin,
              `<p id="welcome" hidden>Welcome</p><iframe id="widget" src="${widget}"></iframe><script>if (document.cookie.includes("session=s3cret")) document.getElementById("welcome").hidden = false</script>`
            ))
            yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
            assert.deepStrictEqual(yield* page.localStorage.get("user"), Option.some("me@example.com"))
            // Restored under the origin it was read under, where the backend keys it by origin (Q232)
            yield* page.frame(page.locator("#widget")).locator("#out").pipe(Expect.toHaveText("w1"))
            const record = yield* page.evaluateInMainWorld(() =>
              new Promise<
                {
                  when: Date
                  tags: Set<string>
                  bytes: Array<number>
                  weird: number
                  plain: string
                  auto: boolean
                  index: Array<string>
                }
              >((resolve) => {
                const open = indexedDB.open("app")
                open.onsuccess = () => {
                  const db = open.result
                  const tx = db.transaction(["items", "plain"])
                  const items = tx.objectStore("items")
                  const one = items.get(1)
                  const plain = tx.objectStore("plain").get(["k", 1])
                  tx.oncomplete = () => {
                    resolve({
                      when: one.result.when,
                      tags: one.result.tags,
                      bytes: Array.from(one.result.bytes),
                      weird: one.result.$weird,
                      plain: plain.result,
                      auto: items.autoIncrement,
                      index: Array.from(items.indexNames)
                    })
                    db.close()
                  }
                }
              })
            )
            assert.strictEqual(record.when.getTime(), 0)
            assert.deepStrictEqual([...record.tags], ["a"])
            assert.deepStrictEqual(record.bytes, [1, 2, 3])
            assert.strictEqual(record.weird, 1)
            assert.strictEqual(record.plain, "value")
            assert.isTrue(record.auto)
            assert.deepStrictEqual(record.index, ["byName"])
            // The seeding page and its routes are gone
            assert.strictEqual((yield* page.context.pages).length, 1)
          }))
        }), timeout)

      it.effect("shows the frame tree", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const childUrl = fixtureUrl(crossSite, `<p>child</p>`)
            yield* page.goto(fixtureUrl(origin, `<iframe id="a" src="${childUrl}"></iframe>`))
            yield* page.frame(page.locator("#a")).locator("p").pipe(Expect.toHaveText("child"))
            const tree = yield* page.frames.waitFor((tree) =>
              tree.children.length === 1 && tree.children[0]!.url === childUrl
            )
            assert.strictEqual(tree.id, page.id)
            assert.include(tree.url, origin)
            assert.isTrue(Option.isNone(tree.children[0]!.name))
            yield* page.evaluateInMainWorld(() =>
              document.getElementById("a")!.remove()
            )
            yield* page.frames.waitFor((tree) => tree.children.length === 0)
          }))
        }), timeout)
    })
  })
