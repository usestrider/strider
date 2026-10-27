// What a module's reference page shows, built from the dataset: TypeDoc's JSON gives each declaration's structure,
// signature and source; the JSDoc model gives its prose (summary, **When to use**, **Details**, **Gotchas**),
// examples, `@see` links and import line. A module the JSDoc checker skips (the generated protocol domains) falls
// back on TypeDoc's comments.
import type { CollectionEntry } from "astro:content"
import type { JsdocsApi } from "./dataset.ts"
import { loadJsdocs, loadModule } from "./dataset.ts"
import { layout } from "./doc.ts"
import { signatureHtml } from "./html.ts"
import type { Block, Resolve } from "./markdown.ts"
import { renderBlocks, renderInline } from "./markdown.ts"
import type { Context } from "./signature.ts"
import { declaration, memberDeclaration, sortBySource } from "./signature.ts"
import type { Comment, DisplayPart, ReferenceTarget, Reflection } from "./typedoc.ts"
import { Kind } from "./typedoc.ts"

export type Entry = CollectionEntry<"reference">

export interface Description {
  readonly summary: Array<Block>
  readonly whenToUse: Array<Block>
  readonly details: Array<Block>
  readonly gotchas: Array<Block>
}

export interface DeclarationView {
  /** The fragment it is linked by: `goto`, or `Page.goto` for a member */
  readonly anchor: string
  readonly name: string
  /** `interface`, `const`, `function`, `type`, `class`, `method`, `property` */
  readonly kind: string
  /** Its `@category`: `models`, `schemas`, `tags`, … */
  readonly category: string | undefined
  /** Signatures, as HTML, with their references linked; one per overload */
  readonly signatures: ReadonlyArray<string>
  readonly description: Description
  readonly examples: ReadonlyArray<{ readonly title: string | undefined; readonly code: string }>
  readonly see: ReadonlyArray<string>
  /** Stated only where it differs from the module's */
  readonly stability: string | undefined
  readonly since: string | undefined
  readonly deprecated: string | undefined
  readonly defaultValue: string | undefined
  readonly sourceUrl: string | undefined
  /** The value that shares a type's name: its Schema, or a service's tag */
  readonly companion: DeclarationView | undefined
  readonly members: ReadonlyArray<DeclarationView>
}

export interface CategoryView {
  readonly title: string
  readonly anchor: string
  readonly declarations: ReadonlyArray<DeclarationView>
}

export interface ModuleView {
  readonly name: string
  readonly module: string
  readonly importLine: string | undefined
  readonly summary: Array<Block>
  /** The first paragraph of the summary, for the page's description */
  readonly description: string
  readonly stability: string | undefined
  readonly since: string | undefined
  readonly sourceUrl: string | undefined
  readonly categories: ReadonlyArray<CategoryView>
  readonly count: number
}

/** A module's page: its route, from its package's slug and its export path */
export const routeOf = (entry: Entry) => `/docs/api/${entry.data.slug}/${entry.data.path}`

const isType = (kind: number) => kind === Kind.Interface || kind === Kind.TypeAlias

const kindLabels: Record<number, string> = {
  [Kind.Function]: "function",
  [Kind.Class]: "class",
  [Kind.Interface]: "interface",
  [Kind.TypeAlias]: "type",
  [Kind.Method]: "method",
  [Kind.Property]: "property",
  [Kind.Accessor]: "getter",
  [Kind.Constructor]: "constructor",
  [Kind.Enum]: "enum",
  [Kind.Namespace]: "namespace"
}

// Every exported variable of the packages is a `const`; TypeDoc drops `isConst` from one with a written type
const kindLabel = (reflection: Reflection) =>
  reflection.kind === Kind.Variable ? "const" : kindLabels[reflection.kind] ?? "declaration"

const partsToMarkdown = (parts: ReadonlyArray<DisplayPart> | undefined) =>
  (parts ?? []).map((part) => (part.kind === "inline-tag" ? `\`${part.text}\`` : part.text)).join("")

const tagOf = (comment: Comment | undefined, tag: string) => {
  const found = comment?.blockTags?.find((t) => t.tag === tag)
  return found === undefined ? undefined : partsToMarkdown(found.content).trim()
}

const commentOf = (reflection: Reflection) => reflection.comment ?? reflection.signatures?.[0]?.comment

// A comment the JSDoc model didn't read, such as a member a declaration inherits from a generic, split into the
// sections the model would give: the summary, then each `**When to use**`, `**Details**` and `**Gotchas**`
const splitSections = (markdown: string) => {
  const sections: Record<"summary" | "whenToUse" | "details" | "gotchas", string> = {
    summary: "",
    whenToUse: "",
    details: "",
    gotchas: ""
  }
  const names = { "When to use": "whenToUse", Details: "details", Gotchas: "gotchas" } as const
  let current: keyof typeof sections = "summary"
  for (const line of markdown.split("\n")) {
    const heading = /^\*\*(When to use|Details|Gotchas)\*\*\s*$/.exec(line.trim())
    if (heading !== null) current = names[heading[1] as keyof typeof names]
    else sections[current] += `${line}\n`
  }
  return sections
}

const moduleReflection = (entry: Entry): Reflection => {
  const project = loadModule(entry.data.file, entry.data.sha256)
  return project.children?.find((child) => child.kind === Kind.Module) ?? project as unknown as Reflection
}

// A module's opening JSDoc block: its text, and its tags
const parseModuleJSDoc = (raw: string) => {
  const lines = raw.replace(/^\/\*\*/, "").replace(/\*\/$/, "").split("\n").map((l) => l.replace(/^\s*\* ?/, ""))
  const text: Array<string> = []
  const tags = new Map<string, string>()
  let fenced = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced
    const tag = fenced ? null : /^@(\w+)\s*(.*)$/.exec(line)
    if (tag !== null) tags.set(tag[1]!, tag[2]!.trim())
    else if (tags.size === 0) text.push(line)
  }
  return { text: text.join("\n").trim(), tags }
}

/** A module's opening text, from the JSDoc model, or else TypeDoc's comment */
export const openingOf = (entry: Entry) => {
  const reflection = moduleReflection(entry)
  const file = loadJsdocs().files.get(reflection.sources?.[0]?.fileName ?? "")
  return file?.moduleJSDoc === null || file?.moduleJSDoc === undefined
    ? { text: partsToMarkdown(reflection.comment?.summary), tags: new Map<string, string>(), file }
    : { ...parseModuleJSDoc(file.moduleJSDoc.raw), file }
}

/** The first paragraph of a module's opening text, as Markdown */
export const summaryOf = (entry: Entry) => {
  const first = openingOf(entry).text.split(/\n\s*\n/)[0] ?? ""
  return first.startsWith("@") ? "" : first.replace(/\s+/g, " ")
}

const titleCase = (category: string) => category.charAt(0).toUpperCase() + category.slice(1)

/** A kind as one letter, as the rail marks it: I, T, C, V, f */
export const kindLetter = (kind: string) =>
  ({ interface: "I", type: "T", class: "C", const: "V", let: "V", function: "f", enum: "E", namespace: "N" })[kind]

export const moduleView = async (entry: Entry, entries: ReadonlyArray<Entry>): Promise<ModuleView> => {
  const data = entry.data
  const module = moduleReflection(entry)
  const jsdocs = loadJsdocs()
  const route = routeOf(entry)
  const sourceFile = module.sources?.[0]?.fileName
  const sourceUrl = (fileName: string, line?: number) =>
    data.repository === null
      ? undefined
      : `${data.repository}/blob/${data.revision}/${fileName}${line === undefined ? "" : `#L${line}`}`

  // ── Links ──────────────────────────────────────────────────────────────────────
  const children = module.children ?? []
  // An interface's or class's members are listed apart when one of them has docs of its own; an interface of
  // undocumented fields is shown as its body, and a link to one of its fields goes to the interface
  const documented = (member: Reflection, parent: Reflection) => {
    const api = jsdocs.apis.get(`${data.module}.${parent.name}.${member.name}`)
    if (api !== undefined) {
      return (api.description.short ?? "").trim() !== "" || (api.description.details ?? "").trim() !== ""
        || api.examples.length > 0
    }
    return partsToMarkdown(commentOf(member)?.summary).trim() !== ""
  }
  const listsMembers = new Set(
    children.filter((child) =>
      (child.kind === Kind.Interface || child.kind === Kind.Class)
      && (child.children ?? []).some((member) => member.inheritedFrom === undefined && documented(member, child))
    ).map((child) => child.id)
  )
  const anchors = new Map<number, string>()
  for (const child of children) {
    anchors.set(child.id, child.name)
    for (const member of child.children ?? []) {
      anchors.set(member.id, listsMembers.has(child.id) ? `${child.name}.${member.name}` : child.name)
    }
  }
  const local = new Set(anchors.values())
  const routes = new Map(entries.map((e) => [`${e.data.packageName}|${e.data.source}`, routeOf(e)]))
  const href = (target: ReferenceTarget) => {
    if (typeof target === "number") {
      const anchor = anchors.get(target)
      return anchor === undefined ? undefined : `#${anchor}`
    }
    if (target.packagePath === undefined) return undefined
    const page = routes.get(`${target.packageName}|${target.packagePath}`)
    if (page === undefined) return undefined
    // A type the module uses but doesn't export has no entry to link to
    if (page === route) return local.has(target.qualifiedName) ? `#${target.qualifiedName}` : undefined
    return `${page}#${target.qualifiedName}`
  }
  const context: Context = { packageName: data.packageName, source: data.source, href }

  // Inline code naming a declaration: `ReadonlyPage`, `Page.goto` in this module, or `Expect.toBeVisible` in
  // another module of the package, preferring a module of the same section where names repeat (`Page`)
  const siblings = new Map<string, Entry>()
  for (const e of entries) {
    if (e.data.packageName !== data.packageName) continue
    const current = siblings.get(e.data.name)
    if (current === undefined || (e.data.section === data.section && current.data.section !== data.section)) {
      siblings.set(e.data.name, e)
    }
  }
  const resolve: Resolve = (name) => {
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) return undefined
    if (local.has(name)) return `#${name}`
    const [head, ...rest] = name.split(".")
    const sibling = siblings.get(head!)
    if (sibling === undefined) return undefined
    if (rest.length === 0) return routeOf(sibling)
    const declared = new Set((moduleReflection(sibling).children ?? []).map((c) => c.name))
    return declared.has(rest[0]!) ? `${routeOf(sibling)}#${rest.join(".")}` : undefined
  }

  // ── The module ─────────────────────────────────────────────────────────────────
  const opening = openingOf(entry)
  const moduleStability = opening.tags.get("stability") ?? tagOf(module.comment, "@stability")
  const moduleSince = opening.tags.get("since") ?? tagOf(module.comment, "@since")
  const barrel = opening.file?.imports?.barrel
  const importLine = barrel !== null && barrel !== undefined
    ? `import { ${barrel.name} } from "${barrel.module}"`
    : data.barrel === null
    ? undefined
    : `import { ${data.name} } from "${data.barrel}"`

  // ── Declarations ───────────────────────────────────────────────────────────────
  const describe = (api: JsdocsApi | undefined, reflection: Reflection): Description => {
    if (api !== undefined) {
      return {
        summary: renderBlocks(api.description.short, resolve),
        whenToUse: renderBlocks(api.description.whenToUse, resolve),
        details: renderBlocks(api.description.details, resolve),
        gotchas: renderBlocks(api.description.gotchas, resolve)
      }
    }
    const sections = splitSections(partsToMarkdown(commentOf(reflection)?.summary))
    return {
      summary: renderBlocks(sections.summary, resolve),
      whenToUse: renderBlocks(sections.whenToUse, resolve),
      details: renderBlocks(sections.details, resolve),
      gotchas: renderBlocks(sections.gotchas, resolve)
    }
  }
  const differs = (value: string | null | undefined, from: string | undefined) =>
    value === null || value === undefined || value === from ? undefined : value

  const view = async (declared: Reflection, parent: Reflection | undefined): Promise<DeclarationView> => {
    const name = parent === undefined ? declared.name : `${parent.name}.${declared.name}`
    const fqn = `${data.module}.${name}`
    const api = jsdocs.apis.get(parent === undefined ? `${fqn}#${isType(declared.kind) ? "type" : "value"}` : fqn)
    const comment = commentOf(declared)
    const ownMembers = declared.kind === Kind.Interface || declared.kind === Kind.Class
      ? sortBySource(declared.children ?? []).filter((member) =>
        member.inheritedFrom === undefined && !member.name.startsWith("~")
        && !(member.kind === Kind.Constructor && declared.extendedTypes?.some((t) => t.type !== "reference"))
      )
      : []
    // Members listed apart are left out of the signature
    const listed = listsMembers.has(declared.id)
    const members = listed ? await Promise.all(ownMembers.map((member) => view(member, declared))) : []
    const docs = parent === undefined
      ? declaration(declared, context, { elideBody: listed })
      : memberDeclaration(declared, context)
    const signatures = await Promise.all(docs.map((doc) => signatureHtml(layout(doc))))
    const source = declared.sources?.[0] ?? declared.signatures?.[0]?.sources?.[0]
    return {
      anchor: name,
      name,
      kind: kindLabel(declared),
      category: api?.tags.category ?? tagOf(comment, "@category"),
      signatures,
      description: describe(api, declared),
      examples: (api?.examples ?? []).map((example) => ({ title: example.title ?? undefined, code: example.code })),
      see: (api?.see ?? []).map((see) => renderInline(see.text, resolve)),
      stability: parent === undefined
        ? differs(api?.tags.stability ?? tagOf(comment, "@stability"), moduleStability)
        : undefined,
      since: parent === undefined ? differs(api?.tags.since ?? tagOf(comment, "@since"), moduleSince) : undefined,
      deprecated: api?.tags.deprecated ?? tagOf(comment, "@deprecated"),
      defaultValue: api?.tags.default ?? tagOf(comment, "@default"),
      sourceUrl: source === undefined ? undefined : sourceUrl(source.fileName, source.line),
      companion: undefined,
      members
    }
  }

  // A type and the value of the same name are one entry: the type first, its Schema or tag beside it
  const byName = new Map<string, Array<Reflection>>()
  for (const child of sortBySource(children)) byName.set(child.name, [...(byName.get(child.name) ?? []), child])
  const groups = new Map<string, Array<DeclarationView>>()
  for (const [, reflections] of byName) {
    const primary = reflections.find((r) => isType(r.kind)) ?? reflections[0]!
    const companion = reflections.find((r) => r !== primary)
    const declared = await view(primary, undefined)
    const entryView = companion === undefined ? declared : { ...declared, companion: await view(companion, undefined) }
    const api = jsdocs.apis.get(`${data.module}.${primary.name}#${isType(primary.kind) ? "type" : "value"}`)
    const category = api?.tags.category ?? tagOf(commentOf(primary), "@category") ?? "other"
    groups.set(category, [...(groups.get(category) ?? []), entryView])
  }
  const rank = (category: string) => {
    if (category === "other") return Number.MAX_SAFE_INTEGER
    const i = data.categoryOrder.indexOf(category)
    return i === -1 ? data.categoryOrder.length : i
  }
  const categories = [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map((
    [category, declarations]
  ) => ({ title: titleCase(category), anchor: `category-${category.replace(/\s+/g, "-")}`, declarations }))

  return {
    name: data.name,
    module: data.module,
    importLine,
    summary: renderBlocks(opening.text, resolve),
    description: summaryOf(entry).replace(/[`*_[\]]/g, ""),
    stability: moduleStability,
    since: moduleSince,
    sourceUrl: sourceFile === undefined ? undefined : sourceUrl(sourceFile),
    categories,
    count: byName.size
  }
}
