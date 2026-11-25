/** Page rounds must use the time left after cold engine setup. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Condition, Deadline, Expect, type Locator, Target } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import { runInNewContext } from "node:vm"
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
    value: unknown = observed,
    stallWaitingRound = false
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
                : request.expectation._tag.startsWith("Accessible")
                ? request.expectation._tag
                : "AccessibleName"
            )
            caps.push(request.cap)
            // Simulate the page's never-passing round, using the actual transmitted cap.
            yield* clock.sleep(stallWaitingRound && request.cap > 0 ? 2000 : request.cap)
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
  it.effect("retains the immediate observation when a waiting round stalls past the deadline", () =>
    Effect.gen(function*() {
      const { error, caps } = yield* scenario(0, Expect.toBeVisible, observed, true)
      assertObserved(error)
      assert.strictEqual(caps[0], 0)
      assert(caps[1]! > 0)
    }))

  it.effect("receives an observation after 300 ms cold setup within the 500 ms deadline", () =>
    Effect.gen(function*() {
      const { error, caps, installs } = yield* scenario(300)
      assertObserved(error)
      assert.strictEqual(installs, 1)
      assert.strictEqual(caps[0], 0)
      assert.strictEqual(caps[1], 100)
    }))

  it.effect("retains timely observations with no cold-setup cost", () =>
    Effect.gen(function*() {
      const { error, caps, installs } = yield* scenario(0)
      assertObserved(error)
      assert.strictEqual(installs, 1)
      assert.strictEqual(caps[0], 0)
      assert.strictEqual(caps[1], 250)
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

describe("Expect accessible description and error message", () => {
  it.effect("sends each matcher's expectation with its comparison, case rule and negation", () =>
    Effect.gen(function*() {
      const sent: Array<Engine.Expectation> = []
      const layer = BrowserImpl.layer((sink) =>
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
          ...adapter,
          realm: () => Effect.succeed("expect-realm" as Target.RealmId),
          evaluate: (_realm, call) =>
            Effect.sync(() => {
              const install = call.functionDeclaration === Engine.install
              if (!install) {
                const argument = call.arguments[0]
                assert(argument?._tag === "Value" && argument.value.type === "string")
                const request = JSON.parse(argument.value.value) as Engine.Request
                assert(request.op === "expect")
                sent.push(request.expectation)
              }
              return {
                _tag: "Value",
                value: {
                  type: "string",
                  value: install ? "installed" : JSON.stringify({
                    _tag: "Expected",
                    passed: true,
                    observed: "Described",
                    changed: false
                  })
                }
              } as const
            })
        })))
      )
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const field = page.locator("input")
        yield* field.pipe(Expect.toHaveAccessibleDescription("Described"))
        yield* Expect.toHaveAccessibleDescription(field, /described/, { ignoreCase: true, not: true })
        yield* field.pipe(Expect.toHaveAccessibleErrorMessage(/Required/i, { ignoreCase: false }))
        yield* Expect.toHaveAccessibleErrorMessage(field, "", { not: true })
      })).pipe(Effect.provide(layer))
      assert.deepStrictEqual(sent, [
        {
          _tag: "AccessibleDescription",
          expected: { _tag: "String", value: "Described", exact: true },
          ignoreCase: false,
          not: false
        },
        {
          _tag: "AccessibleDescription",
          expected: { _tag: "RegExp", source: "described", flags: "i" },
          ignoreCase: true,
          not: true
        },
        {
          _tag: "AccessibleErrorMessage",
          expected: { _tag: "RegExp", source: "Required", flags: "" },
          ignoreCase: false,
          not: false
        },
        {
          _tag: "AccessibleErrorMessage",
          expected: { _tag: "String", value: "", exact: true },
          ignoreCase: false,
          not: true
        }
      ])
    }))

  it.effect("names the matcher, its case rule and its negation in the failure", () =>
    Effect.gen(function*() {
      const described = yield* scenario(
        0,
        Expect.toHaveAccessibleDescription("Expected", { ignoreCase: true, not: true }),
        "Expected"
      )
      assert.strictEqual(
        described.error.condition,
        "not to have the accessible description \"Expected\" ignoring case"
      )
      assert.deepStrictEqual(described.error.history.map((entry) => entry.value), ["Expected"])
      const message = yield* scenario(0, Expect.toHaveAccessibleErrorMessage(/Required/), "")
      assert.strictEqual(message.error.condition, "to have the accessible error message /Required/")
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

describe("Expect.that last", () => {
  it.live("keeps a completed observation when a later check never completes", () =>
    Effect.gen(function*() {
      let reads = 0
      const read = Effect.suspend(() => ++reads === 1 ? Effect.succeed("observed") : Effect.never)
      const error = yield* Expect.that(read, Condition.make("never", () => false)).pipe(
        Deadline.within("300 millis"),
        Effect.flip
      )
      assert(Expect.isExpectationFailed(error), String(error))
      assert.strictEqual(reads, 2)
      assert.deepStrictEqual(error.history.map((entry) => entry.value), ["observed"])
      assert.deepStrictEqual(Option.map(error.last, (entry) => entry.value), Option.some("observed"))
    }))

  it.live("keeps the last value the read returned, not the check cut off at the deadline", () =>
    Effect.gen(function*() {
      let reads = 0
      const read = Effect.sleep("2 millis").pipe(Effect.map(() => ++reads))
      const error = yield* Expect.that(read, Condition.make("never", () => false)).pipe(
        Deadline.within("300 millis"),
        Effect.flip
      )
      assert(Expect.isExpectationFailed(error), String(error))
      const values = error.history.map((entry) => entry.value)
      assert.isAbove(values.length, 0)
      assert.notDeepInclude(values, { error: "a check was still running at the deadline" })
      assert.deepStrictEqual(Option.map(error.last, (entry) => entry.value), Option.some(reads))
    }))
})

describe("Expect URL call forms", () => {
  it.effect("accepts a regular expression from another realm in data-first form", () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const expected: RegExp = runInNewContext("/^about:blank$/")
      yield* Expect.toHaveURL(page, expected)
    })).pipe(Effect.provide(Browser.layerTest(""))))
})

describe("Expect.withChecks", () => {
  it.effect("checks again every 100 ms unless set", () =>
    Effect.gen(function*() {
      const cadence = yield* Effect.service(Expect.CheckCadence)
      assert.deepStrictEqual(cadence, { _tag: "Interval", interval: "100 millis" })
    }))

  for (const interval of [0, -5, Number.POSITIVE_INFINITY, Number.NaN]) {
    it.effect(`fails an interval of ${interval} with InvalidInput when the expectation runs, before any check`, () =>
      Effect.gen(function*() {
        let reads = 0
        const expectation = Expect.that(Effect.sync(() => ++reads), Condition.make("never", () => false)).pipe(
          Expect.withChecks(Expect.Checks.interval(interval))
        )
        assert.strictEqual(reads, 0)
        const error = yield* Effect.flip(expectation)
        assert(Expect.isExpectError(error), String(error))
        assert.strictEqual(error.reason._tag, "InvalidInput")
        assert.strictEqual(error.operation, "Expect.withChecks")
        assert.strictEqual(reads, 0)
      }))
  }

  it.live("waits the interval it is given between checks", () =>
    Effect.gen(function*() {
      const at: Array<number> = []
      const error = yield* Expect.that(
        Effect.sync(() => at.push(Date.now())),
        Condition.make("never", () => false)
      ).pipe(Expect.withChecks(Expect.Checks.interval("150 millis")), Deadline.within("500 millis"), Effect.flip)
      assert(Expect.isExpectationFailed(error), String(error))
      assert.deepStrictEqual(error.checks.triggeredBy, ["initial", "interval"])
      assert.isAtMost(at.length, 4)
      for (let index = 1; index < at.length; index++) assert.isAtLeast(at[index]! - at[index - 1]!, 140)
    }))

  it.effect("ends at the deadline on a page that renders no frames", () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Effect.service(Clock.Clock))
      const changes: Array<Engine.Request> = []
      const layer = BrowserImpl.layer((sink) =>
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
          ...adapter,
          realm: () => Effect.succeed("checks-realm" as Target.RealmId),
          evaluate: Effect.fnUntraced(function*(_realm, call) {
            const answer = (value: unknown) =>
              ({ _tag: "Value", value: { type: "string", value: JSON.stringify(value) } }) as const
            if (call.functionDeclaration === Engine.install) return answer("installed")
            const argument = call.arguments[0]
            assert(argument?._tag === "Value" && argument.value.type === "string")
            const request = JSON.parse(argument.value.value) as Engine.Request
            if (request.op === "change") {
              changes.push(request)
              // The arming answers; a wait for a frame that never comes never does
              if (request.token !== null && request.cap > 0) return yield* Effect.never
              return answer({ _tag: "Watching", changed: false, token: `t${changes.length}` })
            }
            return answer({ _tag: "Watching", changed: false, token: "" })
          })
        })))
      )
      const error = yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const pending = yield* Expect.that(Effect.succeed(false), Condition.make("true", (value: boolean) => value))
          .pipe(
            Expect.withChecks(Expect.Checks.animationFrame(page)),
            Deadline.within("500 millis"),
            Effect.flip,
            Effect.forkChild
          )
        yield* TestClock.adjust("600 millis")
        return yield* Fiber.join(pending)
      })).pipe(Effect.provide(layer), Effect.provideService(BrowserClock.CurrentClock, clock))
      assert(Expect.isExpectationFailed(error), String(error))
      assert.strictEqual(error.checks.count, 1)
      assert.deepStrictEqual(error.checks.triggeredBy, ["initial", "change"])
      assert(changes.length >= 2)
      assert(changes.every((request) => request.op === "change" && request.signals === "frames"))
    }))
})
