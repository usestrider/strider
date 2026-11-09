import { assert, it } from "@effect/vitest"
import { fields } from "../src/internal/emulation.ts"

it("declares native extra request headers", () => {
  assert.deepStrictEqual(fields({ extraHTTPHeaders: { "X-Strider": "test" } }), [{
    capability: "emulation.extraHTTPHeaders",
    override: { _tag: "ExtraHeaders", headers: { "x-strider": "test" } }
  }])
})
