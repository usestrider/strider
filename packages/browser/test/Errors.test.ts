import { assert, describe, it } from "@effect/vitest"
import * as CookieJar from "@usestrider/browser/CookieJar"
import * as Diagnostics from "@usestrider/browser/Diagnostics"
import * as Locator from "@usestrider/browser/Locator"
import * as StorageState from "@usestrider/browser/StorageState"
import * as Url from "@usestrider/browser/Url"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const diagnostics = new Diagnostics.Diagnostics({
  operationId: Diagnostics.OperationId.make("op-1"),
  dispatch: { _tag: "NotSent" },
  progress: [],
  lastObserved: Option.none(),
  cleanup: { _tag: "NotNeeded" }
})

const ambiguous = new Locator.LocatorError({
  operation: "click",
  locator: "getByText(\"Save\")",
  reason: new Locator.StrictViolation({
    candidates: [{ description: "button \"Save\"", visible: true }, { description: "link \"Save\"", visible: true }],
    suggestions: ["getByRole('button', { name: 'Save' })"],
    hint: "try getByRole('button', { name: 'Save' })"
  }),
  diagnostics
})

describe("module errors", () => {
  it("renders the operation, the locator and the reason's message, hint included", () => {
    assert.strictEqual(
      ambiguous.message,
      "click getByText(\"Save\"): 2 matches (try getByRole('button', { name: 'Save' }))"
    )
  })

  it("is identified by its guard, and nothing else is", () => {
    assert.isTrue(Locator.isLocatorError(ambiguous))
    assert.isFalse(Locator.isLocatorError(new Error("click failed")))
  })

  it.effect("recovers by reason with catchReason", () =>
    Effect.gen(function*() {
      const suggestions = yield* Effect.fail(ambiguous).pipe(
        Effect.catchReason("LocatorError", "StrictViolation", (reason) => Effect.succeed(reason.suggestions))
      )
      assert.deepStrictEqual(suggestions, ["getByRole('button', { name: 'Save' })"])
    }))
})

describe("StorageState.Json", () => {
  it.effect("writes secrets out in full, and reads them back redacted", () =>
    Effect.gen(function*() {
      const state = new StorageState.StorageState({
        cookies: [
          new CookieJar.Cookie({
            name: CookieJar.Name.make("session"),
            value: Redacted.make("s3cret"),
            domain: CookieJar.Domain.make(".example.com"),
            path: "/",
            expires: Option.none(),
            httpOnly: true,
            secure: true,
            sameSite: Option.some("lax"),
            partitionKey: { _tag: "Unpartitioned" },
            priority: Option.some("medium")
          })
        ],
        origins: [{
          origin: Url.Origin.make("https://example.com"),
          partition: { _tag: "Unpartitioned" },
          localStorage: [["theme", Redacted.make("dark")]],
          indexedDb: []
        }]
      })
      assert.notInclude(String(state.cookies[0]?.value), "s3cret")
      const logged = yield* Schema.encodeEffect(Schema.fromJsonString(StorageState.StorageState))(state)
      assert.notInclude(logged, "s3cret") // Effect's default JSON encoding, as the CLI and logs use it
      const json = yield* Schema.encodeEffect(StorageState.Json)(state)
      assert.include(json, "s3cret")
      const back = yield* Schema.decodeEffect(StorageState.Json)(json)
      const cookie = back.cookies[0]
      assert.isDefined(cookie)
      assert.strictEqual(Redacted.value(cookie.value), "s3cret")
    }))
})
