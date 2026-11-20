/** The deep equality `Expect.toHaveJSProperty` compares a property's value with. */
import { assert, describe, it } from "@effect/vitest"
import { deepEqual } from "../src/internal/deepEqual.ts"

describe("deepEqual", () => {
  it("compares primitives by value, with NaN equal to NaN", () => {
    assert.isTrue(deepEqual(1, 1))
    assert.isTrue(deepEqual(NaN, NaN))
    assert.isTrue(deepEqual(undefined, undefined))
    assert.isTrue(deepEqual(-0, 0))
    assert.isFalse(deepEqual(null, undefined))
    assert.isFalse(deepEqual(1, "1"))
    assert.isTrue(deepEqual(10n, 10n))
  })

  it("compares Dates by time and RegExps by source and flags", () => {
    assert.isTrue(deepEqual(new Date(5), new Date(5)))
    assert.isFalse(deepEqual(new Date(5), new Date(6)))
    assert.isFalse(deepEqual(new Date(5), 5))
    assert.isTrue(deepEqual(new Date(NaN), new Date(NaN)))
    assert.isTrue(deepEqual(/a+/gi, /a+/gi))
    assert.isFalse(deepEqual(/a+/g, /a+/i))
    assert.isFalse(deepEqual(/a/, /b/))
  })

  it("compares arrays, Maps and Sets by their entries", () => {
    assert.isTrue(deepEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]]))
    assert.isFalse(deepEqual([1, 2], [1, 2, 3]))
    assert.isFalse(deepEqual([1, 2], { 0: 1, 1: 2 }))
    assert.isTrue(deepEqual(new Map([["a", { b: 1 }]]), new Map([["a", { b: 1 }]])))
    assert.isFalse(deepEqual(new Map([["a", 1]]), new Map([["a", 2]])))
    assert.isFalse(deepEqual(new Map([["a", 1]]), new Map([["b", 1]])))
    assert.isTrue(deepEqual(new Set([1, { a: 1 }]), new Set([{ a: 1 }, 1])))
    assert.isFalse(deepEqual(new Set([1, 2]), new Set([1, 3])))
  })

  it("compares plain objects by their own enumerable keys", () => {
    assert.isTrue(deepEqual({ a: 1, b: { c: [new Date(0)] } }, { b: { c: [new Date(0)] }, a: 1 }))
    assert.isFalse(deepEqual({ a: 1 }, { a: 1, b: 2 }))
    assert.isFalse(deepEqual({ a: undefined }, {}))
    assert.isFalse(deepEqual({ a: 1 }, { a: 2 }))
    assert.isFalse(deepEqual({}, null))
  })
})
