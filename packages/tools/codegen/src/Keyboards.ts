/**
 * Keyboard layouts: CLDR's legacy keyboard XML, read without an XML library, since the
 * format is flat (`keyMap` elements of `map`s, and `transform`s), and emitted as one TypeScript module of tables.
 *
 * - **Keys** are read from four maps: the base, `shift`, AltGr (`altR`, which Windows also reaches with Control
 *   and Alt), and AltGr with Shift. A character takes the first key that types it, in that order. Control
 *   characters, which some maps put on keys, aren't keys.
 * - **Positions** are ISO 9995 names (`E01`, `D06`), written as the UI Events `code` of the key in that place.
 * - **Dead keys** are the characters a two-character transform starts with; such a key types nothing alone, so a
 *   character it composes, its own included (`^` then space is `^`), is the dead key then the other key.
 */

/** The modifiers a key needs: none, Shift, AltGraph, or both. */
export type Modifiers = "" | "S" | "G" | "GS"

export interface Layout {
  readonly keys: ReadonlyMap<string, readonly [code: string, modifiers: Modifiers]>
  readonly dead: ReadonlyMap<string, readonly [code: string, modifiers: Modifiers]>
  readonly composed: ReadonlyMap<string, readonly [dead: string, base: string]>
}

/** Each ISO position's UI Events `code`. */
const codes: Readonly<Record<string, string>> = {
  E00: "Backquote",
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [`E${String(index + 1).padStart(2, "0")}`, `Digit${(index + 1) % 10}`])
  ),
  E11: "Minus",
  E12: "Equal",
  ...Object.fromEntries(
    Array.from("QWERTYUIOP", (letter, index) => [`D${String(index + 1).padStart(2, "0")}`, `Key${letter}`])
  ),
  D11: "BracketLeft",
  D12: "BracketRight",
  D13: "Backslash",
  ...Object.fromEntries(
    Array.from("ASDFGHJKL", (letter, index) => [`C${String(index + 1).padStart(2, "0")}`, `Key${letter}`])
  ),
  C10: "Semicolon",
  C11: "Quote",
  C12: "Backslash",
  B00: "IntlBackslash",
  ...Object.fromEntries(
    Array.from("ZXCVBNM", (letter, index) => [`B${String(index + 1).padStart(2, "0")}`, `Key${letter}`])
  ),
  B08: "Comma",
  B09: "Period",
  B10: "Slash",
  A03: "Space"
}

/** An attribute's value: XML's entities, then CLDR's `\u{…}` escapes. */
const unescape = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")

/** Which of the four maps a `keyMap`'s modifiers name, by its first alternative's required modifiers. */
const mapOf = (modifiers: string | undefined): Modifiers | undefined => {
  if (modifiers === undefined) return ""
  const required = modifiers.split(" ")[0]!.split("+").filter((token) => !token.endsWith("?")).sort().join("+")
  switch (required) {
    case "shift":
      return "S"
    case "altR":
      return "G"
    case "altR+shift":
      return "GS"
    default:
      return undefined
  }
}

const order: ReadonlyArray<Modifiers> = ["", "S", "G", "GS"]

const isControl = (character: string) => {
  const point = character.codePointAt(0)!
  return point < 0x20 || (point >= 0x7f && point < 0xa0)
}

/** A layout from its XML. */
export const parse = (xml: string): Layout => {
  const maps = new Map<Modifiers, Array<readonly [code: string, character: string]>>()
  for (const keyMap of xml.matchAll(/<keyMap(?:\s+modifiers="([^"]*)")?\s*>([\s\S]*?)<\/keyMap>/g)) {
    const which = mapOf(keyMap[1])
    if (which === undefined || maps.has(which)) continue
    const entries: Array<readonly [string, string]> = []
    for (const map of keyMap[2]!.matchAll(/<map\s+iso="([A-E]\d\d)"\s+to="([^"]*)"[^>]*\/>/g)) {
      const code = codes[map[1]!]
      const character = unescape(map[2]!)
      if (code === undefined || Array.from(character).length !== 1 || isControl(character)) continue
      entries.push([code, character])
    }
    maps.set(which, entries)
  }
  const transforms = Array.from(xml.matchAll(/<transform\s+from="([^"]*)"\s+to="([^"]*)"\s*\/>/g), (match) => ({
    from: Array.from(unescape(match[1]!)),
    to: unescape(match[2]!)
  })).filter((transform) => transform.from.length === 2 && Array.from(transform.to).length === 1)
  const deadCharacters = new Set(transforms.map((transform) => transform.from[0]!))
  const keys = new Map<string, readonly [string, Modifiers]>()
  const dead = new Map<string, readonly [string, Modifiers]>()
  for (const modifiers of order) {
    for (const [code, character] of maps.get(modifiers) ?? []) {
      const into = deadCharacters.has(character) ? dead : keys
      if (!into.has(character)) into.set(character, [code, modifiers])
    }
  }
  const composed = new Map<string, readonly [string, string]>()
  for (const { from: [accent, base], to } of transforms) {
    if (keys.has(to) || composed.has(to) || !dead.has(accent!) || !keys.has(base!)) continue
    composed.set(to, [accent!, base!])
  }
  return { keys, dead, composed }
}

/** The generated module: every layout's tables, by Strider's name for it. */
export const emit = (layouts: ReadonlyArray<readonly [name: string, source: string, layout: Layout]>): string => {
  const table = <V>(map: ReadonlyMap<string, V>) =>
    `{ ${Array.from(map, ([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")} }`
  return `/**
 * Keyboard layouts, generated by \`strider-codegen keyboards\` from Unicode CLDR's Windows
 * keyboard data, release 43 (\`packages/tools/codegen/keyboards/source\`, under the Unicode license). Do not edit.
 *
 * For each layout: the key that types each character, as its UI Events \`code\`, with the modifiers held (\`""\`
 * none, \`"S"\` Shift, \`"G"\` AltGraph, \`"GS"\` both); its dead keys, by the accent they type; and the characters
 * a dead key then another key compose.
 */

/** The modifiers a key needs. */
export type Modifiers = "" | "S" | "G" | "GS"

/** One layout's tables. */
export interface Layout {
  readonly keys: Readonly<Record<string, readonly [code: string, modifiers: Modifiers]>>
  readonly dead: Readonly<Record<string, readonly [code: string, modifiers: Modifiers]>>
  readonly composed: Readonly<Record<string, readonly [dead: string, base: string]>>
}

${
    layouts.map(([name, source, layout]) =>
      `/** From \`${source}\`. */
const ${name}: Layout = {
  keys: ${table(layout.keys)},
  dead: ${table(layout.dead)},
  composed: ${table(layout.composed)}
}`
    ).join("\n\n")
  }

/** Every layout, by name. */
export const layouts = { ${layouts.map(([name]) => name).join(", ")} } as const
`
}

/** Strider's layouts, and the CLDR file each comes from. */
export const sources: ReadonlyArray<readonly [name: string, file: string]> = [
  ["us", "en-t-k0-windows.xml"],
  ["uk", "en-GB-t-k0-windows.xml"],
  ["de", "de-t-k0-windows.xml"],
  ["fr", "fr-t-k0-windows.xml"],
  ["es", "es-t-k0-windows.xml"],
  ["it", "it-t-k0-windows.xml"]
]
