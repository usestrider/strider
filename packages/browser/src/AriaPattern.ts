/**
 * Patterns over the accessibility tree, for `Expect.toMatchAria`.
 *
 * A pattern is matched against `snapshot({ sources: "aria" })`, the accessibility tree alone. How children
 * match is always stated: exactly these, these among others, or not compared.
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
 * A node with a role, an accessible name, and children matched as stated. An empty name means no accessible
 * name.
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
 * A text node.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const text = (value: string | RegExp): AriaPattern =>
  Data.registerPattern({ [TypeId]: TypeId }, { _tag: "Text", value: matcher(value) })

/**
 * These children, in this order, and no others.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const exactly = (...children: ReadonlyArray<AriaPattern>): Children =>
  Data.registerChildren({ [ChildrenTypeId]: ChildrenTypeId }, { _tag: "Exactly", patterns: children.map(Data.pattern) })

/**
 * These children in this order; others may come between.
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
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const unchecked: Children = Data.registerChildren({ [ChildrenTypeId]: ChildrenTypeId }, { _tag: "Unchecked" })
