// Writes src/internal/version.ts, the package's version as a constant, from its package.json, so the library
// knows its version without reading a file at run time. Run in a package directory with `pnpm codegen`, and after
// `pnpm changeset version` bumps the version; `pnpm check` fails if the constant is stale.
import * as fs from "node:fs"
import * as path from "node:path"

export const version = (root, check) => {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const file = path.join(root, "src", "internal", "version.ts")
  const out =
    `/** The package's version, generated from its package.json by \`pnpm codegen\`. */\nexport const version = ${
      JSON.stringify(version)
    }\n`
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (current === out) return 0
  if (check) {
    process.stderr.write(`${path.relative(root, file)} is stale; run pnpm codegen\n`)
    return 1
  }
  fs.writeFileSync(file, out)
  process.stdout.write(`Wrote ${path.relative(root, file)}\n`)
  return 0
}
