/**
 * An operation's record: the `Timeout` takes its phase from what the operation recorded, a bounded wait ends on the
 * deadline's clock, which `TestClock` doesn't move, and an operation inside another is a step of it, whose `Timeout`
 * leaves as the enclosing operation's.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Dialog, Operation, Popup } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import * as Internal from "../src/internal/operation.ts"

/** The `Timeout` an operation's record gives after `record` has run on it. */
const timeoutAfter = (record: (record: Internal.Record) => void) =>
  Effect.map(Internal.record, (current) => {
    record(current)
    return current.timeout(Option.none())
  }).pipe(Internal.named("Test.operation"))

class Failed extends Data.TaggedError("Failed") {}

describe("Operation", () => {
  describe("a record's phase", () => {
    it.effect("is resolving when nothing was observed, or only NoMatch", () =>
      Effect.gen(function*() {
        assert.strictEqual((yield* timeoutAfter(() => {})).phase, "resolving")
        const timeout = yield* timeoutAfter((record) => {
          record.observe({ _tag: "NoMatch" })
          record.observe({ _tag: "NoMatch" })
        })
        assert.strictEqual(timeout.phase, "resolving")
        assert.strictEqual(timeout.history.length, 1)
      }))

    it.effect("is waitingForCondition once something else was observed, with the last observation", () =>
      Effect.gen(function*() {
        const timeout = yield* timeoutAfter((record) => {
          record.observe({ _tag: "NoMatch" })
          record.observe({ _tag: "Covered", by: "div.toast" })
        })
        assert.strictEqual(timeout.phase, "waitingForCondition")
        assert.deepStrictEqual(
          Option.map(timeout.last, (last) => last.value),
          Option.some({ _tag: "Covered", by: "div.toast" })
        )
        assert.strictEqual(timeout.operation, "Test.operation")
      }))

    it.effect("is dispatchedUnconfirmed once input may have been sent, until the guard says it wasn't", () =>
      Effect.gen(function*() {
        const sent = yield* timeoutAfter((record) => {
          record.observe({ _tag: "NotVisible" })
          record.markSent()
        })
        assert.strictEqual(sent.phase, "dispatchedUnconfirmed")
        assert.deepStrictEqual(sent.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
        const stopped = yield* timeoutAfter((record) => {
          record.observe({ _tag: "NotVisible" })
          record.markSent()
          record.markNotSent()
        })
        assert.strictEqual(stopped.phase, "waitingForCondition")
        assert.deepStrictEqual(stopped.diagnostics.dispatch, { _tag: "NotSent" })
      }))

    it.effect("is postcondition once what was sent was confirmed", () =>
      Effect.gen(function*() {
        const timeout = yield* timeoutAfter((record) => {
          record.dispatch = { _tag: "Acknowledged", result: "ok" }
        })
        assert.strictEqual(timeout.phase, "postcondition")
      }))
  })

  describe("named", () => {
    it.effect("gives everything inside the operation's deadline", () =>
      Effect.gen(function*() {
        const [record, inside] = yield* Effect.all([Internal.record, Deadline.remaining]).pipe(
          Internal.named("Test.operation"),
          Deadline.withDefaultBudget("2 seconds")
        )
        assert.isTrue(Duration.isLessThanOrEqualTo(record.budget.budget, Duration.seconds(2)))
        assert.isTrue(Option.isSome(inside))
      }))

    it.effect("keeps an enclosing deadline", () =>
      Effect.gen(function*() {
        const record = yield* Internal.record.pipe(Internal.named("Test.operation"), Deadline.within("1 second"))
        assert.isTrue(Duration.isLessThanOrEqualTo(record.budget.budget, Duration.seconds(1)))
      }))

    it.effect("is the only place a record can be read", () =>
      Effect.gen(function*() {
        const exit = yield* Effect.exit(Internal.record)
        assert.isTrue(Exit.hasDies(exit))
      }))
  })

  describe("a bounded wait", () => {
    // TestClock is in force here and never moves: the deadline is the browser's, on the live clock
    it.effect("times out on the live clock under TestClock, with the record's phase and hint", () =>
      Effect.gen(function*() {
        const started = performance.now()
        const timeout = yield* Effect.gen(function*() {
          const record = yield* Internal.record
          record.observe({ _tag: "Covered", by: "div.toast" })
          return yield* record.bound(Effect.never, () => Option.some("covered"))
        }).pipe(Internal.named("Test.operation"), Deadline.within("200 millis"), Effect.flip)
        const elapsed = performance.now() - started
        assert.isTrue(Deadline.isTimeout(timeout))
        assert.strictEqual(timeout.phase, "waitingForCondition")
        assert.deepStrictEqual(timeout.hint, Option.some("covered"))
        assert.isTrue(elapsed >= 150 && elapsed < 5000, `${elapsed} ms`)
      }))

    it.effect("gives the wait's value when it comes first", () =>
      Effect.gen(function*() {
        const value = yield* Effect.flatMap(Internal.record, (record) => record.bound(Effect.succeed(1), Option.none))
          .pipe(
            Internal.named("Test.operation"),
            Deadline.within("1 second")
          )
        assert.strictEqual(value, 1)
      }))
  })

  describe("an operation inside another", () => {
    /** A step that waits on nothing it can find until the deadline. */
    const stuck = Effect.gen(function*() {
      const record = yield* Internal.record
      record.observe({ _tag: "NoMatch" })
      return yield* record.bound(Effect.never, () => Option.some("never found"))
    }).pipe(Operation.named("Test.stuck"))

    /** A step that sends, and succeeds. */
    const sends = Operation.markSent.pipe(Operation.named("Test.sends"))

    it.effect("leaves with the operation's Timeout, the step's phase, history and hint, and its steps", () =>
      Effect.gen(function*() {
        const outer = Operation.fn("Test.outer")(function*() {
          yield* sends
          yield* stuck
        }, Deadline.within("100 millis"))
        const timeout = yield* Effect.flip(outer())
        assert.strictEqual(timeout.operation, "Test.outer")
        assert.strictEqual(timeout.phase, "resolving")
        assert.deepStrictEqual(timeout.hint, Option.some("never found"))
        assert.deepStrictEqual(timeout.history.map((each) => each.value), [{ _tag: "NoMatch" }])
        assert.isTrue(Duration.isLessThanOrEqualTo(timeout.budget, Duration.millis(100)))
        // The furthest dispatch: the step that sent succeeded, which confirms it
        assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "Acknowledged", result: "ok" })
        assert.deepStrictEqual(
          timeout.diagnostics.progress.map(({ state, step }) => ({ step, state })),
          [{ step: "Test.sends", state: "ok" }, { step: "Test.stuck", state: "unsent" }]
        )
      }))

    it.effect("is still the step's Timeout inside the body", () =>
      Effect.gen(function*() {
        const caught = yield* Effect.gen(function*() {
          return yield* stuck.pipe(Effect.catchTag("Timeout", (timeout) => Effect.succeed(timeout.operation)))
        }).pipe(Operation.named("Test.outer"), Deadline.within("100 millis"))
        assert.strictEqual(caught, "Test.stuck")
      }))

    it.effect("is a step once when it repeats", () =>
      Effect.gen(function*() {
        const progress = yield* Effect.gen(function*() {
          yield* Effect.repeat(Effect.void.pipe(Operation.named("Test.read")), { times: 4 })
          return (yield* Internal.record).progress
        }).pipe(Operation.named("Test.outer"))
        assert.deepStrictEqual(progress.map(({ state, step }) => ({ step, state })), [{
          step: "Test.read",
          state: "ok"
        }])
      }))

    it.effect("is a step when the operation's own wait interrupts it", () =>
      Effect.gen(function*() {
        const timeout = yield* Operation.bound(Effect.never.pipe(Operation.named("Test.never"))).pipe(
          Operation.named("Test.outer"),
          Deadline.within("100 millis"),
          Effect.flip
        )
        assert(Deadline.isTimeout(timeout), String(timeout))
        assert.strictEqual(timeout.operation, "Test.outer")
        assert.deepStrictEqual(timeout.diagnostics.progress.map(({ step }) => step), ["Test.never"])
      }))
  })

  describe("what a body records", () => {
    it.effect("times out in postcondition after a step that sent and succeeded", () =>
      Effect.gen(function*() {
        const timeout = yield* Effect.flip(
          Operation.fn("Test.pay")(function*() {
            yield* Operation.markSent.pipe(Operation.named("Test.click"))
            return yield* Operation.bound(Effect.never)
          }, Deadline.within("100 millis"))()
        )
        assert.strictEqual(timeout.operation, "Test.pay")
        assert.strictEqual(timeout.phase, "postcondition")
      }))

    it.effect("times out in dispatchedUnconfirmed after markSent", () =>
      Effect.gen(function*() {
        const timeout = yield* Effect.flip(
          Operation.fn("Test.order")(function*() {
            yield* Operation.markSent
            return yield* Operation.bound(Effect.never)
          }, Deadline.within("100 millis"))()
        )
        assert.strictEqual(timeout.phase, "dispatchedUnconfirmed")
        assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
      }))

    it.effect("times out in waitingForCondition after observe, with what it observed", () =>
      Effect.gen(function*() {
        const timeout = yield* Effect.flip(
          Operation.fn("Test.shipped")(function*() {
            yield* Operation.observe("processing")
            yield* Operation.observe("processing")
            yield* Operation.observe("packed")
            return yield* Operation.bound(Effect.never)
          }, Deadline.within("100 millis"))()
        )
        assert.strictEqual(timeout.phase, "waitingForCondition")
        assert.deepStrictEqual(timeout.history.map((each) => each.value), ["processing", "packed"])
      }))

    it.effect("passes the call's arguments to the body and the pipeables", () =>
      Effect.gen(function*() {
        const add = Operation.fn("Test.add")(
          function*(a: number, b: number) {
            return yield* Effect.succeed(a + b)
          },
          (effect, a) => Effect.map(effect, (sum) => sum * a)
        )
        assert.strictEqual(yield* add(2, 3), 10)
      }))

    it.effect("gives a failure the frames of the call and the definition, as Effect.fn does", () =>
      Effect.gen(function*() {
        const failing = Operation.fn("Test.failing")(function*() {
          return yield* Effect.fail(new Failed())
        })
        const exit = yield* Effect.exit(failing())
        assert.isTrue(Exit.isFailure(exit))
        if (!Exit.isFailure(exit)) return
        const lines = Cause.pretty(exit.cause).split("\n").map((line) => line.trim())
        const call = lines.find((line) => line.startsWith("at Test.failing (") && line.includes("Operation.test.ts"))
        const definition = lines.find((line) =>
          line.startsWith("at Test.failing (definition) (") && line.includes("Operation.test.ts")
        )
        assert.isDefined(call, lines.join("\n"))
        assert.isDefined(definition, lines.join("\n"))
      }))

    it.effect("dies with an operation provided by hand", () =>
      Effect.gen(function*() {
        const forged = {
          "~@usestrider/browser/Operation": "~@usestrider/browser/Operation" as const,
          name: "forged",
          id: "OP0" as Internal.Record["id"]
        }
        const exit = yield* Effect.exit(Operation.markSent.pipe(Effect.provideService(Operation.Current, forged)))
        assert.isTrue(Exit.hasDies(exit))
      }))
  })

  describe("work an operation leaves behind", () => {
    it.effect("runs detached with no record and no deadline of the operation's", () =>
      Effect.gen(function*() {
        const [record, deadline] = yield* Effect.all([
          Effect.serviceOption(Operation.Current),
          Effect.service(Deadline.CurrentDeadline)
        ]).pipe(Internal.detached, Internal.named("Test.operation"), Deadline.within("1 second"))
        assert.isTrue(Option.isNone(record))
        assert.isTrue(Option.isNone(deadline))
      }))

    it.effect("decides under a budget of its own, from when it starts", () =>
      Effect.gen(function*() {
        const remaining = yield* Deadline.remaining.pipe(
          Internal.apart("Test.decision", Duration.seconds(30)),
          Internal.named("Test.operation"),
          Deadline.within("10 millis")
        )
        assert.isTrue(Option.exists(remaining, (left) => Duration.isGreaterThan(left, Duration.seconds(29))))
      }))
  })

  describe("on Browser.layerTest, whose browser runs on Effect's clock", () => {
    it.effect("times an event wait out when the test clock reaches its deadline, never before", () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const popups = yield* Popup.next(page).pipe(Deadline.within("200 millis"))
        const fiber = yield* Effect.forkChild(Effect.flip(popups))
        // A second of real time, which the test clock doesn't see
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1000)))
        assert.isUndefined(fiber.pollUnsafe())
        yield* TestClock.adjust("200 millis")
        const timeout = yield* Fiber.join(fiber)
        assert(Deadline.isTimeout(timeout), String(timeout))
        assert.strictEqual(timeout.phase, "waitingForEvent")
      })).pipe(Effect.provide(Browser.layerTest(""))))

    it.effect("makes an event wait awaited inside an operation a step of it", () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const fiber = yield* Effect.forkChild(Effect.flip(
          Operation.fn("Test.awaitPopup")(function*() {
            return yield* yield* Popup.next(page)
          }, Deadline.within("200 millis"))()
        ))
        yield* TestClock.adjust("200 millis")
        const timeout = yield* Fiber.join(fiber)
        assert(Deadline.isTimeout(timeout), String(timeout))
        assert.strictEqual(timeout.operation, "Test.awaitPopup")
        assert.strictEqual(timeout.phase, "waitingForEvent")
        // Subscribing is one step, and the wait another
        assert.deepStrictEqual(
          timeout.diagnostics.progress.map(({ state, step }) => ({ step, state })),
          [{ step: "Popup.next", state: "ok" }, { step: "Popup.next", state: "unsent" }]
        )
      })).pipe(Effect.provide(Browser.layerTest(""))))

    it.effect("gives a handler its own budget, not the deadline in force when it was registered", () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const seen: Array<Option.Option<Duration.Duration>> = []
        const handler = yield* Dialog.handle(
          page,
          (dialog) =>
            Effect.gen(function*() {
              seen.push(yield* Deadline.remaining)
              return yield* Dialog.dismissAll(dialog)
            })
        ).pipe(Deadline.within("10 millis"))
        // The dialog opens at 30 ms, well past the registration's deadline
        yield* TestClock.adjust("40 millis")
        assert.strictEqual(yield* handler.handled, 1)
        assert.strictEqual(seen.length, 1)
        assert.isTrue(Option.exists(seen[0]!, (left) => Duration.isGreaterThan(left, Duration.seconds(29))))
      })).pipe(Effect.provide(Browser.layerTest("---dialog(confirm)"))))
  })
})
