/**
 * Writes timestamped image frames to a finished WebM file.
 *
 * Provide a writer to Chromium, or to WebKit with explicit video polling options, to enable `Capability.Video`.
 * Firefox writes its own files.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import * as Streams from "effect/Stream"
import * as BrowserClock from "./internal/browserClock.ts"
import * as VideoContainer from "./internal/videoContainer.ts"
import * as Reason from "./Reason.ts"

/**
 * An image at a timestamp in nanoseconds relative to the recording start. Each image is shown until the next
 * timestamp. Recordings supply a copy of the first picture at time zero when its capture time is later,
 * keeping the original frame at its capture time; the final image repeats the last picture at recording end.
 * Timestamps never decrease:
 * a source time before its predecessor is held at the preceding timestamp. Chromium maps browser
 * timestamps from a local receipt anchor and caps them at receipt time. Decreasing delivery latency
 * can shorten source intervals; backward clock jumps can flatten them until source time catches up.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Frame = Schema.Struct({
  at: Schema.Number,
  format: Schema.Literals(["jpeg", "png"]),
  data: Schema.Uint8Array,
  width: Schema.Number,
  height: Schema.Number
})

/**
 * One image at nanoseconds relative to recording start, shown until the next timestamp.
 * Recordings begin with the first picture at zero, retain its capture-time frame, and end with a copy
 * of the last picture at recording end. Times never decrease.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Frame = typeof Frame.Type

/**
 * The destination and fixed output size. Writers must output every frame at exactly these dimensions,
 * scaling to fit, centring, and padding with black. Writers must preserve frame timestamps: the last
 * picture lasts until the final frame's timestamp, which marks the recording end.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Destination = Schema.Struct({ path: Schema.String, width: Schema.Number, height: Schema.Number })

/**
 * A file and its fixed output dimensions in device pixels. Writers fit images to this size and preserve
 * their timestamps through the final recording-end frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Destination = typeof Destination.Type

/**
 * A writer could not start, accept frames, or finish its file.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class VideoWriterError extends Schema.TaggedError<VideoWriterError>()("VideoWriterError", {
  reason: Reason.BackendFailure
}) {
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Writes a finite stream to a file, finishing when the input ends. Interrupting the write releases its resources.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VideoWriter {
  /**
   * Consumes timestamped images without adding a fixed frame rate, then completes with the finished file's path.
   * A slow write backpressures the source.
   *
   * **Example** (Writing frames with a provided writer)
   *
   * ```ts import.meta.vitest
   * import { VideoWriter } from "@usestrider/browser"
   * import { Effect, Stream } from "effect"
   *
   * const write = Effect.fn("write")(function*(frames: Stream.Stream<VideoWriter.Frame>) {
   *   const writer = yield* VideoWriter.VideoWriter
   *   return yield* writer.write(frames, { path: "/tmp/run.webm", width: 800, height: 600 })
   * })
   * ```
   */
  readonly write: (frames: Stream.Stream<Frame>, destination: Destination) => Effect.Effect<string, VideoWriterError>
}

/**
 * The optional service Chromium and opted-in WebKit read when their browser layers are built.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const VideoWriter: Context.Service<VideoWriter, VideoWriter> = Context.Service<VideoWriter>(
  "@usestrider/browser/VideoWriter"
)

const failure = (hint: string) =>
  new VideoWriterError({
    reason: new Reason.BackendFailure({ kind: "Rejected", method: "VideoWriter.write", hint })
  })

/**
 * Writes VP8 WebM with the absolute ffmpeg executable at `path`, using its stdin. Nothing is installed or found on PATH.
 *
 * **Details**
 *
 * Requires `ChildProcessSpawner`. The output has no audio and preserves variable frame times to millisecond
 * precision; images are scaled proportionally and padded with black to the recording's original dimensions. Closing the input finishes the file.
 *
 * **Example** (Enabling Chromium video)
 *
 * ```ts import.meta.vitest
 * import { VideoWriter } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Layer } from "effect"
 *
 * const browser = Chromium.layer({ executablePath: "/opt/chromium" }).pipe(
 *   Layer.provide(VideoWriter.layerFfmpeg({ path: "/opt/ffmpeg" }))
 * )
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layerFfmpeg = (
  options: { readonly path: string }
): Layer.Layer<VideoWriter, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(VideoWriter)(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return {
      write: Effect.fnUntraced(
        function*(frames: Stream.Stream<Frame>, destination: Destination) {
          if (!/^(\/|[A-Za-z]:[\\/])/.test(options.path)) {
            return yield* Effect.fail(failure("ffmpeg path must be absolute"))
          }
          const { height, path, width } = destination
          const process = yield* spawner.spawn(ChildProcess.make(options.path, [
            "-nostdin",
            "-loglevel",
            "error",
            "-f",
            "matroska",
            "-copyts",
            "-i",
            "pipe:0",
            "-vf",
            `scale=${width}:${height}:force_original_aspect_ratio=decrease,format=yuv444p,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,setsar=1`,
            "-c:v",
            "libvpx",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-pix_fmt",
            "yuv420p",
            "-fps_mode",
            "passthrough",
            "-enc_time_base",
            "1:1000",
            "-an",
            "-y",
            "-f",
            "webm",
            path
          ], { stdin: "pipe", stdout: "ignore", stderr: "pipe", forceKillAfter: "1 second" })).pipe(BrowserClock.onLive)
          let stderr = ""
          yield* process.stderr.pipe(
            Streams.runForEach((chunk) =>
              Effect.sync(() => {
                stderr = (stderr + new TextDecoder().decode(chunk)).slice(-8192)
              })
            ),
            Effect.forkScoped
          )
          let initialized = false
          yield* frames.pipe(
            Streams.map((frame) => {
              const image = VideoContainer.image(frame)
              if (initialized) return image
              initialized = true
              const header = VideoContainer.header(frame)
              const bytes = new Uint8Array(header.length + image.length)
              bytes.set(header)
              bytes.set(image, header.length)
              return bytes
            }),
            Streams.run(process.stdin),
            Effect.mapError((error) => failure(`${error.message}; ${stderr}`))
          )
          const code = yield* process.exitCode
          if (code !== 0) return yield* Effect.fail(failure(`ffmpeg exited with code ${code}: ${stderr}`))
          return path
        },
        Effect.scoped,
        Effect.mapError((error) => error instanceof VideoWriterError ? error : failure(error.message))
      )
    }
  }))
