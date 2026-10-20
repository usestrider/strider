/**
 * File choosers: what a page opens when a file input is clicked.
 *
 * A file chooser doesn't pause the page, but it is an obligation: something must choose files or cancel.
 * `handle` registers the scoped handler that decides; a chooser no handler decides is canceled, and the
 * cancellation is reported as an `AutoResolution`. Setting files directly with `locator.setInputFiles` needs
 * no chooser at all.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import type * as Deferred from "./Deferred.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FileInput from "./FileInput.ts"
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
 * A file chooser, accepting one file or several.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FileChooser =
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

/**
 * Subscribes to file choosers and returns the first match, latched. Observing doesn't decide it.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.Page,
  filter?: Filter | undefined,
  where?: Subscription.Where<FileChooser, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<FileChooser, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to file choosers and emits every match from now on. Observing doesn't decide them.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.Page,
  filter?: Filter | undefined,
  where?: Subscription.Where<FileChooser, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<FileChooser, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the file choosers a page's log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.Page,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<FileChooser>>

/**
 * Registers a handler that decides the page's file choosers while its scope lives.
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
export declare const handle: <E, R>(
  page: Page.Page,
  handler: (chooser: FileChooser) => Effect.Effect<Decision, E, R>
) => Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError, Scope.Scope | R>

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
export declare const choose: (
  files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>
) => (chooser: FileChooser) => Effect.Effect<Decision, FileChooserError>

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
