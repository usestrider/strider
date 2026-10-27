/**
 * An operation's record (review 26, candidate 1): the `Timeout` takes its phase from what the operation recorded,
 * and a bounded wait ends on the deadline's clock, which `TestClock` doesn't move.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
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
    // TestClock is in force here and never moves: the deadline is the browser's, on the live clock (P1)
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
})
