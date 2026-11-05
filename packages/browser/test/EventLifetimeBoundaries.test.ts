import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Deadline from "../src/Deadline.ts"
import * as Events from "../src/internal/events.ts"
import * as Target from "../src/Target.ts"

const kind: Events.Kind<string, string> = { operation: "test.next", noun: "an event", deliver: (value) => value }
const channel = () => Events.make<string>({ _tag: "Browser" }, () => 10)

describe("event subscription lifetime boundaries", () => {
  it.live("interrupts a pending wait after its delivery worker starts", () =>
    Effect.gen(function*() {
      const events = channel()
      const entered = yield* Deferred.make<void>()
      const wait = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* Events.next(kind, events, () =>
          true, () =>
          Effect.andThen(Deferred.succeed(entered, undefined), Effect.never))
        Events.publish(events, "ready")
        yield* Deferred.await(entered)
        return wait
      }))
      assert.strictEqual(events.subscribers.size, 0)
      const result = yield* Effect.exit(wait).pipe(Effect.timeoutOption("1 second"))
      assert(Option.isSome(result))
      assert(Exit.isFailure(result.value) && result.value.cause.reasons.some(Cause.isInterruptReason))
    }))

  it.live("keeps the subscription after consumer interruption and latches a completed result across scope closure", () =>
    Effect.gen(function*() {
      const events = channel()
      const started = yield* Deferred.make<void>()
      const completed = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* Events.next<string, string, never, never>(kind, events, () => true, undefined)
        const consumer = yield* Effect.andThen(Deferred.succeed(started, undefined), wait).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Fiber.interrupt(consumer)
        const interrupted = yield* Fiber.await(consumer)
        assert(Exit.isFailure(interrupted) && interrupted.cause.reasons.some(Cause.isInterruptReason))
        assert.strictEqual(events.subscribers.size, 1)
        Events.publish(events, "first")
        const value = yield* wait
        Events.publish(events, "second")
        assert.strictEqual(yield* wait, value)
        return { wait, value }
      }))
      assert.strictEqual(events.subscribers.size, 0)
      assert.strictEqual(completed.value, "first")
      assert.strictEqual(yield* completed.wait, "first")
    }))

  it.live("preserves a registration deadline and its latched timeout after scope closure", () =>
    Effect.gen(function*() {
      const completed = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* Events.next<string, string, never, never>(kind, channel(), () => true, undefined).pipe(
          Deadline.within("20 millis")
        )
        const error = yield* wait.pipe(Deadline.within("5 seconds"), Effect.flip)
        assert(Deadline.isTimeout(error))
        assert.strictEqual(error.phase, "waitingForEvent")
        return { wait, error }
      }))
      assert.strictEqual(yield* completed.wait.pipe(Effect.flip), completed.error)
    }))

  it.live("preserves a predicate failure after scope closure", () =>
    Effect.gen(function*() {
      const events = channel()
      const completed = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* Events.next(kind, events, () => true, () => Effect.fail("rejected"))
        Events.publish(events, "ready")
        assert.strictEqual(yield* wait.pipe(Effect.flip), "rejected")
        return wait
      }))
      assert.strictEqual(yield* completed.pipe(Effect.flip), "rejected")
    }))

  for (const normal of [true, false]) {
    it.live(`preserves target-end failure when normal is ${normal}`, () =>
      Effect.gen(function*() {
        const events = channel()
        const reason = normal ? new Target.BrowserClosed({}) : new Target.BrowserCrashed({})
        const completed = yield* Effect.scoped(Effect.gen(function*() {
          const wait = yield* Events.next<string, string, never, never>(kind, events, () => true, undefined)
          Events.end(events, { normal, reason })
          const error = yield* wait.pipe(Effect.flip)
          assert(Target.isTargetGone(error))
          assert.strictEqual(error.reason, reason)
          return { wait, error }
        }))
        assert.strictEqual(yield* completed.wait.pipe(Effect.flip), completed.error)
      }))
  }
})
