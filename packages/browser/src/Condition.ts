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
 * A predicate on `A` with a description, which a failure reports.
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
 * **Example** (Waiting for at least one result)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const someResults = Condition.make("at least one result", (count: number) => count > 0)
 *
 * const searched = Effect.fn("searched")(function*(page: Page.ReadonlyPage) {
 *   yield* Expect.that(page.getByRole("listitem").count, someResults)
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <A>(description: string, predicate: P.Predicate<A>): Condition<A> =>
  ConditionImpl.make(description, predicate)

/**
 * Negates a condition, so `Expect.that` waits for it to stop holding.
 *
 * **Example** (Waiting to leave the sign-in page)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const onSignIn = Condition.make(
 *   "on the sign-in page",
 *   (url: string) => url.endsWith("/sign-in")
 * )
 *
 * const signedIn = Effect.fn("signedIn")(function*(page: Page.ReadonlyPage) {
 *   yield* Expect.that(page.url, Condition.not(onSignIn))
 * })
 * ```
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
 * **Example** (Waiting for a total that is in euros and not zero)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const priced = Condition.and(
 *   Condition.make("in euros", (total: string) => total.startsWith("€")),
 *   Condition.make("not zero", (total: string) => total !== "€0.00")
 * )
 *
 * const totalled = Effect.fn("totalled")(function*(page: Page.ReadonlyPage) {
 *   yield* Expect.that(page.getByTestId("order-total").readText, priced)
 * })
 * ```
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
 * **Example** (Saying why the cart should be empty)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const empty = Condition.make("empty", (count: number) => count === 0).pipe(
 *   Condition.because("placing the order empties the cart")
 * )
 *
 * const emptied = Effect.fn("emptied")(function*(page: Page.ReadonlyPage) {
 *   yield* Expect.that(
 *     page.getByRole("list", { name: "Cart" }).getByRole("listitem").count,
 *     empty
 *   )
 * })
 * ```
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
