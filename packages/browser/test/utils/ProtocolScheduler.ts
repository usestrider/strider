/**
 * Deterministic scheduling for adapter tests that play the browser over a fake transport, without launching one.
 */
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Scheduler from "effect/Scheduler"
import * as BrowserClock from "../../src/internal/browserClock.ts"

// Share one dispatcher across the protocol fibers so a checkpoint drains all runnable work,
// stopping only at an actual protocol reply or permit wait, without counting scheduler turns.
export const withProtocolScheduler = Effect.fnUntraced(function*<A, E, R>(
  run: (drain: Effect.Effect<void>) => Effect.Effect<A, E, R>
) {
  const parent = yield* Scheduler.Scheduler
  const dispatcher = parent.makeDispatcher()
  const checkpoint = parent.makeDispatcher()
  const drain = Effect.callback<void>((resume) => {
    checkpoint.scheduleTask(() => {
      dispatcher.flush()
      resume(Effect.void)
    }, 0)
  })
  return yield* run(drain).pipe(
    Effect.forkChild,
    Effect.flatMap(Fiber.join),
    Effect.provideService(Scheduler.Scheduler, {
      executionMode: parent.executionMode,
      shouldYield: (fiber) => parent.shouldYield(fiber),
      makeDispatcher: () => dispatcher
    })
  )
})

/** Advance deadlines without delays, retaining the live epoch used by the real protocol client's command deadline. */
export const onTestClock = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Clock.clockWith((clock) =>
    Effect.suspend(() => {
      const test = BrowserClock.fromClock(clock)
      const origin = BrowserClock.live.now() - test.now()
      return Effect.provideService(self, BrowserClock.CurrentClock, {
        now: () => (origin + test.now()) as ReturnType<typeof test.now>,
        sleep: test.sleep
      })
    })
  )
