/** Scoped overlay handlers must validate ownership before doing any browser work. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, type Deadline, type Declaration, type Locator, type Page, type Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Fake from "../src/internal/fake.ts"

/** The agreed contract, so the regression can run before the public declaration exists. */
interface HandlerPage extends Page.Page {
  addLocatorHandler<E, R>(
    locator: Locator.Locator,
    handler: (locator: Locator.Locator) => Effect.Effect<void, E, R>,
    options?: { readonly times?: number; readonly noWaitAfter?: boolean }
  ): Effect.Effect<
    Declaration.Registration,
    Page.PageError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope | R
  >
}

describe("Page.addLocatorHandler", () => {
  it.effect("registration and idempotent removal do not evaluate the page or invoke the callback", () => {
    let evaluations = 0
    let callbacks = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((adapter) => ({
        ...adapter,
        evaluate: (...args: Parameters<typeof adapter.evaluate>) => {
          evaluations++
          return adapter.evaluate(...args)
        }
      })))
    )
    return Effect.gen(function*() {
      const page = (yield* Browser.newPage()) as HandlerPage
      const trigger = page.locator("#overlay")
      const registration = yield* page.addLocatorHandler(trigger, (received) =>
        Effect.sync(() => {
          assert.strictEqual(received, trigger)
          callbacks++
        }))
      assert.strictEqual(callbacks, 0)
      yield* registration.remove
      yield* registration.remove
      assert.strictEqual(callbacks, 0)
      assert.strictEqual(evaluations, 0)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect("rejects a locator from another page before invoking its callback", () =>
    Effect.gen(function*() {
      const page = (yield* Browser.newPage()) as HandlerPage
      const other = yield* Browser.newPage()
      const error = yield* page.addLocatorHandler(other.locator("#overlay"), () =>
        Effect.die("A foreign-page handler must never run")).pipe(Effect.flip)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") {
        assert.strictEqual(error.operation, "Page.addLocatorHandler")
        assert.strictEqual(error.reason._tag, "InvalidInput")
      }
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
