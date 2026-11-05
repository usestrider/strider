import { afterAll, beforeAll, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
let shared: ReturnType<typeof connection>
let passing: ReturnType<typeof connection>
beforeAll(() => {
  shared = connection("shared")
  shared("receive", "SETUP_ONLY")
})
it("passing test discarded", () => {
  passing = connection("passing")
  passing("send", "PASS_ONLY")
})
it("failing test retained", () => {
  const own = connection("failing")
  own("send", "FAIL_ONLY")
  passing("receive", "LATE_PASS_ONLY")
  shared("receive", "SHARED_DURING_FAIL")
  expect(false).toBe(true)
})
afterAll(() => {
  shared("receive", "TEARDOWN_ONLY")
  throw Error("deliberate teardown failure")
})
