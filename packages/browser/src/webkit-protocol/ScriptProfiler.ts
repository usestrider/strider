/**
 * Profiler domain exposes JavaScript evaluation timing and profiling.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"

/**
 * `Event`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Event {
  readonly startTime: number
  readonly endTime: number
  readonly type: EventType
}

/**
 * Schema for `Event`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Event = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startTime: Schema.Number,
    endTime: Schema.Number,
    type: EventType
  }).annotate({ identifier: "ScriptProfiler.Event" })
) as any as Schema.Codec<Event>

/**
 * `EventType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EventType =
  | "API"
  | "Microtask"
  | "Other"
  | (string & {})

/**
 * Schema for `EventType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventType = Schema.String as any as Schema.Codec<EventType>

/**
 * `ExpressionLocation`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExpressionLocation {
  /**
   * 1-based.
   */
  readonly line: number
  /**
   * 1-based.
   */
  readonly column: number
}

/**
 * Schema for `ExpressionLocation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExpressionLocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    line: Schema.Int,
    column: Schema.Int
  }).annotate({ identifier: "ScriptProfiler.ExpressionLocation" })
) as any as Schema.Codec<ExpressionLocation>

/**
 * `Samples`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Samples {
  readonly stackTraces: ReadonlyArray<StackTrace>
}

/**
 * Schema for `Samples`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Samples = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stackTraces: Schema.Array(StackTrace)
  }).annotate({ identifier: "ScriptProfiler.Samples" })
) as any as Schema.Codec<Samples>

/**
 * `StackFrame`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StackFrame {
  /**
   * Unique script identifier.
   */
  readonly sourceID: Debugger.ScriptId
  /**
   * A displayable name for the stack frame. i.e function name, (program), etc.
   */
  readonly name: string
  /**
   * -1 if unavailable. 1-based if available.
   */
  readonly line: number
  /**
   * -1 if unavailable. 1-based if available.
   */
  readonly column: number
  readonly url: string
  readonly expressionLocation?: ExpressionLocation | undefined
}

/**
 * Schema for `StackFrame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StackFrame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceID: Debugger.ScriptId,
    name: Schema.String,
    line: Schema.Int,
    column: Schema.Int,
    url: Schema.String,
    expressionLocation: Schema.optional(ExpressionLocation)
  }).annotate({ identifier: "ScriptProfiler.StackFrame" })
) as any as Schema.Codec<StackFrame>

/**
 * `StackTrace`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StackTrace {
  readonly timestamp: number
  /**
   * First array item is the bottom of the call stack and last array item is the top of the call stack.
   */
  readonly stackFrames: ReadonlyArray<StackFrame>
}

/**
 * Schema for `StackTrace`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StackTrace = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    stackFrames: Schema.Array(StackFrame)
  }).annotate({ identifier: "ScriptProfiler.StackTrace" })
) as any as Schema.Codec<StackTrace>

/**
 * Start tracking script evaluations.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartTrackingParams {
  /**
   * Start the sampling profiler, defaults to false.
   */
  readonly includeSamples?: boolean | undefined
}

/**
 * Schema for `StartTrackingParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartTrackingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    includeSamples: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "ScriptProfiler.StartTrackingParams" })
) as any as Schema.Codec<StartTrackingParams>

/**
 * Tracking stopped. Includes any buffered data during tracking, such as profiling information.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingCompleteParams {
  readonly timestamp: number
  /**
   * Stack traces.
   */
  readonly samples?: Samples | undefined
}

/**
 * Schema for `TrackingCompleteParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingCompleteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    samples: Schema.optional(Samples)
  }).annotate({ identifier: "ScriptProfiler.TrackingCompleteParams" })
) as any as Schema.Codec<TrackingCompleteParams>

/**
 * Tracking started.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingStartParams {
  readonly timestamp: number
}

/**
 * Schema for `TrackingStartParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingStartParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number
  }).annotate({ identifier: "ScriptProfiler.TrackingStartParams" })
) as any as Schema.Codec<TrackingStartParams>

/**
 * Periodic tracking updates with event data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingUpdateParams {
  readonly event: Event
}

/**
 * Schema for `TrackingUpdateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingUpdateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    event: Event
  }).annotate({ identifier: "ScriptProfiler.TrackingUpdateParams" })
) as any as Schema.Codec<TrackingUpdateParams>

/**
 * Start tracking script evaluations.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startTracking: Protocol.CommandDef<"ScriptProfiler.startTracking", StartTrackingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "ScriptProfiler.startTracking",
    StartTrackingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Stop tracking script evaluations. This will produce a `trackingComplete` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopTracking: Protocol.CommandDef<"ScriptProfiler.stopTracking", void, void> = /*#__PURE__*/ Protocol
  .command(
    "ScriptProfiler.stopTracking",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Tracking stopped. Includes any buffered data during tracking, such as profiling information.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingComplete: Protocol.EventDef<"ScriptProfiler.trackingComplete", TrackingCompleteParams> =
  /*#__PURE__*/ Protocol.event(
    "ScriptProfiler.trackingComplete",
    TrackingCompleteParams,
    { status: "stable" }
  )

/**
 * Tracking started.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingStart: Protocol.EventDef<"ScriptProfiler.trackingStart", TrackingStartParams> =
  /*#__PURE__*/ Protocol.event(
    "ScriptProfiler.trackingStart",
    TrackingStartParams,
    { status: "stable" }
  )

/**
 * Periodic tracking updates with event data.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingUpdate: Protocol.EventDef<"ScriptProfiler.trackingUpdate", TrackingUpdateParams> =
  /*#__PURE__*/ Protocol.event(
    "ScriptProfiler.trackingUpdate",
    TrackingUpdateParams,
    { status: "stable" }
  )
