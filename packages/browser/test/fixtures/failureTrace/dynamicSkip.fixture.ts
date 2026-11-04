import { expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
it("skips itself at run time", (context) => context.skip())
it("body after a test that skipped itself", () => {
  connection("after-dynamic-skip")("send", "AFTER_DYNAMIC_SKIP")
  expect(false).toBe(true)
})
