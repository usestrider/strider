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
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Evaluation from "./evaluation.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import { isAbsolute } from "./paths.ts"
import * as Runtime from "./runtime.ts"

/** A file made in the page: its name, MIME type and bytes. */
export interface Made {
  readonly _tag: "Bytes"
  readonly name: string
  readonly mimeType: string
  readonly data: Uint8Array
  readonly lastModified?: number | undefined
}

/** Where a file's bytes come from. */
export type Source =
  | { readonly _tag: "Local"; readonly path: string }
  | { readonly _tag: "Remote"; readonly path: string }
  | Made

const chunkSize = 64 * 1024

const TypeId = "~@usestrider/browser/FileInput"
const SourceKey = "~@usestrider/browser/FileInput/source"

export const make = (source: Source): FileInput.FileInput =>
  ({ [TypeId]: TypeId, [SourceKey]: source }) as unknown as FileInput.FileInput

export const source = (input: FileInput.FileInput): Source => (input as unknown as Record<string, Source>)[SourceKey]!

/** Local descriptors keep the file unopened until the scoped transfer. */
export interface LocalMade {
  readonly _tag: "Local"
  readonly path: string
  readonly name: string
  readonly mimeType: string
}
export type TransferFile = Made | LocalMade

/** Select native paths for launched browsers and caller-side transfer for attached browsers. */
export const prepare = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, files: ReadonlyArray<FileInput.FileInput>) {
    const sources = files.map(source)
    const native = (from: Source): from is Extract<Source, { readonly _tag: "Local" | "Remote" }> =>
      from._tag === "Remote" || (from._tag === "Local" && runtime.model.adapter.ownership === "launched")
    const paths = sources.filter(native)
    if (paths.length > 0 && paths.length !== sources.length) {
      return yield* Effect.fail(
        new Reason.InvalidInput({
          input: "files",
          expected: "native paths alone, or transferred files alone",
          hint:
            "Launched Local and Remote are paths; attached Local and Bytes are transferred. These groups cannot be mixed."
        })
      )
    }
    const resolve = (given: string) =>
      isAbsolute(given) ? Effect.succeed(given) : Option.match(runtime.path, {
        onNone: () =>
          Effect.fail(
            new Reason.InvalidInput({
              input: "FileInput.local",
              expected: "an absolute path, or Effect's Path to resolve a relative one",
              hint: "The browser layer was built without Path"
            })
          ),
        onSome: (path) => Effect.succeed(path.resolve(given))
      })
    if (paths.length > 0) {
      return {
        _tag: "Paths",
        files: yield* Effect.forEach(
          paths,
          (from) => from._tag === "Remote" ? Effect.succeed(from.path) : resolve(from.path)
        )
      } as const
    }
    const made = yield* Effect.forEach(
      sources,
      (from) => transferred(runtime, from as Exclude<Source, { _tag: "Remote" }>)
    )
    return { _tag: "Made", files: made } as const
  }
)

/** A file the library sends the page: bytes as given, or a local file it reads with the captured services. */
export const transferred = (
  runtime: Runtime.Runtime,
  from: Exclude<Source, { readonly _tag: "Remote" }>
): Effect.Effect<TransferFile, Reason.InvalidInput> => {
  if (from._tag === "Bytes") return Effect.succeed(from)
  if (Option.isNone(runtime.fileSystem) || Option.isNone(runtime.path)) {
    return Effect.fail(
      new Reason.InvalidInput({
        input: "FileInput.local",
        expected: "Effect's FileSystem and Path services when building the browser layer",
        hint: "Local files the page is sent are read on the caller"
      })
    )
  }
  const path = runtime.path.value.resolve(from.path)
  const name = runtime.path.value.basename(path)
  return Effect.succeed({
    _tag: "Local",
    path,
    name,
    mimeType: Option.getOrElse(Mime.getType(name), () => "application/octet-stream")
  })
}

interface Collector {
  files: Array<File>
  parts: Array<Blob>
}
function beginUpload(element: HTMLInputElement, count: number): Collector | false {
  if (element.type !== "file" || (count > 1 && !element.multiple)) return false
  return { files: [], parts: [] }
}
function appendChunk(collector: Collector, encoded: string) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  collector.parts.push(new Blob([bytes]))
}
function finishFile(collector: Collector, name: string, mimeType: string, lastModified?: number) {
  collector.files.push(
    new File(collector.parts, name, {
      type: mimeType,
      ...(lastModified === undefined ? {} : { lastModified })
    })
  )
  collector.parts.length = 0
}
function commitUpload(collector: Collector, element: HTMLInputElement) {
  if (element.type !== "file" || (collector.files.length > 1 && !element.multiple)) return false
  const transfer = new DataTransfer()
  for (const file of collector.files) transfer.items.add(file)
  element.files = transfer.files
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  collector.files.length = 0
  return true
}
/** The whole upload in one call, for files that fit a single chunk: no collector, no handle to release. */
function uploadAll(
  element: HTMLInputElement,
  files: ReadonlyArray<readonly [string, string, number | undefined, string]>
) {
  if (element.type !== "file" || (files.length > 1 && !element.multiple)) return false
  const transfer = new DataTransfer()
  for (const [name, mimeType, lastModified, encoded] of files) {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    transfer.items.add(
      new File([bytes], name, { type: mimeType, ...(lastModified === undefined ? {} : { lastModified }) })
    )
  }
  element.files = transfer.files
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  return true
}
function discardUpload(collector: Collector) {
  collector.parts.length = 0
  collector.files.length = 0
}

/** Validate native multi-file selection before dispatch; single-file inputs cannot rely on every backend to refuse. */
export const validateCount = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, node: Adapter.NodeBinding, count: number, options: {
    readonly page: Option.Option<Model.PageEntry>
    readonly at: MonotonicInstant.MonotonicInstant
    readonly id: Diagnostics.OperationId
  }) {
    if (count <= 1) return
    const realm = yield* Evaluation.documentRealm(
      runtime,
      node.document,
      yield* Runtime.ownWorld(runtime, Evaluation.isolatedWorld),
      options.id
    )
    const result = yield* Evaluation.call(runtime, {
      realm,
      functionDeclaration: "function(element) { return element.multiple }",
      arguments: [{ _tag: "Node", node }],
      result: "value",
      userActivation: false,
      ...options
    })
    if (result.type === "boolean" && !result.value) {
      return yield* Effect.fail({
        _tag: "Reason" as const,
        reason: new Reason.InvalidInput({
          input: "files",
          expected: "at most one file for an input without multiple",
          hint: "The existing selection is unchanged"
        })
      })
    }
  }
)

/**
 * Prepare a scoped upload and return its final assignment. All-Bytes selections totaling at most 64 KiB
 * encode complete files for one assignment call in the engine utility world. Other selections transfer
 * acknowledged chunks into an isolated-world collector before assignment; stock WebKit uses the page world.
 */
export const prepareMade = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, node: Adapter.NodeBinding, files: ReadonlyArray<TransferFile>, options: {
    readonly dispatch: Operation.Record
    readonly page: Option.Option<Model.PageEntry>
    readonly at: MonotonicInstant.MonotonicInstant
    readonly id: Diagnostics.OperationId
  }) {
    // All-Bytes selections totaling at most 64 KiB, including empty ones, reuse the engine utility world.
    const single = files.every((file): file is Made => file._tag === "Bytes") &&
      files.reduce((total, file) => total + file.data.length, 0) <= chunkSize
    const realm = yield* Evaluation.documentRealm(
      runtime,
      node.document,
      yield* Runtime.ownWorld(runtime, single ? Runtime.utilityWorld : Evaluation.isolatedWorld),
      options.id
    )
    const call = Effect.fnUntraced(function*(
      fn: Function,
      args: ReadonlyArray<Adapter.LocalValue>,
      result: "value" | "handle" = "value",
      at = options.at,
      dispatch?: Operation.Record
    ) {
      if ((yield* BrowserClock.left(at)) <= 0) return yield* Effect.fail({ _tag: "Deadline" as const })
      return yield* Evaluation.call(runtime, {
        realm,
        functionDeclaration: fn.toString(),
        arguments: args,
        result,
        userActivation: false,
        page: options.page,
        id: options.id,
        ...(dispatch === undefined ? {} : { dispatch }),
        at
      })
    })
    const invalid = () => ({
      _tag: "Reason" as const,
      reason: new Reason.InvalidInput({
        input: "files",
        expected: "a file input accepting this number of files",
        hint: "The existing selection is unchanged"
      })
    })
    if (single) {
      const encoded = (files as ReadonlyArray<Made>).map((file) =>
        [file.name, file.mimeType, file.lastModified, Encoding.encode(file.data)] as const
      )
      const commitAll = Effect.fnUntraced(function*() {
        const result = yield* call(
          uploadAll,
          [{ _tag: "Node", node }, ...yield* Evaluation.toLocal([encoded], realm)],
          "value",
          options.at,
          options.dispatch
        )
        if (result.type === "boolean" && !result.value) return yield* Effect.fail(invalid())
      })
      return commitAll()
    }
    const collector = yield* Effect.acquireRelease(
      call(beginUpload, [{ _tag: "Node", node }, ...yield* Evaluation.toLocal([files.length], realm)], "handle"),
      (value) => {
        if (!("handle" in value) || value.handle === undefined) return Effect.void
        const handle = value.handle
        return Operation.detached(Effect.gen(function*() {
          const at = yield* BrowserClock.after(1000)
          yield* call(discardUpload, [{ _tag: "Handle", handle }], "value", at).pipe(Effect.ignore)
          yield* runtime.model.adapter.releaseHandles([handle]).pipe(BrowserClock.until(at), Effect.ignore)
        })).pipe(Effect.ignore)
      }
    )
    if (!("handle" in collector) || collector.handle === undefined) return yield* Effect.fail(invalid())
    const handle: Adapter.LocalValue = { _tag: "Handle", handle: collector.handle }
    for (const file of files) yield* sendFile(runtime, call, handle, realm, file)
    const commit = Effect.fnUntraced(function*() {
      const result = yield* call(commitUpload, [handle, { _tag: "Node", node }], "value", options.at, options.dispatch)
      if (result.type === "boolean" && !result.value) return yield* Effect.fail(invalid())
    })
    return commit()
  }
)

/** Sends one file to a collector in the page, in acknowledged chunks, and makes it a `File` there. */
const sendFile = (
  runtime: Runtime.Runtime,
  call: (
    fn: Function,
    args: ReadonlyArray<Adapter.LocalValue>
  ) => Effect.Effect<Adapter.RemoteValue, Evaluation.Failure>,
  handle: Adapter.LocalValue,
  realm: Target.RealmId,
  file: TransferFile
) =>
  Effect.scoped(Effect.gen(function*() {
    let lastModified: number | undefined
    const chunk = Effect.fnUntraced(function*(data: Uint8Array) {
      yield* call(appendChunk, [handle, ...yield* Evaluation.toLocal([Encoding.encode(data)], realm)])
    })
    if (file._tag === "Local") {
      const unreadable = (error: unknown) => ({
        _tag: "Reason" as const,
        reason: new Locator.FileUnreadable({ path: file.path, hint: String(error) })
      })
      const opened = yield* Option.getOrThrow(runtime.fileSystem).open(file.path).pipe(
        Effect.mapError(unreadable)
      )
      const info = yield* opened.stat.pipe(Effect.mapError(unreadable))
      lastModified = Option.getOrUndefined(Option.map(info.mtime, (time) => time.getTime()))
      while (true) {
        const bytes = yield* opened.readAlloc(chunkSize).pipe(Effect.mapError(unreadable))
        if (Option.isNone(bytes)) break
        yield* chunk(bytes.value)
      }
    } else {
      lastModified = file.lastModified
      for (let offset = 0; offset < file.data.length; offset += chunkSize) {
        yield* chunk(file.data.subarray(offset, offset + chunkSize))
      }
    }
    yield* call(finishFile, [
      handle,
      ...yield* Evaluation.toLocal([file.name, file.mimeType, lastModified], realm)
    ])
  }))

/** Prepare and commit in one upload scope for locator actions. */
export const setMade = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, node: Adapter.NodeBinding, files: ReadonlyArray<TransferFile>, options: {
    readonly dispatch: Operation.Record
    readonly page: Option.Option<Model.PageEntry>
    readonly at: MonotonicInstant.MonotonicInstant
    readonly id: Diagnostics.OperationId
  }) {
    const completed = yield* Effect.scoped(Effect.flatMap(prepareMade(runtime, node, files, options), (apply) => apply))
      .pipe(BrowserClock.until(options.at))
    if (Option.isNone(completed)) return yield* Effect.fail({ _tag: "Deadline" as const })
  }
)

function beginDrop(): Collector {
  return { files: [], parts: [] }
}
/**
 * A drop the page dispatches onto the element: one `DataTransfer` with the collected files, then the data entries,
 * and untrusted `dragenter` and `dragover` at the point, `position` from the padding box or the centre, on the
 * element there when it is inside this one; then `drop` where the `dragover` was canceled, or else `dragleave`.
 * Returns whether the element accepted it.
 */
function dropCollected(
  collector: Collector | null,
  element: Element,
  position: { readonly x: number; readonly y: number } | null,
  entries: ReadonlyArray<readonly [string, string]>
) {
  const box = element.getBoundingClientRect()
  const at = position === null
    ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    : { x: box.left + element.clientLeft + position.x, y: box.top + element.clientTop + position.y }
  const hit = element.ownerDocument.elementFromPoint(at.x, at.y)
  const over = hit !== null && (hit === element || element.contains(hit)) ? hit : element
  const dataTransfer = new DataTransfer()
  if (collector !== null) {
    for (const file of collector.files) dataTransfer.items.add(file)
    collector.files.length = 0
  }
  for (const [type, value] of entries) dataTransfer.setData(type, value)
  const fire = (type: string) =>
    over.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: type !== "dragleave",
        composed: true,
        dataTransfer,
        clientX: at.x,
        clientY: at.y
      })
    )
  fire("dragenter")
  const accepted = !fire("dragover")
  if (accepted) fire("drop")
  else {
    dataTransfer.dropEffect = "none"
    fire("dragleave")
  }
  return accepted
}

/**
 * Drops files and data onto the element: each file sent in acknowledged chunks to a collector in the isolated world
 * (the page's on stock WebKit), then the drop's events dispatched there. Succeeds with whether the element accepted.
 */
export const drop = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, node: Adapter.NodeBinding, files: ReadonlyArray<TransferFile>, options: {
    readonly data: ReadonlyArray<readonly [string, string]>
    readonly position: { readonly x: number; readonly y: number } | null
    readonly dispatch: Operation.Record
    readonly page: Option.Option<Model.PageEntry>
    readonly at: MonotonicInstant.MonotonicInstant
    readonly id: Diagnostics.OperationId
  }) {
    const realm = yield* Evaluation.documentRealm(
      runtime,
      node.document,
      yield* Runtime.ownWorld(runtime, Evaluation.isolatedWorld),
      options.id
    )
    const call = Effect.fnUntraced(function*(
      fn: Function,
      args: ReadonlyArray<Adapter.LocalValue>,
      result: "value" | "handle" = "value",
      at = options.at,
      dispatch?: Operation.Record
    ) {
      if ((yield* BrowserClock.left(at)) <= 0) return yield* Effect.fail({ _tag: "Deadline" as const })
      return yield* Evaluation.call(runtime, {
        realm,
        functionDeclaration: fn.toString(),
        arguments: args,
        result,
        userActivation: false,
        page: options.page,
        id: options.id,
        ...(dispatch === undefined ? {} : { dispatch }),
        at
      })
    })
    const rest = yield* Evaluation.toLocal([options.position, options.data], realm, 2)
    const dispatch = (collector: Adapter.LocalValue) =>
      call(dropCollected, [collector, { _tag: "Node", node }, ...rest], "value", options.at, options.dispatch).pipe(
        Effect.map((result) => result.type === "boolean" && result.value)
      )
    if (files.length === 0) return yield* dispatch((yield* Evaluation.toLocal([null], realm))[0]!)
    return yield* Effect.scoped(Effect.gen(function*() {
      const collector = yield* Effect.acquireRelease(
        call(beginDrop, [], "handle"),
        (value) => {
          if (!("handle" in value) || value.handle === undefined) return Effect.void
          const handle = value.handle
          return Operation.detached(Effect.gen(function*() {
            const at = yield* BrowserClock.after(1000)
            yield* call(discardUpload, [{ _tag: "Handle", handle }], "value", at).pipe(Effect.ignore)
            yield* runtime.model.adapter.releaseHandles([handle]).pipe(BrowserClock.until(at), Effect.ignore)
          })).pipe(Effect.ignore)
        }
      )
      if (!("handle" in collector) || collector.handle === undefined) {
        return yield* Effect.die(new Error("The page made no collector for the dropped files"))
      }
      const handle: Adapter.LocalValue = { _tag: "Handle", handle: collector.handle }
      for (const file of files) yield* sendFile(runtime, call, handle, realm, file)
      return yield* dispatch(handle)
    }))
  }
)
