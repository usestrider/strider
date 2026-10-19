/**
 * Deadlines (README, "One deadline per operation").
 *
 * An operation inside `Deadline.within(d)` shares that deadline with everything else inside, and nesting
 * can only shorten it. An operation with no enclosing deadline gets `DefaultBudget` from when it starts.
 * Deadlines run on the live monotonic clock, even under TestClock. Operations read the remaining budget and
 * fail with their own evidence (`Timeout{phase, …}`) rather than being interrupted from outside, which is
 * why this isn't `Effect.timeout`.
 */
import type { Context, Duration, Effect, Option } from "effect"
import type { MonotonicInstant } from "./Brand.ts"

/** A cross-cutting setting over any effect, data-first or in `pipe`. */
export interface Dual<X> {
  (x: X): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, x: X): Effect.Effect<A, E, R>
}

export declare const Deadline: {
  /** One deadline for everything inside: provides min(enclosing, now + duration), captured when the effect starts. */
  readonly within: Dual<Duration.Input>
  /** What an operation gets when no deadline encloses it; 30 seconds unless set. */
  readonly withDefaultBudget: Dual<Duration.Input>
  /** Time left before the enclosing deadline; None when there is none. */
  readonly remaining: Effect.Effect<Option.Option<Duration.Duration>>
  /** Read freely; set only through `within`, which is what guarantees it only ever shortens. */
  readonly Current: Context.Reference<Option.Option<MonotonicInstant>>
  /** `withDefaultBudget` is `Effect.provideService` on this reference. */
  readonly DefaultBudget: Context.Reference<Duration.Duration>
}
