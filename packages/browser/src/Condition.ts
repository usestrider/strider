/**
 * Conditions for `Expect.that`: predicates with a description, so a failure says what was expected.
 *
 * @stability unstable
 * @since 0.1.0
 */
import { dual } from "effect/Function"
import type { Pipeable } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as P from "effect/Predicate"
import * as ConditionImpl from "./internal/condition.ts"

const TypeId = ConditionImpl.TypeId

/**
 * A described predicate over `A`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Condition<in A> extends Pipeable {
  readonly [TypeId]: (a: A) => boolean
}

/**
 * Checks whether a value is a `Condition`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCondition = (u: unknown): u is Condition<never> => Predicate.hasProperty(u, TypeId)

/**
 * Creates a condition; the description appears in `ExpectationFailed`.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <A>(description: string, predicate: P.Predicate<A>): Condition<A> =>
  ConditionImpl.make(description, predicate)

/**
 * Negates a condition: the wait is for it to stop holding.
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const not = <A>(condition: Condition<A>): Condition<A> =>
  ConditionImpl.make(`not ${ConditionImpl.describe(condition)}`, (a: A) => !ConditionImpl.holds(condition, a))

/**
 * Combines conditions that must all hold for the same observation.
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const and = <A>(...conditions: ReadonlyArray<Condition<A>>): Condition<A> =>
  ConditionImpl.make(
    conditions.map(ConditionImpl.describe).join(" and "),
    (a: A) => conditions.every((condition) => ConditionImpl.holds(condition, a))
  )

/**
 * Adds why the condition matters to its failure message.
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const because: {
  (why: string): <A>(condition: Condition<A>) => Condition<A>
  <A>(condition: Condition<A>, why: string): Condition<A>
} = dual(
  2,
  <A>(condition: Condition<A>, why: string): Condition<A> =>
    ConditionImpl.make(
      `${ConditionImpl.describe(condition)}, because ${why}`,
      (a: A) => ConditionImpl.holds(condition, a)
    )
)
