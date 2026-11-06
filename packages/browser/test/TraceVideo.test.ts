import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
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
  it.effect("explains a video whose acquisition has not finished when the trace is exported", () =>
    Effect.scoped(Effect.gen(function*() {
      const { files, stops, reads } = yield* scenario("pending")
      assert.strictEqual(stops, 0)
      assert.strictEqual(reads, 0)
      for (const file of files) {
        const events = new TextDecoder().decode(file.get("trace.trace")).trim().split("\n").map((line) =>
          JSON.parse(line)
        )
        assert.isFalse(events.some((event) => event.type === "video"))
        const errors = events.filter((event) => event.type === "console" && event.messageType === "error")
        assert.strictEqual(errors.length, 1)
        assert.strictEqual(errors[0].pageId, "video-page")
        assert.include(errors[0].text, "acquisition")
      }
    })))
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
        const videos = events.filter((event) => event.type === "video")
        assert.strictEqual(videos.length, 1)
        assert.strictEqual(videos[0].width, 32)
        assert.strictEqual(videos[0].height, 24)
        assert.strictEqual(events.filter((event) => event.type === "console").length, 0)
      }
    })))
})

for (const stage of ["stop", "file-read"] as const) {
  it.effect(`preserves export interruption during ${stage}`, () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(Effect.scoped(scenario(undefined, stage)))
      assert(Exit.isFailure(exit))
      assert.isTrue(Cause.hasInterruptsOnly(exit.cause))
    }))
}
