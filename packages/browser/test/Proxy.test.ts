import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Proxy from "../src/internal/proxy.ts"
import type * as UserContext from "../src/UserContext.ts"

describe("proxy options", () => {
  it.effect("normalizes endpoints and defaults without unwrapping the password", () =>
    Effect.gen(function*() {
      for (
        const [server, normalized] of [["EXAMPLE.com:8080", "example.com:8080"], [
          "http://example.com/",
          "example.com:80"
        ], ["http://[2001:db8::1]:8080", "[2001:db8::1]:8080"]] as const
      ) {
        const result = yield* Proxy.normalize({ server }, "test")
        assert.deepStrictEqual(result, { server: normalized, bypass: [] })
      }
      const password = Redacted.make("fixture-password")
      const result = yield* Proxy.normalize({
        server: "host:80",
        bypass: ["EXAMPLE.com", "2001:db8::2"],
        credentials: { username: "user", password }
      }, "test")
      assert.strictEqual(result.credentials?.password, password)
      assert.deepStrictEqual(result.bypass, ["example.com", "2001:db8::2"])
      assert.notInclude(JSON.stringify(result), "fixture-password")
    }))

  for (
    const server of [
      "http://host?",
      "http://host#",
      "http://user:embedded-password@host",
      "http://host/path",
      "http://host:0",
      "http://host:65536"
    ]
  ) {
    it.effect(`refuses invalid endpoint ${server.replace("embedded-password", "REDACTED")}`, () =>
      Effect.gen(function*() {
        const error = yield* Proxy.normalize({ server }, "test").pipe(Effect.flip)
        assert.strictEqual(error._tag, "InvalidInput")
        assert.notInclude(String(error), "embedded-password")
      }))
  }

  for (const host of ["*.example.com", "example.com:8080", "192.0.2.0/24", "host,other", "http://host", " host"]) {
    it.effect(`refuses unsupported bypass syntax ${host}`, () =>
      Effect.gen(function*() {
        const error = yield* Proxy.normalize({ server: "host:8080", bypass: [host] }, "test").pipe(Effect.flip)
        assert.strictEqual(error._tag, "InvalidInput")
      }))
  }

  it.effect("refuses unsupported schemes and malformed credentials without reflecting secrets", () =>
    Effect.gen(function*() {
      for (const server of ["https://host:443", "socks5://host:1080"]) {
        const error = yield* Proxy.normalize({ server }, "test").pipe(Effect.flip)
        assert.strictEqual(error._tag, "Unsupported")
      }
      const untyped = {
        server: "host:8080",
        credentials: { username: "user", password: "plain-secret" }
      } as unknown as NonNullable<UserContext.Options["proxy"]>
      const error = yield* Proxy.normalize(untyped, "test").pipe(Effect.flip)
      assert.strictEqual(error._tag, "InvalidInput")
      assert.notInclude(JSON.stringify(error), "plain-secret")
    }))
})
