import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { stats } from "../src/measure.ts"
import { type Measurements, report } from "../src/report.ts"
import { publish, runScenarios } from "../src/runner.ts"
import type { Scenario } from "../src/scenarios.ts"

const scenario = (name: string): Scenario => ({ name, title: name, description: "", expected: "42 sold" } as Scenario)
const render = (scenarios: Measurements["scenarios"]) =>
  report({
    date: "today",
    machine: "test",
    node: "test",
    browser: "test",
    striderCommit: "test",
    playwright: "test",
    runs: 10,
    launch: { strider: stats([]), playwright: stats([]) },
    scenarios,
    q82: [],
    q82WaitMs: 3000,
    q103: [],
    tells: { strider: {}, playwright: {} },
    flags: { strider: [], playwright: [] },
    source: ""
  })

describe("scenario runner", () => {
  it.each(["strider", "playwright"] as const)("continues after a timed %s failure", async (library) => {
    const calls = { strider: 0, playwright: 0 }
    const later = { strider: 0, playwright: 0 }
    const results = await runScenarios([scenario("har"), scenario("later")], 10, (s) => {
      const run = (name: "strider" | "playwright") => async () => {
        if (s.name === "later") later[name]++
        else {
          calls[name]++
          if (name === library && calls[name] === 2) throw new Error("timed attempt failed")
        }
        return "42 sold"
      }
      return { strider: run("strider"), playwright: run("playwright") }
    }, () => {})
    expect(calls).toEqual({ strider: 11, playwright: 11 })
    expect(later).toEqual({ strider: 11, playwright: 11 })
    expect(results[0]!.outcome[library]).toEqual({ _tag: "Read", text: "42 sold" })
    expect(results[0]!.failures).toEqual([{ library, repetition: 1, error: "timed attempt failed" }])
    expect(results[0]!.times[library].runs).toBe(9)
    const written = render(results)
    expect(written).toContain("9/10 successful")
    expect(written).toContain(`${library}, timed repetition 1: failed: timed attempt failed`)
    expect(written).toContain("later")
    let output = ""
    expect(publish(results, () => {
      output = written
    })).toBe(1)
    expect(output).toBe(written)
  })

  it("retains initial failures, records every mismatch and handles zero successful samples", async () => {
    const run = async () => "unexpected"
    const results = await runScenarios([scenario("mismatch")], 10, () => ({ strider: run, playwright: run }), () => {})
    expect(results[0]!.outcome.strider).toEqual({ _tag: "Failed", error: "Read \"unexpected\", expected \"42 sold\"" })
    expect(results[0]!.failures).toHaveLength(20)
    expect(results[0]!.attempts).toEqual({ strider: 10, playwright: 10 })
    expect(results[0]!.times.strider.runs).toBe(0)
    expect(render(results)).toContain("–; 0/10 successful")
    expect(render(results)).not.toContain("NaN")
  })

  it("retains an initial rejection even when all timed attempts succeed", async () => {
    let calls = 0
    const results = await runScenarios([scenario("initial")], 10, () => ({
      strider: async () => {
        if (++calls === 1) throw new Error("initial failure")
        return "42 sold"
      },
      playwright: async () => "42 sold"
    }), () => {})
    expect(results[0]!.outcome.strider).toEqual({ _tag: "Failed", error: "initial failure" })
    expect(results[0]!.times.strider.runs).toBe(10)
    expect(results[0]!.failures).toEqual([])
    expect(render(results)).toContain("failed: initial failure")
    expect(publish(results, () => {})).toBe(1)
  })

  it("rejects timed output mismatches even after a successful initial outcome", async () => {
    let calls = 0
    const results = await runScenarios([scenario("mismatch")], 10, () => ({
      strider: async () => ++calls === 1 ? "42 sold" : "wrong",
      playwright: async () => "42 sold"
    }), () => {})
    expect(results[0]!.outcome.strider._tag).toBe("Read")
    expect(results[0]!.times.strider.runs).toBe(0)
    expect(results[0]!.failures).toHaveLength(10)
  })

  it("returns a nonzero process status after publishing failures", () => {
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import { publish, runScenarios } from ${JSON.stringify(new URL("../src/runner.ts", import.meta.url).href)};
      const results = await runScenarios([{ name: 'test', expected: 'ok' }], 10,
        () => ({ strider: async () => 'wrong', playwright: async () => 'ok' }), () => {});
      process.exitCode = publish(results, () => process.stdout.write('report written'));
    `
    ], { encoding: "utf8" })
    expect(child.stderr).toBe("")
    expect(child.stdout).toBe("report written")
    expect(child.status).toBe(1)
  })

  it("returns success after publishing a complete passing run", async () => {
    const run = async () => "42 sold"
    const results = await runScenarios([scenario("pass")], 10, () => ({ strider: run, playwright: run }), () => {})
    expect(results[0]!.times.strider.runs).toBe(10)
    expect(publish(results, () => {})).toBe(0)
  })
})
