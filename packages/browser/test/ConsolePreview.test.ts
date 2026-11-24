/**
 * A console argument's text, previewed from what the browser sends with the message.
 */
import { assert, describe, it } from "@effect/vitest"
import * as ConsolePreview from "../src/internal/consolePreview.ts"

const number = (value: string): ConsolePreview.PreviewProperty => ({ name: "", type: "number", value })

describe("ConsolePreview.remote", () => {
  it("renders primitives as the console prints them", () => {
    assert.strictEqual(ConsolePreview.remote({ type: "string", value: "str" }), "str")
    assert.strictEqual(ConsolePreview.remote({ type: "undefined" }), "undefined")
    assert.strictEqual(ConsolePreview.remote({ type: "object", subtype: "null", value: null }), "null")
    // CDP sends -0 as unserializable, WebKit as 0 described as -0
    assert.strictEqual(ConsolePreview.remote({ type: "number", unserializableValue: "-0" }), "-0")
    assert.strictEqual(ConsolePreview.remote({ type: "number", value: 0, description: "-0" }), "-0")
    assert.strictEqual(ConsolePreview.remote({ type: "bigint", description: "1n" }), "1n")
  })

  it("renders a sparse array's holes, trailing ones included, and an overflow", () => {
    const properties = [{ ...number("2"), name: "10" }, { ...number("1"), name: "1" }]
    assert.strictEqual(
      ConsolePreview.remote({
        type: "object",
        subtype: "array",
        className: "Array",
        description: "Array(13)",
        preview: { type: "object", subtype: "array", overflow: false, properties }
      }),
      "[empty, 1, empty x 8, 2, empty x 2]"
    )
    // WebKit says the length in `size`
    assert.strictEqual(
      ConsolePreview.remote({
        type: "object",
        subtype: "array",
        description: "Array",
        size: 3,
        preview: { type: "object", overflow: true, properties: [{ ...number("1"), name: "0" }] }
      }),
      "[1, …]"
    )
  })

  it("renders a plain object's properties, nested values by their class, and others by their description", () => {
    const preview: ConsolePreview.Preview = {
      type: "object",
      overflow: true,
      properties: [
        { name: "s", type: "string", value: "x" },
        { name: "f", type: "function", value: "" },
        {
          name: "a",
          type: "object",
          subtype: "array",
          valuePreview: { type: "object", description: "Array", size: 2 }
        },
        { name: "n", type: "object", subtype: "node", value: "<div id=\"d\" class=\"c e\">" }
      ]
    }
    assert.strictEqual(
      ConsolePreview.remote({ type: "object", className: "Object", description: "Object", preview }),
      "{s: 'x', f: Function, a: Array(2), n: div#d.c.e, …}"
    )
    assert.strictEqual(
      ConsolePreview.remote({ type: "object", className: "Foo", description: "Foo", preview }),
      "Foo"
    )
    assert.strictEqual(
      ConsolePreview.remote({ type: "object", subtype: "node", description: "#text \"t\"" }),
      "#text"
    )
  })
})

describe("ConsolePreview.serialized", () => {
  it("renders BiDi's values as CDP's previews read", () => {
    assert.strictEqual(
      ConsolePreview.serialized({
        type: "object",
        value: [["a", { type: "array", value: [] }], ["b", { type: "string", value: "x" }]]
      }),
      "{a: Array(0), b: 'x'}"
    )
    assert.strictEqual(
      ConsolePreview.serialized({ type: "map", value: [["k", { type: "number", value: 1 }]] }),
      "Map(1) {'k' => 1}"
    )
    assert.strictEqual(ConsolePreview.serialized({ type: "bigint", value: "1" }), "1n")
    assert.strictEqual(ConsolePreview.serialized({ type: "window", value: { context: "1" } }), "Window")
    assert.strictEqual(
      ConsolePreview.serialized({
        type: "node",
        value: { nodeType: 1, localName: "div", attributes: { id: "d", class: "c" } }
      }),
      "div#d.c"
    )
    assert.strictEqual(
      ConsolePreview.serialized({
        type: "array",
        value: Array.from({ length: 101 }, () => ({ type: "number", value: 1 }))
      })?.endsWith("1, 1, …]"),
      true
    )
  })

  it("has no text for an Error, which BiDi serializes without its message", () => {
    assert.strictEqual(ConsolePreview.serialized({ type: "error", value: {} }), undefined)
  })
})
