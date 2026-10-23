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
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as AriaPattern from "./AriaPattern.ts"
import type * as Condition from "./Condition.ts"
import * as Diagnostics from "./Diagnostics.ts"
import { now } from "./internal/adapter.ts"
import type * as Engine from "./internal/engine.ts"
import { LocatorImpl } from "./internal/locator.ts"
import * as Operation from "./internal/operation.ts"
import * as Runtime from "./internal/runtime.ts"
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
export const toBeVisible: Matcher<Locator.ReadonlyLocator> = (locator) => visibility(locator, "visible")

/**
 * Expects the element to be hidden; passes when it is missing too.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeHidden: Matcher<Locator.ReadonlyLocator> = (locator) => visibility(locator, "hidden")

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
export const CheckInterval: Context.Reference<Duration.Duration> = Context.Reference<Duration.Duration>(
  "@usestrider/browser/Expect/CheckInterval",
  { defaultValue: () => Duration.millis(100) }
)

/**
 * Sets the check interval for every expectation inside an effect.
 *
 * @see {@link CheckInterval} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withCheckInterval: {
  (interval: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CheckInterval, Duration.fromInputUnsafe(interval))
)

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

// ── Visibility (review 12, candidate 5) ──

/** What one check of a locator's visibility saw. */
type Seen =
  | { readonly matches: number; readonly visible: number }
  /** `final`: it can't change while the expectation waits, so it fails at once. */
  | { readonly error: string; readonly final?: true }

const visibility = (subject: Locator.ReadonlyLocator, expected: "visible" | "hidden") =>
  Effect.gen(function*() {
    if (!(subject instanceof LocatorImpl)) return yield* Effect.die(new Error("Expect: not a locator of this library"))
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    const interval = Duration.toMillis(yield* Effect.service(CheckInterval))
    const started = now()
    const history: Array<Diagnostics.ObservedValue> = []
    const triggers = new Set<"initial" | "interval">(["initial"])
    let checks = 0
    const condition = expected === "visible" ? "to be visible" : "to be hidden"
    const failed = () =>
      new ExpectationFailed({
        subject: subject.description,
        condition,
        last: Option.fromNullishOr(history.at(-1)),
        history,
        elapsed: Duration.millis((now() - started) / 1e6),
        checks: { count: checks, triggeredBy: Array.from(triggers) },
        nearest: Option.none(),
        suggestions: [],
        diagnostics: Operation.diagnostics(id, { last: Option.fromNullishOr(history.at(-1)) })
      })
    while (true) {
      checks++
      const response = yield* Runtime.send(
        subject.owner.runtime,
        subject.owner.page,
        { op: "visible", steps: subject.steps },
        id,
        budget.at
      ).pipe(
        Effect.map((response): Engine.Response | Seen => response),
        Effect.catch((failure): Effect.Effect<Seen | null, Target.TargetGone> =>
          failure._tag === "Gone"
            ? Effect.fail(failure.error)
            : failure._tag === "Deadline"
            ? Effect.succeed(null)
            // A dialog nothing will decide holds the page until someone else decides it
            : failure.reason._tag === "PromptBlocking"
            ? Effect.succeed({ error: failure.reason.message, final: true as const })
            : Effect.succeed({ error: failure.reason.message })
        )
      )
      if (response === null) return yield* Effect.fail(failed())
      const seen: Seen = "_tag" in response
        ? response._tag === "Visible"
          ? { matches: response.count, visible: response.visible ? 1 : 0 }
          : response._tag === "Strict"
          ? { matches: response.count, visible: response.candidates.filter((each) => each.visible).length }
          : response._tag === "InvalidSelector"
          ? {
            error: `invalid selector ${JSON.stringify(response.selector)}: ${response.message}`,
            final: true as const
          }
          : { error: `unexpected answer ${response._tag}` }
        : response
      Operation.appendObservation(history, seen)
      // A selector that doesn't parse never will
      if ("error" in seen && seen.final === true) return yield* Effect.fail(failed())
      if ("matches" in seen) {
        if (expected === "visible" && seen.matches === 1 && seen.visible === 1) return
        if (expected === "hidden" && seen.visible === 0) return
      }
      const left = Operation.millisLeft(budget.at)
      if (left <= 0) return yield* Effect.fail(failed())
      triggers.add("interval")
      yield* Effect.sleep(Math.min(interval, left))
    }
  }).pipe(
    Effect.withSpan(`Expect.${expected === "visible" ? "toBeVisible" : "toBeHidden"}`, {
      attributes: { "browser.locator": subject instanceof LocatorImpl ? subject.description : "unknown" }
    })
  )
