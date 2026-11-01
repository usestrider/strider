/**
 * The files a page or context downloads: waiting for one, following its progress, and saving it.
 *
 * A download's file belongs to its context. By default a context Strider creates saves downloads into a temporary
 * directory that is removed when the context closes, so copy a file out with `saveAs`, or read it with `stream`,
 * before then.
 *
 * A download's bytes can be read only once it completes. Progress is reported only on CDP (`downloads.progress`),
 * and `cancel` fails with `Unsupported` on BiDi (`downloads.cancel`). On a backend without the `downloads`
 * capability, such as WebKit, `next`, `stream` and `history` fail with `Unsupported`.
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
import * as DownloadEventsImpl from "./internal/downloadEvents.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
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
 * import { Download, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
   * Its progress, through to a terminal state. Byte counts are reported only on CDP (`downloads.progress`).
   *
   * **Example** (Logging a download's progress)
   *
   * ```ts import.meta.vitest
   * import { Download } from "@usestrider/browser"
   * import { Effect, Stream } from "effect"
   *
   * const logProgress = Effect.fn("logProgress")(function*(download: Download.Download) {
   *   yield* download.status.changes.pipe(
   *     Stream.runForEach((status) =>
   *       status._tag === "InProgress"
   *         ? Effect.log(`${status.received} bytes`)
   *         : Effect.log(status._tag)
   *     )
   *   )
   * })
   * ```
   */
  readonly status: Watchable.Watchable<Status>
  /**
   * Waits, under the deadline in force, until the download completes. Fails with `DownloadCanceled` or
   * `DownloadFailed` if it doesn't; closing its context first cancels it.
   *
   * **Example** (Giving a large export two minutes)
   *
   * ```ts import.meta.vitest
   * import { Deadline, Download } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const awaitExport = Effect.fn("awaitExport")(function*(download: Download.Download) {
   *   yield* download.finished.pipe(Deadline.within("2 minutes"))
   * })
   * ```
   */
  readonly finished: Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * The file's bytes, as a stream that first waits, under the deadline in force, for the download to complete.
   * The file is deleted when its context closes, and reading it after that fails with `TargetGone`.
   *
   * **Example** (Reading a downloaded CSV as text)
   *
   * ```ts import.meta.vitest
   * import { Download } from "@usestrider/browser"
   * import { Effect, Stream } from "effect"
   *
   * const readCsv = Effect.fn("readCsv")(function*(download: Download.Download) {
   *   return yield* download.stream.pipe(Stream.decodeText, Stream.mkString)
   * })
   * ```
   */
  readonly stream: Stream.Stream<Uint8Array, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * Copies the file to a path on this machine, waiting under the deadline in force for the download to complete.
   * The file is deleted when its context closes, and saving it after that fails with `TargetGone`.
   *
   * **Example** (Saving under the suggested name)
   *
   * ```ts import.meta.vitest
   * import { Download } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const keep = Effect.fn("keep")(function*(download: Download.Download) {
   *   yield* download.saveAs(`./downloads/${download.suggestedFilename}`)
   * })
   * ```
   */
  saveAs(path: FilePath.Local | string): Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>
  /**
   * Cancels the download; one that already ended stays as it ended. Fails with `Unsupported` on BiDi
   * (`downloads.cancel`).
   *
   * **Example** (Canceling a download the test doesn't need)
   *
   * ```ts import.meta.vitest
   * import { Download, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const skipInstaller = Effect.fn("skipInstaller")(function*(page: Page.Page) {
   *   const installer = yield* Download.next(page)
   *   yield* page.getByRole("link", { name: "Download installer" }).click()
   *   const download = yield* installer
   *   yield* download.cancel
   * })
   * ```
   */
  readonly cancel: Effect.Effect<void, DownloadError | Deadline.Timeout>
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
 * Subscribes to downloads and returns the wait: an effect that gives the first match, the same each time it runs.
 *
 * **Gotchas**
 *
 * - On a backend without the `downloads` capability, such as WebKit, it fails at once with `SubscriptionError`,
 *   reason `Unsupported`.
 * - It takes a `Page` or a `UserContext`: a page you only observe can't start or save a download.
 *
 * **Example** (Waiting for an export by its URL)
 *
 * ```ts import.meta.vitest
 * import { Download, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const exportOrders = Effect.fn("exportOrders")(function*(page: Page.Page) {
 *   const exported = yield* Download.next(page, {
 *     url: "https://shop.example.com/exports/**"
 *   })
 *   yield* page.getByRole("button", { name: "Export orders" }).click()
 *   const download = yield* exported
 *   return download.suggestedFilename
 * })
 * ```
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
> => DownloadEventsImpl.next(target, filter, where)

/**
 * Subscribes to downloads and emits every match from now on.
 *
 * **Gotchas**
 *
 * On a backend without the `downloads` capability, such as WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (Saving every download of a context)
 *
 * ```ts import.meta.vitest
 * import { Download, Page } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const saveAll = Effect.fn("saveAll")(function*(page: Page.Page) {
 *   const downloads = yield* Download.stream(page.context)
 *   yield* downloads.pipe(
 *     Stream.runForEach((download) =>
 *       download.saveAs(`./downloads/${download.suggestedFilename}`)
 *     ),
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
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<Download, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<Download, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => DownloadEventsImpl.stream(target, filter, where)

/**
 * Reads the downloads still in the event log; never waits.
 *
 * **Gotchas**
 *
 * On a backend without the `downloads` capability, such as WebKit, it fails with `SubscriptionError`, reason
 * `Unsupported`.
 *
 * **Example** (The files downloaded so far)
 *
 * ```ts import.meta.vitest
 * import { Download, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const downloadedFiles = Effect.fn("downloadedFiles")(function*(page: Page.Page) {
 *   const downloads = yield* Download.history(page.context)
 *   return downloads.entries.map((download) => download.suggestedFilename)
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<Download>, Subscription.SubscriptionError> =>
  DownloadEventsImpl.history(target, filter)

/**
 * Reason for a download that was canceled: by `cancel`, the page or the browser, or by its context closing before
 * it completed.
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
 * **Example** (Treating a canceled download as skipped)
 *
 * ```ts import.meta.vitest
 * import { Download } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const saveIfCompleted = Effect.fn("saveIfCompleted")(
 *   function*(download: Download.Download) {
 *     return yield* download.saveAs("./export.csv").pipe(
 *       Effect.as(true),
 *       Effect.catchReason(
 *         "DownloadError",
 *         "DownloadCanceled",
 *         () => Effect.succeed(false)
 *       )
 *     )
 *   }
 * )
 * ```
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
