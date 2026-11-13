import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const command = path.resolve(import.meta.dirname, "../playwright-matrix-compare.mjs")
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n")
const fixture = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strider-legacy-matrix-"))
  try {
    fs.mkdirSync(`${dir}/curated/rows`, { recursive: true })
    const metadata = {
      schemaVersion: 1,
      upstreamVersion: "1.0",
      evidence: ["b.ts", "a.ts"],
      scopeDecisions: [{ id: "scope", rows: ["second"] }],
      patchedBrowserNotes: [{ id: "patch", evidence: [{ line: 10 }] }]
    }
    const rows = [
      {
        id: "first",
        status: "has",
        notes: "Reviewed",
        api: [{ symbol: "A.member" }],
        requirements: [{ quote: "source" }],
        browserOverrides: { "webkit.attached": { status: "missing" } }
      },
      { id: "second", status: "missing", notes: "Not built", upstream: ["B.method"] }
    ]
    const legacy = {
      ...metadata,
      evidence: { "a.ts": "old digest", "b.ts": "another digest" },
      rows: [...rows].reverse().map((row) => ({ ...row, browsers: { arbitrary: "old computed status" } }))
    }
    write(`${dir}/legacy.json`, legacy)
    write(`${dir}/curated/metadata.json`, metadata)
    for (const row of rows) write(`${dir}/curated/rows/${row.id}.json`, row)
    const snapshot = () =>
      ["legacy.json", "curated/metadata.json", ...fs.readdirSync(`${dir}/curated/rows`).map((f) => `curated/rows/${f}`)]
        .map((f) => [f, fs.readFileSync(`${dir}/${f}`, "utf8")])
    const compare = () => {
      const before = snapshot()
      const result = spawnSync(process.execPath, [command, `${dir}/legacy.json`, `${dir}/curated`], {
        encoding: "utf8"
      })
      assert.deepEqual(snapshot(), before, "comparison must never rewrite any inputs")
      return { status: result.status, output: result.stdout + result.stderr }
    }
    body({ dir, metadata, rows, legacy, compare })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("compares every curated field while ignoring only derived hashes, browser statuses and ordering", () =>
  fixture(({ compare }) => {
    const result = compare()
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /2 rows.*2 evidence paths.*equivalent/)
  }))

test("reports lost classifications, notes, requirements, overrides and provenance without writing", () =>
  fixture(({ dir, rows, compare }) => {
    for (
      const [field, value] of [["status", "missing"], ["notes", "stale"], ["api", []], ["requirements", []], [
        "browserOverrides",
        {}
      ]]
    ) {
      write(`${dir}/curated/rows/first.json`, { ...rows[0], [field]: value })
      const result = compare()
      assert.equal(result.status, 1, result.output)
      assert.match(result.output, new RegExp(`changed row first.*${field}`))
    }
  }))

test("reports missing and added rows and shared metadata or evidence-path changes", () =>
  fixture(({ dir, metadata, compare }) => {
    fs.rmSync(`${dir}/curated/rows/second.json`)
    write(`${dir}/curated/rows/third.json`, { id: "third", status: "missing" })
    write(`${dir}/curated/metadata.json`, { ...metadata, evidence: ["a.ts"], patchedBrowserNotes: [] })
    const result = compare()
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /missing row second/)
    assert.match(result.output, /added row third/)
    assert.match(result.output, /changed metadata evidence/)
    assert.match(result.output, /changed metadata patchedBrowserNotes/)
  }))

test("rejects duplicate legacy IDs rather than hiding a row", () =>
  fixture(({ dir, legacy, compare }) => {
    write(`${dir}/legacy.json`, { ...legacy, rows: [legacy.rows[0], legacy.rows[0]] })
    const result = compare()
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /Duplicate legacy row ID/)
  }))
