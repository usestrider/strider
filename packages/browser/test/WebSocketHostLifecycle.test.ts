import { assert, it } from "@effect/vitest"
import { Browser, Deadline, Target, WebSocketRoute } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import * as Scope from "effect/Scope"
import * as TestClock from "effect/testing/TestClock"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import { harness } from "./utils/WebSocketHostHarness.ts"

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
        origin,
        { isAlive: () => true }
      ))
      yield* Deferred.await(firstStarted)
      for (const id of [1, 2, 3]) {
        // Fetch and discard are separate: an accepted but unstarted fetch must
        // still release its WebKit object when the registration is removed.
        const fetch = id === 1
          ? Deferred.succeed(batchStarted, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
        assert.isTrue(bridge.receive(
          realm,
          fetch,
          origin,
          {
            isAlive: () => true,
            release: Effect.sync(() => {
              released.push(id)
            })
          }
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
          origin,
          { isAlive: () => true }
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
            origin,
            { isAlive: () => true }
          )
        )
        assert.isTrue(
          bridge.receive(
            realm,
            Effect.yieldNow.pipe(
              Effect.andThen(Deferred.succeed(tailReached, undefined)),
              Effect.as(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
            ),
            origin,
            { isAlive: () => true }
          )
        )
        bridge.ended(realm)
        // The fault consumer is serial: reaching the following faultRealm
        // command proves the preceding destroyed event has finished.
        yield* bridge.captured(faultSentinel, "sentinel" as import("../src/internal/adapter.ts").HandleId)
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

for (const failure of ["defect", "interrupt"] as const) {
  it.effect(`continues releasing accepted payloads after a release ${failure}`, () =>
    harness((getBridge) =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
        const bridge = getBridge()
        const realm = Target.RealmId.make("R-release")
        const started = yield* Deferred.make<void>()
        const released: Array<number> = []
        for (const id of [1, 2, 3]) {
          assert.isTrue(
            bridge.receive(realm, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)), {
              _tag: "Worker",
              realm
            }, {
              isAlive: () => true,
              release: Effect.sync(() => {
                released.push(id)
              }).pipe(Effect.andThen(
                id !== 1 ? Effect.void : failure === "defect" ? Effect.die("release failed") : Effect.interrupt
              ))
            })
          )
        }
        yield* Deferred.await(started)
        yield* registration.remove
        yield* registration.remove
        assert.deepStrictEqual(released.sort(), [1, 2, 3])
      })
    ))
}

it.effect("rejects late dead-realm payloads and duplicate destruction without rejecting a replacement", () =>
  harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const captured = yield* Deferred.make<WebSocketRoute.Connection>()
      const replacement = yield* Deferred.make<WebSocketRoute.Connection>()
      const registration = yield* context.routeWebSocket("**", (socket) =>
        Deferred.succeed(socket.id.endsWith(":replacement") ? replacement : captured, socket).pipe(Effect.asVoid), {
        implementation: "script"
      })
      const bridge = getBridge()
      const old = Target.RealmId.make("R-old")
      const next = Target.RealmId.make("R-next")
      let alive = true
      const payload = (id: string) =>
        Effect.succeed(
          JSON.stringify({ token: bridge.token, type: "create", id, url: "ws://example.com/", protocols: [] })
        )
      assert.isTrue(bridge.receive(old, payload("1"), { _tag: "Worker", realm: old }, {
        isAlive: () =>
          alive
      }))
      const previous = yield* Deferred.await(captured)
      alive = false
      bridge.ended(old)
      bridge.ended(old)
      assert.isFalse(bridge.receive(old, payload("late"), { _tag: "Worker", realm: old }, {
        isAlive: () =>
          alive
      }))
      assert.isTrue(bridge.receive(next, payload("replacement"), { _tag: "Worker", realm: next }, {
        isAlive: () =>
          true
      }))
      const current = yield* Deferred.await(replacement)
      bridge.ended(old)
      assert.strictEqual(yield* current.status, "connecting")
      yield* registration.remove
      assert.strictEqual(yield* previous.status, "closed")
      assert.strictEqual(yield* current.status, "closed")
    })
  ))

it.effect("bounds removal when an accepted fetch and its release never complete", () =>
  harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
      const bridge = getBridge()
      const realm = Target.RealmId.make("R-stuck-release")
      const fetching = yield* Deferred.make<void>()
      const releasing = yield* Deferred.make<void>()
      let releases = 0
      assert.isTrue(
        bridge.receive(realm, Deferred.succeed(fetching, undefined).pipe(Effect.andThen(Effect.never)), {
          _tag: "Worker",
          realm
        }, {
          isAlive: () => true,
          release: Effect.sync(() => {
            releases++
          }).pipe(
            Effect.andThen(Deferred.succeed(releasing, undefined)),
            Effect.andThen(Effect.never)
          )
        })
      )
      yield* Deferred.await(fetching)
      const removal = yield* registration.remove.pipe(Effect.forkChild)
      yield* Deferred.await(releasing)
      yield* TestClock.adjust("100 millis")
      yield* Fiber.join(removal)
      yield* registration.remove
      assert.strictEqual(releases, 1)
    })
  ).pipe(Effect.provideService(Deadline.DefaultBudget, Duration.millis(100))))

it.effect("discards every accepted payload when bridge teardown fails", () =>
  harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
      const bridge = getBridge()
      yield* Scope.addFinalizer(bridge.scope, Effect.die("bridge teardown failed"))
      const realm = Target.RealmId.make("R-teardown-failure")
      const started = yield* Deferred.make<void>()
      let releases = 0
      assert.isTrue(
        bridge.receive(realm, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)), {
          _tag: "Worker",
          realm
        }, {
          isAlive: () => true,
          release: Effect.sync(() => {
            releases++
          })
        })
      )
      yield* Deferred.await(started)
      yield* registration.remove.pipe(Effect.exit)
      assert.strictEqual(releases, 1)
    })
  ))

it.effect("releases a stalled payload at the route budget and proceeds to another realm", () =>
  harness((getBridge) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const received = yield* Deferred.make<WebSocketRoute.Connection>()
      const registration = yield* context.routeWebSocket("**", (socket) =>
        Deferred.succeed(received, socket).pipe(Effect.asVoid), { implementation: "script" })
      const bridge = getBridge()
      const stuck = Target.RealmId.make("R-stalled")
      const next = Target.RealmId.make("R-progress")
      const started = yield* Deferred.make<void>()
      let released = 0
      assert.isTrue(
        bridge.receive(stuck, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)), {
          _tag: "Worker",
          realm: stuck
        }, {
          isAlive: () =>
            true,
          release: Effect.sync(() => {
            released++
          })
        })
      )
      yield* Deferred.await(started)
      assert.isTrue(
        bridge.receive(
          next,
          Effect.succeed(
            JSON.stringify({ token: bridge.token, type: "create", id: "next", url: "ws://example.com/", protocols: [] })
          ),
          { _tag: "Worker", realm: next },
          {
            isAlive: () =>
              true
          }
        )
      )
      yield* TestClock.adjust("100 millis")
      const socket = yield* Deferred.await(received)
      assert.strictEqual(socket.realm, next)
      assert.strictEqual(released, 1)
      yield* registration.remove
      assert.strictEqual(released, 1)
    }), () => Effect.succeed({ _tag: "Value", value: { type: "undefined" } })).pipe(
      Effect.provideService(Deadline.DefaultBudget, Duration.millis(100))
    ))

it.effect("retires a missing WebKit payload context before its realm-end notification without logging a bridge failure", () => {
  const errors: Array<unknown> = []
  const holderReleased = Deferred.makeUnsafe<void>()
  const handlesReleased: Array<Adapter.HandleId> = []
  return harness(
    (getBridge) =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
        const realm = Target.RealmId.make("R-missing-payload-context")
        const released = yield* Deferred.make<void>()
        // The console object belongs to the old document; its fetch can lose the context before the commit event.
        const payload = Effect.fail(
          new Protocol.ProtocolError({
            reason: new Protocol.Rejected({
              method: "Runtime.callFunctionOn",
              reason: "NoSuchObject",
              code: -32000,
              description: "Missing injected script for given objectId"
            })
          })
        ).pipe(Effect.mapError(Kit.realmFailure(realm, () => false)))
        assert.isTrue(
          getBridge().receive(realm, payload, { _tag: "Worker", realm }, {
            isAlive: () => true,
            release: Deferred.succeed(released, undefined).pipe(Effect.asVoid)
          })
        )
        yield* Deferred.await(released)
        assert.deepStrictEqual(errors, [], "a discarded context is not a failed WebSocket bridge")
        // A confirmed discarded context must also retire its retained installation, without waiting for an event.
        yield* Deferred.await(holderReleased)
        getBridge().ended(realm)
        getBridge().ended(realm)
        const next = Target.RealmId.make("R-replacement-payload-context")
        const replacement = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
        yield* getBridge().captured(next, "replacement" as Adapter.HandleId)
        yield* registration.remove
        assert.deepStrictEqual(handlesReleased, ["shim"], "the late event must not release the old holder twice")
        yield* replacement.remove
        assert.deepStrictEqual(handlesReleased, ["shim", "replacement"])
      }),
    undefined,
    {
      releaseHandles: (handles) =>
        Effect.sync(() => {
          handlesReleased.push(...handles)
          if (handles.includes("shim" as Adapter.HandleId)) Deferred.doneUnsafe(holderReleased, Effect.void)
        })
    }
  ).pipe(Effect.provideService(
    Logger.CurrentLoggers,
    new Set([Logger.make((entry) => {
      if (entry.logLevel === "Error") errors.push(entry.message)
    })])
  ))
})

for (const kind of ["other error", "other realm", "other target"] as const) {
  it.effect(`reports a payload failure from ${kind} instead of treating it as its own realm retirement`, () => {
    const errors: Array<unknown> = []
    return harness((getBridge) =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const registration = yield* context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
        const realm = Target.RealmId.make("R-payload-guard")
        const released = yield* Deferred.make<void>()
        const gone = Kit.gone(
          kind === "other target"
            ? { _tag: "Document", id: Target.DocumentId.make("D-other") }
            : { _tag: "Realm", id: kind === "other realm" ? Target.RealmId.make("R-other") : realm },
          new Target.RealmDestroyed({})
        )
        // Exercise the unknown-cause boundary with a non-adapter error carrying a coincidentally matching reason.
        const error = kind === "other error"
          ? Object.assign(new Error("payload failed"), { reason: gone.reason })
          : gone
        assert.isTrue(
          getBridge().receive(
            realm,
            Effect.fail(error as Adapter.AdapterError),
            { _tag: "Worker", realm },
            { isAlive: () => true, release: Deferred.succeed(released, undefined).pipe(Effect.asVoid) }
          )
        )
        yield* Deferred.await(released)
        assert.deepStrictEqual(errors, [["WebSocket bridge failed"]])
        yield* registration.remove
      }), () => Effect.succeed({ _tag: "Value", value: { type: "undefined" } })).pipe(
        Effect.provideService(
          Logger.CurrentLoggers,
          new Set([Logger.make((entry) => {
            if (entry.logLevel === "Error") errors.push(entry.message)
          })])
        )
      )
  })
}
