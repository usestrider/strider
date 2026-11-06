/** Chromium video with a named encoder, including its shared native frame source. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Capability, Trace, VideoWriter } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { chromium } from "../browsers.ts"
import { supports } from "./capabilities.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(
  Layer.provide(VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })),
  Layer.provideMerge(NodeServices.layer)
)

describe("Chromium video writer", () => {
  layer(backend, { excludeTestServices: true })((it) => {
    it.effect(
      "writes playable 25fps WebM through idle periods and viewport changes while screencasting",
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
          const recording = yield* Effect.scoped(Effect.gen(function*() {
            const video = yield* page.capability(Capability.Video)
            yield* Effect.sleep("600 millis")
            yield* page.emulate({ viewport: { width: 320, height: 480 } })
            yield* page.evaluateInMainWorld(() => {
              document.documentElement.style.background = "blue"
            })
            yield* Queue.take(seen)
            yield* Effect.sleep("800 millis")
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
          assert.strictEqual(video.r_frame_rate, "25/1")
          assert.deepStrictEqual([video.width, video.height], [640, 480])
          assert.isAtLeast(Number(video.nb_read_frames), 30)
          assert.isAtLeast(Number(probe.format.duration), 1.2)
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
