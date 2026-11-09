/** Context credentials declare interception only in their owner's scope. */
import { assert, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

it.effect("adds no intercept for default contexts and releases the credential owner's intercept", () =>
  Effect.gen(function*() {
    const active = new Map<Adapter.DeclarationScope, Adapter.Declaration>()
    let intercepts = 0
    const clock = yield* Clock.clockWith(Effect.succeed)
    const backend = BrowserImpl.layer((sink) =>
      Effect.map(
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({
            entries: Fake.capabilities.map((entry) =>
              entry.name === "interception.auth"
                ? ({ ...entry, status: "supported" as const, limitations: [] }) :
                entry
            )
          })
        })(sink),
        (fake) => ({
          ...fake,
          declare: (scope, declaration) =>
            fake.declare(scope, declaration).pipe(
              Effect.tap(() =>
                declaration._tag !== "Intercept" ?
                  Effect.void :
                  Effect.acquireRelease(
                    Effect.sync(() => {
                      intercepts++
                      active.set(scope, declaration)
                    }),
                    () =>
                      Effect.sync(() => {
                        active.delete(scope)
                      })
                  )
              )
            )
        })
      )
    )
    yield* Effect.gen(function*() {
      yield* Browser.newContext()
      assert.strictEqual(intercepts, 0)
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({
          httpCredentials: { username: "strider", password: Redacted.make("secret") }
        })
        assert.strictEqual(intercepts, 1)
        const [scope, declaration] = [...active][0]!
        assert.deepStrictEqual(scope, { _tag: "UserContext", context: context.id })
        assert.deepStrictEqual(declaration, { _tag: "Intercept", patterns: ["*"], phases: ["auth"] })
        yield* Browser.newContext()
        assert.strictEqual(intercepts, 1)
      }))
      assert.strictEqual(active.size, 0)
      yield* Browser.newContext()
      assert.strictEqual(intercepts, 1)
    }).pipe(Effect.provide(backend.pipe(
      Layer.provide(Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock)))
    )))
  }))
