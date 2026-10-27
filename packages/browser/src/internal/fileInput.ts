/**
 * Files to upload, as the library reads them (review 14, candidate 9): where their bytes come from, and the
 * path the browser is given. A local path is on this machine and a remote one on the browser's host; a launched
 * browser shares this machine, so both reach it as they are, once a relative local path is resolved. A file of
 * bytes is made in the page instead (review 20, candidate 1), so it needs no file system the browser shares.
 */
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Option from "effect/Option"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as FileInput from "../FileInput.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as Evaluation from "./evaluation.ts"
import type * as Model from "./model.ts"
import { isAbsolute } from "./paths.ts"
import * as Runtime from "./runtime.ts"

/** A file made in the page: its name, MIME type and bytes. */
export interface Made {
  readonly _tag: "Bytes"
  readonly name: string
  readonly mimeType: string
  readonly data: Uint8Array
}

/** Where a file's bytes come from. */
export type Source =
  | { readonly _tag: "Local"; readonly path: string }
  | { readonly _tag: "Remote"; readonly path: string }
  | Made

const TypeId = "~@usestrider/browser/FileInput"
const SourceKey = "~@usestrider/browser/FileInput/source"

export const make = (source: Source): FileInput.FileInput =>
  ({ [TypeId]: TypeId, [SourceKey]: source }) as unknown as FileInput.FileInput

export const source = (input: FileInput.FileInput): Source => (input as unknown as Record<string, Source>)[SourceKey]!

/**
 * A list's files as the browser gets them: the paths it reads, or the files made in the page. One call can't
 * mix them, since the browser sets the paths and the page the made ones, each replacing the other's.
 */
export const partition = (
  files: ReadonlyArray<FileInput.FileInput>,
  input: string
): Effect.Effect<
  { readonly _tag: "Paths"; readonly files: ReadonlyArray<FileInput.FileInput> } | {
    readonly _tag: "Made"
    readonly files: ReadonlyArray<Made>
  },
  Reason.InvalidInput
> => {
  const made = files.map(source).filter((from): from is Made => from._tag === "Bytes")
  if (made.length === 0) return Effect.succeed({ _tag: "Paths", files })
  if (made.length === files.length) return Effect.succeed({ _tag: "Made", files: made })
  return Effect.fail(
    new Reason.InvalidInput({
      input,
      expected: "files that are all FileInput.bytes, or all paths",
      hint: "The browser sets files from paths and the page makes files from bytes, each replacing the other's; " +
        "give every file as bytes, or every file as a path"
    })
  )
}

/** The path the browser is given for a file; a relative local path is resolved with Effect's `Path`. */
export const path = (
  runtime: Runtime.Runtime,
  input: FileInput.FileInput
): Effect.Effect<string, Reason.InvalidInput> => {
  const from = source(input)
  if (from._tag === "Bytes") {
    return Effect.fail(
      new Reason.InvalidInput({
        input: "FileInput.bytes",
        expected: "a file with a path",
        hint: `${JSON.stringify(from.name)} is made in the page and has no path`
      })
    )
  }
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

/** Runs in the caller's isolated world: makes each file, sets them on the input, and dispatches as a choice does. */
function setMadeFiles(
  element: HTMLInputElement,
  files: ReadonlyArray<{ readonly name: string; readonly mimeType: string; readonly data: string }>
) {
  const transfer = new DataTransfer()
  for (const file of files) {
    const binary = atob(file.data)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    transfer.items.add(new File([bytes], file.name, { type: file.mimeType }))
  }
  element.files = transfer.files
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
}

/**
 * Sets files made in the page on a file input (review 20, P1): their bytes cross into the caller's isolated world
 * as base64 and become `File`s, set through a `DataTransfer`, with `input` and `change` dispatched.
 */
export const setMade = (
  runtime: Runtime.Runtime,
  node: Adapter.NodeBinding,
  files: ReadonlyArray<Made>,
  options: {
    readonly page: Option.Option<Model.PageEntry>
    readonly at: MonotonicInstant.MonotonicInstant
    readonly id: Diagnostics.OperationId
  }
): Effect.Effect<void, Evaluation.Failure> =>
  Effect.gen(function*() {
    // The library's own function: the page's world where the backend makes no other
    const realm = yield* Evaluation.documentRealm(
      runtime,
      node.document,
      yield* Runtime.ownWorld(runtime, Evaluation.isolatedWorld),
      options.id
    )
    const encoded = files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      data: Encoding.encode(file.data)
    }))
    const rest = yield* Evaluation.toLocal([encoded], realm, 1)
    yield* Evaluation.call(runtime, {
      realm,
      functionDeclaration: setMadeFiles.toString(),
      arguments: [{ _tag: "Node", node }, ...rest],
      result: "value",
      userActivation: false,
      page: options.page,
      at: options.at,
      id: options.id
    })
  })
