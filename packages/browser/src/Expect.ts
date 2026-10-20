/**
 * Retrying expectations: each `Expect.to*` checks until it passes or the deadline ends.
 *
 * An expectation is `Reactivity.stream(keys, check)`: one check at once, another whenever the model
 * invalidates a key the subject depends on (a `Watchable` change, a DOM mutation in the subject's subtree),
 * and, for conditions with no change signal, such as layout and visibility, a fixed interval with no backoff.
 * Everything runs on the live clock, within the deadline. Collecting several failures is Effect's job:
 * `Effect.validate`, or `Effect.all(…, { mode: "result" })`.
 *
 * Matchers that take arguments are duals: `locator.pipe(Expect.toHaveText("1 item"))` or
 * `Expect.toHaveText(locator, "1 item")`. Matchers without arguments are the function itself:
 * `locator.pipe(Expect.toBeVisible)`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as AriaPattern from "./AriaPattern.ts"
import type * as Condition from "./Condition.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as Locator from "./Locator.ts"
import type * as Page from "./Page.ts"
import type * as Target from "./Target.ts"

/**
 * A matcher with no arguments: the expectation itself.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Matcher<S> = (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>

/**
 * A matcher with arguments, usable data-first or in `pipe`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DualMatcher<S, Args extends ReadonlyArray<unknown>> {
  (...args: Args): (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>
  (subject: S, ...args: Args): Effect.Effect<void, ExpectationFailed | Target.TargetGone>
}

/**
 * Expects the one match to be visible.
 *
 * **Example** (Waiting for a welcome message)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Expect, Page } from "@usestrider/browser"
 *
 * const welcomed = Effect.fn("welcomed")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeVisible: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the element to be hidden; passes when it is missing too.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeHidden: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the one match to be enabled.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeEnabled: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the one match to be disabled.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeDisabled: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the one match to be checked.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeChecked: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the one match to have focus.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeFocused: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the one match to accept input.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toBeEditable: Matcher<Locator.ReadonlyLocator>

/**
 * Expects the rendered text to match: of the one match, or of each match in order when given a list.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toHaveText: DualMatcher<
  Locator.ReadonlyLocator,
  [expected: string | RegExp | ReadonlyArray<string | RegExp>]
>

/**
 * Expects the rendered text of the one match to contain `expected`.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toContainText: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]>

/**
 * Expects the value of the one matching form control to match.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toHaveValue: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]>

/**
 * Expects the one match to have the attribute, with a matching value when one is given.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toHaveAttribute: DualMatcher<
  Locator.ReadonlyLocator,
  [name: string, expected?: string | RegExp | undefined]
>

/**
 * Expects exactly `count` matches.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toHaveCount: DualMatcher<Locator.ReadonlyLocator, [count: number]>

/**
 * Expects the one match's accessibility tree to match a pattern.
 *
 * **Example** (A navigation with an Orders link)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const hasOrdersLink = (page: Page.ReadonlyPage) =>
 *   page.getByRole("navigation").pipe(Expect.toMatchAria(
 *     AriaPattern.node("navigation", "Main", AriaPattern.including(
 *       AriaPattern.node("link", "Orders", AriaPattern.unchecked)
 *     ))
 *   ))
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toMatchAria: DualMatcher<Locator.ReadonlyLocator, [pattern: AriaPattern.AriaPattern]>

/**
 * Expects the page's URL to match.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toHaveURL: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]>

/**
 * Expects the page's title to match.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const toHaveTitle: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]>

/**
 * Expects any subject to satisfy a condition, checking until it does or the deadline ends.
 *
 * **Details**
 *
 * A `Watchable` subject is checked again on each change. Any other effect is run again at the check
 * interval.
 *
 * **Example** (A download that finishes)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Condition, Download, Expect } from "@usestrider/browser"
 *
 * const completed = (download: Download.Download) =>
 *   Expect.that(download.status, Condition.make("completed", (status) => status._tag === "Completed"))
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export declare const that: <A, E, R>(
  subject: Effect.Effect<A, E, R>,
  condition: Condition.Condition<A>
) => Effect.Effect<void, E | ExpectationFailed | Target.TargetGone, R>

/**
 * Reference to how often a subject with no change signal is checked again; 100 ms unless set.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export declare const CheckInterval: Context.Reference<Duration.Duration>

/**
 * Sets the check interval for every expectation inside an effect.
 *
 * @see {@link CheckInterval} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export declare const withCheckInterval: {
  (interval: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R>
}

const ExpectationFailedTypeId = "~@usestrider/browser/Expect/ExpectationFailed"

/**
 * Error for an expectation that didn't pass before the deadline.
 *
 * **Details**
 *
 * - `last` and `history` are the de-duplicated observations, which answer "was it ever right?".
 * - `checks` says how many checks ran and what triggered them.
 * - `nearest` is a snapshot of the nearest existing ancestor when nothing matched.
 * - `suggestions` are locators that would have matched.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ExpectationFailed extends Schema.TaggedError<ExpectationFailed>(ExpectationFailedTypeId)(
  "ExpectationFailed",
  {
    subject: Schema.String,
    condition: Schema.String,
    last: Schema.Option(Diagnostics.ObservedValue),
    history: Schema.Array(Diagnostics.ObservedValue),
    elapsed: Schema.Duration,
    checks: Schema.Struct({
      count: Schema.Int,
      triggeredBy: Schema.Array(Schema.Literals(["initial", "change", "interval"]))
    }),
    nearest: Schema.Option(Schema.String),
    suggestions: Schema.Array(Schema.String),
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [ExpectationFailedTypeId] = ExpectationFailedTypeId
  override get message(): string {
    return `Expected ${this.subject} ${this.condition}`
  }
}

/**
 * Checks whether a value is an `ExpectationFailed`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isExpectationFailed = (u: unknown): u is ExpectationFailed =>
  Predicate.hasProperty(u, ExpectationFailedTypeId)
