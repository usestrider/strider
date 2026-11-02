/**
 * A watchable's `changes` (README, principle 16; CONCEPTS.md §9): the current value first, then the latest value
 * whenever the consumer takes one, so a slow consumer skips the values it was too slow for, and never sees one
 * repeated; it ends after the terminal state.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Watchable from "../src/internal/watchable.ts"
import * as Target from "../src/Target.ts"

/** A watchable over a number, ended once it reaches 100. */
const counter = Effect.map(SubscriptionRef.make<number>(0), (ref) => ({
  ref,
  watchable: Watchable.make({
    ref,
    project: (state: number) => Option.some(state),
    ended: (state: number): Option.Option<Target.CloseReason> =>
      state >= 100 ? Option.some(new Target.PageClosed({ by: "command" })) : Option.none(),
    target: { _tag: "Page", id: "page-1" as never },
    operation: "Test.changes"
  })
}))

describe("Watchable", () => {
  it.effect("conflates for a slow consumer, and ends after the terminal state", () =>
    Effect.gen(function*() {
      const { ref, watchable } = yield* counter
      const taken = yield* Queue.unbounded<number>()
      const release = yield* Queue.unbounded<void>()
      // A consumer that takes one value, then waits until told before taking the next
      const consumer = yield* watchable.changes.pipe(
        Stream.runForEach((value) => Effect.andThen(Queue.offer(taken, value), Queue.take(release))),
        Effect.forkChild
      )
      assert.strictEqual(yield* Queue.take(taken), 0)
      // While it's busy, the value moves on four times and comes back to where it was before the last
      for (const value of [1, 2, 3, 2]) yield* SubscriptionRef.set(ref, value)
      yield* Effect.yieldNow
      yield* Queue.offer(release, undefined)
      assert.strictEqual(yield* Queue.take(taken), 2)
      yield* SubscriptionRef.set(ref, 100)
      yield* Effect.yieldNow
      yield* Queue.offer(release, undefined)
      assert.strictEqual(yield* Queue.take(taken), 100)
      yield* Queue.offer(release, undefined)
      yield* Fiber.join(consumer)
    }))
})
