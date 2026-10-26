/**
 * HAR recordings: a page's or context's network traffic, exported as an HTTP Archive.
 *
 * Exports are redacted unless a class of secret is included by name. Replaying a HAR is deferred: mocking is
 * the job of `route`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import * as Access from "./internal/access.ts"
import type * as Adapter from "./internal/adapter.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import * as HarImpl from "./internal/har.ts"
import * as Operation from "./internal/operation.ts"
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
 * A class of secret that an export can include on request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SecretClass = "credentials" | "cookies" | "authorizationHeaders" | "typedText"

/**
 * What a HAR records.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * Bodies embedded in the HAR, attached beside it, or left out. Required: never inferred from a file
   * extension.
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
   * Whether stopping waits for requests still in flight. Stopping never waits unless asked.
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
   * How many entries are recorded so far.
   */
  readonly entries: WatchableApi.Watchable<number>
  /**
   * Writes the HAR, redacted unless classes are included.
   */
  exportHar(path: FilePath.Local | string, options?: ExportOptions | undefined): Effect.Effect<FilePath.Local, HarError>
}

/**
 * Starts recording a HAR of a page or context while its scope lives.
 *
 * **Details**
 *
 * Each request the target makes from now on is an entry per redirect hop, with its response and, unless
 * `content` is `omit`, the response body, read as the hop finishes. Timings come from the library's clock, so
 * they mean the same on every backend: `send` is 0, `wait` runs from the request to its response, `receive`
 * from the response to the end, and `blocked`, `dns`, `connect` and `ssl` are -1. Request bodies aren't
 * recorded. `exportHar` writes HAR 1.2, or with `content: "attach"` one zip holding `har.har` and the bodies it
 * names. Cookie values, `Authorization` and `Proxy-Authorization`, and a URL's credentials are `REDACTED`
 * unless `include` names their class.
 *
 * **Gotchas**
 *
 * Bodies are collected for the target while it records, which WebDriver BiDi needs declared before a request;
 * `webSocketFrames` is `Unsupported` there.
 *
 * **Example** (A HAR of a checkout, with its bodies)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Har, Page } from "@usestrider/browser"
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
): Effect.Effect<Recording, HarError | Target.TargetGone, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const found = Handles.target(target)
    const { runtime, grant } = found.behind
    const id = Operation.operationId()
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
    if (options.content !== "omit") {
      yield* HarImpl.collect(runtime, found, yield* NetworkResponse.BodyLimit, id).pipe(Effect.mapError(fail))
    }
    const { recorder, stop } = yield* HarImpl.start(runtime, found.behind.entry, {
      content: options.content,
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
              diagnostics: Operation.diagnostics(Operation.operationId())
            })
          ),
          Spans.operation("Har.exportHar", { attributes: { ...Spans.scopeAttributes(scopeOf), "browser.path": path } })
        )
    }
    return yield* Access.track<Recording>(grant)(recording)
  }).pipe(Spans.operation("Har.record", {
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
 * Schema for the reasons recording or exporting a HAR can fail.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HarErrorReason = Schema.Union([
  WriteFailed,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons recording or exporting a HAR can fail.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type HarErrorReason = typeof HarErrorReason.Type

const HarErrorTypeId = "~@usestrider/browser/Har/HarError"

/**
 * Error for a HAR that couldn't be recorded or exported.
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
}

/**
 * Checks whether a value is a `HarError`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isHarError = (u: unknown): u is HarError => Predicate.hasProperty(u, HarErrorTypeId)
