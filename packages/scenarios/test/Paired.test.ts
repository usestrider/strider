import { describe, expect, it } from "vitest"
import { pairedInterval, rotation } from "../src/benchmarks/paired.ts"

describe("paired comparisons", () => {
  it("rotates every individual sample through every position", () => {
    expect([0, 1, 2, 3].map(rotation)).toEqual([
      ["base:strider", "head:strider", "head:playwright", "base:playwright"],
      ["head:strider", "head:playwright", "base:playwright", "base:strider"],
      ["head:playwright", "base:playwright", "base:strider", "head:strider"],
      ["base:playwright", "base:strider", "head:strider", "head:playwright"]
    ])
  })
  it("pairs by repetition rather than dividing aggregate medians", () => {
    expect(pairedInterval([2, 20, 200], [1, 10, 100])).toEqual({ ratio: 2, low: 2, high: 2, pairs: 3 })
  })
  it("rejects incomplete and invalid evidence", () => {
    expect(() => pairedInterval([1], [1])).toThrow()
    expect(() => pairedInterval([1, 2], [1])).toThrow()
    expect(() => pairedInterval([0, 2], [1, 2])).toThrow()
  })
})
