import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Deadline from "../src/Deadline.ts"
import * as Events from "../src/internal/events.ts"
import * as Target from "../src/Target.ts"

const kind: Events.Kind<string, string> = { operation: "test.next", noun: "an event", deliver: (value) => value }
const channel = () => Events.make<string>({ _tag: "Browser" }, () => 10)
const next = (events: Events.Channel<string>) =>
  Events.next<string, string, never, never>(kind, events, () => true, undefined)
const settled = <A, E>(wait: Effect.Effect<A, E>) =>
  Effect.exit(wait).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map((result) => {
      assert(Option.isSome(result), "the wait must complete")
      return result.value
    })
  )

describe("event wait terminal ordering", () => {
  it.live("interrupts a queued match without running delivery when the scope closes", () =>
    Effect.gen(function*() {
      const events = channel()
      let deliveries = 0
      const wait = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* Events.next<string, string, never, never>(
          {
            ...kind,
            deliver: (value) => {
              deliveries++
              return value
            }
          },
          events,
          () => true,
          undefined
        )
        Events.publish(events, "first")
        return wait
      }))
      const exit = yield* settled(wait)
      assert(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason))
      assert.strictEqual(deliveries, 0)
    }))

  it.live("fails with TargetGone when the target ended before the scope closes, though the worker hasn't run", () =>
    Effect.gen(function*() {
      const events = channel()
      const reason = new Target.BrowserCrashed({})
      const wait = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* next(events)
        Events.end(events, { normal: false, reason })
        return wait
      }))
      const exit = yield* settled(wait)
      assert(Exit.isFailure(exit), String(exit))
      const error = exit.cause.reasons.find((each) => each._tag === "Fail")
      assert(error !== undefined && Target.isTargetGone(error.error), String(exit.cause))
    }))

  it.live("fails with TargetGone when the channel had already ended at registration", () =>
    Effect.gen(function*() {
      const events = channel()
      Events.end(events, { normal: true, reason: new Target.BrowserClosed({}) })
      const exit = yield* settled(yield* Effect.scoped(next(events)))
      assert(Exit.isFailure(exit), String(exit))
      const error = exit.cause.reasons.find((each) => each._tag === "Fail")
      assert(error !== undefined && Target.isTargetGone(error.error), String(exit.cause))
    }))
})

describe("event wait subscription after its outcome", () => {
  it.live("stops receiving events after its first match", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = channel()
      const wait = yield* next(events)
      Events.publish(events, "first")
      assert.strictEqual(yield* wait, "first")
      assert.strictEqual(events.subscribers.size, 0)
    })))

  it.live("stops receiving events after its deadline", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = channel()
      const wait = yield* next(events).pipe(Deadline.within("20 millis"))
      assert(Deadline.isTimeout(yield* wait.pipe(Effect.flip)))
      assert.strictEqual(events.subscribers.size, 0)
    })))
})
