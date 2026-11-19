/**
 * A PNG codec on `node:zlib`: decodes 8-bit, non-interlaced images of every colour type into RGBA, and encodes
 * RGBA. Anything else is refused with a reason, so a baseline Strider can't read fails as invalid, never as a
 * mismatch.
 */
import { crc32, deflateSync, inflateSync } from "node:zlib"

/** An image as RGBA bytes, four per pixel, row by row. */
export interface Image {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

/** Why bytes aren't a PNG this codec reads. */
export class PngError extends Error {}

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

/** Samples per pixel by colour type: grey, RGB, palette, grey and alpha, RGBA. */
const channels: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decodes a PNG into RGBA, or throws a `PngError` saying why it can't. */
export const decode = (bytes: Uint8Array): Image => {
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new PngError("not a PNG: the signature is missing")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let header: { width: number; height: number; depth: number; type: number; interlace: number } | undefined
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const data: Array<Uint8Array> = []
  let ended = false
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (body.length !== length) throw new PngError(`the ${type} chunk is truncated`)
    offset += 12 + length
    if (type === "IHDR") {
      header = {
        width: view.getUint32(body.byteOffset - bytes.byteOffset),
        height: view.getUint32(body.byteOffset - bytes.byteOffset + 4),
        depth: body[8]!,
        type: body[9]!,
        interlace: body[12]!
      }
    } else if (type === "PLTE") palette = body
    else if (type === "tRNS") transparency = body
    else if (type === "IDAT") data.push(body)
    else if (type === "IEND") {
      ended = true
      break
    }
  }
  if (header === undefined) throw new PngError("the IHDR chunk is missing")
  if (!ended) throw new PngError("the IEND chunk is missing")
  const { depth, height, interlace, type, width } = header
  const samples = channels[type]
  if (samples === undefined) throw new PngError(`colour type ${type} is not a PNG colour type`)
  if (depth !== 8) throw new PngError(`bit depth ${depth} is unsupported: only 8-bit images are read`)
  if (interlace !== 0) throw new PngError("interlaced images are unsupported")
  if (type === 3 && palette === undefined) throw new PngError("the palette is missing")
  let raw: Uint8Array
  try {
    raw = inflateSync(Buffer.concat(data))
  } catch (error) {
    throw new PngError(`the image data doesn't inflate: ${(error as Error).message}`)
  }
  const stride = width * samples
  if (raw.length < (stride + 1) * height) throw new PngError("the image data is shorter than its size")
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const source = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= samples ? pixels[row + x - samples]! : 0
      const up = y > 0 ? pixels[row - stride + x]! : 0
      const corner = x >= samples && y > 0 ? pixels[row - stride + x - samples]! : 0
      const value = raw[source + x]!
      const predicted = filter === 0
        ? 0
        : filter === 1
        ? left
        : filter === 2
        ? up
        : filter === 3
        ? (left + up) >> 1
        : filter === 4
        ? paeth(left, up, corner)
        : -1
      if (predicted < 0) throw new PngError(`row ${y} has unknown filter ${filter}`)
      pixels[row + x] = (value + predicted) & 0xff
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  const keyed = (r: number, g: number, b: number): boolean =>
    transparency !== undefined && transparency.length >= (type === 0 ? 2 : 6) &&
    (type === 0
      ? r === transparency[1]
      : r === transparency[1] && g === transparency[3] && b === transparency[5])
  for (let index = 0; index < width * height; index++) {
    const at = index * samples
    let r: number, g: number, b: number, a: number
    if (type === 0) {
      r = g = b = pixels[at]!
      a = keyed(r, g, b) ? 0 : 255
    } else if (type === 2) {
      r = pixels[at]!
      g = pixels[at + 1]!
      b = pixels[at + 2]!
      a = keyed(r, g, b) ? 0 : 255
    } else if (type === 3) {
      const entry = pixels[at]!
      if (entry * 3 + 2 >= palette!.length) throw new PngError(`palette index ${entry} is out of range`)
      r = palette![entry * 3]!
      g = palette![entry * 3 + 1]!
      b = palette![entry * 3 + 2]!
      a = transparency?.[entry] ?? 255
    } else if (type === 4) {
      r = g = b = pixels[at]!
      a = pixels[at + 1]!
    } else {
      r = pixels[at]!
      g = pixels[at + 1]!
      b = pixels[at + 2]!
      a = pixels[at + 3]!
    }
    rgba.set([r, g, b, a], index * 4)
  }
  return { width, height, data: rgba }
}

const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** Encodes RGBA as an 8-bit, non-interlaced PNG. */
export const encode = (image: Image): Uint8Array => {
  const { data, height, width } = image
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array())
  ])
}
