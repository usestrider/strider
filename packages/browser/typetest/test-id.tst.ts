import type { Locator, Page } from "@usestrider/browser"
import { describe, expect, it } from "tstyche"

declare const page: Page.Page
declare const readonlyPage: Page.ReadonlyPage
declare const locator: Locator.Locator
declare const frame: Locator.FrameLocator

describe("getByTestId", () => {
  it("accepts a string or a pattern on every query surface", () => {
    expect(page.getByTestId("row-1")).type.toBe<Locator.Locator>()
    expect(page.getByTestId(/^row-/)).type.toBe<Locator.Locator>()
    expect(readonlyPage.getByTestId(/^row-/i)).type.not.toRaiseError()
    expect(locator.getByTestId(/^row-/)).type.toBe<Locator.Locator>()
    expect(frame.getByTestId(/^row-/)).type.toBe<Locator.Locator>()
  })
  it("rejects anything else", () => {
    expect(page.getByTestId(1)).type.toRaiseError()
  })
})
