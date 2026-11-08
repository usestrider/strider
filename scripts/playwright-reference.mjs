// Extract names and provenance, not documentation prose, from a pinned Playwright checkout.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

export const commit = "606ecd8b34bac100db32561b6278ffd76e5eb3cd"
export const directories = ["api", "test-api", "test-reporter-api", "electron-api", "mobile-api"]
export const hash = (value) => createHash("sha256").update(value).digest("hex")
export const extract = (checkout) => {
  checkout = resolve(checkout)
  const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  if (revision !== commit) throw new Error(`Expected Playwright ${commit}; got ${revision}`)
  execFileSync("git", [
    "-C",
    checkout,
    "diff",
    "--exit-code",
    commit,
    "--",
    "docs/src",
    "utils/doclint",
    "utils/markdown.js"
  ], { stdio: "pipe" })
  const require = createRequire(import.meta.url)
  const { parseApi } = require(`${checkout}/utils/doclint/api_parser.js`)
  const files = {}
  const members = []
  const classes = []
  for (const directory of directories) {
    const root = `${checkout}/docs/src/${directory}`
    for (const file of readdirSync(root).filter((file) => file.endsWith(".md")).sort()) {
      const path = `docs/src/${directory}/${file}`
      files[path] = hash(readFileSync(`${checkout}/${path}`))
    }
    const docs = parseApi(root, `${checkout}/docs/src/api/params.md`)
    docs.filterForLanguage("js")
    for (const clazz of docs.classesArray) {
      const file = `docs/src/${directory}/class-${clazz.name.toLowerCase()}.md`
      const lines = readFileSync(`${checkout}/${file}`, "utf8").split("\n")
      classes.push({ name: clazz.name, directory, file, extends: clazz.extends })
      for (const member of clazz.membersArray) {
        const name = `${clazz.name}.${member.name}`
        const line = lines.findIndex((line) => line.startsWith("## ") && line.includes(`: ${name}`)) + 1
        if (line === 0) throw new Error(`No source heading for ${name}`)
        const options = member.argsArray.find((arg) => arg.name === "options")?.type.properties ?? []
        members.push({
          id: `${member.kind}:${name}`,
          class: clazz.name,
          name: member.name,
          kind: member.kind,
          directory,
          since: member.since,
          deprecated: Boolean(member.deprecated),
          file,
          line,
          options: options.map((option) => option.name).sort(),
          url: `https://github.com/microsoft/playwright/blob/${commit}/${file}#L${line}`
        })
      }
    }
  }
  return { version: "1.64.0", commit, language: "js", files, classes, members }
}
