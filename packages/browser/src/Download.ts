/**
 * The files a page or context downloads: waiting for one, following its progress, and saving it.
 *
 * Seeing a download doesn't make it yours: its file belongs to its context. Every context Strider creates saves
 * downloads into a temporary directory of its own, made before the context and removed after it, so a file is
 * deleted when its context closes. Copy it out with `saveAs`, or read its bytes as a stream, before then.
 *
 * Browsers write a download to a partial file and rename it when it's complete, so its bytes can be read only once
 * it is. Progress is reported where the backend reports it (`downloads.progress`: CDP only), and `cancel` works
 * where the backend can cancel (`downloads.cancel`: not on BiDi).
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FileInput from "./FileInput.ts"
import type * as FilePath from "./FilePath.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import type * as Runtime from "./internal/runtime.ts"
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
 * A file a page downloads: where it came from, its progress and the ways to read, save or cancel it.
 *
 * **Example** (Exporting a CSV)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Download, Page } from "@usestrider/browser"
 *
 * const exportCsv = Effect.fn("exportCsv")(function*(page: Page.Page) {
 *   const next = yield* Download.next(page)
 *   yield* page.getByText("Export CSV").click()
 *   const file = yield* next
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
   * Waits until the download completes, under the deadline in force. If the download is canceled or fails,
   * `finished` fails with `DownloadCanceled` or `DownloadFailed`.
   */
  readonly finished: Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * The file's bytes, as a stream that first waits, under the deadline in force, for the download to complete.
   * The file is deleted when its context closes, and reading it after that fails with `TargetGone`.
   */
  readonly stream: Stream.Stream<Uint8Array, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * Copies the file to a path on this machine, waiting under the deadline in force for the download to complete.
   * The file is deleted when its context closes, and saving it after that fails with `TargetGone`.
   */
  saveAs(path: FilePath.Local | string): Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * Cancels the download; one that already ended stays as it ended.
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

// ── Implementation ──

const kind = (
  runtime: Runtime.Runtime,
  operation: string
): Events.Kind<Model.DownloadEntry, Download> => ({
  operation,
  noun: "a download",
  deliver: (entry) => runtime.download(entry)
})

/** The target's channel and runtime, with its filter compiled. */
const subscription = (target: Page.Page | UserContext.UserContext, filter: Filter | undefined, operation: string) =>
  Effect.suspend(() => {
    const found = Handles.target(target)
    return Filters.requires(found.behind.runtime, operation, "downloads").pipe(
      Effect.andThen(Filters.url(operation, filter?.url))
    ).pipe(Effect.map((matches) => ({
      kind: kind(found.behind.runtime, operation),
      channel: found.behind.entry.events.download,
      accepts: (entry: Events.Entry<Model.DownloadEntry>) => Filters.urlMatches(matches, entry.value.url)
    })))
  })

/**
 * Subscribes to downloads and returns the wait: an effect that gives the first match, the same each time it runs.
 *
 * **Gotchas**
 *
 * Downloads need control: a page you only observe can't start or save one.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<Download, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<Download, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "Download.next"),
    ({ accepts, channel, kind }) => Events.next(kind, channel, accepts, where)
  ).pipe(Operation.named("Download.next"))

/**
 * Subscribes to downloads and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream = <PE = never, PR = never>(
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<Download, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<Download, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "Download.stream"),
    ({ accepts, channel, kind }) => Events.stream(kind, channel, accepts, where)
  )

/**
 * Reads the downloads still in the event log; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<Download>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "Download.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )

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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
