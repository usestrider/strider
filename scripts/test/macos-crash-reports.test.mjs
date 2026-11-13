import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { collect } from "../macos-crash-reports.mjs"

// A minimal minidump with the standard MiscInfo process-id stream and Exception stream.
const dump = (pid, timestamp) => {
  const bytes = Buffer.alloc(240)
  bytes.write("MDMP")
  bytes.writeUInt32LE(2, 8)
  bytes.writeUInt32LE(32, 12)
  bytes.writeUInt32LE(timestamp, 20)
  bytes.writeUInt32LE(15, 32)
  bytes.writeUInt32LE(12, 36)
  bytes.writeUInt32LE(56, 40)
  bytes.writeUInt32LE(6, 44)
  bytes.writeUInt32LE(168, 48)
  bytes.writeUInt32LE(68, 52)
  bytes.writeUInt32LE(12, 56)
  bytes.writeUInt32LE(1, 60)
  bytes.writeUInt32LE(pid, 64)
  bytes.writeUInt32LE(17, 68) // exception thread
  bytes.writeUInt32LE(0x80000003, 76) // deliberate trap
  return bytes
}
const fixture = async (run) => {
  const root = await mkdtemp(path.join(tmpdir(), "macos-capture-test-"))
  try {
    const output = path.join(root, "output"), database = path.join(root, "database"), system = path.join(root, "system")
    await Promise.all([mkdir(output), mkdir(path.join(database, "completed"), { recursive: true }), mkdir(system)])
    const started = new Date(Date.now() - 3000).toISOString()
    await writeFile(path.join(output, "capture-status.json"), JSON.stringify({ started }))
    await run({ output, database, system, started })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const status = async (output) => JSON.parse(await readFile(path.join(output, "capture-status.json"), "utf8"))

test("retains Crashpad files outside deleted profiles and verifies the deliberate renderer by PID and dump time", () =>
  fixture(async ({ output, database, system, started }) => {
    const native = dump(1234, Math.floor(Date.now() / 1000))
    await writeFile(path.join(database, "completed", "renderer.dmp"), native)
    await writeFile(
      path.join(output, "deliberate-crash.json"),
      JSON.stringify({
        started,
        observed: new Date().toISOString(),
        targetId: "intentional-page",
        rendererPids: [1234],
        browserPid: 1200
      })
    )
    await collect(output, [system], database)
    const result = await status(output)
    assert.equal(result.nativeReports, "present")
    assert.equal(result.verification.state, "verified")
    assert.equal(result.reports[0].minidump.pid, 1234)
    assert.deepEqual(await readFile(path.join(output, result.reports[0].artifact)), native)
  }))

test("never verifies an unrelated PID, old dump, or malformed minidump", () =>
  fixture(async ({ output, database, system, started }) => {
    await writeFile(path.join(database, "completed", "other.dmp"), dump(999, Math.floor(Date.now() / 1000)))
    await writeFile(path.join(database, "completed", "old.dmp"), dump(1234, 1))
    await writeFile(path.join(database, "completed", "bad.dmp"), "MDMP")
    await writeFile(
      path.join(output, "deliberate-crash.json"),
      JSON.stringify({ started, observed: new Date().toISOString(), rendererPids: [1234] })
    )
    await collect(output, [system], database)
    const result = await status(output)
    assert.equal(result.verification.state, "missing")
    assert.ok(result.errors.some((error) => error.source.endsWith("bad.dmp")))
  }))

test("bounds file count, skips symlinks, and records missing native database explicitly", () =>
  fixture(async ({ output, database, system }) => {
    await Promise.all(
      Array.from({ length: 33 }, (_, i) => writeFile(path.join(database, "completed", `${i}.dmp`), dump(1234, 1)))
    )
    await symlink(path.join(database, "completed", "0.dmp"), path.join(system, "Chrome.crash"))
    await collect(output, [system], database)
    let result = await status(output)
    assert.equal(result.reports.filter((report) => report.copied).length, 32)
    assert.ok(result.reports.some((report) => report.omitted))
    await rm(database, { recursive: true })
    await collect(output, [system], database)
    result = await status(output)
    assert.equal(result.nativeReports, "absent")
    assert.ok(result.errors.some((error) => error.source.includes("database")))
  }))

test("retains recent OS fallback reports and excludes unrelated or old system files", () =>
  fixture(async ({ output, database, system }) => {
    await writeFile(path.join(system, "Chrome.crash"), "native OS stack")
    await writeFile(path.join(system, "Firefox.crash"), "unrelated")
    await writeFile(path.join(system, "Chrome-old.ips"), "old")
    await utimes(path.join(system, "Chrome-old.ips"), 1, 1)
    await collect(output, [system], database)
    const result = await status(output)
    assert.equal(result.nativeReports, "present")
    assert.equal(result.reports.length, 1)
    assert.equal(result.verification.state, "not-observed")
  }))
