/**
 * The HeapProfiler domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Heap snapshot object id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type HeapSnapshotObjectId = Brand.Branded<string, "~@usestrider/browser/cdp/HeapProfiler/HeapSnapshotObjectId">

/**
 * Schema for `HeapSnapshotObjectId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HeapSnapshotObjectId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/HeapProfiler/HeapSnapshotObjectId")
) as any as Schema.Codec<HeapSnapshotObjectId>

/**
 * Sampling profile.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SamplingHeapProfile {
  readonly head: SamplingHeapProfileNode
  readonly samples: ReadonlyArray<SamplingHeapProfileSample>
}

/**
 * Schema for `SamplingHeapProfile`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SamplingHeapProfile = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    head: SamplingHeapProfileNode,
    samples: Schema.Array(SamplingHeapProfileSample)
  }).annotate({ identifier: "HeapProfiler.SamplingHeapProfile" })
) as any as Schema.Codec<SamplingHeapProfile, unknown>

/**
 * Sampling Heap Profile node. Holds callsite information, allocation statistics and child nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SamplingHeapProfileNode {
  /**
   * Function location.
   */
  readonly callFrame: Runtime.CallFrame
  /**
   * Allocations size in bytes for the node excluding children.
   */
  readonly selfSize: number
  /**
   * Node id. Ids are unique across all profiles collected between startSampling and stopSampling.
   */
  readonly id: number
  /**
   * Child nodes.
   */
  readonly children: ReadonlyArray<SamplingHeapProfileNode>
}

/**
 * Schema for `SamplingHeapProfileNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SamplingHeapProfileNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    callFrame: Runtime.CallFrame,
    selfSize: Schema.Number,
    id: Schema.Int,
    children: Schema.Array(SamplingHeapProfileNode)
  }).annotate({ identifier: "HeapProfiler.SamplingHeapProfileNode" })
) as any as Schema.Codec<SamplingHeapProfileNode, unknown>

/**
 * A single sample from a sampling profile.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SamplingHeapProfileSample {
  /**
   * Allocation size in bytes attributed to the sample.
   */
  readonly size: number
  /**
   * Id of the corresponding profile tree node.
   */
  readonly nodeId: number
  /**
   * Time-ordered sample ordinal number. It is unique across all profiles retrieved
   * between startSampling and stopSampling.
   */
  readonly ordinal: number
}

/**
 * Schema for `SamplingHeapProfileSample`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SamplingHeapProfileSample = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    size: Schema.Number,
    nodeId: Schema.Int,
    ordinal: Schema.Number
  }).annotate({ identifier: "HeapProfiler.SamplingHeapProfileSample" })
) as any as Schema.Codec<SamplingHeapProfileSample>

/**
 * `addHeapSnapshotChunk.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddHeapSnapshotChunkParams {
  readonly chunk: string
}

/**
 * Schema for `AddHeapSnapshotChunkParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddHeapSnapshotChunkParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    chunk: Schema.String
  }).annotate({ identifier: "HeapProfiler.AddHeapSnapshotChunkParams" })
) as any as Schema.Codec<AddHeapSnapshotChunkParams>

/**
 * Enables console to refer to the node with given id via $x (see Command Line API for more details
 * $x functions).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddInspectedHeapObjectParams {
  /**
   * Heap snapshot object id to be accessible by means of $x command line API.
   */
  readonly heapObjectId: HeapSnapshotObjectId
}

/**
 * Schema for `AddInspectedHeapObjectParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddInspectedHeapObjectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    heapObjectId: HeapSnapshotObjectId
  }).annotate({ identifier: "HeapProfiler.AddInspectedHeapObjectParams" })
) as any as Schema.Codec<AddInspectedHeapObjectParams>

/**
 * `getHeapObjectId.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHeapObjectIdParams {
  /**
   * Identifier of the object to get heap object id for.
   */
  readonly objectId: Runtime.RemoteObjectId
}

/**
 * Schema for `GetHeapObjectIdParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHeapObjectIdParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId
  }).annotate({ identifier: "HeapProfiler.GetHeapObjectIdParams" })
) as any as Schema.Codec<GetHeapObjectIdParams>

/**
 * `getHeapObjectId.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHeapObjectIdResult {
  /**
   * Id of the heap snapshot object corresponding to the passed remote object id.
   */
  readonly heapSnapshotObjectId: HeapSnapshotObjectId
}

/**
 * Schema for `GetHeapObjectIdResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHeapObjectIdResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    heapSnapshotObjectId: HeapSnapshotObjectId
  }).annotate({ identifier: "HeapProfiler.GetHeapObjectIdResult" })
) as any as Schema.Codec<GetHeapObjectIdResult>

/**
 * `getObjectByHeapObjectId.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetObjectByHeapObjectIdParams {
  readonly objectId: HeapSnapshotObjectId
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
}

/**
 * Schema for `GetObjectByHeapObjectIdParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetObjectByHeapObjectIdParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: HeapSnapshotObjectId,
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "HeapProfiler.GetObjectByHeapObjectIdParams" })
) as any as Schema.Codec<GetObjectByHeapObjectIdParams>

/**
 * `getObjectByHeapObjectId.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetObjectByHeapObjectIdResult {
  /**
   * Evaluation result.
   */
  readonly result: Runtime.RemoteObject
}

/**
 * Schema for `GetObjectByHeapObjectIdResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetObjectByHeapObjectIdResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Runtime.RemoteObject
  }).annotate({ identifier: "HeapProfiler.GetObjectByHeapObjectIdResult" })
) as any as Schema.Codec<GetObjectByHeapObjectIdResult>

/**
 * `getSamplingProfile.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSamplingProfileResult {
  /**
   * Return the sampling profile being collected.
   */
  readonly profile: SamplingHeapProfile
}

/**
 * Schema for `GetSamplingProfileResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSamplingProfileResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: SamplingHeapProfile
  }).annotate({ identifier: "HeapProfiler.GetSamplingProfileResult" })
) as any as Schema.Codec<GetSamplingProfileResult, unknown>

/**
 * If heap objects tracking has been started then backend may send update for one or more fragments
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HeapStatsUpdateParams {
  /**
   * An array of triplets. Each triplet describes a fragment. The first integer is the fragment
   * index, the second integer is a total count of objects for the fragment, the third integer is
   * a total size of the objects for the fragment.
   */
  readonly statsUpdate: ReadonlyArray<number>
}

/**
 * Schema for `HeapStatsUpdateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HeapStatsUpdateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    statsUpdate: Schema.Array(Schema.Int)
  }).annotate({ identifier: "HeapProfiler.HeapStatsUpdateParams" })
) as any as Schema.Codec<HeapStatsUpdateParams>

/**
 * If heap objects tracking has been started then backend regularly sends a current value for last
 * seen object id and corresponding timestamp. If the were changes in the heap since last event
 * then one or more heapStatsUpdate events will be sent before a new lastSeenObjectId event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LastSeenObjectIdParams {
  readonly lastSeenObjectId: number
  readonly timestamp: number
}

/**
 * Schema for `LastSeenObjectIdParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LastSeenObjectIdParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lastSeenObjectId: Schema.Int,
    timestamp: Schema.Number
  }).annotate({ identifier: "HeapProfiler.LastSeenObjectIdParams" })
) as any as Schema.Codec<LastSeenObjectIdParams>

/**
 * `reportHeapSnapshotProgress.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportHeapSnapshotProgressParams {
  readonly done: number
  readonly total: number
  readonly finished?: boolean | undefined
}

/**
 * Schema for `ReportHeapSnapshotProgressParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportHeapSnapshotProgressParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    done: Schema.Int,
    total: Schema.Int,
    finished: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "HeapProfiler.ReportHeapSnapshotProgressParams" })
) as any as Schema.Codec<ReportHeapSnapshotProgressParams>

/**
 * `startSampling.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartSamplingParams {
  /**
   * Average sample interval in bytes. Poisson distribution is used for the intervals. The
   * default value is 32768 bytes.
   */
  readonly samplingInterval?: number | undefined
  /**
   * Maximum stack depth. The default value is 128.
   */
  readonly stackDepth?: number | undefined
  /**
   * By default, the sampling heap profiler reports only objects which are
   * still alive when the profile is returned via getSamplingProfile or
   * stopSampling, which is useful for determining what functions contribute
   * the most to steady-state memory usage. This flag instructs the sampling
   * heap profiler to also include information about objects discarded by
   * major GC, which will show which functions cause large temporary memory
   * usage or long GC pauses.
   */
  readonly includeObjectsCollectedByMajorGC?: boolean | undefined
  /**
   * By default, the sampling heap profiler reports only objects which are
   * still alive when the profile is returned via getSamplingProfile or
   * stopSampling, which is useful for determining what functions contribute
   * the most to steady-state memory usage. This flag instructs the sampling
   * heap profiler to also include information about objects discarded by
   * minor GC, which is useful when tuning a latency-sensitive application
   * for minimal GC activity.
   */
  readonly includeObjectsCollectedByMinorGC?: boolean | undefined
}

/**
 * Schema for `StartSamplingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartSamplingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    samplingInterval: Schema.optional(Schema.Number),
    stackDepth: Schema.optional(Schema.Number),
    includeObjectsCollectedByMajorGC: Schema.optional(Schema.Boolean),
    includeObjectsCollectedByMinorGC: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "HeapProfiler.StartSamplingParams" })
) as any as Schema.Codec<StartSamplingParams>

/**
 * `startTrackingHeapObjects.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartTrackingHeapObjectsParams {
  readonly trackAllocations?: boolean | undefined
}

/**
 * Schema for `StartTrackingHeapObjectsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartTrackingHeapObjectsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    trackAllocations: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "HeapProfiler.StartTrackingHeapObjectsParams" })
) as any as Schema.Codec<StartTrackingHeapObjectsParams>

/**
 * `stopSampling.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopSamplingResult {
  /**
   * Recorded sampling heap profile.
   */
  readonly profile: SamplingHeapProfile
}

/**
 * Schema for `StopSamplingResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopSamplingResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: SamplingHeapProfile
  }).annotate({ identifier: "HeapProfiler.StopSamplingResult" })
) as any as Schema.Codec<StopSamplingResult, unknown>

/**
 * `stopTrackingHeapObjects.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopTrackingHeapObjectsParams {
  /**
   * If true 'reportHeapSnapshotProgress' events will be generated while snapshot is being taken
   * when the tracking is stopped.
   */
  readonly reportProgress?: boolean | undefined
  /**
   * If true, numerical values are included in the snapshot
   */
  readonly captureNumericValue?: boolean | undefined
  /**
   * If true, exposes internals of the snapshot.
   */
  readonly exposeInternals?: boolean | undefined
}

/**
 * Schema for `StopTrackingHeapObjectsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopTrackingHeapObjectsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reportProgress: Schema.optional(Schema.Boolean),
    captureNumericValue: Schema.optional(Schema.Boolean),
    exposeInternals: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "HeapProfiler.StopTrackingHeapObjectsParams" })
) as any as Schema.Codec<StopTrackingHeapObjectsParams>

/**
 * `takeHeapSnapshot.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TakeHeapSnapshotParams {
  /**
   * If true 'reportHeapSnapshotProgress' events will be generated while snapshot is being taken.
   */
  readonly reportProgress?: boolean | undefined
  /**
   * If true, numerical values are included in the snapshot
   */
  readonly captureNumericValue?: boolean | undefined
  /**
   * If true, exposes internals of the snapshot.
   */
  readonly exposeInternals?: boolean | undefined
}

/**
 * Schema for `TakeHeapSnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TakeHeapSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reportProgress: Schema.optional(Schema.Boolean),
    captureNumericValue: Schema.optional(Schema.Boolean),
    exposeInternals: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "HeapProfiler.TakeHeapSnapshotParams" })
) as any as Schema.Codec<TakeHeapSnapshotParams>

/**
 * Enables console to refer to the node with given id via $x (see Command Line API for more details
 * $x functions).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addInspectedHeapObject: Protocol.CommandDef<
  "HeapProfiler.addInspectedHeapObject",
  AddInspectedHeapObjectParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.addInspectedHeapObject",
  AddInspectedHeapObjectParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.collectGarbage`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const collectGarbage: Protocol.CommandDef<"HeapProfiler.collectGarbage", void, void> = /*#__PURE__*/ Protocol
  .command(
    "HeapProfiler.collectGarbage",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `HeapProfiler.disable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"HeapProfiler.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.enable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"HeapProfiler.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.getHeapObjectId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getHeapObjectId: Protocol.CommandDef<
  "HeapProfiler.getHeapObjectId",
  GetHeapObjectIdParams,
  GetHeapObjectIdResult
> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.getHeapObjectId",
  GetHeapObjectIdParams,
  GetHeapObjectIdResult,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.getObjectByHeapObjectId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getObjectByHeapObjectId: Protocol.CommandDef<
  "HeapProfiler.getObjectByHeapObjectId",
  GetObjectByHeapObjectIdParams,
  GetObjectByHeapObjectIdResult
> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.getObjectByHeapObjectId",
  GetObjectByHeapObjectIdParams,
  GetObjectByHeapObjectIdResult,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.getSamplingProfile`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getSamplingProfile: Protocol.CommandDef<
  "HeapProfiler.getSamplingProfile",
  void,
  GetSamplingProfileResult
> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.getSamplingProfile",
  undefined,
  GetSamplingProfileResult,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.startSampling`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startSampling: Protocol.CommandDef<"HeapProfiler.startSampling", StartSamplingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "HeapProfiler.startSampling",
    StartSamplingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `HeapProfiler.startTrackingHeapObjects`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startTrackingHeapObjects: Protocol.CommandDef<
  "HeapProfiler.startTrackingHeapObjects",
  StartTrackingHeapObjectsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.startTrackingHeapObjects",
  StartTrackingHeapObjectsParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.stopSampling`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopSampling: Protocol.CommandDef<"HeapProfiler.stopSampling", void, StopSamplingResult> =
  /*#__PURE__*/ Protocol.command(
    "HeapProfiler.stopSampling",
    undefined,
    StopSamplingResult,
    { status: "stable" }
  )

/**
 * Sends `HeapProfiler.stopTrackingHeapObjects`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopTrackingHeapObjects: Protocol.CommandDef<
  "HeapProfiler.stopTrackingHeapObjects",
  StopTrackingHeapObjectsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "HeapProfiler.stopTrackingHeapObjects",
  StopTrackingHeapObjectsParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `HeapProfiler.takeHeapSnapshot`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const takeHeapSnapshot: Protocol.CommandDef<"HeapProfiler.takeHeapSnapshot", TakeHeapSnapshotParams, void> =
  /*#__PURE__*/ Protocol.command(
    "HeapProfiler.takeHeapSnapshot",
    TakeHeapSnapshotParams,
    undefined,
    { status: "stable" }
  )

/**
 * The `HeapProfiler.addHeapSnapshotChunk` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const addHeapSnapshotChunk: Protocol.EventDef<"HeapProfiler.addHeapSnapshotChunk", AddHeapSnapshotChunkParams> =
  /*#__PURE__*/ Protocol.event(
    "HeapProfiler.addHeapSnapshotChunk",
    AddHeapSnapshotChunkParams,
    { status: "stable" }
  )

/**
 * If heap objects tracking has been started then backend may send update for one or more fragments
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const heapStatsUpdate: Protocol.EventDef<"HeapProfiler.heapStatsUpdate", HeapStatsUpdateParams> =
  /*#__PURE__*/ Protocol.event(
    "HeapProfiler.heapStatsUpdate",
    HeapStatsUpdateParams,
    { status: "stable" }
  )

/**
 * If heap objects tracking has been started then backend regularly sends a current value for last
 * seen object id and corresponding timestamp. If the were changes in the heap since last event
 * then one or more heapStatsUpdate events will be sent before a new lastSeenObjectId event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const lastSeenObjectId: Protocol.EventDef<"HeapProfiler.lastSeenObjectId", LastSeenObjectIdParams> =
  /*#__PURE__*/ Protocol.event(
    "HeapProfiler.lastSeenObjectId",
    LastSeenObjectIdParams,
    { status: "stable" }
  )

/**
 * The `HeapProfiler.reportHeapSnapshotProgress` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const reportHeapSnapshotProgress: Protocol.EventDef<
  "HeapProfiler.reportHeapSnapshotProgress",
  ReportHeapSnapshotProgressParams
> = /*#__PURE__*/ Protocol.event(
  "HeapProfiler.reportHeapSnapshotProgress",
  ReportHeapSnapshotProgressParams,
  { status: "stable" }
)

/**
 * The `HeapProfiler.resetProfiles` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const resetProfiles: Protocol.EventDef<"HeapProfiler.resetProfiles", void> = /*#__PURE__*/ Protocol.event(
  "HeapProfiler.resetProfiles",
  undefined,
  { status: "stable" }
)
