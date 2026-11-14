/**
 * Reads the PNGs Strider's screenshots are: eight-bit, non-interlaced RGB or RGBA. Ports compare captures by size and
 * pixels here where the original compares them with a golden image or Playwright's PNG decoder.
 */
import { assert } from "@effect/vitest"
import { inflateSync } from "node:zlib"

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG's width and height in device pixels, from its IHDR chunk after the signature. */
export const pngSize = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  assert.deepStrictEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE)
  assert.strictEqual(Buffer.from(bytes.subarray(12, 16)).toString("latin1"), "IHDR")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * A PNG's pixels as RGBA bytes: 8-bit RGB or RGBA, non-interlaced, which is what every backend returns. It inflates the
 * IDAT chunks and undoes each scanline's filter, so two captures compare by what they draw, not by how they were
 * encoded.
 */
export const decodePng = (
  bytes: Uint8Array
): { readonly width: number; readonly height: number; readonly data: Uint8Array } => {
  const { height, width } = pngSize(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colorType = bytes[25]
  assert.strictEqual(bytes[24], 8, "bit depth")
  assert.isTrue(colorType === 2 || colorType === 6, `color type ${colorType}`)
  assert.strictEqual(bytes[28], 0, "interlace")
  const channels = colorType === 6 ? 4 : 3
  const chunks: Array<Buffer> = []
  for (let offset = 8; offset < bytes.byteLength;) {
    const length = view.getUint32(offset)
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("latin1")
    if (type === "IDAT") chunks.push(Buffer.from(bytes.subarray(offset + 8, offset + 8 + length)))
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels]! : 0
      const up = previous[i]!
      const upLeft = i >= channels ? previous[i - channels]! : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      line[i] = (line[i]! + predictor) & 0xff
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        out[(y * width + x) * 4 + c] = c < channels ? line[x * channels + c]! : 255
      }
    }
    previous = line
  }
  return { width, height, data: out }
}

export const pixelAt = (image: ReturnType<typeof decodePng>, x: number, y: number): Array<number> => {
  const at = (y * image.width + x) * 4
  return [...image.data.subarray(at, at + 4)]
}
