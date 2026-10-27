// Reads the API reference dataset `pnpm api-reference` writes, one directory per package:
//
//   .data/api-reference/<package>/manifest.json        the package, revision, repository, category order, modules
//   .data/api-reference/<package>/modules/<path>.json  TypeDoc's JSON for one module
//   .data/api-reference/<package>/jsdocs.json          the JSDoc model: sections, examples, tags, import lines
//
// The dataset is generated, never committed: `pnpm reference` (or `pnpm jsdocs && pnpm api-reference`) writes it.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Project } from "./typedoc.ts"

export interface ManifestModule {
  /** `@usestrider/browser/Page` */
  readonly module: string
  /** `./Page` */
  readonly export: string
  /** `src/Page.ts`, relative to the package */
  readonly source: string
  /** `modules/Page.json`, relative to the package's directory in the dataset */
  readonly json: string
  readonly sha256: string
  /** The entry point that re-exports the module, `@usestrider/browser` */
  readonly barrel: string | null
}

export interface Manifest {
  readonly package: string
  readonly version: string
  readonly revision: string
  readonly repository: string | null
  readonly categoryOrder: ReadonlyArray<string>
  readonly modules: ReadonlyArray<ManifestModule>
}

export interface JsdocsApi {
  readonly kind: "root-declaration" | "member" | "namespace"
  readonly apiFqn: string
  readonly bucket: "type" | "value" | null
  readonly description: {
    readonly short: string | null
    readonly whenToUse: string | null
    readonly details: string | null
    readonly gotchas: string | null
  }
  readonly examples: ReadonlyArray<{ readonly title: string | null; readonly code: string }>
  readonly tags: {
    readonly category: string | null
    readonly since: string | null
    readonly stability: string | null
    readonly deprecated: string | null
    readonly default: string | null
  }
  readonly see: ReadonlyArray<{ readonly text: string }>
  readonly importGuidance: { readonly importDeclaration: string; readonly usage: string } | null
}

export interface JsdocsFile {
  readonly file: string
  // A file without an opening block, or that no barrel re-exports, leaves the key out
  readonly imports?: {
    readonly barrel?: { readonly module: string; readonly name: string } | null
  } | null
  readonly moduleJSDoc?: { readonly raw: string } | null
}

/** Where the dataset is: `astro.config.ts` sets it to the repository's `.data/api-reference/` */
export const datasetRoot = () => {
  const root = process.env["STRIDER_REFERENCE_DATA"]
  if (root === undefined) throw new Error("STRIDER_REFERENCE_DATA is not set; astro.config.ts sets it")
  return root
}

const missing = (file: string) =>
  new Error(`${file} is missing. Run \`pnpm reference\` from the repository root to generate the API reference.`)

/** Every package in the dataset, with its directory */
export const manifests = (): Array<{ readonly directory: string; readonly manifest: Manifest }> => {
  const root = datasetRoot()
  if (!fs.existsSync(root)) throw missing(root)
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "manifest.json")))
    .map((entry) => {
      const directory = path.join(root, entry.name)
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")) as Manifest
      return { directory, manifest }
    })
    .sort((a, b) => a.manifest.package.localeCompare(b.manifest.package))
}

const projects = new Map<string, Project>()

/** One module's TypeDoc JSON, checked against the hash its manifest recorded */
export const loadModule = (file: string, sha256: string): Project => {
  // Keyed by hash too, so a regenerated dataset is read again while `astro dev` runs
  const key = `${file}:${sha256}`
  const cached = projects.get(key)
  if (cached !== undefined) return cached
  if (!fs.existsSync(file)) throw missing(file)
  const text = fs.readFileSync(file)
  const actual = createHash("sha256").update(text).digest("hex")
  if (actual !== sha256) {
    throw new Error(`${file} doesn't match its manifest; regenerate the dataset with \`pnpm api-reference\``)
  }
  const project = JSON.parse(text.toString("utf8")) as Project
  projects.set(key, project)
  return project
}

export interface JsdocsIndex {
  /** A root declaration by `<apiFqn>#<bucket>`, a member by its `apiFqn` */
  readonly apis: ReadonlyMap<string, JsdocsApi>
  /** A module's file by its path from the repository root, `packages/browser/src/Page.ts` */
  readonly files: ReadonlyMap<string, JsdocsFile>
}

let jsdocs: { readonly key: string; readonly index: JsdocsIndex } | undefined

/** The JSDoc model, which every package's directory holds a copy of, indexed once per version of it */
export const loadJsdocs = (): JsdocsIndex => {
  const found = manifests().map(({ directory }) => path.join(directory, "jsdocs.json")).find((file) =>
    fs.existsSync(file)
  )
  const key = found === undefined ? "" : `${found}:${fs.statSync(found).mtimeMs}`
  if (jsdocs?.key === key) return jsdocs.index
  const apis = new Map<string, JsdocsApi>()
  const files = new Map<string, JsdocsFile>()
  if (found !== undefined) {
    const model = JSON.parse(fs.readFileSync(found, "utf8")) as {
      readonly apis: ReadonlyArray<JsdocsApi>
      readonly files: ReadonlyArray<JsdocsFile>
    }
    for (const api of model.apis) {
      apis.set(api.kind === "member" ? api.apiFqn : `${api.apiFqn}#${api.bucket}`, api)
    }
    for (const file of model.files) files.set(file.file, file)
  }
  jsdocs = { key, index: { apis, files } }
  return jsdocs.index
}
