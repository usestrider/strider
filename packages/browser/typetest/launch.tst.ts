/**
 * A launch names its browser by its executable's path (reviews 10 and 11): there are no channels, and nothing
 * is looked up, so a launch that names nothing doesn't compile.
 */
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import { describe, expect, it } from "tstyche"

describe("a launch", () => {
  it("names its browser by its executable", () => {
    expect(Chromium.layer).type.toBeCallableWith({ executablePath: "/usr/bin/chromium" })
    expect(Firefox.layer).type.toBeCallableWith({ executablePath: "/usr/bin/firefox", headless: false })
    expect(WebKit.layer).type.toBeCallableWith({ executablePath: "/opt/pw/webkit-2359/pw_run.sh" })
  })

  it("never names nothing", () => {
    expect(Chromium.layer).type.not.toBeCallableWith()
    expect(Chromium.layer).type.not.toBeCallableWith({})
    expect(Chromium.layer).type.not.toBeCallableWith({ headless: true })
  })

  it("has no channels", () => {
    expect(Chromium.layer).type.not.toBeCallableWith({ channel: "stable" })
    expect(Firefox.layer).type.not.toBeCallableWith({ executablePath: "/usr/bin/firefox", channel: "beta" })
    expect(WebKit.layer).type.not.toBeCallableWith({ channel: "playwright" })
  })
})
