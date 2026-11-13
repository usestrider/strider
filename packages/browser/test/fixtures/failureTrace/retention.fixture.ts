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
  if (process.env.STRIDER_QUOTA_FAILED_SCOPE === "1") {
    const record = connection("failed-after-quota")
    for (let i = 0; i < 100; i++) record("receive", "FAILED_AFTER_QUOTA" + "界".repeat(30_000))
  }
  throw Error("Deliberate quota probe failure to expose recorder console output")
})
