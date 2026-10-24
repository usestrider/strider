/**
 * The query and actionability engine (review 12), in each browser: the same requests, against the same pages,
 * must give the same answers on every backend, because the engine is ours and runs in the page.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as Engine from "../../../src/internal/engine.ts"
import { type Backend, makeRecorder, site } from "./harness.ts"

const timeout = 60_000

const string = (value: string): Adapter.LocalValue => ({ _tag: "Value", value: { type: "string", value } })

/** A page showing `html`, and a function that sends the engine a request in its utility world. */
const open = Effect.fnUntraced(function*(backend: Backend, html: string) {
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
  const realm = yield* adapter.realm(document, { _tag: "Isolated", name: "__strider_utility__" })
  const call = (functionDeclaration: string, args: ReadonlyArray<Adapter.LocalValue>) =>
    adapter.evaluate(realm, {
      functionDeclaration,
      arguments: args,
      awaitPromise: true,
      result: "value",
      userActivation: false
    })
  const installed = yield* call(Engine.install, [])
  assert(installed._tag === "Value", installed._tag === "Exception" ? installed.text : "")
  const send = Effect.fnUntraced(function*(request: Engine.Request) {
    const result = yield* call(Engine.run, [string(JSON.stringify(request))])
    assert(result._tag === "Value", result._tag === "Exception" ? result.text : "")
    assert(result.value.type === "string")
    return JSON.parse(result.value.value) as Engine.Response
  })
  return { send, adapter, page }
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

export const engine = (backend: Backend) =>
  describe(`${backend.name} engine`, () => {
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
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
            const named = response.roles.filter((each) => each.role !== null && each.role !== "generic")
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
              count(yield* send({ op: "count", steps: [role("button", text("Buy")), { _tag: "Nth", index: -1 }] })),
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
