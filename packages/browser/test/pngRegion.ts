import * as assert from "node:assert/strict"
import { inflateSync } from "node:zlib"

const verifyPngRows = (
  value: unknown,
  width: number,
  height: number,
  visit: (row: Uint8Array, y: number, channels: number) => void
) => {
  assert.equal(Buffer.from(value as Uint8Array).subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  const bytes = Buffer.from(value as Uint8Array)
  assert.equal(bytes[28], 0, "non-interlaced PNG")
  assert.equal(bytes[24], 8, "8-bit PNG")
  assert.ok(bytes[25] === 2 || bytes[25] === 6, "RGB or RGBA PNG")
  const channels = bytes[25] === 6 ? 4 : 3
  const chunks = []
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at)
    if (bytes.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length))
    at += length + 12
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  assert.equal(raw.length, (stride + 1) * height)
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1)
    const filter = raw[offset]!
    assert.ok(filter <= 4, "valid PNG filter")
    for (let x = 0; x < stride; x++) {
      const left = x < channels ? 0 : row[x - channels]!
      const up = previous[x]!
      const upperLeft = x < channels ? 0 : previous[x - channels]!
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upperLeft
        const a = Math.abs(p - left)
        const b = Math.abs(p - up)
        const c = Math.abs(p - upperLeft)
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft
      }
      row[x] = (raw[offset + 1 + x]! + predictor) & 255
    }
    visit(row, y, channels)
    const swap = previous
    previous = row
    row = swap
  }
}

/** Decode exact RGBA pixels in a physical-pixel rectangle of a noninterlaced 8-bit RGB/RGBA PNG. */
export const pngRegion = (png: Uint8Array, rect: { x: number; y: number; width: number; height: number }) => {
  const bytes = Buffer.from(png)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  for (const value of Object.values(rect)) assert.ok(Number.isInteger(value))
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0)
  assert.ok(rect.x + rect.width <= width && rect.y + rect.height <= height)
  const pixels: Array<Array<number>> = []
  verifyPngRows(png, width, height, (row, y, channels) => {
    if (y < rect.y || y >= rect.y + rect.height) return
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const at = x * channels
      pixels.push([row[at]!, row[at + 1]!, row[at + 2]!, channels === 4 ? row[at + 3]! : 255])
    }
  })
  return pixels
}
