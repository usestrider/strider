/**
 * What Chromium's adapter sends for a key that the key's name alone doesn't give: its place on the keyboard.
 */
import { assert, describe, it } from "@effect/vitest"
import { keyLocation } from "../src/internal/cdpAdapter/mapping.ts"

describe("keyLocation", () => {
  it("places the left and right modifiers, the numeric keypad, and every other key as standard", () => {
    const codes = ["ShiftLeft", "MetaLeft", "AltRight", "ControlRight", "Numpad7", "NumpadEnter"]
    assert.deepStrictEqual(codes.map(keyLocation), [1, 1, 2, 2, 3, 3])
    const standard = ["KeyA", "BracketLeft", "BracketRight", "ArrowLeft", "ArrowRight", "Space", ""]
    assert.deepStrictEqual(standard.map(keyLocation), [0, 0, 0, 0, 0, 0, 0])
  })
})
