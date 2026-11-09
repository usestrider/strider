/** BiDi channels are private to one opted-in declaration and scoped preload. */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Script from "../../bidi-protocol/Script.ts"
import * as Adapter from "../adapter.ts"
import * as Declarations from "../declarations.ts"
import { placement, type State } from "./state.ts"

export const channel = (bridge: Adapter.WebSocketBridge): Script.ChannelValue => ({
  type: "channel",
  value: { channel: bridge.name as Script.Channel }
})
export const prepare = Effect.fnUntraced(
  function*(state: State, scope: Adapter.DeclarationScope, bridge: Adapter.WebSocketBridge) {
    const known = new Map<string, import("../../Target.ts").RealmId>()
    const messages = yield* state.root().subscribe(Script.message).pipe(Scope.provide(bridge.scope))
    yield* messages.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.channel !== bridge.name || event.data.type !== "string") return
          const realm = state.realms.get(event.source.realm)
          if (realm === undefined || realm.ended) {
            return
          }
          known.set(event.source.realm, realm.id)
          bridge.receive(
            realm.id,
            Effect.succeed(event.data.value),
            realm.navigable === undefined
              ? { _tag: "Worker", realm: realm.id }
              : { _tag: "Frame", page: realm.navigable.page.id, frame: realm.navigable.id }
          )
        })
      ),
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? Effect.void : Effect.sync(() => {
          for (const realm of known.values()) bridge.failed(realm)
        })
      ),
      Effect.forkIn(bridge.scope)
    )
    const destroyed = yield* state.root().subscribe(Script.realmDestroyed).pipe(Scope.provide(bridge.scope))
    yield* destroyed.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          const realm = known.get(event.realm)
          if (realm !== undefined) {
            known.delete(event.realm)
            bridge.ended(realm)
          }
        })
      ),
      Effect.forkIn(bridge.scope)
    )
    for (const realm of state.realms.values()) {
      if (
        realm.ended || realm.world._tag !== "Main" || realm.navigable === undefined ||
        !Declarations.covers(scope, placement(realm.navigable))
      ) continue
      yield* state.send(Script.callFunction({
        functionDeclaration: `(send) => { globalThis[${JSON.stringify(bridge.name)}] = send }`,
        target: { realm: realm.bidi },
        arguments: [channel(bridge)],
        awaitPromise: false
      })).pipe(Effect.mapError(Adapter.protocolError))
    }
  }
)
