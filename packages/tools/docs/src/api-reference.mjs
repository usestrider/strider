// Writes the API reference dataset, in the shape effect.website renders Effect's from:
//
//   .data/api-reference/<package>/
//     manifest.json         the package, its revision and repository, the order of @category groups, and one
//                           entry per module with its file and hash
//     modules/<path>.json   TypeDoc's JSON for one module (schema 2.0), e.g. modules/Page.json
//     jsdocs.json           the effect-jsdocs model: parsed sections, examples, tags and import guidance
//
// Modules are found from package.json's export map, as Effect's website finds them: every source file a
// pattern matches, except barrels and internal modules. Run with `pnpm api-reference` (after `pnpm jsdocs`).
// A site renders the dataset however it likes; nothing here is tied to one.
//
// One change from TypeDoc's defaults: a type the source writes is converted as written. TypeDoc converts the type
// the checker resolved, which has lost the name of an alias such as `type PageNavigation = typeof
// PageNavigation.Type`, so `Effect.Effect<PageNavigation.PageNavigation, …>` became four object types.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  Application,
  Comment,
  CommentTag,
  Converter,
  MinimalSourceFile,
  normalizePath,
  OptionDefaults,
  ReflectionKind,
  UnionType
} from "typedoc"
import ts from "typescript"
import { categoryOrder } from "./categories.mjs"

export const apiReference = async (repo, root, out = path.join(repo, ".data/api-reference")) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

  // ── Modules, from the export map ─────────────────────────────────────────────
  const sources = fs.readdirSync(path.join(root, "src"), { recursive: true })
    .map((file) => `./src/${file.split(path.sep).join("/")}`)
    .filter((file) => file.endsWith(".ts"))
  const blocked = Object.entries(pkg.exports).filter(([, target]) => target === null).map(([key]) => key)
  const toRegExp = (pattern) =>
    new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("(.+)")}$`)
  const isBlocked = (exportPath) => blocked.some((pattern) => toRegExp(pattern).test(exportPath))
  const isBarrel = (file) => fs.readFileSync(path.join(root, file), "utf8").includes("// @barrel:")

  const modules = new Map() // export path -> source file
  for (const [pattern, target] of Object.entries(pkg.exports)) {
    if (typeof target !== "string" || !target.endsWith(".ts")) continue
    if (!pattern.includes("*")) {
      if (!isBlocked(pattern)) modules.set(pattern, target)
      continue
    }
    const match = toRegExp(target)
    for (const file of sources) {
      const found = match.exec(file)
      if (found === null) continue
      const exportPath = pattern.replace("*", found[1])
      if (!isBlocked(exportPath) && !exportPath.split("/").includes("internal")) modules.set(exportPath, file)
    }
  }
  const barrels = [...modules].filter(([, file]) => isBarrel(file))
  const documented = [...modules].filter(([, file]) => !isBarrel(file)).sort(([a], [b]) => a.localeCompare(b))
  const nearestBarrel = (exportPath) =>
    barrels.map(([barrel]) => barrel)
      .filter((barrel) => barrel === "." || exportPath.startsWith(`${barrel}/`))
      .sort((a, b) => b.length - a.length)[0]

  // ── TypeDoc, one project per module ──────────────────────────────────────────
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()
  const app = await Application.bootstrap({
    name: pkg.name,
    entryPoints: documented.map(([, file]) => path.join(root, file)),
    entryPointStrategy: "resolve",
    tsconfig: path.join(root, "tsconfig.json"),
    alwaysCreateEntryPointModule: true,
    excludeInternal: true,
    excludeExternals: true,
    excludePrivate: true,
    excludeProtected: true,
    blockTags: [...OptionDefaults.blockTags, "@stability"],
    gitRevision: revision,
    // Source paths from the repository's root, as the source links on GitHub need them
    displayBasePath: repo,
    validation: { invalidLink: false, notDocumented: false, notExported: false },
    logLevel: "Warn"
  })
  convertWrittenTypes(app)
  const entryPoints = app.getEntryPoints()
  if (entryPoints === undefined) throw new Error("TypeDoc could not resolve the entry points")
  const bySource = new Map(entryPoints.map((entry) => [path.resolve(entry.sourceFile.fileName), entry]))

  // Effect-style modules open with an untagged JSDoc block; TypeDoc only reads one tagged @module, so it is
  // attached here, with its tags (@stability, @since) as block tags.
  const attachModuleComment = (project, file) => {
    const module = project.children?.find((child) => child.kind === ReflectionKind.Module) ?? project
    if (module.comment !== undefined) return
    const block = fs.readFileSync(file, "utf8").match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1]
    if (block === undefined) return
    const lines = block.split("\n").map((line) => line.replace(/^\s*\* ?/, "").trimEnd())
    const summary = []
    const tags = []
    let fenced = false
    for (const line of lines) {
      if (/^\s*```/.test(line)) fenced = !fenced
      const tag = fenced ? null : /^@(\w+)\s*(.*)$/.exec(line)
      if (tag !== null) tags.push({ name: tag[1], lines: [tag[2]] })
      else if (tags.length > 0) tags.at(-1).lines.push(line)
      else summary.push(line)
    }
    const parse = (text) =>
      app.converter.parseRawComment(new MinimalSourceFile(text, normalizePath(file)), project.files).content
    module.comment = new Comment(
      parse(summary.join("\n").trim()),
      tags.map(({ name, lines }) => new CommentTag(`@${name}`, parse(lines.join("\n").trim())))
    )
    app.converter.resolveLinks(module)
  }

  fs.rmSync(out, { recursive: true, force: true })
  const entries = []
  for (const [exportPath, file] of documented) {
    const source = path.join(root, file)
    const entry = bySource.get(source)
    if (entry === undefined) throw new Error(`TypeDoc made no entry point for ${file}`)
    const name = exportPath === "." ? pkg.name : `${pkg.name}/${exportPath.slice(2)}`
    entry.displayName = name
    const project = app.converter.convert([entry])
    attachModuleComment(project, source)
    app.validate(project)
    const json = path.join(out, "modules", `${exportPath.slice(2)}.json`)
    fs.mkdirSync(path.dirname(json), { recursive: true })
    await app.generateJson(project, json)
    const barrel = nearestBarrel(exportPath)
    entries.push({
      module: name,
      export: exportPath,
      source: file.slice(2),
      json: path.relative(out, json),
      sha256: createHash("sha256").update(fs.readFileSync(json)).digest("hex"),
      barrel: barrel === undefined ? null : barrel === "." ? pkg.name : `${pkg.name}/${barrel.slice(2)}`
    })
  }

  const model = path.join(repo, ".data/jsdocs.json")
  if (fs.existsSync(model)) fs.copyFileSync(model, path.join(out, "jsdocs.json"))
  fs.writeFileSync(
    path.join(out, "manifest.json"),
    JSON.stringify(
      {
        package: pkg.name,
        version: pkg.version,
        revision,
        repository: repositoryUrl(pkg),
        categoryOrder,
        typedocVersion: Application.VERSION,
        typedocSchemaVersion: "2.0",
        barrels: barrels.map(([exportPath, file]) => ({ export: exportPath, source: file.slice(2) })),
        modules: entries
      },
      null,
      2
    ) + "\n"
  )
  process.stdout.write(`Wrote ${entries.length} modules to ${path.relative(repo, out)}\n`)
}

// The repository's web address, from package.json's `repository`, for source links: `git@github.com:o/r.git`,
// `git+https://github.com/o/r.git` and `https://github.com/o/r` all give `https://github.com/o/r`
const repositoryUrl = (pkg) => {
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url
  if (url === undefined) return null
  return url.replace(/^git\+/, "").replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "")
}

// Converts the types the source writes from their type nodes, in place of the types the checker resolved: a
// signature's return and parameter types, as each signature is created, and a property's type, as it is. What the source leaves to inference keeps TypeDoc's conversion. As TypeDoc does,
// an optional member or parameter drops the `undefined` that `?: T | undefined` writes.
const convertWrittenTypes = (app) => {
  const convert = (context, node, optional) => {
    const type = context.converter.convertType(context, node)
    if (!optional || !(type instanceof UnionType)) return type
    const types = type.types.filter((member) => !(member.type === "intrinsic" && member.name === "undefined"))
    return types.length === 1 ? types[0] : new UnionType(types)
  }
  // A context scoped to `reflection`, through each of its parents, as TypeDoc's own conversion scopes it
  const scopedTo = (context, reflection) => {
    const chain = []
    for (let r = reflection; r !== undefined && r !== context.scope; r = r.parent) chain.unshift(r)
    return chain.reduce((scoped, r) => scoped.withScope(r), context)
  }
  const written = (node) => node?.type !== undefined && !ts.isTypePredicateNode(node.type) ? node.type : undefined
  app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, signature, declaration) => {
    if (declaration === undefined || !ts.isFunctionLike(declaration)) return
    const scoped = scopedTo(context, signature)
    const returns = written(declaration)
    if (returns !== undefined) signature.type = convert(scoped, returns, false)
    for (const parameter of signature.parameters ?? []) {
      const node = declaration.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === parameter.name)
      const type = written(node)
      if (type !== undefined) parameter.type = convert(scoped, type, parameter.flags.isOptional)
    }
  })
  // Variables already convert a written type from its node; properties don't
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, (context, reflection) => {
    if (!reflection.kindOf(ReflectionKind.Property) || reflection.type === undefined) return
    const declaration = context.getSymbolFromReflection(reflection)?.declarations?.find((node) =>
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && node.type !== undefined
    )
    if (declaration === undefined) return
    reflection.type = convert(scopedTo(context, reflection), declaration.type, reflection.flags.isOptional)
  })
}
