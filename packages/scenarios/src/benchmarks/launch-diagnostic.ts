/** Hosted launch attribution only; never a production performance comparison. */
import * as assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const launchDiagnostic = (options: {
  roots: { base: string; head: string; driver: string }
  output: string
  runs: number
}) => {
  const { roots, output, runs } = options
  // One source is profiled; base is provenance only, never an unmeasured comparison role.
  for (
    const file of [
      "packages/scenarios/benchmark/launch-profile.ts",
      "packages/scenarios/benchmark/native-launch-trace.ts",
      "packages/scenarios/test/NativeLaunchTrace.test.ts",
      "packages/scenarios/benchmark/launch-profile-hooks.mjs",
      "packages/scenarios/test/LaunchProfile.test.ts"
    ]
  ) {
    const bytes = fs.readFileSync(path.join(roots.driver, file))
    const retained = path.join(output, "driver", file)
    fs.mkdirSync(path.dirname(retained), { recursive: true })
    fs.writeFileSync(retained, bytes)
    fs.writeFileSync(path.join(roots.head, file), bytes)
  }
  fs.copyFileSync(import.meta.filename, path.join(output, "launch-diagnostic.ts"))
  const directory = path.join(output, "launch-diagnostic")
  fs.mkdirSync(directory, { recursive: true })
  const manifest = {
    kind: "instrumented-launch-diagnostic",
    status: "running",
    runs,
    warmup: 3,
    profiledRole: "head",
    tooling: "driver launch profiler, hooks and regression tests overlaid on head; base is provenance only",
    files: Object.fromEntries(
      ["launch-profile.ts", "launch-profile-hooks.mjs", "native-launch-trace.ts"].map((name) => [
        name,
        createHash("sha256").update(fs.readFileSync(path.join(roots.head, "packages/scenarios/benchmark", name)))
          .digest("hex")
      ])
    )
  }
  const save = () => fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2))
  const run = (name: string, command: string, args: Array<string>, env: Record<string, string> = {}) => {
    const log = fs.openSync(path.join(directory, `${name}.log`), "w")
    try {
      const result = spawnSync(command, args, {
        cwd: roots.head,
        env: { ...process.env, ...env, STRIDER_LAUNCH_TEST_OUTPUT: path.join(directory, "regressions") },
        stdio: ["ignore", log, log],
        timeout: 15 * 60_000
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, `${name} failed; see launch-diagnostic/${name}.log`)
    } finally {
      fs.closeSync(log)
    }
  }
  save()
  try {
    run("regressions", "pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "vitest.config.ts",
      "packages/scenarios/test/LaunchProfile.test.ts",
      "packages/scenarios/test/NativeLaunchTrace.test.ts",
      "--reporter=json",
      `--outputFile=${path.join(directory, "regression-results.json")}`
    ])
    const regressions = JSON.parse(fs.readFileSync(path.join(directory, "regression-results.json"), "utf8"))
    assert.equal(regressions.numTotalTests, 20)
    assert.equal(regressions.numPassedTests, 20)
    assert.equal(regressions.numPendingTests, 0)
    assert.equal(regressions.numFailedTests, 0)
    // Phase-only controls bound native tracing perturbation; these sequential blocks are not a speedup comparison.
    for (const mode of ["phase-baseline", "native-baseline", "native-control", "phase-control"]) {
      const target = path.join(directory, mode)
      fs.mkdirSync(target, { recursive: true })
      run(mode, process.execPath, [
        "--import",
        path.join(roots.head, "packages/scenarios/benchmark/launch-profile-hooks.mjs"),
        path.join(roots.head, "packages/scenarios/benchmark/launch-profile.ts"),
        path.join(target, "report.json"),
        String(runs)
      ], {
        STRIDER_LAUNCH_NATIVE: mode.startsWith("native") ? "1" : "0",
        STRIDER_LAUNCH_CONTROL: mode.endsWith("control") ? "1" : "0"
      })
      const report = JSON.parse(fs.readFileSync(path.join(target, "report.json"), "utf8"))
      assert.equal(report.status, "completed")
      assert.equal(report.error, null)
      assert.equal(report.samples.length, 2 * (runs + 3))
    }
    manifest.status = "complete"
  } finally {
    if (manifest.status !== "complete") manifest.status = "failed"
    save()
    fs.writeFileSync(
      path.join(output, "launch-summary.md"),
      [
        `Launch diagnostic status: **${manifest.status}**.`,
        "Diagnostic only: instrumented head Strider versus its pinned Playwright, after rejection and complete-report regressions.",
        `${runs} alternating pairs per block after three warmup pairs: phase-baseline, native-baseline, native-control, phase-control. Base is provenance only.`,
        "Control adds only --disable-extensions to Strider. Sequential phase-only/native blocks expose perturbation but do not isolate overhead from runner drift.",
        "Launch ends at Browser availability; initial-page gate observation and cleanup are outside timing.",
        "Defaults retain different initial resources, sandbox settings and readiness. Overlapping spans must not be summed.",
        "Complete native startup traces, causal clock bounds, raw phase/protocol observations, spawn argv, liveness and partial failures are retained in launch-diagnostic/.",
        "These observations establish no speedup or parity result. Failed/partial reports are not timing evidence.",
        ""
      ].join("\n")
    )
  }
}
