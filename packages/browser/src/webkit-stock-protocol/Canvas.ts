/**
 * Canvas domain allows tracking of canvases that have an associated graphics context. Tracks canvases in the DOM and CSS canvases created with -webkit-canvas.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Console from "./Console.ts"
import * as DOM from "./DOM.ts"
import * as Recording from "./Recording.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Information about a canvas for which a rendering context has been created.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Canvas {
  /**
   * Canvas identifier.
   */
  readonly canvasId: CanvasId
  /**
   * The type of rendering context backing the canvas.
   */
  readonly contextType: ContextType
  /**
   * Width of the canvas in pixels.
   */
  readonly width: number
  /**
   * Height of the canvas in pixels.
   */
  readonly height: number
  /**
   * The corresponding DOM node id.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * The CSS canvas identifier, for canvases created with <code>document.getCSSCanvasContext</code>.
   */
  readonly cssCanvasName?: string | undefined
  /**
   * Context attributes for rendering contexts.
   */
  readonly contextAttributes?: ContextAttributes | undefined
  /**
   * Memory usage of the canvas in bytes.
   */
  readonly memoryCost?: number | undefined
  /**
   * Backtrace that was captured when this canvas context was created.
   */
  readonly stackTrace?: Console.StackTrace | undefined
}

/**
 * Schema for `Canvas`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Canvas = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    contextType: ContextType,
    width: Schema.Number,
    height: Schema.Number,
    nodeId: Schema.optional(DOM.NodeId),
    cssCanvasName: Schema.optional(Schema.String),
    contextAttributes: Schema.optional(ContextAttributes),
    memoryCost: Schema.optional(Schema.Number),
    stackTrace: Schema.optional(Console.StackTrace)
  }).annotate({ identifier: "Canvas.Canvas" })
) as any as Schema.Codec<Canvas, unknown>

/**
 * Unique canvas identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CanvasId = Brand.Branded<string, "~@usestrider/browser/webkit-stock-protocol/Canvas/CanvasId">

/**
 * Schema for `CanvasId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CanvasId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/Canvas/CanvasId")
) as any as Schema.Codec<CanvasId>

/**
 * `ColorSpace` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ColorSpace =
  | "srgb"
  | "srgb-linear"
  | "display-p3"
  | "display-p3-linear"
  | (string & {})

/**
 * Schema for `ColorSpace`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ColorSpace = Schema.String as any as Schema.Codec<ColorSpace>

/**
 * Drawing surface attributes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContextAttributes {
  /**
   * WebGL, WebGL2, ImageBitmapRenderingContext
   */
  readonly alpha?: boolean | undefined
  /**
   * 2D
   */
  readonly colorSpace?: ColorSpace | undefined
  /**
   * 2D
   */
  readonly desynchronized?: boolean | undefined
  /**
   * 2D
   */
  readonly willReadFrequently?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly depth?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly stencil?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly antialias?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly premultipliedAlpha?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly preserveDrawingBuffer?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly failIfMajorPerformanceCaveat?: boolean | undefined
  /**
   * WebGL, WebGL2
   */
  readonly powerPreference?: string | undefined
}

/**
 * Schema for `ContextAttributes`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextAttributes = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    alpha: Schema.optional(Schema.Boolean),
    colorSpace: Schema.optional(ColorSpace),
    desynchronized: Schema.optional(Schema.Boolean),
    willReadFrequently: Schema.optional(Schema.Boolean),
    depth: Schema.optional(Schema.Boolean),
    stencil: Schema.optional(Schema.Boolean),
    antialias: Schema.optional(Schema.Boolean),
    premultipliedAlpha: Schema.optional(Schema.Boolean),
    preserveDrawingBuffer: Schema.optional(Schema.Boolean),
    failIfMajorPerformanceCaveat: Schema.optional(Schema.Boolean),
    powerPreference: Schema.optional(Schema.String)
  }).annotate({ identifier: "Canvas.ContextAttributes" })
) as any as Schema.Codec<ContextAttributes>

/**
 * The type of rendering context backing the canvas element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContextType =
  | "canvas-2d"
  | "offscreen-canvas-2d"
  | "bitmaprenderer"
  | "offscreen-bitmaprenderer"
  | "webgl"
  | "offscreen-webgl"
  | "webgl2"
  | "offscreen-webgl2"
  | (string & {})

/**
 * Schema for `ContextType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextType = Schema.String as any as Schema.Codec<ContextType>

/**
 * Unique shader program identifier. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ProgramId = Brand.Branded<string, "~@usestrider/browser/webkit-stock-protocol/Canvas/ProgramId">

/**
 * Schema for `ProgramId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProgramId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/Canvas/ProgramId")
) as any as Schema.Codec<ProgramId>

/**
 * `ProgramType` values. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ProgramType =
  | "compute"
  | "render"
  | (string & {})

/**
 * Schema for `ProgramType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProgramType = Schema.String as any as Schema.Codec<ProgramType>

/**
 * Information about a WebGL/WebGL2 shader program. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ShaderProgram {
  readonly programId: ProgramId
  readonly programType: ProgramType
  readonly canvasId: CanvasId
}

/**
 * Schema for `ShaderProgram`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShaderProgram = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    programId: ProgramId,
    programType: ProgramType,
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.ShaderProgram" })
) as any as Schema.Codec<ShaderProgram>

/**
 * `ShaderType` values. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ShaderType =
  | "compute"
  | "fragment"
  | "vertex"
  | (string & {})

/**
 * Schema for `ShaderType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShaderType = Schema.String as any as Schema.Codec<ShaderType>

/**
 * `canvasAdded.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CanvasAddedParams {
  /**
   * Canvas object.
   */
  readonly canvas: Canvas
}

/**
 * Schema for `CanvasAddedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CanvasAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvas: Canvas
  }).annotate({ identifier: "Canvas.CanvasAddedParams" })
) as any as Schema.Codec<CanvasAddedParams, unknown>

/**
 * `canvasMemoryChanged.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CanvasMemoryChangedParams {
  /**
   * Identifier of canvas that changed.
   */
  readonly canvasId: CanvasId
  /**
   * New memory cost value for the canvas in bytes.
   */
  readonly memoryCost: number
}

/**
 * Schema for `CanvasMemoryChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CanvasMemoryChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    memoryCost: Schema.Number
  }).annotate({ identifier: "Canvas.CanvasMemoryChangedParams" })
) as any as Schema.Codec<CanvasMemoryChangedParams>

/**
 * `canvasRemoved.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CanvasRemovedParams {
  /**
   * Removed canvas identifier.
   */
  readonly canvasId: CanvasId
}

/**
 * Schema for `CanvasRemovedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CanvasRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.CanvasRemovedParams" })
) as any as Schema.Codec<CanvasRemovedParams>

/**
 * `canvasSizeChanged.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CanvasSizeChangedParams {
  /**
   * Identifier of canvas that changed.
   */
  readonly canvasId: CanvasId
  /**
   * Width of the canvas in pixels.
   */
  readonly width: number
  /**
   * Height of the canvas in pixels.
   */
  readonly height: number
}

/**
 * Schema for `CanvasSizeChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CanvasSizeChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    width: Schema.Number,
    height: Schema.Number
  }).annotate({ identifier: "Canvas.CanvasSizeChangedParams" })
) as any as Schema.Codec<CanvasSizeChangedParams>

/**
 * `clientNodesChanged.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClientNodesChangedParams {
  /**
   * Identifier of canvas that changed.
   */
  readonly canvasId: CanvasId
}

/**
 * Schema for `ClientNodesChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClientNodesChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.ClientNodesChangedParams" })
) as any as Schema.Codec<ClientNodesChangedParams>

/**
 * `extensionEnabled.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExtensionEnabledParams {
  readonly canvasId: CanvasId
  /**
   * Name of the extension that was enabled.
   */
  readonly extension: string
}

/**
 * Schema for `ExtensionEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    extension: Schema.String
  }).annotate({ identifier: "Canvas.ExtensionEnabledParams" })
) as any as Schema.Codec<ExtensionEnabledParams>

/**
 * `programCreated.Params`. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProgramCreatedParams {
  readonly shaderProgram: ShaderProgram
}

/**
 * Schema for `ProgramCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProgramCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    shaderProgram: ShaderProgram
  }).annotate({ identifier: "Canvas.ProgramCreatedParams" })
) as any as Schema.Codec<ProgramCreatedParams>

/**
 * `programDeleted.Params`. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProgramDeletedParams {
  readonly programId: ProgramId
}

/**
 * Schema for `ProgramDeletedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProgramDeletedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    programId: ProgramId
  }).annotate({ identifier: "Canvas.ProgramDeletedParams" })
) as any as Schema.Codec<ProgramDeletedParams>

/**
 * `recordingFinished.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RecordingFinishedParams {
  readonly canvasId: CanvasId
  readonly recording?: Recording.Recording | undefined
}

/**
 * Schema for `RecordingFinishedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RecordingFinishedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    recording: Schema.optional(Recording.Recording)
  }).annotate({ identifier: "Canvas.RecordingFinishedParams" })
) as any as Schema.Codec<RecordingFinishedParams>

/**
 * `recordingProgress.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RecordingProgressParams {
  readonly canvasId: CanvasId
  readonly frames: ReadonlyArray<Recording.Frame>
  /**
   * Total memory size in bytes of all data recorded since the recording began.
   */
  readonly bufferUsed: number
}

/**
 * Schema for `RecordingProgressParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RecordingProgressParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    frames: Schema.Array(Recording.Frame),
    bufferUsed: Schema.Int
  }).annotate({ identifier: "Canvas.RecordingProgressParams" })
) as any as Schema.Codec<RecordingProgressParams>

/**
 * `recordingStarted.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RecordingStartedParams {
  readonly canvasId: CanvasId
  readonly initiator: Recording.Initiator
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
    canvasId: CanvasId,
    initiator: Recording.Initiator
  }).annotate({ identifier: "Canvas.RecordingStartedParams" })
) as any as Schema.Codec<RecordingStartedParams>

/**
 * Gets all <code>-webkit-canvas</code> nodes or active <code>HTMLCanvasElement</code> for a <code>WebGPUDevice</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestClientNodesParams {
  readonly canvasId: CanvasId
}

/**
 * Schema for `RequestClientNodesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestClientNodesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.RequestClientNodesParams" })
) as any as Schema.Codec<RequestClientNodesParams>

/**
 * Gets all <code>-webkit-canvas</code> nodes or active <code>HTMLCanvasElement</code> for a <code>WebGPUDevice</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestClientNodesResult {
  readonly clientNodeIds: ReadonlyArray<DOM.NodeId>
}

/**
 * Schema for `RequestClientNodesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestClientNodesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    clientNodeIds: Schema.Array(DOM.NodeId)
  }).annotate({ identifier: "Canvas.RequestClientNodesResult" })
) as any as Schema.Codec<RequestClientNodesResult>

/**
 * Gets the data for the canvas node with the given CanvasId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestContentParams {
  /**
   * Canvas identifier.
   */
  readonly canvasId: CanvasId
}

/**
 * Schema for `RequestContentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.RequestContentParams" })
) as any as Schema.Codec<RequestContentParams>

/**
 * Gets the data for the canvas node with the given CanvasId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestContentResult {
  /**
   * Base64-encoded data of the canvas' contents.
   */
  readonly content: string
}

/**
 * Schema for `RequestContentResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestContentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    content: Schema.String
  }).annotate({ identifier: "Canvas.RequestContentResult" })
) as any as Schema.Codec<RequestContentResult>

/**
 * Gets the NodeId for the canvas node with the given CanvasId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestNodeParams {
  /**
   * Canvas identifier.
   */
  readonly canvasId: CanvasId
}

/**
 * Schema for `RequestNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.RequestNodeParams" })
) as any as Schema.Codec<RequestNodeParams>

/**
 * Gets the NodeId for the canvas node with the given CanvasId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestNodeResult {
  /**
   * Node identifier for given canvas.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `RequestNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Canvas.RequestNodeResult" })
) as any as Schema.Codec<RequestNodeResult>

/**
 * Requests the source of the shader of the given type from the program with the given id. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestShaderSourceParams {
  readonly programId: ProgramId
  readonly shaderType: ShaderType
}

/**
 * Schema for `RequestShaderSourceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestShaderSourceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    programId: ProgramId,
    shaderType: ShaderType
  }).annotate({ identifier: "Canvas.RequestShaderSourceParams" })
) as any as Schema.Codec<RequestShaderSourceParams>

/**
 * Requests the source of the shader of the given type from the program with the given id. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestShaderSourceResult {
  readonly source: string
}

/**
 * Schema for `RequestShaderSourceResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestShaderSourceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: Schema.String
  }).annotate({ identifier: "Canvas.RequestShaderSourceResult" })
) as any as Schema.Codec<RequestShaderSourceResult>

/**
 * Resolves JavaScript canvas/device context object for given canvasId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveContextParams {
  /**
   * Canvas identifier.
   */
  readonly canvasId: CanvasId
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
}

/**
 * Schema for `ResolveContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "Canvas.ResolveContextParams" })
) as any as Schema.Codec<ResolveContextParams>

/**
 * Resolves JavaScript canvas/device context object for given canvasId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveContextResult {
  /**
   * JavaScript object wrapper for given canvas context.
   */
  readonly object: Runtime.RemoteObject
}

/**
 * Schema for `ResolveContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveContextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: Runtime.RemoteObject
  }).annotate({ identifier: "Canvas.ResolveContextResult" })
) as any as Schema.Codec<ResolveContextResult, unknown>

/**
 * Tells the backend to record `count` frames whenever a new context is created.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetRecordingAutoCaptureFrameCountParams {
  /**
   * Number of frames to record (0 means don't record anything).
   */
  readonly count: number
}

/**
 * Schema for `SetRecordingAutoCaptureFrameCountParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetRecordingAutoCaptureFrameCountParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    count: Schema.Int
  }).annotate({ identifier: "Canvas.SetRecordingAutoCaptureFrameCountParams" })
) as any as Schema.Codec<SetRecordingAutoCaptureFrameCountParams>

/**
 * Enable/disable the visibility of the given shader program. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetShaderProgramDisabledParams {
  readonly programId: ProgramId
  readonly disabled: boolean
}

/**
 * Schema for `SetShaderProgramDisabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetShaderProgramDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    programId: ProgramId,
    disabled: Schema.Boolean
  }).annotate({ identifier: "Canvas.SetShaderProgramDisabledParams" })
) as any as Schema.Codec<SetShaderProgramDisabledParams>

/**
 * Enable/disable highlighting of the given shader program. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetShaderProgramHighlightedParams {
  readonly programId: ProgramId
  readonly highlighted: boolean
}

/**
 * Schema for `SetShaderProgramHighlightedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetShaderProgramHighlightedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    programId: ProgramId,
    highlighted: Schema.Boolean
  }).annotate({ identifier: "Canvas.SetShaderProgramHighlightedParams" })
) as any as Schema.Codec<SetShaderProgramHighlightedParams>

/**
 * Record the next frame, or up to the given number of bytes of data, for the given canvas.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartRecordingParams {
  readonly canvasId: CanvasId
  /**
   * Number of frames to record (unlimited when not specified).
   */
  readonly frameCount?: number | undefined
  /**
   * Memory limit of recorded data (100MB when not specified).
   */
  readonly memoryLimit?: number | undefined
}

/**
 * Schema for `StartRecordingParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartRecordingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId,
    frameCount: Schema.optional(Schema.Int),
    memoryLimit: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Canvas.StartRecordingParams" })
) as any as Schema.Codec<StartRecordingParams>

/**
 * Stop recording the given canvas.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StopRecordingParams {
  readonly canvasId: CanvasId
}

/**
 * Schema for `StopRecordingParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StopRecordingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    canvasId: CanvasId
  }).annotate({ identifier: "Canvas.StopRecordingParams" })
) as any as Schema.Codec<StopRecordingParams>

/**
 * Compiles and links the shader with identifier and type with the given source code. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UpdateShaderParams {
  readonly programId: ProgramId
  readonly shaderType: ShaderType
  readonly source: string
}

/**
 * Schema for `UpdateShaderParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UpdateShaderParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    programId: ProgramId,
    shaderType: ShaderType,
    source: Schema.String
  }).annotate({ identifier: "Canvas.UpdateShaderParams" })
) as any as Schema.Codec<UpdateShaderParams>

/**
 * Disables Canvas domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Canvas.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Canvas.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables Canvas domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Canvas.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Canvas.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Gets all <code>-webkit-canvas</code> nodes or active <code>HTMLCanvasElement</code> for a <code>WebGPUDevice</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestClientNodes: Protocol.CommandDef<
  "Canvas.requestClientNodes",
  RequestClientNodesParams,
  RequestClientNodesResult
> = /*#__PURE__*/ Protocol.command(
  "Canvas.requestClientNodes",
  RequestClientNodesParams,
  RequestClientNodesResult,
  { status: "stable" }
)

/**
 * Gets the data for the canvas node with the given CanvasId.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestContent: Protocol.CommandDef<"Canvas.requestContent", RequestContentParams, RequestContentResult> =
  /*#__PURE__*/ Protocol.command(
    "Canvas.requestContent",
    RequestContentParams,
    RequestContentResult,
    { status: "stable" }
  )

/**
 * Gets the NodeId for the canvas node with the given CanvasId.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestNode: Protocol.CommandDef<"Canvas.requestNode", RequestNodeParams, RequestNodeResult> =
  /*#__PURE__*/ Protocol.command(
    "Canvas.requestNode",
    RequestNodeParams,
    RequestNodeResult,
    { status: "stable" }
  )

/**
 * Requests the source of the shader of the given type from the program with the given id. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestShaderSource: Protocol.CommandDef<
  "Canvas.requestShaderSource",
  RequestShaderSourceParams,
  RequestShaderSourceResult
> = /*#__PURE__*/ Protocol.command(
  "Canvas.requestShaderSource",
  RequestShaderSourceParams,
  RequestShaderSourceResult,
  { status: "stable" }
)

/**
 * Resolves JavaScript canvas/device context object for given canvasId.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveContext: Protocol.CommandDef<"Canvas.resolveContext", ResolveContextParams, ResolveContextResult> =
  /*#__PURE__*/ Protocol.command(
    "Canvas.resolveContext",
    ResolveContextParams,
    ResolveContextResult,
    { status: "stable" }
  )

/**
 * Tells the backend to record `count` frames whenever a new context is created.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setRecordingAutoCaptureFrameCount: Protocol.CommandDef<
  "Canvas.setRecordingAutoCaptureFrameCount",
  SetRecordingAutoCaptureFrameCountParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Canvas.setRecordingAutoCaptureFrameCount",
  SetRecordingAutoCaptureFrameCountParams,
  undefined,
  { status: "stable" }
)

/**
 * Enable/disable the visibility of the given shader program. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setShaderProgramDisabled: Protocol.CommandDef<
  "Canvas.setShaderProgramDisabled",
  SetShaderProgramDisabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Canvas.setShaderProgramDisabled",
  SetShaderProgramDisabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Enable/disable highlighting of the given shader program. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setShaderProgramHighlighted: Protocol.CommandDef<
  "Canvas.setShaderProgramHighlighted",
  SetShaderProgramHighlightedParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Canvas.setShaderProgramHighlighted",
  SetShaderProgramHighlightedParams,
  undefined,
  { status: "stable" }
)

/**
 * Record the next frame, or up to the given number of bytes of data, for the given canvas.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startRecording: Protocol.CommandDef<"Canvas.startRecording", StartRecordingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Canvas.startRecording",
    StartRecordingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Stop recording the given canvas.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopRecording: Protocol.CommandDef<"Canvas.stopRecording", StopRecordingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Canvas.stopRecording",
    StopRecordingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Compiles and links the shader with identifier and type with the given source code. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const updateShader: Protocol.CommandDef<"Canvas.updateShader", UpdateShaderParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Canvas.updateShader",
    UpdateShaderParams,
    undefined,
    { status: "stable" }
  )

/**
 * The `Canvas.canvasAdded` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const canvasAdded: Protocol.EventDef<"Canvas.canvasAdded", CanvasAddedParams> = /*#__PURE__*/ Protocol.event(
  "Canvas.canvasAdded",
  CanvasAddedParams,
  { status: "stable" }
)

/**
 * The `Canvas.canvasMemoryChanged` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const canvasMemoryChanged: Protocol.EventDef<"Canvas.canvasMemoryChanged", CanvasMemoryChangedParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.canvasMemoryChanged",
    CanvasMemoryChangedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.canvasRemoved` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const canvasRemoved: Protocol.EventDef<"Canvas.canvasRemoved", CanvasRemovedParams> = /*#__PURE__*/ Protocol
  .event(
    "Canvas.canvasRemoved",
    CanvasRemovedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.canvasSizeChanged` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const canvasSizeChanged: Protocol.EventDef<"Canvas.canvasSizeChanged", CanvasSizeChangedParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.canvasSizeChanged",
    CanvasSizeChangedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.clientNodesChanged` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const clientNodesChanged: Protocol.EventDef<"Canvas.clientNodesChanged", ClientNodesChangedParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.clientNodesChanged",
    ClientNodesChangedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.extensionEnabled` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const extensionEnabled: Protocol.EventDef<"Canvas.extensionEnabled", ExtensionEnabledParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.extensionEnabled",
    ExtensionEnabledParams,
    { status: "stable" }
  )

/**
 * The `Canvas.programCreated` event. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const programCreated: Protocol.EventDef<"Canvas.programCreated", ProgramCreatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Canvas.programCreated",
    ProgramCreatedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.programDeleted` event. Only in builds compiled with `defined(ENABLE_WEBGL) && ENABLE_WEBGL`.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const programDeleted: Protocol.EventDef<"Canvas.programDeleted", ProgramDeletedParams> = /*#__PURE__*/ Protocol
  .event(
    "Canvas.programDeleted",
    ProgramDeletedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.recordingFinished` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const recordingFinished: Protocol.EventDef<"Canvas.recordingFinished", RecordingFinishedParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.recordingFinished",
    RecordingFinishedParams,
    { status: "stable" }
  )

/**
 * The `Canvas.recordingProgress` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const recordingProgress: Protocol.EventDef<"Canvas.recordingProgress", RecordingProgressParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.recordingProgress",
    RecordingProgressParams,
    { status: "stable" }
  )

/**
 * The `Canvas.recordingStarted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const recordingStarted: Protocol.EventDef<"Canvas.recordingStarted", RecordingStartedParams> =
  /*#__PURE__*/ Protocol.event(
    "Canvas.recordingStarted",
    RecordingStartedParams,
    { status: "stable" }
  )
