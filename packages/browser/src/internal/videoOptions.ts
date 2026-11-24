/** `Capability.Video`'s options: which are valid, and the size a recording takes by default. */
import * as Result from "effect/Result"
import type * as Capability from "../Capability.ts"
import * as Reason from "../Reason.ts"

/** The largest default width and height: a viewport larger in either is scaled down to fit. */
const largest = 800

const invalid = (input: string, expected: string, hint: string) =>
  Result.fail(new Reason.InvalidInput({ input, expected, hint }))

const positiveInteger = (n: number) => Number.isInteger(n) && n > 0

/** The options, or why they can't be recorded with; what is on the file system is checked where it's read. */
export const validate = (
  options: Capability.VideoOptions | undefined
): Result.Result<Capability.VideoOptions, Reason.InvalidInput> => {
  if (options === undefined) return Result.succeed({})
  const { fps, path, size } = options
  if (size !== undefined && !(positiveInteger(size.width) && positiveInteger(size.height))) {
    return invalid("size", "a width and height that are positive integers", `${size.width} by ${size.height}`)
  }
  if (fps !== undefined && !(Number.isFinite(fps) && fps > 0)) {
    return invalid("fps", "a finite, positive frame rate", String(fps))
  }
  if (path !== undefined && !/^(\/|[A-Za-z]:[\\/])/.test(path)) {
    return invalid("path", "an absolute file path", path)
  }
  return Result.succeed(options)
}

/** A viewport in CSS pixels, scaled down (never up) to fit 800 by 800, in whole pixels of at least one. */
export const defaultSize = (viewport: { readonly width: number; readonly height: number }) => {
  const scale = Math.min(1, largest / viewport.width, largest / viewport.height)
  return {
    width: Math.max(1, Math.floor(viewport.width * scale)),
    height: Math.max(1, Math.floor(viewport.height * scale))
  }
}
