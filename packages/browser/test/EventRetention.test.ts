import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Deadline from "../src/Deadline.ts"
import * as Events from "../src/internal/events.ts"

const kind: Events.Kind<string, string> = { operation: "test.next", noun: "an event", deliver: (value) => value }

describe("completed event wait retention", () => {
  for (const fails of [false, true]) {
    it.live(`releases buffered events and predicate resources after ${fails ? "predicate failure" : "success"}`, () =>
      Effect.scoped(Effect.gen(function*() {
        const owner = yield* Effect.scope
        const events = Events.make<string>({ _tag: "Browser" }, () => 0)
        const entered = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const released = yield* Deferred.make<void>()
        const wait = yield* Events.next(kind, events, () => true, () =>
          Effect.gen(function*() {
            yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined))
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(finish)
            if (fails) return yield* Effect.fail("rejected")
            return true
          }))
        const subscriber = Array.from(events.subscribers)[0]!
        Events.publish(events, "first")
        yield* Deferred.await(entered)
        for (let i = 0; i < 100; i++) Events.publish(events, `later-${i}`)
        assert.strictEqual(Queue.sizeUnsafe(subscriber.queue), 100)
        yield* Deferred.succeed(finish, undefined)
        const result = yield* Effect.exit(wait)
        assert.deepStrictEqual(result, fails ? Exit.fail("rejected") : Exit.succeed("first"))
        assert.strictEqual(events.subscribers.size, 0)
        assert.strictEqual(Queue.sizeUnsafe(subscriber.queue), 0)
        assert.strictEqual(subscriber.queue.state._tag, "Done")
        assert(
          Option.isSome(yield* Deferred.await(released).pipe(Effect.timeoutOption("1 second"))),
          "predicate resources must be released without closing the acquiring scope"
        )
        assert.strictEqual(owner.state._tag, "Empty", "completed waits must detach their scope finalizers")
        assert.deepStrictEqual(yield* Effect.exit(wait), result)
      })))
  }

  it.live("discards buffered entries when a pending predicate reaches its deadline", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = Events.make<string>({ _tag: "Browser" }, () => 0)
      const entered = yield* Deferred.make<void>()
      const wait = yield* Events.next(
        kind,
        events,
        () => true,
        () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
      ).pipe(Deadline.within("100 millis"))
      const subscriber = Array.from(events.subscribers)[0]!
      Events.publish(events, "first")
      yield* Deferred.await(entered)
      for (let i = 0; i < 100; i++) Events.publish(events, `later-${i}`)
      assert.strictEqual(Queue.sizeUnsafe(subscriber.queue), 100)
      const error = yield* wait.pipe(Effect.flip)
      assert(Deadline.isTimeout(error))
      assert.strictEqual(events.subscribers.size, 0)
      assert.strictEqual(Queue.sizeUnsafe(subscriber.queue), 0)
      assert.strictEqual(yield* wait.pipe(Effect.flip), error)
    })))
})
