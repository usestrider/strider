// Curated classifications are inputs; statuses and digests describe the current source tree.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file) => JSON.parse(readFileSync(file, "utf8"))
export const loadCuratedMatrix = (root = "scripts/playwright-matrix") => {
  const metadata = read(join(root, "metadata.json"))
  assert.ok(!Object.hasOwn(metadata, "rows"), "Curated metadata must not contain rows")
  assert.ok(Array.isArray(metadata.evidence), "Curated evidence must list paths, not derived hashes")
  assert.equal(new Set(metadata.evidence).size, metadata.evidence.length, "Duplicate evidence paths")
  for (const field of ["browsers", "browserSnapshot"]) {
    assert.ok(!Object.hasOwn(metadata, field), `Curated metadata contains derived ${field}`)
  }
  const rows = readdirSync(join(root, "rows")).sort().map((file) => {
    assert.match(file, /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/, "Invalid row filename")
    const row = read(join(root, "rows", file))
    assert.equal(file, `${row.id}.json`, "Row filename must match its stable ID")
    assert.ok(!Object.hasOwn(row, "browsers"), `${row.id}: derived browsers belong in ignored output`)
    assert.ok(!Object.hasOwn(row, "evidence"), `${row.id}: derived evidence belongs in ignored output`)
    return row
  })
  return { ...metadata, rows }
}

// Browser statuses are derived from explicit capability requirements, with the inspector-only access boundary.
export const browserStatuses = (row, currentBrowsers) => {
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

export const deriveMatrix = (matrix, currentBrowsers) => ({
  ...matrix,
  rows: matrix.rows.map((row) => ({ ...row, browsers: browserStatuses(row, currentBrowsers) })),
  evidence: Object.fromEntries(matrix.evidence.map((file) => [
    file,
    createHash("sha256").update(readFileSync(file)).digest("hex")
  ]))
})
