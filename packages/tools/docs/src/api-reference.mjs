// Writes the API reference dataset, in the shape effect.website renders Effect's from:
//
//   .data/api-reference/
//     manifest.json         the package, its revision, and one entry per module with its file and hash
//     modules/<path>.json   TypeDoc's JSON for one module (schema 2.0), e.g. modules/Page.json
//     jsdocs.json           the effect-jsdocs model: parsed sections, examples, tags and import guidance
//
// Modules are found from package.json's export map, as Effect's website finds them: every source file a
// pattern matches, except barrels and internal modules. Run with `pnpm api-reference` (after `pnpm jsdocs`).
// A site renders the dataset however it likes; nothing here is tied to one.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  Application,
  Comment,
  CommentTag,
  MinimalSourceFile,
  normalizePath,
  OptionDefaults,
  ReflectionKind
} from "typedoc"

export const apiReference = async (repo, root) => {
  const out = path.join(repo, ".data/api-reference")
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
    validation: { invalidLink: false, notDocumented: false, notExported: false },
    logLevel: "Warn"
  })
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
