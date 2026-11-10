/** Hosted per-phase attribution of the upload and response scenarios; instrument head only, never a timing result. */
import * as assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const phaseDiagnostic = (options: {
  roots: { base: string; head: string; driver: string }
  output: string
  runs: number
}) => {
  const { roots, output, runs } = options
  const directory = path.join(output, "phase-diagnostic")
  fs.mkdirSync(directory, { recursive: true })
  const files = ["phase-profile.ts", "phase-profile-model.ts"]
  const hashes: Record<string, string> = {}
  for (const file of files) {
    const relative = `packages/scenarios/benchmark/${file}`
    const bytes = fs.readFileSync(path.join(roots.driver, relative))
    fs.mkdirSync(path.dirname(path.join(roots.head, relative)), { recursive: true })
    fs.writeFileSync(path.join(roots.head, relative), bytes)
    fs.writeFileSync(path.join(directory, file), bytes)
    hashes[file] = createHash("sha256").update(bytes).digest("hex")
  }
  // The fixture is the one the uninstrumented scenarios use
  fs.copyFileSync(
    path.join(roots.driver, "packages/scenarios/src/site.ts"),
    path.join(roots.head, "packages/scenarios/src/site.ts")
  )
  const manifest = {
    status: "running",
    runs,
    warmup: 3,
    scenarios: ["upload", "response"],
    hashes,
    profiledRole: "head"
  }
  const save = () => fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2))
  save()
  const log = fs.openSync(path.join(directory, "profile.log"), "w")
  try {
    const result = spawnSync(process.execPath, [
      "packages/scenarios/benchmark/phase-profile.ts",
      path.join(directory, "report.json"),
      String(runs)
    ], { cwd: roots.head, env: process.env, stdio: ["ignore", log, log], timeout: 30 * 60_000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, "Phase diagnostic failed; see profile.log")
    const report = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"))
    assert.equal(report.status, "completed")
    assert.equal(report.samples.length, 2 * 2 * (runs + 3))
    manifest.status = "complete"
  } finally {
    fs.closeSync(log)
    if (manifest.status !== "complete") manifest.status = "failed"
    save()
    const table = fs.existsSync(path.join(directory, "phases.md"))
      ? fs.readFileSync(path.join(directory, "phases.md"), "utf8")
      : "No phase table was written."
    fs.writeFileSync(
      path.join(output, "phase-summary.md"),
      `Phase diagnostic: **${manifest.status}**.\n\nAttribution only: head profiled with timing marks between steps, ${runs} alternating pairs after three warmups; the paired comparison, not this, gives ratios.\n\n${table}\n`
    )
  }
}
