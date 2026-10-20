// Type-checks every **Example** in the JSDoc against the package. The examples come from the model that
// effect-jsdocs writes, so they are exactly what the API reference shows. Once the modules are implemented,
// @effect/doctest runs them instead. Run with `pnpm examples` (after `pnpm jsdocs`).
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

export const examples = (root) => {
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
      const name = `${api.apiFqn.replace(/[^A-Za-z0-9]+/g, "_")}_${index}.ts`
      const header = `// ${api.apiFqn}: ${example.title} (${api.source.file})\n`
      fs.writeFileSync(path.join(out, name), header + example.code + "\nexport {}\n")
      count++
    })
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
  process.stdout.write(`Checking ${count} examples\n`)
  try {
    execFileSync(path.join(root, "node_modules/.bin/tsc"), ["--noEmit", "-p", out], { stdio: "inherit" })
    return 0
  } catch {
    return 1
  }
}
