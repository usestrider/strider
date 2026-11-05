import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { pngRegion } from "./pngRegion.ts"

describe("PNG interior regions", () => {
  const width = 9
  const height = 10
  const encode = (image: Uint8Array, channels: number, idatChunks = 3) => {
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

  for (const channels of [3, 4]) {
    it(`decodes ${channels} channels through every filter, ignoring pixels outside the region`, () => {
      const image = Uint8Array.from({ length: width * height * channels }, (_, i) => (i * 73 + 19) & 255)
      const expected = []
      for (let y = 3; y < 8; y++) {
        for (let x = 2; x < 6; x++) {
          const at = (y * width + x) * channels
          expected.push([image[at], image[at + 1], image[at + 2], channels === 4 ? image[at + 3] : 255])
        }
      }
      const rect = { x: 2, y: 3, width: 4, height: 5 }
      expect(pngRegion(encode(image, channels), rect)).toEqual(expected)
      image[0]! ^= 1
      expect(pngRegion(encode(image, channels), rect)).toEqual(expected)
      image[(7 * width + 5) * channels + channels - 1]! ^= 1
      expect(pngRegion(encode(image, channels), rect)).not.toEqual(expected)
    })
  }
  it("rejects empty, fractional and out-of-bounds rectangles", () => {
    const png = encode(new Uint8Array(width * height * 3), 3)
    for (
      const rect of [{ x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, {
        x: 0.5,
        y: 0,
        width: 1,
        height: 1
      }, { x: 8, y: 9, width: 2, height: 1 }]
    ) {
      expect(() => pngRegion(png, rect)).toThrow()
    }
  })
})
