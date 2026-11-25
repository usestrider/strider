/** A context's `baseURL`: how relative URLs and URL patterns resolve against it. */
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as BaseUrl from "../src/internal/baseUrl.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Handles from "../src/internal/handles.ts"
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

  it("keeps literal marker text inherited from the base", () => {
    assert.strictEqual(
      BaseUrl.pattern("/api/**", "http://zq0zq.example/"),
      "http://zq0zq.example/api/**"
    )
  })

  it("keeps literal marker text after a hostname is lowercased", () => {
    assert.strictEqual(
      BaseUrl.pattern("//ZQ0ZQ.example/**", base),
      "http://zq0zq.example/**"
    )
  })

  it("keeps literal marker text after a hostname is percent-decoded", () => {
    assert.strictEqual(BaseUrl.pattern("/api/**", "http://%7Aq0zq.example/"), "http://zq0zq.example/api/**")
    assert.strictEqual(BaseUrl.pattern("//%7Aq0zq.example/*", base), "http://zq0zq.example/*")
  })

  it("removes a wildcard segment followed by a parent segment", () => {
    assert.strictEqual(BaseUrl.pattern("/a/*/../b", base), "http://127.0.0.1:8080/a/b")
  })

  it("keeps a percent-encoded uppercase host when a parent segment removes the wildcard", () => {
    const pattern = BaseUrl.pattern("//%5A%51%30%5A%51.example/*/../a", base)
    assert.strictEqual(pattern, "http://zq0zq.example/a")
    assert.isFalse(UrlPattern.compile(pattern)("http://other.example/a"))
  })

  it("keeps a Unicode host when a parent segment removes the wildcard", () => {
    const pattern = BaseUrl.pattern("//ｚｑ０ｚｑ.example/*/../a", base)
    assert.strictEqual(pattern, "http://zq0zq.example/a")
    assert.isFalse(UrlPattern.compile(pattern)("http://other.example/a"))
  })

  it("keeps a host with stripped tabs when a parent segment removes the wildcard", () => {
    const pattern = BaseUrl.pattern("//z\tq0z\tq.example/*/../a", base)
    assert.strictEqual(pattern, "http://zq0zq.example/a")
    assert.isFalse(UrlPattern.compile(pattern)("http://other.example/a"))
  })

  it("preserves marker text in the input and query and fragment delimiters in globs", () => {
    assert.strictEqual(BaseUrl.pattern("/zq0zq/**", base), "http://127.0.0.1:8080/zq0zq/**")
    const pattern = BaseUrl.pattern("/a*?q=*#x*", base)
    assert.strictEqual(pattern, "http://127.0.0.1:8080/a*?q=*#x*")
    assert.isTrue(UrlPattern.compile(pattern)("http://127.0.0.1:8080/abc?q=one#xyz"))
    assert.strictEqual(BaseUrl.pattern("//HOST/**", base), "http://host/**")
    // A colon after a scheme-shaped name is a scheme under the stated resolution rule.
    assert.strictEqual(BaseUrl.pattern("host:8080/path", base), "host:8080/path")
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

describe("A launched default context's base URL", () => {
  it.effect("outlives a control scope and is restored when the launch scope closes", () =>
    Effect.gen(function*() {
      const entry = yield* Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const entry = Handles.target(browser.defaultContext).behind.entry
        assert.strictEqual(BaseUrl.of(entry), base)
        yield* Effect.scoped(Effect.gen(function*() {
          const controlled = yield* browser.defaultContext.control
          assert.strictEqual(BaseUrl.of(Handles.target(controlled).behind.entry), base)
        }))
        assert.strictEqual(BaseUrl.of(entry), base)
        return entry
      }).pipe(Effect.provide(BrowserImpl.layerLaunched(
        "fake",
        { baseURL: base },
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })
      )))
      assert.isUndefined(BaseUrl.of(entry))
    }))
})
