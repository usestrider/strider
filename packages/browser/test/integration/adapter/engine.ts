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
import { beforeEach } from "vitest"
import * as Browser from "../../../src/Browser.ts"
import * as Expect from "../../../src/Expect.ts"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as Engine from "../../../src/internal/engine.ts"
import { LocatorImpl } from "../../../src/internal/locator.ts"
import * as Operation from "../../../src/internal/operation.ts"
import * as Runtime from "../../../src/internal/runtime.ts"
import { type LinkGeometry, linkGeometry, wrappedLinkHtml, wrappedLinks } from "../wrappedLinks.ts"
import * as Connection from "./engineConnection.ts"
import { type Backend, site } from "./harness.ts"

const timeout = 60_000

const string = (value: string): Adapter.LocalValue => ({ _tag: "Value", value: { type: "string", value } })

/** A page showing `html`, and a function that sends the engine a request in the world the library would use. */
const open = Effect.fnUntraced(function*(_backend: Backend, html: string, beforeInstall?: string, origin?: string) {
  const served = origin === undefined ? yield* site : { origin }
  const { adapter, page, context, facts } = yield* (yield* Connection.Shared).page
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
  return { send, call, adapter, page, context, document, realm }
})

const text = (value: string, exact = false): Engine.TextMatcher => ({ _tag: "String", value, exact })
const role = (
  name: string,
  accessibleName: Engine.TextMatcher | null = null,
  includeHidden = false
): Extract<Engine.Step, { readonly _tag: "Role" }> => ({
  _tag: "Role",
  role: name,
  name: accessibleName,
  includeHidden
})
const all: Engine.Checks = {
  rendered: true,
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

/** Count live browser resources, rather than assuming that a canceled host fiber stops page execution. */
const trackCooperativeResources = `() => {
  const resources = globalThis.engineTestResources = { timers: new Set(), frames: new Set(), observers: new Set(), listeners: new Set() }
  const timer = globalThis.setTimeout.bind(globalThis)
  const clear = globalThis.clearTimeout.bind(globalThis)
  const frame = globalThis.requestAnimationFrame.bind(globalThis)
  const cancel = globalThis.cancelAnimationFrame.bind(globalThis)
  globalThis.setTimeout = (callback, delay) => {
    const id = timer(() => { resources.timers.delete(id); callback() }, delay)
    resources.timers.add(id)
    return id
  }
  globalThis.clearTimeout = (id) => { resources.timers.delete(id); clear(id) }
  globalThis.requestAnimationFrame = (callback) => {
    const id = frame((time) => { resources.frames.delete(id); callback(time) })
    resources.frames.add(id)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => { resources.frames.delete(id); cancel(id) }
  const Observer = globalThis.MutationObserver
  globalThis.MutationObserver = class extends Observer {
    observe(...args) { resources.observers.add(this); return super.observe(...args) }
    disconnect() { resources.observers.delete(this); return super.disconnect() }
  }
  const add = globalThis.addEventListener.bind(globalThis)
  const remove = globalThis.removeEventListener.bind(globalThis)
  globalThis.addEventListener = (type, callback, options) => {
    resources.listeners.add(callback)
    add(type, callback, options)
  }
  globalThis.removeEventListener = (type, callback, options) => {
    resources.listeners.delete(callback)
    remove(type, callback, options)
  }
  Object.defineProperty(globalThis, Symbol.for("@usestrider/browser/clock/real"), {
    value: {
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
      now: performance.now.bind(performance)
    }
  })
  globalThis.cancelAnimationFrame = () => { throw Error("The engine canceled a virtual frame") }
}`

/** Drive the saved real clock deterministically, including automatic terminal-result eviction. */
const controlledCooperativeClock = `() => {
  (${trackCooperativeResources})()
  const real = globalThis[Symbol.for("@usestrider/browser/clock/real")]
  const resources = globalThis.engineTestResources
  let time = 0
  let sequence = 10000
  const timers = new Map()
  real.now = () => time
  real.setTimeout = (callback, delay) => {
    const id = ++sequence
    timers.set(id, { at: time + delay, callback })
    resources.timers.add(id)
    return id
  }
  real.clearTimeout = (id) => { timers.delete(id); resources.timers.delete(id) }
  globalThis.engineTestAdvance = (millis) => {
    time += millis
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0]); resources.timers.delete(due[0]); due[1].callback()
    }
  }
}`

/** Execute the opt-in wire protocol in one evaluation to control frame ordering. */
const cooperativeExercise = Effect.fnUntraced(function*(
  call: Effect.Success<ReturnType<typeof open>>["call"],
  script: string
) {
  const declaration = Engine.cooperate
  assert.strictEqual(typeof declaration, "string", "The engine must expose cooperative execution")
  const result = yield* call(
    `async () => {
    const invoke = ${declaration}
    const command = async (value) => JSON.parse(await invoke(JSON.stringify({
      document: "test-document", operation: "test-operation", session: "test-session", ...value
    })))
    ${script}
  }`,
    []
  )
  assert(result._tag === "Value", result._tag === "Exception" ? result.text : "")
  assert(result.value.type === "string")
  return JSON.parse(result.value.value)
})

export const engine = (backend: Backend) =>
  describe(`${backend.name} engine`, () => {
    let shared: Effect.Success<ReturnType<typeof Connection.make>>
    const isolated = new Set<string>()
    const fixture = Layer.effect(
      Connection.Shared,
      Effect.gen(function*() {
        shared = yield* Connection.make(backend)
        return shared
      })
    ).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor)))
    layer(fixture, { excludeTestServices: true })(
      (it) => {
        for (const cooperative of [false, true]) {
          it.effect(
            `keeps waiting after a baseline when a later blocker recovers with cooperative=${cooperative}`,
            () =>
              Effect.gen(function*() {
                const { send, call } = yield* open(
                  backend,
                  "<button id=\"go\">Go</button>",
                  countFrames("document.getElementById(\"go\").disabled = globalThis.engineTestFrames === 1")
                )
                for (const sample of [false, true]) {
                  yield* call(
                    "() => { globalThis.engineTestFrames = 0; document.getElementById(\"go\").disabled = false }",
                    []
                  )
                  const request = { ...point(2), sample }
                  const response = cooperative
                    ? (yield* cooperativeExercise(
                      call,
                      `
                    let reply = await command({ command: "start", budget: 2000, request: ${JSON.stringify(request)} })
                    for (let i = 0; i < 20 && reply._tag === "Check"; i++) {
                      reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
                    }
                    return JSON.stringify(reply)
                  `
                    )).response
                    : yield* send(request)
                  // The first sample sees only a stable-layout baseline. A later transient blocker must keep
                  // waiting in that same round, just as the ordinary round above does.
                  assert(response?._tag === "Ready", JSON.stringify({ sample, response }))
                }
              }),
            timeout
          )
        }

        for (const cooperative of [false, true]) {
          for (const rendered of [false, true]) {
            it.effect(
              `waits past a stability baseline to Ready in the first round with cooperative=${cooperative} rendered=${rendered}`,
              () =>
                Effect.gen(function*() {
                  const { send, call } = yield* open(backend, "<button id=\"go\">Go</button>", countFrames())
                  const request = { ...point(2), checks: { ...point(2).checks, rendered }, sample: true }
                  const response = cooperative
                    ? (yield* cooperativeExercise(
                      call,
                      `
                    let reply = await command({ command: "start", budget: 2000, request: ${JSON.stringify(request)} })
                    // Each later sample asks the host to check its handlers again.
                    for (let i = 0; i < 20 && reply._tag === "Check"; i++) {
                      reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
                    }
                    return JSON.stringify(reply)
                  `
                    ))
                    : { response: yield* send(request) }
                  // A still, enabled button: the first sample only takes the stability baseline, which is not
                  // evidence, so the round keeps waiting and comes back Ready instead of returning early.
                  assert(response.response?._tag === "Ready", JSON.stringify(response))
                }),
              timeout
            )
          }
        }

        it.effect("returns initial action evidence before waiting for another sample", () =>
          Effect.gen(function*() {
            const { send, call } = yield* open(backend, "<button id=\"go\" disabled>Go</button>", countFrames())
            const request = { ...point(2), sample: true }
            const response = yield* send(request)
            assert(response._tag === "NotReady")
            assert.deepStrictEqual(response.reason, { _tag: "Disabled" })
            assert.deepStrictEqual(response.history, [{ _tag: "Disabled" }])
            assert.strictEqual(response.checked, true)
            assert.strictEqual(yield* framesRead(call), 0)
          }), timeout)

        for (const kind of ["expect", "act"] as const) {
          it.effect(`cooperative initial ${kind} samples after the host checks handlers`, () =>
            Effect.gen(function*() {
              const { call } = yield* open(
                backend,
                "<button id=\"go\" disabled>Actual</button>",
                controlledCooperativeClock
              )
              const request = kind === "act"
                ? { ...point(2), sample: true }
                : {
                  op: "expect",
                  steps: [{ _tag: "Css", selector: "#go" }],
                  cap: 0,
                  expectation: {
                    _tag: "Text",
                    expected: [{ _tag: "String", value: "Expected", exact: true }],
                    list: false
                  }
                }
              const result = yield* cooperativeExercise(
                call,
                `
                let reply = await command({ command: "start", budget: 500, request: ${JSON.stringify(request)} })
                const started = reply._tag
                globalThis.engineTestAdvance(10)
                reply = await command({ command: "resume", token: reply.token, left: 490, decision: "continue" })
                if (reply._tag === "Check") await command({ command: "cancel" })
                return JSON.stringify({ started, reply })
              `
              )
              assert.strictEqual(result.started, "Check")
              assert.strictEqual(result.reply._tag, "Done")
              if (kind === "act") {
                assert.deepStrictEqual(result.reply.response.reason, { _tag: "Disabled" })
                assert.strictEqual(result.reply.response.checked, true)
              } else {
                assert.strictEqual(result.reply.response.observed, "Actual")
                assert.strictEqual(result.reply.response.passed, false)
              }
            }), timeout)
        }

        for (const ending of ["cancel", "departure"] as const) {
          it.effect(`cooperative viewport ${ending} releases its pending round immediately`, () =>
            Effect.gen(function*() {
              const { call } = yield* open(backend, "<div>Missing target</div>", controlledCooperativeClock)
              const result = yield* cooperativeExercise(
                call,
                `
                const first = await command({ command: "start", budget: 2000, request: {
                  op: "expect", steps: [{ _tag: "Css", selector: "#absent" }],
                  expectation: { _tag: "Viewport", ratio: 0, inViewport: true }, cap: 2000
                } })
                const pending = command({ command: "resume", token: first.token, left: 2000, decision: "continue" })
                ${
                  ending === "cancel"
                    ? "await command({ command: \"cancel\" })"
                    : "dispatchEvent(new Event(\"pagehide\"))"
                }
                const remaining = Object.values(globalThis.engineTestResources).map((set) => set.size)
                globalThis.engineTestAdvance(100)
                await pending
                return JSON.stringify(remaining)
              `
              )
              assert.deepStrictEqual(result, [0, 0, 0, 0])
            }), timeout)
        }
        it.effect("cooperative viewport expiry retains observations from its final round", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<div>Missing target</div>", controlledCooperativeClock)
            const result = yield* cooperativeExercise(
              call,
              `
              const first = await command({ command: "start", budget: 50, request: {
                op: "expect", steps: [{ _tag: "Css", selector: "#absent" }],
                expectation: { _tag: "Viewport", ratio: 0, inViewport: true }, cap: 50
              } })
              const pending = command({ command: "resume", token: first.token, left: 50, decision: "continue" })
              globalThis.engineTestAdvance(50)
              const resumed = await pending
              const terminal = await command({ command: "finish" })
              return JSON.stringify({ resumed, terminal })
            `
            )
            assert.strictEqual(result.terminal._tag, "Done")
            assert.deepStrictEqual(result.terminal.response.observed, { matches: 0 })
            assert.strictEqual(result.resumed._tag, "Done")
          }), timeout)
        it.effect("cooperative viewport keeps its last ratio while another observation is pending", () =>
          Effect.gen(function*() {
            const { call } = yield* open(
              backend,
              "<div id=\"target\">Target</div>",
              `() => {
              (${controlledCooperativeClock})()
              let observations = 0
              globalThis.IntersectionObserver = class {
                constructor(callback) { this.callback = callback }
                observe() {
                  if (++observations === 1) queueMicrotask(() => this.callback([{ intersectionRatio: 0 }]))
                }
                disconnect() {}
              }
            }`
            )
            const result = yield* cooperativeExercise(
              call,
              `
              const first = await command({ command: "start", budget: 50, request: {
                op: "expect", steps: [{ _tag: "Css", selector: "#target" }],
                expectation: { _tag: "Viewport", ratio: 0, inViewport: true }, cap: 50
              } })
              const next = await command({ command: "resume", token: first.token, left: 50, decision: "continue" })
              const pending = command({ command: "resume", token: next.token, left: 50, decision: "continue" })
              globalThis.engineTestAdvance(50)
              await pending
              return JSON.stringify(await command({ command: "finish" }))
            `
            )
            assert.strictEqual(result._tag, "Done")
            assert.deepStrictEqual(result.response.observed, { matches: 1, ratio: 0 })
          }), timeout)
        it.effect("cooperative viewport accepts a target whose geometry keeps changing", () =>
          Effect.gen(function*() {
            const { call } = yield* open(
              backend,
              "<div id=\"moving\" style=\"width:100px;height:100px\">Moving</div>",
              `() => {
                const Observer = globalThis.IntersectionObserver
                let offset = 0
                globalThis.IntersectionObserver = class extends Observer {
                  constructor(callback, options) {
                    super((entries, observer) => {
                      document.querySelector('#moving').style.transform = 'translateX(' + ++offset + 'px)'
                      callback(entries, observer)
                    }, options)
                  }
                }
              }`
            )
            const result = yield* cooperativeExercise(
              call,
              `
              let reply = await command({ command: "start", budget: 2000, request: {
                op: "expect", steps: [{ _tag: "Css", selector: "#moving" }],
                expectation: { _tag: "Viewport", ratio: 0, inViewport: true }, cap: 2000
              } })
              let checks = 0
              while (reply._tag === "Check" && checks++ < 8) {
                reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
              }
              await command({ command: "cancel" })
              return JSON.stringify(reply)
            `
            )
            assert.strictEqual(result._tag, "Done")
            assert.isTrue(result.response.passed)
          }), timeout)
        it.effect("cooperative viewport yields before checking an overlay arriving during a round", () =>
          Effect.gen(function*() {
            const { call } = yield* open(
              backend,
              "<div id=\"done\" hidden>Done</div>",
              countFrames(`
              document.querySelector('#done').hidden = false
              if (!document.querySelector('#overlay')) document.body.insertAdjacentHTML('beforeend', '<div id="overlay">Overlay</div>')
            `)
            )
            const result = yield* cooperativeExercise(
              call,
              `
              let reply = await command({ command: "start", budget: 2000, request: {
                op: "expect", steps: [{ _tag: "Css", selector: "#done" }], expectation: { _tag: "Viewport", ratio: 0, inViewport: true }, cap: 2000
              } })
              if (reply._tag !== "Check") throw Error("No initial check")
              reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
              const overlayBeforeCheck = document.querySelector('#overlay') !== null
              const yielded = reply._tag
              document.querySelector('#overlay')?.remove()
              reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "invalidate" })
              return JSON.stringify({ yielded, overlayBeforeCheck, reply })
            `
            )
            assert.strictEqual(result.yielded, "Check")
            assert.isTrue(result.overlayBeforeCheck)
            assert.strictEqual(result.reply._tag, "Done")
            assert.isTrue(result.reply.response.passed)
          }), timeout)
        it.effect("cooperative expectation yields before checking an overlay arriving during a round", () =>
          Effect.gen(function*() {
            const { call } = yield* open(
              backend,
              "<div id=\"done\" hidden>Done</div>",
              countFrames(`
              document.querySelector('#done').hidden = false
              if (!document.querySelector('#overlay')) document.body.insertAdjacentHTML('beforeend', '<div id="overlay">Overlay</div>')
            `)
            )
            const result = yield* cooperativeExercise(
              call,
              `
              let reply = await command({ command: "start", budget: 2000, request: {
                op: "expect", steps: [{ _tag: "Css", selector: "#done" }], expectation: { _tag: "Visible" }, cap: 2000
              } })
              if (reply._tag !== "Check") throw Error("No initial check")
              reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
              const overlayBeforeCheck = document.querySelector('#overlay') !== null
              const yielded = reply._tag
              document.querySelector('#overlay')?.remove()
              reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "invalidate" })
              return JSON.stringify({ yielded, overlayBeforeCheck, reply })
            `
            )
            assert.strictEqual(result.yielded, "Check")
            assert.isTrue(result.overlayBeforeCheck)
            assert.strictEqual(result.reply._tag, "Done")
            assert.isTrue(result.reply.response.passed)
          }), timeout)
        it.effect("cooperative no-handler resumes preserve stable-frame sampling", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<button id=\"go\">Go</button>", countFrames())
            const result = yield* cooperativeExercise(
              call,
              `
              let reply = await command({ command: "start", budget: 2000, request: ${JSON.stringify(point(2))} })
              let checks = 0
              while (reply._tag === "Check" && checks++ < 10) {
                reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
              }
              return JSON.stringify({ reply, checks, frames: globalThis.engineTestFrames })
            `
            )
            assert.strictEqual(result.reply._tag, "Done")
            assert.strictEqual(result.reply.response._tag, "Ready")
            assert.strictEqual(result.frames, 2)
            assert.strictEqual(result.checks, 3)
          }), timeout)
        it.effect("cooperative invalidation discards earlier samples and resolved elements", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<button id=\"go\">Go</button>", countFrames())
            const result = yield* cooperativeExercise(
              call,
              `
              let reply = await command({ command: "start", budget: 2000, request: ${JSON.stringify(point(2))} })
              reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
              document.querySelector('#go').outerHTML = '<button id="go" style="margin-left:80px">New</button>'
              const before = globalThis.engineTestFrames
              reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "invalidate" })
              while (reply._tag === "Check") reply = await command({ command: "resume", token: reply.token, left: 2000, decision: "continue" })
              const frames = globalThis.engineTestFrames - before
              const fresh = await command({ command: "start", budget: 2000, request: ${JSON.stringify(point(0))} })
              const beforeRendered = globalThis.engineTestFrames
              const invalidated = await command({ command: "resume", token: fresh.token, left: 2000, decision: "invalidate" })
              const renderedFrames = globalThis.engineTestFrames - beforeRendered
              const completed = await command({ command: "resume", token: invalidated.token, left: 2000, decision: "continue" })
              return JSON.stringify({ reply, frames, invalidated, renderedFrames, completed })
            `
            )
            assert.strictEqual(result.reply.response._tag, "Ready")
            assert.include(result.reply.response.element, "New")
            assert.strictEqual(result.frames, 2)
            assert.strictEqual(result.invalidated._tag, "Check")
            assert.strictEqual(result.renderedFrames, 1)
            assert.strictEqual(result.completed.response._tag, "Ready")
          }), timeout)
        it.effect("cooperative final checks restart before in-page application", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<input id=\"go\">")
            const request = {
              ...point(0),
              checks: { ...all, rendered: false, stable: 0 },
              action: { _tag: "Focus" },
              apply: true
            }
            const result = yield* cooperativeExercise(
              call,
              `
              const first = await command({ command: "start", budget: 2000, request: ${JSON.stringify(request)} })
              const reply = await command({ command: "resume", token: first.token, left: 2000, decision: "restart" })
              const replay = await command({ command: "resume", token: first.token, left: 2000, decision: "continue" })
              return JSON.stringify({ final: first.final, reply, replay, applied: document.activeElement.id === "go" })
            `
            )
            assert.isTrue(result.final)
            assert.strictEqual(result.reply._tag, "Restart")
            assert.strictEqual(result.replay._tag, "Disposed")
            assert.isFalse(result.applied)
          }), timeout)
        it.effect("cooperative tokens enforce ownership, single use and cancellation during a frame wait", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<button id=\"go\">Go</button>")
            const result = yield* cooperativeExercise(
              call,
              `
              const first = await command({ command: "start", budget: 2000, request: ${JSON.stringify(point(2))} })
              const wrongDocument = await command({ command: "resume", document: "other", token: first.token, left: 2000, decision: "continue" })
              const foreign = await command({ command: "resume", operation: "other", token: first.token, left: 2000, decision: "continue" })
              const pending = command({ command: "resume", token: first.token, left: 2000, decision: "continue" })
              const replay = await command({ command: "resume", token: first.token, left: 2000, decision: "continue" })
              await command({ command: "cancel" })
              const canceled = await pending
              const second = await command({ command: "start", budget: 2000, request: ${JSON.stringify(point(2))} })
              const departing = command({ command: "resume", token: second.token, left: 2000, decision: "continue" })
              dispatchEvent(new Event("pagehide"))
              const departed = await departing
              const afterNavigation = await command({ command: "resume", token: second.token, left: 2000, decision: "continue" })
              return JSON.stringify({ wrongDocument, foreign, replay, canceled, afterNavigation, departed })
            `
            )
            assert.strictEqual(result.departed._tag, "Departed")
            delete result.departed
            for (const response of Object.values(result)) {
              assert.strictEqual((response as { _tag: string })._tag, "Disposed")
            }
          }), timeout)
        it.effect("cooperative cancellation and deadline expiry release observers, frames, timers and listeners", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<div id=\"done\" hidden>Done</div>", trackCooperativeResources)
            const result = yield* cooperativeExercise(
              call,
              `
              const request = { op: "expect", steps: [{ _tag: "Css", selector: "#done" }], expectation: { _tag: "Visible" }, cap: 2000 }
              const first = await command({ command: "start", budget: 2000, request })
              const pending = command({ command: "resume", token: first.token, left: 2000, decision: "continue" })
              await command({ command: "cancel" })
              await pending
              const afterCancel = Object.values(globalThis.engineTestResources).map((set) => set.size)
              const second = await command({ command: "start", budget: 2000, request })
              const expired = await command({ command: "resume", token: second.token, left: 0, decision: "continue" })
              const afterExpiry = Object.values(globalThis.engineTestResources).map((set) => set.size)
              return JSON.stringify({ afterCancel, expired, afterExpiry })
            `
            )
            assert.deepStrictEqual(result.afterCancel, [0, 0, 0, 0])
            assert.strictEqual(result.expired._tag, "Done")
            assert.isFalse(result.expired.response.passed)
            assert.deepStrictEqual(result.afterExpiry, [0, 0, 0, 0])
          }), timeout)
        it.effect("cooperative expiry while the host holds a token still answers with the timeout evidence", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<button id=\"go\" hidden>Go</button>")
            // The browser-side timer expires the session while the host is probing triggers. Its resume must
            // receive the terminal response the expiry computed (why the target wasn't actionable), as a resume
            // that arrives with no time left does, not Disposed, which discards that evidence and reroutes.
            const result = yield* cooperativeExercise(
              call,
              `
              let control = await command({ command: "start", budget: 2000, request: ${JSON.stringify(point(0))} })
              control = await command({ command: "resume", token: control.token, left: 2000, decision: "continue" })
              const answered = await command({ command: "resume", token: control.token, left: 0, decision: "continue" })
              let first = await command({ command: "start", budget: 100, request: ${JSON.stringify(point(0))} })
              first = await command({ command: "resume", token: first.token, left: 100, decision: "continue" })
              await new Promise((resolve) => setTimeout(resolve, 300))
              const expired = await command({ command: "resume", token: first.token, left: 0, decision: "continue" })
              return JSON.stringify({ answered, expired })
            `
            )
            assert.strictEqual(result.answered._tag, "Done")
            assert.strictEqual(result.expired._tag, "Done", JSON.stringify(result.expired))
            assert.strictEqual(result.expired.response._tag, result.answered.response._tag)
            assert.deepStrictEqual(result.answered.response.reason, { _tag: "NotVisible" })
            assert.deepStrictEqual(result.expired.response.reason, { _tag: "NotVisible" })
            assert.deepStrictEqual(result.expired.response.history, [{ _tag: "NotVisible" }])
          }), timeout)
        it.effect("cooperative expired observations are owned, consumed once, and cleared on cancel or departure", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<div id=\"go\">actual</div>", controlledCooperativeClock)
            const result = yield* cooperativeExercise(
              call,
              `
              const resources = () => Object.values(globalThis.engineTestResources).map((set) => set.size)
              const request = { op: "expect", steps: [{ _tag: "Css", selector: "#go" }], cap: 1000,
                expectation: { _tag: "Text", expected: [{ _tag: "String", value: "expected", exact: true }], list: false } }
              const expired = async (session) => {
                document.querySelector('#go').textContent = "actual"
                let reply = await command({ command: "start", session, budget: 100, request })
                reply = await command({ command: "resume", session, token: reply.token, left: 100, decision: "continue" })
                globalThis.engineTestAdvance(100)
                document.querySelector('#go').textContent = "changed after expiry"
                return reply.token
              }
              const token = await expired("consume")
              const retained = resources()
              const foreignFinish = await command({ command: "finish", session: "consume", operation: "other" })
              const foreign = await command({ command: "resume", session: "consume", operation: "other", token, left: 0, decision: "continue" })
              const wrongDocument = await command({ command: "resume", session: "consume", document: "other", token, left: 0, decision: "continue" })
              const consumed = await command({ command: "resume", session: "consume", token, left: 0, decision: "continue" })
              const replay = await command({ command: "resume", session: "consume", token, left: 0, decision: "continue" })
              const afterConsumption = resources()
              document.querySelector('#go').textContent = "actual"
              const waiting = await command({ command: "start", session: "pending", budget: 100, request })
              const pending = command({ command: "resume", session: "pending", token: waiting.token, left: 100, decision: "continue" })
              globalThis.engineTestAdvance(100)
              const stopped = await pending
              const finished = await command({ command: "finish", session: "pending" })
              const finishedReplay = await command({ command: "resume", session: "pending", token: waiting.token, left: 0, decision: "continue" })
              const afterFinish = resources()
              const canceledToken = await expired("cancel")
              await command({ command: "cancel", session: "cancel" })
              const canceled = await command({ command: "resume", session: "cancel", token: canceledToken, left: 0, decision: "continue" })
              const afterCancel = resources()
              const departedToken = await expired("depart")
              dispatchEvent(new Event("pagehide"))
              const departed = await command({ command: "resume", session: "depart", token: departedToken, left: 0, decision: "continue" })
              const afterDeparture = resources()
              const abandonedToken = await expired("abandon")
              globalThis.engineTestAdvance(30000)
              const afterRetention = resources()
              const abandoned = await command({ command: "resume", session: "abandon", token: abandonedToken, left: 0, decision: "continue" })
              return JSON.stringify({ retained, foreignFinish, foreign, wrongDocument, consumed, replay, afterConsumption,
                stopped, finished, finishedReplay, afterFinish, canceled, afterCancel, departed, afterDeparture, abandoned, afterRetention })
            `
            )
            assert.deepStrictEqual(result.retained, [1, 0, 0, 1])
            assert.strictEqual(result.consumed._tag, "Done")
            assert.strictEqual(result.consumed.response.observed, "actual")
            assert.isFalse(result.consumed.response.passed)
            assert.isTrue(result.stopped.retained)
            assert.strictEqual(result.finished.response.observed, "actual")
            for (
              const key of [
                "foreignFinish",
                "foreign",
                "wrongDocument",
                "replay",
                "finishedReplay",
                "canceled",
                "departed",
                "abandoned"
              ]
            ) {
              assert.strictEqual(result[key]._tag, "Disposed", key)
            }
            for (const key of ["afterConsumption", "afterFinish", "afterCancel", "afterDeparture", "afterRetention"]) {
              assert.deepStrictEqual(result[key], [0, 0, 0, 0], key)
            }
          }), timeout)
        it.effect("cooperative abandoned terminal storage is bounded by count and serialized size", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<div id=\"go\">actual</div>", controlledCooperativeClock)
            const result = yield* cooperativeExercise(
              call,
              `
              const request = { op: "expect", steps: [], cap: 1000, expectation: { _tag: "Title", expected: { _tag: "String", value: "expected", exact: true } } }
              const tokens = []
              for (let index = 0; index < 65; index++) {
                const session = "count-" + index
                const reply = await command({ command: "start", session, budget: 100, request })
                tokens.push(reply.token)
                globalThis.engineTestAdvance(100)
              }
              const oldest = await command({ command: "resume", session: "count-0", token: tokens[0], left: 0, decision: "continue" })
              const newest = await command({ command: "resume", session: "count-64", token: tokens[64], left: 0, decision: "continue" })
              dispatchEvent(new Event("pagehide"))
              document.title = "x".repeat(300000)
              const large = []
              for (let index = 0; index < 2; index++) {
                const session = "size-" + index
                let reply = await command({ command: "start", session, budget: 100, request })
                reply = await command({ command: "resume", session, token: reply.token, left: 100, decision: "continue" })
                large.push(reply.token)
                globalThis.engineTestAdvance(100)
              }
              const evicted = await command({ command: "resume", session: "size-0", token: large[0], left: 0, decision: "continue" })
              const kept = await command({ command: "resume", session: "size-1", token: large[1], left: 0, decision: "continue" })
              document.title = "x".repeat(600000)
              let oversized = await command({ command: "start", session: "oversized", budget: 100, request })
              oversized = await command({ command: "resume", session: "oversized", token: oversized.token, left: 100, decision: "continue" })
              globalThis.engineTestAdvance(100)
              oversized = await command({ command: "resume", session: "oversized", token: oversized.token, left: 0, decision: "continue" })
              return JSON.stringify({ oldest, newest, evicted, oversized, keptTag: kept._tag, observedLength: kept.response?.observed.length,
                resources: Object.values(globalThis.engineTestResources).map((set) => set.size) })
            `
            )
            assert.strictEqual(result.oldest._tag, "Disposed")
            assert.strictEqual(result.newest._tag, "Done")
            assert.strictEqual(result.evicted._tag, "Disposed")
            assert.strictEqual(result.oversized._tag, "Disposed")
            assert.strictEqual(result.keptTag, "Done")
            assert.strictEqual(result.observedLength, 300000)
            assert.deepStrictEqual(result.resources, [0, 0, 0, 0])
          }), timeout)
        it.effect("cooperative runtime probes a top-document trigger while the target is cross-origin", () =>
          Effect.gen(function*() {
            const served = yield* site
            const browser = BrowserImpl.layer((sink) =>
              backend.connect(sink).pipe(Effect.map(({ adapter }) =>
                adapter
              ))
            )
            yield* Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const child = `${served.crossSite}/fixture?html=${encodeURIComponent("<button id=\"go\">Go</button>")}`
              yield* page.goto(
                `${served.origin}/fixture?html=${
                  encodeURIComponent(
                    `<div id="overlay">Overlay</div><iframe src="${child.replaceAll("&", "&amp;")}"></iframe>`
                  )
                }`
              )
              const target = page.frame(page.locator("iframe")).locator("#go") as LocatorImpl
              const trigger = page.locator("#overlay") as LocatorImpl
              let probes = 0
              let removals = 0
              const reply = yield* Effect.gen(function*() {
                const record = yield* Operation.record
                return yield* Runtime.sendCooperative(
                  target.owner.runtime,
                  target.owner.page,
                  {
                    op: "expect",
                    steps: target.steps,
                    expectation: { _tag: "Visible" },
                    cap: 2000
                  },
                  record.id,
                  record.budget.at,
                  (routed, final) =>
                    Effect.gen(function*() {
                      assert.isFalse(final)
                      const visible = yield* Runtime.send(
                        trigger.owner.runtime,
                        trigger.owner.page,
                        { op: "visible", steps: trigger.steps },
                        record.id,
                        record.budget.at
                      )
                      assert.strictEqual(visible._tag, "Visible")
                      const top = yield* Runtime.openState(trigger.owner.page, record.id)
                      assert.notStrictEqual(routed.document, top.document.id)
                      assert.strictEqual(routed.hops.length, 1)
                      probes++
                      if (visible._tag === "Visible" && visible.visible) {
                        yield* page.evaluateInMainWorld(() =>
                          document.querySelector("#overlay")!.setAttribute("hidden", "")
                        )
                        removals++
                        return "invalidate" as const
                      }
                      return "continue" as const
                    })
                )
              }).pipe(Operation.named("Test.cooperativeFrame"))
              assert(!("_tag" in reply))
              assert.strictEqual(reply.response._tag, "Expected")
              if (reply.response._tag === "Expected") {
                assert.isTrue(reply.response.passed)
              }
              assert.isAtLeast(probes, 1)
              assert.strictEqual(removals, 1)
            }).pipe(Effect.scoped, Effect.provide(browser))
          }), timeout)
        it.effect("cooperative runtime follows a navigation during a waiting round instead of failing", () =>
          Effect.gen(function*() {
            const served = yield* site
            const browser = BrowserImpl.layer((sink) =>
              backend.connect(sink).pipe(Effect.map(({ adapter }) =>
                adapter
              ))
            )
            yield* Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const next = `${served.origin}/fixture?html=${encodeURIComponent("<div id=\"done\">Done</div>")}`
              // The page leaves while the engine waits; pagehide disposes the session, as a navigation does in
              // ordinary dispatch, and the target must then be found again in the new document.
              yield* page.goto(
                `${served.origin}/fixture?html=${
                  encodeURIComponent(
                    `<div id="done" hidden>Done</div><script>setTimeout(() => { location.href = ${
                      JSON.stringify(next)
                    } }, 300)</script>`
                  )
                }`
              )
              const target = page.locator("#done") as LocatorImpl
              const reply = yield* Effect.gen(function*() {
                const record = yield* Operation.record
                return yield* Runtime.sendCooperative(
                  target.owner.runtime,
                  target.owner.page,
                  { op: "expect", steps: target.steps, expectation: { _tag: "Visible" }, cap: 2000 },
                  record.id,
                  record.budget.at,
                  () =>
                    Effect.succeed("continue" as const)
                )
              }).pipe(Operation.named("Test.cooperativeNavigation"), Effect.result)
              assert(reply._tag === "Success", JSON.stringify(reply))
              assert(!("_tag" in reply.success))
              assert.strictEqual(reply.success.response._tag, "Expected")
              if (reply.success.response._tag === "Expected") {
                assert.isTrue(reply.success.response.passed)
              }
            }).pipe(Effect.scoped, Effect.provide(browser))
          }), timeout)
        it.effect("owns viewport observers only during requested rounds and releases them independently", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(
              backend,
              `<div id="go" style="position:absolute;top:100000px;width:100px;height:100px"></div>`,
              `function() {
                globalThis.viewportActive = 0;
                globalThis.viewportCreated = 0;
                const Native = globalThis.IntersectionObserver;
                globalThis.IntersectionObserver = class {
                  active = true;
                  constructor(callback, options) {
                    this.native = new Native(callback, options);
                    globalThis.viewportActive++;
                    globalThis.viewportCreated++;
                  }
                  observe(element) { this.native.observe(element); }
                  disconnect() {
                    if (this.active) { globalThis.viewportActive--; this.active = false; }
                    this.native.disconnect();
                  }
                };
              }`
            )
            yield* send({ op: "count", steps: [] })
            const result = yield* call(
              `async function() {
              const engine = globalThis[Symbol.for(${JSON.stringify(Engine.installKey)})];
              const unused = globalThis.viewportCreated;
              const request = { op: 'expect', steps: [{ _tag: 'Css', selector: '#go' }],
                expectation: { _tag: 'Viewport', ratio: 0, inViewport: true }, cap: 10000 };
              const first = engine.run(JSON.stringify({ ...request, token: 'first' }));
              const second = engine.run(JSON.stringify({ ...request, token: 'second' }));
              const during = globalThis.viewportActive;
              await engine.run(JSON.stringify({ op: 'expectStop', token: 'first' }));
              await first;
              const remaining = globalThis.viewportActive;
              await engine.run(JSON.stringify({ op: 'expectStop', token: 'second' }));
              await second;
              const stopped = globalThis.viewportActive;
              await engine.run(JSON.stringify({ ...request, cap: 100, token: 'timeout' }));
              const timedOut = globalThis.viewportActive;
              await engine.run(JSON.stringify({ ...request, token: 'success', expectation: {
                ...request.expectation, inViewport: false
              } }));
              return JSON.stringify({ unused, during, remaining, stopped, timedOut, success: globalThis.viewportActive });
            }`,
              []
            )
            assert(result._tag === "Value")
            assert(result.value.type === "string")
            assert.deepStrictEqual(JSON.parse(result.value.value), {
              unused: 0,
              during: 2,
              remaining: 1,
              stopped: 0,
              timedOut: 0,
              success: 0
            })
          }), timeout)

        for (const publicExpectation of [false, true]) {
          const name = `${
            publicExpectation ? "public expectation" : "ordinary runtime"
          } follows a navigation during a waiting round`
          isolated.add(name)
          it.effect(
            name,
            () =>
              Effect.gen(function*() {
                const served = yield* site
                const browser = BrowserImpl.layer((sink) =>
                  backend.connect(sink).pipe(Effect.map(({ adapter }) =>
                    adapter
                  ))
                )
                yield* Effect.gen(function*() {
                  const page = yield* Browser.newPage()
                  const next = `${served.origin}/fixture?html=${encodeURIComponent("<div id=\"done\">Done</div>")}`
                  // Replace the document while the engine is waiting for the hidden target.
                  yield* page.goto(
                    `${served.origin}/fixture?html=${
                      encodeURIComponent(
                        `<div id="done" hidden>Done</div><script>setTimeout(() => { location.href = ${
                          JSON.stringify(next)
                        } }, 300)</script>`
                      )
                    }`
                  )
                  if (publicExpectation) {
                    yield* page.locator("#done").pipe(Expect.toBeVisible)
                    return
                  }
                  const target = page.locator("#done") as LocatorImpl
                  const reply = yield* Effect.gen(function*() {
                    const record = yield* Operation.record
                    return yield* Runtime.send(
                      target.owner.runtime,
                      target.owner.page,
                      { op: "expect", steps: target.steps, expectation: { _tag: "Visible" }, cap: 2000 },
                      record.id,
                      record.budget.at
                    )
                  }).pipe(Operation.named("Test.ordinaryNavigation"), Effect.result)
                  assert(reply._tag === "Success", JSON.stringify(reply))
                  assert.strictEqual(reply.success._tag, "Expected")
                  if (reply.success._tag === "Expected") {
                    assert.isTrue(reply.success.passed)
                  }
                }).pipe(Effect.scoped, Effect.provide(browser))
              }),
            timeout
          )
        }
        it.effect("returns bounded rendering timing evidence with an ordinary action response", () =>
          Effect.gen(function*() {
            const { call } = yield* open(backend, "<button id=\"go\">Go</button>")
            const result = yield* call(Engine.run, [string(JSON.stringify(point(0)))])
            assert(result._tag === "Value")
            assert(result.value.type === "string")
            const response = JSON.parse(result.value.value)
            assert.strictEqual(response._tag, "Ready")
            assert.isAtLeast(response.__rendering.events.length, 1)
            assert.isAtMost(response.__rendering.events.length, 32)
            assert.strictEqual(response.__rendering.events[0].winner, "callback")
            assert.strictEqual(response.__rendering.events[0].clock, "page-performance-ms")
            assert.isNumber(response.__rendering.events[0].callback)
            const extension = yield* call(
              `() => Object.prototype.hasOwnProperty.call(
              globalThis, Symbol.for("@usestrider/browser/engine/cooperative/1")
            )`,
              []
            )
            assert(extension._tag === "Value" && extension.value.type === "boolean")
            assert.isFalse(extension.value.value)
          }), timeout)
        for (const state of ["pressed", "expanded", "selected"] as const) {
          it.effect(`includes ASCII case-insensitive ${state} in snapshots as in role filters`, () =>
            Effect.gen(function*() {
              const name = state === "selected" ? "tab" : "button"
              const html = `<div role="${name}" aria-${state}="TRUE">State</div>`
              const { send } = yield* open(backend, html)
              assert.strictEqual(count(yield* send({ op: "count", steps: [{ ...role(name), [state]: true }] })), 1)
              assert.strictEqual(count(yield* send({ op: "count", steps: [{ ...role(name), [state]: false }] })), 0)
              const snapshot = yield* send({ op: "snapshot", steps: null, interactivity: false, depth: null })
              assert(snapshot._tag === "Snapshot")
              assert.include(snapshot.root.children[0]!.states, state)
            }), timeout)
        }

        it.effect("uses native option selection before aria-selected in snapshots as in role filters", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<select multiple><option aria-selected="true">Unselected</option></select>`
            )
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [{ ...role("option", null, true), selected: true }] })),
              0
            )
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [{ ...role("option", null, true), selected: false }] })),
              1
            )
            const snapshot = yield* send({
              op: "snapshot",
              steps: [{ _tag: "Css", selector: "option" }],
              interactivity: false,
              depth: null
            })
            assert(snapshot._tag === "Snapshot")
            assert.notInclude(snapshot.root.states, "selected")
          }), timeout)

        it.effect("shares state role gating and native details precedence with snapshots", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<article aria-pressed="true" aria-expanded="true" aria-selected="true">Article</article>
              <details open aria-expanded="false"><summary>Open</summary></details>
              <details aria-expanded="true"><summary>Closed</summary></details>
              <details role="button" open aria-expanded="false"><summary>Button open</summary></details>
              <details role="button" aria-expanded="true"><summary>Button closed</summary></details>
              <select multiple><option selected aria-selected="false">Selected</option></select>`
            )
            for (const state of ["pressed", "expanded", "selected"] as const) {
              for (const value of [true, false]) {
                assert.strictEqual(
                  (yield* send({
                    op: "count",
                    steps: [{ ...role("article"), [state]: value }]
                  }))._tag,
                  "InvalidSelector"
                )
              }
            }
            for (const value of [true, false]) {
              assert.strictEqual(
                (yield* send({
                  op: "count",
                  steps: [{ ...role("group"), expanded: value }]
                }))._tag,
                "InvalidSelector"
              )
              assert.strictEqual(
                count(
                  yield* send({
                    op: "count",
                    steps: [{ ...role("button"), expanded: value }]
                  })
                ),
                1
              )
              assert.strictEqual(
                count(
                  yield* send({
                    op: "count",
                    steps: [{ ...role("option", null, true), selected: value }]
                  })
                ),
                value ? 1 : 0
              )
            }
            for (
              const [selector, expected] of [
                ["article", []],
                ["details:nth-of-type(1)", ["expanded"]],
                ["details:nth-of-type(2)", []],
                ["details:nth-of-type(3)", ["expanded"]],
                ["details:nth-of-type(4)", []],
                ["option", ["selected"]]
              ] as const
            ) {
              const snapshot = yield* send({
                op: "snapshot",
                steps: [{ _tag: "Css", selector }],
                interactivity: false,
                depth: 0
              })
              assert(snapshot._tag === "Snapshot")
              assert.deepEqual(snapshot.root.states, expected, selector)
            }
          }), timeout)

        it.effect("preserves state token defaults without trimming in filters and snapshots", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(backend, "<div id=\"state\">State</div>")
            for (const state of ["pressed", "expanded", "selected"] as const) {
              const name = state === "selected" ? "tab" : "button"
              for (
                const token of [
                  null,
                  "",
                  "true",
                  "True",
                  "FALSE",
                  "mixed",
                  "MIXED",
                  "undefined",
                  "UNDEFINED",
                  " true ",
                  " false ",
                  " mixed ",
                  "\t",
                  "bogus",
                  "1"
                ]
              ) {
                yield* call(
                  `(state, name, encoded) => {
                  const token = JSON.parse(encoded)
                  const element = document.getElementById("state")
                  for (const key of ["pressed", "expanded", "selected"]) element.removeAttribute("aria-" + key)
                  element.setAttribute("role", name)
                  if (token !== null) element.setAttribute("aria-" + state, token)
                }`,
                  [string(state), string(name), string(JSON.stringify(token))]
                )
                const positive = token === "true" || token === "True"
                const neither = state === "expanded" && token === null ||
                  state === "pressed" && (token === "mixed" || token === "MIXED")
                for (const value of [true, false]) {
                  assert.strictEqual(
                    count(
                      yield* send({
                        op: "count",
                        steps: [{ ...role(name), [state]: value }]
                      })
                    ),
                    (value ? positive : !positive && !neither) ? 1 : 0,
                    JSON.stringify({ state, token, value })
                  )
                }
                const snapshot = yield* send({
                  op: "snapshot",
                  steps: [{ _tag: "Css", selector: "#state" }],
                  interactivity: false,
                  depth: 0
                })
                assert(snapshot._tag === "Snapshot")
                assert.strictEqual(snapshot.root.states.includes(state), positive, JSON.stringify({ state, token }))
              }
            }
          }), timeout)

        it.effect("collects field metadata only for masking snapshots and clears it across mode switches", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(
              backend,
              `<h2 contenteditable>private</h2><div onclick="void 0"><div role="textbox"><span>nested</span></div></div>`,
              `() => {
                globalThis.fieldReads = 0
                globalThis.editabilityReads = 0
                const heading = document.querySelector("h2")
                const editable = heading.isContentEditable
                Object.defineProperty(heading, "isContentEditable", { get() { globalThis.editabilityReads++; return editable } })
                const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "assignedSlot")
                Object.defineProperty(Element.prototype, "assignedSlot", {
                  ...descriptor, get() { globalThis.fieldReads++; return descriptor.get.call(this) }
                })
              }`
            )
            for (const provenance of [false, true, false, true]) {
              yield* call(`() => { globalThis.fieldReads = 0; globalThis.editabilityReads = 0 }`, [])
              const response = yield* send(
                { op: "snapshot", steps: null, interactivity: true, depth: null, provenance } as Engine.Request
              )
              assert.strictEqual(response._tag, "Snapshot")
              if (response._tag !== "Snapshot") {
                return
              }
              assert.strictEqual(JSON.stringify(response.root).includes("\"fieldContent\":true"), provenance)
              assert.strictEqual(JSON.stringify(response.root).includes("\"editable\":true"), provenance)
              const reads = yield* call(`() => String(globalThis.fieldReads)`, [])
              assert(reads._tag === "Value" && reads.value.type === "string")
              if (provenance) {
                assert.isAbove(Number(reads.value.value), 0)
              } else assert.strictEqual(Number(reads.value.value), 0)
              const classifications = yield* call(`() => String(globalThis.editabilityReads)`, [])
              assert(classifications._tag === "Value" && classifications.value.type === "string")
              if (provenance) {
                assert.isAbove(Number(classifications.value.value), 0)
              } else assert.strictEqual(Number(classifications.value.value), 0)
            }
          }), timeout)

        it.effect("carries field editability independently of semantics and enabled state", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<article contenteditable="true" aria-label="Article">private</article><p contenteditable="plaintext-only">plain</p><h2 contenteditable="true">secret heading</h2><input aria-label="Native" readonly><textarea disabled>value</textarea><select><option>Choice</option></select><div role="textbox" aria-label="ARIA">aria value</div><select multiple aria-label="Choices"><option>Choice</option></select><div role="slider" aria-label="Range">range value</div><button>Outside</button>`
            )
            const answer = yield* send({
              op: "snapshot",
              steps: null,
              interactivity: true,
              depth: null,
              provenance: true
            })
            assert.strictEqual(answer._tag, "Snapshot")
            if (answer._tag !== "Snapshot") {
              return
            }
            const nodes = answer.root.children
            assert.deepStrictEqual(nodes.map((node) => [node.role.role, node.editable === true]), [
              ["article", true],
              ["paragraph", true],
              ["heading", true],
              ["textbox", true],
              ["textbox", true],
              ["combobox", true],
              ["textbox", true],
              ["listbox", true],
              ["slider", true],
              ["button", false]
            ])
            assert.deepStrictEqual(nodes[2]!.name, {
              _tag: "Accessible",
              value: "secret heading",
              from: "text",
              fieldContent: true
            })
            assert.deepStrictEqual(nodes[0]!.name, { _tag: "Accessible", value: "Article" })
          }), timeout)

        it.effect("reports accessible-name mismatches and cardinality on an immediate check", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button id="named" aria-label="Updated"></button><button class="many">One</button><button class="many">Two</button>`
            )
            for (
              const [selector, expected, observed] of [
                ["#named", { _tag: "String", value: "updated", exact: true }, "Updated"],
                ["#named", { _tag: "RegExp", source: "updated", flags: "" }, "Updated"],
                ["#named", { _tag: "RegExp", source: "Updated  ", flags: "" }, "Updated"],
                ["#missing", { _tag: "String", value: "", exact: true }, { matches: 0 }],
                [".many", { _tag: "RegExp", source: "One", flags: "" }, { matches: 2 }]
              ] as const
            ) {
              const response = yield* send({
                op: "expect",
                steps: [{ _tag: "Css", selector }],
                cap: 0,
                expectation: { _tag: "AccessibleName", expected, ignoreCase: false }
              })
              assert.deepStrictEqual(response, { _tag: "Expected", passed: false, observed, changed: false })
            }
          }))

        it.effect("tracks chosen name contributions from fields without tainting public labels", () =>
          Effect.gen(function*() {
            const { send, call } = yield* open(
              backend,
              `<h2><span contenteditable>ancestor-private</span></h2><button aria-label="Public"><span contenteditable>ignored-private</span></button><input id="field" aria-label="Field" value="embedded-private"><button aria-labelledby="field"></button><div>Nearby public</div><div contenteditable></div><span id="label" contenteditable aria-label="Referenced public"></span><button aria-labelledby="label"></button>`
            )
            const answer = yield* send({
              op: "snapshot",
              steps: null,
              interactivity: true,
              depth: null,
              provenance: true
            })
            assert.strictEqual(answer._tag, "Snapshot")
            if (answer._tag !== "Snapshot") {
              return
            }
            const names = new Map(
              answer.root.children.flatMap((node) =>
                node.name._tag === "None" ? [] : [[node.name.value, node.name]]
              )
            )
            assert.deepStrictEqual(names.get("ancestor-private"), {
              _tag: "Accessible",
              value: "ancestor-private",
              fieldContent: true
            })
            assert.deepStrictEqual(names.get("embedded-private"), {
              _tag: "Accessible",
              value: "embedded-private",
              fieldContent: true
            })
            assert.deepStrictEqual(names.get("Public"), { _tag: "Accessible", value: "Public" })
            assert.deepStrictEqual(names.get("Field"), { _tag: "Accessible", value: "Field" })
            assert.deepStrictEqual(names.get("Referenced public"), { _tag: "Accessible", value: "Referenced public" })
            assert.deepStrictEqual(names.get("Nearby public"), {
              _tag: "Inferred",
              value: "Nearby public",
              from: "nearbyLabel"
            })
            const changed = yield* call(
              `() => {
              document.querySelector('h2').setAttribute('aria-label', 'Changed public')
              document.querySelector('button').removeAttribute('aria-label')
            }`,
              []
            )
            assert.strictEqual(changed._tag, "Value")
            const next = yield* send({
              op: "snapshot",
              steps: null,
              interactivity: true,
              depth: null,
              provenance: true
            })
            assert.strictEqual(next._tag, "Snapshot")
            if (next._tag !== "Snapshot") {
              return
            }
            assert.deepStrictEqual(next.root.children[0]!.name, { _tag: "Accessible", value: "Changed public" })
            assert.deepStrictEqual(next.root.children[1]!.name, {
              _tag: "Accessible",
              value: "ignored-private",
              fieldContent: true
            })
          }), timeout)

        it.effect("marks actual name contributors under native and ARIA fields while preserving explicit labels", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<select aria-label="Plan"><option id="option" selected>option value</option></select><button aria-labelledby="option"></button><div role="textbox" aria-label="Field"><span id="nested">nested value</span><span id="public" aria-label="Explicit public">ignored value</span><input id="action" type="button" value="action value"></div><button aria-labelledby="nested"></button><button aria-labelledby="public"></button><button aria-labelledby="action"></button><article contenteditable aria-label="Editor"><span id="blocked" contenteditable="false">blocked value</span></article><button aria-labelledby="blocked"></button><div role="textbox"><span id="empty"> </span></div><button aria-labelledby="empty" aria-label="Fallback public"></button>`
            )
            const answer = yield* send({
              op: "snapshot",
              steps: null,
              interactivity: true,
              depth: null,
              provenance: true
            })
            assert.strictEqual(answer._tag, "Snapshot")
            if (answer._tag !== "Snapshot") {
              return
            }
            const buttons = answer.root.children.filter((node) =>
              node.role.role === "button"
            )
            assert.deepStrictEqual(
              buttons.map((node) =>
                node.name
              ),
              [
                { _tag: "Accessible", value: "option value", fieldContent: true },
                { _tag: "Accessible", value: "nested value", fieldContent: true },
                { _tag: "Accessible", value: "Explicit public" },
                { _tag: "Accessible", value: "action value", fieldContent: true },
                { _tag: "Accessible", value: "blocked value", fieldContent: true },
                { _tag: "Accessible", value: "Fallback public" }
              ]
            )
          }), timeout)

        it.effect("follows field ancestry through shadow hosts and assigned slots", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<div id="host"><span id="assigned" slot="private">assigned value</span></div><button aria-labelledby="assigned"></button><div id="shadow" role="textbox" aria-label="Shadow field"></div>`,
              `() => {
                document.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<div role="textbox" aria-label="Slot field"><slot name="private"></slot></div>'
                document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML = '<span id="source">shadow value</span><button aria-labelledby="source"></button>'
              }`
            )
            const answer = yield* send({
              op: "snapshot",
              steps: null,
              interactivity: true,
              depth: null,
              provenance: true
            })
            assert.strictEqual(answer._tag, "Snapshot")
            if (answer._tag !== "Snapshot") {
              return
            }
            const buttons: Array<Engine.SnapNode["name"]> = []
            const visit = (node: Engine.SnapNode) => {
              if (node.role.role === "button") {
                buttons.push(node.name)
              }
              for (const child of node.children) {
                visit(child)
              }
            }
            visit(answer.root)
            assert.deepStrictEqual(buttons, [
              { _tag: "Accessible", value: "assigned value", fieldContent: true },
              { _tag: "Accessible", value: "shadow value", fieldContent: true }
            ])
          }), timeout)

        it.effect("invalidates field ancestry and subtree text caches after slot, role and parent changes", () =>
          Effect.gen(function*() {
            const { send, call } = yield* open(
              backend,
              `<div id="host"><span id="moving" slot="private">moving value</span></div><button aria-labelledby="moving"></button><div id="clickable" onclick="void 0"><span id="text">inferred value</span></div>`,
              `() => { document.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<div role="textbox" aria-label="Slot field"><slot name="private"></slot></div><slot name="public"></slot>' }`
            )
            const check = Effect.fnUntraced(function*(privateReference: boolean, privateText: boolean) {
              const answer = yield* send({
                op: "snapshot",
                steps: null,
                interactivity: true,
                depth: null,
                provenance: true
              })
              assert.strictEqual(answer._tag, "Snapshot")
              if (answer._tag !== "Snapshot") {
                return
              }
              const reference = answer.root.children.find((node) =>
                node.role.role === "button"
              )!
              const clickable = answer.root.children.find((node) =>
                node.role.role === "clickable"
              )!
              assert.deepStrictEqual(reference.name, {
                _tag: "Accessible",
                value: "moving value",
                ...(privateReference ? { fieldContent: true } : {})
              })
              assert.deepStrictEqual(clickable.name, {
                _tag: "Inferred",
                value: "inferred value",
                from: "text",
                ...(privateText ? { fieldContent: true } : {})
              })
            })
            yield* check(true, false)
            const reassigned = yield* call(
              `() => {
              document.getElementById('moving').slot = 'public'
              document.getElementById('text').setAttribute('role', 'textbox')
            }`,
              []
            )
            assert.strictEqual(reassigned._tag, "Value")
            yield* check(false, true)
            const reclassified = yield* call(
              `() => {
              document.getElementById('host').setAttribute('role', 'textbox')
              document.getElementById('text').removeAttribute('role')
            }`,
              []
            )
            assert.strictEqual(reclassified._tag, "Value")
            yield* check(true, false)
            const moved = yield* call(
              `() => {
              document.body.appendChild(document.getElementById('moving'))
              document.getElementById('host').removeAttribute('role')
            }`,
              []
            )
            assert.strictEqual(moved._tag, "Value")
            yield* check(false, false)
          }), timeout)

        it.effect("keeps unlabeled and labeled password controls discoverable in snapshots", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<input type="password" value="private-unlabeled"><label>Account password<input type="password" value="private-labeled"></label>`
            )
            const response = yield* send({ op: "snapshot", steps: null, interactivity: true, depth: null })
            assert(response._tag === "Snapshot", JSON.stringify(response))
            const nodes: Array<Engine.SnapNode> = []
            const visit = (node: Engine.SnapNode) => {
              if (node.ref !== null) {
                nodes.push(node)
              }
              for (const child of node.children) {
                visit(child)
              }
            }
            visit(response.root)
            assert.notInclude(JSON.stringify(response), "private-unlabeled")
            assert.notInclude(JSON.stringify(response), "private-labeled")
            assert.deepEqual(
              nodes.map((node) =>
                node.role
              ),
              [
                { _tag: "Inferred", role: "editable", evidence: ["password"] },
                { _tag: "Inferred", role: "editable", evidence: ["password"] }
              ]
            )
            assert.deepEqual(nodes[0]!.name, { _tag: "None" })
            const without = yield* send({ op: "snapshot", steps: null, interactivity: false, depth: null })
            assert(without._tag === "Snapshot")
            assert.notInclude(JSON.stringify(without.root), "\"password\"")
            assert.strictEqual(count(yield* send({ op: "count", steps: [role("textbox")] })), 0)
            const rendered = Engine.renderText(response.root)
            assert.notInclude(rendered, "private-unlabeled")
            assert.notInclude(rendered, "private-labeled")
            assert.strictEqual(nodes.length, 2, rendered)
            assert.isTrue(
              nodes.some((node) =>
                node.name._tag === "Accessible" && node.name.value === "Account password"
              ),
              rendered
            )
          }), timeout)

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
                  if (partial) {
                    assert.isBelow(geometry.rects[0]!.bottom, 0)
                  }
                  const first = geometry.rects.find((r) =>
                    r.bottom > 0 && r.top < geometry.height
                  )!
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
              if (mode !== "partial ancestor") {
                assert.strictEqual(centers.length, 3)
              }
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
              `<a id="go" style="position:fixed;left:-100px;top:20px;width:10px;height:10px">Go</a>`,
              // Supply the rendering opportunity this geometry case requires, independently of frame scheduling.
              "() => { globalThis.requestAnimationFrame = callback => { queueMicrotask(() => callback(performance.now())); return 0 } }"
            )
            const response = yield* send({
              ...point(0),
              cap: 100,
              checks: {
                rendered: true,
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

        for (const stable of [0, 2]) {
          it.effect(`checks immediately with rendered off and retains ${stable} stability frames`, () =>
            Effect.gen(function*() {
              const { call, send } = yield* open(backend, `<button id="go">Go</button>`, countFrames())
              const request = point(stable)
              const response = yield* send({ ...request, checks: { ...request.checks, rendered: false } })
              assert(response._tag === "Ready", JSON.stringify(response))
              assert.strictEqual(yield* framesRead(call), stable)
            }), timeout)
        }

        it.effect("retains the readiness reason without a rendering hint when rendered is off", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button id="go" disabled>Go</button>`,
              "() => { globalThis.requestAnimationFrame = () => 0 }"
            )
            const request = point(0)
            const response = yield* send({ ...request, cap: 100, checks: { ...request.checks, rendered: false } })
            assert(response._tag === "NotReady", JSON.stringify(response))
            assert.strictEqual(response.reason._tag, "Disabled")
            assert(
              !response.history.some((reason) =>
                reason._tag === "NoRenderingOpportunity"
              )
            )
          }), timeout)

        it.effect("retains established instability as reportable evidence", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              "<button id=\"go\">Go</button>",
              countFrames(
                "document.getElementById(\"go\").style.marginLeft = (globalThis.engineTestFrames % 2 ? 10 : 20) + \"px\""
              )
            )
            const response = yield* send(point(2))
            assert(response._tag === "NotReady")
            assert.strictEqual(response.checked, true)
            assert.deepStrictEqual(response.reason, { _tag: "NotStable" })
            assert.deepStrictEqual(response.history, [{ _tag: "NotStable" }])
          }), timeout)

        it.effect("does not report a stability baseline with rendered off when frames never arrive", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button id="go">Go</button>`,
              "() => { globalThis.requestAnimationFrame = () => 0 }"
            )
            const request = point(2)
            const response = yield* send({ ...request, cap: 100, checks: { ...request.checks, rendered: false } })
            assert(response._tag === "NotReady", JSON.stringify(response))
            assert.strictEqual(response.reason._tag, "NotStable")
            assert.isFalse(response.checked)
            assert.deepStrictEqual(response.history, [])
            assert(
              !response.history.some((reason) =>
                reason._tag === "NoRenderingOpportunity"
              )
            )
          }), timeout)

        it.effect("waits for a frame to retry current layout with rendered off", () =>
          Effect.gen(function*() {
            const { call, send } = yield* open(
              backend,
              `<button id="go" disabled>Go</button>`,
              countFrames("document.getElementById('go').disabled = false")
            )
            const request = point(0)
            const response = yield* send({ ...request, checks: { ...request.checks, rendered: false } })
            assert(response._tag === "Ready", JSON.stringify(response))
            assert.strictEqual(yield* framesRead(call), 1)
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
            const { send } = yield* open(
              backend,
              `<h2>Title</h2><h3>Other</h3>
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
<div aria-disabled="true"><button>Inherited</button></div>`
            )
            const check = Effect.fnUntraced(function*(name: string, options: object, expected: number) {
              const step = { ...role(name), ...options }
              assert.strictEqual(
                count(yield* send({ op: "count", steps: [step] })),
                expected,
                `${name} ${JSON.stringify(options)}`
              )
            })
            yield* check("heading", { level: 2 }, 2)
            yield* check("checkbox", { checked: true }, 2)
            yield* check("checkbox", { checked: false }, 3)
            yield* check("checkbox", {}, 6)
            yield* check("button", { pressed: true }, 1)
            yield* check("button", { pressed: false, name: text("Toggle") }, 2)
            yield* check("button", { expanded: true }, 1)
            yield* check("button", { expanded: false }, 1)
            yield* check("option", { selected: true, includeHidden: true }, 1)
            yield* check("option", { selected: false, includeHidden: true }, 1)
            yield* check("tab", { selected: false }, 1)
            yield* check("button", { disabled: true }, 2)
            yield* check("button", { pressed: false, disabled: false, name: text("Toggle", true) }, 2)
          }), timeout)

        for (const name of ["radio", "menuitemradio", "switch"]) {
          it.effect(`treats mixed as false for the two-state ${name} role`, () =>
            Effect.gen(function*() {
              const { send } = yield* open(backend, `<div role="${name}" aria-checked="mixed"></div>`)
              assert.strictEqual(
                count(yield* send({ op: "count", steps: [{ ...role(name), checked: false }] })),
                1
              )
            }), timeout)
        }

        it.effect("distinguishes mixed, absent and malformed checked role states", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<input id="mixed" type="checkbox" checked>
<div role="checkbox" aria-checked="TRUE"></div>
<div role="checkbox" aria-checked="bogus"></div>
<div role="checkbox" aria-checked=""></div>
<div role="checkbox" aria-checked="undefined"></div>
<div role="option"></div><div role="option" aria-checked=""></div>
<div role="option" aria-checked="undefined"></div>
<div role="option" aria-checked="bogus"></div>
<div role="treeitem" aria-checked="mixed"></div>`,
              "() => { document.querySelector(\"#mixed\").indeterminate = true }"
            )
            const check = Effect.fnUntraced(function*(name: string, checked: boolean, expected: number) {
              assert.strictEqual(
                count(
                  yield* send({
                    op: "count",
                    steps: [{ ...role(name), checked }]
                  })
                ),
                expected
              )
            })
            yield* check("checkbox", true, 1)
            yield* check("checkbox", false, 3)
            yield* check("option", true, 0)
            yield* check("option", false, 0)
            yield* check("treeitem", false, 0)
            const read = yield* send({
              op: "read",
              steps: [{ _tag: "Css", selector: "#mixed" }],
              read: { _tag: "Checked", followLabel: false }
            })
            assert(read._tag === "Read")
            assert.strictEqual(read.value, true)
          }), timeout)

        it.effect("combines role filters with scope, names and hidden options", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<section>
<h2 aria-level="3">Native</h2><div role="treeitem" aria-level="3">Tree</div>
<input type="radio" checked><input type="radio">
<details role="button" open><summary>Open</summary></details><details role="button"><summary>Closed</summary></details>
<div role="tab" aria-selected="false">Off</div><div role="tab" aria-selected="TRUE">On</div>
<div role="button" aria-pressed="TRUE" aria-expanded="TRUE">Case</div>
<div role="button" aria-pressed="mixed" aria-expanded="bogus">Mixed</div>
<button hidden aria-pressed="true">Hidden</button>
<div aria-disabled="true"><button aria-disabled="false">Inherited</button></div>
<select multiple><optgroup disabled><option>Blocked</option></optgroup></select>
</section>`
            )
            const check = Effect.fnUntraced(function*(name: string, options: object, expected: number) {
              assert.strictEqual(
                count(
                  yield* send({
                    op: "count",
                    steps: [{ _tag: "Css", selector: "section" }, { ...role(name), ...options }]
                  })
                ),
                expected
              )
            })
            yield* check("heading", { level: 2 }, 1)
            yield* check("heading", { level: 3 }, 0)
            yield* check("treeitem", { level: 3 }, 1)
            yield* check("radio", { checked: true }, 1)
            yield* check("radio", { checked: false }, 1)
            yield* check("button", { expanded: true, name: text("Open", true) }, 1)
            yield* check("button", { expanded: false, name: text("Closed", true) }, 1)
            yield* check("tab", { selected: false }, 1)
            yield* check("tab", { selected: true }, 1)
            yield* check("button", { pressed: true, expanded: true, name: text("Case", true) }, 1)
            yield* check("button", { pressed: true, name: text("Hidden"), includeHidden: false }, 0)
            yield* check("button", { pressed: true, name: text("Hidden"), includeHidden: true }, 1)
            yield* check("button", { disabled: true, name: text("Inherited") }, 1)
            yield* check("option", { disabled: true, includeHidden: true }, 1)
          }), timeout)

        it.effect("rejects unsupported role filters before matching candidates", () =>
          Effect.gen(function*() {
            const { send } = yield* open(backend, `<a href="/" aria-expanded="false">Link</a><input type="checkbox">`)
            for (
              const [name, options] of [
                ["link", { checked: true }],
                ["link", { pressed: false }],
                ["group", { expanded: false }],
                ["checkbox", { selected: false }],
                ["link", { level: 2 }]
              ] as const
            ) {
              for (
                const steps of [
                  [{ ...role(name), ...options }],
                  [{ _tag: "Css" as const, selector: "#missing" }, { ...role(name), ...options }],
                  [{ _tag: "Css" as const, selector: "#missing" }, {
                    _tag: "Filter" as const,
                    hasText: null,
                    hasNotText: null,
                    visible: null,
                    has: [{ ...role(name), ...options }],
                    hasNot: null
                  }]
                ]
              ) {
                const response = yield* send({ op: "count", steps })
                assert.strictEqual(response._tag, "InvalidSelector", JSON.stringify({ options, steps, response }))
                if (response._tag === "InvalidSelector") {
                  assert.include(response.message, Object.keys(options)[0]!)
                }
              }
            }
            assert.strictEqual(count(yield* send({ op: "count", steps: [{ ...role("link"), expanded: false }] })), 1)
            assert.strictEqual(count(yield* send({ op: "count", steps: [role("link")] })), 1)
            assert.strictEqual(count(yield* send({ op: "count", steps: [{ ...role("link"), disabled: false }] })), 1)
          }), timeout)

        it.effect("filters options inside a disabled fieldset as disabled, except in its legend", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<fieldset disabled>
<legend><select multiple><option>Free</option></select></legend>
<select multiple><option>Blocked</option></select>
</fieldset><fieldset></fieldset>`
            )
            const check = Effect.fnUntraced(function*(disabled: boolean, expected: number) {
              const step = { ...role("option", null, true), disabled }
              assert.strictEqual(count(yield* send({ op: "count", steps: [step] })), expected, `disabled: ${disabled}`)
            })
            yield* check(true, 1)
            yield* check(false, 1)
            assert.strictEqual(count(yield* send({ op: "count", steps: [{ ...role("group"), disabled: true }] })), 1)
            assert.strictEqual(count(yield* send({ op: "count", steps: [{ ...role("group"), disabled: false }] })), 1)
          }), timeout)

        it.effect("does not read an option of a disabled select as disabled", () =>
          Effect.gen(function*() {
            const { send } = yield* open(backend, `<select multiple disabled><option>One</option></select>`)
            const check = Effect.fnUntraced(function*(disabled: boolean, expected: number) {
              const step = { ...role("option", null, true), disabled }
              assert.strictEqual(count(yield* send({ op: "count", steps: [step] })), expected, `disabled: ${disabled}`)
            })
            yield* check(true, 0)
            yield* check(false, 1)
          }), timeout)

        it.effect("reads an optgroup inside a disabled fieldset as disabled", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<fieldset disabled><select multiple><optgroup label="G"><option>In</option></optgroup></select></fieldset>`
            )
            const step = { _tag: "Css" as const, selector: "select" }
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [step, { ...role("group", null, true), disabled: true }] })),
              1
            )
          }), timeout)

        it.effect("preserves browser-native enabled reads for options and optgroups", () =>
          Effect.gen(function*() {
            const { send, call } = yield* open(
              backend,
              `<select multiple disabled><option id="option">One</option></select>
<fieldset disabled><select multiple><optgroup id="optgroup" label="G"><option>Two</option></optgroup></select></fieldset>`
            )
            for (const id of ["option", "optgroup"]) {
              const native = yield* call(
                `(id) => !document.getElementById(id).matches(":disabled")`,
                [string(id)]
              )
              assert(native._tag === "Value" && native.value.type === "boolean")
              const read = yield* send({
                op: "read",
                steps: [{ _tag: "Css", selector: `#${id}` }],
                read: { _tag: "Enabled" }
              })
              assert(read._tag === "Read")
              assert.strictEqual(read.value, native.value.value, id)
            }
          }), timeout)

        it.effect("uses a consistent native disabled matrix for role filters", () =>
          Effect.gen(function*() {
            const controls = ["button", "input", "select", "textarea", "option", "optgroup", "fieldset"]
            const cases = controls.flatMap((tag) => {
              const control = (attributes = "") =>
                `<${tag} role="button" ${attributes}></${tag}>`
              return [
                { html: control(), disabled: false },
                { html: control("disabled"), disabled: true },
                { html: `<fieldset disabled>${control()}</fieldset>`, disabled: true },
                { html: `<fieldset disabled><legend>${control()}</legend></fieldset>`, disabled: false },
                {
                  html: `<fieldset disabled><legend>First</legend><legend>${control()}</legend></fieldset>`,
                  disabled: true
                }
              ]
            })
            cases.push(
              { html: `<select disabled><option role="button">One</option></select>`, disabled: false },
              {
                html: `<select><optgroup disabled><option role="button">One</option></optgroup></select>`,
                disabled: true
              },
              { html: `<div disabled role="button">One</div>`, disabled: false },
              { html: `<fieldset disabled><div role="button">One</div></fieldset>`, disabled: false },
              { html: `<div aria-disabled="true"><button aria-disabled="false">One</button></div>`, disabled: true },
              { html: `<button aria-disabled="TRUE">One</button>`, disabled: false }
            )
            const { send } = yield* open(
              backend,
              cases.map(({ html }, index) =>
                `<div id="case-${index}">${html}</div>`
              ).join("")
            )
            for (const [index, { html, disabled }] of cases.entries()) {
              const scope = { _tag: "Css" as const, selector: `#case-${index}` }
              assert.strictEqual(
                count(yield* send({ op: "count", steps: [scope, role("button", null, true)] })),
                1,
                html
              )
              for (const filter of [true, false]) {
                assert.strictEqual(
                  count(
                    yield* send({ op: "count", steps: [scope, { ...role("button", null, true), disabled: filter }] })
                  ),
                  filter === disabled ? 1 : 0,
                  `${html}: disabled=${filter}`
                )
              }
            }
          }), timeout)

        it.effect("rejects unsupported role filters in hasNot, and and or branches", () =>
          Effect.gen(function*() {
            const { send } = yield* open(backend, `<a href="/">Link</a>`)
            const invalid = [{ ...role("link"), pressed: false }]
            const empty = { _tag: "Css" as const, selector: "#missing" }
            for (
              const steps of [
                [empty, {
                  _tag: "Filter" as const,
                  hasText: null,
                  hasNotText: null,
                  visible: null,
                  has: null,
                  hasNot: invalid
                }],
                [empty, { _tag: "And" as const, other: invalid }],
                [empty, { _tag: "Or" as const, other: invalid }]
              ]
            ) {
              assert.strictEqual((yield* send({ op: "count", steps }))._tag, "InvalidSelector")
            }
          }), timeout)

        it.effect("reads an invalid aria-expanded as false, and an absent one as neither", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<button aria-expanded="bogus">Invalid</button><button>Absent</button>`
            )
            const check = Effect.fnUntraced(function*(expanded: boolean, expected: number) {
              const step = { ...role("button"), expanded }
              assert.strictEqual(count(yield* send({ op: "count", steps: [step] })), expected, `expanded: ${expanded}`)
            })
            yield* check(false, 1)
            yield* check(true, 0)
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

        it.effect("searches a scope's own open shadow root, and a root nested in it, with every kind of step", () =>
          Effect.gen(function*() {
            const { send } = yield* open(
              backend,
              `<div id="host"></div><div id="outer"></div>
<script>
document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
  '<button title="tip" data-testid="go">Go</button><label>Name <input placeholder="who"></label>' +
  '<img alt="logo"><p>Hello</p><div id="inner"></div>'
document.getElementById("host").shadowRoot.getElementById("inner").attachShadow({ mode: "open" }).innerHTML =
  "<button>Deep</button>"
document.getElementById("outer").attachShadow({ mode: "open" }).innerHTML =
  "<div><span>chained</span></div>"
</script>`
            )
            const host: Engine.Step = { _tag: "Css", selector: "#host" }
            const inHost = (step: Engine.Step) =>
              send({ op: "count", steps: [host, step] }).pipe(Effect.map(count))
            assert.strictEqual(yield* inHost({ _tag: "Css", selector: "button" }), 2)
            assert.strictEqual(yield* inHost(role("button", text("Go"))), 1)
            assert.strictEqual(yield* inHost(role("button", text("Deep"))), 1)
            assert.strictEqual(yield* inHost({ _tag: "Text", matcher: text("Hello") }), 1)
            assert.strictEqual(yield* inHost({ _tag: "Label", matcher: text("Name") }), 1)
            assert.strictEqual(yield* inHost({ _tag: "Placeholder", matcher: text("who") }), 1)
            assert.strictEqual(yield* inHost({ _tag: "AltText", matcher: text("logo") }), 1)
            assert.strictEqual(yield* inHost({ _tag: "Title", matcher: text("tip") }), 1)
            assert.strictEqual(yield* inHost({ _tag: "TestId", id: "go" }), 1)
            const hasDeep: Engine.Step = {
              _tag: "Filter",
              hasText: null,
              hasNotText: null,
              has: [role("button", text("Deep"))],
              hasNot: null,
              visible: null
            }
            // The host and the nested root's host both have the button under them.
            assert.strictEqual(
              count(yield* send({ op: "count", steps: [{ _tag: "Css", selector: "div" }, hasDeep] })),
              2
            )
            const chain = [{ _tag: "Css", selector: "div" }, { _tag: "Css", selector: "div" }, {
              _tag: "Css",
              selector: "span"
            }] as const
            assert.strictEqual(count(yield* send({ op: "count", steps: chain })), 1)
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
        it.effect("keeps raw-engine documents, realms and storage private to each scoped context", () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const first = yield* Effect.scoped(Effect.gen(function*() {
              const opened = yield* open(backend, "<p>First</p>", undefined, origin)
              const written = yield* opened.call(
                `() => {
                localStorage.setItem("engine-fixture", "first");
                document.cookie = "engineFixture=first; path=/";
                globalThis.engineFixture = "first";
                return JSON.stringify({
                  storage: localStorage.getItem("engine-fixture"),
                  cookie: document.cookie,
                  global: globalThis.engineFixture
                });
              }`,
                []
              )
              assert(written._tag === "Value" && written.value.type === "string")
              assert.deepStrictEqual(JSON.parse(written.value.value), {
                storage: "first",
                cookie: "engineFixture=first",
                global: "first"
              })
              return opened
            }))
            yield* Effect.scoped(Effect.gen(function*() {
              const second = yield* open(backend, "<p>Second</p>", undefined, origin)
              assert.strictEqual(first.adapter, second.adapter)
              assert.notStrictEqual(first.context, second.context)
              assert.notStrictEqual(first.page, second.page)
              assert.notStrictEqual(first.document, second.document)
              assert.notStrictEqual(first.realm, second.realm)
              const fresh = yield* second.call(
                `() => JSON.stringify({
                storage: localStorage.getItem("engine-fixture"),
                cookie: document.cookie,
                global: typeof globalThis.engineFixture
              })`,
                []
              )
              assert(fresh._tag === "Value" && fresh.value.type === "string")
              assert.deepStrictEqual(JSON.parse(fresh.value.value), {
                storage: null,
                cookie: "",
                global: "undefined"
              })
              assert.strictEqual(
                count(yield* second.send({ op: "count", steps: [{ _tag: "Text", matcher: text("Second") }] })),
                1
              )
            }))
          }), timeout)
      }
    )
    beforeEach(({ task }) =>
      Effect.runPromise(
        isolated.has(task.name) ? shared.reset : shared.prepare
      )
    )
  })
