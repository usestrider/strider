/**
 * File choosers: what a page opens when a file input is clicked.
 *
 * A file chooser doesn't pause the page, but it is an obligation: something must choose files or cancel.
 * `handle` registers the scoped handler that decides; a chooser no handler decides is canceled, and the
 * cancellation is reported as an `AutoResolution`. Setting files directly with `locator.setInputFiles` needs
 * no chooser at all.
 *
 * Every page of a context the library creates has its choosers reported and decided, so none is shown. What
 * `next`, `stream` and `history` report is data; a handler receives it as `Pending`, with the decisions.
 *
 * **Gotchas**
 *
 * On Firefox the input gets a `cancel` event as the chooser opens, before any decision; files a handler
 * chooses still arrive after it, with `input` and `change`. Its `fileChooser` capability says so.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FileInput from "./FileInput.ts"
import * as Access from "./internal/access.ts"
import type * as Adapter from "./internal/adapter.ts"
import * as Events from "./internal/events.ts"
import * as FileInputImpl from "./internal/fileInput.ts"
import * as Handlers from "./internal/handlers.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
import type * as Runtime from "./internal/runtime.ts"
import * as Spans from "./internal/spans.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"

const DecisionTypeId = "~@usestrider/browser/FileChooser/Decision"

/**
 * How a file chooser is answered.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Decision {
  readonly [DecisionTypeId]: typeof DecisionTypeId
}

/**
 * Checks whether a value is a file chooser `Decision`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDecision = (u: unknown): u is Decision => Predicate.hasProperty(u, DecisionTypeId)

/**
 * Schema for a file chooser, as events report it: one that accepts one file or several.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileChooser = Schema.Union([Schema.TaggedStruct("Single", {}), Schema.TaggedStruct("Multiple", {})])

/**
 * A file chooser, as events report it; observing it doesn't decide it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FileChooser = typeof FileChooser.Type

/**
 * A file chooser as a handler receives it: each shape with the decisions it offers.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Pending =
  | { readonly _tag: "Single"; select(file: FileInput.FileInput): Decision; readonly cancel: Decision }
  | {
    readonly _tag: "Multiple"
    select(files: ReadonlyArray<FileInput.FileInput>): Decision
    readonly cancel: Decision
  }

/**
 * Which file choosers to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match only choosers that accept several files, or only those that accept one.
   *
   * @default either
   */
  readonly multiple?: boolean | undefined
}

// ── Implementation ──

/** A decision, carrying the files it chose, or none to cancel. */
interface DecisionImpl extends Decision {
  readonly files: ReadonlyArray<FileInput.FileInput> | undefined
}

const decision = (files: ReadonlyArray<FileInput.FileInput> | undefined): Decision => {
  const made: DecisionImpl = { [DecisionTypeId]: DecisionTypeId, files }
  return made
}

const canceled = decision(undefined)

const toFileChooser = (chooser: Model.FileChooserEvent): FileChooser =>
  chooser.multiple ? { _tag: "Multiple" } : { _tag: "Single" }

const toPending = (chooser: Model.FileChooserEvent): Pending =>
  chooser.multiple
    ? { _tag: "Multiple", select: (files) => decision(files), cancel: canceled }
    : { _tag: "Single", select: (file) => decision([file]), cancel: canceled }

const kind = (operation: string): Events.Kind<Model.FileChooserEvent, FileChooser> => ({
  operation,
  noun: "a file chooser",
  deliver: toFileChooser
})

const subscription = (target: Page.ObservedPage, filter: Filter | undefined, operation: string) =>
  Effect.sync(() => ({
    kind: kind(operation),
    channel: Handles.page(target).entry.events.fileChooser,
    accepts: (entry: Events.Entry<Model.FileChooserEvent>) =>
      filter?.multiple === undefined || entry.value.multiple === filter.multiple
  }))

/**
 * Subscribes to file choosers and returns the first match, latched. Observing doesn't decide it.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.Page,
  filter?: Filter | undefined,
  where?: Subscription.Where<FileChooser, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<FileChooser, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "FileChooser.next"),
    ({ accepts, channel, kind }) => Events.next(kind, channel, accepts, where)
  ).pipe(Spans.operation("FileChooser.next"))

/**
 * Subscribes to file choosers and emits every match from now on. Observing doesn't decide them.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream = <PE = never, PR = never>(
  target: Page.Page,
  filter?: Filter | undefined,
  where?: Subscription.Where<FileChooser, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<FileChooser, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "FileChooser.stream"),
    ({ accepts, channel, kind }) => Events.stream(kind, channel, accepts, where)
  )

/**
 * Reads the file choosers a page's log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.Page,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<FileChooser>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "FileChooser.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )

/**
 * Registers a handler that decides the page's file choosers while its scope lives.
 *
 * **Details**
 *
 * The page's latest handler decides each chooser, chosen when the chooser opens; removing it, or closing its
 * scope, leaves the choosers that open after to the one before. A handler has `Deadline.DefaultBudget`, as it
 * is when `handle` is called, to decide each chooser. `handled` counts the choosers it decided.
 *
 * **Gotchas**
 *
 * A handler that fails, is interrupted or runs out of time leaves the chooser canceled, reported as an
 * `AutoResolution`, and its failure is logged at Effect's `References.UnhandledLogLevel`.
 *
 * **Example** (Uploading through the page's own picker)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { FileChooser, FileInput, Page } from "@usestrider/browser"
 *
 * const uploadReport = Effect.fn("uploadReport")(function*(page: Page.Page) {
 *   yield* FileChooser.handle(page, FileChooser.choose(FileInput.local("./report.pdf")))
 *   yield* page.getByRole("button", { name: "Upload" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const handle = <E, R>(
  page: Page.Page,
  handler: (chooser: Pending) => Effect.Effect<Decision, E, R>
): Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError, Scope.Scope | R> =>
  Effect.suspend(() => {
    const { entry, grant, runtime } = Handles.page(page)
    return Access.checkOr(grant, (reason) =>
      new Declaration.DeclarationError({
        declaration: "FileChooser.handle",
        reason,
        diagnostics: Operation.diagnostics(Operation.operationId())
      })).pipe(
        Effect.andThen(Handlers.register({
          page: entry,
          handlers: entry.chooserHandlers,
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

/** Sets made files on a chooser's input, then lets the chooser go. */
const setMade = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  node: Adapter.NodeBinding,
  files: ReadonlyArray<FileInputImpl.Made>
) {
  const id = Operation.operationId()
  const budget = yield* Operation.budget
  yield* FileInputImpl.setMade(runtime, node, files, { page: Option.some(page), at: budget.at, id }).pipe(
    Effect.mapError((failure) =>
      failure._tag === "Gone"
        ? failure.error
        : failure._tag === "Reason"
        ? failure.reason
        : Operation.timeout({
          operation: "FileChooser.handle",
          id,
          phase: "dispatchedUnconfirmed",
          budget: budget.budget,
          history: [],
          hint: Option.some("The page didn't answer before the deadline; the files may have been set"),
          dispatch: { _tag: "MayHaveBeenSent" }
        })
    )
  )
  return { _tag: "Cancel" } satisfies Adapter.Decision as Adapter.Decision
})

/**
 * A handler that selects `files`.
 *
 * **Gotchas**
 *
 * A `Single` chooser given several files fails the handler with `InvalidInput`, so the chooser is canceled
 * rather than given the first file.
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const choose = (
  files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>
) =>
(chooser: Pending): Effect.Effect<Decision, FileChooserError> => {
  const list: ReadonlyArray<FileInput.FileInput> = Array.isArray(files) ? files : [files as FileInput.FileInput]
  if (chooser._tag === "Multiple") return Effect.succeed(chooser.select(list))
  if (list.length === 1) return Effect.succeed(chooser.select(list[0]!))
  return Effect.fail(
    new FileChooserError({
      reason: new Reason.InvalidInput({
        input: "files",
        expected: "one file, for a chooser that accepts one",
        hint: `${list.length} files were given, so the chooser is canceled rather than given the first`
      }),
      diagnostics: Operation.diagnostics(Operation.operationId())
    })
  )
}

/**
 * Schema for the reasons choosing files can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileChooserErrorReason = Schema.Union([Reason.InvalidInput])

/**
 * The reasons choosing files can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FileChooserErrorReason = typeof FileChooserErrorReason.Type

const FileChooserErrorTypeId = "~@usestrider/browser/FileChooser/FileChooserError"

/**
 * Error for files that don't fit the chooser.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class FileChooserError extends Schema.TaggedError<FileChooserError>(FileChooserErrorTypeId)(
  "FileChooserError",
  {
    reason: FileChooserErrorReason,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [FileChooserErrorTypeId] = FileChooserErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `FileChooserError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isFileChooserError = (u: unknown): u is FileChooserError =>
  Predicate.hasProperty(u, FileChooserErrorTypeId)
