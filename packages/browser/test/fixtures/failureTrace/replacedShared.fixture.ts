import { expect, it } from "vitest"
import { connection, sharedAcquisition } from "../../integration/failureTrace.ts"
let browser: ReturnType<typeof connection>
// A suite's shared browser replaced during a passing case's body, as the recycled Firefox is once the case's own scope
// has closed: the replacement serves the cases after it.
it("passing test replaces the shared browser", () => {
  const release = sharedAcquisition()
  try {
    browser = connection("replaced-shared")
    browser("send", "REPLACED_SETUP")
  } finally {
    release()
  }
  browser("send", "REPLACING_TEST")
})
it("later test fails on the replacement", () => {
  browser("send", "REPLACEMENT_SEND")
  browser("receive", "REPLACEMENT_RECEIVE")
  expect(false).toBe(true)
})
