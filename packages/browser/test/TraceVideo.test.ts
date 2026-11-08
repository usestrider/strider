import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as TestRun from "../src/test/TestRun.ts"
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
        assert.include(errors[0].text, "pending")
        assert.notInclude(errors[0].text, "failed")
      }
    })))
  it.effect("retains the no-frame failure when export stops recording before its first image", () =>
    Effect.scoped(Effect.gen(function*() {
      const { files, reads, stops } = yield* scenario("before-frame")
      assert.strictEqual(stops, 1)
      assert.strictEqual(reads, 0)
      for (const file of files) {
        const events = new TextDecoder().decode(file.get("trace.trace")).trim().split("\n").map((line) =>
          JSON.parse(line)
        )
        assert.strictEqual(events.filter((event) => event.type === "video").length, 0)
        const errors = events.filter((event) => event.type === "console" && event.messageType === "error")
        assert.strictEqual(errors.length, 1)
        assert.include(errors[0].text, "failed during stop")
        assert.include(errors[0].text, "The recording ended before receiving a frame; no writer was started")
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

for (const stage of ["pending-success", "pending-failure"] as const) {
  it.effect(`updates a pending acquisition after ${stage}`, () =>
    Effect.scoped(Effect.gen(function*() {
      const { files, stops, reads } = yield* scenario(stage)
      assert.strictEqual(files.length, 3)
      for (const [index, file] of files.entries()) {
        const events = new TextDecoder().decode(file.get("trace.trace")).trim().split("\n").map((line) =>
          JSON.parse(line)
        )
        const messages = events.filter((event) => event.type === "console")
        const videos = events.filter((event) => event.type === "video")
        if (index === 0) {
          assert.strictEqual(messages.length, 1)
          assert.include(messages[0].text, "acquisition")
          assert.include(messages[0].text, "pending")
          assert.notInclude(messages[0].text, "failed")
          assert.strictEqual(videos.length, 0)
        } else if (stage === "pending-success") {
          assert.strictEqual(messages.length, 0)
          assert.strictEqual(videos.length, 1)
        } else {
          assert.strictEqual(messages.length, 1)
          assert.notInclude(messages[0].text, "pending")
          assert.include(messages[0].text, "ACQUISITION_REASON")
          assert.strictEqual(videos.length, 0)
        }
      }
      assert.strictEqual(stops, stage === "pending-success" ? 1 : 0)
      assert.strictEqual(reads, stage === "pending-success" ? 1 : 0)
    })))
}

describe("trace test identity", () => {
  const info = (attempt: number, repeat = 0) =>
    new TestRun.TestInfo({
      project: "chromium",
      file: "/tests/cart.test.ts",
      id: "cart > pays",
      attempt,
      repeat,
      worker: "1",
      shard: ""
    })
  for (const attempt of [0, 1, 2]) {
    it.effect(`snapshots retry ${attempt} before the current test changes`, () =>
      Effect.scoped(Effect.gen(function*() {
        let current = info(attempt)
        const { files } = yield* scenario(undefined, undefined, () => {
          current = new TestRun.TestInfo({ ...info(99), project: "other", file: "/other.test.ts", id: "another test" })
        }).pipe(
          Effect.provideService(TestRun.TestRun, {
            get info() {
              return current
            },
            attach: () => Effect.void
          })
        )
        for (const file of files) {
          const header = JSON.parse(new TextDecoder().decode(file.get("trace.trace")).split("\n")[0]!)
          assert.strictEqual(header.title, "cart > pays")
          assert.deepStrictEqual(header.striderTest, {
            project: "chromium",
            file: "/tests/cart.test.ts",
            id: "cart > pays",
            attempt,
            repeat: 0
          })
          assert.strictEqual(header.origin, "library")
          assert.strictEqual(header.version, 9)
          assert.deepStrictEqual(header.options, {})
        }
      })))
  }
  it.effect("snapshots the repeat before identity changes at export", () =>
    Effect.scoped(Effect.gen(function*() {
      let current = info(2, 3)
      const { files } = yield* scenario(undefined, undefined, () => {
        current = info(99, 99)
      }).pipe(
        Effect.provideService(TestRun.TestRun, {
          get info() {
            return current
          },
          attach: () => Effect.void
        })
      )
      for (const file of files) {
        const header = JSON.parse(new TextDecoder().decode(file.get("trace.trace")).split("\n")[0]!)
        assert.strictEqual(header.striderTest.repeat, 3)
        assert.strictEqual(header.striderTest.attempt, 2)
      }
    })))
  it.effect("keeps standalone headers free of test metadata", () =>
    Effect.scoped(Effect.gen(function*() {
      const { files } = yield* scenario()
      const header = JSON.parse(new TextDecoder().decode(files[0]!.get("trace.trace")).split("\n")[0]!)
      assert.notProperty(header, "title")
      assert.notProperty(header, "striderTest")
    })))
  it.effect("omits metadata when the adapter has no running test", () =>
    Effect.scoped(Effect.gen(function*() {
      const { files } = yield* scenario().pipe(Effect.provideService(TestRun.TestRun, {
        info: new TestRun.TestInfo({ project: "", file: "", id: "", attempt: 0, worker: "", shard: "" }),
        attach: () => Effect.void
      }))
      const header = JSON.parse(new TextDecoder().decode(files[0]!.get("trace.trace")).split("\n")[0]!)
      assert.notProperty(header, "title")
      assert.notProperty(header, "striderTest")
    })))
})
