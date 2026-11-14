/**
 * Keyboard layouts: the strokes that type a character on each layout, from CLDR's data.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Keys from "../src/internal/keys.ts"
import * as Reason from "../src/Reason.ts"

const summary = (strokes: ReadonlyArray<Keys.Stroke> | undefined) =>
  strokes?.map(({ altGraph, definition, shift }) =>
    `${definition.key}:${definition.code}${shift ? "+Shift" : ""}${altGraph ? "+AltGr" : ""}`
  )

describe("Keys.strokes", () => {
  it("types a character with the key and modifiers its layout types it with", () => {
    assert.deepStrictEqual(summary(Keys.strokes("A", "us")), ["A:KeyA+Shift"])
    assert.deepStrictEqual(summary(Keys.strokes("z", "de")), ["z:KeyY"])
    assert.deepStrictEqual(summary(Keys.strokes("@", "de")), ["@:KeyQ+AltGr"])
    assert.deepStrictEqual(summary(Keys.strokes("a", "fr")), ["a:KeyQ"])
    assert.deepStrictEqual(summary(Keys.strokes("1", "fr")), ["1:Digit1+Shift"])
    assert.deepStrictEqual(summary(Keys.strokes("£", "uk")), ["£:Digit3+Shift"])
    assert.deepStrictEqual(summary(Keys.strokes("€", "uk")), ["€:Digit4+AltGr"])
  })

  it("types what only a dead key reaches as the dead key, then the other key", () => {
    assert.deepStrictEqual(summary(Keys.strokes("ê", "fr")), ["Dead:BracketLeft", "ê:KeyE"])
    assert.deepStrictEqual(summary(Keys.strokes("^", "de")), ["Dead:Backquote", "^:Space"])
    assert.deepStrictEqual(summary(Keys.strokes("á", "es")), ["Dead:Quote", "á:KeyA"])
  })

  it("types a character the layout lacks as a key of its own, and a named key the same everywhere", () => {
    assert.deepStrictEqual(summary(Keys.strokes("é", "us")), ["é:"])
    assert.deepStrictEqual(summary(Keys.strokes("\n", "de")), ["Enter:Enter"])
    assert.deepStrictEqual(summary(Keys.strokes("ArrowDown", "fr")), ["ArrowDown:ArrowDown"])
    assert.isUndefined(Keys.strokes("NotAKey", "us"))
  })

  it("turns a key with Shift as its layout does", () => {
    assert.strictEqual(Keys.withShift(Keys.definition("7", "de")!, "de").key, "/")
    assert.strictEqual(Keys.withShift(Keys.definition("7", "us")!, "us").key, "&")
    assert.strictEqual(Keys.withShift(Keys.definition("Enter", "us")!, "us").key, "Enter")
  })
})

describe("Keys.chord", () => {
  it("reads every part of a Modifier+Key chord but the last as a modifier held for the key", () => {
    assert.deepStrictEqual(Keys.chord("Meta+k"), { key: "k", modifiers: ["Meta"] })
    assert.deepStrictEqual(Keys.chord("Control+Shift+P"), { key: "P", modifiers: ["Control", "Shift"] })
    assert.deepStrictEqual(Keys.chord("Enter"), { key: "Enter", modifiers: [] })
    assert.deepStrictEqual(Keys.chord("Shift"), { key: "Shift", modifiers: [] })
  })

  it("reads a + with nothing before it as the key", () => {
    assert.deepStrictEqual(Keys.chord("+"), { key: "+", modifiers: [] })
    assert.deepStrictEqual(Keys.chord("Shift++"), { key: "+", modifiers: ["Shift"] })
    assert.deepStrictEqual(Keys.chord("Alt+Meta++"), { key: "+", modifiers: ["Alt", "Meta"] })
  })

  it("refuses a part that isn't a modifier, naming the four", () => {
    for (
      const [text, part] of [["Ctrl+k", "Ctrl"], ["ControlOrMeta+k", "ControlOrMeta"], ["Shift+a+b", "a"]] as const
    ) {
      const refused = Keys.chord(text)
      assert.instanceOf(refused, Reason.InvalidInput, text)
      const { message } = refused as Reason.InvalidInput
      assert.include(message, "Alt, Control, Meta, or Shift")
      assert.include(message, JSON.stringify(part))
    }
  })
})
