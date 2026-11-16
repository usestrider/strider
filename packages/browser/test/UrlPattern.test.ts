/** `Url.Pattern`'s exact URLs, compared as the browser writes a URL. */
import { assert, describe, it } from "@effect/vitest"
import * as UrlPattern from "../src/internal/urlPattern.ts"

describe("An exact URL pattern", () => {
  it("matches the URL as the browser writes it", () => {
    for (
      const [pattern, url] of [
        ["ws://h", "ws://h/"],
        ["http://h", "http://h/"],
        ["HTTP://H:80/", "http://h/"],
        ["http://h/a b", "http://h/a%20b"]
      ] as const
    ) assert.isTrue(UrlPattern.compile(pattern)(url), `${pattern} against ${url}`)
  })

  it("still matches itself", () => {
    for (const url of ["http://h/", "ws://h:8080/socket?x=1"]) assert.isTrue(UrlPattern.compile(url)(url), url)
  })

  it("compares a pattern that isn't an absolute URL as it is written", () => {
    assert.isTrue(UrlPattern.compile("not a url")("not a url"))
    assert.isFalse(UrlPattern.compile("not a url")("not%20a%20url"))
  })
})
