/** Page rounds must use the time left after cold engine setup. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Expect, type Locator, Target } from "@usestrider/browser"
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

const observed = { matches: 2, visible: 2 }

/** Real routing, engine cache and bounded adapter; only page execution is simulated. */
const scenario = Effect.fnUntraced(
  function*(
    setup: number,
    matcher: Expect.Matcher<Locator.ReadonlyLocator> = Expect.toBeVisible,
    value: unknown = observed
  ) {
    const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
    const caps: Array<number> = []
    let installs = 0
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
            yield* clock.sleep(setup)
            return { _tag: "Value", value: { type: "string", value: "installed" } } as const
          }
          const argument = call.arguments[0]
          assert(argument?._tag === "Value" && argument.value.type === "string")
          const request = JSON.parse(argument.value.value) as Engine.Request
          if (request.op === "expect") {
            assert.strictEqual(
              request.expectation._tag,
              matcher === Expect.toBeAttached
                ? "Attached"
                : matcher === Expect.toBeDetached
                ? "Detached"
                : matcher === Expect.toBeVisible
                ? "Visible"
                : "AccessibleName"
            )
            caps.push(request.cap)
            // Simulate the page's never-passing round, using the actual transmitted cap.
            yield* clock.sleep(request.cap)
            return {
              _tag: "Value",
              value: {
                type: "string",
                value: JSON.stringify({ _tag: "Expected", passed: false, observed: value, changed: true })
              }
            } as const
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
        matcher,
        Deadline.within("500 millis"),
        Effect.flip,
        Effect.forkChild
      )
      // Failure explanation has its own 1000 ms budget after the 500 ms expectation.
      yield* TestClock.adjust("1500 millis")
      return yield* Fiber.join(pending)
    })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
    assert(Expect.isExpectationFailed(error), String(error))
    return { error, caps, installs }
  }
)

const assertObserved = (error: Expect.ExpectationFailed) => {
  assert.deepStrictEqual(error.history.map((entry) => entry.value), [observed])
  assert.deepStrictEqual(error.last, Option.some(error.history[0]!))
}

describe("Expect page-round scheduling", () => {
  it.effect("receives an observation after 300 ms cold setup within the 500 ms deadline", () =>
    Effect.gen(function*() {
      const { error, caps, installs } = yield* scenario(300)
      assertObserved(error)
      assert.strictEqual(installs, 1)
      assert.strictEqual(caps[0], 100)
    }))

  it.effect("retains timely observations with no cold-setup cost", () =>
    Effect.gen(function*() {
      const { error, caps, installs } = yield* scenario(0)
      assertObserved(error)
      assert.strictEqual(installs, 1)
      assert.strictEqual(caps[0], 250)
    }))

  it.effect("has empty history and absent last when setup exhausts the deadline", () =>
    Effect.gen(function*() {
      const { error, caps } = yield* scenario(600)
      assert.deepStrictEqual(error.history, [])
      assert.deepStrictEqual(error.last, Option.none())
      assert.deepStrictEqual(caps, [])
    }))
})

describe("Expect accessible-name opt-in", () => {
  it.effect("retains an accessible-name mismatch in typed last and history evidence", () =>
    Effect.gen(function*() {
      const { error } = yield* scenario(0, Expect.toHaveAccessibleName("Expected"), "Actual")
      assert.strictEqual(error.condition, "to have the accessible name \"Expected\"")
      assert.deepStrictEqual(error.history.map((entry) => entry.value), ["Actual"])
      assert.deepStrictEqual(error.last, Option.some(error.history[0]!))
    }))

  it.effect("sends no engine work for unused contexts before or after another context opts in", () =>
    Effect.gen(function*() {
      const calls: Array<{ realm: Target.RealmId; install: boolean }> = []
      const layer = BrowserImpl.layer((sink) =>
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
          ...adapter,
          realm: (document) => Effect.succeed(String(document) as Target.RealmId),
          evaluate: (realm, call) =>
            Effect.sync(() => {
              const install = call.functionDeclaration === Engine.install
              calls.push({ realm, install })
              if (!install) {
                const argument = call.arguments[0]
                assert(argument?._tag === "Value" && argument.value.type === "string")
                const request = JSON.parse(argument.value.value) as Engine.Request
                assert(request.op === "expect" && request.expectation._tag === "AccessibleName")
              }
              return {
                _tag: "Value",
                value: {
                  type: "string",
                  value: install ? "installed" : JSON.stringify({
                    _tag: "Expected",
                    passed: true,
                    observed: "Save",
                    changed: false
                  })
                }
              } as const
            })
        })))
      )
      yield* Effect.scoped(Effect.gen(function*() {
        const unused = yield* Browser.newContext()
        yield* unused.newPage
        assert.deepStrictEqual(calls, [])
        const active = yield* Browser.newContext()
        const page = yield* active.newPage
        const check = page.locator("button").pipe(Expect.toHaveAccessibleName("Save"))
        assert.deepStrictEqual(calls, [])
        yield* check
        assert.deepStrictEqual(calls.map((call) => call.install), [true, false])
        const snapshot = [...calls]
        yield* unused.newPage
        yield* Browser.newPage()
        assert.deepStrictEqual(calls, snapshot)
      })).pipe(Effect.provide(layer))
    }))
})

describe("attachment matchers", () => {
  it("provides value matchers for attachment and detachment", () => {
    assert.strictEqual(typeof Expect.toBeAttached, "function")
    assert.strictEqual(typeof Expect.toBeDetached, "function")
  })
})

describe("attachment failure evidence", () => {
  for (const matcher of [Expect.toBeAttached, Expect.toBeDetached]) {
    it.effect("preserves observations and the operation condition", () =>
      Effect.gen(function*() {
        const { error, installs } = yield* scenario(0, matcher)
        assertObserved(error)
        assert.strictEqual(installs, 1)
        assert.strictEqual(error.condition, matcher === Expect.toBeAttached ? "to be attached" : "to be detached")
      }))
  }
})
