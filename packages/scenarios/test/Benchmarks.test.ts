import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { captureCases } from "../src/benchmarks/cases.ts"
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

describe("capture benchmark verification", () => {
  it("checks repeated captures independently", () => {
    const entry = captureCases.find((entry) => entry.name === "screenshot-repeated")!
    expect(() => entry.verify([])).toThrow()
    expect(() => entry.verify(Array.from({ length: 5 }, () => new Uint8Array(24)))).toThrow()
  })

  it("rejects wrong element pixels even with matching dimensions", () => {
    const entry = captureCases.find((entry) => entry.name === "screenshot-element")!
    const header = Buffer.alloc(33)
    Buffer.from("89504e470d0a1a0a", "hex").copy(header)
    header.writeUInt32BE(13, 8)
    header.write("IHDR", 12)
    header.writeUInt32BE(320, 16)
    header.writeUInt32BE(180, 20)
    header[24] = 8
    header[25] = 2
    const png = (rgb: Array<number>) => {
      const compressed = deflateSync(Buffer.from([0, ...rgb]))
      const chunk = Buffer.alloc(12 + compressed.length)
      chunk.writeUInt32BE(compressed.length)
      chunk.write("IDAT", 4)
      compressed.copy(chunk, 8)
      return Buffer.concat([header, chunk])
    }
    entry.verify(png([200, 100, 50]))
    expect(() => entry.verify(png([12, 34, 56]))).toThrow()
  })
})

it("rejects dense-image corruption away from the first pixel", () => {
  const entry = captureCases.find((entry) => entry.name === "screenshot-dense")!
  const header = Buffer.alloc(33)
  Buffer.from("89504e470d0a1a0a", "hex").copy(header)
  header.writeUInt32BE(13, 8)
  header.write("IHDR", 12)
  header.writeUInt32BE(1280, 16)
  header.writeUInt32BE(2880, 20)
  header[24] = 8
  header[25] = 2
  const raw = Buffer.alloc((1280 * 3 + 1) * 2880)
  raw.set([12, 34, 56], 1)
  const compressed = deflateSync(raw)
  const chunk = Buffer.alloc(12 + compressed.length)
  chunk.writeUInt32BE(compressed.length)
  chunk.write("IDAT", 4)
  compressed.copy(chunk, 8)
  expect(() => entry.verify(Buffer.concat([header, chunk]))).toThrow()
})
