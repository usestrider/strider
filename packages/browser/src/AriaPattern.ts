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
 * A node with a role, an accessible name, and children compared as `children` says. A string name is matched whole
 * after collapsing whitespace, and an empty one means no accessible name.
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
export const node = (role: AriaRole.AriaRole, name: string | RegExp, children: Children): AriaPattern =>
  Data.registerPattern({ [TypeId]: TypeId }, {
    _tag: "Node",
    role,
    name: matcher(name),
    children: Data.childrenOf(children)
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
