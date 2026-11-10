import { describe, expect, it } from "vitest"
import { selectScenarios } from "../src/selection.ts"

const all = [{ name: "a", playwright: () => {} }, { name: "b" }, { name: "c", playwright: () => {} }, {
  name: "d",
  playwright: () => {},
  recording: "the-internet"
}]

describe("scenario selection", () => {
  it("takes every scenario, or those with a twin and no recording when paired, when none is named", () => {
    expect(selectScenarios(all, undefined, false).map((s) => s.name)).toEqual(["a", "b", "c", "d"])
    expect(selectScenarios(all, undefined, true).map((s) => s.name)).toEqual(["a", "c"])
    expect(selectScenarios(all, "", true).map((s) => s.name)).toEqual(["a", "c"])
  })
  it("takes a comma-separated list in scenario order", () => {
    expect(selectScenarios(all, "c, a", true).map((s) => s.name)).toEqual(["a", "c"])
  })
  it("rejects unknown names", () => {
    expect(() => selectScenarios(all, "a,x", false)).toThrow("Unknown scenarios: x")
  })
})
