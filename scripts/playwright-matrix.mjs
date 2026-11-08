import assert from "node:assert/strict"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { assertApiLink, assertDecision, assertValueGaps } from "../packages/tools/docs/src/matrix-evidence.ts"
import { commit, extract, hash } from "./playwright-reference.mjs"

const root = "website/src/features/playwright/"
const read = (file) => JSON.parse(readFileSync(file, "utf8"))
const upstream = read(`${root}upstream.json`)
const matrix = read(`${root}matrix.json`)
const browserSnapshot = read(`${root}browsers.json`)
const currentBrowsers = read(".data/api-reference/capabilities.json")
const members = new Map(upstream.members.map((member) => [member.id, member]))
const statuses = new Set(["has", "different", "missing"])
const args = process.argv.slice(2)
const argument = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const write = (name, data) => writeFileSync(`${root}${name}.json`, `${JSON.stringify(data, null, 2)}\n`)

// Browser statuses are derived from explicit capability requirements, with the inspector-only access boundary.
const browserStatuses = (row) => {
  const result = {}
  for (const backend of currentBrowsers.backends) {
    for (const mode of ["launched", "attached"]) {
      const entries = new Map((backend[mode] ?? []).map((entry) => [entry.name, entry]))
      let status = row.status
      const limitations = []
      const requirements = [...row.capabilities.map((capability) => ({ capability })), ...(row.requirements ?? [])]
      for (const requirement of requirements) {
        if (requirement.unavailable) {
          if (requirement.unavailable.includes(`${backend.id}.${mode}`)) {
            status = "missing"
            limitations.push(requirement.quote)
          }
          continue
        }
        const capability = requirement.capability
        const candidates = [capability, ...(requirement.alternatives ?? [])].map((name) => entries.get(name)).filter(
          Boolean
        )
        const entry = candidates.find((entry) => entry.status === "supported") ?? candidates.find((entry) =>
          entry.status === "partial"
        ) ?? candidates[0]
        if (!entry) {
          limitations.push(`Capability ${capability} is not reported.`)
          status = "missing"
        } else {
          limitations.push(...entry.limitations)
          if (
            ["unsupported", "unknown"].includes(entry.status) &&
            !(capability === "capability.video" && row.configuration?.[backend.id])
          ) status = "missing"
          if (entry.status === "partial" && entry.limitations.length === 0) limitations.push("Partial adapter support.")
        }
      }
      result[`${backend.id}.${mode}`] = row.browserOverrides?.[`${backend.id}.${mode}`] ??
        { status, limitations: [...new Set(limitations)] }
    }
  }
  return result
}

if (args.includes("--refresh-browsers")) {
  for (const row of matrix.rows) row.browsers = browserStatuses(row)
  write("browsers", currentBrowsers)
  write("matrix", matrix)
  process.stdout.write("Refreshed browser statuses; review the diff before accepting new evidence.\n")
}
if (args.includes("--refresh-evidence")) {
  for (const file of Object.keys(matrix.evidence)) matrix.evidence[file] = hash(readFileSync(file))
  write("matrix", matrix)
  process.stdout.write("Refreshed evidence hashes; classifications require human review.\n")
}

assert.equal(upstream.commit, commit)
assert.equal(upstream.version, matrix.upstreamVersion)
assert.equal(members.size, upstream.members.length, "Duplicate upstream member IDs")
assert.equal(new Set(matrix.rows.map((row) => row.id)).size, matrix.rows.length, "Duplicate row IDs")
assertValueGaps(matrix.rows)
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
  assert.deepEqual(row.browsers, browserStatuses(row), `${row.id}: browser statuses drifted; review and refresh`)
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
if (!args.includes("--refresh-browsers")) {
  assert.deepEqual(browserSnapshot, currentBrowsers, "Adapter capability snapshot drifted")
}
for (const [file, digest] of Object.entries(matrix.evidence)) {
  assert.equal(
    hash(readFileSync(file)),
    digest,
    `${file}: source changed; review classifications before refreshing evidence`
  )
}

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

if (args.includes("--built")) {
  const html = readFileSync("website/dist/docs/playwright-matrix/index.html", "utf8")
  for (const row of matrix.rows) assert.ok(html.includes(`id="${row.id}"`), `Built page omitted ${row.id}`)
  const urls = new Set(
    [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).filter((url) => url.startsWith("/docs"))
  )
  for (const url of urls) {
    const [pathname, fragment] = url.split("#")
    const file = pathname.endsWith(".json")
      ? `website/dist${pathname}`
      : `website/dist${pathname.replace(/\/$/, "")}/index.html`
    assert.ok(existsSync(file), `Broken built link ${url}`)
    if (fragment) {
      assert.ok(
        readFileSync(file, "utf8").includes(`id="${decodeURIComponent(fragment)}"`),
        `Broken built anchor ${url}`
      )
    }
  }
  const downloaded = read("website/dist/docs/playwright-matrix.json")
  assert.deepEqual(downloaded, { matrix, upstream, browsers: currentBrowsers }, "Machine-readable download drifted")
  process.stdout.write(`Checked ${urls.size} local built links and all row anchors.\n`)
}
process.stdout.write(
  `Playwright ${upstream.version}: ${upstream.classes.length} classes, ${members.size} members covered by ${matrix.rows.length} rows; provenance, API links, decisions and browser statuses valid.\n`
)
