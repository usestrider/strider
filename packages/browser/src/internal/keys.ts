/**
 * Keys, as UI Events names them: the named keys from a table of ours, and the characters
 * a keyboard layout types, from Unicode CLDR's (`keyboardLayouts.ts`, generated).
 *
 * - **A character** is typed by the key its layout types it with, Shift or AltGr held where the layout says. One
 *   only a dead key reaches is two strokes: the dead key (`key: "Dead"`, no text), then the other key, whose
 *   `key` and text are the character it composes. One the layout lacks, such as `é` on `us`, is a key whose
 *   text is the character and whose `code` is empty, which every backend types.
 * - **A named key** (`Enter`, `ArrowDown`, `Shift`) is the same on every layout. `Shift`, `Control`, `Alt`, and
 *   `Meta` are the left-hand keys.
 * - **A code** (`ShiftRight`, `Numpad1`, `KeyW`) names a place on the keyboard, as UI Events' `code` does: its `key`
 *   is what the layout types there (`KeyW` types `z` on `fr`), and the numeric keypad types with Num Lock on
 *   (`Numpad1` types `1`). Anything else isn't a key.
 */
import type * as Keyboard from "../Keyboard.ts"
import * as Reason from "../Reason.ts"
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

/** The keys a code names apart from a layout's: each modifier's two sides, the numeric keypad, and the media keys. */
const codes = new Map<string, Definition>()
for (const name of ["Shift", "Control", "Alt", "Meta"]) {
  codes.set(`${name}Left`, named.get(name)!)
  codes.set(`${name}Right`, { key: name, code: `${name}Right`, text: undefined })
}
for (let digit = 0; digit <= 9; digit++) {
  codes.set(`Numpad${digit}`, { key: String(digit), code: `Numpad${digit}`, text: String(digit) })
}
for (
  const [code, character] of [
    ["NumpadAdd", "+"],
    ["NumpadSubtract", "-"],
    ["NumpadMultiply", "*"],
    ["NumpadDivide", "/"],
    ["NumpadDecimal", "."]
  ] as const
) {
  codes.set(code, { key: character, code, text: character })
}
codes.set("NumpadEnter", { key: "Enter", code: "NumpadEnter", text: "\r" })

/** The media keys, whose `key` is their code: what WebDriver and WebKit's Automation have no way to send. */
export const mediaKeys: ReadonlySet<string> = new Set([
  "AudioVolumeMute",
  "AudioVolumeDown",
  "AudioVolumeUp",
  "MediaTrackNext",
  "MediaTrackPrevious",
  "MediaPlayPause"
])
for (const name of mediaKeys) codes.set(name, { key: name, code: name, text: undefined })

/** Every code some layout types on. */
const layoutCodes: ReadonlySet<string> = new Set(
  Object.values(Layouts.layouts).flatMap((tables) =>
    [...Object.values(tables.keys), ...Object.values(tables.dead)].map(([code]) => code)
  )
)

/**
 * Each layout's key at each code: the character it types with no modifier, a dead key, or `Unidentified` where the
 * layout types nothing there unmodified. Built once per layout, so a key held and released is the same definition.
 */
const placed = new Map<Keyboard.Layout, Map<string, Definition>>()

const atCode = (code: string, layout: Keyboard.Layout): Definition | undefined => {
  if (!layoutCodes.has(code)) return undefined
  let table = placed.get(layout)
  if (table === undefined) placed.set(layout, table = new Map())
  const known = table.get(code)
  if (known !== undefined) return known
  const tables = Layouts.layouts[layout]
  const typed = Object.entries(tables.keys).find(([, [at, modifiers]]) => at === code && modifiers === "")?.[0]
  const dead = Object.values(tables.dead).some(([at, modifiers]) => at === code && modifiers === "")
  const definition: Definition = typed !== undefined
    ? { key: typed, code, text: typed }
    : { key: dead ? "Dead" : "Unidentified", code, text: undefined }
  table.set(code, definition)
  return definition
}

/** The key a code names on a layout; `undefined` for what isn't a code. */
const coded = (code: string, layout: Keyboard.Layout): Definition | undefined => codes.get(code) ?? atCode(code, layout)

/**
 * Whether a key names a layout's place whose character, with Shift held or not, a backend that sends characters,
 * not places, would type elsewhere: a code such as `KeyQ` on `fr`, which types `a`, where a US keyboard has `a` on
 * `KeyA`, or `Digit2` with Shift on `de`, which types `"`, on a US keyboard's `Quote`.
 */
export const placedOffUs = (key: string, layout: Keyboard.Layout, shift = false): boolean => {
  if (named.has(key) || codes.has(key)) return false
  const unshifted = atCode(key, layout)
  if (unshifted === undefined) return false
  const here = shift ? withShift(unshifted, layout) : unshifted
  return here.code !== definition(here.key, "us")?.code
}

/** Whether a modifier's other side is held: the left Shift, say, when this is the right. */
export const otherSideHeld = (held: ReadonlyArray<Definition>, key: Definition): boolean =>
  modifierOf(key.key) !== undefined && held.some((each) => each.key === key.key && each.code !== key.code)

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

/**
 * A key's definition on a layout: a named key, a code's key (what the layout types at it), or a character's own key;
 * `undefined` for what isn't a key.
 */
export const definition = (key: string, layout: Keyboard.Layout = "us"): Definition | undefined => {
  const known = named.get(key) ?? coded(key, layout)
  if (known !== undefined) return known
  if (Array.from(key).length !== 1) return undefined
  const tables = Layouts.layouts[layout]
  return { key, code: tables.keys[key]?.[0] ?? tables.dead[key]?.[0] ?? "", text: key }
}

/** The key Shift makes of this one on a layout, such as `A` for `a`; itself when Shift changes nothing. */
export const withShift = (definition: Definition, layout: Keyboard.Layout = "us"): Definition => {
  const character = shifted.get(layout)!.get(definition.code)
  return character === undefined || named.has(definition.key) || codes.has(definition.code)
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
  const known = named.get(name) ?? coded(name, layout)
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

/** A key with modifiers held, as a `Modifier+Key` chord names it. */
export interface Chord {
  readonly key: string
  readonly modifiers: ReadonlyArray<Keyboard.Modifier>
}

/**
 * A `Modifier+Key` chord, such as `Meta+k` or `Control+Shift+P`: every part but the last a modifier, and the last
 * the key. A `+` with nothing before it is the key itself, so `+` and `Shift++` press `+`. A key alone is a chord
 * with no modifiers, and what the key is isn't checked here. A part that isn't a modifier fails as `InvalidInput`.
 */
export const chord = (text: string): Chord | Reason.InvalidInput => {
  const parts: Array<string> = []
  let part = ""
  for (const character of text) {
    if (character === "+" && part !== "") {
      parts.push(part)
      part = ""
    } else {
      part += character
    }
  }
  parts.push(part)
  const key = parts.pop()!
  const modifiers: Array<Keyboard.Modifier> = []
  for (const each of parts) {
    const modifier = modifierOf(each)
    if (modifier === undefined) {
      return new Reason.InvalidInput({
        input: "modifier",
        expected: "Alt, Control, Meta, or Shift",
        hint: `${JSON.stringify(each)} in ${JSON.stringify(text)} isn't a modifier`
      })
    }
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }
  return { key, modifiers }
}
