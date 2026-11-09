/** Cooperative dispatch owns its request lifetime, while ordinary dispatch never enters that protocol. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Target } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { TestClock } from "effect/testing"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Fake from "../src/internal/fake.ts"
import { LocatorImpl } from "../src/internal/locator.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Runtime from "../src/internal/runtime.ts"

const request: Engine.CooperativeRequest = {
  op: "expect",
  steps: [{ _tag: "Css", selector: "#ready" }],
  expectation: { _tag: "Visible" },
  cap: 1000
}

const scenario = () => {
  const commands: Array<Engine.CooperativeCommand> = []
  const layer = BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
      ...adapter,
      realm: () => Effect.succeed(Target.RealmId.make("cooperative-realm")),
      evaluate: (_realm, call) =>
        Effect.sync(() => {
          if (call.functionDeclaration === Engine.install) {
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          const arg = call.arguments[0]
          assert(arg?._tag === "Value" && arg.value.type === "string")
          const command = JSON.parse(arg.value.value) as Engine.CooperativeCommand
          const ordinary = { _tag: "Expected", passed: true, observed: true, changed: false }
          if (call.functionDeclaration === Engine.cooperate) commands.push(command)
          const response = call.functionDeclaration !== Engine.cooperate ?
            ordinary :
            command.command === "start" ?
            {
              _tag: "Check",
              token: "check-token",
              final: command.final === true || command.request.op === "act" && command.request.apply
            } :
            command.command === "cancel" ?
            { _tag: "Disposed" } :
            command.decision === "restart"
            ? { _tag: "Restart" }
            : { _tag: "Done", response: ordinary }
          return { _tag: "Value", value: { type: "string", value: JSON.stringify(response) } } as const
        })
    })))
  )
  return { layer, commands }
}

const run = Effect.fnUntraced(function*<E, R>(
  owner: LocatorImpl["owner"],
  hook: (routed: Runtime.Routed, final: boolean) => Effect.Effect<"continue" | "invalidate" | "restart", E, R>,
  current: Engine.CooperativeRequest = request,
  final = false
) {
  const record = yield* Operation.record
  return yield* Runtime.sendCooperative(owner.runtime, owner.page, current, record.id, record.budget.at, hook, {
    final
  })
}, Operation.named("Test.cooperative"))

describe("cooperative runtime", () => {
  it.effect("passes typed hook errors unchanged and cancels without resuming", () =>
    Effect.gen(function*() {
      const { layer, commands } = scenario()
      const sentinel = { _tag: "CallbackFailure", fields: { preserved: true } }
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const error = yield* run(owner, () => Effect.fail(sentinel)).pipe(Effect.flip)
        assert.strictEqual(error, sentinel)
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "cancel"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("returns a final restart for a trial without resuming application", () =>
    Effect.gen(function*() {
      const { layer, commands } = scenario()
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const action: Engine.CooperativeRequest = {
          op: "act",
          steps: request.steps!,
          cap: 1000,
          apply: false,
          checks: {
            rendered: false,
            visible: true,
            enabled: true,
            editable: false,
            notInert: true,
            inViewport: false,
            stable: 0,
            receivesPointer: false
          },
          action: { _tag: "Focus" }
        }
        const result = yield* run(
          owner,
          (_routed, final) => {
            assert.isTrue(final)
            return Effect.succeed("restart" as const)
          },
          action,
          true
        )
        assert.deepStrictEqual(result, { _tag: "Restart" })
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "resume"])
        assert.strictEqual(commands[0]!.operation, commands[1]!.operation)
        assert.strictEqual(commands[0]!.document, commands[1]!.document)
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("charges hook waiting to the original deadline and cancels on interruption", () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
      const { layer, commands } = scenario()
      const entered = yield* Deferred.make<void>()
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const pending = yield* run(owner, () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never))
          .pipe(Deadline.within("100 millis"), Effect.flip, Effect.forkChild)
        yield* Deferred.await(entered)
        yield* TestClock.adjust("100 millis")
        const error = yield* Fiber.join(pending)
        assert.strictEqual(error._tag, "Deadline")
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "cancel"])
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    }))

  it.effect("does no cooperative browser work on ordinary requests", () =>
    Effect.gen(function*() {
      const { layer, commands } = scenario()
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const { runtime, page: entry } = (page.locator("#ready") as LocatorImpl).owner
        yield* Effect.gen(function*() {
          const record = yield* Operation.record
          const response = yield* Runtime.send(runtime, entry, request, record.id, record.budget.at)
          assert.strictEqual(response._tag, "Expected")
        }).pipe(Operation.named("Test.ordinary"))
        assert.deepStrictEqual(commands, [])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))
})
