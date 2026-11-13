/** Output checks shared by codec-backed VideoWriter layers. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, layer } from "@effect/vitest"
import { VideoWriter } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { deflateSync } from "node:zlib"
import * as BrowserClock from "../../src/internal/browserClock.ts"
import * as Video from "../../src/internal/video.ts"
import { lastVideoFrame } from "./videoFrames.ts"

const png = (width: number, height: number, color: readonly number[]) =>
  pngFromRows(width, height, () => Buffer.from(Array.from({ length: width }, () => color).flat()))

const pngFromRows = (width: number, height: number, rowAt: (y: number) => Buffer) => {
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind), data])
    let crc = 0xffffffff
    for (const byte of body) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    const size = Buffer.alloc(4)
    size.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([size, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk(
      "IDAT",
      deflateSync(
        Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), rowAt(y)])))
      )
    ),
    chunk("IEND", Buffer.alloc(0))
  ])
}

const textWidth = 1280
const textHeight = 720

/** A page of small text: 6 by 9 pixel glyph cells with one-pixel strokes in a deterministic pseudo-random pattern. */
const textPage = (scroll: number) => {
  const pixels = Buffer.alloc(textWidth * textHeight * 3, 255)
  const glyph = (code: number) => {
    let state = (code * 2654435761) >>> 0
    return Array.from({ length: 5 * 7 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state >>> 29 < 3
    })
  }
  for (let line = 0; line * 12 < textHeight + scroll + 12; line++) {
    for (let column = 0; column * 6 < textWidth; column++) {
      if (column % 7 === 6) continue
      const cells = glyph((line * 131 + column * 17) % 94)
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i]) continue
        const x = column * 6 + (i % 5)
        const y = line * 12 + Math.floor(i / 5) + 3 - scroll
        if (y < 0 || y >= textHeight) continue
        const at = (y * textWidth + x) * 3
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 20
      }
    }
  }
  return pixels
}

const psnr = (a: Buffer, b: Buffer) => {
  let error = 0
  for (let i = 0; i < a.length; i++) error += (a[i]! - b[i]!) ** 2
  return error === 0 ? 100 : 10 * Math.log10((255 * 255) / (error / a.length))
}

export const writerConformance = (
  name: string,
  writer: Layer.Layer<VideoWriter.VideoWriter, never, ChildProcessSpawner.ChildProcessSpawner>
) => {
  layer(writer.pipe(Layer.provide(NodeServices.layer)), { excludeTestServices: true })((it) => {
    it.effect(
      `${name} validates the final picture after a delayed first frame`,
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-writer-delayed-first-frame-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const encoder = yield* VideoWriter.VideoWriter
          const earlier = png(2, 2, [255, 0, 0])
          const final = png(2, 2, [0, 0, 255])
          const file = yield* encoder.write(
            Stream.fromIterable([127, 237, 391, 412]).pipe(Stream.map((at) => ({
              at: at * 1e6,
              format: "png" as const,
              width: 2,
              height: 2,
              data: at === 412 ? final : earlier
            }))),
            { path: path.join(directory, "delayed-first-frame.webm"), width: 2, height: 2 }
          )
          const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
            "-v",
            "error",
            "-show_frames",
            "-show_format",
            "-of",
            "json",
            file
          ], { encoding: "utf8" }))
          assert.deepStrictEqual(
            probe.frames.map((frame: { best_effort_timestamp_time: string }) =>
              Number(frame.best_effort_timestamp_time)
            ),
            [0.127, 0.237, 0.391, 0.412]
          )
          assert.strictEqual(Number(probe.format.start_time), 0.127)
          assert.strictEqual(Number(probe.format.duration), 0.413)
          const pixels = lastVideoFrame(file, probe.frames.length)
          assert.strictEqual(pixels.length, 2 * 2 * 3)
          for (let offset = 0; offset < pixels.length; offset += 3) {
            assert.isBelow(pixels[offset]!, 20, "final frame is not an earlier red picture")
            assert.isAbove(pixels[offset + 2]!, 200, "final frame is blue")
          }
        }),
      60_000
    )

    it.effect(
      `${name} starts core recordings at zero without shifting delayed capture times`,
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-writer-zero-start-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const encoder = yield* VideoWriter.VideoWriter
          let now = 0
          const file = yield* Video.record(
            Effect.succeed({
              frames: Stream.fromIterable([127, 237, 391, 412]).pipe(Stream.map((at) => ({
                frame: {
                  at: at * 1e6,
                  format: "png" as const,
                  width: 2,
                  height: 2,
                  data: png(2, 2, at < 391 ? [255, 0, 0] : [0, 0, 255])
                },
                take: Effect.sync(() => {
                  now = at * 1e6
                })
              }))),
              ended: Effect.never
            }),
            encoder,
            directory
          ).pipe(Effect.provideService(BrowserClock.CurrentClock, {
            now: () => now as ReturnType<BrowserClock.BrowserClock["now"]>,
            sleep: () => Effect.never
          }))
          const output = yield* file
          const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
            "-v",
            "error",
            "-show_frames",
            "-show_format",
            "-of",
            "json",
            output
          ], { encoding: "utf8" }))
          // Check seeking first so the pre-fix failure demonstrates the reported empty output.
          const final = lastVideoFrame(output, probe.frames.length)
          for (const distance of ["-0.1", "-0.01"]) {
            const pixels = execFileSync(process.env["STRIDER_FFMPEG"]!, [
              "-v",
              "error",
              "-sseof",
              distance,
              "-i",
              output,
              "-frames:v",
              "1",
              "-fps_mode",
              "passthrough",
              "-f",
              "rawvideo",
              "-pix_fmt",
              "rgb24",
              "pipe:1"
            ])
            assert.strictEqual(pixels.length, 12, `end seek ${distance} returns a picture`)
            for (let offset = 0; offset < pixels.length; offset += 3) {
              assert.isAbove(pixels[offset + 2]!, 200, "end seek returns the final blue picture")
              assert.isBelow(pixels[offset]!, 20, "end seek does not return an earlier red picture")
            }
          }
          assert.deepStrictEqual(
            probe.frames.map((frame: { best_effort_timestamp_time: string }) =>
              Number(frame.best_effort_timestamp_time)
            ),
            [0, 0.127, 0.237, 0.391, 0.412, 0.412]
          )
          assert.strictEqual(Number(probe.format.start_time), 0)
          assert.strictEqual(Number(probe.format.duration), 0.413)
          assert.isAbove(final[2]!, 200, "final picture is blue")
          assert.isBelow(final[0]!, 20, "final picture is not red")
        }),
      60_000
    )

    it.effect(
      `${name} preserves the later four-second frame after normalizing a backward source time`,
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-writer-order-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const encoder = yield* VideoWriter.VideoWriter
          const data = png(2, 2, [255, 0, 0])
          const file = yield* Video.record(
            Effect.succeed({
              frames: Stream.fromIterable([0, 5e6, 3e6, 4e9]).pipe(Stream.map((at) => ({
                frame: { at, format: "png" as const, data, width: 2, height: 2 },
                take: Effect.void
              }))),
              ended: Effect.never
            }),
            encoder,
            directory
          ).pipe(Effect.provideService(BrowserClock.CurrentClock, {
            now: () => 0 as ReturnType<BrowserClock.BrowserClock["now"]>,
            sleep: () => Effect.never
          }))
          const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
            "-v",
            "error",
            "-show_frames",
            "-show_format",
            "-of",
            "json",
            yield* file
          ], { encoding: "utf8" }))
          assert.deepStrictEqual(
            probe.frames.map((frame: { best_effort_timestamp_time: string }) =>
              Number(frame.best_effort_timestamp_time)
            ),
            [0, 0.005, 0.005, 4, 4]
          )
          assert.closeTo(Number(probe.format.duration), 4, 0.002)
        }),
      60_000
    )

    it.effect(
      `${name} writer conformance: preserves variable frame times and fits changing odd sizes`,
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-writer-conformance-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const encoder = yield* VideoWriter.VideoWriter
          const file = yield* encoder.write(
            Stream.make(
              { at: 0, format: "png", width: 321, height: 243, data: png(321, 243, [255, 0, 0]) },
              { at: 237e6, format: "png", width: 161, height: 243, data: png(161, 243, [0, 0, 255]) },
              { at: 2391e6, format: "png", width: 643, height: 243, data: png(643, 243, [0, 255, 0]) },
              { at: 4127e6, format: "png", width: 643, height: 243, data: png(643, 243, [0, 255, 0]) }
            ),
            { path: path.join(directory, "conformance.webm"), width: 321, height: 243 }
          )
          const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
            "-v",
            "error",
            "-show_frames",
            "-show_format",
            "-of",
            "json",
            file
          ], { encoding: "utf8" }))
          assert.strictEqual(probe.frames.length, 4)
          assert.deepStrictEqual(
            probe.frames.map((frame: { best_effort_timestamp_time: string }) =>
              Number(frame.best_effort_timestamp_time)
            ),
            [0, 0.237, 2.391, 4.127]
          )
          assert.closeTo(Number(probe.format.duration), 4.127, 0.002, "still duration includes the final timestamp")
          for (const frame of probe.frames) assert.deepStrictEqual([frame.width, frame.height], [321, 243])
          const pixels = execFileSync(process.env["STRIDER_FFMPEG"]!, [
            "-v",
            "error",
            "-i",
            file,
            "-fps_mode",
            "passthrough",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1"
          ], { maxBuffer: 2_000_000 })
          const frameBytes = 321 * 243 * 3
          assert.strictEqual(pixels.length, frameBytes * 4)
          assert.isAbove(pixels[(121 * 321 + 160) * 3]!, 200, "first frame is red")
          assert.isAbove(pixels[frameBytes + (121 * 321 + 160) * 3 + 2]!, 200, "second frame is blue")
          assert.isAbove(pixels[frameBytes * 2 + (121 * 321 + 160) * 3 + 1]!, 200, "wide third frame is scaled green")
          for (const x of [5, 315]) {
            assert.isAbove(pixels[frameBytes * 2 + (121 * 321 + x) * 3 + 1]!, 200, "wide image fills fitted width")
          }
          for (const y of [65, 177]) {
            assert.isAbove(pixels[frameBytes * 2 + (y * 321 + 160) * 3 + 1]!, 200, "wide image fills fitted height")
          }
          for (const y of [20, 220]) {
            for (let channel = 0; channel < 3; channel++) {
              assert.isBelow(
                pixels[frameBytes * 2 + (y * 321 + 160) * 3 + channel]!,
                20,
                "scaled image has centred black padding"
              )
            }
          }
          for (const x of [40, 280]) {
            for (let channel = 0; channel < 3; channel++) {
              assert.isBelow(pixels[frameBytes + (121 * 321 + x) * 3 + channel]!, 20, "padding is centred and black")
            }
          }
        }),
      60_000
    )

    it.effect(
      `${name} keeps small text legible at desktop size`,
      () =>
        Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-writer-quality-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const encoder = yield* VideoWriter.VideoWriter
          const scrolls = [0, 0, 5, 11, 17, 17, 29, 40]
          const sources = scrolls.map(textPage)
          const started = Date.now()
          const file = yield* encoder.write(
            Stream.fromIterable(sources).pipe(Stream.map((pixels, index) => ({
              at: index * 150e6,
              format: "png" as const,
              width: textWidth,
              height: textHeight,
              data: pngFromRows(
                textWidth,
                textHeight,
                (y) => pixels.subarray(y * textWidth * 3, (y + 1) * textWidth * 3)
              )
            }))),
            { path: path.join(directory, "quality.webm"), width: textWidth, height: textHeight }
          )
          const elapsed = Date.now() - started
          const decoded = execFileSync(process.env["STRIDER_FFMPEG"]!, [
            "-v",
            "error",
            "-i",
            file,
            "-fps_mode",
            "passthrough",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1"
          ], { maxBuffer: 1 << 28 })
          const frameBytes = textWidth * textHeight * 3
          assert.strictEqual(decoded.length, frameBytes * sources.length)
          const scores = sources.map((source, index) =>
            psnr(source, decoded.subarray(index * frameBytes, (index + 1) * frameBytes))
          )
          const worst = Math.min(...scores)
          console.log(
            `video quality ${name}: encode ${elapsed} ms, ${fs.statSync(file).size} bytes, ` +
              `PSNR worst ${worst.toFixed(2)} dB, per frame ${scores.map((score) => score.toFixed(1)).join(" ")}`
          )
          assert.isAbove(worst, 30, "every decoded frame is close to its source")
        }),
      120_000
    )
  })
}
