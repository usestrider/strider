/**
 * The query and actionability engine: one engine of ours, evaluated in each document's utility
 * world, the same on every backend, so a locator means the same thing in every browser.
 *
 * `engine` is self-contained: it refers to nothing outside its own body but the page's globals, because its
 * source crosses into the page as text (`source`), where it is installed once per realm, out of the page's
 * reach. L1 sends it requests as JSON and reads JSON back (`Request`, `Response`).
 *
 * - **The tree** is the document's elements and those of every open shadow root, in tree order, a shadow
 *   root's elements right after its host. Closed shadow roots are invisible to scripts, so to the engine too;
 *   iframes are entered only through `frame()`, whose steps L1 resolves with the engine of each document
 *   on the way.
 * - **Text** is an element's text content in the flat tree (a shadow host's shadow tree, a slot's assigned
 *   nodes), skipping `script`, `style`, `noscript` and `template`, with a button-like `input`'s value, and
 *   whitespace collapsed and trimmed. Not `innerText`, which depends on layout and differs between engines.
 * - **`getByText`** matches the smallest element that says it: its text matches and no child element's does.
 *   The document's `head` isn't searched.
 * - **`getByRole`** takes the first role token the engine knows from `role`, or else the implicit role under
 *   HTML-AAM, and computes the accessible name under accname 1.2.
 * - **Actions** take an initial stability sample immediately, then check at each animation frame until the
 *   checks pass or the round's cap runs out. The checks (CONCEPTS.md §8) are visible, enabled, notInert,
 *   inViewport (scrolling into view once), stable across `frames` rendering updates, and receivesPointer at
 *   the action point. The rendered check independently gates the first check on a rendering update.
 */

import * as Schema from "effect/Schema"

/** How a query matches text. */
export type TextMatcher =
  | { readonly _tag: "String"; readonly value: string; readonly exact: boolean }
  | { readonly _tag: "RegExp"; readonly source: string; readonly flags: string }

/** One step of a locator, applied to the matches of the steps before it. */
export type Step =
  | {
    readonly _tag: "Role"
    readonly role: string
    readonly name: TextMatcher | null
    readonly includeHidden: boolean
    readonly level?: number | undefined
    readonly checked?: boolean | undefined
    readonly pressed?: boolean | undefined
    readonly expanded?: boolean | undefined
    readonly selected?: boolean | undefined
    readonly disabled?: boolean | undefined
  }
  | { readonly _tag: "Text"; readonly matcher: TextMatcher }
  | { readonly _tag: "Label"; readonly matcher: TextMatcher }
  | { readonly _tag: "Placeholder"; readonly matcher: TextMatcher }
  | { readonly _tag: "AltText"; readonly matcher: TextMatcher }
  | { readonly _tag: "Title"; readonly matcher: TextMatcher }
  | { readonly _tag: "TestId"; readonly id: string }
  | { readonly _tag: "Css"; readonly selector: string }
  | { readonly _tag: "Nth"; readonly index: number }
  | { readonly _tag: "First" }
  | { readonly _tag: "Last" }
  | {
    readonly _tag: "Filter"
    readonly hasText: TextMatcher | null
    readonly hasNotText: TextMatcher | null
    readonly has: ReadonlyArray<Step> | null
    readonly hasNot: ReadonlyArray<Step> | null
    readonly visible: boolean | null
  }
  | { readonly _tag: "And"; readonly other: ReadonlyArray<Step> }
  | { readonly _tag: "Or"; readonly other: ReadonlyArray<Step> }
  /**
   * A frame boundary: the steps before it find an iframe, and those after it resolve in
   * the iframe's document. L1 splits steps at each one before resolution; validation receives the complete query.
   */
  | { readonly _tag: "Frame" }
  /**
   * A snapshot's ref: the one node it was given to, in the document and engine that gave
   * it, never another. L1 checks the document; the engine its generation and the node.
   */
  | { readonly _tag: "Ref"; readonly document: string; readonly generation: number; readonly ref: string }

/** Which actionability checks an action runs. */
export interface Checks {
  readonly rendered: boolean
  readonly visible: boolean
  readonly enabled: boolean
  readonly editable: boolean
  readonly notInert: boolean
  readonly inViewport: boolean
  /** Frames the rect must stay unchanged across; 0 skips the check. */
  readonly stable: number
  readonly receivesPointer: boolean
}

/** Why a target or its action preparation isn't ready. */
export const NotReady = Schema.Union([
  Schema.TaggedStruct("NoMatch", {}),
  Schema.TaggedStruct("NotVisible", {}),
  Schema.TaggedStruct("Disabled", {}),
  Schema.TaggedStruct("ReadOnly", {}),
  Schema.TaggedStruct("Inert", {}),
  Schema.TaggedStruct("BlockedByModal", { dialog: Schema.String }),
  Schema.TaggedStruct("OutsideViewport", {}),
  Schema.TaggedStruct("NotStable", {}),
  Schema.TaggedStruct("NoRenderingOpportunity", {}),
  Schema.TaggedStruct("Covered", { by: Schema.String }),
  /** The guard stopped the gesture: its first trusted event landed on another element. */
  Schema.TaggedStruct("Intercepted", { by: Schema.String }),
  Schema.TaggedStruct("NoSuchOption", { option: Schema.String }),
  /** A different text control held focus before preparing the target for insertion. */
  Schema.TaggedStruct("PreparingFocus", { from: Schema.String })
])
export type NotReady = typeof NotReady.Type

/** An option of a `<select>`, by value, label or index. */
export type Choice =
  | { readonly value: string }
  | { readonly label: string }
  | { readonly index: number }

/**
 * What an action does in the page once its checks pass: answer the action point, and
 * guard the gesture that follows; or focus, scroll, prepare a fill, choose options, or read whether it is checked.
 */
export type Action =
  | {
    readonly _tag: "Point"
    readonly position: { readonly x: number; readonly y: number } | null
    readonly guard: boolean
  }
  | { readonly _tag: "Focus" }
  | { readonly _tag: "SelectText" }
  | { readonly _tag: "Blur" }
  | { readonly _tag: "Scroll" }
  | { readonly _tag: "Fill"; readonly value: string }
  | { readonly _tag: "Select"; readonly choices: ReadonlyArray<Choice> }
  | { readonly _tag: "Checked" }
  | { readonly _tag: "FileInput" }
  | { readonly _tag: "None" }

/** Whether the action can change the element in its applying round, before native input dispatch. */
export const appliesInRound = (action: Action): boolean =>
  action._tag === "Focus" || action._tag === "Scroll" || action._tag === "Fill" ||
  action._tag === "Select" || action._tag === "SelectText" || action._tag === "Blur"

/** A one-shot read of the one match. */
export type Read =
  | { readonly _tag: "Text" }
  | { readonly _tag: "Value" }
  | { readonly _tag: "Html" }
  | { readonly _tag: "Attribute"; readonly name: string }
  | { readonly _tag: "Editable" }
  | { readonly _tag: "Enabled" }
  | { readonly _tag: "Checked"; readonly followLabel?: boolean; readonly uncheck?: boolean }

/** What an expectation waits for. */
export type Expectation =
  | { readonly _tag: "Attached" }
  | { readonly _tag: "Detached" }
  | { readonly _tag: "Viewport"; readonly ratio: number; readonly inViewport: boolean }
  | {
    readonly _tag: "CSS"
    readonly name: string
    readonly expected: TextMatcher
    readonly not: boolean
    readonly pseudo: "before" | "after" | null
  }
  | { readonly _tag: "Visible" }
  | { readonly _tag: "Hidden" }
  | { readonly _tag: "Enabled" }
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Checked" }
  | { readonly _tag: "Focused" }
  | { readonly _tag: "Editable" }
  /** The whole text of the one match, or with `list`, of each match in order. */
  | { readonly _tag: "Text"; readonly expected: ReadonlyArray<TextMatcher>; readonly list: boolean }
  | { readonly _tag: "Role"; readonly expected: string }
  | { readonly _tag: "AccessibleName"; readonly expected: TextMatcher; readonly ignoreCase: boolean }
  /** The raw class string of one match, or each match in order. */
  | { readonly _tag: "Class"; readonly expected: ReadonlyArray<TextMatcher>; readonly list: boolean }
  | { readonly _tag: "ContainsText"; readonly expected: TextMatcher }
  | { readonly _tag: "Value"; readonly expected: TextMatcher }
  | { readonly _tag: "Attribute"; readonly name: string; readonly expected: TextMatcher | null }
  | { readonly _tag: "Count"; readonly count: number }
  | { readonly _tag: "Title"; readonly expected: TextMatcher }
  /** The one match's accessibility tree matches a pattern. */
  | { readonly _tag: "Aria"; readonly pattern: Pattern }

/** A pattern over the accessibility tree, as `AriaPattern` builds it. */
export type Pattern =
  | { readonly _tag: "Node"; readonly role: string; readonly name: TextMatcher; readonly children: PatternChildren }
  | { readonly _tag: "Text"; readonly value: TextMatcher }

/** How a pattern's children are matched. */
export type PatternChildren =
  | { readonly _tag: "Exactly"; readonly patterns: ReadonlyArray<Pattern> }
  | { readonly _tag: "Including"; readonly patterns: ReadonlyArray<Pattern> }
  | { readonly _tag: "Unchecked" }

/** Why a ref no longer points at its node (`Locator.StaleRef`). */
export const Stale = Schema.Literals(["Replaced", "Detached", "Suspended", "BindingLost", "OtherSnapshot"])
export type Stale = typeof Stale.Type

/** A node of a document's accessibility tree. */
export interface SnapNode {
  readonly ref: string | null
  readonly role:
    | { readonly _tag: "Aria"; readonly role: string }
    | {
      readonly _tag: "Inferred"
      readonly role: "clickable" | "editable" | "focusable"
      readonly evidence: ReadonlyArray<string>
    }
  readonly name:
    | {
      readonly _tag: "Accessible"
      readonly value: string
      readonly from?: "text" | undefined
      readonly fieldContent?: boolean | undefined
    }
    | {
      readonly _tag: "Inferred"
      readonly value: string
      readonly from: string
      readonly fieldContent?: boolean | undefined
    }
    | { readonly _tag: "None" }
  readonly states: ReadonlyArray<string>
  readonly editable?: boolean | undefined
  readonly validationMessage: string | null
  readonly children: ReadonlyArray<SnapNode>
  /** An iframe, whose frame's tree L1 stitches in. */
  readonly frame: boolean
}

export const SnapNode: Schema.Codec<SnapNode> = Schema.Struct({
  ref: Schema.NullOr(Schema.String),
  role: Schema.Union([
    Schema.TaggedStruct("Aria", { role: Schema.String }),
    Schema.TaggedStruct("Inferred", {
      role: Schema.Literals(["clickable", "editable", "focusable"]),
      evidence: Schema.Array(Schema.String)
    })
  ]),
  name: Schema.Union([
    Schema.TaggedStruct("Accessible", {
      value: Schema.String,
      from: Schema.optional(Schema.Literal("text")),
      fieldContent: Schema.optional(Schema.Boolean)
    }),
    Schema.TaggedStruct("Inferred", {
      value: Schema.String,
      from: Schema.String,
      fieldContent: Schema.optional(Schema.Boolean)
    }),
    Schema.TaggedStruct("None", {})
  ]),
  states: Schema.Array(Schema.String),
  editable: Schema.optional(Schema.Boolean),
  validationMessage: Schema.NullOr(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<SnapNode> => SnapNode)),
  frame: Schema.Boolean
})

/** A failure no waiting can mend: the one match isn't the kind of element the operation needs. */
export const Final = Schema.Union([
  Schema.TaggedStruct("WrongElement", {
    expected: Schema.String,
    element: Schema.String,
    hint: Schema.optional(Schema.String)
  }),
  Schema.TaggedStruct("NotEditable", { element: Schema.String }),
  Schema.TaggedStruct("Refused", { element: Schema.String, value: Schema.String })
])
export type Final = typeof Final.Type

const Clip = Schema.Struct({ left: Schema.Number, top: Schema.Number, right: Schema.Number, bottom: Schema.Number })
export type Clip = typeof Clip.Type

/** A request to the engine. */
export type Request =
  | { readonly op: "validationStart"; readonly token: string; readonly full: boolean }
  | { readonly op: "validationStop"; readonly token: string }
  | { readonly op: "count"; readonly steps: ReadonlyArray<Step> }
  | { readonly op: "visible"; readonly steps: ReadonlyArray<Step> }
  | {
    readonly op: "act"
    readonly steps: ReadonlyArray<Step>
    readonly checks: Checks
    /** Visible bounds inherited from parent frames, in this document’s viewport coordinates. */
    readonly clip?: Clip
    /** Milliseconds this round may wait for the checks to pass. */
    readonly cap: number
    readonly action: Action
    /**
     * Whether to do what `action` asks once the checks pass: only under the page's input permit. Without it, the
     * round only checks, and answers the point and what it read.
     */
    readonly apply: boolean
    /** Capture stability for immediate revalidation, or consume the returned token. Expires at the next frame. */
    readonly stability?: string
  }
  /** Removes the guard an action armed, and says whether it stopped the gesture. */
  | { readonly op: "disarm" }
  | { readonly op: "fillGuard"; readonly steps: ReadonlyArray<Step>; readonly ancestor: boolean }
  | { readonly op: "fillDisarm" }
  | { readonly op: "read"; readonly steps: ReadonlyArray<Step>; readonly read: Read }
  | {
    readonly op: "expect"
    readonly steps: ReadonlyArray<Step>
    readonly token?: string | undefined
    readonly expectation: Expectation
    /** Milliseconds this round may wait in the page for the expectation to hold. */
    readonly cap: number
  }
  | { readonly op: "expectStop"; readonly token: string }
  | { readonly op: "title" }
  | { readonly op: "role"; readonly steps: ReadonlyArray<Step> }
  /**
   * An iframe on the way to a frame's element: its content box's origin in this
   * document's viewport, after scrolling it into view when asked and it isn't; and, given a point in the
   * frame's viewport, what the pointer would hit there in this document.
   */
  | {
    readonly op: "frame"
    readonly steps: ReadonlyArray<Step>
    readonly scroll: boolean
    readonly clip?: Clip
    readonly point: { readonly x: number; readonly y: number } | null
  }
  /**
   * The accessibility tree of the document, or of the one match's subtree, with inferred
   * interactivity when asked, down to `depth` levels below the root.
   */
  | {
    readonly op: "snapshot"
    readonly steps: ReadonlyArray<Step> | null
    readonly interactivity: boolean
    readonly provenance?: boolean | undefined
    readonly depth: number | null
  }
  /** Why a locator matches nothing: the nearest match of its steps, and close names. */
  | { readonly op: "explain"; readonly steps: ReadonlyArray<Step> }
  /** The one match's box in its viewport, and its document's scroll offset. */
  | { readonly op: "rect"; readonly steps: ReadonlyArray<Step> }
  /** The document's doctype and HTML. */
  | { readonly op: "html" }

/** A candidate of an ambiguous match. */
export const Candidate = Schema.Struct({ description: Schema.String, visible: Schema.Boolean })
export type Candidate = typeof Candidate.Type

const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })

/**
 * What the engine answers, decoded from the JSON it returns: where the engine shares the page's world, as on stock
 * WebKit, a page's script can answer in its place, so nothing it says is taken on trust.
 */
export const Response = Schema.Union([
  Schema.TaggedStruct("Validation", { lines: Schema.Array(Schema.String) }),
  Schema.TaggedStruct("Count", { count: Schema.Number }),
  Schema.TaggedStruct("Visible", { count: Schema.Number, visible: Schema.Boolean }),
  Schema.TaggedStruct("Ready", {
    element: Schema.String,
    scrolled: Schema.Boolean,
    /** Stability evidence for an immediate check of the same element and rectangle. */
    stability: Schema.optionalKey(Schema.String),
    /** Locally reachable default candidates for parent hit tests. */
    candidates: Schema.optionalKey(Schema.Array(Point)),
    /** The action point, for `Point`. */
    point: Schema.NullOr(Point),
    /** Whether an HTML drag would start from it: it or an ancestor is `draggable`. */
    draggable: Schema.Boolean,
    /** For `Checked`: whether it is checked. */
    checked: Schema.NullOr(Schema.Boolean),
    /** For `Fill`: whether the value is to be typed (focused, contents selected) or was set. */
    fill: Schema.NullOr(Schema.Literals(["type", "set", "guarded"]))
  }),
  Schema.TaggedStruct("NotReady", {
    reason: NotReady,
    /** Each reason seen this round, de-duplicated in order. */
    history: Schema.Array(NotReady),
    scrolled: Schema.Boolean,
    /**
     * Whether the round saw a reason worth reporting: one the deadline cut before its first frame, or while a rect
     * was still settling, saw nothing wrong, `reason` included. With rendered disabled, a sampled stability
     * wait is reported even without a frame, since no rendering hint will replace it.
     */
    checked: Schema.Boolean
  }),
  Schema.TaggedStruct("Final", { final: Final }),
  Schema.TaggedStruct("Guarded", { blocked: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("FillGuard", {
    blocked: Schema.NullOr(Schema.String),
    unsafe: Schema.Boolean,
    accepted: Schema.Boolean
  }),
  Schema.TaggedStruct("Read", { value: Schema.NullOr(Schema.Union([Schema.String, Schema.Boolean])) }),
  Schema.TaggedStruct("NoMatch", {}),
  Schema.TaggedStruct("Expected", {
    passed: Schema.Boolean,
    /** What the last check saw, for the expectation's history. */
    observed: Schema.Unknown,
    /** Whether it re-checked in the page after a change. */
    changed: Schema.Boolean
  }),
  Schema.TaggedStruct("Strict", { candidates: Schema.Array(Candidate), count: Schema.Number }),
  Schema.TaggedStruct("InvalidSelector", {
    selector: Schema.String,
    message: Schema.String,
    kind: Schema.optionalKey(Schema.Literal("role"))
  }),
  Schema.TaggedStruct("Title", { title: Schema.String }),
  Schema.TaggedStruct("Roles", {
    roles: Schema.Array(Schema.Struct({ role: Schema.NullOr(Schema.String), name: Schema.String }))
  }),
  Schema.TaggedStruct("Frame", {
    /** The iframe's content box, in this document's viewport. */
    origin: Point,
    /** Visible content bounds, in the child viewport’s coordinates. */
    viewport: Clip,
    /** Whether it was scrolled into view. */
    scrolled: Schema.Boolean,
    /** What covers the iframe at the point given, or `null` when the iframe itself is hit there. */
    covered: Schema.NullOr(Schema.String),
    /** This document's scroll offset. */
    scroll: Point
  }),
  Schema.TaggedStruct("Snapshot", { root: SnapNode, generation: Schema.Number }),
  Schema.TaggedStruct("Explained", {
    /** Whether the steps match something now, so there is nothing to explain. */
    matched: Schema.Boolean,
    /** The text of the longest matching prefix's first match, two levels deep. */
    nearest: Schema.NullOr(Schema.String),
    /** Elements under it whose role is the last step's and whose name is close to its name. */
    suggestions: Schema.Array(Schema.Struct({ role: Schema.String, name: Schema.String })),
    /** How many of the steps matched. */
    prefix: Schema.Number
  }),
  Schema.TaggedStruct("Rect", {
    rect: Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number }),
    scroll: Point
  }),
  Schema.TaggedStruct("StaleRef", { why: Stale })
])
export type Response = typeof Response.Type

/** Decodes the engine's answer: the JSON text it returns. */
export const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(Response))

/**
 * A snapshot tree as text: indented YAML, one line per node. Self-contained, so the engine
 * takes its source too.
 */
export function renderText(root: SnapNode): string {
  const lines: Array<string> = []
  const line = (node: SnapNode, indent: string) => {
    if (node.role._tag === "Aria" && node.role.role === "text") {
      lines.push(`${indent}- text: ${JSON.stringify(node.name._tag === "None" ? "" : node.name.value)}`)
      return
    }
    let out = `${indent}- ${node.role.role}`
    if (node.name._tag !== "None") out += ` ${JSON.stringify(node.name.value)}`
    for (const state of node.states) out += ` [${state}]`
    if (node.validationMessage != null) out += ` [validationMessage=${JSON.stringify(node.validationMessage)}]`
    if (node.ref !== null) out += ` [ref=${node.ref}]`
    if (node.role._tag === "Inferred") out += ` [inferred: ${node.role.evidence.join(", ")}]`
    if (node.name._tag === "Inferred") out += ` [name from: ${node.name.from}]`
    lines.push(node.children.length > 0 ? `${out}:` : out)
    for (const child of node.children) line(child, `${indent}  `)
  }
  line(root, "")
  return lines.join("\n")
}

/** The engine. Self-contained: its source is evaluated in the page, with `renderText`'s. */
export function engine(render: (root: SnapNode) => string) {
  // ── Time ──────────────────────────────────────────────────────────────────────────────────────────────

  // The page's own timers and frames, never a page clock's (`clock.ts`): where the engine shares the page's world,
  // a clock installed first leaves the real ones under this symbol, and one installed later finds these taken
  const realTimers = (globalThis as any)[Symbol.for("@usestrider/browser/clock/real")] as
    | {
      readonly setTimeout: (callback: () => void, delay: number) => number
      readonly clearTimeout: (id: number) => void
      readonly cancelAnimationFrame: (id: number) => void
      readonly requestAnimationFrame: (callback: () => void) => number
      readonly now: () => number
    }
    | undefined
  const setTimer = realTimers?.setTimeout ?? globalThis.setTimeout.bind(globalThis)
  const clearTimer = realTimers?.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  const onFrame = realTimers?.requestAnimationFrame ?? globalThis.requestAnimationFrame.bind(globalThis)
  const now = realTimers?.now ?? performance.now.bind(performance)

  // ── The tree ──────────────────────────────────────────────────────────────────────────────────────────

  const SKIPPED = new Set(["script", "style", "noscript", "template"])

  /** Every element under `root`, in tree order, with each open shadow root's elements after its host. */
  const elementsUnder = (root: Document | Element | ShadowRoot): Array<Element> => {
    const out: Array<Element> = []
    const visit = (node: Document | Element | ShadowRoot) => {
      for (let child = node.firstElementChild; child !== null; child = child.nextElementSibling) {
        out.push(child)
        if (child.shadowRoot !== null) visit(child.shadowRoot)
        visit(child)
      }
    }
    visit(root)
    return out
  }

  /** The parent in the composed tree: the parent element, or a shadow root's host. */
  const composedParent = (element: Element): Element | null => {
    if (element.parentElement !== null) return element.parentElement
    const root = element.parentNode
    return root instanceof ShadowRoot ? root.host : null
  }

  /** Whether `ancestor` contains `node` in the composed tree. */
  const composedContains = (ancestor: Element, node: Element): boolean => {
    for (let current: Element | null = node; current !== null; current = composedParent(current)) {
      if (current === ancestor) return true
    }
    return false
  }

  /** A node's children in the flat tree: a host's shadow tree, a slot's assigned nodes. */
  const flatChildNodes = (node: Node): Array<Node> => {
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true })
      return assigned.length > 0 ? assigned : Array.from(node.childNodes)
    }
    if (node instanceof Element && node.shadowRoot !== null) return Array.from(node.shadowRoot.childNodes)
    return Array.from(node.childNodes)
  }

  const flatChildElements = (element: Element): Array<Element> => {
    const out: Array<Element> = []
    for (const child of flatChildNodes(element)) {
      if (!(child instanceof Element)) continue
      if (child instanceof HTMLSlotElement) out.push(...flatChildElements(child))
      else out.push(child)
    }
    return out
  }

  const inHead = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.localName === "head") return true
    }
    return false
  }

  // ── Text ──────────────────────────────────────────────────────────────────────────────────────────────

  const collapse = (text: string): string => text.replace(/\s+/g, " ").trim()

  const buttonLikeInput = (element: Element): element is HTMLInputElement =>
    element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)

  const rawText = new Map<Node, string>()
  const textOfNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ""
    if (!(node instanceof Element)) return ""
    const cached = rawText.get(node)
    if (cached !== undefined) return cached
    let text = ""
    if (SKIPPED.has(node.localName)) text = ""
    else if (buttonLikeInput(node)) text = node.value
    else for (const child of flatChildNodes(node)) text += textOfNode(child)
    rawText.set(node, text)
    return text
  }

  /** An element's text: flat-tree text content, whitespace collapsed. */
  const textOf = (element: Element): string => collapse(textOfNode(element))

  const matches = (matcher: TextMatcher, text: string): boolean => {
    if (matcher._tag === "RegExp") return new RegExp(matcher.source, matcher.flags).test(text)
    const expected = collapse(matcher.value)
    return matcher.exact ? text === expected : text.toLowerCase().includes(expected.toLowerCase())
  }

  // ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────

  const KNOWN_ROLES = new Set([
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "complementary",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "insertion",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "mark",
    "marquee",
    "math",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "meter",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "region",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "strong",
    "subscript",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem"
  ])

  /** Roles that prohibit a name for the element itself (accname 1.2, step 1). */
  const NAME_PROHIBITED = new Set([
    "caption",
    "code",
    "definition",
    "deletion",
    "emphasis",
    "generic",
    "insertion",
    "mark",
    "paragraph",
    "presentation",
    "strong",
    "subscript",
    "suggestion",
    "superscript",
    "term",
    "time"
  ])

  /** Roles whose name comes from their content (accname 1.2, step 2F). */
  const NAME_FROM_CONTENT = new Set([
    "button",
    "cell",
    "checkbox",
    "columnheader",
    "gridcell",
    "heading",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "row",
    "rowheader",
    "switch",
    "tab",
    "tooltip",
    "treeitem"
  ])

  const hasAccessibleNameAttribute = (element: Element): boolean =>
    (element.getAttribute("aria-label") ?? "").trim() !== "" || element.hasAttribute("aria-labelledby") ||
    (element.getAttribute("title") ?? "").trim() !== ""

  // HTML integer parsing only needs to succeed here: ASCII whitespace, optional sign, then a digit.
  // Trailing text is ignored; Number/trim accept different inputs (notably non-ASCII whitespace).
  const HTML_INTEGER_PREFIX = /^[\t\n\f\r ]*[+-]?[0-9]/
  const DISABLABLE_TAGS = new Set(["button", "fieldset", "input", "optgroup", "option", "select", "textarea"])
  const NATIVE_FOCUSABLE_TAGS = new Set(["button", "details", "select", "textarea"])
  const focusable = (element: Element): boolean => {
    const tag = element.localName
    // Custom-element definitions live in the main world. A hyphen conservatively includes form-associated hosts.
    // Keep the native selector for these and built-in controls: it includes disabled fieldsets and legend exceptions.
    if ((DISABLABLE_TAGS.has(tag) || tag.includes("-")) && element.matches(":disabled")) return false
    const tabindex = element.getAttribute("tabindex")
    return (tabindex !== null && HTML_INTEGER_PREFIX.test(tabindex)) ||
      ((tag === "a" || tag === "area") && element.hasAttribute("href")) ||
      NATIVE_FOCUSABLE_TAGS.has(tag) ||
      (element instanceof HTMLInputElement && element.type !== "hidden") ||
      (element instanceof HTMLElement && element.isContentEditable)
  }

  // ARIA 1.2 global properties; deprecated globals follow the pinned role-query contract.
  const GLOBAL_ARIA = new Set([
    "aria-atomic",
    "aria-busy",
    "aria-controls",
    "aria-current",
    "aria-describedby",
    "aria-details",
    "aria-dropeffect",
    "aria-flowto",
    "aria-grabbed",
    "aria-hidden",
    "aria-keyshortcuts",
    "aria-live",
    "aria-owns",
    "aria-relevant"
  ])
  // Presentation conflicts retain the pinned role-query naming exceptions, distinct from accname root rules.
  const PRESENTATION_NAME_PROHIBITED = new Set([
    "caption",
    "code",
    "deletion",
    "emphasis",
    "generic",
    "insertion",
    "paragraph",
    "presentation",
    "strong",
    "subscript",
    "superscript"
  ])
  const presentationConflict = (element: Element, implicit: string | null): boolean => {
    if (focusable(element)) return true
    // One attribute snapshot avoids probing every possible global property on every presentation candidate.
    for (const attribute of element.getAttributeNames()) {
      if (GLOBAL_ARIA.has(attribute)) return true
      if (
        (attribute === "aria-label" || attribute === "aria-labelledby") &&
        !PRESENTATION_NAME_PROHIBITED.has(implicit ?? "")
      ) return true
      if (attribute === "aria-roledescription" && implicit !== "generic") return true
    }
    return false
  }

  // Only required structural children inherit presentation, never arbitrary descendants or nested lists/tables.
  // https://www.w3.org/TR/wai-aria-1.2/#presentation
  const PRESENTATION_PARENTS = new Map<string, ReadonlyArray<string>>([
    ["dd", ["dl", "div"]],
    ["div", ["dl"]],
    ["dt", ["dl", "div"]],
    ["li", ["ol", "ul"]],
    ["caption", ["table"]],
    ["tbody", ["table"]],
    ["tfoot", ["table"]],
    ["thead", ["table"]],
    ["td", ["tr"]],
    ["th", ["tr"]],
    ["tr", ["thead", "tbody", "tfoot", "table"]]
  ])

  const inputRole = (input: HTMLInputElement): string | null => {
    const list = input.hasAttribute("list")
    switch (input.type) {
      case "button":
      case "image":
      case "reset":
      case "submit":
        return "button"
      case "checkbox":
        return "checkbox"
      case "radio":
        return "radio"
      case "range":
        return "slider"
      case "number":
        return "spinbutton"
      case "search":
        return list ? "combobox" : "searchbox"
      case "email":
      case "tel":
      case "text":
      case "url":
        return list ? "combobox" : "textbox"
      default:
        return null
    }
  }

  const sectioningAncestor = (element: Element): boolean => {
    for (let current = composedParent(element); current !== null; current = composedParent(current)) {
      if (["article", "aside", "main", "nav", "section"].includes(current.localName)) return true
    }
    return false
  }

  /** The implicit role under HTML-AAM, for the elements the engine knows; `null` for none. */
  const implicitRole = (element: Element): string | null => {
    switch (element.localName) {
      case "a":
      case "area":
        return element.hasAttribute("href") ? "link" : element.localName === "a" ? "generic" : null
      case "address":
      case "details":
      case "fieldset":
      case "hgroup":
      case "optgroup":
        return "group"
      case "article":
        return "article"
      case "aside":
        return "complementary"
      case "blockquote":
        return "blockquote"
      case "button":
        return "button"
      case "caption":
        return "caption"
      case "code":
        return "code"
      case "datalist":
        return "listbox"
      case "dd":
        return "definition"
      case "del":
      case "s":
        return "deletion"
      case "dialog":
        return "dialog"
      case "dt":
        return "term"
      case "em":
        return "emphasis"
      case "figure":
        return "figure"
      case "footer":
        return sectioningAncestor(element) ? "generic" : "contentinfo"
      case "form":
        return hasAccessibleNameAttribute(element) ? "form" : null
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading"
      case "header":
        return sectioningAncestor(element) ? "generic" : "banner"
      case "hr":
        return "separator"
      case "html":
        return "document"
      case "img":
        return element.getAttribute("alt") === "" && !hasAccessibleNameAttribute(element) ? "presentation" : "img"
      case "input":
        return inputRole(element as HTMLInputElement)
      case "ins":
        return "insertion"
      case "li":
        return "listitem"
      case "main":
        return "main"
      case "mark":
        return "mark"
      case "math":
        return "math"
      case "menu":
      case "ol":
      case "ul":
        return "list"
      case "meter":
        return "meter"
      case "nav":
        return "navigation"
      case "option":
        return "option"
      case "output":
        return "status"
      case "p":
        return "paragraph"
      case "progress":
        return "progressbar"
      case "search":
        return "search"
      case "section":
        return hasAccessibleNameAttribute(element) ? "region" : "generic"
      case "select": {
        const select = element as HTMLSelectElement
        return select.multiple || select.size > 1 ? "listbox" : "combobox"
      }
      case "strong":
        return "strong"
      case "sub":
        return "subscript"
      case "sup":
        return "superscript"
      case "table":
        return "table"
      case "tbody":
      case "tfoot":
      case "thead":
        return "rowgroup"
      case "td": {
        const table = element.closest("table")
        const role = table?.getAttribute("role")
        return role === "grid" || role === "treegrid" ? "gridcell" : "cell"
      }
      case "textarea":
        return "textbox"
      case "th":
        return element.getAttribute("scope") === "row" ? "rowheader" : "columnheader"
      case "time":
        return "time"
      case "tr":
        return "row"
      case "b":
      case "bdi":
      case "bdo":
      case "data":
      case "div":
      case "i":
      case "pre":
      case "q":
      case "samp":
      case "small":
      case "span":
      case "u":
        return "generic"
      default:
        return null
    }
  }

  const roleCache = new Map<Element, string | null>()
  /** Shared role computation, including ARIA presentation conflict resolution and required-child inheritance. */
  const roleOf = (element: Element): string | null => {
    if (roleCache.has(element)) return roleCache.get(element)!
    let explicit: string | null = null
    for (const token of (element.getAttribute("role") ?? "").split(/\s+/)) {
      if (!KNOWN_ROLES.has(token)) continue
      explicit = token
      break
    }
    let role = explicit
    if (explicit === null || explicit === "none" || explicit === "presentation") {
      const implicit = implicitRole(element)
      role = explicit ?? implicit
      if (explicit !== null) {
        // A conflict cancels the first recognized presentation token, not advances to a fallback token.
        if (presentationConflict(element, implicit)) role = implicit
      } else if (implicit !== null) {
        const parents = PRESENTATION_PARENTS.get(element.localName)
        const parent = parents === undefined ? null : composedParent(element)
        if (parent !== null && parents!.includes(parent.localName)) {
          const inherited = roleOf(parent)
          if ((inherited === "none" || inherited === "presentation") && !presentationConflict(element, implicit)) {
            role = inherited
          }
        }
      }
    }
    roleCache.set(element, role)
    return role
  }

  // ── Hidden, visible ───────────────────────────────────────────────────────────────────────────────────

  /** Excluded from the accessibility tree: `aria-hidden`, `display: none`, `visibility: hidden`. */
  const hiddenFromAccessibility = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.getAttribute("aria-hidden") === "true") return true
    }
    return !element.checkVisibility({ visibilityProperty: true })
  }

  /** CONCEPTS.md §8: observations include opacity; action readiness ignores it. */
  const rendered = (element: Element, opacityProperty: boolean): boolean => {
    if (getComputedStyle(element).display === "contents") {
      return flatChildElements(element).some((child) => rendered(child, opacityProperty))
    }
    if (!element.checkVisibility({ contentVisibilityAuto: true, opacityProperty, visibilityProperty: true })) {
      return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const visible = (element: Element): boolean => rendered(element, true)

  // ── Accessible names (accname 1.2) ────────────────────────────────────────────────────────────────────

  interface NameContext {
    readonly visited: Set<Element>
    /** Inside an `aria-labelledby` traversal, which includes hidden referenced nodes. */
    readonly labelledBy: boolean
    /** Computing another element's name, not the root's. */
    readonly traversal: boolean
    readonly includeHidden: boolean
    readonly contribution: { fieldContent: boolean }
  }

  const byId = (element: Element, id: string): Element | null => {
    const root = element.getRootNode()
    return root instanceof Document || root instanceof ShadowRoot ? root.getElementById(id) : null
  }

  const embeddedControlRole = (role: string | null): boolean =>
    role === "textbox" || role === "searchbox" || role === "combobox" || role === "listbox" ||
    role === "slider" || role === "spinbutton"

  const embeddedValue = (element: Element, role: string | null): string => {
    if (element instanceof HTMLInputElement && element.type === "password") return ""
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (role === "slider" || role === "spinbutton") {
        return element.getAttribute("aria-valuetext") ?? element.getAttribute("aria-valuenow") ?? element.value
      }
      return element.value
    }
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.selectedOptions).map((option) => textOf(option)).join(" ")
    }
    return element.getAttribute("aria-valuetext") ?? element.getAttribute("aria-valuenow") ?? textOf(element)
  }

  const labelsOf = (element: Element): Array<HTMLLabelElement> =>
    "labels" in element && element.labels instanceof NodeList
      ? Array.from(element.labels as NodeListOf<HTMLLabelElement>)
      : []

  const pseudoContent = (element: Element, pseudo: "::before" | "::after"): string => {
    const content = getComputedStyle(element, pseudo).content
    const match = /^"(.*)"$/.exec(content)
    return match === null ? "" : match[1]!
  }

  const nameOfNode = (node: Node, context: NameContext): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? ""
      if (value !== "" && inField(node)) context.contribution.fieldContent = true
      return value
    }
    if (!(node instanceof Element)) return ""
    return nameOfElement(node, context)
  }

  // Propagate only the chosen, nonempty name. Failed naming alternatives must not taint a public label.
  const nameOfElement = (element: Element, context: NameContext): string => {
    if (!provenance) return nameOfElementValue(element, context)
    const previous = context.contribution.fieldContent
    context.contribution.fieldContent = false
    const value = nameOfElementValue(element, context)
    context.contribution.fieldContent = previous || (context.contribution.fieldContent && value.trim() !== "")
    return value
  }

  const nameOfElementValue = (element: Element, context: NameContext): string => {
    if (context.visited.has(element)) return ""
    context.visited.add(element)
    // 2A: hidden, unless referenced or asked for
    if (!context.labelledBy && !(context.includeHidden && !context.traversal) && hiddenFromAccessibility(element)) {
      return ""
    }
    // 2B: aria-labelledby, not followed twice
    if (!context.labelledBy) {
      const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((id) => id !== "")
      const parts = ids.flatMap((id) => {
        const target = byId(element, id)
        return target === null ? [] : [nameOfElement(target, { ...context, labelledBy: true, traversal: true })]
      })
      const joined = parts.join(" ")
      if (joined.trim() !== "") return joined
    }
    const role = roleOf(element)
    // 2E: an embedded control inside another element's name contributes its value
    if (context.traversal && embeddedControlRole(role)) {
      const value = embeddedValue(element, role)
      if (value.trim() !== "") context.contribution.fieldContent = true
      return value
    }
    // 2C: aria-label
    const label = element.getAttribute("aria-label") ?? ""
    if (label.trim() !== "") return label
    // 2D: the host language's label
    if (role !== "none" && role !== "presentation") {
      const native = nativeName(element, context)
      if (native.trim() !== "") return native
    }
    // 2F: name from content
    if (context.traversal || (role !== null && NAME_FROM_CONTENT.has(role))) {
      let content = pseudoContent(element, "::before")
      for (const child of flatChildNodes(element)) {
        if (child instanceof Element && SKIPPED.has(child.localName)) continue
        const name = nameOfNode(child, { ...context, traversal: true })
        const inline = !(child instanceof Element) || getComputedStyle(child).display.startsWith("inline")
        content += inline ? name : ` ${name} `
      }
      content += pseudoContent(element, "::after")
      if (content.trim() !== "") {
        if (provenance && !context.traversal && !context.labelledBy) namesFromContent.add(element)
        if (inField(element)) context.contribution.fieldContent = true
        return content
      }
    }
    // 2I: the tooltip, then a placeholder (HTML-AAM)
    const title = element.getAttribute("title") ?? ""
    if (title.trim() !== "") return title
    const placeholder = element.getAttribute("placeholder") ?? ""
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && placeholder.trim() !== "") {
      return placeholder
    }
    return ""
  }

  const nativeName = (element: Element, context: NameContext): string => {
    if (element instanceof HTMLInputElement) {
      if (element.type === "submit" || element.type === "reset" || element.type === "button") {
        const value = element.value !== "" ?
          element.value :
          element.type === "submit" ?
          "Submit" :
          element.type === "reset"
          ? "Reset"
          : ""
        if (value !== "" && inField(element)) context.contribution.fieldContent = true
        return value
      }
      if (element.type === "image") {
        const value = element.alt !== "" ? element.alt : element.value
        if (value !== "" && inField(element)) context.contribution.fieldContent = true
        return value
      }
    }
    const labels = labelsOf(element)
    if (labels.length > 0) {
      return labels.map((label) => nameOfElement(label, { ...context, traversal: true })).join(" ")
    }
    if (element instanceof HTMLImageElement || element instanceof HTMLAreaElement) {
      const alt = element.getAttribute("alt") ?? ""
      if (alt.trim() !== "" && inField(element)) context.contribution.fieldContent = true
      return alt
    }
    const first = (selector: string) => Array.from(element.children).find((child) => child.matches(selector))
    if (element instanceof HTMLFieldSetElement) {
      const legend = first("legend")
      return legend === undefined ? "" : nameOfElement(legend, { ...context, traversal: true })
    }
    if (element instanceof HTMLTableElement) {
      const caption = first("caption")
      return caption === undefined ? "" : nameOfElement(caption, { ...context, traversal: true })
    }
    if (element.localName === "figure") {
      const caption = first("figcaption")
      return caption === undefined ? "" : nameOfElement(caption, { ...context, traversal: true })
    }
    if (element instanceof SVGSVGElement) {
      const title = first("title")
      if (title === undefined) return ""
      if (textContainsField(title)) context.contribution.fieldContent = true
      return title.textContent ?? ""
    }
    return ""
  }

  let provenance = false
  const namesFromFields = new Set<Element>()
  const namesFromContent = new Set<Element>()
  const nameCache = new Map<Element, string>()
  const accessibleName = (element: Element, includeHidden: boolean): string => {
    const cached = nameCache.get(element)
    if (cached !== undefined) return cached
    const contribution = { fieldContent: false }
    const role = roleOf(element)
    // This restriction is on the root, not on descendants or references contributing to another element's name.
    const name = role !== null && NAME_PROHIBITED.has(role) ? "" : collapse(
      nameOfElement(element, { visited: new Set(), labelledBy: false, traversal: false, includeHidden, contribution })
    )
    if (provenance && contribution.fieldContent) namesFromFields.add(element)
    nameCache.set(element, name)
    return name
  }

  // ── Queries ───────────────────────────────────────────────────────────────────────────────────────────

  interface InvalidSelector {
    readonly invalidSelector: true
    readonly kind?: "role" | undefined
    readonly selector: string
    readonly message: string
  }
  const isInvalidSelector = (error: unknown): error is InvalidSelector =>
    typeof error === "object" && error !== null && "invalidSelector" in error

  interface StaleMarker {
    readonly staleRef: true
    readonly why: Stale
  }
  const isStale = (error: unknown): error is StaleMarker =>
    typeof error === "object" && error !== null && "staleRef" in error

  // ── Refs ──────────────────────────────────────────────────────────────────────────────────────────────

  /** This engine's ref table: a ref names one node while the document lives, and this number names the table. */
  const generation = Math.floor(Math.random() * 2 ** 31)
  let refCount = 0
  const refs = new WeakMap<Element, string>()
  const nodesByRef = new Map<string, WeakRef<Element>>()

  const refFor = (element: Element): string => {
    let ref = refs.get(element)
    if (ref === undefined) {
      ref = `e${++refCount}`
      refs.set(element, ref)
      nodesByRef.set(ref, new WeakRef(element))
    }
    return ref
  }

  /** The node a ref names, or why it names none. */
  const byRef = (step: Extract<Step, { _tag: "Ref" }>): Element => {
    const stale = (why: Stale): never => {
      throw { staleRef: true, why } satisfies StaleMarker
    }
    // Another engine's table: this realm's engine was installed again
    if (step.generation !== generation) return stale("BindingLost")
    const held = nodesByRef.get(step.ref)
    if (held === undefined) return stale("OtherSnapshot")
    const element = held.deref()
    if (element === undefined || !element.isConnected) return stale("Detached")
    return element
  }

  const labelable = (element: Element): boolean =>
    (element instanceof HTMLInputElement && element.type !== "hidden") || element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement ||
    element instanceof HTMLMeterElement || element instanceof HTMLOutputElement ||
    element instanceof HTMLProgressElement

  const labelTexts = (element: Element): Array<string> => {
    const texts: Array<string> = []
    for (const id of (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((id) => id !== "")) {
      const target = byId(element, id)
      if (target !== null) texts.push(textOf(target))
    }
    const label = element.getAttribute("aria-label")
    if (label !== null) texts.push(collapse(label))
    for (const each of labelsOf(element)) texts.push(textOf(each))
    return texts
  }

  const attributeMatches = (element: Element, attribute: string, matcher: TextMatcher): boolean => {
    const value = element.getAttribute(attribute)
    return value !== null && matches(matcher, collapse(value))
  }

  /** The candidates of one query under `scope`, in tree order. */
  const query = (scope: Document | Element, step: Step): Array<Element> => {
    const under = elementsUnder(scope)
    switch (step._tag) {
      case "Css": {
        const roots: Array<Document | Element | ShadowRoot> = [scope]
        for (const element of under) if (element.shadowRoot !== null) roots.push(element.shadowRoot)
        const found = new Set<Element>()
        for (const root of roots) {
          try {
            for (const element of Array.from(root.querySelectorAll(step.selector))) found.add(element)
          } catch (error) {
            throw {
              invalidSelector: true,
              selector: step.selector,
              message: error instanceof Error ? error.message : String(error)
            } satisfies InvalidSelector
          }
        }
        return under.filter((element) => found.has(element))
      }
      case "Text": {
        const candidates = under.filter((element) => !inHead(element) && !SKIPPED.has(element.localName))
        const says = (element: Element) => matches(step.matcher, textOf(element))
        return candidates.filter((element) => says(element) && !flatChildElements(element).some(says))
      }
      case "Role":
        return under.filter((element) =>
          roleOf(element) === step.role && (step.includeHidden || !hiddenFromAccessibility(element)) &&
          (step.name === null || matches(step.name, accessibleName(element, step.includeHidden))) &&
          (step.level === undefined || levelOf(element) === step.level) &&
          (step.checked === undefined || checkedState(element).state === step.checked) &&
          (step.pressed === undefined || pressedOf(element) === step.pressed) &&
          (step.expanded === undefined || expandedOf(element) === step.expanded) &&
          (step.selected === undefined || selectedOf(element) === step.selected) &&
          (step.disabled === undefined || disabledOf(element) === step.disabled)
        )
      case "Label":
        return under.filter((element) =>
          (labelable(element) || element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")) &&
          labelTexts(element).some((text) => matches(step.matcher, text))
        )
      case "Placeholder":
        return under.filter((element) =>
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
          attributeMatches(element, "placeholder", step.matcher)
        )
      case "AltText":
        return under.filter((element) =>
          (element instanceof HTMLImageElement || element instanceof HTMLAreaElement ||
            (element instanceof HTMLInputElement && element.type === "image")) &&
          attributeMatches(element, "alt", step.matcher)
        )
      case "Title":
        return under.filter((element) => attributeMatches(element, "title", step.matcher))
      case "TestId":
        return under.filter((element) => element.getAttribute("data-testid") === step.id)
      default:
        return []
    }
  }

  const treeOrder = (elements: Iterable<Element>): Array<Element> => {
    const set = new Set(elements)
    return elementsUnder(document).filter((element) => set.has(element))
  }

  /** Validate the whole query before searching, including branches whose scope may be empty. */
  const validateSteps = (steps: ReadonlyArray<Step>): void => {
    for (const step of steps) {
      switch (step._tag) {
        case "Role": {
          const supported = {
            level: LEVEL_ROLES,
            checked: CHECKABLE_ROLES,
            pressed: PRESSED_ROLES,
            expanded: EXPANDED_ROLES,
            selected: SELECTED_ROLES
          }
          for (const key of ["level", "checked", "pressed", "expanded", "selected"] as const) {
            const roles = supported[key]
            if (step[key] !== undefined && !roles.has(step.role)) {
              throw {
                invalidSelector: true,
                kind: "role",
                selector: `getByRole(${JSON.stringify(step.role)}, { ${key}: ${step[key]} })`,
                message: `"${key}" is only supported for roles: ${Array.from(roles).sort().join(", ")}`
              } satisfies InvalidSelector
            }
          }
          break
        }
        case "Filter":
          if (step.has !== null) validateSteps(step.has)
          if (step.hasNot !== null) validateSteps(step.hasNot)
          break
        case "And":
        case "Or":
          validateSteps(step.other)
          break
      }
    }
  }

  /** The matches of a locator's steps, from the document. */
  const resolve = (
    steps: ReadonlyArray<Step>,
    from: ReadonlyArray<Document | Element> = [document]
  ): Array<Element> => {
    validateSteps(steps)
    let current: ReadonlyArray<Document | Element> = from
    for (const step of steps) {
      switch (step._tag) {
        case "First":
        case "Last":
        case "Nth": {
          const index = step._tag === "First" ? 0 : step._tag === "Last" ? current.length - 1 : step.index
          current = index >= 0 && index < current.length ? [current[index]!] : []
          break
        }
        case "Filter": {
          current = current.filter((scope) => {
            if (!(scope instanceof Element)) return false
            if (step.hasText !== null && !matches(step.hasText, textOf(scope))) return false
            if (step.hasNotText !== null && matches(step.hasNotText, textOf(scope))) return false
            if (step.has !== null && resolve(step.has, [scope]).length === 0) return false
            if (step.hasNot !== null && resolve(step.hasNot, [scope]).length > 0) return false
            if (step.visible !== null && visible(scope) !== step.visible) return false
            return true
          })
          break
        }
        case "And": {
          const other = new Set(resolve(step.other))
          current = current.filter((element) => element instanceof Element && other.has(element))
          break
        }
        case "Or":
          current = treeOrder([
            ...current.filter((scope): scope is Element => scope instanceof Element),
            ...resolve(step.other)
          ])
          break
        case "Ref":
          current = [byRef(step)]
          break
        default: {
          const found = new Set<Element>()
          for (const scope of current) for (const element of query(scope, step)) found.add(element)
          current = current.length === 1 ? Array.from(found) : treeOrder(found)
        }
      }
    }
    return current.filter((scope): scope is Element => scope instanceof Element)
  }

  // ── Actionability ─────────────────────────────────────────────────────────────────────────────────────

  /** A short description of an element for errors: `button#buy.primary "Add to cart"`. */
  const describe = (element: Element): string => {
    let out = element.localName
    if (element.id !== "") out += `#${element.id}`
    for (const name of Array.from(element.classList).slice(0, 2)) out += `.${name}`
    const text = textOf(element)
    if (text !== "") out += ` "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`
    return out
  }

  const ariaDisabled = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.getAttribute("aria-disabled") === "true") return true
    }
    return false
  }

  const enabled = (element: Element): boolean => {
    if (element.matches(":disabled")) return false
    return !ariaDisabled(element)
  }

  const disabledOf = (element: Element): boolean => {
    if (ariaDisabled(element)) return true
    const native = element instanceof HTMLButtonElement || element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ||
      element instanceof HTMLOptionElement || element instanceof HTMLOptGroupElement ||
      element instanceof HTMLFieldSetElement
    if (!native) return false
    if (element.hasAttribute("disabled")) return true
    if (element instanceof HTMLOptionElement && element.closest("optgroup[disabled]") !== null) return true
    // Role filters use explicit native rules: :disabled differs between browsers for options and optgroups.
    const fieldset = element.closest("fieldset[disabled]")
    if (fieldset === null) return false
    const legend = Array.from(fieldset.children).find((child) => child instanceof HTMLLegendElement)
    return legend === undefined || !legend.contains(element)
  }

  /** Text inputs whose value is typed; the other input types have it set. */
  const TYPED = new Set(["text", "search", "email", "password", "tel", "url", "number"])

  const typed = (element: Element): element is HTMLInputElement | HTMLTextAreaElement =>
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && TYPED.has(element.type))

  const SET = new Set(["date", "datetime-local", "month", "week", "time", "color", "range"])

  const settable = (element: Element): element is HTMLInputElement =>
    element instanceof HTMLInputElement && SET.has(element.type)

  const invalidNumberFill = (element: Element, value: string): boolean =>
    element instanceof HTMLInputElement && element.type === "number" && value !== "" &&
    (!/^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value) ||
      !Number.isFinite(Number(value)))

  // Validate on a detached copy so refusal never writes the live input. Keep constraints and the
  // value attribute, which can supply a range's step base. Both sides of focus use this same rule.
  const fillCandidate = (element: HTMLInputElement, value: string): HTMLInputElement | undefined => {
    if (!settable(element)) return undefined
    const candidate = element.cloneNode(false) as HTMLInputElement
    candidate.value = value
    const accepted = element.type === "range"
      ? /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value) &&
        Number.isFinite(Number(value)) && candidate.valueAsNumber === Number(value)
      : element.type === "color"
      ? candidate.value === value.toLowerCase()
      : candidate.value !== "" || value === ""
    return accepted ? candidate : undefined
  }

  const contentEditable = (element: Element): element is HTMLElement =>
    element instanceof HTMLElement && element.isContentEditable

  /** Whether an element's kind takes input at all, whatever its state. */
  const editableKind = (element: Element): boolean => typed(element) || settable(element) || contentEditable(element)

  /** The Editable predicate: enabled, not read-only, and an editable kind (CONCEPTS.md §8). */
  const readOnly = (element: Element): boolean =>
    ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) ||
    element.getAttribute("aria-readonly") === "true"

  const CHECKABLE_ROLES = new Set([
    "checkbox",
    "radio",
    "switch",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "treeitem"
  ])

  /** One read for queries and actions; actions retain their boolean view of mixed state. */
  const checkedState = (element: Element): {
    readonly state: boolean | "mixed" | null
    readonly checked: boolean | null
  } => {
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      return { state: element.indeterminate ? "mixed" : element.checked, checked: element.checked }
    }
    const role = roleOf(element)
    if (role === null || !CHECKABLE_ROLES.has(role)) return { state: null, checked: null }
    const token = element.getAttribute("aria-checked")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    if (token === "true") return { state: true, checked: true }
    if (token === "false") return { state: false, checked: false }
    if (token === "mixed") {
      return {
        state: role === "radio" || role === "menuitemradio" || role === "switch" ? false : "mixed",
        checked: false
      }
    }
    // Invalid optional state must not authorize check/uncheck input.
    const fallback = role === "option" || role === "treeitem" ? null : false
    return { state: fallback, checked: fallback }
  }

  const checkedOf = (element: Element): boolean | null => checkedState(element).checked

  const PRESSED_ROLES = new Set(["button"])
  const LEVEL_ROLES = new Set(["heading", "listitem", "row", "treeitem"])
  const SELECTED_ROLES = new Set(["gridcell", "option", "row", "tab", "rowheader", "columnheader", "treeitem"])
  const EXPANDED_ROLES = new Set([
    "application",
    "button",
    "checkbox",
    "combobox",
    "gridcell",
    "link",
    "listbox",
    "menuitem",
    "row",
    "rowheader",
    "tab",
    "treeitem",
    "columnheader",
    "menuitemcheckbox",
    "menuitemradio",
    "switch"
  ])

  const levelOf = (element: Element): number => {
    if (/^h[1-6]$/.test(element.localName)) return Number(element.localName.slice(1))
    if (!LEVEL_ROLES.has(roleOf(element) ?? "")) return 0
    const value = Number(element.getAttribute("aria-level"))
    return Number.isInteger(value) && value >= 1 ? value : 0
  }

  const pressedOf = (element: Element): boolean | "mixed" => {
    if (!PRESSED_ROLES.has(roleOf(element) ?? "")) return false
    const value = element.getAttribute("aria-pressed")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    return value === "mixed" ? "mixed" : value === "true"
  }

  const expandedOf = (element: Element): boolean | undefined => {
    if (element instanceof HTMLDetailsElement) return element.open
    if (!EXPANDED_ROLES.has(roleOf(element) ?? "")) return undefined
    const value = element.getAttribute("aria-expanded")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    return value === undefined ? undefined : value === "true"
  }

  const selectedOf = (element: Element): boolean => {
    if (element instanceof HTMLOptionElement) return element.selected
    return SELECTED_ROLES.has(roleOf(element) ?? "") &&
      element.getAttribute("aria-selected")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) === "true"
  }

  const LABEL_WIDGET_ROLES = new Set([
    "button",
    "checkbox",
    "combobox",
    "grid",
    "gridcell",
    "link",
    "listbox",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "radiogroup",
    "scrollbar",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "tablist",
    "textbox",
    "tree",
    "treegrid",
    "treeitem"
  ])

  const interactiveLabelDescendant = (element: Element): boolean => {
    const role = roleOf(element)
    return element.matches(
      "button, input, select, textarea, details, summary, iframe, frame, embed, object, a[href], area[href], img[usemap], audio[controls], video[controls]"
    ) || (
      element.namespaceURI === "http://www.w3.org/2000/svg" && element.localName === "a" &&
      element.hasAttributeNS("http://www.w3.org/1999/xlink", "href")
    ) || contentEditable(element) || (role !== null && LABEL_WIDGET_ROLES.has(role))
  }

  const enclosingLabel = (element: Element): HTMLLabelElement | null => {
    let label: Element | null = element
    while (label !== null && !(label instanceof HTMLLabelElement)) label = label.parentElement
    return label
  }

  const textSelectionTarget = (element: Element): Element => {
    let target = element
    if (!target.matches("input, textarea, select") && !contentEditable(target)) {
      target = target.closest("button, [role=button], [role=checkbox], [role=radio]") ?? target
    }
    if (
      !target.matches(
        "a, input, textarea, button, select, [role=link], [role=button], [role=checkbox], [role=radio]"
      ) &&
      !contentEditable(target)
    ) {
      target = enclosingLabel(target)?.control ?? target
    }
    return target
  }

  /** Association stays in the DOM; slots can add refusals without choosing another label. */
  const checkableForAction = (element: Element): Element | null => {
    const own = checkedOf(element)
    if (own !== null) return element
    const label = enclosingLabel(element)
    if (label === null || label.control === null) return null
    for (
      let ancestor: Element | null = element;
      ancestor !== null && ancestor !== label;
      ancestor = ancestor.parentElement
    ) {
      if (interactiveLabelDescendant(ancestor)) return null
    }
    for (
      let ancestor: Element | null = element;
      ancestor !== null && ancestor !== label;
      ancestor = ancestor.assignedSlot ?? composedParent(ancestor)
    ) {
      if (interactiveLabelDescendant(ancestor)) return null
    }
    return checkedOf(label.control) === null ? null : label.control
  }

  /** The element with focus, through open shadow roots. */
  const deepActive = (): Element | null => {
    let active: Element | null = document.activeElement
    while (active !== null && active.shadowRoot !== null && active.shadowRoot.activeElement !== null) {
      active = active.shadowRoot.activeElement
    }
    return active
  }

  const valueOf = (element: Element): string | null =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
      ? element.value
      : null

  const inertReason = (element: Element): NotReady | null => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.hasAttribute("inert")) return { _tag: "Inert" }
    }
    const modal = Array.from(document.querySelectorAll("dialog")).find((dialog) => dialog.matches(":modal"))
    return modal !== undefined && !composedContains(modal, element)
      ? { _tag: "BlockedByModal", dialog: describe(modal) }
      : null
  }

  /** Geometric bounds only; the browser's hit test determines whether ancestors or overlays block a centre. */
  const viewportBounds = (inherited?: Clip): Clip => ({
    left: Math.max(0, inherited?.left ?? 0),
    top: Math.max(0, inherited?.top ?? 0),
    right: Math.min(innerWidth, inherited?.right ?? innerWidth),
    bottom: Math.min(innerHeight, inherited?.bottom ?? innerHeight)
  })

  const fragments = (element: Element, inherited?: Clip): Array<Clip> => {
    const bounds = viewportBounds(inherited)
    const result: Array<Clip> = []
    for (const rect of element.getClientRects()) {
      const left = Math.max(bounds.left, rect.left)
      const top = Math.max(bounds.top, rect.top)
      const right = Math.min(bounds.right, rect.right)
      const bottom = Math.min(bounds.bottom, rect.bottom)
      if (right > left && bottom > top) result.push({ left, top, right, bottom })
    }
    return result
  }

  const visibleFragment = (element: Element, inherited?: Clip): Clip | null => fragments(element, inherited)[0] ?? null

  const inViewport = (element: Element): boolean => visibleFragment(element) !== null

  /** Oversized unions can have their centre in a gap between fragments; align an edge in that case. */
  const scrollToFragments = (element: Element, inherited?: Clip) => {
    const rect = element.getBoundingClientRect()
    const bounds = viewportBounds(inherited)
    element.scrollIntoView({
      block: rect.height > bounds.bottom - bounds.top ? "start" : "center",
      inline: rect.width > bounds.right - bounds.left ? "start" : "center",
      behavior: "instant"
    })
  }

  /** Keep integer-coordinate backends inside the fragment whenever it contains an integer point. */
  const fragmentCenter = (min: number, max: number): number => {
    const center = (min + max) / 2
    const rounded = Math.round(center)
    if (rounded >= max && Math.floor(center) >= min) return Math.floor(center)
    return center
  }

  /** Probe centres only when requested; retain the first geometric point for a Covered result if none reaches. */
  const actionPoints = (
    element: Element,
    position: { readonly x: number; readonly y: number } | null,
    clip: Clip | undefined,
    receivesPointer: boolean
  ) => {
    if (position === null) {
      let first: { x: number; y: number } | null = null
      const points: Array<{ x: number; y: number }> = []
      for (const rect of fragments(element, clip)) {
        const point = { x: fragmentCenter(rect.left, rect.right), y: fragmentCenter(rect.top, rect.bottom) }
        first ??= point
        if (!receivesPointer) return [point]
        const hit = hitTarget(point.x, point.y)
        if (hit !== null && composedContains(element, hit)) {
          if (clip === undefined) return [point]
          points.push(point)
        }
      }
      return points.length > 0 ? points : first === null ? [] : [first]
    }
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return [{
      x: rect.left + parseFloat(style.borderLeftWidth) + position.x,
      y: rect.top + parseFloat(style.borderTopWidth) + position.y
    }]
  }

  /** What the pointer would hit at a point, through open shadow roots. */
  const hitTarget = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y)
    while (hit !== null && hit.shadowRoot !== null) {
      const inner = hit.shadowRoot.elementFromPoint(x, y)
      if (inner === null || inner === hit) break
      hit = inner
    }
    return hit
  }

  const sameRect = (a: DOMRect, b: DOMRect) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

  const nextFrame = (timeout: number): Promise<boolean> =>
    new Promise((resume) => {
      const timer = setTimer(() => resume(false), Math.max(0, timeout))
      onFrame(() => {
        clearTimer(timer)
        resume(true)
      })
    })

  const fire = (element: Element, type: "input" | "change") =>
    element.dispatchEvent(new Event(type, { bubbles: true, composed: type === "input" }))

  /** Focuses an element and selects its contents, so text inserted next replaces them. */
  const selectContents = (element: HTMLElement) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus()
      element.select()
      return
    }
    if (document.designMode === "on") {
      window.focus()
    } else {
      let host = element
      while (host.parentElement?.isContentEditable) host = host.parentElement
      host.focus()
    }
    const selection = getSelection()
    if (selection === null) return
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const optionMatches = (option: HTMLOptionElement, index: number, choice: Choice) =>
    "value" in choice ? option.value === choice.value : "label" in choice
      ? option.label === choice.label || collapse(option.textContent ?? "") === choice.label
      : index === choice.index

  const describeChoice = (choice: Choice) =>
    "value" in choice ? `value ${JSON.stringify(choice.value)}` : "label" in choice
      ? `label ${JSON.stringify(choice.label)}`
      : `index ${choice.index}`

  // ── The guard on the first trusted event ──

  /** The gesture's events a guard watches, on the window, capturing. */
  const GUARDED = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "touchstart",
    "touchend"
  ]

  let guard: { readonly remove: () => void; blocked: string | null } | null = null

  const disarm = (): string | null => {
    if (guard === null) return null
    guard.remove()
    const blocked = guard.blocked
    guard = null
    return blocked
  }

  /** Arms a guard on `element`: the gesture's first trusted event must land in it, or the gesture is stopped. */
  const arm = (element: Element) => {
    disarm()
    let decided = false
    const handler = (event: Event) => {
      if (!event.isTrusted || current === null) return
      if (!decided) {
        decided = true
        const target = event.composedPath()[0]
        if (!(target instanceof Element) || !composedContains(element, target)) {
          current.blocked = target instanceof Element ? describe(target) : "nothing at that point"
        }
      }
      if (current.blocked !== null) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const current: { readonly remove: () => void; blocked: string | null } = {
      remove: () => {
        for (const type of GUARDED) removeEventListener(type, handler, true)
      },
      blocked: null
    }
    for (const type of GUARDED) addEventListener(type, handler, true)
    guard = current
  }

  // Native insertion is a separate protocol command. In a design-mode document a timer can refocus a
  // form control after selection, so validate at the cancellable native event, before its default mutation.
  let fillGuard: { remove: () => void; blocked: string | null; unsafe: boolean; accepted: boolean } | null = null
  const fillDisarm = () => {
    const current = fillGuard
    fillGuard = null
    current?.remove()
    return {
      _tag: "FillGuard" as const,
      blocked: current?.blocked ?? null,
      unsafe: current?.unsafe ?? false,
      accepted: current?.accepted ?? false
    }
  }
  const armFill = (steps: ReadonlyArray<Step>, ancestor: boolean) => {
    fillDisarm()
    const matches = resolve(steps)
    const element = matches.length === 1 ? matches[0]! : null
    const types = ["keydown", "keypress", "keyup", "beforeinput"]
    const current = {
      remove: () => {
        for (const type of types) removeEventListener(type, handler, true)
      },
      blocked: null as string | null,
      unsafe: false,
      accepted: false,
      inserting: false
    }
    const blocker = (): string | null => {
      // Ancestors should receive no insertion event: correct input reaches the target document instead.
      if (ancestor) return null
      const active = deepActive()
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return describe(active)
      const selection = getSelection()
      if (element === null || !element.isConnected || selection?.rangeCount !== 1) {
        return "the selection left the target"
      }
      const selected = selection.getRangeAt(0)
      if (current.inserting && element.contains(selected.startContainer) && element.contains(selected.endContainer)) {
        return null
      }
      // WebKit canonicalizes element-edge ranges to text-node edges. Ascend equivalent edges rather
      // than treating those native representations as different selections.
      const atEdge = (node: Node, offset: number, end: boolean): boolean => {
        while (node !== element) {
          const length = node instanceof CharacterData ? node.length : node.childNodes.length
          if (offset !== (end ? length : 0) || node.parentNode === null) return false
          const parent = node.parentNode
          offset = Array.prototype.indexOf.call(parent.childNodes, node) + (end ? 1 : 0)
          node = parent
        }
        return offset === (end ? element.childNodes.length : 0)
      }
      return atEdge(selected.startContainer, selected.startOffset, false) &&
          atEdge(selected.endContainer, selected.endOffset, true)
        ? null :
        "the selection left the target"
    }
    const handler = (event: Event) => {
      if (!event.isTrusted || (event.type === "keyup" && current.blocked === null)) return
      const recipient = event.composedPath()[0]
      const elsewhere = ancestor ?
        (recipient instanceof Element ? describe(recipient) : "another document")
        : recipient instanceof Element && element !== null &&
            !composedContains(recipient, element) && !composedContains(element, recipient)
        ? describe(recipient) :
        null
      const blocked = current.blocked ?? elsewhere ?? blocker()
      if (blocked === null) {
        current.accepted = true
        if (event.type === "beforeinput") current.inserting = true
        return
      }
      // Cancellation must be confirmed locally; the host also combines accepted input across documents.
      if (current.blocked === null && !event.cancelable) current.unsafe = true
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.defaultPrevented) current.blocked = blocked
    }
    if (ancestor) {
      if (!(element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement)) {
        current.blocked = "the frame no longer matches"
      } else {
        const active = deepActive()
        if (active !== element) {
          current.blocked = active === null ? "another document" : describe(active)
          element.focus()
        }
      }
    }
    current.blocked ??= blocker()
    // A preparation blocker sends no native input. Recheck through the ordinary action loop after focusing the frame,
    // whose handlers may replace the target or change readiness, before installing an insertion guard.
    if (current.blocked === null) { for (const type of types) addEventListener(type, handler, true) }
    fillGuard = current
    return { _tag: "FillGuard" as const, blocked: current.blocked, unsafe: false, accepted: false }
  }

  // ── Actions ──

  let stabilitySequence = 0
  let stability: {
    readonly token: string
    readonly element: Element
    readonly rect: DOMRect
    readonly frames: number
  } | null = null

  const act = async (request: Extract<Request, { op: "act" }>): Promise<Response> => {
    // Evidence is single-use and lasts only until the next rendering update. Another attempt supersedes it.
    let previous = stability !== null && request.stability === stability.token ? stability : null
    stability = null
    const end = now() + request.cap
    const history: Array<NotReady> = []
    const seen = new Set<string>()
    let last: NotReady = { _tag: "NoMatch" }
    const note = (reason: NotReady) => {
      const key = JSON.stringify(reason)
      if (!seen.has(key)) {
        seen.add(key)
        history.push(reason)
      }
      last = reason
    }
    let scrolled = false
    let frames = 0
    let sampled = false
    // The rects of one element across frames, for the stable check
    let tracked: Element | null = null
    let rects: Array<DOMRect> = []
    const action = request.action
    while (true) {
      const left = end - now()
      if (left <= 0) {
        return {
          _tag: "NotReady",
          reason: last,
          history,
          scrolled,
          checked: history.length > 0 || (!request.checks.rendered && sampled)
        }
      }
      // The current rectangle is the baseline; k rendering updates still have to agree with it. Waiting for
      // a frame just to take that baseline adds a frame to both the preliminary check and the check under the
      // input permit. Without stability, only the rendered check waits before checking current layout.
      // Retry waits remain frame-based even when rendered is disabled.
      if (sampled || (request.checks.rendered && !(request.checks.stable > 0))) {
        if (!(await nextFrame(left))) {
          // A round the deadline cut too short for any page to render says nothing about rendering
          if (request.checks.rendered && frames === 0 && request.cap >= 100) note({ _tag: "NoRenderingOpportunity" })
          return {
            _tag: "NotReady",
            reason: last,
            history,
            scrolled,
            checked: history.length > 0 || (!request.checks.rendered && sampled)
          }
        }
        frames++
      }
      sampled = true
      clearTreeCaches()
      const found = resolve(request.steps)
      if (found.length > 1) return strict(found)
      const element = found[0]
      if (element !== tracked) {
        tracked = element ?? null
        rects = []
      }
      // What no waiting mends fails at once
      if (element !== undefined) {
        if (request.checks.editable && !editableKind(element)) {
          return { _tag: "Final", final: { _tag: "NotEditable", element: describe(element) } }
        }
        if (action._tag === "Checked" && checkedOf(element) === null) {
          return {
            _tag: "Final",
            final: {
              _tag: "WrongElement",
              expected: "a checkbox, a radio or an ARIA checkable",
              element: describe(element)
            }
          }
        }
        if (action._tag === "Select" && !(element instanceof HTMLSelectElement)) {
          return { _tag: "Final", final: { _tag: "WrongElement", expected: "a <select>", element: describe(element) } }
        }
        if (action._tag === "FileInput" && !(element instanceof HTMLInputElement && element.type === "file")) {
          return {
            _tag: "Final",
            final: { _tag: "WrongElement", expected: "a file input", element: describe(element) }
          }
        }
      }
      const checks = request.checks
      const evidence = previous
      previous = null
      let reason: NotReady | null = null
      if (element === undefined) reason = { _tag: "NoMatch" }
      else if (checks.visible && !rendered(element, false)) reason = { _tag: "NotVisible" }
      else if (checks.enabled && !enabled(element)) reason = { _tag: "Disabled" }
      else if (checks.editable && readOnly(element)) reason = { _tag: "ReadOnly" }
      else if (checks.notInert && inertReason(element) !== null) reason = inertReason(element)
      else if (checks.inViewport && visibleFragment(element, request.clip) === null) {
        reason = { _tag: "OutsideViewport" }
        if (!scrolled) {
          scrollToFragments(element, request.clip)
          scrolled = true
        }
      } else if (checks.stable > 0) {
        const rect = element.getBoundingClientRect()
        rects.push(rect)
        if (rects.length > checks.stable + 1) rects.shift()
        const unchanged = evidence !== null && evidence.element === element && evidence.frames === checks.stable &&
          sameRect(evidence.rect, rect)
        if (!unchanged && (rects.length < checks.stable + 1 || !rects.every((rect) => sameRect(rect, rects[0]!)))) {
          reason = { _tag: "NotStable" }
        }
      }
      const position = action._tag === "Point" ? action.position : null
      const points = reason === null && element !== undefined && (action._tag === "Point" || checks.receivesPointer)
        ? actionPoints(element, position, request.clip, checks.receivesPointer)
        : []
      const point = points[0] ?? null
      if (reason === null && element !== undefined && (action._tag === "Point" || checks.receivesPointer)) {
        if (point === null) reason = { _tag: "OutsideViewport" }
        else if (checks.receivesPointer) {
          const hit = hitTarget(point.x, point.y)
          if (hit === null || !composedContains(element, hit)) {
            reason = { _tag: "Covered", by: hit === null ? "nothing at that point" : describe(hit) }
          }
        }
      }
      if (reason === null && element !== undefined && action._tag === "Select") {
        const options = Array.from(element instanceof HTMLSelectElement ? element.options : [])
        const missing = action.choices.find((choice) =>
          !options.some((option, index) => optionMatches(option, index, choice))
        )
        if (missing !== undefined) reason = { _tag: "NoSuchOption", option: describeChoice(missing) }
      }
      if (reason === null && element !== undefined) {
        if (
          request.apply && action._tag === "Fill" && document.designMode === "on" &&
          !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
        ) {
          const active = deepActive()
          if (active !== element && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
            note({ _tag: "PreparingFocus", from: describe(active) })
            active.blur()
            // Blur handlers can replace the target or change any effective check. Resolve and check again
            // through the ordinary wait loop before selecting a range or allowing native insertion.
            rects = []
            continue
          }
        }
        let response = ready(element, action, request.apply, scrolled, point, checks)
        if (response._tag === "Retry") {
          reason = response.reason
        } else {
          if (
            response._tag === "Ready" && action._tag === "Point" && action.position === null &&
            checks.receivesPointer && request.clip !== undefined && points.length > 1
          ) {
            response = { ...response, candidates: points }
          }
          if (request.stability === "capture" && checks.stable > 0 && !request.apply && response._tag === "Ready") {
            const captured = {
              token: `${generation}:${++stabilitySequence}`,
              element,
              rect: rects[rects.length - 1]!,
              frames: checks.stable
            }
            stability = captured
            const token = captured.token
            onFrame(() => {
              if (stability?.token === token) stability = null
            })
            return { ...response, stability: captured.token }
          }
          return response
        }
      }
      if (reason!._tag !== "NotStable") rects = []
      // A rect still settling within its first frames is the check working, not a reason to report
      if (reason!._tag !== "NotStable" || rects.length === checks.stable + 1) note(reason!)
      else if (history.length === 0) last = reason!
    }
  }

  /** Does what the action asks of the element, now that its checks pass. */
  const ready = (
    element: Element,
    action: Action,
    apply: boolean,
    scrolled: boolean,
    point: { x: number; y: number } | null,
    checks: Checks
  ): Response | { readonly _tag: "Retry"; readonly reason: NotReady } => {
    const answer = {
      _tag: "Ready" as const,
      element: describe(element),
      scrolled,
      point: null as { x: number; y: number } | null,
      draggable: false,
      checked: null as boolean | null,
      fill: null as "type" | "set" | "guarded" | null
    }
    switch (action._tag) {
      case "Point": {
        let draggable = false
        for (let current: Element | null = element; current !== null; current = composedParent(current)) {
          if (current.getAttribute("draggable") === "true") draggable = true
        }
        if (apply && action.guard) arm(element)
        return { ...answer, point, draggable }
      }
      case "Checked":
        return { ...answer, checked: checkedOf(element) }
      case "Blur":
        if (!("blur" in element) || typeof element.blur !== "function") {
          return {
            _tag: "Final",
            final: { _tag: "WrongElement", expected: "an element with a blur method", element: describe(element) }
          }
        }
        if (apply) element.blur()
        return answer
      default:
        break
    }
    if (!apply) return answer
    switch (action._tag) {
      case "SelectText": {
        const target = textSelectionTarget(element)
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          target.select()
          target.focus()
        } else {
          if (target instanceof HTMLElement || target instanceof SVGElement) target.focus()
          const range = document.createRange()
          range.selectNodeContents(target)
          const selection = getSelection()
          if (selection !== null) {
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
        return answer
      }
      case "Focus":
        if (element instanceof HTMLElement || element instanceof SVGElement) element.focus()
        return answer
      case "Scroll":
        element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
        return answer
      case "Fill": {
        if (invalidNumberFill(element, action.value)) {
          return { _tag: "Final", final: { _tag: "Refused", element: describe(element), value: action.value } }
        }
        const recheckFill = (): Response | { readonly _tag: "Retry"; readonly reason: NotReady } | undefined => {
          let reason: NotReady | null = null
          if (checks.visible && !rendered(element, false)) reason = { _tag: "NotVisible" }
          else if (checks.enabled && !enabled(element)) reason = { _tag: "Disabled" }
          else if (checks.editable && readOnly(element)) reason = { _tag: "ReadOnly" }
          else if (checks.notInert) reason = inertReason(element)
          return reason === null ? undefined : { _tag: "Retry", reason }
        }
        if (settable(element)) {
          if (fillCandidate(element, action.value) === undefined) {
            return { _tag: "Final", final: { _tag: "Refused", element: describe(element), value: action.value } }
          }
          element.focus()
          const focused = recheckFill()
          if (focused !== undefined) return focused
          // Focus handlers can change the type or its constraints. Use the current state before writing.
          if (TYPED.has(element.type)) {
            if (invalidNumberFill(element, action.value)) {
              return { _tag: "Final", final: { _tag: "Refused", element: describe(element), value: action.value } }
            }
            selectContents(element)
            return recheckFill() ?? { ...answer, fill: "type" }
          }
          const candidate = fillCandidate(element, action.value)
          if (candidate === undefined) {
            return { _tag: "Final", final: { _tag: "Refused", element: describe(element), value: action.value } }
          }
          element.value = candidate.value
          fire(element, "input")
          fire(element, "change")
          return { ...answer, fill: "set" }
        }
        selectContents(element as HTMLElement)
        // Focus and selection handlers can remove readiness before insertion.
        if (checks.editable && !editableKind(element)) {
          return { _tag: "Final", final: { _tag: "NotEditable", element: describe(element) } }
        }
        return recheckFill() ?? {
          ...answer,
          fill: document.designMode === "on" &&
              !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ?
            "guarded" :
            "type"
        }
      }
      case "Select": {
        const select = element as HTMLSelectElement
        const options = Array.from(select.options)
        for (const [index, option] of options.entries()) {
          option.selected = action.choices.some((choice) => optionMatches(option, index, choice))
        }
        fire(select, "input")
        fire(select, "change")
        return answer
      }
      default:
        return answer
    }
  }

  // ── Reads ──

  const read = (request: Extract<Request, { op: "read" }>): Response => {
    const found = resolve(request.steps)
    if (found.length > 1) return strict(found)
    const element = found[0]
    if (element === undefined) return { _tag: "NoMatch" }
    const wrong = (expected: string): Response => ({
      _tag: "Final",
      final: { _tag: "WrongElement", expected, element: describe(element) }
    })
    switch (request.read._tag) {
      case "Text":
        return { _tag: "Read", value: textOf(element) }
      case "Value": {
        const value = valueOf(element)
        return value === null ? wrong("an input, a textarea or a select") : { _tag: "Read", value }
      }
      case "Html":
        return { _tag: "Read", value: element.outerHTML }
      case "Attribute":
        return { _tag: "Read", value: element.getAttribute(request.read.name) }
      case "Editable":
        return { _tag: "Read", value: editableKind(element) && enabled(element) && !readOnly(element) }
      case "Enabled":
        return { _tag: "Read", value: enabled(element) }
      case "Checked": {
        const control = request.read.followLabel ? checkableForAction(element) : element
        const checked = control === null ? null : checkedOf(control)
        if (
          request.read.uncheck && checked === true && control instanceof HTMLInputElement && control.type === "radio"
        ) {
          return {
            _tag: "Final",
            final: {
              _tag: "WrongElement",
              expected: "a checkbox or a page-managed ARIA checkable to uncheck",
              element: describe(control),
              hint: "Check another radio in the group instead"
            }
          }
        }
        return checked === null ? wrong("a checkbox, a radio or an ARIA checkable") : { _tag: "Read", value: checked }
      }
    }
  }

  // ── Expectations, waiting in the page ──

  const expected = (matcher: TextMatcher, text: string): boolean =>
    matcher._tag === "RegExp" ? new RegExp(matcher.source, matcher.flags).test(text) : text === collapse(matcher.value)

  const classMatches = (matcher: TextMatcher, value: string): boolean =>
    matcher._tag === "RegExp" ? new RegExp(matcher.source, matcher.flags).test(value) : value === matcher.value

  /** Checks an expectation once: whether it holds, and what was seen. */
  const evaluate = (steps: ReadonlyArray<Step>, expectation: Expectation): { passed: boolean; observed: unknown } => {
    clearTreeCaches()
    if (expectation._tag === "Title") {
      const title = collapse(document.title)
      return { passed: expected(expectation.expected, title), observed: title }
    }
    const found = resolve(steps)
    switch (expectation._tag) {
      case "Attached":
        return { passed: found.length === 1, observed: { matches: found.length } }
      case "Detached":
        return { passed: found.length === 0, observed: { matches: found.length } }
      case "Visible": {
        const visibleCount = found.filter(visible).length
        return {
          passed: found.length === 1 && visibleCount === 1,
          observed: { matches: found.length, visible: visibleCount }
        }
      }
      case "Hidden": {
        const visibleCount = found.filter(visible).length
        return { passed: visibleCount === 0, observed: { matches: found.length, visible: visibleCount } }
      }
      case "Count":
        return { passed: found.length === expectation.count, observed: found.length }
      case "Text": {
        const texts = found.map(textOf)
        if (expectation.list) {
          return {
            passed: texts.length === expectation.expected.length &&
              texts.every((text, index) => expected(expectation.expected[index]!, text)),
            observed: texts
          }
        }
        if (found.length !== 1) return { passed: false, observed: { matches: found.length } }
        return { passed: expected(expectation.expected[0]!, texts[0]!), observed: texts[0] }
      }
      case "Class": {
        const texts = found.map((element) => element.classList.toString())
        if (expectation.list) {
          return {
            passed: texts.length === expectation.expected.length &&
              texts.every((text, index) => classMatches(expectation.expected[index]!, text)),
            observed: texts
          }
        }
        if (found.length !== 1) return { passed: false, observed: { matches: found.length } }
        return { passed: classMatches(expectation.expected[0]!, texts[0]!), observed: texts[0] }
      }
      default:
        break
    }
    if (found.length !== 1) return { passed: false, observed: { matches: found.length } }
    const element = found[0]!
    switch (expectation._tag) {
      case "Enabled":
        return { passed: enabled(element), observed: enabled(element) ? "enabled" : "disabled" }
      case "Disabled":
        return { passed: !enabled(element), observed: enabled(element) ? "enabled" : "disabled" }
      case "Checked": {
        const checked = checkedOf(element)
        return {
          passed: checked === true,
          observed: checked === null ? "not checkable" : checked ? "checked" : "unchecked"
        }
      }
      case "Focused": {
        const active = deepActive()
        return { passed: active === element, observed: active === null ? "nothing focused" : describe(active) }
      }
      case "Editable": {
        const editable = editableKind(element) && enabled(element) && !readOnly(element)
        return { passed: editable, observed: editable ? "editable" : "not editable" }
      }
      case "Role": {
        const role = roleOf(element) ?? ""
        return { passed: role === expectation.expected, observed: role }
      }
      case "AccessibleName": {
        // Resolving an includeHidden role locator may have cached a name with different visibility rules.
        nameCache.delete(element)
        const name = accessibleName(element, false)
        const matcher = expectation.expected
        const normalize = (text: string) => collapse(text.replace(/[\u200b\u00ad]/g, ""))
        return {
          passed: matcher._tag === "RegExp"
            ? new RegExp(matcher.source, matcher.flags).test(name)
            : expectation.ignoreCase
            ? normalize(name).toLocaleLowerCase() === normalize(matcher.value).toLocaleLowerCase()
            : normalize(name) === normalize(matcher.value),
          observed: name
        }
      }
      case "ContainsText": {
        const text = textOf(element)
        const matcher = expectation.expected
        return {
          passed: matcher._tag === "RegExp"
            ? new RegExp(matcher.source, matcher.flags).test(text)
            : text.includes(collapse(matcher.value)),
          observed: text
        }
      }
      case "Value": {
        const value = valueOf(element)
        const matcher = expectation.expected
        return {
          passed: value !== null &&
            (matcher._tag === "RegExp"
              ? new RegExp(matcher.source, matcher.flags).test(value)
              : value === matcher.value),
          observed: value === null ? "not a form control" : value
        }
      }
      case "CSS": {
        const value = getComputedStyle(element, expectation.pseudo === null ? undefined : `::${expectation.pseudo}`)
          .getPropertyValue(expectation.name)
        const matcher = expectation.expected
        const matches = matcher._tag === "RegExp"
          ? new RegExp(matcher.source, matcher.flags).test(value)
          : value === matcher.value
        return { passed: expectation.not ? !matches : matches, observed: value }
      }
      case "Aria": {
        const root = rootNode(element, { interactivity: false, depth: null })
        return { passed: matchPattern(expectation.pattern, root), observed: render(root) }
      }
      case "Attribute": {
        const value = element.getAttribute(expectation.name)
        const matcher = expectation.expected
        return {
          passed: value !== null &&
            (matcher === null ||
              (matcher._tag === "RegExp"
                ? new RegExp(matcher.source, matcher.flags).test(value)
                : value === matcher.value)),
          observed: value
        }
      }
      default:
        return { passed: false, observed: null }
    }
  }

  // Allocated only while a viewport expectation owns observations in this document.
  let viewportRounds: Map<string, () => void> | undefined

  const expectViewport = (request: Extract<Request, { op: "expect" }>): Promise<Response> =>
    new Promise((resume, reject) => {
      const expectation = request.expectation
      if (expectation._tag !== "Viewport") return
      let done = false
      let observer: IntersectionObserver | undefined
      let frame: number | undefined
      const next = (callback: () => void) => {
        frame = onFrame(callback)
      }
      let last: { passed: boolean; observed: unknown } = { passed: false, observed: null }
      let changed = false
      let samples = 0
      const finish = (error?: unknown) => {
        if (done) return
        done = true
        observer?.disconnect()
        if (frame !== undefined) {
          ;(realTimers?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame.bind(globalThis))(frame)
        }
        clearTimer(timer)
        if (request.token !== undefined) {
          viewportRounds?.delete(request.token)
          if (viewportRounds?.size === 0) viewportRounds = undefined
        }
        if (error !== undefined) reject(error)
        else resume({ _tag: "Expected", ...last, changed })
      }
      const sample = () => {
        if (done) return
        changed = samples++ > 0
        observer?.disconnect()
        clearTreeCaches()
        let found: ReadonlyArray<Element>
        try {
          found = resolve(request.steps)
        } catch (error) {
          finish(error)
          return
        }
        if (found.length !== 1) {
          last = {
            passed: found.length === 0 && !expectation.inViewport,
            observed: { matches: found.length }
          }
          if (last.passed) finish()
          else next(sample)
          return
        }
        if (last.observed === null) last = { passed: false, observed: { matches: 1 } }
        const element = found[0]!
        observer = new IntersectionObserver((entries) => {
          if (done) return
          observer?.disconnect()
          // Re-resolve after the asynchronous observation: a detached or replaced match is not evidence.
          clearTreeCaches()
          try {
            const current = resolve(request.steps)
            if (current.length !== 1 || current[0] !== element) {
              next(sample)
              return
            }
          } catch (error) {
            finish(error)
            return
          }
          const ratio = entries[0]!.intersectionRatio
          const intersects = ratio > 0 && ratio > expectation.ratio - 1e-9
          last = { passed: intersects === expectation.inViewport, observed: { matches: 1, ratio } }
          if (last.passed) finish()
          else {
            changed = true
            next(sample)
          }
        })
        observer.observe(element)
        // Firefox needs a rendering opportunity to deliver intersection observations.
        next(() => {})
      }
      const timer = setTimer(finish, Math.max(0, request.cap))
      if (request.token !== undefined) (viewportRounds ??= new Map()).set(request.token, finish)
      sample()
    })

  /**
   * One round of an expectation: a check now, then again on each change the page makes (a mutation, an `input`,
   * `change` or focus event, an animation frame) until it holds or the round's cap runs out.
   */
  const expect = (request: Extract<Request, { op: "expect" }>): Promise<Response> => {
    if (request.expectation._tag === "Viewport") {
      resolve(request.steps)
      return expectViewport(request)
    }
    const first = evaluate(request.steps, request.expectation)
    if (first.passed || request.cap <= 0) {
      return Promise.resolve({ _tag: "Expected", passed: first.passed, observed: first.observed, changed: false })
    }
    return new Promise((resume) => {
      let done = false
      let last = first
      const finish = (changed: boolean) => {
        if (done) return
        done = true
        observer.disconnect()
        for (const type of EVENTS) removeEventListener(type, recheck, true)
        clearTimer(timer)
        resume({ _tag: "Expected", passed: last.passed, observed: last.observed, changed })
      }
      const recheck = () => {
        if (done) return
        try {
          last = evaluate(request.steps, request.expectation)
        } catch {
          return
        }
        if (last.passed) finish(true)
      }
      const EVENTS = ["input", "change", "focusin", "focusout"]
      const observer = new MutationObserver(recheck)
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
      for (const type of EVENTS) addEventListener(type, recheck, true)
      const tick = () => {
        if (done) return
        recheck()
        onFrame(tick)
      }
      onFrame(tick)
      const timer = setTimer(() => finish(true), request.cap)
    })
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────────────────────────────────

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

  interface Walk {
    readonly interactivity: boolean
    readonly depth: number | null
  }

  const statesOf = (element: Element, role: string | null): Array<string> => {
    const states: Array<string> = []
    if (checkedOf(element) === true) states.push("checked")
    if (expandedOf(element) === true) states.push("expanded")
    if (selectedOf(element) === true) states.push("selected")
    if ((INTERACTIVE.has(role ?? "") || element.matches(":disabled")) && !enabled(element)) states.push("disabled")
    if (deepActive() === element) states.push("focused")
    if (pressedOf(element) === true) states.push("pressed")
    if (validationMessageOf(element) !== null) states.push("invalid")
    return states
  }

  const validationMessageOf = (element: Element): string | null => {
    if (
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement ||
        element instanceof HTMLFieldSetElement || element instanceof HTMLOutputElement) &&
      element.willValidate && !element.validity.valid
    ) return element.validationMessage
    return null
  }

  /** What makes an element with no role look interactive. */
  const evidenceOf = (element: Element): Array<string> => {
    const evidence: Array<string> = []
    if (element instanceof HTMLInputElement && element.type === "password") evidence.push("password")
    const parent = composedParent(element)
    // `cursor` is inherited: only the element that sets it counts
    if (
      getComputedStyle(element).cursor === "pointer" &&
      (parent === null || getComputedStyle(parent).cursor !== "pointer")
    ) evidence.push("cursorPointer")
    if (element.hasAttribute("tabindex") && (element as HTMLElement).tabIndex >= 0) evidence.push("tabindex")
    if (
      element instanceof HTMLElement && element.isContentEditable &&
      !(parent instanceof HTMLElement && parent.isContentEditable)
    ) evidence.push("contentEditable")
    if (element.hasAttribute("onclick")) evidence.push("onclickAttribute")
    return evidence
  }

  const clip = (text: string) => text.length > 80 ? `${text.slice(0, 80)}…` : text

  const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "slider", "spinbutton", "editable"])
  const fieldKinds = new Map<Element, boolean>()
  const fieldOf = (element: Element): boolean => {
    const cached = fieldKinds.get(element)
    if (cached !== undefined) return cached
    const field = FIELD_ROLES.has(roleOf(element) ?? "") || element instanceof HTMLSelectElement ||
      typed(element) || settable(element) || contentEditable(element)
    fieldKinds.set(element, field)
    return field
  }

  // Naming follows assigned slots and shadow hosts without changing action/selector ancestry.
  const fieldParent = (node: Node): Node | null => {
    if ((node instanceof Element || node instanceof Text) && node.assignedSlot !== null) return node.assignedSlot
    return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode
  }

  const fieldAncestry = new Map<Node, boolean>()
  const inField = (node: Node): boolean => {
    if (!provenance) return false
    const cached = fieldAncestry.get(node)
    if (cached !== undefined) return cached
    const path: Array<Node> = []
    let field = false
    for (let current: Node | null = node; current !== null; current = fieldParent(current)) {
      const known = fieldAncestry.get(current)
      if (known !== undefined) {
        field = known
        break
      }
      path.push(current)
      if (current instanceof Element && fieldOf(current)) {
        field = true
        break
      }
    }
    // Cache negative paths too: nested clickables must not repeat a full ancestor walk per contributor.
    for (const ancestor of path) fieldAncestry.set(ancestor, field)
    return field
  }

  const fieldText = new Map<Element, boolean>()
  // Follow textOf's actual flat-tree contributors. Each subtree is classified at most once per walk.
  const textContainsField = (element: Element): boolean => {
    if (!provenance) return false
    const cached = fieldText.get(element)
    if (cached !== undefined) return cached
    const field = textOfNode(element).trim() !== "" && (inField(element) ||
      flatChildNodes(element).some((child) =>
        child instanceof Element
          ? textContainsField(child)
          : child.nodeType === Node.TEXT_NODE && (child.nodeValue ?? "").trim() !== "" && inField(child)
      ))
    fieldText.set(element, field)
    return field
  }

  const clearTreeCaches = (): void => {
    rawText.clear()
    roleCache.clear()
    nameCache.clear()
    namesFromContent.clear()
    namesFromFields.clear()
    provenance = false
    fieldKinds.clear()
    fieldAncestry.clear()
    fieldText.clear()
  }

  /** An inferred node's name: its accessible name, or where one can be read from. */
  const inferredName = (element: Element): SnapNode["name"] => {
    const accessible = accessibleName(element, false)
    if (accessible !== "") {
      return {
        _tag: "Accessible",
        value: accessible,
        ...(namesFromFields.has(element) ? { fieldContent: true } : {})
      }
    }
    const text = textOf(element)
    if (text !== "") {
      return {
        _tag: "Inferred",
        value: clip(text),
        from: "text",
        ...(textContainsField(element) ? { fieldContent: true } : {})
      }
    }
    const title = collapse(element.getAttribute("title") ?? "")
    if (title !== "") return { _tag: "Inferred", value: title, from: "title" }
    const placeholder = collapse(
      element.getAttribute("placeholder") ?? element.getAttribute("aria-placeholder") ??
        element.getAttribute("data-placeholder") ?? ""
    )
    if (placeholder !== "") return { _tag: "Inferred", value: placeholder, from: "placeholder" }
    const image = element.querySelector("img[alt]")
    const alt = collapse(image?.getAttribute("alt") ?? "")
    if (alt !== "") {
      return {
        _tag: "Inferred",
        value: alt,
        from: "alt",
        ...(image !== null && inField(image) ? { fieldContent: true } : {})
      }
    }
    const previous = element.previousElementSibling
    const nearby = previous === null ? "" : textOf(previous)
    if (nearby !== "" && nearby.length <= 40) {
      return {
        _tag: "Inferred",
        value: nearby,
        from: "nearbyLabel",
        ...(previous !== null && textContainsField(previous) ? { fieldContent: true } : {})
      }
    }
    return { _tag: "None" }
  }

  const textNode = (value: string): SnapNode => ({
    ref: null,
    role: { _tag: "Aria", role: "text" },
    name: { _tag: "Accessible", value },
    states: [],
    validationMessage: null,
    children: [],
    frame: false
  })

  /** The nodes under `parent`: text runs merged, elements without a role giving theirs to the parent. */
  const childrenOf = (parent: Node, level: number, walk: Walk): Array<SnapNode> => {
    const out: Array<SnapNode> = []
    let pending = ""
    const flush = () => {
      const text = collapse(pending)
      pending = ""
      if (text !== "") out.push(textNode(text))
    }
    const visit = (node: Node, textShown: boolean) => {
      if (node.nodeType === 3) {
        if (textShown) pending += node.textContent ?? ""
        return
      }
      if (!(node instanceof Element) || SKIPPED.has(node.localName)) return
      if (node.getAttribute("aria-hidden") === "true") return
      const display = getComputedStyle(node).display
      if (display === "none") return
      if (display !== "contents" && !node.checkVisibility()) return
      const shown = display === "contents" || node.checkVisibility({ visibilityProperty: true })
      const made = shown ? elementNode(node, level, walk) : null
      if (made === null) {
        for (const child of flatChildNodes(node)) visit(child, shown)
        return
      }
      flush()
      out.push(made)
    }
    for (const child of flatChildNodes(parent)) visit(child, true)
    flush()
    return out
  }

  /** An element's own node, or `null` when it has no role and shows no interactivity. */
  const elementNode = (element: Element, level: number, walk: Walk): SnapNode | null => {
    const frame = element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement
    const role = frame ? "iframe" : roleOf(element)
    const plain = role === null || role === "generic" || role === "none" || role === "presentation"
    let inferred: Extract<SnapNode["role"], { _tag: "Inferred" }> | null = null
    if (plain && walk.interactivity) {
      const evidence = evidenceOf(element)
      if (evidence.length > 0) {
        inferred = {
          _tag: "Inferred",
          role: evidence.includes("password") || evidence.includes("contentEditable")
            ? "editable"
            : evidence.includes("cursorPointer") || evidence.includes("onclickAttribute")
            ? "clickable"
            : "focusable",
          evidence
        }
      }
    }
    if (plain && inferred === null) return null
    return made(element, inferred ?? { _tag: "Aria", role: role! }, level, walk, frame)
  }

  const made = (
    element: Element,
    role: SnapNode["role"],
    level: number,
    walk: Walk,
    frame: boolean
  ): SnapNode => {
    const accessible = accessibleName(element, false)
    const field = provenance && fieldOf(element)
    const name: SnapNode["name"] = role._tag === "Inferred" && !role.evidence.includes("password")
      ? inferredName(element)
      : accessible === ""
      ? { _tag: "None" }
      : {
        _tag: "Accessible",
        value: accessible,
        ...(field && namesFromContent.has(element) ? { from: "text" as const } : {}),
        ...(namesFromFields.has(element) ? { fieldContent: true } : {})
      }
    let children = frame || (walk.depth !== null && level >= walk.depth) ? [] : childrenOf(element, level + 1, walk)
    // Text that only repeats the node's name isn't a node of its own
    if (
      name._tag !== "None" && children.length === 1 && children[0]!.role._tag === "Aria" &&
      children[0]!.role.role === "text" && children[0]!.name._tag !== "None" && children[0]!.name.value === name.value
    ) children = []
    return {
      ref: refFor(element),
      role,
      name,
      states: statesOf(element, role._tag === "Aria" ? role.role : null),
      ...(field ? { editable: true } : {}),
      validationMessage: validationMessageOf(element),
      children,
      frame
    }
  }

  /** A subtree's root: the element's node, or a generic one when it has no role of its own. */
  const rootNode = (element: Element, walk: Walk): SnapNode =>
    elementNode(element, 0, walk) ?? made(element, { _tag: "Aria", role: "generic" }, 0, walk, false)

  /** The document's root. */
  const documentNode = (walk: Walk): SnapNode => {
    const title = collapse(document.title)
    return {
      ref: null,
      role: { _tag: "Aria", role: "document" },
      name: title === "" ? { _tag: "None" } : { _tag: "Accessible", value: title },
      states: [],
      validationMessage: null,
      children: document.documentElement === null || (walk.depth !== null && walk.depth < 1)
        ? []
        : childrenOf(document.documentElement, 1, walk),
      frame: false
    }
  }

  const snapshot = (request: Extract<Request, { op: "snapshot" }>): Response => {
    provenance = request.provenance === true
    const walk: Walk = { interactivity: request.interactivity, depth: request.depth }
    if (request.steps === null) return { _tag: "Snapshot", root: documentNode(walk), generation }
    const found = resolve(request.steps)
    if (found.length > 1) return strict(found)
    if (found.length === 0) return { _tag: "NoMatch" }
    return { _tag: "Snapshot", root: rootNode(found[0]!, walk), generation }
  }

  const nameMatches = (matcher: TextMatcher, name: SnapNode["name"]): boolean => {
    const value = name._tag === "None" ? "" : name.value
    return matcher._tag === "RegExp"
      ? new RegExp(matcher.source, matcher.flags).test(value)
      : value === collapse(matcher.value)
  }

  /** Whether a node matches a pattern: its role and name, and its children as the pattern states. */
  const matchPattern = (pattern: Pattern, node: SnapNode): boolean => {
    if (pattern._tag === "Text") {
      return node.role._tag === "Aria" && node.role.role === "text" && nameMatches(pattern.value, node.name)
    }
    if (node.role._tag !== "Aria" || node.role.role !== pattern.role || !nameMatches(pattern.name, node.name)) {
      return false
    }
    const children = pattern.children
    switch (children._tag) {
      case "Unchecked":
        return true
      case "Exactly":
        return children.patterns.length === node.children.length &&
          children.patterns.every((each, index) => matchPattern(each, node.children[index]!))
      case "Including": {
        let at = 0
        for (const each of children.patterns) {
          while (at < node.children.length && !matchPattern(each, node.children[at]!)) at++
          if (at === node.children.length) return false
          at++
        }
        return true
      }
    }
  }

  /** Edits between two short strings (Levenshtein). */
  const distance = (a: string, b: string): number => {
    if (Math.abs(a.length - b.length) > 2) return 3
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let i = 1; i <= a.length; i++) {
      const row = [i]
      for (let j = 1; j <= b.length; j++) {
        row.push(Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)))
      }
      previous = row
    }
    return previous[b.length]!
  }

  const explain = (steps: ReadonlyArray<Step>): Response => {
    if (resolve(steps).length > 0) {
      return { _tag: "Explained", matched: true, nearest: null, suggestions: [], prefix: steps.length }
    }
    let prefix = steps.length - 1
    let anchor: Element | null = null
    for (; prefix > 0; prefix--) {
      const found = resolve(steps.slice(0, prefix))
      if (found.length > 0) {
        anchor = found[0]!
        break
      }
    }
    const nearest = anchor === null ? null : render(rootNode(anchor, { interactivity: false, depth: 2 }))
    const suggestions: Array<{ role: string; name: string }> = []
    const last = steps.at(-1)
    if (last !== undefined && last._tag === "Role" && last.name !== null && last.name._tag === "String") {
      const wanted = collapse(last.name.value).toLowerCase()
      for (const element of elementsUnder(anchor ?? document)) {
        if (roleOf(element) !== last.role || hiddenFromAccessibility(element)) continue
        const name = accessibleName(element, false)
        const lower = name.toLowerCase()
        if (name === "" || suggestions.some((each) => each.name === name)) continue
        if (lower.includes(wanted) || wanted.includes(lower) || distance(lower, wanted) <= 2) {
          suggestions.push({ role: last.role, name })
        }
        if (suggestions.length === 5) break
      }
    }
    return { _tag: "Explained", matched: false, nearest, suggestions, prefix }
  }

  const rect = (steps: ReadonlyArray<Step>): Response => {
    const found = resolve(steps)
    if (found.length > 1) return strict(found)
    if (found.length === 0) return { _tag: "NoMatch" }
    const box = found[0]!.getBoundingClientRect()
    return {
      _tag: "Rect",
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      scroll: { x: scrollX, y: scrollY }
    }
  }

  const html = (): Response => {
    const doctype = document.doctype === null ? "" : new XMLSerializer().serializeToString(document.doctype)
    return { _tag: "Read", value: doctype + (document.documentElement?.outerHTML ?? "") }
  }

  const strict = (found: ReadonlyArray<Element>): Response => ({
    _tag: "Strict",
    count: found.length,
    candidates: found.slice(0, 10).map((element) => ({ description: describe(element), visible: visible(element) }))
  })

  /**
   * The one match itself, for an evaluation that returns it by value with its node binding: what
   * `setInputFiles`, `Locator.evaluate` and a frame's iframe need. Otherwise a `Response` as JSON text: no match,
   * several, an invalid selector, or, for an iframe, an element that isn't one.
   */
  const element = (text: string): Element | Array<Element> | string => {
    const request = JSON.parse(text) as {
      readonly steps: ReadonlyArray<Step>
      /** The complete query, before frame routing splits it. */
      readonly validationSteps?: ReadonlyArray<Step>
      readonly all?: boolean
      readonly frame?: boolean
      /** For an iframe on an action's way: scrolled into view, so its frame renders (QUIRKS.md, Q110). */
      readonly scroll?: boolean
    }
    clearTreeCaches()
    let found: Array<Element>
    try {
      if (request.validationSteps !== undefined) validateSteps(request.validationSteps)
      found = resolve(request.steps)
    } catch (error) {
      if (isInvalidSelector(error)) {
        return JSON.stringify(
          {
            _tag: "InvalidSelector",
            selector: error.selector,
            message: error.message,
            ...(error.kind === undefined ? {} : { kind: error.kind })
          } satisfies Response
        )
      }
      if (isStale(error)) return JSON.stringify({ _tag: "StaleRef", why: error.why } satisfies Response)
      throw error
    }
    if (request.all === true) return found
    if (found.length === 0) return JSON.stringify({ _tag: "NoMatch" } satisfies Response)
    if (found.length > 1) return JSON.stringify(strict(found))
    const one = found[0]!
    if (request.frame === true && !(one instanceof HTMLIFrameElement || one instanceof HTMLFrameElement)) {
      return JSON.stringify(
        {
          _tag: "Final",
          final: { _tag: "WrongElement", expected: "an iframe", element: describe(one) }
        } satisfies Response
      )
    }
    if (request.scroll === true && !inViewport(one)) {
      one.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
    }
    return one
  }

  /** An iframe's content box origin, scrolled into view when asked, and what the pointer would hit at a point. */
  const frame = (request: Extract<Request, { op: "frame" }>): Response => {
    const found = resolve(request.steps)
    if (found.length > 1) return strict(found)
    const iframe = found[0]
    if (iframe === undefined) return { _tag: "NoMatch" }
    let scrolled = false
    if (request.scroll && visibleFragment(iframe, request.clip) === null) {
      scrollToFragments(iframe, request.clip)
      scrolled = true
    }
    const rect = iframe.getBoundingClientRect()
    const style = getComputedStyle(iframe)
    const origin = {
      x: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      y: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
    }
    let covered: string | null = null
    if (request.point !== null) {
      const hit = hitTarget(origin.x + request.point.x, origin.y + request.point.y)
      if (hit !== iframe) covered = hit === null ? "nothing at that point" : describe(hit)
    }
    const bounds = viewportBounds(request.clip)
    const viewport = {
      left: Math.max(bounds.left, origin.x) - origin.x,
      top: Math.max(bounds.top, origin.y) - origin.y,
      right: Math.min(bounds.right, rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)) -
        origin.x,
      bottom:
        Math.min(bounds.bottom, rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)) -
        origin.y
    }
    return { _tag: "Frame", origin, viewport, scrolled, covered, scroll: { x: scrollX, y: scrollY } }
  }

  // Invalid events do not bubble or cross shadow boundaries. Listen on each existing open root,
  // without probing validity or changing page behavior. Each call owns its listeners and deduplication.
  const validationObservers = new Map<string, () => Array<string>>()
  const observeValidation = (token: string, full: boolean) => {
    validationObservers.get(token)?.()
    const roots: Array<Document | ShadowRoot> = [document]
    for (const element of elementsUnder(document)) {
      if (element.shadowRoot !== null) roots.push(element.shadowRoot)
    }
    const found = new Map<Element, string>()
    const listener = (event: Event) => {
      const element = event.target
      if (!(element instanceof Element) || found.has(element)) return
      const message = validationMessageOf(element)
      if (message === null) return
      rawText.clear()
      roleCache.clear()
      nameCache.clear()
      const name = full ? accessibleName(element, true) : ""
      found.set(
        element,
        `${roleOf(element)}${name === "" ? "" : ` ${JSON.stringify(name)}`} validationMessage=${
          JSON.stringify(full ? message : "•••")
        }`
      )
    }
    for (const root of roots) root.addEventListener("invalid", listener, true)
    validationObservers.set(token, () => {
      for (const root of roots) root.removeEventListener("invalid", listener, true)
      validationObservers.delete(token)
      return Array.from(found.values())
    })
  }

  const run = async (text: string): Promise<string> => {
    const request = JSON.parse(text) as Request
    clearTreeCaches()
    try {
      switch (request.op) {
        case "validationStart":
          observeValidation(request.token, request.full)
          return JSON.stringify({ _tag: "Validation", lines: [] } satisfies Response)
        case "validationStop":
          return JSON.stringify(
            {
              _tag: "Validation",
              lines: validationObservers.get(request.token)?.() ?? []
            } satisfies Response
          )
        case "count":
          return JSON.stringify({ _tag: "Count", count: resolve(request.steps).length } satisfies Response)
        case "visible": {
          const found = resolve(request.steps)
          if (found.length > 1) return JSON.stringify(strict(found))
          return JSON.stringify(
            {
              _tag: "Visible",
              count: found.length,
              visible: found.length === 1 && visible(found[0]!)
            } satisfies Response
          )
        }
        case "act":
          return JSON.stringify(await act(request))
        case "fillGuard":
          return JSON.stringify(armFill(request.steps, request.ancestor) satisfies Response)
        case "fillDisarm":
          return JSON.stringify(fillDisarm() satisfies Response)
        case "disarm":
          return JSON.stringify({ _tag: "Guarded", blocked: disarm() } satisfies Response)
        case "read":
          return JSON.stringify(read(request))
        case "expectStop":
          viewportRounds?.get(request.token)?.()
          return JSON.stringify({ _tag: "Expected", passed: false, observed: null, changed: false } satisfies Response)
        case "expect":
          return JSON.stringify(await expect(request))
        case "title":
          return JSON.stringify({ _tag: "Title", title: document.title } satisfies Response)
        case "frame":
          return JSON.stringify(frame(request))
        case "snapshot":
          return JSON.stringify(snapshot(request))
        case "explain":
          return JSON.stringify(explain(request.steps))
        case "rect":
          return JSON.stringify(rect(request.steps))
        case "html":
          return JSON.stringify(html())
        case "role":
          return JSON.stringify(
            {
              _tag: "Roles",
              roles: resolve(request.steps).map((element) => ({
                role: roleOf(element),
                name: accessibleName(element, true)
              }))
            } satisfies Response
          )
      }
    } catch (error) {
      if (isInvalidSelector(error)) {
        return JSON.stringify(
          {
            _tag: "InvalidSelector",
            selector: error.selector,
            message: error.message,
            ...(error.kind === undefined ? {} : { kind: error.kind })
          } satisfies Response
        )
      }
      if (isStale(error)) return JSON.stringify({ _tag: "StaleRef", why: error.why } satisfies Response)
      throw error
    }
  }

  return { run, element }
}

/** The key the engine is installed under in a realm's global: a symbol, out of the way of anything else. */
export const installKey = "@usestrider/browser/engine/1"

/** Installs the engine in a realm, once: a function declaration for `evaluate`. */
export const install = `function() {
  const key = Symbol.for(${JSON.stringify(installKey)});
  if (globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, { value: (${engine.toString()})(${renderText.toString()}), enumerable: false });
  }
  return "installed";
}`

/** Runs one request: a function declaration for `evaluate`, taking the request as JSON text. */
export const run = `function(request) {
  const engine = globalThis[Symbol.for(${JSON.stringify(installKey)})];
  return engine === undefined ? "\\u0000missing" : engine.run(request);
}`

/**
 * Returns the one match itself, by value, so the adapter gives its node binding: a function declaration for
 * `evaluate`, taking the steps as JSON text. A string says why there is no one match.
 */
export const element = `function(request) {
  const engine = globalThis[Symbol.for(${JSON.stringify(installKey)})];
  return engine === undefined ? "\\u0000missing" : engine.element(request);
}`

/** What `run` answers when the realm has no engine yet. */
export const missing = "\u0000missing"
