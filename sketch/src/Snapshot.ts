/**
 * Accessibility snapshots for agents and for structural expectations.
 *
 * A structured tree; `text` is one rendering of it. The default `snapshot` adds inferred interactivity and
 * names for inaccessible sites, and every inference is tagged with its evidence. `ariaSnapshot` is the pure
 * accessibility tree. Same node, same ref within a document generation. A snapshot's refs carry the access of
 * the page it came from: a ReadonlyPage's snapshot hands out ReadonlyLocators.
 */
import type { Effect } from "effect"
import type { AriaRole, DocumentGeneration, DocumentId, RefId } from "./Brand.ts"
import type { SnapshotDiffError } from "./Errors.ts"
import type { ReadonlyLocator } from "./Locator.ts"

export interface Snapshot<L extends ReadonlyLocator = ReadonlyLocator> {
  readonly document: DocumentId
  readonly generation: DocumentGeneration
  readonly root: SnapshotNode
  readonly text: string                                 // the YAML rendering agents already read, plus evidence tags
  readonly refs: ReadonlyMap<RefId, SnapshotNode>
  /** A locator pinned to one node, never rebound; acting fails with StaleRef once the document or generation moves on. */
  ref(id: RefId): L
  /** Explicit; fails if the documents differ. */
  diff(previous: Snapshot<ReadonlyLocator>): Effect.Effect<SnapshotDiff, SnapshotDiffError>
}

export interface SnapshotNode {
  readonly ref: import("effect").Option.Option<RefId>
  readonly role:                                        // where the role came from is always visible
    | { readonly _tag: "Aria"; readonly role: AriaRole }
    | { readonly _tag: "Inferred"; readonly role: "clickable" | "editable" | "focusable"; readonly evidence: readonly [InteractivityEvidence, ...Array<InteractivityEvidence>] }
  readonly name:
    | { readonly _tag: "Accessible"; readonly value: string }
    | { readonly _tag: "Inferred"; readonly value: string; readonly from: "text" | "title" | "placeholder" | "alt" | "nearbyLabel" }
    | { readonly _tag: "None" }
  readonly states: ReadonlySet<"checked" | "expanded" | "selected" | "disabled" | "focused" | "pressed">
  readonly children: ReadonlyArray<SnapshotNode>
}
export type InteractivityEvidence = "clickListener" | "cursorPointer" | "tabindex" | "contentEditable" | "onclickAttribute"
export interface SnapshotDiff {
  readonly added: ReadonlyArray<SnapshotNode>
  readonly removed: ReadonlyArray<RefId>
  readonly changed: ReadonlyArray<SnapshotNode>
  readonly text: string
}
export interface SnapshotOptions {                      // defaults: aria+interactivity, the whole page, every level, every node
  readonly sources?: "aria" | "aria+interactivity"
  readonly root?: ReadonlyLocator
  readonly depth?: number
  readonly interactiveOnly?: boolean
}
