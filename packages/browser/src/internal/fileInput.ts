/**
 * Files to upload, as the library reads them (review 14, candidate 9): where their bytes come from, and the
 * path the browser is given. A local path is on this machine and a remote one on the browser's host; a launched
 * browser shares this machine, so both reach it as they are, once a relative local path is resolved.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as FileInput from "../FileInput.ts"
import * as Reason from "../Reason.ts"
import { isAbsolute } from "./paths.ts"
import type * as Runtime from "./runtime.ts"

/** Where a file's bytes come from. */
export type Source =
  | { readonly _tag: "Local"; readonly path: string }
  | { readonly _tag: "Remote"; readonly path: string }

const TypeId = "~@usestrider/browser/FileInput"
const SourceKey = "~@usestrider/browser/FileInput/source"

export const make = (source: Source): FileInput.FileInput =>
  ({ [TypeId]: TypeId, [SourceKey]: source }) as unknown as FileInput.FileInput

export const source = (input: FileInput.FileInput): Source => (input as unknown as Record<string, Source>)[SourceKey]!

/** The path the browser is given for a file; a relative local path is resolved with Effect's `Path`. */
export const path = (
  runtime: Runtime.Runtime,
  input: FileInput.FileInput
): Effect.Effect<string, Reason.InvalidInput> => {
  const from = source(input)
  if (from._tag === "Remote" || isAbsolute(from.path)) return Effect.succeed(from.path)
  return Option.match(runtime.path, {
    onNone: () =>
      Effect.fail(
        new Reason.InvalidInput({
          input: "FileInput.local",
          expected: "an absolute path, or Effect's Path to resolve a relative one",
          hint: `${JSON.stringify(from.path)} is relative, and the browser's layer was built without Path`
        })
      ),
    onSome: (path) => Effect.succeed(path.resolve(from.path))
  })
}
