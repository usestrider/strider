import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { CapturePolicy } from "@usestrider/browser/ai"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import * as SegmentResult from "../src/internal/cli/segmentResult.ts"
import * as Serialization from "../src/internal/serialization.ts"
import * as Toolkit from "../src/internal/toolkit.ts"

const session = {
  name: () => Effect.succeed("p1"),
  conceal: <A>(value: A): A => value
}

describe("segment results", () => {
  it.effect("preserves JSON data, falsy values and fields named __proto__", () =>
    Effect.gen(function*() {
      const value = JSON.parse(
        "{\"status\":200,\"body\":\"ok\",\"empty\":\"\",\"no\":false,\"zero\":0,\"nil\":null,\"__proto__\":{\"x\":1}}"
      )
      const result = yield* SegmentResult.serialize(value, session, false)
      assert.deepStrictEqual(result, { value, handles: {} })
    }))

  it.effect("keeps special values explicit and applies evaluation's function and symbol rules", () =>
    Effect.gen(function*() {
      const sparse: Array<unknown> = []
      sparse.length = 1
      const result = yield* SegmentResult.serialize(
        {
          absent: undefined,
          big: 42n,
          nan: NaN,
          negativeZero: -0,
          infinity: Infinity,
          date: new Date("2026-01-01T00:00:00Z"),
          regexp: /a+/gi,
          map: new Map([["key", 42n]]),
          set: new Set([1, Symbol()]),
          array: [() => {}, Symbol()],
          sparse,
          method() {},
          symbol: Symbol(),
          instance: new class {
            count = 2
            method() {}
          }()
        },
        session,
        false
      )
      assert.deepStrictEqual(result.value, {
        absent: { type: "undefined" },
        big: { type: "bigint", value: "42" },
        nan: { type: "number", value: "NaN" },
        negativeZero: { type: "number", value: "-0" },
        infinity: { type: "number", value: "Infinity" },
        date: { type: "date", value: "2026-01-01T00:00:00.000Z" },
        regexp: { type: "regexp", value: { pattern: "a+", flags: "gi" } },
        map: { type: "map", value: [["key", { type: "bigint", value: "42" }]] },
        set: { type: "set", value: [1] },
        array: [{ type: "undefined" }, { type: "undefined" }],
        sparse: [{ type: "undefined" }],
        instance: { count: 2 }
      })
    }))

  it.effect("reports the path of a cycle without rejecting shared references", () =>
    Effect.gen(function*() {
      const child = { id: 1 }
      assert.deepStrictEqual((yield* SegmentResult.serialize([child, child], session, false)).value, [child, child])
      const cycle: Record<string, unknown> = {}
      cycle.self = cycle
      const result = yield* Effect.result(SegmentResult.serialize({ cycle }, session, false))
      assert.isTrue(Result.isFailure(result))
      if (Result.isFailure(result)) {
        assert.instanceOf(result.failure, Serialization.Unserializable)
        assert.strictEqual((result.failure as Serialization.Unserializable).path, "result.cycle.self")
      }
    }))

  for (
    const value of [() => {}, Symbol(), new WeakMap(), new Date(NaN), {
      get field() {
        throw new Error("secret")
      }
    }]
  ) {
    it.effect(`reports an unserializable ${String(value)}`, () =>
      Effect.gen(function*() {
        const result = yield* Effect.result(SegmentResult.serialize(value, session, false))
        assert.isTrue(Result.isFailure(result))
        if (Result.isFailure(result)) assert.instanceOf(result.failure, Serialization.Unserializable)
      }))
  }

  it.effect("masks Redacted values without calling their serializers", () =>
    Effect.gen(function*() {
      const result = yield* SegmentResult.serialize({ password: Redacted.make("secret") }, session, false)
      assert.deepStrictEqual(result.value, { password: "<redacted>" })
    }))

  it.effect("names nested page handles once and conceals secrets in values and keys", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const session = yield* Toolkit.makeSession({
        context,
        secrets: { token: Redacted.make("secret") },
        capture: CapturePolicy.local
      })
      const result = yield* SegmentResult.serialize({ secret: [page, { page }], body: "secret" }, session, false)
      assert.deepStrictEqual(result.value, { "%token%": ["p1", { page: "p1" }], body: "%token%" })
      assert.deepStrictEqual(result.handles, { p1: { type: "page", id: page.id } })
      const strict = yield* SegmentResult.serialize({ field: "unregistered password", page }, session, true)
      assert.strictEqual(strict.value, "•••")
      assert.deepStrictEqual(strict.handles, result.handles)
      assert.strictEqual((yield* SegmentResult.serialize(page, session, true)).value, "p1")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("conceals data once without rewriting serialization tags", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* Toolkit.makeSession({
        context,
        secrets: { string: Redacted.make("string") },
        capture: CapturePolicy.local
      })
      const result = yield* SegmentResult.serialize({ string: "string", absent: undefined }, session, false)
      assert.deepStrictEqual(result.value, { "%string%": "%string%", absent: { type: "undefined" } })
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it("truncates only plain previews and leaves direct handles unquoted", () => {
    assert.strictEqual(SegmentResult.preview("p2", true), "p2")
    assert.strictEqual(SegmentResult.preview("text", false), "\"text\"")
    assert.include(SegmentResult.preview("x".repeat(5000), false), "[truncated; use --json for the full value]")
  })
})
