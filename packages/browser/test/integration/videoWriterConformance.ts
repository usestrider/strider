/** Output checks shared by codec-backed VideoWriter layers. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, layer } from "@effect/vitest"
import { VideoWriter } from "@usestrider/browser"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { deflateSync } from "node:zlib"

const png = (width: number, height: number, color: readonly number[]) => {
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => color).flat())])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0))
  ])
}

export const writerConformance = (
  name: string,
  writer: Layer.Layer<VideoWriter.VideoWriter, never, ChildProcessSpawner.ChildProcessSpawner>
) => {
  layer(writer.pipe(Layer.provide(NodeServices.layer)), { excludeTestServices: true })((it) => {
    it.effect(`${name} writer conformance: fits changing odd sizes with centred black padding`, () =>
      Effect.gen(function*() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-writer-conformance-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
        const encoder = yield* VideoWriter.VideoWriter
        const file = yield* encoder.write(Stream.make(
          { at: 0, format: "png", width: 321, height: 243, data: png(321, 243, [255, 0, 0]) },
          { at: 40e6, format: "png", width: 161, height: 243, data: png(161, 243, [0, 0, 255]) }
        ), { path: path.join(directory, "conformance.webm"), width: 321, height: 243 })
        const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
          "-v", "error", "-show_frames", "-of", "json", file
        ], { encoding: "utf8" }))
        assert.strictEqual(probe.frames.length, 2)
        for (const frame of probe.frames) assert.deepStrictEqual([frame.width, frame.height], [321, 243])
        const pixels = execFileSync(process.env["STRIDER_FFMPEG"]!, [
          "-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"
        ], { maxBuffer: 2_000_000 })
        const frameBytes = 321 * 243 * 3
        assert.strictEqual(pixels.length, frameBytes * 2)
        assert.isAbove(pixels[(121 * 321 + 160) * 3]!, 200, "first frame is red")
        assert.isAbove(pixels[frameBytes + (121 * 321 + 160) * 3 + 2]!, 200, "second frame is blue")
        for (const x of [40, 280]) {
          for (let channel = 0; channel < 3; channel++) {
            assert.isBelow(pixels[frameBytes + (121 * 321 + x) * 3 + channel]!, 20, "padding is centred and black")
          }
        }
      }), 60_000)
  })
}
