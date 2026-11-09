import * as Effect from "effect/Effect"
import * as DOM from "../../cdp/DOM.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Geometry from "../geometry.ts"
import * as Evaluation from "./evaluation.ts"
import { documentOf, type State } from "./state.ts"

export const read = Effect.fnUntraced(function*(state: State, node: Adapter.NodeBinding, kind: Geometry.Kind) {
  const document = yield* documentOf(state, node.document)
  const realm = yield* Evaluation.realm(state, node.document, { _tag: "Isolated", name: "__strider_utility__" })
  const data = yield* Evaluation.evaluate(state, realm, Geometry.call(node, kind === "bounds" ? "bounds" : "metadata"))
    .pipe(Effect.flatMap(Geometry.decode))
  if (kind === "bounds" || data.quads.length === 0) return { document: node.document, data }
  const reply = yield* Kit.protocol(
    DOM.getBoxModel({ backendNodeId: Number(node.binding) as DOM.BackendNodeId }).pipe(
      Protocol.on(document.frame.owner.session),
      Effect.catchIf(
        (error) =>
          error.reason._tag === "Rejected" && error.reason.code === -32000 &&
          error.reason.description === "Could not compute box model.",
        () => Effect.succeed(null)
      )
    )
  )
  // A hidden ancestor can suppress native layout even while child DOM rectangles remain cached.
  if (reply === null) return { document: node.document, data: { ...data, quads: [] } }
  const q = reply.model.border
  let quad: Geometry.Data["quads"][number] = [
    { x: q[0]!, y: q[1]! },
    { x: q[2]!, y: q[3]! },
    { x: q[4]!, y: q[5]! },
    { x: q[6]!, y: q[7]! }
  ]
  // Native quads compose the owning session's local frame tree, not necessarily the entire page tree.
  const root = document.frame.owner.frame ?? state.frames.get(document.frame.owner.targetId)
  if (root?.document === undefined) return yield* Effect.fail(Kit.ended({ _tag: "Document", id: node.document }))
  // CDP normalizes the root-frame quad by the queried frame's layout zoom, which can differ
  // from the coordinate document's zoom across a same-process frame boundary.
  if (root.document.id !== node.document) {
    const rootRealm = yield* Evaluation.realm(state, root.document.id, {
      _tag: "Isolated",
      name: "__strider_utility__"
    })
    const scale = yield* Evaluation.evaluate(state, rootRealm, {
      functionDeclaration: "function(){return devicePixelRatio}",
      arguments: [],
      awaitPromise: false,
      result: "value",
      userActivation: false
    })
    if (
      scale._tag !== "Value" || scale.value.type !== "number" || typeof scale.value.value !== "number" ||
      !Number.isFinite(scale.value.value) || scale.value.value <= 0
    ) {
      return yield* Effect.fail(
        Geometry.incompatible("The browser did not return the coordinate viewport's pixel ratio", scale)
      )
    }
    const factor = data.pixelRatio / scale.value.value
    const scaled = (p: Geometry.Point) => ({ x: p.x * factor, y: p.y * factor })
    quad = [scaled(quad[0]), scaled(quad[1]), scaled(quad[2]), scaled(quad[3])]
  }
  const matrix = kind === "frame"
    ? Geometry.fromQuad(quad, data.width, data.height, data.contentX, data.contentY)
    : null
  if (kind === "frame" && matrix === null) {
    const local = yield* Evaluation.evaluate(state, realm, Geometry.call(node, kind)).pipe(
      Effect.flatMap(Geometry.decode)
    )
    return { document: node.document, data: local }
  }
  return { document: root.document.id, data: { ...data, quads: [quad], matrix } }
})
