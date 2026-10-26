/**
 * Keys, as UI Events names them (review 16, candidate 3): the named keys from a table of ours, and the characters
 * a keyboard layout types, from Unicode CLDR's (review 22, candidate 6d; `keyboardLayouts.ts`, generated).
 *
 * - **A character** is typed by the key its layout types it with, Shift or AltGr held where the layout says. One
 *   only a dead key reaches is two strokes: the dead key (`key: "Dead"`, no text), then the other key, whose
 *   `key` and text are the character it composes. One the layout lacks, such as `é` on `us`, is a key whose
 *   text is the character and whose `code` is empty, which every backend types (review 16, P3).
 * - **A named key** (`Enter`, `ArrowDown`, `Shift`) is the same on every layout. Anything else isn't a key.
 */
import type * as Keyboard from "../Keyboard.ts"
import * as Layouts from "./keyboardLayouts.ts"

/** One key: its `KeyboardEvent.key`, `code`, and the text it inserts, if any. */
export interface Definition {
  readonly key: string
  readonly code: string
  readonly text: string | undefined
}

/** One stroke of a character: its key, and whether the layout holds Shift or AltGr for it. */
export interface Stroke {
  readonly definition: Definition
  readonly shift: boolean
  readonly altGraph: boolean
}

const named = new Map<string, Definition>()

const add = (key: string, code: string, text: string | undefined) => named.set(key, { key, code, text })

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
add("AltGraph", "AltRight", undefined)

/** Each layout's Shift: the character the same key types with Shift held, by the key's code. */
const shifted = new Map<Keyboard.Layout, ReadonlyMap<string, string>>(
  (Object.keys(Layouts.layouts) as Array<Keyboard.Layout>).map((layout) => [
    layout,
    new Map(
      Object.entries(Layouts.layouts[layout].keys)
        .filter(([, [, modifiers]]) => modifiers === "S")
        .map(([character, [code]]) => [code, character])
    )
  ])
)

/** A key's definition on a layout: a named key, or a character's own key; `undefined` for what isn't a key. */
export const definition = (key: string, layout: Keyboard.Layout = "us"): Definition | undefined => {
  const known = named.get(key)
  if (known !== undefined) return known
  if (Array.from(key).length !== 1) return undefined
  const tables = Layouts.layouts[layout]
  return { key, code: tables.keys[key]?.[0] ?? tables.dead[key]?.[0] ?? "", text: key }
}

/** The key Shift makes of this one on a layout, such as `A` for `a`; itself when Shift changes nothing. */
export const withShift = (definition: Definition, layout: Keyboard.Layout = "us"): Definition => {
  const character = shifted.get(layout)!.get(definition.code)
  return character === undefined || named.has(definition.key)
    ? definition
    : { key: character, code: definition.code, text: character }
}

const stroke = (key: string, code: string, modifiers: Layouts.Modifiers, text: string | undefined): Stroke => ({
  definition: { key, code, text },
  shift: modifiers.includes("S"),
  altGraph: modifiers.includes("G")
})

/**
 * The strokes that type a key or a character on a layout: `\n` and `\r` are Enter, and `\t` is Tab;
 * `undefined` for what isn't a key.
 */
export const strokes = (key: string, layout: Keyboard.Layout): ReadonlyArray<Stroke> | undefined => {
  const name = key === "\n" || key === "\r" ? "Enter" : key === "\t" ? "Tab" : key
  const known = named.get(name)
  if (known !== undefined) return [{ definition: known, shift: false, altGraph: false }]
  if (Array.from(key).length !== 1) return undefined
  const tables = Layouts.layouts[layout]
  const typed = tables.keys[key]
  if (typed !== undefined) return [stroke(key, typed[0], typed[1], key)]
  const composed = tables.composed[key]
  if (composed !== undefined) {
    const dead = tables.dead[composed[0]]!
    const other = tables.keys[composed[1]]!
    return [stroke("Dead", dead[0], dead[1], undefined), stroke(key, other[0], other[1], key)]
  }
  return [{ definition: { key, code: "", text: key }, shift: false, altGraph: false }]
}

/** A modifier's key. */
export const modifier = (name: Keyboard.Modifier): Definition => named.get(name)!

/** AltGr's key: not a modifier flag, since Windows makes it Control with Alt, which would make a key a shortcut. */
export const altGraph: Definition = named.get("AltGraph")!

/** Whether a key is a modifier, and which. */
export const modifierOf = (key: string): Keyboard.Modifier | undefined =>
  key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" ? key : undefined
