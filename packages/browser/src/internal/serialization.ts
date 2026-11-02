/**
 * Values that cross into and out of an evaluation by value, as WebDriver BiDi
 * serializes them: what `JSHandle.Serialized` says arrives. Arguments become local values, and results come
 * back as JavaScript values. Something that can't cross fails with the path to it, for `NotSerializable`.
 *
 * What crosses: `undefined`, `null`, strings, numbers (with `NaN`, `-0` and the infinities), booleans, bigints,
 * `Date`, `RegExp`, arrays, `Map`, `Set` and objects, by their own enumerable string keys. Functions and
 * symbols inside an object, a `Map` or a `Set` are left out, as `Serialized` leaves them out, and in an array
 * keep their place as `undefined`; anything else that
 * can't cross (a function or symbol on its own, a DOM node, a cycle, a value nested deeper than the browser
 * serializes) is an error.
 */
import type * as Adapter from "./adapter.ts"

/** Something that couldn't cross, and where. */
export class Unserializable {
  readonly _tag = "Unserializable"
  readonly path: string
  readonly hint: string
  constructor(path: string, hint: string) {
    this.path = path
    this.hint = hint
  }
}

const number = (value: number): Adapter.RemoteValue => {
  if (Number.isNaN(value)) return { type: "number", value: "NaN" }
  if (Object.is(value, -0)) return { type: "number", value: "-0" }
  if (value === Infinity) return { type: "number", value: "Infinity" }
  if (value === -Infinity) return { type: "number", value: "-Infinity" }
  return { type: "number", value }
}

const skipped = (value: unknown) => typeof value === "function" || typeof value === "symbol"

/** A value as a local value for an evaluation's argument. */
export const toRemote = (value: unknown, path = "argument", seen = new Set<object>()): Adapter.RemoteValue =>
  encode(value, path, seen)

/** A local result under the same rules as evaluation, optionally replacing application handles. */
export const result = (
  value: unknown,
  replace: (value: object, path: string) => Adapter.RemoteValue | undefined = () => undefined
): Adapter.RemoteValue => encode(value, "result", new Set(), replace)

const encode = (
  value: unknown,
  path: string,
  seen: Set<object>,
  replace?: (value: object, path: string) => Adapter.RemoteValue | undefined
): Adapter.RemoteValue => {
  switch (typeof value) {
    case "undefined":
      return { type: "undefined" }
    case "string":
      return { type: "string", value }
    case "number":
      return number(value)
    case "boolean":
      return { type: "boolean", value }
    case "bigint":
      return { type: "bigint", value: value.toString() }
    case "function":
    case "symbol":
      throw new Unserializable(
        path,
        `A ${typeof value} can't cross${replace === undefined ? " into a realm" : ""} by value`
      )
  }
  if (value === null) return { type: "null" }
  const object = value as object
  const replaced = replace?.(object, path)
  if (replaced !== undefined) return replaced
  if (replace !== undefined && seen.size >= 64) throw deeper(path)
  if (replace !== undefined && (object instanceof Promise || object instanceof WeakMap || object instanceof WeakSet)) {
    throw new Unserializable(path, "Promises and weak collections don't cross by value; return their data instead")
  }
  if (object instanceof Date) return { type: "date", value: object.toISOString() }
  if (object instanceof RegExp) return { type: "regexp", value: { pattern: object.source, flags: object.flags } }
  if (seen.has(object)) throw new Unserializable(path, "The value refers to itself, which can't cross by value")
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      return {
        type: "array",
        value: (replace === undefined ? object : Array.from(object)).map((item, index) =>
          encode(replace !== undefined && skipped(item) ? undefined : item, `${path}[${index}]`, seen, replace)
        )
      }
    }
    if (object instanceof Set) {
      return {
        type: "set",
        value: [...object].filter((item) => !skipped(item)).map((item, index) =>
          encode(item, `${path}.<set ${index}>`, seen, replace)
        )
      }
    }
    if (object instanceof Map) {
      return {
        type: "map",
        value: [...object].filter(([, item]) => !skipped(item)).map(([key, item]) =>
          [
            typeof key === "string" ? key : encode(key, `${path}.<key>`, seen, replace),
            encode(item, `${path}.get(${String(key)})`, seen, replace)
          ] as const
        )
      }
    }
    return {
      type: "object",
      value: Object.entries(object).filter(([, item]) => !skipped(item)).map(([key, item]) =>
        [key, encode(item, `${path}.${key}`, seen, replace)] as const
      )
    }
  } finally {
    seen.delete(object)
  }
}

const deeper = (path: string) =>
  new Unserializable(path, "The value is nested deeper than the browser serializes; return less of it")

const leftOut = (value: Adapter.RemoteValue) => value.type === "function" || value.type === "symbol"

/** A result, as a JavaScript value. */
export const fromRemote = (value: Adapter.RemoteValue, path = "result"): unknown => {
  switch (value.type) {
    case "undefined":
      return undefined
    case "null":
      return null
    case "string":
    case "boolean":
      return value.value
    case "number":
      return typeof value.value === "number" ? value.value : Number(value.value)
    case "bigint":
      return BigInt(value.value)
    case "date":
      return new Date(value.value)
    case "regexp":
      return new RegExp(value.value.pattern, value.value.flags)
    case "array":
    case "nodelist":
    case "htmlcollection":
      if (value.type !== "array") {
        throw new Unserializable(path, "DOM nodes don't cross by value; use evaluateHandle")
      }
      if (value.value === undefined) throw deeper(path)
      // A function or symbol in an array keeps its place, as `undefined`
      return value.value.map((item, index) => leftOut(item) ? undefined : fromRemote(item, `${path}[${index}]`))
    case "set":
      if (value.value === undefined) throw deeper(path)
      return new Set(value.value.filter((item) => !leftOut(item)).map((item) => fromRemote(item, `${path}.<set>`)))
    case "map":
      if (value.value === undefined) throw deeper(path)
      return new Map(
        value.value.filter(([, item]) => !leftOut(item)).map(([key, item]) => [
          typeof key === "string" ? key : fromRemote(key, `${path}.<key>`),
          fromRemote(item, `${path}.get(${typeof key === "string" ? key : "…"})`)
        ])
      )
    case "object": {
      if (value.value === undefined) throw deeper(path)
      const result: Record<string, unknown> = {}
      for (const [key, item] of value.value) {
        if (leftOut(item)) continue
        const name = typeof key === "string" ? key : String(fromRemote(key, `${path}.<key>`))
        result[name] = fromRemote(item, `${path}.${name}`)
      }
      return result
    }
    case "node":
      throw new Unserializable(path, "DOM nodes don't cross by value; use evaluateHandle")
    default:
      throw new Unserializable(path, `A ${value.type} doesn't cross by value; use evaluateHandle`)
  }
}
