/**
 * The Tracing domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as IO from "./IO.ts"

/**
 * Configuration for memory dump. Used only when "memory-infra" category is enabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type MemoryDumpConfig = { readonly [key: string]: unknown }

/**
 * Schema for `MemoryDumpConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MemoryDumpConfig = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<MemoryDumpConfig>

/**
 * Details exposed when memory request explicitly declared.
 * Keep consistent with memory_dump_request_args.h and
 * memory_instrumentation.mojom
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type MemoryDumpLevelOfDetail =
  | "background"
  | "light"
  | "detailed"
  | (string & {})

/**
 * Schema for `MemoryDumpLevelOfDetail`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MemoryDumpLevelOfDetail = Schema.String as any as Schema.Codec<MemoryDumpLevelOfDetail>

/**
 * Compression type to use for traces returned via streams.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StreamCompression =
  | "none"
  | "gzip"
  | (string & {})

/**
 * Schema for `StreamCompression`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StreamCompression = Schema.String as any as Schema.Codec<StreamCompression>

/**
 * Data format of a trace. Can be either the legacy JSON format or the
 * protocol buffer format. Note that the JSON format will be deprecated soon.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StreamFormat =
  | "json"
  | "proto"
  | (string & {})

/**
 * Schema for `StreamFormat`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StreamFormat = Schema.String as any as Schema.Codec<StreamFormat>

/**
 * `TraceConfig`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TraceConfig {
  /**
   * Controls how the trace buffer stores data. The default is `recordUntilFull`.
   */
  readonly recordMode?: TraceConfigRecordMode | undefined
  /**
   * Size of the trace buffer in kilobytes. If not specified or zero is passed, a default value
   * of 200 MB would be used.
   */
  readonly traceBufferSizeInKb?: number | undefined
  /**
   * Turns on JavaScript stack sampling.
   */
  readonly enableSampling?: boolean | undefined
  /**
   * Turns on system tracing.
   */
  readonly enableSystrace?: boolean | undefined
  /**
   * Turns on argument filter.
   */
  readonly enableArgumentFilter?: boolean | undefined
  /**
   * Included category filters.
   */
  readonly includedCategories?: ReadonlyArray<string> | undefined
  /**
   * Excluded category filters.
   */
  readonly excludedCategories?: ReadonlyArray<string> | undefined
  /**
   * Configuration to synthesize the delays in tracing.
   */
  readonly syntheticDelays?: ReadonlyArray<string> | undefined
  /**
   * Configuration for memory dump triggers. Used only when "memory-infra" category is enabled.
   */
  readonly memoryDumpConfig?: MemoryDumpConfig | undefined
}

/**
 * Schema for `TraceConfig`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TraceConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    recordMode: Schema.optional(TraceConfigRecordMode),
    traceBufferSizeInKb: Schema.optional(Schema.Number),
    enableSampling: Schema.optional(Schema.Boolean),
    enableSystrace: Schema.optional(Schema.Boolean),
    enableArgumentFilter: Schema.optional(Schema.Boolean),
    includedCategories: Schema.optional(Schema.Array(Schema.String)),
    excludedCategories: Schema.optional(Schema.Array(Schema.String)),
    syntheticDelays: Schema.optional(Schema.Array(Schema.String)),
    memoryDumpConfig: Schema.optional(MemoryDumpConfig)
  }).annotate({ identifier: "Tracing.TraceConfig" })
) as any as Schema.Codec<TraceConfig>

/**
 * Controls how the trace buffer stores data. The default is `recordUntilFull`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type TraceConfigRecordMode =
  | "recordUntilFull"
  | "recordContinuously"
  | "recordAsMuchAsPossible"
  | "echoToConsole"
  | (string & {})

/**
 * Schema for `TraceConfigRecordMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TraceConfigRecordMode = Schema.String as any as Schema.Codec<TraceConfigRecordMode>

/**
 * Backend type to use for tracing. `chrome` uses the Chrome-integrated
 * tracing service and is supported on all platforms. `system` is only
 * supported on Chrome OS and uses the Perfetto system tracing service.
 * `auto` chooses `system` when the perfettoConfig provided to Tracing.start
 * specifies at least one non-Chrome data source; otherwise uses `chrome`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type TracingBackend =
  | "auto"
  | "chrome"
  | "system"
  | (string & {})

/**
 * Schema for `TracingBackend`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TracingBackend = Schema.String as any as Schema.Codec<TracingBackend>

/**
 * `bufferUsage.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BufferUsageParams {
  /**
   * A number in range [0..1] that indicates the used size of event buffer as a fraction of its
   * total size.
   */
  readonly percentFull?: number | undefined
  /**
   * An approximate number of events in the trace log.
   */
  readonly eventCount?: number | undefined
  /**
   * A number in range [0..1] that indicates the used size of event buffer as a fraction of its
   * total size.
   */
  readonly value?: number | undefined
}

/**
 * Schema for `BufferUsageParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BufferUsageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    percentFull: Schema.optional(Schema.Number),
    eventCount: Schema.optional(Schema.Number),
    value: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Tracing.BufferUsageParams" })
) as any as Schema.Codec<BufferUsageParams>

/**
 * Contains a bucket of collected trace events. When tracing is stopped collected events will be
 * sent as a sequence of dataCollected events followed by tracingComplete event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DataCollectedParams {
  readonly value: ReadonlyArray<{ readonly [key: string]: unknown }>
}

/**
 * Schema for `DataCollectedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DataCollectedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "Tracing.DataCollectedParams" })
) as any as Schema.Codec<DataCollectedParams>

/**
 * Gets supported tracing categories.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCategoriesResult {
  /**
   * A list of supported tracing categories.
   */
  readonly categories: ReadonlyArray<string>
}

/**
 * Schema for `GetCategoriesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCategoriesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    categories: Schema.Array(Schema.String)
  }).annotate({ identifier: "Tracing.GetCategoriesResult" })
) as any as Schema.Codec<GetCategoriesResult>

/**
 * Return a descriptor for all available tracing categories.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetTrackEventDescriptorResult {
  /**
   * Base64-encoded serialized perfetto.protos.TrackEventDescriptor protobuf message. (Encoded as a base64 string when passed over JSON)
   */
  readonly descriptor: string
}

/**
 * Schema for `GetTrackEventDescriptorResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetTrackEventDescriptorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    descriptor: Schema.String
  }).annotate({ identifier: "Tracing.GetTrackEventDescriptorResult" })
) as any as Schema.Codec<GetTrackEventDescriptorResult>

/**
 * Record a clock sync marker in the trace.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RecordClockSyncMarkerParams {
  /**
   * The ID of this clock sync marker
   */
  readonly syncId: string
}

/**
 * Schema for `RecordClockSyncMarkerParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RecordClockSyncMarkerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    syncId: Schema.String
  }).annotate({ identifier: "Tracing.RecordClockSyncMarkerParams" })
) as any as Schema.Codec<RecordClockSyncMarkerParams>

/**
 * Request a global memory dump.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestMemoryDumpParams {
  /**
   * Enables more deterministic results by forcing garbage collection
   */
  readonly deterministic?: boolean | undefined
  /**
   * Specifies level of details in memory dump. Defaults to "detailed".
   */
  readonly levelOfDetail?: MemoryDumpLevelOfDetail | undefined
}

/**
 * Schema for `RequestMemoryDumpParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestMemoryDumpParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    deterministic: Schema.optional(Schema.Boolean),
    levelOfDetail: Schema.optional(MemoryDumpLevelOfDetail)
  }).annotate({ identifier: "Tracing.RequestMemoryDumpParams" })
) as any as Schema.Codec<RequestMemoryDumpParams>

/**
 * Request a global memory dump.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestMemoryDumpResult {
  /**
   * GUID of the resulting global memory dump.
   */
  readonly dumpGuid: string
  /**
   * True iff the global memory dump succeeded.
   */
  readonly success: boolean
}

/**
 * Schema for `RequestMemoryDumpResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestMemoryDumpResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dumpGuid: Schema.String,
    success: Schema.Boolean
  }).annotate({ identifier: "Tracing.RequestMemoryDumpResult" })
) as any as Schema.Codec<RequestMemoryDumpResult>

/**
 * Start trace events collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartParams {
  /**
   * If set, the agent will issue bufferUsage events at this interval, specified in milliseconds
   */
  readonly bufferUsageReportingInterval?: number | undefined
  /**
   * Whether to report trace events as series of dataCollected events or to save trace to a
   * stream (defaults to `ReportEvents`).
   */
  readonly transferMode?: StartParamsTransferMode | undefined
  /**
   * Trace data format to use. This only applies when using `ReturnAsStream`
   * transfer mode (defaults to `json`).
   */
  readonly streamFormat?: StreamFormat | undefined
  /**
   * Compression format to use. This only applies when using `ReturnAsStream`
   * transfer mode (defaults to `none`)
   */
  readonly streamCompression?: StreamCompression | undefined
  readonly traceConfig?: TraceConfig | undefined
  /**
   * Base64-encoded serialized perfetto.protos.TraceConfig protobuf message
   * When specified, the parameters `categories`, `options`, `traceConfig`
   * are ignored. (Encoded as a base64 string when passed over JSON)
   */
  readonly perfettoConfig?: string | undefined
  /**
   * Backend type (defaults to `auto`)
   */
  readonly tracingBackend?: TracingBackend | undefined
  /**
   * Maximum width and height (in pixels) of each captured screenshot.
   * Only used when the `disabled-by-default-devtools.screenshot` category is
   * enabled. Defaults to 500. The combined memory footprint of screenshots
   * (`screenshotMaxSize` * `screenshotMaxSize` * 4 * `screenshotMaxCount`)
   * is clamped to the existing per-session budget.
   */
  readonly screenshotMaxSize?: number | undefined
  /**
   * Maximum number of screenshots captured during a single tracing session.
   * Only used when the `disabled-by-default-devtools.screenshot` category is
   * enabled. Defaults to 450. Clamped together with `screenshotMaxSize` to
   * stay within the per-session screenshot memory budget.
   */
  readonly screenshotMaxCount?: number | undefined
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
    bufferUsageReportingInterval: Schema.optional(Schema.Number),
    transferMode: Schema.optional(StartParamsTransferMode),
    streamFormat: Schema.optional(StreamFormat),
    streamCompression: Schema.optional(StreamCompression),
    traceConfig: Schema.optional(TraceConfig),
    perfettoConfig: Schema.optional(Schema.String),
    tracingBackend: Schema.optional(TracingBackend),
    screenshotMaxSize: Schema.optional(Schema.Int),
    screenshotMaxCount: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Tracing.StartParams" })
) as any as Schema.Codec<StartParams>

/**
 * Whether to report trace events as series of dataCollected events or to save trace to a
 * stream (defaults to `ReportEvents`).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StartParamsTransferMode =
  | "ReportEvents"
  | "ReturnAsStream"
  | (string & {})

/**
 * Schema for `StartParamsTransferMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartParamsTransferMode = Schema.String as any as Schema.Codec<StartParamsTransferMode>

/**
 * Signals that tracing is stopped and there is no trace buffers pending flush, all data were
 * delivered via dataCollected events.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TracingCompleteParams {
  /**
   * Indicates whether some trace data is known to have been lost, e.g. because the trace ring
   * buffer wrapped around.
   */
  readonly dataLossOccurred: boolean
  /**
   * A handle of the stream that holds resulting trace data.
   */
  readonly stream?: IO.StreamHandle | undefined
  /**
   * Trace data format of returned stream.
   */
  readonly traceFormat?: StreamFormat | undefined
  /**
   * Compression format of returned stream.
   */
  readonly streamCompression?: StreamCompression | undefined
}

/**
 * Schema for `TracingCompleteParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TracingCompleteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataLossOccurred: Schema.Boolean,
    stream: Schema.optional(IO.StreamHandle),
    traceFormat: Schema.optional(StreamFormat),
    streamCompression: Schema.optional(StreamCompression)
  }).annotate({ identifier: "Tracing.TracingCompleteParams" })
) as any as Schema.Codec<TracingCompleteParams>

/**
 * Stop trace events collection.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const end: Protocol.CommandDef<"Tracing.end", void, void> = /*#__PURE__*/ Protocol.command(
  "Tracing.end",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Gets supported tracing categories.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getCategories: Protocol.CommandDef<"Tracing.getCategories", void, GetCategoriesResult> =
  /*#__PURE__*/ Protocol.command(
    "Tracing.getCategories",
    undefined,
    GetCategoriesResult,
    { status: "experimental" }
  )

/**
 * Return a descriptor for all available tracing categories.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getTrackEventDescriptor: Protocol.CommandDef<
  "Tracing.getTrackEventDescriptor",
  void,
  GetTrackEventDescriptorResult
> = /*#__PURE__*/ Protocol.command(
  "Tracing.getTrackEventDescriptor",
  undefined,
  GetTrackEventDescriptorResult,
  { status: "experimental" }
)

/**
 * Record a clock sync marker in the trace.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const recordClockSyncMarker: Protocol.CommandDef<
  "Tracing.recordClockSyncMarker",
  RecordClockSyncMarkerParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Tracing.recordClockSyncMarker",
  RecordClockSyncMarkerParams,
  undefined,
  { status: "experimental" }
)

/**
 * Request a global memory dump.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const requestMemoryDump: Protocol.CommandDef<
  "Tracing.requestMemoryDump",
  RequestMemoryDumpParams,
  RequestMemoryDumpResult
> = /*#__PURE__*/ Protocol.command(
  "Tracing.requestMemoryDump",
  RequestMemoryDumpParams,
  RequestMemoryDumpResult,
  { status: "experimental" }
)

/**
 * Start trace events collection.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const start: Protocol.CommandDef<"Tracing.start", StartParams, void> = /*#__PURE__*/ Protocol.command(
  "Tracing.start",
  StartParams,
  undefined,
  { status: "stable" }
)

/**
 * The `Tracing.bufferUsage` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const bufferUsage: Protocol.EventDef<"Tracing.bufferUsage", BufferUsageParams> = /*#__PURE__*/ Protocol.event(
  "Tracing.bufferUsage",
  BufferUsageParams,
  { status: "experimental" }
)

/**
 * Contains a bucket of collected trace events. When tracing is stopped collected events will be
 * sent as a sequence of dataCollected events followed by tracingComplete event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const dataCollected: Protocol.EventDef<"Tracing.dataCollected", DataCollectedParams> = /*#__PURE__*/ Protocol
  .event(
    "Tracing.dataCollected",
    DataCollectedParams,
    { status: "experimental" }
  )

/**
 * Signals that tracing is stopped and there is no trace buffers pending flush, all data were
 * delivered via dataCollected events.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const tracingComplete: Protocol.EventDef<"Tracing.tracingComplete", TracingCompleteParams> =
  /*#__PURE__*/ Protocol.event(
    "Tracing.tracingComplete",
    TracingCompleteParams,
    { status: "stable" }
  )
