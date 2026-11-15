import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Clock from "../src/internal/clock.ts"
import type * as Model from "../src/internal/model.ts"
import type * as Runtime from "../src/internal/runtime.ts"

describe("PageClock broadcast", () => {
  it.effect("waits for the other document after an evaluation fails", () =>
    Effect.scoped(Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let interrupted = false
      let finished = false
      const adapter = {
        declare: () => Effect.void,
        realm: (id: string) => Effect.succeed(id),
        evaluate: (realm: string, options: { readonly awaitPromise: boolean }) => {
          const done = { _tag: "Value", value: { type: "string", value: "done" } }
          if (!options.awaitPromise) return Effect.succeed(done)
          if (realm === "first") {
            return Deferred.await(started).pipe(Effect.as({ _tag: "Exception", text: "evaluation failed" }))
          }
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.sync(() => {
              finished = true
            })),
            Effect.as(done),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true
              })
            )
          )
        }
      }
      const runtime = { model: { adapter }, timelines: Clock.makeTimelines() } as unknown as Runtime.Runtime
      const pages = ["first", "second"].map((id) => ({
        state: { get: Effect.succeed({ status: { _tag: "Open", document: { id }, url: id }, frames: [], workers: [] }) }
      })) as unknown as Array<Model.PageEntry>
      const clock = Clock.make({
        runtime,
        scope: { _tag: "Browser" },
        pages: () => pages,
        name: "clock",
        conflicting: Option.none
      }, {})
      yield* clock.install({ mode: "controlled", at: 1000 })
      const fiber = yield* Effect.forkChild(Effect.exit(clock.adjust(100)))
      yield* Deferred.await(started)
      // Give the first document's already-ready failure a turn before releasing the second document.
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.join(fiber)
      assert(Exit.isFailure(result))
      assert.strictEqual(interrupted, false)
      assert.strictEqual(finished, true)
    })))
})

describe("PageClock duration input", () => {
  for (
    const [label, duration] of [
      ["a NaN object field", { milliseconds: Number.NaN }],
      ["a NaN tuple field", [0, Number.NaN]],
      ["opposite infinite fields", { seconds: Infinity, minutes: -Infinity }],
      ["a duration overflowing millisecond conversion", 10n ** 400n]
    ] as const
  ) {
    for (const operation of ["offset", "adjust"] as const) {
      it.effect(`rejects ${label} in ${operation}`, () =>
        Effect.scoped(Effect.gen(function*() {
          const runtime = {
            model: { adapter: { declare: () => Effect.void } },
            timelines: Clock.makeTimelines()
          } as unknown as Runtime.Runtime
          const clock = Clock.make({
            runtime,
            scope: { _tag: "Browser" },
            pages: () => [],
            name: "clock",
            conflicting: Option.none
          }, {})
          if (operation === "adjust") yield* clock.install({ mode: "controlled", at: 1000 })
          const result = operation === "offset"
            ? yield* Effect.exit(clock.install({ mode: "offset", by: duration }))
            : yield* Effect.exit(clock.adjust(duration))
          assert(result._tag === "Failure", `${operation} accepted ${label}`)
        })))
    }
  }
})
