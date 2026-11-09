/** Locator expectation history contains only replies received before its deadline. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Expect, Target } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Engine from "../src/internal/engine.ts"
import * as Fake from "../src/internal/fake.ts"

/** Real routing, engine cache and bounded adapter; only page execution is simulated. */
const scenario = Effect.fnUntraced(function*(
  replies: ReadonlyArray<{ delay: number; value: unknown }>,
  classes = false
) {
  const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
  const caps: Array<number> = []
  let installs = 0
  let delivered = 0
  const layer = BrowserImpl.layer((sink) =>
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
      ...adapter,
      realm: () => Effect.succeed("expect-realm" as Target.RealmId),
      evaluate: Effect.fnUntraced(function*(_realm, call) {
        if (call.functionDeclaration === Engine.install) {
          installs++
          return { _tag: "Value", value: { type: "string", value: "installed" } } as const
        }
        const argument = call.arguments[0]
        assert(argument?._tag === "Value" && argument.value.type === "string")
        const request = JSON.parse(argument.value.value) as Engine.Request
        if (request.op === "expect") {
          caps.push(request.cap)
          const reply = replies[caps.length - 1]!
          return yield* Effect.gen(function*() {
            yield* clock.sleep(reply.delay)
            delivered++
            return {
              _tag: "Value",
              value: {
                type: "string",
                value: JSON.stringify({ _tag: "Expected", passed: false, observed: reply.value, changed: true })
              }
            } as const
          }).pipe(Effect.forkDetach, Effect.flatMap(Fiber.join))
        }
        assert.strictEqual(request.op, "explain")
        return {
          _tag: "Value",
          value: {
            type: "string",
            value: JSON.stringify({ _tag: "Explained", matched: true, nearest: null, suggestions: [], prefix: 1 })
          }
        } as const
      })
    })))
  )
  const error = yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const pending = yield* page.getByText("item").pipe(
      classes ? Expect.toHaveClass(["ready"]) : Expect.toBeVisible,
      Deadline.within("500 millis"),
      Effect.flip,
      Effect.forkChild
    )
    // Explanation replies immediately; capture the failure before late evaluations finish.
    yield* TestClock.adjust("500 millis")
    const error = yield* Fiber.join(pending)
    assert(Expect.isExpectationFailed(error), String(error))
    assert.strictEqual(delivered, replies.length - 1)
    const history = structuredClone(error.history)
    const last = error.last
    yield* TestClock.adjust("1000 millis")
    assert.deepStrictEqual(error.history, history)
    assert.deepStrictEqual(error.last, last)
    return error
  })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
  assert(Expect.isExpectationFailed(error), String(error))
  return { error, caps, installs, delivered }
})

describe("Expect received observations", () => {
  it.effect("retains timely replies and drops consecutive duplicate values", () =>
    Effect.gen(function*() {
      const { error, delivered } = yield* scenario([
        { delay: 100, value: "Working" },
        { delay: 100, value: "Working" },
        { delay: 100, value: "Done" },
        { delay: 1000, value: "Late" }
      ])
      assert.deepStrictEqual(error.history.map((entry) => entry.value), ["Working", "Done"])
      assert.deepStrictEqual(error.last, Option.some(error.history[1]!))
      assert.strictEqual(delivered, 4)
    }))

  it.effect("keeps empty history and absent last after a late first reply", () =>
    Effect.gen(function*() {
      const { error, delivered } = yield* scenario([{ delay: 1000, value: "Late" }])
      assert.deepStrictEqual(error.history, [])
      assert.deepStrictEqual(error.last, Option.none())
      assert.strictEqual(delivered, 1)
    }))
  it.effect("retains timely class evidence and ignores a later class reply", () =>
    Effect.gen(function*() {
      const { error, delivered } = yield* scenario([
        { delay: 100, value: ["first", "second"] },
        { delay: 1000, value: ["late"] }
      ], true)
      assert.deepStrictEqual(error.history.map((entry) => entry.value), [["first", "second"]])
      assert.deepStrictEqual(error.last, Option.some(error.history[0]!))
      assert.strictEqual(delivered, 2)
    }))

  it.effect("keeps class evidence empty after a late first reply", () =>
    Effect.gen(function*() {
      const { error, delivered } = yield* scenario([{ delay: 1000, value: { matches: 0 } }], true)
      assert.deepStrictEqual(error.history, [])
      assert.deepStrictEqual(error.last, Option.none())
      assert.strictEqual(delivered, 1)
    }))
})
