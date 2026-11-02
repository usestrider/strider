import { assert, describe, it } from "@effect/vitest"
import * as Emulation from "@usestrider/browser/Emulation"
import * as Pixels from "@usestrider/browser/Pixels"
import * as Url from "@usestrider/browser/Url"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const accepts = (schema: Schema.Decoder<unknown>, ...inputs: ReadonlyArray<unknown>) => {
  for (const input of inputs) {
    assert.isTrue(Result.isSuccess(Schema.decodeUnknownResult(schema)(input)), `${String(input)} should decode`)
  }
}

const rejects = (schema: Schema.Decoder<unknown>, ...inputs: ReadonlyArray<unknown>) => {
  for (const input of inputs) {
    assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(schema)(input)), `${String(input)} should not decode`)
  }
}

describe("Brands that check what they hold", () => {
  it("Url.Url is an absolute URL by WHATWG parsing", () => {
    accepts(Url.Url, "https://example.com/a?b#c", "about:blank", "data:text/plain,hi", "file:///tmp/a")
    rejects(Url.Url, "nope", "/path", "//example.com", "")
    assert.throws(() => Url.Url.make("nope"))
    assert.strictEqual(Url.Url.make("HTTPS://Example.com"), "HTTPS://Example.com")
  })

  it("Url.Origin is a serialized origin", () => {
    accepts(Url.Origin, "https://example.com", "http://localhost:3000", "http://[::1]:8080")
    rejects(Url.Origin, "https://example.com/", "https://example.com/a", "HTTPS://Example.com", "null", "example.com")
  })

  it("Url.Site is a serialized origin without a port", () => {
    accepts(Url.Site, "https://example.com", "http://localhost")
    rejects(Url.Site, "https://example.com:8443", "https://example.com/", "about://", "file://", "")
  })

  it("Pixels are finite numbers", () => {
    accepts(Pixels.Css, 0, -1.5, 390)
    accepts(Pixels.Device, 1170)
    rejects(Pixels.Css, Number.NaN, Number.POSITIVE_INFINITY, "1")
    rejects(Pixels.Device, Number.NEGATIVE_INFINITY)
  })

  it("Emulation.Locale is a BCP 47 language tag", () => {
    accepts(Emulation.Locale, "de-DE", "en", "zh-Hant-TW")
    rejects(Emulation.Locale, "not a locale", "", "de_DE")
  })

  it("Emulation.TimeZoneId is an IANA time zone", () => {
    accepts(Emulation.TimeZoneId, "Europe/Berlin", "UTC", "Asia/Tokyo")
    rejects(Emulation.TimeZoneId, "Mars/Olympus", "", "Berlin")
  })
})
