/** Unused native dispatch contains no WebSocket hook probes; opting in replaces only owned contexts. */
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Runtime from "../src/cdp/Runtime.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Evaluation from "../src/internal/cdpAdapter/evaluation.ts"
import * as CdpState from "../src/internal/cdpAdapter/state.ts"
import { installWebSocketGates } from "../src/internal/cdpAdapter/targets.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Console from "../src/internal/webkitAdapter/console.ts"
import * as State from "../src/internal/webkitAdapter/state.ts"
import * as Bridge from "../src/internal/webkitAdapter/webSocketBridge.ts"
import * as Target from "../src/Target.ts"
import * as UserContext from "../src/UserContext.ts"

it.effect("installs CDP gate overrides only on the requesting context and restores their shared defaults", () =>
  Effect.gen(function*() {
    const first = new CdpState.ContextEntry(UserContext.Id.make("C1"), "one", false)
    const sibling = new CdpState.ContextEntry(UserContext.Id.make("C2"), "two", false)
    const gate = sibling.gate, worker = sibling.workerGate
    assert.strictEqual(first.gate, gate)
    assert.isFalse(Object.hasOwn(first, "gate"))
    const scope = yield* Scope.make()
    yield* installWebSocketGates(first, scope, true)
    assert.notStrictEqual(first.gate, gate)
    assert.notStrictEqual(first.workerGate, worker)
    assert.strictEqual(sibling.gate, gate)
    assert.isFalse(Object.hasOwn(sibling, "gate"))
    yield* Scope.close(scope, Exit.void)
    assert.strictEqual(first.gate, gate)
    assert.strictEqual(first.workerGate, worker)
    assert.isFalse(Object.hasOwn(first, "gate"))
    assert.isFalse(Object.hasOwn(first, "workerGate"))
  }))

it.effect("keeps the WebKit default console table intact and scopes filtering and realm cleanup to opted-in dispatch", () =>
  Effect.gen(function*() {
    const ids = Kit.makeIds()
    const facts: Array<Adapter.Fact> = []
    const handlers = Console.register(Kit.handlers<State.Event>())
    const scope = yield* Scope.make()
    let live: ReadonlyArray<Adapter.WebSocketBridge> = []
    let ended = 0, received = 0
    const session = {} as ProtocolClient.Session
    const state = {
      handlers,
      buffer: { emit: (fact: Adapter.Fact) => facts.push(fact) },
      workers: new Map(),
      realmsByContext: new Map(),
      registry: { bundles: () => new Map([["", { webSockets: live }]]) }
    } as unknown as State.State
    const make = () => {
      const page = { id: ids.navigable(), context: { id: ids.userContext() }, session } as State.PageEntry
      const target = { page, session } as State.TargetEntry
      const realm = { id: ids.realm(), target, world: { _tag: "Main" }, document: {} } as State.RealmEntry
      Object.assign(page, { main: { document: { realms: new Set([realm]) } } })
      page.event = State.eventContext(state, session, page, undefined, undefined)
      target.event = State.eventContext(state, session, page, target, undefined)
      // Any legacy optional-field probe would make an ordinary console event fail.
      Object.defineProperties(target, {
        webSocketConsole: {
          get: () => {
            throw new Error("unused console hook was read")
          }
        },
        webSocketEnded: {
          get: () => {
            throw new Error("unused realm hook was read")
          }
        }
      })
      return { target, realm }
    }
    const first = make(), sibling = make()
    const ordinary = { message: { source: "console-api", level: "debug", text: "ordinary" } }
    sibling.target.event.handlers.apply("Console.messageAdded", ordinary, sibling.target.event)
    assert.strictEqual(facts.length, 1)
    const bridge: Adapter.WebSocketBridge = {
      name: "private",
      token: "token",
      scope,
      captured: () => Effect.void,
      receive: () => {
        received++
        return false
      },
      ended: () => {
        ended++
      },
      failed: () => undefined
    }
    live = [bridge]
    yield* Bridge.prepare(state, first.target, live)
    assert.strictEqual(sibling.target.event.handlers, handlers)
    assert.strictEqual(sibling.target.event.state, state)
    assert.notStrictEqual(first.target.event.handlers, handlers)
    first.target.event.handlers.apply("Console.messageAdded", ordinary, first.target.event)
    assert.strictEqual(facts.length, 2)
    first.target.event.state.buffer.emit({
      _tag: "RealmRemoved",
      realm: first.realm.id,
      reason: new Target.RealmDestroyed({})
    })
    assert.strictEqual(ended, 1)
    assert.strictEqual(received, 0)
    // The declaration registry has an older finalizer and can still contain this closing bridge.
    yield* Scope.close(scope, Exit.void)
    assert.strictEqual(first.target.event.handlers, handlers)
    assert.strictEqual(first.target.event.state, state)
    sibling.target.event.handlers.apply("Console.messageAdded", ordinary, sibling.target.event)
    assert.strictEqual(facts.length, 4)
  }))

it("does not probe popup-replay deduplication during ordinary CDP context dispatch", () => {
  const ids = Kit.makeIds()
  const facts: Array<Adapter.Fact> = []
  const target = { kind: "page", session: { key: "ordinary" } } as CdpState.TargetEntry
  const frame = {
    id: ids.navigable(),
    document: { realms: new Set() },
    navigations: new Map()
  } as unknown as CdpState.FrameEntry
  const state = {
    ids,
    buffer: { emit: (fact: Adapter.Fact) => facts.push(fact) },
    frames: new Map([["frame", frame]]),
    realms: new Map(),
    realmsByContext: new Map(),
    realmsByUnique: new Map()
  } as unknown as CdpState.State
  state.realmsByUnique.has = () => {
    throw new Error("ordinary dispatch probed popup replay")
  }
  const handlers = Evaluation.register(Kit.handlers<CdpState.Event>())
  handlers.apply(Runtime.executionContextCreated.method, {
    context: {
      id: Runtime.ExecutionContextId.make(1),
      uniqueId: "ordinary",
      name: "",
      origin: "https://example.com",
      auxData: { frameId: "frame", isDefault: true }
    }
  }, { state, target })
  assert.strictEqual(state.realmsByUnique.size, 1)
  assert.strictEqual(facts[0]?._tag, "RealmAdded")
})
