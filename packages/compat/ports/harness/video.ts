/**
 * What the video ports share: reading a recorded WebM file with ffmpeg and ffprobe (`STRIDER_FFMPEG`, `STRIDER_FFPROBE`),
 * and Playwright's frame-colour checks over it. Playwright's `VideoPlayer` resamples to 25 fps and reads PNGs; these read
 * the file's own frames in order (`-fps_mode passthrough`).
 */
import { assert } from "@effect/vitest"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { execFileSync, spawn } from "node:child_process"
import { rafraf } from "./playwright.ts"

export interface Size {
  readonly width: number
  readonly height: number
}

/** An RGB pixel, read from the file's frames. */
export type Rgb = readonly [number, number, number]

export const isAlmostRed = ([r, g, b]: Rgb) => r > 185 && g < 70 && b < 70

/** The file's first video stream's size, and its duration in seconds. */
export const probe = (file: string): { readonly width: number; readonly height: number; readonly duration: number } => {
  const json = JSON.parse(
    execFileSync(
      process.env["STRIDER_FFPROBE"]!,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8" }
    )
  )
  const stream = json.streams.find((candidate: { readonly codec_type: string }) => candidate.codec_type === "video")
  return { width: stream.width, height: stream.height, duration: Number(json.format.duration) }
}

/**
 * Decodes the file's frames as RGB in order, calling `visit` with each one until it returns true. Decoding stops
 * there, so a search reads no further than its match.
 */
export const decodeFrames = (file: string, size: Size, visit: (frame: Buffer) => boolean) =>
  Effect.promise(() =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.env["STRIDER_FFMPEG"]!, [
        "-v",
        "error",
        "-i",
        file,
        // The file's own frames, not ffmpeg's constant-rate resampling of a variable-rate file.
        "-fps_mode",
        "passthrough",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1"
      ])
      const bytes = size.width * size.height * 3
      let pending = Buffer.alloc(0)
      let stderr = ""
      let stopped = false
      child.stdout.on("data", (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk])
        while (!stopped && pending.length >= bytes) {
          const frame = Buffer.from(pending.subarray(0, bytes))
          pending = pending.subarray(bytes)
          if (visit(frame)) {
            stopped = true
            child.kill()
          }
        }
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (stopped || code === 0) resolve()
        else reject(new Error(stderr))
      })
    })
  )

/** The file's last frame, which is what `seekLastFrame` reads. */
export const lastFrame = Effect.fnUntraced(function*(file: string, size: Size) {
  const seen: { last?: Buffer } = {}
  yield* decodeFrames(file, size, (frame) => {
    seen.last = frame
    return false
  })
  assert.isTrue(seen.last !== undefined, "the file has no decoded frame")
  return seen.last!
})

/** The 10×10 pixels at `offset` of a frame, as Playwright's `seekLastFrame(offset)` reads them. */
export const block = (frame: Buffer, size: Size, offset: { readonly x: number; readonly y: number }): Array<Rgb> => {
  const pixels: Array<Rgb> = []
  for (let y = offset.y; y < offset.y + 10; y++) {
    for (let x = offset.x; x < offset.x + 10; x++) {
      const i = (y * size.width + x) * 3
      pixels.push([frame[i]!, frame[i + 1]!, frame[i + 2]!])
    }
  }
  return pixels
}

/** Playwright's `expectAll`: every pixel satisfies the predicate, or the first one that doesn't is named. */
export const expectAll = (pixels: ReadonlyArray<Rgb>, predicate: (pixel: Rgb) => boolean, name: string) => {
  const bad = pixels.find((pixel) => !predicate(pixel))
  assert.isTrue(bad === undefined, `expected every pixel ${name}, found ${bad}`)
}

/** Playwright's `expectFrames`: a video of `size`, whose last frame is `predicate` at both sampled offsets. */
export const expectFrames = Effect.fnUntraced(function*(
  file: string,
  size: Size,
  predicate: (pixel: Rgb) => boolean,
  name: string
) {
  const info = probe(file)
  assert.isAbove(info.duration, 0)
  assert.strictEqual(info.width, size.width)
  assert.strictEqual(info.height, size.height)
  const last = yield* lastFrame(file, size)
  expectAll(block(last, size, { x: 10, y: 10 }), predicate, name)
  expectAll(block(last, size, { x: size.width - 20, y: 10 }), predicate, name)
})

export const expectRedFrames = (file: string, size: Size) => expectFrames(file, size, isAlmostRed, "almost red")

/** Playwright's `ensureSomeFrames`: a hundred pairs of animation frames, then a screenshot. */
export const ensureSomeFrames = Effect.fnUntraced(function*(page: Page.Page) {
  yield* rafraf(page, 100)
  yield* page.screenshot()
})
