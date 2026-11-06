/**
 * Recordings of what happened on a page, exported as traces that Playwright's trace viewer opens.
 *
 * Every operation is already a span, which any tracer you install receives (OTLP through `effect/observability`
 * or `effect/devtools`). `record` adds what spans can't carry, such as screenshots and DOM snapshots, and an
 * export, which is explicit and redacted.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Deadline from "./Deadline.ts"
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
 * **Details**
 *
 * DOM snapshots render with the recorded network, so `domSnapshots: true` needs `network: true` beside it, and
 * options with one but not the other don't compile. Options built from a computed flag choose a branch:
 * `flag ? { domSnapshots: true, network: true } : {}`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Options = CaptureOptions & (NetworkOptions | SnapshotOptions)

/**
 * The screenshots and frames a trace records, whichever the other options are.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CaptureOptions {
  /**
   * A screenshot after each action and navigation.
   *
   * @default "off"
   */
  readonly screenshots?: "perAction" | "off" | undefined
  /**
   * Frames as the browser renders them, or polled screenshots at an interval. Where video is supported, `"native"` is the
   * video of each page (`Capability.Video`).
   *
   * @default "off"
   */
  readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" | undefined
}

/**
 * Options for a trace without DOM snapshots, with or without the network.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NetworkOptions {
  /**
   * DOM snapshots, which need `network: true` beside them.
   *
   * @default false
   */
  readonly domSnapshots?: false | undefined
  /**
   * Network entries: the requests a `Har` would record, with their bodies.
   *
   * @default false
   */
  readonly network?: boolean | undefined
}

/**
 * Options for a trace with DOM snapshots, and the network they render with.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SnapshotOptions {
  /**
   * DOM snapshots of every frame of the page before and after each action and navigation, which the trace
   * viewer renders.
   */
  readonly domSnapshots: true
  /**
   * Network entries, so DOM snapshots render with their resources.
   */
  readonly network: true
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
   *
   * **Example** (Exporting a trace of signing in)
   *
   * ```ts import.meta.vitest
   * import { Page, Trace } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const traceSignIn = Effect.fn("traceSignIn")(function*(page: Page.Page) {
   *   const trace = yield* Trace.record(page, { screenshots: "perAction" })
   *   yield* page.goto("https://app.example.com/sign-in")
   *   yield* page.getByRole("button", { name: "Sign in" }).click()
   *   return yield* trace.exportTrace("sign-in-trace.zip")
   * })
   * ```
   */
  exportTrace(path: FilePath.Local | string): Effect.Effect<FilePath.Local, TraceError>
}

/**
 * Starts recording a trace of a page or context, until `remove` or until the scope it runs in closes.
 *
 * **Details**
 *
 * - Each Strider operation on the target is a step, with its name, its span's attributes as params, its duration
 *   and its error. A span of yours that encloses steps, such as an `Effect.fn`'s, is a step too, so the trace
 *   nests as the program did.
 * - Console messages and uncaught exceptions are always recorded.
 * - `screenshots: "perAction"` adds a screenshot after each action and navigation.
 * - `screencast` adds frames: the page's video where `Capability.Video` is supported, native frames otherwise
 *   (`Capability.Screencast`) or polled screenshots.
 * - `network` adds the requests a `Har` would record, with their bodies.
 * - `domSnapshots` adds a snapshot of each frame of the page before and after each action and navigation, which
 *   the viewer renders with the recorded network and the action's target highlighted.
 * - Times come from Strider's clock, never Effect's, so a trace made under `TestClock` still has a timeline.
 * - `exportTrace` writes a zip that trace.playwright.dev opens, with params redacted under
 *   `Diagnostics.CurrentPreset`. Under the strict preset, snapshots also redact password inputs and fields filled
 *   with `Redacted` text.
 *
 * **Gotchas**
 *
 * - `domSnapshots` needs `network: true`, since a snapshot's images, fonts and cross-origin styles come from the
 *   network recording. The types refuse one without the other; options that get past them, such as a cast, fail
 *   with `InvalidInput`.
 * - Snapshots are taken in an isolated world of Strider's, which the page can't see, and each one reads every
 *   stylesheet again. Stock WebKit has no isolated worlds, so there they run in the page's own.
 * - The viewer draws a snapshot's canvas from the action's screenshot, so canvases need
 *   `screenshots: "perAction"`.
 * - Failed expectations keep their original message plus the last observation, observation history, check
 *   count and triggers, elapsed time, nearest match and suggestions where available in the viewer's error message.
 *   Each export applies its diagnostics preset: URL expectations redact query values, credentials and fragments
 *   under `"strict"`, and keep whole URLs under `"local"`. Expected URL regexps and titles are hidden under
 *   `"strict"`; form values are hidden under both presets. Redaction follows the originating expectation through
 *   enclosing operations and rethrows. The original failure returned to the caller is unchanged.
 * - The page's video ends at the first `exportTrace`, which reads its file.
 *
 * **Example** (Exporting a trace when checkout fails)
 *
 * ```ts import.meta.vitest
 * import { Page, Trace } from "@usestrider/browser"
 * import { Effect } from "effect"
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
): Effect.Effect<Recording, TraceError | Target.TargetGone | Deadline.Timeout, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const found = Handles.target(target)
    const { runtime, grant } = found.behind
    const { id } = yield* Operation.record
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
        Effect.mapError((error) => Deadline.isTimeout(error) ? error : fail(error))
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
              diagnostics: Operation.diagnosticsNow()
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
 * **Example** (Falling back to polled screenshots)
 *
 * ```ts import.meta.vitest
 * import { Page, Trace } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const recordVideo = Effect.fn("recordVideo")(function*(page: Page.Page) {
 *   return yield* Trace.record(page, { screencast: "native" }).pipe(
 *     Effect.catchReason(
 *       "TraceError",
 *       "Unsupported",
 *       () => Trace.record(page, { screencast: { polled: "500 millis" } })
 *     )
 *   )
 * })
 * ```
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
