/**
 * What every event module shares: `next`, `stream` and `history`, the `where` predicate, and their errors.
 *
 * Each kind of event is a module of its own (`Download`, `Popup`, `NetworkResponse`, …) with the same three
 * functions. Waits look forward, and reads look back:
 *
 * - `next(target, filter?, where?)` subscribes by the time it returns, and gives back the wait: an effect whose
 *   value is the first match, the same each time it runs. Code order is subscription order, so call it before the
 *   action that causes the event. It keeps what arrives until its first match or its deadline, which starts at
 *   `next`.
 * - `stream(target, filter?, where?)` subscribes the same way and emits every match from then on, buffering at most
 *   `Capacity` events for a consumer that falls behind.
 * - `history(target, filter?)` reads what already happened from a bounded log, and never waits. Its filter is
 *   checked as the others' are, so a filter it can't apply fails it with `SubscriptionError` too.
 *
 * Events report and handlers decide (`Dialog.handle`, `FileChooser.handle`, `route`). Seeing an event doesn't make
 * anything yours: a popup belongs to the scope that owns its opener, and a download's file to its context.
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
import * as ReasonCause from "./internal/reasonCause.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import * as Reason from "./Reason.ts"

/**
 * The `where` predicate: an effect that checks each event the filter let through.
 *
 * **Details**
 *
 * The filter is data and is applied before buffering. `where` runs after it, in the fiber that runs the wait or
 * the stream, never as events arrive, so a slow or failing predicate can't hold up other subscribers. Its failure
 * `PE` and requirements `PR` join the wait's or the stream's.
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
 * It fails the call that took the filter (`next`, `stream` or `history`) before any event, never the wait or
 * the stream that call returns. An invalid filter, such as a malformed URL pattern, is `InvalidInput`, and one
 * that asks for events the backend can't report is `Unsupported`, naming the capability. `operation` names the
 * call, such as `NetworkResponse.next`.
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
 * It is read when a stream subscribes. A stream whose consumer falls further behind fails with `EventOverflow`
 * rather than losing events silently. `next` keeps what arrives until its first match or its deadline, so it needs
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
 * Sets the buffer size of every stream that subscribes inside an effect.
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
