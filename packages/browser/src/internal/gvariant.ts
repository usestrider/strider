/**
 * GVariant, GLib's serialization format, for WebKitGTK's and WPE's remote inspector socket. Values are
 * encoded and decoded from their type strings, with GVariant's alignment and framing offsets, without GLib: the
 * basic types, strings, variants, maybes, arrays, tuples and dictionary entries.
 *
 * - A tuple or dictionary entry is an array of its members; a dictionary is an array of entries.
 * - A variant is `{ type, value }`; a maybe is its value or `null`.
 * - 64-bit integers are `bigint`s, other numbers `number`s.
 *
 * Encoding is little-endian, which the socket's frames say; decoding takes either. Malformed data throws
 * `GVariantError`.
 */

/** A value of some GVariant type. */
export type Value =
  | boolean
  | number
  | bigint
  | string
  | null
  | Variant
  | ReadonlyArray<Value>

/** A variant: a value with its type. */
export interface Variant {
  readonly type: string
  readonly value: Value
}

/** Data that doesn't decode as its type, or a value that doesn't encode as it. */
export class GVariantError extends Error {
  override readonly name = "GVariantError"
}

type Type =
  | { readonly k: "basic"; readonly c: string }
  | { readonly k: "v" }
  | { readonly k: "a"; readonly elem: Type }
  | { readonly k: "m"; readonly elem: Type }
  | { readonly k: "tuple"; readonly members: ReadonlyArray<Type> }

const basics = "bynqiuxthdsog"

const parseAt = (signature: string, at: number): readonly [Type, number] => {
  const c = signature[at]
  if (c === undefined) throw new GVariantError(`Type ${JSON.stringify(signature)} ends early`)
  if (c === "a" || c === "m") {
    const [elem, next] = parseAt(signature, at + 1)
    return [{ k: c, elem }, next]
  }
  if (c === "(" || c === "{") {
    const close = c === "(" ? ")" : "}"
    const members: Array<Type> = []
    let next = at + 1
    while (signature[next] !== close) {
      const [member, after] = parseAt(signature, next)
      members.push(member)
      next = after
    }
    if (c === "{" && members.length !== 2) {
      throw new GVariantError(`A dictionary entry has two members: ${signature}`)
    }
    return [{ k: "tuple", members }, next + 1]
  }
  if (c === "v") return [{ k: "v" }, at + 1]
  if (basics.includes(c)) return [{ k: "basic", c }, at + 1]
  throw new GVariantError(`Type ${JSON.stringify(signature)} has ${JSON.stringify(c)}`)
}

const types = new Map<string, Type>()
const typeOf = (signature: string): Type => {
  const known = types.get(signature)
  if (known !== undefined) return known
  const [type, next] = parseAt(signature, 0)
  if (next !== signature.length) throw new GVariantError(`Type ${JSON.stringify(signature)} has more than one type`)
  types.set(signature, type)
  return type
}

const basicSize: Readonly<Record<string, number>> = { b: 1, y: 1, n: 2, q: 2, i: 4, u: 4, h: 4, x: 8, t: 8, d: 8 }

const alignment = (type: Type): number => {
  switch (type.k) {
    case "basic":
      return basicSize[type.c] ?? 1
    case "v":
      return 8
    case "a":
    case "m":
      return alignment(type.elem)
    case "tuple":
      return Math.max(1, ...type.members.map(alignment))
  }
}

/** A type's size when every value of it has the same, or `undefined`. */
const fixedSize = (type: Type): number | undefined => {
  switch (type.k) {
    case "basic":
      return basicSize[type.c]
    case "tuple": {
      if (type.members.length === 0) return 1
      let at = 0
      for (const member of type.members) {
        const size = fixedSize(member)
        if (size === undefined) return undefined
        at = alignUp(at, alignment(member)) + size
      }
      return alignUp(at, alignment(type))
    }
    default:
      return undefined
  }
}

const alignUp = (at: number, to: number) => Math.ceil(at / to) * to

/** The size of a container's framing offsets, by its total size. */
const offsetSize = (total: number) => total > 0xffffffff ? 8 : total > 0xffff ? 4 : total > 0xff ? 2 : total > 0 ? 1 : 0

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

// ── Encoding ──

class Writer {
  readonly chunks: Array<Uint8Array> = []
  size = 0
  push(bytes: Uint8Array) {
    this.chunks.push(bytes)
    this.size += bytes.length
  }
  pad(to: number) {
    const padding = alignUp(this.size, to) - this.size
    if (padding > 0) this.push(new Uint8Array(padding))
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size)
    let at = 0
    for (const chunk of this.chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }
}

/** A container's body with its framing offsets after it, at the smallest size they all fit. */
const framed = (body: Uint8Array, offsets: ReadonlyArray<number>): Uint8Array => {
  if (offsets.length === 0) return body
  for (const size of [1, 2, 4, 8]) {
    const total = body.length + offsets.length * size
    if (offsetSize(total) > size) continue
    const out = new Uint8Array(total)
    out.set(body)
    const view = new DataView(out.buffer)
    offsets.forEach((offset, index) => {
      const at = body.length + index * size
      if (size === 1) view.setUint8(at, offset)
      else if (size === 2) view.setUint16(at, offset, true)
      else if (size === 4) view.setUint32(at, offset, true)
      else view.setBigUint64(at, BigInt(offset), true)
    })
    return out
  }
  throw new GVariantError("A container too large to frame")
}

const expected = (what: string, value: Value): never => {
  throw new GVariantError(`Expected ${what}, got ${typeof value === "bigint" ? `${value}n` : JSON.stringify(value)}`)
}

const encodeBasic = (c: string, value: Value): Uint8Array => {
  if (c === "s" || c === "o" || c === "g") {
    if (typeof value !== "string") return expected("a string", value)
    if (value.includes("\0")) throw new GVariantError("A string can't hold a nul")
    const bytes = encoder.encode(value)
    const out = new Uint8Array(bytes.length + 1)
    out.set(bytes)
    return out
  }
  const out = new Uint8Array(basicSize[c]!)
  const view = new DataView(out.buffer)
  switch (c) {
    case "b":
      if (typeof value !== "boolean") return expected("a boolean", value)
      view.setUint8(0, value ? 1 : 0)
      break
    case "x":
    case "t":
      if (typeof value !== "bigint") return expected("a bigint", value)
      if (c === "x") view.setBigInt64(0, value, true)
      else view.setBigUint64(0, value, true)
      break
    default: {
      if (typeof value !== "number") return expected("a number", value)
      if (c === "y") view.setUint8(0, value)
      else if (c === "n") view.setInt16(0, value, true)
      else if (c === "q") view.setUint16(0, value, true)
      else if (c === "i" || c === "h") view.setInt32(0, value, true)
      else if (c === "u") view.setUint32(0, value, true)
      else view.setFloat64(0, value, true)
    }
  }
  return out
}

const encodeType = (type: Type, value: Value): Uint8Array => {
  switch (type.k) {
    case "basic":
      return encodeBasic(type.c, value)
    case "v": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return expected("a variant", value)
      const variant = value as Variant
      const writer = new Writer()
      writer.push(encodeType(typeOf(variant.type), variant.value))
      writer.push(new Uint8Array(1))
      writer.push(encoder.encode(variant.type))
      return writer.bytes()
    }
    case "m": {
      if (value === null) return new Uint8Array(0)
      const inner = encodeType(type.elem, value)
      if (fixedSize(type.elem) !== undefined) return inner
      const out = new Uint8Array(inner.length + 1)
      out.set(inner)
      return out
    }
    case "a": {
      if (!Array.isArray(value)) return expected("an array", value)
      const writer = new Writer()
      const ends: Array<number> = []
      for (const element of value as ReadonlyArray<Value>) {
        writer.pad(alignment(type.elem))
        writer.push(encodeType(type.elem, element))
        ends.push(writer.size)
      }
      return fixedSize(type.elem) === undefined ? framed(writer.bytes(), ends) : writer.bytes()
    }
    case "tuple": {
      if (!Array.isArray(value) || value.length !== type.members.length) {
        return expected(`a tuple of ${type.members.length}`, value)
      }
      const writer = new Writer()
      const ends: Array<number> = []
      type.members.forEach((member, index) => {
        writer.pad(alignment(member))
        writer.push(encodeType(member, (value as ReadonlyArray<Value>)[index]!))
        if (fixedSize(member) === undefined && index < type.members.length - 1) ends.push(writer.size)
      })
      if (fixedSize(type) !== undefined) {
        if (type.members.length === 0) return new Uint8Array(1)
        writer.pad(alignment(type))
        return writer.bytes()
      }
      // A tuple's offsets are written last member first
      return framed(writer.bytes(), ends.reverse())
    }
  }
}

/** The bytes of `value` as the GVariant type `signature`, little-endian. */
export const encode = (signature: string, value: Value): Uint8Array => encodeType(typeOf(signature), value)

// ── Decoding ──

const readOffset = (view: DataView, at: number, size: number, littleEndian: boolean): number => {
  if (size === 1) return view.getUint8(at)
  if (size === 2) return view.getUint16(at, littleEndian)
  if (size === 4) return view.getUint32(at, littleEndian)
  return Number(view.getBigUint64(at, littleEndian))
}

const decodeType = (type: Type, data: Uint8Array, littleEndian: boolean): Value => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const short = () => new GVariantError(`${data.length} bytes is too few`)
  switch (type.k) {
    case "basic": {
      if (type.c === "s" || type.c === "o" || type.c === "g") {
        if (data.length === 0 || data[data.length - 1] !== 0) throw new GVariantError("A string without its nul")
        try {
          return decoder.decode(data.subarray(0, data.length - 1))
        } catch {
          throw new GVariantError("A string that isn't UTF-8")
        }
      }
      if (data.length < basicSize[type.c]!) throw short()
      switch (type.c) {
        case "b":
          return data[0] !== 0
        case "y":
          return data[0]!
        case "n":
          return view.getInt16(0, littleEndian)
        case "q":
          return view.getUint16(0, littleEndian)
        case "i":
        case "h":
          return view.getInt32(0, littleEndian)
        case "u":
          return view.getUint32(0, littleEndian)
        case "x":
          return view.getBigInt64(0, littleEndian)
        case "t":
          return view.getBigUint64(0, littleEndian)
        default:
          return view.getFloat64(0, littleEndian)
      }
    }
    case "v": {
      const nul = data.lastIndexOf(0)
      if (nul < 0) throw new GVariantError("A variant without its type")
      const signature = decoder.decode(data.subarray(nul + 1))
      return { type: signature, value: decodeType(typeOf(signature), data.subarray(0, nul), littleEndian) }
    }
    case "m": {
      if (data.length === 0) return null
      return fixedSize(type.elem) !== undefined
        ? decodeType(type.elem, data, littleEndian)
        : decodeType(type.elem, data.subarray(0, data.length - 1), littleEndian)
    }
    case "a": {
      if (data.length === 0) return []
      const size = fixedSize(type.elem)
      if (size !== undefined) {
        if (data.length % size !== 0) throw new GVariantError(`An array of ${size}-byte elements in ${data.length}`)
        const out: Array<Value> = []
        for (let at = 0; at < data.length; at += size) {
          out.push(decodeType(type.elem, data.subarray(at, at + size), littleEndian))
        }
        return out
      }
      const width = offsetSize(data.length)
      const last = readOffset(view, data.length - width, width, littleEndian)
      if (last > data.length - width || (data.length - last) % width !== 0) {
        throw new GVariantError("An array's offsets don't fit it")
      }
      const out: Array<Value> = []
      let start = 0
      for (let at = last; at < data.length; at += width) {
        const end = readOffset(view, at, width, littleEndian)
        start = alignUp(start, alignment(type.elem))
        if (end < start || end > last) throw new GVariantError("An array's element runs past it")
        out.push(decodeType(type.elem, data.subarray(start, end), littleEndian))
        start = end
      }
      return out
    }
    case "tuple": {
      const width = offsetSize(data.length)
      let framing = data.length
      let at = 0
      return type.members.map((member, index) => {
        at = alignUp(at, alignment(member))
        const size = fixedSize(member)
        let end: number
        if (size !== undefined) end = at + size
        else if (index < type.members.length - 1) {
          framing -= width
          if (framing < 0) throw short()
          end = readOffset(view, framing, width, littleEndian)
        } else end = framing
        if (end < at || end > framing) throw new GVariantError("A tuple's member runs past it")
        const value = decodeType(member, data.subarray(at, end), littleEndian)
        at = end
        return value
      })
    }
  }
}

/** The value of the GVariant type `signature` that `data` holds. */
export const decode = (signature: string, data: Uint8Array, littleEndian = true): Value =>
  decodeType(typeOf(signature), data, littleEndian)
