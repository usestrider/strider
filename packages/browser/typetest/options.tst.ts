import type { CookieJar, FilePath, Locator, Page } from "@usestrider/browser"
import type { TestRun } from "@usestrider/browser/test"
import { describe, expect, it } from "tstyche"

declare const page: Page.Page
declare const locator: Locator.ReadonlyLocator
declare const run: TestRun.TestRun
declare const path: FilePath.Local
declare const rect: Extract<NonNullable<Page.ScreenshotOptions["area"]>, { readonly clip: unknown }>["clip"]

describe("options a caller writes", () => {
  it("name a screenshot's area and format without _tag", () => {
    expect(page.screenshot({ area: "fullPage" })).type.not.toRaiseError()
    expect(page.screenshot({ area: { clip: rect } })).type.not.toRaiseError()
    expect(page.screenshot({ area: { element: locator } })).type.not.toRaiseError()
    expect(page.screenshot({ format: "jpeg", quality: 80 })).type.not.toRaiseError()
    expect(page.screenshot({ area: { _tag: "FullPage" } })).type.toRaiseError()
  })
  it("keep a screenshot's choices exclusive", () => {
    expect(page.screenshot({ area: { clip: rect, element: locator } })).type.toRaiseError()
    expect(page.screenshot({ format: "png", quality: 80 })).type.toRaiseError()
    expect(page.screenshot({ quality: 80 })).type.toRaiseError()
    expect(page.screenshot({ format: "jpeg" })).type.toRaiseError()
  })
  it("scope a cookie by a URL, or by a domain and path", () => {
    expect<{ url: string }>().type.toBeAssignableTo<CookieJar.Input["scope"]>()
    expect<{ domain: string; path: string }>().type.toBeAssignableTo<CookieJar.Input["scope"]>()
    expect<{ url: string; domain: string; path: string }>().type.not.toBeAssignableTo<CookieJar.Input["scope"]>()
    expect<{ domain: string }>().type.not.toBeAssignableTo<CookieJar.Input["scope"]>()
  })
  it("attach a test's file by its kind", () => {
    expect(run.attach({ trace: path })).type.not.toRaiseError()
    expect(run.attach({ _tag: "Trace", path })).type.toRaiseError()
  })
})
