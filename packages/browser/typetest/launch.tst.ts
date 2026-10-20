/**
 * A launch names its browser (review 10): its executable or one of its backend's channels, exactly one. Nothing
 * else is looked up, so a launch that names nothing doesn't compile.
 */
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import { describe, expect, it } from "tstyche"

describe("a launch", () => {
  it("names its browser by an executable or a channel", () => {
    expect(Chromium.layer).type.toBeCallableWith({ executablePath: "/usr/bin/chromium" })
    expect(Chromium.layer).type.toBeCallableWith({ channel: "stable", headless: false })
    expect(Firefox.layer).type.toBeCallableWith({ channel: "canary" })
    expect(WebKit.layer).type.toBeCallableWith({ channel: "playwright" })
  })

  it("never names nothing, or both", () => {
    expect(Chromium.layer).type.not.toBeCallableWith()
    expect(Chromium.layer).type.not.toBeCallableWith({ headless: true })
    expect(Chromium.layer).type.not.toBeCallableWith({ executablePath: "/usr/bin/chromium", channel: "stable" })
  })

  it("names only a channel its backend has", () => {
    expect(WebKit.layer).type.not.toBeCallableWith({ channel: "stable" })
    expect(Chromium.layer).type.not.toBeCallableWith({ channel: "playwright" })
  })
})
