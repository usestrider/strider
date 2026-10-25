/**
 * Trace recordings, exported in the format Playwright's trace viewer reads.
 *
 * Spans are the record: every operation is a span, so any installed tracer (OTLP through
 * `effect/observability`, or `effect/devtools`) already receives the trace. `record` adds what spans can't
 * carry, page-side captures as attachments, and the export. Exports cross a persistence boundary, so they are
 * explicit and redacted. Archives are written with Effect's Zip module.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import * as Access from "./internal/access.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import * as HarImpl from "./internal/har.ts"
import * as NotBuilt from "./internal/notBuilt.ts"
import * as Operation from "./internal/operation.ts"
import * as Spans from "./internal/spans.ts"
import * as TraceImpl from "./internal/trace.ts"
import * as NetworkResponse from "./NetworkResponse.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * What a trace records beyond spans, logs, errors and console messages.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * A screenshot after each action.
   *
   * @default "off"
   */
  readonly screenshots?: "perAction" | "off" | undefined
  /**
   * Frames as the browser renders them, or polled screenshots at an interval. BiDi has no native
   * screencast.
   *
   * @default "off"
   */
  readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" | undefined
  /**
   * DOM snapshots per action. Installs a main-world script, so it needs control.
   *
   * @default false
   */
  readonly domSnapshots?: boolean | undefined
  /**
   * Network entries, so DOM snapshots render with their resources.
   *
   * @default false
   */
  readonly network?: boolean | undefined
}

/**
 * A trace being recorded; stopped by `remove` or when its scope closes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Recording extends Declaration.Registration {
  /**
   * Writes the trace as a Playwright trace-viewer archive (format 9), redacted.
   */
  exportTrace(path: FilePath.Local | string): Effect.Effect<FilePath.Local, TraceError>
}

/**
 * Starts recording a trace of a page or context while its scope lives.
 *
 * **Details**
 *
 * Each library operation on the target is a step, with its name, its span's attributes as params, its
 * duration and its error. A span of the caller's that encloses one, such as an `Effect.fn`'s, is a step too,
 * spanning the operations recorded inside it, so the trace nests as the program did. Console messages and
 * uncaught exceptions are recorded; `screenshots: "perAction"` adds one after each action and navigation;
 * `screencast` adds frames, the browser's own where `Capability.Screencast` has them or polled screenshots;
 * `network` adds the requests a `Har` would record, with their bodies. Times come from the library's clock,
 * never Effect's, so a trace made under `TestClock` still has a timeline. `exportTrace` writes a zip that
 * trace.playwright.dev opens (format 9), with params redacted under `Diagnostics.CurrentPreset`.
 *
 * **Gotchas**
 *
 * `screencast: "native"` is `Unsupported` on WebDriver BiDi. `domSnapshots` isn't built: it needs Playwright's
 * capture script in the page's main world, and fails as the defect `NotBuilt`.
 *
 * **Example** (A trace of a failing checkout)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page, Trace } from "@usestrider/browser"
 *
 * const traced = Effect.fn("traced")(function*(page: Page.Page) {
 *   const recording = yield* Trace.record(page.context, { screenshots: "perAction" })
 *   yield* page.getByRole("button", { name: "Pay" }).click().pipe(
 *     Effect.tapError(() => recording.exportTrace("./checkout-trace.zip"))
 *   )
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const record = (
  target: UserContext.UserContext | Page.Page,
  options?: Options | undefined
): Effect.Effect<Recording, TraceError, Scope.Scope> =>
  Effect.gen(function*() {
    if (options?.domSnapshots === true) return yield* NotBuilt.effect("Trace.record with domSnapshots")
    const scope = yield* Effect.scope
    const found = Handles.target(target)
    const { runtime, grant } = found.behind
    const id = Operation.operationId()
    const fail = (reason: TraceErrorReason) => new TraceError({ reason, diagnostics: Operation.diagnostics(id) })
    yield* Access.checkOr(grant, fail)
    const screencast = options?.screencast ?? "off"
    if (screencast === "native") {
      yield* Filters.requires(runtime, "Trace.record", "capability.screencast").pipe(
        Effect.mapError((error) => fail(error.reason as TraceErrorReason))
      )
    }
    if (options?.network === true) {
      yield* HarImpl.collect(runtime, found, yield* NetworkResponse.BodyLimit, id).pipe(Effect.mapError(fail))
    }
    const { exportTrace, stop } = yield* TraceImpl.start(
      runtime,
      found._tag === "Page"
        ? { _tag: "Page", entry: found.behind.entry }
        : { _tag: "UserContext", entry: found.behind.entry },
      { screenshots: options?.screenshots ?? "off", screencast, network: options?.network === true },
      scope
    )
    const recording: Recording = {
      remove: stop,
      exportTrace: (path) =>
        exportTrace(path).pipe(
          Effect.mapError((failure) =>
            new TraceError({
              reason: new WriteFailed({
                path: failure.path === "" ? String(path) : failure.path,
                hint: failure.hint,
                ...(failure.cause === undefined ? {} : { cause: failure.cause })
              }),
              diagnostics: Operation.diagnostics(Operation.operationId())
            })
          ),
          Spans.operation("Trace.exportTrace", { attributes: { "browser.path": path } })
        )
    }
    return yield* Access.track<Recording>(grant)(recording)
  }).pipe(Spans.operation("Trace.record", {
    attributes: { "browser.trace.screenshots": options?.screenshots ?? "off" }
  }))

/**
 * Reason for a trace that couldn't be written.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class WriteFailed extends Schema.Error<WriteFailed>("@usestrider/browser/Trace/WriteFailed")({
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
 * Schema for the reasons recording or exporting a trace can fail.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TraceErrorReason = Schema.Union([
  WriteFailed,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons recording or exporting a trace can fail.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type TraceErrorReason = typeof TraceErrorReason.Type

const TraceErrorTypeId = "~@usestrider/browser/Trace/TraceError"

/**
 * Error for a trace that couldn't be recorded or exported.
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class TraceError extends Schema.TaggedError<TraceError>(TraceErrorTypeId)("TraceError", {
  reason: TraceErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [TraceErrorTypeId] = TraceErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `TraceError`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isTraceError = (u: unknown): u is TraceError => Predicate.hasProperty(u, TraceErrorTypeId)
