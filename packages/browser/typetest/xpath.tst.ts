/**
 * `locator` takes an XPath expression built by `Locator.xpath` wherever it takes CSS.
 */
import { Locator, Page } from "@usestrider/browser"
import { describe, expect, it } from "tstyche"

declare const page: Page.ReadonlyPage
declare const frame: Locator.FrameLocator

describe("Locator.xpath", () => {
  it("is accepted by locator on a read-only page, a frame locator and a relative locator", () => {
    const xpath = Locator.xpath("//li")
    expect(xpath).type.toBe<Locator.XPath>()
    expect(page.locator(xpath)).type.toBe<Locator.ReadonlyLocator>()
    expect(page.locator("ul").locator(xpath)).type.toBe<Locator.ReadonlyLocator>()
    expect(frame.locator(xpath)).type.toBe<Locator.Locator>()
    expect(Locator.relative.locator(xpath)).type.toBe<Locator.RelativeLocator>()
  })

  it("is not a string", () => {
    expect(Locator.xpath("//li")).type.not.toBeAssignableTo<string>()
    expect(page.locator).type.not.toBeCallableWith({ expression: "//li" })
  })
})
