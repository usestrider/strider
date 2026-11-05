import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Deadline from "../src/Deadline.ts"
import * as Events from "../src/internal/events.ts"
import * as Target from "../src/Target.ts"

const kind: Events.Kind<string, string> = { operation: "test.next", noun: "an event", deliver: (value) => value }

describe("event predicate resource ownership", () => {
  for (const terminal of ["deadline", "normal target end", "abnormal target end"] as const) {
    it.live(`keeps caller resources live through held work after ${terminal}`, () =>
      Effect.scoped(Effect.gen(function*() {
        const owner = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void))
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const finished = yield* Deferred.make<void>()
        const closingStarted = yield* Deferred.make<void>()
        const resourceReleased = yield* Deferred.make<void>()
        let workExited = false
        let releasedWhileRunning = false
        let liveAtWorkExit = false
        const resource = yield* Effect.acquireRelease(
          Effect.succeed({ live: true }),
          (resource) =>
            Effect.andThen(
              Effect.sync(() => {
                releasedWhileRunning = !workExited
                resource.live = false
              }),
              Deferred.succeed(resourceReleased, undefined)
            )
        ).pipe(Effect.provideService(Scope.Scope, owner))
        const events = Events.make<string>({ _tag: "Browser" }, () => 0)
        const wait = yield* Events.next<string, string, never, never>(
          kind,
          events,
          () => true,
          () =>
            Effect.uninterruptible(Effect.gen(function*() {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              liveAtWorkExit = resource.live
              workExited = true
              yield* Deferred.succeed(finished, undefined)
              return true
            }))
        ).pipe(Deadline.within("20 millis"), Effect.provideService(Scope.Scope, owner))
        yield* Scope.addFinalizer(owner, Deferred.succeed(closingStarted, undefined))
        yield* Effect.gen(function*() {
          Events.publish(events, "first")
          yield* Deferred.await(entered)
          if (terminal !== "deadline") {
            Events.end(events, {
              normal: terminal === "normal target end",
              reason: terminal === "normal target end" ? new Target.BrowserClosed({}) : new Target.BrowserCrashed({})
            })
          }
          const notification = yield* Effect.exit(wait).pipe(Effect.timeoutOption("1 second"))
          assert(Option.isSome(notification) && Exit.isFailure(notification.value))
          const failure = notification.value.cause.reasons.find((reason) => reason._tag === "Fail")
          assert(failure !== undefined)
          if (terminal === "deadline") assert(Deadline.isTimeout(failure.error))
          else assert(Target.isTargetGone(failure.error))
          // In target-end cases, also let the original registration deadline pass while the work stays held.
          if (terminal !== "deadline") yield* Effect.sleep("50 millis")
          const closing = yield* Scope.close(owner, Exit.void).pipe(Effect.forkChild)
          yield* Deferred.await(closingStarted)
          const releasedEarly = yield* Deferred.await(resourceReleased).pipe(Effect.timeoutOption("50 millis"))
          yield* Deferred.succeed(release, undefined)
          yield* Deferred.await(finished)
          yield* Fiber.join(closing)
          assert(Option.isNone(releasedEarly), "scope release must not run the resource finalizer under held work")
          assert.isFalse(releasedWhileRunning)
          assert.isTrue(liveAtWorkExit)
          assert.isFalse(resource.live)
          assert.deepStrictEqual(yield* Effect.exit(wait), notification.value)
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
      })))
  }
})
