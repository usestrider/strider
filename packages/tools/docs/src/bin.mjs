#!/usr/bin/env node
// strider-docs <command>: documentation tools, run from the repository root.
//   jsdocs          Effect's JSDoc checker (vendored), writing .data/jsdocs.json
//   examples        type-check every JSDoc example against the package, and every guide's TypeScript block
//   format          format every guide's TypeScript and JSON blocks, and every JSDoc example, with dprint, at the
//                   site's column width; with --check, write nothing and fail if one isn't formatted
//   index           write each public package's INDEX.md
//   api-reference   write each public package's API reference dataset to .data/api-reference/<package>/, what
//                   TypeScript reads in every example and guide block to .data/api-reference/code.json, and each
//                   backend's capabilities to .data/api-reference/capabilities.json
//   audit           list, for each guide, what its review checks: size, sections with little before their code,
//                   and names the prose mentions that no block on the page shows; --json for the data, and page
//                   ids (events/events) to audit only those; --consistency compares the pages instead
import { spawnSync } from "node:child_process"
import * as path from "node:path"

const [command, ...args] = process.argv.slice(2)
const root = process.cwd()
// The public packages: @usestrider/browser and @usestrider/vitest
const packages = ["browser", "vitest"].map((name) => ({ name, dir: path.join(root, "packages", name) }))
// The documentation site's guides, whose code is checked and read with the examples'
const guides = path.join(root, "website/src/content/docs")
switch (command) {
  case "jsdocs": {
    const bin = path.join(import.meta.dirname, "jsdocs/bin.ts")
    const result = spawnSync(process.execPath, [bin, "--check", ...args], { cwd: root, stdio: "inherit" })
    process.exitCode = result.status ?? 1
    break
  }
  case "examples":
    process.exitCode = (await import("./examples.mjs")).examples(root, guides)
    break
  case "format":
    process.exitCode = (await import("./format.mjs")).format(
      root,
      guides,
      packages.map((pkg) => path.join(pkg.dir, "src")),
      { check: args.includes("--check") }
    )
    break
  case "index":
    for (const pkg of packages) (await import("./index.mjs")).index(pkg.dir)
    break
  case "api-reference": {
    const out = path.join(root, ".data/api-reference")
    for (const pkg of packages) {
      await (await import("./api-reference.mjs")).apiReference(root, pkg.dir, path.join(out, pkg.name))
    }
    const { code } = await import("./code.mjs")
    code(root, { packages, guides, out })
    await (await import("./capabilities.mjs")).capabilities(root, out)
    break
  }
  case "audit":
    process.exitCode = await (await import("./audit.mjs")).audit(root, guides, {
      json: args.includes("--json"),
      consistency: args.includes("--consistency"),
      pages: args.filter((arg) => !arg.startsWith("--"))
    })
    break
  default:
    process.stderr.write(
      "usage: strider-docs jsdocs | examples | format [--check] | index | api-reference | audit [--json] [--consistency] [page…]\n"
    )
    process.exitCode = 1
}
