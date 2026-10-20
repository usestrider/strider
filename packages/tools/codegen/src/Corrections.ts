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
import type { ProtocolModel, Traits } from "./Model.ts"
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
  return { ...model, shapes }
}
