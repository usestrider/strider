/**
 * The WebKit adapter's helper in a realm: an object installed once per realm, through which every evaluation
 * runs, because WebKit can call a function only on an object (`Runtime.callFunctionOn` takes an `objectId`) and
 * serializes values only as JSON.
 *
 * - `run` deserializes the caller's arguments, calls the function, awaits it if asked, and returns the result
 *   either as the value itself (for a handle) or as WebDriver BiDi's `RemoteValue`, as JSON text.
 * - Nodes in a serialized value are kept in a batch the adapter takes next (`takeNodes`), for their object ids:
 *   WebKit's handle on a node is its remote object.
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
  const batches = new Map()
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
    }
  }
})()`

/**
 * The function declaration that runs `fn` through the helper, called on the helper with the argument kinds
 * (`"v"` for a value, `"h"` for a handle) first and the arguments after.
 */
export const call = (fn: string, mode: "value" | "handle", awaitResult: boolean): string =>
  `function(kinds, ...args) { return this.run((${fn}), kinds, args, ${JSON.stringify(mode)}, ${awaitResult}) }`

/**
 * The function declaration that runs `fn` through the helper, called on another object with the helper first, the
 * argument kinds next and the arguments after: its result joins that object's group (Q132).
 */
export const callBeside = (fn: string, mode: "value" | "handle", awaitResult: boolean): string =>
  `function(helper, kinds, ...args) { return helper.run((${fn}), kinds, args, ${
    JSON.stringify(mode)
  }, ${awaitResult}) }`

/** The function declaration that takes a batch of nodes, as an array. */
export const takeNodes = "function(id) { return this.takeNodes(id) }"
