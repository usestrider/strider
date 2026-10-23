/**
 * One deadline per operation (README, "One deadline per operation").
 *
 * An operation inside `within(duration)` shares that deadline with everything else inside, and nesting can
 * only shorten it. An operation with no enclosing deadline gets `DefaultBudget`, counted from when it starts.
 * Deadlines run on the live monotonic clock, even under `TestClock`.
 *
 * This isn't `Effect.timeout`. An operation reads its remaining budget and fails with its own evidence
 * (`Timeout`, with the phase it reached) instead of being interrupted from outside, so a click that timed
 * out after dispatching says so.
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
import * as Diagnostics from "./Diagnostics.ts"
import { now } from "./internal/adapter.ts"
import type * as MonotonicInstant from "./MonotonicInstant.ts"

/**
 * Sets one deadline for everything inside an effect.
 *
 * **Details**
 *
 * The deadline is the earlier of the enclosing one and `now + duration`, captured when the effect starts.
 * Every operation inside shares it: three clicks under `within("5 seconds")` have five seconds between them,
 * not five each.
 *
 * **Gotchas**
 *
 * An event wait takes the deadline in force where it subscribes, at `next`, not where it is awaited. Put
 * `within` around `next` to give a wait its own budget.
 *
 * **Example** (A shared budget for a checkout)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Deadline, Page } from "@usestrider/browser"
 *
 * const checkout = Effect.fn("checkout")(function*(page: Page.Page) {
 *   yield* page.getByLabel("Card number").fill("4242 4242 4242 4242")
 *   yield* page.getByRole("button", { name: "Pay" }).click()
 * }, Deadline.within("10 seconds"))
 * ```
 *
 * @see {@link withDefaultBudget} for the budget an operation gets when nothing encloses it
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const within: {
  (duration: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E, R> =>
    Effect.flatMap(CurrentDeadlineEffect, (enclosing) => {
      const own =
        (now() + Duration.toMillis(Duration.fromInputUnsafe(duration)) * 1e6) as MonotonicInstant.MonotonicInstant
      const deadline = Option.match(enclosing, { onNone: () => own, onSome: (at) => Math.min(at, own) })
      return Effect.provideService(self, CurrentDeadline, Option.some(deadline as MonotonicInstant.MonotonicInstant))
    })
)

/**
 * Sets the budget an operation gets when no deadline encloses it.
 *
 * **Details**
 *
 * The default is 30 seconds. An explicit deadline from `within` always wins over this budget. This is
 * `Effect.provideService` on `DefaultBudget`.
 *
 * @see {@link within} for an explicit deadline
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withDefaultBudget: {
  (duration: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E, R> =>
    Effect.provideService(self, DefaultBudget, Duration.fromInputUnsafe(duration))
)

/**
 * Reads the time left before the enclosing deadline, or `None` when there is none.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const remaining: Effect.Effect<Option.Option<Duration.Duration>> = Effect.suspend(() =>
  Effect.map(
    CurrentDeadlineEffect,
    Option.map((at) => Duration.millis(Math.max(0, (at - now()) / 1e6)))
  )
)

/**
 * Reference to the enclosing deadline, if any.
 *
 * **Gotchas**
 *
 * Read it freely, but set it only through `within`, which is what guarantees that nesting only shortens a
 * deadline. Providing it directly could lengthen one.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const CurrentDeadline: Context.Reference<Option.Option<MonotonicInstant.MonotonicInstant>> = Context
  .Reference<Option.Option<MonotonicInstant.MonotonicInstant>>("@usestrider/browser/Deadline/CurrentDeadline", {
    defaultValue: () => Option.none()
  })

const CurrentDeadlineEffect = Effect.service(CurrentDeadline)

/**
 * Reference to the budget an operation gets when no deadline encloses it; 30 seconds unless set.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const DefaultBudget: Context.Reference<Duration.Duration> = Context.Reference<Duration.Duration>(
  "@usestrider/browser/Deadline/DefaultBudget",
  { defaultValue: () => Duration.seconds(30) }
)

const TimeoutTypeId = "~@usestrider/browser/Deadline/Timeout"

/**
 * Error for an operation that ran out of budget, with where it got to.
 *
 * **Details**
 *
 * `phase` answers the question a timeout always raises:
 *
 * - `"resolving"`: the target was never found.
 * - `"waitingForCondition"`: found, but a check such as `visible` never passed.
 * - `"dispatchedUnconfirmed"`: the input was sent and its effect wasn't confirmed, so it may have happened.
 * - `"postcondition"`: the operation happened, and what it waits for afterwards didn't.
 * - `"waitingForEvent"`: an event wait (`next`) saw no matching event.
 *
 * `last` and `history` are the de-duplicated observations, and `hint` explains common causes, such as a
 * download that started before `Download.next` subscribed.
 *
 * **Example** (Recovering when a click may have happened)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Deadline, Page } from "@usestrider/browser"
 *
 * const pay = Effect.fn("pay")(function*(page: Page.Page, recheck: Effect.Effect<void>) {
 *   yield* page.getByRole("button", { name: "Pay" }).click().pipe(
 *     Deadline.within("5 seconds"),
 *     Effect.catchTag("Timeout", (timeout) =>
 *       timeout.phase === "dispatchedUnconfirmed" ? recheck : Effect.fail(timeout))
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class Timeout extends Schema.TaggedError<Timeout>(TimeoutTypeId)("Timeout", {
  operation: Schema.String,
  phase: Schema.Literals([
    "resolving",
    "waitingForCondition",
    "dispatchedUnconfirmed",
    "postcondition",
    "waitingForEvent"
  ]),
  budget: Schema.Duration,
  last: Schema.Option(Diagnostics.ObservedValue),
  history: Schema.Array(Diagnostics.ObservedValue),
  hint: Schema.Option(Schema.String),
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [TimeoutTypeId] = TimeoutTypeId
  override get message(): string {
    return `${this.operation} timed out while ${this.phase}`
  }
}

/**
 * Checks whether a value is a `Timeout`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isTimeout = (u: unknown): u is Timeout => Predicate.hasProperty(u, TimeoutTypeId)
