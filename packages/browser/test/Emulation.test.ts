import { assert, it } from "@effect/vitest"
import { fields } from "../src/internal/emulation.ts"

it("declares native extra request headers", () => {
  assert.deepStrictEqual(fields({ extraHTTPHeaders: { "X-Strider": "test" } }), [{
    capability: "emulation.extraHTTPHeaders",
    override: { _tag: "ExtraHeaders", headers: { "x-strider": "test" } }
  }])
})

it("rejects malformed header names and values", () => {
  for (const headers of [{ "bad name": "value" }, { "x-test": "a\r\nb" }, { "x-test": "\u0100" }, { "x-test": 1 }]) {
    const result = fields({ extraHTTPHeaders: headers as Record<string, string> })
    assert.strictEqual("_tag" in result ? result._tag : "valid", "InvalidInput")
  }
})

it("does not declare headers when omitted", () => {
  assert.deepStrictEqual(fields({}), [])
})
