/**
 * The clock the browser runs on, which every deadline and every wait on the browser reads,
 * never the fiber's `Clock`. A real browser's is the live monotonic clock, which `TestClock` never moves: the
 * browser is another process, so a deadline on the test clock would never fire and a poll would never come round.
 * `Browser.layerTest`'s browser is a timeline on Effect's clock, so its clock is the `Clock` its layer was built with.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import { now } from "./adapter.ts"

/** How a browser's time is read and waited on. */
export interface BrowserClock {
  /** Now, on this clock. */
  readonly now: () => MonotonicInstant.MonotonicInstant
  /** Waits `millis` on this clock. */
  readonly sleep: (millis: number) => Effect.Effect<void>
}

/** A browser's clock from an Effect `Clock`'s monotonic time. */
export const fromClock = (clock: Clock.Clock): BrowserClock => ({
  now: () => Number(clock.monotonicTimeNanosUnsafe()) as MonotonicInstant.MonotonicInstant,
  sleep: (millis) => clock.sleep(Duration.millis(millis))
})

/** Effect's live `Clock`, which `TestClock` doesn't replace for whoever holds it. */
const liveClock: Clock.Clock = Clock.Clock.defaultValue()

/** The live monotonic clock: a real browser's, read as `Adapter.now` reads it. */
export const live: BrowserClock = { now, sleep: fromClock(liveClock).sleep }

/**
 * Runs `self` with the live clock as its `Clock`, so its timers and schedules run in real time under `TestClock`:
 * a real browser's launch, polls and protocol waits.
 */
export const onLive = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(self, Clock.Clock, liveClock)

/** The clock of the browser the program drives; live unless its layer sets another. */
export const CurrentClock: Context.Reference<BrowserClock> = Context.Reference<BrowserClock>(
  "@usestrider/browser/internal/BrowserClock/CurrentClock",
  { defaultValue: () => live }
)

/** Milliseconds left before `at` on `clock`, at least 0. */
export const millisLeft = (clock: BrowserClock, at: MonotonicInstant.MonotonicInstant): number =>
  Math.max(0, (at - clock.now()) / 1e6)

/** Milliseconds left before `at` on the browser's clock, at least 0. */
export const left = (at: MonotonicInstant.MonotonicInstant): Effect.Effect<number> =>
  Effect.map(Effect.service(CurrentClock), (clock) => millisLeft(clock, at))

/** The instant `millis` from now on the browser's clock. */
export const after = (millis: number): Effect.Effect<MonotonicInstant.MonotonicInstant> =>
  Effect.map(Effect.service(CurrentClock), (clock) => (clock.now() + millis * 1e6) as MonotonicInstant.MonotonicInstant)

/** Waits `millis` on the browser's clock. */
export const sleep = (millis: number): Effect.Effect<void> =>
  Effect.flatMap(Effect.service(CurrentClock), (clock) => clock.sleep(millis))

/** `self`'s value, or `None` after `millis` on `clock`: `Effect.timeoutOption` on that clock. */
// Deliberately not `Effect.timeoutOption`, which sleeps on the fiber's `Clock`: under `TestClock` a real browser's
// wait would never end. The race sleeps on the browser's clock instead, the live one for a real browser
export const timeoutOn = (clock: BrowserClock, millis: number) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.raceFirst(Effect.asSome(self), Effect.as(clock.sleep(millis), Option.none()))

/** `self`'s value, or `None` after `millis` on the browser's clock. */
export const timeoutOption = (millis: number) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.flatMap(
    Effect.service(CurrentClock),
    (clock): Effect.Effect<Option.Option<A>, E, R> => timeoutOn(clock, millis)(self)
  )

/** `self`'s value, or `None` once `at` passes on the browser's clock. */
export const until = (at: MonotonicInstant.MonotonicInstant) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.flatMap(
    Effect.service(CurrentClock),
    (clock): Effect.Effect<Option.Option<A>, E, R> => timeoutOn(clock, millisLeft(clock, at))(self)
  )
