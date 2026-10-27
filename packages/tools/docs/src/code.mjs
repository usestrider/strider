// Reads every code block the documentation shows with TypeScript's language service, and writes what it finds to
// the API reference dataset, for a site to highlight, link and annotate the code with:
//
//   .data/api-reference/code.json
//     typescript      the version that read the code
//     blocks          one per distinct block: its key, language, code and sources, and its identifiers
//
// The blocks are each package's JSDoc examples (from .data/jsdocs.json, whose fences are TypeScript) and the
// guides' TypeScript blocks. A block's key is the SHA-256, in hex, of its language, a newline and its code
// (`ts\nimport …`), so a site finds a block from what it renders; a block shown in several places is read once.
// Each identifier has its span, and, where TypeScript has them:
//
//   type, modifiers   TypeScript's 2020 semantic classification: `namespace`, `function`, `parameter`, …; a
//                     module's namespace, which TypeScript leaves out (`import { Effect } from "effect"`), is a
//                     `namespace` here
//   quickInfo         its quick info: the declaration as hovering it shows it, and the first paragraph of its JSDoc
//   target            the documented declaration it names: a module of the dataset's manifests, and the
//                     declaration's name in it (`Page.goto`, for a member), or no name for the module itself
//
// One language service holds every block, as a file beside the repository's root that isn't written, read with the
// tests' compiler options, as the example check reads them. Run with `pnpm api-reference`, which writes the
// manifests this reads first.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import ts from "typescript"
import { guideBlocks, typescriptLanguages } from "./guides.mjs"

/** A block's key: the SHA-256 of its language, a newline and its code */
export const keyOf = (lang, code) => createHash("sha256").update(`${lang}\n${code}`).digest("hex")

// The 2020 classification's legend, as TypeScript encodes it: `(type + 1) << 8 | modifiers`
const { TokenType, TokenModifier, TokenEncodingConsts } = ts.classifier.v2020
const modifierNames = Object.values(TokenModifier).filter((value) => typeof value === "string")

export const code = (root, { packages, guides, out }) => {
  const model = JSON.parse(fs.readFileSync(path.join(root, ".data/jsdocs.json"), "utf8"))

  // ── The blocks ─────────────────────────────────────────────────────────────────
  const blocks = new Map()
  const add = (lang, text, source) => {
    const key = keyOf(lang, text)
    const block = blocks.get(key) ?? { key, lang, code: text, sources: [] }
    block.sources.push(source)
    blocks.set(key, block)
  }
  for (const api of model.apis) {
    for (const example of api.examples) add("ts", example.code, { api: api.apiFqn, title: example.title })
  }
  for (const block of guideBlocks(root, guides)) {
    if (typescriptLanguages.has(block.lang)) add(block.lang, block.code, { guide: block.guide, line: block.line })
  }
  const directory = path.join(root, ".code")
  const files = new Map([...blocks.values()].map((block) => [path.join(directory, `${block.key}.ts`), block]))

  // ── What the dataset documents ─────────────────────────────────────────────────
  // Each module's source file, with the names of its declarations and of their members, from TypeDoc's JSON
  const documented = new Map()
  for (const pkg of packages) {
    const dataset = path.join(out, pkg.name)
    const manifest = JSON.parse(fs.readFileSync(path.join(dataset, "manifest.json"), "utf8"))
    for (const entry of manifest.modules) {
      const project = JSON.parse(fs.readFileSync(path.join(dataset, entry.json), "utf8"))
      const module = project.children?.find((child) => child.kind === 2) ?? project
      const names = new Set()
      for (const child of module.children ?? []) {
        names.add(child.name)
        for (const member of child.children ?? []) names.add(`${child.name}.${member.name}`)
      }
      documented.set(path.join(pkg.dir, entry.source), { module: entry.module, names })
    }
  }

  // ── The language service ───────────────────────────────────────────────────────
  const config = ts.readConfigFile(path.join(root, "tsconfig.tests.json"), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const options = {
    ...parsed.options,
    composite: false,
    incremental: false,
    declarationMap: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    // Quick info is shortened as an editor shortens it; the tests' settings spell out every type in an error
    noErrorTruncation: false
  }
  const service = ts.createLanguageService({
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "0",
    getScriptSnapshot: (file) => {
      const text = files.get(file)?.code ?? ts.sys.readFile(file)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (file) => files.has(file) || ts.sys.fileExists(file),
    readFile: (file) => files.get(file)?.code ?? ts.sys.readFile(file),
    directoryExists: (dir) => dir === directory || ts.sys.directoryExists(dir),
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath
  }, ts.createDocumentRegistry())
  const program = service.getProgram()
  const checker = program.getTypeChecker()

  // ── Targets ────────────────────────────────────────────────────────────────────
  // An object literal's key is a symbol of its own; the declaration it fills is its contextual type's property
  const symbolAt = (node) => {
    const { parent } = node
    if (ts.isPropertyAssignment(parent) && parent.name === node && ts.isObjectLiteralExpression(parent.parent)) {
      const contextual = checker.getContextualType(parent.parent)
      if (contextual !== undefined) {
        const type = checker.getNonNullableType(contextual)
        for (const member of type.isUnion() ? type.types : [type]) {
          const property = checker.getPropertyOfType(member, node.text)
          if (property !== undefined) return property
        }
      }
    }
    return checker.getSymbolAtLocation(node)
  }
  // A declaration's file, and the names of what encloses it there: `["Page", "goto"]` for a method of `Page`
  const placeOf = (declaration) => {
    const names = []
    for (let node = declaration; !ts.isSourceFile(node); node = node.parent) {
      const name = node.name
      if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name))) names.unshift(name.text)
    }
    return { file: declaration.getSourceFile().fileName, names }
  }
  // The first declaration the dataset documents along the symbol's aliases: an import resolves through a barrel's
  // `export * as Page` to the module, and a module's `export { x } from "./internal/…"` names `x` in that module
  const targetOf = (symbol) => {
    const seen = new Set()
    for (let s = symbol; s !== undefined && !seen.has(s);) {
      seen.add(s)
      const declaration = s.valueDeclaration ?? s.declarations?.[0]
      if (declaration !== undefined) {
        const { file, names } = placeOf(declaration)
        const module = documented.get(path.resolve(file))
        const name = names.join(".")
        if (module !== undefined && name === "") return { module: module.module }
        if (module !== undefined && module.names.has(name)) return { module: module.module, name }
      }
      s = s.flags & ts.SymbolFlags.Alias ? checker.getImmediateAliasedSymbol(s) : undefined
    }
    return undefined
  }

  // TypeScript classifies a namespace a `namespace` declares, but not a module's, which a file is
  const classifyModule = (symbol) => {
    const resolved = symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol
    return resolved !== undefined && resolved.flags & ts.SymbolFlags.ValueModule
      ? { type: "namespace", modifiers: [] }
      : {}
  }

  // ── Each block ─────────────────────────────────────────────────────────────────
  const analyzed = []
  for (const [file, block] of files) {
    const source = program.getSourceFile(file)
    const classified = new Map()
    const { spans } = service.getEncodedSemanticClassifications(
      file,
      { start: 0, length: block.code.length },
      ts.SemanticClassificationFormat.TwentyTwenty
    )
    for (let i = 0; i < spans.length; i += 3) {
      const encoded = spans[i + 2]
      classified.set(spans[i], {
        type: TokenType[(encoded >> TokenEncodingConsts.typeOffset) - 1],
        modifiers: modifierNames.filter((_, bit) => encoded & (1 << bit) & TokenEncodingConsts.modifierMask)
      })
    }
    const identifiers = []
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        const start = node.getStart(source)
        const symbol = symbolAt(node)
        const identifier = { start, length: node.end - start, ...(classified.get(start) ?? classifyModule(symbol)) }
        const info = service.getQuickInfoAtPosition(file, start)
        if (info !== undefined) {
          const documentation = ts.displayPartsToString(info.documentation).split(/\n\s*\n/)[0].trim()
          identifier.quickInfo = {
            display: ts.displayPartsToString(info.displayParts),
            ...(documentation === "" ? {} : { documentation })
          }
        }
        const target = symbol === undefined ? undefined : targetOf(symbol)
        if (target !== undefined) identifier.target = target
        identifiers.push(identifier)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    analyzed.push({ ...block, identifiers })
  }

  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(
    path.join(out, "code.json"),
    JSON.stringify({ typescript: ts.version, blocks: analyzed }) + "\n"
  )
  process.stdout.write(`Read ${analyzed.length} code blocks with TypeScript ${ts.version}\n`)
}
