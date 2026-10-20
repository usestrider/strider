/**
 * The Memory domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * DOM object counter data.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DOMCounter {
  /**
   * Object name. Note: object names should be presumed volatile and clients should not expect
   * the returned names to be consistent across runs.
   */
  readonly name: string
  /**
   * Object count.
   */
  readonly count: number
}

/**
 * Schema for `DOMCounter`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DOMCounter = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    count: Schema.Int
  }).annotate({ identifier: "Memory.DOMCounter" })
) as any as Schema.Codec<DOMCounter>

/**
 * Executable module information
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Module {
  /**
   * Name of the module.
   */
  readonly name: string
  /**
   * UUID of the module.
   */
  readonly uuid: string
  /**
   * Base address where the module is loaded into memory. Encoded as a decimal
   * or hexadecimal (0x prefixed) string.
   */
  readonly baseAddress: string
  /**
   * Size of the module in bytes.
   */
  readonly size: number
}

/**
 * Schema for `Module`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Module = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    uuid: Schema.String,
    baseAddress: Schema.String,
    size: Schema.Number
  }).annotate({ identifier: "Memory.Module" })
) as any as Schema.Codec<Module>

/**
 * Memory pressure level.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PressureLevel =
  | "moderate"
  | "critical"
  | (string & {})

/**
 * Schema for `PressureLevel`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PressureLevel = Schema.String as any as Schema.Codec<PressureLevel>

/**
 * Array of heap profile samples.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SamplingProfile {
  readonly samples: ReadonlyArray<SamplingProfileNode>
  readonly modules: ReadonlyArray<Module>
}

/**
 * Schema for `SamplingProfile`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SamplingProfile = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    samples: Schema.Array(SamplingProfileNode),
    modules: Schema.Array(Module)
  }).annotate({ identifier: "Memory.SamplingProfile" })
) as any as Schema.Codec<SamplingProfile>

/**
 * Heap profile sample.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SamplingProfileNode {
  /**
   * Size of the sampled allocation.
   */
  readonly size: number
  /**
   * Total bytes attributed to this sample.
   */
  readonly total: number
  /**
   * Execution stack at the point of allocation.
   */
  readonly stack: ReadonlyArray<string>
}

/**
 * Schema for `SamplingProfileNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SamplingProfileNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    size: Schema.Number,
    total: Schema.Number,
    stack: Schema.Array(Schema.String)
  }).annotate({ identifier: "Memory.SamplingProfileNode" })
) as any as Schema.Codec<SamplingProfileNode>

/**
 * Retrieve native memory allocations profile
 * collected since renderer process startup.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAllTimeSamplingProfileResult {
  readonly profile: SamplingProfile
}

/**
 * Schema for `GetAllTimeSamplingProfileResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAllTimeSamplingProfileResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: SamplingProfile
  }).annotate({ identifier: "Memory.GetAllTimeSamplingProfileResult" })
) as any as Schema.Codec<GetAllTimeSamplingProfileResult>

/**
 * Retrieve native memory allocations profile
 * collected since browser process startup.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetBrowserSamplingProfileResult {
  readonly profile: SamplingProfile
}

/**
 * Schema for `GetBrowserSamplingProfileResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetBrowserSamplingProfileResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: SamplingProfile
  }).annotate({ identifier: "Memory.GetBrowserSamplingProfileResult" })
) as any as Schema.Codec<GetBrowserSamplingProfileResult>

/**
 * Retruns current DOM object counters.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDOMCountersResult {
  readonly documents: number
  readonly nodes: number
  readonly jsEventListeners: number
}

/**
 * Schema for `GetDOMCountersResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDOMCountersResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    documents: Schema.Int,
    nodes: Schema.Int,
    jsEventListeners: Schema.Int
  }).annotate({ identifier: "Memory.GetDOMCountersResult" })
) as any as Schema.Codec<GetDOMCountersResult>

/**
 * Retruns DOM object counters after preparing renderer for leak detection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDOMCountersForLeakDetectionResult {
  /**
   * DOM object counters.
   */
  readonly counters: ReadonlyArray<DOMCounter>
}

/**
 * Schema for `GetDOMCountersForLeakDetectionResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDOMCountersForLeakDetectionResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    counters: Schema.Array(DOMCounter)
  }).annotate({ identifier: "Memory.GetDOMCountersForLeakDetectionResult" })
) as any as Schema.Codec<GetDOMCountersForLeakDetectionResult>

/**
 * Retrieve native memory allocations profile collected since last
 * `startSampling` call.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSamplingProfileResult {
  readonly profile: SamplingProfile
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
    profile: SamplingProfile
  }).annotate({ identifier: "Memory.GetSamplingProfileResult" })
) as any as Schema.Codec<GetSamplingProfileResult>

/**
 * Enable/disable suppressing memory pressure notifications in all processes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPressureNotificationsSuppressedParams {
  /**
   * If true, memory pressure notifications will be suppressed.
   */
  readonly suppressed: boolean
}

/**
 * Schema for `SetPressureNotificationsSuppressedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPressureNotificationsSuppressedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    suppressed: Schema.Boolean
  }).annotate({ identifier: "Memory.SetPressureNotificationsSuppressedParams" })
) as any as Schema.Codec<SetPressureNotificationsSuppressedParams>

/**
 * Simulate a memory pressure notification in all processes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SimulatePressureNotificationParams {
  /**
   * Memory pressure level of the notification.
   */
  readonly level: PressureLevel
}

/**
 * Schema for `SimulatePressureNotificationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SimulatePressureNotificationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    level: PressureLevel
  }).annotate({ identifier: "Memory.SimulatePressureNotificationParams" })
) as any as Schema.Codec<SimulatePressureNotificationParams>

/**
 * Start collecting native memory profile.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartSamplingParams {
  /**
   * Average number of bytes between samples.
   */
  readonly samplingInterval?: number | undefined
  /**
   * Do not randomize intervals between samples.
   */
  readonly suppressRandomness?: boolean | undefined
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
    samplingInterval: Schema.optional(Schema.Int),
    suppressRandomness: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Memory.StartSamplingParams" })
) as any as Schema.Codec<StartSamplingParams>

/**
 * Simulate OomIntervention by purging V8 memory.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const forciblyPurgeJavaScriptMemory: Protocol.CommandDef<"Memory.forciblyPurgeJavaScriptMemory", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Memory.forciblyPurgeJavaScriptMemory",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Retrieve native memory allocations profile
 * collected since renderer process startup.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAllTimeSamplingProfile: Protocol.CommandDef<
  "Memory.getAllTimeSamplingProfile",
  void,
  GetAllTimeSamplingProfileResult
> = /*#__PURE__*/ Protocol.command(
  "Memory.getAllTimeSamplingProfile",
  undefined,
  GetAllTimeSamplingProfileResult,
  { status: "stable" }
)

/**
 * Retrieve native memory allocations profile
 * collected since browser process startup.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getBrowserSamplingProfile: Protocol.CommandDef<
  "Memory.getBrowserSamplingProfile",
  void,
  GetBrowserSamplingProfileResult
> = /*#__PURE__*/ Protocol.command(
  "Memory.getBrowserSamplingProfile",
  undefined,
  GetBrowserSamplingProfileResult,
  { status: "stable" }
)

/**
 * Retruns current DOM object counters.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getDOMCounters: Protocol.CommandDef<"Memory.getDOMCounters", void, GetDOMCountersResult> =
  /*#__PURE__*/ Protocol.command(
    "Memory.getDOMCounters",
    undefined,
    GetDOMCountersResult,
    { status: "stable" }
  )

/**
 * Retruns DOM object counters after preparing renderer for leak detection.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getDOMCountersForLeakDetection: Protocol.CommandDef<
  "Memory.getDOMCountersForLeakDetection",
  void,
  GetDOMCountersForLeakDetectionResult
> = /*#__PURE__*/ Protocol.command(
  "Memory.getDOMCountersForLeakDetection",
  undefined,
  GetDOMCountersForLeakDetectionResult,
  { status: "stable" }
)

/**
 * Retrieve native memory allocations profile collected since last
 * `startSampling` call.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getSamplingProfile: Protocol.CommandDef<"Memory.getSamplingProfile", void, GetSamplingProfileResult> =
  /*#__PURE__*/ Protocol.command(
    "Memory.getSamplingProfile",
    undefined,
    GetSamplingProfileResult,
    { status: "stable" }
  )

/**
 * Prepares for leak detection by terminating workers, stopping spellcheckers,
 * dropping non-essential internal caches, running garbage collections, etc.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const prepareForLeakDetection: Protocol.CommandDef<"Memory.prepareForLeakDetection", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Memory.prepareForLeakDetection",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Enable/disable suppressing memory pressure notifications in all processes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPressureNotificationsSuppressed: Protocol.CommandDef<
  "Memory.setPressureNotificationsSuppressed",
  SetPressureNotificationsSuppressedParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Memory.setPressureNotificationsSuppressed",
  SetPressureNotificationsSuppressedParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulate a memory pressure notification in all processes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const simulatePressureNotification: Protocol.CommandDef<
  "Memory.simulatePressureNotification",
  SimulatePressureNotificationParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Memory.simulatePressureNotification",
  SimulatePressureNotificationParams,
  undefined,
  { status: "stable" }
)

/**
 * Start collecting native memory profile.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startSampling: Protocol.CommandDef<"Memory.startSampling", StartSamplingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Memory.startSampling",
    StartSamplingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Stop collecting native memory profile.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopSampling: Protocol.CommandDef<"Memory.stopSampling", void, void> = /*#__PURE__*/ Protocol.command(
  "Memory.stopSampling",
  undefined,
  undefined,
  { status: "stable" }
)
