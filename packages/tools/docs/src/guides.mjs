// The guides' fenced code blocks, as remark reads them in the site's MDX:
// tabs are four spaces, and a fence may be indented, as in a list item, or quoted, and its lines lose that
// indentation and quoting. Each block keeps the line its code starts on, and how far each of its lines moved, so a
// check can point into the guide.
import * as fs from "node:fs"
import * as path from "node:path"

/** The languages whose blocks are TypeScript, which the example check type-checks and the code analysis reads */
export const typescriptLanguages = new Set(["ts", "typescript"])

const fence = /^((?: {0,3}> ?)*)( *)(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*(.*)$/
const quoteMarker = /^ {0,3}> ?/

/**
 * Each fenced block of a Markdown document: its language, its code, the 1-based line its code starts on, and how
 * many characters each line of it lost to indentation and quoting
 */
export const codeBlocks = (markdown) => {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const open = fence.exec(lines[i])
    i++
    if (open === null) continue
    const [, quotes, indent, marker, lang] = open
    const depth = quotes.match(/>/g)?.length ?? 0
    // A line inside the fence, without its quote markers; undefined once the quote ends
    const unquote = (line) => {
      for (let d = 0; d < depth; d++) {
        const marked = quoteMarker.exec(line)
        if (marked === null) return undefined
        line = line.slice(marked[0].length)
      }
      return line
    }
    const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`)
    const start = i + 1
    const code = []
    const shifts = []
    while (i < lines.length) {
      const line = unquote(lines[i])?.replace(new RegExp(`^ {0,${indent.length}}`), "")
      if (line === undefined) break
      if (close.test(line)) {
        i++
        break
      }
      code.push(line)
      shifts.push(lines[i].length - line.length)
      i++
    }
    blocks.push({ lang, code: code.join("\n"), line: start, shifts })
  }
  return blocks
}

/** Every guide's blocks: each Markdown file under `dir`, with its path from the repository's root */
export const guideBlocks = (root, dir) => {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true })
    .filter((file) => file.endsWith(".md") || file.endsWith(".mdx"))
    .sort()
    .flatMap((file) => {
      const guide = path.relative(root, path.join(dir, file)).split(path.sep).join("/")
      return codeBlocks(fs.readFileSync(path.join(dir, file), "utf8")).map((block) => ({ guide, ...block }))
    })
}
