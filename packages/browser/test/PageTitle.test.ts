/** Title reads retain runtime lifetimes without eagerly installing the query engine. */
import { assert, it } from "@effect/vitest"
import { Browser, Deadline, Target } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Fake from "../src/internal/fake.ts"

const text = (value: unknown): Adapter.RemoteResult => ({
  _tag: "Value",
  value: { type: "string", value: JSON.stringify(value) }
})
const backend = (evaluate: Adapter.AdapterConnection["evaluate"], isolated = true, realms: Array<string> = []) =>
  BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({
        entries: Fake.capabilities.map((entry) =>
          entry.name === "isolatedWorlds" && isolated ? { ...entry, status: "supported" as const } : entry
        )
      })
    })(sink).pipe(Effect.map((fake): Adapter.AdapterConnection => ({
      ...fake,
      realm: (document, world) => {
        assert.strictEqual(world._tag, isolated ? "Isolated" : "Main")
        realms.push(document)
        return Effect.succeed(Target.RealmId.make(`realm:${document}`))
      },
      evaluate
    })))
  )

it.effect("reads fresh titles repeatedly without an engine, then initializes it for a locator", () => {
  let title = "First"
  let installs = 0
  const layer = backend((_realm, call) => {
    if (call.functionDeclaration === Engine.install) {
      installs++
      return Effect.succeed(text("installed"))
    }
    const count = call.functionDeclaration === Engine.run &&
      call.arguments.some((arg) =>
        arg._tag === "Value" && arg.value.type === "string" && arg.value.value.includes("\"op\":\"count\"")
      )
    return Effect.succeed(text(count ? { _tag: "Count", count: 1 } : { _tag: "Title", title }))
  })
  return Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    assert.strictEqual(yield* page.title, "First")
    title = "Changed"
    assert.strictEqual(yield* page.title, "Changed")
    assert.strictEqual(installs, 0)
    assert.strictEqual(yield* page.locator("h1").count, 1)
    assert.strictEqual(installs, 1)
  })).pipe(Effect.provide(layer))
})

it.effect("retains the engine path where isolated worlds are unavailable", () => {
  let installs = 0
  return Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    assert.strictEqual(yield* page.title, "Fallback")
    assert.strictEqual(installs, 1)
  })).pipe(Effect.provide(backend((_realm, call) => {
    if (call.functionDeclaration === Engine.install) installs++
    return Effect.succeed(text({ _tag: "Title", title: "Fallback" }))
  }, false)))
})

it.effect("rebinds a title read after its document and realm are replaced", () => {
  let replace = Effect.void
  let calls = 0
  const realms: Array<string> = []
  return Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    replace = page.goto("https://example.com/replacement").pipe(Effect.orDie, Effect.asVoid)
    assert.strictEqual(yield* page.title, "Replacement")
    assert.strictEqual(calls, 2)
    assert.notStrictEqual(realms[0], realms[realms.length - 1])
  })).pipe(Effect.provide(backend(
    Effect.fnUntraced(function*(realm, call) {
      if (call.functionDeclaration === Engine.install) return text("installed")
      if (++calls === 1) {
        yield* replace
        return yield* Effect.fail(
          new Adapter.AdapterError({
            reason: {
              _tag: "Gone",
              target: { _tag: "Realm", id: realm },
              reason: new Target.RealmDestroyed({})
            }
          })
        )
      }
      return text({ _tag: "Title", title: "Replacement" })
    }),
    true,
    realms
  )))
})

for (const finish of ["cancel", "deadline"] as const) {
  it.effect(`interrupts a pending title evaluation on ${finish}`, () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const layer = backend((_realm, call) =>
        call.functionDeclaration === Engine.install
          ? Effect.succeed(text("installed"))
          : Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
          )
      )
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const read = yield* page.title.pipe(
          Deadline.within("50 millis"),
          Effect.exit,
          Effect.forkChild({ startImmediately: true })
        )
        yield* Deferred.await(started)
        if (finish === "cancel") yield* Fiber.interrupt(read)
        else {
          const exit = yield* Fiber.join(read)
          const error = Option.getOrUndefined(Cause.findErrorOption(exit._tag === "Failure" ? exit.cause : Cause.empty))
          assert.strictEqual((error as { _tag: string })._tag, "Timeout")
          if (Deadline.isTimeout(error)) assert.strictEqual(error.operation, "Page.title")
        }
        assert.isTrue(yield* Deferred.isDone(interrupted))
      })).pipe(Effect.provide(layer))
    }))
}

it.effect("retains evaluation exceptions as runtime defects", () =>
  Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const exit = yield* page.title.pipe(Effect.exit)
    assert.strictEqual(exit._tag, "Failure")
    if (exit._tag === "Failure") assert.include(Cause.pretty(exit.cause), "The engine threw: title failed")
  })).pipe(Effect.provide(backend((_realm, call) =>
    Effect.succeed(
      call.functionDeclaration === Engine.install
        ? text("installed")
        : { _tag: "Exception", text: "title failed", exception: { type: "undefined" }, stack: Option.none() }
    )
  ))))

it.effect("fails a title read after closure without evaluating", () => {
  let calls = 0
  return Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    yield* page.close()
    const error = yield* page.title.pipe(Effect.flip)
    assert.strictEqual(error._tag, "TargetGone")
    assert.strictEqual(calls, 0)
  })).pipe(Effect.provide(backend(() => {
    calls++
    return Effect.succeed(text({ _tag: "Title", title: "Closed" }))
  })))
})
