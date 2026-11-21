/** Chromium video with a named encoder, including its shared native frame source. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Capability, Trace, VideoWriter } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { chromium } from "../browsers.ts"
import { writerConformance } from "../videoWriterConformance.ts"
import { supports } from "./capabilities.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(
  Layer.provide(VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })),
  Layer.provideMerge(NodeServices.layer)
)

const probe = (file: string) =>
  JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file
  ], { encoding: "utf8" }))

const frameTimes = (file: string): Array<number> =>
  JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
    "-v",
    "error",
    "-show_frames",
    "-of",
    "json",
    file
  ], { encoding: "utf8" })).frames.map((frame: { best_effort_timestamp_time: string }) =>
    Number(frame.best_effort_timestamp_time)
  )

describe("Chromium video writer", () => {
  layer(backend, { excludeTestServices: true })((it) => {
    it.effect(
      "writes playable variable-rate WebM through idle periods and viewport changes while screencasting",
      () =>
        Effect.gen(function*() {
          assert.isTrue(yield* supports("capability.video"))
          const page = yield* Browser.newPage({ emulation: { viewport: { width: 640, height: 480 } } })
          yield* page.goto("data:text/html,<style>html{background:red}</style>")
          const seen = yield* Queue.unbounded<void>()
          const cast = yield* page.capability(Capability.Screencast)
          yield* cast.frames.pipe(Stream.runForEach(() => Queue.offer(seen, undefined)), Effect.forkScoped)
          yield* Queue.take(seen)
          // Video joins an already confirmed idle stream and must get an initial image without a repaint.
          const started = performance.now()
          let stopped = started
          const recording = yield* Effect.scoped(Effect.gen(function*() {
            const video = yield* page.capability(Capability.Video)
            yield* Effect.sleep("600 millis")
            yield* page.emulate({ viewport: { width: 320, height: 480 } })
            yield* page.evaluateInMainWorld(() => {
              document.documentElement.style.background = "blue"
            })
            yield* Queue.take(seen)
            yield* Effect.sleep("800 millis")
            stopped = performance.now()
            return video
          }))
          const file = yield* recording.file
          const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
            "-v",
            "error",
            "-count_frames",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            file
          ], { encoding: "utf8" }))
          const video = probe.streams[0]
          assert.strictEqual(video.codec_name, "vp8")
          assert.strictEqual(Number(probe.format.start_time), 0)

          assert.deepStrictEqual([video.width, video.height], [640, 480])
          assert.isAtMost(Number(video.nb_read_frames), 8)
          assert.isAtLeast(Number(video.nb_read_frames), 3)
          assert.closeTo(Number(probe.format.duration), (stopped - started) / 1000, 0.1)
          // Decode the entire file, so an EBML header alone cannot pass this test.
          execFileSync(process.env["STRIDER_FFMPEG"]!, ["-v", "error", "-i", file, "-f", "null", "-"])
          const pixels = execFileSync(process.env["STRIDER_FFMPEG"]!, [
            "-v",
            "error",
            "-sseof",
            "-0.1",
            "-i",
            file,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1"
          ], { maxBuffer: 2_000_000 })
          assert.strictEqual(pixels.length, 640 * 480 * 3)
          const center = (240 * 640 + 320) * 3
          assert.isAbove(pixels[center + 2]!, 200, "last image is blue after resize")
          assert.isBelow(pixels[0]!, 20, "unused width is padded black")
          console.log(
            "Chromium WebM validation",
            JSON.stringify({
              codec: video.codec_name,
              fps: video.r_frame_rate,
              width: video.width,
              height: video.height,
              frames: video.nb_read_frames,
              duration: probe.format.duration
            })
          )
        }),
      60_000
    )

    it.effect("sizes a recording to the viewport scaled to fit 800 by 800 by default", () =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
        yield* page.goto("data:text/html,<p>default size</p>")
        const recording = yield* Effect.scoped(Effect.gen(function*() {
          const video = yield* page.capability(Capability.Video)
          yield* Effect.sleep("300 millis")
          return video
        }))
        const video = probe(yield* recording.file).streams[0]
        assert.deepStrictEqual([video.width, video.height], [800, 450])
      }), 60_000)

    it.effect(
      "writes to a path at a size and constant frame rate, without a downloads directory",
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-video-path-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const target = path.join(directory, "run.webm")
          const page = yield* Browser.newPage({
            downloads: "deny",
            emulation: { viewport: { width: 640, height: 480 } }
          })
          yield* page.goto("data:text/html,<p>sized</p>")
          const recording = yield* Effect.scoped(Effect.gen(function*() {
            const video = yield* page.capability(Capability.Video, {
              path: target,
              size: { width: 320, height: 200 },
              fps: 10
            })
            yield* Effect.sleep("500 millis")
            return video
          }))
          assert.strictEqual(yield* recording.file, target)
          const video = probe(target).streams[0]
          assert.deepStrictEqual([video.width, video.height], [320, 200])
          // Frames every 100 milliseconds, the last of them the one-millisecond end marker at the rounded stop time
          const times = frameTimes(target)
          assert.isAtLeast(times.length, 3)
          for (let index = 1; index < times.length; index++) {
            assert.closeTo(times[index]! - times[index - 1]!, 0.1, 0.001)
          }
          assert.deepStrictEqual(fs.readdirSync(directory), ["run.webm"])
        }),
      60_000
    )

    it.effect(
      "refuses an existing file without overwrite, and replaces it with overwrite",
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-video-overwrite-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const target = path.join(directory, "run.webm")
          fs.writeFileSync(target, "kept")
          const page = yield* Browser.newPage()
          yield* page.goto("data:text/html,<p>overwrite</p>")
          const refused = yield* Effect.flip(
            Effect.scoped(page.capability(Capability.Video, { path: target, overwrite: false }))
          )
          assert(Capability.isCapabilityError(refused), String(refused))
          assert.deepInclude(refused.reason, { _tag: "InvalidInput", input: "path" })
          assert.strictEqual(fs.readFileSync(target, "utf8"), "kept")
          const missing = yield* Effect.flip(
            Effect.scoped(page.capability(Capability.Video, { path: path.join(directory, "no/such/run.webm") }))
          )
          assert(Capability.isCapabilityError(missing), String(missing))
          assert.deepInclude(missing.reason, { _tag: "InvalidInput", input: "path" })
          const recording = yield* Effect.scoped(Effect.gen(function*() {
            const video = yield* page.capability(Capability.Video, { path: target })
            yield* Effect.sleep("300 millis")
            return video
          }))
          yield* recording.file
          assert.deepStrictEqual(Array.from(fs.readFileSync(target).subarray(0, 4)), [0x1a, 0x45, 0xdf, 0xa3])
        }),
      60_000
    )

    it.effect("refuses a directory as the video file path before recording", () =>
      Effect.gen(function*() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-video-directory-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
        const target = path.join(directory, "existing-directory")
        fs.mkdirSync(target)
        const page = yield* Browser.newPage()
        yield* page.goto("data:text/html,<p>invalid path</p>")
        const result = yield* Effect.scoped(page.capability(Capability.Video, { path: target })).pipe(Effect.result)
        assert.strictEqual(result._tag, "Failure", "a directory is not a file destination")
        if (result._tag === "Failure") {
          assert(Capability.isCapabilityError(result.failure))
          assert.deepInclude(result.failure.reason, { _tag: "InvalidInput", input: "path" })
        }
        assert.deepStrictEqual(fs.readdirSync(directory), ["existing-directory"])
      }), 60_000)

    it.effect("keeps a destination file that appears during recording", () =>
      Effect.gen(function*() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-video-race-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
        const target = path.join(directory, "run.webm")
        const page = yield* Browser.newPage()
        yield* page.goto("data:text/html,<p>race</p>")
        const recording = yield* Effect.scoped(Effect.gen(function*() {
          const recording = yield* page.capability(Capability.Video, { path: target, overwrite: false })
          fs.writeFileSync(target, "created during recording")
          yield* Effect.sleep("300 millis")
          return recording
        }))
        const failure = yield* recording.file.pipe(Effect.flip)
        assert(Capability.isCapabilityError(failure))
        assert.strictEqual(failure.reason._tag, "BackendFailure")
        assert.strictEqual(fs.readFileSync(target, "utf8"), "created during recording")
        const saved = fs.readdirSync(directory).filter((name) => name !== "run.webm")
        assert.strictEqual(saved.length, 1)
        assert.include(failure.message, saved[0]!)
        assert.strictEqual(probe(path.join(directory, saved[0]!)).streams[0].codec_name, "vp8")
      }), 60_000)

    it.effect("backpressures native acknowledgements without stopping page timers", () =>
      Effect.gen(function*() {
        const blocked = yield* Deferred.make<void>()
        const unblock = yield* Deferred.make<void>()
        let acknowledgements = 0
        let stops = 0
        const writer: VideoWriter.VideoWriter = {
          write: Effect.fnUntraced(
            function*(frames: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) {
              yield* Deferred.succeed(blocked, undefined)
              yield* Deferred.await(unblock)
              yield* Stream.runDrain(frames)
              return destination.path
            }
          )
        }
        const observed = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
          const { transport } = yield* ChromiumLauncher.launch({ executablePath: chromium.executable })
          return yield* CdpAdapter.connect({
            ...transport,
            send: Effect.fnUntraced(function*(message: string) {
              const command = JSON.parse(message)
              if (command.method === "Page.screencastFrameAck") acknowledgements++
              if (command.method === "Page.stopScreencast") stops++
              yield* transport.send(message)
            })
          }, { sink, ownership: "launched" }).pipe(Effect.provideService(VideoWriter.VideoWriter, writer))
        }))
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.goto(
            "data:text/html,<body><script>var paints=0;setInterval(()=>document.body.textContent=++paints,20)</script>",
            { waitUntil: "load" }
          )
          const castScope = yield* Scope.make()
          const cast = yield* page.capability(Capability.Screencast).pipe(Scope.provide(castScope))
          yield* cast.frames.pipe(Stream.runDrain, Effect.forkIn(castScope))
          const videoScope = yield* Scope.make()
          const video = yield* page.capability(Capability.Video).pipe(Scope.provide(videoScope))
          yield* Deferred.await(blocked)
          yield* Effect.sleep("300 millis")
          const before = acknowledgements
          const paints = yield* page.evaluateInMainWorld(() => Number(document.body.textContent))
          yield* Effect.sleep("200 millis")
          assert.strictEqual(acknowledgements, before, "the fast screencast must not bypass a blocked writer")
          assert.isAbove(
            yield* page.evaluateInMainWorld(() => Number(document.body.textContent)),
            paints,
            "the renderer continues painting while native frame delivery is backpressured"
          )
          yield* Deferred.succeed(unblock, undefined)
          yield* Effect.sleep("200 millis")
          assert.isAbove(acknowledgements, before, "native acknowledgements resume when the writer consumes input")
          yield* Scope.close(videoScope, Exit.void)
          yield* video.file
          assert.strictEqual(stops, 0, "the user screencast still owns the session stream")
          yield* Scope.close(castScope, Exit.void)
          assert.strictEqual(stops, 1)
          console.log(
            "Chromium shared-stream probe",
            JSON.stringify({
              acknowledgementsWhileBlocked: before,
              acknowledgementsAfterResume: acknowledgements,
              stops
            })
          )
        }).pipe(Effect.provide(observed))
      }), 60_000)

    it.effect(
      "finishes a playable file when the page closes while the recording scope stays open",
      () =>
        Effect.gen(function*() {
          const read = yield* Deferred.make<void>()
          const writer = Layer.effect(VideoWriter.VideoWriter)(Effect.gen(function*() {
            const encoder = yield* VideoWriter.VideoWriter
            return {
              write: (frames: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) =>
                encoder.write(frames.pipe(Stream.tap(() => Deferred.succeed(read, undefined))), destination)
            }
          })).pipe(Layer.provide(VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })))
          const browser = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(writer))
          yield* Effect.gen(function*() {
            const page = yield* Browser.newPage({ emulation: { viewport: { width: 321, height: 243 } } })
            yield* page.goto("data:text/html,<h1>finished before scope closure</h1>")
            const recording = yield* page.capability(Capability.Video)
            yield* Deferred.await(read)
            yield* page.close()
            const file = yield* recording.file
            const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
              "-v",
              "error",
              "-count_frames",
              "-show_streams",
              "-of",
              "json",
              file
            ], { encoding: "utf8" }))
            assert.isAtLeast(Number(probe.streams[0].nb_read_frames), 1)
            execFileSync(process.env["STRIDER_FFMPEG"]!, ["-v", "error", "-i", file, "-f", "null", "-"])
          }).pipe(Effect.provide(browser))
        }),
      60_000
    )

    it.effect("accepts PNG input and preserves odd recording dimensions", () =>
      Effect.gen(function*() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-video-png-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
        const page = yield* Browser.newPage({ emulation: { viewport: { width: 321, height: 243 } } })
        const data = yield* page.screenshot()
        const file = yield* Effect.gen(function*() {
          const writer = yield* VideoWriter.VideoWriter
          return yield* writer.write(
            Stream.make(
              { at: 0, format: "png", width: 321, height: 243, data },
              { at: 40e6, format: "png", width: 321, height: 243, data }
            ),
            { path: path.join(directory, "png.webm"), width: 321, height: 243 }
          )
        }).pipe(Effect.provide(VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })))
        const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-of",
          "json",
          file
        ], { encoding: "utf8" }))
        assert.deepStrictEqual([probe.streams[0].width, probe.streams[0].height], [321, 243])
        assert.strictEqual(Number(probe.streams[0].nb_read_frames), 2)
      }), 60_000)

    it.effect("exports native Chromium recording as a trace video event", () =>
      Effect.gen(function*() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-video-trace-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
        const firstFrame = yield* Deferred.make<void>()
        const writer = Layer.effect(VideoWriter.VideoWriter)(Effect.gen(function*() {
          const encoder = yield* VideoWriter.VideoWriter
          return {
            write: (frames: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) =>
              encoder.write(frames.pipe(Stream.tap(() => Deferred.succeed(firstFrame, undefined))), destination)
          }
        })).pipe(Layer.provide(VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })))
        const browser = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(writer))
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const trace = yield* Trace.record(page, { screencast: "native" })
          yield* page.goto("data:text/html,<h1>video trace</h1>")
          // Export stops the native recorder. Observe this recording's actual writer input before stopping it.
          yield* Deferred.await(firstFrame).pipe(Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () =>
              Effect.fail(new Error("The native trace recorder delivered no frame to its writer within 10 seconds"))
          }))
          const file = path.join(directory, "trace.zip")
          yield* trace.exportTrace(file)
          const files = new Map<string, Uint8Array>()
          yield* Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
            Stream.pipeThroughChannel(Zip.decode()),
            Stream.runForEach((entry) =>
              Stream.runCollect(entry.body).pipe(Effect.map((chunks) => {
                files.set(entry.header.path, Buffer.concat(chunks))
              }))
            )
          )
          const events = new TextDecoder().decode(files.get("trace.trace")).trim().split("\n").map((line) =>
            JSON.parse(line)
          )
          const videos = events.filter((event) => event.type === "video")
          assert.strictEqual(videos.length, 1)
          assert.isAbove(videos[0].width, 0)
          assert.isAbove(videos[0].height, 0)
          assert.deepStrictEqual(Array.from(files.get(videos[0].file)!.subarray(0, 4)), [0x1a, 0x45, 0xdf, 0xa3])
        }).pipe(Effect.provide(browser))
      }), 60_000)
  })
})

writerConformance("ffmpeg", VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! }))

// Keep optional-service refusal separate from conformance with a real encoder.
describe("Chromium video without a writer", () => {
  layer(Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer)), {
    excludeTestServices: true
  })((it) => {
    it.effect("refuses video when no writer is configured", () =>
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assert.strictEqual(
          (yield* browser.capabilities).entries.find((entry) => entry.name === "capability.video")!.status,
          "unsupported"
        )
        const page = yield* Browser.newPage()
        const error = yield* page.capability(Capability.Video).pipe(Effect.flip)
        assert(Capability.isCapabilityError(error), String(error))
        assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.video" })
      }), 60_000)
  })
})
