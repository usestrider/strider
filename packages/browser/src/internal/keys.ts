/**
 * Keys, as UI Events names them (review 16, candidate 3): each key value's `code` and the text it inserts, for
 * the US layout, from a table of ours. A single character the table lacks, such as `é`, is a key whose text is
 * the character, which every backend types (review 16, P3). Anything else isn't a key.
 */
import type * as Keyboard from "../Keyboard.ts"

/** One key: its `KeyboardEvent.key`, `code`, and the text it inserts, if any. */
export interface Definition {
  readonly key: string
  readonly code: string
  readonly text: string | undefined
}

const table = new Map<string, Definition>()
/** A key's value with Shift held: `a` is `A`, `1` is `!`. */
const shifted = new Map<string, string>()

const add = (key: string, code: string, text: string | undefined) => table.set(key, { key, code, text })

for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  const upper = letter.toUpperCase()
  add(letter, `Key${upper}`, letter)
  add(upper, `Key${upper}`, upper)
  shifted.set(letter, upper)
}
for (const [index, symbol] of Array.from(")!@#$%^&*(").entries()) {
  add(String(index), `Digit${index}`, String(index))
  add(symbol, `Digit${index}`, symbol)
  shifted.set(String(index), symbol)
}
for (
  const [plain, symbol, code] of [
    ["`", "~", "Backquote"],
    ["-", "_", "Minus"],
    ["=", "+", "Equal"],
    ["[", "{", "BracketLeft"],
    ["]", "}", "BracketRight"],
    ["\\", "|", "Backslash"],
    [";", ":", "Semicolon"],
    ["'", "\"", "Quote"],
    [",", "<", "Comma"],
    [".", ">", "Period"],
    ["/", "?", "Slash"]
  ] as const
) {
  add(plain, code, plain)
  add(symbol, code, symbol)
  shifted.set(plain, symbol)
}
add(" ", "Space", " ")
add("Enter", "Enter", "\r")
for (
  const name of [
    "Tab",
    "Backspace",
    "Delete",
    "Escape",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Insert",
    "CapsLock",
    "ContextMenu",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12"
  ]
) {
  add(name, name, undefined)
}
add("Shift", "ShiftLeft", undefined)
add("Control", "ControlLeft", undefined)
add("Alt", "AltLeft", undefined)
add("Meta", "MetaLeft", undefined)

/** A key's definition; `undefined` for what isn't a key. */
export const definition = (key: string): Definition | undefined => {
  const known = table.get(key)
  if (known !== undefined) return known
  return Array.from(key).length === 1 ? { key, code: "", text: key } : undefined
}

/** The key Shift makes of this one, such as `A` for `a`; itself when Shift changes nothing. */
export const withShift = (definition: Definition): Definition => {
  const value = shifted.get(definition.key)
  return value === undefined ? definition : table.get(value)!
}

/** The key that types a character: `\n` and `\r` are Enter, `\t` is Tab. */
export const forCharacter = (character: string): Definition =>
  character === "\n" || character === "\r"
    ? table.get("Enter")!
    : character === "\t"
    ? table.get("Tab")!
    : definition(character)!

/** A modifier's key. */
export const modifier = (name: Keyboard.Modifier): Definition => table.get(name)!

/** Whether a key is a modifier, and which. */
export const modifierOf = (key: string): Keyboard.Modifier | undefined =>
  key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" ? key : undefined
