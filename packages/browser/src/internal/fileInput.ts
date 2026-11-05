/** Shared preparation of caller-local files, in-memory files and browser-host paths. */
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Mime from "effect/http/Mime"
import * as Option from "effect/Option"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as FileInput from "../FileInput.ts"
import * as Locator from "../Locator.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as Evaluation from "./evaluation.ts"
import type * as Model from "./model.ts"
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
export const prepare = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  files: ReadonlyArray<FileInput.FileInput>
) {
  const sources = files.map(source)
  const remote = sources.filter((from) => from._tag === "Remote")
  if (remote.length > 0 && remote.length !== sources.length) {
    return yield* Effect.fail(
      new Reason.InvalidInput({
        input: "files",
        expected: "browser-host paths alone, or caller-local files and bytes",
        hint: "FileInput.remote cannot be mixed with FileInput.local or FileInput.bytes"
      })
    )
  }
  if (remote.length > 0) return { _tag: "Paths", files: remote.map((from) => from.path) } as const
  const made = yield* Effect.forEach(
    sources,
    (from): Effect.Effect<Made, Reason.InvalidInput | Locator.FileUnreadable> => {
      if (from._tag === "Bytes") return Effect.succeed(from)
      if (Option.isNone(runtime.fileSystem) || Option.isNone(runtime.path)) {
        return Effect.fail(
          new Reason.InvalidInput({
            input: "FileInput.local",
            expected: "Effect's FileSystem and Path services when building the browser layer",
            hint: "Local files are read on the caller and transferred to the browser"
          })
        )
      }
      const path = runtime.path.value.resolve(from.path)
      const name = runtime.path.value.basename(path)
      return runtime.fileSystem.value.readFile(path).pipe(
        Effect.mapError((error) => new Locator.FileUnreadable({ path, hint: String(error) })),
        Effect.map((data): Made => ({
          _tag: "Bytes",
          name,
          data,
          mimeType: Option.getOrElse(Mime.getType(name), () => "application/octet-stream")
        }))
      )
    }
  )
  return { _tag: "Made", files: made } as const
})

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
 * Sets files made in the page on a file input: their bytes cross into the caller's isolated world
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
