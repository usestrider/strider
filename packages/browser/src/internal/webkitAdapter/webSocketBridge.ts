/** Opted-in targets replace their native dispatch context; ordinary targets run the shared default table. */
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Console from "../../webkit-stock-protocol/Console.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Adapter from "../adapter.ts"
import { contextKey, type Event, placement, type State, type TargetEntry, type WorkerEntry } from "./state.ts"

type Installation = { readonly view: State; readonly registered: Set<string> }
let installed: WeakMap<TargetEntry, Installation> | undefined
let originals: WeakMap<State, State> | undefined
let retired: WeakSet<Adapter.WebSocketBridge> | undefined

const restore = (state: State, target: TargetEntry, installation: Installation) => {
  const events = [
    target.event,
    target.page.event,
    ...[...state.workers.values()].filter((worker) => worker.target === target).map((worker) => worker.event)
  ]
  for (const event of events) {
    if (event.state !== installation.view) continue
    event.state = state
    event.handlers = state.handlers
  }
}

export const prepare: (
  state: State,
  target: TargetEntry,
  bridges: ReadonlyArray<Adapter.WebSocketBridge>
) => Effect.Effect<void> = Effect.fnUntraced(
  function*(state: State, target: TargetEntry, bridges: ReadonlyArray<Adapter.WebSocketBridge>) {
    const closed = retired
    if (closed !== undefined) bridges = bridges.filter((bridge) => !closed.has(bridge))
    const base = originals?.get(state) ?? state
    const previous = installed?.get(target)
    if (previous !== undefined) restore(base, target, previous)
    if (bridges.length === 0) {
      installed?.delete(target)
      return
    }
    installed ??= new WeakMap()
    originals ??= new WeakMap()
    const registered = previous?.registered ?? new Set<string>()
    const classify = (
      message: Console.ConsoleMessage,
      worker: WorkerEntry | undefined,
      target: TargetEntry
    ): boolean => {
      const object = message.parameters?.find((argument) =>
        argument.objectId !== undefined &&
        argument.preview?.properties?.some((property) =>
          property.name === "__striderWebSocket" &&
          bridges.some((bridge) => bridge.token === property.value)
        )
      )
      if (object?.objectId === undefined) return false
      const marker = object.preview?.properties?.find((property) => property.name === "__striderWebSocket")?.value
      const bridge = bridges.find((bridge) => bridge.token === marker)
      if (bridge === undefined) return false
      const contextId = (JSON.parse(object.objectId) as { injectedScriptId: number }).injectedScriptId
      const realm = worker?.realm ?? base.realmsByContext.get(contextKey(target, contextId))
      const session = worker?.session ?? target.session
      const release = Runtime.releaseObject({ objectId: object.objectId }).pipe(Protocol.on(session), Effect.ignore)
      if (realm === undefined || realm.ended) {
        base.buffer.later(release)
        return true
      }
      const accepted = bridge.receive(
        realm.id,
        Runtime.callFunctionOn({
          objectId: object.objectId,
          functionDeclaration: `function(){ return this.__striderWebSocket === ${
            JSON.stringify(bridge.token)
          } ? this.payload : '' }`,
          returnByValue: true
        }).pipe(
          Protocol.on(session),
          Effect.map((result) => typeof result.result.value === "string" ? result.result.value : ""),
          Effect.mapError(Adapter.protocolError),
          Effect.ensuring(release)
        ),
        worker === undefined
          ? { _tag: "Frame", page: realm.document!.frame.page.id, frame: realm.document!.frame.id }
          : { _tag: "Worker", realm: realm.id }
      )
      if (!accepted) base.buffer.later(release)
      return true
    }
    const view: State = Object.create(base)
    Object.defineProperties(view, {
      buffer: {
        value: {
          ...base.buffer,
          emit: (fact: Adapter.Fact) => {
            if (fact._tag === "RealmRemoved") {
              for (const bridge of bridges) {
                if (
                  fact.reason._tag === "ConnectionLost" || fact.reason._tag === "ModelUnavailable" ||
                  fact.reason._tag === "AccessReleased"
                ) bridge.failed(fact.realm)
                else bridge.ended(fact.realm)
              }
            }
            base.buffer.emit(fact)
          }
        }
      },
      handlers: {
        value: {
          ...base.handlers,
          apply: (method: string, params: unknown, event: Event) => {
            if (
              method === Console.messageAdded.method && event.target !== undefined &&
              classify((params as Console.MessageAddedParams).message, event.worker, event.target)
            ) {
              const holder = event.worker ?? event.target
              holder.lastConsole = undefined
              return
            }
            base.handlers.apply(method, params, event)
          }
        }
      }
    })
    originals.set(view, base)
    installed.set(target, { view, registered })
    for (
      const event of [
        target.event,
        target.page.event,
        ...[...base.workers.values()].filter((worker) => worker.target === target).map((worker) => worker.event)
      ]
    ) {
      event.state = view
      event.handlers = view.handlers
    }
    for (const bridge of bridges) {
      if (registered.has(bridge.token)) continue
      registered.add(bridge.token)
      yield* Scope.addFinalizer(
        bridge.scope,
        Effect.suspend(() => {
          retired ??= new WeakSet()
          retired.add(bridge)
          registered.delete(bridge.token)
          const current = base.registry.bundles(placement(target.page)).get("")?.webSockets ?? []
          return prepare(base, target, current)
        })
      )
    }
  }
)
