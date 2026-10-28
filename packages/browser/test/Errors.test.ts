import { assert, describe, it } from "@effect/vitest"
import * as CookieJar from "@usestrider/browser/CookieJar"
import * as Diagnostics from "@usestrider/browser/Diagnostics"
import * as Locator from "@usestrider/browser/Locator"
import * as Page from "@usestrider/browser/Page"
import * as PageNavigation from "@usestrider/browser/PageNavigation"
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

  it("names where a navigation was going, when its reason knows", () => {
    const url = Option.some("http://127.0.0.1:9/" as Url.Url)
    const failed = new PageNavigation.NavigationFailed({
      url,
      netError: "net::ERR_CONNECTION_REFUSED",
      hint: "The browser couldn't load the page"
    })
    assert.strictEqual(
      new Page.PageError({ operation: "Page.goto", reason: failed, diagnostics }).message,
      "Page.goto: Navigation to http://127.0.0.1:9/ failed: net::ERR_CONNECTION_REFUSED (The browser couldn't load the page)"
    )
    // A reload's or a traversal's knows none
    assert.strictEqual(
      new PageNavigation.NavigationFailed({ ...failed, url: Option.none() }).message,
      "Navigation failed: net::ERR_CONNECTION_REFUSED (The browser couldn't load the page)"
    )
    assert.strictEqual(
      new PageNavigation.NavigationCanceled({ url, why: "beforeunload", hint: "kept" }).message,
      "Navigation to http://127.0.0.1:9/ canceled by beforeunload (kept)"
    )
    assert.strictEqual(
      new PageNavigation.NavigationSuperseded({ url, by: "another", hint: "replaced" }).message,
      "Navigation to http://127.0.0.1:9/ superseded by another (replaced)"
    )
    assert.strictEqual(
      new PageNavigation.BecameDownload({ url, hint: "stayed" }).message,
      "The navigation to http://127.0.0.1:9/ became a download (stayed)"
    )
    assert.strictEqual(
      new PageNavigation.NoContent({ url, hint: "stayed" }).message,
      "The server answered the navigation to http://127.0.0.1:9/ without content, 204 or 205 (stayed)"
    )
  })

  it("is identified by its guard, and nothing else is", () => {
    assert.isTrue(Locator.isLocatorError(ambiguous))
    assert.isFalse(Locator.isLocatorError(new Error("click failed")))
  })

  it("lifts its reason's cause, so the failure beneath it renders, and has none where the reason has none", () => {
    const missing = new Error("ENOENT: no such file")
    const unreadable = new Locator.LocatorError({
      operation: "setInputFiles",
      locator: "getByLabel(\"Photo\")",
      reason: new Locator.FileUnreadable({ path: "/tmp/photo.png", hint: "check the path", cause: missing }),
      diagnostics
    })
    assert.strictEqual(unreadable.cause, missing)
    assert.isUndefined(ambiguous.cause)
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

  it.effect("reads a partitioned origin's top-level origin, and a state saved before it had one", () =>
    Effect.gen(function*() {
      const partitioned = {
        origin: Url.Origin.make("https://widget.example"),
        partition: {
          _tag: "Partitioned" as const,
          topLevelSite: Url.Site.make("https://news.example"),
          crossSiteAncestor: Option.some(true)
        },
        localStorage: [["seen", Redacted.make("1")] as const],
        indexedDb: []
      }
      // Saved without the key, as older states are: it decodes with no top-level origin
      const before = yield* Schema.encodeEffect(StorageState.Json)(
        new StorageState.StorageState({ cookies: [], origins: [partitioned] })
      )
      assert.notInclude(before, "topLevelOrigin")
      assert.isUndefined((yield* Schema.decodeEffect(StorageState.Json)(before)).origins[0]?.topLevelOrigin)
      const after = yield* Schema.encodeEffect(StorageState.Json)(
        new StorageState.StorageState({
          cookies: [],
          origins: [{ ...partitioned, topLevelOrigin: Url.Origin.make("https://news.example:8443") }]
        })
      )
      assert.strictEqual(
        (yield* Schema.decodeEffect(StorageState.Json)(after)).origins[0]?.topLevelOrigin,
        "https://news.example:8443"
      )
    }))
})
