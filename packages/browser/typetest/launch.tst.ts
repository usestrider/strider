/**
 * A launch names its browser by its executable's path: there are no channels, and nothing
 * is looked up, so a launch that names nothing doesn't compile.
 */
import type { UserContext } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Redacted from "effect/Redacted"
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

declare const contextOptions: (options: UserContext.Options) => void

describe("context proxy credentials", () => {
  it("takes a complete credential pair with a Redacted password", () => {
    expect(contextOptions).type.toBeCallableWith({ proxy: { server: "host:8080" } })
    expect(contextOptions).type.toBeCallableWith({
      proxy: { server: "host:8080", credentials: { username: "user", password: Redacted.make("secret") } }
    })
    expect(contextOptions).type.not.toBeCallableWith({
      proxy: { server: "host:8080", credentials: { username: "user", password: "secret" } }
    })
    expect(contextOptions).type.not.toBeCallableWith({
      proxy: { server: "host:8080", credentials: { username: "user" } }
    })
    expect(contextOptions).type.not.toBeCallableWith({
      proxy: { credentials: { username: "user", password: Redacted.make("secret") } }
    })
  })
})
