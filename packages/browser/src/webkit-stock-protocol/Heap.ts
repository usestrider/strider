/**
 * Heap domain exposes JavaScript heap attributes and capabilities.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Information about a garbage collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GarbageCollection {
  /**
   * The type of garbage collection.
   */
  readonly type: GarbageCollectionType
  readonly startTime: number
  readonly endTime: number
}

/**
 * Schema for `GarbageCollection`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GarbageCollection = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: GarbageCollectionType,
    startTime: Schema.Number,
    endTime: Schema.Number
  }).annotate({ identifier: "Heap.GarbageCollection" })
) as any as Schema.Codec<GarbageCollection>

/**
 * The type of garbage collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type GarbageCollectionType =
  | "full"
  | "partial"
  | (string & {})

/**
 * Schema for `GarbageCollectionType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GarbageCollectionType = Schema.String as any as Schema.Codec<GarbageCollectionType>

/**
 * JavaScriptCore HeapSnapshot JSON data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type HeapSnapshotData = string

/**
 * Schema for `HeapSnapshotData`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HeapSnapshotData = Schema.String as any as Schema.Codec<HeapSnapshotData>

/**
 * Information about the garbage collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GarbageCollectedParams {
  readonly collection: GarbageCollection
}

/**
 * Schema for `GarbageCollectedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GarbageCollectedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    collection: GarbageCollection
  }).annotate({ identifier: "Heap.GarbageCollectedParams" })
) as any as Schema.Codec<GarbageCollectedParams>

/**
 * Returns a preview (string, Debugger.FunctionDetails, or Runtime.ObjectPreview) for a Heap.HeapObjectId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPreviewParams {
  /**
   * Identifier of the heap object within the snapshot.
   */
  readonly heapObjectId: number
}

/**
 * Schema for `GetPreviewParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPreviewParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    heapObjectId: Schema.Int
  }).annotate({ identifier: "Heap.GetPreviewParams" })
) as any as Schema.Codec<GetPreviewParams>

/**
 * Returns a preview (string, Debugger.FunctionDetails, or Runtime.ObjectPreview) for a Heap.HeapObjectId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPreviewResult {
  /**
   * String value.
   */
  readonly string?: string | undefined
  /**
   * Function details.
   */
  readonly functionDetails?: Debugger.FunctionDetails | undefined
  /**
   * Object preview.
   */
  readonly preview?: Runtime.ObjectPreview | undefined
}

/**
 * Schema for `GetPreviewResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPreviewResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    string: Schema.optional(Schema.String),
    functionDetails: Schema.optional(Debugger.FunctionDetails),
    preview: Schema.optional(Runtime.ObjectPreview)
  }).annotate({ identifier: "Heap.GetPreviewResult" })
) as any as Schema.Codec<GetPreviewResult>

/**
 * Returns the strongly referenced Runtime.RemoteObject for a Heap.HeapObjectId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRemoteObjectParams {
  /**
   * Identifier of the heap object within the snapshot.
   */
  readonly heapObjectId: number
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
}

/**
 * Schema for `GetRemoteObjectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRemoteObjectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    heapObjectId: Schema.Int,
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "Heap.GetRemoteObjectParams" })
) as any as Schema.Codec<GetRemoteObjectParams>

/**
 * Returns the strongly referenced Runtime.RemoteObject for a Heap.HeapObjectId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRemoteObjectResult {
  /**
   * Resulting object.
   */
  readonly result: Runtime.RemoteObject
}

/**
 * Schema for `GetRemoteObjectResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRemoteObjectResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Runtime.RemoteObject
  }).annotate({ identifier: "Heap.GetRemoteObjectResult" })
) as any as Schema.Codec<GetRemoteObjectResult>

/**
 * Take a heap snapshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SnapshotResult {
  readonly timestamp: number
  readonly snapshotData: HeapSnapshotData
}

/**
 * Schema for `SnapshotResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    snapshotData: HeapSnapshotData
  }).annotate({ identifier: "Heap.SnapshotResult" })
) as any as Schema.Codec<SnapshotResult>

/**
 * Tracking stopped.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingCompleteParams {
  readonly timestamp: number
  /**
   * Snapshot at the end of tracking.
   */
  readonly snapshotData: HeapSnapshotData
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
    snapshotData: HeapSnapshotData
  }).annotate({ identifier: "Heap.TrackingCompleteParams" })
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
  /**
   * Snapshot at the start of tracking.
   */
  readonly snapshotData: HeapSnapshotData
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
    timestamp: Schema.Number,
    snapshotData: HeapSnapshotData
  }).annotate({ identifier: "Heap.TrackingStartParams" })
) as any as Schema.Codec<TrackingStartParams>

/**
 * Disables Heap domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Heap.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Heap.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables Heap domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Heap.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Heap.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Trigger a full garbage collection.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const gc: Protocol.CommandDef<"Heap.gc", void, void> = /*#__PURE__*/ Protocol.command(
  "Heap.gc",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Returns a preview (string, Debugger.FunctionDetails, or Runtime.ObjectPreview) for a Heap.HeapObjectId.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getPreview: Protocol.CommandDef<"Heap.getPreview", GetPreviewParams, GetPreviewResult> =
  /*#__PURE__*/ Protocol.command(
    "Heap.getPreview",
    GetPreviewParams,
    GetPreviewResult,
    { status: "stable" }
  )

/**
 * Returns the strongly referenced Runtime.RemoteObject for a Heap.HeapObjectId.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getRemoteObject: Protocol.CommandDef<
  "Heap.getRemoteObject",
  GetRemoteObjectParams,
  GetRemoteObjectResult
> = /*#__PURE__*/ Protocol.command(
  "Heap.getRemoteObject",
  GetRemoteObjectParams,
  GetRemoteObjectResult,
  { status: "stable" }
)

/**
 * Take a heap snapshot.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const snapshot: Protocol.CommandDef<"Heap.snapshot", void, SnapshotResult> = /*#__PURE__*/ Protocol.command(
  "Heap.snapshot",
  undefined,
  SnapshotResult,
  { status: "stable" }
)

/**
 * Start tracking heap changes. This will produce a `trackingStart` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startTracking: Protocol.CommandDef<"Heap.startTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "Heap.startTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Stop tracking heap changes. This will produce a `trackingComplete` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopTracking: Protocol.CommandDef<"Heap.stopTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "Heap.stopTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Information about the garbage collection.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const garbageCollected: Protocol.EventDef<"Heap.garbageCollected", GarbageCollectedParams> =
  /*#__PURE__*/ Protocol.event(
    "Heap.garbageCollected",
    GarbageCollectedParams,
    { status: "stable" }
  )

/**
 * Tracking stopped.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingComplete: Protocol.EventDef<"Heap.trackingComplete", TrackingCompleteParams> =
  /*#__PURE__*/ Protocol.event(
    "Heap.trackingComplete",
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
export const trackingStart: Protocol.EventDef<"Heap.trackingStart", TrackingStartParams> = /*#__PURE__*/ Protocol.event(
  "Heap.trackingStart",
  TrackingStartParams,
  { status: "stable" }
)
