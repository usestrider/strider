import { assert, describe, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Grants from "../src/internal/grants.ts"
import type * as Model from "../src/internal/model.ts"

const at = (origin: string | undefined, permissions: ReadonlyArray<string>, setting: "granted" | "denied") =>
  ({
    origin: origin === undefined ? Option.none() : Option.some(origin),
    permissions,
    setting
  }) satisfies Model.GrantEntry

const settled = (grants: ReadonlyArray<Model.GrantEntry>) =>
  Grants.resolve(grants).map((each) => [Option.getOrUndefined(each.origin), each.permissions[0], each.setting])

describe("permission declarations in force", () => {
  it("lets a later declaration for every origin override an origin's own", () => {
    assert.deepStrictEqual(
      settled([at("https://a.test", ["notifications", "geolocation"], "granted"), at(undefined, ["notifications"], "denied")]),
      [[undefined, "notifications", "denied"], ["https://a.test", "notifications", "denied"], [
        "https://a.test",
        "geolocation",
        "granted"
      ]]
    )
  })

  it("lets a later declaration for one origin override every origin's there alone", () => {
    assert.deepStrictEqual(
      settled([at(undefined, ["notifications"], "denied"), at("https://a.test", ["notifications"], "granted")]),
      [[undefined, "notifications", "denied"], ["https://a.test", "notifications", "granted"]]
    )
  })
})
