// Formats the guides' code blocks as dprint formats the repository's code, with Effect's settings (dprint.json), at
// the width of the site's column. dprint reads Markdown but not MDX, so each TypeScript or JSON block is formatted on
// its own, through `dprint fmt --stdin`, and written back in place. With `check`, nothing is written, and each block
// that would change is named by its guide and line.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { codeBlocks } from "./guides.mjs"

/** The characters a code block's line fits in the site's column, at the code's font size */
export const guideLineWidth = 88

const extensions = { ts: "ts", typescript: "ts", tsx: "tsx", json: "json" }

export const format = (root, guides, { check = false } = {}) => {
  const base = JSON.parse(fs.readFileSync(path.join(root, "dprint.json"), "utf8"))
  const config = path.join(root, ".data", "dprint.guides.json")
  fs.mkdirSync(path.dirname(config), { recursive: true })
  fs.writeFileSync(
    config,
    JSON.stringify({
      lineWidth: guideLineWidth,
      indentWidth: base.indentWidth,
      newLineKind: base.newLineKind,
      typescript: base.typescript,
      json: base.json ?? {},
      plugins: base.plugins.filter((plugin) => !plugin.includes("/markdown-"))
    })
  )
  const dprint = path.join(root, "node_modules/.bin/dprint")
  const files = fs.existsSync(guides)
    ? fs.readdirSync(guides, { recursive: true }).filter((file) => /\.mdx?$/.test(file)).sort()
    : []
  const unformatted = []
  let failed = false
  for (const file of files) {
    const full = path.join(guides, file)
    const guide = path.relative(root, full).split(path.sep).join("/")
    const source = fs.readFileSync(full, "utf8")
    const lines = source.split("\n")
    // Last first, so a block that changes length leaves the lines of those before it where they were
    const blocks = codeBlocks(source).filter((block) => block.lang in extensions).reverse()
    let changed = false
    for (const block of blocks) {
      if (block.code === "") continue
      const result = spawnSync(dprint, ["fmt", "--config", config, "--stdin", extensions[block.lang]], {
        cwd: root,
        input: block.code + "\n",
        encoding: "utf8"
      })
      if (result.status !== 0) {
        process.stderr.write(`${guide}:${block.line}: dprint couldn't format this block\n${result.stderr}`)
        failed = true
        continue
      }
      const formatted = result.stdout.replace(/\n+$/, "")
      if (formatted === block.code) continue
      unformatted.push(`${guide}:${block.line}`)
      changed = true
      // A fence in a list item or a quote keeps the indentation and markers its first line had
      const count = block.code.split("\n").length
      const prefix = block.shifts.length > 0 ? lines[block.line - 1].slice(0, block.shifts[0]) : ""
      const replacement = formatted.split("\n").map((line) => line === "" ? prefix.trimEnd() : prefix + line)
      lines.splice(block.line - 1, count, ...replacement)
    }
    if (changed && !check) fs.writeFileSync(full, lines.join("\n"))
  }
  if (check && unformatted.length > 0) {
    process.stdout.write(
      `Not formatted (pnpm lint-fix formats them):\n${unformatted.map((at) => `  ${at}\n`).join("")}`
    )
    return 1
  }
  if (!check && unformatted.length > 0) process.stdout.write(`Formatted ${unformatted.length} guide blocks\n`)
  return failed ? 1 : 0
}
