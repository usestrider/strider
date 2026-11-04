import { describe, expect, it } from "vitest"
import { instrumentationTargets, profileOptions } from "../benchmark/query-profile-config.ts"

const installed = new Set<string>(instrumentationTargets)

describe("query profile arguments", () => {
  it("keeps defaults and accepts every supported mode with positive integer counts", () => {
    expect(profileOptions(["report.json"]).runs).toBe(20)
    for (const mode of ["plain", "instrumented", "trace", "boundary", "boundary-trace"]) {
      expect(profileOptions(["report.json", mode, "1"], installed)).toMatchObject({ mode, runs: 1 })
    }
    expect(profileOptions(["report.json", "trace"], installed)).toMatchObject({ runs: 3, warmups: 1 })
  })

  it("rejects unknown modes instead of silently choosing a workload", () => {
    for (const mode of ["typo", "boundary-typo", "typo-trace", ""]) {
      expect(() => profileOptions(["report.json", mode], installed)).toThrow("mode")
    }
  })

  it("rejects invalid counts instead of completing with no samples", () => {
    for (const count of ["0", "-1", "1.5", "NaN", "Infinity", "", "9007199254740992"]) {
      expect(() => profileOptions(["report.json", "plain", count])).toThrow("positive integer")
    }
  })

  it("rejects missing output and unexpected positional arguments", () => {
    expect(() => profileOptions([])).toThrow("output")
    expect(() => profileOptions(["report.json", "plain", "1", "extra"])).toThrow("arguments")
  })

  it("requires every instrumentation target for instrumented modes", () => {
    for (const mode of ["instrumented", "trace", "boundary-trace"]) {
      expect(() => profileOptions(["report.json", mode])).toThrow("instrumentation")
      for (const missing of instrumentationTargets) {
        expect(() => profileOptions(["report.json", mode], new Set(instrumentationTargets.filter((x) => x !== missing))))
          .toThrow("instrumentation")
      }
    }
    for (const mode of ["plain", "boundary"]) expect(() => profileOptions(["report.json", mode])).not.toThrow()
  })
})
