import { beforeAll, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
beforeAll(() => {
  connection("setup-failure")("receive", "SETUP_FAILURE_ONLY")
  throw Error("deliberate setup failure")
})
it("never runs", () => {})
