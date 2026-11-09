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
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Handles from "../src/internal/handles.ts"
import { LocatorImpl } from "../src/internal/locator.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Runtime from "../src/internal/runtime.ts"

it.effect("runtime never reroutes an applying engine round after its realm ends", () =>
  Effect.gen(function*() {
    let calls = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: () => Effect.succeed("action-realm" as Target.RealmId),
        evaluate: Effect.fnUntraced(function*(_realm, call) {
          if (call.functionDeclaration === Engine.install) {
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          calls++
          if (calls === 1) {
            return yield* Effect.fail(
              new Adapter.AdapterError({
                reason: {
                  _tag: "Gone",
                  target: { _tag: "Realm", id: "action-realm" as Target.RealmId },
                  reason: new Target.RealmDestroyed({})
                }
              })
            )
          }
          return {
            _tag: "Value",
            value: { type: "string", value: JSON.stringify({ _tag: "Count", count: 1 }) }
          } as const
        })
      })))
    )
    yield* Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const { entry, runtime } = Handles.page(page)
      const result = yield* Effect.gen(function*() {
        const record = yield* Operation.record
        return yield* Runtime.send(
          runtime,
          entry,
          {
            op: "act",
            steps: [],
            action: { _tag: "Focus" },
            apply: true,
            cap: 100,
            checks: {
              rendered: false,
              visible: false,
              enabled: false,
              editable: false,
              notInert: false,
              inViewport: false,
              stable: 0,
              receivesPointer: false
            }
          },
          record.id,
          record.budget.at
        )
      }).pipe(Operation.named("test.applyingRound"), Effect.result)
      assert.strictEqual(result._tag, "Failure")
      if (result._tag === "Failure") assert.strictEqual(result.failure._tag, "Gone")
      assert.strictEqual(calls, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  }).pipe(Effect.scoped))

for (const loss of ["realm", "engine"] as const) {
  it.effect(
    loss === "realm"
      ? "runtime follows a realm lost while installing the engine, before an applying round is sent"
      : "runtime reinstalls a missing engine without claiming an action was applied",
    () =>
      Effect.gen(function*() {
        let installs = 0
        let calls = 0
        let operation: Operation.Record | undefined
        const layer = BrowserImpl.layer((sink) =>
          Fake.connect([], {
            info: new Browser.Info(Fake.info),
            capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
          })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
            ...adapter,
            realm: () => Effect.succeed("action-realm" as Target.RealmId),
            evaluate: Effect.fnUntraced(function*(_realm, call) {
              if (call.functionDeclaration === Engine.install) {
                assert.deepStrictEqual(operation?.diagnostics().dispatch, { _tag: "NotSent" })
                installs++
                // The document is replaced while the engine is installed: the action round was never sent.
                if (installs === 1 && loss === "realm") {
                  return yield* Effect.fail(
                    new Adapter.AdapterError({
                      reason: {
                        _tag: "Gone",
                        target: { _tag: "Realm", id: "action-realm" as Target.RealmId },
                        reason: new Target.RealmDestroyed({})
                      }
                    })
                  )
                }
                return { _tag: "Value", value: { type: "string", value: "installed" } } as const
              }
              if (installs === 1 && loss === "engine") {
                return { _tag: "Value", value: { type: "string", value: Engine.missing } } as const
              }
              assert.deepStrictEqual(operation?.diagnostics().dispatch, { _tag: "MayHaveBeenSent" })
              calls++
              return {
                _tag: "Value",
                value: { type: "string", value: JSON.stringify({ _tag: "Count", count: 1 }) }
              } as const
            })
          })))
        )
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const { entry, runtime } = Handles.page(page)
          const result = yield* Effect.gen(function*() {
            const record = yield* Operation.record
            operation = record
            return yield* Runtime.send(
              runtime,
              entry,
              {
                op: "act",
                steps: [],
                action: { _tag: "Focus" },
                apply: true,
                cap: 100,
                checks: {
                  rendered: false,
                  visible: false,
                  enabled: false,
                  editable: false,
                  notInert: false,
                  inViewport: false,
                  stable: 0,
                  receivesPointer: false
                }
              },
              record.id,
              record.budget.at
            )
          }).pipe(Operation.named("test.applyingRoundInstall"), Effect.result)
          assert.strictEqual(result._tag, "Success")
          assert.strictEqual(installs, 2)
          assert.strictEqual(calls, 1)
        }).pipe(Effect.scoped, Effect.provide(layer))
      }).pipe(Effect.scoped)
  )
}

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

describe("Locator.selectText", () => {
  it.effect("uses the owned action path and reports the backend's typed refusal", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.locator("#field").selectText().pipe(Effect.flip)
      assert(Locator.isLocatorError(error))
      assert.strictEqual(error.reason._tag, "Unsupported")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
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
  for (const mode of ["success", "refusal", "deadline", "installation deadline", "document handoff"] as const) {
    it.effect(
      mode === "installation deadline"
        ? "ends a read at its deadline during node installation"
        : mode === "document handoff" ?
        "resolves a document handoff before reading geometry"
        : `releases the temporary node after geometry ${mode}`,
      () =>
        Effect.gen(function*() {
          const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
          const reading = yield* Deferred.make<void>()
          const finishInstallation = yield* Deferred.make<void>()
          let document!: Target.DocumentId
          const released: Array<string> = []
          let inputs = 0
          let queries = 0
          const layer = BrowserImpl.layer((sink) =>
            Fake.connect([], {
              info: new Browser.Info(Fake.info),
              capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
            })(sink).pipe(
              Effect.map((adapter): Adapter.AdapterConnection => ({
                ...adapter,
                realm: (id) =>
                  Effect.sync(() => {
                    document = id
                    return "geometry-realm" as Target.RealmId
                  }),
                evaluate: (_realm, call) =>
                  mode === "installation deadline" && call.functionDeclaration === Engine.install
                    ? Deferred.succeed(reading, undefined).pipe(
                      Effect.andThen(Deferred.await(finishInstallation)),
                      Effect.as({ _tag: "Value", value: { type: "string", value: "installed" } } as const)
                    )
                    : Effect.succeed(
                      call.functionDeclaration === Engine.install
                        ? { _tag: "Value", value: { type: "string", value: "installed" } }
                        : {
                          _tag: "Value",
                          value: {
                            type: "node",
                            node: mode === "document handoff" && queries++ === 0
                              ? { document: "during-commit" as Target.DocumentId, binding: "handoff-box" }
                              : { document, binding: "temporary-box" }
                          }
                        }
                    ),
                geometry: (node) =>
                  mode === "deadline" ?
                    Deferred.succeed(reading, undefined).pipe(Effect.andThen(Effect.never)) :
                    mode === "refusal" ?
                    Effect.fail(
                      new Adapter.AdapterError({
                        reason: {
                          _tag: "Unsupported",
                          capability: "Locator.boundingBox",
                          hint: "native geometry refused"
                        }
                      })
                    )
                    : Effect.succeed({
                      document: node.document,
                      data: {
                        quads: [[{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 6 }, { x: 1, y: 6 }]],
                        matrix: null,
                        width: 3,
                        height: 4,
                        contentX: 0,
                        contentY: 0,
                        pixelRatio: 1,
                        hint: null
                      }
                    }),
                releaseNodes: (nodes) =>
                  Effect.sync(() => {
                    released.push(...nodes.map((node) => node.binding))
                  }),
                dispatchInput: () =>
                  Effect.sync(() => {
                    inputs++
                  })
              }))
            )
          )
          yield* Effect.gen(function*() {
            const page = yield* Browser.newPage()
            if (mode === "deadline" || mode === "installation deadline") {
              const pending = yield* page.locator("#box").boundingBox.pipe(
                Deadline.within("1 second"),
                Effect.flip,
                Effect.forkChild
              )
              yield* Deferred.await(reading)
              yield* TestClock.adjust("1 second")
              const settled = pending.pollUnsafe()
              yield* Deferred.succeed(finishInstallation, undefined)
              const error = yield* Fiber.join(pending)
              assert.isDefined(settled, "the pending browser read must not mask the operation deadline")
              assert(Deadline.isTimeout(error))
              assert.strictEqual(error.phase, "resolving")
              assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "NotSent" })
            } else if (mode === "refusal") {
              const error = yield* page.locator("#box").boundingBox.pipe(Effect.flip)
              assert(Locator.isLocatorError(error))
              assert.strictEqual(error.reason._tag, "Unsupported")
            } else {
              assert.deepStrictEqual(
                yield* page.locator("#box").boundingBox,
                Option.some({ x: 1, y: 2, width: 3, height: 4 })
              )
            }
            if (mode === "document handoff") {
              assert.sameMembers(released, ["temporary-box", "handoff-box"])
              assert.strictEqual(queries, 2)
            } else assert.deepStrictEqual(released, mode === "installation deadline" ? [] : ["temporary-box"])
            assert.strictEqual(inputs, 0)
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
        }).pipe(Effect.scoped)
    )
  }

  it.effect("reports backend refusal through the readonly read error contract", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.locator("#box").boundingBox.pipe(Effect.flip)
      assert(Locator.isLocatorError(error))
      assert.strictEqual(error.operation, "Locator.boundingBox")
      assert.strictEqual(error.reason._tag, "Unsupported")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
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
describe("Locator.isEditable", () => {
  it.effect("reads through the engine without dispatching input", () => {
    let reads = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: () => Effect.succeed("editable-realm" as Target.RealmId),
        dispatchInput: () => Effect.die("a read must never dispatch input"),
        evaluate: (_realm, call) =>
          Effect.sync(() => {
            if (call.functionDeclaration === Engine.install) {
              return { _tag: "Value", value: { type: "string", value: "installed" } } as const
            }
            const argument = call.arguments[0]
            assert(argument?._tag === "Value" && argument.value.type === "string")
            const request = JSON.parse(argument.value.value) as Engine.Request
            assert(request.op === "read" && request.read._tag === "Editable")
            reads++
            return {
              _tag: "Value",
              value: { type: "string", value: JSON.stringify({ _tag: "Read", value: true }) }
            } as const
          })
      })))
    )
    return Effect.gen(function*() {
      const page = yield* Browser.newPage()
      assert.isTrue(yield* page.locator("#field").isEditable)
      assert.strictEqual(reads, 1)
    }).pipe(Effect.scoped, Effect.provide(layer))
  })
})
