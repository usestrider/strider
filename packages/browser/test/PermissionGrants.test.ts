import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as TestClock from "effect/testing/TestClock"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Grants from "../src/internal/grants.ts"
import type * as Model from "../src/internal/model.ts"

const at = (origin: string | undefined, permissions: ReadonlyArray<string>, setting: "granted" | "denied") =>
  ({
    origin: origin === undefined ? Option.none() : Option.some(origin),
    permissions,
    setting
  }) satisfies Model.GrantEntry

const settled = (grants: ReadonlyArray<Model.GrantEntry>) =>
  Grants.resolve(grants).map((each) => [Option.getOrUndefined(each.origin), each.permissions[0], each.setting])

describe("permission declarations in force", () => {
  it("lets a later declaration for every origin override an origin's own", () => {
    assert.deepStrictEqual(
      settled([
        at("https://a.test", ["notifications", "geolocation"], "granted"),
        at(undefined, ["notifications"], "denied")
      ]),
      [[undefined, "notifications", "denied"], ["https://a.test", "notifications", "denied"], [
        "https://a.test",
        "geolocation",
        "granted"
      ]]
    )
  })

  it("lets a later declaration for one origin override every origin's there alone", () => {
    assert.deepStrictEqual(
      settled([at(undefined, ["notifications"], "denied"), at("https://a.test", ["notifications"], "granted")]),
      [[undefined, "notifications", "denied"], ["https://a.test", "notifications", "granted"]]
    )
  })
})

it.effect("keeps overlapping permission calls consistent with their replay", () =>
  Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const clock = yield* Clock.clockWith(Effect.succeed)
    const settings = new Map<string, string>()
    let hold = true
    const layer = BrowserImpl.layer((sink) =>
      Effect.map(
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink),
        (fake) => ({
          ...fake,
          grantPermissions: Effect.fnUntraced(function*(_context, origin, names, setting) {
            if (Option.isNone(origin) && hold) {
              hold = false
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(resume)
            }
            for (const name of names) {
              settings.set(JSON.stringify([Option.getOrUndefined(origin), name]), setting)
            }
          }),
          resetPermissions: () => Effect.sync(() => settings.clear())
        })
      )
    ).pipe(Layer.provideMerge(Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))))
    yield* Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const denying = yield* context.deny(["notifications"]).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const granting = yield* context.grant(["notifications"], { origin: "https://a.test" }).pipe(Effect.forkChild)
      // Let runnable work settle; a serialized implementation may leave the grant waiting for the denial.
      yield* TestClock.adjust("1 millis")
      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(denying)
      yield* Fiber.join(granting)
      const current = () =>
        settings.get(JSON.stringify(["https://a.test", "notifications"])) ??
          settings.get(JSON.stringify([undefined, "notifications"])) ?? "prompt"
      const before = current()
      // Removing an empty declaration changes no permission and must preserve the settled result.
      const empty = yield* context.grant([])
      yield* empty.remove
      assert.strictEqual(current(), before)
    }).pipe(Effect.provide(layer))
  }))

it.effect("releases the permission permit when its scope closes during a send", () =>
  Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const clock = yield* Clock.clockWith(Effect.succeed)
    const settings = new Map<string, string>()
    const layer = BrowserImpl.layer((sink) =>
      Effect.map(
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink),
        (fake) => ({
          ...fake,
          grantPermissions: Effect.fnUntraced(function*(_context, _origin, names, setting) {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(resume)
            for (const name of names) settings.set(name, setting)
          }),
          resetPermissions: () => Effect.sync(() => settings.clear())
        })
      )
    ).pipe(Layer.provideMerge(Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))))
    yield* Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const owner = yield* Scope.make()
      // Observe completion without making the test's cleanup wait on a deadlocked fiber.
      const pending = yield* context.deny(["notifications"]).pipe(Scope.provide(owner), Effect.forkDetach)
      yield* Deferred.await(entered)
      // Closing the scope waits for the call to finish, so it runs beside the send it interrupts.
      const closing = yield* Scope.close(owner, Exit.void).pipe(Effect.forkDetach)
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(closing.pollUnsafe(), undefined, "closing the scope must wait for the call")
      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(closing)
      yield* TestClock.adjust("1 millis")
      assert.notStrictEqual(pending.pollUnsafe(), undefined, "permission call must finish after its scope closes")
      assert.strictEqual(settings.size, 0, "the closed scope must leave no permission behind")
      const next = yield* context.grant([])
      yield* next.remove
      assert.strictEqual(settings.size, 0, "replay must not restore the closed declaration")
    }).pipe(Effect.provide(layer))
  }))

it.effect("leaves no permission when its scope is already closed", () =>
  Effect.gen(function*() {
    const clock = yield* Clock.clockWith(Effect.succeed)
    const settings = new Map<string, string>()
    const layer = BrowserImpl.layer((sink) =>
      Effect.map(
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink),
        (fake) => ({
          ...fake,
          grantPermissions: Effect.fnUntraced(function*(_context, _origin, names, setting) {
            for (const name of names) settings.set(name, setting)
          }),
          resetPermissions: () => Effect.sync(() => settings.clear())
        })
      )
    ).pipe(Layer.provideMerge(Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))))
    yield* Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const owner = yield* Scope.make()
      yield* Scope.close(owner, Exit.void)
      const registration = yield* context.deny(["notifications"]).pipe(Scope.provide(owner))
      yield* registration.remove
      assert.strictEqual(settings.size, 0, "a closed scope must leave no permission behind")
      const next = yield* context.grant([])
      yield* next.remove
      assert.strictEqual(settings.size, 0, "replay must not restore the closed declaration")
    }).pipe(Effect.provide(layer))
  }))
