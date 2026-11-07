import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import { afterAll, expect, it } from "vitest"
import { waitTrace } from "../../integration/waitTrace.ts"

let trace: ReturnType<typeof waitTrace>
it("fails after abort observation and controlled cleanup", async () => {
  trace = waitTrace("wait-owner")
  const controller = new AbortController()
  await Effect.runPromise(Effect.gen(function*() {
    const gate = yield* Deferred.make<void>()
    const cleanup = trace.observe("controlled-cleanup", Deferred.await(gate))
    yield* trace.test(
      controller.signal,
      Effect.void.pipe(
        Effect.ensuring(Effect.sync(() => controller.abort())),
        Effect.ensuring(Deferred.succeed(gate, undefined)),
        Effect.ensuring(cleanup)
      )
    )
  }))
  expect(false).toBe(true)
})
it("does not receive the failed test's late event", () => {
  trace.event("late-owned-event")
})
afterAll(() => trace.event("late-owned-cleanup"))
