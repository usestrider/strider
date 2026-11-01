import { describe, expect, it } from "vitest"
import { compare, measure, options, summarize } from "../src/benchmarks/measure.ts"

describe("benchmark measurements", () => {
  it("discards warmups and alternates paired samples without overlapping work", async () => {
    const order: Array<string> = []
    let active = false
    let sequence = 0
    const run = (name: string) => async () => {
      expect(active).toBe(false)
      active = true
      order.push(name)
      await Promise.resolve()
      active = false
      return ++sequence
    }
    const samples = await measure({ strider: run("S"), playwright: run("P") }, 3, 2)
    expect(order).toEqual(["S", "P", "P", "S", "S", "P", "P", "S", "S", "P"])
    expect(samples).toEqual({ strider: [5, 8, 9], playwright: [6, 7, 10] })
  })

  it("stops on failed work, including during warmup", async () => {
    let calls = 0
    await expect(measure(
      {
        strider: async () => {
          calls++
          throw new Error("wrong result")
        },
        playwright: async () => {
          calls++
          return 1
        }
      },
      3,
      2
    )).rejects.toThrow("wrong result")
    expect(calls).toBe(1)
  })

  it("uses the middle pair for an even median and nearest rank for p95", () => {
    expect(summarize([9, 1, 3, 7])).toEqual({ median: 5, p95: 9, min: 1 })
    expect(summarize([7, 1, 3])).toEqual({ median: 3, p95: 7, min: 1 })
    expect(summarize(Array.from({ length: 20 }, (_, i) => i + 1)).p95).toBe(19)
  })

  it("gates on the per-case median ratio, including the exact boundary", () => {
    expect(compare([11, 11, 100], [10, 10, 10], 1.1).passed).toBe(true)
    expect(compare([12, 12, 12], [10, 10, 10], 1.1).passed).toBe(false)
    expect(compare([9, 9, 9], [10, 10, 10], 1).ratio).toBe(0.9)
  })

  it("rejects empty, incomplete and invalid samples instead of passing NaN ratios", () => {
    for (const values of [[], [0], [-1], [Number.NaN], [Infinity]]) {
      expect(() => summarize(values)).toThrow()
    }
    expect(() => compare([1], [1, 2], 1.1)).toThrow("same number")
  })

  it("rejects invalid arguments and prevents a smoke run being used as a performance gate", () => {
    for (
      const args of [
        ["--runs", "0"],
        ["--runs", "1.5"],
        ["--warmup", "-1"],
        ["--max-ratio", "NaN"],
        ["--max-ratio", "0"],
        ["--runs"],
        ["--typo"],
        ["--check", "--runs", "3"],
        ["--check", "--warmup", "0"]
      ]
    ) expect(() => options(args)).toThrow()
    expect(options(["--runs", "1", "--warmup", "0"]).runs).toBe(1)
    expect(options(["--check"]).maxRatio).toBe(1.1)
  })
})
