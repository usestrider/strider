// Writes each entry point's barrel (src/index.ts, src/chromium/index.ts, …) in Effect's format: one
// `export * as Module` per module file, carrying only the module's @stability and @since. Run in a package
// directory with `pnpm codegen`; `pnpm check` fails if a barrel is stale.
import * as fs from "node:fs"
import * as path from "node:path"

export const barrel = (root, check) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const barrels = Object.entries(pkg.exports)
    .filter(([key, target]) => typeof target === "string" && target.endsWith("/index.ts") && key !== "./package.json")
    .map(([, target]) => path.join(root, target))

  const tag = (block, name) => block.match(new RegExp(`@${name}\\s+(\\S+)`))?.[1]
  const moduleTags = (file) => {
    const block = fs.readFileSync(file, "utf8").match(/^\/\*\*[\s\S]*?\*\//)?.[0]
    const stability = block && tag(block, "stability")
    const since = block && tag(block, "since")
    if (!stability || !since) throw new Error(`${path.relative(root, file)}: module JSDoc needs @stability and @since`)
    return { stability, since }
  }

  let stale = 0
  for (const barrel of barrels) {
    const dir = path.dirname(barrel)
    const modules = fs.readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && name !== "index.ts")
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
    const own = moduleTags(barrel)
    let out =
      `/**\n * @stability ${own.stability}\n * @since ${own.since}\n */\n\n// @barrel: Auto-generated exports. Do not edit manually.\n`
    for (const name of modules) {
      const { stability, since } = moduleTags(path.join(dir, name))
      const id = name.slice(0, -3)
      out += `\n/**\n * @stability ${stability}\n * @since ${since}\n */\nexport * as ${id} from "./${name}"\n`
    }
    const current = fs.readFileSync(barrel, "utf8")
    if (current === out) continue
    if (check) {
      stale++
      process.stderr.write(`${path.relative(root, barrel)} is stale; run pnpm codegen\n`)
    } else {
      fs.writeFileSync(barrel, out)
      process.stdout.write(`Wrote ${path.relative(root, barrel)}\n`)
    }
  }
  return stale > 0 ? 1 : 0
}
