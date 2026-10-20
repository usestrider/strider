/**
 * Downloads a page starts.
 *
 * Seeing a download acquires nothing: its file belongs to its context, and the browser-side copy is deleted
 * when the context closes unless the backend's download policy keeps it. Copy it out with `saveAs` or read it
 * as a stream before then.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FileInput from "./FileInput.ts"
import type * as FilePath from "./FilePath.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * Schema for the id of a download.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/Download/Id"))

/**
 * Id of a download.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

/**
 * Schema for a download's progress.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Status = Schema.Union([
  Schema.TaggedStruct("InProgress", { received: Schema.Int, total: Schema.Option(Schema.Int) }),
  Schema.TaggedStruct("Completed", {}),
  Schema.TaggedStruct("Canceled", {}),
  Schema.TaggedStruct("Failed", { reason: Schema.String })
])

/**
 * A download's progress: in progress with bytes received, or one of its terminal states.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Status = typeof Status.Type

const TypeId = "~@usestrider/browser/Download"

/**
 * A download.
 *
 * **Example** (Exporting a CSV)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Deferred, Download, Page } from "@usestrider/browser"
 *
 * const exportCsv = Effect.fn("exportCsv")(function*(page: Page.Page) {
 *   const next = yield* Download.next(page)
 *   yield* page.getByText("Export CSV").click()
 *   const file = yield* Deferred.await(next)
 *   yield* file.saveAs("./export.csv")
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Download extends Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  readonly id: Id
  /**
   * The URL it came from; fixed when the download begins.
   */
  readonly url: Url.Url
  /**
   * The name the server or page suggested; fixed when the download begins.
   */
  readonly suggestedFilename: FileInput.FileName
  /**
   * Progress, through to a terminal state.
   */
  readonly status: Watchable.Watchable<Status>
  /**
   * Waits until the download completes, under the deadline; `status.waitFor` for a terminal state.
   */
  readonly finished: Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * The bytes, as they arrive.
   */
  readonly stream: Stream.Stream<Uint8Array, DownloadError>
  /**
   * Copies the file to a path on this machine, transferring it from a remote browser where supported.
   */
  saveAs(path: FilePath.Local | string): Effect.Effect<void, DownloadError>
  /**
   * Cancels the download.
   */
  readonly cancel: Effect.Effect<void, DownloadError>
}

/**
 * Checks whether a value is a `Download`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDownload = (u: unknown): u is Download => Predicate.hasProperty(u, TypeId)

/**
 * Which downloads to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match downloads from URLs matching this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
}

/**
 * Subscribes to downloads and returns the first match, latched.
 *
 * **Gotchas**
 *
 * Downloads need control: a page you only observe can't start or save one.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<Download, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<Download, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to downloads and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<Download, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<Download, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the downloads a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<Download>>

/**
 * Reason for a download that was canceled.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DownloadCanceled extends Schema.Error<DownloadCanceled>("@usestrider/browser/Download/DownloadCanceled")({
  _tag: Schema.tag("DownloadCanceled"),
  hint: Schema.String
}) {
  override get message(): string {
    return `The download was canceled (${this.hint})`
  }
}

/**
 * Reason for a download the browser reported as failed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DownloadFailed extends Schema.Error<DownloadFailed>("@usestrider/browser/Download/DownloadFailed")({
  _tag: Schema.tag("DownloadFailed"),
  why: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `The download failed: ${this.why} (${this.hint})`
  }
}

/**
 * Schema for the reasons a download operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadErrorReason = Schema.Union([
  DownloadCanceled,
  DownloadFailed,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a download operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DownloadErrorReason = typeof DownloadErrorReason.Type

const DownloadErrorTypeId = "~@usestrider/browser/Download/DownloadError"

/**
 * Error for a download operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class DownloadError extends Schema.TaggedError<DownloadError>(DownloadErrorTypeId)("DownloadError", {
  operation: Schema.String,
  reason: DownloadErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [DownloadErrorTypeId] = DownloadErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `DownloadError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDownloadError = (u: unknown): u is DownloadError => Predicate.hasProperty(u, DownloadErrorTypeId)
