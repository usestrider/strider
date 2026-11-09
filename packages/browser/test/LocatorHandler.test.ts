/** Scoped overlay handlers must validate ownership before doing any browser work. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, type Declaration, Expect, Target } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import { TestClock } from "effect/testing"
import type * as Access from "../src/internal/access.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Execution from "../src/internal/execution.ts"
import * as Fake from "../src/internal/fake.ts"
import { LocatorImpl } from "../src/internal/locator.ts"
import * as LocatorHandlers from "../src/internal/locatorHandlers.ts"
import * as Operation from "../src/internal/operation.ts"

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
      const page = yield* Browser.newPage()
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
      const page = yield* Browser.newPage()
      const other = yield* Browser.newPage()
      const error = yield* page.addLocatorHandler(other.locator("#overlay"), () =>
        Effect.die("A foreign-page handler must never run")).pipe(Effect.flip)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") {
        assert.strictEqual(error.operation, "Page.addLocatorHandler")
        assert.strictEqual(error.reason._tag, "InvalidInput")
      }
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  it.effect("rejects foreign runtime ownership even if a locator carries the registering page entry", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      yield* Effect.gen(function*() {
        const other = yield* Browser.newPage()
        const local = page.locator("body") as LocatorImpl
        const foreign = other.locator("body") as LocatorImpl
        const crossed = new LocatorImpl({ ...foreign.owner, page: local.owner.page }, foreign.steps)
        const failure = yield* page.addLocatorHandler(crossed, () => Effect.die("Foreign callback ran")).pipe(
          Effect.flip
        )
        assert.strictEqual(failure._tag, "PageError")
        if (failure._tag === "PageError") assert.strictEqual(failure.reason._tag, "InvalidInput")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest("")))
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

/** A wire fixture for public handler lifetime tests, without a browser or real-clock sleeps. */
const fixture = () => {
  let visible = true
  let visibility: (() => boolean) | undefined
  const decisions: Array<string> = []
  let hiddenWait: Effect.Effect<void> = Effect.void
  const requests: Array<{ readonly page: string; readonly request: string }> = []
  const layer = BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink).pipe(
      Effect.map((adapter) => ({
        ...adapter,
        realm: (document: Target.DocumentId) => Effect.succeed(Target.RealmId.make(document)),
        evaluate: Effect.fnUntraced(function*(realm: Target.RealmId, call: Adapter.EvaluationCall) {
          if (call.functionDeclaration === Engine.install) {
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          const arg = call.arguments[0]
          assert(arg?._tag === "Value" && arg.value.type === "string")
          const request = JSON.parse(arg.value.value)
          requests.push({ page: realm, request: request.command ?? request.op })
          if (request.command === "resume") decisions.push(request.decision)
          const ready = {
            _tag: "Ready",
            element: "input",
            point: null,
            scrolled: false,
            draggable: false,
            checked: null,
            fill: null
          }
          let response: unknown
          if (call.functionDeclaration === Engine.cooperate) {
            response = request.command === "start" ?
              { _tag: "Check", token: request.session, final: request.final || request.request.apply === true }
              : request.command === "cancel" ?
              { _tag: "Disposed" }
              : {
                _tag: "Done",
                response: request.command === "finish" ?
                  { _tag: "Expected", passed: false, observed: "waiting", changed: false }
                  : request.decision === "restart"
                  ? undefined
                  : ready
              }
            if (request.command === "resume" && request.decision === "restart") response = { _tag: "Restart" }
          } else if (request.op === "visible") {
            response = { _tag: "Visible", count: 1, visible: visibility?.() ?? visible }
          } else if (request.op === "expect") {
            if (request.expectation._tag === "Hidden") {
              yield* hiddenWait
            }
            response = {
              _tag: "Expected",
              passed: request.expectation._tag === "Hidden" ? !visible : true,
              observed: visible,
              changed: false
            }
          } else response = ready
          return { _tag: "Value", value: { type: "string", value: JSON.stringify(response) } } as const
        })
      }))
    )
  )
  return {
    layer,
    requests,
    decisions,
    setVisibility: (read: () => boolean) => {
      visibility = read
    },
    hide: () => {
      visible = false
    },
    show: () => {
      visible = true
    },
    waitHidden: (wait: Effect.Effect<void>) => {
      hiddenWait = wait
    }
  }
}

class CallbackService extends Context.Service<CallbackService, { readonly value: number }>()("test/CallbackService") {}

describe("locator handler execution", () => {
  it.effect("captures callback services while inheriting the triggering operation and clock", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      let operation = ""
      let value = 0
      yield* page.addLocatorHandler(page.locator("#overlay"), () =>
        Effect.gen(function*() {
          operation = (yield* Operation.record).name
          value = (yield* CallbackService).value
          yield* Effect.forkChild(page.locator("#inside").focus()).pipe(Effect.flatMap(Fiber.join))
          f.hide()
        })).pipe(Effect.provideService(CallbackService, { value: 42 }), Deadline.within("1 millis"))
      yield* page.locator("#target").focus()
      assert.strictEqual(value, 42)
      assert.strictEqual(operation, "Locator.focus")
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("inherits the live triggering clock and charges callback waiting to one deadline", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Clock.Clock)
      const registrationClock = { ...clock }
      const entered = yield* Deferred.make<void>()
      let left = 0
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.addLocatorHandler(page.locator("#overlay"), () =>
          Effect.gen(function*() {
            assert.strictEqual(yield* BrowserClock.CurrentClock, clock)
            yield* Deferred.succeed(entered, undefined)
            yield* BrowserClock.sleep(40)
            left = (yield* Operation.record).left()
            f.hide()
          })).pipe(Effect.provideService(BrowserClock.CurrentClock, registrationClock))
        const action = yield* page.locator("#target").focus().pipe(Deadline.within("100 millis"), Effect.forkChild)
        yield* Deferred.await(entered)
        yield* TestClock.adjust("40 millis")
        yield* Fiber.join(action)
        assert.strictEqual(left, 60)
      }).pipe(Effect.scoped, Effect.provide(f.layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    })
  })

  it.effect("does not let removal or scope cleanup of an old registry disable a later registration", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const scope = yield* Scope.make()
      const old = yield* page.addLocatorHandler(page.locator("#overlay"), () => Effect.void).pipe(Scope.provide(scope))
      yield* old.remove
      let calls = 0
      yield* page.addLocatorHandler(page.locator("#overlay"), () =>
        Effect.sync(() => {
          calls++
          f.hide()
        }))
      yield* old.remove
      yield* Scope.close(scope, Exit.void)
      assert.notStrictEqual((page.locator("#target") as LocatorImpl).owner.page.execution, Execution.ordinary)
      yield* page.locator("#target").focus()
      assert.strictEqual(calls, 1)
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("keeps last-registration dispatch active through hidden waits and concurrent actions", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const owner = (page.locator("#target") as LocatorImpl).owner
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let callbacks = 0
      f.waitHidden(Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)))
      const registration = yield* page.addLocatorHandler(page.locator("#overlay"), () =>
        Effect.sync(() => {
          callbacks++
          f.hide()
        }), { times: 1 })
      const first = yield* page.locator("#first").focus().pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* registration.remove
      const second = yield* page.locator("#second").focus().pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.notStrictEqual(owner.page.execution, Execution.ordinary)
      assert.isUndefined(second.pollUnsafe())
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      assert.strictEqual(callbacks, 1)
      assert.strictEqual(owner.page.execution, Execution.ordinary)
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("scope closure interrupts a selected callback and prevents the triggering action succeeding", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const scope = yield* Scope.make()
      const entered = yield* Deferred.make<void>()
      yield* page.addLocatorHandler(
        page.locator("#overlay"),
        () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
      ).pipe(Scope.provide(scope))
      const action = yield* page.locator("#target").focus().pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Scope.close(scope, Exit.void)
      const exit = yield* Fiber.join(action)
      assert.isTrue(Exit.isFailure(exit))
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause))
      assert.strictEqual((page.locator("#target") as LocatorImpl).owner.page.execution, Execution.ordinary)
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("scope closure waits for a selected callback's finalizers before releasing its services", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const scope = yield* Scope.make()
      const entered = yield* Deferred.make<void>()
      const finalizing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* page.addLocatorHandler(
        page.locator("#overlay"),
        () =>
          Effect.andThen(Deferred.succeed(entered, undefined), Effect.never).pipe(
            Effect.ensuring(Effect.andThen(Deferred.succeed(finalizing, undefined), Deferred.await(release)))
          )
      ).pipe(Scope.provide(scope))
      const action = yield* page.locator("#target").focus().pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(entered)
      const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* Deferred.await(finalizing)
      yield* Effect.yieldNow
      yield* Effect.sync(() => assert.isUndefined(closing.pollUnsafe())).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined))
      )
      yield* Fiber.join(closing)
      assert.isTrue(Exit.isFailure(yield* Fiber.join(action)))
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("interrupts a callback that closes its own registration scope without joining itself", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const scope = yield* Scope.make()
      yield* page.addLocatorHandler(page.locator("#overlay"), () => Scope.close(scope, Exit.void)).pipe(
        Scope.provide(scope)
      )
      const exit = yield* page.locator("#target").focus().pipe(Effect.exit)
      assert.isTrue(Exit.isFailure(exit))
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause))
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("explicit self-removal finishes its selected callback and restores dispatch", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const registration: Declaration.Registration = yield* page.addLocatorHandler(
        page.locator("#overlay"),
        () =>
          Effect.gen(function*() {
            yield* registration.remove
            yield* page.locator("#inside").focus()
            f.hide()
          })
      )
      yield* page.locator("#target").focus()
      assert.strictEqual((page.locator("#target") as LocatorImpl).owner.page.execution, Execution.ordinary)
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("preserves custom typed callback errors and defects without retrying", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const sentinel = Object.assign(new Error("sentinel"), { code: 42, details: { retained: true } })
      let calls = 0
      const registration = yield* page.addLocatorHandler(page.locator("#overlay"), () => {
        calls++
        return Effect.fail(sentinel)
      })
      const failure = yield* page.locator("#target").focus().pipe(Effect.flip)
      assert.strictEqual(failure._tag, "LocatorError")
      if (failure._tag === "LocatorError") {
        assert.strictEqual(failure.reason._tag, "LocatorHandlerFailed")
        if (failure.reason._tag === "LocatorHandlerFailed") assert.strictEqual(failure.reason.error, sentinel)
      }
      assert.strictEqual(calls, 1)
      yield* registration.remove
      yield* page.addLocatorHandler(page.locator("#overlay"), () => Effect.die(sentinel))
      const exit = yield* page.locator("#target").focus().pipe(Effect.exit)
      assert.isTrue(Exit.isFailure(exit))
      if (Exit.isFailure(exit)) assert.strictEqual(Result.getOrThrow(Cause.findDefect(exit.cause)), sentinel)
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("isolates active dispatch to its page and restores ordinary reads and actions", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const other = yield* Browser.newPage()
      const context = yield* Browser.newContext()
      const elsewhere = yield* context.newPage
      const registration = yield* page.addLocatorHandler(page.locator("body"), () => Effect.void, { noWaitAfter: true })
      for (const untouched of [other, elsewhere]) {
        assert.strictEqual((untouched.locator("#target") as LocatorImpl).owner.page.execution, Execution.ordinary)
        yield* untouched.locator("#target").focus()
      }
      assert.isFalse(f.requests.some((request) => request.request === "start"))
      yield* page.locator("body").isVisible
      assert.isFalse(f.requests.some((request) => request.request === "start"))
      yield* registration.remove
      yield* page.locator("#target").focus()
      assert.isFalse(f.requests.some((request) => request.request === "start"))
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("restarts a final check before calling a callback that needs the input permit", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      let probes = 0
      let calls = 0
      f.setVisibility(() => ++probes > 1)
      yield* page.addLocatorHandler(page.locator("#overlay"), () =>
        Effect.gen(function*() {
          calls++
          f.setVisibility(() => false)
          yield* page.locator("#inside").focus()
          f.hide()
        }), { times: 1 })
      yield* page.locator("#target").focus()
      assert.strictEqual(calls, 1)
      assert.include(f.decisions, "restart")
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("rechecks both the registering page grant and the trigger grant before invocation", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const base = page.locator("#overlay") as LocatorImpl
      for (const which of ["page", "locator"] as const) {
        let released = false
        const grant: Access.Grant = {
          level: "control",
          target: { _tag: "Page", id: page.id },
          released: () => released,
          onRelease: () => Effect.void
        }
        const owner = { ...base.owner, grant: which === "page" ? Option.some(grant) : Option.none() }
        const locator = new LocatorImpl({
          ...base.owner,
          grant: which === "locator" ? Option.some(grant) : Option.none()
        }, base.steps)
        const registration = yield* LocatorHandlers.add(owner, locator, () => Effect.die("Revoked callback ran"))
        released = true
        const failure = yield* page.locator("#target").focus().pipe(Effect.flip)
        assert.strictEqual(failure._tag, "TargetGone")
        if (failure._tag === "TargetGone") assert.strictEqual(failure.reason._tag, "AccessReleased")
        yield* registration.remove
      }
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("passes callback TargetGone unchanged and attributes step Timeout at the outer operation", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      let original: Deadline.Timeout | undefined
      const registration = yield* page.addLocatorHandler(page.locator("#overlay"), () =>
        Effect.gen(function*() {
          const record = yield* Operation.record
          original = record.timeout(Option.some("callback detail"))
          return yield* Effect.fail(original)
        }).pipe(Operation.named("Callback.step")))
      const timeout = yield* page.locator("#target").focus().pipe(Effect.flip)
      assert.strictEqual(timeout._tag, "Timeout")
      if (timeout._tag === "Timeout") {
        assert.strictEqual(timeout.operation, "Locator.focus")
        assert.strictEqual(original!.operation, "Callback.step")
        assert.deepStrictEqual(timeout.hint, original!.hint)
      }
      const assertionTimeout = yield* Expect.toBeVisible(page.locator("#target")).pipe(Effect.flip)
      assert.strictEqual(assertionTimeout._tag, "Timeout")
      if (assertionTimeout._tag === "Timeout") assert.strictEqual(assertionTimeout.operation, "Expect.toBeVisible")
      yield* registration.remove
      const gone = new Target.TargetGone({
        target: { _tag: "Page", id: page.id },
        reason: new Target.AccessReleased({}),
        diagnostics: Operation.diagnosticsNow()
      })
      yield* page.addLocatorHandler(page.locator("#overlay"), () => Effect.fail(gone))
      assert.strictEqual(yield* page.locator("#target").focus().pipe(Effect.flip), gone)
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("keeps a callback's unsupported backend operation as the original typed failure", () => {
    const f = fixture()
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      yield* page.addLocatorHandler(page.locator("#overlay"), () => page.keyboard.press("Escape"))
      const error = yield* page.locator("#target").focus().pipe(Effect.flip)
      assert.strictEqual(error._tag, "LocatorError")
      if (error._tag === "LocatorError" && error.reason._tag === "LocatorHandlerFailed") {
        const original = error.reason.error as {
          readonly reason: { readonly _tag: string; readonly capability: string }
        }
        assert.strictEqual(original.reason._tag, "Unsupported")
        assert.strictEqual(original.reason.capability, "input.native")
      } else assert.fail("Expected a typed callback failure")
    }).pipe(Effect.scoped, Effect.provide(f.layer))
  })

  it.effect("rejects invalid invocation counts without installing dispatch", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      for (const times of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        const failure = yield* page.addLocatorHandler(page.locator("body"), () => Effect.void, { times }).pipe(
          Effect.flip
        )
        assert.strictEqual(failure._tag, "PageError")
        assert.strictEqual((page.locator("body") as LocatorImpl).owner.page.execution, Execution.ordinary)
      }
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
