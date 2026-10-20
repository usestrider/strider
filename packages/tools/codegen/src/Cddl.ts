/**
 * Parses WebDriver BiDi's CDDL (RFC 8610) into the protocol model.
 *
 * Only the subset the spec uses is accepted, and anything else fails the parse rather than being guessed at:
 * rules naming a type or a group; maps, arrays and parenthesized groups; type choices (`/`) and group choices
 * (`//`); occurrences (`?`, `*`, `+`); bareword, literal and `=>` keys; literals and ranges; and the control
 * operators the spec writes (`.default`, `.ge`, `.gt`, `.le`, `.lt`), which constrain values the model doesn't
 * check.
 *
 * Into the model:
 * - a group with `method: "module.name"` and `params` is a command (in `remote.cddl`) or an event (in
 *   `local.cddl`); a command's result is the rule named after it with `Result` appended;
 * - a map is a struct; a map whose group has choices is a union of structs; a group included in a map is
 *   flattened into it, optional if included with `?`;
 * - a choice of string literals is an enum, open like CDP's; a single literal stays exact, since unions are told
 *   apart by such literals (`type: "window"`);
 * - `{* text => T}` is a map with string keys; an `Extensible` entry is noted as the struct's `extensible` trait.
 *
 * A name with a dot is `module.Name`, so its shape is `module#Name`; one without is in the `common` module.
 */
import type { Member, ProtocolModel, Scalar, Shape, Traits, TypeExpr } from "./Model.ts"
import { sorted } from "./Model.ts"

// ── Syntax ──────────────────────────────────────────────────────────────────────────────────────────────

type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "number"; readonly value: number; readonly text: string }
  | { readonly kind: "control"; readonly text: string }
  | { readonly kind: "punct"; readonly text: string }

export type CType =
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null; readonly decimal?: true }
  | { readonly kind: "choice"; readonly options: ReadonlyArray<CType> }
  | { readonly kind: "map"; readonly group: CGroup }
  | { readonly kind: "array"; readonly group: CGroup }
  | { readonly kind: "range"; readonly integer: boolean }
  | { readonly kind: "group"; readonly group: CGroup }

export interface CEntry {
  readonly occur: "" | "?" | "*" | "+"
  /** A bareword or literal key, or a type for `=>`, or none for an entry that is only a type or group. */
  readonly key:
    | { readonly kind: "name"; readonly name: string }
    | { readonly kind: "type"; readonly type: CType }
    | undefined
  readonly type: CType
}

/** A group: its choices (`//`), each a sequence of entries. */
export interface CGroup {
  readonly choices: ReadonlyArray<ReadonlyArray<CEntry>>
}

const tokenize = (source: string, file: string): Array<Token> => {
  const tokens: Array<Token> = []
  let i = 0
  const fail = (message: string) => {
    const line = source.slice(0, i).split("\n").length
    throw new Error(`${file}:${line}: ${message}`)
  }
  while (i < source.length) {
    const c = source[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === ";") {
      while (i < source.length && source[i] !== "\n") i++
      continue
    }
    if (c === "\"") {
      const end = source.indexOf("\"", i + 1)
      if (end < 0) fail("unterminated string")
      tokens.push({ kind: "string", text: source.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(i, i + 32))
    if (number !== null && (c !== "-" || /\d/.test(source[i + 1] ?? ""))) {
      tokens.push({ kind: "number", value: Number(number[0]), text: number[0] })
      i += number[0].length
      continue
    }
    if (c === "." && source[i + 1] === ".") {
      tokens.push({ kind: "punct", text: source[i + 2] === "." ? "..." : ".." })
      i += source[i + 2] === "." ? 3 : 2
      continue
    }
    if (c === "." && /[a-z]/.test(source[i + 1] ?? "")) {
      const control = /^\.[a-z]+/.exec(source.slice(i))![0]
      tokens.push({ kind: "control", text: control })
      i += control.length
      continue
    }
    const word = /^[A-Za-z_$@][\w.$@-]*/.exec(source.slice(i))
    if (word !== null) {
      // A trailing dot belongs to no name
      const text = word[0].replace(/\.+$/, "")
      tokens.push({ kind: "word", text })
      i += text.length
      continue
    }
    const punct = ["//", "=>", "=", "(", ")", "{", "}", "[", "]", ",", ":", "/", "?", "*", "+"].find((punct) =>
      source.startsWith(punct, i)
    )
    if (punct === undefined) fail(`unexpected ${JSON.stringify(c)}`)
    tokens.push({ kind: "punct", text: punct! })
    i += punct!.length
  }
  return tokens
}

/** Parses a CDDL document into its rules, in order. */
export const parseRules = (source: string, file: string): ReadonlyArray<readonly [name: string, type: CType]> => {
  const tokens = tokenize(source, file)
  let i = 0
  const peek = (offset = 0) => tokens[i + offset]
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message} at token ${i} (${JSON.stringify(peek()?.text)})`)
  }
  const isPunct = (text: string, offset = 0) => {
    const token = peek(offset)
    return token?.kind === "punct" && token.text === text
  }
  const expect = (text: string) => {
    if (!isPunct(text)) fail(`expected ${text}`)
    i++
  }

  const parseType = (): CType => {
    const options = [parseType1()]
    while (isPunct("/")) {
      i++
      options.push(parseType1())
    }
    return options.length === 1 ? options[0]! : { kind: "choice", options }
  }

  const parseType1 = (): CType => {
    let type = parseType2()
    if (isPunct("..") || isPunct("...")) {
      i++
      const to = parseType2()
      const integer = (value: CType) => value.kind === "literal" ? value.decimal !== true : true
      type = { kind: "range", integer: integer(type) && integer(to) }
    }
    while (peek()?.kind === "control") {
      i++
      parseType2()
    }
    return type
  }

  const parseType2 = (): CType => {
    const token = peek()
    if (token === undefined) return fail("unexpected end")
    if (token.kind === "string") {
      i++
      return { kind: "literal", value: token.text }
    }
    if (token.kind === "number") {
      i++
      return token.text.includes(".")
        ? { kind: "literal", value: token.value, decimal: true }
        : { kind: "literal", value: token.value }
    }
    if (token.kind === "word") {
      i++
      if (token.text === "true" || token.text === "false") return { kind: "literal", value: token.text === "true" }
      if (token.text === "null" || token.text === "nil") return { kind: "literal", value: null }
      return { kind: "name", name: token.text }
    }
    if (isPunct("(")) {
      i++
      const group = parseGroup(")")
      expect(")")
      const only = group.choices.length === 1 && group.choices[0]!.length === 1 ? group.choices[0]![0]! : undefined
      return only !== undefined && only.key === undefined && only.occur === "" ? only.type : { kind: "group", group }
    }
    if (isPunct("{")) {
      i++
      const group = parseGroup("}")
      expect("}")
      return { kind: "map", group }
    }
    if (isPunct("[")) {
      i++
      const group = parseGroup("]")
      expect("]")
      return { kind: "array", group }
    }
    return fail("expected a type")
  }

  const parseGroup = (close: string): CGroup => {
    const choices: Array<Array<CEntry>> = [[]]
    while (!isPunct(close)) {
      if (isPunct("//")) {
        i++
        choices.push([])
        continue
      }
      if (isPunct(",")) {
        i++
        continue
      }
      choices.at(-1)!.push(parseEntry())
    }
    return { choices }
  }

  const parseEntry = (): CEntry => {
    let occur: CEntry["occur"] = ""
    if (isPunct("?") || isPunct("*") || isPunct("+")) {
      occur = peek()!.text as CEntry["occur"]
      i++
    } else if (peek()?.kind === "number" && isPunct("*", 1)) {
      // `1*` means one or more; the model only knows "some"
      i += 2
      occur = "*"
    }
    const token = peek()
    if ((token?.kind === "word" || token?.kind === "string") && isPunct(":", 1)) {
      i += 2
      return { occur, key: { kind: "name", name: token.text }, type: parseType() }
    }
    const type = parseType()
    if (isPunct("=>")) {
      i++
      return { occur, key: { kind: "type", type }, type: parseType() }
    }
    return { occur, key: undefined, type }
  }

  const rules: Array<readonly [string, CType]> = []
  while (i < tokens.length) {
    const name = peek()
    if (name?.kind !== "word") fail("expected a rule name")
    i++
    expect("=")
    rules.push([name!.text, parseType()])
  }
  return rules
}

// ── Into the model ──────────────────────────────────────────────────────────────────────────────────────

const builtins: Readonly<Record<string, TypeExpr>> = {
  text: { _tag: "Scalar", scalar: "string" },
  tstr: { _tag: "Scalar", scalar: "string" },
  bytes: { _tag: "Scalar", scalar: "string" },
  bool: { _tag: "Scalar", scalar: "boolean" },
  float: { _tag: "Scalar", scalar: "number" },
  number: { _tag: "Scalar", scalar: "number" },
  int: { _tag: "Scalar", scalar: "integer" },
  uint: { _tag: "Scalar", scalar: "integer" },
  "js-int": { _tag: "Scalar", scalar: "integer" },
  "js-uint": { _tag: "Scalar", scalar: "integer" },
  any: { _tag: "Scalar", scalar: "unknown" }
}

/** Rules that describe the envelope, which the wire handles, not the model. */
const envelope = new Set([
  "Command",
  "CommandData",
  "CommandResponse",
  "ErrorResponse",
  "Message",
  "ResultData",
  "Event",
  "EventData",
  "Extensible",
  "EmptyParams",
  "EmptyResult",
  "js-int",
  "js-uint"
])

const shapeId = (name: string): string => {
  const dot = name.indexOf(".")
  return dot < 0 ? `common#${name}` : `${name.slice(0, dot)}#${name.slice(dot + 1)}`
}

const traits: Traits = { status: "stable" }

/** One CDDL source: its rules, and whether it is what clients send (`remote`) or browsers send (`local`). */
export interface CddlSource {
  readonly file: string
  readonly side: "remote" | "local"
  readonly text: string
}

/**
 * Parses the BiDi CDDL into one model. Shared rules appear in both sources; their definitions must agree.
 */
export const parse = (revision: string, sources: ReadonlyArray<CddlSource>): ProtocolModel => {
  const rules = new Map<string, CType>()
  const sides = new Map<string, Set<CddlSource["side"]>>()
  for (const source of sources) {
    for (const [name, type] of parseRules(source.text, source.file)) {
      const known = rules.get(name)
      if (known !== undefined && JSON.stringify(known) !== JSON.stringify(type)) {
        throw new Error(`${source.file}: ${name} is defined differently in another source`)
      }
      rules.set(name, type)
      const set = sides.get(name) ?? new Set()
      set.add(source.side)
      sides.set(name, set)
    }
  }

  const shapes: Record<string, Shape> = {}
  const add = (id: string, shape: Shape) => {
    if (id in shapes) throw new Error(`Duplicate shape ${id}`)
    shapes[id] = shape
  }

  // The method and params of a command or event group, if it is one.
  const messageOf = (type: CType) => {
    if (type.kind !== "group" || type.group.choices.length !== 1) return undefined
    const entries = type.group.choices[0]!
    const method = entries.find((entry) => entry.key?.kind === "name" && entry.key.name === "method")
    const params = entries.find((entry) => entry.key?.kind === "name" && entry.key.name === "params")
    if (method?.type.kind !== "literal" || typeof method.type.value !== "string" || params === undefined) {
      return undefined
    }
    return { method: method.type.value, params: params.type }
  }

  const isGroupRule = (name: string) => {
    const type = rules.get(name)
    return type?.kind === "group"
  }

  // Flattens a group's sequence into struct members; included groups are spread in.
  const membersOf = (
    owner: string,
    entries: ReadonlyArray<CEntry>,
    optional: boolean
  ): { members: Record<string, Member>; extensible: boolean } => {
    const members: Record<string, Member> = {}
    let extensible = false
    for (const entry of entries) {
      if (entry.key?.kind === "name") {
        members[entry.key.name] = {
          type: typeOf(entry.type, `${owner}.${entry.key.name}`),
          optional: optional || entry.occur === "?" || entry.occur === "*",
          traits
        }
        continue
      }
      if (entry.key?.kind === "type") {
        if (
          entry.key.type.kind === "name" && entry.key.type.name === "text" && entry.type.kind === "name" &&
          entry.type.name === "any"
        ) {
          extensible = true
          continue
        }
        throw new Error(`${owner}: a map entry with a computed key, inside a struct`)
      }
      if (entry.type.kind === "name" && entry.type.name === "Extensible") {
        extensible = true
        continue
      }
      if (entry.type.kind === "name" && isGroupRule(entry.type.name)) {
        const included = rules.get(entry.type.name)!
        if (included.kind !== "group" || included.group.choices.length !== 1) {
          throw new Error(`${owner}: includes ${entry.type.name}, which has choices`)
        }
        const flattened = membersOf(owner, included.group.choices[0]!, optional || entry.occur === "?")
        Object.assign(members, flattened.members)
        extensible ||= flattened.extensible
        continue
      }
      throw new Error(`${owner}: an entry with no key that isn't a group: ${JSON.stringify(entry.type)}`)
    }
    return { members, extensible }
  }

  const structOf = (id: string, entries: ReadonlyArray<CEntry>): string => {
    const { members, extensible } = membersOf(id, entries, false)
    add(id, { _tag: "Struct", members, traits: extensible ? { ...traits, extensible: true } : traits })
    return id
  }

  // The ways a sequence can be spelled out: an included group with choices, inline or named, multiplies them.
  // Each alternative records the included groups it chose, to name it by.
  const alternatives = (
    entries: ReadonlyArray<CEntry>
  ): Array<{ readonly entries: Array<CEntry>; readonly chosen: Array<string> }> => {
    let result: Array<{ entries: Array<CEntry>; chosen: Array<string> }> = [{ entries: [], chosen: [] }]
    for (const entry of entries) {
      // An inline group is always spliced in; a named one only when it has choices to distribute, since a
      // single-choice one is flattened by `membersOf`, which keeps its `?`
      const included = entry.key === undefined
        ? entry.type.kind === "group"
          ? { group: entry.type.group, name: undefined }
          : entry.type.kind === "name" && isGroupRule(entry.type.name) &&
              (rules.get(entry.type.name) as { group: CGroup }).group.choices.length > 1
          ? { group: (rules.get(entry.type.name) as { group: CGroup }).group, name: entry.type.name }
          : undefined
        : undefined
      if (included === undefined) {
        result = result.map((alternative) => ({ entries: [...alternative.entries, entry], chosen: alternative.chosen }))
        continue
      }
      const optional = (choice: ReadonlyArray<CEntry>) =>
        entry.occur === "?"
          ? choice.map((inner): CEntry => ({ ...inner, occur: inner.occur === "" ? "?" : inner.occur }))
          : choice
      result = result.flatMap((alternative) =>
        included.group.choices.flatMap((choice) => {
          const only = choice.length === 1 ? choice[0]! : undefined
          const name = only?.key === undefined && only?.type.kind === "name" ? only.type.name : included.name
          return alternatives(optional(choice)).map((inner) => ({
            entries: [...alternative.entries, ...inner.entries],
            chosen: [...alternative.chosen, ...(name === undefined ? [] : [name]), ...inner.chosen]
          }))
        })
      )
    }
    return result
  }

  // A map: one struct, or a union of structs, one per way its group can be spelled out.
  const mapOf = (id: string, group: CGroup): TypeExpr => {
    if (group.choices.length === 1) {
      const entries = group.choices[0]!
      const only = entries.length === 1 ? entries[0]! : undefined
      if (only?.key?.kind === "type" && only.occur === "*") {
        const isAny = only.key.type.kind === "name" && only.key.type.name === "text" && only.type.kind === "name" &&
          only.type.name === "any"
        return isAny ? { _tag: "Record" } : { _tag: "Map", values: typeOf(only.type, `${id}.Value`) }
      }
    }
    const cases = group.choices.flatMap((choice) => {
      // A choice that is only an included group is named by it
      const only = choice.length === 1 && choice[0]!.key === undefined && choice[0]!.type.kind === "name"
        ? (choice[0]!.type as { name: string }).name
        : undefined
      return alternatives(choice).map((alternative) => ({
        entries: alternative.entries,
        chosen: alternative.chosen.length === 0 && only !== undefined ? [only] : alternative.chosen,
        alone: choice.length === 1
      }))
    })
    if (cases.length === 1) return { _tag: "Ref", shape: structOf(id, cases[0]!.entries) }
    return {
      _tag: "Union",
      members: cases.map((alternative, index) => {
        // A case that is one included group and nothing else takes that group's name
        const named = alternative.chosen.length === 1 ? alternative.chosen[0]! : undefined
        const name = named !== undefined && alternative.alone
          ? shapeId(named)
          : named !== undefined
          ? `${id}.${named.slice(named.indexOf(".") + 1)}`
          : `${id}.Case${index + 1}`
        if (name in shapes) return { _tag: "Ref", shape: name } as TypeExpr
        return { _tag: "Ref", shape: structOf(name, alternative.entries) } as TypeExpr
      })
    }
  }

  const typeOf = (type: CType, owner: string): TypeExpr => {
    switch (type.kind) {
      case "name": {
        const builtin = builtins[type.name]
        if (builtin !== undefined) return builtin
        if (type.name === "Extensible") throw new Error(`${owner}: Extensible used as a type`)
        if (type.name === "EmptyResult" || type.name === "EmptyParams") return { _tag: "Record" }
        if (!rules.has(type.name)) throw new Error(`${owner}: ${type.name} isn't defined`)
        if (isGroupRule(type.name)) throw new Error(`${owner}: ${type.name} is a group, used as a type`)
        return { _tag: "Ref", shape: shapeId(type.name) }
      }
      case "literal":
        return { _tag: "Literal", value: type.value }
      case "range":
        return { _tag: "Scalar", scalar: type.integer ? "integer" : "number" }
      case "choice": {
        if (type.options.every((option) => option.kind === "literal" && typeof option.value === "string")) {
          add(owner, {
            _tag: "Enum",
            values: type.options.map((option) => (option as { value: string }).value),
            traits
          })
          return { _tag: "Ref", shape: owner }
        }
        return {
          _tag: "Union",
          members: type.options.map((option, index) => typeOf(option, `${owner}.Option${index + 1}`))
        }
      }
      case "map":
        return mapOf(owner, type.group)
      case "array": {
        const entries = type.group.choices.length === 1 ? type.group.choices[0]! : []
        if (entries.length === 1 && (entries[0]!.occur === "*" || entries[0]!.occur === "+")) {
          return { _tag: "List", items: typeOf(entries[0]!.type, `${owner}.Item`) }
        }
        if (entries.every((entry) => entry.occur === "" && entry.key === undefined)) {
          return { _tag: "Tuple", items: entries.map((entry, index) => typeOf(entry.type, `${owner}.${index}`)) }
        }
        throw new Error(`${owner}: an array CDDL this model can't describe`)
      }
      case "group": {
        throw new Error(`${owner}: a group used as a type`)
      }
    }
  }

  const domains = new Set<string>()
  const commands: Array<{ readonly name: string; readonly method: string; readonly params: CType }> = []
  const events: Array<{ readonly method: string; readonly params: CType }> = []

  for (const [name, type] of rules) {
    if (envelope.has(name)) continue
    const message = messageOf(type)
    if (message !== undefined) {
      const side = sides.get(name)!
      if (side.has("remote")) commands.push({ name, ...message })
      else events.push(message)
      continue
    }
    // Module-level unions of commands, results and events, and other groups, are spread where they're used
    if (type.kind === "group") continue
    if (
      type.kind === "choice" &&
      type.options.every((option) => option.kind === "name" && messageOf(rules.get(option.name)!) !== undefined)
    ) {
      continue
    }
    // Each module's union of its commands, results or events (`BrowsingContextCommand`, `LogEvent`)
    if (/Command$|Result$|Event$/.test(name) && name.indexOf(".") < 0) continue
    const id = shapeId(name)
    domains.add(id.slice(0, id.indexOf("#")))
    if (
      type.kind === "choice" &&
      type.options.every((option) => option.kind === "literal" && typeof option.value === "string")
    ) {
      add(id, { _tag: "Enum", values: type.options.map((option) => (option as { value: string }).value), traits })
      continue
    }
    if (type.kind === "map") {
      const shape = mapOf(id, type.group)
      if (shape._tag !== "Ref" || shape.shape !== id) add(id, { _tag: "Alias", type: shape, traits })
      continue
    }
    add(id, { _tag: "Alias", type: typeOf(type, id), traits })
  }

  const paramsOf = (params: CType, owner: string): string | null => {
    if (params.kind === "name" && params.name === "EmptyParams") return null
    if (params.kind === "name") {
      if (!rules.has(params.name)) throw new Error(`${owner}: params ${params.name} isn't defined`)
      return shapeId(params.name)
    }
    const type = typeOf(params, `${owner}.Params`)
    if (type._tag !== "Ref") throw new Error(`${owner}: params that aren't a struct`)
    return type.shape
  }

  for (const command of commands) {
    const [domain, name] = command.method.split(".") as [string, string]
    const id = `${domain}#${name}`
    domains.add(domain)
    const resultName = `${command.name}Result`
    const result = rules.get(resultName)
    if (result === undefined) throw new Error(`${command.method}: no ${resultName}`)
    add(id, {
      _tag: "Command",
      method: command.method,
      params: paramsOf(command.params, id),
      result: result.kind === "name" && result.name === "EmptyResult" ? null : shapeId(resultName),
      traits
    })
  }
  for (const event of events) {
    const [domain, name] = event.method.split(".") as [string, string]
    const id = `${domain}#${name}`
    domains.add(domain)
    add(id, { _tag: "Event", method: event.method, params: paramsOf(event.params, id), traits })
  }

  // Every reference resolves
  const check = (type: TypeExpr, from: string) => {
    switch (type._tag) {
      case "Ref":
        if (!(type.shape in shapes)) throw new Error(`${from}: ${type.shape} doesn't resolve`)
        return
      case "List":
        return check(type.items, from)
      case "Map":
        return check(type.values, from)
      case "Union":
      case "Tuple":
        for (const member of type._tag === "Union" ? type.members : type.items) check(member, from)
        return
      default:
        return
    }
  }
  for (const [id, shape] of Object.entries(shapes)) {
    if (shape._tag === "Struct") { for (const member of Object.values(shape.members)) check(member.type, id) }
    if (shape._tag === "Alias") check(shape.type, id)
    if (shape._tag === "Command") {
      for (const ref of [shape.params, shape.result]) if (ref !== null) check({ _tag: "Ref", shape: ref }, id)
    }
    if (shape._tag === "Event" && shape.params !== null) check({ _tag: "Ref", shape: shape.params }, id)
  }

  return sorted({
    backend: "bidi",
    revision,
    domains: Object.fromEntries([...domains].map((domain) => [domain, { dependencies: [], traits }])),
    shapes
  })
}

export type { Scalar }
