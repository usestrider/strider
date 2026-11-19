import { assert, it } from "@effect/vitest"
import type * as Engine from "../src/internal/engine.ts"
import { describeSteps, queries } from "../src/internal/steps.ts"

it("describes test ids as written, with a pattern's flags and without its g", () => {
  const steps = (id: string | RegExp) => {
    let made: ReadonlyArray<Engine.Step> = []
    queries([], (next) => (made = next), () => "data-testid").getByTestId(id)
    return made
  }
  assert.deepStrictEqual(steps("row-1"), [{
    _tag: "TestId",
    matcher: { _tag: "String", value: "row-1", exact: true },
    attribute: "data-testid"
  }])
  assert.deepStrictEqual(steps(/^row-/gi), [{
    _tag: "TestId",
    matcher: { _tag: "RegExp", source: "^row-", flags: "i" },
    attribute: "data-testid"
  }])
  assert.strictEqual(describeSteps(steps("row-1")), "getByTestId(\"row-1\")")
  assert.strictEqual(describeSteps(steps(/^row-/gi)), "getByTestId(/^row-/i)")
})
