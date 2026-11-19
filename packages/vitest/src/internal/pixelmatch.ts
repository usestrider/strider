/**
 * A pixel comparator after pixelmatch 5.3.0 (ISC, Mapbox; THIRD_PARTY_NOTICES.md): pixels differ when their YIQ
 * distance passes a threshold, unless the difference is anti-aliasing, which it detects from each pixel's
 * neighbours.
 */
import type { Image } from "./png.ts"

/** How many pixels differ, and an image showing where. */
export interface Comparison {
  readonly diffPixels: number
  readonly diff: Image
}

const blend = (c: number, a: number): number => 255 + (c - 255) * a
const rgb2y = (r: number, g: number, b: number): number => r * 0.29889531 + g * 0.58662247 + b * 0.11448223
const rgb2i = (r: number, g: number, b: number): number => r * 0.59597799 - g * 0.2741761 - b * 0.32180189
const rgb2q = (r: number, g: number, b: number): number => r * 0.21147017 - g * 0.52261711 + b * 0.31114694

/** The squared YIQ distance between pixel `k` of `a` and pixel `m` of `b`, signed by which is lighter. */
const colorDelta = (a: Uint8Array, b: Uint8Array, k: number, m: number, yOnly: boolean): number => {
  let r1 = a[k]!, g1 = a[k + 1]!, b1 = a[k + 2]!, a1 = a[k + 3]!
  let r2 = b[m]!, g2 = b[m + 1]!, b2 = b[m + 2]!, a2 = b[m + 3]!
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0
  // Translucent pixels are compared as they'd show over white
  if (a1 < 255) {
    a1 /= 255
    r1 = blend(r1, a1)
    g1 = blend(g1, a1)
    b1 = blend(b1, a1)
  }
  if (a2 < 255) {
    a2 /= 255
    r2 = blend(r2, a2)
    g2 = blend(g2, a2)
    b2 = blend(b2, a2)
  }
  const y1 = rgb2y(r1, g1, b1)
  const y2 = rgb2y(r2, g2, b2)
  const y = y1 - y2
  if (yOnly) return y
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
  return y1 > y2 ? -delta : delta
}

/** Whether the pixel has more than two neighbours of exactly its colour. */
const hasManySiblings = (image: Uint8Array, x1: number, y1: number, width: number, height: number): boolean => {
  const x0 = Math.max(x1 - 1, 0)
  const y0 = Math.max(y1 - 1, 0)
  const x2 = Math.min(x1 + 1, width - 1)
  const y2 = Math.min(y1 + 1, height - 1)
  const at = (y1 * width + x1) * 4
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const other = (y * width + x) * 4
      if (
        image[at] === image[other] && image[at + 1] === image[other + 1] && image[at + 2] === image[other + 2] &&
        image[at + 3] === image[other + 3]
      ) zeroes++
      if (zeroes > 2) return true
    }
  }
  return false
}

/**
 * Whether the pixel looks anti-aliased: its neighbours run from darker to lighter, and the darkest or the
 * lightest of them sits in a flat region of both images.
 */
const antialiased = (
  image: Uint8Array,
  x1: number,
  y1: number,
  width: number,
  height: number,
  other: Uint8Array
): boolean => {
  const x0 = Math.max(x1 - 1, 0)
  const y0 = Math.max(y1 - 1, 0)
  const x2 = Math.min(x1 + 1, width - 1)
  const y2 = Math.min(y1 + 1, height - 1)
  const at = (y1 * width + x1) * 4
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  let min = 0, max = 0, minX = 0, minY = 0, maxX = 0, maxY = 0
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const delta = colorDelta(image, image, at, (y * width + x) * 4, true)
      if (delta === 0) {
        zeroes++
        if (zeroes > 2) return false
      } else if (delta < min) {
        min = delta
        minX = x
        minY = y
      } else if (delta > max) {
        max = delta
        maxX = x
        maxY = y
      }
    }
  }
  if (min === 0 || max === 0) return false
  return (hasManySiblings(image, minX, minY, width, height) && hasManySiblings(other, minX, minY, width, height)) ||
    (hasManySiblings(image, maxX, maxY, width, height) && hasManySiblings(other, maxX, maxY, width, height))
}

/**
 * Compares two images of the same size. `threshold`, from 0 to 1, is the YIQ distance a pixel may move without
 * counting; anti-aliased pixels never count. The diff shows the expected image faded, differing pixels red and
 * anti-aliasing yellow.
 */
export const compare = (expected: Image, actual: Image, threshold: number): Comparison => {
  const { height, width } = expected
  const a = expected.data
  const b = actual.data
  const out = new Uint8Array(width * height * 4)
  const maxDelta = 35215 * threshold * threshold
  let diffPixels = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const delta = colorDelta(a, b, at, at, false)
      if (Math.abs(delta) > maxDelta) {
        if (antialiased(a, x, y, width, height, b) || antialiased(b, x, y, width, height, a)) {
          out.set([255, 255, 0, 255], at)
        } else {
          out.set([255, 0, 0, 255], at)
          diffPixels++
        }
      } else {
        const grey = blend(rgb2y(a[at]!, a[at + 1]!, a[at + 2]!), 0.1 * a[at + 3]! / 255)
        out.set([grey, grey, grey, 255], at)
      }
    }
  }
  return { diffPixels, diff: { width, height, data: out } }
}
