/**
 * The query and actionability engine, in each browser: the same requests, against the same pages,
 * must give the same answers on every backend, because the engine is ours and runs in the page.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as Engine from "../../../src/internal/engine.ts"
import { type LinkGeometry, linkGeometry, wrappedLinkHtml, wrappedLinks } from "../wrappedLinks.ts"
import { type Backend, makeRecorder, site } from "./harness.ts"

const timeout = 60_000

const string = (value: string): Adapter.LocalValue => ({ _tag: "Value", value: { type: "string", value } })

/** A page showing `html`, and a function that sends the engine a request in the world the library would use. */
const open = Effect.fnUntraced(function*(backend: Backend, html: string, beforeInstall?: string) {
  const served = yield* site
  const facts = makeRecorder()
  const { adapter } = yield* backend.connect(facts.sink)
  const context = yield* adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false })
  const page = yield* adapter.createPage(context)
  const navigation = yield* adapter.navigate(
    page,
    `${served.origin}/fixture?html=${encodeURIComponent(html)}`,
    { referrer: Option.none() }
  )
  const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
  assert(ended.outcome._tag === "Committed")
  const document = ended.outcome.document
  yield* facts.when("DocumentReadiness", (fact) => fact.document === document && fact.readiness === "complete")
  // The utility world, or the page's where the backend makes no worlds, as the library chooses (`runtime.ts`)
  const capabilities = yield* SubscriptionRef.get(adapter.capabilities)
  const noWorlds = capabilities.entries.some((entry) =>
    entry.name === "isolatedWorlds" && entry.status === "unsupported"
  )
  const realm = yield* adapter.realm(
    document,
    noWorlds ? { _tag: "Main" } : { _tag: "Isolated", name: "__strider_utility__" }
  )
  const call = (functionDeclaration: string, args: ReadonlyArray<Adapter.LocalValue>) =>
    adapter.evaluate(realm, {
      functionDeclaration,
      arguments: args,
      awaitPromise: true,
      result: "value",
      userActivation: false
    })
  if (beforeInstall !== undefined) {
    const prepared = yield* call(beforeInstall, [])
    assert(prepared._tag === "Value", prepared._tag === "Exception" ? prepared.text : "")
  }
  const installed = yield* call(Engine.install, [])
  assert(installed._tag === "Value", installed._tag === "Exception" ? installed.text : "")
  const send = Effect.fnUntraced(function*(request: Engine.Request) {
    const result = yield* call(Engine.run, [string(JSON.stringify(request))])
    assert(result._tag === "Value", result._tag === "Exception" ? result.text : "")
    assert(result.value.type === "string")
    // Decoded as the library decodes it, so every answer the tests see is one the schema accepts
    return yield* Engine.decodeResponse(result.value.value).pipe(Effect.orDie)
  })
  return { send, call, adapter, page }
})

const text = (value: string, exact = false): Engine.TextMatcher => ({ _tag: "String", value, exact })
const role = (name: string, accessibleName: Engine.TextMatcher | null = null, includeHidden = false): Engine.Step => ({
  _tag: "Role",
  role: name,
  name: accessibleName,
  includeHidden
})
const all: Engine.Checks = {
  visible: true,
  enabled: true,
  editable: false,
  notInert: true,
  inViewport: true,
  stable: 2,
  receivesPointer: true
}

const count = (response: Engine.Response) => {
  assert(response._tag === "Count", JSON.stringify(response))
  return response.count
}

// Count real rendering callbacks in the engine's realm, optionally changing the fixture at a chosen frame.
// This checks the sampling contract without depending on the machine's frame rate or wall-clock latency.
const countFrames = (onFrame = "") =>
  `() => {
  const frame = globalThis.requestAnimationFrame.bind(globalThis)
  globalThis.engineTestFrames = 0
  globalThis.requestAnimationFrame = (callback) => frame((time) => {
    globalThis.engineTestFrames++
    ${onFrame}
    callback(time)
  })
}`

const point = (stable: number): Extract<Engine.Request, { op: "act" }> => ({
  op: "act",
  steps: [{ _tag: "Css", selector: "#go" }],
  checks: { ...all, stable },
  cap: 1000,
  action: { _tag: "Point", position: null, guard: false },
  apply: false
})

const framesRead = Effect.fnUntraced(function*(call: Effect.Success<ReturnType<typeof open>>["call"]) {
  const result = yield* call("() => globalThis.engineTestFrames", [])
  assert(result._tag === "Value")
  assert(result.value.type === "number")
  return result.value.value
})

/** Both rounds share one evaluation so the test controls what happens between them, independent of wire latency. */
const revalidate = Effect.fnUntraced(function*(
  call: Effect.Success<ReturnType<typeof open>>["call"],
  between: string,
  stable = 2
) {
  const result = yield* call(
    `async (json) => {
    const engine = globalThis[Symbol.for(${JSON.stringify(Engine.installKey)})]
    const request = JSON.parse(json)
    const first = JSON.parse(await engine.run(JSON.stringify({ ...request, stability: "capture" })))
    if (first._tag !== "Ready" || typeof first.stability !== "string") throw new Error("No stability evidence")
    ${between}
    const before = globalThis.engineTestFrames
    const response = await engine.run(JSON.stringify({
      ...request, checks: { ...request.checks, stable: ${stable} }, stability: first.stability
    }))
    return JSON.stringify({ response, frames: globalThis.engineTestFrames - before })
  }`,
    [string(JSON.stringify(point(2)))]
  )
  assert(result._tag === "Value", result._tag === "Exception" ? result.text : "")
  assert(result.value.type === "string")
  const measured = JSON.parse(result.value.value) as { response: string; frames: number }
  return { response: yield* Engine.decodeResponse(measured.response).pipe(Effect.orDie), frames: measured.frames }
})

export const engine = (backend: Backend) =>
  describe(`${backend.name} engine`, () => {
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
        for (const shape of wrappedLinks) {
          for (const partial of shape.id === "three" ? [false, true] : [false]) {
            it.effect(
              `selects first visible fragment for wrapped link ${shape.id}${
                partial ? " partially above viewport" : ""
              }`,
              () =>
                Effect.gen(function*() {
                  const { call, send } = yield* open(backend, wrappedLinkHtml(shape, partial))
                  const measured = yield* call(linkGeometry, [])
                  assert(measured._tag === "Value" && measured.value.type === "string")
                  const geometry = JSON.parse(measured.value.value) as LinkGeometry
                  assert.strictEqual(geometry.rects.length, shape.fragments)
                  if (partial) assert.isBelow(geometry.rects[0]!.bottom, 0)
                  const first = geometry.rects.find((r) => r.bottom > 0 && r.top < geometry.height)!
                  const response = yield* send(point(0))
                  assert(response._tag === "Ready", JSON.stringify(response))
                  assert(response.point !== null, JSON.stringify(response))
                  assert.closeTo(
                    response.point.x,
                    (Math.max(0, first.left) + Math.min(geometry.width, first.right)) / 2,
                    1
                  )
                  assert.closeTo(
                    response.point.y,
                    (Math.max(0, first.top) + Math.min(geometry.height, first.bottom)) / 2,
                    1
                  )
                }),
              timeout
            )
          }
        }

        for (
          const mode of [
            "later line",
            "disabled coverage",
            "explicit covered",
            "wholly covered",
            "partial ancestor"
          ] as const
        ) {
          it.effect(`selects a fragment with ${mode}`, () =>
            Effect.gen(function*() {
              const { send, call } = yield* open(
                backend,
                `<style>body{margin:0;font:16px/24px monospace}#box{position:absolute;left:20px;top:20px;width:240px}${
                  mode === "partial ancestor"
                    ? "#box{width:75px;height:40px;overflow:hidden}#go{display:inline-block;width:100px;height:20px}"
                    : ""
                }</style><div id="box"><a id="go">${Array(6).fill("abcdefghij").join(" ")}</a></div>${
                  mode === "partial ancestor"
                    ? ""
                    : `<div id="cover" style="position:absolute;left:0;top:0;width:400px;height:${
                      mode === "wholly covered" ? 120 : 44
                    }px"></div>`
                }`,
                `() => { globalThis.engineTestHits = 0; const original = document.elementFromPoint.bind(document); document.elementFromPoint = (...args) => { globalThis.engineTestHits++; return original(...args) } }`
              )
              const geometry = yield* call(
                `() => JSON.stringify(Array.from(document.querySelector('#go').getClientRects(), r => ({x:(r.left+r.right)/2,y:(r.top+r.bottom)/2})))`,
                []
              )
              assert(geometry._tag === "Value" && geometry.value.type === "string")
              const centers = JSON.parse(geometry.value.value) as Array<{ x: number; y: number }>
              if (mode !== "partial ancestor") assert.strictEqual(centers.length, 3)
              const response = yield* send({
                ...point(0),
                cap: 150,
                checks: { ...all, stable: 0, receivesPointer: mode !== "disabled coverage" },
                action: { _tag: "Point", position: mode === "explicit covered" ? { x: 2, y: 2 } : null, guard: false }
              })
              if (mode === "explicit covered" || mode === "wholly covered") {
                assert(response._tag === "NotReady", JSON.stringify(response))
                assert.strictEqual(response.reason._tag, "Covered")
                assert.strictEqual(response.scrolled, false)
              } else {
                assert(response._tag === "Ready", JSON.stringify(response))
                assert.deepStrictEqual(response.point, centers[mode === "later line" ? 1 : 0])
              }
              if (mode === "disabled coverage") {
                const hits = yield* call("() => globalThis.engineTestHits", [])
                assert(hits._tag === "Value" && hits.value.type === "number")
                assert.strictEqual(hits.value.value, 0)
              }
            }), timeout)
        }

        it.effect("refuses a default point without a visible fragment even with checks disabled", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<a id="go" style="position:fixed;left:-100px;top:20px;width:10px;height:10px">Go</a>`
            )
            const response = yield* send({
              ...point(0),
              cap: 100,
              checks: {
                visible: false,
                enabled: false,
                editable: false,
                notInert: false,
                inViewport: false,
                stable: 0,
                receivesPointer: false
              }
            })
            assert(response._tag === "NotReady", JSON.stringify(response))
            assert.strictEqual(response.reason._tag, "OutsideViewport")
          }), timeout)

        it.effect("keeps the rounded default point inside a one-pixel fragment", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<a id="go" style="position:fixed;left:0;top:20px;width:1px;height:10px"></a>`
            )
            const response = yield* send(point(0))
            assert(response._tag === "Ready" && response.point !== null, JSON.stringify(response))
            assert.isAtLeast(Math.round(response.point.x), 0)
            assert.isBelow(Math.round(response.point.x), 1)
          }), timeout)

        it.effect("selects explicit position from the padding-box origin", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<style>#go{position:absolute;left:40px;top:60px;border-style:solid;border-width:7px 11px 13px 5px;padding:19px;width:100px;height:80px}</style><a id="go">Go</a>`
            )
            const response = yield* send({
              ...point(0),
              action: { _tag: "Point", position: { x: 13, y: 9 }, guard: false }
            })
            assert(response._tag === "Ready", JSON.stringify(response))
            assert.deepStrictEqual(response.point, { x: 58, y: 76 })
          }), timeout)

        it.effect("revalidates fresh stability without another rendering wait", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, `<button id="go">Go</button>`, countFrames())
            const result = yield* revalidate(call, "")
            assert.strictEqual(result.response._tag, "Ready")
            assert.strictEqual(result.frames, 0)
          }), timeout)

        for (
          const [name, between, stable] of [
            ["a moved target", `document.getElementById("go").style.marginLeft = "40px"`, 2],
            [
              "a replacement with identical geometry",
              `const old = document.getElementById("go"); old.replaceWith(old.cloneNode(true))`,
              2
            ],
            ["an intervening rendering frame", `await new Promise(requestAnimationFrame)`, 2],
            [
              "already consumed evidence",
              `await engine.run(JSON.stringify({ ...request, stability: first.stability }))`,
              2
            ],
            ["superseded evidence", `await engine.run(JSON.stringify({ ...request, stability: "capture" }))`, 2],
            ["a different stability requirement", "", 4]
          ] as const
        ) {
          it.effect(`takes new stability samples after ${name}`, () =>
            Effect.gen(function*() {
              const { call } = yield* open(backend, `<button id="go">Go</button>`, countFrames())
              const result = yield* revalidate(call, between, stable)
              assert.strictEqual(result.response._tag, "Ready")
              assert.isAtLeast(result.frames, stable)
            }), timeout)
        }

        for (
          const [name, between, reason] of [
            ["disabled", `document.getElementById("go").disabled = true`, "Disabled"],
            ["hidden", `document.getElementById("go").style.visibility = "hidden"`, "NotVisible"],
            ["inert", `document.getElementById("go").inert = true`, "Inert"],
            [
              "covered",
              `const cover = document.createElement("div"); cover.style.cssText = "position:fixed;inset:0;z-index:1"; document.body.append(cover)`,
              "Covered"
            ],
            ["detached", `document.getElementById("go").remove()`, "NoMatch"]
          ] as const
        ) {
          it.effect(`refuses fresh stability when the target becomes ${name}`, () =>
            Effect.gen(function*() {
              const { call } = yield* open(backend, `<button id="go">Go</button>`, countFrames())
              const result = yield* revalidate(call, between)
              assert(result.response._tag === "NotReady", JSON.stringify(result.response))
              assert.strictEqual(result.response.reason._tag, reason)
            }), timeout)
        }

        it.effect("samples stability immediately, then across the configured rendering updates", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(backend, `<button id="go">Go</button>`, countFrames())
            for (const stable of [1, 2, 4]) {
              yield* call("() => { globalThis.engineTestFrames = 0 }", [])
              const response = yield* send(point(stable))
              assert(response._tag === "Ready", JSON.stringify(response))
              assert.strictEqual(yield* framesRead(call), stable)
            }
          }), timeout)

        it.effect("restarts stability sampling when the rectangle changes", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(
              backend,
              `<button id="go" style="position:absolute;left:0;top:0">Go</button>`,
              countFrames(
                `document.getElementById('go').style.left = Math.min(globalThis.engineTestFrames, 3) * 5 + 'px'`
              )
            )
            const response = yield* send(point(2))
            assert(response._tag === "Ready", JSON.stringify(response))
            assert.strictEqual(yield* framesRead(call), 5)
          }), timeout)

        it.effect("does not carry stability samples to a replacement with the same rectangle", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(
              backend,
              `<button id="go">Go</button>`,
              countFrames(`if (globalThis.engineTestFrames === 2) {
                const button = document.getElementById('go')
                button.replaceWith(button.cloneNode(true))
              }`)
            )
            const response = yield* send(point(2))
            assert(response._tag === "Ready", JSON.stringify(response))
            assert.strictEqual(yield* framesRead(call), 4)
          }), timeout)

        it.effect("still waits for rendering when stability is disabled", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(backend, `<button id="go">Go</button>`, countFrames())
            const response = yield* send(point(0))
            assert(response._tag === "Ready", JSON.stringify(response))
            assert.strictEqual(yield* framesRead(call), 1)
          }), timeout)

        it.effect("refuses an action when rendering never arrives, even with an initial rectangle", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button id="go">Go</button>`,
              "() => { globalThis.requestAnimationFrame = () => 0 }"
            )
            const response = yield* send({ ...point(2), cap: 100 })
            assert(response._tag === "NotReady", JSON.stringify(response))
            assert.strictEqual(response.reason._tag, "NoRenderingOpportunity")
          }), timeout)

        it.effect("filters role queries by native and ARIA states", () =>
          Effect.gen(function*() {
            const { send } = yield* open(backend, `<h2>Title</h2><h3>Other</h3>
<div role="heading" aria-level="2">ARIA</div>
<input type="checkbox" checked><input type="checkbox">
<div role="checkbox" aria-checked="true"></div><div role="checkbox" aria-checked="false"></div>
<div role="checkbox" aria-checked="mixed"></div><div role="checkbox"></div>
<button aria-pressed="true">Toggle</button><button aria-pressed="false">Toggle</button>
<button aria-pressed="mixed">Toggle</button><button>Toggle</button>
<button aria-expanded="true">Open</button><button aria-expanded="false">Open</button>
<select multiple><option selected>One</option><option>Two</option></select>
<div role="tab" aria-selected="true">Tab</div><div role="tab">Tab</div>
<fieldset disabled><legend><button>Legend</button></legend><button>Blocked</button></fieldset>
<div aria-disabled="true"><button>Inherited</button></div>`)
            const check = Effect.fnUntraced(function*(name: string, options: object, expected: number) {
              const step = { ...role(name), ...options }
              assert.strictEqual(count(yield* send({ op: "count", steps: [step] })), expected)
            })
            yield* check("heading", { level: 2 }, 2)
            yield* check("checkbox", { checked: true }, 2)
            yield* check("checkbox", { checked: false }, 3)
            yield* check("checkbox", {}, 6)
            yield* check("button", { pressed: true }, 1)
            yield* check("button", { pressed: false, name: text("Toggle") }, 2)
            yield* check("button", { expanded: true }, 1)
            yield* check("button", { expanded: false }, 1)
            yield* check("option", { selected: true }, 1)
            yield* check("option", { selected: false }, 1)
            yield* check("tab", { selected: false }, 1)
            yield* check("button", { disabled: true }, 2)
            yield* check("button", { pressed: false, disabled: false, name: text("Toggle", true) }, 2)
          }), timeout)

        it.effect("computes roles and accessible names", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<h2>Cart</h2>
<button>Add <b>to</b> cart</button>
<button aria-label="Close dialog">×</button>
<span id="l">Remove item</span><button aria-labelledby="l">−</button>
<input type="submit" value="Pay now">
<a href="/x"><img alt="Home"></a>
<label for="q">Search the shop</label><input id="q">
<label>Quantity <input type="number" value="2"></label>
<select><option>One</option></select>
<ul><li>first</li></ul>
<input type="checkbox" title="Gift wrap">
<div role="button tab">Role list</div>
<input type="checkbox" id="flash"><label for="flash">Flash <input value="5" size="2"> times</label>`
            )
            const response = yield* send({ op: "role", steps: [{ _tag: "Css", selector: "body *" }] })
            assert(response._tag === "Roles")
            const named = response.roles.filter((each) =>
              each.role !== null && each.role !== "generic"
            )
            assert.deepStrictEqual(named, [
              { role: "heading", name: "Cart" },
              { role: "button", name: "Add to cart" },
              { role: "button", name: "Close dialog" },
              { role: "button", name: "Remove item" },
              { role: "button", name: "Pay now" },
              { role: "link", name: "Home" },
              { role: "img", name: "Home" },
              { role: "textbox", name: "Search the shop" },
              // A control is never part of its own name, even inside its label
              { role: "spinbutton", name: "Quantity" },
              { role: "combobox", name: "" },
              { role: "option", name: "One" },
              { role: "list", name: "" },
              { role: "listitem", name: "" },
              { role: "checkbox", name: "Gift wrap" },
              { role: "button", name: "Role list" },
              // Inside another control's label, a control contributes its value
              { role: "checkbox", name: "Flash 5 times" },
              { role: "textbox", name: "" }
            ])
          }), timeout)

        it.effect("finds by role and name: substring by default, exact when asked, hidden only when asked", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button>Add to cart</button><button>Add to wishlist</button>
<button style="display:none">Add to cart</button><div aria-hidden="true"><button>Add to cart</button></div>`
            )
            assert.strictEqual(count(yield* send({ op: "count", steps: [role("button", text("add to"))] })), 2)
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [role("button", text("Add to cart", true))] })),
              1
            )
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [role("button", text("add to cart", true))] })),
              0
            )
            assert.strictEqual(
              count(
                yield* send({ op: "count", steps: [role("button", { _tag: "RegExp", source: "^Add", flags: "" })] })
              ),
              2
            )
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [role("button", text("Add to cart", true), true)] })),
              3
            )
          }), timeout)

        it.effect("finds the smallest element that says a text, outside head and scripts", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<title>1 item</title><div><p id="p">1 <b>item</b></p></div><script>"1 item"</script>
<div><span>2 items</span></div>`
            )
            const found = yield* send({ op: "role", steps: [{ _tag: "Text", matcher: text("1 item") }] })
            assert(found._tag === "Roles")
            assert.deepStrictEqual(found.roles, [{ role: "paragraph", name: "" }])
            assert.strictEqual(count(yield* send({ op: "count", steps: [{ _tag: "Text", matcher: text("item") }] })), 2)
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [{ _tag: "Text", matcher: text("1 item", true) }] })),
              1
            )
          }), timeout)

        it.effect("searches open shadow roots, and chains, filters and picks", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<div id="host"></div>
<script>document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = "<button>Inside</button>"</script>
<ul><li>Apple <button>Buy</button></li><li>Pear <button>Buy</button></li></ul>`
            )
            assert.strictEqual(count(yield* send({ op: "count", steps: [role("button", text("Inside"))] })), 1)
            assert.strictEqual(count(yield* send({ op: "count", steps: [{ _tag: "Css", selector: "button" }] })), 3)
            const pear: ReadonlyArray<Engine.Step> = [
              role("listitem"),
              { _tag: "Filter", hasText: text("pear"), hasNotText: null, has: null, hasNot: null, visible: null },
              role("button")
            ]
            assert.strictEqual(count(yield* send({ op: "count", steps: pear })), 1)
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [role("button", text("Buy")), { _tag: "Last" }] })),
              1
            )
            const invalid = yield* send({ op: "count", steps: [{ _tag: "Css", selector: "button[" }] })
            assert.strictEqual(invalid._tag, "InvalidSelector")
          }), timeout)

        it.effect("checks actionability at each frame: ready, covered, disabled, scrolled into view", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button id="go">Go</button>
<div style="position:relative"><button id="under">Under</button>
<div style="position:absolute;inset:0;background:white" class="overlay">Saving</div></div>
<button id="off" disabled>Off</button>
<div style="height:3000px"></div><button id="far">Far</button>`
            )
            const act = (selector: string) =>
              send({
                op: "act",
                steps: [{ _tag: "Css", selector }],
                checks: all,
                cap: 1000,
                action: { _tag: "Point", position: null, guard: false },
                apply: false
              })
            const ready = yield* act("#go")
            assert(ready._tag === "Ready", JSON.stringify(ready))
            assert.isAbove(ready.point?.x ?? 0, 0)
            const covered = yield* act("#under")
            assert(covered._tag === "NotReady")
            assert.deepStrictEqual(covered.reason, { _tag: "Covered", by: `div.overlay "Saving"` })
            const disabled = yield* act("#off")
            assert(disabled._tag === "NotReady")
            assert.deepStrictEqual(disabled.reason, { _tag: "Disabled" })
            const far = yield* act("#far")
            assert(far._tag === "Ready", JSON.stringify(far))
            assert.isTrue(far.scrolled)
            const none = yield* act("#missing")
            assert(none._tag === "NotReady")
            assert.deepStrictEqual(none.reason, { _tag: "NoMatch" })
            const twice = yield* act("button")
            assert(twice._tag === "Strict")
            assert.strictEqual(twice.count, 4)
          }), timeout)
      }
    )
  })
