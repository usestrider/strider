/**
 * Every entry point loads in Node. A declaration that isn't built is erased at run time, so one that a module
 * uses as it loads, or re-exports under another name, breaks every import of the package. Vite's transform
 * forgives the second, so the entry points are loaded by Node itself, which strips types as `tsc` emits them.
 */
import { assert, describe, it } from "@effect/vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const root = new URL("../", import.meta.url)

const exportMap: Record<string, string | null> = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).exports

/** The files the export map names, but for the wildcard, whose modules the barrels re-export. */
const entryPoints = Object.entries(exportMap).flatMap(([subpath, target]) =>
  typeof target === "string" && target.endsWith(".ts") && !subpath.includes("*")
    ? [new URL(target, root).href]
    : []
)

// Imports each entry point in turn and prints the ones that failed, with why
const loader = `
const failed = []
for (const entryPoint of JSON.parse(process.argv[1])) {
  try { await import(entryPoint) } catch (error) { failed.push(entryPoint + ": " + String(error).split("\\n")[0]) }
}
console.log(JSON.stringify(failed))
`

describe("Modules", () => {
  it("loads every entry point in Node", () => {
    assert.include(entryPoints, new URL("src/index.ts", root).href)
    assert.include(entryPoints, new URL("src/chromium/index.ts", root).href)
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "--no-warnings", "--eval", loader, JSON.stringify(entryPoints)],
      { encoding: "utf8" }
    )
    assert.deepStrictEqual(JSON.parse(output), [])
  })
})
