/**
 * The sixth slice (review 18): a page's contents, through the public API on every backend's layer. Evaluation and
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
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Tracer from "effect/Tracer"
import * as zlib from "node:zlib"
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
                yield* page.evaluateInMainWorld(() => (window as unknown as { secret: number }).secret),
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
                (a: number, b: number) => a + b,
                1,
                2
              ),
              3
            )
            // The isolated world doesn't see the page's globals; the main world does
            assert.strictEqual(
              yield* page.evaluate(() => typeof (window as unknown as { secret?: number }).secret),
              "undefined"
            )
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() => (window as unknown as { secret: number }).secret),
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
              yield* frame.getByLabel("Name").fill(`typed in ${id}`)
              assert.strictEqual(yield* frame.getByLabel("Name").readValue, `typed in ${id}`)
              assert.strictEqual(yield* frame.getByRole("heading").readText, id === "same" ? "Same" : "Cross")
              assert.strictEqual(yield* frame.locator("button").count, 1)
              if (yield* supports("isolatedWorlds")) {
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
              diff.changed.some((node) => node.role.role === "checkbox" && !node.states.has("checked"))
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
            const add = [...snapshot.refs].find(([ref, node]) => ref.startsWith("f1") && node.role.role === "button")!
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
                area: { _tag: "Clip", rect: cssRect({ x: 10, y: 2000, width: 100, height: 50 }) }
              })
            )
            assert.deepStrictEqual(clip, { width: 100 * ratio, height: 50 * ratio })
            const box = pngSize(yield* page.screenshot({ area: { _tag: "Element", locator: page.locator("#box") } }))
            assert.deepStrictEqual(box, { width: 120 * ratio, height: 80 * ratio })
            const frame = page.frame(page.locator("#frame"))
            yield* frame.locator("#inner").pipe(Expect.toBeVisible)
            const inner = pngSize(
              yield* page.screenshot({ area: { _tag: "Element", locator: frame.locator("#inner") } })
            )
            assert.deepStrictEqual(inner, { width: 50 * ratio, height: 40 * ratio })
            const full = pngSize(yield* page.screenshot({ area: { _tag: "FullPage" } }))
            assert.strictEqual(full.height, (1500 + 80 + 200 + 1000) * ratio + (full.height % ratio))
            const jpeg = yield* Effect.exit(page.screenshot({ format: { _tag: "Jpeg", quality: 50 } }))
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
              yield* Effect.exit(page.screenshot({ area: { _tag: "Element", locator: page.locator("#none") } }))
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
              yield* page.screenshot({ area: { _tag: "Clip", rect: cssRect({ x: 0, y: 200, width: 20, height: 20 }) } })
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
                area: { _tag: "Clip", rect: cssRect({ x: 0, y: 200, width: 20, height: 20 }) }
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
              area: { _tag: "Clip", rect: cssRect({ x: 0, y: 200, width: 20, height: 20 }) }
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
                cookies.map((cookie) => cookie.name).sort())
              yield* jar.set({
                name: "token",
                value: Redacted.make("secret"),
                scope: { _tag: "Url", url: `${origin}/app/page` }
              })
              assert.deepStrictEqual(yield* listed, ["plain"])
              yield* page.goto(`${origin}/app/page`)
              const token = (yield* jar.list).find((cookie) => cookie.name === "token")
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
              scope: { _tag: "Url", url: `${origin}/app/page` }
            })
            yield* jar.set({
              name: "other",
              value: "2",
              scope: { _tag: "Domain", domain: new URL(crossSite).hostname, path: "/" },
              sameSite: "strict"
            })
            const all = yield* jar.list
            const token = all.find((cookie) => cookie.name === "token")!
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
              scope: { _tag: "Url", url: "https://shop.example/" },
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
              yield* Effect.exit(jar.set({ name: "a b", value: "1", scope: { _tag: "Url", url: origin } }))
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
            // A partition restored under its site's default port, where the backend keys it by origin (Q232)
            if (yield* fullySupports("storageState.partitioned")) {
              yield* page.frame(page.locator("#widget")).locator("#out").pipe(Expect.toHaveText("w1"))
            }
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
