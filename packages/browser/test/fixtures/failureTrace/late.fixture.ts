import { afterAll, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
let late: ReturnType<typeof connection>
it("fails before its connection emits late cleanup traffic", () => {
  late = connection("late-cleanup")
  late("send", "BEFORE_FAILURE")
  expect(false).toBe(true)
})
afterAll(() => {
  for (let i = 0; i < 32; i++) late("receive", "x".repeat(32 * 1024))
  late("receive", "AFTER_OVERFLOW")
})
