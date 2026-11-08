/** Runtime validation for JavaScript callers that bypass Locator's TypeScript contract. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Locator, Target } from "@usestrider/browser"
import * as Cache from "effect/Cache"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import { TestClock } from "effect/testing"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Handles from "../src/internal/handles.ts"

describe("Locator.fill", () => {
  for (
    const [label, value] of [
      ["number", 123],
      ["null", null],
      ["undefined", undefined],
      ["boolean", true],
      ["object", {}],
      ["Redacted number", Redacted.make(123)]
    ] as const
  ) {
    it.effect(`rejects ${label} before consulting the backend`, () =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        // The test backend has no DOM: reaching it would return Unsupported.
        const error = yield* page.locator("#field").fill(value as unknown as string).pipe(Effect.flip)
        assert(Locator.isLocatorError(error))
        assert.strictEqual(error.reason._tag, "InvalidInput")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }
})

describe("Locator.pressSequentially", () => {
  for (
    const [label, value] of [
      ["number", 123],
      ["null", null],
      ["undefined", undefined],
      ["boolean", true],
      ["object", {}],
      ["array", ["private-caller-value"]],
      ["Redacted number", Redacted.make(123)],
      ["Redacted null", Redacted.make(null)],
      ["Redacted object", Redacted.make({ secret: "private-caller-value" })],
      ["Redacted array", Redacted.make(["private-caller-value"])]
    ] as const
  ) {
    it.effect(`rejects ${label} before consulting the backend`, () =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        // Suspend also captures a synchronous caller-type exception as a defect.
        const result = yield* Effect.suspend(() => page.locator("#field").pressSequentially(value as unknown as string))
          .pipe(Effect.exit)
        const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
        assert(Option.isSome(error) && Locator.isLocatorError(error.value))
        assert.strictEqual(error.value.reason._tag, "InvalidInput")
        assert.notInclude(JSON.stringify(error.value), "private-caller-value")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }
})

/** Real routing, engine installation cache and deadlines, with gated page execution. */
describe("Locator.check refusal deadlines", () => {
  for (const boundary of ["timely", "installation", "reply"] as const) {
    it.effect(
      boundary === "timely"
        ? "returns timely WrongElement without input"
        : boundary === "installation"
        ? "times out during installation without a Checked read or input"
        : "preserves Timeout after a late Checked refusal without input",
      () =>
        Effect.gen(function*() {
          const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
          const installing = yield* Deferred.make<void>()
          const installed = yield* Deferred.make<void>()
          const reading = yield* Deferred.make<void>()
          const reply = yield* Deferred.make<void>()
          const installationFinished = yield* Deferred.make<void>()
          const responseFiber = yield* Deferred.make<Fiber.Fiber<Adapter.RemoteResult>>()
          const scope = yield* Scope.Scope
          let installsFinished = 0
          let reads = 0
          let inputs = 0
          const layer = BrowserImpl.layer((sink) =>
            Fake.connect([], {
              info: new Browser.Info(Fake.info),
              capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
            })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
              ...adapter,
              realm: () => Effect.succeed("checked-realm" as Target.RealmId),
              dispatchInput: () =>
                Effect.sync(() => {
                  inputs++
                }),
              evaluate: Effect.fnUntraced(function*(_realm, call) {
                if (call.functionDeclaration === Engine.install) {
                  yield* Deferred.succeed(installing, undefined)
                  yield* Deferred.await(installed)
                  installsFinished++
                  yield* Deferred.succeed(installationFinished, undefined)
                  return { _tag: "Value", value: { type: "string", value: "installed" } } as const
                }
                const argument = call.arguments[0]
                assert(argument?._tag === "Value" && argument.value.type === "string")
                const request = JSON.parse(argument.value.value) as Engine.Request
                assert(request.op === "read" && request.read._tag === "Checked")
                reads++
                yield* Deferred.succeed(reading, undefined)
                // Model a browser response that still arrives after its caller's deadline.
                const fiber = yield* Effect.gen(function*() {
                  yield* Deferred.await(reply)
                  return {
                    _tag: "Value",
                    value: {
                      type: "string",
                      value: JSON.stringify({
                        _tag: "Final",
                        final: {
                          _tag: "WrongElement",
                          expected: "a checkbox, a radio or an ARIA checkable",
                          element: "<option>"
                        }
                      })
                    }
                  } as const
                }).pipe(Effect.forkDetach)
                yield* Scope.addFinalizer(scope, Fiber.interrupt(fiber))
                yield* Deferred.succeed(responseFiber, fiber)
                return yield* Fiber.join(fiber)
              })
            })))
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const pending = yield* page.locator("#target").check().pipe(
              Deadline.within("1 second"),
              Effect.flip,
              Effect.forkChild
            )
            yield* Deferred.await(installing)
            // Keep a cache observer waiting independently of the action's deadline.
            // Cache cancels a pending installation when its last waiter leaves.
            const { entry, runtime } = Handles.page(page)
            const document = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
            const installation = yield* Cache.get(runtime.engineRealms, document).pipe(Effect.forkChild)
            yield* Effect.yieldNow
            if (boundary !== "installation") {
              yield* Deferred.succeed(installed, undefined)
              yield* Deferred.await(reading)
            }
            if (boundary === "timely") {
              yield* TestClock.adjust("500 millis")
              yield* Deferred.succeed(reply, undefined)
            } else {
              yield* TestClock.adjust("1 second")
            }
            const error = yield* Fiber.join(pending)
            if (boundary === "timely") {
              assert(Locator.isLocatorError(error))
              assert.strictEqual(error.reason._tag, "WrongElement")
            } else {
              assert(Deadline.isTimeout(error), String(error))
              assert.strictEqual(error.operation, "Locator.check")
              assert.strictEqual(error.phase, "resolving")
              assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "NotSent" })
              if (boundary === "installation") {
                assert.strictEqual(reads, 0)
                yield* Deferred.succeed(installed, undefined)
                yield* Deferred.await(installationFinished)
                // Await the shared cache lookup, including the installation's continuation.
                assert.strictEqual(yield* Fiber.join(installation), "checked-realm")
                assert.strictEqual(installsFinished, 1)
              } else {
                yield* Deferred.succeed(reply, undefined)
                yield* Fiber.join(yield* Deferred.await(responseFiber))
                assert.strictEqual(yield* Fiber.join(pending), error)
              }
            }
            if (boundary === "timely") {
              yield* Fiber.join(yield* Deferred.await(responseFiber))
            }
            assert.strictEqual(reads, boundary === "installation" ? 0 : 1)
            assert.strictEqual(inputs, 0)
          })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
        }).pipe(Effect.scoped)
    )
  }
})

describe("Locator.boundingBox", () => {
  it.effect("reports backend refusal through the readonly read error contract", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.locator("#box").boundingBox.pipe(Effect.flip)
      assert(Locator.isLocatorError(error))
      assert.strictEqual(error.operation, "Locator.boundingBox")
      assert.strictEqual(error.reason._tag, "Unsupported")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
