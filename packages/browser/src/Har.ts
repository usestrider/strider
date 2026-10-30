/**
 * HAR recordings: a page's or context's network traffic, exported as an HTTP Archive.
 *
 * Exports are redacted unless `include` names a class of secret. `Route.fromHar` answers requests from a recorded
 * HAR.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import * as Access from "./internal/access.ts"
import type * as Adapter from "./internal/adapter.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import * as HarImpl from "./internal/har.ts"
import * as Operation from "./internal/operation.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Recordings from "./internal/recordings.ts"
import * as Spans from "./internal/spans.ts"
import * as UrlPattern from "./internal/urlPattern.ts"
import * as Watchable from "./internal/watchable.ts"
import * as NetworkResponse from "./NetworkResponse.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"
import type * as WatchableApi from "./Watchable.ts"

/**
 * A class of secret that an export can include on request: a URL's credentials, cookie values, `Authorization`
 * headers, text typed into a trace or the bodies requests sent.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SecretClass = "credentials" | "cookies" | "authorizationHeaders" | "typedText" | "requestBodies"

/**
 * What a HAR records.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * Where bodies go: embedded in the HAR, attached beside it in a zip or left out. Required: never inferred from a
   * file extension.
   */
  readonly content: "embed" | "attach" | "omit"
  /**
   * Full entries, or only what tools need to show a timeline.
   *
   * @default "full"
   */
  readonly detail?: "full" | "minimal" | undefined
  /**
   * Record only requests to matching URLs.
   *
   * @default every request
   */
  readonly url?: Url.Pattern | string | undefined
  /**
   * Record WebSocket frames; unsupported on BiDi.
   *
   * @default false
   */
  readonly webSocketFrames?: boolean | undefined
  /**
   * Whether stopping and exporting wait for requests still in flight, or mark them incomplete.
   *
   * @default "markIncomplete"
   */
  readonly inFlightAtStop?: "wait" | "markIncomplete" | undefined
}

/**
 * Settings for exporting a HAR.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ExportOptions {
  /**
   * Classes of secret to write out in full.
   *
   * @default none: everything classified is redacted
   */
  readonly include?: ReadonlyArray<SecretClass> | undefined
}

/**
 * A HAR being recorded; stopped by `remove` or when its scope closes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Recording extends Declaration.Registration {
  /**
   * How many entries have been recorded so far.
   *
   * **Example** (Waiting for a page's API calls before exporting)
   *
   * ```ts import.meta.vitest
   * import { Har, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const recordLanding = Effect.fn("recordLanding")(function*(page: Page.Page) {
   *   const har = yield* Har.record(page, {
   *     content: "omit",
   *     url: "https://shop.example.com/api/**"
   *   })
   *   yield* page.goto("https://shop.example.com")
   *   yield* har.entries.waitFor((entries) => entries >= 3)
   *   return yield* har.exportHar("landing.har")
   * })
   * ```
   */
  readonly entries: WatchableApi.Watchable<number>
  /**
   * Writes the HAR to `path`, redacted except for the classes of secret `include` names.
   *
   * **Example** (Exporting a sign-up with the bodies it sent)
   *
   * ```ts import.meta.vitest
   * import { Har, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const recordSignUp = Effect.fn("recordSignUp")(function*(page: Page.Page) {
   *   const har = yield* Har.record(page, { content: "embed" })
   *   yield* page.goto("https://app.example.com/sign-up")
   *   yield* page.getByRole("button", { name: "Sign up" }).click()
   *   return yield* har.exportHar("sign-up.har", { include: ["requestBodies"] })
   * })
   * ```
   */
  exportHar(path: FilePath.Local | string, options?: ExportOptions | undefined): Effect.Effect<FilePath.Local, HarError>
}

/**
 * Starts recording a HAR of a page or context, until `remove` or until the scope it runs in closes.
 *
 * **Details**
 *
 * - From now on, each redirect hop of each request the target makes is an entry, with its response and, unless
 *   `content` is `"omit"`, the response body, read as the hop finishes.
 * - Timings come from Strider's clock, so they mean the same on every backend: `send` is 0, `wait` runs from the
 *   request to its response, `receive` from the response to the end, and `blocked`, `dns`, `connect` and `ssl`
 *   are -1.
 * - `exportHar` writes HAR 1.2, or with `content: "attach"` one zip holding `har.har` and the bodies it names.
 * - A URL's credentials, cookie values and the `Authorization` and `Proxy-Authorization` headers are `REDACTED`
 *   unless `include` names their class.
 * - The body each request sent is recorded whatever `content` says, and written as `postData` only when
 *   `include` names `"requestBodies"`. A text body is written as `text`, with a form's `params`; any other is
 *   base64 (marked with `_encoding`) or a file beside the HAR when bodies are attached.
 *
 * **Gotchas**
 *
 * - Bodies are collected for the target while it records, up to `NetworkResponse.BodyLimit`.
 * - `webSocketFrames` is `Unsupported` on WebDriver BiDi.
 * - Chromium keeps only the body a request's last hop sent, so an earlier hop's body that its event didn't carry,
 *   such as a file upload that a 307 redirected, is left out.
 *
 * **Example** (Recording a checkout's traffic)
 *
 * ```ts import.meta.vitest
 * import { Har, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const checkout = Effect.fn("checkout")(function*(page: Page.Page) {
 *   const har = yield* Har.record(page, { content: "attach" })
 *   yield* page.goto("https://shop.example.com/cart")
 *   yield* page.getByRole("button", { name: "Pay" }).click()
 *   return yield* har.exportHar("checkout.zip")
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const record = (
  target: UserContext.UserContext | Page.Page,
  options: Options
): Effect.Effect<Recording, HarError | Target.TargetGone | Deadline.Timeout, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const found = Handles.target(target)
    const { runtime, grant } = found.behind
    const { id } = yield* Operation.record
    const fail = (reason: HarErrorReason) => new HarError({ reason, diagnostics: Operation.diagnostics(id) })
    yield* Access.check(grant)
    let matches: (url: string) => boolean = () => true
    if (options.url !== undefined) {
      try {
        matches = UrlPattern.compile(options.url)
      } catch (error) {
        return yield* Effect.fail(fail(
          new Reason.InvalidInput({ input: "url", expected: "a URL pattern", hint: String(error) })
        ))
      }
    }
    if (options.webSocketFrames === true) {
      yield* Filters.requires(runtime, "Har.record", "webSocketFrames").pipe(
        Effect.mapError((error) => fail(error.reason as HarErrorReason))
      )
    }
    const scopeOf: Adapter.DeclarationScope = found._tag === "Page"
      ? { _tag: "Page", page: found.behind.entry.id }
      : { _tag: "UserContext", context: found.behind.entry.id }
    // Requests' bodies are always kept, which an export can include; responses' unless they are omitted
    yield* HarImpl.collect(
      runtime,
      found,
      options.content === "omit" ? ["request"] : ["request", "response"],
      yield* NetworkResponse.BodyLimit,
      id
    ).pipe(Effect.mapError((error) => Deadline.isTimeout(error) ? error : fail(error)))
    const { recorder, stop } = yield* HarImpl.start(runtime, found.behind.entry, {
      content: options.content,
      requestBodies: true,
      matches,
      webSocketFrames: options.webSocketFrames === true,
      inFlightAtStop: options.inFlightAtStop ?? "markIncomplete"
    }, scope)
    const info = runtime.model.adapter.info
    const recording: Recording = {
      remove: stop,
      entries: Watchable.make({
        ref: recorder.count,
        project: Option.some,
        ended: () => Option.none(),
        target: found._tag === "Page" ? { _tag: "Page", id: found.behind.entry.id } : { _tag: "UserContext" },
        operation: "Har.Recording.entries.waitFor"
      }),
      exportHar: (path, exportOptions) =>
        Effect.gen(function*() {
          yield* (options.inFlightAtStop ?? "markIncomplete") === "wait" ? recorder.settle : recorder.flush
          const { log, files } = HarImpl.logOf(recorder.entries, recorder.clock, {
            detail: options.detail ?? "full",
            include: new Set(exportOptions?.include ?? []),
            bodies: options.content === "embed"
              ? { _tag: "Embed" }
              : options.content === "attach"
              ? { _tag: "File", prefix: "" }
              : { _tag: "Omit" }
          }, { name: info.product, version: info.version })
          const text = JSON.stringify(log, null, 2)
          const resolved = yield* Recordings.resolve(runtime, path)
          const bytes = options.content === "attach"
            ? yield* Recordings.zip([{ path: "har.har", content: text }, ...files])
            : new TextEncoder().encode(text)
          return yield* Recordings.write(runtime, resolved, bytes)
        }).pipe(
          Effect.mapError((failure) =>
            new HarError({
              reason: new WriteFailed({
                path: failure.path === "" ? String(path) : failure.path,
                hint: failure.hint,
                ...(failure.cause === undefined ? {} : { cause: failure.cause })
              }),
              diagnostics: Operation.diagnosticsNow()
            })
          ),
          Operation.named("Har.exportHar", { attributes: { ...Spans.scopeAttributes(scopeOf), "browser.path": path } })
        )
    }
    return yield* Access.track<Recording>(grant)(recording)
  }).pipe(Operation.named("Har.record", {
    attributes: { "browser.har.content": options.content, "browser.har.detail": options.detail ?? "full" }
  }))

/**
 * Reason for a HAR that couldn't be written.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class WriteFailed extends Schema.Error<WriteFailed>("@usestrider/browser/Har/WriteFailed")({
  _tag: Schema.tag("WriteFailed"),
  path: Schema.String,
  hint: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return `Couldn't write ${this.path} (${this.hint})`
  }
}

/**
 * Reason for a HAR that couldn't be read for replay.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class ReadFailed extends Schema.Error<ReadFailed>("@usestrider/browser/Har/ReadFailed")({
  _tag: Schema.tag("ReadFailed"),
  path: Schema.String,
  hint: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return `Couldn't read ${this.path} (${this.hint})`
  }
}

/**
 * Schema for the reasons recording, exporting or replaying a HAR can fail.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HarErrorReason = Schema.Union([
  WriteFailed,
  ReadFailed,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons recording, exporting or replaying a HAR can fail.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type HarErrorReason = typeof HarErrorReason.Type

const HarErrorTypeId = "~@usestrider/browser/Har/HarError"

/**
 * Error for a HAR that couldn't be recorded, exported or read for replay.
 *
 * **Example** (Logging a HAR that couldn't be written)
 *
 * ```ts import.meta.vitest
 * import { Har } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const saveHar = Effect.fn("saveHar")(function*(har: Har.Recording) {
 *   yield* har.exportHar("artifacts/run.har").pipe(
 *     Effect.catchReason(
 *       "HarError",
 *       "WriteFailed",
 *       (reason) => Effect.logWarning(`No HAR: ${reason.hint}`)
 *     )
 *   )
 * })
 * ```
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class HarError extends Schema.TaggedError<HarError>(HarErrorTypeId)("HarError", {
  reason: HarErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [HarErrorTypeId] = HarErrorTypeId
  override get message(): string {
    return this.reason.message
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `HarError`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isHarError = (u: unknown): u is HarError => Predicate.hasProperty(u, HarErrorTypeId)
