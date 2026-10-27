#!/usr/bin/env node
// strider-docs <command>: documentation tools, run from the repository root.
//   jsdocs          Effect's JSDoc checker (vendored), writing .data/jsdocs.json
//   examples        type-check every JSDoc example against the package
//   index           write each public package's INDEX.md
//   api-reference   write each public package's API reference dataset to .data/api-reference/<package>/
import { spawnSync } from "node:child_process"
import * as path from "node:path"

const [command, ...args] = process.argv.slice(2)
const root = process.cwd()
// The public packages: @usestrider/browser and @usestrider/vitest
const packages = ["browser", "vitest"].map((name) => ({ name, dir: path.join(root, "packages", name) }))
switch (command) {
  case "jsdocs": {
    const bin = path.join(import.meta.dirname, "jsdocs/bin.ts")
    const result = spawnSync(process.execPath, [bin, "--check", ...args], { cwd: root, stdio: "inherit" })
    process.exitCode = result.status ?? 1
    break
  }
  case "examples":
    process.exitCode = (await import("./examples.mjs")).examples(root)
    break
  case "index":
    for (const pkg of packages) (await import("./index.mjs")).index(pkg.dir)
    break
  case "api-reference":
    for (const pkg of packages) {
      await (await import("./api-reference.mjs")).apiReference(
        root,
        pkg.dir,
        path.join(root, ".data/api-reference", pkg.name)
      )
    }
    break
  default:
    process.stderr.write("usage: strider-docs jsdocs | examples | index | api-reference\n")
    process.exitCode = 1
}
