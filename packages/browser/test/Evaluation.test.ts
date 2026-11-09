/** Reply evidence for evaluations explicitly sent as writes, independently of read-only engine queries. */
import { assert, describe, it } from "@effect/vitest"
import { Protocol } from "@usestrider/browser/protocol"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { runInNewContext } from "node:vm"
import * as Adapter from "../src/internal/adapter.ts"
import * as Evaluation from "../src/internal/evaluation.ts"
import * as Argument from "../src/internal/evaluationArgument.ts"
import * as Operation from "../src/internal/operation.ts"
import type * as Runtime from "../src/internal/runtime.ts"
import * as Utility from "../src/internal/webkitUtility.ts"
import * as Target from "../src/Target.ts"

const runtime = (evaluate: Adapter.AdapterConnection["evaluate"]) =>
  ({ backend: "test", model: { adapter: { evaluate } } }) as unknown as Runtime.Runtime

const value: Adapter.RemoteResult = { _tag: "Value", value: { type: "undefined" } }

const options = (record: Operation.Record, write: boolean) => ({
  realm: "realm" as Target.RealmId,
  functionDeclaration: "() => undefined",
  arguments: [],
  result: "value" as const,
  userActivation: false,
  page: Option.none(),
  at: record.budget.at,
  id: record.id,
  ...(write ? { dispatch: record } : {})
})

describe("Evaluation dispatch evidence", () => {
  it.effect("acknowledges an explicitly dispatched evaluation before decoding its result", () =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      record.markSent()
      yield* Evaluation.call(runtime(() => Effect.succeed(value)), options(record, true))
      assert.deepStrictEqual(record.diagnostics().dispatch, { _tag: "Acknowledged", result: "ok" })
    }).pipe(Operation.named("Locator.evaluate")))

  for (
    const reason of [
      new Protocol.Rejected({
        method: "Runtime.callFunctionOn",
        reason: "InvalidArgument",
        code: -32602,
        description: "refused"
      }),
      new Protocol.NoReply({ method: "Runtime.callFunctionOn", timeout: Duration.zero })
    ]
  ) {
    it.effect(`records ${reason._tag} without replacing the original protocol cause`, () =>
      Effect.gen(function*() {
        const record = yield* Operation.record
        record.markConfirmed()
        const cause = new Protocol.ProtocolError({ reason })
        const error = yield* Evaluation.call(
          runtime(() =>
            Effect.fail(
              new Adapter.AdapterError({
                reason: { _tag: "Protocol", error: cause }
              })
            )
          ),
          options(record, true)
        ).pipe(Effect.flip)
        assert(error._tag === "Reason" && error.reason._tag === "BackendFailure")
        assert.strictEqual(error.reason.cause, cause)
        assert.deepStrictEqual(
          record.diagnostics().dispatch,
          reason._tag === "Rejected"
            ? { _tag: "Acknowledged", result: "rejected" }
            : { _tag: "MayHaveBeenSent" }
        )
      }).pipe(Operation.named("Locator.evaluate")))
  }

  it.effect("does not replay a possibly applied caller function when its realm ends", () =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      let calls = 0
      const error = yield* Evaluation.call(
        runtime(() =>
          Effect.suspend(() => {
            calls++
            return Effect.fail(
              new Adapter.AdapterError({
                reason: {
                  _tag: "Gone",
                  target: { _tag: "Realm", id: "realm" as Target.RealmId },
                  reason: new Target.RealmDestroyed({})
                }
              })
            )
          })
        ),
        { ...options(record, true), functionDeclaration: "() => { globalThis.applied = true }" }
      ).pipe(Effect.flip)
      assert.strictEqual(error._tag, "Gone")
      assert.strictEqual(calls, 1)
      assert.deepStrictEqual(record.diagnostics().dispatch, { _tag: "MayHaveBeenSent" })
    }).pipe(Operation.named("Locator.evaluate")))

  it.effect("does not use a read evaluation to confirm an earlier uncertain write", () =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      record.markSent()
      yield* Evaluation.call(runtime(() => Effect.succeed(value)), options(record, false))
      assert.deepStrictEqual(record.diagnostics().dispatch, { _tag: "MayHaveBeenSent" })
    }).pipe(Operation.named("query after input")))
})

describe("Evaluation argument reconstruction", () => {
  it("constructs WebKit callbacks outside the handle-group wrapper bindings", () => {
    const call = runInNewContext(
      `(${
        Utility.callBeside(
          "() => [kinds, args, helper, fn, arguments]",
          "handle",
          false
        )
      })`,
      {
        kinds: "page:kinds",
        args: "page:args",
        helper: "page:helper",
        fn: "page:fn",
        arguments: "page:arguments"
      }
    )
    const result = call({ run: (fn: () => unknown) => fn() }, [])
    assert.deepStrictEqual(Array.from(result), ["page:kinds", "page:args", "page:helper", "page:fn", "page:arguments"])
  })

  it("copies own __proto__ keys as data without changing the object prototype", () => {
    const call = new Function(`return (${Argument.call("value => value")})`)()
    const value = call(["v"], {
      type: "object",
      value: [["__proto__", { type: "string", value: "data" }]]
    })
    assert.strictEqual(Object.getPrototypeOf(value), Object.prototype)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(value, "__proto__"), true)
    assert.strictEqual(value["__proto__"], "data")
  })
})
