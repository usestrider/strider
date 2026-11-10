/**
 * Closing a page and removing a context through the public API, over the fake browser with its close or removal
 * replaced: `Page.close` is done once the page ends, whether or not the browser has answered, keeps its `Timeout`
 * and its refusals, and never cuts the close short; a context's scope, as it closes, waits for the context's end
 * under a budget of its own, warns, and never cuts the removal short.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Dialog } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import type * as Dialogs from "../src/Dialog.ts"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fake from "../src/internal/fake.ts"

/** The fake browser, on Effect's clock as `Browser.layerTest`'s is, with `replace`'s methods in place of its own. */
const layer = (
  replace: (fake: Adapter.AdapterConnection, sink: Adapter.Sink) => Partial<Adapter.AdapterConnection>
): Layer.Layer<Browser.Browser> =>
  Layer.unwrap(Clock.clockWith((clock) =>
    Effect.sync(() =>
      Layer.provideMerge(
        BrowserImpl.layer((sink) =>
          Effect.map(
            Fake.connect([], {
              info: new Browser.Info(Fake.info),
              capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
            })(sink),
            (fake) => ({ ...fake, ...replace(fake, sink) })
          )
        ),
        Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
      )
    )
  ))

/** Sets `interrupted` if `self` is interrupted. */
const noting = (interrupted: Deferred.Deferred<void>) => <A, E>(self: Effect.Effect<A, E>) =>
  Effect.onInterrupt(self, () => Deferred.succeed(interrupted, undefined))

describe("Page.close", () => {
  it.effect("is done once the page ends, though the browser hasn't answered, and doesn't cut the close short", () =>
    Effect.gen(function*() {
      const reply = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const closing = yield* page.close().pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
        yield* TestClock.adjust("31 seconds")
        assert.isTrue(Exit.isSuccess(yield* Fiber.join(closing)))
        assert.strictEqual((yield* page.status)._tag, "Closed")
        assert.isFalse(yield* Deferred.isDone(interrupted))
        yield* Deferred.succeed(reply, undefined)
      })).pipe(Effect.provide(layer((fake) => ({
        // The page ends at once; the reply waits until the test sends it
        closePage: (page, options) =>
          fake.closePage(page, options).pipe(Effect.andThen(Deferred.await(reply)), noting(interrupted))
      }))))
    }))

  it.effect("fails with its Timeout when the page never ends, and doesn't cut the close short", () =>
    Effect.gen(function*() {
      const interrupted = yield* Deferred.make<void>()
      let calls = 0
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const closing = yield* page.close().pipe(Effect.flip, Effect.forkChild({ startImmediately: true }))
        yield* TestClock.adjust("30 seconds")
        const error = yield* Fiber.join(closing)
        assert(Deadline.isTimeout(error), String(error))
        assert.strictEqual(error.operation, "Page.close")
        assert.strictEqual(error.phase, "dispatchedUnconfirmed")
        assert.deepStrictEqual(
          error.hint,
          Option.some("The browser was asked to close the page, and hadn't confirmed it by the deadline")
        )
        assert.strictEqual((yield* page.status)._tag, "Open")
        assert.isFalse(yield* Deferred.isDone(interrupted))
      })).pipe(Effect.provide(layer((fake) => ({
        // The scope's release, which comes second, closes it
        closePage: (page, options) =>
          calls++ === 0 ? Effect.never.pipe(noting(interrupted)) : fake.closePage(page, options)
      }))))
    }))

  it.effect("fails at once, with the page open, when the browser refuses the close", () =>
    Effect.gen(function*() {
      let calls = 0
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const error = yield* page.close().pipe(Effect.flip)
        assert(error._tag === "PageError", String(error))
        assert(error.reason._tag === "Unsupported", error.reason._tag)
        assert.strictEqual(error.reason.capability, "close")
        assert.strictEqual((yield* page.status)._tag, "Open")
      })).pipe(Effect.provide(layer((fake) => ({
        // The scope's release, which comes second, closes it
        closePage: (page, options) =>
          calls++ === 0
            ? Effect.fail(
              new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability: "close", hint: "in the test" } })
            )
            : fake.closePage(page, options)
      }))))
    }))

  it.effect("fails with CloseCanceled once a handler stays, though the browser's reply waits on the prompt", () =>
    Effect.gen(function*() {
      const obligation = "O-test" as Adapter.ObligationId
      const prompt = "P-test" as Dialogs.PromptId
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* Dialog.handle(page, Dialog.dismissAll)
        const error = yield* page.close({ runBeforeUnload: true }).pipe(Effect.flip)
        assert(error._tag === "PageError", String(error))
        assert.strictEqual(error.reason._tag, "CloseCanceled")
        assert.strictEqual((yield* page.status)._tag, "Open")
      })).pipe(Effect.provide(layer((fake, sink) => ({
        // Asked to run beforeunload, the page prompts, and the reply never comes, as a browser's whose reply waits on
        // the prompt doesn't once the prompt stays
        closePage: (page, options) =>
          options.runBeforeUnload
            ? sink({
              _tag: "ObligationOpened",
              obligation,
              subject: { _tag: "Prompt", prompt, page, kind: "beforeunload", message: "", defaultValue: "" }
            }).pipe(Effect.andThen(Effect.never))
            : fake.closePage(page, options),
        resolve: (decided, decision) =>
          decided === obligation
            ? Effect.andThen(
              sink({ _tag: "ObligationEnded", obligation, reason: "resolved", evidence: "test: resolve" }),
              sink({ _tag: "PromptClosed", prompt, accepted: false, userText: Option.none() })
            )
            : fake.resolve(decided, decision)
      }))))
    }))
})

describe("a context's removal", () => {
  it.effect("stops waiting at its own budget as its scope closes, warning, and doesn't cut the removal short", () =>
    Effect.gen(function*() {
      const interrupted = yield* Deferred.make<void>()
      const warnings: Array<string> = []
      const logger = Logger.make((options) => {
        const message = (options.message as ReadonlyArray<string>).join(" ")
        if (options.logLevel === "Warn" && message.startsWith("Context ")) warnings.push(message)
      })
      yield* Effect.gen(function*() {
        // Its finalizer is added inside Browser.newContext, here under a deadline of a second, which isn't its budget
        const removal = yield* Effect.scoped(Browser.newContext().pipe(Deadline.within("1 second"))).pipe(
          Effect.map((context) => context.id),
          Effect.forkChild({ startImmediately: true })
        )
        yield* TestClock.adjust("2 seconds")
        assert.isUndefined(removal.pollUnsafe())
        assert.deepStrictEqual(warnings, [])
        yield* TestClock.adjust("28 seconds")
        const context = yield* Fiber.join(removal)
        assert.deepStrictEqual(warnings, [
          `Context ${context} is still being removed after 15s: the browser hasn't answered the command to remove ` +
          "it; its removal waits up to 30s for the context to end",
          `Context ${context} didn't end within 30s of its removal: the browser hasn't answered the command to ` +
          "remove it; its removal stopped waiting"
        ])
        assert.isFalse(yield* Deferred.isDone(interrupted))
      }).pipe(
        Effect.provide(layer(() => ({ removeUserContext: () => Effect.never.pipe(noting(interrupted)) }))),
        Effect.provideService(Logger.CurrentLoggers, new Set([logger]))
      )
    }))
})

describe("a context scope's release of its pages", () => {
  it.effect("closes twenty pages at once, so it takes one close, not twenty", () =>
    Effect.gen(function*() {
      let sent = 0
      yield* Effect.gen(function*() {
        const released = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* Browser.newContext()
          for (let i = 0; i < 20; i++) yield* context.newPage
          return context
        })).pipe(Effect.forkChild({ startImmediately: true }))
        // One close takes a second; twenty in turn would take twenty
        yield* TestClock.adjust("2 seconds")
        assert.isDefined(released.pollUnsafe())
        assert.strictEqual(sent, 20)
      }).pipe(
        Effect.provide(layer((fake) => ({
          closePage: (page, options) => {
            sent++
            return Effect.sleep("1 second").pipe(Effect.andThen(fake.closePage(page, options)))
          }
        })))
      )
    }))
})
