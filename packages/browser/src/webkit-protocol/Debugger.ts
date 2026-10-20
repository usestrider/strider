/**
 * Debugger domain exposes JavaScript debugging capabilities. It allows setting and removing breakpoints, stepping through execution, exploring stack traces, etc.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Console from "./Console.ts"
import * as GenericTypes from "./GenericTypes.ts"
import * as Network from "./Network.ts"
import * as Runtime from "./Runtime.ts"

/**
 * The pause reason auxiliary data when paused because of an assertion.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AssertPauseReason {
  /**
   * The console.assert message string if provided.
   */
  readonly message?: string | undefined
}

/**
 * Schema for `AssertPauseReason`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AssertPauseReason = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.optional(Schema.String)
  }).annotate({ identifier: "Debugger.AssertPauseReason" })
) as any as Schema.Codec<AssertPauseReason>

/**
 * Action to perform when a breakpoint is triggered.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BreakpointAction {
  /**
   * Different kinds of breakpoint actions.
   */
  readonly type: BreakpointActionType
  /**
   * Data associated with this breakpoint type (e.g. for type "eval" this is the JavaScript string to evaluate).
   */
  readonly data?: string | undefined
  /**
   * A frontend-assigned identifier for this breakpoint action.
   */
  readonly id?: BreakpointActionIdentifier | undefined
  /**
   * Indicates whether this action should be executed with a user gesture or not. Defaults to <code>false<code>.
   */
  readonly emulateUserGesture?: boolean | undefined
}

/**
 * Schema for `BreakpointAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: BreakpointActionType,
    data: Schema.optional(Schema.String),
    id: Schema.optional(BreakpointActionIdentifier),
    emulateUserGesture: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.BreakpointAction" })
) as any as Schema.Codec<BreakpointAction>

/**
 * Different kinds of breakpoint actions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BreakpointActionType =
  | "log"
  | "evaluate"
  | "sound"
  | "probe"
  | (string & {})

/**
 * Schema for `BreakpointActionType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointActionType = Schema.String as any as Schema.Codec<BreakpointActionType>

/**
 * Breakpoint action identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BreakpointActionIdentifier = Brand.Branded<
  number,
  "~@usestrider/browser/webkit-protocol/Debugger/BreakpointActionIdentifier"
>

/**
 * Schema for `BreakpointActionIdentifier`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointActionIdentifier = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Debugger/BreakpointActionIdentifier")
) as any as Schema.Codec<BreakpointActionIdentifier>

/**
 * Breakpoint identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BreakpointId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Debugger/BreakpointId">

/**
 * Schema for `BreakpointId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Debugger/BreakpointId")
) as any as Schema.Codec<BreakpointId>

/**
 * Extra options that modify breakpoint behavior.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BreakpointOptions {
  /**
   * Expression to use as a breakpoint condition. When specified, debugger will only stop on the breakpoint if this expression evaluates to true.
   */
  readonly condition?: string | undefined
  /**
   * Actions to perform automatically when the breakpoint is triggered.
   */
  readonly actions?: ReadonlyArray<BreakpointAction> | undefined
  /**
   * Automatically continue after hitting this breakpoint and running actions.
   */
  readonly autoContinue?: boolean | undefined
  /**
   * Number of times to ignore this breakpoint, before stopping on the breakpoint and running actions.
   */
  readonly ignoreCount?: number | undefined
}

/**
 * Schema for `BreakpointOptions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointOptions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    condition: Schema.optional(Schema.String),
    actions: Schema.optional(Schema.Array(BreakpointAction)),
    autoContinue: Schema.optional(Schema.Boolean),
    ignoreCount: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Debugger.BreakpointOptions" })
) as any as Schema.Codec<BreakpointOptions>

/**
 * The pause reason auxiliary data when paused because of hitting a breakpoint.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BreakpointPauseReason {
  /**
   * The identifier of the breakpoint causing the pause.
   */
  readonly breakpointId: string
}

/**
 * Schema for `BreakpointPauseReason`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointPauseReason = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: Schema.String
  }).annotate({ identifier: "Debugger.BreakpointPauseReason" })
) as any as Schema.Codec<BreakpointPauseReason>

/**
 * The pause reason auxiliary data when paused because of a Content Security Policy directive.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSPViolationPauseReason {
  /**
   * The CSP directive that blocked script execution.
   */
  readonly directive: string
}

/**
 * Schema for `CSPViolationPauseReason`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSPViolationPauseReason = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    directive: Schema.String
  }).annotate({ identifier: "Debugger.CSPViolationPauseReason" })
) as any as Schema.Codec<CSPViolationPauseReason>

/**
 * JavaScript call frame. Array of call frames form the call stack.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallFrame {
  /**
   * Call frame identifier. This identifier is only valid while the virtual machine is paused.
   */
  readonly callFrameId: CallFrameId
  /**
   * Name of the JavaScript function called on this call frame.
   */
  readonly functionName: string
  /**
   * Location in the source code.
   */
  readonly location: Location
  /**
   * Scope chain for this call frame.
   */
  readonly scopeChain: ReadonlyArray<Scope>
  /**
   * <code>this</code> object for this call frame.
   */
  readonly this: Runtime.RemoteObject
  /**
   * Is the current frame tail deleted from a tail call.
   */
  readonly isTailDeleted: boolean
}

/**
 * Schema for `CallFrame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFrame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    callFrameId: CallFrameId,
    functionName: Schema.String,
    location: Location,
    scopeChain: Schema.Array(Scope),
    this: Runtime.RemoteObject,
    isTailDeleted: Schema.Boolean
  }).annotate({ identifier: "Debugger.CallFrame" })
) as any as Schema.Codec<CallFrame>

/**
 * Call frame identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CallFrameId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Debugger/CallFrameId">

/**
 * Schema for `CallFrameId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFrameId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Debugger/CallFrameId")
) as any as Schema.Codec<CallFrameId>

/**
 * Information about the function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FunctionDetails {
  /**
   * Location of the function.
   */
  readonly location: Location
  /**
   * Name of the function. Not present for anonymous functions.
   */
  readonly name?: string | undefined
  /**
   * Display name of the function(specified in 'displayName' property on the function object).
   */
  readonly displayName?: string | undefined
  /**
   * Scope chain for this closure.
   */
  readonly scopeChain?: ReadonlyArray<Scope> | undefined
}

/**
 * Schema for `FunctionDetails`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FunctionDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    location: Location,
    name: Schema.optional(Schema.String),
    displayName: Schema.optional(Schema.String),
    scopeChain: Schema.optional(Schema.Array(Scope))
  }).annotate({ identifier: "Debugger.FunctionDetails" })
) as any as Schema.Codec<FunctionDetails>

/**
 * Location in the source code.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Location {
  /**
   * Script identifier as reported in the <code>Debugger.scriptParsed</code>.
   */
  readonly scriptId: ScriptId
  /**
   * Line number in the script (0-based).
   */
  readonly lineNumber: number
  /**
   * Column number in the script (0-based) or bytecode offset for WebAssembly modules (0-based).
   */
  readonly columnNumber?: number | undefined
}

/**
 * Schema for `Location`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Location = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: ScriptId,
    lineNumber: Schema.Int,
    columnNumber: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Debugger.Location" })
) as any as Schema.Codec<Location>

/**
 * A sample collected by evaluating a probe breakpoint action.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProbeSample {
  /**
   * Identifier of the probe breakpoint action that created the sample.
   */
  readonly probeId: BreakpointActionIdentifier
  /**
   * Unique identifier for this sample.
   */
  readonly sampleId: number
  /**
   * A batch identifier which is the same for all samples taken at the same breakpoint hit.
   */
  readonly batchId: number
  /**
   * Timestamp of when the sample was taken.
   */
  readonly timestamp: number
  /**
   * Contents of the sample.
   */
  readonly payload: Runtime.RemoteObject
}

/**
 * Schema for `ProbeSample`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProbeSample = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    probeId: BreakpointActionIdentifier,
    sampleId: Schema.Int,
    batchId: Schema.Int,
    timestamp: Schema.Number,
    payload: Runtime.RemoteObject
  }).annotate({ identifier: "Debugger.ProbeSample" })
) as any as Schema.Codec<ProbeSample>

/**
 * Scope description.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Scope {
  /**
   * Object representing the scope. For <code>global</code> and <code>with</code> scopes it represents the actual object; for the rest of the scopes, it is artificial transient object enumerating scope variables as its properties.
   */
  readonly object: Runtime.RemoteObject
  /**
   * Scope type.
   */
  readonly type: ScopeType
  /**
   * Name associated with the scope.
   */
  readonly name?: string | undefined
  /**
   * Location if available of the scope definition.
   */
  readonly location?: Location | undefined
  /**
   * Whether the scope has any variables.
   */
  readonly empty?: boolean | undefined
}

/**
 * Schema for `Scope`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Scope = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: Runtime.RemoteObject,
    type: ScopeType,
    name: Schema.optional(Schema.String),
    location: Schema.optional(Location),
    empty: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.Scope" })
) as any as Schema.Codec<Scope>

/**
 * Scope type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScopeType =
  | "global"
  | "with"
  | "closure"
  | "catch"
  | "functionName"
  | "globalLexicalEnvironment"
  | "nestedLexical"
  | (string & {})

/**
 * Schema for `ScopeType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScopeType = Schema.String as any as Schema.Codec<ScopeType>

/**
 * Unique script identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScriptId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Debugger/ScriptId">

/**
 * Schema for `ScriptId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Debugger/ScriptId")
) as any as Schema.Codec<ScriptId>

/**
 * `ScriptType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScriptType =
  | "program"
  | "module"
  | "webassembly"
  | (string & {})

/**
 * Schema for `ScriptType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptType = Schema.String as any as Schema.Codec<ScriptType>

/**
 * Adds a JavaScript breakpoint that pauses execution whenever a function with the given name is about to be called.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddSymbolicBreakpointParams {
  /**
   * The name of the function to pause in when called.
   */
  readonly symbol: string
  /**
   * If true, symbol is case sensitive. Defaults to true.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats symbol as a regex. Defaults to false.
   */
  readonly isRegex?: boolean | undefined
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `AddSymbolicBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddSymbolicBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    symbol: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean),
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.AddSymbolicBreakpointParams" })
) as any as Schema.Codec<AddSymbolicBreakpointParams>

/**
 * Fired when breakpoint is resolved to an actual script and location.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BreakpointResolvedParams {
  /**
   * Breakpoint unique identifier.
   */
  readonly breakpointId: BreakpointId
  /**
   * Actual breakpoint location.
   */
  readonly location: Location
}

/**
 * Schema for `BreakpointResolvedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointResolvedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId,
    location: Location
  }).annotate({ identifier: "Debugger.BreakpointResolvedParams" })
) as any as Schema.Codec<BreakpointResolvedParams>

/**
 * Continues execution until specific location is reached. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueToLocationParams {
  /**
   * Location to continue to.
   */
  readonly location: Location
}

/**
 * Schema for `ContinueToLocationParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueToLocationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    location: Location
  }).annotate({ identifier: "Debugger.ContinueToLocationParams" })
) as any as Schema.Codec<ContinueToLocationParams>

/**
 * Fires when a new probe sample is collected.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DidSampleProbeParams {
  /**
   * A collected probe sample.
   */
  readonly sample: ProbeSample
}

/**
 * Schema for `DidSampleProbeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DidSampleProbeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sample: ProbeSample
  }).annotate({ identifier: "Debugger.DidSampleProbeParams" })
) as any as Schema.Codec<DidSampleProbeParams>

/**
 * Evaluates expression on a given call frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateOnCallFrameParams {
  /**
   * Call frame identifier to evaluate on.
   */
  readonly callFrameId: CallFrameId
  /**
   * Expression to evaluate.
   */
  readonly expression: string
  /**
   * String object group name to put result into (allows rapid releasing resulting object handles using <code>releaseObjectGroup</code>).
   */
  readonly objectGroup?: string | undefined
  /**
   * Specifies whether command line API should be available to the evaluated expression, defaults to false.
   */
  readonly includeCommandLineAPI?: boolean | undefined
  /**
   * Specifies whether evaluation should stop on exceptions and mute console. Overrides setPauseOnException state.
   */
  readonly doNotPauseOnExceptionsAndMuteConsole?: boolean | undefined
  /**
   * Whether the result is expected to be a JSON object that should be sent by value.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * Whether the resulting value should be considered for saving in the $n history.
   */
  readonly saveResult?: boolean | undefined
  /**
   * Whether the expression should be considered to be in a user gesture or not.
   */
  readonly emulateUserGesture?: boolean | undefined
}

/**
 * Schema for `EvaluateOnCallFrameParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateOnCallFrameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    callFrameId: CallFrameId,
    expression: Schema.String,
    objectGroup: Schema.optional(Schema.String),
    includeCommandLineAPI: Schema.optional(Schema.Boolean),
    doNotPauseOnExceptionsAndMuteConsole: Schema.optional(Schema.Boolean),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    saveResult: Schema.optional(Schema.Boolean),
    emulateUserGesture: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.EvaluateOnCallFrameParams" })
) as any as Schema.Codec<EvaluateOnCallFrameParams>

/**
 * Evaluates expression on a given call frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateOnCallFrameResult {
  /**
   * Object wrapper for the evaluation result.
   */
  readonly result: Runtime.RemoteObject
  /**
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
  /**
   * If the result was saved, this is the $n index that can be used to access the value.
   */
  readonly savedResultIndex?: number | undefined
}

/**
 * Schema for `EvaluateOnCallFrameResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateOnCallFrameResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Runtime.RemoteObject,
    wasThrown: Schema.optional(Schema.Boolean),
    savedResultIndex: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Debugger.EvaluateOnCallFrameResult" })
) as any as Schema.Codec<EvaluateOnCallFrameResult>

/**
 * Returns a list of valid breakpoint locations within the given location range.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBreakpointLocationsParams {
  /**
   * Starting location to look for breakpoint locations after (inclusive). Must have same scriptId as end.
   */
  readonly start: Location
  /**
   * Ending location to look for breakpoint locations before (exclusive). Must have same scriptId as start.
   */
  readonly end: Location
}

/**
 * Schema for `GetBreakpointLocationsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBreakpointLocationsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    start: Location,
    end: Location
  }).annotate({ identifier: "Debugger.GetBreakpointLocationsParams" })
) as any as Schema.Codec<GetBreakpointLocationsParams>

/**
 * Returns a list of valid breakpoint locations within the given location range.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBreakpointLocationsResult {
  /**
   * List of resolved breakpoint locations.
   */
  readonly locations: ReadonlyArray<Location>
}

/**
 * Schema for `GetBreakpointLocationsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBreakpointLocationsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locations: Schema.Array(Location)
  }).annotate({ identifier: "Debugger.GetBreakpointLocationsResult" })
) as any as Schema.Codec<GetBreakpointLocationsResult>

/**
 * Returns detailed information on given function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetFunctionDetailsParams {
  /**
   * Id of the function to get location for.
   */
  readonly functionId: Runtime.RemoteObjectId
}

/**
 * Schema for `GetFunctionDetailsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetFunctionDetailsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    functionId: Runtime.RemoteObjectId
  }).annotate({ identifier: "Debugger.GetFunctionDetailsParams" })
) as any as Schema.Codec<GetFunctionDetailsParams>

/**
 * Returns detailed information on given function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetFunctionDetailsResult {
  /**
   * Information about the function.
   */
  readonly details: FunctionDetails
}

/**
 * Schema for `GetFunctionDetailsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetFunctionDetailsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    details: FunctionDetails
  }).annotate({ identifier: "Debugger.GetFunctionDetailsResult" })
) as any as Schema.Codec<GetFunctionDetailsResult>

/**
 * Returns source for the script with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetScriptSourceParams {
  /**
   * Id of the script to get source for.
   */
  readonly scriptId: ScriptId
}

/**
 * Schema for `GetScriptSourceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetScriptSourceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: ScriptId
  }).annotate({ identifier: "Debugger.GetScriptSourceParams" })
) as any as Schema.Codec<GetScriptSourceParams>

/**
 * Returns source for the script with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetScriptSourceResult {
  /**
   * Script source.
   */
  readonly scriptSource: string
}

/**
 * Schema for `GetScriptSourceResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetScriptSourceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptSource: Schema.String
  }).annotate({ identifier: "Debugger.GetScriptSourceResult" })
) as any as Schema.Codec<GetScriptSourceResult>

/**
 * Fired when the virtual machine stopped on breakpoint or exception or any other stop criteria.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PausedParams {
  /**
   * Call stack the virtual machine stopped on.
   */
  readonly callFrames: ReadonlyArray<CallFrame>
  /**
   * Pause reason.
   */
  readonly reason: PausedParamsReason
  /**
   * Object containing break-specific auxiliary properties.
   */
  readonly data?: { readonly [key: string]: unknown } | undefined
  /**
   * Linked list of asynchronous StackTraces.
   */
  readonly asyncStackTrace?: Console.StackTrace | undefined
}

/**
 * Schema for `PausedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PausedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    callFrames: Schema.Array(CallFrame),
    reason: PausedParamsReason,
    data: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    asyncStackTrace: Schema.optional(Console.StackTrace)
  }).annotate({ identifier: "Debugger.PausedParams" })
) as any as Schema.Codec<PausedParams>

/**
 * Pause reason.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PausedParamsReason =
  | "URL"
  | "DOM"
  | "AnimationFrame"
  | "Interval"
  | "Listener"
  | "Timeout"
  | "exception"
  | "assert"
  | "CSPViolation"
  | "DebuggerStatement"
  | "Breakpoint"
  | "PauseOnNextStatement"
  | "Microtask"
  | "FunctionCall"
  | "BlackboxedScript"
  | "other"
  | (string & {})

/**
 * Schema for `PausedParamsReason`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PausedParamsReason = Schema.String as any as Schema.Codec<PausedParamsReason>

/**
 * Fired when a "sound" breakpoint action is triggered on a breakpoint.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PlayBreakpointActionSoundParams {
  /**
   * Breakpoint action identifier.
   */
  readonly breakpointActionId: BreakpointActionIdentifier
}

/**
 * Schema for `PlayBreakpointActionSoundParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PlayBreakpointActionSoundParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointActionId: BreakpointActionIdentifier
  }).annotate({ identifier: "Debugger.PlayBreakpointActionSoundParams" })
) as any as Schema.Codec<PlayBreakpointActionSoundParams>

/**
 * Removes JavaScript breakpoint.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveBreakpointParams {
  readonly breakpointId: BreakpointId
}

/**
 * Schema for `RemoveBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId
  }).annotate({ identifier: "Debugger.RemoveBreakpointParams" })
) as any as Schema.Codec<RemoveBreakpointParams>

/**
 * Removes a previously added symbolic breakpoint.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveSymbolicBreakpointParams {
  /**
   * The name of the function to pause in when called.
   */
  readonly symbol: string
  /**
   * If true, symbol is case sensitive. Defaults to true.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats symbol as a regex. Defaults to false.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `RemoveSymbolicBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveSymbolicBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    symbol: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.RemoveSymbolicBreakpointParams" })
) as any as Schema.Codec<RemoveSymbolicBreakpointParams>

/**
 * Fired when virtual machine fails to parse the script.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScriptFailedToParseParams {
  /**
   * URL of the script that failed to parse.
   */
  readonly url: string
  /**
   * Source text of the script that failed to parse.
   */
  readonly scriptSource: string
  /**
   * Line offset of the script within the resource.
   */
  readonly startLine: number
  /**
   * Line with error.
   */
  readonly errorLine: number
  /**
   * Parse error message.
   */
  readonly errorMessage: string
}

/**
 * Schema for `ScriptFailedToParseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptFailedToParseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    scriptSource: Schema.String,
    startLine: Schema.Int,
    errorLine: Schema.Int,
    errorMessage: Schema.String
  }).annotate({ identifier: "Debugger.ScriptFailedToParseParams" })
) as any as Schema.Codec<ScriptFailedToParseParams>

/**
 * Fired when virtual machine parses script. This event is also fired for all known and uncollected scripts upon enabling debugger.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScriptParsedParams {
  /**
   * Identifier of the script parsed.
   */
  readonly scriptId: ScriptId
  /**
   * URL of the script parsed (if any).
   */
  readonly url: string
  /**
   * Line offset of the script within the resource with given URL (for script tags).
   */
  readonly startLine: number
  /**
   * Column offset of the script within the resource with given URL.
   */
  readonly startColumn: number
  /**
   * Last line of the script.
   */
  readonly endLine: number
  /**
   * Length of the last line of the script or the end bytecode offset for WebAssembly modules.
   */
  readonly endColumn: number
  /**
   * Identifier of the execution context in which this script was parsed.
   */
  readonly executionContextId: Runtime.ExecutionContextId
  /**
   * Type of script.
   */
  readonly scriptType: ScriptType
  /**
   * Determines whether this script is a user extension script.
   */
  readonly isContentScript?: boolean | undefined
  /**
   * sourceURL name of the script (if any).
   */
  readonly sourceURL?: string | undefined
  /**
   * URL of source map associated with script (if any).
   */
  readonly sourceMapURL?: string | undefined
  /**
   * Human-readable name of the script.
   */
  readonly displayName?: string | undefined
  /**
   * Identifier of the network request associated with this script (if any).
   */
  readonly requestId?: Network.RequestId | undefined
}

/**
 * Schema for `ScriptParsedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptParsedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: ScriptId,
    url: Schema.String,
    startLine: Schema.Int,
    startColumn: Schema.Int,
    endLine: Schema.Int,
    endColumn: Schema.Int,
    executionContextId: Runtime.ExecutionContextId,
    scriptType: ScriptType,
    isContentScript: Schema.optional(Schema.Boolean),
    sourceURL: Schema.optional(Schema.String),
    sourceMapURL: Schema.optional(Schema.String),
    displayName: Schema.optional(Schema.String),
    requestId: Schema.optional(Network.RequestId)
  }).annotate({ identifier: "Debugger.ScriptParsedParams" })
) as any as Schema.Codec<ScriptParsedParams>

/**
 * Searches for given string in script content.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchInContentParams {
  /**
   * Id of the script to search in.
   */
  readonly scriptId: ScriptId
  /**
   * String to search for.
   */
  readonly query: string
  /**
   * If true, search is case sensitive.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats string parameter as regex.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `SearchInContentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchInContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: ScriptId,
    query: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.SearchInContentParams" })
) as any as Schema.Codec<SearchInContentParams>

/**
 * Searches for given string in script content.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchInContentResult {
  /**
   * List of search matches.
   */
  readonly result: ReadonlyArray<GenericTypes.SearchMatch>
}

/**
 * Schema for `SearchInContentResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchInContentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(GenericTypes.SearchMatch)
  }).annotate({ identifier: "Debugger.SearchInContentResult" })
) as any as Schema.Codec<SearchInContentResult>

/**
 * Set the async stack trace depth for the page. A value of zero disables recording of async stack traces.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAsyncStackTraceDepthParams {
  /**
   * Async stack trace depth.
   */
  readonly depth: number
}

/**
 * Schema for `SetAsyncStackTraceDepthParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAsyncStackTraceDepthParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    depth: Schema.Int
  }).annotate({ identifier: "Debugger.SetAsyncStackTraceDepthParams" })
) as any as Schema.Codec<SetAsyncStackTraceDepthParams>

/**
 * Sets whether evaluation of breakpoint conditions, ignore counts, and actions happen at the location of the breakpoint or are deferred due to blackboxing.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBlackboxBreakpointEvaluationsParams {
  readonly blackboxBreakpointEvaluations: boolean
}

/**
 * Schema for `SetBlackboxBreakpointEvaluationsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBlackboxBreakpointEvaluationsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    blackboxBreakpointEvaluations: Schema.Boolean
  }).annotate({ identifier: "Debugger.SetBlackboxBreakpointEvaluationsParams" })
) as any as Schema.Codec<SetBlackboxBreakpointEvaluationsParams>

/**
 * Sets JavaScript breakpoint at a given location.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointParams {
  /**
   * Location to set breakpoint in.
   */
  readonly location: Location
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `SetBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    location: Location,
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.SetBreakpointParams" })
) as any as Schema.Codec<SetBreakpointParams>

/**
 * Sets JavaScript breakpoint at a given location.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointResult {
  /**
   * Id of the created breakpoint for further reference.
   */
  readonly breakpointId: BreakpointId
  /**
   * Location this breakpoint resolved into.
   */
  readonly actualLocation: Location
}

/**
 * Schema for `SetBreakpointResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId,
    actualLocation: Location
  }).annotate({ identifier: "Debugger.SetBreakpointResult" })
) as any as Schema.Codec<SetBreakpointResult>

/**
 * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this command is issued, all existing parsed scripts will have breakpoints resolved and returned in <code>locations</code> property. Further matching script parsing will result in subsequent <code>breakpointResolved</code> events issued. This logical breakpoint will survive page reloads.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointByUrlParams {
  /**
   * Line number to set breakpoint at.
   */
  readonly lineNumber: number
  /**
   * URL of the resources to set breakpoint on.
   */
  readonly url?: string | undefined
  /**
   * Regex pattern for the URLs of the resources to set breakpoints on. Either <code>url</code> or <code>urlRegex</code> must be specified.
   */
  readonly urlRegex?: string | undefined
  /**
   * Offset in the line to set breakpoint at.
   */
  readonly columnNumber?: number | undefined
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `SetBreakpointByUrlParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointByUrlParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lineNumber: Schema.Int,
    url: Schema.optional(Schema.String),
    urlRegex: Schema.optional(Schema.String),
    columnNumber: Schema.optional(Schema.Int),
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.SetBreakpointByUrlParams" })
) as any as Schema.Codec<SetBreakpointByUrlParams>

/**
 * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this command is issued, all existing parsed scripts will have breakpoints resolved and returned in <code>locations</code> property. Further matching script parsing will result in subsequent <code>breakpointResolved</code> events issued. This logical breakpoint will survive page reloads.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointByUrlResult {
  /**
   * Id of the created breakpoint for further reference.
   */
  readonly breakpointId: BreakpointId
  /**
   * List of the locations this breakpoint resolved into upon addition.
   */
  readonly locations: ReadonlyArray<Location>
}

/**
 * Schema for `SetBreakpointByUrlResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointByUrlResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId,
    locations: Schema.Array(Location)
  }).annotate({ identifier: "Debugger.SetBreakpointByUrlResult" })
) as any as Schema.Codec<SetBreakpointByUrlResult>

/**
 * Activates / deactivates all breakpoints on the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointsActiveParams {
  /**
   * New value for breakpoints active state.
   */
  readonly active: boolean
}

/**
 * Schema for `SetBreakpointsActiveParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointsActiveParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    active: Schema.Boolean
  }).annotate({ identifier: "Debugger.SetBreakpointsActiveParams" })
) as any as Schema.Codec<SetBreakpointsActiveParams>

/**
 * Change whether to pause in the debugger for internal scripts. The default value is false.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPauseForInternalScriptsParams {
  readonly shouldPause: boolean
}

/**
 * Schema for `SetPauseForInternalScriptsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseForInternalScriptsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    shouldPause: Schema.Boolean
  }).annotate({ identifier: "Debugger.SetPauseForInternalScriptsParams" })
) as any as Schema.Codec<SetPauseForInternalScriptsParams>

/**
 * Set pause on assertions state. Assertions are console.assert assertions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPauseOnAssertionsParams {
  readonly enabled: boolean
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `SetPauseOnAssertionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseOnAssertionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.SetPauseOnAssertionsParams" })
) as any as Schema.Codec<SetPauseOnAssertionsParams>

/**
 * Control whether the debugger pauses execution before `debugger` statements.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPauseOnDebuggerStatementsParams {
  readonly enabled: boolean
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `SetPauseOnDebuggerStatementsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseOnDebuggerStatementsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.SetPauseOnDebuggerStatementsParams" })
) as any as Schema.Codec<SetPauseOnDebuggerStatementsParams>

/**
 * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions or no exceptions. Initial pause on exceptions state is <code>none</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPauseOnExceptionsParams {
  /**
   * Pause on exceptions mode.
   */
  readonly state: SetPauseOnExceptionsParamsState
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `SetPauseOnExceptionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseOnExceptionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    state: SetPauseOnExceptionsParamsState,
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.SetPauseOnExceptionsParams" })
) as any as Schema.Codec<SetPauseOnExceptionsParams>

/**
 * Pause on exceptions mode.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetPauseOnExceptionsParamsState =
  | "none"
  | "uncaught"
  | "all"
  | (string & {})

/**
 * Schema for `SetPauseOnExceptionsParamsState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseOnExceptionsParamsState = Schema.String as any as Schema.Codec<SetPauseOnExceptionsParamsState>

/**
 * Pause when running the next JavaScript microtask.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPauseOnMicrotasksParams {
  readonly enabled: boolean
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: BreakpointOptions | undefined
}

/**
 * Schema for `SetPauseOnMicrotasksParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseOnMicrotasksParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    options: Schema.optional(BreakpointOptions)
  }).annotate({ identifier: "Debugger.SetPauseOnMicrotasksParams" })
) as any as Schema.Codec<SetPauseOnMicrotasksParams>

/**
 * Sets whether the given URL should be in the list of blackboxed scripts, which are ignored when pausing.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetShouldBlackboxURLParams {
  readonly url: string
  readonly shouldBlackbox: boolean
  /**
   * If <code>true</code>, <code>url</code> is case sensitive. Defaults to true.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If <code>true</code>, treat <code>url</code> as regular expression. Defaults to false.
   */
  readonly isRegex?: boolean | undefined
  /**
   * If provided, limits where in the script the debugger will skip pauses. Expected structure is a repeated <code>[startLine, startColumn, endLine, endColumn]</code>. Ignored if <code>shouldBlackbox</code> is <code>false</code>.
   */
  readonly sourceRanges?: ReadonlyArray<number> | undefined
}

/**
 * Schema for `SetShouldBlackboxURLParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetShouldBlackboxURLParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    shouldBlackbox: Schema.Boolean,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean),
    sourceRanges: Schema.optional(Schema.Array(Schema.Int))
  }).annotate({ identifier: "Debugger.SetShouldBlackboxURLParams" })
) as any as Schema.Codec<SetShouldBlackboxURLParams>

/**
 * Adds a JavaScript breakpoint that pauses execution whenever a function with the given name is about to be called.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addSymbolicBreakpoint: Protocol.CommandDef<
  "Debugger.addSymbolicBreakpoint",
  AddSymbolicBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.addSymbolicBreakpoint",
  AddSymbolicBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Continues execution until specific location is reached. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueToLocation: Protocol.CommandDef<"Debugger.continueToLocation", ContinueToLocationParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.continueToLocation",
    ContinueToLocationParams,
    undefined,
    { status: "stable" }
  )

/**
 * Continues execution until the current evaluation completes. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueUntilNextRunLoop: Protocol.CommandDef<"Debugger.continueUntilNextRunLoop", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.continueUntilNextRunLoop",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Disables debugger for given page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Debugger.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables debugger for the given page. Clients should not assume that the debugging has been enabled until the result for this command is received.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Debugger.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Evaluates expression on a given call frame.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const evaluateOnCallFrame: Protocol.CommandDef<
  "Debugger.evaluateOnCallFrame",
  EvaluateOnCallFrameParams,
  EvaluateOnCallFrameResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.evaluateOnCallFrame",
  EvaluateOnCallFrameParams,
  EvaluateOnCallFrameResult,
  { status: "stable" }
)

/**
 * Returns a list of valid breakpoint locations within the given location range.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBreakpointLocations: Protocol.CommandDef<
  "Debugger.getBreakpointLocations",
  GetBreakpointLocationsParams,
  GetBreakpointLocationsResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.getBreakpointLocations",
  GetBreakpointLocationsParams,
  GetBreakpointLocationsResult,
  { status: "stable" }
)

/**
 * Returns detailed information on given function.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getFunctionDetails: Protocol.CommandDef<
  "Debugger.getFunctionDetails",
  GetFunctionDetailsParams,
  GetFunctionDetailsResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.getFunctionDetails",
  GetFunctionDetailsParams,
  GetFunctionDetailsResult,
  { status: "stable" }
)

/**
 * Returns source for the script with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getScriptSource: Protocol.CommandDef<
  "Debugger.getScriptSource",
  GetScriptSourceParams,
  GetScriptSourceResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.getScriptSource",
  GetScriptSourceParams,
  GetScriptSourceResult,
  { status: "stable" }
)

/**
 * Stops on the next JavaScript statement.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const pause: Protocol.CommandDef<"Debugger.pause", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.pause",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Removes JavaScript breakpoint.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeBreakpoint: Protocol.CommandDef<"Debugger.removeBreakpoint", RemoveBreakpointParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.removeBreakpoint",
    RemoveBreakpointParams,
    undefined,
    { status: "stable" }
  )

/**
 * Removes a previously added symbolic breakpoint.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeSymbolicBreakpoint: Protocol.CommandDef<
  "Debugger.removeSymbolicBreakpoint",
  RemoveSymbolicBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.removeSymbolicBreakpoint",
  RemoveSymbolicBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Resumes JavaScript execution. This will trigger a Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resume: Protocol.CommandDef<"Debugger.resume", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.resume",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Searches for given string in script content.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const searchInContent: Protocol.CommandDef<
  "Debugger.searchInContent",
  SearchInContentParams,
  SearchInContentResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.searchInContent",
  SearchInContentParams,
  SearchInContentResult,
  { status: "stable" }
)

/**
 * Set the async stack trace depth for the page. A value of zero disables recording of async stack traces.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAsyncStackTraceDepth: Protocol.CommandDef<
  "Debugger.setAsyncStackTraceDepth",
  SetAsyncStackTraceDepthParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setAsyncStackTraceDepth",
  SetAsyncStackTraceDepthParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets whether evaluation of breakpoint conditions, ignore counts, and actions happen at the location of the breakpoint or are deferred due to blackboxing.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBlackboxBreakpointEvaluations: Protocol.CommandDef<
  "Debugger.setBlackboxBreakpointEvaluations",
  SetBlackboxBreakpointEvaluationsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setBlackboxBreakpointEvaluations",
  SetBlackboxBreakpointEvaluationsParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets JavaScript breakpoint at a given location.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBreakpoint: Protocol.CommandDef<"Debugger.setBreakpoint", SetBreakpointParams, SetBreakpointResult> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.setBreakpoint",
    SetBreakpointParams,
    SetBreakpointResult,
    { status: "stable" }
  )

/**
 * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this command is issued, all existing parsed scripts will have breakpoints resolved and returned in <code>locations</code> property. Further matching script parsing will result in subsequent <code>breakpointResolved</code> events issued. This logical breakpoint will survive page reloads.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBreakpointByUrl: Protocol.CommandDef<
  "Debugger.setBreakpointByUrl",
  SetBreakpointByUrlParams,
  SetBreakpointByUrlResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setBreakpointByUrl",
  SetBreakpointByUrlParams,
  SetBreakpointByUrlResult,
  { status: "stable" }
)

/**
 * Activates / deactivates all breakpoints on the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBreakpointsActive: Protocol.CommandDef<
  "Debugger.setBreakpointsActive",
  SetBreakpointsActiveParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setBreakpointsActive",
  SetBreakpointsActiveParams,
  undefined,
  { status: "stable" }
)

/**
 * Change whether to pause in the debugger for internal scripts. The default value is false.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPauseForInternalScripts: Protocol.CommandDef<
  "Debugger.setPauseForInternalScripts",
  SetPauseForInternalScriptsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setPauseForInternalScripts",
  SetPauseForInternalScriptsParams,
  undefined,
  { status: "stable" }
)

/**
 * Set pause on assertions state. Assertions are console.assert assertions.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPauseOnAssertions: Protocol.CommandDef<
  "Debugger.setPauseOnAssertions",
  SetPauseOnAssertionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setPauseOnAssertions",
  SetPauseOnAssertionsParams,
  undefined,
  { status: "stable" }
)

/**
 * Control whether the debugger pauses execution before `debugger` statements.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPauseOnDebuggerStatements: Protocol.CommandDef<
  "Debugger.setPauseOnDebuggerStatements",
  SetPauseOnDebuggerStatementsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setPauseOnDebuggerStatements",
  SetPauseOnDebuggerStatementsParams,
  undefined,
  { status: "stable" }
)

/**
 * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions or no exceptions. Initial pause on exceptions state is <code>none</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPauseOnExceptions: Protocol.CommandDef<
  "Debugger.setPauseOnExceptions",
  SetPauseOnExceptionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setPauseOnExceptions",
  SetPauseOnExceptionsParams,
  undefined,
  { status: "stable" }
)

/**
 * Pause when running the next JavaScript microtask.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPauseOnMicrotasks: Protocol.CommandDef<
  "Debugger.setPauseOnMicrotasks",
  SetPauseOnMicrotasksParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setPauseOnMicrotasks",
  SetPauseOnMicrotasksParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets whether the given URL should be in the list of blackboxed scripts, which are ignored when pausing.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setShouldBlackboxURL: Protocol.CommandDef<
  "Debugger.setShouldBlackboxURL",
  SetShouldBlackboxURLParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setShouldBlackboxURL",
  SetShouldBlackboxURLParams,
  undefined,
  { status: "stable" }
)

/**
 * Steps into the function call. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stepInto: Protocol.CommandDef<"Debugger.stepInto", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.stepInto",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Steps over the expression. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stepNext: Protocol.CommandDef<"Debugger.stepNext", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.stepNext",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Steps out of the function call. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stepOut: Protocol.CommandDef<"Debugger.stepOut", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.stepOut",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Steps over the statement. This will trigger either a Debugger.paused or Debugger.resumed event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stepOver: Protocol.CommandDef<"Debugger.stepOver", void, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.stepOver",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fired when breakpoint is resolved to an actual script and location.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const breakpointResolved: Protocol.EventDef<"Debugger.breakpointResolved", BreakpointResolvedParams> =
  /*#__PURE__*/ Protocol.event(
    "Debugger.breakpointResolved",
    BreakpointResolvedParams,
    { status: "stable" }
  )

/**
 * Fires when a new probe sample is collected.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const didSampleProbe: Protocol.EventDef<"Debugger.didSampleProbe", DidSampleProbeParams> = /*#__PURE__*/ Protocol
  .event(
    "Debugger.didSampleProbe",
    DidSampleProbeParams,
    { status: "stable" }
  )

/**
 * Called when global has been cleared and debugger client should reset its state. Happens upon navigation or reload.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const globalObjectCleared: Protocol.EventDef<"Debugger.globalObjectCleared", void> = /*#__PURE__*/ Protocol
  .event(
    "Debugger.globalObjectCleared",
    undefined,
    { status: "stable" }
  )

/**
 * Fired when the virtual machine stopped on breakpoint or exception or any other stop criteria.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const paused: Protocol.EventDef<"Debugger.paused", PausedParams> = /*#__PURE__*/ Protocol.event(
  "Debugger.paused",
  PausedParams,
  { status: "stable" }
)

/**
 * Fired when a "sound" breakpoint action is triggered on a breakpoint.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const playBreakpointActionSound: Protocol.EventDef<
  "Debugger.playBreakpointActionSound",
  PlayBreakpointActionSoundParams
> = /*#__PURE__*/ Protocol.event(
  "Debugger.playBreakpointActionSound",
  PlayBreakpointActionSoundParams,
  { status: "stable" }
)

/**
 * Fired when the virtual machine resumed execution.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const resumed: Protocol.EventDef<"Debugger.resumed", void> = /*#__PURE__*/ Protocol.event(
  "Debugger.resumed",
  undefined,
  { status: "stable" }
)

/**
 * Fired when virtual machine fails to parse the script.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const scriptFailedToParse: Protocol.EventDef<"Debugger.scriptFailedToParse", ScriptFailedToParseParams> =
  /*#__PURE__*/ Protocol.event(
    "Debugger.scriptFailedToParse",
    ScriptFailedToParseParams,
    { status: "stable" }
  )

/**
 * Fired when virtual machine parses script. This event is also fired for all known and uncollected scripts upon enabling debugger.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const scriptParsed: Protocol.EventDef<"Debugger.scriptParsed", ScriptParsedParams> = /*#__PURE__*/ Protocol
  .event(
    "Debugger.scriptParsed",
    ScriptParsedParams,
    { status: "stable" }
  )
