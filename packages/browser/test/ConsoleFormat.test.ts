/**
 * A console call's text from its arguments, as the Console Standard's formatter makes it (QUIRKS.md, Q33).
 */
import { assert, describe, it } from "@effect/vitest"
import * as ConsoleFormat from "../src/internal/consoleFormat.ts"

const string = (text: string): ConsoleFormat.Argument => ({ text, value: text, string: true })
const number = (value: number): ConsoleFormat.Argument => ({ text: String(value), value, string: false })
const object = (text: string): ConsoleFormat.Argument => ({ text, value: undefined, string: false })

describe("ConsoleFormat.format", () => {
  it("joins arguments with spaces when the first isn't a format", () => {
    assert.strictEqual(ConsoleFormat.format([]), "")
    assert.strictEqual(ConsoleFormat.format([string("plain")]), "plain")
    assert.strictEqual(ConsoleFormat.format([number(1), string("two"), object("Object")]), "1 two Object")
  })

  it("takes an argument for each specifier, and appends the rest", () => {
    assert.strictEqual(
      ConsoleFormat.format([string("%s has %d items at %f"), string("cart"), number(3.7), number(1.25)]),
      "cart has 3 items at 1.25"
    )
    assert.strictEqual(
      ConsoleFormat.format([string("%o and"), object("Array(2)"), string("more")]),
      "Array(2) and more"
    )
    assert.strictEqual(ConsoleFormat.format([string("%i"), string("42px")]), "42")
    assert.strictEqual(ConsoleFormat.format([string("%d"), object("Object")]), "NaN")
  })

  it("drops styling, and leaves a specifier with nothing left to take", () => {
    assert.strictEqual(ConsoleFormat.format([string("%cstyled"), string("color: red")]), "styled")
    assert.strictEqual(ConsoleFormat.format([string("%s and %s"), string("one")]), "one and %s")
  })
})
