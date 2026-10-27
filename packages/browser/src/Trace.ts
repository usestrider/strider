/**
 * Recordings of what happened on a page, exported as traces that Playwright's trace viewer opens.
 *
 * Spans are the record: every operation is a span, so any tracer you install (OTLP through `effect/observability`,
 * or `effect/devtools`) already receives it. `record` adds what spans can't carry, captures from the page such as
 * screenshots, and the export. An export leaves the process, so it's explicit and redacted. Archives are written
 * with Effect's `Zip` module.
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
import * as Operation from "./internal/operation.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as TraceImpl from "./internal/trace.ts"
import * as NetworkResponse from "./NetworkResponse.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
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
   * A screenshot after each action and navigation.
   *
   * @default "off"
   */
  readonly screenshots?: "perAction" | "off" | undefined
  /**
   * Frames as the browser renders them, or polled screenshots at an interval. On Firefox, `"native"` is the
   * browser's own video of each page (`Capability.Video`).
   *
   * @default "off"
   */
  readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" | undefined
  /**
   * DOM snapshots of every frame of the page before and after each action and navigation, which the trace viewer
   * renders. They render with the recorded network, so they need `network: true`.
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
 * Starts recording a trace of a page or context, until `remove` or until the scope it runs in closes.
 *
 * **Details**
 *
 * Each Strider operation on the target is a step, with its name, its span's attributes as params, its duration
 * and its error. A span of the caller's that encloses one, such as an `Effect.fn`'s, is a step too, spanning the
 * operations recorded inside it, so the trace nests as the program did. Console messages and uncaught exceptions
 * are recorded. `screenshots: "perAction"` adds a screenshot after each action and navigation. `screencast` adds
 * frames: the browser's own where `Capability.Screencast` has them, Firefox's video (`Capability.Video`), or
 * polled screenshots. `network` adds the requests a `Har` would record, with their bodies. `domSnapshots` adds a
 * snapshot of each frame of the page before and after each action and navigation, which the viewer renders with
 * the recorded network and the action's target highlighted. Times come from Strider's clock, never Effect's, so
 * a trace made under `TestClock` still has a timeline. `exportTrace` writes a zip that trace.playwright.dev opens
 * (format 9), with params redacted under `Diagnostics.CurrentPreset`; under the strict preset, so are the values
 * of password inputs, and of fields filled with `Redacted` text, in snapshots.
 *
 * **Gotchas**
 *
 * `domSnapshots` without `network: true` fails with `InvalidInput`: a snapshot's images, fonts and cross-origin
 * styles come from the network recording. Snapshots are captured in an isolated world of Strider's, which the
 * page can't see, and nothing hooks the page's styles, so each capture reads every stylesheet again. The viewer
 * draws a snapshot's canvas from the action's screenshot, so canvases need `screenshots: "perAction"`. Firefox's
 * video ends at the first `exportTrace`, which reads its file.
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
): Effect.Effect<Recording, TraceError | Target.TargetGone, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const found = Handles.target(target)
    const { runtime, grant } = found.behind
    const id = Operation.operationId()
    const fail = (reason: TraceErrorReason) => new TraceError({ reason, diagnostics: Operation.diagnostics(id) })
    yield* Access.check(grant)
    const screencast = options?.screencast ?? "off"
    if (screencast === "native" && !(yield* Filters.supported(runtime, "capability.video"))) {
      yield* Filters.requires(runtime, "Trace.record", "capability.screencast").pipe(
        Effect.mapError((error) => fail(error.reason as TraceErrorReason))
      )
    }
    if (options?.domSnapshots === true && options.network !== true) {
      return yield* Effect.fail(fail(
        new Reason.InvalidInput({
          input: "domSnapshots",
          expected: "network: true beside it",
          hint: "A snapshot's images, fonts and cross-origin styles come from the network recording"
        })
      ))
    }
    if (options?.network === true) {
      yield* HarImpl.collect(runtime, found, ["response"], yield* NetworkResponse.BodyLimit, id).pipe(
        Effect.mapError(fail)
      )
    }
    const { exportTrace, stop } = yield* TraceImpl.start(
      runtime,
      found._tag === "Page"
        ? { _tag: "Page", entry: found.behind.entry }
        : { _tag: "UserContext", entry: found.behind.entry },
      {
        screenshots: options?.screenshots ?? "off",
        screencast,
        network: options?.network === true,
        domSnapshots: options?.domSnapshots === true
      },
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
          Operation.named("Trace.exportTrace", { attributes: { "browser.path": path } })
        )
    }
    return yield* Access.track<Recording>(grant)(recording)
  }).pipe(Operation.named("Trace.record", {
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
  Reason.InvalidInput,
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
