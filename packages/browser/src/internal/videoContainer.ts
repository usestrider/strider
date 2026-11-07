/** A streaming Matroska image track, with millisecond timestamps and no frame pacing. */
import type * as VideoWriter from "../VideoWriter.ts"

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
const uint = (value: number): Uint8Array => {
  const bytes = []
  do {
    bytes.unshift(value % 256)
    value = Math.floor(value / 256)
  } while (value > 0)
  return new Uint8Array(bytes)
}
const element = (id: number, data: Uint8Array): Uint8Array => {
  let length = 1
  while (data.length >= 2 ** (length * 7) - 1) length++
  const size = new Uint8Array(length)
  let value = data.length
  for (let i = length - 1; i >= 0; i--) {
    size[i] = value % 256
    value = Math.floor(value / 256)
  }
  size[0] = size[0]! | (1 << (8 - length))
  return concat(uint(id), size, data)
}
const number = (id: number, value: number) => element(id, uint(value))
const string = (id: number, value: string) => element(id, new TextEncoder().encode(value))

export const header = (frame: VideoWriter.Frame): Uint8Array => {
  // Matroska's VFW codec private data is a little-endian BITMAPINFOHEADER.
  const bitmap = new Uint8Array(40)
  const view = new DataView(bitmap.buffer)
  view.setUint32(0, 40, true)
  view.setInt32(4, frame.width, true)
  view.setInt32(8, frame.height, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, 24, true)
  bitmap.set(new TextEncoder().encode(frame.format === "jpeg" ? "MJPG" : "MPNG"), 16)
  return concat(
    element(
      0x1a45dfa3,
      concat(
        number(0x4286, 1),
        number(0x42f7, 1),
        number(0x42f2, 4),
        number(0x42f3, 8),
        string(0x4282, "matroska"),
        number(0x4287, 4),
        number(0x4285, 2)
      )
    ),
    // An unknown-sized segment permits writing without buffering or seeking.
    new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    element(0x1549a966, concat(number(0x2ad7b1, 1e6), string(0x4d80, "Strider"), string(0x5741, "Strider"))),
    element(
      0x1654ae6b,
      element(
        0xae,
        concat(
          number(0xd7, 1),
          number(0x73c5, 1),
          number(0x83, 1),
          // Only the terminal marker has no following timestamp; give it a one-millisecond duration.
          number(0x23e383, 1e6),
          string(0x86, "V_MS/VFW/FOURCC"),
          element(0x63a2, bitmap),
          element(0xe0, concat(number(0xb0, frame.width), number(0xba, frame.height)))
        )
      )
    )
  )
}

export const image = (frame: VideoWriter.Frame): Uint8Array =>
  element(
    0x1f43b675,
    concat(
      number(0xe7, Math.round(frame.at / 1e6)),
      element(0xa3, concat(new Uint8Array([0x81, 0, 0, 0x80]), frame.data))
    )
  )
