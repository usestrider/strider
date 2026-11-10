import { describe, expect, it } from "vitest"
import { median, type PhaseSample, summarize, table, validate } from "../benchmark/phase-profile-model.ts"

const sample = (
  library: PhaseSample["library"],
  phases: Record<string, number>,
  warmup = false
): PhaseSample => ({
  scenario: "upload",
  library,
  repetition: warmup ? -1 : 1,
  warmup,
  phases,
  total: Object.values(phases).reduce((a, b) => a + b, 0)
})

describe("phase profile summaries", () => {
  it("takes medians of even and odd counts", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
  })
  it("reports each library's phase median and the gap, leaving warmups out", () => {
    const rows = summarize([
      sample("strider", { enter: 5, goto: 10 }),
      sample("strider", { enter: 5, goto: 30 }),
      sample("strider", { enter: 500, goto: 500 }, true),
      sample("playwright", { goto: 8 })
    ])
    expect(rows.find((row) => row.phase === "goto")).toEqual({
      scenario: "upload",
      phase: "goto",
      strider: 20,
      playwright: 8,
      gap: 12
    })
    // A phase only one library has keeps its value, with no gap
    expect(rows.find((row) => row.phase === "enter")).toMatchObject({ strider: 5, playwright: null, gap: null })
    expect(table(rows)).toContain("| upload | enter | 5.0 | n/a | n/a |")
  })
  it("rejects a sample whose phases do not add up to its total", () => {
    expect(() => validate({ ...sample("strider", { a: 1, b: 2 }), total: 10 })).toThrow()
    expect(() => validate(sample("strider", { a: 1, b: 2 }))).not.toThrow()
  })
})
