// Type-checks every **Example** in the JSDoc against the package, and every TypeScript block in the guides. The
// examples come from the model that effect-jsdocs writes, so they are exactly what the API reference shows. Once
// the modules are implemented, @effect/doctest runs them instead. Run with `pnpm examples` (after `pnpm jsdocs`).
//
// One `tsc` checks them all. A guide's block is a file of its own, which an error names by the guide and the line,
// `website/src/content/docs/index.mdx(18,5): error TS2322: …`; an example's error names its file in `.examples/`, which
// opens with the API and the source the example is from.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { guideBlocks, typescriptLanguages } from "./guides.mjs"

export const examples = (root, guides) => {
  const out = path.join(root, ".examples")
  const model = JSON.parse(fs.readFileSync(path.join(root, ".data/jsdocs.json"), "utf8"))

  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const seen = new Set()
  let count = 0
  for (const api of model.apis) {
    api.examples.forEach((example, index) => {
      const key = `${api.source.file}:${example.title}`
      if (seen.has(key)) return // an API re-exported from a barrel shares its examples
      seen.add(key)
      // numbered, so names that differ only in case, such as `Protocol.command` and `Protocol.Command`, stay apart
      const name = `${count}_${api.apiFqn.replace(/[^A-Za-z0-9]+/g, "_")}_${index}.ts`
      const header = `// ${api.apiFqn}: ${example.title} (${api.source.file})\n`
      fs.writeFileSync(path.join(out, name), header + example.code + "\nexport {}\n")
      count++
    })
  }
  // A guide's block opens on its first line, so the file's line n is the guide's line `block.line + n - 1`, and its
  // columns are the guide's less what the line lost to indentation
  const fromGuide = new Map()
  for (const block of guideBlocks(root, guides).filter((block) => typescriptLanguages.has(block.lang))) {
    const name = `guide_${block.guide.replace(/[^A-Za-z0-9]+/g, "_")}_${block.line}.ts`
    fs.writeFileSync(path.join(out, name), block.code + "\nexport {}\n")
    fromGuide.set(name, block)
  }
  const files = fs.readdirSync(out).filter((name) => name.endsWith(".ts"))
  // The tests' settings and paths, without project references, so examples read the package's source
  const tsconfig = {
    extends: "../tsconfig.tests.json",
    compilerOptions: {
      composite: false,
      incremental: false,
      declarationMap: false,
      // an example defines what it shows, and needn't use it
      noUnusedLocals: false,
      noUnusedParameters: false
    },
    files
  }
  fs.writeFileSync(path.join(out, "tsconfig.json"), JSON.stringify(tsconfig, null, 2))
  process.stdout.write(`Checking ${count} examples and ${fromGuide.size} guide blocks\n`)
  try {
    execFileSync(path.join(root, "node_modules/.bin/tsc"), ["--noEmit", "--pretty", "false", "-p", out], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"]
    })
    return 0
  } catch (error) {
    if (typeof error.stdout !== "string") throw error
    process.stdout.write(inGuides(error.stdout, fromGuide))
    return 1
  }
}

// tsc's diagnostics, each in a guide's block moved to where the block is in its guide
const inGuides = (output, fromGuide) =>
  output.replace(
    /^(?:\.examples[\\/])?(guide_\w+\.ts)\((\d+),(\d+)\)/gm,
    (whole, name, line, column) => {
      const block = fromGuide.get(name)
      if (block === undefined) return whole
      const index = Number(line) - 1
      return `${block.guide}(${block.line + index},${Number(column) + (block.shifts[index] ?? 0)})`
    }
  )
