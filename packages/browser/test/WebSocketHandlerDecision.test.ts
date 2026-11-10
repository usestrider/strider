import { assert, it } from "@effect/vitest"
import { Browser, Target, WebSocketRoute } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import { harness } from "./utils/WebSocketHostHarness.ts"

const create = (token: string, id: string) =>
  JSON.stringify({ token, type: "create", id, url: "ws://example.com/", protocols: [] })

const recording = () => {
  const commands: Array<string> = []
  const failed = Deferred.makeUnsafe<void>()
  return {
    commands,
    failed,
    evaluate: ((_realm: Target.RealmId, options: { readonly functionDeclaration: string }) =>
      Effect.sync(() => {
        commands.push(options.functionDeclaration)
        if (options.functionDeclaration.includes("\"type\":\"fail\"")) Deferred.doneUnsafe(failed, Effect.void)
        return { _tag: "Value" as const, value: { type: "undefined" as const } }
      })) as never
  }
}

it.effect("fails closed when a handler returns without opening, and frees the slot", () => {
  const seen = recording()
  return harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const sockets: Array<WebSocketRoute.Connection> = []
      const registration = yield* context.routeWebSocket("**", (socket) =>
        Effect.sync(() => {
          sockets.push(socket)
        }), { implementation: "script" })
      const bridge = getBridge()
      const realm = Target.RealmId.make("R-undecided")
      assert.isTrue(
        bridge.receive(realm, Effect.succeed(create(bridge.token, "1")), { _tag: "Worker", realm }, {
          isAlive: () => true
        })
      )
      yield* Deferred.await(seen.failed)
      assert.lengthOf(sockets, 1)
      assert.strictEqual(yield* sockets[0]!.status, "closed")
      // The slot and credit are free again: fourteen more sockets are admitted.
      for (let index = 0; index < 14; index++) {
        assert.isTrue(
          bridge.receive(realm, Effect.succeed(create(bridge.token, `n${index}`)), { _tag: "Worker", realm }, {
            isAlive: () => true
          })
        )
      }
      yield* registration.remove
    }), seen.evaluate)
})

it.effect("applies the handler deadline only to the decision", () => {
  const seen = recording()
  return harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const sockets: Array<WebSocketRoute.Connection> = []
      const registration = yield* context.routeWebSocket("**", (socket) =>
        Effect.gen(function*() {
          sockets.push(socket)
          if (socket.id.endsWith(":late")) return yield* Effect.never
          yield* socket.open({})
          return yield* Effect.never
        }), { implementation: "script" })
      const bridge = getBridge()
      const realm = Target.RealmId.make("R-decision")
      for (const id of ["opened", "late"]) {
        assert.isTrue(
          bridge.receive(realm, Effect.succeed(create(bridge.token, id)), { _tag: "Worker", realm }, {
            isAlive: () => true
          })
        )
      }
      yield* Effect.yieldNow
      yield* TestClock.adjust("10 minutes")
      yield* Deferred.await(seen.failed)
      const statuses = yield* Effect.forEach(sockets, (socket) => socket.status)
      const opened = sockets.findIndex((socket) => socket.id.endsWith(":opened"))
      assert.strictEqual(statuses[opened], "open", "work after the decision has no deadline")
      assert.strictEqual(statuses[1 - opened], "closed", "an undecided handler is closed at its deadline")
      yield* registration.remove
    }), seen.evaluate)
})
