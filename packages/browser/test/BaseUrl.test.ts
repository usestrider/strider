/** A context's `baseURL`: how relative URLs and URL patterns resolve against it. */
import { assert, describe, it } from "@effect/vitest"
import * as BaseUrl from "../src/internal/baseUrl.ts"
import * as UrlPattern from "../src/internal/urlPattern.ts"

const base = "http://127.0.0.1:8080/app/index.html"

describe("A relative URL to navigate to", () => {
  it("resolves against the base as a link does", () => {
    // A path from the root replaces the base's path; one without a slash replaces its last segment
    assert.strictEqual(BaseUrl.url("/a", base)?.href, "http://127.0.0.1:8080/a")
    assert.strictEqual(BaseUrl.url("a", base)?.href, "http://127.0.0.1:8080/app/a")
    assert.strictEqual(BaseUrl.url("?q=1", base)?.href, "http://127.0.0.1:8080/app/index.html?q=1")
  })

  it("is used as given when it's absolute", () => {
    assert.strictEqual(BaseUrl.url("https://example.com/x", base)?.href, "https://example.com/x")
    assert.strictEqual(BaseUrl.url("about:blank", base)?.href, "about:blank")
  })

  it("doesn't parse without a base", () => {
    assert.isUndefined(BaseUrl.url("/a", undefined))
    assert.strictEqual(BaseUrl.url("https://example.com/", undefined)?.href, "https://example.com/")
  })
})

describe("A relative URL pattern", () => {
  it("resolves against the base, keeping its globs", () => {
    const pattern = BaseUrl.pattern("/api/**", base)
    assert.strictEqual(pattern, "http://127.0.0.1:8080/api/**")
    assert.isTrue(UrlPattern.compile(pattern)("http://127.0.0.1:8080/api/v1/items"))
    assert.strictEqual(BaseUrl.pattern("*.png", base), "*.png")
    assert.strictEqual(BaseUrl.pattern("img/*.png", base), "http://127.0.0.1:8080/app/img/*.png")
  })

  it("resolves a :name pattern into a URLPattern", () => {
    const pattern = BaseUrl.pattern("/products/:id", base)
    assert.strictEqual(pattern, "http://127.0.0.1:8080/products/:id")
    assert.isTrue(UrlPattern.compile(pattern)("http://127.0.0.1:8080/products/42"))
    assert.isFalse(UrlPattern.compile(pattern)("http://127.0.0.1:8080/products/42/reviews"))
    // URLPattern's own syntax survives resolution unencoded
    assert.strictEqual(BaseUrl.pattern("/files/:name{.txt}?", base), "http://127.0.0.1:8080/files/:name{.txt}?")
  })

  it("is used as given when it starts with * or a scheme", () => {
    for (const pattern of ["**/api/**", "*://example.com/", "https://example.com/products/:id", "ws://h/socket"]) {
      assert.strictEqual(BaseUrl.pattern(pattern, base), pattern)
    }
  })

  it("is unchanged without a base", () => {
    for (const pattern of ["/api/**", "/products/:id", "a"]) {
      assert.strictEqual(BaseUrl.pattern(pattern, undefined), pattern)
    }
  })

  it("takes a WebSocket scheme from the base's for a WebSocket route", () => {
    assert.strictEqual(BaseUrl.webSocketPattern("/ws", base), "ws://127.0.0.1:8080/ws")
    assert.strictEqual(BaseUrl.webSocketPattern("/ws/**", "https://example.com/"), "wss://example.com/ws/**")
    assert.strictEqual(BaseUrl.webSocketPattern("wss://other/ws", base), "wss://other/ws")
  })
})
