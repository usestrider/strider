import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as VideoOptions from "../src/internal/videoOptions.ts"
import * as VideoWriter from "../src/VideoWriter.ts"

const invalid = (options: Parameters<typeof VideoOptions.validate>[0]) => {
  const result = VideoOptions.validate(options)
  assert(result._tag === "Failure", `expected ${JSON.stringify(options)} to be refused`)
  assert.strictEqual(result.failure._tag, "InvalidInput")
  return result.failure
}

describe("Video options", () => {
  it("takes no options, or valid ones", () => {
    assert.strictEqual(VideoOptions.validate(undefined)._tag, "Success")
    assert.strictEqual(
      VideoOptions.validate({ size: { width: 321, height: 243 }, fps: 12.5, path: "/tmp/a.webm", overwrite: false })
        ._tag,
      "Success"
    )
  })

  it("refuses a width or height that isn't a positive integer", () => {
    for (const size of [{ width: 0, height: 10 }, { width: 10, height: -1 }, { width: 10.5, height: 10 }]) {
      assert.strictEqual(invalid({ size }).input, "size")
    }
    assert.strictEqual(invalid({ size: { width: Number.NaN, height: 10 } }).input, "size")
  })

  it("refuses a frame rate that isn't finite and positive", () => {
    for (const fps of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) assert.strictEqual(invalid({ fps }).input, "fps")
  })

  it("refuses a relative path", () => {
    assert.strictEqual(invalid({ path: "video.webm" }).input, "path")
  })

  it("defaults to the viewport, scaled down but never up to fit 800 by 800", () => {
    assert.deepStrictEqual(VideoOptions.defaultSize({ width: 1600, height: 1200 }), { width: 800, height: 600 })
    assert.deepStrictEqual(VideoOptions.defaultSize({ width: 1280, height: 720 }), { width: 800, height: 450 })
    assert.deepStrictEqual(VideoOptions.defaultSize({ width: 600, height: 1200 }), { width: 400, height: 800 })
    assert.deepStrictEqual(VideoOptions.defaultSize({ width: 640, height: 480 }), { width: 640, height: 480 })
  })

  it.effect("leaves ffmpeg no rate conversion of its own", () =>
    Effect.gen(function*() {
      const seen: Array<ReadonlyArray<string>> = []
      const handle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          if (command._tag === "StandardCommand") seen.push(command.args.map(String))
          return handle
        })
      )
      yield* Effect.gen(function*() {
        const writer = yield* VideoWriter.VideoWriter
        yield* writer.write(Stream.empty, { path: "/tmp/v.webm", width: 2, height: 2 })
        yield* writer.write(Stream.empty, { path: "/tmp/v.webm", width: 2, height: 2, fps: 10 })
      }).pipe(
        Effect.provide(VideoWriter.layerFfmpeg({ path: "/opt/ffmpeg" })),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
      assert.strictEqual(seen.length, 2)
      // The writer resamples to a frame rate itself, so ffmpeg passes exact timestamps through either way
      for (const args of seen.map((each) => each.join(" "))) {
        assert.include(args, "-fps_mode passthrough -enc_time_base 1:1000")
        assert.notInclude(args, "cfr")
        assert.notInclude(args, "fps=")
      }
    }))
})
