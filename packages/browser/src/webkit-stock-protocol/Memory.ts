/**
 * Memory domain exposes page memory tracking. Only in builds compiled with `defined(ENABLE_RESOURCE_USAGE) && ENABLE_RESOURCE_USAGE`.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `CategoryData`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CategoryData {
  /**
   * Category type.
   */
  readonly type: CategoryDataType
  /**
   * Category size in bytes.
   */
  readonly size: number
}

/**
 * Schema for `CategoryData`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CategoryData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: CategoryDataType,
    size: Schema.Number
  }).annotate({ identifier: "Memory.CategoryData" })
) as any as Schema.Codec<CategoryData>

/**
 * Category type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CategoryDataType =
  | "javascript"
  | "jit"
  | "images"
  | "layers"
  | "page"
  | "other"
  | (string & {})

/**
 * Schema for `CategoryDataType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CategoryDataType = Schema.String as any as Schema.Codec<CategoryDataType>

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
   * Breakdown of memory in categories.
   */
  readonly categories: ReadonlyArray<CategoryData>
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
    categories: Schema.Array(CategoryData)
  }).annotate({ identifier: "Memory.Event" })
) as any as Schema.Codec<Event>

/**
 * Memory pressure was encountered.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MemoryPressureParams {
  readonly timestamp: number
  /**
   * The severity of the memory pressure event.
   */
  readonly severity: MemoryPressureParamsSeverity
}

/**
 * Schema for `MemoryPressureParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MemoryPressureParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    severity: MemoryPressureParamsSeverity
  }).annotate({ identifier: "Memory.MemoryPressureParams" })
) as any as Schema.Codec<MemoryPressureParams>

/**
 * The severity of the memory pressure event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MemoryPressureParamsSeverity =
  | "critical"
  | "non-critical"
  | (string & {})

/**
 * Schema for `MemoryPressureParamsSeverity`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MemoryPressureParamsSeverity = Schema.String as any as Schema.Codec<MemoryPressureParamsSeverity>

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
  }).annotate({ identifier: "Memory.TrackingCompleteParams" })
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
  }).annotate({ identifier: "Memory.TrackingStartParams" })
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
  }).annotate({ identifier: "Memory.TrackingUpdateParams" })
) as any as Schema.Codec<TrackingUpdateParams>

/**
 * Disables Memory domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Memory.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Memory.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables Memory domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Memory.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Memory.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Start tracking memory. This will produce a `trackingStart` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startTracking: Protocol.CommandDef<"Memory.startTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "Memory.startTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Stop tracking memory. This will produce a `trackingComplete` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopTracking: Protocol.CommandDef<"Memory.stopTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "Memory.stopTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Memory pressure was encountered.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const memoryPressure: Protocol.EventDef<"Memory.memoryPressure", MemoryPressureParams> = /*#__PURE__*/ Protocol
  .event(
    "Memory.memoryPressure",
    MemoryPressureParams,
    { status: "stable" }
  )

/**
 * Tracking stopped.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingComplete: Protocol.EventDef<"Memory.trackingComplete", TrackingCompleteParams> =
  /*#__PURE__*/ Protocol.event(
    "Memory.trackingComplete",
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
export const trackingStart: Protocol.EventDef<"Memory.trackingStart", TrackingStartParams> = /*#__PURE__*/ Protocol
  .event(
    "Memory.trackingStart",
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
export const trackingUpdate: Protocol.EventDef<"Memory.trackingUpdate", TrackingUpdateParams> = /*#__PURE__*/ Protocol
  .event(
    "Memory.trackingUpdate",
    TrackingUpdateParams,
    { status: "stable" }
  )
