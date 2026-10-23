/**
 * Accessibility snapshots, for agents and for structural expectations.
 *
 * A snapshot is a structured tree; its `text` is one rendering of it, the YAML agents already read. The
 * default `snapshot` adds inferred interactivity and names for sites that aren't accessible, and every
 * inference is tagged with its evidence. `ariaSnapshot` is the accessibility tree alone. Within one document
 * generation, the same node keeps the same ref.
 *
 * The tree is data (a Schema), so it can be encoded for the CLI, an MCP result or a trace. The refs are not:
 * `ref(id)` returns a locator bound to the page the snapshot came from, with that page's access.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as AriaRole from "./AriaRole.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as Locator from "./Locator.ts"
import * as Target from "./Target.ts"

/**
 * Schema for a ref an agent can act on, such as `e12`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RefId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Snapshot/RefId"))

/**
 * A ref an agent can act on, such as `e12`.
 *
 * **Details**
 *
 * A ref is meaningful only for the document and generation it came from. Decoding a model's `"e12"` gives a
 * `RefId`, which is then checked against that page's latest snapshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RefId = typeof RefId.Type

/**
 * Schema for a document generation, which advances when the document changes enough to invalidate refs.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Generation = Schema.Number.pipe(Schema.brand("~@usestrider/browser/Snapshot/Generation"))

/**
 * A document generation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Generation = typeof Generation.Type

/**
 * Schema for what made a node count as interactive when its role doesn't say so.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InteractivityEvidence = Schema.Literals([
  "clickListener",
  "cursorPointer",
  "tabindex",
  "contentEditable",
  "onclickAttribute"
])

/**
 * What made a node count as interactive when its role doesn't say so.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InteractivityEvidence = typeof InteractivityEvidence.Type

/**
 * One node of a snapshot tree.
 *
 * **Details**
 *
 * Where a role or name came from is always visible: `Aria` and `Accessible` come from the accessibility
 * tree, and `Inferred` carries its evidence.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Node {
  readonly ref: Option.Option<RefId>
  readonly role:
    | { readonly _tag: "Aria"; readonly role: AriaRole.AriaRole }
    | {
      readonly _tag: "Inferred"
      readonly role: "clickable" | "editable" | "focusable"
      readonly evidence: readonly [InteractivityEvidence, ...Array<InteractivityEvidence>]
    }
  readonly name:
    | { readonly _tag: "Accessible"; readonly value: string }
    | {
      readonly _tag: "Inferred"
      readonly value: string
      readonly from: "text" | "title" | "placeholder" | "alt" | "nearbyLabel"
    }
    | { readonly _tag: "None" }
  readonly states: ReadonlySet<"checked" | "expanded" | "selected" | "disabled" | "focused" | "pressed">
  readonly children: ReadonlyArray<Node>
}

/**
 * The encoded form of a `Node`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NodeEncoded {
  readonly ref: Option.Option<string>
  readonly role: Node["role"]
  readonly name: Node["name"]
  readonly states: Node["states"]
  readonly children: ReadonlyArray<NodeEncoded>
}

/**
 * Schema for one node of a snapshot tree.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Node: Schema.Codec<Node, NodeEncoded> = Schema.Struct({
  ref: Schema.Option(RefId),
  role: Schema.Union([
    // A role is an open string (`AriaRole`): one added after this version still decodes
    Schema.TaggedStruct("Aria", { role: Schema.String }),
    Schema.TaggedStruct("Inferred", {
      role: Schema.Literals(["clickable", "editable", "focusable"]),
      evidence: Schema.NonEmptyArray(InteractivityEvidence)
    })
  ]),
  name: Schema.Union([
    Schema.TaggedStruct("Accessible", { value: Schema.String }),
    Schema.TaggedStruct("Inferred", {
      value: Schema.String,
      from: Schema.Literals(["text", "title", "placeholder", "alt", "nearbyLabel"])
    }),
    Schema.TaggedStruct("None", {})
  ]),
  states: Schema.ReadonlySet(Schema.Literals(["checked", "expanded", "selected", "disabled", "focused", "pressed"])),
  children: Schema.Array(Schema.suspend((): Schema.Codec<Node, NodeEncoded> => Node))
})

/**
 * The data of a snapshot: which document it describes, its tree, and its text rendering.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Data extends Schema.Class<Data>("@usestrider/browser/Snapshot/Data")({
  document: Target.DocumentId,
  generation: Generation,
  root: Node,
  text: Schema.String
}) {}

/**
 * What changed between two snapshots of the same document.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Diff extends Schema.Class<Diff>("@usestrider/browser/Snapshot/Diff")({
  added: Schema.Array(Node),
  removed: Schema.Array(RefId),
  changed: Schema.Array(Node),
  text: Schema.String
}) {}

const TypeId = "~@usestrider/browser/Snapshot"

/**
 * A snapshot of a page, whose refs carry the page's access.
 *
 * **Details**
 *
 * `L` follows the access of the page the snapshot came from: a `ReadonlyPage`'s snapshot hands out
 * `ReadonlyLocator`s, so its refs can't act.
 *
 * **Example** (Acting on a ref an agent chose)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page, Snapshot } from "@usestrider/browser"
 *
 * const clickRef = Effect.fn("clickRef")(function*(page: Page.Page, id: Snapshot.RefId) {
 *   const snapshot = yield* page.snapshot()
 *   yield* snapshot.ref(id).click()
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Snapshot<L extends Locator.ReadonlyLocator = Locator.ReadonlyLocator> extends Data {
  readonly [TypeId]: typeof TypeId
  /**
   * Every node with a ref, by ref.
   */
  readonly refs: ReadonlyMap<RefId, Node>
  /**
   * A locator pinned to one node and never rebound.
   *
   * **Gotchas**
   *
   * Acting on it fails with `StaleRef` once the document or generation moves on. Use a locator built from
   * roles and names for anything that must survive a re-render.
   */
  ref(id: RefId): L
  /**
   * What changed since `previous`; fails when the two describe different documents.
   */
  diff(previous: Snapshot): Effect.Effect<Diff, SnapshotError>
}

/**
 * Checks whether a value is a `Snapshot`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isSnapshot = (u: unknown): u is Snapshot => Predicate.hasProperty(u, TypeId)

/**
 * Settings for taking a snapshot.
 *
 * **Details**
 *
 * Size is explicit: nothing is truncated automatically. Narrow a large page with `depth` or
 * `interactiveOnly`, or snapshot one element's subtree with `locator.snapshot()`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * The accessibility tree alone, or with inferred interactivity.
   *
   * @default "aria+interactivity"
   */
  readonly sources?: "aria" | "aria+interactivity" | undefined
  /**
   * Levels below the root to include.
   *
   * @default every level
   */
  readonly depth?: number | undefined
  /**
   * Keep only interactive nodes and their ancestors.
   *
   * @default false
   */
  readonly interactiveOnly?: boolean | undefined
}

/**
 * Reason for a diff between snapshots of different documents.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DocumentsDiffer extends Schema.Error<DocumentsDiffer>("@usestrider/browser/Snapshot/DocumentsDiffer")({
  _tag: Schema.tag("DocumentsDiffer"),
  documents: Schema.Tuple([Target.DocumentId, Target.DocumentId]),
  hint: Schema.String
}) {
  override get message(): string {
    return `Snapshots describe different documents (${this.hint})`
  }
}

const SnapshotErrorTypeId = "~@usestrider/browser/Snapshot/SnapshotError"

/**
 * Error for a snapshot operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class SnapshotError extends Schema.TaggedError<SnapshotError>(SnapshotErrorTypeId)("SnapshotError", {
  reason: DocumentsDiffer,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [SnapshotErrorTypeId] = SnapshotErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `SnapshotError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isSnapshotError = (u: unknown): u is SnapshotError => Predicate.hasProperty(u, SnapshotErrorTypeId)
