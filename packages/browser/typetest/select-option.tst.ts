import type { Deadline, Locator, Target } from "@usestrider/browser"
import type { Effect } from "effect"
import { describe, expect, it } from "tstyche"

declare const locator: Locator.Locator
declare const both: { value: string; label: string }

describe("selectOption choices", () => {
  it("accepts one attribute", () => {
    expect(locator.selectOption({ value: "a" })).type.not.toRaiseError()
    expect(locator.selectOption({ label: "A" })).type.not.toRaiseError()
    expect(locator.selectOption({ index: 1 })).type.not.toRaiseError()
  })
  it("rejects a choice that names two attributes", () => {
    expect(locator.selectOption({ value: "a", label: "A" })).type.toRaiseError()
    expect(locator.selectOption({ index: 1, label: "A" })).type.toRaiseError()
    expect(locator.selectOption(both)).type.toRaiseError()
  })
})

describe("selectOption result", () => {
  it("succeeds with the values it selected", () => {
    expect(locator.selectOption([{ value: "a" }, { index: 1 }])).type.toBe<
      Effect.Effect<ReadonlyArray<string>, Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
    >()
  })
})
