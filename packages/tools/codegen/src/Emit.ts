/**
 * Emits one TypeScript module per protocol domain from the model, plus the coverage report.
 *
 * Policy (PROTOCOL.md, Code generation):
 * - each type is a hand-emitted interface plus a codec cast to it, so the compiler never infers types from
 *   schema generics; codecs that reference other shapes are wrapped in `Schema.suspend`, which also makes
 *   cycles between domains safe;
 * - every top-level call is `/*#__PURE__*\/`, so unused domains tree-shake;
 * - enums are open in both directions: known literals plus a string fallback;
 * - experimental members are optional;
 * - deprecated items are excluded, unless an emitted shape still references them;
 * - commands and events are data: a method, codecs and traits.
 *
 * Every spec item is emitted, excluded or approximated, with a reason, in the coverage report.
 */
import type { Member, ProtocolModel, Shape, Traits, TypeExpr } from "./Model.ts"
import { splitId } from "./Model.ts"

export interface Source {
  /** Where the spec came from, for the generated header. */
  readonly description: string
  /** The output directory under `packages/browser/src`, which also keys brands: `cdp`, `bidi-protocol`, `webkit-protocol`. */
  readonly output: string
  /** The protocol's directory under `packages/tools/codegen/protocols`, where its model is corrected. */
  readonly directory: string
}

export type Verdict =
  | { readonly item: string; readonly verdict: "excluded"; readonly reason: "deprecated" }
  | { readonly item: string; readonly verdict: "kept"; readonly reason: "deprecated-but-referenced" }
  | { readonly item: string; readonly verdict: "approximated"; readonly reason: "any" | "untyped-object" }

export interface Coverage {
  readonly revision: string
  readonly counts: {
    readonly domains: number
    readonly types: number
    readonly commands: number
    readonly events: number
    readonly excluded: number
    readonly approximated: number
  }
  readonly entries: ReadonlyArray<Verdict>
}

export interface Emitted {
  /** Module file name (`Page.ts`) to source. */
  readonly modules: ReadonlyMap<string, string>
  readonly coverage: Coverage
}

const reserved = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield"
])

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** `Page#navigate.Params` → `NavigateParams`; `Page#Frame.adFrameStatus` → `FrameAdFrameStatus`. */
const localName = (id: string) => splitId(id)[1].split(".").map(cap).join("")

const isDeprecated = (traits: Traits) => traits.status === "deprecated"

// WebKit: the build flags an item is compiled under, in its JSDoc's first paragraph
const onlyWhere = (traits: Traits, description: string) =>
  traits.condition === undefined
    ? description
    : `${description.trimEnd()} Only in builds compiled with \`${traits.condition}\`.`

const refsOf = (type: TypeExpr): ReadonlyArray<string> => {
  switch (type._tag) {
    case "Ref":
      return [type.shape]
    case "List":
      return refsOf(type.items)
    case "Map":
      return refsOf(type.values)
    case "Union":
      return type.members.flatMap(refsOf)
    case "Tuple":
      return type.items.flatMap(refsOf)
    default:
      return []
  }
}

const jsdoc = (indent: string, lines: ReadonlyArray<string>) => {
  // `*/` would end the comment, and CDP's descriptions mention CSS at-rules (`@media`) that read as tags
  const body = lines.flatMap((line) => line.split("\n")).map((line) =>
    line.startsWith("@") && /^@(stability|category|since|deprecated) /.test(line)
      ? line
      : line.replaceAll("*/", "*\\/").replace(/(^|[\s(`"'])@(?=[\w-])/g, "$1\\@")
  )
  return `${indent}/**\n${
    body.map((line) => line === "" ? `${indent} *` : `${indent} * ${line}`).join("\n")
  }\n${indent} */\n`
}

export const emit = (model: ProtocolModel, source: Source): Emitted => {
  const shapes = model.shapes
  const domainOf = (id: string) => splitId(id)[0]
  const statusOf = (id: string, traits: Traits): Traits["status"] => {
    const domain = model.domains[domainOf(id)]
    return domain !== undefined && isDeprecated(domain.traits) ? "deprecated" : traits.status
  }
  const entries: Array<Verdict> = []

  // ── What is emitted: everything not deprecated, plus deprecated shapes something emitted still references ──
  const roots = Object.entries(shapes)
    .filter(([id, shape]) =>
      !id.slice(id.indexOf("#") + 1).includes(".") && statusOf(id, shape.traits) !== "deprecated"
    )
    .map(([id]) => id)
  const emitted = new Set<string>()
  const membersOf = (shape: Shape): ReadonlyArray<readonly [string, Member]> =>
    shape._tag === "Struct" ? Object.entries(shape.members).filter(([, member]) => !isDeprecated(member.traits)) : []
  const visit = (id: string) => {
    if (emitted.has(id)) return
    const shape = shapes[id]
    if (shape === undefined) throw new Error(`Missing shape ${id}`)
    emitted.add(id)
    const next: Array<string> = []
    switch (shape._tag) {
      case "Command":
        if (shape.params !== null) next.push(shape.params)
        if (shape.result !== null) next.push(shape.result)
        break
      case "Event":
        if (shape.params !== null) next.push(shape.params)
        break
      case "Struct":
        for (const [, member] of membersOf(shape)) next.push(...refsOf(member.type))
        break
      case "Alias":
        next.push(...refsOf(shape.type))
        break
    }
    next.forEach(visit)
  }
  roots.forEach(visit)

  for (const [id, shape] of Object.entries(shapes)) {
    const deprecated = statusOf(id, shape.traits) === "deprecated"
    if (deprecated && !emitted.has(id)) entries.push({ item: id, verdict: "excluded", reason: "deprecated" })
    if (deprecated && emitted.has(id)) entries.push({ item: id, verdict: "kept", reason: "deprecated-but-referenced" })
    if (shape._tag === "Struct") {
      for (const [name, member] of Object.entries(shape.members)) {
        const item = `${id}:${name}`
        if (isDeprecated(member.traits)) entries.push({ item, verdict: "excluded", reason: "deprecated" })
      }
    }
  }

  // ── Names: unique within each domain ──
  const names = new Map<string, string>()
  const byDomain = new Map<string, Array<string>>()
  for (const id of [...emitted].sort()) {
    const domain = domainOf(id)
    const shape = shapes[id]!
    const spelled = shape._tag === "Command" || shape._tag === "Event" ? splitId(id)[1] : localName(id)
    // A reserved word can't name a const: BiDi's `session.new` becomes `new_`
    const name = reserved.has(spelled) ? `${spelled}_` : spelled
    const taken = byDomain.get(domain) ?? []
    if (taken.some((other) => names.get(other) === name)) throw new Error(`${id}: name ${name} is taken in ${domain}`)
    names.set(id, name)
    byDomain.set(domain, [...taken, id])
  }

  /**
   * The order a union's members are tried in when decoding: the spec's, except that a member typing a field
   * loosely (BiDi's `log.GenericLogEntry`, `type: text`) goes after the members that fix that field to a
   * literal, so it doesn't decode their values and drop their fields.
   */
  const decodeOrder = (members: ReadonlyArray<TypeExpr>): ReadonlyArray<TypeExpr> => {
    const structOf = (member: TypeExpr) => member._tag === "Ref" ? shapes[member.shape] : undefined
    const literalKeys = new Set<string>()
    for (const member of members) {
      const shape = structOf(member)
      if (shape?._tag !== "Struct") continue
      for (const [key, field] of Object.entries(shape.members)) if (field.type._tag === "Literal") literalKeys.add(key)
    }
    const loose = (member: TypeExpr) => {
      const shape = structOf(member)
      return shape?._tag === "Struct" &&
        Object.entries(shape.members).some(([key, field]) => literalKeys.has(key) && field.type._tag !== "Literal")
    }
    return [...members.filter((member) => !loose(member)), ...members.filter(loose)]
  }

  const modules = new Map<string, string>()
  for (const [domain, ids] of [...byDomain].sort(([a], [b]) => a < b ? -1 : 1)) {
    // Import names never collide with the module's own (CDP's SmartCardEmulation has a type named `Protocol`)
    const locals = new Set(ids.map((id) => names.get(id)!))
    const alias = (name: string) => {
      let candidate = name
      while (locals.has(candidate)) candidate += "_"
      return candidate
    }
    const $Schema = alias("Schema")
    const $Brand = alias("Brand")
    const $Redacted = alias("Redacted")
    const $Protocol = alias("Protocol")
    const valueImports = new Set<string>()
    const typeImports = new Set<string>()
    let usesBrand = false
    let usesRedacted = false
    let usesProtocol = false

    const nameOf = (id: string, asType: boolean) => {
      const owner = domainOf(id)
      const name = names.get(id)
      if (name === undefined) throw new Error(`${id} is referenced but not emitted`)
      if (owner === domain) return name
      ;(asType ? typeImports : valueImports).add(owner)
      return `${alias(cap(owner))}.${name}`
    }
    const typeOf = (type: TypeExpr, item: string): string => {
      switch (type._tag) {
        case "Ref":
          return nameOf(type.shape, true)
        case "Scalar":
          if (type.scalar === "unknown") entries.push({ item, verdict: "approximated", reason: "any" })
          return type.scalar === "integer" ? "number" : type.scalar
        case "List":
          return `ReadonlyArray<${typeOf(type.items, item)}>`
        case "Record":
          entries.push({ item, verdict: "approximated", reason: "untyped-object" })
          return "{ readonly [key: string]: unknown }"
        case "Literal":
          return JSON.stringify(type.value)
        case "Union":
          return type.members.map((member) => {
            const text = typeOf(member, item)
            return member._tag === "Union" ? `(${text})` : text
          }).join(" | ")
        case "Tuple":
          return `readonly [${type.items.map((member) => typeOf(member, item)).join(", ")}]`
        case "Map":
          return `{ readonly [key: string]: ${typeOf(type.values, item)} }`
      }
    }
    const codecOf = (type: TypeExpr): string => {
      switch (type._tag) {
        case "Ref":
          return nameOf(type.shape, false)
        case "Scalar":
          return `${$Schema}.${
            { string: "String", integer: "Int", number: "Number", boolean: "Boolean", unknown: "Unknown" }[type.scalar]
          }`
        case "List":
          return `${$Schema}.Array(${codecOf(type.items)})`
        case "Record":
          return `${$Schema}.Record(${$Schema}.String, ${$Schema}.Unknown)`
        case "Literal":
          return type.value === null ? `${$Schema}.Null` : `${$Schema}.Literal(${JSON.stringify(type.value)})`
        case "Union":
          return `${$Schema}.Union([${decodeOrder(type.members).map(codecOf).join(", ")}])`
        case "Tuple":
          return `${$Schema}.Tuple([${type.items.map(codecOf).join(", ")}])`
        case "Map":
          return `${$Schema}.Record(${$Schema}.String, ${codecOf(type.values)})`
      }
    }
    const stability = (traits: Traits) => {
      const domainTraits = model.domains[domain]!.traits
      return traits.status === "experimental" || domainTraits.status === "experimental" ? "experimental" : "unstable"
    }
    const tags = (id: string, traits: Traits, category: string) => [
      ...(statusOf(id, traits) === "deprecated"
        ? ["", "@deprecated Kept because an emitted shape still references it."]
        : [""]),
      `@stability ${stability(traits)}`,
      `@category ${category}`,
      "@since 0.1.0"
    ]
    const describe = (traits: Traits, fallback: string) => onlyWhere(traits, traits.description ?? fallback)

    const types: Array<string> = []
    const commands: Array<string> = []
    const events: Array<string> = []
    for (const id of ids) {
      const shape = shapes[id]!
      const name = names.get(id)!
      switch (shape._tag) {
        case "Enum": {
          types.push(
            jsdoc("", [describe(shape.traits, `\`${splitId(id)[1]}\` values.`), ...tags(id, shape.traits, "models")]) +
              `export type ${name} =\n${
                shape.values.map((value) => `  | ${JSON.stringify(value)}`).join("\n")
              }\n  | (string & {})\n\n` +
              jsdoc("", [
                `Schema for \`${name}\`: known values, and any other string.`,
                ...tags(id, shape.traits, "schemas")
              ]) +
              `export const ${name} = ${$Schema}.String as any as ${$Schema}.Codec<${name}>\n`
          )
          break
        }
        case "Alias": {
          const id_ = shape.traits.id === true
          const scalar = shape.type._tag === "Scalar" ? shape.type.scalar : undefined
          let type: string
          let codec: string
          if (id_) {
            if (scalar !== "string" && scalar !== "integer") {
              throw new Error(`${id}: only string and integer ids are branded`)
            }
            usesBrand = true
            const key = `~@usestrider/browser/${source.output}/${cap(domain)}/${name}`
            type = `${$Brand}.Branded<${scalar === "integer" ? "number" : "string"}, ${JSON.stringify(key)}>`
            codec = `/*#__PURE__*/ ${$Schema}.${
              scalar === "integer" ? "Int" : "String"
            }.pipe(/*#__PURE__*/ ${$Schema}.brand(${JSON.stringify(key)}))`
          } else {
            type = typeOf(shape.type, id)
            codec = shape.type._tag === "Scalar" || shape.type._tag === "Record" || shape.type._tag === "Literal"
              ? codecOf(shape.type)
              : `/*#__PURE__*/ ${$Schema}.suspend(() => ${codecOf(shape.type)})`
          }
          types.push(
            jsdoc("", [describe(shape.traits, `\`${splitId(id)[1]}\`.`), ...tags(id, shape.traits, "models")]) +
              `export type ${name} = ${type}\n\n` +
              jsdoc("", [`Schema for \`${name}\`.`, ...tags(id, shape.traits, "schemas")]) +
              `export const ${name} = ${codec} as any as ${$Schema}.Codec<${name}>\n`
          )
          break
        }
        case "Struct": {
          const members = membersOf(shape)
          const fields = members.map(([member, spec]) => {
            const optional = spec.optional || spec.traits.status === "experimental"
            const sensitive = spec.traits.sensitive === true
            if (sensitive) usesRedacted = true
            const inner = typeOf(spec.type, `${id}:${member}`)
            const type = sensitive ? `${$Redacted}.Redacted<${inner}>` : inner
            const codec = sensitive ? `${$Schema}.RedactedFromValue(${codecOf(spec.type)})` : codecOf(spec.type)
            const doc = spec.traits.description === undefined ? "" : jsdoc("  ", [spec.traits.description])
            const key = /^[A-Za-z_$][\w$]*$/.test(member) ? member : JSON.stringify(member)
            return {
              type: `${doc}  readonly ${key}${optional ? "?" : ""}: ${type}${optional ? " | undefined" : ""}`,
              codec: `    ${key}: ${optional ? `${$Schema}.optional(${codec})` : codec}`
            }
          })
          const identifier = `${domain}.${name}`
          types.push(
            jsdoc("", [describe(shape.traits, `\`${splitId(id)[1]}\`.`), ...tags(id, shape.traits, "models")]) +
              `export interface ${name} {\n${fields.map((field) => field.type).join("\n")}\n}\n\n` +
              jsdoc("", [`Schema for \`${name}\`.`, ...tags(id, shape.traits, "schemas")]) +
              `export const ${name} = /*#__PURE__*/ ${$Schema}.suspend(() =>\n  ${$Schema}.Struct({\n${
                fields.map((field) => field.codec).join(",\n")
              }\n  }).annotate({ identifier: ${JSON.stringify(identifier)} })\n) as any as ${$Schema}.Codec<${name}>\n`
          )
          break
        }
        case "Command": {
          usesProtocol = true
          const params = shape.params === null ? undefined : names.get(shape.params)
          const result = shape.result === null ? undefined : names.get(shape.result)
          commands.push(
            jsdoc("", [describe(shape.traits, `Sends \`${shape.method}\`.`), ...tags(id, shape.traits, "commands")]) +
              `export const ${name}: ${$Protocol}.CommandDef<${JSON.stringify(shape.method)}, ${params ?? "void"}, ${
                result ?? "void"
              }> = /*#__PURE__*/ ${$Protocol}.command(\n  ${JSON.stringify(shape.method)},\n  ${
                params ?? "undefined"
              },\n  ${result ?? "undefined"},\n  ${traitsLiteral(shape.traits)}\n)\n`
          )
          break
        }
        case "Event": {
          usesProtocol = true
          const params = shape.params === null ? undefined : names.get(shape.params)
          events.push(
            jsdoc("", [describe(shape.traits, `The \`${shape.method}\` event.`), ...tags(id, shape.traits, "events")]) +
              `export const ${name}: ${$Protocol}.EventDef<${JSON.stringify(shape.method)}, ${
                params ?? "void"
              }> = /*#__PURE__*/ ${$Protocol}.event(\n  ${JSON.stringify(shape.method)},\n  ${
                params ?? "undefined"
              },\n  ${traitsLiteral(shape.traits)}\n)\n`
          )
          break
        }
      }
    }

    const domainTraits = model.domains[domain]!.traits
    const imports = [
      ...(usesBrand ? [`import type * as ${$Brand} from "effect/Brand"`] : []),
      ...(usesRedacted ? [`import type * as ${$Redacted} from "effect/Redacted"`] : []),
      `import * as ${$Schema} from "effect/Schema"`,
      ...(usesProtocol ? [`import * as ${$Protocol} from "../protocol/Protocol.ts"`] : []),
      ...[...valueImports].sort().map((other) => `import * as ${alias(cap(other))} from "./${cap(other)}.ts"`),
      ...[...typeImports].filter((other) => !valueImports.has(other)).sort().map((other) =>
        `import type * as ${alias(cap(other))} from "./${cap(other)}.ts"`
      )
    ]
    const header = jsdoc("", [
      onlyWhere(
        domainTraits,
        domainTraits.description ?? `The ${domain} ${model.backend === "bidi" ? "module" : "domain"}.`
      ),
      "",
      `Generated from ${source.description}. Don't edit: correct the model (\`packages/tools/codegen/protocols/${source.directory}\`) and run \`pnpm codegen:protocol\`.`,
      "",
      `@stability ${domainTraits.status === "experimental" ? "experimental" : "unstable"}`,
      "@since 0.1.0"
    ])
    modules.set(
      `${cap(domain)}.ts`,
      `${header}${imports.join("\n")}\n\n${[...types, ...commands, ...events].join("\n")}`
    )
  }

  const count = (tag: Shape["_tag"]) =>
    [...emitted].filter((id) => shapes[id]!._tag === tag && !splitId(id)[1].includes(".")).length
  const unique = [...new Map(entries.map((entry) => [`${entry.item}|${entry.verdict}`, entry])).values()]
    .sort((a, b) => a.item < b.item ? -1 : a.item > b.item ? 1 : 0)
  return {
    modules,
    coverage: {
      revision: model.revision,
      counts: {
        domains: modules.size,
        types: count("Struct") + count("Enum") + count("Alias"),
        commands: count("Command"),
        events: count("Event"),
        excluded: unique.filter((entry) => entry.verdict === "excluded").length,
        approximated: unique.filter((entry) => entry.verdict === "approximated").length
      },
      entries: unique
    }
  }
}

const traitsLiteral = (traits: Traits) => {
  const fields: Array<string> = [`status: ${JSON.stringify(traits.status)}`]
  if (traits.session !== undefined) fields.push(`session: ${JSON.stringify(traits.session)}`)
  if (traits.compensation !== undefined) fields.push(`compensation: ${JSON.stringify(traits.compensation)}`)
  if (traits.createsResource === true) fields.push("createsResource: true")
  if (traits.release !== undefined) {
    fields.push(
      `release: [${
        traits.release.map((release) =>
          `{ method: ${JSON.stringify(release.method)}, param: ${JSON.stringify(release.param)}, from: ${
            JSON.stringify(release.from)
          }${release.list === true ? ", list: true" : ""} }`
        ).join(", ")
      }]`
    )
  }
  if (traits.redirect !== undefined) fields.push(`redirect: ${JSON.stringify(traits.redirect)}`)
  return `{ ${fields.join(", ")} }`
}
