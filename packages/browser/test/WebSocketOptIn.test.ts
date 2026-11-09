/** No declaration, bridge metadata or evaluation is prepared for untouched contexts. */
import { assert, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
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
