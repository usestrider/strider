/** No declaration, bridge metadata or evaluation is prepared for untouched contexts. */
import { assert, it } from "@effect/vitest"
import { Browser, Target, WebSocketRoute } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

it.effect("allocates a bridge declaration only in the requesting context and removes it early", () =>
  Effect.gen(function*() {
    const active = new Map<Adapter.WebSocketBridge, Adapter.DeclarationScope>()
    let installations = 0
    let evaluations = 0
    const clock = yield* Clock.clockWith(Effect.succeed)
    const backend = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((fake) => ({
        ...fake,
        ownership: "launched" as const,
        evaluate: (realm, call) => {
          evaluations++
          return fake.evaluate(realm, call)
        },
        declare: (scope, declaration) =>
          fake.declare(scope, declaration).pipe(Effect.tap(() => {
            if (declaration._tag !== "InitScript" || declaration.webSocket === undefined) return Effect.void
            const bridge = declaration.webSocket
            return Effect.acquireRelease(
              Effect.sync(() => {
                installations++
                active.set(bridge, scope)
              }),
              () =>
                Effect.sync(() => {
                  active.delete(bridge)
                })
            )
          }))
      })))
    )
    yield* Effect.gen(function*() {
      const first = yield* Browser.newContext()
      const sibling = yield* Browser.newContext()
      assert.strictEqual(installations, 0)
      assert.strictEqual(evaluations, 0)
      const route = yield* first.routeWebSocket("**", () => Effect.void, { implementation: "script" })
      assert.strictEqual(installations, 1)
      assert.strictEqual(active.size, 1)
      assert.deepStrictEqual([...active.values()], [{ _tag: "UserContext", context: first.id }])
      yield* sibling.cookies.list
      assert.strictEqual(installations, 1)
      assert.strictEqual(evaluations, 0)
      yield* route.remove
      yield* route.remove
      assert.strictEqual(active.size, 0)
    }).pipe(Effect.provide(backend), Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(clock)))
  }))

it.effect("keeps proxy endpoints connecting until the native opening event", () =>
  Effect.gen(function*() {
    const captured = yield* Deferred.make<WebSocketRoute.Connection>()
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let bridge!: Adapter.WebSocketBridge
    const clock = yield* Clock.clockWith(Effect.succeed)
    const backend = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((fake) => ({
        ...fake,
        ownership: "launched" as const,
        declare: (scope, declaration) =>
          fake.declare(scope, declaration).pipe(Effect.tap(() =>
            Effect.sync(() => {
              if (declaration._tag === "InitScript" && declaration.webSocket !== undefined) {
                bridge = declaration.webSocket
              }
            })
          )),
        evaluate: Effect.fnUntraced(function*(_realm: Target.RealmId, call: Adapter.EvaluationCall) {
          if (call.functionDeclaration.includes("\"type\":\"connect\"")) {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
          }
          return { _tag: "Value" as const, value: { type: "undefined" as const } }
        })
      })))
    )
    yield* Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const registration = yield* context.routeWebSocket(
        "**",
        (socket) => Deferred.succeed(captured, socket).pipe(Effect.asVoid),
        { implementation: "script" }
      )
      const realm = Target.RealmId.make("R-proxy")
      const origin = { _tag: "Worker" as const, realm }
      bridge.receive(
        realm,
        Effect.succeed(
          JSON.stringify({
            token: bridge.token,
            type: "create",
            id: "1",
            url: "ws://example.com/socket",
            protocols: []
          })
        ),
        origin
      )
      const socket = yield* Deferred.await(captured)
      const opening = yield* socket.connectToServer({}).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const before = yield* socket.status
      const earlySend = yield* socket.page.send({ _tag: "Text", data: "too early" }).pipe(Effect.exit)
      yield* Deferred.succeed(release, undefined)
      bridge.receive(
        realm,
        Effect.succeed(JSON.stringify({ token: bridge.token, type: "opened", id: "1", protocol: "" })),
        origin
      )
      yield* Fiber.join(opening)
      assert.strictEqual(before, "connecting")
      assert.isTrue(Exit.isFailure(earlySend))
      assert.strictEqual(yield* socket.status, "open")
      yield* registration.remove
    }).pipe(Effect.provide(backend), Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(clock)))
  }))
