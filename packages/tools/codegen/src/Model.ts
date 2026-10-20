/**
 * The protocol model: one committed JSON document per backend revision, keyed by name so that patch pointers
 * survive browser rolls (PROTOCOL.md, Code generation).
 *
 * Shape ids are `Domain#Name` for named types, commands and events. Shapes the spec writes inline get ids
 * derived from their owner: `Page#navigate.Params` for a command's parameters, `Page#navigate.Result` for its
 * result, `Page#Frame.adFrameStatus` for an enum written inside a member. A member is addressed as
 * `ShapeId:member` in overlays.
 */
import * as Schema from "effect/Schema"

export const Status = Schema.Literals(["stable", "experimental", "deprecated"])
export type Status = typeof Status.Type

/** Spec facts, plus the annotations the overlay adds. */
export const Traits = Schema.Struct({
  status: Status,
  description: Schema.optionalKey(Schema.String),
  /** CDP: the command is implemented by another domain. */
  redirect: Schema.optionalKey(Schema.String),
  /** Overlay: a branded id, never interchangeable with another kind or protocol. */
  id: Schema.optionalKey(Schema.Literal(true)),
  /** Overlay: decodes as `Redacted`. */
  sensitive: Schema.optionalKey(Schema.Literal(true)),
  /** Overlay: which session a command is sent on. */
  session: Schema.optionalKey(Schema.Literals(["browser", "target"])),
  /** Overlay: what L1 must undo if the caller is interrupted after dispatch. */
  compensation: Schema.optionalKey(Schema.String),
  /** WebKit: the build flags the item is compiled under, as the spec writes them. */
  condition: Schema.optionalKey(Schema.String),
  /** BiDi: a map that admits keys beyond its members (`Extensible`). */
  extensible: Schema.optionalKey(Schema.Literal(true)),
  /** Overlay: late replies route to an owner for adoption or cleanup. */
  createsResource: Schema.optionalKey(Schema.Literal(true)),
  /**
   * Overlay: the commands that release what a reply hands out, each taking `param` from the result at the
   * JSON pointer `from`, where `*` stands for every element of a list.
   */
  release: Schema.optionalKey(Schema.Array(Schema.Struct({
    method: Schema.String,
    param: Schema.String,
    from: Schema.String,
    /** The parameter is a list: the value goes in one. */
    list: Schema.optionalKey(Schema.Literal(true))
  })))
})
export type Traits = typeof Traits.Type

export type Scalar = "string" | "integer" | "number" | "boolean" | "unknown"

export type TypeExpr =
  | { readonly _tag: "Ref"; readonly shape: string }
  | { readonly _tag: "Scalar"; readonly scalar: Scalar }
  | { readonly _tag: "List"; readonly items: TypeExpr }
  /** An object the spec leaves untyped: string keys, unknown values. */
  | { readonly _tag: "Record" }
  /** BiDi: one exact value, such as a union's discriminator (`type: "window"`). */
  | { readonly _tag: "Literal"; readonly value: string | number | boolean | null }
  /** BiDi: any of several types, tried in order. */
  | { readonly _tag: "Union"; readonly members: ReadonlyArray<TypeExpr> }
  /** BiDi: a fixed-length array. */
  | { readonly _tag: "Tuple"; readonly items: ReadonlyArray<TypeExpr> }
  /** BiDi: string keys, values of one type. */
  | { readonly _tag: "Map"; readonly values: TypeExpr }

const self = Schema.suspend((): Schema.Codec<TypeExpr> => TypeExpr)

export const TypeExpr: Schema.Codec<TypeExpr> = Schema.Union([
  Schema.TaggedStruct("Ref", { shape: Schema.String }),
  Schema.TaggedStruct("Scalar", { scalar: Schema.Literals(["string", "integer", "number", "boolean", "unknown"]) }),
  Schema.TaggedStruct("List", { items: self }),
  Schema.TaggedStruct("Record", {}),
  Schema.TaggedStruct("Literal", { value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]) }),
  Schema.TaggedStruct("Union", { members: Schema.Array(self) }),
  Schema.TaggedStruct("Tuple", { items: Schema.Array(self) }),
  Schema.TaggedStruct("Map", { values: self })
])

export const Member = Schema.Struct({
  type: TypeExpr,
  optional: Schema.Boolean,
  traits: Traits
})
export type Member = typeof Member.Type

export const Shape = Schema.Union([
  Schema.TaggedStruct("Command", {
    method: Schema.String,
    params: Schema.NullOr(Schema.String),
    result: Schema.NullOr(Schema.String),
    traits: Traits
  }),
  Schema.TaggedStruct("Event", { method: Schema.String, params: Schema.NullOr(Schema.String), traits: Traits }),
  Schema.TaggedStruct("Struct", { members: Schema.Record(Schema.String, Member), traits: Traits }),
  Schema.TaggedStruct("Enum", { values: Schema.Array(Schema.String), traits: Traits }),
  /** A named type that is neither a struct nor an enum: an id, a number, a list. */
  Schema.TaggedStruct("Alias", { type: TypeExpr, traits: Traits })
])
export type Shape = typeof Shape.Type

export const Domain = Schema.Struct({
  dependencies: Schema.Array(Schema.String),
  traits: Traits
})
export type Domain = typeof Domain.Type

export const ProtocolModel = Schema.Struct({
  backend: Schema.Literals(["cdp", "bidi", "webkit"]),
  revision: Schema.String,
  domains: Schema.Record(Schema.String, Domain),
  shapes: Schema.Record(Schema.String, Shape)
})
export type ProtocolModel = typeof ProtocolModel.Type

/** `Page#Frame` → `["Page", "Frame"]`. */
export const splitId = (id: string): readonly [domain: string, name: string] => {
  const index = id.indexOf("#")
  return [id.slice(0, index), id.slice(index + 1)]
}

/** The same model with its shapes and domains in sorted order, so serialization is deterministic. */
export const sorted = (model: ProtocolModel): ProtocolModel => ({
  ...model,
  domains: Object.fromEntries(Object.entries(model.domains).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
  shapes: Object.fromEntries(Object.entries(model.shapes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
})
