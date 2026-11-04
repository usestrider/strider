import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { captureCases, cases } from "../src/benchmarks/cases.ts"
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

describe("dense capture verification of valid PNG encodings", () => {
  const entry = captureCases.find((entry) => entry.name === "screenshot-dense")!
  const width = 1280
  const height = 2880

  // The fixture's seeded pixels, as `prepareDenseCapture` draws them.
  const pixels = (channels: number) => {
    const image = new Uint8Array(width * height * channels)
    let seed = 42
    for (let at = 0; at < image.length; at += channels) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      image[at] = seed & 255
      image[at + 1] = (seed >>> 8) & 255
      image[at + 2] = (seed >>> 16) & 255
      if (channels === 4) image[at + 3] = 255
    }
    image.set([12, 34, 56], 0)
    return image
  }

  // Encodes with the five PNG row filters in turn, so every predictor is exercised on seeded data.
  const encode = (image: Uint8Array, channels: number, idatChunks = 1) => {
    const header = Buffer.alloc(33)
    Buffer.from("89504e470d0a1a0a", "hex").copy(header)
    header.writeUInt32BE(13, 8)
    header.write("IHDR", 12)
    header.writeUInt32BE(width, 16)
    header.writeUInt32BE(height, 20)
    header[24] = 8
    header[25] = channels === 4 ? 6 : 2
    const stride = width * channels
    const raw = Buffer.alloc((stride + 1) * height)
    for (let y = 0; y < height; y++) {
      const filter = y % 5
      const start = y * (stride + 1)
      raw[start] = filter
      for (let x = 0; x < stride; x++) {
        const value = image[y * stride + x]!
        const left = x < channels ? 0 : image[y * stride + x - channels]!
        const up = y === 0 ? 0 : image[(y - 1) * stride + x]!
        const upperLeft = y === 0 || x < channels ? 0 : image[(y - 1) * stride + x - channels]!
        let predictor = 0
        if (filter === 1) predictor = left
        else if (filter === 2) predictor = up
        else if (filter === 3) predictor = (left + up) >> 1
        else if (filter === 4) {
          const p = left + up - upperLeft
          const a = Math.abs(p - left)
          const b = Math.abs(p - up)
          const c = Math.abs(p - upperLeft)
          predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft
        }
        raw[start + 1 + x] = (value - predictor) & 255
      }
    }
    const compressed = deflateSync(raw, { level: 1 })
    const size = Math.ceil(compressed.length / idatChunks)
    const parts = [header]
    for (let at = 0; at < compressed.length; at += size) {
      const data = compressed.subarray(at, at + size)
      const chunk = Buffer.alloc(12 + data.length)
      chunk.writeUInt32BE(data.length)
      chunk.write("IDAT", 4)
      data.copy(chunk, 8)
      parts.push(chunk)
    }
    return Buffer.concat(parts)
  }

  for (const [label, channels] of [["RGB", 3], ["RGBA", 4]] as const) {
    it(`accepts ${label} with every row filter and split IDAT chunks`, () => {
      const image = pixels(channels)
      entry.verify(encode(image, channels))
      entry.verify(encode(image, channels, 7))
    })

    // One row per filter, from the bottom of the image, where earlier rows' reconstruction has to be right.
    it(`rejects a one-channel difference in ${label} under every row filter`, () => {
      for (const y of [2875, 2876, 2877, 2878, 2879]) {
        const image = pixels(channels)
        image[(y * width + 640) * channels]! ^= 1
        expect(() => entry.verify(encode(image, channels))).toThrow(`Dense PNG differs at 640,${y}`)
      }
    }, 60_000)
  }

  it("rejects RGBA whose alpha is not opaque", () => {
    const image = pixels(4)
    image[(100 * width + 640) * 4 + 3] = 254
    expect(() => entry.verify(encode(image, 4))).toThrow("Dense PNG differs at 640,100")
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


describe("viewport capture pixels", () => {
  const image = (corrupt: boolean) => {
    const header = Buffer.alloc(33)
    Buffer.from("89504e470d0a1a0a", "hex").copy(header)
    header.writeUInt32BE(13, 8)
    header.write("IHDR", 12)
    header.writeUInt32BE(1280, 16)
    header.writeUInt32BE(720, 20)
    header[24] = 8
    header[25] = 2
    const stride = 1280 * 3 + 1
    const raw = Buffer.alloc(stride * 720, 255)
    for (let y = 0; y < 720; y++) raw[y * stride] = 0
    for (let y = 650; y < 714; y++) {
      for (const [left, rgb] of [[0, [200, 40, 60]], [600, [30, 170, 90]], [1216, [50, 80, 220]]] as const) {
        for (let x = left; x < left + 64; x++) raw.set(rgb, y * stride + 1 + x * 3)
      }
    }
    if (corrupt) raw[700 * stride + 1 + 620 * 3]! ^= 1
    const data = deflateSync(raw)
    const chunk = Buffer.alloc(12 + data.length)
    chunk.writeUInt32BE(data.length)
    chunk.write("IDAT", 4)
    data.copy(chunk, 8)
    return Buffer.concat([header, chunk])
  }
  it("accepts viewport marker pixels and rejects one changed channel", () => {
    const entry = cases.find((entry) => entry.name === "screenshot")!
    entry.verify(image(false))
    expect(() => entry.verify(image(true))).toThrow()
  })
  it("checks marker pixels in every repeated capture", () => {
    const entry = captureCases.find((entry) => entry.name === "screenshot-repeated")!
    const images = Array.from({ length: 5 }, () => image(false))
    entry.verify(images)
    images[3] = image(true)
    expect(() => entry.verify(images)).toThrow()
  })
})
