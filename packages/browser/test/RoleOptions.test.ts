import { assert, it } from "@effect/vitest"
import { roleStep, describeSteps } from "../src/internal/steps.ts"

it("preserves role filters in shared query steps and descriptions", () => {
  const options = { level: 2, checked: false, pressed: true, expanded: false, selected: true, disabled: false }
  const step = roleStep("heading", options)
  assert.deepStrictEqual(step, {
    _tag: "Role", role: "heading", name: null, includeHidden: false, ...options
  })
  assert.strictEqual(describeSteps([step]),
    'getByRole("heading", { level: 2, checked: false, pressed: true, expanded: false, selected: true, disabled: false })')
  assert.deepStrictEqual(roleStep("heading", undefined), {
    _tag: "Role", role: "heading", name: null, includeHidden: false
  })
})
