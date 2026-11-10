import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { compare, type Report, type Result, summarize } from "../benchmark/report.ts"

const samples = (library: string, times: ReadonlyArray<number>, name = "case"): Array<Result> =>
  times.map((browserMs, sample) => ({ suite: "suite", name, library, sample, browserMs, state: "passed", errors: [] }))

const report = (results: ReadonlyArray<Result>): Report => ({
  schemaVersion: 1,
  date: "2026-10-31T00:00:00Z",
  reason: "passed",
  unhandledErrors: [],
  sequential: true,
  samples: 2,
  viewport: { width: 1280, height: 720 },
  timing: "workflow",
  machine: { cpu: "cpu", cpus: 1, load: [0], node: "v24", platform: "linux", arch: "x64", kernel: "kernel" },
  versions: { playwright: "1.64.1", vite: "8.3.4", astro: "7.4.2" },
  browsers: { chromium: { version: "155.0.8059.79" } },
  results
})

describe("benchmark summaries", () => {
  it("discards the warmup and averages the middle pair for an even sample count", () => {
    expect(summarize(samples("strider", [9000, 20, 10]), 2)).toEqual({ text: "15.0 (10.0–20.0)", median: 15 })
  })

  it("does not hide a failed warmup behind passing measured samples", () => {
    const rows = samples("strider", [9000, 20, 10])
    expect(summarize([{ ...rows[0]!, state: "failed" }, ...rows.slice(1)], 2).text).toBe("FAIL")
  })

  it("refuses missing, duplicate, skipped and invalid measurements", () => {
    const rows = samples("strider", [1, 20, 10])
    for (
      const invalid of [
        rows.slice(1),
        [rows[0]!, rows[1]!, rows[1]!],
        [rows[0]!, rows[1]!, { ...rows[2]!, state: "skipped" }],
        [rows[0]!, rows[1]!, { ...rows[2]!, browserMs: NaN }]
      ]
    ) expect(summarize(invalid, 2).text).toBe("incomplete")
  })
})

describe("generation comparisons", () => {
  it("uses paired successful cases and reports improved and regressed durations separately", () => {
    const before = report([...samples("strider", [1, 20, 20]), ...samples("playwright", [1, 10, 10])])
    const after = report([...samples("strider", [1, 10, 10]), ...samples("playwright", [1, 20, 20])])
    const text = compare(before, after)
    expect(text).toContain("1 cases passed by both libraries in both runs")
    expect(text).toContain("strider: 20.0 → 10.0 ms (-50.0%).")
    expect(text).toContain("playwright: 10.0 → 20.0 ms (100.0%).")
  })

  it("keeps failed, fixed, added and removed cases visible without including them in the aggregate", () => {
    const before = report([
      ...samples("strider", [1, 20, 20], "removed"),
      ...samples("strider", [1, 20, 20], "fixed").map((row) => ({ ...row, state: "failed" }))
    ])
    const after = report([...samples("strider", [1, 10, 10], "fixed"), ...samples("strider", [1, 10, 10], "added")])
    const text = compare(before, after)
    expect(text).toContain("0 cases passed")
    expect(text).toContain("| suite / fixed | missing | missing | — | FAIL | 10.0 (10.0–10.0) | — |")
    expect(text).toContain("| suite / added | missing | missing | — | missing | 10.0 (10.0–10.0) | — |")
    expect(text).toContain("| suite / removed | missing | missing | — | 20.0 (20.0–20.0) | missing | — |")
  })

  it("warns when the browser or machine changes", () => {
    const before = report([])
    const after = {
      ...before,
      browsers: { chromium: { version: "different" } },
      machine: { ...before.machine, cpu: "different" }
    }
    expect(compare(before, after)).toContain("WARNING: browser version, cpu changed.")
  })

  it("rejects parallel, single-sample and interrupted runs", () => {
    const before = report([])
    for (
      const invalid of [
        { ...before, sequential: false },
        { ...before, samples: 1 },
        { ...before, reason: "interrupted" },
        { ...before, unhandledErrors: ["worker crashed"] }
      ]
    ) expect(() => compare(before, invalid)).toThrow()
  })
})

describe("benchmark command", () => {
  const cli = path.resolve(import.meta.dirname, "../benchmark/cli.ts")
  it("shows its workflow without starting a browser", () => {
    expect(execFileSync(process.execPath, [cli, "run", "--help"], { encoding: "utf8" })).toContain(
      "benchmark:compare BEFORE AFTER"
    )
  })

  it("rejects unsafe names and insufficient sample counts before starting a browser", () => {
    for (const args of [["--name", "../escape"], ["--samples", "1"]]) {
      expect(() => execFileSync(process.execPath, [cli, "run", ...args], { stdio: "pipe" })).toThrow()
    }
  })

  it("refuses to reuse an output directory and preserves its existing files", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-benchmark-"))
    try {
      fs.writeFileSync(path.join(directory, "results.json"), "existing results")
      expect(() => execFileSync(process.execPath, [cli, "run", "--output", directory], { stdio: "pipe" })).toThrow()
      expect(fs.readFileSync(path.join(directory, "results.json"), "utf8")).toBe("existing results")
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

it("rejects an existing explicit benchmark output before collecting Git or fixture metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-benchmark-metadata-"))
  const preload = path.join(directory, "observe.cjs")
  const calls = path.join(directory, "calls.jsonl")
  try {
    fs.writeFileSync(calls, "")
    fs.writeFileSync(
      preload,
      `
const fs = require("node:fs")
const childProcess = require("node:child_process")
const append = fs.appendFileSync
for (const [target, method] of [[childProcess, "execFileSync"], [fs, "lstatSync"]]) {
  const original = target[method]
  target[method] = (...args) => {
    append(${JSON.stringify(calls)}, JSON.stringify([method, String(args[0])]) + "\\n")
    return original(...args)
  }
}
require("node:module").syncBuiltinESMExports()
`
    )
    const result = spawnSync(process.execPath, [
      "--require",
      preload,
      path.resolve(import.meta.dirname, "../benchmark/cli.ts"),
      "run",
      "--output",
      directory
    ], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("EEXIST")
    expect(fs.readFileSync(calls, "utf8")).toBe("")
    expect(fs.readdirSync(directory).sort()).toEqual(["calls.jsonl", "observe.cjs"])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
