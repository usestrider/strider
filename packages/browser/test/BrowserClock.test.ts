/**
 * The browser's clock: a sleep ends no sooner than the clock it is read on says, though the timer beneath it fires
 * early, as Node's do by a fraction of a millisecond, so a deadline its timer said had passed has passed.
 */
import { assert, describe, it } from "@effect/vitest"
import type * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as BrowserClock from "../src/internal/browserClock.ts"

/** A clock whose timers fire 0.4 ms before the time they were set for, as Node's can: each sleep is counted. */
const early = () => {
  let nanos = 1_000_000_000n
  let sleeps = 0
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => Number(nanos / 1_000_000n),
    currentTimeMillis: Effect.sync(() => Number(nanos / 1_000_000n)),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.sync(() => nanos),
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.sync(() => nanos),
    sleep: (duration) =>
      Effect.sync(() => {
        sleeps++
        const asked = Duration.toNanos(duration)
        const millis = asked._tag === "Some" ? asked.value : 0n
        nanos += millis > 400_000n ? millis - 400_000n : 1n
      })
  }
  return { clock, sleeps: () => sleeps }
}

describe("BrowserClock", () => {
  it.effect("ends a sleep once its clock has moved the whole time, though a timer fired early", () =>
    Effect.gen(function*() {
      const { clock, sleeps } = early()
      const browser = BrowserClock.fromClock(clock)
      const at = browser.now() + 250 * 1e6
      yield* browser.sleep(250)
      assert.isAtLeast(browser.now(), at)
      assert.strictEqual(BrowserClock.millisLeft(browser, at as never), 0)
      assert.isAbove(sleeps(), 1)
    }))

  it.effect("sleeps once where the timer is on time", () =>
    Effect.gen(function*() {
      let nanos = 0n
      let sleeps = 0
      const onTime = {
        ...early().clock,
        monotonicTimeNanosUnsafe: () => nanos,
        sleep: (duration: Duration.Duration) =>
          Effect.sync(() => {
            sleeps++
            nanos += Duration.toNanos(duration).pipe((nanos) => nanos._tag === "Some" ? nanos.value : 0n)
          })
      } satisfies Clock.Clock
      yield* BrowserClock.fromClock(onTime).sleep(250)
      assert.strictEqual(sleeps, 1)
    }))
})
