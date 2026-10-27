/**
 * Keyboard layouts from CLDR's legacy XML: the maps read, the escapes, and dead keys.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Keyboards from "../src/Keyboards.ts"

const xml = `<keyboard locale="xx-t-k0-windows">
  <keyMap>
    <map iso="E00" to="^"/> <!-- dead -->
    <map iso="E01" to="1"/>
    <map iso="D03" to="e"/>
    <map iso="D12" to="\\u{1D}"/>
    <map iso="B00" to="&lt;"/>
    <map iso="A03" to=" "/>
  </keyMap>
  <keyMap modifiers="shift">
    <map iso="E01" to="!"/>
    <map iso="E02" to="\\u{22}"/>
  </keyMap>
  <keyMap modifiers="caps">
    <map iso="D03" to="E"/>
  </keyMap>
  <keyMap modifiers="altR+caps? ctrl+alt+caps?">
    <map iso="D03" to="€"/>
    <map iso="E01" to="!"/>
  </keyMap>
  <transforms type="simple">
    <transform from="^e" to="ê"/>
    <transform from="^ " to="^"/>
  </transforms>
</keyboard>`

describe("Keyboards.parse", () => {
  it("reads the base, Shift and AltGr maps, keeping each character's first key", () => {
    const layout = Keyboards.parse(xml)
    assert.deepStrictEqual(Object.fromEntries(layout.keys), {
      "1": ["Digit1", ""],
      "e": ["KeyE", ""],
      "<": ["IntlBackslash", ""],
      " ": ["Space", ""],
      "!": ["Digit1", "S"],
      "\"": ["Digit2", "S"],
      "€": ["KeyE", "G"]
    })
  })

  it("makes a transform's first character a dead key, and composes what no key types", () => {
    const layout = Keyboards.parse(xml)
    assert.deepStrictEqual(Object.fromEntries(layout.dead), { "^": ["Backquote", ""] })
    assert.deepStrictEqual(Object.fromEntries(layout.composed), { "ê": ["^", "e"], "^": ["^", " "] })
  })
})
