import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, expect, it } from "vitest"
import { stats } from "../src/measure.ts"
import * as Report from "../src/report.ts"
import { runScenarios } from "../src/runner.ts"
import type { Scenario } from "../src/scenarios.ts"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "combined-report-"))
afterEach(() => fs.rmSync(directory, { force: true, recursive: true }))
const measurements = async (engine: string): Promise<Report.Measurements> => ({
  date: "2026-11-08",
  browser: engine,
  machine: "test",
  node: "test",
  striderCommit: "abc123",
  playwright: "test",
  runs: 1,
  metadata: {
    engine,
    sourceCommit: "abc123",
    fairness: "Different browser builds",
    launchBoundary: "Includes shutdown"
  },
  scenarios: await runScenarios([{ name: "login", title: "Login", expected: "ok" } as Scenario], 1, () => ({
    strider: async () => engine === "firefox" ? "wrong" : "ok",
    playwright: async () => "ok"
  }), () => {}),
  launch: { strider: stats([]), playwright: stats([]) },
  q82: [],
  q82WaitMs: 3000,
  q103: [],
  tells: { strider: {}, playwright: {} },
  flags: { strider: [], playwright: [] },
  source: ""
})

it("regenerates a combined report from saved measurements without running browsers", async () => {
  fs.mkdirSync(directory, { recursive: true })
  const runs = await Promise.all([measurements("chromium"), measurements("firefox")])
  const files = runs.map((run, index) => {
    const file = path.join(directory, `${index}.json`)
    fs.writeFileSync(file, JSON.stringify(run))
    return file
  })
  const output = path.join(directory, "RESULTS.md")
  const child = spawnSync(process.execPath, [
    new URL("../src/report-bin.ts", import.meta.url).pathname,
    "--output",
    output,
    ...files
  ], { encoding: "utf8" })
  expect(child.stderr).toBe("")
  expect(child.status).toBe(0)
  const written = fs.readFileSync(output, "utf8")
  expect(written).toBe(Report.combine(files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")))))
  expect(written).toContain("abc123")
  expect(written).toContain("Different browser builds")
  expect(written).toContain("Includes shutdown")
  expect(written).toContain("incomplete")
  expect(written).toContain("Read \"wrong\", expected \"ok\"")
})

it("prints single-browser output without replacing the combined report", async () => {
  const combined = new URL("../RESULTS.md", import.meta.url)
  const before = fs.readFileSync(combined, "utf8")
  let printed = ""
  Report.writeRunReport(await measurements("chromium"), undefined, (text) => {
    printed = text
  })
  expect(printed).toContain("chromium")
  expect(fs.readFileSync(combined, "utf8")).toBe(before)
})

it("keeps reviewed observations tied to their measured source commit", async () => {
  const runs = await Promise.all([measurements("chromium"), measurements("firefox")])
  expect(() => Report.combine(runs, { sourceCommit: "another-commit", observations: ["old observation"] }))
    .toThrow("different source commit")
  expect(Report.combine(runs, { sourceCommit: "abc123", observations: ["reviewed cleanup warning"] }))
    .toContain("reviewed cleanup warning")
})

// `pnpm scenarios --runs` changes the sample count, so the combined report has to describe the count each run has
it("describes the estimator for the runs' own sample count", async () => {
  const runs = await Promise.all([measurements("chromium"), measurements("firefox")])
  const written = Report.combine(runs.map((run) => ({ ...run, runs: 3 })))
  expect(written).not.toContain("with ten samples")
  expect(written).toContain("3 scheduled repetitions")
})

const sampled = async (engine: string, runs: number, failLast = false): Promise<Report.Measurements> => {
  const base = await measurements(engine)
  let calls = 0
  return {
    ...base, runs,
    scenarios: await runScenarios([base.scenarios[0]!.scenario], runs, () => ({
      strider: async () => ++calls === runs + 1 && failLast ? "wrong" : "ok",
      playwright: async () => "ok"
    }), () => {})
  }
}

it("describes mixed successful sample counts without treating a large-run p90 as the maximum", async () => {
  const written = Report.combine(await Promise.all([sampled("chromium", 3), sampled("firefox", 100)]))
  expect(written).toContain("3 scheduled repetitions")
  expect(written).toContain("100 scheduled repetitions")
  expect(written).toContain("| 3 | 2 | 3 (maximum) |")
  expect(written).toContain("| 100 | 51 | 91 |")
  expect(written).not.toContain("91 (maximum)")
  expect(written).not.toContain("A p90-only gap is a single tail observation")
})

it("describes successful samples rather than scheduled attempts after a failure", async () => {
  const written = Report.combine(await Promise.all([sampled("chromium", 100, true), sampled("firefox", 10)]))
  expect(written).toContain("| 99 | 50 | 90 |")
  expect(written).toContain("| 100 | 51 | 91 |")
  expect(written).toContain("| 10 | 6 | 10 (maximum) |")
  expect(written).toContain("incomplete")
  const zero = Report.combine(await Promise.all([measurements("chromium"), measurements("firefox")]))
  expect(zero).toContain("| 0 | – | – |")
  expect(zero).not.toContain("NaN")
})
