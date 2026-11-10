/** Hosted navigation attribution; instrument head only, with base retained for provenance. */
import * as assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const navigationDiagnostic = (options: {
  roots: { base: string; head: string; driver: string }
  output: string
  runs: number
}) => {
  const { roots, output, runs } = options
  const directory = path.join(output, "navigation-diagnostic")
  fs.mkdirSync(directory, { recursive: true })
  const files = ["navigation-profile.ts", "navigation-profile-hooks.mjs", "navigation-profile-model.ts"]
  const hashes: Record<string, string> = {}
  for (const file of files) {
    const relative = `packages/scenarios/benchmark/${file}`
    const bytes = fs.readFileSync(path.join(roots.driver, relative))
    fs.writeFileSync(path.join(roots.head, relative), bytes)
    fs.writeFileSync(path.join(directory, file), bytes)
    hashes[file] = createHash("sha256").update(bytes).digest("hex")
  }
  // Fixture is identical to the ordinary navigate control's local fixture.
  fs.copyFileSync(
    path.join(roots.driver, "packages/scenarios/src/site.ts"),
    path.join(roots.head, "packages/scenarios/src/site.ts")
  )
  fs.copyFileSync(import.meta.filename, path.join(directory, "navigation-diagnostic.ts"))
  const manifest = {
    status: "running",
    runs,
    warmup: 3,
    tracePairs: 4,
    hashes,
    profiledRole: "head",
    base: "provenance only"
  }
  const save = () => fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2))
  save()
  const log = fs.openSync(path.join(directory, "profile.log"), "w")
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "./packages/scenarios/benchmark/navigation-profile-hooks.mjs",
      "packages/scenarios/benchmark/navigation-profile.ts",
      path.join(directory, "report.json"),
      String(runs)
    ], { cwd: roots.head, env: process.env, stdio: ["ignore", log, log], timeout: 15 * 60_000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, "Navigation diagnostic failed; see profile.log")
    const report = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"))
    assert.equal(report.status, "completed")
    assert.equal(report.samples.length, 2 * (runs + 3 + 4))
    manifest.status = "complete"
  } finally {
    fs.closeSync(log)
    if (manifest.status !== "complete") manifest.status = "failed"
    save()
    fs.writeFileSync(
      path.join(output, "navigation-summary.md"),
      `Navigation diagnostic: **${manifest.status}**.\n\nAttribution only; head profiled, base retained for provenance. ${runs} alternating pairs, three warmups, then four separately traced pairs. See navigation-diagnostic/ for phases, protocol dependencies and tooling. No parity or speedup claim.\n`
    )
  }
}
