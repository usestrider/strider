/** Runtime validation for JavaScript callers that bypass Locator's TypeScript contract. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Locator, Target } from "@usestrider/browser"
import * as Cache from "effect/Cache"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
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
                          expected: "a checkbox, a radio, or an ARIA checkable",
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

describe("checked-action Disabled deadline evidence", () => {
  for (const action of ["check", "uncheck"] as const) {
    for (const observed of [true, false, "immediate"] as const) {
      it.effect(`${action} ${observed === "immediate" ? "samples Disabled before waiting" : observed ? "retains observed Disabled" : "does not invent history for a late Disabled reply"} at its deadline`, () =>
        Effect.gen(function*() {
          const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
          const waiting = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const responseFiber = yield* Deferred.make<Fiber.Fiber<Adapter.RemoteResult>>()
          const scope = yield* Scope.Scope
          let rounds = 0
          let inputs = 0
          const disabled: Engine.Response = {
            _tag: "NotReady",
            reason: { _tag: "Disabled" },
            history: [{ _tag: "Disabled" }],
            scrolled: false,
            checked: true
          }
          const remote = (response: Engine.Response): Adapter.RemoteResult => ({
            _tag: "Value",
            value: { type: "string", value: JSON.stringify(response) }
          })
          const layer = BrowserImpl.layer((sink) =>
            Fake.connect([], {
              info: new Browser.Info(Fake.info),
              capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
            })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
              ...adapter,
              realm: () => Effect.succeed("checked-deadline-realm" as Target.RealmId),
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
                if (request.op === "read") {
                  assert(request.read._tag === "Checked")
                  assert.strictEqual(request.read.followLabel, true)
                  assert.strictEqual(request.read.uncheck, action === "uncheck")
                  return remote({ _tag: "Read", value: action === "uncheck" })
                }
                assert(request.op === "act" && request.action._tag === "Point")
                assert.strictEqual(request.action.checked, true)
                assert.strictEqual(request.checks.enabled, true)
                rounds++
                if (observed && rounds === 1 && (observed !== "immediate" || request.sample === true)) {
                  return remote(disabled)
                }
                // The second request proves L1 already consumed the first Disabled reply.
                // Otherwise this is the first reply, which the browser delivers only after expiry.
                const late = yield* Deferred.await(release).pipe(
                  Effect.as(remote(disabled)),
                  Effect.forkDetach
                )
                yield* Scope.addFinalizer(scope, Fiber.interrupt(late))
                yield* Deferred.succeed(responseFiber, late)
                yield* Deferred.succeed(waiting, undefined)
                return yield* Fiber.join(late)
              })
            })))
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const running = yield* page.locator("#label")[action]().pipe(
              Deadline.within("200 millis"),
              Effect.flip,
              Effect.forkChild
            )
            yield* Deferred.await(waiting)
            yield* TestClock.adjust("200 millis")
            const error = yield* Fiber.join(running)
            assert(Deadline.isTimeout(error), String(error))
            assert.strictEqual(error.operation, `Locator.${action}`)
            assert.strictEqual(error.diagnostics.dispatch._tag, "NotSent")
            if (observed) {
              assert(error.history.some((entry) => (entry.value as { _tag: string })._tag === "Disabled"))
              assert(Option.isSome(error.last))
              assert.deepStrictEqual(error.last.value.value, { _tag: "Disabled" })
            } else {
              assert.deepStrictEqual(error.history, [])
              assert(Option.isNone(error.last))
            }
            assert.strictEqual(inputs, 0)
            const history = [...error.history]
            yield* Deferred.succeed(release, undefined)
            const reply = yield* Fiber.join(yield* Deferred.await(responseFiber))
            assert.deepStrictEqual(reply, remote(disabled))
            // A late page observation cannot retroactively change the error already returned.
            assert.strictEqual(yield* Fiber.join(running), error)
            assert.deepStrictEqual(error.history, history)
            assert.strictEqual(error.diagnostics.dispatch._tag, "NotSent")
            assert.strictEqual(inputs, 0)
          })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
        }).pipe(Effect.scoped))
    }
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
              assert.sameMembers(released, ["handoff-box"])
              assert.strictEqual(queries, 1, "the bound node's document is used without looking again")
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
      const error = yield* page.locator("p").evaluateAll((elements: ReadonlyArray<unknown>) => elements.length).pipe(
        Effect.flip
      )
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
    const error = yield* locator.evaluateAll((elements: ReadonlyArray<unknown>) => elements.length).pipe(Effect.flip)
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
      const expired = yield* page.locator("p").evaluateAll((elements: ReadonlyArray<unknown>) => elements.length).pipe(
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

it.effect("does not acknowledge native fill while its insertion guard is still pending", () =>
  Effect.gen(function*() {
    const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
    const guarding = yield* Deferred.make<void>()
    const cleaned = yield* Deferred.make<void>()
    let inputs = 0
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: () => Effect.succeed("fill-realm" as Target.RealmId),
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
          if (request.op === "fillGuard") {
            yield* Deferred.succeed(guarding, undefined)
            return yield* Effect.never
          }
          if (request.op === "fillDisarm") {
            yield* Deferred.succeed(cleaned, undefined)
            return {
              _tag: "Value",
              value: {
                type: "string",
                value: JSON.stringify({
                  _tag: "FillGuard",
                  blocked: "input#other",
                  unsafe: false,
                  accepted: false
                })
              }
            } as const
          }
          assert(request.op === "act" && request.action._tag === "Fill")
          return {
            _tag: "Value",
            value: {
              type: "string",
              value: JSON.stringify({
                _tag: "Ready",
                element: "p#target",
                scrolled: false,
                point: null,
                draggable: false,
                checked: null,
                fill: request.apply ? "guarded" : null
              })
            }
          } as const
        })
      })))
    )
    yield* Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const pending = yield* page.locator("#target").fill("new").pipe(
        Deadline.within("1 second"),
        Effect.flip,
        Effect.forkChild
      )
      yield* Deferred.await(guarding)
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(pending)
      yield* Deferred.await(cleaned)
      assert(Deadline.isTimeout(error))
      assert.strictEqual(inputs, 0)
      assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "NotSent" })
    })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
  }).pipe(Effect.scoped))

const guardCleanup = Effect.fnUntraced(function*(disarm: "gone" | "missing", ends: boolean) {
  const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
  const guarding = yield* Deferred.make<void>()
  const cleaned = yield* Deferred.make<void>()
  const warnings: Array<string> = []
  const logger = Logger.make((options) => {
    const message = (options.message as ReadonlyArray<string>).join(" ")
    if (options.logLevel === "Warn") warnings.push(message)
  })
  let connection: Adapter.AdapterConnection | undefined
  const layer = BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => (connection = {
      ...adapter,
      realm: () => Effect.succeed("fill-realm" as Target.RealmId),
      evaluate: Effect.fnUntraced(function*(_realm, call) {
        if (call.functionDeclaration === Engine.install) {
          return { _tag: "Value", value: { type: "string", value: "installed" } } as const
        }
        const argument = call.arguments[0]
        assert(argument?._tag === "Value" && argument.value.type === "string")
        const request = JSON.parse(argument.value.value) as Engine.Request
        if (request.op === "fillGuard") {
          yield* Deferred.succeed(guarding, undefined)
          return yield* Effect.never
        }
        if (request.op === "fillDisarm") {
          yield* Deferred.succeed(cleaned, undefined)
          if (disarm === "missing") {
            return { _tag: "Value", value: { type: "string", value: Engine.missing } } as const
          }
          // The navigation destroyed the realm; the model hasn't yet dropped the document.
          return yield* Effect.fail(
            new Adapter.AdapterError({
              reason: {
                _tag: "Gone",
                target: { _tag: "Realm", id: "fill-realm" as Target.RealmId },
                reason: new Target.RealmDestroyed({})
              }
            })
          )
        }
        assert(request.op === "act" && request.action._tag === "Fill")
        return {
          _tag: "Value",
          value: {
            type: "string",
            value: JSON.stringify({
              _tag: "Ready",
              element: "p#target",
              scrolled: false,
              point: null,
              draggable: false,
              checked: null,
              fill: request.apply ? "guarded" : null
            })
          }
        } as const
      })
    })))
  )
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const pending = yield* page.locator("#target").fill("new").pipe(
      Deadline.within("1 second"),
      Effect.flip,
      Effect.forkChild
    )
    yield* Deferred.await(guarding)
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(pending)
    yield* Deferred.await(cleaned)
    if (ends) {
      yield* connection!.navigate(page.id, "https://example.test/next", { referrer: Option.none() })
    }
    // Past the cleanup's default budget when nothing ends the document
    yield* TestClock.adjust(ends ? "1 second" : "10 minutes")
    assert.strictEqual(warnings.length, disarm === "gone" && ends ? 0 : 1)
  })).pipe(
    Effect.provide(layer),
    Effect.provideService(BrowserClock.CurrentClock, clock),
    Effect.provideService(Logger.CurrentLoggers, new Set([logger]))
  )
}, Effect.scoped)

it.effect(
  "does not leave input blocked when navigation destroys the realm during guard cleanup",
  () => guardCleanup("gone", true)
)

it.effect(
  "keeps input blocked when the realm is destroyed but the document is still live at the cleanup's deadline",
  () => guardCleanup("gone", false)
)

it.effect("keeps input blocked when a live document's engine is missing during guard cleanup", () =>
  guardCleanup("missing", true))

for (const boundary of ["unanswered", "set", "type", "guarded", "confirmed"] as const) {
  it.effect(`accounts for fill at the ${boundary} boundary`, () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
      const reached = yield* Deferred.make<void>()
      let record: Operation.Record | undefined
      let inputs = 0
      let disarms = 0
      const layer = BrowserImpl.layer((sink) =>
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
          ...adapter,
          realm: () => Effect.succeed("fill-boundary-realm" as Target.RealmId),
          dispatchInput: Effect.fnUntraced(function*() {
            inputs++
            if (boundary === "confirmed") return
            yield* Deferred.succeed(reached, undefined)
            return yield* Effect.never
          }),
          evaluate: Effect.fnUntraced(function*(_realm, call) {
            if (call.functionDeclaration === Engine.install) {
              return { _tag: "Value", value: { type: "string", value: "installed" } } as const
            }
            const argument = call.arguments[0]
            assert(argument?._tag === "Value" && argument.value.type === "string")
            const request = JSON.parse(argument.value.value) as Engine.Request
            if (request.op === "fillGuard" || request.op === "fillDisarm") {
              if (request.op === "fillDisarm" && boundary === "confirmed" && disarms++ === 0) {
                yield* Deferred.succeed(reached, undefined)
                return yield* Effect.never
              }
              return {
                _tag: "Value",
                value: {
                  type: "string",
                  value: JSON.stringify({
                    _tag: "FillGuard",
                    blocked: null,
                    unsafe: false,
                    accepted: true
                  })
                }
              } as const
            }
            assert(request.op === "act" && request.action._tag === "Fill")
            if (request.apply) {
              record = yield* Operation.record
              if (boundary === "unanswered") {
                yield* Deferred.succeed(reached, undefined)
                return yield* Effect.never
              }
            }
            return {
              _tag: "Value",
              value: {
                type: "string",
                value: JSON.stringify({
                  _tag: "Ready",
                  element: "input#target",
                  scrolled: false,
                  point: null,
                  draggable: false,
                  checked: null,
                  fill: request.apply ? (boundary === "confirmed" ? "guarded" : boundary) : null
                })
              }
            } as const
          })
        })))
      )
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        if (boundary === "set") {
          yield* page.locator("#target").fill("new")
          assert.strictEqual(inputs, 0)
          assert.deepStrictEqual(record?.dispatch, { _tag: "Acknowledged", result: "ok" })
          return
        }
        const pending = yield* page.locator("#target").fill("new").pipe(
          Deadline.within("1 second"),
          Effect.flip,
          Effect.forkChild
        )
        yield* Deferred.await(reached)
        yield* TestClock.adjust("1 second")
        const error = yield* Fiber.join(pending)
        assert(Deadline.isTimeout(error))
        assert.strictEqual(inputs, boundary === "unanswered" ? 0 : 1)
        assert.deepStrictEqual(
          error.diagnostics.dispatch,
          boundary === "confirmed"
            ? { _tag: "Acknowledged", result: "ok" }
            : { _tag: "MayHaveBeenSent" }
        )
        assert.strictEqual(error.phase, boundary === "confirmed" ? "postcondition" : "dispatchedUnconfirmed")
        if (boundary === "confirmed") assert.strictEqual(disarms, 2)
      })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    }).pipe(Effect.scoped))
}

// A frame can commit while an element lookup resolves: the engine then answers from the new document, so the
// node it returns belongs to `committed` while the lookup was routed to the page's earlier `current` document.
// `lookups` gives what each successive engine call returns, as node documents; later calls return undefined.
const withCommittedLookup = <A, E, R>(
  lookups: (documents: { readonly current: Target.DocumentId; readonly committed: Target.DocumentId }) => ReadonlyArray<
    ReadonlyArray<Target.DocumentId>
  >,
  body: (input: {
    readonly page: Effect.Success<ReturnType<typeof Browser.newPage>>
    readonly current: Target.DocumentId
    readonly committed: Target.DocumentId
    readonly realms: Array<Target.DocumentId>
  }) => Effect.Effect<A, E, R>
) => {
  const committed = "committed-frame-document" as Target.DocumentId
  const realms: Array<Target.DocumentId> = []
  const queue: Array<ReadonlyArray<Target.DocumentId>> = []
  const layer = BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({
        entries: Fake.capabilities.map((entry) =>
          entry.name === "isolatedWorlds" ? { ...entry, status: "supported", limitations: [] } : entry
        )
      })
    })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
      ...adapter,
      realm: (document) =>
        Effect.sync(() => {
          realms.push(document)
          return "realm" as Target.RealmId
        }),
      evaluate: (_realm, call) =>
        Effect.sync(() => {
          if (call.functionDeclaration === Engine.install) {
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          const next = queue.shift()
          if (next === undefined) return { _tag: "Value", value: { type: "undefined" } } as const
          const nodes = next.map((document, index) => ({
            type: "node" as const,
            node: { document, binding: `node-${index}` }
          }))
          return {
            _tag: "Value",
            value: nodes.length === 1 ? nodes[0]! : { type: "array" as const, value: nodes }
          } as const
        })
    })))
  )
  return Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const { entry, runtime } = Handles.page(page)
    const current = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
    queue.push(...lookups({ current, committed }))
    return yield* body({ page, current, committed, realms })
  })).pipe(Effect.provide(layer))
}

it.effect("evaluate runs in the realm of the bound node's document when a frame commits during resolution", () =>
  withCommittedLookup(({ committed }) => [[committed]], ({ committed, page, realms }) =>
    Effect.gen(function*() {
      yield* page.locator("#target").evaluate((element: { id: string }) => element.id).pipe(Effect.ignore)
      assert.strictEqual(realms.at(-1), committed, "the realm comes from node.document, not the routed document")
    })))

it.effect("evaluateAll runs in the realm of the bound nodes' document when a frame commits during resolution", () =>
  withCommittedLookup(
    ({ committed }) => [[committed, committed]],
    ({ committed, page, realms }) =>
      Effect.gen(function*() {
        yield* page.locator("li").evaluateAll((elements: ReadonlyArray<unknown>) => elements.length).pipe(Effect.ignore)
        assert.strictEqual(realms.at(-1), committed, "the realm comes from the nodes' document")
      })
  ))

const syntheticDrag = (from: Locator.Locator, to: Locator.Locator) =>
  Operation.named("Locator.dragTo")(
    Effect.flatMap(Operation.record, (record) =>
      ((from as any).syntheticDrag(to, undefined, record)) as Effect.Effect<unknown, unknown>)
  ).pipe(Effect.flip, Effect.option)

it.effect("a synthetic dragTo runs in the realm of the bound nodes' document when a frame commits during resolution", () =>
  withCommittedLookup(
    ({ committed }) => [[committed], [committed]],
    ({ committed, page, realms }) =>
      Effect.gen(function*() {
        const error = yield* syntheticDrag(page.locator("#a"), page.locator("#b"))
        const reason = Option.isSome(error) ? (error.value as any).reason?._tag : undefined
        assert.notStrictEqual(reason, "InvalidInput", "same-document nodes refused as a cross-document drag")
        assert.strictEqual(realms.at(-1), committed)
      })
  ))

it.effect("a synthetic dragTo refuses nodes of different documents when only one lookup straddled the commit", () =>
  withCommittedLookup(({ committed, current }) => [[committed], [current]], ({ page }) =>
    Effect.gen(function*() {
      const error = yield* syntheticDrag(page.locator("#a"), page.locator("#b"))
      assert.strictEqual(Option.isSome(error) ? (error.value as any).reason?._tag : undefined, "InvalidInput")
    })))

it.effect("evaluateAll uses the committed document for an empty match set after realm acquisition crosses a commit", () =>
  Effect.gen(function*() {
    let acquire = Effect.void
    let acquired = false
    const requested: Array<Target.DocumentId> = []
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({
          entries: Fake.capabilities.map((entry) =>
            entry.name === "isolatedWorlds" ? { ...entry, status: "supported", limitations: [] } : entry
          )
        })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        // A realm acquired for a document is that document's, or the document has ended: the commit during
        // the first acquisition ends the requested document, so its realm fails and the lookup routes again.
        realm: Effect.fnUntraced(function*(document) {
          requested.push(document)
          if (!acquired) {
            acquired = true
            yield* acquire
            return yield* Effect.fail(
              new Adapter.AdapterError({
                reason: {
                  _tag: "Gone",
                  target: { _tag: "Document", id: document },
                  reason: new Target.DocumentReplaced({})
                }
              })
            )
          }
          return "committed-realm" as Target.RealmId
        }),
        evaluate: (_realm, call) =>
          Effect.succeed({
            _tag: "Value",
            value: call.functionDeclaration === Engine.install
              ? { type: "string", value: "installed" }
              : call.functionDeclaration === Engine.element
              ? { type: "array", value: [] }
              : { type: "number", value: 0 }
          })
      })))
    )
    yield* Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const { entry, runtime } = Handles.page(page)
      const previous = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      acquire = runtime.model.adapter.navigate(entry.id, "https://example.test/committed", { referrer: Option.none() })
        .pipe(Effect.asVoid, Effect.orDie)
      assert.strictEqual(yield* page.locator(".absent").evaluateAll((elements) => elements.length), 0)
      const committed = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      assert.notStrictEqual(committed, previous)
      assert.deepStrictEqual(requested.slice(0, 2), [previous, committed], "the lookup routes again to the replacement")
      assert.strictEqual(requested.at(-1), committed, "the empty snapshot's callback runs in the replacement document")
    }).pipe(Effect.scoped, Effect.provide(layer))
  }))

it.effect("evaluateAll does not move an empty snapshot to a document committed after the query ran", () =>
  Effect.gen(function*() {
    let beforeReply = Effect.void
    const requested: Array<Target.DocumentId> = []
    const layer = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({
          entries: Fake.capabilities.map((entry) =>
            entry.name === "isolatedWorlds" ? { ...entry, status: "supported", limitations: [] } : entry
          )
        })
      })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
        ...adapter,
        realm: (document) =>
          Effect.sync(() => {
            requested.push(document)
            return "searched-realm" as Target.RealmId
          }),
        evaluate: Effect.fnUntraced(function*(_realm, call) {
          if (call.functionDeclaration === Engine.install) {
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          if (call.functionDeclaration === Engine.element) {
            // The query already produced its empty snapshot; a navigation is folded before its reply is consumed.
            const result = { _tag: "Value", value: { type: "array", value: [] } } as const
            yield* beforeReply
            return result
          }
          return { _tag: "Value", value: { type: "number", value: 0 } } as const
        })
      })))
    )
    yield* Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const { entry, runtime } = Handles.page(page)
      const searched = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      beforeReply = runtime.model.adapter.navigate(entry.id, "https://example.test/replacement", {
        referrer: Option.none()
      }).pipe(Effect.asVoid, Effect.orDie)
      yield* page.locator(".absent").evaluateAll((elements) => elements.length)
      const current = Option.getOrThrow(yield* runtime.model.documentOf(entry.id))
      assert.notStrictEqual(current, searched)
      assert.strictEqual(
        requested.at(-1),
        searched,
        "an empty snapshot must not dispatch its callback in an unsearched document"
      )
    }).pipe(Effect.scoped, Effect.provide(layer))
  }))
