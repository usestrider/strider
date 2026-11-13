import { describe, expect, it } from "vitest"
import {
  closeReport,
  inputReport,
  median,
  type PhaseSample,
  summarize,
  table,
  timeline,
  validate
} from "../benchmark/phase-profile-model.ts"

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
  it("adds a close total across Strider's release and exit", () => {
    const rows = summarize([sample("strider", { release: 20, close: 5 }), sample("playwright", { close: 8 })])
    expect(rows.find((row) => row.phase === "closeTotal")).toMatchObject({ strider: 25, playwright: 8, gap: 17 })
  })
  it("turns wire events into a timeline with serial round trips and host gaps", () => {
    const send = (at: number, id: number, method: string) => ({ at, kind: "send" as const, message: { id, method } })
    const reply = (at: number, id: number) => ({ at, kind: "receive" as const, message: { id } })
    const result = timeline([
      send(0, 1, "A.one"),
      reply(4, 1),
      send(6, 2, "B.two"),
      send(7, 3, "C.three"),
      { at: 8, kind: "receive", message: { method: "X.event" } },
      reply(10, 2),
      reply(12, 3)
    ])
    expect(result).toMatchObject({ sent: 3, events: 1, roundTrips: 2 })
    expect(result.hostGaps).toEqual([2, 0])
    expect(result.steps[0]).toMatchObject({ what: "send A.one", waited: 4 })
  })
  it("reports the median traced close of each library", () => {
    const traced = (library: PhaseSample["library"], close: number): PhaseSample => ({
      ...sample(library, { release: close, close: 1 }),
      events: [{ at: 0, kind: "send", message: { id: 1, method: "Target.closeTarget" } }, {
        at: close,
        kind: "receive",
        message: { id: 1 }
      }]
    })
    const text = closeReport([
      traced("strider", 30),
      traced("strider", 10),
      traced("strider", 20),
      traced("playwright", 8)
    ])
    expect(text).toContain("upload, strider: close 21.0 ms (median of 3)")
    expect(text).toContain("| 0.0 | send Target.closeTarget | 20.0 |")
    expect(text).toContain("upload, playwright")
  })
  it("reports the traced setInputFiles call with the bytes it sent", () => {
    const traced: PhaseSample = {
      ...sample("strider", { setInputFiles: 12 }),
      inputEvents: [
        { at: 0, kind: "send", bytes: 100, message: { id: 1, method: "DOM.setFileInputFiles" } },
        { at: 12, kind: "receive", bytes: 20, message: { id: 1 } }
      ]
    }
    const text = inputReport([traced])
    expect(text).toContain("upload, strider: setInputFiles 12.0 ms (median of 1), 1 commands")
    expect(text).toContain("100 bytes sent, 20 bytes received")
  })
})
