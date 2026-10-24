/**
 * What every event module shares: the three verbs, caller predicates, history and their errors.
 *
 * Each event type is its own module (`Download`, `Popup`, `NetworkResponse`, …) with the same three verbs
 * (principle 5, "Waits look forward; reads look back"):
 *
 * - `next(target, filter?, where?)` subscribes by the time its effect returns and hands back the first match
 *   as a `ReadonlyDeferred`. Code order is subscription order, so call it before the action that causes the
 *   event. It keeps what arrives until its first match or its deadline.
 * - `stream(target, filter?, where?)` subscribes the same way and emits every match from then on, buffering
 *   at most `Capacity` events for a consumer that falls behind.
 * - `history(target, filter?)` reads what already happened from a bounded log and never waits. Its filter is
 *   checked as the others' are, so a filter it can't apply fails it with `SubscriptionError` too.
 *
 * Events report; handlers decide (`Dialog.handle`, `FileChooser.handle`, `route`). Seeing an event acquires
 * nothing: a popup belongs to the scope that acquired its opener, and a download's file to its context.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Diagnostics from "./Diagnostics.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import * as Reason from "./Reason.ts"

/**
 * A caller predicate over events, applied after the filter.
 *
 * **Details**
 *
 * The filter is data and is applied before buffering. `where` runs after it, in the subscriber and never on
 * the ingestion path, so a slow or failing predicate can't hold up other subscribers. Its failure `PE` and
 * requirements `PR` join the subscription's.
 *
 * **Gotchas**
 *
 * `where` is a separate trailing argument, not a filter field, so that its parameter type can be inferred from
 * the filter (a decoded body, say). TypeScript can't infer that for a callback inside the same object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Where<A, PE, PR> = (event: A) => Effect.Effect<boolean, PE, PR>

/**
 * What a bounded event log retained, oldest first.
 *
 * **Details**
 *
 * `dropped` counts every event of the kind the log discarded for its target, so a truncated log doesn't look
 * complete. Which of them a filter would have matched can't be known once they're gone, so it is an upper
 * bound on the matches lost, and `0` proves the entries are complete. The cap is `UserContext.Options.eventLog`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface History<A> {
  readonly entries: ReadonlyArray<A>
  readonly dropped: number
}

/**
 * Creates the schema for the history of an event that is data, such as `NetworkRequest`.
 *
 * **When to use**
 *
 * Use to encode a history for export, such as to JSON for the CLI or a test artifact.
 *
 * **Example** (Encoding request history)
 *
 * ```ts import.meta.vitest
 * import { Effect, Schema } from "effect"
 * import { NetworkRequest, Page, Subscription } from "@usestrider/browser"
 *
 * const RequestHistory = Subscription.History(NetworkRequest.NetworkRequest)
 *
 * const exportRequests = Effect.fn("exportRequests")(function*(page: Page.ObservedPage) {
 *   const history = yield* NetworkRequest.history(page)
 *   return yield* Schema.encodeEffect(Schema.fromJsonString(RequestHistory))(history)
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const History = <S extends Schema.Top>(entry: S) =>
  Schema.Struct({
    entries: Schema.Array(entry),
    dropped: Schema.Int
  })

/**
 * Schema for the reasons subscribing can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SubscriptionErrorReason = Schema.Union([
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons subscribing can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SubscriptionErrorReason = typeof SubscriptionErrorReason.Type

const SubscriptionErrorTypeId = "~@usestrider/browser/Subscription/SubscriptionError"

/**
 * Error for a subscription that couldn't be set up, or a log that couldn't be read, such as for a filter the
 * backend can't apply.
 *
 * **Details**
 *
 * It fails the call that took the filter, `next`, `stream` or `history`, before any event, never the awaited
 * result: a filter that doesn't compile is `InvalidInput`, and one that asks for events the backend can't
 * report is `Unsupported`, naming the capability. `operation` names the call, such as `NetworkResponse.next`.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class SubscriptionError extends Schema.TaggedError<SubscriptionError>(SubscriptionErrorTypeId)(
  "SubscriptionError",
  {
    operation: Schema.String,
    reason: SubscriptionErrorReason,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [SubscriptionErrorTypeId] = SubscriptionErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `SubscriptionError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isSubscriptionError = (u: unknown): u is SubscriptionError =>
  Predicate.hasProperty(u, SubscriptionErrorTypeId)

/**
 * Reference to how many events a `stream` buffers for a consumer that falls behind; 1,000 unless set.
 *
 * **Details**
 *
 * It is read when a stream subscribes. A consumer that falls further behind fails with `EventOverflow` rather
 * than losing events silently. `next` keeps what arrives until its first match or its deadline, so it needs
 * no bound.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const Capacity: Context.Reference<number> = Context.Reference<number>(
  "@usestrider/browser/Subscription/Capacity",
  { defaultValue: () => 1000 }
)

/**
 * Sets how many events every stream subscribed inside an effect buffers.
 *
 * @see {@link Capacity} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withCapacity: {
  (capacity: number): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, capacity: number): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, capacity: number): Effect.Effect<A, E, R> =>
    Effect.provideService(self, Capacity, capacity)
)

const EventOverflowTypeId = "~@usestrider/browser/Subscription/EventOverflow"

/**
 * Error for a stream whose consumer fell further behind than its buffer allows.
 *
 * **Details**
 *
 * Event streams are bounded, so a stalled consumer can't grow memory without limit. The stream fails rather
 * than dropping events silently; `bound` is the buffer size and `at` is when it overflowed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class EventOverflow extends Schema.TaggedError<EventOverflow>(EventOverflowTypeId)("EventOverflow", {
  bound: Schema.Int,
  at: MonotonicInstant.MonotonicInstant,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [EventOverflowTypeId] = EventOverflowTypeId
  override get message(): string {
    return `A consumer fell more than ${this.bound} events behind`
  }
}

/**
 * Checks whether a value is an `EventOverflow`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isEventOverflow = (u: unknown): u is EventOverflow => Predicate.hasProperty(u, EventOverflowTypeId)
