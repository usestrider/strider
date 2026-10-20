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

const TypeId = "~effect-browser/AriaPattern"

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

const ChildrenTypeId = "~effect-browser/AriaPattern/Children"

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
export declare const node: (role: AriaRole.AriaRole, name: string | RegExp, children: Children) => AriaPattern

/**
 * A text node.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const text: (value: string | RegExp) => AriaPattern

/**
 * These children, in this order, and no others.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const exactly: (...children: ReadonlyArray<AriaPattern>) => Children

/**
 * These children in this order; others may come between.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const including: (...children: ReadonlyArray<AriaPattern>) => Children

/**
 * Children are not compared.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export declare const unchecked: Children
