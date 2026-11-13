import * as Effect from "effect/Effect"
import * as Script from "../../bidi-protocol/Script.ts"
import * as Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Geometry from "../geometry.ts"
import * as Evaluation from "./evaluation.ts"
import { realmOf, type State } from "./state.ts"

/** Native node serialization exposes closed shadow roots without changing page preferences or keeping handles. */
export const read = Effect.fnUntraced(function*(state: State, node: Adapter.NodeBinding, kind: Geometry.Kind) {
  const id = yield* Evaluation.realm(state, node.document, { _tag: "Isolated", name: "__strider_utility__" })
  const realm = yield* realmOf(state, id)
  const roots = new Set<Script.SharedId>()
  const functionDeclaration = Geometry.source()
  while (true) {
    const reply = yield* state.send(Script.callFunction({
      functionDeclaration,
      target: { realm: realm.bidi },
      awaitPromise: false,
      resultOwnership: "none",
      arguments: [
        { sharedId: node.binding as Script.SharedId },
        { type: "string", value: kind },
        ...Array.from(roots, (sharedId) => ({ sharedId }))
      ],
      serializationOptions: { maxObjectDepth: 4, maxDomDepth: 0 },
      userActivation: false
    })).pipe(
      Effect.mapError(Kit.realmFailure(id, () => realm.ended)),
      Effect.raceFirst(
        state.buffer.waitFor(() => realm.ended ? true : undefined).pipe(
          Effect.flatMap(() => Effect.fail(Kit.gone({ _tag: "Realm", id }, new Target.RealmDestroyed({}))))
        )
      )
    )
    if (reply.type !== "success" || reply.result.type !== "object") {
      return yield* Effect.fail(Geometry.incompatible("The browser did not serialize geometry", reply))
    }
    const members = new Map(
      reply.result.value?.filter((entry): entry is [string, Script.RemoteValue] => typeof entry[0] === "string")
    )
    const data = members.get("data"), ancestors = members.get("ancestors")
    const before = roots.size
    if (ancestors?.type === "array") {
      for (const ancestor of ancestors.value ?? []) {
        if (ancestor.type === "node" && ancestor.value?.shadowRoot?.sharedId !== undefined) {
          roots.add(ancestor.value.shadowRoot.sharedId)
        }
      }
    }
    if (roots.size !== before) continue
    if (data?.type !== "string") {
      return yield* Effect.fail(Geometry.incompatible("The browser did not return geometry data", reply))
    }
    return { document: node.document, data: yield* Geometry.decode({ _tag: "Value", value: data }) }
  }
})
