import { assert, describe, it } from "@effect/vitest"
import * as Network from "@usestrider/browser/cdp/Network"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

// Shaped like what Chrome 155 sends; trimmed to the fields that matter here.
const frameNavigated = {
  frame: {
    id: "8B6F0E3A1F2C4D5E6F708192A3B4C5D6",
    loaderId: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
    url: "https://shop.example.com/cart",
    domainAndRegistry: "example.com",
    securityOrigin: "https://shop.example.com",
    mimeType: "text/html",
    secureContextType: "Secure",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: []
  },
  type: "Navigation"
}

describe("generated CDP codecs", () => {
  it.effect("decode an event's parameters", () =>
    Effect.gen(function*() {
      const params = Page.frameNavigated.Params
      assert.isDefined(params)
      const decoded = yield* Schema.decodeUnknownEffect(params!)(frameNavigated)
      assert.strictEqual(decoded.frame.url, "https://shop.example.com/cart")
      assert.strictEqual(decoded.type, "Navigation")
    }))

  it.effect("accept enum values this revision doesn't know", () =>
    Effect.gen(function*() {
      const decoded = yield* Schema.decodeUnknownEffect(Page.frameNavigated.Params!)({
        ...frameNavigated,
        type: "Prerender"
      })
      assert.strictEqual(decoded.type, "Prerender")
    }))

  it.effect("fail on a payload that doesn't match", () =>
    Effect.gen(function*() {
      const result = yield* Schema.decodeUnknownEffect(Page.frameNavigated.Params!)({ type: "Navigation" }).pipe(
        Effect.result
      )
      assert.strictEqual(result._tag, "Failure")
    }))

  it.effect("decode cookie values as Redacted", () =>
    Effect.gen(function*() {
      const decoded = yield* Schema.decodeUnknownEffect(Network.getCookies.Result!)({
        cookies: [{
          name: "session",
          value: "s3cret",
          domain: ".example.com",
          path: "/",
          expires: -1,
          size: 13,
          httpOnly: true,
          secure: true,
          session: true,
          priority: "Medium",
          sameParty: false,
          sourceScheme: "Secure",
          sourcePort: 443
        }]
      })
      const cookie = decoded.cookies[0]!
      assert.isTrue(Redacted.isRedacted(cookie.value))
      assert.strictEqual(Redacted.value(cookie.value), "s3cret")
      assert.notInclude(String(cookie.value), "s3cret")
    }))

  it("declare commands as data, with their traits", () => {
    assert.strictEqual(Page.navigate.method, "Page.navigate")
    assert.strictEqual(Page.navigate.traits.status, "stable")
    assert.strictEqual(Network.getCookies.method, "Network.getCookies")
    const command = Page.navigate({ url: "https://shop.example.com" })
    assert.strictEqual(command.method, "Page.navigate")
    assert.deepStrictEqual(command.params, { url: "https://shop.example.com" })
  })
})
