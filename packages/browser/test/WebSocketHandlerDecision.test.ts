import { assert, it } from "@effect/vitest"
import { Browser, Target, WebSocketRoute } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as TestClock from "effect/testing/TestClock"
import { harness } from "./utils/WebSocketHostHarness.ts"

const create = (token: string, id: string) =>
  JSON.stringify({ token, type: "create", id, url: "ws://example.com/", protocols: [] })

const recording = (yieldSend = false) => {
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
      }).pipe(Effect.flatMap((result) =>
        yieldSend && options.functionDeclaration.includes("\"type\":\"send\"")
          ? Effect.as(Effect.yieldNow, result)
          : Effect.succeed(result)
      ))) as never
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

it.effect("rechecks the route pattern on the host before admitting a constructor", () => {
  const seen = recording()
  return harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      let handled = 0
      const registration = yield* context.routeWebSocket("ws://allowed.test/**", () =>
        Effect.sync(() => {
          handled++
        }).pipe(Effect.andThen(Effect.never)), { implementation: "script" })
      const bridge = getBridge()
      const realm = Target.RealmId.make("R-pattern")
      const envelope = JSON.stringify({
        token: bridge.token,
        type: "create",
        id: "1",
        url: "ws://other.test/",
        protocols: []
      })
      assert.isTrue(
        bridge.receive(realm, Effect.succeed(envelope), { _tag: "Worker", realm }, { isAlive: () => true })
      )
      yield* Deferred.await(seen.failed)
      assert.strictEqual(handled, 0, "a page-forged url outside the route's pattern must not reach the handler")
      yield* registration.remove
    }), seen.evaluate)
})

it.effect("allows the deciding handler to send after its decision budget has elapsed", () => {
  const seen = recording(true)
  return harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opened = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()
      const sent = yield* Deferred.make<Exit.Exit<void, unknown>>()
      const registration = yield* context.routeWebSocket("**", (socket) =>
        Effect.gen(function*() {
          yield* socket.open({})
          yield* Deferred.succeed(opened, undefined)
          yield* Deferred.await(resume)
          const result = yield* socket.page.send({ _tag: "Text", data: "still here" }).pipe(Effect.exit)
          yield* Deferred.succeed(sent, result)
        }), { implementation: "script" })
      const bridge = getBridge()
      const realm = Target.RealmId.make("R-late-send")
      assert.isTrue(bridge.receive(realm, Effect.succeed(create(bridge.token, "1")), { _tag: "Worker", realm }, {
        isAlive: () => true
      }))
      yield* Deferred.await(opened)
      yield* TestClock.adjust("1 minute")
      yield* Deferred.succeed(resume, undefined)
      const result = yield* Deferred.await(sent)
      assert.deepStrictEqual(result, Exit.void, "a send after deciding must not inherit the expired decision deadline")
      yield* registration.remove
    }), seen.evaluate)
})
