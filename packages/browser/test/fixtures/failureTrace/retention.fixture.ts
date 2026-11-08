/** Exercise the aggregate on-disk passing diagnostic budget without a browser. */
import { afterAll, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"

if (process.env.STRIDER_TRACE_RETAIN_PASSES === "1") {
  for (let i = 0; i < 24; i++) {
    it(`retention budget ${i}`, () => {
      expect(process.env.STRIDER_TRACE_RETAIN_PASSES).toBe("1")
      const record = connection("diagnostic-budget")
      for (let j = 0; j < 100; j++) record("host-timeout", { operationId: i, detail: "界".repeat(30_000) })
    })
  }
} else it.skip("retention quota probe is opt-in", () => {})

afterAll(() => {
  throw Error("Deliberate quota probe failure to expose recorder console output")
})
