/**
 * What HAR and trace recordings share: the clock their times are read on, where their
 * files go, and the zip they are written as.
 *
 * Times come from the library's monotonic clock, never Effect's `Clock`, so a recording made under `TestClock`
 * still has a timeline; wall time is the anchor read once as the recording starts, plus the monotonic time since.
 */
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Mime from "effect/http/Mime"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type * as FilePath from "../FilePath.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import { now } from "./adapter.ts"
import { dirname, isAbsolute } from "./paths.ts"
import type * as Runtime from "./runtime.ts"

/** The monotonic clock, anchored to wall time when a recording starts. */
export interface Clock {
  readonly wall: number
  readonly monotonic: MonotonicInstant.MonotonicInstant
}

export const anchor = (): Clock => ({ wall: Date.now(), monotonic: now() })

/** A monotonic instant in milliseconds, to the microsecond, as traces write them. */
export const millis = (at: MonotonicInstant.MonotonicInstant): number => Math.round(at / 1e3) / 1e3

/** Milliseconds between two instants, to the microsecond; never negative. */
export const between = (from: MonotonicInstant.MonotonicInstant, to: MonotonicInstant.MonotonicInstant): number =>
  Math.max(0, Math.round((to - from) / 1e3) / 1e3)

/** The wall time of an instant, as an ISO 8601 string. */
export const wallTime = (clock: Clock, at: MonotonicInstant.MonotonicInstant): string =>
  new Date(clock.wall + (at - clock.monotonic) / 1e6).toISOString()

/** Why a file couldn't be written, for the module's `WriteFailed`. */
export interface WriteFailure {
  readonly path: string
  readonly hint: string
  readonly cause?: unknown
}

/** An output path, absolute: a relative one is resolved with Effect's `Path`, which the layer needs for it. */
export const resolve = (
  runtime: Runtime.Runtime,
  path: FilePath.Local | string
): Effect.Effect<FilePath.Local, WriteFailure> => {
  if (isAbsolute(path)) return Effect.succeed(path as FilePath.Local)
  return Option.match(runtime.path, {
    onNone: () =>
      Effect.fail({ path, hint: "The path is relative, and the browser's layer was built without Effect's Path" }),
    onSome: (paths) => Effect.succeed(paths.resolve(path) as FilePath.Local)
  })
}

/** Writes a file, creating the directories on the way to it. */
export const write = (
  runtime: Runtime.Runtime,
  path: FilePath.Local,
  content: Uint8Array
): Effect.Effect<FilePath.Local, WriteFailure> =>
  Option.match(runtime.fileSystem, {
    onNone: () => Effect.fail({ path, hint: "The browser's layer was built without Effect's FileSystem" }),
    onSome: (fs) => {
      const directory = dirname(path)
      return fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError((error): WriteFailure => ({
          path,
          hint: `Its directory ${directory} couldn't be created: ${error.message}`,
          cause: error
        })),
        Effect.andThen(
          fs.writeFile(path, content).pipe(
            Effect.mapError((error): WriteFailure => ({ path, hint: error.message, cause: error }))
          )
        ),
        Effect.as(path)
      )
    }
  })

/** A zip of files, deflated but for those already compressed. */
export const zip = (
  files: ReadonlyArray<{ readonly path: string; readonly content: string | Uint8Array }>
): Effect.Effect<Uint8Array, WriteFailure> =>
  Stream.fromIterable(files.map((file) =>
    Zip.file(file.path, file.content, {
      method: /\.(png|jpe?g|gif|webp|zip|gz|woff2?)$/i.test(file.path) ? "Store" : "Deflate"
    })
  )).pipe(
    Stream.pipeThroughChannel(Zip.encode()),
    Stream.mkUint8Array,
    Effect.mapError((error): WriteFailure => ({ path: "", hint: `The zip couldn't be encoded: ${error.message}` }))
  )

/** A file extension for a MIME type, as Effect's `Mime` gives it; `bin` for one it doesn't know. */
export const extension = (mimeType: string): string => Option.getOrElse(Mime.getExtension(mimeType), () => "bin")
