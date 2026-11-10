/** Bindings are created only for targets covered by a WebSocket declaration. */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Page from "../../cdp/Page.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import * as Target from "../../cdp/Target.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Declarations from "../declarations.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { contextKey, placement, type RealmEntry, type State, type TargetEntry } from "./state.ts"

const origin = (realm: RealmEntry): import("../../WebSocketRoute.ts").Origin =>
  realm.frame === undefined
    ? { _tag: "Worker", realm: realm.id }
    : { _tag: "Frame", page: realm.frame.page.id, frame: realm.frame.id }
const installed = new WeakMap<TargetEntry, Set<string>>()
const pending = new WeakMap<
  TargetEntry,
  Map<
    string,
    {
      readonly bridge: Adapter.WebSocketBridge
      readonly events: Array<Runtime.BindingCalledParams>
      readonly known: Map<string, import("../../Target.ts").RealmId>
      overflow: boolean
    }
  >
>()
export const flush = (state: State, target: TargetEntry): void => {
  for (const holder of pending.get(target)?.values() ?? []) {
    if (holder.overflow) {
      for (const realm of state.realms.values()) {
        if (realm.target === target && realm.world._tag === "Main" && !realm.ended) holder.bridge.failed(realm.id)
      }
      holder.events.length = 0
      continue
    }
    for (const event of holder.events.splice(0)) {
      const realm = state.realmsByContext.get(contextKey(target, event.executionContextId))
      if (realm !== undefined && !realm.ended && !realm.pending) {
        holder.known.set(realm.uniqueId, realm.id)
        holder.bridge.receive(realm.id, Effect.succeed(event.payload), origin(realm))
      } else holder.events.push(event)
    }
  }
}
export const prepare = Effect.fnUntraced(
  function*(state: State, target: TargetEntry, given?: ReadonlyArray<Adapter.WebSocketBridge>, send = true) {
    const commands: Array<ReturnType<typeof Runtime.addBinding>> = []
    if (target.page === undefined) return commands
    const placementOfTarget = placement(target.page)
    const bridges = given ?? state.registry.all().flatMap((entry) =>
      entry.declaration._tag === "InitScript" &&
        entry.declaration.webSocket !== undefined && Declarations.covers(entry.scope, placementOfTarget) &&
        (target.kind !== "worker" || entry.declaration.workers) ?
        [entry.declaration.webSocket] :
        []
    )
    for (const bridge of bridges) {
      let names = installed.get(target)
      if (names === undefined) {
        names = new Set()
        installed.set(target, names)
      }
      if (names.has(bridge.name)) continue
      names.add(bridge.name)
      let deferred = pending.get(target)
      if (deferred === undefined) {
        deferred = new Map()
        pending.set(target, deferred)
      }
      const known = new Map<string, import("../../Target.ts").RealmId>()
      const holder = { bridge, events: [] as Array<Runtime.BindingCalledParams>, known, overflow: false }
      deferred.set(bridge.name, holder)
      const lifetime = yield* Scope.fork(bridge.scope)
      const events = yield* target.session.subscribe(Runtime.bindingCalled).pipe(Scope.provide(lifetime))
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.name !== bridge.name) return
            const realm = state.realmsByContext.get(contextKey(target, event.executionContextId))
            if (realm === undefined || realm.ended || realm.pending) {
              if (holder.events.length < 64) holder.events.push(event)
              else {
                holder.overflow = true
                flush(state, target)
              }
              return
            }
            known.set(realm.uniqueId, realm.id)
            bridge.receive(realm.id, Effect.succeed(event.payload), origin(realm))
          })
        ),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ?
            Effect.void :
            Target.getTargets().pipe(
              Protocol.on(state.root()),
              Operation.detached,
              Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
              Effect.match({
                onFailure: () => {
                  for (const realm of known.values()) bridge.failed(realm)
                },
                onSuccess: ({ targetInfos }) => {
                  const callback = targetInfos.some((info) => info.targetId === target.targetId)
                    ? bridge.failed
                    : bridge.ended
                  for (const realm of known.values()) callback(realm)
                }
              })
            )
        ),
        Effect.ensuring(Scope.close(lifetime, Exit.void)),
        Effect.forkIn(lifetime)
      )
      const created = yield* target.session.subscribe(Runtime.executionContextCreated).pipe(Scope.provide(lifetime))
      yield* created.pipe(
        Stream.runForEach(() => Effect.sync(() => flush(state, target))),
        Effect.forkIn(lifetime)
      )
      const committed = yield* target.session.subscribe(Page.frameNavigated).pipe(Scope.provide(lifetime))
      yield* committed.pipe(
        Stream.runForEach(() => Effect.sync(() => flush(state, target))),
        Effect.forkIn(lifetime)
      )
      const destroyed = yield* target.session.subscribe(Runtime.executionContextDestroyed).pipe(
        Scope.provide(lifetime)
      )
      yield* destroyed.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            const id = known.get(event.executionContextUniqueId ?? "")
            if (id !== undefined) {
              known.delete(event.executionContextUniqueId ?? "")
              bridge.ended(id)
            }
          })
        ),
        Effect.forkIn(lifetime)
      )
      const cleared = yield* target.session.subscribe(Runtime.executionContextsCleared).pipe(
        Scope.provide(lifetime)
      )
      yield* cleared.pipe(
        Stream.runForEach(() =>
          Effect.sync(() => {
            for (const realm of known.values()) bridge.ended(realm)
            known.clear()
          })
        ),
        Effect.forkIn(lifetime)
      )
      commands.push(Runtime.addBinding({ name: bridge.name }))
      yield* Scope.addFinalizer(
        lifetime,
        Runtime.removeBinding({ name: bridge.name }).pipe(
          Protocol.on(target.session),
          Effect.ignore,
          Effect.andThen(Effect.sync(() => {
            names.delete(bridge.name)
            deferred.delete(bridge.name)
          }))
        )
      )
    }
    if (send) yield* Effect.forEach(commands, (command) => command.pipe(Protocol.on(target.session)), { discard: true })
    return commands
  }
)
