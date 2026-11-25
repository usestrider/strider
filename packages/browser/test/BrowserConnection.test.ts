/** `Browser.layerTest`'s connection state: `close` ends the fake browser, its pages with it, as a browser's does. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Target } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import { TestClock } from "effect/testing"
import * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

describe("Browser connection", () => {
  it.effect("close ends the connection, and closed and the pages say the browser closed", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const page = yield* browser.newPage()
      assert.isTrue(yield* browser.isConnected)
      yield* browser.close
      assert.isFalse(yield* browser.isConnected)
      assert.deepStrictEqual(yield* browser.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
      assert.deepStrictEqual(yield* page.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
      // A closed browser has nothing left to close
      yield* browser.close
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

const layer = (replace: (fake: Adapter.AdapterConnection) => Partial<Adapter.AdapterConnection>) =>
  Layer.unwrap(Clock.clockWith((clock) =>
    Effect.succeed(
      BrowserImpl.layer((sink) =>
        Effect.map(
          Fake.connect([], {
            info: new Browser.Info(Fake.info),
            capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
          })(sink),
          (fake) => ({ ...fake, ...replace(fake) })
        )
      ).pipe(
        Layer.provide(Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock)))
      )
    )
  ))

describe("Browser close deadlines", () => {
  it.effect("keeps BrowserClosed when an accepted close finishes after its deadline", () =>
    Effect.gen(function*() {
      const accepted = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const ending: Kit.Ending = {}
      yield* Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const close = yield* browser.close.pipe(
          Deadline.within("1 second"),
          Effect.flip,
          Effect.forkChild({ startImmediately: true })
        )
        yield* Deferred.await(accepted)
        yield* TestClock.adjust("1 second")
        const error = yield* Fiber.join(close)
        assert.strictEqual(error._tag, "Timeout")
        assert.isTrue(yield* browser.isConnected)
        yield* Deferred.succeed(finish, undefined)
        assert.strictEqual((yield* browser.closed)._tag, "BrowserClosed")
      }).pipe(Effect.provide(layer((fake) => ({
        closed: Deferred.await(finish).pipe(
          Effect.andThen(fake.closeBrowser().pipe(Effect.orDie)),
          Effect.andThen(fake.closed)
        ),
        closeBrowser: () => Kit.closeBrowser(ending, Deferred.succeed(accepted, undefined), Deferred.await(finish))
      }))))
    }))

  it.effect("a refused close leaves a subsequent connection loss as ConnectionLost", () =>
    Effect.gen(function*() {
      const finish = yield* Deferred.make<void>()
      yield* Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const error = yield* Effect.flip(browser.close)
        assert.strictEqual(error._tag, "BrowserError")
        yield* Deferred.succeed(finish, undefined)
        assert.strictEqual((yield* browser.closed)._tag, "ConnectionLost")
      }).pipe(Effect.provide(layer((fake) => ({
        closed: Deferred.await(finish).pipe(
          Effect.andThen(fake.closeBrowser().pipe(Effect.orDie)),
          Effect.andThen(fake.closed)
        ),
        closeBrowser: () =>
          Effect.fail(
            new Adapter.AdapterError({
              reason: { _tag: "Unsupported", capability: "browser.close", hint: "refused" }
            })
          )
      }))))
    }))
})
