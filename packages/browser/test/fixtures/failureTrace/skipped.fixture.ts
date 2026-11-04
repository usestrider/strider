import { expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
it.skip("skipped bookkeeping probe", () => {})
it("body after a skipped test", () => {
  connection("after-skip")("send", "AFTER_SKIP_PROBE")
  expect(false).toBe(true)
})
