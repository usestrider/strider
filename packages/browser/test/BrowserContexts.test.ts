/**
 * `Browser.contexts` over the fake browser: the default context first, then the others in the order they were
 * added; a context this connection created as the handle `newContext` returned; one someone else created as an
 * observed handle, the same one each time; a context leaving the list as it is removed; and a read that never waits
 * for a context still being created.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, UserContext } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

/**
 * The fake browser, on Effect's clock, with the fact sink kept so a test can report a context someone else made,
 * and, with a `gate`, each context's creation held after the browser reports it until the gate opens.
 */
const withSink = (
  kept: { sink?: Adapter.Sink; gate?: Deferred.Deferred<void>; reported?: Deferred.Deferred<void> }
): Layer.Layer<Browser.Browser> =>
  Layer.unwrap(Clock.clockWith((clock) =>
    Effect.sync(() =>
      Layer.provideMerge(
        BrowserImpl.layer((sink) => {
          kept.sink = sink
          return Effect.map(
            Fake.connect([], {
              info: new Browser.Info(Fake.info),
              capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
            })(sink),
            (fake) => ({
              ...fake,
              createUserContext: (options: Parameters<typeof fake.createUserContext>[0]) =>
                Effect.tap(
                  fake.createUserContext(options),
                  () =>
                    kept.gate === undefined
                      ? Effect.void
                      : Effect.andThen(Deferred.succeed(kept.reported!, undefined), Deferred.await(kept.gate))
                )
            })
          )
        }),
        Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
      )
    )
  ))

/** Deliver creation's reply first, and hold setup at its first declaration until the test releases it. */
const replyFirst = (kept: {
  fact?: Extract<Adapter.Fact, { readonly _tag: "UserContextAdded" }>
  sink?: Adapter.Sink
  gate?: Deferred.Deferred<void>
  configuring?: Deferred.Deferred<void>
}): Layer.Layer<Browser.Browser> =>
  Layer.unwrap(Clock.clockWith((clock) =>
    Effect.sync(() =>
      Layer.provideMerge(
        BrowserImpl.layer((sink) => {
          kept.sink = sink
          return Effect.map(
            Fake.connect([], {
              info: new Browser.Info(Fake.info),
              capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
            })((fact) => {
              if (fact._tag === "UserContextAdded" && fact.created) {
                kept.fact = fact
                return Effect.void
              }
              return sink(fact)
            }),
            (fake) => ({
              ...fake,
              declare: Effect.fnUntraced(function*(...args: Parameters<typeof fake.declare>) {
                yield* Deferred.succeed(kept.configuring!, undefined)
                yield* Deferred.await(kept.gate!)
                return yield* fake.declare(...args)
              })
            })
          )
        }),
        Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
      )
    )
  ))

describe("Browser.contexts", () => {
  it.effect("lists the default context first, then the contexts this connection creates, as they open and close", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const initial = yield* browser.contexts
      assert.strictEqual(initial.length, 1)
      assert.strictEqual(initial[0], browser.defaultContext)
      yield* Effect.scoped(Effect.gen(function*() {
        const first = yield* Browser.newContext()
        const second = yield* Effect.scoped(Effect.gen(function*() {
          const second = yield* Browser.newContext()
          const listed = yield* browser.contexts
          assert.strictEqual(listed.length, 3)
          assert.strictEqual(listed[0], browser.defaultContext)
          // The handles `newContext` returned, not copies
          assert.strictEqual(listed[1], first)
          assert.strictEqual(listed[2], second)
          return second
        }))
        const listed = yield* browser.contexts
        assert.deepStrictEqual(listed.map((each) => each.id), [browser.defaultContext.id, first.id])
        assert.isFalse(listed.some((each) => Equal.equals(each, second)))
      }))
      assert.deepStrictEqual((yield* browser.contexts).map((each) => each.id), [browser.defaultContext.id])
    }).pipe(Effect.provide(Browser.layerTest(""))))

  it.effect("waits for a context to open", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      yield* Effect.scoped(Effect.gen(function*() {
        const waiting = yield* browser.contexts.waitFor((list) => list.length >= 2).pipe(Effect.forkChild)
        const context = yield* Browser.newContext()
        const listed = yield* Fiber.join(waiting)
        assert.strictEqual(listed[1], context)
      }))
    }).pipe(Effect.provide(Browser.layerTest(""))))

  it.effect("lists a context someone else created as observed, the same handle each time, until it is removed", () => {
    const kept: { sink?: Adapter.Sink } = {}
    return Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const foreign = UserContext.Id.make("foreign")
      yield* kept.sink!({ _tag: "UserContextAdded", context: foreign, isDefault: false })
      const listed = yield* browser.contexts
      assert.deepStrictEqual(listed.map((each) => each.id), [browser.defaultContext.id, foreign])
      // Observed: it has no `newPage` until it is controlled
      assert.isFalse("newPage" in listed[1]!)
      assert.strictEqual((yield* browser.contexts)[1], listed[1])
      yield* kept.sink!({ _tag: "UserContextRemoved", context: foreign })
      assert.deepStrictEqual((yield* browser.contexts).map((each) => each.id), [browser.defaultContext.id])
    }).pipe(Effect.provide(withSink(kept)))
  })

  it.effect("reads the list at once while a context is being created, and lists it once it has its handle", () => {
    const kept: { sink?: Adapter.Sink; gate?: Deferred.Deferred<void>; reported?: Deferred.Deferred<void> } = {}
    return Effect.gen(function*() {
      const browser = yield* Browser.Browser
      kept.gate = yield* Deferred.make<void>()
      kept.reported = yield* Deferred.make<void>()
      const creating = yield* Browser.newContext().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(kept.reported)
      // The browser has reported the context, and its creation is held: the list leaves it out, without waiting
      const during = yield* browser.contexts
      assert.deepStrictEqual(during.map((each) => each.id), [browser.defaultContext.id])
      yield* Deferred.succeed(kept.gate, undefined)
      const context = yield* Fiber.join(creating)
      const listed = yield* browser.contexts
      assert.strictEqual(listed.length, 2)
      assert.strictEqual(listed[1], context)
    }).pipe(Effect.provide(withSink(kept)))
  })
  for (const check of ["read", "notification"] as const) {
    it.effect(`preserves owned context publication with reply before fact: ${check}`, () => {
      const kept: Parameters<typeof replyFirst>[0] = {}
      return Effect.gen(function*() {
        const browser = yield* Browser.Browser
        kept.gate = yield* Deferred.make<void>()
        kept.configuring = yield* Deferred.make<void>()
        const creating = yield* Browser.newContext({ downloads: "deny" }).pipe(
          Effect.forkChild({ startImmediately: true })
        )
        yield* Deferred.await(kept.configuring)
        if (check === "read") {
          assert.deepStrictEqual((yield* browser.contexts).map((each) => each.id), [browser.defaultContext.id])
        }
        yield* kept.sink!(kept.fact!)
        if (check === "read") {
          assert.deepStrictEqual((yield* browser.contexts).map((each) => each.id), [browser.defaultContext.id])
        }
        const waiting = yield* browser.contexts.waitFor((list) =>
          list.some((context) => context.id === kept.fact!.context && "newPage" in context)
        ).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.succeed(kept.gate, undefined)
        const context = yield* Fiber.join(creating)
        yield* TestClock.adjust("1 second")
        assert.isDefined(waiting.pollUnsafe(), "owned handle must notify list watchers")
        assert.strictEqual((yield* Fiber.join(waiting))[1], context)
      }).pipe(Effect.provide(replyFirst(kept)))
    })
  }

  it.effect("lists a context a failed creation couldn't remove, as observed", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const failed = yield* Effect.exit(Effect.scoped(Browser.newContext()))
      assert.isTrue(Exit.isFailure(failed))
      const listed = yield* browser.contexts
      assert.strictEqual(listed.length, 2)
      assert.isFalse("newPage" in listed[1]!)
    }).pipe(Effect.provide(
      Layer.unwrap(Clock.clockWith((clock) =>
        Effect.sync(() =>
          Layer.provideMerge(
            BrowserImpl.layer((sink) =>
              Effect.map(
                Fake.connect([], {
                  info: new Browser.Info(Fake.info),
                  capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
                })(sink),
                (fake) => ({
                  ...fake,
                  // The browser reports the context, then the creation fails and can't remove it, so it releases it
                  // before setup ever has its entry
                  createUserContext: (options: Parameters<typeof fake.createUserContext>[0]) =>
                    Effect.andThen(
                      Effect.flatMap(
                        fake.createUserContext(options),
                        (context) => sink({ _tag: "UserContextReleased", context })
                      ),
                      Effect.fail(
                        new Adapter.AdapterError({
                          reason: { _tag: "Unsupported", capability: "createUserContext", hint: "in the test" }
                        })
                      )
                    )
                })
              )
            ),
            Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
          )
        )
      ))
    )))
})
