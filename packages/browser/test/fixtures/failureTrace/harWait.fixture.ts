import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import { expect, it, vi } from "vitest"
import { start } from "../../../src/internal/har.ts"
import { install } from "../../integration/failureTrace.ts"

const fixture = vi.hoisted(() => ({ queue: undefined as unknown }))
vi.mock("../../../src/internal/events.ts", () => ({
  recorded: () => Effect.succeed(fixture.queue)
}))
vi.mock("../../../src/internal/operation.ts", async (load) => ({
  ...await load<object>(),
  budget: Effect.succeed({ at: 0 }),
  detached: (effect: unknown) => effect
}))
vi.mock("../../../src/internal/browserClock.ts", async (load) => ({
  ...await load<object>(),
  until: () => (effect: unknown) => effect
}))

it("executes transformed hop, body, settlement and finalizer waits", async () => {
  const events: Array<{ kind: string; phase?: string }> = []
  install({ connection: () => (kind, payload) => events.push({ kind, ...payload as object }) })
  await Effect.runPromise(Effect.gen(function*() {
    const queue = yield* Queue.unbounded()
    fixture.queue = queue
    const end = yield* Deferred.make()
    const body = yield* Deferred.make<Option.Option<Uint8Array>>()
    const entered = yield* Deferred.make()
    const scope = yield* Scope.make()
    const state = yield* Ref.make({ response: Option.some({ status: 200 }) })
    const runtime = {
      model: {
        hop: () => Option.some({ end, state: { get: Ref.get(state) } }),
        adapter: {
          requestBody: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(body))),
          responseBody: () => Effect.succeed(new Uint8Array())
        }
      }
    } as unknown as Parameters<typeof start>[0]
    const target = { events: { request: {} } } as unknown as Parameters<typeof start>[1]
    const { recorder } = yield* start(runtime, target, {
      content: "embed",
      requestBodies: true,
      matches: () => true,
      webSocketFrames: false,
      inFlightAtStop: "wait"
    }, scope)
    yield* Queue.offer(queue, { value: { hop: "fixture-hop" } })
    yield* Deferred.succeed(end, { _tag: "Finished" })
    yield* Deferred.await(entered)
    expect(events.some((e) => e.kind === "stage-enter" && e.phase === "request-body")).toBe(true)
    expect(events.some((e) => e.kind === "stage-exit" && e.phase === "request-body")).toBe(false)
    yield* Deferred.succeed(body, Option.none())
    yield* recorder.settle
    yield* Scope.close(scope, Exit.void)
    for (
      const phase of [
        "hop-end",
        "request-body",
        "response-body",
        "hop-follow",
        "await-empty",
        "settle",
        "har-finalizer",
        "queue-loop"
      ]
    ) {
      expect(events.some((e) => e.kind === "stage-exit" && e.phase === phase), phase).toBe(true)
    }
  }))
})
