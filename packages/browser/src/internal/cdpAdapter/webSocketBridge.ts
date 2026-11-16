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
import type * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { contextKey, type Event, placement, type RealmEntry, type State, type TargetEntry } from "./state.ts"

const origin = (realm: RealmEntry): import("../../WebSocketRoute.ts").Initiator =>
  realm.frame === undefined
    ? { _tag: "Worker", realm: realm.id }
    : { _tag: "Frame", page: realm.frame.page.id, frame: realm.frame.id }
let installed:
  | WeakMap<
    TargetEntry,
    { names: Set<string>; base: Kit.Handlers<Event>; table: Kit.Handlers<Event> }
  >
  | undefined
let pending:
  | WeakMap<
    TargetEntry,
    Map<
      string,
      {
        readonly bridge: Adapter.WebSocketBridge
        readonly events: Array<Runtime.BindingCalledParams>
        readonly captures: Array<Runtime.ConsoleAPICalledParams>
        readonly known: Map<string, import("../../Target.ts").RealmId>
        overflow: boolean
      }
    >
  >
  | undefined
export const flush = (state: State, target: TargetEntry): void => {
  const holders = pending?.get(target)
  if (holders === undefined) return
  for (const holder of holders.values()) {
    if (holder.overflow) {
      for (const realm of state.realms.values()) {
        if (realm.target === target && realm.world._tag === "Main" && !realm.ended) holder.bridge.failed(realm.id)
      }
      holder.events.length = 0
      continue
    }
    for (const event of holder.captures.splice(0)) {
      const realm = state.realmsByContext.get(contextKey(target, event.executionContextId))
      if (realm === undefined || realm.ended || realm.pending) {
        holder.captures.push(event)
        continue
      }
      holder.known.set(realm.uniqueId, realm.id)
      const objectId = event.args[1]?.objectId
      if (objectId === undefined) {
        holder.bridge.failed(realm.id)
        continue
      }
      const handle = state.ids.handle()
      state.handles.set(handle, { target, realm, objectId, group: undefined })
      state.buffer.start(holder.bridge.captured(realm.id, handle, () => !realm.ended))
    }
    for (const event of holder.events.splice(0)) {
      const realm = state.realmsByContext.get(contextKey(target, event.executionContextId))
      if (realm !== undefined && !realm.ended && !realm.pending) {
        holder.known.set(realm.uniqueId, realm.id)
        holder.bridge.receive(realm.id, Effect.succeed(event.payload), origin(realm), { isAlive: () => !realm.ended })
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
      const installs = installed ??= new WeakMap()
      const awaiting = pending ??= new WeakMap()
      let installation = installs.get(target)
      if (installation === undefined) {
        const base = target.event.handlers
        const table: Kit.Handlers<Event> = {
          ...base,
          apply: (method, params, event) => {
            if (method === Runtime.executionContextCreated.method) {
              const context = (params as Runtime.ExecutionContextCreatedParams).context
              if (context.uniqueId !== undefined && state.realmsByUnique.has(context.uniqueId)) return
            }
            if (method === Runtime.consoleAPICalled.method) {
              const message = params as Runtime.ConsoleAPICalledParams
              const marker = message.args[0]?.value
              const holder = [...(awaiting.get(target)?.values() ?? [])].find((h) =>
                "__striderWebSocketCapture:" + h.bridge.token === marker
              )
              if (holder !== undefined && message.args[1]?.objectId !== undefined) {
                return
              }
            }
            base.apply(method, params, event)
          }
        }
        installation = { names: new Set(), base, table }
        installs.set(target, installation)
        target.event.handlers = table
      }
      const names = installation.names
      if (names.has(bridge.name)) continue
      names.add(bridge.name)
      let deferred = awaiting.get(target)
      if (deferred === undefined) {
        deferred = new Map()
        awaiting.set(target, deferred)
      }
      const known = new Map<string, import("../../Target.ts").RealmId>()
      const holder = {
        bridge,
        events: [] as Array<Runtime.BindingCalledParams>,
        captures: [] as Array<Runtime.ConsoleAPICalledParams>,
        known,
        overflow: false
      }
      deferred.set(bridge.name, holder)
      const lifetime = yield* Scope.fork(bridge.scope)
      const captures = yield* target.session.subscribe(Runtime.consoleAPICalled).pipe(Scope.provide(lifetime))
      yield* captures.pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            if (
              message.args[0]?.value !== "__striderWebSocketCapture:" + bridge.token ||
              message.args[1]?.objectId === undefined
            ) return
            if (holder.captures.length < 64) holder.captures.push(message)
            else holder.overflow = true
            flush(state, target)
          })
        ),
        Effect.forkIn(lifetime)
      )
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
            // A capture may have arrived before the realm fold; a later binding proves it is now usable.
            flush(state, target)
            known.set(realm.uniqueId, realm.id)
            bridge.receive(realm.id, Effect.succeed(event.payload), origin(realm), { isAlive: () => !realm.ended })
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
          Effect.andThen(Effect.suspend(() =>
            Effect.forEach(
              holder.captures.splice(0),
              (event) =>
                event.args[1]?.objectId === undefined
                  ? Effect.void
                  : Runtime.releaseObject({ objectId: event.args[1].objectId }).pipe(
                    Protocol.on(target.session),
                    Effect.ignore
                  ),
              { concurrency: "unbounded", discard: true }
            )
          )),
          Effect.andThen(Effect.sync(() => {
            names.delete(bridge.name)
            deferred.delete(bridge.name)
            if (names.size === 0) {
              if (target.event.handlers === installation.table) target.event.handlers = installation.base
              installs.delete(target)
            }
          }))
        )
      )
    }
    if (send) yield* Effect.forEach(commands, (command) => command.pipe(Protocol.on(target.session)), { discard: true })
    return commands
  }
)
