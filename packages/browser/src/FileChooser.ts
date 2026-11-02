/**
 * File choosers: the file picker a page opens when a file input is clicked.
 *
 * A chooser doesn't pause the page, but something must answer it, by choosing files or canceling. `next`, `stream`
 * and `history` report a chooser as data; `handle` registers a scoped handler that answers it, given as `Pending`
 * with the decisions. In a context Strider creates no chooser is shown: one no handler answers is canceled and
 * reported as an `AutoResolution`. `locator.setInputFiles` sets an input's files without a chooser.
 *
 * **Gotchas**
 *
 * - On Firefox the input gets a `cancel` event as the chooser opens, before any decision; the files a handler
 *   chooses still arrive after it, with `input` and `change` (`fileChooser`).
 * - On a backend without the `fileChooser` capability, such as WebKit, no chooser is reported: `next`, `stream`,
 *   `history` and `handle` fail with `Unsupported`, and the browser cancels the chooser itself.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FileInput from "./FileInput.ts"
import * as FileChooserImpl from "./internal/fileChooser.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"

const DecisionTypeId = "~@usestrider/browser/FileChooser/Decision"

/**
 * How a file chooser is answered: one of a `Pending` chooser's decisions, which a handler returns.
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
 * A file chooser, as events report it. Seeing one doesn't decide it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FileChooser = typeof FileChooser.Type

/**
 * A file chooser as a handler receives it, with the decisions it offers: `select` and `cancel`.
 *
 * **Details**
 *
 * `select` and `cancel` are Effects: return one directly from a handler, or use `return yield*` after other
 * work in a generator. Its result is the decision the handler machinery sends to the browser.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Pending =
  | {
    readonly _tag: "Single"
    select(file: FileInput.FileInput): Effect.Effect<Decision>
    readonly cancel: Effect.Effect<Decision>
  }
  | {
    readonly _tag: "Multiple"
    select(files: ReadonlyArray<FileInput.FileInput>): Effect.Effect<Decision>
    readonly cancel: Effect.Effect<Decision>
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

/**
 * Subscribes to file choosers and returns the wait: an effect that gives the first match, the same each time it
 * runs. Waiting for a chooser doesn't decide it.
 *
 * **Gotchas**
 *
 * On a backend without the `fileChooser` capability, such as WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (Checking that a picker takes several files)
 *
 * ```ts import.meta.vitest
 * import { FileChooser, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const takesSeveral = Effect.fn("takesSeveral")(function*(page: Page.Page) {
 *   const choosers = yield* FileChooser.next(page)
 *   yield* page.getByRole("button", { name: "Add photos" }).click()
 *   const chooser = yield* choosers
 *   return chooser._tag === "Multiple"
 * })
 * ```
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
> => FileChooserImpl.next(target, filter, where)

/**
 * Subscribes to file choosers and emits every match from now on. Seeing a chooser doesn't decide it.
 *
 * **Gotchas**
 *
 * On a backend without the `fileChooser` capability, such as WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (Logging every chooser a page opens)
 *
 * ```ts import.meta.vitest
 * import { FileChooser, Page } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const logChoosers = Effect.fn("logChoosers")(function*(page: Page.Page) {
 *   const choosers = yield* FileChooser.stream(page)
 *   yield* choosers.pipe(
 *     Stream.runForEach((chooser) => Effect.log(`${chooser._tag} file chooser`)),
 *     Effect.forkScoped
 *   )
 * })
 * ```
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
> => FileChooserImpl.stream(target, filter, where)

/**
 * Reads the file choosers still in the page's event log; never waits.
 *
 * **Gotchas**
 *
 * On a backend without the `fileChooser` capability, such as WebKit, it fails with `SubscriptionError`, reason
 * `Unsupported`.
 *
 * **Example** (Whether a page has opened a picker)
 *
 * ```ts import.meta.vitest
 * import { FileChooser, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const pickerOpened = Effect.fn("pickerOpened")(function*(page: Page.Page) {
 *   const choosers = yield* FileChooser.history(page)
 *   return choosers.entries.length > 0
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.Page,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<FileChooser>, Subscription.SubscriptionError> =>
  FileChooserImpl.history(target, filter)

/**
 * Registers a handler that decides the page's file choosers while its scope lives.
 *
 * **Details**
 *
 * Each chooser goes to the page's most recent handler at the moment the chooser opens. Removing a handler, or
 * closing its scope, leaves later choosers to the handler registered before it. A handler has
 * `Deadline.DefaultBudget`, read when `handle` is called, to decide each chooser. `handled` counts the choosers it
 * has decided.
 *
 * **Gotchas**
 *
 * - A handler that fails, is interrupted or runs out of time leaves the chooser canceled, reported as an
 *   `AutoResolution`, and its failure is logged at Effect's `References.UnhandledLogLevel`.
 * - On a backend without the `fileChooser` capability, such as WebKit, it fails at once with `DeclarationError`,
 *   reason `Unsupported`: no chooser would reach the handler.
 *
 * **Example** (Uploading through the page's own picker)
 *
 * ```ts import.meta.vitest
 * import { FileChooser, FileInput, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
): Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope | R> =>
  FileChooserImpl.handle(page, handler)

/** Sets made files on a chooser's input, then lets the chooser go. */

/**
 * A handler that selects `files`.
 *
 * **Gotchas**
 *
 * A `Single` chooser given several files fails the handler with `InvalidInput`, so the chooser is canceled
 * rather than given the first file.
 *
 * **Example** (Choosing two photos)
 *
 * ```ts import.meta.vitest
 * import { FileChooser, FileInput, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const addPhotos = Effect.fn("addPhotos")(function*(page: Page.Page) {
 *   const photos = [FileInput.local("./front.jpg"), FileInput.local("./back.jpg")]
 *   yield* FileChooser.handle(page, FileChooser.choose(photos))
 *   yield* page.getByRole("button", { name: "Add photos" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const choose = (
  files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>
) =>
(chooser: Pending): Effect.Effect<Decision, FileChooserError> => FileChooserImpl.choose(files)(chooser)

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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
