/**
 * The query and actionability engine: one engine of ours, evaluated in each document's utility
 * world, the same on every backend, so a locator means the same thing in every browser.
 *
 * `engine` is self-contained: it refers to nothing outside its own body but the page's globals, because its
 * source crosses into the page as text (`source`), where it is installed once per realm, out of the page's
 * reach. L1 sends it requests as JSON and reads JSON back (`Request`, `Response`).
 *
 * It reads the DOM members of anything that can be any element, or the document, through the prototypes' own
 * getters and methods, taken once as it loads (`dom`, and each labelable element's `labels`), never through the
 * object: a form's named controls are properties of the form that win over its members (`<input name="localName">`
 * makes `form.localName` the input), and where the engine shares the page's world, as on stock WebKit, a document's
 * named images, forms, embeds, objects and iframes do the same. Members of a value already known not to be a form,
 * such as an input's `value` or a shadow root's `activeElement`, are read directly.
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
 *   the action point, which the target's nearest enclosing button or link in the flat tree, or else the target,
 *   must receive; an `input`, `textarea`, `select`, or editable target must receive it itself. The rendered check
 *   independently gates the first check on a rendering update.
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
  /**
   * `by` is the element with the `inert` attribute; `dialog` the open modal dialog outside the target, when there is
   * one: a native one, or a rendered `aria-modal` dialog that isn't inert itself.
   */
  Schema.TaggedStruct("Inert", { by: Schema.String, dialog: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("BlockedByModal", { dialog: Schema.String }),
  Schema.TaggedStruct("OutsideViewport", {}),
  Schema.TaggedStruct("NotStable", {}),
  Schema.TaggedStruct("NoRenderingOpportunity", {}),
  Schema.TaggedStruct("Covered", { by: Schema.String }),
  /** The hit test skips `element`, the target or an iframe holding it, because its `pointer-events` is `none`. */
  Schema.TaggedStruct("NoPointerEvents", { element: Schema.String }),
  /** The guard stopped the gesture: its first trusted event landed on another element. */
  Schema.TaggedStruct("Intercepted", { by: Schema.String }),
  Schema.TaggedStruct("NoSuchOption", { option: Schema.String }),
  /** A chosen option, or its optgroup, is disabled. */
  Schema.TaggedStruct("DisabledOption", { option: Schema.String }),
  /** A different text control held focus before preparing the target for insertion. */
  Schema.TaggedStruct("PreparingFocus", { from: Schema.String })
])
export type NotReady = typeof NotReady.Type

/** An option of a `<select>`, by value, label or index. */
export type Choice =
  | { readonly value: string; readonly label?: never; readonly index?: never }
  | { readonly label: string; readonly value?: never; readonly index?: never }
  | { readonly index: number; readonly value?: never; readonly label?: never }

/**
 * What an action does in the page once its checks pass: answer the action point, and
 * guard the gesture that follows; or focus, scroll, prepare a fill, choose options, or read whether it is checked.
 */
export type Action =
  | {
    readonly _tag: "Point"
    readonly position: { readonly x: number; readonly y: number } | null
    readonly guard: boolean
    readonly checked?: boolean | undefined
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
  | { readonly _tag: "Empty" }
  /** The whole text of the one match, or with `list`, of each match in order. */
  | { readonly _tag: "Text"; readonly expected: ReadonlyArray<TextMatcher>; readonly list: boolean }
  | { readonly _tag: "Role"; readonly expected: string }
  | { readonly _tag: "AccessibleName"; readonly expected: TextMatcher; readonly ignoreCase: boolean }
  /** The raw class string of one match, or each match in order. */
  | { readonly _tag: "Class"; readonly expected: ReadonlyArray<TextMatcher>; readonly list: boolean }
  | { readonly _tag: "ContainsText"; readonly expected: TextMatcher }
  | { readonly _tag: "Value"; readonly expected: TextMatcher }
  | { readonly _tag: "Values"; readonly expected: ReadonlyArray<TextMatcher> }
  | { readonly _tag: "Attribute"; readonly name: string; readonly expected: TextMatcher | null }
  | { readonly _tag: "Count"; readonly count: number }
  | { readonly _tag: "Title"; readonly expected: TextMatcher }
  /**
   * The one match's accessibility tree, or with `document` the page's from its document node, matches a pattern;
   * with `not`, it doesn't.
   */
  | { readonly _tag: "Aria"; readonly pattern: Pattern; readonly document: boolean; readonly not: boolean }

/** A pattern over the accessibility tree, as `AriaPattern` builds it. */
export type Pattern =
  | {
    readonly _tag: "Node"
    readonly role: string
    readonly name: TextMatcher
    readonly children: PatternChildren
    readonly states: PatternStates
  }
  | { readonly _tag: "Text"; readonly value: TextMatcher }
  /** A node, at the subject or at any depth beneath it, whose children match. */
  | { readonly _tag: "Anywhere"; readonly children: PatternChildren }

/** The level and states a node pattern compares; an omitted one isn't compared. */
export interface PatternStates {
  readonly level?: number | undefined
  readonly checked?: boolean | "mixed" | undefined
  readonly pressed?: boolean | "mixed" | undefined
  readonly expanded?: boolean | undefined
  readonly selected?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly invalid?: boolean | undefined
  readonly focused?: boolean | undefined
}

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
  /** A heading's, list item's, row's or tree item's level, when it has one. */
  readonly level?: number | undefined
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
  level: Schema.optional(Schema.Number),
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
    /**
     * Return after the first permitted readiness sample only when that sample recorded a blocker. Otherwise the
     * round waits like any other, retaining rendering requirements.
     */
    readonly sample?: boolean
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
  /**
   * Inserts text with the editing command in this document's focused element, after a cancelable `beforeinput`
   * when `beforeInput` is set; answers `InFrame` when the focus is in a frame's document instead.
   */
  | { readonly op: "insert"; readonly text: string; readonly beforeInput: boolean }
  | { readonly op: "read"; readonly steps: ReadonlyArray<Step>; readonly read: Read }
  | {
    readonly op: "expect"
    readonly steps: ReadonlyArray<Step>
    readonly token?: string | undefined
    readonly expectation: Expectation
    /** Milliseconds this round may wait in the page for the expectation to hold. */
    readonly cap: number
    /**
     * Whether the last round answered with a provisional observation: this round then answers as soon as it has a
     * complete one, before its cap.
     */
    readonly provisional?: boolean | undefined
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
    /** Milliseconds available for native clipping observation; 1000 when omitted, as for reads that never scroll. */
    readonly cap?: number
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
     * Whether the round recorded reportable evidence in history. An incomplete stability baseline adds none,
     * even with rendered disabled; an observed blocker or established instability does.
     */
    checked: Schema.Boolean
  }),
  Schema.TaggedStruct("Final", { final: Final }),
  Schema.TaggedStruct("Guarded", { blocked: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("Inserted", { inserted: Schema.Boolean }),
  /** The focused element is the `index`th of the document's frames, in the order a `"iframe, frame"` query finds them. */
  Schema.TaggedStruct("InFrame", { index: Schema.Number }),
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
    changed: Schema.Boolean,
    /**
     * Whether `observed` is provisional: a viewport expectation's one match, before the browser has measured how
     * much of it is in view.
     */
    provisional: Schema.optional(Schema.Boolean)
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
    /** Why the iframe isn't hit at the point given (`Covered` or `NoPointerEvents`), or `null` when it is. */
    covered: Schema.NullOr(NotReady),
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
    if (node.level !== undefined) out += ` [level=${node.level}]`
    // A button's mixed state is its pressed state's; any other node's, its checked state's
    for (const state of node.states) {
      out += state !== "mixed"
        ? ` [${state}]`
        : node.role._tag === "Aria" && node.role.role === "button"
        ? " [pressed=mixed]"
        : " [checked=mixed]"
    }
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
  // Time
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
  const cancelFrame = realTimers?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame.bind(globalThis)
  const now = realTimers?.now ?? performance.now.bind(performance)

  // The DOM
  // Each DOM member the engine reads from an element or a document, taken from its prototype as the engine loads
  // and called on the object, never read through it. A form exposes each named control as a property that wins
  // over the form's own members, so in a form holding `<input name="localName">`, `form.localName` is the input;
  // a document does the same for its named images, forms, embeds, objects and iframes where the engine shares the
  // page's world (`document.activeElement` is `<img name="activeElement">`).
  const call = Reflect.apply
  const getter = <P extends object, K extends keyof P & string>(prototype: P, name: K): (receiver: P) => P[K] => {
    const get = Object.getOwnPropertyDescriptor(prototype, name)!.get!
    return (receiver) => call(get, receiver, [])
  }
  const method = <P extends object, K extends keyof P & string>(prototype: P, name: K) => {
    const member = prototype[name] as (...args: Array<any>) => any
    return (
      receiver: P,
      ...args: P[K] extends (...args: infer A) => any ? A : never
    ): P[K] extends (...args: Array<any>) => infer R ? R : never => call(member, receiver, args)
  }
  const dom = {
    nodeType: getter(Node.prototype, "nodeType"),
    nodeName: getter(Node.prototype, "nodeName"),
    nodeValue: getter(Node.prototype, "nodeValue"),
    parentNode: getter(Node.prototype, "parentNode"),
    parentElement: getter(Node.prototype, "parentElement"),
    childNodes: getter(Node.prototype, "childNodes"),
    textContent: getter(Node.prototype, "textContent"),
    isConnected: getter(Node.prototype, "isConnected"),
    getRootNode: method(Node.prototype, "getRootNode"),
    contains: method(Node.prototype, "contains"),
    localName: getter(Element.prototype, "localName"),
    namespaceURI: getter(Element.prototype, "namespaceURI"),
    id: getter(Element.prototype, "id"),
    classList: getter(Element.prototype, "classList"),
    outerHTML: getter(Element.prototype, "outerHTML"),
    children: getter(Element.prototype, "children"),
    firstElementChild: getter(Element.prototype, "firstElementChild"),
    nextElementSibling: getter(Element.prototype, "nextElementSibling"),
    previousElementSibling: getter(Element.prototype, "previousElementSibling"),
    scrollWidth: getter(Element.prototype, "scrollWidth"),
    scrollHeight: getter(Element.prototype, "scrollHeight"),
    clientWidth: getter(Element.prototype, "clientWidth"),
    clientHeight: getter(Element.prototype, "clientHeight"),
    shadowRoot: getter(Element.prototype, "shadowRoot"),
    assignedSlot: getter(Element.prototype, "assignedSlot"),
    getAttribute: method(Element.prototype, "getAttribute"),
    hasAttribute: method(Element.prototype, "hasAttribute"),
    hasAttributeNS: method(Element.prototype, "hasAttributeNS"),
    getAttributeNames: method(Element.prototype, "getAttributeNames"),
    matches: method(Element.prototype, "matches"),
    closest: method(Element.prototype, "closest"),
    querySelector: method(Element.prototype, "querySelector"),
    querySelectorAll: method(Element.prototype, "querySelectorAll"),
    getBoundingClientRect: method(Element.prototype, "getBoundingClientRect"),
    getClientRects: method(Element.prototype, "getClientRects"),
    checkVisibility: method(Element.prototype, "checkVisibility"),
    scrollIntoView: method(Element.prototype, "scrollIntoView"),
    dispatchEvent: method(EventTarget.prototype, "dispatchEvent"),
    addEventListener: method(EventTarget.prototype, "addEventListener"),
    removeEventListener: method(EventTarget.prototype, "removeEventListener"),
    isContentEditable: getter(HTMLElement.prototype, "isContentEditable"),
    tabIndex: getter(HTMLElement.prototype, "tabIndex"),
    activeElement: getter(Document.prototype, "activeElement"),
    documentElement: getter(Document.prototype, "documentElement"),
    doctype: getter(Document.prototype, "doctype"),
    title: getter(Document.prototype, "title"),
    designMode: getter(Document.prototype, "designMode"),
    execCommand: method(Document.prototype, "execCommand"),
    createRange: method(Document.prototype, "createRange"),
    getElementById: method(Document.prototype, "getElementById"),
    elementFromPoint: method(Document.prototype, "elementFromPoint"),
    elementsFromPoint: method(Document.prototype, "elementsFromPoint"),
    documentFirstElementChild: getter(Document.prototype, "firstElementChild"),
    documentQuerySelectorAll: method(Document.prototype, "querySelectorAll")
  }
  // The labelable elements, each with its own `labels` getter
  const nativeLabels = [
    HTMLButtonElement,
    HTMLInputElement,
    HTMLMeterElement,
    HTMLOutputElement,
    HTMLProgressElement,
    HTMLSelectElement,
    HTMLTextAreaElement
  ].map((type) => [type, Object.getOwnPropertyDescriptor(type.prototype, "labels")!.get!] as const)
  const htmlFocus = HTMLElement.prototype.focus
  const svgFocus = SVGElement.prototype.focus
  const htmlBlur = HTMLElement.prototype.blur
  const svgBlur = SVGElement.prototype.blur
  /** Focuses an HTML or SVG element. */
  const focus = (element: HTMLElement | SVGElement): void =>
    call(element instanceof SVGElement ? svgFocus : htmlFocus, element, [])
  /** An element's own `blur`, or `undefined` for one that has none. */
  const blurOf = (element: Element): (() => void) | undefined => {
    const blur = element instanceof HTMLElement
      ? htmlBlur
      : element instanceof SVGElement
      ? svgBlur
      : "blur" in element && typeof element.blur === "function"
      ? element.blur
      : undefined
    return blur === undefined ? undefined : () => call(blur, element, [])
  }

  // The tree
  const SKIPPED = new Set(["script", "style", "noscript", "template"])

  /**
   * Every element under `root`, in tree order, with each open shadow root's elements after its host. An element
   * root's own open shadow root counts as under it, before its light children.
   */
  const elementsUnder = (root: Document | Element | ShadowRoot): Array<Element> => {
    const out: Array<Element> = []
    const visit = (node: Document | Element | ShadowRoot) => {
      for (
        let child = node instanceof Element
          ? dom.firstElementChild(node)
          : node instanceof Document
          ? dom.documentFirstElementChild(node)
          : node.firstElementChild;
        child !== null;
        child = dom.nextElementSibling(child)
      ) {
        out.push(child)
        const shadow = dom.shadowRoot(child)
        if (shadow !== null) visit(shadow)
        visit(child)
      }
    }
    const shadow = root instanceof Element ? dom.shadowRoot(root) : null
    if (shadow !== null) visit(shadow)
    visit(root)
    return out
  }

  /** The parent in the composed tree: the parent element, or a shadow root's host. */
  const composedParent = (element: Element): Element | null => {
    const parent = dom.parentElement(element)
    if (parent !== null) return parent
    const root = dom.parentNode(element)
    return root instanceof ShadowRoot ? root.host : null
  }

  /**
   * The parent in the flat tree: an assigned node's slot, otherwise its composed parent. Rendering, hit testing and
   * event dispatch follow this tree, where slotted content sits under its slot rather than its host. Hit testing and
   * pointer containment, inertness, and a `display: contents` element's visibility all walk it.
   */
  const flatParent = (element: Element): Element | null => dom.assignedSlot(element) ?? composedParent(element)

  /** Whether `ancestor` contains `node` in the flat tree, which reaches every composed ancestor too. */
  const flatContains = (ancestor: Element, node: Element): boolean => {
    for (let current: Element | null = node; current !== null; current = flatParent(current)) {
      if (current === ancestor) return true
    }
    return false
  }

  /** A node's children in the flat tree: a host's shadow tree, a slot's assigned nodes. */
  const flatChildNodes = (node: Node): Array<Node> => {
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true })
      return assigned.length > 0 ? assigned : Array.from(dom.childNodes(node))
    }
    const shadow = node instanceof Element ? dom.shadowRoot(node) : null
    if (shadow !== null) return Array.from(shadow.childNodes)
    return Array.from(dom.childNodes(node))
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
      if (dom.localName(current) === "head") return true
    }
    return false
  }

  // Text
  const collapse = (text: string): string => text.replace(/\s+/g, " ").trim()
  /**
   * accname's flat string: soft hyphens and zero-width spaces dropped, other whitespace runs collapsed to one space,
   * non-breaking spaces kept, and the ends trimmed.
   */
  const flatString = (text: string): string =>
    text.split("\u00a0").map((chunk) => chunk.replace(/[\u200b\u00ad]/g, "").replace(/\s+/g, " ")).join("\u00a0").trim()

  const buttonLikeInput = (element: Element): element is HTMLInputElement =>
    element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)

  const rawText = new Map<Node, string>()
  const textOfNode = (node: Node): string => {
    if (dom.nodeType(node) === Node.TEXT_NODE) return dom.nodeValue(node) ?? ""
    if (!(node instanceof Element)) return ""
    const cached = rawText.get(node)
    if (cached !== undefined) return cached
    let text = ""
    if (SKIPPED.has(dom.localName(node))) text = ""
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

  // Roles
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

  /**
   * Roles that also take their name from content as a descendant of the target's own content, after w3c/aria#1821,
   * as Chromium and Firefox do. A descendant of another role, such as a nested tree item's group, contributes nothing.
   */
  const NAME_FROM_CONTENT_DESCENDANT = new Set([
    "caption",
    "code",
    "contentinfo",
    "definition",
    "deletion",
    "emphasis",
    "generic",
    "insertion",
    "list",
    "listitem",
    "mark",
    "none",
    "paragraph",
    "presentation",
    "region",
    "row",
    "rowgroup",
    "section",
    "strong",
    "subscript",
    "superscript",
    "table",
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
    (dom.getAttribute(element, "aria-label") ?? "").trim() !== "" || dom.hasAttribute(element, "aria-labelledby") ||
    (dom.getAttribute(element, "title") ?? "").trim() !== ""

  // HTML integer parsing only needs to succeed here: ASCII whitespace, optional sign, then a digit.
  // Trailing text is ignored; Number/trim accept different inputs (notably non-ASCII whitespace).
  const HTML_INTEGER_PREFIX = /^[\t\n\f\r ]*[+-]?[0-9]/
  const DISABLABLE_TAGS = new Set(["button", "fieldset", "input", "optgroup", "option", "select", "textarea"])
  const NATIVE_FOCUSABLE_TAGS = new Set(["button", "details", "select", "textarea"])
  const focusable = (element: Element): boolean => {
    const tag = dom.localName(element)
    // Custom-element definitions live in the main world. A hyphen conservatively includes form-associated hosts.
    // Keep the native selector for these and built-in controls: it includes disabled fieldsets and legend exceptions.
    if ((DISABLABLE_TAGS.has(tag) || tag.includes("-")) && dom.matches(element, ":disabled")) return false
    const tabindex = dom.getAttribute(element, "tabindex")
    return (tabindex !== null && HTML_INTEGER_PREFIX.test(tabindex)) ||
      ((tag === "a" || tag === "area") && dom.hasAttribute(element, "href")) ||
      NATIVE_FOCUSABLE_TAGS.has(tag) ||
      (element instanceof HTMLInputElement && element.type !== "hidden") ||
      (element instanceof HTMLElement && dom.isContentEditable(element))
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
    for (const attribute of dom.getAttributeNames(element)) {
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
    const list = dom.hasAttribute(input, "list")
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
      if (["article", "aside", "main", "nav", "section"].includes(dom.localName(current))) return true
    }
    return false
  }

  /** The implicit role under HTML-AAM, for the elements the engine knows; `null` for none. */
  const implicitRole = (element: Element): string | null => {
    switch (dom.localName(element)) {
      case "a":
      case "area":
        return dom.hasAttribute(element, "href") ? "link" : dom.localName(element) === "a" ? "generic" : null
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
        return dom.getAttribute(element, "alt") === "" && !hasAccessibleNameAttribute(element) ? "presentation" : "img"
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
        const table = dom.closest(element, "table")
        const role = table === null ? undefined : dom.getAttribute(table, "role")
        return role === "grid" || role === "treegrid" ? "gridcell" : "cell"
      }
      case "textarea":
        return "textbox"
      case "th":
        return dom.getAttribute(element, "scope") === "row" ? "rowheader" : "columnheader"
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
    for (const token of (dom.getAttribute(element, "role") ?? "").split(/\s+/)) {
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
        const parents = PRESENTATION_PARENTS.get(dom.localName(element))
        const parent = parents === undefined ? null : composedParent(element)
        if (parent !== null && parents!.includes(dom.localName(parent))) {
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

  // Hidden, visible
  /**
   * Whether a `display: contents` element shows what it holds. It has no box of its own, so it's judged by its
   * computed `visibility` and by its nearest flat-tree ancestor with a box: that one must not be `display: none`,
   * inside one, or skipping its content (`content-visibility: hidden`, or `auto` off screen with
   * `contentVisibilityAuto`). With `opacityProperty`, opacity 0 hides it too: its own, a `display: contents`
   * ancestor's on the way up, or that boxed ancestor's or one above it.
   */
  const contentsShown = (
    element: Element,
    options?: { readonly contentVisibilityAuto?: boolean; readonly opacityProperty?: boolean }
  ): boolean => {
    const opacityProperty = options?.opacityProperty ?? false
    const own = getComputedStyle(element)
    if (own.visibility !== "visible" || (opacityProperty && own.opacity === "0")) return false
    for (let current = flatParent(element); current !== null; current = flatParent(current)) {
      const style = getComputedStyle(current)
      if (style.display === "contents") {
        if (opacityProperty && style.opacity === "0") return false
        continue
      }
      return style.contentVisibility !== "hidden" && dom.checkVisibility(current, {
        contentVisibilityAuto: options?.contentVisibilityAuto ?? false,
        opacityProperty
      })
    }
    return true
  }

  /**
   * Excluded from the accessibility tree: `aria-hidden` on it or a flat-tree ancestor, inert, `display: none` on it or an
   * ancestor, its own `visibility: hidden`, or content an ancestor skips. A `display: contents` element keeps its
   * semantics, so what it holds doesn't decide it.
   */
  const hiddenFromAccessibility = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = flatParent(current)) {
      if (dom.getAttribute(current, "aria-hidden") === "true") return true
    }
    if (inert(element)) return true
    if (getComputedStyle(element).display === "contents") return !contentsShown(element)
    return !dom.checkVisibility(element, { visibilityProperty: true })
  }

  // Inertness
  /** What the document holds that makes anything inert, read once per call, so a page without it walks nothing. */
  let inertness: { readonly attribute: boolean; readonly modal: HTMLDialogElement | null } | undefined
  const inertnessOf = (): { readonly attribute: boolean; readonly modal: HTMLDialogElement | null } => {
    if (inertness !== undefined) return inertness
    let attribute = false
    let modal: HTMLDialogElement | null = null
    for (const element of documentElements()) {
      if (!attribute && dom.hasAttribute(element, "inert")) attribute = true
      if (element instanceof HTMLDialogElement && dom.matches(element, ":modal")) modal = element
    }
    return inertness = { attribute, modal }
  }

  /**
   * The topmost open modal dialog. The DOM exposes no top-layer order, so it is the last open modal dialog in tree
   * order, open shadow roots included: a dialog opened later but earlier in the document is taken for one beneath.
   */
  const topmostModal = (): HTMLDialogElement | null => inertnessOf().modal

  /**
   * The element whose `inert` attribute makes `element` inert, on the flat tree, through slots. The topmost modal
   * dialog doesn't inherit its ancestors' inertness.
   */
  const inertAncestor = (element: Element): Element | null => {
    const { attribute, modal } = inertnessOf()
    if (!attribute) return null
    // Every element on the way shares the answer, so each ancestor is walked once per call
    const path: Array<Element> = []
    let found: Element | null = null
    for (let current: Element | null = element; current !== null; current = flatParent(current)) {
      const known = inertAncestors.get(current)
      if (known !== undefined) {
        found = known
        break
      }
      path.push(current)
      if (dom.hasAttribute(current, "inert")) {
        found = current
        break
      }
      if (current === modal) break
    }
    for (const each of path) inertAncestors.set(each, found)
    return found
  }
  const inertAncestors = new Map<Element, Element | null>()

  /** The topmost modal dialog when `element` is outside it, which makes `element` inert. */
  const blockingModal = (element: Element): HTMLDialogElement | null => {
    const modal = topmostModal()
    if (modal === null) return null
    const path: Array<Element> = []
    let inside = false
    for (let current: Element | null = element; current !== null; current = flatParent(current)) {
      const known = insideModal.get(current)
      if (known !== undefined) {
        inside = known
        break
      }
      path.push(current)
      if (current === modal) {
        inside = true
        break
      }
    }
    for (const each of path) insideModal.set(each, inside)
    return inside ? null : modal
  }
  const insideModal = new Map<Element, boolean>()

  /** The topmost modal dialog's flat-tree ancestors, which it escapes the inertness of. */
  const modalAncestors = (): ReadonlySet<Element> => {
    if (escaped !== undefined) return escaped
    escaped = new Set()
    const modal = topmostModal()
    for (let current = modal && flatParent(modal); current !== null; current = flatParent(current)) {
      escaped.add(current)
    }
    return escaped
  }
  let escaped: Set<Element> | undefined

  /** HTML's inertness: `inert` on the element or a flat-tree ancestor, or outside the topmost open modal dialog. */
  const inert = (element: Element): boolean => inertAncestor(element) !== null || blockingModal(element) !== null

  /** Text that takes up space on the page: non-blank, with a non-empty rect. */
  const renderedText = (node: Text): boolean => {
    if ((dom.nodeValue(node) ?? "").trim() === "") return false
    const range = dom.createRange(document)
    range.selectNodeContents(node)
    return Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)
  }

  /**
   * CONCEPTS.md §8: observations include opacity; action readiness ignores it. A `display: contents` element is
   * rendered when one of its flat-tree children is: an element, or text it shows. A slot among them is judged as an
   * element of its own, so the text it holds is shown or hidden by the slot's style, which that text inherits.
   */
  const rendered = (element: Element, opacityProperty: boolean): boolean => {
    if (getComputedStyle(element).display === "contents") {
      let text = false
      for (const child of flatChildNodes(element)) {
        if (child instanceof Element) {
          if (rendered(child, opacityProperty)) return true
        } else if (child instanceof Text) text ||= renderedText(child)
      }
      return text && contentsShown(element, { contentVisibilityAuto: true, opacityProperty })
    }
    if (!dom.checkVisibility(element, { contentVisibilityAuto: true, opacityProperty, visibilityProperty: true })) {
      return false
    }
    const rect = dom.getBoundingClientRect(element)
    return rect.width > 0 && rect.height > 0
  }

  const visible = (element: Element): boolean => rendered(element, true)

  // Accessible names (accname 1.2)
  interface NameContext {
    readonly visited: Set<Element>
    /** Inside an `aria-labelledby` traversal, so `aria-labelledby` isn't followed again. */
    readonly labelledBy: boolean
    /** The element a reference or label traversal started from was hidden, so its hidden descendants count. */
    readonly hiddenReference: boolean
    /**
     * Where the node is: the target itself, a descendant in the target's own content, or inside a reference
     * (`aria-labelledby`, a label, a legend or a caption), where every descendant counts.
     */
    readonly embedded: "self" | "descendant" | "reference"
    readonly includeHidden: boolean
    readonly contribution: { fieldContent: boolean }
  }

  /** What separates the ids of an ID reference list: ASCII whitespace, so a non-breaking space can be part of an id. */
  const ID_SEPARATOR = /[\t\n\f\r ]+/

  const byId = (element: Element, id: string): Element | null => {
    const root = dom.getRootNode(element)
    return root instanceof Document || root instanceof ShadowRoot
      ? (root instanceof Document ? dom.getElementById(root, id) : root.getElementById(id))
      : null
  }

  const RANGE_ROLES = new Set(["meter", "progressbar", "scrollbar", "slider", "spinbutton"])
  const embeddedControlRole = (role: string | null): boolean =>
    role === "textbox" || role === "searchbox" || role === "combobox" || role === "listbox" || role === "menu" ||
    (role !== null && RANGE_ROLES.has(role))

  /** The elements an element contains or owns through `aria-owns`, in that order. */
  const ownedDescendants = (element: Element): Array<Element> => {
    const out = Array.from(dom.querySelectorAll(element, "*"))
    for (const id of (dom.getAttribute(element, "aria-owns") ?? "").split(ID_SEPARATOR)) {
      const owned = id === "" ? null : byId(element, id)
      if (owned !== null) out.push(owned, ...Array.from(dom.querySelectorAll(owned, "*")))
    }
    return out
  }

  /** What an embedded control contributes to another element's name (accname 2E). */
  const embeddedValue = (element: Element, role: string | null, context: NameContext): string => {
    if (element instanceof HTMLInputElement && element.type === "password") return ""
    if (role !== null && RANGE_ROLES.has(role)) {
      return dom.getAttribute(element, "aria-valuetext") ?? dom.getAttribute(element, "aria-valuenow") ??
        (element instanceof HTMLInputElement ? element.value : dom.getAttribute(element, "value") ?? "")
    }
    if (role === "menu") return ""
    if (role === "combobox" || role === "listbox") {
      if (element instanceof HTMLSelectElement) {
        // A native select gives its chosen options' labels, or its first option's: its own, not a name of theirs
        let chosen = Array.from(element.selectedOptions)
        if (chosen.length === 0 && element.options.length > 0) chosen = [element.options[0]!]
        return chosen.map((option) => {
          const label = dom.getAttribute(option, "label") ?? ""
          return label !== "" ? label : textOf(option)
        }).join(" ")
      }
      const listbox = role === "combobox"
        ? ownedDescendants(element).find((each) => roleOf(each) === "listbox")
        : element
      const selected = listbox === undefined ?
        [] :
        ownedDescendants(listbox).filter((each) =>
          roleOf(each) === "option" && (dom.getAttribute(each, "aria-selected") ?? "").toLowerCase() === "true"
        )
      if (selected.length === 0 && element instanceof HTMLInputElement) return element.value
      // An embedded control is never the target itself, so its options keep the traversal they're in: a
      // reference's every descendant counts, and the target's own content keeps the descendant role rule
      return selected.map((option) => nameOfElement(option, context)).join(" ")
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
    return dom.textContent(element) ?? ""
  }

  const labelsOf = (element: Element): Array<HTMLLabelElement> => {
    const labels = nativeLabels.find(([type]) => element instanceof type)
    const list = labels === undefined ? null : call(labels[1], element, []) as NodeListOf<HTMLLabelElement> | null
    return list === null ? [] : Array.from(list)
  }

  /**
   * The text a computed CSS `content` value gives: its alternative text after `/` when there is one, otherwise its
   * strings and `attr()` values joined. Anything else, such as `url()` or `counter()`, gives `undefined`, and so
   * does any value on the element itself without alternative text.
   */
  const parseCssContent = (element: Element, value: string, pseudo: boolean): string | undefined => {
    type Token = { readonly kind: "string" | "attr" | "slash" | "other"; readonly value: string }
    const tokens: Array<Token> = []
    // Skips a quoted string from its opening quote, returning its value and the index after it.
    const string = (from: number): [string, number] => {
      const quote = value[from]
      let out = ""
      let i = from + 1
      while (i < value.length && value[i] !== quote) {
        if (value[i] === "\\") {
          const hex = /^[0-9a-fA-F]{1,6}[ \t\n]?/.exec(value.slice(i + 1))
          if (hex !== null) {
            out += String.fromCodePoint(Number.parseInt(hex[0].trim(), 16))
            i += 1 + hex[0].length
          } else {
            out += value[i + 1] ?? ""
            i += 2
          }
          continue
        }
        out += value[i]
        i++
      }
      return [out, i + 1]
    }
    let i = 0
    while (i < value.length) {
      const c = value[i]!
      if (/\s/.test(c)) {
        i++
      } else if (c === "\"" || c === "'") {
        const [text, next] = string(i)
        tokens.push({ kind: "string", value: text })
        i = next
      } else if (c === "/") {
        tokens.push({ kind: "slash", value: c })
        i++
      } else {
        const attr = /^attr\(\s*([-\w]+)\s*\)/i.exec(value.slice(i))
        if (attr !== null) {
          tokens.push({ kind: "attr", value: attr[1]! })
          i += attr[0].length
          continue
        }
        // Another value, such as url(…) or counter(…): up to the next space or slash outside parentheses
        let depth = 0
        while (i < value.length && (depth > 0 || !/[\s/]/.test(value[i]!))) {
          if (value[i] === "\"" || value[i] === "'") {
            i = string(i)[1]
            continue
          }
          if (value[i] === "(") depth++
          else if (value[i] === ")") depth--
          i++
        }
        tokens.push({ kind: "other", value: "" })
      }
    }
    const slash = tokens.findIndex((token) => token.kind === "slash")
    if (slash === -1 && !pseudo) return undefined
    const parts = slash === -1 ? tokens : tokens.slice(slash + 1)
    let out = ""
    for (const token of parts) {
      if (token.kind === "string") out += token.value
      else if (token.kind === "attr") out += dom.getAttribute(element, token.value) ?? ""
      else return undefined
    }
    return out
  }

  /**
   * The CSS content an element or one of its pseudo-elements contributes to a name, or `undefined` for none. A
   * `display: none` or `visibility: hidden` pseudo-element contributes nothing, and one that isn't inline is
   * separated by spaces.
   */
  const cssContent = (element: Element, pseudo?: "::before" | "::after"): string | undefined => {
    const style = getComputedStyle(element, pseudo)
    const value = style.content
    if (value === "" || value === "none" || value === "normal") return undefined
    if (style.display === "none" || style.visibility === "hidden") return undefined
    const content = parseCssContent(element, value, pseudo !== undefined)
    if (content === undefined || pseudo === undefined) return content
    return style.display === "inline" || style.display === "" ? content : ` ${content} `
  }

  const nameOfNode = (node: Node, context: NameContext): string => {
    if (dom.nodeType(node) === Node.TEXT_NODE) {
      const value = dom.nodeValue(node) ?? ""
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
    // 2A: hidden, unless asked for or in a traversal from a hidden reference
    if (!context.includeHidden && !context.hiddenReference && hiddenFromAccessibility(element)) {
      context.visited.add(element)
      return ""
    }
    // 2B: aria-labelledby, not followed twice
    if (!context.labelledBy) {
      const ids = (dom.getAttribute(element, "aria-labelledby") ?? "").split(ID_SEPARATOR).filter((id) => id !== "")
      const parts = ids.flatMap((id) => {
        const target = byId(element, id)
        return target === null ? [] : [
          nameOfElement(target, {
            ...context,
            labelledBy: true,
            hiddenReference: hiddenFromAccessibility(target),
            embedded: "reference"
          })
        ]
      })
      const joined = parts.join(" ")
      if (joined.trim() !== "") return joined
    }
    // Marked only now, so an element whose aria-labelledby names itself still reaches its own aria-label
    context.visited.add(element)
    const role = roleOf(element)
    // 2E: an embedded control inside another element's name contributes its value, unless it names itself
    const id = dom.id(element)
    const namesItself = id !== "" &&
      (dom.getAttribute(element, "aria-labelledby") ?? "").split(ID_SEPARATOR).includes(id)
    if (context.embedded !== "self" && !namesItself && embeddedControlRole(role)) {
      const value = embeddedValue(element, role, context)
      if (value.trim() !== "") context.contribution.fieldContent = true
      return value
    }
    // 2C: aria-label
    const label = dom.getAttribute(element, "aria-label") ?? ""
    if (label.trim() !== "") return label
    // 2D: the host language's label
    if (role !== "none" && role !== "presentation") {
      const native = nativeName(element, context)
      if (native.trim() !== "") return native
    }
    // 2F: name from content. In the target's own content, only a descendant whose role allows it.
    const fromContent = context.embedded === "reference" ||
      (role !== null && NAME_FROM_CONTENT.has(role)) ||
      (context.embedded === "descendant" && (role === null || NAME_FROM_CONTENT_DESCENDANT.has(role)))
    if (fromContent) {
      const child: NameContext = context.embedded === "self" ? { ...context, embedded: "descendant" } : context
      let content = cssContent(element, "::before") ?? ""
      const own = cssContent(element)
      if (own !== undefined) {
        // Content on the element itself replaces its children.
        content += own
      } else {
        for (const node of flatChildNodes(element)) {
          if (node instanceof Element && SKIPPED.has(dom.localName(node))) continue
          const name = nameOfNode(node, child)
          // Only an inline child runs into its neighbours; <br> always separates.
          const inline = !(node instanceof Element) ||
            (getComputedStyle(node).display === "inline" && dom.localName(node) !== "br")
          content += inline ? name : ` ${name} `
        }
        // Elements it owns through aria-owns follow its children
        for (const owned of (dom.getAttribute(element, "aria-owns") ?? "").split(ID_SEPARATOR)) {
          const target = owned === "" ? null : byId(element, owned)
          if (target === null) continue
          const name = nameOfElement(target, child)
          content += getComputedStyle(target).display === "inline" ? name : ` ${name} `
        }
      }
      content += cssContent(element, "::after") ?? ""
      // Only the target's own name is trimmed: a descendant's whitespace separates its neighbours.
      if (context.embedded === "self" ? content.trim() !== "" : content !== "") {
        if (provenance && context.embedded === "self") namesFromContent.add(element)
        if (inField(element) && content.trim() !== "") context.contribution.fieldContent = true
        return content
      }
    }
    // 2I: the tooltip, except on a presentational element, then a placeholder (HTML-AAM)
    const title = role === "none" || role === "presentation" ? "" : dom.getAttribute(element, "title") ?? ""
    if (title.trim() !== "") return title
    const placeholder = dom.getAttribute(element, "placeholder") ?? ""
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && placeholder.trim() !== "") {
      return placeholder
    }
    return ""
  }

  /** The context for a native label, legend or caption: a reference, hidden if it or an enclosing one is. */
  const reference = (context: NameContext, element: Element): NameContext => ({
    ...context,
    hiddenReference: context.hiddenReference || hiddenFromAccessibility(element),
    embedded: "reference"
  })

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
      return labels.map((label) => nameOfElement(label, reference(context, label))).join(" ")
    }
    if (element instanceof HTMLImageElement || element instanceof HTMLAreaElement) {
      const alt = dom.getAttribute(element, "alt") ?? ""
      if (alt.trim() !== "" && inField(element)) context.contribution.fieldContent = true
      return alt
    }
    const first = (selector: string) => Array.from(dom.children(element)).find((child) => dom.matches(child, selector))
    if (element instanceof HTMLFieldSetElement) {
      const legend = first("legend")
      return legend === undefined ? "" : nameOfElement(legend, reference(context, legend))
    }
    if (element instanceof HTMLTableElement) {
      const caption = first("caption")
      return caption === undefined ? "" : nameOfElement(caption, reference(context, caption))
    }
    if (dom.localName(element) === "figure") {
      const caption = first("figcaption")
      return caption === undefined ? "" : nameOfElement(caption, reference(context, caption))
    }
    if (element instanceof SVGSVGElement) {
      const title = first("title")
      if (title === undefined) return ""
      if (textContainsField(title)) context.contribution.fieldContent = true
      return dom.textContent(title) ?? ""
    }
    return ""
  }

  let provenance = false
  const namesFromFields = new Set<Element>()
  const namesFromContent = new Set<Element>()
  const nameCache = new Map<Element, string>()
  const hiddenNameCache = new Map<Element, string>()
  /** An element's accessible name, as a flat string. With `includeHidden`, hidden descendants count too. */
  const accessibleName = (element: Element, includeHidden: boolean): string => {
    const cache = includeHidden ? hiddenNameCache : nameCache
    const cached = cache.get(element)
    if (cached !== undefined) return cached
    const contribution = { fieldContent: false }
    const role = roleOf(element)
    // This restriction is on the root, not on descendants or references contributing to another element's name.
    const name = role !== null && NAME_PROHIBITED.has(role) ? "" : flatString(
      nameOfElement(element, {
        visited: new Set(),
        labelledBy: false,
        hiddenReference: false,
        embedded: "self",
        includeHidden,
        contribution
      })
    )
    if (provenance && contribution.fieldContent) namesFromFields.add(element)
    cache.set(element, name)
    return name
  }

  // Queries
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

  // Refs
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
    if (element === undefined || !dom.isConnected(element)) return stale("Detached")
    return element
  }

  const labelable = (element: Element): boolean =>
    (element instanceof HTMLInputElement && element.type !== "hidden") || element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement ||
    element instanceof HTMLMeterElement || element instanceof HTMLOutputElement ||
    element instanceof HTMLProgressElement

  const labelTexts = (element: Element): Array<string> => {
    const texts: Array<string> = []
    for (
      const id of (dom.getAttribute(element, "aria-labelledby") ?? "").split(ID_SEPARATOR).filter((id) => id !== "")
    ) {
      const target = byId(element, id)
      if (target !== null) texts.push(textOf(target))
    }
    const label = dom.getAttribute(element, "aria-label")
    if (label !== null) texts.push(collapse(label))
    for (const each of labelsOf(element)) texts.push(textOf(each))
    return texts
  }

  const attributeMatches = (element: Element, attribute: string, matcher: TextMatcher): boolean => {
    const value = dom.getAttribute(element, attribute)
    return value !== null && matches(matcher, collapse(value))
  }

  /**
   * The whole document's elements, open shadow roots included, walked once per readiness check: `checkAction`
   * opens a scope its queries and its dialog search share, and closes it when it returns, or before it runs page
   * code such as a focus handler, so no walk outlives the synchronous check or a change the page made. Outside a
   * scope each call walks the document again.
   */
  let treeScope: { elements?: Array<Element> } | null = null
  const documentElements = (): Array<Element> =>
    treeScope === null ? elementsUnder(document) : (treeScope.elements ??= elementsUnder(document))

  /** The candidates of one query under `scope`, in tree order. */
  const query = (scope: Document | Element, step: Step): Array<Element> => {
    const under = scope === document ? documentElements() : elementsUnder(scope)
    switch (step._tag) {
      case "Css": {
        const roots: Array<Document | Element | ShadowRoot> = [scope]
        const shadow = scope instanceof Element ? dom.shadowRoot(scope) : null
        if (shadow !== null) roots.push(shadow)
        for (const element of under) {
          const shadow = dom.shadowRoot(element)
          if (shadow !== null) roots.push(shadow)
        }
        const found = new Set<Element>()
        for (const root of roots) {
          try {
            const all = root instanceof Document
              ? dom.documentQuerySelectorAll(root, step.selector)
              : root instanceof Element
              ? dom.querySelectorAll(root, step.selector)
              : root.querySelectorAll(step.selector)
            for (const element of Array.from(all)) found.add(element)
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
        // A slot is transparent here as in the flat tree: what it renders, its assigned nodes or its fallback
        // content, is its parent's text, so the slot itself is never the smallest element that says it. An
        // element scope is a candidate itself, ahead of its descendants: the text it says may be its own.
        const candidates = (scope instanceof Element ? [scope, ...under] : under).filter((element) =>
          !(element instanceof HTMLSlotElement) && !inHead(element) && !SKIPPED.has(dom.localName(element))
        )
        const says = (element: Element) => matches(step.matcher, textOf(element))
        return candidates.filter((element) => says(element) && !flatChildElements(element).some(says))
      }
      case "Role":
        return under.filter((element) =>
          roleOf(element) === step.role && (step.includeHidden || !hiddenFromAccessibility(element)) &&
          (step.name === null || matches(step.name, collapse(accessibleName(element, step.includeHidden)))) &&
          (step.level === undefined || levelOf(element) === step.level) &&
          (step.checked === undefined || checkedState(element).state === step.checked) &&
          (step.pressed === undefined || pressedOf(element) === step.pressed) &&
          (step.expanded === undefined || expandedOf(element) === step.expanded) &&
          (step.selected === undefined || selectedOf(element) === step.selected) &&
          (step.disabled === undefined || disabledOf(element) === step.disabled)
        )
      case "Label":
        return under.filter((element) =>
          (labelable(element) || dom.hasAttribute(element, "aria-label") ||
            dom.hasAttribute(element, "aria-labelledby")) &&
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
        return under.filter((element) => dom.getAttribute(element, "data-testid") === step.id)
      default:
        return []
    }
  }

  const treeOrder = (elements: Iterable<Element>): Array<Element> => {
    const set = new Set(elements)
    return documentElements().filter((element) => set.has(element))
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

  // Actionability
  /** An element's text for a description: as `textOf`, but with no field's content, which may be private. */
  const describedText = (node: Node): string =>
    dom.nodeType(node) === Node.TEXT_NODE
      ? dom.nodeValue(node) ?? ""
      : !(node instanceof Element) || SKIPPED.has(dom.localName(node)) || fieldOf(node)
      ? ""
      : buttonLikeInput(node)
      ? node.value
      : flatChildNodes(node).map(describedText).join("")

  /**
   * A short description of an element for errors: `button#buy.primary "Add to cart"`. Its text leaves out what a
   * field holds, such as a textarea's or an editable element's content, whatever the capture policy: a field, or
   * an element inside one, is described with no text.
   */
  const describe = (element: Element): string => {
    let out = dom.localName(element)
    if (dom.id(element) !== "") out += `#${dom.id(element)}`
    for (const name of Array.from(dom.classList(element)).slice(0, 2)) out += `.${name}`
    const text = withinField(element) ? "" : collapse(describedText(element))
    if (text !== "") out += ` "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`
    return out
  }

  /** `aria-disabled` on the element or a flat-tree ancestor, so a slotted element inherits its slot's. */
  const ariaDisabled = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = flatParent(current)) {
      if (dom.getAttribute(current, "aria-disabled") === "true") return true
    }
    return false
  }

  const enabled = (element: Element): boolean => {
    if (dom.matches(element, ":disabled")) return false
    return !ariaDisabled(element)
  }

  const disabledOf = (element: Element): boolean => {
    if (ariaDisabled(element)) return true
    const native = element instanceof HTMLButtonElement || element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ||
      element instanceof HTMLOptionElement || element instanceof HTMLOptGroupElement ||
      element instanceof HTMLFieldSetElement
    if (!native) return false
    if (dom.hasAttribute(element, "disabled")) return true
    if (element instanceof HTMLOptionElement && dom.closest(element, "optgroup[disabled]") !== null) return true
    // Role filters use explicit native rules: :disabled differs between browsers for options and optgroups.
    const fieldset = dom.closest(element, "fieldset[disabled]")
    if (fieldset === null) return false
    const legend = Array.from(dom.children(fieldset)).find((child) => child instanceof HTMLLegendElement)
    return legend === undefined || !dom.contains(legend, element)
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
    element instanceof HTMLElement && dom.isContentEditable(element)

  /** Whether an element's kind takes input at all, whatever its state. */
  const editableKind = (element: Element): boolean => typed(element) || settable(element) || contentEditable(element)

  /** The Editable predicate: enabled, not read-only, and an editable kind (CONCEPTS.md §8). */
  const readOnly = (element: Element): boolean =>
    ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) ||
    dom.getAttribute(element, "aria-readonly") === "true"

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
    const token = dom.getAttribute(element, "aria-checked")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
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
    if (/^h[1-6]$/.test(dom.localName(element))) return Number(dom.localName(element).slice(1))
    if (!LEVEL_ROLES.has(roleOf(element) ?? "")) return 0
    const value = Number(dom.getAttribute(element, "aria-level"))
    return Number.isInteger(value) && value >= 1 ? value : 0
  }

  const pressedOf = (element: Element): boolean | "mixed" => {
    if (!PRESSED_ROLES.has(roleOf(element) ?? "")) return false
    const value = dom.getAttribute(element, "aria-pressed")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    return value === "mixed" ? "mixed" : value === "true"
  }

  const expandedOf = (element: Element): boolean | undefined => {
    if (element instanceof HTMLDetailsElement) return element.open
    if (!EXPANDED_ROLES.has(roleOf(element) ?? "")) return undefined
    const value = dom.getAttribute(element, "aria-expanded")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    return value === undefined ? undefined : value === "true"
  }

  const selectedOf = (element: Element): boolean => {
    if (element instanceof HTMLOptionElement) return element.selected
    return SELECTED_ROLES.has(roleOf(element) ?? "") &&
      dom.getAttribute(element, "aria-selected")?.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) === "true"
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
    return dom.matches(
      element,
      "button, input, select, textarea, details, summary, iframe, frame, embed, object, a[href], area[href], img[usemap], audio[controls], video[controls]"
    ) || (
      dom.namespaceURI(element) === "http://www.w3.org/2000/svg" && dom.localName(element) === "a" &&
      dom.hasAttributeNS(element, "http://www.w3.org/1999/xlink", "href")
    ) || contentEditable(element) || (role !== null && LABEL_WIDGET_ROLES.has(role))
  }

  const enclosingLabel = (element: Element): HTMLLabelElement | null => {
    let label: Element | null = element
    while (label !== null && !(label instanceof HTMLLabelElement)) label = dom.parentElement(label)
    return label
  }

  const CONTROL = "button, [role=button], [role=checkbox], [role=radio]"

  const standsForItself = (element: Element): boolean =>
    dom.matches(element, "input, textarea, select") || contentEditable(element)

  // Selection takes the text of the control an element is in, found among its DOM ancestors. Fields and editable
  // content stand for themselves.
  const enclosingControl = (element: Element): Element =>
    standsForItself(element) ? element : dom.closest(element, CONTROL) ?? element

  // The browser delivers no click to a disabled button's subtree on the flat tree, so Enabled climbs it: through
  // assigned slots and out of shadow roots. Fields and editable content stand for themselves.
  const flatEnclosingControl = (element: Element): Element => {
    if (standsForItself(element)) return element
    for (
      let current: Element | null = element;
      current !== null;
      current = dom.assignedSlot(current) ?? composedParent(current)
    ) {
      if (dom.matches(current, CONTROL)) return current
    }
    return element
  }

  // Enabled as a user sees it: an element is enabled only when it and its enclosing control both are, so a span inside
  // a disabled button is disabled, and a disabled option stays disabled whatever encloses its select
  const enabledControl = (element: Element): boolean => enabled(element) && enabled(flatEnclosingControl(element))

  const textSelectionTarget = (element: Element): Element => {
    let target = enclosingControl(element)
    if (
      !dom.matches(
        target,
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
      ancestor = dom.parentElement(ancestor)
    ) {
      if (interactiveLabelDescendant(ancestor)) return null
    }
    for (
      let ancestor: Element | null = element;
      ancestor !== null && ancestor !== label;
      ancestor = flatParent(ancestor)
    ) {
      if (interactiveLabelDescendant(ancestor)) return null
    }
    return checkedOf(label.control) === null ? null : label.control
  }

  /** The element with focus, through open shadow roots. */
  const deepActive = (): Element | null => {
    let active: Element | null = dom.activeElement(document)
    for (let shadow = active === null ? null : dom.shadowRoot(active); shadow?.activeElement;) {
      active = shadow.activeElement
      shadow = dom.shadowRoot(active)
    }
    return active
  }

  const valueOf = (element: Element): string | null =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
      ? element.value
      : null

  /**
   * The element that must receive the pointer for an action on `element`: its nearest enclosing button or link in
   * the flat tree, through shadow roots and slots, itself included, since the browser hands a click on a
   * pointer-events: none descendant to it. A form field or an editable element must receive the pointer itself.
   */
  const pointerRecipient = (element: Element): Element => {
    if (
      dom.matches(element, "input, textarea, select") ||
      (element instanceof HTMLElement && dom.isContentEditable(element))
    ) return element
    for (let current: Element | null = element; current !== null; current = flatParent(current)) {
      if (dom.matches(current, "button, [role=button], a, [role=link]")) return current
    }
    return element
  }

  const missed = (element: Element, hit: Element | null): NotReady =>
    getComputedStyle(element).pointerEvents === "none"
      ? { _tag: "NoPointerEvents", element: describe(element) }
      : { _tag: "Covered", by: hit === null ? "nothing at that point" : describe(hit) }

  const inertReason = (element: Element): NotReady | null => {
    const by = inertAncestor(element)
    const modal = blockingModal(element)
    if (by !== null) {
      // The dialog to name: the topmost modal one, or a rendered `aria-modal` dialog outside the target that isn't
      // inert itself, in shadow roots too
      const dialog = modal ??
        documentElements().find((d) =>
          dom.matches(d, "[role=dialog][aria-modal=true],[role=alertdialog][aria-modal=true]") &&
          !flatContains(d, element) && inertAncestor(d) === null && visible(d)
        )
      return { _tag: "Inert", by: describe(by), dialog: dialog && describe(dialog) }
    }
    return modal !== null ? { _tag: "BlockedByModal", dialog: describe(modal) } : null
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
    for (const rect of dom.getClientRects(element)) {
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

  /** Paint-stack membership ignores overlays without mistaking their coverage for clipping. */
  const exposedFragment = (element: Element, clip?: Clip): boolean => {
    for (const rect of fragments(element, clip)) {
      const x = fragmentCenter(rect.left, rect.right)
      const y = fragmentCenter(rect.top, rect.bottom)
      const roots: Array<Document | ShadowRoot> = [document]
      const seen = new Set<Document | ShadowRoot>()
      while (roots.length > 0) {
        const root = roots.pop()!
        if (seen.has(root)) continue
        seen.add(root)
        for (const hit of root instanceof Document ? dom.elementsFromPoint(root, x, y) : root.elementsFromPoint(x, y)) {
          if (flatContains(element, hit)) return true
          const shadow = dom.shadowRoot(hit)
          if (shadow !== null) roots.push(shadow)
        }
      }
    }
    return false
  }

  /** Compare native intersections with only scrollport clipping expanded; other clipping stays in force. */
  /** `onCancel` receives a function that disconnects the observers and clears the timer at once, answering no evidence. */
  const clippedByScroller = (
    element: Element,
    timeout: number,
    clip?: Clip,
    onCancel?: (cancel: () => void) => void
  ): Promise<boolean | null> | null => {
    let margin = 0
    for (let ancestor = flatParent(element); ancestor !== null; ancestor = flatParent(ancestor)) {
      const style = getComputedStyle(ancestor)
      if (
        (/^(auto|scroll|hidden)$/.test(style.overflowX) && dom.scrollWidth(ancestor) > dom.clientWidth(ancestor)) ||
        (/^(auto|scroll|hidden)$/.test(style.overflowY) && dom.scrollHeight(ancestor) > dom.clientHeight(ancestor))
      ) {
        const rect = dom.getBoundingClientRect(ancestor)
        margin += dom.scrollWidth(ancestor) + dom.scrollHeight(ancestor) + Math.abs(rect.left) + Math.abs(rect.top) +
          rect.width + rect.height
      }
    }
    if (margin === 0 || exposedFragment(element, clip)) return null
    return new Promise((resume) => {
      const observers: Array<IntersectionObserver> = []
      const values: Array<boolean | undefined> = []
      const finish = (value: boolean | null) => {
        clearTimer(timer)
        for (const observer of observers) observer.disconnect()
        resume(value)
      }
      const timer = setTimer(() => finish(null), Math.max(0, timeout))
      onCancel?.(() => finish(null))
      for (const expanded of [false, true]) {
        const observer = new IntersectionObserver(([entry]) => {
          if (entry === undefined) return
          const present = entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
          values[expanded ? 1 : 0] = present
          if (values[0] === true || values[1] === false) finish(false)
          else if (values[0] === false && values[1] === true) finish(true)
        }, { scrollMargin: expanded ? `${margin}px` : "0px" })
        observers.push(observer)
        observer.observe(element)
      }
    })
  }

  /** Oversized unions can have their centre in a gap between fragments; align an edge in that case. */
  const scrollToFragments = (element: Element, inherited?: Clip) => {
    const rect = dom.getBoundingClientRect(element)
    const bounds = viewportBounds(inherited)
    dom.scrollIntoView(element, {
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

  /**
   * Probe centres only when requested; retain the first geometric point for a `Covered` or `NoPointerEvents` result
   * if none reaches.
   */
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
        if (hit !== null && flatContains(pointerRecipient(element), hit)) {
          if (clip === undefined) return [point]
          points.push(point)
        }
      }
      return points.length > 0 ? points : first === null ? [] : [first]
    }
    const rect = dom.getBoundingClientRect(element)
    const style = getComputedStyle(element)
    return [{
      x: rect.left + parseFloat(style.borderLeftWidth) + position.x,
      y: rect.top + parseFloat(style.borderTopWidth) + position.y
    }]
  }

  /**
   * What the pointer would hit at a point, through open shadow roots. Each root's answer counts only when it belongs
   * to that root. A root can answer with its own host or an enclosing one, for slotted text, whose DOM parent is a
   * host (Chromium does), or for the host's own box or pseudo-element covering its contents. The topmost element of
   * the root's paint stack then decides: the hit descends to it when it belongs to the root, and otherwise stops at
   * the host, which covers. Each step descends into a deeper root, so the walk ends.
   */
  const hitTarget = (x: number, y: number): Element | null => {
    let hit = dom.elementFromPoint(document, x, y)
    let shadow: ShadowRoot | null
    while (hit !== null && (shadow = dom.shadowRoot(hit)) !== null) {
      const root = shadow
      const answer = root.elementFromPoint(x, y)
      const inner = answer !== null && dom.getRootNode(answer) === root ? answer : root.elementsFromPoint(x, y)[0]
      if (inner === undefined || dom.getRootNode(inner) !== root) break
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
    dom.dispatchEvent(element, new Event(type, { bubbles: true, composed: type === "input" }))

  /** Focuses an element and selects its contents, so text inserted next replaces them. */
  const selectContents = (element: HTMLElement) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus()
      element.select()
      return
    }
    if (dom.designMode(document) === "on") {
      window.focus()
    } else {
      let host = element
      for (
        let parent = dom.parentElement(host);
        parent instanceof HTMLElement && dom.isContentEditable(parent);
        parent = dom.parentElement(host)
      ) host = parent
      focus(host)
    }
    const selection = getSelection()
    if (selection === null) return
    const range = dom.createRange(document)
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const optionMatches = (option: HTMLOptionElement, index: number, choice: Choice) =>
    choice.value !== undefined ? option.value === choice.value : choice.label !== undefined
      ? option.label === choice.label || collapse(dom.textContent(option) ?? "") === choice.label
      : index === choice.index

  const describeChoice = (choice: Choice) =>
    choice.value !== undefined ? `value ${JSON.stringify(choice.value)}` : choice.label !== undefined
      ? `label ${JSON.stringify(choice.label)}`
      : `index ${choice.index}`

  // The guard on the first trusted event
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

  /** Arms a guard on `element`, the pointer's recipient: the gesture's first trusted event must land in it, or the gesture is stopped. */
  const arm = (element: Element) => {
    disarm()
    let decided = false
    const handler = (event: Event) => {
      if (!event.isTrusted || current === null) return
      if (!decided) {
        decided = true
        const target = event.composedPath()[0]
        if (!(target instanceof Element) || !flatContains(element, target)) {
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
  // form control after selection, so validate at the cancellable native event, before its default mutation, or,
  // where the engine inserts the text itself, at the insertion, before it dispatches anything (`insert`).
  let fillGuard: {
    remove: () => void
    blocked: string | null
    unsafe: boolean
    accepted: boolean
    inserting: boolean
    check: () => string | null
  } | null = null
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
      inserting: false,
      // At an insertion the engine makes itself: an ancestor's focus must still be on the guarded frame, as the
      // trusted events a native insertion sends would show it
      check: (): string | null => {
        if (!ancestor) return blocker()
        const active = deepActive()
        return active === element ? null : active === null ? "another document" : describe(active)
      }
    }
    const blocker = (): string | null => {
      // Ancestors should receive no insertion event: correct input reaches the target document instead.
      if (ancestor) return null
      const active = deepActive()
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return describe(active)
      const selection = getSelection()
      if (element === null || !dom.isConnected(element) || selection?.rangeCount !== 1) {
        return "the selection left the target"
      }
      const selected = selection.getRangeAt(0)
      if (
        current.inserting && dom.contains(element, selected.startContainer) &&
        dom.contains(element, selected.endContainer)
      ) {
        return null
      }
      // WebKit canonicalizes element-edge ranges to text-node edges. Ascend equivalent edges rather
      // than treating those native representations as different selections.
      const atEdge = (node: Node, offset: number, end: boolean): boolean => {
        while (node !== element) {
          const length = node instanceof CharacterData ? node.length : dom.childNodes(node).length
          const parent = dom.parentNode(node)
          if (offset !== (end ? length : 0) || parent === null) return false
          offset = Array.prototype.indexOf.call(dom.childNodes(parent), node) + (end ? 1 : 0)
          node = parent
        }
        return offset === (end ? dom.childNodes(element).length : 0)
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
            !flatContains(recipient, element) && !flatContains(element, recipient)
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
          focus(element)
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

  /**
   * Inserts text where the focus is, with the document's editing command, which sends no key events: the
   * engine's own `execCommand`, taken from `Document.prototype` at install, so a page's replacement isn't called.
   * Where the browser's command dispatches no `beforeinput` (Firefox), `beforeInput` dispatches it first, as the
   * other browsers do, and a page that cancels it gets nothing inserted. An armed fill guard checks the target here,
   * before anything is dispatched.
   */
  const insert = (text: string, beforeInput: boolean): Response => {
    const active = deepActive()
    const guard = fillGuard
    // An armed guard, in an ancestor document too, decides before anything goes further or is dispatched
    const blocked = (): boolean => {
      if (guard === null) return false
      guard.blocked ??= guard.check()
      return guard.blocked !== null
    }
    if (blocked()) return { _tag: "Inserted", inserted: false }
    if (active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) {
      return { _tag: "InFrame", index: resolve([{ _tag: "Css", selector: "iframe, frame" }]).indexOf(active) }
    }
    if (beforeInput && active !== null) {
      const event = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: text,
        bubbles: true,
        cancelable: true,
        composed: true
      })
      if (!dom.dispatchEvent(active, event)) return { _tag: "Inserted", inserted: false }
      // Its handlers may have moved the focus or the selection
      if (blocked()) return { _tag: "Inserted", inserted: false }
    }
    if (guard !== null) {
      guard.accepted = true
      guard.inserting = true
    }
    return { _tag: "Inserted", inserted: dom.execCommand(document, "insertText", false, text) }
  }

  // Actions
  let stabilitySequence = 0
  let stability: {
    readonly token: string
    readonly element: Element
    readonly rect: DOMRect
    readonly frames: number
  } | null = null

  /** State shared by ordinary and opted-in rounds; no continuation exists on the ordinary path. */
  const createAction = (request: Extract<Request, { op: "act" }>) => {
    const previous = stability !== null && request.stability === stability.token ? stability : null
    stability = null
    return {
      previous,
      end: now() + request.cap,
      history: [] as Array<NotReady>,
      seen: new Set<string>(),
      last: { _tag: "NoMatch" } as NotReady,
      scrolled: false,
      frames: 0,
      sampled: false,
      tracked: null as Element | null,
      rects: [] as Array<DOMRect>,
      /** Set once the owner stops the action; a pending clipping observation then never continues. */
      stopped: false,
      cancelObservation: undefined as (() => void) | undefined
    }
  }
  type ActionState = ReturnType<typeof createAction>
  const noteAction = (state: ActionState, reason: NotReady) => {
    const key = JSON.stringify(reason)
    if (!state.seen.has(key)) {
      state.seen.add(key)
      state.history.push(reason)
    }
    state.last = reason
  }
  const actionTimeout = (_request: Extract<Request, { op: "act" }>, state: ActionState): Response => ({
    _tag: "NotReady",
    reason: state.last,
    history: state.history,
    scrolled: state.scrolled,
    // Sampling a stability baseline is progress, not failure evidence. Only noteAction records evidence.
    checked: state.history.length > 0
  })

  const actionFrameTimeout = (request: Extract<Request, { op: "act" }>, state: ActionState): Response => {
    if (request.checks.rendered && state.frames === 0 && request.cap >= 100) {
      noteAction(state, { _tag: "NoRenderingOpportunity" })
    }
    return actionTimeout(request, state)
  }

  /** Resolves fresh DOM and runs exactly one readiness/application check. */
  const checkAction = (
    request: Extract<Request, { op: "act" }>,
    state: ActionState
  ): Response | undefined | Promise<Response | undefined> => {
    treeScope = {}
    try {
      return checkActionIn(request, state)
    } finally {
      treeScope = null
    }
  }

  const checkActionIn = (
    request: Extract<Request, { op: "act" }>,
    state: ActionState
  ): Response | undefined | Promise<Response | undefined> => {
    const action = request.action
    clearTreeCaches()
    const found = resolve(request.steps)
    if (found.length > 1) return strict(found)
    const element = found[0]
    if (element !== state.tracked) {
      state.tracked = element ?? null
      state.rects = []
    }
    // Observation is asynchronous only when a clipping check is needed: a synchronous caller sees no extra turn.
    const observation = element !== undefined && request.checks.inViewport &&
        visibleFragment(element, request.clip) !== null
      ? clippedByScroller(element, state.end - now(), request.clip, (cancel) => {
        state.cancelObservation = cancel
      })
      : null
    const proceed = (clipped: boolean): Response | undefined => {
      // What no waiting mends fails at once
      if (element !== undefined) {
        if (request.checks.editable && !editableKind(element)) {
          return { _tag: "Final", final: { _tag: "NotEditable", element: describe(element) } }
        }
        if (
          (action._tag === "Checked" && checkedOf(element) === null) ||
          (action._tag === "Point" && action.checked === true && checkableForAction(element) === null)
        ) {
          return {
            _tag: "Final",
            final: {
              _tag: "WrongElement",
              expected: "a checkbox, a radio, or an ARIA checkable",
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
      const evidence = state.previous
      state.previous = null
      let reason: NotReady | null = null
      // Computed once: its dialog search may walk the whole document
      let inert: NotReady | null = null
      if (element === undefined) reason = { _tag: "NoMatch" }
      else if (checks.visible && !rendered(element, false)) reason = { _tag: "NotVisible" }
      else if (
        checks.enabled && (
          !enabledControl(element) || (action._tag === "Point" && action.checked === true &&
            !enabledControl(checkableForAction(element) ?? element))
        )
      ) reason = { _tag: "Disabled" }
      else if (checks.editable && readOnly(element)) reason = { _tag: "ReadOnly" }
      else if (checks.notInert && (inert = inertReason(element)) !== null) reason = inert
      else if (checks.inViewport && (visibleFragment(element, request.clip) === null || clipped)) {
        reason = { _tag: "OutsideViewport" }
        if (!state.scrolled) {
          scrollToFragments(element, request.clip)
          state.scrolled = true
        }
      } else if (checks.stable > 0) {
        const rect = dom.getBoundingClientRect(element)
        state.rects.push(rect)
        if (state.rects.length > checks.stable + 1) state.rects.shift()
        const unchanged = evidence !== null && evidence.element === element && evidence.frames === checks.stable &&
          sameRect(evidence.rect, rect)
        if (
          !unchanged &&
          (state.rects.length < checks.stable + 1 || !state.rects.every((rect) => sameRect(rect, state.rects[0]!)))
        ) {
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
          if (hit === null || !flatContains(pointerRecipient(element), hit)) reason = missed(element, hit)
        }
      }
      if (reason === null && element !== undefined && action._tag === "Select") {
        const options = Array.from(element instanceof HTMLSelectElement ? element.options : [])
        const missing = action.choices.find((choice) =>
          !options.some((option, index) => optionMatches(option, index, choice))
        )
        if (missing !== undefined) reason = { _tag: "NoSuchOption", option: describeChoice(missing) }
        else if (checks.enabled) {
          // The native rule, as the role filters use it: :disabled differs between browsers for options.
          const off = action.choices.find((choice) =>
            options.some((option, index) =>
              optionMatches(option, index, choice) &&
              (option.disabled || dom.closest(option, "optgroup[disabled]") !== null)
            )
          )
          if (off !== undefined) reason = { _tag: "DisabledOption", option: describeChoice(off) }
        }
      }
      if (reason === null && element !== undefined) {
        if (
          request.apply && action._tag === "Fill" && dom.designMode(document) === "on" &&
          !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
        ) {
          const active = deepActive()
          if (active !== element && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
            noteAction(state, { _tag: "PreparingFocus", from: describe(active) })
            active.blur()
            // Blur handlers can replace the target or change any effective check. Resolve and check again
            // through the ordinary wait loop before selecting a range or allowing native insertion.
            state.rects = []
            return
          }
        }
        // `ready` runs page code, such as focus handlers, which can change the tree: what follows walks it afresh
        treeScope = null
        let response = ready(element, action, request.apply, state.scrolled, point, checks)
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
              rect: state.rects[state.rects.length - 1]!,
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
      if (reason!._tag !== "NotStable") state.rects = []
      // A rect still settling within its first frames is the check working, not a reason to report
      if (reason!._tag !== "NotStable" || state.rects.length === checks.stable + 1) noteAction(state, reason!)
      else if (state.history.length === 0) state.last = reason!
    }
    if (observation === null) return proceed(false)
    return observation.then((result) => {
      state.cancelObservation = undefined
      state.previous = null
      // A stopped action must not scroll or apply anything after its owner has gone.
      if (state.stopped || result === null || now() >= state.end) return
      clearTreeCaches()
      const current = resolve(request.steps)
      // An observation belongs to one node; a replacement must start its own complete check.
      if (current.length !== 1 || current[0] !== element) return
      // The continuation runs after `checkAction` closed its tree scope, so it opens its own
      treeScope = {}
      try {
        return proceed(result)
      } finally {
        treeScope = null
      }
    })
  }

  /** Stops an action's pending clipping observation: both observers disconnect and its continuation ends. */
  const stopAction = (state: ActionState) => {
    state.stopped = true
    state.cancelObservation?.()
  }

  const act = async (request: Extract<Request, { op: "act" }>): Promise<Response> => {
    const state = createAction(request)
    while (true) {
      const left = state.end - now()
      if (left <= 0) return actionTimeout(request, state)
      // The baseline is immediate; later samples and the independent rendered check wait for a frame.
      if (state.sampled || (request.checks.rendered && !(request.checks.stable > 0))) {
        if (!(await nextFrame(left))) {
          return actionFrameTimeout(request, state)
        }
        state.frames++
      }
      const first = !state.sampled
      state.sampled = true
      const checked = checkAction(request, state)
      const response = checked instanceof Promise ? await checked : checked
      if (response !== undefined) return response
      // The first round returns early only when its first sample observed a blocker; after a stability
      // baseline it keeps waiting like any round, through later samples too.
      if (request.sample === true && first && state.history.length > 0) return actionTimeout(request, state)
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
          if (dom.getAttribute(current, "draggable") === "true") draggable = true
        }
        if (apply && action.guard) arm(pointerRecipient(element))
        return { ...answer, point, draggable }
      }
      case "Checked":
        return { ...answer, checked: checkedOf(element) }
      case "Blur":
        const blur = blurOf(element)
        if (blur === undefined) {
          return {
            _tag: "Final",
            final: { _tag: "WrongElement", expected: "an element with a blur method", element: describe(element) }
          }
        }
        if (apply) blur()
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
          if (target instanceof HTMLElement || target instanceof SVGElement) focus(target)
          const range = dom.createRange(document)
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
        if (element instanceof HTMLElement || element instanceof SVGElement) focus(element)
        return answer
      case "Scroll":
        dom.scrollIntoView(element, { block: "center", inline: "center", behavior: "instant" })
        return answer
      case "Fill": {
        if (invalidNumberFill(element, action.value)) {
          return { _tag: "Final", final: { _tag: "Refused", element: describe(element), value: action.value } }
        }
        const recheckFill = (): Response | { readonly _tag: "Retry"; readonly reason: NotReady } | undefined => {
          // Focus handlers may have changed the tree: read it afresh
          clearTreeCaches()
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
          fill: dom.designMode(document) === "on" &&
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

  // Reads
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
        return value === null ? wrong("an input, a textarea, or a select") : { _tag: "Read", value }
      }
      case "Html":
        return { _tag: "Read", value: dom.outerHTML(element) }
      case "Attribute":
        return { _tag: "Read", value: dom.getAttribute(element, request.read.name) }
      case "Editable":
        return { _tag: "Read", value: editableKind(element) && enabled(element) && !readOnly(element) }
      case "Enabled":
        return { _tag: "Read", value: enabledControl(element) }
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
        return checked === null ? wrong("a checkbox, a radio, or an ARIA checkable") : { _tag: "Read", value: checked }
      }
    }
  }

  // Expectations, waiting in the page
  const expected = (matcher: TextMatcher, text: string): boolean =>
    matcher._tag === "RegExp" ? new RegExp(matcher.source, matcher.flags).test(text) : text === collapse(matcher.value)

  const classMatches = (matcher: TextMatcher, value: string): boolean =>
    matcher._tag === "RegExp" ? new RegExp(matcher.source, matcher.flags).test(value) : value === matcher.value

  /** Checks an expectation once: whether it holds, and what was seen. */
  const evaluate = (steps: ReadonlyArray<Step>, expectation: Expectation): { passed: boolean; observed: unknown } => {
    clearTreeCaches()
    if (expectation._tag === "Title") {
      const title = collapse(dom.title(document))
      return { passed: expected(expectation.expected, title), observed: title }
    }
    if (expectation._tag === "Aria" && expectation.document) {
      const root = documentNode({ interactivity: false, depth: null })
      const matches = matchPattern(expectation.pattern, root)
      return { passed: expectation.not ? !matches : matches, observed: render(root) }
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
        const texts = found.map((element) => dom.classList(element).toString())
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
        return { passed: enabledControl(element), observed: enabledControl(element) ? "enabled" : "disabled" }
      case "Disabled":
        return { passed: !enabledControl(element), observed: enabledControl(element) ? "enabled" : "disabled" }
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
      case "Empty": {
        const empty = dom.nodeName(element) === "INPUT" || dom.nodeName(element) === "TEXTAREA"
          ? !(element as HTMLInputElement | HTMLTextAreaElement).value
          : !dom.textContent(element)?.trim()
        return { passed: empty, observed: empty ? "empty" : "not empty" }
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
      case "Values": {
        const control = textSelectionTarget(element)
        if (!(control instanceof HTMLSelectElement) || !control.multiple) {
          return { passed: false, observed: "not a select element with a multiple attribute" }
        }
        const values = Array.from(control.selectedOptions, (option) => option.value)
        return {
          passed: values.length === expectation.expected.length &&
            values.every((value, index) => classMatches(expectation.expected[index]!, value)),
          observed: values
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
        const matches = matchPattern(expectation.pattern, root)
        return { passed: expectation.not ? !matches : matches, observed: render(root) }
      }
      case "Attribute": {
        const value = dom.getAttribute(element, expectation.name)
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

  // One native sample; its caller owns retries, cancellation and provisional evidence.
  const sampleViewport = (
    steps: ReadonlyArray<Step>,
    expectation: Extract<Expectation, { _tag: "Viewport" }>,
    publish: (result: { passed: boolean; observed: unknown }, provisional?: boolean) => void,
    complete: (error?: unknown) => void,
    requireUnchangedRendering = false
  ): () => void => {
    let active = true
    let observer: IntersectionObserver | undefined
    let frame: number | undefined
    const cancel = () => {
      active = false
      observer?.disconnect()
      if (frame !== undefined) {
        cancelFrame(frame)
      }
    }
    const finish = (error?: unknown) => {
      if (!active) return
      cancel()
      complete(error)
    }
    clearTreeCaches()
    try {
      const found = resolve(steps)
      if (found.length !== 1) {
        publish({ passed: found.length === 0 && !expectation.inViewport, observed: { matches: found.length } })
        finish()
      } else {
        publish({ passed: false, observed: { matches: 1 } }, true)
        const element = found[0]!
        const rendered = requireUnchangedRendering ? dom.getClientRects(element).length > 0 : undefined
        observer = new IntersectionObserver((entries) => {
          if (!active) return
          clearTreeCaches()
          try {
            const current = resolve(steps)
            // A new box needs a host check; moving an existing box needs no stability gate.
            if (
              current.length === 1 && current[0] === element &&
              (rendered === undefined || rendered === (dom.getClientRects(element).length > 0))
            ) {
              const ratio = entries[0]!.intersectionRatio
              const intersects = ratio > 0 && ratio > expectation.ratio - 1e-9
              publish({ passed: intersects === expectation.inViewport, observed: { matches: 1, ratio } })
            }
            finish()
          } catch (error) {
            finish(error)
          }
        })
        observer.observe(element)
        // Firefox needs a rendering opportunity to deliver intersection observations.
        frame = onFrame(() => {})
      }
    } catch (error) {
      finish(error)
    }
    return cancel
  }

  const expectViewport = (request: Extract<Request, { op: "expect" }>): Promise<Response> =>
    new Promise((resume, reject) => {
      const expectation = request.expectation
      if (expectation._tag !== "Viewport") return
      let done = false
      let cancelObservation: (() => void) | undefined
      let frame: number | undefined
      let last: { passed: boolean; observed: unknown } = { passed: false, observed: null }
      let provisional = false
      let changed = false
      let samples = 0
      const finish = (error?: unknown) => {
        if (done) return
        done = true
        cancelObservation?.()
        if (frame !== undefined) {
          cancelFrame(frame)
        }
        clearTimer(timer)
        if (request.token !== undefined) {
          viewportRounds?.delete(request.token)
          if (viewportRounds?.size === 0) viewportRounds = undefined
        }
        if (error !== undefined) reject(error)
        else resume({ _tag: "Expected", ...last, changed, ...(provisional ? { provisional } : {}) })
      }
      const sample = () => {
        if (done) return
        changed = samples++ > 0
        cancelObservation = sampleViewport(request.steps, expectation, (result, pending) => {
          // Keep the previous complete observation while a new native observation is pending.
          if (!pending || last.observed === null) {
            last = result
            provisional = pending === true
          }
        }, (error) => {
          if (error !== undefined) finish(error)
          // The host holds only a provisional observation: the first complete one goes to it at once
          else if (last.passed || request.provisional === true && !provisional) finish()
          else {
            if (last.observed !== null && typeof last.observed === "object" && "ratio" in last.observed) changed = true
            frame = onFrame(sample)
          }
        })
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

  // Snapshots
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
    const checked = checkedState(element).state
    if (checked === "mixed") states.push("mixed")
    else if (checked === true) states.push("checked")
    if (expandedOf(element) === true) states.push("expanded")
    if (selectedOf(element) === true) states.push("selected")
    if ((INTERACTIVE.has(role ?? "") || dom.matches(element, ":disabled")) && !enabled(element)) states.push("disabled")
    if (deepActive() === element) states.push("focused")
    const pressed = pressedOf(element)
    if (pressed === "mixed") states.push("mixed")
    else if (pressed === true) states.push("pressed")
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
    // `cursor` is inherited, in the flat tree: only the element that sets it counts
    const inheritsFrom = flatParent(element)
    if (
      getComputedStyle(element).cursor === "pointer" &&
      (inheritsFrom === null || getComputedStyle(inheritsFrom).cursor !== "pointer")
    ) evidence.push("cursorPointer")
    if (dom.hasAttribute(element, "tabindex") && element instanceof HTMLElement && dom.tabIndex(element) >= 0) {
      evidence.push("tabindex")
    }
    if (
      element instanceof HTMLElement && dom.isContentEditable(element) &&
      !(parent instanceof HTMLElement && dom.isContentEditable(parent))
    ) evidence.push("contentEditable")
    if (dom.hasAttribute(element, "onclick")) evidence.push("onclickAttribute")
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

  // The flat-tree parent of any node, text included, as `flatParent` is an element's: field ancestry follows it.
  const fieldParent = (node: Node): Node | null => {
    const slot = node instanceof Element ? dom.assignedSlot(node) : node instanceof Text ? node.assignedSlot : null
    if (slot !== null) return slot
    const parent = dom.parentNode(node)
    return parent instanceof ShadowRoot ? parent.host : parent
  }

  const fieldAncestry = new Map<Node, boolean>()
  /** Whether `node` is a field or inside one: through its ancestors, assigned slots and shadow hosts. */
  const withinField = (node: Node): boolean => {
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

  const inField = (node: Node): boolean => provenance && withinField(node)

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
          : dom.nodeType(child) === Node.TEXT_NODE && (dom.nodeValue(child) ?? "").trim() !== "" && inField(child)
      ))
    fieldText.set(element, field)
    return field
  }

  const clearTreeCaches = (): void => {
    rawText.clear()
    roleCache.clear()
    nameCache.clear()
    hiddenNameCache.clear()
    inertness = undefined
    inertAncestors.clear()
    insideModal.clear()
    escaped = undefined
    namesFromContent.clear()
    namesFromFields.clear()
    provenance = false
    fieldKinds.clear()
    fieldAncestry.clear()
    fieldText.clear()
  }

  /** An inferred node's name: its accessible name, or where one can be read from. */
  const inferredName = (element: Element): SnapNode["name"] => {
    // A snapshot is text to read, so its names show a non-breaking space as a space
    const accessible = collapse(accessibleName(element, false))
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
    const title = collapse(dom.getAttribute(element, "title") ?? "")
    if (title !== "") return { _tag: "Inferred", value: title, from: "title" }
    const placeholder = collapse(
      dom.getAttribute(element, "placeholder") ?? dom.getAttribute(element, "aria-placeholder") ??
        dom.getAttribute(element, "data-placeholder") ?? ""
    )
    if (placeholder !== "") return { _tag: "Inferred", value: placeholder, from: "placeholder" }
    const image = dom.querySelector(element, "img[alt]")
    const alt = collapse((image === null ? null : dom.getAttribute(image, "alt")) ?? "")
    if (alt !== "") {
      return {
        _tag: "Inferred",
        value: alt,
        from: "alt",
        ...(image !== null && inField(image) ? { fieldContent: true } : {})
      }
    }
    const previous = dom.previousElementSibling(element)
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
      const text = collapse(pending.replace(/[\u200b\u00ad]/g, ""))
      pending = ""
      if (text !== "") out.push(textNode(text))
    }
    const visit = (node: Node, textShown: boolean) => {
      if (dom.nodeType(node) === 3) {
        if (textShown) pending += dom.textContent(node) ?? ""
        return
      }
      if (!(node instanceof Element) || SKIPPED.has(dom.localName(node))) return
      if (dom.getAttribute(node, "aria-hidden") === "true") return
      if (inert(node)) {
        // An inert ancestor of the topmost modal dialog adds nothing of its own, but the dialog escapes it
        if (modalAncestors().has(node)) {
          for (const child of flatChildNodes(node)) visit(child, false)
        }
        return
      }
      const display = getComputedStyle(node).display
      if (display === "none") return
      if (display !== "contents" && !dom.checkVisibility(node)) return
      const shown = display === "contents"
        ? contentsShown(node)
        : dom.checkVisibility(node, { visibilityProperty: true })
      const made = shown ? elementNode(node, level, walk) : null
      if (made === null) {
        if (shown) pending += cssContent(node, "::before") ?? ""
        for (const child of flatChildNodes(node)) visit(child, shown)
        if (shown) pending += cssContent(node, "::after") ?? ""
        return
      }
      flush()
      out.push(made)
    }
    // Pseudo-element content is part of the text, as it is of a name
    if (parent instanceof Element) pending += cssContent(parent, "::before") ?? ""
    for (const child of flatChildNodes(parent)) visit(child, true)
    if (parent instanceof Element) pending += cssContent(parent, "::after") ?? ""
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
    // A snapshot is text to read, so its names show a non-breaking space as a space
    const accessible = collapse(accessibleName(element, false))
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
    // Only a role that takes a level has one, so an h2 with role="tab" has none
    const level_ = role._tag === "Aria" && LEVEL_ROLES.has(role.role) ? levelOf(element) : 0
    let children = frame || (walk.depth !== null && level >= walk.depth) ? [] : childrenOf(element, level + 1, walk)
    // Text that only repeats the node's name isn't a node of its own
    if (
      name._tag !== "None" && children.length === 1 && children[0]!.role._tag === "Aria" &&
      children[0]!.role.role === "text" && children[0]!.name._tag !== "None" &&
      children[0]!.name.value === collapse(name.value)
    ) children = []
    return {
      ref: refFor(element),
      role,
      name,
      states: statesOf(element, role._tag === "Aria" ? role.role : null),
      ...(level_ > 0 ? { level: level_ } : {}),
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
    const title = collapse(dom.title(document))
    const root = dom.documentElement(document)
    return {
      ref: null,
      role: { _tag: "Aria", role: "document" },
      name: title === "" ? { _tag: "None" } : { _tag: "Accessible", value: title },
      states: [],
      validationMessage: null,
      children: root === null || (walk.depth !== null && walk.depth < 1) ? [] : childrenOf(root, 1, walk),
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
      : collapse(value) === collapse(matcher.value)
  }

  /** Whether a node matches a pattern: its role and name, and its children as the pattern states. */
  const matchPattern = (pattern: Pattern, node: SnapNode): boolean => {
    if (pattern._tag === "Text") {
      return node.role._tag === "Aria" && node.role.role === "text" && nameMatches(pattern.value, node.name)
    }
    if (pattern._tag === "Anywhere") return matchAnywhere(pattern.children, node)
    if (node.role._tag !== "Aria" || node.role.role !== pattern.role || !nameMatches(pattern.name, node.name)) {
      return false
    }
    return statesMatch(pattern.states, node) && matchChildren(pattern.children, node)
  }

  /** Whether a node has the level and states a pattern states. */
  const statesMatch = (states: PatternStates, node: SnapNode): boolean => {
    if (states.level !== undefined && node.level !== states.level) return false
    const has = (state: string) => node.states.includes(state)
    // A node's mixed state is a button's pressed state, and any other node's checked state
    const button = node.role._tag === "Aria" && node.role.role === "button"
    const checked = has("checked") ? true : !button && has("mixed") ? "mixed" : false
    const pressed = has("pressed") ? true : button && has("mixed") ? "mixed" : false
    if (states.checked !== undefined && states.checked !== checked) return false
    if (states.pressed !== undefined && states.pressed !== pressed) return false
    for (const state of ["expanded", "selected", "disabled", "invalid", "focused"] as const) {
      const expected = states[state]
      if (expected !== undefined && has(state) !== expected) return false
    }
    return true
  }

  /** Whether the node, or any node beneath it, has children that match. */
  const matchAnywhere = (children: PatternChildren, node: SnapNode): boolean =>
    matchChildren(children, node) || node.children.some((child) => matchAnywhere(children, child))

  /** Whether a node's children match as a pattern states. */
  const matchChildren = (children: PatternChildren, node: SnapNode): boolean => {
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
        const lower = collapse(name).toLowerCase()
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
    const box = dom.getBoundingClientRect(found[0]!)
    return {
      _tag: "Rect",
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      scroll: { x: scrollX, y: scrollY }
    }
  }

  const html = (): Response => {
    const type = dom.doctype(document)
    const doctype = type === null ? "" : new XMLSerializer().serializeToString(type)
    const root = dom.documentElement(document)
    return { _tag: "Read", value: doctype + (root === null ? "" : dom.outerHTML(root)) }
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
      dom.scrollIntoView(one, { block: "center", inline: "center", behavior: "instant" })
    }
    return one
  }

  /** An iframe's content box origin, scrolled into view when asked, and what the pointer would hit at a point. */
  const frame = async (request: Extract<Request, { op: "frame" }>): Promise<Response> => {
    const found = resolve(request.steps)
    if (found.length > 1) return strict(found)
    const iframe = found[0]
    if (iframe === undefined) return { _tag: "NoMatch" }
    let scrolled = false
    if (request.scroll) {
      let outside = visibleFragment(iframe, request.clip) === null
      if (!outside) {
        const observation = clippedByScroller(iframe, request.cap ?? 1000, request.clip)
        if (observation !== null) {
          const result = await observation
          clearTreeCaches()
          const current = resolve(request.steps)
          if (result === null || current.length !== 1 || current[0] !== iframe) return { _tag: "NoMatch" }
          outside = result
        }
      }
      if (outside) {
        scrollToFragments(iframe, request.clip)
        scrolled = true
      }
    }
    const rect = dom.getBoundingClientRect(iframe)
    const style = getComputedStyle(iframe)
    const origin = {
      x: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      y: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
    }
    let covered: NotReady | null = null
    if (request.point !== null) {
      const hit = hitTarget(origin.x + request.point.x, origin.y + request.point.y)
      if (hit !== iframe) covered = missed(iframe, hit)
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
      const shadow = dom.shadowRoot(element)
      if (shadow !== null) roots.push(shadow)
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
      hiddenNameCache.clear()
      inertness = undefined
      inertAncestors.clear()
      insideModal.clear()
      escaped = undefined
      const name = full ? accessibleName(element, hiddenFromAccessibility(element)) : ""
      found.set(
        element,
        `${roleOf(element)}${name === "" ? "" : ` ${JSON.stringify(name)}`} validationMessage=${
          JSON.stringify(full ? message : "•••")
        }`
      )
    }
    for (const root of roots) dom.addEventListener(root, "invalid", listener, true)
    validationObservers.set(token, () => {
      for (const root of roots) dom.removeEventListener(root, "invalid", listener, true)
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
        case "insert":
          return JSON.stringify(insert(request.text, request.beforeInput) satisfies Response)
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
          return JSON.stringify({ _tag: "Title", title: dom.title(document) } satisfies Response)
        case "frame":
          return JSON.stringify(await frame(request))
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
                // A hidden element's name counts its hidden content; a shown one's, what a reader gets
                name: accessibleName(element, hiddenFromAccessibility(element))
              }))
            } satisfies Response
          )
      }
    } catch (error) {
      return JSON.stringify(failureResponse(error))
    }
  }
  const failureResponse = (error: unknown): Response => {
    if (isInvalidSelector(error)) {
      return {
        _tag: "InvalidSelector",
        selector: error.selector,
        message: error.message,
        ...(error.kind === undefined ? {} : { kind: error.kind })
      } satisfies Response
    }
    if (isStale(error)) return { _tag: "StaleRef", why: error.why } satisfies Response
    throw error
  }

  const cooperativeHelpers = () => ({
    createAction,
    checkAction,
    stopAction,
    actionTimeout,
    actionFrameTimeout,
    evaluate,
    sampleViewport,
    matchesValue: classMatches,
    clearTreeCaches,
    failureResponse,
    now,
    setTimer,
    clearTimer,
    onFrame,
    cancelFrame
  })
  return { run, element, cooperativeHelpers }
}

/** The key the engine is installed under in a realm's global: a symbol, out of the way of anything else. */
export const installKey = "@usestrider/browser/engine/1"

/** Drops the indentation of function source, which no line of it depends on, to stay within inspector packet limits. */
const compact = (source: string): string => source.replace(/^[ \t]+/gm, "")

/** Installs the engine in a realm, once: a function declaration for `evaluate`. */
export const install = `function() {
  const key = Symbol.for(${JSON.stringify(installKey)});
  if (globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, { value: (${compact(engine.toString())})(${
  compact(renderText.toString())
}), enumerable: false });
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

/** A check that may be driven by the opted-in host handshake. */
export type CooperativeURLRequest = Omit<Extract<Request, { readonly op: "expect" }>, "expectation"> & {
  readonly expectation: { readonly _tag: "URL"; readonly expected: TextMatcher }
}
export type CooperativeRequest = Extract<Request, { readonly op: "act" | "expect" }> | CooperativeURLRequest

/** All commands name both the actual document and the triggering operation. */
export type CooperativeCommand =
  & {
    readonly document: string
    readonly operation: string
    readonly session: string
  }
  & (
    | {
      readonly command: "start"
      readonly request: CooperativeRequest
      readonly budget: number
      readonly final?: boolean
    }
    | {
      readonly command: "resume"
      readonly token: string
      readonly left: number
      readonly decision: "continue" | "invalidate" | "restart"
      readonly clip?: Clip
    }
    | { readonly command: "cancel" }
    | { readonly command: "finish" }
  )

/** The ordinary response is nested so cooperative control messages cannot reach ordinary callers. */
export const CooperativeResponse = Schema.Union([
  Schema.TaggedStruct("Check", { token: Schema.String, final: Schema.Boolean }),
  Schema.TaggedStruct("Done", { response: Response, retained: Schema.optional(Schema.Boolean) }),
  Schema.TaggedStruct("Restart", {}),
  Schema.TaggedStruct("Departed", {}),
  Schema.TaggedStruct("Disposed", {})
])
export type CooperativeResponse = typeof CooperativeResponse.Type
export const decodeCooperativeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(CooperativeResponse))

/**
 * Installed separately on first use. This source is deliberately absent from the ordinary engine installation.
 * Each session owns its timers, frame callbacks, observer and references to action state.
 */
function cooperativeEngine(helpers: ReturnType<ReturnType<typeof engine>["cooperativeHelpers"]>) {
  const { now, setTimer, clearTimer, onFrame, cancelFrame } = helpers
  type ActionState = ReturnType<typeof helpers.createAction>
  interface Session {
    readonly document: string
    readonly operation: string
    readonly session: string
    request: CooperativeRequest
    readonly final: boolean
    end: number
    token: string | undefined
    state: ActionState | undefined
    observed: unknown
    /** Whether `observed` is a viewport expectation's provisional observation. */
    provisional: boolean
    terminal: Response | undefined
    changed: boolean
    disposed: boolean
    departed: boolean
    timer: number
    stopWaiting: (() => void) | undefined
    expireEvidence: (() => void) | undefined
  }
  interface Terminal {
    readonly document: string
    readonly operation: string
    readonly token: string | undefined
    readonly text: string
    readonly expires: number
    readonly bytes: number
  }
  const sessions = new Map<string, Session>()
  // Only serialized data survives expiry. Count, UTF-16 storage and age are independently bounded.
  const terminals = new Map<string, Terminal>()
  const terminalLimit = 64
  const terminalByteLimit = 1024 * 1024
  const terminalRetention = 30_000
  let terminalBytes = 0
  let terminalTimer: number | undefined
  let listening = false
  let sequence = 0
  const epoch = Math.random().toString(36).slice(2)
  const disposed = { _tag: "Disposed" } as const
  const lifecycle = () => {
    const needed = sessions.size > 0 || terminals.size > 0
    if (needed && !listening) addEventListener("pagehide", navigated)
    else if (!needed && listening) removeEventListener("pagehide", navigated)
    listening = needed
  }
  const forgetTerminal = (key: string) => {
    const terminal = terminals.get(key)
    if (terminal === undefined) return
    terminalBytes -= terminal.bytes
    terminals.delete(key)
  }
  const sweepTerminals = () => {
    if (terminalTimer !== undefined) clearTimer(terminalTimer)
    terminalTimer = undefined
    let next = Infinity
    const time = now()
    for (const [key, terminal] of terminals) {
      if (terminal.expires <= time) forgetTerminal(key)
      else next = Math.min(next, terminal.expires)
    }
    if (next !== Infinity) terminalTimer = setTimer(sweepTerminals, Math.max(0, next - now()))
    lifecycle()
  }
  const retainTerminal = (session: Session, response: Response, token: string | undefined) => {
    const text = JSON.stringify(response)
    const bytes = 2 * (text.length + session.session.length + session.document.length +
      session.operation.length + (token?.length ?? 0))
    if (bytes > terminalByteLimit) return
    while (terminals.size >= terminalLimit || terminalBytes + bytes > terminalByteLimit) {
      forgetTerminal(terminals.keys().next().value!)
    }
    terminals.set(session.session, {
      document: session.document,
      operation: session.operation,
      token,
      text,
      expires: now() + terminalRetention,
      bytes
    })
    terminalBytes += bytes
    sweepTerminals()
  }
  const remove = (session: Session) => {
    if (session.disposed) return
    session.disposed = true
    session.token = undefined
    sessions.delete(session.session)
    clearTimer(session.timer)
    session.stopWaiting?.()
    session.expireEvidence?.()
    session.state = undefined
    lifecycle()
  }
  const navigated = () => {
    for (const session of sessions.values()) {
      session.departed = true
      remove(session)
    }
    terminals.clear()
    terminalBytes = 0
    sweepTerminals()
  }
  const check = (session: Session): CooperativeResponse => {
    if (session.disposed) return disposed
    session.token = `${epoch}:${++sequence}`
    return { _tag: "Check", token: session.token, final: session.final }
  }
  const finished = (session: Session, response: Response): CooperativeResponse => {
    remove(session)
    return { _tag: "Done", response }
  }
  const timeoutResponse = (session: Session): Response =>
    session.request.op === "act"
      ? helpers.actionTimeout(session.request, session.state!)
      : {
        _tag: "Expected",
        passed: false,
        observed: session.observed,
        changed: session.changed,
        ...(session.provisional ? { provisional: true } : {})
      }
  const expired = (session: Session): CooperativeResponse => finished(session, timeoutResponse(session))
  const expire = (session: Session) => {
    if (session.disposed) return
    session.terminal = session.request.op === "act" && session.stopWaiting !== undefined
      ? helpers.actionFrameTimeout(session.request, session.state!)
      : timeoutResponse(session)
    const token = session.token
    remove(session)
    retainTerminal(session, session.terminal, token)
  }
  const stopped = (session: Session): CooperativeResponse =>
    session.terminal === undefined
      ? session.departed ? { _tag: "Departed" } : disposed
      : { _tag: "Done", response: session.terminal, retained: terminals.has(session.session) }
  // A cooperative wait only announces that another check is due. It never evaluates/asserts/applies DOM.
  const wait = (session: Session, mutations: boolean): Promise<boolean> =>
    new Promise((resume) => {
      let done = false
      let frame: number | undefined
      let observer: MutationObserver | undefined
      const events = ["input", "change", "focusin", "focusout", "hashchange", "popstate"]
      const finish = (ready: boolean) => {
        if (done) return
        done = true
        if (frame !== undefined) cancelFrame(frame)
        observer?.disconnect()
        if (mutations) { for (const type of events) removeEventListener(type, changed, true) }
        session.stopWaiting = undefined
        resume(ready)
      }
      const changed = () => finish(true)
      session.stopWaiting = () => finish(false)
      frame = onFrame(() => {
        if (session.state !== undefined) session.state.frames++
        finish(true)
      })
      if (mutations) {
        observer = new MutationObserver(changed)
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
        for (const type of events) addEventListener(type, changed, true)
      }
    })
  // An expectation's cap-0 round samples once; an action's first round ends early only on recorded evidence.
  const singleSample = (request: CooperativeRequest): boolean => request.op !== "act" && request.cap <= 0
  const run = async (command: CooperativeCommand): Promise<CooperativeResponse> => {
    sweepTerminals()
    if (command.command === "start") {
      if (sessions.has(command.session) || terminals.has(command.session)) return disposed
      if (!Number.isFinite(command.budget) || command.budget <= 0 || !Number.isFinite(command.request.cap)) {
        return disposed
      }
      const session: Session = {
        document: command.document,
        operation: command.operation,
        session: command.session,
        request: command.request,
        final: command.final === true || command.request.op === "act" && command.request.apply,
        end: now() +
          Math.max(0, singleSample(command.request) ? command.budget : Math.min(command.budget, command.request.cap)),
        token: undefined,
        state: command.request.op === "act" ? helpers.createAction(command.request) : undefined,
        observed: null,
        provisional: false,
        terminal: undefined,
        changed: false,
        disposed: false,
        departed: false,
        timer: 0,
        stopWaiting: undefined,
        expireEvidence: undefined
      }
      sessions.set(session.session, session)
      lifecycle()
      session.timer = setTimer(() => expire(session), Math.max(0, session.end - now()))
      // Captured final-check evidence expires at the next rendering update, even while the host probes.
      if (session.state?.previous !== null && session.state !== undefined) {
        const frame = onFrame(() => {
          if (session.state !== undefined) session.state.previous = null
        })
        session.expireEvidence = () => cancelFrame(frame)
      }
      if (command.request.op === "act" && command.request.checks.rendered && command.request.checks.stable === 0) {
        if (!(await wait(session, false))) return stopped(session)
      }
      return check(session)
    }
    const terminal = terminals.get(command.session)
    if (terminal !== undefined) {
      if (terminal.document !== command.document || terminal.operation !== command.operation) return disposed
      if (command.command === "cancel") {
        forgetTerminal(command.session)
        sweepTerminals()
        return disposed
      }
      if (
        command.command === "resume" &&
        (terminal.token === undefined || typeof command.token !== "string" || command.token !== terminal.token)
      ) return disposed
      forgetTerminal(command.session)
      sweepTerminals()
      return command.command === "finish" || Number.isFinite(command.left)
        ? { _tag: "Done", response: JSON.parse(terminal.text) as Response }
        : disposed
    }
    const session = sessions.get(command.session)
    if (session === undefined || session.document !== command.document || session.operation !== command.operation) {
      return disposed
    }
    if (command.command === "cancel") {
      remove(session)
      return disposed
    }
    // Finishing only returns timeout evidence; it never authorizes a check or application.
    if (command.command === "finish") return expired(session)
    if (session.token === undefined || session.token !== command.token) return disposed
    // Consume before any await. Concurrent/replayed resumes cannot evaluate the same check twice.
    session.token = undefined
    if (!Number.isFinite(command.left)) {
      remove(session)
      return disposed
    }
    session.end = Math.min(session.end, now() + Math.max(0, command.left))
    clearTimer(session.timer)
    session.timer = setTimer(() => expire(session), Math.max(0, session.end - now()))
    if (command.decision === "restart") {
      remove(session)
      return { _tag: "Restart" }
    }
    if (session.end <= now()) return expired(session)
    if (command.decision === "invalidate" && session.request.op === "act") {
      // Do not consume a stale shared capture token when a callback has changed DOM/focus/scroll.
      const { stability: _capture, ...fresh } = session.request
      session.request = command.clip === undefined ? fresh : { ...fresh, clip: command.clip }
      session.state = helpers.createAction(session.request)
      if (session.request.checks.rendered && session.request.checks.stable === 0) {
        if (!(await wait(session, false))) return stopped(session)
        return check(session)
      }
    }
    try {
      if (session.request.op === "act") {
        const first = !session.state!.sampled
        session.state!.sampled = true
        // Only a clipping observation is asynchronous; otherwise the wait starts in the same turn.
        const state = session.state!
        const checked = helpers.checkAction(session.request, state)
        let response: Response | undefined
        if (checked instanceof Promise) {
          // The session owns the observation: cancellation or departure stops it before it can scroll or apply.
          session.stopWaiting = () => helpers.stopAction(state)
          response = await checked
          session.stopWaiting = undefined
          if (session.disposed) return stopped(session)
        } else response = checked
        if (response !== undefined) return finished(session, response)
        if (session.request.sample === true && first && session.state!.history.length > 0) return expired(session)
        if (!(await wait(session, false))) return stopped(session)
      } else {
        helpers.clearTreeCaches()
        const expectation = session.request.expectation
        if (expectation._tag === "Viewport") {
          let passed = false
          const ready = await new Promise<boolean>((resume, reject) => {
            let cancelObservation: (() => void) | undefined
            let done = false
            const finish = (ready: boolean, error?: unknown) => {
              if (done) return
              done = true
              cancelObservation?.()
              session.stopWaiting = undefined
              if (error !== undefined) reject(error)
              else resume(ready)
            }
            session.stopWaiting = () => finish(false)
            cancelObservation = helpers.sampleViewport(
              session.request.steps,
              expectation,
              (result, provisional) => {
                if (!provisional || session.observed === null) {
                  session.observed = result.observed
                  session.provisional = provisional === true
                }
                passed = result.passed
              },
              (error) => finish(true, error),
              true
            )
          })
          if (!ready || session.disposed) return stopped(session)
          // A complete observation after the host's provisional one goes to it at once
          if (
            passed || singleSample(session.request) || session.request.provisional === true && !session.provisional
          ) {
            return finished(session, {
              _tag: "Expected",
              passed,
              observed: session.observed,
              changed: session.changed,
              ...(session.provisional ? { provisional: true } : {})
            })
          }
          if (!(await wait(session, false))) return stopped(session)
          session.changed = true
          return check(session)
        }
        const result = expectation._tag === "URL"
          ? { passed: helpers.matchesValue(expectation.expected, location.href), observed: location.href }
          : helpers.evaluate(session.request.steps, expectation)
        session.observed = result.observed
        if (result.passed || singleSample(session.request)) {
          return finished(session, {
            _tag: "Expected",
            passed: result.passed,
            observed: result.observed,
            changed: session.changed
          })
        }
        if (!(await wait(session, true))) return stopped(session)
        session.changed = true
      }
      return check(session)
    } catch (error) {
      remove(session)
      return { _tag: "Done", response: helpers.failureResponse(error) }
    }
  }
  return async (text: string): Promise<string> => JSON.stringify(await run(JSON.parse(text) as CooperativeCommand))
}

/** Runs the separate cooperative protocol; ordinary engine requests never call or install this function. */
export const cooperate = `function(command) {
  const key = Symbol.for("@usestrider/browser/engine/cooperative/1");
  const engine = globalThis[Symbol.for(${JSON.stringify(installKey)})];
  if (engine === undefined) return "\\u0000missing";
  if (globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, { value: (${cooperativeEngine.toString()})(engine.cooperativeHelpers()), enumerable: false });
  }
  return globalThis[key](command);
}`
