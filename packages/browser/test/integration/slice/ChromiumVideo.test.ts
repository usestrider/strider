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
            "data:text/html,<body><script>var paints=0;setInterval(()=>document.body.textContent=++paints,20)</script>"
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
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page, { screencast: "native" })
        yield* page.goto("data:text/html,<h1>video trace</h1>")
        yield* Effect.sleep("400 millis")
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
      }), 60_000)
  })
})

writerConformance("ffmpeg", VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! }))
