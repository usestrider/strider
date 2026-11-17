import { assert, it } from "@effect/vitest"
import { describeSteps, queries } from "../src/internal/steps.ts"
import type * as Engine from "../src/internal/engine.ts"

it("describes test ids as written, with a pattern's flags and without its g", () => {
  const steps = (id: string | RegExp) => {
    let made: ReadonlyArray<Engine.Step> = []
    queries([], (next) => (made = next)).getByTestId(id)
    return made
  }
  assert.deepStrictEqual(steps("row-1"), [{ _tag: "TestId", matcher: { _tag: "String", value: "row-1", exact: true } }])
  assert.deepStrictEqual(steps(/^row-/gi), [{ _tag: "TestId", matcher: { _tag: "RegExp", source: "^row-", flags: "i" } }])
  assert.strictEqual(describeSteps(steps("row-1")), "getByTestId(\"row-1\")")
  assert.strictEqual(describeSteps(steps(/^row-/gi)), "getByTestId(/^row-/i)")
})
