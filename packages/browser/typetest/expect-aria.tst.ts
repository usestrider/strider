import { AriaPattern, Expect } from "@usestrider/browser"
import type { Locator, Page } from "@usestrider/browser"
import { describe, expect, it } from "tstyche"

declare const page: Page.ReadonlyPage
declare const locator: Locator.ReadonlyLocator
const pattern = AriaPattern.anywhere(AriaPattern.including(AriaPattern.node("heading", "todos", AriaPattern.unchecked)))

describe("toMatchAria's subject", () => {
  it("takes a locator or a page, data-first or piped", () => {
    expect(Expect.toMatchAria(locator, pattern)).type.not.toRaiseError()
    expect(Expect.toMatchAria(page, pattern)).type.not.toRaiseError()
    expect(Expect.toMatchAria(page, pattern, { not: true })).type.not.toRaiseError()
    expect(page.pipe(Expect.toMatchAria(pattern))).type.not.toRaiseError()
    expect(locator.pipe(Expect.toMatchAria(pattern, { not: true }))).type.not.toRaiseError()
  })
  it("rejects anything else", () => {
    expect(Expect.toMatchAria).type.not.toBeCallableWith("body", pattern)
    expect(Expect.toMatchAria).type.not.toBeCallableWith({ id: "p1" }, pattern)
  })
})
