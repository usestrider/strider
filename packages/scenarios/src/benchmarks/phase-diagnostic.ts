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
  const tracePairs = 8
  const directory = path.join(output, "phase-diagnostic")
  fs.mkdirSync(directory, { recursive: true })
  const files = ["phase-profile.ts", "phase-profile-model.ts", "phase-trace-hooks.mjs"]
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
    // The same samples again under the loader hooks that see every protocol message, apart from the timing run:
    // the hooks cost time of their own
    const traceLog = fs.openSync(path.join(directory, "trace.log"), "w")
    try {
      const traced = spawnSync(process.execPath, [
        "--import",
        "./packages/scenarios/benchmark/phase-trace-hooks.mjs",
        "packages/scenarios/benchmark/phase-profile.ts",
        path.join(directory, "trace", "report.json"),
        String(tracePairs),
        "trace"
      ], { cwd: roots.head, env: process.env, stdio: ["ignore", traceLog, traceLog], timeout: 15 * 60_000 })
      assert.ifError(traced.error)
      assert.equal(traced.status, 0, "Traced phase diagnostic failed; see trace.log")
    } finally {
      fs.closeSync(traceLog)
    }
    manifest.status = "complete"
  } finally {
    fs.closeSync(log)
    if (manifest.status !== "complete") manifest.status = "failed"
    save()
    const read = (file: string, none: string) =>
      fs.existsSync(path.join(directory, file)) ? fs.readFileSync(path.join(directory, file), "utf8") : none
    const table = `${read("phases.md", "No phase table was written.")}\n## Traced close\n\n${
      read("trace/phases.md", "").length === 0
        ? "No trace was written."
        : read("trace/close.md", "")
    }\n## Traced setInputFiles\n\n${read("trace/input.md", "")}`
    fs.writeFileSync(
      path.join(output, "phase-summary.md"),
      `Phase diagnostic: **${manifest.status}**.\n\nAttribution only: head profiled with timing marks between steps, ${runs} alternating pairs after three warmups; the paired comparison, not this, gives ratios.\n\n${table}\n`
    )
  }
}
