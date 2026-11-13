/**
 * Time limits for operations: one deadline covers everything an operation does.
 *
 * Inside `within(duration)`, every operation shares that one deadline, and a deadline nested inside it can only be
 * shorter. An operation with no deadline around it gets `DefaultBudget`, counted from when it starts. Deadlines run
 * on the clock the browser runs on: for a real browser, the real monotonic clock, even under `TestClock`.
 *
 * Unlike `Effect.timeout`, nothing interrupts an operation from outside: it reads the time it has left and, when
 * that runs out, fails with its own `Timeout`, which says how far it got, such as whether a click was sent.
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
import * as BrowserClock from "./internal/browserClock.ts"
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
 * import { Deadline, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
    Effect.flatMap(Effect.all([CurrentDeadlineEffect, BrowserClockEffect]), ([enclosing, clock]) => {
      // A duration without end has no nanoseconds: its deadline never comes
      const nanos = Option.match(Duration.toNanos(duration), { onNone: () => Infinity, onSome: Number })
      const own = (clock.now() + nanos) as MonotonicInstant.MonotonicInstant
      const deadline = Option.match(enclosing, { onNone: () => own, onSome: (at) => Math.min(at, own) })
      return Effect.provideService(self, CurrentDeadline, Option.some(deadline as MonotonicInstant.MonotonicInstant))
    })
)

/**
 * Sets the budget an operation gets when no deadline encloses it.
 *
 * **Details**
 *
 * Each operation gets the whole budget, counted from when it starts. The default is 30 seconds. A deadline from
 * `within` always wins over this budget, whether it's shorter or longer.
 *
 * **Example** (More time for each step of a slow report)
 *
 * ```ts import.meta.vitest
 * import { Deadline, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const nightlyReport = Effect.fn("nightlyReport")(function*(page: Page.Page) {
 *   yield* page.goto("https://app.example.com/reports/nightly")
 *   yield* page.getByRole("button", { name: "Generate" }).click()
 * }, Deadline.withDefaultBudget("2 minutes"))
 * ```
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
 * **Example** (Skipping an optional step when time is short)
 *
 * ```ts import.meta.vitest
 * import { Deadline, Page } from "@usestrider/browser"
 * import { Duration, Effect, Option } from "effect"
 *
 * const placeOrder = Effect.fn("placeOrder")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Place order" }).click()
 *   const left = yield* Deadline.remaining
 *   if (Option.exists(left, Duration.isGreaterThan(Duration.seconds(5)))) {
 *     yield* page.getByRole("link", { name: "Download receipt" }).click()
 *   }
 * }, Deadline.within("20 seconds"))
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const remaining: Effect.Effect<Option.Option<Duration.Duration>> = Effect.suspend(() =>
  Effect.map(
    Effect.all([CurrentDeadlineEffect, BrowserClockEffect]),
    ([enclosing, clock]) => Option.map(enclosing, (at) => Duration.millis(BrowserClock.millisLeft(clock, at)))
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

const BrowserClockEffect = Effect.service(BrowserClock.CurrentClock)

/**
 * Reference to the budget an operation gets when no deadline encloses it; 30 seconds unless set.
 *
 * **Details**
 *
 * It also bounds closing a page you own, and removing a context Strider created, when its scope closes, whatever
 * deadline encloses the scope: the close waits up to this long for the browser to report the page or the context
 * ended, then stops waiting and leaves it as it is, though the command it sent goes on. Halfway through, a close
 * still waiting logs a warning naming the page or the context and what it waits on: the browser's answer to the
 * command, or the end, or for a context the pages that haven't ended. It warns again if it stops waiting with the
 * page or the context still open.
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
 * Error for an operation that ran out of time, saying how far it got.
 *
 * **Details**
 *
 * `phase` says how far the operation got:
 *
 * - `"resolving"`: the target was never found.
 * - `"waitingForCondition"`: found, but a check such as `visible` never passed, or a `waitFor` predicate never
 *   held.
 * - `"dispatchedUnconfirmed"`: the input was sent and its effect wasn't confirmed, so it may have happened.
 * - `"postcondition"`: the operation happened, and what it waits for afterwards didn't.
 * - `"waitingForEvent"`: an event wait (`next`) saw no matching event.
 *
 * `history` is what the operation observed, with consecutive repeats dropped, and `last` is the latest of it.
 * Locator actions return their first readiness observation without waiting in the page. Replies must arrive
 * before the deadline to enter history; if none arrives, history can be empty. Late replies cannot change it.
 * `hint` explains common causes, such as a download that started before `Download.next` subscribed.
 *
 * **Example** (Recovering when a click may have happened)
 *
 * ```ts import.meta.vitest
 * import { Deadline, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const pay = Effect.fn("pay")(function*(page: Page.Page, recheck: Effect.Effect<void>) {
 *   yield* page.getByRole("button", { name: "Pay" }).click().pipe(
 *     Deadline.within("5 seconds"),
 *     Effect.catchTag(
 *       "Timeout",
 *       (timeout) =>
 *         timeout.phase === "dispatchedUnconfirmed" ? recheck : Effect.fail(timeout)
 *     )
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
