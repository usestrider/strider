import { afterAll, beforeAll, it } from "vitest"
import { connection, retain } from "../../integration/failureTrace.ts"
let shared: ReturnType<typeof connection>
beforeAll(() => {
  shared = connection("shared")
  shared("receive", "RETAINED_SETUP")
})
afterAll(() => shared("closed", "RETAINED_TEARDOWN"))
it("retains a passing diagnostic", () => {
  const boundary = retain("boundaries")
  boundary("boundary", "RETAINED_BEGIN")
  connection("observer")("send", { id: 1, method: "Target.getTargets" })
  connection("adapter")("receive", { id: 2, sessionId: "session", result: { targetId: "target" } })
  boundary("boundary", "RETAINED_END")
})
