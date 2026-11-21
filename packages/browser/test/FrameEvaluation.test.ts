/** Frame evaluations retain only live correlation and report a realm's independent loss promptly. */
import { assert, it } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import { vi } from "vitest"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

const backend = (evaluate: Adapter.AdapterConnection["evaluate"]) =>
  BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink).pipe(Effect.map((fake): Adapter.AdapterConnection => ({
      ...fake,
      realm: (document) => Effect.succeed(Target.RealmId.make(`frame-test:${document}`)),
      evaluate
    })))
  )

it.effect("does not retain old realm correlations after successful frame evaluations and navigation", () => {
  const maps = new Set<Map<unknown, unknown>>()
  const original = Map.prototype.set
  const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function(this: Map<unknown, unknown>, key, value) {
    if (typeof key === "string" && key.startsWith("frame-test:") && typeof value === "string") maps.add(this)
    return original.call(this, key, value)
  })
  return Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const frame = yield* page.frameById(page.id)
    for (let index = 0; index < 8; index++) {
      yield* page.goto(`https://example.com/${index}`)
      yield* frame.evaluateInMainWorld(() => 1)
    }
    for (const map of maps) assert.isAtMost(map.size, 1, "completed evaluations must not retain old realms")
  })).pipe(
    Effect.provide(backend(() => Effect.succeed({ _tag: "Value", value: { type: "number", value: 1 } }))),
    Effect.ensuring(Effect.sync(() => spy.mockRestore()))
  )
})

it.effect("reports a destroyed realm without waiting for its still-live document to end", () =>
  Effect.gen(function*() {
    const called = yield* Deferred.make<void>()
    const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
    yield* Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const frame = yield* page.frameById(page.id)
      const pending = yield* frame.evaluateInMainWorld(() => 1).pipe(Effect.forkScoped)
      yield* Deferred.await(called)
      yield* TestClock.adjust("1 second")
      assert.isDefined(pending.pollUnsafe(), "an acknowledged realm loss must not wait for the operation deadline")
      const error = yield* Fiber.join(pending).pipe(Effect.flip)
      assert.strictEqual(error._tag, "TargetGone")
      if (error._tag === "TargetGone") assert.strictEqual(error.reason._tag, "RealmDestroyed")
    })).pipe(
      Effect.provide(backend((realm) =>
        Effect.andThen(
          Deferred.succeed(called, undefined),
          Effect.fail(
            new Adapter.AdapterError({
              reason: { _tag: "Gone", target: { _tag: "Realm", id: realm }, reason: new Target.RealmDestroyed({}) }
            })
          )
        )
      )),
      Effect.provideService(BrowserClock.CurrentClock, clock)
    )
  }))
