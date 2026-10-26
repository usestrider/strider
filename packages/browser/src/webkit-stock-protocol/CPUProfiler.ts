/**
 * CPUProfiler domain exposes cpu usage tracking. Only in builds compiled with `defined(ENABLE_RESOURCE_USAGE) && ENABLE_RESOURCE_USAGE`.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `Event`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Event {
  readonly timestamp: number
  /**
   * Percent of total cpu usage. If there are multiple cores the usage may be greater than 100%.
   */
  readonly usage: number
  /**
   * Per-thread CPU usage information. Does not include the main thread.
   */
  readonly threads?: ReadonlyArray<ThreadInfo> | undefined
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
    timestamp: Schema.Number,
    usage: Schema.Number,
    threads: Schema.optional(Schema.Array(ThreadInfo))
  }).annotate({ identifier: "CPUProfiler.Event" })
) as any as Schema.Codec<Event>

/**
 * CPU usage for an individual thread.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ThreadInfo {
  /**
   * Some thread identification information.
   */
  readonly name: string
  /**
   * CPU usage for this thread. This should not exceed 100% for an individual thread.
   */
  readonly usage: number
  /**
   * Type of thread. There should be a single main thread.
   */
  readonly type?: ThreadInfoType | undefined
  /**
   * A thread may be associated with a target, such as a Worker, in the process.
   */
  readonly targetId?: string | undefined
}

/**
 * Schema for `ThreadInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ThreadInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    usage: Schema.Number,
    type: Schema.optional(ThreadInfoType),
    targetId: Schema.optional(Schema.String)
  }).annotate({ identifier: "CPUProfiler.ThreadInfo" })
) as any as Schema.Codec<ThreadInfo>

/**
 * Type of thread. There should be a single main thread.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ThreadInfoType =
  | "main"
  | "webkit"
  | (string & {})

/**
 * Schema for `ThreadInfoType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ThreadInfoType = Schema.String as any as Schema.Codec<ThreadInfoType>

/**
 * Tracking stopped.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingCompleteParams {
  readonly timestamp: number
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
    timestamp: Schema.Number
  }).annotate({ identifier: "CPUProfiler.TrackingCompleteParams" })
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
  }).annotate({ identifier: "CPUProfiler.TrackingStartParams" })
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
  }).annotate({ identifier: "CPUProfiler.TrackingUpdateParams" })
) as any as Schema.Codec<TrackingUpdateParams>

/**
 * Start tracking cpu usage.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startTracking: Protocol.CommandDef<"CPUProfiler.startTracking", void, void> = /*#__PURE__*/ Protocol
  .command(
    "CPUProfiler.startTracking",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Stop tracking cpu usage. This will produce a `trackingComplete` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopTracking: Protocol.CommandDef<"CPUProfiler.stopTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "CPUProfiler.stopTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Tracking stopped.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingComplete: Protocol.EventDef<"CPUProfiler.trackingComplete", TrackingCompleteParams> =
  /*#__PURE__*/ Protocol.event(
    "CPUProfiler.trackingComplete",
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
export const trackingStart: Protocol.EventDef<"CPUProfiler.trackingStart", TrackingStartParams> = /*#__PURE__*/ Protocol
  .event(
    "CPUProfiler.trackingStart",
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
export const trackingUpdate: Protocol.EventDef<"CPUProfiler.trackingUpdate", TrackingUpdateParams> =
  /*#__PURE__*/ Protocol.event(
    "CPUProfiler.trackingUpdate",
    TrackingUpdateParams,
    { status: "stable" }
  )
