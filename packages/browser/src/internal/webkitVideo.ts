/** Validates explicitly enabled stock-WebKit PNG polling before connecting or launching. */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as WebKit from "../webkit/WebKit.ts"
import * as Launch from "./launch.ts"

export interface Settings {
  readonly polled: number
  readonly directory: string
}

export const settings = Effect.fnUntraced(function*(video: WebKit.LaunchOptions["video"]) {
  if (video === undefined) return undefined
  const duration = Duration.fromInput(video.polled)
  const polled = Option.isSome(duration) ? Duration.toMillis(duration.value) : NaN
  if (!Number.isFinite(polled) || polled <= 0) {
    return yield* Launch.invalidInput({
      input: "video.polled",
      expected: "a finite positive duration",
      hint: "Name the delay between completed PNG captures"
    }, "check video")
  }
  if (typeof video.directory !== "string" || !Launch.isAbsolute(video.directory) || video.directory.includes("\0")) {
    return yield* Launch.invalidInput({
      input: "video.directory",
      expected: "an absolute writable directory",
      hint: "Video files use a caller-owned directory, independently of downloads"
    }, "check video")
  }
  const fs = yield* Effect.serviceOption(FileSystem.FileSystem)
  if (Option.isNone(fs)) {
    return yield* Launch.invalidInput({
      input: "video.directory",
      expected: "a FileSystem service to check the directory",
      hint: "Provide FileSystem, for example with NodeServices.layer"
    }, "check video")
  }
  // Keep the create/remove pair together on interruption, including typed removal failures.
  yield* fs.value.makeTempDirectory({ directory: video.directory, prefix: ".strider-video-check-" }).pipe(
    Effect.flatMap((path) => fs.value.remove(path, { recursive: true })),
    Effect.uninterruptible,
    Effect.catch((error) =>
      Launch.invalidInput(
        { input: "video.directory", expected: "an existing writable directory", hint: error.message },
        "check video"
      )
    )
  )
  return { polled, directory: video.directory } satisfies Settings
})
