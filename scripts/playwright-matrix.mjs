import assert from "node:assert/strict"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
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
  const member = members.get(row.upstream[0])
  const result = {}
  for (const backend of currentBrowsers.backends) {
    for (const mode of ["launched", "attached"]) {
      const entries = new Map((backend[mode] ?? []).map((entry) => [entry.name, entry]))
      let status = row.status
      const limitations = []
      for (const capability of row.capabilities) {
        const entry = entries.get(capability)
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
      if (backend.id === "webkit" && mode === "attached" && row.status !== "missing") {
        const writes =
          "newPage newContext goto reload goBack goForward close click dblclick check uncheck clear fill focus hover press pressSequentially type selectOption setInputFiles tap dragTo dragAndDrop"
            .split(" ")
        if (["Keyboard", "Mouse", "Touchscreen"].includes(member.class) || writes.includes(member.name)) {
          status = "missing"
          limitations.push("Attached stock WebKit has no Automation session for this operation.")
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
const covered = new Set()
for (const row of matrix.rows) {
  assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(statuses.has(row.status), `${row.id}: invalid classification`)
  if (row.status !== "has") assert.ok(row.notes.trim(), `${row.id}: missing explanation`)
  assert.ok(row.upstream.length > 0, `${row.id}: missing upstream ownership`)
  for (const id of row.upstream) {
    assert.ok(members.has(id), `${row.id}: unknown upstream member ${id}`)
    if (row.option) assert.ok(members.get(id).options.includes(row.option), `${row.id}: unknown option`)
    else covered.add(id)
  }
  assert.deepEqual(row.browsers, browserStatuses(row), `${row.id}: browser statuses drifted; review and refresh`)
  for (const api of row.api) {
    assert.ok(api.url.startsWith(`/docs/api/browser/${api.module}#`), `${row.id}: invalid API link`)
    const model = read(`.data/api-reference/browser/modules/${api.module}.json`).children[0].children
    const anchor = api.url.split("#")[1]
    const declaration = model.find((child) => child.name === anchor)
    assert.ok(declaration, `${row.id}: API declaration ${anchor} not exported`)
    assert.ok(
      declaration.name === api.symbol || declaration.children?.some((child) => child.name === api.symbol),
      `${row.id}: API symbol ${api.symbol} not declared`
    )
  }
  if (row.status !== "missing") assert.ok(row.api.length > 0, `${row.id}: supported capability needs API evidence`)
  if (row.status === "different") {
    assert.ok(row.decision, `${row.id}: different needs a decision`)
    const decisions = readFileSync(row.decision.file, "utf8")
    const headings = [...decisions.matchAll(/^## (.+)$/gm)].map((match) =>
      match[1].toLowerCase().replace(/[^\w -]/g, "").replaceAll(" ", "-")
    )
    assert.ok(headings.includes(row.decision.anchor), `${row.id}: decision anchor missing`)
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
