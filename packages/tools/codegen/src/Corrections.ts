/**
 * Corrections (`patches/`) and annotations (`overlay/`), applied to the parsed model.
 *
 * A correction is a claim that the spec is wrong about the wire: a JSON patch with what the spec states, what
 * the browser does, and the evidence. An annotation is our own semantics, which no upstream will absorb: id
 * brands, sensitive members, session scope, compensation, resource creation. Both fail on a target that no
 * longer resolves, so a roll that moves something can't silently drop a correction.
 */
import * as JsonPatch from "effect/JsonPatch"
import * as Schema from "effect/Schema"
import type { ProtocolModel, Shape, Traits, TypeExpr } from "./Model.ts"
import { ProtocolModel as ProtocolModelSchema, sorted, Traits as TraitsSchema } from "./Model.ts"

export const Correction = Schema.Struct({
  /** What the spec states. */
  spec: Schema.String,
  /** What the browser does on the wire. */
  wire: Schema.String,
  /** The probe or recorded trace that showed it. */
  evidence: Schema.String,
  operations: Schema.Array(Schema.Union([
    Schema.Struct({ op: Schema.Literal("add"), path: Schema.String, value: Schema.Json }),
    Schema.Struct({ op: Schema.Literal("remove"), path: Schema.String }),
    Schema.Struct({ op: Schema.Literal("replace"), path: Schema.String, value: Schema.Json })
  ]))
})
export type Correction = typeof Correction.Type

/** Overlay traits: everything but the spec's own facts. */
const Annotation = TraitsSchema.mapFields((
  { status: _status, description: _description, redirect: _redirect, ...annotations }
) => annotations)

export const Overlay = Schema.Struct({
  /** Why these annotations hold. */
  reason: Schema.String,
  /** `Domain#Shape`, or `Domain#Shape:member` for a member. */
  annotate: Schema.Array(Schema.Struct({ target: Schema.String, traits: Annotation }))
})
export type Overlay = typeof Overlay.Type

/**
 * Applies corrections in file order. A pointer that no longer resolves fails, naming the file.
 */
export const applyCorrections = (
  model: ProtocolModel,
  corrections: ReadonlyArray<readonly [file: string, correction: Correction]>
): ProtocolModel => {
  let current: Schema.Json = model as unknown as Schema.Json
  for (const [file, correction] of corrections) {
    try {
      current = JsonPatch.apply(correction.operations as JsonPatch.JsonPatch, current)
    } catch (cause) {
      throw new Error(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return sorted(Schema.decodeUnknownSync(ProtocolModelSchema)(current))
}

/**
 * Applies annotations. A target that doesn't exist fails, naming the file.
 */
export const applyOverlays = (
  model: ProtocolModel,
  overlays: ReadonlyArray<readonly [file: string, overlay: Overlay]>
): ProtocolModel => {
  const shapes = structuredClone(model.shapes) as Record<string, any>
  for (const [file, overlay] of overlays) {
    for (const { target, traits } of overlay.annotate) {
      const [shapeId, member] = target.split(":") as [string, string | undefined]
      const shape = shapes[shapeId]
      if (shape === undefined) throw new Error(`${file}: no shape ${shapeId}`)
      const owner = member === undefined ? shape : shape.members?.[member]
      if (owner === undefined) throw new Error(`${file}: ${shapeId} has no member ${member}`)
      owner.traits = { ...owner.traits, ...traits } satisfies Traits
    }
  }
  const annotated = { ...model, shapes }
  checkReleases(annotated)
  return annotated
}

/**
 * Checks every `release` annotation against the model: it belongs to a command that creates a resource, names
 * a command that takes `param`, and its pointer resolves through the command's result. A roll that moves any
 * of them fails here, rather than at run time.
 */
const checkReleases = (model: ProtocolModel): void => {
  const commands = new Map<string, string>()
  for (const [id, shape] of Object.entries(model.shapes)) {
    if (shape._tag === "Command") commands.set(shape.method, id)
  }
  for (const [id, shape] of Object.entries(model.shapes)) {
    const releases = shape.traits.release
    if (releases === undefined) continue
    if (shape._tag !== "Command" || shape.traits.createsResource !== true) {
      throw new Error(`${id}: only a command that creates a resource can name its release`)
    }
    for (const release of releases) {
      const releaseId = commands.get(release.method)
      if (releaseId === undefined) throw new Error(`${id}: no command ${release.method} releases it`)
      const releaseShape = model.shapes[releaseId]
      const params = releaseShape?._tag === "Command" && releaseShape.params !== null
        ? model.shapes[releaseShape.params]
        : undefined
      // Parameters that are a union (BiDi's session.unsubscribe) take the parameter if any case does
      const cases = params?._tag === "Alias" && params.type._tag === "Union"
        ? params.type.members.map((member) => member._tag === "Ref" ? model.shapes[member.shape] : undefined)
        : [params]
      if (!cases.some((shape) => shape?._tag === "Struct" && release.param in shape.members)) {
        throw new Error(`${id}: ${release.method} has no parameter ${release.param}`)
      }
      if (shape.result === null) throw new Error(`${id}: has no result to release from`)
      resolvePointer(model, shape.result, release.from, id)
    }
  }
}

/** Follows a JSON pointer through the model's shapes; `*` steps into a list's items. */
const resolvePointer = (model: ProtocolModel, from: string, pointer: string, owner: string): void => {
  if (!pointer.startsWith("/")) throw new Error(`${owner}: ${pointer} isn't a JSON pointer`)
  let type: TypeExpr = { _tag: "Ref", shape: from }
  for (const segment of pointer.slice(1).split("/")) {
    while (type._tag === "Ref") {
      const shape: Shape | undefined = model.shapes[type.shape]
      if (shape?._tag === "Alias") type = shape.type
      else break
    }
    if (segment === "*") {
      if (type._tag !== "List") throw new Error(`${owner}: ${pointer} steps into a list where there is none`)
      type = type.items
      continue
    }
    const shape = type._tag === "Ref" ? model.shapes[type.shape] : undefined
    const member = shape?._tag === "Struct" ? shape.members[segment] : undefined
    if (member === undefined) throw new Error(`${owner}: ${pointer} doesn't resolve at ${segment}`)
    type = member.type
  }
}
