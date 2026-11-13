import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { assertApiLink, assertDecision, assertValueGaps } from "../packages/tools/docs/src/matrix-evidence.ts"
import { commit, extract } from "./playwright-reference.mjs"

import { deriveMatrix, loadCuratedMatrix } from "./playwright-matrix/data.mjs"

const root = "scripts/playwright-matrix/"
const read = (file) => JSON.parse(readFileSync(file, "utf8"))
const upstream = read(`${root}upstream.json`)
const curated = loadCuratedMatrix()
const currentBrowsers = read(".data/api-reference/capabilities.json")
const matrix = deriveMatrix(curated, currentBrowsers)
const members = new Map(upstream.members.map((member) => [member.id, member]))
const statuses = new Set(["has", "different", "missing"])
const args = process.argv.slice(2)
const argument = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
assert.ok(
  !args.includes("--refresh-browsers") && !args.includes("--refresh-evidence"),
  "Refresh flags were removed: review curated rows; current statuses and hashes are generated automatically"
)

assert.equal(upstream.commit, commit)
assert.equal(upstream.version, matrix.upstreamVersion)
assert.equal(members.size, upstream.members.length, "Duplicate upstream member IDs")
assert.equal(new Set(matrix.rows.map((row) => row.id)).size, matrix.rows.length, "Duplicate row IDs")
assertValueGaps(matrix.rows)
for (const decision of [...matrix.scopeDecisions, ...matrix.selectorDecisions]) {
  assert.ok(decision.rows.length > 0, `${decision.id}: scope decision needs affected rows`)
  for (const id of decision.rows) {
    const row = matrix.rows.find((row) => row.id === id)
    assert.ok(row && row.status === "missing", `${decision.id}: scope must preserve a missing row: ${id}`)
  }
}
for (const note of matrix.patchedBrowserNotes) {
  assert.ok(
    note.scope === "build" || note.scope === "feature" && note.rows.length > 0,
    `${note.id}: feature patch needs affected rows`
  )
  for (const id of note.rows) {
    assert.ok(
      matrix.rows.some((row) => row.id === id && row.patches?.includes(note.id)),
      `${note.id}: affected row missing reverse dependency`
    )
  }
}
const covered = new Set()
for (const row of matrix.rows) {
  assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(statuses.has(row.status), `${row.id}: invalid classification`)
  if (row.status !== "has") assert.ok(row.notes.trim(), `${row.id}: missing explanation`)
  assert.ok(row.upstream.length > 0, `${row.id}: missing upstream ownership`)
  for (const id of row.upstream) {
    assert.ok(members.has(id), `${row.id}: unknown upstream member ${id}`)
    if (row.option) {
      assert.ok(members.get(id).options.includes(row.option), `${row.id}: unknown option`)
      if (!row.value) {
        for (const value of members.get(id).optionValues[row.option] ?? []) {
          assert.ok(
            row.valueCoverage?.some((entry) => entry.value === value),
            `${row.id}: upstream value ${value} omitted`
          )
        }
      }
    } else if (!row.value) covered.add(id)
  }
  assert.ok(
    Object.values(row.browsers).every((entry) => statuses.has(entry.status)),
    `${row.id}: invalid browser classification`
  )
  assert.ok(
    (row.valueCoverage ?? []).every((entry) => statuses.has(entry.status)),
    `${row.id}: invalid value classification`
  )
  for (const requirement of row.requirements ?? []) {
    assert.ok(
      (requirement.capability || requirement.unavailable?.length) && requirement.file && requirement.quote,
      `${row.id}: access requirement needs evidence`
    )
    assert.ok(
      readFileSync(requirement.file, "utf8").replace(/\s+/g, " ").includes(requirement.quote.replace(/\s+/g, " ")),
      `${row.id}: access evidence missing`
    )
  }
  for (const api of row.api) assertApiLink(api)
  if (row.status !== "missing") assert.ok(row.api.length > 0, `${row.id}: supported capability needs API evidence`)
  if (row.status === "different") {
    assert.ok(row.decision, `${row.id}: missing decision`)
    assertDecision(row.decision)
  }
  for (const patch of row.patches ?? []) {
    assert.ok(
      matrix.patchedBrowserNotes.some((note) => note.id === patch && note.rows.includes(row.id)),
      `${row.id}: patch dependency not bidirectional`
    )
  }
}
for (const member of members.values()) {
  for (const option of member.options) {
    assert.ok(
      matrix.rows.some((row) => row.upstream.includes(member.id) && row.option === option),
      `${member.id}: option ${option} omitted`
    )
  }
}
assert.deepEqual([...covered].sort(), [...members.keys()].sort(), "Reference completeness failure")
const checkout = argument("--upstream")
if (checkout) {
  assert.deepEqual(extract(checkout), upstream, "Upstream inventory differs from the pinned checkout")
  for (const note of matrix.patchedBrowserNotes) {
    for (const source of note.evidence) {
      const body = readFileSync(resolve(checkout, source.file), "utf8")
      assert.ok(body.includes(source.text), `${note.id}: patch evidence missing`)
      assert.equal(body.slice(0, body.indexOf(source.text)).split("\n").length, source.line)
      assert.equal(source.url, `https://github.com/microsoft/playwright/blob/${commit}/${source.file}#L${source.line}`)
    }
  }
}

// The inventory isn't published, so the built check confirms that the reference pages its API links name were rendered
if (args.includes("--built")) {
  const urls = new Set(
    matrix.rows.flatMap((row) => row.api.map((api) => api.url)).filter((url) => url.startsWith("/docs"))
  )
  for (const url of urls) {
    const [pathname, fragment] = url.split("#")
    const file = `website/dist${pathname.replace(/\/$/, "")}/index.html`
    assert.ok(existsSync(file), `Broken built link ${url}`)
    if (fragment) {
      assert.ok(
        readFileSync(file, "utf8").includes(`id="${decodeURIComponent(fragment)}"`),
        `Broken built anchor ${url}`
      )
    }
  }
  process.stdout.write(`Checked ${urls.size} built API reference links.\n`)
}
mkdirSync(".data/playwright-matrix", { recursive: true })
writeFileSync(".data/playwright-matrix/matrix.json", `${JSON.stringify(matrix, null, 2)}\n`)
writeFileSync(".data/playwright-matrix/browsers.json", `${JSON.stringify(currentBrowsers, null, 2)}\n`)
process.stdout.write(
  `Playwright ${upstream.version}: ${upstream.classes.length} classes, ${members.size} members covered by ${matrix.rows.length} rows; provenance, API links, decisions and browser statuses valid.\n`
)
