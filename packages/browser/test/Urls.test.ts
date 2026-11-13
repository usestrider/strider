import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Tracer from "effect/Tracer"
import * as Diagnostics from "../src/Diagnostics.ts"
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

for (const preset of ["default", "local"] as const) {
  it.effect(`shows each malformed URL diagnostic as the ${preset} preset allows`, () =>
    Effect.gen(function*() {
      const original = "https//user:pa55word@example.com/?token=s3cret"
      const expected = preset === "default" ? "REDACTED" : original
      const warnings: Array<ReturnType<typeof Logger.formatStructured.log>> = []
      const spans: Array<Tracer.NativeSpan> = []
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        }
      })
      const report = Effect.sync(() => assert.strictEqual(Urls.reported(original), "about:blank"))
      yield* (preset === "local" ? report.pipe(Effect.provideService(Diagnostics.CurrentPreset, "local")) : report)
        .pipe(
          Effect.withTracer(tracer),
          Effect.provideService(
            Logger.CurrentLoggers,
            new Set([Logger.make((entry) => {
              if (entry.logLevel === "Warn") warnings.push(Logger.formatStructured.log(entry))
            })])
          )
        )
      assert.strictEqual(warnings.length, 1)
      assert.strictEqual(warnings[0]?.annotations["browser.url.reported"], expected)
      assert.strictEqual(spans.length, 1)
      const span = spans[0]!
      assert.strictEqual(span.status._tag, "Ended")
      assert.strictEqual(span.attributes.get("browser.operation"), "browser.url.malformed")
      assert.strictEqual(span.attributes.get("browser.url.reported"), expected)
      assert.strictEqual(span.events.length, 1)
      assert.strictEqual(span.events[0]?.[0], "browser.url.malformed")
      assert.strictEqual(span.events[0]?.[2]?.["browser.url.reported"], expected)
    }))
}
