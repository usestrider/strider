import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import {
  begin,
  expectedPhases,
  finish,
  instrument,
  instrumentRunner,
  phaseEnd,
  phaseStart,
  reconcile
} from "../src/benchmarks/many-pages-phases.ts"

describe("many-pages phase diagnostics", () => {
  const phases = expectedPhases.map((name, i) => ({ name, start: i * 2 + 1, end: i * 2 + 2 }))
  it("instruments only the two existing callbacks and leaves defaults intact", () => {
    const source = fs.readFileSync(new URL("../src/scenarios.ts", import.meta.url), "utf8")
    const transformed = instrument(instrument(source, "strider"), "playwright")
    expect(transformed.match(/phaseStart/g)).toHaveLength(12)
    expect(transformed).toContain("page.goto(`${origin}/benchmark`)")
    expect(() => instrument("", "strider")).toThrow()
    const runner = instrumentRunner(fs.readFileSync(new URL("../src/runner.ts", import.meta.url), "utf8"))
    expect(runner).toContain("phaseEnabled = scenario.name === \"many-pages\"")
    expect(runner).toContain("const ms = performance.now() - started\n        flushPhases()")
  })
  it("runs the generated harness, flushes after timing and preserves operation failures", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "many-pages-harness-"))
    try {
      const root = new URL("../src/", import.meta.url).pathname
      const source = instrumentRunner(fs.readFileSync(path.join(root, "runner.ts"), "utf8"))
        .replaceAll("from \"./", `from "${root}`)
      const entry = path.join(directory, "runner.ts")
      const output = path.join(directory, "phases.ndjson")
      fs.writeFileSync(entry, source)
      const script = `
        import { runScenarios } from ${JSON.stringify(entry)};
        import { expectedPhases, phaseStart, phaseEnd } from ${
        JSON.stringify(root + "benchmarks/many-pages-phases.ts")
      };
        const expected = Array(20).fill("1").join(",");
        let fail = false;
        const run = async () => {
          for (const name of expectedPhases) {
            phaseStart(name);
            if (fail && name === "navigate:0") throw new Error("original operation failure");
            if (name !== "release") phaseEnd();
          }
          return expected;
        };
        const scenario = { name: "many-pages", expected };
        await runScenarios([scenario], 1, () => ({ strider: run, playwright: run }), () => {});
        fail = true;
        const results = await runScenarios([scenario], 1, () => ({ strider: run }), () => {});
        if (!results[0].failures[0].error.includes("original operation failure")) throw new Error("lost error");
      `
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, STRIDER_PAIRED: "", STRIDER_PHASE_OUTPUT: output }
      })
      const records = fs.readFileSync(output, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      expect(records).toHaveLength(6)
      expect(records.slice(0, 4).every((record) => record.phases.length === expectedPhases.length)).toBe(true)
      expect(records.slice(4).every((record) => record.failed && record.reconciliation === null)).toBe(true)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  it("reconciles disjoint work and residual against callback time", () => {
    const result = reconcile(phases, 0, phases.length * 2 + 3)
    expect(result.sum + result.residual).toBe(result.total)
    expect(result.sum).toBe(phases.length)
  })
  it("rejects missing phases and overlapping spans", () => {
    expect(() => reconcile(phases.slice(1), 0, 1000)).toThrow()
    expect(() => reconcile(phases.map((p) => ({ ...p, start: 0 })), 0, 1000)).toThrow()
  })
  it("retains partial failure without presenting it as reconciled timing", () => {
    begin()
    phaseStart("context")
    phaseEnd()
    phaseStart("create:0")
    const record = finish(true)
    expect(record.failed).toBe(true)
    expect(record.active?.name).toBe("create:0")
    expect(record.reconciliation).toBeNull()
    expect(record.phases).toHaveLength(1)
  })
  it("rejects a successful callback without all required instrumentation", () => {
    begin()
    expect(() => finish(false)).toThrow()
  })
})
