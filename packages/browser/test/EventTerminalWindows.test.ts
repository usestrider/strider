import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Deadline from "../src/Deadline.ts"
import * as Events from "../src/internal/events.ts"

const kind: Events.Kind<string, string> = { operation: "test.next", noun: "an event", deliver: (value) => value }
const channel = () => Events.make<string>({ _tag: "Browser" }, () => 10)
const settled = <A, E>(wait: Effect.Effect<A, E>) =>
  Effect.exit(wait).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map((result) => {
      assert(Option.isSome(result), "the wait must complete while the uninterruptible work is held")
      return result.value
    })
  )
const held = (entered: Deferred.Deferred<void>, release: Deferred.Deferred<void>) =>
  Effect.uninterruptible(Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)))

describe("event wait terminal notification", () => {
  it.live("reports its deadline while a predicate is uninterruptible", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = channel()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const wait = yield* Events.next<string, string, never, never>(
        kind,
        events,
        () => true,
        () => Effect.as(held(entered, release), true)
      ).pipe(Deadline.within("20 millis"))
      Events.publish(events, "first")
      yield* Deferred.await(entered)
      const exit = yield* settled(wait)
      yield* Deferred.succeed(release, undefined)
      assert(Exit.isFailure(exit) && String(exit.cause).includes("Timeout"), String(exit))
    })))

  it.live("reports its deadline while delivery is uninterruptible", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = channel()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const wait = yield* Events.next<string, string, never, never>(kind, events, () => true, undefined, {
        deliver: (value) => Effect.as(held(entered, release), value),
        unfinished: () => "held"
      }).pipe(Deadline.within("20 millis"))
      Events.publish(events, "first")
      yield* Deferred.await(entered)
      const exit = yield* settled(wait)
      yield* Deferred.succeed(release, undefined)
      assert(Exit.isFailure(exit) && String(exit.cause).includes("Timeout"), String(exit))
    })))

  it.live("reports scope cancellation before closing finishes behind an uninterruptible predicate", () =>
    Effect.gen(function*() {
      const events = channel()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const wait = yield* Events.next<string, string, never, never>(
        kind,
        events,
        () => true,
        () => Effect.as(held(entered, release), true)
      ).pipe(Effect.provideService(Scope.Scope, scope))
      Events.publish(events, "first")
      yield* Deferred.await(entered)
      const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      const exit = yield* settled(wait)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(closing)
      assert(Exit.isFailure(exit), String(exit))
    }))
})

describe("event wait acquiring scope", () => {
  it.live("waits for an uninterruptible predicate after its deadline, before releasing what it uses", () =>
    Effect.gen(function*() {
      const events = channel()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let finished = false
      const scope = yield* Scope.make()
      const wait = yield* Events.next<string, string, never, never>(
        kind,
        events,
        () => true,
        () =>
          held(entered, release).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                finished = true
              })
            ),
            Effect.as(true)
          )
      ).pipe(Deadline.within("20 millis"), Effect.provideService(Scope.Scope, scope))
      Events.publish(events, "first")
      yield* Deferred.await(entered)
      yield* settled(wait)
      const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* Effect.sleep("50 millis")
      const closedEarly = closing.pollUnsafe() !== undefined
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(closing)
      assert.isFalse(closedEarly, `the scope closed while the predicate ran (finished: ${finished})`)
    }))
})
