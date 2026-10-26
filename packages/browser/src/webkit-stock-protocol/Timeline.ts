/**
 * Timeline provides its clients with instrumentation records that are generated during the page runtime. Timeline instrumentation can be started and stopped using corresponding commands. While timeline is started, it is generating timeline event records.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Timeline record type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EventType =
  | "EventDispatch"
  | "ScheduleStyleRecalculation"
  | "RecalculateStyles"
  | "InvalidateLayout"
  | "ScheduleLayout"
  | "Layout"
  | "Paint"
  | "Composite"
  | "RenderingFrame"
  | "TimerInstall"
  | "TimerRemove"
  | "TimerFire"
  | "EvaluateScript"
  | "TimeStamp"
  | "Time"
  | "TimeEnd"
  | "FunctionCall"
  | "ProbeSample"
  | "ConsoleProfile"
  | "RequestAnimationFrame"
  | "CancelAnimationFrame"
  | "FireAnimationFrame"
  | "ObserverCallback"
  | "FirstContentfulPaint"
  | "LargestContentfulPaint"
  | "Screenshot"
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
 * Instrument types.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Instrument =
  | "ScriptProfiler"
  | "Timeline"
  | "CPU"
  | "Memory"
  | "Heap"
  | "Animation"
  | "Screenshot"
  | (string & {})

/**
 * Schema for `Instrument`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Instrument = Schema.String as any as Schema.Codec<Instrument>

/**
 * Timeline record contains information about the recorded activity.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TimelineEvent {
  /**
   * Event type.
   */
  readonly type: EventType
  /**
   * Event data.
   */
  readonly data: { readonly [key: string]: unknown }
  /**
   * Nested records.
   */
  readonly children?: ReadonlyArray<TimelineEvent> | undefined
}

/**
 * Schema for `TimelineEvent`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TimelineEvent = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: EventType,
    data: Schema.Record(Schema.String, Schema.Unknown),
    children: Schema.optional(Schema.Array(TimelineEvent))
  }).annotate({ identifier: "Timeline.TimelineEvent" })
) as any as Schema.Codec<TimelineEvent>

/**
 * Fired for every instrumentation event while timeline is started.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EventRecordedParams {
  /**
   * Timeline event record data.
   */
  readonly record: TimelineEvent
}

/**
 * Schema for `EventRecordedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventRecordedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    record: TimelineEvent
  }).annotate({ identifier: "Timeline.EventRecordedParams" })
) as any as Schema.Codec<EventRecordedParams>

/**
 * Fired when recording has started.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RecordingStartedParams {
  /**
   * Start time of this new recording.
   */
  readonly startTime: number
}

/**
 * Schema for `RecordingStartedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RecordingStartedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startTime: Schema.Number
  }).annotate({ identifier: "Timeline.RecordingStartedParams" })
) as any as Schema.Codec<RecordingStartedParams>

/**
 * Fired when recording has stopped.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RecordingStoppedParams {
  /**
   * End time of this recording.
   */
  readonly endTime: number
}

/**
 * Schema for `RecordingStoppedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RecordingStoppedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    endTime: Schema.Number
  }).annotate({ identifier: "Timeline.RecordingStoppedParams" })
) as any as Schema.Codec<RecordingStoppedParams>

/**
 * Toggle auto capture state. If <code>true</code> the backend will disable breakpoints and start capturing on navigation. The backend will fire the <code>autoCaptureStarted</code> event when an auto capture starts. The frontend should stop the auto capture when appropriate and re-enable breakpoints.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAutoCaptureEnabledParams {
  /**
   * New auto capture state.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetAutoCaptureEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAutoCaptureEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Timeline.SetAutoCaptureEnabledParams" })
) as any as Schema.Codec<SetAutoCaptureEnabledParams>

/**
 * Instruments to enable when capture starts on the backend (e.g. auto capture or programmatic capture).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInstrumentsParams {
  /**
   * Instruments to enable.
   */
  readonly instruments: ReadonlyArray<Instrument>
}

/**
 * Schema for `SetInstrumentsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInstrumentsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    instruments: Schema.Array(Instrument)
  }).annotate({ identifier: "Timeline.SetInstrumentsParams" })
) as any as Schema.Codec<SetInstrumentsParams>

/**
 * Starts capturing instrumentation events.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartParams {
  /**
   * Samples JavaScript stack traces up to <code>maxCallStackDepth</code>, defaults to 5.
   */
  readonly maxCallStackDepth?: number | undefined
}

/**
 * Schema for `StartParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxCallStackDepth: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Timeline.StartParams" })
) as any as Schema.Codec<StartParams>

/**
 * Disables Timeline domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Timeline.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Timeline.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables Timeline domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Timeline.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Timeline.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Toggle auto capture state. If <code>true</code> the backend will disable breakpoints and start capturing on navigation. The backend will fire the <code>autoCaptureStarted</code> event when an auto capture starts. The frontend should stop the auto capture when appropriate and re-enable breakpoints.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAutoCaptureEnabled: Protocol.CommandDef<
  "Timeline.setAutoCaptureEnabled",
  SetAutoCaptureEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Timeline.setAutoCaptureEnabled",
  SetAutoCaptureEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Instruments to enable when capture starts on the backend (e.g. auto capture or programmatic capture).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInstruments: Protocol.CommandDef<"Timeline.setInstruments", SetInstrumentsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Timeline.setInstruments",
    SetInstrumentsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Starts capturing instrumentation events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const start: Protocol.CommandDef<"Timeline.start", StartParams, void> = /*#__PURE__*/ Protocol.command(
  "Timeline.start",
  StartParams,
  undefined,
  { status: "stable" }
)

/**
 * Stops capturing instrumentation events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stop: Protocol.CommandDef<"Timeline.stop", void, void> = /*#__PURE__*/ Protocol.command(
  "Timeline.stop",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fired when auto capture started.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const autoCaptureStarted: Protocol.EventDef<"Timeline.autoCaptureStarted", void> = /*#__PURE__*/ Protocol.event(
  "Timeline.autoCaptureStarted",
  undefined,
  { status: "stable" }
)

/**
 * Fired for every instrumentation event while timeline is started.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const eventRecorded: Protocol.EventDef<"Timeline.eventRecorded", EventRecordedParams> = /*#__PURE__*/ Protocol
  .event(
    "Timeline.eventRecorded",
    EventRecordedParams,
    { status: "stable" }
  )

/**
 * Fired when recording has started.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const recordingStarted: Protocol.EventDef<"Timeline.recordingStarted", RecordingStartedParams> =
  /*#__PURE__*/ Protocol.event(
    "Timeline.recordingStarted",
    RecordingStartedParams,
    { status: "stable" }
  )

/**
 * Fired when recording has stopped.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const recordingStopped: Protocol.EventDef<"Timeline.recordingStopped", RecordingStoppedParams> =
  /*#__PURE__*/ Protocol.event(
    "Timeline.recordingStopped",
    RecordingStoppedParams,
    { status: "stable" }
  )
