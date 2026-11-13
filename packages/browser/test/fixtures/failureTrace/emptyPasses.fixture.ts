/** Passing tests that record no diagnostics, then one that does, without a browser. */
import { afterAll, beforeAll, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"

let shared: ReturnType<typeof connection>
beforeAll(() => {
  shared = connection("shared-diagnostic")
})

if (process.env.STRIDER_TRACE_RETAIN_PASSES === "1") {
  // A slice file runs over 600 tests, most of which record no rendering round or host deadline.
  for (let i = 0; i < 600; i++) {
    it(`empty pass ${i}`, () => {
      connection("empty-connection")
      expect(i).toBeGreaterThanOrEqual(0)
    })
  }
  it("late diagnostic pass", () => {
    connection("late-diagnostic")("host-timeout", { operationId: "late", detail: "kept" })
    shared("host-timeout", { operationId: "shared-late" })
    const transfer = connection("child-transfer-probe")
    for (const pid of [101, 102]) {
      const origin = { pid, sequence: 1, connection: "1:host-operation", timestamp: new Date().toISOString() }
      transfer("connection", { label: `child-${pid}` }, origin)
      transfer("host-timeout", { operationId: `child-${pid}` }, { ...origin, sequence: 2 })
    }
  })
} else it.skip("empty pass probe is opt-in", () => {})

afterAll(() => {
  throw Error("Deliberate probe failure to expose recorder console output")
})
