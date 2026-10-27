/**
 * A download's handle (review 14, candidate 8): its status, folded by the model, and what reads it. Every
 * browser writes a download into a partial file and renames it when it completes (P2), so its bytes are read
 * once it has: `finished`, `saveAs` and `stream` wait for that under the deadline in force when called.
 */
import * as Effect from "effect/Effect"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Download from "../Download.ts"
import type * as FileInput from "../FileInput.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Watchable from "./watchable.ts"

const TypeId = "~@usestrider/browser/Download"

export const make = (runtime: Runtime.Runtime, entry: Model.DownloadEntry): Download.Download => {
  const failure = (operation: string, reason: Download.DownloadErrorReason) =>
    new Download.DownloadError({ operation, reason, diagnostics: Operation.diagnostics(Operation.operationId()) })

  /** Why the download's file is gone: its context ended, taking its directory. */
  const contextGone = Effect.map(
    SubscriptionRef.get(entry.context.state),
    (state) =>
      Option.map(state.closed, (reason) =>
        new Target.TargetGone({
          target: { _tag: "UserContext" },
          reason,
          diagnostics: Operation.diagnostics(Operation.operationId())
        }))
  )

  /** Waits for the download to end, under the deadline in force: where it was written, once completed. */
  const completed = Effect.fnUntraced(function*(operation: string) {
    const record = yield* Operation.record
    record.observe(yield* SubscriptionRef.get(entry.status))
    const terminal = yield* SubscriptionRef.changes(entry.status).pipe(
      Stream.filter((status) => status._tag !== "InProgress"),
      Stream.runHead,
      (waiting) => record.bound(waiting, () => Option.some("The download was still in progress at the deadline"))
    )
    if (Option.isNone(terminal)) {
      return yield* Effect.fail(record.timeout(Option.some("The download was still in progress at the deadline")))
    }
    const status = terminal.value
    switch (status._tag) {
      case "Canceled": {
        const gone = yield* contextGone
        return yield* Effect.fail(failure(
          operation,
          new Download.DownloadCanceled({
            hint: Option.isSome(gone)
              ? "Its context closed before it completed, which cancels it"
              : "The page, the browser or Download.cancel canceled it"
          })
        ))
      }
      case "Failed":
        return yield* Effect.fail(failure(
          operation,
          new Download.DownloadFailed({ why: status.reason, hint: "The browser stopped the download" })
        ))
      default:
        return entry.path
    }
  })

  /** The completed file and the program's file system, or why it can't be read. */
  const file = Effect.fnUntraced(function*(operation: string) {
    if (Option.isNone(runtime.fileSystem)) {
      return yield* Effect.fail(failure(
        operation,
        new Reason.Unsupported({
          capability: "downloads.read",
          backend: runtime.backend,
          hint: "Reading a download needs the program's FileSystem, which a launched browser's layer provides"
        })
      ))
    }
    const path = yield* completed(operation)
    if (Option.isNone(path)) {
      return yield* Effect.fail(failure(
        operation,
        new Reason.BackendFailure({
          kind: "IncompatibleResponse",
          method: "download",
          metadata: {},
          hint: "The browser didn't say where it wrote the download"
        })
      ))
    }
    return { fs: runtime.fileSystem.value, path: path.value }
  })

  /** A file-system failure: the file went with its context, or the read failed. */
  const unreadable = (
    operation: string,
    message: string
  ): Effect.Effect<never, Download.DownloadError | Target.TargetGone> =>
    Effect.flatMap(
      contextGone,
      Option.match({
        onSome: (gone): Effect.Effect<never, Download.DownloadError | Target.TargetGone> => Effect.fail(gone),
        onNone: () =>
          Effect.fail(failure(
            operation,
            new Reason.BackendFailure({ kind: "Rejected", method: "FileSystem", metadata: {}, hint: message })
          ))
      })
    )

  const download: Download.Download = {
    [TypeId]: TypeId,
    id: entry.id,
    url: entry.url as Url.Url,
    suggestedFilename: entry.suggestedFilename as FileInput.FileName,
    status: Watchable.make({
      ref: entry.status,
      project: Option.some,
      // A download ends with its context as `Canceled`, a final value, so the watchable never ends with it
      ended: () => Option.none(),
      final: (status) => status._tag !== "InProgress",
      target: { _tag: "UserContext" },
      operation: "Download.status.waitFor"
    }),
    finished: completed("Download.finished").pipe(
      Effect.asVoid,
      Operation.named("Download.finished", { attributes: { "browser.download.id": entry.id } })
    ),
    stream: Stream.unwrap(Effect.map(
      file("Download.stream").pipe(
        Operation.named("Download.stream", { attributes: { "browser.download.id": entry.id } })
      ),
      ({ fs, path }) =>
        fs.stream(path).pipe(
          Stream.catch((error) => Stream.fromEffect(unreadable("Download.stream", error.message)))
        )
    )),
    saveAs: (to) =>
      Effect.gen(function*() {
        const { fs, path } = yield* file("Download.saveAs")
        yield* fs.copyFile(path, to).pipe(Effect.catch((error) => unreadable("Download.saveAs", error.message)))
      }).pipe(
        Operation.named("Download.saveAs", { attributes: { "browser.download.id": entry.id, "browser.path": to } })
      ),
    cancel: Effect.suspend(() => {
      const id = Operation.operationId()
      return runtime.model.adapter.cancelDownload(entry.id).pipe(
        Effect.catch((error) => {
          const mapped = Operation.fromAdapter(error, id, runtime.backend)
          // Its context is gone, which canceled it already
          return mapped._tag === "Gone" ? Effect.void : Effect.fail(failure("Download.cancel", mapped.reason))
        })
      )
    }).pipe(Operation.named("Download.cancel", { attributes: { "browser.download.id": entry.id } })),
    pipe() {
      return pipeArguments(this, arguments)
    },
    toString() {
      return `Download(${entry.id})`
    },
    toJSON() {
      return { _id: "Download", id: entry.id, url: entry.url, suggestedFilename: entry.suggestedFilename }
    },
    [Inspectable.NodeInspectSymbol]() {
      return this.toJSON()
    }
  }
  return download
}
