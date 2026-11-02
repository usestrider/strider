/**
 * The file choosers a page opens (`FileChooser`): the decisions a handler returns, the events, and the handler.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import type * as Declaration from "../Declaration.ts"
import * as FileChooser from "../FileChooser.ts"
import type * as FileInput from "../FileInput.ts"
import type * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as EventModule from "./eventModule.ts"
import * as FileInputImpl from "./fileInput.ts"
import * as Filters from "./filters.ts"
import * as Handlers from "./handlers.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"

const DecisionTypeId = "~@usestrider/browser/FileChooser/Decision"

interface DecisionImpl extends FileChooser.Decision {
  readonly files: ReadonlyArray<FileInput.FileInput> | undefined
}

const decision = (files: ReadonlyArray<FileInput.FileInput> | undefined): FileChooser.Decision => {
  const made: DecisionImpl = { [DecisionTypeId]: DecisionTypeId, files }
  return made
}

const canceled = decision(undefined)

const toFileChooser = (chooser: Model.FileChooserEvent): FileChooser.FileChooser =>
  chooser.multiple ? { _tag: "Multiple" } : { _tag: "Single" }

const toPending = (chooser: Model.FileChooserEvent): FileChooser.Pending =>
  chooser.multiple
    ? { _tag: "Multiple", select: (files) => decision(files), cancel: canceled }
    : { _tag: "Single", select: (file) => decision([file]), cancel: canceled }

const isDecision = (u: unknown): u is FileChooser.Decision => Predicate.hasProperty(u, DecisionTypeId)

export const { history, next, stream } = EventModule.make<
  Page.Page,
  FileChooser.Filter,
  Model.FileChooserEvent,
  FileChooser.FileChooser
>({
  name: "FileChooser",
  noun: "a file chooser",
  prepare: (target, filter, operation) => {
    const behind = Handles.page(target)
    return Filters.requires(behind.runtime, operation, "fileChooser").pipe(Effect.as({
      channel: behind.entry.events.fileChooser,
      accepts: (entry) => filter?.multiple === undefined || entry.value.multiple === filter.multiple,
      deliver: toFileChooser
    }))
  }
})

export const handle = <E, R>(
  page: Page.Page,
  handler: (chooser: FileChooser.Pending) => Effect.Effect<FileChooser.Decision, E, R>
): Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope | R> =>
  Effect.suspend(() => {
    const { entry, grant, runtime } = Handles.page(page)
    return Access.check(grant).pipe(
      Effect.andThen(Handlers.requires(runtime, "FileChooser.handle", "fileChooser")),
      Effect.andThen(Handlers.register({
        page: entry,
        add: (handler) => runtime.model.handleChoosers(entry, handler),
        handler,
        pending: toPending,
        decision: (chosen, chooser): Effect.Effect<Adapter.Decision | Handlers.Staged, unknown> => {
          if (!isDecision(chosen) || !("files" in chosen)) {
            return Effect.die(
              new Error("FileChooser.handle: the handler returned something that isn't a FileChooser decision")
            )
          }
          const files = (chosen as DecisionImpl).files
          if (files === undefined) return Effect.succeed({ _tag: "Cancel" })
          return Effect.flatMap(
            FileInputImpl.partition(files, "files"),
            (given): Effect.Effect<Adapter.Decision | Handlers.Staged, unknown> =>
              given._tag === "Paths"
                ? Effect.map(
                  Effect.forEach(given.files, (file) => FileInputImpl.path(runtime, file)),
                  (paths): Adapter.Decision => ({ _tag: "SetFiles", files: paths })
                )
                // Made files are set on the chooser's input by the page, and the chooser is let go
                : Option.match(chooser.element, {
                  onNone: (): Effect.Effect<Handlers.Staged, unknown> =>
                    Effect.fail(
                      new Reason.Unsupported({
                        capability: "FileChooser.choose with FileInput.bytes",
                        backend: runtime.backend,
                        hint: "The browser didn't say which input opened the chooser, so files can't be made on it"
                      })
                    ),
                  onSome: (node) =>
                    Effect.succeed<Handlers.Staged>({
                      _tag: "Staged",
                      apply: setMade(runtime, entry, node, given.files)
                    })
                })
          )
        },
        noun: () => "file chooser",
        operation: "FileChooser.handle.handled.waitFor",
        name: "FileChooser.handle",
        fallback: "canceling it"
      })),
      Effect.flatMap(Access.track(grant))
    )
  })

const setMade = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  node: Adapter.NodeBinding,
  files: ReadonlyArray<FileInputImpl.Made>
) {
  // Part of the handler's decision, under its deadline
  const record = yield* Operation.start("FileChooser.handle")
  record.markSent()
  yield* FileInputImpl.setMade(runtime, node, files, { page: Option.some(page), at: record.budget.at, id: record.id })
    .pipe(
      Effect.mapError((failure) =>
        failure._tag === "Gone"
          ? failure.error
          : failure._tag === "Reason"
          ? failure.reason
          : record.timeout(Option.some("The page didn't answer before the deadline; the files may have been set"))
      )
    )
  return { _tag: "Cancel" } satisfies Adapter.Decision as Adapter.Decision
})

/** A handler that gives a chooser the files, or fails with `FileChooserError` for one it can't. */
export const choose = (
  files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>
) =>
(chooser: FileChooser.Pending): Effect.Effect<FileChooser.Decision, FileChooser.FileChooserError> => {
  const list: ReadonlyArray<FileInput.FileInput> = Array.isArray(files) ? files : [files as FileInput.FileInput]
  if (chooser._tag === "Multiple") return Effect.succeed(chooser.select(list))
  if (list.length === 1) return Effect.succeed(chooser.select(list[0]!))
  return Effect.fail(
    new FileChooser.FileChooserError({
      reason: new Reason.InvalidInput({
        input: "files",
        expected: "one file, for a chooser that accepts one",
        hint: `${list.length} files were given, so the chooser is canceled rather than given the first`
      }),
      diagnostics: Operation.diagnosticsNow()
    })
  )
}
