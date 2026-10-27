/**
 * What every event module shares: `next`, `stream` and `history`, the `where` predicate, and their errors.
 *
 * Each kind of event is a module of its own (`Download`, `Popup`, `NetworkResponse`, …) with the same three
 * functions. Waits look forward, and reads look back:
 *
 * - `next(target, filter?, where?)` subscribes by the time it returns, and gives back the wait: an effect whose
 *   value is the first match, the same each time it runs. Call it before the action that causes the event. It
 *   keeps what arrives until its first match or its deadline, which starts at `next`.
 * - `stream(target, filter?, where?)` subscribes the same way and emits every match from then on, buffering at most
 *   `Capacity` events for a consumer that falls behind.
 * - `history(target, filter?)` reads what already happened from a bounded log, and never waits. A filter it can't
 *   apply fails it with `SubscriptionError`, as it does the others.
 *
 * Seeing an event decides nothing and makes nothing yours. Handlers decide (`Dialog.handle`, `FileChooser.handle`,
 * `route`), a popup belongs to the scope that owns its opener, and a download's file to its context.
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
 * It's the argument after the filter, so its parameter is typed by the filter, such as a decoded body. The filter
 * is data, applied before buffering. `where` runs after it in the subscriber's own fiber, never as events arrive,
 * so a slow or failing predicate holds up no other subscriber. Its failure `PE` fails the wait or the stream, and
 * its requirements `PR` are the `next` or `stream` call's.
 *
 * **Example** (Matching a download by its file name)
 *
 * ```ts import.meta.vitest
 * import { Download, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const exportCsv = Effect.fn("exportCsv")(function*(page: Page.Page) {
 *   const csv = yield* Download.next(
 *     page,
 *     {},
 *     (download) => Effect.succeed(download.suggestedFilename.endsWith(".csv"))
 *   )
 *   yield* page.getByRole("button", { name: "Export" }).click()
 *   return yield* csv
 * })
 * ```
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
 * `dropped` counts every event of the kind that the target's log discarded, whether the filter would have
 * matched it or not, so it's an upper bound on the matches lost; `0` means `entries` is complete. The log's size
 * is `UserContext.Options.eventLog`.
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
 * import { NetworkRequest, Page, Subscription } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
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
 * It fails the call that took the filter (`next`, `stream` or `history`), before any event, never the wait or
 * the stream that call returns. An invalid filter, such as a malformed URL pattern, is `InvalidInput`, and one
 * that asks for events the backend can't report is `Unsupported`, naming the capability. `operation` names the
 * call, such as `NetworkResponse.next`.
 *
 * **Example** (Skipping a download the browser can't report)
 *
 * ```ts import.meta.vitest
 * import { Download, Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const exportReport = Effect.fn("exportReport")(function*(page: Page.Page) {
 *   const download = yield* Download.next(page).pipe(
 *     Effect.map(Option.some),
 *     Effect.catchReason("SubscriptionError", "Unsupported", () => Effect.succeedNone)
 *   )
 *   yield* page.getByRole("button", { name: "Export" }).click()
 *   if (Option.isSome(download)) {
 *     const file = yield* download.value
 *     yield* file.saveAs("./report.csv")
 *   }
 * })
 * ```
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
 * It's read when a stream subscribes. A stream whose consumer falls further behind fails with `EventOverflow`.
 * `next` has no bound: it keeps what arrives until its first match or its deadline.
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
 * **Example** (Logging every request without falling behind)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page, Subscription } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const logRequests = Effect.fn("logRequests")(function*(page: Page.ObservedPage) {
 *   const requests = yield* NetworkRequest.stream(page).pipe(
 *     Subscription.withCapacity(10_000)
 *   )
 *   yield* requests.pipe(
 *     Stream.runForEach((request) => Effect.log(`${request.method} ${request.url}`))
 *   )
 * })
 * ```
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
 * Only that stream fails; other subscriptions to the same events go on. `bound` is its buffer's size
 * (`Capacity`) and `at` is when it overflowed.
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
