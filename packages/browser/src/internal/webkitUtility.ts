/**
 * The WebKit adapter's helper in a realm: an object installed once per realm, through which every evaluation
 * runs, because WebKit can call a function only on an object (`Runtime.callFunctionOn` takes an `objectId`) and
 * serializes values only as JSON.
 *
 * - `run` deserializes the caller's arguments, calls the function, awaits it if asked, and returns the result
 *   either as the value itself (for a handle) or as WebDriver BiDi's `RemoteValue`, as JSON text.
 * - Nodes in a serialized value are kept in a batch the adapter takes next (`takeNodes`), for their object ids:
 *   WebKit's handle on a node is its remote object.
 * - A function too large for one inspector message arrives in parts (`stage`), which `compile` joins and compiles
 *   with the `eval` captured at install. WebKit allows eval for the length of an inspector call, even where the
 *   page's Content-Security-Policy forbids it, and the compile runs inside one. A page that replaced `eval` before
 *   the helper was installed could compile something else, so `compile` checks that it made a function whose
 *   source is the text it joined, and throws otherwise.
 *
 * The helper captures the intrinsics it uses when it is installed, so a page that later replaces
 * `JSON.stringify` or `Array.prototype` doesn't change what it returns; a page that replaced them before can.
 * It lives in a closure, never on a global, so a page can't reach it.
 */

import * as Argument from "./evaluationArgument.ts"

/** The expression that installs the helper; its value is the helper object. */
export const source = String.raw`(() => {
  const toStringTag = Object.prototype.toString
  const isArray = Array.isArray
  const ownKeys = Object.keys
  const is = Object.is
  const stringify = JSON.stringify
  const resolve = Promise.resolve.bind(Promise)
  const then = Promise.prototype.then
  const apply = Reflect.apply
  const mapEntries = Map.prototype.entries
  const setValues = Set.prototype.values
  const iteratorNext = Object.getPrototypeOf([][Symbol.iterator]()).next
  const mapIteratorNext = Object.getPrototypeOf(new Map()[Symbol.iterator]()).next
  const setIteratorNext = Object.getPrototypeOf(new Set()[Symbol.iterator]()).next
  const isView = ArrayBuffer.isView
  const getTime = Date.prototype.getTime
  const toISOString = Date.prototype.toISOString
  const NodeType = typeof Node === "function" ? Node : undefined
  const ErrorType = Error
  const MapType = Map
  const SetType = Set
  const join = Array.prototype.join
  const trim = String.prototype.trim
  const functionSource = Function.prototype.toString
  const compile = eval
  const batches = new Map()
  const staged = new Map()
  let batchId = 0

  const tag = (value) => apply(toStringTag, value, []).slice(8, -1)

  const kindOf = (value) => {
    if (isArray(value)) return "array"
    if (NodeType !== undefined && value instanceof NodeType) return "node"
    switch (tag(value)) {
      case "Map": return "map"
      case "Set": return "set"
      case "WeakMap": return "weakmap"
      case "WeakSet": return "weakset"
      case "Date": return "date"
      case "RegExp": return "regexp"
      case "Error": return "error"
      case "Promise": return "promise"
      case "Generator": return "generator"
      case "ArrayBuffer": return "arraybuffer"
      case "NodeList": return "nodelist"
      case "HTMLCollection": return "htmlcollection"
      case "Window": return "window"
    }
    if (isView(value)) return "typedarray"
    if (value instanceof ErrorType) return "error"
    return "object"
  }

  const number = (value) =>
    value !== value ? "NaN" : is(value, -0) ? "-0" : value === Infinity ? "Infinity" : value === -Infinity ? "-Infinity" : value

  const each = (iterator, next, visit) => {
    for (let step = apply(next, iterator, []); !step.done; step = apply(next, iterator, [])) visit(step.value)
  }

  const describe = (node) => {
    const description = { nodeType: node.nodeType, nodeName: node.nodeName, childNodeCount: node.childNodes.length }
    if (node.nodeType === 1) {
      description.localName = node.localName
      const attributes = {}
      for (let i = 0; i < node.attributes.length; i++) attributes[node.attributes[i].name] = node.attributes[i].value
      description.attributes = attributes
    }
    return description
  }

  const serialize = (value, seen, nodes, depth) => {
    switch (typeof value) {
      case "undefined": return { type: "undefined" }
      case "string": return { type: "string", value }
      case "boolean": return { type: "boolean", value }
      case "number": return { type: "number", value: number(value) }
      case "bigint": return { type: "bigint", value: String(value) }
      case "symbol": return { type: "symbol" }
      case "function": return { type: "function" }
    }
    if (value === null) return { type: "null" }
    const type = kindOf(value)
    switch (type) {
      case "date": {
        const time = apply(getTime, value, [])
        return { type, value: time !== time ? "Invalid Date" : apply(toISOString, value, []) }
      }
      case "regexp": return { type, value: { pattern: value.source, flags: value.flags } }
      case "node":
        nodes.push(value)
        return { type, nodeIndex: nodes.length - 1, value: describe(value) }
      case "array":
      case "set":
      case "nodelist":
      case "htmlcollection":
      case "map":
      case "object":
        break
      default:
        return { type }
    }
    // A cycle, or a value nested too deep, is reported by its type alone
    if (seen.has(value) || depth >= 64) return { type }
    seen.add(value)
    try {
      const items = []
      switch (type) {
        case "array":
        case "nodelist":
        case "htmlcollection":
          for (let i = 0; i < value.length; i++) items.push(serialize(value[i], seen, nodes, depth + 1))
          break
        case "set":
          each(apply(setValues, value, []), setIteratorNext, (item) => items.push(serialize(item, seen, nodes, depth + 1)))
          break
        case "map":
          each(apply(mapEntries, value, []), mapIteratorNext, (entry) =>
            items.push([
              typeof entry[0] === "string" ? entry[0] : serialize(entry[0], seen, nodes, depth + 1),
              serialize(entry[1], seen, nodes, depth + 1)
            ]))
          break
        default: {
          const keys = ownKeys(value)
          for (let i = 0; i < keys.length; i++) items.push([keys[i], serialize(value[keys[i]], seen, nodes, depth + 1)])
        }
      }
      return { type, value: items }
    } finally {
      seen.delete(value)
    }
  }

  const deserialize = ${Argument.decoder}

  const encode = (value) => {
    const nodes = []
    const serialized = serialize(value, new SetType(), nodes, 0)
    const id = nodes.length === 0 ? 0 : ++batchId
    if (id !== 0) batches.set(id, nodes)
    return stringify({ batch: id, value: serialized })
  }

  return {
    run(fn, kinds, args, mode, awaitResult) {
      const values = []
      for (let i = 0; i < args.length; i++) values.push(kinds[i] === "v" ? deserialize(args[i]) : args[i])
      const result = apply(fn, undefined, values)
      const finish = (value) => mode === "value" ? encode(value) : value
      return awaitResult ? apply(then, resolve(result), [finish]) : finish(result)
    },
    takeNodes(id) {
      const nodes = batches.get(id) || []
      batches.delete(id)
      return nodes
    },
    stage(key, index, text) {
      let parts = staged.get(key)
      if (parts === undefined) staged.set(key, parts = [])
      parts[index] = text
    },
    compile(key) {
      const parts = staged.get(key) || []
      staged.delete(key)
      const text = apply(trim, apply(join, parts, [""]), [])
      const fn = compile("(" + text + ")")
      if (typeof fn !== "function" || apply(functionSource, fn, []) !== text) {
        throw new ErrorType(
          "The page replaced eval before Strider's helper was installed, so a function too large for one inspector message can't be compiled there"
        )
      }
      return fn
    }
  }
})()`

/**
 * The function declaration that runs `fn` through the helper, called on the helper with the argument kinds
 * (`"v"` for a value, `"h"` for a handle) first and the arguments after.
 */
export const call = (fn: string, mode: "value" | "handle", awaitResult: boolean): string =>
  `((fn) => function(kinds, ...args) { return this.run(fn, kinds, args, ${
    JSON.stringify(mode)
  }, ${awaitResult}) })((${fn}))`

/**
 * The function declaration that runs `fn` through the helper, called on another object with the helper first, the
 * argument kinds next and the arguments after: its result joins that object's group (Q132).
 */
export const callBeside = (fn: string, mode: "value" | "handle", awaitResult: boolean): string =>
  `((fn) => function(helper, kinds, ...args) { return helper.run(fn, kinds, args, ${
    JSON.stringify(mode)
  }, ${awaitResult}) })((${fn}))`

/** The function declaration that takes a batch of nodes, as an array. */
export const takeNodes = "function(id) { return this.takeNodes(id) }"

/** The most bytes a part's text takes in a message once JSON-encoded twice, half of libsoup's 128 KiB limit. */
const partBytes = 64 * 1024

/** The most bytes a declaration takes once JSON-encoded twice and still goes in one message, as it is. */
const wholeBytes = 96 * 1024

/**
 * What a UTF-16 code unit outside a surrogate pair takes once JSON-encoded twice: a quote or backslash becomes
 * four bytes (`\\\"`), a control character three or seven (`\\n`, `\\u0001`), a lone surrogate seven, and any other its
 * UTF-8 bytes.
 */
const encodedBytes = (code: number): number => {
  if (code === 0x22 || code === 0x5c) return 4
  if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) return 3
  if (code < 0x20) return 7
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code >= 0xd800 && code < 0xe000) return 7
  return 3
}

/**
 * A function declaration's parts, for the helper to stage (`stage`) when it is too large to send in one message,
 * or `undefined` when it isn't. The attached inspector carries a page's command as a JSON string inside
 * `Target.sendMessageToTarget`, so a declaration is JSON-encoded twice, and libsoup closes a socket whose incoming
 * message is over 128 KiB. A declaration that takes at most 96 KiB once encoded goes in one message, so the page's
 * own `eval` never compiles it; a larger one is staged in parts of at most 64 KiB each, never splitting a surrogate
 * pair.
 */
export const parts = (fn: string): ReadonlyArray<string> | undefined => {
  // At most seven bytes a code unit: a declaration this short fits without measuring it
  if (fn.length * 7 <= wholeBytes) return undefined
  const found: Array<string> = []
  let start = 0
  let bytes = 0
  let total = 0
  for (let i = 0; i < fn.length;) {
    const code = fn.charCodeAt(i)
    const next = fn.charCodeAt(i + 1)
    const pair = code >= 0xd800 && code < 0xdc00 && next >= 0xdc00 && next < 0xe000
    const cost = pair ? 4 : encodedBytes(code)
    if (bytes + cost > partBytes) {
      found.push(fn.slice(start, i))
      start = i
      bytes = 0
    }
    bytes += cost
    total += cost
    i += pair ? 2 : 1
  }
  found.push(fn.slice(start))
  return total <= wholeBytes ? undefined : found
}

/** The function declaration that stages a part of a function, called on the helper with its key, index and text. */
export const stage = "function(key, index, text) { this.stage(key, index, text) }"

/** As `call`, for a function staged in parts, called with its key before the argument kinds. */
export const callStaged = (mode: "value" | "handle", awaitResult: boolean): string =>
  `function(key, kinds, ...args) { return this.run(this.compile(key), kinds, args, ${
    JSON.stringify(mode)
  }, ${awaitResult}) }`

/** As `callBeside`, for a function staged in parts, called with the helper, then its key, before the kinds. */
export const callStagedBeside = (mode: "value" | "handle", awaitResult: boolean): string =>
  `function(helper, key, kinds, ...args) { return helper.run(helper.compile(key), kinds, args, ${
    JSON.stringify(mode)
  }, ${awaitResult}) }`
