// Writes the README npm shows for `@usestrider/browser` from the repository's: npm reads the one in the package and
// GitHub the one at the root, so a second copy written by hand would drift. It leaves out what's for working on the
// repository, and points relative links at GitHub, since they'd resolve against the wrong place on npm. Run from the
// repository root; `pnpm check` runs it with `--check`.
import * as fs from "node:fs"
import * as path from "node:path"

const target = "packages/browser/README.md"
const repository = "https://github.com/usestrider/strider/blob/main/"
const notice = "<!-- Generated from the repository's README.md by `pnpm readme`. Edit that one. -->\n\n"

/** The README's text with a level-two section removed, up to the next one. */
const withoutSection = (text, title) => text.replace(new RegExp(`^## ${title}\\n[\\s\\S]*?(?=^## )`, "m"), "")

/** The text with its relative links made absolute, leaving code blocks alone. */
const withAbsoluteLinks = (text) =>
  text.split(/(^```[\s\S]*?^```$)/m).map((part, index) =>
    index % 2 === 1
      ? part
      : part.replace(/\]\((?![a-z]+:|#)([^)\s]+)\)/g, (_, link) => `](${repository}${link})`)
  ).join("")

export const render = (source) =>
  notice + withAbsoluteLinks(withoutSection(source, "Contributing")).replace(/^# Strider$/m, "# @usestrider/browser")

export const readme = (root, check) => {
  const file = path.join(root, target)
  const rendered = render(fs.readFileSync(path.join(root, "README.md"), "utf8"))
  if (!check) {
    fs.writeFileSync(file, rendered)
    return 0
  }
  if (fs.readFileSync(file, "utf8") === rendered) return 0
  process.stderr.write(`${target} doesn't match README.md: run \`pnpm readme\`\n`)
  return 1
}
