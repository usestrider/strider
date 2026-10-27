// Formats the guides' code blocks and the JSDoc examples as dprint formats the repository's code, with Effect's
// settings (dprint.json), at the width of the site's column, so the API reference and the guides show them unwrapped.
// dprint reads Markdown but not MDX, and leaves comments alone, so each block is written to a file of its own, one
// `dprint fmt` formats them all, and each is written back in place: a guide's at its fence's indentation, an
// example under its comment's ` * `. With `check`, nothing is written, and each block that would change is named by
// its file and line.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { codeBlocks } from "./guides.mjs"

/** The characters a code block's line fits in the site's column, at the code's font size */
export const guideLineWidth = 88

const extensions = { ts: "ts", typescript: "ts", tsx: "tsx", json: "json" }

// An example's fence in a doc comment, and the comment's prefix before it
const exampleOpen = /^(\s*\*) ```ts import\.meta\.vitest\s*$/
const exampleClose = /^\s*\* ```\s*$/

/** Each TypeScript and JSON block of a guide, with how to put it back */
const guideBlocksOf = (full) => {
  const lines = fs.readFileSync(full, "utf8").split("\n")
  return codeBlocks(lines.join("\n")).filter((block) => block.lang in extensions && block.code !== "").map((
    block
  ) => {
    // A fence in a list item or a quote keeps the indentation and markers its first line had
    const prefix = block.shifts.length > 0 ? lines[block.line - 1].slice(0, block.shifts[0]) : ""
    return {
      file: full,
      line: block.line,
      ext: extensions[block.lang],
      code: block.code,
      count: block.code.split("\n").length,
      render: (line) => line === "" ? prefix.trimEnd() : prefix + line
    }
  })
}

/** Each example in a source file's doc comments, with how to put it back */
const exampleBlocksOf = (full) => {
  const lines = fs.readFileSync(full, "utf8").split("\n")
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const open = exampleOpen.exec(lines[i])
    if (open === null) continue
    const star = open[1]
    const start = i + 1
    let end = start
    while (end < lines.length && !exampleClose.test(lines[end])) end++
    const code = lines.slice(start, end).map((line) => line.startsWith(`${star} `) ? line.slice(star.length + 1) : "")
    blocks.push({
      file: full,
      line: start + 1,
      ext: "ts",
      code: code.join("\n"),
      count: end - start,
      render: (line) => line === "" ? star : `${star} ${line}`
    })
    i = end
  }
  return blocks
}

const sourceFiles = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).filter((file) => file.endsWith(".ts")).sort().map((file) =>
      path.join(dir, file)
    )
    : []

export const format = (root, guides, sources, { check = false } = {}) => {
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
  const guideFiles = fs.existsSync(guides)
    ? fs.readdirSync(guides, { recursive: true }).filter((file) => /\.mdx?$/.test(file)).sort().map((file) =>
      path.join(guides, file)
    )
    : []
  const blocks = [
    ...guideFiles.flatMap(guideBlocksOf),
    ...sources.flatMap(sourceFiles).flatMap(exampleBlocksOf)
  ]
  const where = (block) => `${path.relative(root, block.file).split(path.sep).join("/")}:${block.line}`

  // One dprint over a file per block
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "strider-format-"))
  const files = blocks.map((block, n) => {
    const file = path.join(scratch, `${n}.${block.ext}`)
    fs.writeFileSync(file, block.code + "\n")
    return file
  })
  const result = spawnSync(
    path.join(root, "node_modules/.bin/dprint"),
    ["fmt", "--config", config, ...files],
    { cwd: root, encoding: "utf8" }
  )
  let failed = false
  if (result.status !== 0) {
    // dprint names each file it couldn't parse; name the block instead
    const named = result.stderr.replace(
      new RegExp(`${scratch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\\\/](\\d+)\\.\\w+`, "g"),
      (_, n) => where(blocks[Number(n)])
    )
    process.stderr.write(`dprint couldn't format these blocks:\n${named}`)
    failed = true
  }
  const formatted = files.map((file) => fs.readFileSync(file, "utf8").replace(/\n+$/, ""))
  fs.rmSync(scratch, { recursive: true, force: true })

  // Back in place, last first in each file, so a block that changes length leaves the lines before it where they were
  const unformatted = []
  const byFile = new Map()
  blocks.forEach((block, n) => {
    if (formatted[n] === block.code) return
    unformatted.push(where(block))
    byFile.set(block.file, [...(byFile.get(block.file) ?? []), { block, code: formatted[n] }])
  })
  if (!check) {
    for (const [file, changes] of byFile) {
      const lines = fs.readFileSync(file, "utf8").split("\n")
      for (const { block, code } of changes.reverse()) {
        lines.splice(block.line - 1, block.count, ...code.split("\n").map(block.render))
      }
      fs.writeFileSync(file, lines.join("\n"))
    }
  }
  if (check && unformatted.length > 0) {
    process.stdout.write(
      `Not formatted (pnpm lint-fix formats them):\n${unformatted.map((at) => `  ${at}\n`).join("")}`
    )
    return 1
  }
  if (!check && unformatted.length > 0) process.stdout.write(`Formatted ${unformatted.length} code blocks\n`)
  return failed ? 1 : 0
}
