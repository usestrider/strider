/**
 * The clock a deadline runs on: the one the browser runs on (review 26, candidate 1). A real browser's is the live
 * monotonic clock, which `TestClock` never moves: the browser is another process, so a deadline on the test clock
 * would never fire. Every deadline reads it here, never Effect's `Clock`.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import { now } from "./adapter.ts"

/** How a deadline is measured and waited for. */
export interface DeadlineClock {
  /** Now, on this clock. */
  readonly now: () => MonotonicInstant.MonotonicInstant
  /** Waits `millis` on this clock. */
  readonly sleep: (millis: number) => Effect.Effect<void>
}

/** The live monotonic clock: a real browser's. */
export const live: DeadlineClock = {
  now,
  sleep: (millis) =>
    Effect.callback<void>((resume) => {
      const timer = setTimeout(() => resume(Effect.void), millis)
      return Effect.sync(() => clearTimeout(timer))
    })
}

/** The clock deadlines run on; live unless set. */
export const CurrentClock: Context.Reference<DeadlineClock> = Context.Reference<DeadlineClock>(
  "@usestrider/browser/internal/DeadlineClock/CurrentClock",
  { defaultValue: () => live }
)

/** Milliseconds left before `at` on `clock`, at least 0. */
export const millisLeft = (clock: DeadlineClock, at: MonotonicInstant.MonotonicInstant): number =>
  Math.max(0, (at - clock.now()) / 1e6)

/** `self`'s value, or `None` once `at` passes on the deadline's clock: `Effect.timeoutOption` on that clock. */
export const until = (at: MonotonicInstant.MonotonicInstant) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.flatMap(
    Effect.service(CurrentClock),
    (clock): Effect.Effect<Option.Option<A>, E, R> =>
      Effect.raceFirst(Effect.asSome(self), Effect.as(clock.sleep(millisLeft(clock, at)), Option.none()))
  )
