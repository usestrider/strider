import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Urls from "../src/internal/urls.ts"

describe("Urls.reported", () => {
  it("treats a document's placeholder names as about:blank", () => {
    for (const placeholder of ["", ":", "about:blank"]) {
      assert.strictEqual(Urls.reported(placeholder), "about:blank")
    }
  })

  it("keeps an absolute URL", () => {
    assert.strictEqual(Urls.reported("https://example.com/a?b#c"), "https://example.com/a?b#c")
  })

  it("falls back for malformed reported URLs", () => {
    for (const url of ["nope", "/path", "::"]) {
      assert.strictEqual(Urls.reported(url), "about:blank")
    }
  })
})

it.effect("keeps optional URL parsing and valid placeholders silent", () =>
  Effect.gen(function*() {
    const warnings: Array<unknown> = []
    yield* Effect.sync(() => {
      for (const url of ["nope", "/path", "::", "", ":"]) {
        assert.isTrue(Option.isNone(Urls.reportedOption(url)))
      }
      assert.deepStrictEqual(Urls.reportedOption("https://example.com/"), Option.some("https://example.com/"))
      for (const url of ["", ":", "about:blank", "https://example.com/"]) Urls.reported(url)
    }).pipe(
      Effect.provideService(Logger.CurrentLoggers, new Set([Logger.make((entry) => warnings.push(entry.message))]))
    )
    assert.deepStrictEqual(warnings, [])
  }))
