// Read-only migration check: a legacy comparison versus the current curated rows and metadata.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { loadCuratedMatrix } from "./playwright-matrix/data.mjs"

try {
  const [file, root = "scripts/playwright-matrix", ...extra] = process.argv.slice(2)
  assert.ok(file && extra.length === 0, "usage: pnpm matrix:compare <legacy-matrix.json> [curated-directory]")
  const legacy = JSON.parse(readFileSync(file, "utf8"))
  assert.ok(Array.isArray(legacy.rows), "Legacy matrix needs a rows array")
  assert.ok(
    legacy.evidence && typeof legacy.evidence === "object" && !Array.isArray(legacy.evidence),
    "Legacy matrix needs an evidence hash map"
  )
  const current = loadCuratedMatrix(root)
  const expected = new Map()
  for (const { browsers: _browsers, ...row } of legacy.rows) {
    assert.ok(typeof row.id === "string", "Legacy row needs an ID")
    assert.ok(!expected.has(row.id), `Duplicate legacy row ID: ${row.id}`)
    expected.set(row.id, row)
  }
  const actual = new Map(current.rows.map((row) => [row.id, row]))
  const changes = []
  for (const [id, row] of expected) {
    if (!actual.has(id)) changes.push(`missing row ${id}`)
    else if (!isDeepStrictEqual(row, actual.get(id))) {
      const fields = [...new Set([...Object.keys(row), ...Object.keys(actual.get(id))])]
        .filter((field) => !isDeepStrictEqual(row[field], actual.get(id)[field]))
      changes.push(`changed row ${id} (${fields.join(", ")})`)
    }
  }
  for (const id of actual.keys()) if (!expected.has(id)) changes.push(`added row ${id}`)
  const { rows: _legacyRows, evidence: hashes, ...expectedMetadata } = legacy
  const { rows: _currentRows, evidence: paths, ...actualMetadata } = current
  expectedMetadata.evidence = Object.keys(hashes).sort()
  actualMetadata.evidence = [...paths].sort()
  for (const field of new Set([...Object.keys(expectedMetadata), ...Object.keys(actualMetadata)])) {
    if (!isDeepStrictEqual(expectedMetadata[field], actualMetadata[field])) changes.push(`changed metadata ${field}`)
  }
  if (changes.length > 0) {
    process.stdout.write(changes.join("\n") + "\n")
    process.exitCode = 1
  } else {
    process.stdout.write(`${expected.size} rows, ${paths.length} evidence paths and all curated metadata equivalent.\n`)
  }
} catch (error) {
  process.stderr.write(`matrix comparison: ${error.message}\n`)
  process.exitCode = 1
}
