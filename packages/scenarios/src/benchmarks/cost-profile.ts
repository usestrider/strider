/** Hosted diagnostic orchestration; never imported by the browser runtime. */
import * as assert from "node:assert/strict"
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

export const costProfile = async ({ roots, output, runs }: {
  roots: { base: string; head: string; driver: string }
  output: string
  runs: number
}) => {
  assert.equal(runs, 20, "Cost profiling requires exactly 20 repetitions")
  const files = ["benchmarks/cost-profile-worker.ts", "benchmarks/cost-profiler.ts", "benchmarks/cases.ts", "site.ts"]
  for (const file of ["benchmarks/cost-profile.ts", ...files]) {
    const dest = path.join(output, "driver", file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(roots.driver, "packages/scenarios/src", file), dest)
  }
  for (const root of [roots.base, roots.head]) {
    for (const file of files) {
      fs.copyFileSync(
        path.join(roots.driver, "packages/scenarios/src", file),
        path.join(root, "packages/scenarios/src", file)
      )
    }
  }
  // Reverse source order for the second case; no result-dependent repetition or retries.
  for (
    const [name, role] of [
      ["repeated-lifecycle", "base"],
      ["repeated-lifecycle", "head"],
      ["resources", "head"],
      ["resources", "base"]
    ] as const
  ) {
    const directory = path.join(output, "profiles", `${role}-${name}`)
    fs.mkdirSync(directory, { recursive: true })
    const log = fs.openSync(path.join(directory, "node-gc.log"), "w")
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [
          "--trace-gc",
          "--trace-gc-nvp",
          path.join(roots[role], "packages/scenarios/src/benchmarks/cost-profile-worker.ts"),
          name,
          directory
        ], { cwd: roots[role], env: process.env, stdio: ["ignore", log, log] })
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
          reject(new Error(`Profile deadline: ${role} ${name}`))
        }, 600_000)
        child.once("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once("exit", (code, signal) => {
          clearTimeout(timer)
          if (code === 0) resolve()
          else reject(new Error(`Profile failed: ${role} ${name}: ${code} ${signal}`))
        })
      })
    } finally {
      fs.closeSync(log)
    }
    const capture = JSON.parse(fs.readFileSync(path.join(directory, "capture.json"), "utf8"))
    assert.equal(capture.success, true, "Incomplete profile workload")
    const labels = ["browser-setup", "browser-cleanup"]
    for (let index = -3; index < 20; index++) {
      const label = index < 0 ? `warmup-${index + 3}` : `workload-${index}`
      labels.push(label)
      if (name === "resources") labels.push(`${label}-setup`, `${label}-cleanup`)
    }
    assert.equal(capture.phases.length, labels.length)
    for (const label of labels) {
      assert.equal(
        capture.phases.filter((phase: { label: string; complete: boolean }) => phase.label === label && phase.complete)
          .length,
        1
      )
      for (const suffix of ["cpuprofile", "heapprofile"]) {
        const profile = JSON.parse(fs.readFileSync(path.join(directory, `${label}.${suffix}`), "utf8"))
        assert.ok(suffix === "cpuprofile" ? profile.nodes?.length : profile.head)
      }
    }
  }
  fs.writeFileSync(
    path.join(output, "cost-summary.md"),
    "# CPU/allocation diagnostic\n\nFour source/case captures completed, each with three warmups and 20 workload repetitions. " +
      "Profiles and GC logs are instrumented attribution evidence, not an elapsed-time comparison or significance test. " +
      "See profiles/*/capture.json for phase boundaries, completeness and instrumentation limits.\n"
  )
}
