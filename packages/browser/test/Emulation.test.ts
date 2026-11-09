import { assert, it } from "@effect/vitest"
import type { Target, UserContext } from "@usestrider/browser"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Declarations from "../src/internal/declarations.ts"
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

it("merges headers between scopes but replaces each scope's map", () => {
  const registry = Declarations.make()
  const context = "context" as UserContext.Id
  const page = "page" as Target.NavigableId
  const add = (scope: Adapter.DeclarationScope, headers: Record<string, string>, id: string) =>
    registry.add(scope, { _tag: "Override", override: { _tag: "ExtraHeaders", headers } }, id as Adapter.RegistrationId)
  add({ _tag: "UserContext", context }, { "x-context": "context", "x-shared": "context" }, "context")
  add({ _tag: "Page", page }, { "x-old": "old", "x-shared": "old" }, "old")
  add({ _tag: "Page", page }, { "x-shared": "page" }, "page")
  const read = () => registry.overrides({ context, page }).get("ExtraHeaders")
  assert.deepStrictEqual(read(), { _tag: "ExtraHeaders", headers: { "x-context": "context", "x-shared": "page" } })
  registry.remove("page" as Adapter.RegistrationId)
  assert.deepStrictEqual(read(), {
    _tag: "ExtraHeaders",
    headers: { "x-context": "context", "x-shared": "old", "x-old": "old" }
  })
  add({ _tag: "Page", page }, {}, "empty")
  assert.deepStrictEqual(read(), { _tag: "ExtraHeaders", headers: { "x-context": "context", "x-shared": "context" } })
})
