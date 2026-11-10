import { assert, it } from "@effect/vitest"
import { Browser, Target, WebSocketRoute } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

const harness = Effect.fnUntraced(
  function*(
    test: (
      bridge: () => Adapter.WebSocketBridge
    ) => Effect.Effect<void, unknown, Browser.Browser | import("effect/Scope").Scope>,
    evaluate?: Adapter.AdapterConnection["evaluate"]
  ) {
    let bridge!: Adapter.WebSocketBridge
    const clock = yield* Clock.clockWith(Effect.succeed)
    const backend = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((fake) => ({
        ...fake,
        ownership: "launched" as const,
        ...(evaluate === undefined ? {} : { evaluate }),
        declare: (scope, declaration) =>
          fake.declare(scope, declaration).pipe(Effect.tap(() =>
            Effect.sync(() => {
              if (declaration._tag === "InitScript" && declaration.webSocket !== undefined) {
                bridge = declaration.webSocket
              }
            })
          ))
      })))
    )
    yield* test(() => bridge).pipe(
      Effect.provide(backend),
      Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
    )
  }
)

it.effect("releases every accepted payload in a pulled batch when removal interrupts its first fetch", () =>
  harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
      const bridge = getBridge()
      const realm = Target.RealmId.make("R-batch")
      const origin = { _tag: "Worker" as const, realm }
      const firstStarted = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const batchStarted = yield* Deferred.make<void>()
      const released: Array<number> = []
      // This first pull holds the consumer while the next three items accumulate.
      assert.isTrue(bridge.receive(
        realm,
        Deferred.succeed(firstStarted, undefined).pipe(
          Effect.andThen(Deferred.await(firstRelease)),
          Effect.as(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
        ),
        origin
      ))
      yield* Deferred.await(firstStarted)
      for (const id of [1, 2, 3]) {
        // Like WebKit callFunctionOn(...).ensuring(releaseObject), release is
        // owned by the accepted fetch, including cancellation during the fetch.
        const fetch = id === 1
          ? Deferred.succeed(batchStarted, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
        assert.isTrue(bridge.receive(
          realm,
          fetch.pipe(Effect.ensuring(Effect.sync(() => {
            released.push(id)
          }))),
          origin
        ))
      }
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(batchStarted)
      yield* registration.remove
      assert.deepStrictEqual(released.sort(), [1, 2, 3])
    })
  ))

it.effect("rejects a queued constructor after its realm destruction has completed", () =>
  Effect.gen(function*() {
    const faultsFinished = yield* Deferred.make<void>()
    const faultSentinel = Target.RealmId.make("R-fault-sentinel")
    yield* harness((getBridge) =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const admitted: Array<WebSocketRoute.Connection> = []
        const registration = yield* context.routeWebSocket("**", (socket) =>
          Effect.sync(() => {
            admitted.push(socket)
          }), { implementation: "script" })
        const bridge = getBridge()
        const realm = Target.RealmId.make("R-ended")
        const origin = { _tag: "Worker" as const, realm }
        const fetchStarted = yield* Deferred.make<void>()
        const fetchRelease = yield* Deferred.make<void>()
        const tailReached = yield* Deferred.make<void>()
        assert.isTrue(bridge.receive(
          realm,
          Deferred.succeed(fetchStarted, undefined).pipe(
            Effect.andThen(Deferred.await(fetchRelease)),
            Effect.as(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
          ),
          origin
        ))
        yield* Deferred.await(fetchStarted)
        assert.isTrue(
          bridge.receive(
            realm,
            Effect.succeed(
              JSON.stringify({
                token: bridge.token,
                type: "create",
                id: "dead",
                url: "ws://example.com/",
                protocols: []
              })
            ),
            origin
          )
        )
        assert.isTrue(
          bridge.receive(
            realm,
            Effect.yieldNow.pipe(
              Effect.andThen(Deferred.succeed(tailReached, undefined)),
              Effect.as(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
            ),
            origin
          )
        )
        bridge.ended(realm)
        // The fault consumer is serial: reaching the following faultRealm
        // command proves the preceding destroyed event has finished.
        bridge.failed(faultSentinel)
        yield* Deferred.await(faultsFinished)
        yield* Deferred.succeed(fetchRelease, undefined)
        yield* Deferred.await(tailReached)
        const statuses = yield* Effect.forEach(admitted, (socket) => socket.status)
        yield* registration.remove
        assert.deepStrictEqual(statuses, [], "a dead realm must not retain a connecting handle and its admitted lease")
      }), (realm) =>
      Effect.gen(function*() {
        if (realm === faultSentinel) yield* Deferred.succeed(faultsFinished, undefined)
        return { _tag: "Value" as const, value: { type: "undefined" as const } }
      }))
  }))
