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

const scenario = (
  resumes: ReadonlyArray<Engine.CooperativeResponse> = [],
  afterResume: () => Effect.Effect<void> = () => Effect.void
) => {
  let resumed = 0
  const commands: Array<Engine.CooperativeCommand> = []
  const evaluations: Array<"install" | "run" | "cooperate"> = []
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
            evaluations.push("install")
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          evaluations.push(call.functionDeclaration === Engine.cooperate ? "cooperate" : "run")
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
            resumes[resumed++] ?? (command.command === "resume" && command.decision === "restart"
              ? { _tag: "Restart" }
              : { _tag: "Done", response: ordinary })
          return { _tag: "Value", value: { type: "string", value: JSON.stringify(response) } } as const
        }).pipe(Effect.tap(() => {
          if (call.functionDeclaration !== Engine.cooperate) return Effect.void
          const arg = call.arguments[0]
          assert(arg?._tag === "Value" && arg.value.type === "string")
          return JSON.parse(arg.value.value).command === "resume" ? afterResume() : Effect.void
        }))
    })))
  )
  return { layer, commands, evaluations }
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
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "finish", "cancel"])
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    }))

  it.effect("returns round-expiry observations even when the hook requests restart", () =>
    Effect.gen(function*() {
      const terminal = { _tag: "Expected", passed: false, observed: "actual", changed: true } as const
      const { layer, commands } = scenario([{ _tag: "Done", response: terminal }])
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const result = yield* run(owner, () => Effect.succeed("restart" as const))
        assert(!("_tag" in result))
        assert.deepStrictEqual(result.response, terminal)
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "resume"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("fails explicitly instead of restarting when a continuation answer is unavailable", () =>
    Effect.gen(function*() {
      const { layer, commands } = scenario([
        { _tag: "Disposed" },
        { _tag: "Done", response: { _tag: "Expected", passed: false, observed: "lost", changed: true } }
      ])
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const failure = yield* run(owner, () => Effect.succeed("continue" as const)).pipe(Effect.flip)
        assert.strictEqual(failure._tag, "Reason")
        if (failure._tag === "Reason") {
          assert.strictEqual(failure.reason._tag, "BackendFailure")
          assert.include(failure.reason.message, "unavailable")
        }
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "resume", "cancel"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("reroutes a disposed waiting round only after departure without renewing its budget", () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
      let depart: Effect.Effect<void> = Effect.void
      let departures = 0
      const { layer, commands } = scenario([{ _tag: "Disposed" }], () => departures++ === 0 ? depart : Effect.void)
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        depart = Effect.andThen(TestClock.adjust("40 millis"), page.goto("https://example.test/next")).pipe(
          Effect.asVoid,
          Effect.orDie
        )
        const answer = yield* run(owner, () => Effect.succeed("continue" as const)).pipe(
          Deadline.within("100 millis")
        )
        assert(!("_tag" in answer))
        const starts = commands.filter((command) => command.command === "start")
        assert.strictEqual(starts.length, 2)
        assert.notStrictEqual(starts[0]!.document, starts[1]!.document)
        assert.notStrictEqual(starts[0]!.session, starts[1]!.session)
        assert.strictEqual(starts[0]!.operation, starts[1]!.operation)
        assert.strictEqual(starts[0]!.budget, 100)
        assert.strictEqual(starts[1]!.budget, 60)
        // Only the new document's continuation can complete; the old token is never replayed.
        const resumes = commands.filter((command) => command.command === "resume")
        assert.strictEqual(resumes.length, 2)
        assert.notStrictEqual(resumes[0]!.document, resumes[1]!.document)
        assert.deepStrictEqual(commands.map((command) => command.command), [
          "start",
          "resume",
          "cancel",
          "start",
          "resume"
        ])
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    }))

  it.effect("reroutes an explicit departure before the host receives the document commit", () =>
    Effect.gen(function*() {
      const { layer, commands } = scenario([{ _tag: "Departed" }])
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const answer = yield* run(owner, () => Effect.succeed("continue" as const))
        assert(!("_tag" in answer))
        assert.deepStrictEqual(commands.map((command) => command.command), [
          "start",
          "resume",
          "cancel",
          "start",
          "resume"
        ])
        assert.strictEqual(commands[0]!.operation, commands[3]!.operation)
        assert.notStrictEqual(commands[0]!.session, commands[3]!.session)
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("does not replay a disposed applying action on the same document", () =>
    Effect.gen(function*() {
      const { layer, commands } = scenario([{ _tag: "Disposed" }])
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const failure = yield* run(owner, () => Effect.succeed("continue" as const), {
          op: "act",
          steps: request.steps!,
          cap: 1000,
          apply: true,
          action: { _tag: "Focus" },
          checks: {
            rendered: false,
            visible: true,
            enabled: true,
            editable: false,
            notInert: true,
            inViewport: false,
            stable: 0,
            receivesPointer: false
          }
        }).pipe(Effect.flip)
        assert.strictEqual(failure._tag, "Reason")
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "resume", "cancel"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("collects failed observations after the absolute deadline without checking again", () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
      const terminal = { _tag: "Expected", passed: false, observed: "actual", changed: true } as const
      const { layer, commands } = scenario([{ _tag: "Done", response: terminal }])
      const entered = yield* Deferred.make<void>()
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const pending = yield* run(owner, () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never))
          .pipe(Deadline.within("100 millis"), Effect.forkChild)
        yield* Deferred.await(entered)
        yield* TestClock.adjust("100 millis")
        const answer = yield* Fiber.join(pending)
        assert(!("_tag" in answer))
        assert.deepStrictEqual(answer.response, terminal)
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "finish"])
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    }))

  it.effect("acknowledges terminal evidence returned to an in-flight resume", () =>
    Effect.gen(function*() {
      const terminal = { _tag: "Expected", passed: false, observed: "actual", changed: true } as const
      const { layer, commands } = scenario([{ _tag: "Done", response: terminal, retained: true }])
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const owner = (page.locator("#ready") as LocatorImpl).owner
        const answer = yield* run(owner, () => Effect.succeed("continue" as const))
        assert(!("_tag" in answer))
        assert.deepStrictEqual(answer.response, terminal)
        assert.deepStrictEqual(commands.map((command) => command.command), ["start", "resume", "cancel"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))

  it.effect("does no cooperative browser work on ordinary requests", () =>
    Effect.gen(function*() {
      const { layer, commands, evaluations } = scenario()
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const { runtime, page: entry } = (page.locator("#ready") as LocatorImpl).owner
        yield* Effect.gen(function*() {
          const record = yield* Operation.record
          const response = yield* Runtime.send(runtime, entry, request, record.id, record.budget.at)
          assert.strictEqual(response._tag, "Expected")
        }).pipe(Operation.named("Test.ordinary"))
        assert.deepStrictEqual(commands, [])
        assert.deepStrictEqual(evaluations, ["install", "run"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }))
})
