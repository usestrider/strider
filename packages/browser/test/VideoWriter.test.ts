import { assert, describe, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as Browser from "../src/Browser.ts"
import * as Cdp from "../src/internal/cdpAdapter.ts"
import * as VideoWriter from "../src/VideoWriter.ts"
import * as WebKit from "../src/internal/webkitAdapter/capabilities.ts"

describe("VideoWriter", () => {
  it("reports opted-in WebKit video without enabling downloads or native screencasts", () => {
    const info = new Browser.Info({ protocol: "webkit", product: "WebKit", version: "test", revision: "test" })
    for (const capabilities of [WebKit.attachedCapabilities, WebKit.launchedCapabilities]) {
      const off = capabilities(info).entries.find((e) => e.name === "capability.video")!
      assert.strictEqual(off.status, "unsupported")
      const on = capabilities(info, true)
      assert.strictEqual(on.entries.find((e) => e.name === "capability.video")!.status, "supported")
      assert.strictEqual(on.entries.find((e) => e.name === "capability.screencast")!.status, "unsupported")
      assert.strictEqual(on.entries.find((e) => e.name === "downloads")!.status, "unsupported")
    }
  })

  it("reports Chromium video only with an optional writer", () => {
    const info = new Browser.Info({ protocol: "cdp", product: "Chromium", version: "test", revision: "test" })
    const entry = (writer: boolean) =>
      Cdp.capabilities(info, "launched", true, writer).entries.find((e) => e.name === "capability.video")!
    assert.strictEqual(entry(false).status, "unsupported")
    assert.include(entry(false).limitations.join(" "), "VideoWriter")
    assert.strictEqual(entry(true).status, "supported")
  })

  it.effect("spawns and releases the real encoder on a live clock under TestClock", () =>
    Effect.gen(function*() {
      const testClock = yield* Clock.Clock
      let released = false
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
      const spawn = Effect.acquireRelease(
        Clock.clockWith((clock) =>
          Effect.sync(() => {
            assert.notStrictEqual(clock, testClock, "the real process must not inherit TestClock")
            return handle
          })
        ),
        () =>
          Clock.clockWith((clock) =>
            Effect.sync(() => {
              assert.notStrictEqual(clock, testClock, "process finalizers must retain the live clock")
              released = true
            })
          )
      )
      yield* Effect.gen(function*() {
        const writer = yield* VideoWriter.VideoWriter
        yield* writer.write(Stream.empty, { path: "/tmp/video.webm", width: 2, height: 2 })
      }).pipe(
        Effect.provide(VideoWriter.layerFfmpeg({ path: "/opt/ffmpeg" })),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => spawn))
      )
      assert.isTrue(released)
    }))

  it.effect("accepts timestamped PNG frames without a browser or a process dependency", () =>
    Effect.gen(function*() {
      const writer = yield* VideoWriter.VideoWriter
      assert.strictEqual(
        yield* writer.write(Stream.make({ at: 0, format: "png", data: new Uint8Array(), width: 2, height: 2 }), {
          path: "/tmp/video.webm",
          width: 2,
          height: 2
        }),
        "/tmp/video.webm"
      )
    }).pipe(Effect.provide(Layer.succeed(VideoWriter.VideoWriter, {
      write: (frames, destination) => frames.pipe(Stream.runDrain, Effect.as(destination.path))
    }))))
})
