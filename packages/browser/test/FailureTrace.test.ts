import { describe, expect, it } from "vitest"
import { TraceBuffer } from "./integration/failureTrace.ts"

describe("failure trace buffer", () => {
  it("keeps both directions and connection identity in sequence", () => {
    const trace = new TraceBuffer(4096, 100)
    trace.record("a", "send", "command")
    trace.record("b", "receive", "reply")
    const entries = trace.entries()
    expect(entries.map((entry) => [entry.sequence, entry.connection, entry.kind, entry.payload])).toEqual([
      [1, "a", "send", "command"], [2, "b", "receive", "reply"]
    ])
    expect(entries[0].timestamp).toEqual(expect.any(String))
  })
  it("marks truncated messages and evicted history within a fixed bound", () => {
    const trace = new TraceBuffer(512, 32)
    for (let i = 0; i < 100; i++) trace.record("a", "receive", "x".repeat(100))
    const entries = trace.entries()
    expect(entries[0].kind).toBe("overflow")
    expect(entries.at(-1)?.truncated).toBe(true)
    expect(entries.at(-1)?.originalLength).toBe(100)
    expect(trace.bytes).toBeLessThanOrEqual(512)
    expect(entries.length).toBeLessThan(100)
  })
  it("clears passing traffic", () => {
    const trace = new TraceBuffer()
    trace.record("a", "stderr", "text")
    trace.clear()
    expect(trace.entries()).toEqual([])
    expect(trace.bytes).toBe(0)
  })
})
