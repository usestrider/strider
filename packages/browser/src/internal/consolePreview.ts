/**
 * A console argument's text, previewed from what the browser sends with the message, as its devtools print it:
 * `[1, 2, 3]`, `{a: 1}`, `[empty, 1, empty x 2, 2]`, `Map(1) {'k' => 1}`, `div#d.c`, `Window`. Inside a preview, a
 * string is quoted and an object reads as its class (`[Array(2), Object]`). CDP and WebKit send a remote object with
 * a preview of its first properties; BiDi sends the value serialized. Nothing here asks the browser for more.
 */

/** A property in an object's preview, as CDP and WebKit give one; WebKit nests an object's own preview. */
export interface PreviewProperty {
  readonly name: string
  readonly type: string
  readonly subtype?: string | undefined
  readonly value?: string | undefined
  readonly valuePreview?: Preview | undefined
}

/** A map's or set's entry in a preview. */
export interface PreviewEntry {
  readonly key?: Preview | undefined
  readonly value: Preview
}

/** An object's preview, as CDP and WebKit give one. */
export interface Preview {
  readonly type: string
  readonly subtype?: string | undefined
  readonly description?: string | undefined
  readonly overflow?: boolean | undefined
  readonly properties?: ReadonlyArray<PreviewProperty> | undefined
  readonly entries?: ReadonlyArray<PreviewEntry> | undefined
  /** WebKit's length of an array, or size of a map or set, which CDP puts in the description. */
  readonly size?: number | undefined
}

/** A console argument as CDP and WebKit describe one: a `Runtime.RemoteObject`. */
export interface Remote {
  readonly type: string
  readonly subtype?: string | undefined
  readonly className?: string | undefined
  readonly value?: unknown
  readonly unserializableValue?: string | undefined
  readonly description?: string | undefined
  readonly preview?: Preview | undefined
  readonly size?: number | undefined
}

/** A console argument as BiDi serializes one: a `script.RemoteValue`. */
export interface Serialized {
  readonly type: string
  readonly value?: unknown
}

/** How many of an array's items, and of an object's properties or a collection's entries, a BiDi preview shows. */
const items = 100
const properties = 5

const quote = (text: string) => `'${text}'`

/** `Array(2)` from WebKit's `Array` and its length, which CDP's description already has. */
const sized = (text: string, size: number | undefined) =>
  size === undefined || /\(\d+\)$/.test(text) ? text : `${text}(${size})`

const sizeOf = (description: string | undefined, size: number | undefined) =>
  size ?? (description === undefined ? undefined : Number(/\((\d+)\)$/.exec(description)?.[1] ?? Number.NaN))

/** An element as `div#d.c`; another node as its name (`#text`, `#document`). WebKit describes an element as markup. */
const nodeName = (description: string): string => {
  const markup = /^<([^\s>]+)([^>]*)>$/.exec(description)
  if (markup !== null) {
    const id = /\bid="([^"]*)"/.exec(markup[2]!)?.[1]
    const classes = /\bclass="([^"]*)"/.exec(markup[2]!)?.[1]
    return element(markup[1]!, id, classes)
  }
  return description.startsWith("#") ? description.split(" ")[0]! : description
}

const element = (name: string, id: string | undefined, classes: string | undefined) =>
  name + (id === undefined || id === "" ? "" : `#${id}`) +
  (classes ?? "").split(/\s+/).filter((each) => each !== "").map((each) => `.${each}`).join("")

const holes = (count: number) => count === 1 ? ["empty"] : count > 1 ? [`empty x ${count}`] : []

/** A value inside a preview: a string quoted, an object as its class. */
const nested = (property: PreviewProperty): string => {
  if (property.type === "string") return quote(property.value ?? "")
  if (property.type === "function") return "Function"
  if (property.type !== "object") return property.value ?? property.type
  if (property.subtype === "null") return "null"
  const text = property.value ?? property.valuePreview?.description ?? "Object"
  if (property.subtype === "array") return sized(text, property.valuePreview?.size)
  return property.subtype === "node" ? nodeName(text) : text
}

/** A map's or set's key or value, which CDP and WebKit give as a preview of its own. */
const entry = (preview: Preview): string =>
  preview.type === "string"
    ? quote(preview.description ?? "")
    : preview.type === "function"
    ? "Function"
    : preview.subtype === "array"
    ? sized(preview.description ?? "Array", preview.size)
    : preview.subtype === "null"
    ? "null"
    : preview.description ?? preview.type

const array = (preview: Preview, length: number | undefined): string => {
  const indexed = (preview.properties ?? [])
    .map((property) => ({ index: Number(property.name), property }))
    .filter(({ index }) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a.index - b.index)
  const tokens: Array<string> = []
  let last = -1
  for (const { index, property } of indexed) {
    tokens.push(...holes(index - last - 1), nested(property))
    last = index
  }
  if (preview.overflow === true) tokens.push("…")
  else if (length !== undefined && !Number.isNaN(length)) tokens.push(...holes(length - last - 1))
  return `[${tokens.join(", ")}]`
}

const braces = (tokens: ReadonlyArray<string>, overflow: boolean) =>
  `{${[...tokens, ...(overflow ? ["…"] : [])].join(", ")}}`

/** A CDP or WebKit argument's text. */
export const remote = (value: Remote): string => {
  switch (value.type) {
    case "string":
      return String(value.value)
    case "undefined":
      return "undefined"
    case "number":
      // WebKit sends -0 as the value 0, described as `-0`
      return value.unserializableValue ?? value.description ?? String(value.value)
    case "object":
      break
    default:
      return value.unserializableValue ??
        (value.value !== undefined ? String(value.value) : value.description ?? value.type)
  }
  if (value.subtype === "null") return "null"
  const description = value.description ?? value.className ?? "Object"
  const preview = value.preview
  if (value.subtype === "node") return nodeName(description)
  if (preview === undefined) return description
  if (value.subtype === "array") return array(preview, sizeOf(description, value.size ?? preview.size))
  if (value.subtype === "map" || value.subtype === "set") {
    const name = sized(description, value.size ?? preview.size)
    const tokens = (preview.entries ?? []).map((each) =>
      each.key === undefined ? entry(each.value) : `${entry(each.key)} => ${entry(each.value)}`
    )
    return `${name} ${braces(tokens, preview.overflow === true)}`
  }
  if (value.className === "Object" && value.subtype === undefined) {
    return braces(
      (preview.properties ?? []).map((property) => `${property.name}: ${nested(property)}`),
      preview.overflow === true
    )
  }
  return description
}

/** BiDi's types that serialize with no value, or a value a preview doesn't show, as their class. */
const classes: Record<string, string> = {
  symbol: "Symbol",
  function: "Function",
  weakmap: "WeakMap",
  weakset: "WeakSet",
  generator: "Generator",
  error: "Error",
  proxy: "Proxy",
  promise: "Promise",
  typedarray: "TypedArray",
  arraybuffer: "ArrayBuffer",
  nodelist: "NodeList",
  htmlcollection: "HTMLCollection",
  window: "Window"
}

const list = (value: unknown): ReadonlyArray<unknown> => Array.isArray(value) ? value : []

interface NodeProperties {
  readonly nodeType?: number
  readonly localName?: string
  readonly attributes?: Record<string, string>
}

const node = (value: unknown): string => {
  const properties = (typeof value === "object" && value !== null ? value : {}) as NodeProperties
  switch (properties.nodeType) {
    case 1:
      return element(properties.localName ?? "", properties.attributes?.["id"], properties.attributes?.["class"])
    case 3:
      return "#text"
    case 4:
      return "#cdata-section"
    case 8:
      return "#comment"
    case 9:
      return "#document"
    case 11:
      return "#document-fragment"
    default:
      return "Node"
  }
}

/** A serialized key, which BiDi gives as a string for an object's own and as a value for a map's. */
const keyOf = (key: unknown, inner: (value: Serialized) => string, string: (key: string) => string = String) =>
  typeof key === "string" ? string(key) : inner(key as Serialized)

/** A serialized value inside a preview: a string quoted, an object as its class. */
const inside = (value: Serialized): string => {
  switch (value.type) {
    case "string":
      return quote(String(value.value))
    case "array":
      return value.value === undefined ? "Array" : `Array(${list(value.value).length})`
    case "object":
      return "Object"
    case "map":
    case "set":
      return value.value === undefined ? classes[value.type] ?? value.type : collection(value)
    default:
      return serialized(value) ?? "Error"
  }
}

const collection = (value: Serialized) => `${value.type === "map" ? "Map" : "Set"}(${list(value.value).length})`

/**
 * A BiDi argument's text, or `undefined` for an `Error`, whose serialization carries neither its name nor its
 * message, so the browser's own text says more.
 */
export const serialized = (value: Serialized): string | undefined => {
  switch (value.type) {
    case "undefined":
    case "null":
      return value.type
    case "string":
    case "number":
    case "boolean":
      return String(value.value)
    case "bigint":
      return `${String(value.value)}n`
    case "error":
      return undefined
    case "node":
      return node(value.value)
    case "date":
      return String(value.value)
    case "regexp": {
      const { flags, pattern } = value.value as { readonly pattern: string; readonly flags?: string }
      return `/${pattern}/${flags ?? ""}`
    }
    case "array": {
      const all = list(value.value) as ReadonlyArray<Serialized>
      const tokens = all.slice(0, items).map(inside)
      return `[${[...tokens, ...(all.length > items ? ["…"] : [])].join(", ")}]`
    }
    case "object": {
      const all = list(value.value) as ReadonlyArray<readonly [unknown, Serialized]>
      return braces(
        all.slice(0, properties).map(([key, item]) => `${keyOf(key, inside)}: ${inside(item)}`),
        all.length > properties
      )
    }
    case "map":
    case "set": {
      const all = list(value.value)
      const tokens = all.slice(0, properties).map((each) =>
        value.type === "map"
          ? `${keyOf((each as readonly [unknown, Serialized])[0], inside, quote)} => ${
            inside((each as readonly [unknown, Serialized])[1])
          }`
          : inside(each as Serialized)
      )
      return `${collection(value)} ${braces(tokens, all.length > properties)}`
    }
    default:
      return classes[value.type] ?? value.type
  }
}
