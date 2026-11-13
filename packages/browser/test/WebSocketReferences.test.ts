import { assert, it } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Adapter from "../src/internal/adapter.ts"
import { harness } from "./utils/WebSocketHostHarness.ts"

it.effect("waits for capture, shares the reference, and releases it after the final removal", () => {
  const calls: Array<Adapter.EvaluationCall> = []
  const released: Array<Adapter.HandleId> = []
  const realm = Target.RealmId.make("R-captured")
  const handle = "holder" as Adapter.HandleId
  const duplicate = "duplicate" as Adapter.HandleId
  return harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const handled = yield* Deferred.make<void>()
      const first = yield* context.routeWebSocket(
        "**",
        () => Deferred.succeed(handled, undefined).pipe(Effect.asVoid),
        { implementation: "script" }
      )
      const bridge = getBridge()
      bridge.receive(
        realm,
        Effect.succeed(
          JSON.stringify({ token: bridge.token, type: "create", id: "1", url: "ws://example.com/", protocols: [] })
        ),
        { _tag: "Worker", realm },
        { isAlive: () => true }
      )
      yield* Effect.yieldNow
      assert.isFalse(Deferred.isDoneUnsafe(handled), "intake must wait for the installation reference")
      assert.isEmpty(calls)
      yield* bridge.captured(realm, handle)
      yield* Deferred.await(handled)
      const second = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
      yield* getBridge().captured(realm, duplicate)
      assert.deepStrictEqual(released, [duplicate])
      yield* first.remove
      assert.deepStrictEqual(released, [duplicate], "another registration still owns the shared holder")
      yield* second.remove
      assert.deepStrictEqual(released, [duplicate, handle])
      assert.isAbove(calls.length, 0)
      for (const call of calls) {
        assert.deepStrictEqual(call.arguments, [{ _tag: "Handle", handle }])
        assert.notInclude(call.functionDeclaration, "globalThis")
      }
      yield* getBridge().captured(realm, "late" as Adapter.HandleId)
      assert.deepStrictEqual(released, [duplicate, handle, "late"], "late captures after removal are released")
    }), (_realm, call) =>
    Effect.sync(() => {
      calls.push(call)
      return { _tag: "Value", value: { type: "undefined" } } as const
    }), {
    capture: false,
    releaseHandles: (handles) =>
      Effect.sync(() => {
        released.push(...handles)
      })
  })
})

it.effect("releases destroyed realms independently and captures the replacement realm", () => {
  const released: Array<Adapter.HandleId> = []
  const oldReleased = Deferred.makeUnsafe<void>()
  const old = Target.RealmId.make("R-before-navigation")
  const next = Target.RealmId.make("R-after-navigation")
  return harness(
    (getBridge) =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
        const bridge = getBridge()
        yield* bridge.captured(old, "old" as Adapter.HandleId)
        bridge.ended(old)
        bridge.ended(old)
        yield* Deferred.await(oldReleased)
        yield* bridge.captured(old, "stale" as Adapter.HandleId, () => false)
        yield* bridge.captured(next, "next" as Adapter.HandleId)
        assert.deepStrictEqual(released, ["old", "stale"])
        yield* registration.remove
        assert.deepStrictEqual(released, ["old", "stale", "next"])
      }),
    undefined,
    {
      capture: false,
      releaseHandles: (handles) =>
        Effect.sync(() => {
          released.push(...handles)
          if (handles.includes("old" as Adapter.HandleId)) Deferred.doneUnsafe(oldReleased, Effect.void)
        })
    }
  )
})
