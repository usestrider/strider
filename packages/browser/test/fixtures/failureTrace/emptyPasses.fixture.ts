/** Passing tests that record no diagnostics, then one that does, without a browser. */
import { afterAll, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"

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
  })
} else it.skip("empty pass probe is opt-in", () => {})

afterAll(() => {
  throw Error("Deliberate probe failure to expose recorder console output")
})
