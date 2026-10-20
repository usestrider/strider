#!/usr/bin/env node
// strider-docs <command>: documentation tools, run from the repository root.
//   jsdocs          Effect's JSDoc checker (vendored), writing .data/jsdocs.json
//   examples        type-check every JSDoc example against the package
//   index           write packages/browser/INDEX.md
//   api-reference   write the API reference dataset to .data/api-reference/
import { spawnSync } from "node:child_process"
import * as path from "node:path"

const [command, ...args] = process.argv.slice(2)
const root = process.cwd()
const pkg = path.join(root, "packages/browser")
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
    ;(await import("./index.mjs")).index(pkg)
    break
  case "api-reference":
    await (await import("./api-reference.mjs")).apiReference(root, pkg)
    break
  default:
    process.stderr.write("usage: strider-docs jsdocs | examples | index | api-reference\n")
    process.exitCode = 1
}
