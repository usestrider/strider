import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { scenario } from "./fixtures/traceVideo.ts"

describe("native trace video", () => {
  for (
    const [stage, reason] of [["acquisition", "ACQUISITION_REASON"], ["stop", "STOP_REASON"], [
      "file-read",
      "READ_REASON"
    ]] as const
  ) {
    it.effect(`retains ${stage} failure as a reader-visible console error across exports`, () =>
      Effect.scoped(Effect.gen(function*() {
        const { files, reads, stops } = yield* scenario(stage)
        assert.strictEqual(stops, stage === "acquisition" ? 0 : 1)
        assert.strictEqual(reads, stage === "file-read" ? 1 : 0)
        for (const [index, file] of files.entries()) {
          const events = new TextDecoder().decode(file.get("trace.trace")).trim().split("\n").map((line) =>
            JSON.parse(line)
          )
          const errors = events.filter((event) => event.type === "console" && event.messageType === "error")
          assert.strictEqual(errors.length, 1)
          assert.strictEqual(errors[0].pageId, "video-page")
          assert.include(errors[0].text, stage)
          assert.include(errors[0].text, reason)
          assert.include(
            errors[0].text,
            index === 0
              ? "https://example.test/video?token=REDACTED"
              : "https://user:pass@example.test/video?token=secret#fragment"
          )
          if (index === 0) assert.notInclude(errors[0].text, "secret")
          assert.isFalse(events.some((event) => event.type === "video"))
        }
      })))
  }
  it.effect("keeps successful video bytes and reads them only on the first export", () =>
    Effect.scoped(Effect.gen(function*() {
      const { files, reads, stops, bytes } = yield* scenario()
      assert.strictEqual(reads, 1)
      assert.strictEqual(stops, 1)
      for (const file of files) {
        assert.deepStrictEqual(file.get("resources/video-page.webm"), bytes)
        const events = new TextDecoder().decode(file.get("trace.trace")).trim().split("\n").map((line) =>
          JSON.parse(line)
        )
        assert.strictEqual(events.filter((event) => event.type === "video").length, 1)
        assert.strictEqual(events.filter((event) => event.type === "console").length, 0)
      }
    })))
})
