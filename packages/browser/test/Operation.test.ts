/**
 * An operation's record: the `Timeout` takes its phase from what the operation recorded,
 * and a bounded wait ends on the deadline's clock, which `TestClock` doesn't move.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, Dialog, Popup } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import * as Operation from "../src/internal/operation.ts"

/** The `Timeout` an operation's record gives after `record` has run on it. */
const timeoutAfter = (record: (record: Operation.Record) => void) =>
  Effect.map(Operation.record, (current) => {
    record(current)
    return current.timeout(Option.none())
  }).pipe(Operation.named("Test.operation"))

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
        const [record, inside] = yield* Effect.all([Operation.record, Deadline.remaining]).pipe(
          Operation.named("Test.operation"),
          Deadline.withDefaultBudget("2 seconds")
        )
        assert.isTrue(Duration.isLessThanOrEqualTo(record.budget.budget, Duration.seconds(2)))
        assert.isTrue(Option.isSome(inside))
      }))

    it.effect("keeps an enclosing deadline", () =>
      Effect.gen(function*() {
        const record = yield* Operation.record.pipe(Operation.named("Test.operation"), Deadline.within("1 second"))
        assert.isTrue(Duration.isLessThanOrEqualTo(record.budget.budget, Duration.seconds(1)))
      }))

    it.effect("is the only place a record can be read", () =>
      Effect.gen(function*() {
        const exit = yield* Effect.exit(Operation.record)
        assert.isTrue(Exit.hasDies(exit))
      }))
  })

  describe("a bounded wait", () => {
    // TestClock is in force here and never moves: the deadline is the browser's, on the live clock
    it.effect("times out on the live clock under TestClock, with the record's phase and hint", () =>
      Effect.gen(function*() {
        const started = performance.now()
        const timeout = yield* Effect.gen(function*() {
          const record = yield* Operation.record
          record.observe({ _tag: "Covered", by: "div.toast" })
          return yield* record.bound(Effect.never, () => Option.some("covered"))
        }).pipe(Operation.named("Test.operation"), Deadline.within("200 millis"), Effect.flip)
        const elapsed = performance.now() - started
        assert.isTrue(Deadline.isTimeout(timeout))
        assert.strictEqual(timeout.phase, "waitingForCondition")
        assert.deepStrictEqual(timeout.hint, Option.some("covered"))
        assert.isTrue(elapsed >= 150 && elapsed < 5000, `${elapsed} ms`)
      }))

    it.effect("gives the wait's value when it comes first", () =>
      Effect.gen(function*() {
        const value = yield* Effect.flatMap(Operation.record, (record) => record.bound(Effect.succeed(1), Option.none))
          .pipe(
            Operation.named("Test.operation"),
            Deadline.within("1 second")
          )
        assert.strictEqual(value, 1)
      }))
  })

  describe("work an operation leaves behind", () => {
    it.effect("runs detached with no record and no deadline of the operation's", () =>
      Effect.gen(function*() {
        const [record, deadline] = yield* Effect.all([
          Effect.service(Operation.Current),
          Effect.service(Deadline.CurrentDeadline)
        ]).pipe(Operation.detached, Operation.named("Test.operation"), Deadline.within("1 second"))
        assert.isTrue(Option.isNone(record))
        assert.isTrue(Option.isNone(deadline))
      }))

    it.effect("decides under a budget of its own, from when it starts", () =>
      Effect.gen(function*() {
        const remaining = yield* Deadline.remaining.pipe(
          Operation.deciding(Duration.seconds(30)),
          Operation.named("Test.operation"),
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
