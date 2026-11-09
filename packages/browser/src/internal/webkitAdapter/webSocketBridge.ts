/** Console object envelopes are consumed before public console publication, only in opted-in targets. */
import * as Effect from "effect/Effect"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Adapter from "../adapter.ts"
import { contextKey, type State, type TargetEntry } from "./state.ts"

export const prepare = (state: State, target: TargetEntry, bridges: ReadonlyArray<Adapter.WebSocketBridge>): void => {
  if (bridges.length === 0) {
    delete target.webSocketConsole
    delete target.webSocketEnded
    return
  }
  target.webSocketEnded = (realm, reason) => {
    for (const bridge of bridges) {
      if (reason._tag === "ConnectionLost" || reason._tag === "ModelUnavailable" || reason._tag === "AccessReleased") {
        bridge.failed(realm)
      } else bridge.ended(realm)
    }
  }
  target.webSocketConsole = (message, worker) => {
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
    const realm = worker?.realm ?? state.realmsByContext.get(contextKey(target, contextId))
    const session = worker?.session ?? target.session
    const release = Runtime.releaseObject({ objectId: object.objectId }).pipe(Protocol.on(session), Effect.ignore)
    if (realm === undefined || realm.ended) {
      state.buffer.later(release)
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
    if (!accepted) state.buffer.later(release)
    return true
  }
}
