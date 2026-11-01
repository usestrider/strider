/**
 * Debugger domain exposes JavaScript debugging capabilities. It allows setting and removing
 * breakpoints, stepping through execution, exploring stack traces, etc.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Runtime from "./Runtime.ts"

/**
 * `BreakLocation`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BreakLocation {
  /**
   * Script identifier as reported in the `Debugger.scriptParsed`.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * Line number in the script (0-based).
   */
  readonly lineNumber: number
  /**
   * Column number in the script (0-based).
   */
  readonly columnNumber?: number | undefined
  readonly type?: BreakLocationType | undefined
}

/**
 * Schema for `BreakLocation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakLocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId,
    lineNumber: Schema.Int,
    columnNumber: Schema.optional(Schema.Int),
    type: Schema.optional(BreakLocationType)
  }).annotate({ identifier: "Debugger.BreakLocation" })
) as any as Schema.Codec<BreakLocation>

/**
 * `BreakLocation.type` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BreakLocationType =
  | "debuggerStatement"
  | "call"
  | "return"
  | (string & {})

/**
 * Schema for `BreakLocationType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakLocationType = Schema.String as any as Schema.Codec<BreakLocationType>

/**
 * Breakpoint identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BreakpointId = Brand.Branded<string, "~@usestrider/browser/cdp/Debugger/BreakpointId">

/**
 * Schema for `BreakpointId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BreakpointId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Debugger/BreakpointId")
) as any as Schema.Codec<BreakpointId>

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
  readonly functionLocation?: Location | undefined
  /**
   * Location in the source code.
   */
  readonly location: Location
  /**
   * Scope chain for this call frame.
   */
  readonly scopeChain: ReadonlyArray<Scope>
  /**
   * `this` object for this call frame.
   */
  readonly this: Runtime.RemoteObject
  /**
   * The value being returned, if the function is at return point.
   */
  readonly returnValue?: Runtime.RemoteObject | undefined
  /**
   * Valid only while the VM is paused and indicates whether this frame
   * can be restarted or not. Note that a `true` value here does not
   * guarantee that Debugger#restartFrame with this CallFrameId will be
   * successful, but it is very likely.
   */
  readonly canBeRestarted?: boolean | undefined
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
    functionLocation: Schema.optional(Location),
    location: Location,
    scopeChain: Schema.Array(Scope),
    this: Runtime.RemoteObject,
    returnValue: Schema.optional(Runtime.RemoteObject),
    canBeRestarted: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.CallFrame" })
) as any as Schema.Codec<CallFrame>

/**
 * Call frame identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CallFrameId = Brand.Branded<string, "~@usestrider/browser/cdp/Debugger/CallFrameId">

/**
 * Schema for `CallFrameId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFrameId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Debugger/CallFrameId")
) as any as Schema.Codec<CallFrameId>

/**
 * Debug symbols available for a wasm script.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DebugSymbols {
  /**
   * Type of the debug symbols.
   */
  readonly type: DebugSymbolsType
  /**
   * URL of the external symbol source.
   */
  readonly externalURL?: string | undefined
}

/**
 * Schema for `DebugSymbols`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DebugSymbols = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DebugSymbolsType,
    externalURL: Schema.optional(Schema.String)
  }).annotate({ identifier: "Debugger.DebugSymbols" })
) as any as Schema.Codec<DebugSymbols>

/**
 * Type of the debug symbols.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DebugSymbolsType =
  | "SourceMap"
  | "EmbeddedDWARF"
  | "ExternalDWARF"
  | (string & {})

/**
 * Schema for `DebugSymbolsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DebugSymbolsType = Schema.String as any as Schema.Codec<DebugSymbolsType>

/**
 * Location in the source code.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Location {
  /**
   * Script identifier as reported in the `Debugger.scriptParsed`.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * Line number in the script (0-based).
   */
  readonly lineNumber: number
  /**
   * Column number in the script (0-based).
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
    scriptId: Runtime.ScriptId,
    lineNumber: Schema.Int,
    columnNumber: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Debugger.Location" })
) as any as Schema.Codec<Location>

/**
 * Location range within one script.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LocationRange {
  readonly scriptId: Runtime.ScriptId
  readonly start: ScriptPosition
  readonly end: ScriptPosition
}

/**
 * Schema for `LocationRange`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LocationRange = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId,
    start: ScriptPosition,
    end: ScriptPosition
  }).annotate({ identifier: "Debugger.LocationRange" })
) as any as Schema.Codec<LocationRange>

/**
 * `ResolvedBreakpoint`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolvedBreakpoint {
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
 * Schema for `ResolvedBreakpoint`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolvedBreakpoint = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId,
    location: Location
  }).annotate({ identifier: "Debugger.ResolvedBreakpoint" })
) as any as Schema.Codec<ResolvedBreakpoint>

/**
 * Scope description.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Scope {
  /**
   * Scope type.
   */
  readonly type: ScopeType
  /**
   * Object representing the scope. For `global` and `with` scopes it represents the actual
   * object; for the rest of the scopes, it is artificial transient object enumerating scope
   * variables as its properties.
   */
  readonly object: Runtime.RemoteObject
  readonly name?: string | undefined
  /**
   * Location in the source code where scope starts
   */
  readonly startLocation?: Location | undefined
  /**
   * Location in the source code where scope ends
   */
  readonly endLocation?: Location | undefined
  /**
   * True if the scope does not declare any variables or have a runtime context.
   * Only present if true.
   * Empty scopes are retained in the scope chain because
   * they can be targeted via `evaluateOnCallFrame` (using `scopeNumber`) or
   * matched against scopes in source maps.
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
    type: ScopeType,
    object: Runtime.RemoteObject,
    name: Schema.optional(Schema.String),
    startLocation: Schema.optional(Location),
    endLocation: Schema.optional(Location),
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
  | "local"
  | "with"
  | "closure"
  | "catch"
  | "block"
  | "script"
  | "eval"
  | "module"
  | "wasm-expression-stack"
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
 * Enum of possible script languages.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScriptLanguage =
  | "JavaScript"
  | "WebAssembly"
  | (string & {})

/**
 * Schema for `ScriptLanguage`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptLanguage = Schema.String as any as Schema.Codec<ScriptLanguage>

/**
 * Location in the source code.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScriptPosition {
  readonly lineNumber: number
  readonly columnNumber: number
}

/**
 * Schema for `ScriptPosition`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScriptPosition = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lineNumber: Schema.Int,
    columnNumber: Schema.Int
  }).annotate({ identifier: "Debugger.ScriptPosition" })
) as any as Schema.Codec<ScriptPosition>

/**
 * Search match for resource.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchMatch {
  /**
   * Line number in resource content.
   */
  readonly lineNumber: number
  /**
   * Line with match content.
   */
  readonly lineContent: string
}

/**
 * Schema for `SearchMatch`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchMatch = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lineNumber: Schema.Number,
    lineContent: Schema.String
  }).annotate({ identifier: "Debugger.SearchMatch" })
) as any as Schema.Codec<SearchMatch>

/**
 * `WasmDisassemblyChunk`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WasmDisassemblyChunk {
  /**
   * The next chunk of disassembled lines.
   */
  readonly lines: ReadonlyArray<string>
  /**
   * The bytecode offsets describing the start of each line.
   */
  readonly bytecodeOffsets: ReadonlyArray<number>
}

/**
 * Schema for `WasmDisassemblyChunk`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WasmDisassemblyChunk = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lines: Schema.Array(Schema.String),
    bytecodeOffsets: Schema.Array(Schema.Int)
  }).annotate({ identifier: "Debugger.WasmDisassemblyChunk" })
) as any as Schema.Codec<WasmDisassemblyChunk>

/**
 * Continues execution until specific location is reached.
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
  readonly targetCallFrames?: ContinueToLocationParamsTargetCallFrames | undefined
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
    location: Location,
    targetCallFrames: Schema.optional(ContinueToLocationParamsTargetCallFrames)
  }).annotate({ identifier: "Debugger.ContinueToLocationParams" })
) as any as Schema.Codec<ContinueToLocationParams>

/**
 * `continueToLocation.Params.targetCallFrames` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContinueToLocationParamsTargetCallFrames =
  | "any"
  | "current"
  | (string & {})

/**
 * Schema for `ContinueToLocationParamsTargetCallFrames`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueToLocationParamsTargetCallFrames = Schema.String as any as Schema.Codec<
  ContinueToLocationParamsTargetCallFrames
>

/**
 * `disassembleWasmModule.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DisassembleWasmModuleParams {
  /**
   * Id of the script to disassemble
   */
  readonly scriptId: Runtime.ScriptId
}

/**
 * Schema for `DisassembleWasmModuleParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisassembleWasmModuleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId
  }).annotate({ identifier: "Debugger.DisassembleWasmModuleParams" })
) as any as Schema.Codec<DisassembleWasmModuleParams>

/**
 * `disassembleWasmModule.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DisassembleWasmModuleResult {
  /**
   * For large modules, return a stream from which additional chunks of
   * disassembly can be read successively.
   */
  readonly streamId?: string | undefined
  /**
   * The total number of lines in the disassembly text.
   */
  readonly totalNumberOfLines: number
  /**
   * The offsets of all function bodies, in the format [start1, end1,
   * start2, end2, ...] where all ends are exclusive.
   */
  readonly functionBodyOffsets: ReadonlyArray<number>
  /**
   * The first chunk of disassembly.
   */
  readonly chunk: WasmDisassemblyChunk
}

/**
 * Schema for `DisassembleWasmModuleResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisassembleWasmModuleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    streamId: Schema.optional(Schema.String),
    totalNumberOfLines: Schema.Int,
    functionBodyOffsets: Schema.Array(Schema.Int),
    chunk: WasmDisassemblyChunk
  }).annotate({ identifier: "Debugger.DisassembleWasmModuleResult" })
) as any as Schema.Codec<DisassembleWasmModuleResult>

/**
 * Enables debugger for the given page. Clients should not assume that the debugging has been
 * enabled until the result for this command is received.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * The maximum size in bytes of collected scripts (not referenced by other heap objects)
   * the debugger can hold. Puts no limit if parameter is omitted.
   */
  readonly maxScriptsCacheSize?: number | undefined
}

/**
 * Schema for `EnableParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EnableParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxScriptsCacheSize: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Debugger.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Enables debugger for the given page. Clients should not assume that the debugging has been
 * enabled until the result for this command is received.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableResult {
  /**
   * Unique identifier of the debugger.
   */
  readonly debuggerId?: Runtime.UniqueDebuggerId | undefined
}

/**
 * Schema for `EnableResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EnableResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    debuggerId: Schema.optional(Runtime.UniqueDebuggerId)
  }).annotate({ identifier: "Debugger.EnableResult" })
) as any as Schema.Codec<EnableResult>

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
   * String object group name to put result into (allows rapid releasing resulting object handles
   * using `releaseObjectGroup`).
   */
  readonly objectGroup?: string | undefined
  /**
   * Specifies whether command line API should be available to the evaluated expression, defaults
   * to false.
   */
  readonly includeCommandLineAPI?: boolean | undefined
  /**
   * In silent mode exceptions thrown during evaluation are not reported and do not pause
   * execution. Overrides `setPauseOnException` state.
   */
  readonly silent?: boolean | undefined
  /**
   * Whether the result is expected to be a JSON object that should be sent by value.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * Whether to throw an exception if side effect cannot be ruled out during evaluation.
   */
  readonly throwOnSideEffect?: boolean | undefined
  /**
   * Terminate execution after timing out (number of milliseconds).
   */
  readonly timeout?: Runtime.TimeDelta | undefined
  /**
   * Specifies the scope number to evaluate the expression in (default: 0, innermost scope).
   */
  readonly scopeNumber?: number | undefined
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
    silent: Schema.optional(Schema.Boolean),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    throwOnSideEffect: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(Runtime.TimeDelta),
    scopeNumber: Schema.optional(Schema.Int)
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
   * Exception details.
   */
  readonly exceptionDetails?: Runtime.ExceptionDetails | undefined
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
    exceptionDetails: Schema.optional(Runtime.ExceptionDetails)
  }).annotate({ identifier: "Debugger.EvaluateOnCallFrameResult" })
) as any as Schema.Codec<EvaluateOnCallFrameResult, unknown>

/**
 * Returns possible locations for breakpoint. scriptId in start and end range locations should be
 * the same.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPossibleBreakpointsParams {
  /**
   * Start of range to search possible breakpoint locations in.
   */
  readonly start: Location
  /**
   * End of range to search possible breakpoint locations in (excluding). When not specified, end
   * of scripts is used as end of range.
   */
  readonly end?: Location | undefined
  /**
   * Only consider locations which are in the same (non-nested) function as start.
   */
  readonly restrictToFunction?: boolean | undefined
}

/**
 * Schema for `GetPossibleBreakpointsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPossibleBreakpointsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    start: Location,
    end: Schema.optional(Location),
    restrictToFunction: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.GetPossibleBreakpointsParams" })
) as any as Schema.Codec<GetPossibleBreakpointsParams>

/**
 * Returns possible locations for breakpoint. scriptId in start and end range locations should be
 * the same.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPossibleBreakpointsResult {
  /**
   * List of the possible breakpoint locations.
   */
  readonly locations: ReadonlyArray<BreakLocation>
}

/**
 * Schema for `GetPossibleBreakpointsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPossibleBreakpointsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locations: Schema.Array(BreakLocation)
  }).annotate({ identifier: "Debugger.GetPossibleBreakpointsResult" })
) as any as Schema.Codec<GetPossibleBreakpointsResult>

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
  readonly scriptId: Runtime.ScriptId
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
    scriptId: Runtime.ScriptId
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
   * Script source (empty in case of Wasm bytecode).
   */
  readonly scriptSource: string
  /**
   * Wasm bytecode. (Encoded as a base64 string when passed over JSON)
   */
  readonly bytecode?: string | undefined
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
    scriptSource: Schema.String,
    bytecode: Schema.optional(Schema.String)
  }).annotate({ identifier: "Debugger.GetScriptSourceResult" })
) as any as Schema.Codec<GetScriptSourceResult>

/**
 * Returns stack trace with given `stackTraceId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStackTraceParams {
  readonly stackTraceId: Runtime.StackTraceId
}

/**
 * Schema for `GetStackTraceParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStackTraceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stackTraceId: Runtime.StackTraceId
  }).annotate({ identifier: "Debugger.GetStackTraceParams" })
) as any as Schema.Codec<GetStackTraceParams>

/**
 * Returns stack trace with given `stackTraceId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStackTraceResult {
  readonly stackTrace: Runtime.StackTrace
}

/**
 * Schema for `GetStackTraceResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStackTraceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stackTrace: Runtime.StackTrace
  }).annotate({ identifier: "Debugger.GetStackTraceResult" })
) as any as Schema.Codec<GetStackTraceResult, unknown>

/**
 * Disassemble the next chunk of lines for the module corresponding to the
 * stream. If disassembly is complete, this API will invalidate the streamId
 * and return an empty chunk. Any subsequent calls for the now invalid stream
 * will return errors.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NextWasmDisassemblyChunkParams {
  readonly streamId: string
}

/**
 * Schema for `NextWasmDisassemblyChunkParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NextWasmDisassemblyChunkParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    streamId: Schema.String
  }).annotate({ identifier: "Debugger.NextWasmDisassemblyChunkParams" })
) as any as Schema.Codec<NextWasmDisassemblyChunkParams>

/**
 * Disassemble the next chunk of lines for the module corresponding to the
 * stream. If disassembly is complete, this API will invalidate the streamId
 * and return an empty chunk. Any subsequent calls for the now invalid stream
 * will return errors.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NextWasmDisassemblyChunkResult {
  /**
   * The next chunk of disassembly.
   */
  readonly chunk: WasmDisassemblyChunk
}

/**
 * Schema for `NextWasmDisassemblyChunkResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NextWasmDisassemblyChunkResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    chunk: WasmDisassemblyChunk
  }).annotate({ identifier: "Debugger.NextWasmDisassemblyChunkResult" })
) as any as Schema.Codec<NextWasmDisassemblyChunkResult>

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
   * Hit breakpoints IDs
   */
  readonly hitBreakpoints?: ReadonlyArray<string> | undefined
  /**
   * Async stack trace, if any.
   */
  readonly asyncStackTrace?: Runtime.StackTrace | undefined
  /**
   * Async stack trace, if any.
   */
  readonly asyncStackTraceId?: Runtime.StackTraceId | undefined
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
    hitBreakpoints: Schema.optional(Schema.Array(Schema.String)),
    asyncStackTrace: Schema.optional(Runtime.StackTrace),
    asyncStackTraceId: Schema.optional(Runtime.StackTraceId)
  }).annotate({ identifier: "Debugger.PausedParams" })
) as any as Schema.Codec<PausedParams, unknown>

/**
 * Pause reason.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PausedParamsReason =
  | "ambiguous"
  | "assert"
  | "CSPViolation"
  | "debugCommand"
  | "DOM"
  | "EventListener"
  | "exception"
  | "instrumentation"
  | "OOM"
  | "other"
  | "promiseRejection"
  | "XHR"
  | "step"
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
 * Restarts particular call frame from the beginning. The old, deprecated
 * behavior of `restartFrame` is to stay paused and allow further CDP commands
 * after a restart was scheduled. This can cause problems with restarting, so
 * we now continue execution immediatly after it has been scheduled until we
 * reach the beginning of the restarted frame.
 *
 * To stay back-wards compatible, `restartFrame` now expects a `mode`
 * parameter to be present. If the `mode` parameter is missing, `restartFrame`
 * errors out.
 *
 * The various return values are deprecated and `callFrames` is always empty.
 * Use the call frames from the `Debugger#paused` events instead, that fires
 * once V8 pauses at the beginning of the restarted function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RestartFrameParams {
  /**
   * Call frame identifier to evaluate on.
   */
  readonly callFrameId: CallFrameId
  /**
   * The `mode` parameter must be present and set to 'StepInto', otherwise
   * `restartFrame` will error out.
   */
  readonly mode?: RestartFrameParamsMode | undefined
}

/**
 * Schema for `RestartFrameParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RestartFrameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    callFrameId: CallFrameId,
    mode: Schema.optional(RestartFrameParamsMode)
  }).annotate({ identifier: "Debugger.RestartFrameParams" })
) as any as Schema.Codec<RestartFrameParams>

/**
 * The `mode` parameter must be present and set to 'StepInto', otherwise
 * `restartFrame` will error out.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RestartFrameParamsMode =
  | "StepInto"
  | (string & {})

/**
 * Schema for `RestartFrameParamsMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RestartFrameParamsMode = Schema.String as any as Schema.Codec<RestartFrameParamsMode>

/**
 * Restarts particular call frame from the beginning. The old, deprecated
 * behavior of `restartFrame` is to stay paused and allow further CDP commands
 * after a restart was scheduled. This can cause problems with restarting, so
 * we now continue execution immediatly after it has been scheduled until we
 * reach the beginning of the restarted frame.
 *
 * To stay back-wards compatible, `restartFrame` now expects a `mode`
 * parameter to be present. If the `mode` parameter is missing, `restartFrame`
 * errors out.
 *
 * The various return values are deprecated and `callFrames` is always empty.
 * Use the call frames from the `Debugger#paused` events instead, that fires
 * once V8 pauses at the beginning of the restarted function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RestartFrameResult {
}

/**
 * Schema for `RestartFrameResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RestartFrameResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({}).annotate({ identifier: "Debugger.RestartFrameResult" })
) as any as Schema.Codec<RestartFrameResult>

/**
 * Resumes JavaScript execution.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResumeParams {
  /**
   * Set to true to terminate execution upon resuming execution. In contrast
   * to Runtime.terminateExecution, this will allows to execute further
   * JavaScript (i.e. via evaluation) until execution of the paused code
   * is actually resumed, at which point termination is triggered.
   * If execution is currently not paused, this parameter has no effect.
   */
  readonly terminateOnResume?: boolean | undefined
}

/**
 * Schema for `ResumeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResumeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    terminateOnResume: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.ResumeParams" })
) as any as Schema.Codec<ResumeParams>

/**
 * Fired when virtual machine fails to parse the script.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScriptFailedToParseParams {
  /**
   * Identifier of the script parsed.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * URL or name of the script parsed (if any).
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
   * Length of the last line of the script.
   */
  readonly endColumn: number
  /**
   * Specifies script creation context.
   */
  readonly executionContextId: Runtime.ExecutionContextId
  /**
   * Content hash of the script, SHA-256.
   */
  readonly hash: string
  /**
   * For Wasm modules, the content of the `build_id` custom section. For JavaScript the `debugId` magic comment.
   */
  readonly buildId: string
  /**
   * Embedder-specific auxiliary data likely matching {isDefault: boolean, type: 'default'|'isolated'|'worker', frameId: string}
   */
  readonly executionContextAuxData?: { readonly [key: string]: unknown } | undefined
  /**
   * URL of source map associated with script (if any).
   */
  readonly sourceMapURL?: string | undefined
  /**
   * True, if this script has sourceURL.
   */
  readonly hasSourceURL?: boolean | undefined
  /**
   * True, if this script is ES6 module.
   */
  readonly isModule?: boolean | undefined
  /**
   * This script length.
   */
  readonly length?: number | undefined
  /**
   * JavaScript top stack frame of where the script parsed event was triggered if available.
   */
  readonly stackTrace?: Runtime.StackTrace | undefined
  /**
   * If the scriptLanguage is WebAssembly, the code section offset in the module.
   */
  readonly codeOffset?: number | undefined
  /**
   * The language of the script.
   */
  readonly scriptLanguage?: ScriptLanguage | undefined
  /**
   * The name the embedder supplied for this script.
   */
  readonly embedderName?: string | undefined
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
    scriptId: Runtime.ScriptId,
    url: Schema.String,
    startLine: Schema.Int,
    startColumn: Schema.Int,
    endLine: Schema.Int,
    endColumn: Schema.Int,
    executionContextId: Runtime.ExecutionContextId,
    hash: Schema.String,
    buildId: Schema.String,
    executionContextAuxData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    sourceMapURL: Schema.optional(Schema.String),
    hasSourceURL: Schema.optional(Schema.Boolean),
    isModule: Schema.optional(Schema.Boolean),
    length: Schema.optional(Schema.Int),
    stackTrace: Schema.optional(Runtime.StackTrace),
    codeOffset: Schema.optional(Schema.Int),
    scriptLanguage: Schema.optional(ScriptLanguage),
    embedderName: Schema.optional(Schema.String)
  }).annotate({ identifier: "Debugger.ScriptFailedToParseParams" })
) as any as Schema.Codec<ScriptFailedToParseParams, unknown>

/**
 * Fired when virtual machine parses script. This event is also fired for all known and uncollected
 * scripts upon enabling debugger.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScriptParsedParams {
  /**
   * Identifier of the script parsed.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * URL or name of the script parsed (if any).
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
   * Length of the last line of the script.
   */
  readonly endColumn: number
  /**
   * Specifies script creation context.
   */
  readonly executionContextId: Runtime.ExecutionContextId
  /**
   * Content hash of the script, SHA-256.
   */
  readonly hash: string
  /**
   * For Wasm modules, the content of the `build_id` custom section. For JavaScript the `debugId` magic comment.
   */
  readonly buildId: string
  /**
   * Embedder-specific auxiliary data likely matching {isDefault: boolean, type: 'default'|'isolated'|'worker', frameId: string}
   */
  readonly executionContextAuxData?: { readonly [key: string]: unknown } | undefined
  /**
   * True, if this script is generated as a result of the live edit operation.
   */
  readonly isLiveEdit?: boolean | undefined
  /**
   * URL of source map associated with script (if any).
   */
  readonly sourceMapURL?: string | undefined
  /**
   * True, if this script has sourceURL.
   */
  readonly hasSourceURL?: boolean | undefined
  /**
   * True, if this script is ES6 module.
   */
  readonly isModule?: boolean | undefined
  /**
   * This script length.
   */
  readonly length?: number | undefined
  /**
   * JavaScript top stack frame of where the script parsed event was triggered if available.
   */
  readonly stackTrace?: Runtime.StackTrace | undefined
  /**
   * If the scriptLanguage is WebAssembly, the code section offset in the module.
   */
  readonly codeOffset?: number | undefined
  /**
   * The language of the script.
   */
  readonly scriptLanguage?: ScriptLanguage | undefined
  /**
   * If the scriptLanguage is WebAssembly, the source of debug symbols for the module.
   */
  readonly debugSymbols?: ReadonlyArray<DebugSymbols> | undefined
  /**
   * The name the embedder supplied for this script.
   */
  readonly embedderName?: string | undefined
  /**
   * The list of set breakpoints in this script if calls to `setBreakpointByUrl`
   * matches this script's URL or hash. Clients that use this list can ignore the
   * `breakpointResolved` event. They are equivalent.
   */
  readonly resolvedBreakpoints?: ReadonlyArray<ResolvedBreakpoint> | undefined
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
    scriptId: Runtime.ScriptId,
    url: Schema.String,
    startLine: Schema.Int,
    startColumn: Schema.Int,
    endLine: Schema.Int,
    endColumn: Schema.Int,
    executionContextId: Runtime.ExecutionContextId,
    hash: Schema.String,
    buildId: Schema.String,
    executionContextAuxData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    isLiveEdit: Schema.optional(Schema.Boolean),
    sourceMapURL: Schema.optional(Schema.String),
    hasSourceURL: Schema.optional(Schema.Boolean),
    isModule: Schema.optional(Schema.Boolean),
    length: Schema.optional(Schema.Int),
    stackTrace: Schema.optional(Runtime.StackTrace),
    codeOffset: Schema.optional(Schema.Int),
    scriptLanguage: Schema.optional(ScriptLanguage),
    debugSymbols: Schema.optional(Schema.Array(DebugSymbols)),
    embedderName: Schema.optional(Schema.String),
    resolvedBreakpoints: Schema.optional(Schema.Array(ResolvedBreakpoint))
  }).annotate({ identifier: "Debugger.ScriptParsedParams" })
) as any as Schema.Codec<ScriptParsedParams, unknown>

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
  readonly scriptId: Runtime.ScriptId
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
    scriptId: Runtime.ScriptId,
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
  readonly result: ReadonlyArray<SearchMatch>
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
    result: Schema.Array(SearchMatch)
  }).annotate({ identifier: "Debugger.SearchInContentResult" })
) as any as Schema.Codec<SearchInContentResult>

/**
 * Enables or disables async call stacks tracking.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAsyncCallStackDepthParams {
  /**
   * Maximum depth of async call stacks. Setting to `0` will effectively disable collecting async
   * call stacks (default).
   */
  readonly maxDepth: number
}

/**
 * Schema for `SetAsyncCallStackDepthParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAsyncCallStackDepthParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxDepth: Schema.Int
  }).annotate({ identifier: "Debugger.SetAsyncCallStackDepthParams" })
) as any as Schema.Codec<SetAsyncCallStackDepthParams>

/**
 * Replace previous blackbox execution contexts with passed ones. Forces backend to skip
 * stepping/pausing in scripts in these execution contexts. VM will try to leave blackboxed script by
 * performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBlackboxExecutionContextsParams {
  /**
   * Array of execution context unique ids for the debugger to ignore.
   */
  readonly uniqueIds: ReadonlyArray<string>
}

/**
 * Schema for `SetBlackboxExecutionContextsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBlackboxExecutionContextsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    uniqueIds: Schema.Array(Schema.String)
  }).annotate({ identifier: "Debugger.SetBlackboxExecutionContextsParams" })
) as any as Schema.Codec<SetBlackboxExecutionContextsParams>

/**
 * Replace previous blackbox patterns with passed ones. Forces backend to skip stepping/pausing in
 * scripts with url matching one of the patterns. VM will try to leave blackboxed script by
 * performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBlackboxPatternsParams {
  /**
   * Array of regexps that will be used to check script url for blackbox state.
   */
  readonly patterns: ReadonlyArray<string>
  /**
   * If true, also ignore scripts with no source url.
   */
  readonly skipAnonymous?: boolean | undefined
}

/**
 * Schema for `SetBlackboxPatternsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBlackboxPatternsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    patterns: Schema.Array(Schema.String),
    skipAnonymous: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Debugger.SetBlackboxPatternsParams" })
) as any as Schema.Codec<SetBlackboxPatternsParams>

/**
 * Makes backend skip steps in the script in blackboxed ranges. VM will try leave blacklisted
 * scripts by performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
 * Positions array contains positions where blackbox state is changed. First interval isn't
 * blackboxed. Array should be sorted.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBlackboxedRangesParams {
  /**
   * Id of the script.
   */
  readonly scriptId: Runtime.ScriptId
  readonly positions: ReadonlyArray<ScriptPosition>
}

/**
 * Schema for `SetBlackboxedRangesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBlackboxedRangesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId,
    positions: Schema.Array(ScriptPosition)
  }).annotate({ identifier: "Debugger.SetBlackboxedRangesParams" })
) as any as Schema.Codec<SetBlackboxedRangesParams>

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
   * Expression to use as a breakpoint condition. When specified, debugger will only stop on the
   * breakpoint if this expression evaluates to true.
   */
  readonly condition?: string | undefined
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
    condition: Schema.optional(Schema.String)
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
 * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this
 * command is issued, all existing parsed scripts will have breakpoints resolved and returned in
 * `locations` property. Further matching script parsing will result in subsequent
 * `breakpointResolved` events issued. This logical breakpoint will survive page reloads.
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
   * Regex pattern for the URLs of the resources to set breakpoints on. Either `url` or
   * `urlRegex` must be specified.
   */
  readonly urlRegex?: string | undefined
  /**
   * Script hash of the resources to set breakpoint on.
   */
  readonly scriptHash?: string | undefined
  /**
   * Offset in the line to set breakpoint at.
   */
  readonly columnNumber?: number | undefined
  /**
   * Expression to use as a breakpoint condition. When specified, debugger will only stop on the
   * breakpoint if this expression evaluates to true.
   */
  readonly condition?: string | undefined
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
    scriptHash: Schema.optional(Schema.String),
    columnNumber: Schema.optional(Schema.Int),
    condition: Schema.optional(Schema.String)
  }).annotate({ identifier: "Debugger.SetBreakpointByUrlParams" })
) as any as Schema.Codec<SetBreakpointByUrlParams>

/**
 * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this
 * command is issued, all existing parsed scripts will have breakpoints resolved and returned in
 * `locations` property. Further matching script parsing will result in subsequent
 * `breakpointResolved` events issued. This logical breakpoint will survive page reloads.
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
 * Sets JavaScript breakpoint before each call to the given function.
 * If another function was created from the same source as a given one,
 * calling it will also trigger the breakpoint.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointOnFunctionCallParams {
  /**
   * Function object id.
   */
  readonly objectId: Runtime.RemoteObjectId
  /**
   * Expression to use as a breakpoint condition. When specified, debugger will
   * stop on the breakpoint if this expression evaluates to true.
   */
  readonly condition?: string | undefined
}

/**
 * Schema for `SetBreakpointOnFunctionCallParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointOnFunctionCallParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId,
    condition: Schema.optional(Schema.String)
  }).annotate({ identifier: "Debugger.SetBreakpointOnFunctionCallParams" })
) as any as Schema.Codec<SetBreakpointOnFunctionCallParams>

/**
 * Sets JavaScript breakpoint before each call to the given function.
 * If another function was created from the same source as a given one,
 * calling it will also trigger the breakpoint.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointOnFunctionCallResult {
  /**
   * Id of the created breakpoint for further reference.
   */
  readonly breakpointId: BreakpointId
}

/**
 * Schema for `SetBreakpointOnFunctionCallResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointOnFunctionCallResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId
  }).annotate({ identifier: "Debugger.SetBreakpointOnFunctionCallResult" })
) as any as Schema.Codec<SetBreakpointOnFunctionCallResult>

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
 * Sets instrumentation breakpoint.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInstrumentationBreakpointParams {
  /**
   * Instrumentation name.
   */
  readonly instrumentation: SetInstrumentationBreakpointParamsInstrumentation
}

/**
 * Schema for `SetInstrumentationBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInstrumentationBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    instrumentation: SetInstrumentationBreakpointParamsInstrumentation
  }).annotate({ identifier: "Debugger.SetInstrumentationBreakpointParams" })
) as any as Schema.Codec<SetInstrumentationBreakpointParams>

/**
 * Instrumentation name.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetInstrumentationBreakpointParamsInstrumentation =
  | "beforeScriptExecution"
  | "beforeScriptWithSourceMapExecution"
  | (string & {})

/**
 * Schema for `SetInstrumentationBreakpointParamsInstrumentation`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInstrumentationBreakpointParamsInstrumentation = Schema.String as any as Schema.Codec<
  SetInstrumentationBreakpointParamsInstrumentation
>

/**
 * Sets instrumentation breakpoint.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInstrumentationBreakpointResult {
  /**
   * Id of the created breakpoint for further reference.
   */
  readonly breakpointId: BreakpointId
}

/**
 * Schema for `SetInstrumentationBreakpointResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInstrumentationBreakpointResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointId: BreakpointId
  }).annotate({ identifier: "Debugger.SetInstrumentationBreakpointResult" })
) as any as Schema.Codec<SetInstrumentationBreakpointResult>

/**
 * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions,
 * or caught exceptions, no exceptions. Initial pause on exceptions state is `none`.
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
    state: SetPauseOnExceptionsParamsState
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
  | "caught"
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
 * Changes return value in top frame. Available only at return break position.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetReturnValueParams {
  /**
   * New return value.
   */
  readonly newValue: Runtime.CallArgument
}

/**
 * Schema for `SetReturnValueParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetReturnValueParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    newValue: Runtime.CallArgument
  }).annotate({ identifier: "Debugger.SetReturnValueParams" })
) as any as Schema.Codec<SetReturnValueParams>

/**
 * Makes page not interrupt on any pauses (breakpoint, exception, dom exception etc).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetSkipAllPausesParams {
  /**
   * New value for skip pauses state.
   */
  readonly skip: boolean
}

/**
 * Schema for `SetSkipAllPausesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetSkipAllPausesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    skip: Schema.Boolean
  }).annotate({ identifier: "Debugger.SetSkipAllPausesParams" })
) as any as Schema.Codec<SetSkipAllPausesParams>

/**
 * Changes value of variable in a callframe. Object-based scopes are not supported and must be
 * mutated manually.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetVariableValueParams {
  /**
   * 0-based number of scope as was listed in scope chain. Only 'local', 'closure' and 'catch'
   * scope types are allowed. Other scopes could be manipulated manually.
   */
  readonly scopeNumber: number
  /**
   * Variable name.
   */
  readonly variableName: string
  /**
   * New variable value.
   */
  readonly newValue: Runtime.CallArgument
  /**
   * Id of callframe that holds variable.
   */
  readonly callFrameId: CallFrameId
}

/**
 * Schema for `SetVariableValueParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetVariableValueParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scopeNumber: Schema.Int,
    variableName: Schema.String,
    newValue: Runtime.CallArgument,
    callFrameId: CallFrameId
  }).annotate({ identifier: "Debugger.SetVariableValueParams" })
) as any as Schema.Codec<SetVariableValueParams>

/**
 * Steps into the function call.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StepIntoParams {
  /**
   * Debugger will pause on the execution of the first async task which was scheduled
   * before next pause.
   */
  readonly breakOnAsyncCall?: boolean | undefined
  /**
   * The skipList specifies location ranges that should be skipped on step into.
   */
  readonly skipList?: ReadonlyArray<LocationRange> | undefined
}

/**
 * Schema for `StepIntoParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StepIntoParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakOnAsyncCall: Schema.optional(Schema.Boolean),
    skipList: Schema.optional(Schema.Array(LocationRange))
  }).annotate({ identifier: "Debugger.StepIntoParams" })
) as any as Schema.Codec<StepIntoParams>

/**
 * Steps over the statement.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StepOverParams {
  /**
   * The skipList specifies location ranges that should be skipped on step over.
   */
  readonly skipList?: ReadonlyArray<LocationRange> | undefined
}

/**
 * Schema for `StepOverParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StepOverParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    skipList: Schema.optional(Schema.Array(LocationRange))
  }).annotate({ identifier: "Debugger.StepOverParams" })
) as any as Schema.Codec<StepOverParams>

/**
 * Continues execution until specific location is reached.
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
 * Sends `Debugger.disassembleWasmModule`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disassembleWasmModule: Protocol.CommandDef<
  "Debugger.disassembleWasmModule",
  DisassembleWasmModuleParams,
  DisassembleWasmModuleResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.disassembleWasmModule",
  DisassembleWasmModuleParams,
  DisassembleWasmModuleResult,
  { status: "experimental" }
)

/**
 * Enables debugger for the given page. Clients should not assume that the debugging has been
 * enabled until the result for this command is received.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Debugger.enable", EnableParams, EnableResult> = /*#__PURE__*/ Protocol
  .command(
    "Debugger.enable",
    EnableParams,
    EnableResult,
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
 * Returns possible locations for breakpoint. scriptId in start and end range locations should be
 * the same.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getPossibleBreakpoints: Protocol.CommandDef<
  "Debugger.getPossibleBreakpoints",
  GetPossibleBreakpointsParams,
  GetPossibleBreakpointsResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.getPossibleBreakpoints",
  GetPossibleBreakpointsParams,
  GetPossibleBreakpointsResult,
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
 * Returns stack trace with given `stackTraceId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getStackTrace: Protocol.CommandDef<"Debugger.getStackTrace", GetStackTraceParams, GetStackTraceResult> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.getStackTrace",
    GetStackTraceParams,
    GetStackTraceResult,
    { status: "experimental" }
  )

/**
 * Disassemble the next chunk of lines for the module corresponding to the
 * stream. If disassembly is complete, this API will invalidate the streamId
 * and return an empty chunk. Any subsequent calls for the now invalid stream
 * will return errors.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const nextWasmDisassemblyChunk: Protocol.CommandDef<
  "Debugger.nextWasmDisassemblyChunk",
  NextWasmDisassemblyChunkParams,
  NextWasmDisassemblyChunkResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.nextWasmDisassemblyChunk",
  NextWasmDisassemblyChunkParams,
  NextWasmDisassemblyChunkResult,
  { status: "experimental" }
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
 * Restarts particular call frame from the beginning. The old, deprecated
 * behavior of `restartFrame` is to stay paused and allow further CDP commands
 * after a restart was scheduled. This can cause problems with restarting, so
 * we now continue execution immediatly after it has been scheduled until we
 * reach the beginning of the restarted frame.
 *
 * To stay back-wards compatible, `restartFrame` now expects a `mode`
 * parameter to be present. If the `mode` parameter is missing, `restartFrame`
 * errors out.
 *
 * The various return values are deprecated and `callFrames` is always empty.
 * Use the call frames from the `Debugger#paused` events instead, that fires
 * once V8 pauses at the beginning of the restarted function.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const restartFrame: Protocol.CommandDef<"Debugger.restartFrame", RestartFrameParams, RestartFrameResult> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.restartFrame",
    RestartFrameParams,
    RestartFrameResult,
    { status: "stable" }
  )

/**
 * Resumes JavaScript execution.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resume: Protocol.CommandDef<"Debugger.resume", ResumeParams, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.resume",
  ResumeParams,
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
 * Enables or disables async call stacks tracking.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAsyncCallStackDepth: Protocol.CommandDef<
  "Debugger.setAsyncCallStackDepth",
  SetAsyncCallStackDepthParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setAsyncCallStackDepth",
  SetAsyncCallStackDepthParams,
  undefined,
  { status: "stable" }
)

/**
 * Replace previous blackbox execution contexts with passed ones. Forces backend to skip
 * stepping/pausing in scripts in these execution contexts. VM will try to leave blackboxed script by
 * performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setBlackboxExecutionContexts: Protocol.CommandDef<
  "Debugger.setBlackboxExecutionContexts",
  SetBlackboxExecutionContextsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setBlackboxExecutionContexts",
  SetBlackboxExecutionContextsParams,
  undefined,
  { status: "experimental" }
)

/**
 * Replace previous blackbox patterns with passed ones. Forces backend to skip stepping/pausing in
 * scripts with url matching one of the patterns. VM will try to leave blackboxed script by
 * performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setBlackboxPatterns: Protocol.CommandDef<"Debugger.setBlackboxPatterns", SetBlackboxPatternsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.setBlackboxPatterns",
    SetBlackboxPatternsParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Makes backend skip steps in the script in blackboxed ranges. VM will try leave blacklisted
 * scripts by performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
 * Positions array contains positions where blackbox state is changed. First interval isn't
 * blackboxed. Array should be sorted.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setBlackboxedRanges: Protocol.CommandDef<"Debugger.setBlackboxedRanges", SetBlackboxedRangesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.setBlackboxedRanges",
    SetBlackboxedRangesParams,
    undefined,
    { status: "experimental" }
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
 * Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this
 * command is issued, all existing parsed scripts will have breakpoints resolved and returned in
 * `locations` property. Further matching script parsing will result in subsequent
 * `breakpointResolved` events issued. This logical breakpoint will survive page reloads.
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
 * Sets JavaScript breakpoint before each call to the given function.
 * If another function was created from the same source as a given one,
 * calling it will also trigger the breakpoint.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setBreakpointOnFunctionCall: Protocol.CommandDef<
  "Debugger.setBreakpointOnFunctionCall",
  SetBreakpointOnFunctionCallParams,
  SetBreakpointOnFunctionCallResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setBreakpointOnFunctionCall",
  SetBreakpointOnFunctionCallParams,
  SetBreakpointOnFunctionCallResult,
  { status: "experimental" }
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
 * Sets instrumentation breakpoint.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInstrumentationBreakpoint: Protocol.CommandDef<
  "Debugger.setInstrumentationBreakpoint",
  SetInstrumentationBreakpointParams,
  SetInstrumentationBreakpointResult
> = /*#__PURE__*/ Protocol.command(
  "Debugger.setInstrumentationBreakpoint",
  SetInstrumentationBreakpointParams,
  SetInstrumentationBreakpointResult,
  { status: "stable" }
)

/**
 * Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions,
 * or caught exceptions, no exceptions. Initial pause on exceptions state is `none`.
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
 * Changes return value in top frame. Available only at return break position.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setReturnValue: Protocol.CommandDef<"Debugger.setReturnValue", SetReturnValueParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.setReturnValue",
    SetReturnValueParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Makes page not interrupt on any pauses (breakpoint, exception, dom exception etc).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setSkipAllPauses: Protocol.CommandDef<"Debugger.setSkipAllPauses", SetSkipAllPausesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.setSkipAllPauses",
    SetSkipAllPausesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Changes value of variable in a callframe. Object-based scopes are not supported and must be
 * mutated manually.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setVariableValue: Protocol.CommandDef<"Debugger.setVariableValue", SetVariableValueParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Debugger.setVariableValue",
    SetVariableValueParams,
    undefined,
    { status: "stable" }
  )

/**
 * Steps into the function call.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stepInto: Protocol.CommandDef<"Debugger.stepInto", StepIntoParams, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.stepInto",
  StepIntoParams,
  undefined,
  { status: "stable" }
)

/**
 * Steps out of the function call.
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
 * Steps over the statement.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stepOver: Protocol.CommandDef<"Debugger.stepOver", StepOverParams, void> = /*#__PURE__*/ Protocol.command(
  "Debugger.stepOver",
  StepOverParams,
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
 * Fired when virtual machine parses script. This event is also fired for all known and uncollected
 * scripts upon enabling debugger.
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
