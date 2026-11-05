import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Deadline from "../src/Deadline.ts"
import * as Events from "../src/internal/events.ts"
import * as Target from "../src/Target.ts"

const kind: Events.Kind<string, string> = { operation: "test.next", noun: "an event", deliver: (value) => value }
const channel = () => Events.make<string>({ _tag: "Browser" }, () => 0)
const settled = <A, E>(wait: Effect.Effect<A, E>) =>
  Effect.exit(wait).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map((result) => {
      assert(Option.isSome(result), "a terminal event must complete the wait independently of delivery")
      return result.value
    })
  )
const targetFailure = <A, E>(exit: Exit.Exit<A, E>, reason: Target.CloseReason) => {
  assert(Exit.isFailure(exit), String(exit))
  const failure = exit.cause.reasons.find(Cause.isFailReason)
  assert(failure !== undefined && Target.isTargetGone(failure.error), String(exit.cause))
  assert.strictEqual(failure.error.reason, reason)
}

describe("event wait first terminal outcome", () => {
  for (const normal of [true, false]) {
    for (const phase of ["delivery", "predicate"] as const) {
      it.live(`latches ${normal ? "normal" : "abnormal"} target end during pending ${phase}`, () =>
        Effect.scoped(Effect.gen(function*() {
          const events = channel()
          const entered = yield* Deferred.make<void>()
          const canceled = yield* Deferred.make<void>()
          const blocked = Effect.andThen(Deferred.succeed(entered, undefined), Effect.never).pipe(
            Effect.onInterrupt(() => Deferred.succeed(canceled, undefined))
          )
          const wait = yield* Events.next(
            kind,
            events,
            () => true,
            phase === "predicate" ? () => blocked : undefined,
            phase === "delivery" ? { deliver: () => blocked, unfinished: () => "pending delivery" } : undefined
          )
          const subscriber = Array.from(events.subscribers)[0]!
          Events.publish(events, "first")
          yield* Deferred.await(entered)
          Events.publish(events, "buffered")
          const reason = normal ? new Target.BrowserClosed({}) : new Target.BrowserCrashed({})
          Events.end(events, { normal, reason })
          const result = yield* settled(wait)
          targetFailure(result, reason)
          yield* settled(Deferred.await(canceled))
          assert.strictEqual(events.subscribers.size, 0)
          assert.strictEqual(Queue.sizeUnsafe(subscriber.queue), 0)
          assert.deepStrictEqual(yield* settled(wait), result)
        })))
    }
  }

  it.live("publishes target end while uninterruptible delivery is pending and starts no predicate afterward", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = channel()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const stopped = yield* Deferred.make<void>()
      let predicates = 0
      const wait = yield* Events.next(kind, events, () => true, () =>
        Effect.sync(() => {
          predicates++
          return true
        }), {
        deliver: () =>
          Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)).pipe(
            Effect.as("delivered"),
            Effect.uninterruptible,
            Effect.onExit(() => Deferred.succeed(stopped, undefined))
          ),
        unfinished: () => "pending uninterruptible delivery"
      })
      yield* Effect.gen(function*() {
        Events.publish(events, "first")
        yield* Deferred.await(entered)
        const reason = new Target.BrowserClosed({})
        Events.end(events, { normal: true, reason })
        targetFailure(yield* settled(wait), reason)
        yield* Deferred.succeed(release, undefined)
        yield* settled(Deferred.await(stopped))
        assert.strictEqual(predicates, 0)
        targetFailure(yield* settled(wait), reason)
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
    })))

  it.live("preserves target end before scope closure and scope cancellation before target end", () =>
    Effect.gen(function*() {
      for (const targetFirst of [true, false]) {
        const events = channel()
        const owner = yield* Scope.make()
        const wait = yield* Events.next<string, string, never, never>(kind, events, () => true, undefined).pipe(
          Effect.provideService(Scope.Scope, owner)
        )
        const reason = new Target.BrowserClosed({})
        if (targetFirst) Events.end(events, { normal: true, reason })
        yield* Scope.close(owner, Exit.void)
        if (!targetFirst) Events.end(events, { normal: true, reason })
        const result = yield* settled(wait)
        if (targetFirst) targetFailure(result, reason)
        else assert(Exit.isFailure(result) && result.cause.reasons.some(Cause.isInterruptReason))
        assert.strictEqual(events.subscribers.size, 0)
      }
    }))

  for (const targetFirst of [true, false]) {
    it.live(`preserves ${targetFirst ? "target end before timeout" : "timeout before target end"}`, () =>
      Effect.scoped(Effect.gen(function*() {
        const events = channel()
        const entered = yield* Deferred.make<void>()
        const wait = yield* Events.next(
          kind,
          events,
          () => true,
          () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
        ).pipe(Deadline.within("100 millis"))
        Events.publish(events, "first")
        yield* Deferred.await(entered)
        const reason = new Target.BrowserCrashed({})
        if (targetFirst) Events.end(events, { normal: false, reason })
        const result = yield* settled(wait)
        if (!targetFirst) Events.end(events, { normal: false, reason })
        if (targetFirst) targetFailure(result, reason)
        else {
          assert(Exit.isFailure(result))
          const failure = result.cause.reasons.find(Cause.isFailReason)
          assert(failure !== undefined && Deadline.isTimeout(failure.error))
        }
        assert.deepStrictEqual(yield* settled(wait), result)
      })))
  }

  for (const fails of [false, true]) {
    it.live(`preserves completed ${fails ? "error" : "success"} through target end and scope closure`, () =>
      Effect.gen(function*() {
        const events = channel()
        const owner = yield* Scope.make()
        const wait = yield* Events.next(
          kind,
          events,
          () => true,
          () => fails ? Effect.fail("rejected") : Effect.succeed(true)
        )
          .pipe(Effect.provideService(Scope.Scope, owner))
        Events.publish(events, "first")
        const result = yield* settled(wait)
        assert.deepStrictEqual(result, fails ? Exit.fail("rejected") : Exit.succeed("first"))
        Events.end(events, { normal: false, reason: new Target.BrowserCrashed({}) })
        yield* Scope.close(owner, Exit.void)
        assert.deepStrictEqual(yield* settled(wait), result)
        assert.strictEqual(events.subscribers.size, 0)
        assert.strictEqual(owner.state._tag, "Closed")
      }))
  }

  it.live("keeps an unfinished subscription after interrupting only its consumer", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = channel()
      const started = yield* Deferred.make<void>()
      const wait = yield* Events.next<string, string, never, never>(kind, events, () => true, undefined)
      const consumer = yield* Effect.andThen(Deferred.succeed(started, undefined), wait).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(consumer)
      assert.strictEqual(events.subscribers.size, 1)
      const reason = new Target.BrowserClosed({})
      Events.end(events, { normal: true, reason })
      targetFailure(yield* settled(wait), reason)
    })))
})
