/**
 * Retrying expectations (`Expect.to*` retries until the deadline).
 *
 * An expectation is `Reactivity.stream(keys, check)`: one check immediately, another each time the model
 * invalidates a key the subject depends on (a Watchable change, a DOM mutation in the subject's subtree), and,
 * for conditions with no change signal (layout, visibility), a fixed interval with no backoff. Everything runs
 * on the live clock, within the deadline. Accumulating several failures is Effect's job (`Effect.validate`).
 */
import type { Effect, Predicate } from "effect"
import type { AriaRole } from "./Brand.ts"
import type { Dual } from "./Deadline.ts"
import type { ExpectationFailed, TargetGone } from "./Errors.ts"
import type { ReadonlyLocator } from "./Locator.ts"
import type { ReadonlyPage } from "./Page.ts"

/** `locator.pipe(Expect.toHaveText("1 item"))` or `Expect.toHaveText(locator, "1 item")`. */
export interface DualMatcher<S, Args extends ReadonlyArray<unknown>> {
  (...args: Args): (subject: S) => Effect.Effect<void, ExpectationFailed | TargetGone>
  (subject: S, ...args: Args): Effect.Effect<void, ExpectationFailed | TargetGone>
}
type Matcher<S> = (subject: S) => Effect.Effect<void, ExpectationFailed | TargetGone>

export declare const Expect: {
  // no extra arguments: the matcher itself is the function
  readonly toBeVisible: Matcher<ReadonlyLocator>
  readonly toBeHidden: Matcher<ReadonlyLocator>         // passes when the element is missing
  readonly toBeEnabled: Matcher<ReadonlyLocator>
  readonly toBeDisabled: Matcher<ReadonlyLocator>
  readonly toBeChecked: Matcher<ReadonlyLocator>
  readonly toBeFocused: Matcher<ReadonlyLocator>
  readonly toBeEditable: Matcher<ReadonlyLocator>
  // with arguments: dual
  readonly toHaveText: DualMatcher<ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>]>
  readonly toContainText: DualMatcher<ReadonlyLocator, [expected: string | RegExp]>
  readonly toHaveValue: DualMatcher<ReadonlyLocator, [expected: string | RegExp]>
  readonly toHaveAttribute: DualMatcher<ReadonlyLocator, [name: string, expected?: string | RegExp]>
  readonly toHaveCount: DualMatcher<ReadonlyLocator, [count: number]>
  readonly toMatchAria: DualMatcher<ReadonlyLocator, [pattern: AriaPattern]>
  readonly toHaveURL: DualMatcher<ReadonlyPage, [expected: string | RegExp]>
  readonly toHaveTitle: DualMatcher<ReadonlyPage, [expected: string | RegExp]>
  /** The general form. A Watchable is re-checked on each change; any other Effect is re-run at the interval. */
  that<A, E, R>(subject: Effect.Effect<A, E, R>, condition: Condition<A>): Effect.Effect<void, E | ExpectationFailed | TargetGone, R>
  /** Re-check interval for subjects with no change signal; default 100 ms. */
  readonly withInterval: Dual<import("effect").Duration.Input>
}

declare const ConditionTypeId: unique symbol
export interface Condition<in A> { readonly [ConditionTypeId]: (a: A) => boolean }
export declare const Condition: {
  /** The description appears in ExpectationFailed. */
  make<A>(description: string, predicate: Predicate.Predicate<A>): Condition<A>
  not<A>(condition: Condition<A>): Condition<A>         // the wait is for the negation
  and<A>(...conditions: ReadonlyArray<Condition<A>>): Condition<A>   // evaluated against one observation
  because<A>(why: string): (condition: Condition<A>) => Condition<A>
}

/** Matched against ariaSnapshot (the pure accessibility tree); how children match is always stated. */
declare const AriaPatternTypeId: unique symbol
export interface AriaPattern { readonly [AriaPatternTypeId]: "AriaPattern" }
declare const ChildrenPatternTypeId: unique symbol
export interface ChildrenPattern { readonly [ChildrenPatternTypeId]: "ChildrenPattern" }
export declare const AriaPattern: {
  node(role: AriaRole, name: string | RegExp, children: ChildrenPattern): AriaPattern   // "" means no accessible name
  text(value: string | RegExp): AriaPattern
  exactly(...children: ReadonlyArray<AriaPattern>): ChildrenPattern    // these children, in this order, and no others
  including(...children: ReadonlyArray<AriaPattern>): ChildrenPattern  // these in this order; others may come between
  readonly unchecked: ChildrenPattern                                  // children are not compared
}
