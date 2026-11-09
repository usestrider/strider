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
import { vi } from "vitest"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Handles from "../src/internal/handles.ts"
import { LocatorImpl } from "../src/internal/locator.ts"
import * as Runtime from "../src/internal/runtime.ts"

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

describe("Locator.dispatchEvent", () => {
  it.effect("preserves a typed refusal when the backend cannot evaluate", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.locator("#target").dispatchEvent("change").pipe(Effect.flip)
      assert(Locator.isLocatorError(error))
      assert.strictEqual(error.reason._tag, "Unsupported")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

it.effect("dispatchEvent preserves uncertain dispatch and never retries a call whose response is lost", () =>
  Effect.gen(function*() {
    const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
    const lookedUp = yield* Deferred.make<void>()
    const dispatched = yield* Deferred.make<void>()
    let calls = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: () => Effect.succeed("dispatch-realm" as Target.RealmId),
        evaluate: Effect.fnUntraced(function*() {
          calls++
          yield* Deferred.succeed(dispatched, undefined)
          return yield* Effect.never
        })
      })))
    )
    yield* Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const { entry, runtime } = Handles.page(page)
      const document = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      const routed = { document, hops: [] }
      let lookups = 0
      const element = vi.spyOn(Runtime, "element").mockImplementation(() =>
        Effect.gen(function*() {
          lookups++
          if (lookups === 1) {
            yield* Deferred.succeed(lookedUp, undefined)
            return { _tag: "Response", response: { _tag: "NoMatch" }, routed } as const
          }
          return { _tag: "Found", routed, node: { document, binding: "target" } } as const
        })
      )
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          element.mockRestore()
        })
      )
      const expired = yield* page.locator("#target").dispatchEvent("change").pipe(
        Deadline.within("0 millis"),
        Effect.flip
      )
      assert(Deadline.isTimeout(expired))
      assert.strictEqual(expired.phase, "resolving")
      assert.deepStrictEqual(expired.diagnostics.dispatch, { _tag: "NotSent" })
      assert.strictEqual(lookups, 0)
      assert.strictEqual(calls, 0)
      const running = yield* page.locator("#target").dispatchEvent("change").pipe(
        Deadline.within("1 second"),
        Effect.flip,
        Effect.forkChild
      )
      yield* Deferred.await(lookedUp)
      assert.strictEqual(calls, 0)
      yield* TestClock.adjust("50 millis")
      yield* Deferred.await(dispatched)
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(running)
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.dispatchEvent")
      assert.strictEqual(error.phase, "dispatchedUnconfirmed")
      assert.strictEqual(error.diagnostics.dispatch._tag, "MayHaveBeenSent")
      assert.strictEqual(calls, 1)
      assert.strictEqual(lookups, 2)
    })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
  }).pipe(Effect.scoped))

it.effect("dispatchEvent rejects a released ownership grant before reaching the backend", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const original = page.locator("#target") as LocatorImpl
    const locator = new LocatorImpl(
      {
        ...original.owner,
        grant: Option.some({
          level: "control",
          target: { _tag: "Page", id: original.owner.page.id },
          released: () => true,
          onRelease: () => Effect.void
        })
      },
      original.steps,
      Option.none()
    )
    const error = yield* locator.dispatchEvent("change").pipe(Effect.flip)
    assert(Target.isTargetGone(error))
    assert.strictEqual(error.reason._tag, "AccessReleased")
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("dispatchEvent uses the bound node's document when a frame commits during resolution", () =>
  Effect.gen(function*() {
    let current: Target.DocumentId | undefined
    let calls = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: (document) =>
          Effect.sync(() => {
            assert.strictEqual(document, current, "The node binding identifies the document that returned the node")
            return "committed-frame" as Target.RealmId
          }),
        evaluate: () =>
          Effect.sync(() => {
            calls++
            return { _tag: "Value", value: { type: "string", value: "sent" } } as const
          })
      })))
    )
    yield* Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const { entry, runtime } = Handles.page(page)
      current = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      const element = vi.spyOn(Runtime, "element").mockReturnValue(Effect.succeed({
        _tag: "Found",
        node: { document: current, binding: "target" },
        routed: { document: "previous-frame-document" as Target.DocumentId, hops: [] }
      }))
      yield* Effect.addFinalizer(() => Effect.sync(() => element.mockRestore()))
      yield* page.locator("#target").dispatchEvent("change")
      assert.strictEqual(calls, 1)
    })).pipe(Effect.provide(layer))
  }).pipe(Effect.scoped))

describe("Locator.blur", () => {
  it.effect("reports uncertain dispatch when the native blur reply misses the deadline", () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
      const applying = yield* Deferred.make<void>()
      let inputs = 0
      const layer = BrowserImpl.layer((sink) =>
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
          ...adapter,
          realm: () => Effect.succeed("blur-realm" as Target.RealmId),
          dispatchInput: () =>
            Effect.sync(() => {
              inputs++
            }),
          evaluate: Effect.fnUntraced(function*(_realm, call) {
            if (call.functionDeclaration === Engine.install) {
              return { _tag: "Value", value: { type: "string", value: "installed" } } as const
            }
            const argument = call.arguments[0]
            assert(argument?._tag === "Value" && argument.value.type === "string")
            const request = JSON.parse(argument.value.value) as Engine.Request
            assert(request.op === "act" && request.action._tag === "Blur")
            assert(Object.values(request.checks).every((value) => value === false || value === 0))
            if (request.apply) {
              yield* Deferred.succeed(applying, undefined)
              return yield* Effect.never
            }
            return {
              _tag: "Value",
              value: {
                type: "string",
                value: JSON.stringify({
                  _tag: "Ready",
                  element: "<input>",
                  scrolled: false,
                  point: null,
                  draggable: false,
                  checked: null,
                  fill: null
                })
              }
            } as const
          })
        })))
      )
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const pending = yield* page.locator("#field").blur().pipe(
          Deadline.within("1 second"),
          Effect.flip,
          Effect.forkChild
        )
        yield* Deferred.await(applying)
        yield* TestClock.adjust("1 second")
        const error = yield* Fiber.join(pending)
        assert(Deadline.isTimeout(error))
        assert.strictEqual(error.operation, "Locator.blur")
        assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
        assert.strictEqual(inputs, 0)
      })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    }).pipe(Effect.scoped))

  it.effect("rejects a released control grant before consulting the backend", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const target = page.locator("#field") as LocatorImpl
      const owned = new LocatorImpl({
        ...target.owner,
        grant: Option.some({
          level: "control",
          target: { _tag: "Page", id: target.owner.page.id },
          released: () => true,
          onRelease: () => Effect.void
        })
      }, target.steps)
      const error = yield* owned.blur().pipe(Effect.flip)
      assert(Target.isTargetGone(error))
      assert.strictEqual(error.reason._tag, "AccessReleased")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("uses the owned action path and preserves backend refusal", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.locator("#field").blur().pipe(Effect.flip)
      assert(Locator.isLocatorError(error))
      assert.strictEqual(error.reason._tag, "Unsupported")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Locator.evaluateAll", () => {
  it.effect("preserves a typed backend refusal", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.locator("p").evaluateAll((elements) => elements.length).pipe(Effect.flip)
      assert(Locator.isLocatorError(error))
      assert.strictEqual(error.reason._tag, "Unsupported")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

it.effect("evaluateAll rejects a released ownership grant before reaching the backend", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const original = page.locator("#target") as LocatorImpl
    const locator = new LocatorImpl(
      {
        ...original.owner,
        grant: Option.some({
          level: "control",
          target: { _tag: "Page", id: original.owner.page.id },
          released: () => true,
          onRelease: () => Effect.void
        })
      },
      original.steps,
      Option.none()
    )
    const error = yield* locator.evaluateAll((elements) => elements.length).pipe(Effect.flip)
    assert(Target.isTargetGone(error))
    assert.strictEqual(error.reason._tag, "AccessReleased")
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("evaluateAll preserves deadlines before and after dispatch without repeating the snapshot", () =>
  Effect.gen(function*() {
    const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
    const dispatched = yield* Deferred.make<void>()
    let calls = 0
    let snapshots = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({
          entries: Fake.capabilities.map((entry) =>
            entry.name === "isolatedWorlds" ? { ...entry, status: "supported" } : entry
          )
        })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: () => Effect.succeed("all-realm" as Target.RealmId),
        evaluate: Effect.fnUntraced(function*() {
          calls++
          yield* Deferred.succeed(dispatched, undefined)
          return yield* Effect.never
        })
      })))
    )
    yield* Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const { entry, runtime } = Handles.page(page)
      const document = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      const expired = yield* page.locator("p").evaluateAll((elements) => elements.length).pipe(
        Deadline.within("0 millis"),
        Effect.flip
      )
      assert(Deadline.isTimeout(expired))
      assert.strictEqual(snapshots, 0)
      assert.strictEqual(calls, 0)
      const snapshot = vi.spyOn(Runtime, "elements").mockImplementation(() =>
        Effect.sync(() => {
          snapshots++
          return { _tag: "Found", nodes: [], routed: { document, hops: [] } } as const
        })
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => snapshot.mockRestore()))
      const running = yield* page.locator("p").evaluateAll(async () => 1).pipe(
        Deadline.within("1 second"),
        Effect.flip,
        Effect.forkChild
      )
      yield* Deferred.await(dispatched)
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(running)
      assert(Deadline.isTimeout(error))
      assert.strictEqual(error.operation, "Locator.evaluateAll")
      assert.strictEqual(error.diagnostics.dispatch._tag, "MayHaveBeenSent")
      assert.strictEqual(snapshots, 1)
      assert.strictEqual(calls, 1)
    })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
  }).pipe(Effect.scoped))
