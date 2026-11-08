import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Operation from "../../../src/internal/operation.ts"
const timeout = (name: string) => Effect.runSync(Operation.named(name)(Effect.map(Operation.record, (record) => record.timeout(Option.some("diagnostic refusal")))))
import { afterAll, beforeAll, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
let shared: ReturnType<typeof connection>
let passing: ReturnType<typeof connection>
beforeAll(() => {
  shared = connection("shared")
  shared("receive", "SETUP_ONLY")
})
it("passing test discarded", () => {
  timeout("Passing.operation")
  passing = connection("passing")
  passing("send", "PASS_ONLY")
})
it("failing test retained", () => {
  timeout("Unrelated.failure")
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
