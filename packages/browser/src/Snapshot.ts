/**
 * Accessibility snapshots of a page, for agents and for checking a page's structure.
 *
 * A snapshot is a tree, with a YAML rendering of it in `text`. By default `snapshot` adds the interactivity and
 * names it can infer on pages that aren't fully accessible, and marks each inference with what it came from;
 * `snapshot({ sources: "aria" })` is the accessibility tree alone. While a document lives, the same node keeps the
 * same ref.
 *
 * The tree is data, so it can be encoded for the CLI, an MCP result, or a trace. `ref(id)` returns a locator for a
 * node, bound to the page the snapshot came from and with that page's access.
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
import * as ReasonCause from "./internal/reasonCause.ts"
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
 * A ref is meaningful only for the document and generation it came from. The agent toolkit decodes a model's
 * `"e12"` to a `RefId` and checks it against that page's latest snapshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RefId = typeof RefId.Type

/**
 * Schema for a ref generation: the id of the table of refs Strider keeps in a document. It changes only when
 * Strider has to rebuild that table, which leaves every earlier ref stale.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Generation = Schema.Number.pipe(Schema.brand("~@usestrider/browser/Snapshot/Generation"))

/**
 * A ref generation: the id of the table of refs Strider keeps in a document.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Generation = typeof Generation.Type

/**
 * Schema for what made a node count as interactive when its role doesn't say so.
 * Password inputs carry `password` evidence on an inferred `editable` role, preserving their accessible
 * label without inferring a name or exposing their value.
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
  "onclickAttribute",
  "password"
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
 * A node's role and where it came from: the accessibility tree's (`Aria`), or one inferred from what the node does
 * (`Inferred`), with the evidence for it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Role =
  | { readonly _tag: "Aria"; readonly role: AriaRole.AriaRole }
  | {
    readonly _tag: "Inferred"
    readonly role: "clickable" | "editable" | "focusable"
    readonly evidence: readonly [InteractivityEvidence, ...Array<InteractivityEvidence>]
  }

/**
 * Schema for a node's role and where it came from.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Role: Schema.Codec<Role> = Schema.Union([
  // A role is an open string (`AriaRole`): one added after this version still decodes
  Schema.TaggedStruct("Aria", { role: Schema.String }),
  Schema.TaggedStruct("Inferred", {
    role: Schema.Literals(["clickable", "editable", "focusable"]),
    evidence: Schema.NonEmptyArray(InteractivityEvidence)
  })
]) as Schema.Codec<Role>

/**
 * Schema for a node's name and where it came from: its accessible name (`Accessible`), one inferred from the page
 * (`Inferred`), which says what it came `from`, or none. Accessible names derived from an editable
 * element's content carry optional `from: "text"`; explicit labels do not. Optional `fieldContent`, collected for redacted capture only, is true when
 * the chosen accessible or inferred name contains field content, even when copied from another node.
 * Ordinary library snapshots and full capture omit this provenance; absence is not evidence that a name is public.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Name = Schema.Union([
  Schema.TaggedStruct("Accessible", {
    value: Schema.String,
    from: Schema.optional(Schema.Literal("text")),
    fieldContent: Schema.optional(Schema.Boolean)
  }),
  Schema.TaggedStruct("Inferred", {
    value: Schema.String,
    from: Schema.Literals(["text", "title", "placeholder", "alt", "nearbyLabel"]),
    fieldContent: Schema.optional(Schema.Boolean)
  }),
  Schema.TaggedStruct("None", {})
])

/**
 * A node's name and where it came from.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Name = typeof Name.Type

/**
 * Schema for a state a node can be in.
 *
 * **Details**
 *
 * Pressed, expanded, and selected appear only when their role-filter reader returns true.
 * ARIA keywords are ASCII case-insensitive without trimming; unsupported roles contribute no marker.
 * Native option selection and details open state take precedence over ARIA attributes.
 * Open details carries expanded even with its ordinary group role; group expanded filters remain invalid.
 * Summary expansion is not inferred. These markers describe Strider's query policy rather than browser
 * accessibility-tree state, which can differ for conflicting native and ARIA values.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const State = Schema.Literals(["checked", "expanded", "selected", "disabled", "focused", "pressed", "invalid"])

/**
 * A state a node can be in, such as `checked` or `disabled`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type State = typeof State.Type

/**
 * One node of a snapshot tree.
 *
 * **Details**
 *
 * Where a role or name came from is always visible: `Aria` and `Accessible` come from the accessibility
 * tree. An `Inferred` role carries its `evidence`, and an `Inferred` name says what it came `from`.
 *
 * Optional `editable` records native or ARIA field kinds and DOM contenteditability independently of role,
 * including plaintext-only contenteditables. It remains true for disabled and read-only fields. Redacted capture
 * collects it; ordinary library and full capture omit it. Older snapshot nodes without this property still decode.
 * Text rendering does not print this signal.
 *
 * Native controls that participate in constraint validation carry `invalid` and their browser-provided
 * `validationMessage` when invalid. Other nodes carry `None`. Inspection reads current state without
 * triggering validation events or changing focus. Invalidity does not prove a submission was attempted.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Node {
  readonly ref: Option.Option<RefId>
  readonly role: Role
  readonly name: Name
  readonly states: ReadonlySet<State>
  /** Whether this node takes field input, independent of role and read-only or disabled state. Collected for redacted capture; absent when not collected or not a field. */
  readonly editable?: boolean | undefined
  readonly validationMessage: Option.Option<string>
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
  /** Whether this node takes field input, independent of role and read-only or disabled state. Collected for redacted capture; absent when not collected or not a field. */
  readonly editable?: boolean | undefined
  readonly validationMessage: Option.Option<string>
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
  role: Role,
  name: Name,
  states: Schema.ReadonlySet(State),
  editable: Schema.optional(Schema.Boolean),
  validationMessage: Schema.Option(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<Node, NodeEncoded> => Node))
})

/**
 * The data of a snapshot: which document it describes, its generation, its tree, and its text rendering.
 *
 * **Example** (Encoding a snapshot as JSON)
 *
 * ```ts import.meta.vitest
 * import { Page, Snapshot } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const snapshotJson = Effect.fn("snapshotJson")(function*(page: Page.ReadonlyPage) {
 *   const snapshot = yield* page.snapshot()
 *   return yield* Schema.encodeEffect(
 *     Schema.fromJsonString(Schema.toCodecJson(Snapshot.Data))
 *   )(snapshot)
 * })
 * ```
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
   * Acting on it fails with `StaleRef` once its node is removed, or its document or generation moves on. Use a
   * locator built from roles and names for anything that must survive a re-render.
   *
   * **Example** (Acting on a ref an agent chose)
   *
   * ```ts import.meta.vitest
   * import { Page, Snapshot } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const clickRef = Effect.fn("clickRef")(function*(page: Page.Page, id: Snapshot.RefId) {
   *   const snapshot = yield* page.snapshot()
   *   yield* snapshot.ref(id).click()
   * })
   * ```
   */
  ref(id: RefId): L
  /**
   * What changed since `previous`; fails with `DocumentsDiffer` when the two describe different documents.
   *
   * **Example** (What a click changed)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const whatChanged = Effect.fn("whatChanged")(function*(page: Page.Page) {
   *   const before = yield* page.snapshot()
   *   yield* page.getByRole("button", { name: "Add to cart" }).click()
   *   const after = yield* page.snapshot()
   *   const diff = yield* after.diff(before)
   *   return diff.text
   * })
   * ```
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
 * **Example** (Diffing only within one document)
 *
 * ```ts import.meta.vitest
 * import { Snapshot } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const changes = Effect.fn("changes")(
 *   function*(before: Snapshot.Snapshot, after: Snapshot.Snapshot) {
 *     return yield* after.diff(before).pipe(
 *       Effect.map(Option.some),
 *       Effect.catchReason("SnapshotError", "DocumentsDiffer", () => Effect.succeedNone)
 *     )
 *   }
 * )
 * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
