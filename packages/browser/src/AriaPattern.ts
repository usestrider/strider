/**
 * Patterns that describe part of the accessibility tree, for `Expect.toMatchAria`.
 *
 * A pattern is matched against `snapshot({ sources: "aria" })`, the accessibility tree alone. It always says how a
 * node's children are compared: exactly these children, these among others, or not at all.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import type * as AriaRole from "./AriaRole.ts"
import * as Data from "./internal/ariaPattern.ts"
import type * as Engine from "./internal/engine.ts"

const TypeId = "~@usestrider/browser/AriaPattern"

/**
 * A pattern for one node of the accessibility tree.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AriaPattern {
  readonly [TypeId]: typeof TypeId
}

const ChildrenTypeId = "~@usestrider/browser/AriaPattern/Children"

/**
 * How a node's children are matched.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Children {
  readonly [ChildrenTypeId]: typeof ChildrenTypeId
}

/** A name or text: a string matched whole after collapsing whitespace, or a `RegExp`. */
const matcher = (value: string | RegExp): Engine.TextMatcher =>
  typeof value === "string"
    ? { _tag: "String", value, exact: true }
    : { _tag: "RegExp", source: value.source, flags: value.flags.replace("g", "") }

/**
 * Checks whether a value is an `AriaPattern`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isAriaPattern = (u: unknown): u is AriaPattern => Predicate.hasProperty(u, TypeId)

/**
 * The level and states a node pattern compares. An omitted one isn't compared; `true` requires the state, and
 * `false` requires its absence.
 *
 * **Example** (Matching a pressed toggle that isn't disabled)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern } from "@usestrider/browser"
 *
 * const options: AriaPattern.NodeOptions = { pressed: true, disabled: false }
 * const bold = AriaPattern.node("button", "Bold", AriaPattern.unchecked, options)
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NodeOptions {
  /** The node's level, such as 2 for an `h2`: headings, list items, rows and tree items have one. @default undefined */
  readonly level?: number | undefined
  /** Whether it's checked; `"mixed"` for an indeterminate checkbox or `aria-checked="mixed"`. @default undefined */
  readonly checked?: boolean | "mixed" | undefined
  /** Whether a toggle button is pressed; `"mixed"` for `aria-pressed="mixed"`. @default undefined */
  readonly pressed?: boolean | "mixed" | undefined
  /** Whether it's expanded. @default undefined */
  readonly expanded?: boolean | undefined
  /** Whether it's selected. @default undefined */
  readonly selected?: boolean | undefined
  /** Whether it's disabled. @default undefined */
  readonly disabled?: boolean | undefined
  /** Whether a form control fails its constraint validation. @default undefined */
  readonly invalid?: boolean | undefined
  /** Whether it has focus. @default undefined */
  readonly focused?: boolean | undefined
}

/**
 * A node with a role, an accessible name, and children compared as `children` says, and with `options`, the level
 * and states it must have. A string name is matched whole after collapsing whitespace, and an empty one means no
 * accessible name.
 *
 * **Details**
 *
 * States are read as the snapshot reads them, so a pattern's `level`, `checked` or `pressed` matches what
 * `snapshot({ sources: "aria" })` shows as `[level=2]`, `[checked]`, `[checked=mixed]` or `[pressed=mixed]`.
 *
 * **Example** (Matching a second-level heading and a partly checked box)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern } from "@usestrider/browser"
 *
 * const plans = AriaPattern.node("heading", "Plans", AriaPattern.unchecked, { level: 2 })
 * const selectAll = AriaPattern.node("checkbox", "All", AriaPattern.unchecked, {
 *   checked: "mixed",
 *   disabled: false
 * })
 * ```
 *
 * **Example** (Matching a heading whose name varies)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const orderSummary = (page: Page.ReadonlyPage) =>
 *   page.getByRole("region", { name: "Order summary" }).pipe(Expect.toMatchAria(
 *     AriaPattern.node(
 *       "region",
 *       "Order summary",
 *       AriaPattern.including(
 *         AriaPattern.node("heading", /^Order #\d+$/, AriaPattern.unchecked)
 *       )
 *     )
 *   ))
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const node = (
  role: AriaRole.AriaRole,
  name: string | RegExp,
  children: Children,
  options?: NodeOptions | undefined
): AriaPattern =>
  Data.registerPattern({ [TypeId]: TypeId }, {
    _tag: "Node",
    role,
    name: matcher(name),
    children: Data.childrenOf(children),
    states: {
      level: options?.level,
      checked: options?.checked,
      pressed: options?.pressed,
      expanded: options?.expanded,
      selected: options?.selected,
      disabled: options?.disabled,
      invalid: options?.invalid,
      focused: options?.focused
    }
  })

/**
 * A text node; a string `value` is matched whole after collapsing whitespace.
 *
 * **Example** (Matching a status that says only Saved)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern } from "@usestrider/browser"
 *
 * const saved = AriaPattern.node(
 *   "status",
 *   "",
 *   AriaPattern.exactly(AriaPattern.text("Saved"))
 * )
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const text = (value: string | RegExp): AriaPattern =>
  Data.registerPattern({ [TypeId]: TypeId }, { _tag: "Text", value: matcher(value) })

/**
 * A node, at the subject or at any depth beneath it, whose children match as `children` says. Its own role and name
 * aren't compared.
 *
 * **When to use**
 *
 * Use to match part of a tree without spelling out the nodes above it, such as a heading inside a banner from the
 * page.
 *
 * **Example** (Matching a heading and a field anywhere on a page)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const todoForm = (page: Page.ReadonlyPage) =>
 *   page.pipe(Expect.toMatchAria(
 *     AriaPattern.anywhere(
 *       AriaPattern.including(
 *         AriaPattern.node("heading", "todos", AriaPattern.unchecked),
 *         AriaPattern.node("textbox", "What needs to be done?", AriaPattern.unchecked)
 *       )
 *     )
 *   ))
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const anywhere = (children: Children): AriaPattern =>
  Data.registerPattern({ [TypeId]: TypeId }, { _tag: "Anywhere", children: Data.childrenOf(children) })

/**
 * These direct children, in this order, and no others.
 *
 * **Example** (Matching a cart with exactly two items)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern } from "@usestrider/browser"
 *
 * const item = (name: string) =>
 *   AriaPattern.node("listitem", "", AriaPattern.exactly(AriaPattern.text(name)))
 *
 * const cart = AriaPattern.node(
 *   "list",
 *   "Cart",
 *   AriaPattern.exactly(item("Headphones"), item("Charger"))
 * )
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const exactly = (...children: ReadonlyArray<AriaPattern>): Children =>
  Data.registerChildren({ [ChildrenTypeId]: ChildrenTypeId }, { _tag: "Exactly", patterns: children.map(Data.pattern) })

/**
 * These direct children, in this order; others may come between.
 *
 * **Example** (Matching a form's field and button among others)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern } from "@usestrider/browser"
 *
 * const signIn = AriaPattern.node(
 *   "form",
 *   "Sign in",
 *   AriaPattern.including(
 *     AriaPattern.node("textbox", "Email", AriaPattern.unchecked),
 *     AriaPattern.node("button", "Sign in", AriaPattern.unchecked)
 *   )
 * )
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const including = (...children: ReadonlyArray<AriaPattern>): Children =>
  Data.registerChildren({ [ChildrenTypeId]: ChildrenTypeId }, {
    _tag: "Including",
    patterns: children.map(Data.pattern)
  })

/**
 * Children are not compared.
 *
 * **Example** (Matching a dialog without its contents)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const dialogOpen = (page: Page.ReadonlyPage) =>
 *   page.getByRole("dialog").pipe(
 *     Expect.toMatchAria(AriaPattern.node("dialog", "Sign in", AriaPattern.unchecked))
 *   )
 * ```
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const unchecked: Children = Data.registerChildren({ [ChildrenTypeId]: ChildrenTypeId }, { _tag: "Unchecked" })
