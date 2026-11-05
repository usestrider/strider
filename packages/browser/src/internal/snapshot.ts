/**
 * Snapshots: the engine's accessibility tree of a document, the same on every backend and
 * the one `getByRole` matches, with each frame's tree stitched in under its iframe.
 *
 * - **Refs.** The engine gives every element node a ref, which names that node for as long as its document lives.
 *   A frame's refs are prefixed with the frame's place in the snapshot (`f1e3`). `ref(id)` is a locator pinned to
 *   the node, through the iframes on its way; it never rebinds, and fails with `StaleRef` once the node, its
 *   document or the engine's table is gone.
 * - **The tree** is narrowed by `depth` in the engine, and by `interactiveOnly` here, once the frames are in.
 * - **`text`** is the tree as indented YAML (`Engine.renderText`).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Equivalence from "effect/Equivalence"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Locator from "../Locator.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Snapshot from "../Snapshot.ts"
import type * as Target from "../Target.ts"
import * as Engine from "./engine.ts"
import type { Locate, Owner } from "./locatorOwner.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"

/** Internal masking-metadata request; ordinary library snapshots omit field editability and name provenance. @default false */
export const NameProvenance = Context.Reference<boolean>("@usestrider/browser/internal/snapshot/NameProvenance", {
  defaultValue: () => false
})

const TypeId = "~@usestrider/browser/Snapshot"

/** Roles a person acts on; with inferred nodes, what `interactiveOnly` keeps. */
const INTERACTIVE = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem"
])

/** A snapshot, or the engine's answer for why there is none (no match, several, a stale ref). */
export type Taken = { readonly _tag: "Taken"; readonly snapshot: SnapshotImpl } | {
  readonly _tag: "Response"
  readonly response: Engine.Response
}

/** A ref's locator steps, by the ref the snapshot shows. */
type Table = Map<string, ReadonlyArray<Engine.Step>>

/**
 * Takes a snapshot of the page's document (`steps` null) or of a locator's one match, with the trees of the frames
 * inside it.
 */
export const take = (
  owner: Owner,
  locate: Locate,
  steps: ReadonlyArray<Engine.Step> | null,
  options: Snapshot.Options | undefined,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<Taken, Runtime.SendFailure> =>
  Effect.gen(function*() {
    const interactivity = (options?.sources ?? "aria+interactivity") === "aria+interactivity"
    const depth = options?.depth ?? null
    const provenance = yield* NameProvenance
    const answer = yield* Runtime.sendRouted(
      owner.runtime,
      owner.page,
      { op: "snapshot", steps, interactivity, depth, provenance },
      id,
      at
    )
    const response = answer.response
    if (response._tag !== "Snapshot") return { _tag: "Response", response } as const
    // The steps a ref in the root's document begins with: the frames the locator entered
    const boundary = steps === null ? -1 : steps.findLastIndex((step) => step._tag === "Frame")
    const prefix = steps === null ? [] : steps.slice(0, boundary + 1)
    const table: Table = new Map()
    let frames = 0
    /** A document's tree with its refs named and their steps kept, and its frames' trees stitched in. */
    const stitch = (
      node: Engine.SnapNode,
      document: Target.DocumentId,
      generation: number,
      before: ReadonlyArray<Engine.Step>,
      name: string,
      level: number
    ): Effect.Effect<Engine.SnapNode, Runtime.SendFailure> =>
      Effect.gen(function*() {
        const ref = node.ref === null ? null : `${name}${node.ref}`
        const own: ReadonlyArray<Engine.Step> = [...before, {
          _tag: "Ref",
          document,
          generation,
          ref: node.ref ?? ""
        }]
        if (ref !== null) table.set(ref, own)
        let children: ReadonlyArray<Engine.SnapNode>
        if (node.frame && node.ref !== null && (depth === null || level < depth)) {
          children = yield* frameTree(own, level)
        } else {
          children = yield* Effect.forEach(
            node.children,
            (child) => stitch(child, document, generation, before, name, level + 1)
          )
        }
        return { ...node, ref, children }
      })
    /** The tree of the frame an iframe holds, its root's children under the iframe; none when it has no document. */
    const frameTree = Effect.fnUntraced(function*(iframe: ReadonlyArray<Engine.Step>, level: number) {
      const found = yield* Runtime.element(owner.runtime, owner.page, iframe, id, at)
      if (found._tag !== "Found") return []
      // A frame the browser can't name is left out; the deadline ends the snapshot
      const frame = yield* owner.runtime.model.adapter.contentFrame(found.node).pipe(
        Effect.catch((error) =>
          Deadline.isTimeout(error) ? Effect.fail<Runtime.SendFailure>({ _tag: "Deadline" }) : Effect.succeedNone
        )
      )
      if (Option.isNone(frame)) return []
      const document = yield* owner.runtime.model.documentOf(frame.value)
      if (Option.isNone(document)) return []
      const inner = yield* Runtime.sendToDocument(owner.runtime, owner.page, document.value, {
        op: "snapshot",
        steps: null,
        interactivity,
        provenance,
        depth: depth === null ? null : depth - level
      }, id).pipe(Effect.orElseSucceed(() => Option.none<Engine.Response>()))
      if (Option.isNone(inner) || inner.value._tag !== "Snapshot") return []
      const name = `f${++frames}`
      const root = inner.value.root
      const generation = inner.value.generation
      return yield* Effect.forEach(
        root.children,
        (child) => stitch(child, document.value, generation, [...iframe, { _tag: "Frame" }], name, level + 1)
      )
    })
    const stitched = yield* stitch(response.root, answer.routed.document, response.generation, prefix, "", 0)
    const root = options?.interactiveOnly === true ? prune(stitched) ?? { ...stitched, children: [] } : stitched
    return {
      _tag: "Taken",
      snapshot: SnapshotImpl.of(
        {
          document: answer.routed.document,
          generation: Snapshot.Generation.make(response.generation),
          root: toNode(root),
          text: Engine.renderText(root)
        },
        locate,
        table
      )
    } as const
  })

/** Interactive nodes and their ancestors; `undefined` when nothing in the subtree is interactive. */
const prune = (node: Engine.SnapNode): Engine.SnapNode | undefined => {
  const children = node.children.map(prune).filter((child): child is Engine.SnapNode => child !== undefined)
  const interactive = node.role._tag === "Inferred" || INTERACTIVE.has(node.role.role)
  return interactive || children.length > 0 ? { ...node, children } : undefined
}

/** The engine's node as the `Snapshot.Node` schema has it. */
const toNode = (node: Engine.SnapNode): Snapshot.Node => ({
  ref: node.ref === null ? Option.none() : Option.some(Snapshot.RefId.make(node.ref)),
  role: node.role._tag === "Aria"
    ? { _tag: "Aria", role: node.role.role }
    : {
      _tag: "Inferred",
      role: node.role.role,
      evidence: node.role.evidence as unknown as readonly [
        Snapshot.InteractivityEvidence,
        ...Array<Snapshot.InteractivityEvidence>
      ]
    },
  name: node.name._tag === "Inferred"
    ? {
      _tag: "Inferred",
      value: node.name.value,
      from: node.name.from as "text" | "title" | "placeholder" | "alt" | "nearbyLabel",
      ...(node.name.fieldContent === undefined ? {} : { fieldContent: node.name.fieldContent })
    }
    : node.name,
  states: new Set(
    node.states as ReadonlyArray<"checked" | "expanded" | "selected" | "disabled" | "focused" | "pressed" | "invalid">
  ),
  ...(node.editable === undefined ? {} : { editable: node.editable }),
  validationMessage: Option.fromNullishOr(node.validationMessage),
  children: node.children.map(toNode)
})

/** Every node with a ref, by ref. */
const refsOf = (root: Snapshot.Node): ReadonlyMap<Snapshot.RefId, Snapshot.Node> => {
  const refs = new Map<Snapshot.RefId, Snapshot.Node>()
  const visit = (node: Snapshot.Node) => {
    if (Option.isSome(node.ref)) refs.set(node.ref.value, node)
    node.children.forEach(visit)
  }
  visit(root)
  return refs
}

/** Renders a structured tree with the same renderer as page snapshots. */
export const render = (node: Snapshot.Node): string => Engine.renderText(toEngine(node))

const toEngine = (node: Snapshot.Node): Engine.SnapNode => ({
  ref: Option.getOrNull(node.ref),
  role: node.role,
  name: node.name,
  states: [...node.states],
  validationMessage: Option.getOrNull(node.validationMessage),
  ...(node.editable === undefined ? {} : { editable: node.editable }),
  children: node.children.map(toEngine),
  frame: false
})

/** One node's line of the text, without its children. */
const lineOf = (node: Snapshot.Node): string =>
  Engine.renderText({
    ref: Option.getOrNull(node.ref),
    role: node.role,
    name: node.name,
    states: [...node.states],
    validationMessage: Option.getOrNull(node.validationMessage),
    children: [],
    frame: false
  }).replace(/^- /, "")

/** What a diff compares of a node: its role, name, states and validation message. */
const sameNode: Equivalence.Equivalence<Snapshot.Node> = Schema.toEquivalence(Schema.Struct({
  role: Snapshot.Role,
  name: Snapshot.Name,
  states: Schema.ReadonlySet(Snapshot.State),
  editable: Schema.optional(Schema.Boolean),
  validationMessage: Schema.Option(Schema.String)
}))

export class SnapshotImpl extends Snapshot.Data implements Snapshot.Snapshot<Locator.Locator> {
  readonly [TypeId] = TypeId as typeof TypeId
  #locate: Locate | undefined
  #table: Table = new Map()
  #refs: ReadonlyMap<Snapshot.RefId, Snapshot.Node> | undefined

  /** A snapshot of `data`, whose refs are locators on the owner's page. */
  static of(
    data: {
      readonly document: Target.DocumentId
      readonly generation: Snapshot.Generation
      readonly root: Snapshot.Node
      readonly text: string
    },
    locate: Locate,
    table: Table
  ): SnapshotImpl {
    const snapshot = new SnapshotImpl(data)
    snapshot.#locate = locate
    snapshot.#table = table
    return snapshot
  }

  get refs(): ReadonlyMap<Snapshot.RefId, Snapshot.Node> {
    return this.#refs ??= refsOf(this.root)
  }

  ref(id: Snapshot.RefId): Locator.Locator {
    // A ref no snapshot gave still makes a locator, which fails with `StaleRef` when used
    const steps = this.#table.get(id) ??
      [{ _tag: "Ref", document: this.document, generation: this.generation, ref: id } as const]
    return this.#locate!(steps, Option.some(`snapshot.ref(${JSON.stringify(id)})`))
  }

  diff(previous: Snapshot.Snapshot): Effect.Effect<Snapshot.Diff, Snapshot.SnapshotError> {
    return Effect.suspend(() => {
      if (previous.document !== this.document) {
        return Effect.fail(
          new Snapshot.SnapshotError({
            reason: new Snapshot.DocumentsDiffer({
              documents: [previous.document, this.document],
              hint: "Refs name nodes of one document; diff two snapshots of the same document"
            }),
            diagnostics: Operation.diagnosticsNow()
          })
        )
      }
      const added: Array<Snapshot.Node> = []
      const changed: Array<Snapshot.Node> = []
      const lines: Array<string> = []
      for (const [ref, node] of this.refs) {
        const before = previous.refs.get(ref)
        if (before === undefined) {
          added.push(node)
          lines.push(`+ ${lineOf(node)}`)
        } else if (!sameNode(before, node)) {
          changed.push(node)
          lines.push(`~ ${lineOf(node)}`)
        }
      }
      const removed = [...previous.refs.keys()].filter((ref) => !this.refs.has(ref))
      for (const ref of removed) lines.push(`- ${lineOf(previous.refs.get(ref)!)}`)
      return Effect.succeed(new Snapshot.Diff({ added, removed, changed, text: lines.join("\n") }))
    })
  }

  override toString() {
    return `Snapshot(${this.document})`
  }
  toJSON() {
    return { _id: "Snapshot", document: this.document, generation: this.generation, text: this.text }
  }
  [Inspectable.NodeInspectSymbol]() {
    return this.toJSON()
  }
}
