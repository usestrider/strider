/** The raw-engine fixture owns each case's resources and never retries uncertain work. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import * as Browser from "../src/Browser.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Target from "../src/Target.ts"
import type * as UserContext from "../src/UserContext.ts"
import * as Fixture from "./integration/adapter/engineConnection.ts"
import type { Backend } from "./integration/adapter/harness.ts"

const backend = (change: (adapter: Adapter.AdapterConnection) => Adapter.AdapterConnection = (adapter) => adapter) => {
  let connects = 0
  let disposals = 0
  const removed: Array<string> = []
  const sinks: Array<Adapter.Sink> = []
  const connect: Backend["connect"] = Effect.fnUntraced(function*(sink) {
    connects++
    sinks.push(sink)
    yield* Effect.addFinalizer(() => Effect.sync(() => void disposals++))
    const adapter = yield* Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink)
    return {
      adapter: change({
        ...adapter,
        closePage: (page, options) =>
          adapter.closePage(page, options).pipe(
            Effect.tap(() => Effect.sync(() => void removed.push("page:" + page)))
          ),
        removeUserContext: (context) =>
          adapter.removeUserContext(context).pipe(
            Effect.tap(() => Effect.sync(() => void removed.push("context:" + context)))
          )
      }),
      kill: Effect.void
    }
  })
  return { name: "fake", connect, connects: () => connects, disposals: () => disposals, removed, sinks }
}

describe("Raw engine connection fixture", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))((it) => {
    it.effect("reuses only the connection and confirms page then context cleanup", () =>
      Effect.scoped(Effect.gen(function*() {
        const source = backend()
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        const first = yield* Effect.scoped(fixture.page)
        assert.strictEqual(first.facts.size(), 0)
        const second = yield* Effect.scoped(fixture.page)
        assert.notStrictEqual(first.context, second.context)
        assert.notStrictEqual(first.page, second.page)
        assert.strictEqual(source.connects(), 1)
        assert.deepStrictEqual(source.removed, [
          "page:" + first.page,
          "context:" + first.context,
          "page:" + second.page,
          "context:" + second.context
        ])
        yield* fixture.reset
        assert.strictEqual(source.disposals(), 1)
      })))

    it.effect("discards uncertain cleanup and preserves the original case failure without retry", () =>
      Effect.scoped(Effect.gen(function*() {
        const source = backend((adapter) => ({ ...adapter, closePage: () => Effect.die("cleanup") }))
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        let attempts = 0
        const exit = yield* Effect.scoped(Effect.gen(function*() {
          yield* fixture.page
          attempts++
          return yield* Effect.fail("original")
        })).pipe(Effect.exit)
        assert.deepStrictEqual(Exit.findErrorOption(exit), Option.some("original"))
        assert.strictEqual(attempts, 1)
        assert.strictEqual(source.disposals(), 1)
        yield* fixture.prepare
        assert.strictEqual(source.connects(), 2)
      })))

    it.effect("fails a successful case when cleanup is uncertain and replaces its connection", () =>
      Effect.scoped(Effect.gen(function*() {
        const source = backend((adapter) => ({ ...adapter, closePage: () => Effect.die("cleanup") }))
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        const exit = yield* Effect.scoped(fixture.page).pipe(Effect.exit)
        assert.isTrue(Exit.isFailure(exit))
        assert.strictEqual(source.disposals(), 1)
        yield* fixture.prepare
        assert.strictEqual(source.connects(), 2)
      })))

    it.effect("removes the acquired context if page creation fails", () =>
      Effect.scoped(Effect.gen(function*() {
        const source = backend((adapter) => ({ ...adapter, createPage: () => Effect.die("create page") }))
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        const exit = yield* Effect.scoped(fixture.page).pipe(Effect.exit)
        assert.isTrue(Exit.isFailure(exit))
        assert.strictEqual(source.removed.length, 1)
        assert(source.removed[0]!.startsWith("context:"))
        assert.strictEqual(source.disposals(), 1)
      })))

    it.effect("cleans and discards an interrupted case before another connection is prepared", () =>
      Effect.scoped(Effect.gen(function*() {
        const source = backend()
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        const ready = yield* Deferred.make<void>()
        const fiber = yield* Effect.scoped(Effect.gen(function*() {
          yield* fixture.page
          yield* Deferred.succeed(ready, undefined)
          return yield* Effect.never
        })).pipe(Effect.forkChild)
        yield* Deferred.await(ready)
        yield* Fiber.interrupt(fiber)
        assert.strictEqual(source.removed.length, 2)
        assert.strictEqual(source.disposals(), 1)
        yield* fixture.prepare
        assert.strictEqual(source.connects(), 2)
      })))

    for (const boundary of ["unanswered close", "missing removal fact"] as const) {
      it.effect(`discards cleanup after ${boundary} reaches its existing fact deadline`, () =>
        Effect.scoped(Effect.gen(function*() {
          const source = backend((adapter) => ({
            ...adapter,
            closePage: () => boundary === "unanswered close" ? Effect.never : Effect.void
          }))
          const fixture = yield* Fixture.make(source)
          yield* fixture.prepare
          const pending = yield* Effect.scoped(fixture.page).pipe(Effect.exit, Effect.forkChild)
          yield* TestClock.adjust("10 seconds")
          assert.isTrue(Exit.isFailure(yield* Fiber.join(pending)))
          assert.strictEqual(source.disposals(), 1)
          yield* fixture.prepare
          assert.strictEqual(source.connects(), 2)
        })))
    }

    it.effect("discards acquisition interrupted before the page identity returns", () =>
      Effect.scoped(Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const source = backend((adapter) => ({
          ...adapter,
          createPage: (context) =>
            adapter.createPage(context).pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Effect.never)
            )
        }))
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        const pending = yield* Effect.scoped(fixture.page).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(pending)
        assert.strictEqual(source.disposals(), 1)
        assert.strictEqual(source.removed.length, 1)
        assert(source.removed[0]!.startsWith("context:"))
      })))

    it.effect("clears evidence, filters identities, cancels waiters and bounds retained facts", () =>
      Effect.gen(function*() {
        const facts = Fixture.recorder()
        const first = "first" as UserContext.Id
        const second = "second" as UserContext.Id
        const pending = yield* facts.when("UserContextRemoved", (fact) => fact.context === second).pipe(
          Effect.forkChild
        )
        yield* facts.sink({ _tag: "UserContextRemoved", context: first })
        yield* Effect.yieldNow
        assert.isUndefined(pending.pollUnsafe())
        yield* facts.sink({ _tag: "UserContextRemoved", context: second })
        assert.strictEqual((yield* Fiber.join(pending)).context, second)
        const canceled = yield* facts.when("NavigableRemoved", () => true).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Fiber.interrupt(canceled)
        yield* facts.check
        yield* facts.clear
        assert.strictEqual(facts.size(), 0)
        for (let i = 0; i < 257; i++) yield* facts.sink({ _tag: "UserContextRemoved", context: first })
        assert.strictEqual(facts.size(), 256)
        assert.isTrue(Exit.isFailure(yield* facts.check.pipe(Effect.exit)))
      }))

    it.effect("ignores late facts from a discarded connection and closes before isolated work", () =>
      Effect.scoped(Effect.gen(function*() {
        const source = backend()
        const fixture = yield* Fixture.make(source)
        yield* fixture.prepare
        yield* Effect.scoped(fixture.page)
        yield* fixture.reset
        assert.strictEqual(source.disposals(), 1)
        yield* fixture.prepare
        yield* Effect.scoped(Effect.gen(function*() {
          const current = yield* fixture.page
          const before = current.facts.size()
          yield* source.sinks[0]!({ _tag: "UserContextRemoved", context: current.context })
          yield* source.sinks[0]!({
            _tag: "NavigableRemoved",
            navigable: current.page as Target.NavigableId,
            reason: new Target.PageClosed({ by: "command" }),
            evidence: "late"
          })
          assert.strictEqual(current.facts.size(), before)
        }))
      })))
  })
})
