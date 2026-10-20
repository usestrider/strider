/**
 * The Profiler domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Coverage data for a source range.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CoverageRange {
  /**
   * JavaScript script source offset for the range start.
   */
  readonly startOffset: number
  /**
   * JavaScript script source offset for the range end.
   */
  readonly endOffset: number
  /**
   * Collected execution count of the source range.
   */
  readonly count: number
}

/**
 * Schema for `CoverageRange`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CoverageRange = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startOffset: Schema.Int,
    endOffset: Schema.Int,
    count: Schema.Int
  }).annotate({ identifier: "Profiler.CoverageRange" })
) as any as Schema.Codec<CoverageRange>

/**
 * Coverage data for a JavaScript function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FunctionCoverage {
  /**
   * JavaScript function name.
   */
  readonly functionName: string
  /**
   * Source ranges inside the function with coverage data.
   */
  readonly ranges: ReadonlyArray<CoverageRange>
  /**
   * Whether coverage data for this function has block granularity.
   */
  readonly isBlockCoverage: boolean
}

/**
 * Schema for `FunctionCoverage`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FunctionCoverage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    functionName: Schema.String,
    ranges: Schema.Array(CoverageRange),
    isBlockCoverage: Schema.Boolean
  }).annotate({ identifier: "Profiler.FunctionCoverage" })
) as any as Schema.Codec<FunctionCoverage>

/**
 * Specifies a number of samples attributed to a certain source position.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PositionTickInfo {
  /**
   * Source line number (1-based).
   */
  readonly line: number
  /**
   * Number of samples attributed to the source line.
   */
  readonly ticks: number
}

/**
 * Schema for `PositionTickInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PositionTickInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    line: Schema.Int,
    ticks: Schema.Int
  }).annotate({ identifier: "Profiler.PositionTickInfo" })
) as any as Schema.Codec<PositionTickInfo>

/**
 * Profile.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Profile {
  /**
   * The list of profile nodes. First item is the root node.
   */
  readonly nodes: ReadonlyArray<ProfileNode>
  /**
   * Profiling start timestamp in microseconds.
   */
  readonly startTime: number
  /**
   * Profiling end timestamp in microseconds.
   */
  readonly endTime: number
  /**
   * Ids of samples top nodes.
   */
  readonly samples?: ReadonlyArray<number> | undefined
  /**
   * Time intervals between adjacent samples in microseconds. The first delta is relative to the
   * profile startTime.
   */
  readonly timeDeltas?: ReadonlyArray<number> | undefined
}

/**
 * Schema for `Profile`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Profile = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(ProfileNode),
    startTime: Schema.Number,
    endTime: Schema.Number,
    samples: Schema.optional(Schema.Array(Schema.Int)),
    timeDeltas: Schema.optional(Schema.Array(Schema.Int))
  }).annotate({ identifier: "Profiler.Profile" })
) as any as Schema.Codec<Profile>

/**
 * Profile node. Holds callsite information, execution statistics and child nodes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProfileNode {
  /**
   * Unique id of the node.
   */
  readonly id: number
  /**
   * Function location.
   */
  readonly callFrame: Runtime.CallFrame
  /**
   * Number of samples where this node was on top of the call stack.
   */
  readonly hitCount?: number | undefined
  /**
   * Child node ids.
   */
  readonly children?: ReadonlyArray<number> | undefined
  /**
   * The reason of being not optimized. The function may be deoptimized or marked as don't
   * optimize.
   */
  readonly deoptReason?: string | undefined
  /**
   * An array of source position ticks.
   */
  readonly positionTicks?: ReadonlyArray<PositionTickInfo> | undefined
}

/**
 * Schema for `ProfileNode`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProfileNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.Int,
    callFrame: Runtime.CallFrame,
    hitCount: Schema.optional(Schema.Int),
    children: Schema.optional(Schema.Array(Schema.Int)),
    deoptReason: Schema.optional(Schema.String),
    positionTicks: Schema.optional(Schema.Array(PositionTickInfo))
  }).annotate({ identifier: "Profiler.ProfileNode" })
) as any as Schema.Codec<ProfileNode>

/**
 * Coverage data for a JavaScript script.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScriptCoverage {
  /**
   * JavaScript script id.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * JavaScript script name or url.
   */
  readonly url: string
  /**
   * Functions contained in the script that has coverage data.
   */
  readonly functions: ReadonlyArray<FunctionCoverage>
}

/**
 * Schema for `ScriptCoverage`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptCoverage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId,
    url: Schema.String,
    functions: Schema.Array(FunctionCoverage)
  }).annotate({ identifier: "Profiler.ScriptCoverage" })
) as any as Schema.Codec<ScriptCoverage>

/**
 * `consoleProfileFinished.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ConsoleProfileFinishedParams {
  readonly id: string
  /**
   * Location of console.profileEnd().
   */
  readonly location: Debugger.Location
  readonly profile: Profile
  /**
   * Profile title passed as an argument to console.profile().
   */
  readonly title?: string | undefined
}

/**
 * Schema for `ConsoleProfileFinishedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleProfileFinishedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    location: Debugger.Location,
    profile: Profile,
    title: Schema.optional(Schema.String)
  }).annotate({ identifier: "Profiler.ConsoleProfileFinishedParams" })
) as any as Schema.Codec<ConsoleProfileFinishedParams>

/**
 * Sent when new profile recording is started using console.profile() call.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ConsoleProfileStartedParams {
  readonly id: string
  /**
   * Location of console.profile().
   */
  readonly location: Debugger.Location
  /**
   * Profile title passed as an argument to console.profile().
   */
  readonly title?: string | undefined
}

/**
 * Schema for `ConsoleProfileStartedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleProfileStartedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    location: Debugger.Location,
    title: Schema.optional(Schema.String)
  }).annotate({ identifier: "Profiler.ConsoleProfileStartedParams" })
) as any as Schema.Codec<ConsoleProfileStartedParams>

/**
 * Collect coverage data for the current isolate. The coverage data may be incomplete due to
 * garbage collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBestEffortCoverageResult {
  /**
   * Coverage data for the current isolate.
   */
  readonly result: ReadonlyArray<ScriptCoverage>
}

/**
 * Schema for `GetBestEffortCoverageResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBestEffortCoverageResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(ScriptCoverage)
  }).annotate({ identifier: "Profiler.GetBestEffortCoverageResult" })
) as any as Schema.Codec<GetBestEffortCoverageResult>

/**
 * Reports coverage delta since the last poll (either from an event like this, or from
 * `takePreciseCoverage` for the current isolate. May only be sent if precise code
 * coverage has been started. This event can be trigged by the embedder to, for example,
 * trigger collection of coverage data immediately at a certain point in time.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PreciseCoverageDeltaUpdateParams {
  /**
   * Monotonically increasing time (in seconds) when the coverage update was taken in the backend.
   */
  readonly timestamp: number
  /**
   * Identifier for distinguishing coverage events.
   */
  readonly occasion: string
  /**
   * Coverage data for the current isolate.
   */
  readonly result: ReadonlyArray<ScriptCoverage>
}

/**
 * Schema for `PreciseCoverageDeltaUpdateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreciseCoverageDeltaUpdateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    occasion: Schema.String,
    result: Schema.Array(ScriptCoverage)
  }).annotate({ identifier: "Profiler.PreciseCoverageDeltaUpdateParams" })
) as any as Schema.Codec<PreciseCoverageDeltaUpdateParams>

/**
 * Changes CPU profiler sampling interval. Must be called before CPU profiles recording started.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetSamplingIntervalParams {
  /**
   * New sampling interval in microseconds.
   */
  readonly interval: number
}

/**
 * Schema for `SetSamplingIntervalParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetSamplingIntervalParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    interval: Schema.Int
  }).annotate({ identifier: "Profiler.SetSamplingIntervalParams" })
) as any as Schema.Codec<SetSamplingIntervalParams>

/**
 * Enable precise code coverage. Coverage data for JavaScript executed before enabling precise code
 * coverage may be incomplete. Enabling prevents running optimized code and resets execution
 * counters.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartPreciseCoverageParams {
  /**
   * Collect accurate call counts beyond simple 'covered' or 'not covered'.
   */
  readonly callCount?: boolean | undefined
  /**
   * Collect block-based coverage.
   */
  readonly detailed?: boolean | undefined
  /**
   * Allow the backend to send updates on its own initiative
   */
  readonly allowTriggeredUpdates?: boolean | undefined
}

/**
 * Schema for `StartPreciseCoverageParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartPreciseCoverageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    callCount: Schema.optional(Schema.Boolean),
    detailed: Schema.optional(Schema.Boolean),
    allowTriggeredUpdates: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Profiler.StartPreciseCoverageParams" })
) as any as Schema.Codec<StartPreciseCoverageParams>

/**
 * Enable precise code coverage. Coverage data for JavaScript executed before enabling precise code
 * coverage may be incomplete. Enabling prevents running optimized code and resets execution
 * counters.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartPreciseCoverageResult {
  /**
   * Monotonically increasing time (in seconds) when the coverage update was taken in the backend.
   */
  readonly timestamp: number
}

/**
 * Schema for `StartPreciseCoverageResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartPreciseCoverageResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number
  }).annotate({ identifier: "Profiler.StartPreciseCoverageResult" })
) as any as Schema.Codec<StartPreciseCoverageResult>

/**
 * `stop.Result`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StopResult {
  /**
   * Recorded profile.
   */
  readonly profile: Profile
}

/**
 * Schema for `StopResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StopResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: Profile
  }).annotate({ identifier: "Profiler.StopResult" })
) as any as Schema.Codec<StopResult>

/**
 * Collect coverage data for the current isolate, and resets execution counters. Precise code
 * coverage needs to have started.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakePreciseCoverageResult {
  /**
   * Coverage data for the current isolate.
   */
  readonly result: ReadonlyArray<ScriptCoverage>
  /**
   * Monotonically increasing time (in seconds) when the coverage update was taken in the backend.
   */
  readonly timestamp: number
}

/**
 * Schema for `TakePreciseCoverageResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakePreciseCoverageResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(ScriptCoverage),
    timestamp: Schema.Number
  }).annotate({ identifier: "Profiler.TakePreciseCoverageResult" })
) as any as Schema.Codec<TakePreciseCoverageResult>

/**
 * Sends `Profiler.disable`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Profiler.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Profiler.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `Profiler.enable`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Profiler.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Profiler.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Collect coverage data for the current isolate. The coverage data may be incomplete due to
 * garbage collection.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBestEffortCoverage: Protocol.CommandDef<
  "Profiler.getBestEffortCoverage",
  void,
  GetBestEffortCoverageResult
> = /*#__PURE__*/ Protocol.command(
  "Profiler.getBestEffortCoverage",
  undefined,
  GetBestEffortCoverageResult,
  { status: "stable" }
)

/**
 * Changes CPU profiler sampling interval. Must be called before CPU profiles recording started.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setSamplingInterval: Protocol.CommandDef<"Profiler.setSamplingInterval", SetSamplingIntervalParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Profiler.setSamplingInterval",
    SetSamplingIntervalParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `Profiler.start`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const start: Protocol.CommandDef<"Profiler.start", void, void> = /*#__PURE__*/ Protocol.command(
  "Profiler.start",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable precise code coverage. Coverage data for JavaScript executed before enabling precise code
 * coverage may be incomplete. Enabling prevents running optimized code and resets execution
 * counters.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startPreciseCoverage: Protocol.CommandDef<
  "Profiler.startPreciseCoverage",
  StartPreciseCoverageParams,
  StartPreciseCoverageResult
> = /*#__PURE__*/ Protocol.command(
  "Profiler.startPreciseCoverage",
  StartPreciseCoverageParams,
  StartPreciseCoverageResult,
  { status: "stable" }
)

/**
 * Sends `Profiler.stop`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stop: Protocol.CommandDef<"Profiler.stop", void, StopResult> = /*#__PURE__*/ Protocol.command(
  "Profiler.stop",
  undefined,
  StopResult,
  { status: "stable" }
)

/**
 * Disable precise code coverage. Disabling releases unnecessary execution count records and allows
 * executing optimized code.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopPreciseCoverage: Protocol.CommandDef<"Profiler.stopPreciseCoverage", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Profiler.stopPreciseCoverage",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Collect coverage data for the current isolate, and resets execution counters. Precise code
 * coverage needs to have started.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const takePreciseCoverage: Protocol.CommandDef<"Profiler.takePreciseCoverage", void, TakePreciseCoverageResult> =
  /*#__PURE__*/ Protocol.command(
    "Profiler.takePreciseCoverage",
    undefined,
    TakePreciseCoverageResult,
    { status: "stable" }
  )

/**
 * The `Profiler.consoleProfileFinished` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const consoleProfileFinished: Protocol.EventDef<
  "Profiler.consoleProfileFinished",
  ConsoleProfileFinishedParams
> = /*#__PURE__*/ Protocol.event(
  "Profiler.consoleProfileFinished",
  ConsoleProfileFinishedParams,
  { status: "stable" }
)

/**
 * Sent when new profile recording is started using console.profile() call.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const consoleProfileStarted: Protocol.EventDef<"Profiler.consoleProfileStarted", ConsoleProfileStartedParams> =
  /*#__PURE__*/ Protocol.event(
    "Profiler.consoleProfileStarted",
    ConsoleProfileStartedParams,
    { status: "stable" }
  )

/**
 * Reports coverage delta since the last poll (either from an event like this, or from
 * `takePreciseCoverage` for the current isolate. May only be sent if precise code
 * coverage has been started. This event can be trigged by the embedder to, for example,
 * trigger collection of coverage data immediately at a certain point in time.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const preciseCoverageDeltaUpdate: Protocol.EventDef<
  "Profiler.preciseCoverageDeltaUpdate",
  PreciseCoverageDeltaUpdateParams
> = /*#__PURE__*/ Protocol.event(
  "Profiler.preciseCoverageDeltaUpdate",
  PreciseCoverageDeltaUpdateParams,
  { status: "experimental" }
)
