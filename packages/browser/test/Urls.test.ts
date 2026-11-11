import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Tracer from "effect/Tracer"
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

it.effect("shows a malformed URL's diagnostics only as the default diagnostics preset allows", () =>
  Effect.gen(function*() {
    // The default preset, "strict", governs how much of a URL Strider shows in its spans and logs; a string it
    // can't parse is shown as REDACTED there, so a credential or token in it doesn't reach a tracer or log.
    const shown: Array<unknown> = []
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      }
    })
    yield* Effect.sync(() => Urls.reported("https//user:pa55word@example.com/?token=s3cret")).pipe(
      Effect.withTracer(tracer),
      Effect.provideService(
        Logger.CurrentLoggers,
        new Set([Logger.make((entry) => shown.push(Logger.formatStructured.log(entry)))])
      )
    )
    for (const span of spans) shown.push([...span.attributes], span.events)
    assert.isAbove(shown.length, 1)
    const text = JSON.stringify(shown)
    assert.notInclude(text, "s3cret")
    assert.notInclude(text, "pa55word")
  }))
