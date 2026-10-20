/**
 * The LayerTree domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"

/**
 * Information about a compositing layer.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Layer {
  /**
   * The unique id for this layer.
   */
  readonly layerId: LayerId
  /**
   * The id of parent (not present for root).
   */
  readonly parentLayerId?: LayerId | undefined
  /**
   * The backend id for the node associated with this layer.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * Offset from parent layer, X coordinate.
   */
  readonly offsetX: number
  /**
   * Offset from parent layer, Y coordinate.
   */
  readonly offsetY: number
  /**
   * Layer width.
   */
  readonly width: number
  /**
   * Layer height.
   */
  readonly height: number
  /**
   * Transformation matrix for layer, default is identity matrix
   */
  readonly transform?: ReadonlyArray<number> | undefined
  /**
   * Transform anchor point X, absent if no transform specified
   */
  readonly anchorX?: number | undefined
  /**
   * Transform anchor point Y, absent if no transform specified
   */
  readonly anchorY?: number | undefined
  /**
   * Transform anchor point Z, absent if no transform specified
   */
  readonly anchorZ?: number | undefined
  /**
   * Indicates how many time this layer has painted.
   */
  readonly paintCount: number
  /**
   * Indicates whether this layer hosts any content, rather than being used for
   * transform/scrolling purposes only.
   */
  readonly drawsContent: boolean
  /**
   * Set if layer is not visible.
   */
  readonly invisible?: boolean | undefined
  /**
   * Rectangles scrolling on main thread only.
   */
  readonly scrollRects?: ReadonlyArray<ScrollRect> | undefined
  /**
   * Sticky position constraint information
   */
  readonly stickyPositionConstraint?: StickyPositionConstraint | undefined
}

/**
 * Schema for `Layer`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Layer = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layerId: LayerId,
    parentLayerId: Schema.optional(LayerId),
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    offsetX: Schema.Number,
    offsetY: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
    transform: Schema.optional(Schema.Array(Schema.Number)),
    anchorX: Schema.optional(Schema.Number),
    anchorY: Schema.optional(Schema.Number),
    anchorZ: Schema.optional(Schema.Number),
    paintCount: Schema.Int,
    drawsContent: Schema.Boolean,
    invisible: Schema.optional(Schema.Boolean),
    scrollRects: Schema.optional(Schema.Array(ScrollRect)),
    stickyPositionConstraint: Schema.optional(StickyPositionConstraint)
  }).annotate({ identifier: "LayerTree.Layer" })
) as any as Schema.Codec<Layer>

/**
 * Unique Layer identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type LayerId = Brand.Branded<string, "~@usestrider/browser/cdp/LayerTree/LayerId">

/**
 * Schema for `LayerId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayerId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/LayerTree/LayerId")
) as any as Schema.Codec<LayerId>

/**
 * Array of timings, one per paint step.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PaintProfile = ReadonlyArray<number>

/**
 * Schema for `PaintProfile`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PaintProfile = /*#__PURE__*/ Schema.suspend(() => Schema.Array(Schema.Number)) as any as Schema.Codec<
  PaintProfile
>

/**
 * Serialized fragment of layer picture along with its offset within the layer.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PictureTile {
  /**
   * Offset from owning layer left boundary
   */
  readonly x: number
  /**
   * Offset from owning layer top boundary
   */
  readonly y: number
  /**
   * Base64-encoded snapshot data. (Encoded as a base64 string when passed over JSON)
   */
  readonly picture: string
}

/**
 * Schema for `PictureTile`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PictureTile = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    picture: Schema.String
  }).annotate({ identifier: "LayerTree.PictureTile" })
) as any as Schema.Codec<PictureTile>

/**
 * Rectangle where scrolling happens on the main thread.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScrollRect {
  /**
   * Rectangle itself.
   */
  readonly rect: DOM.Rect
  /**
   * Reason for rectangle to force scrolling on the main thread
   */
  readonly type: ScrollRectType
}

/**
 * Schema for `ScrollRect`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScrollRect = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rect: DOM.Rect,
    type: ScrollRectType
  }).annotate({ identifier: "LayerTree.ScrollRect" })
) as any as Schema.Codec<ScrollRect>

/**
 * Reason for rectangle to force scrolling on the main thread
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ScrollRectType =
  | "RepaintsOnScroll"
  | "TouchEventHandler"
  | "WheelEventHandler"
  | (string & {})

/**
 * Schema for `ScrollRectType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScrollRectType = Schema.String as any as Schema.Codec<ScrollRectType>

/**
 * Unique snapshot identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SnapshotId = Brand.Branded<string, "~@usestrider/browser/cdp/LayerTree/SnapshotId">

/**
 * Schema for `SnapshotId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/LayerTree/SnapshotId")
) as any as Schema.Codec<SnapshotId>

/**
 * Sticky position constraints.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StickyPositionConstraint {
  /**
   * Layout rectangle of the sticky element before being shifted
   */
  readonly stickyBoxRect: DOM.Rect
  /**
   * Layout rectangle of the containing block of the sticky element
   */
  readonly containingBlockRect: DOM.Rect
  /**
   * The nearest sticky layer that shifts the sticky box
   */
  readonly nearestLayerShiftingStickyBox?: LayerId | undefined
  /**
   * The nearest sticky layer that shifts the containing block
   */
  readonly nearestLayerShiftingContainingBlock?: LayerId | undefined
}

/**
 * Schema for `StickyPositionConstraint`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StickyPositionConstraint = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stickyBoxRect: DOM.Rect,
    containingBlockRect: DOM.Rect,
    nearestLayerShiftingStickyBox: Schema.optional(LayerId),
    nearestLayerShiftingContainingBlock: Schema.optional(LayerId)
  }).annotate({ identifier: "LayerTree.StickyPositionConstraint" })
) as any as Schema.Codec<StickyPositionConstraint>

/**
 * Provides the reasons why the given layer was composited.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CompositingReasonsParams {
  /**
   * The id of the layer for which we want to get the reasons it was composited.
   */
  readonly layerId: LayerId
}

/**
 * Schema for `CompositingReasonsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CompositingReasonsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layerId: LayerId
  }).annotate({ identifier: "LayerTree.CompositingReasonsParams" })
) as any as Schema.Codec<CompositingReasonsParams>

/**
 * Provides the reasons why the given layer was composited.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CompositingReasonsResult {
  /**
   * A list of strings specifying reasons for the given layer to become composited.
   */
  readonly compositingReasons: ReadonlyArray<string>
  /**
   * A list of strings specifying reason IDs for the given layer to become composited.
   */
  readonly compositingReasonIds: ReadonlyArray<string>
}

/**
 * Schema for `CompositingReasonsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CompositingReasonsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    compositingReasons: Schema.Array(Schema.String),
    compositingReasonIds: Schema.Array(Schema.String)
  }).annotate({ identifier: "LayerTree.CompositingReasonsResult" })
) as any as Schema.Codec<CompositingReasonsResult>

/**
 * `layerPainted.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LayerPaintedParams {
  /**
   * The id of the painted layer.
   */
  readonly layerId: LayerId
  /**
   * Clip rectangle.
   */
  readonly clip: DOM.Rect
}

/**
 * Schema for `LayerPaintedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayerPaintedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layerId: LayerId,
    clip: DOM.Rect
  }).annotate({ identifier: "LayerTree.LayerPaintedParams" })
) as any as Schema.Codec<LayerPaintedParams>

/**
 * `layerTreeDidChange.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LayerTreeDidChangeParams {
  /**
   * Layer tree, absent if not in the compositing mode.
   */
  readonly layers?: ReadonlyArray<Layer> | undefined
}

/**
 * Schema for `LayerTreeDidChangeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayerTreeDidChangeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layers: Schema.optional(Schema.Array(Layer))
  }).annotate({ identifier: "LayerTree.LayerTreeDidChangeParams" })
) as any as Schema.Codec<LayerTreeDidChangeParams>

/**
 * Returns the snapshot identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadSnapshotParams {
  /**
   * An array of tiles composing the snapshot.
   */
  readonly tiles: ReadonlyArray<PictureTile>
}

/**
 * Schema for `LoadSnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    tiles: Schema.Array(PictureTile)
  }).annotate({ identifier: "LayerTree.LoadSnapshotParams" })
) as any as Schema.Codec<LoadSnapshotParams>

/**
 * Returns the snapshot identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadSnapshotResult {
  /**
   * The id of the snapshot.
   */
  readonly snapshotId: SnapshotId
}

/**
 * Schema for `LoadSnapshotResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadSnapshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapshotId: SnapshotId
  }).annotate({ identifier: "LayerTree.LoadSnapshotResult" })
) as any as Schema.Codec<LoadSnapshotResult>

/**
 * Returns the layer snapshot identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface MakeSnapshotParams {
  /**
   * The id of the layer.
   */
  readonly layerId: LayerId
}

/**
 * Schema for `MakeSnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MakeSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layerId: LayerId
  }).annotate({ identifier: "LayerTree.MakeSnapshotParams" })
) as any as Schema.Codec<MakeSnapshotParams>

/**
 * Returns the layer snapshot identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface MakeSnapshotResult {
  /**
   * The id of the layer snapshot.
   */
  readonly snapshotId: SnapshotId
}

/**
 * Schema for `MakeSnapshotResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MakeSnapshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapshotId: SnapshotId
  }).annotate({ identifier: "LayerTree.MakeSnapshotResult" })
) as any as Schema.Codec<MakeSnapshotResult>

/**
 * `profileSnapshot.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ProfileSnapshotParams {
  /**
   * The id of the layer snapshot.
   */
  readonly snapshotId: SnapshotId
  /**
   * The maximum number of times to replay the snapshot (1, if not specified).
   */
  readonly minRepeatCount?: number | undefined
  /**
   * The minimum duration (in seconds) to replay the snapshot.
   */
  readonly minDuration?: number | undefined
  /**
   * The clip rectangle to apply when replaying the snapshot.
   */
  readonly clipRect?: DOM.Rect | undefined
}

/**
 * Schema for `ProfileSnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ProfileSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapshotId: SnapshotId,
    minRepeatCount: Schema.optional(Schema.Int),
    minDuration: Schema.optional(Schema.Number),
    clipRect: Schema.optional(DOM.Rect)
  }).annotate({ identifier: "LayerTree.ProfileSnapshotParams" })
) as any as Schema.Codec<ProfileSnapshotParams>

/**
 * `profileSnapshot.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ProfileSnapshotResult {
  /**
   * The array of paint profiles, one per run.
   */
  readonly timings: ReadonlyArray<PaintProfile>
}

/**
 * Schema for `ProfileSnapshotResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ProfileSnapshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timings: Schema.Array(PaintProfile)
  }).annotate({ identifier: "LayerTree.ProfileSnapshotResult" })
) as any as Schema.Codec<ProfileSnapshotResult>

/**
 * Releases layer snapshot captured by the back-end.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReleaseSnapshotParams {
  /**
   * The id of the layer snapshot.
   */
  readonly snapshotId: SnapshotId
}

/**
 * Schema for `ReleaseSnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapshotId: SnapshotId
  }).annotate({ identifier: "LayerTree.ReleaseSnapshotParams" })
) as any as Schema.Codec<ReleaseSnapshotParams>

/**
 * Replays the layer snapshot and returns the resulting bitmap.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReplaySnapshotParams {
  /**
   * The id of the layer snapshot.
   */
  readonly snapshotId: SnapshotId
  /**
   * The first step to replay from (replay from the very start if not specified).
   */
  readonly fromStep?: number | undefined
  /**
   * The last step to replay to (replay till the end if not specified).
   */
  readonly toStep?: number | undefined
  /**
   * The scale to apply while replaying (defaults to 1).
   */
  readonly scale?: number | undefined
}

/**
 * Schema for `ReplaySnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReplaySnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapshotId: SnapshotId,
    fromStep: Schema.optional(Schema.Int),
    toStep: Schema.optional(Schema.Int),
    scale: Schema.optional(Schema.Number)
  }).annotate({ identifier: "LayerTree.ReplaySnapshotParams" })
) as any as Schema.Codec<ReplaySnapshotParams>

/**
 * Replays the layer snapshot and returns the resulting bitmap.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReplaySnapshotResult {
  /**
   * A data: URL for resulting image.
   */
  readonly dataURL: string
}

/**
 * Schema for `ReplaySnapshotResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReplaySnapshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataURL: Schema.String
  }).annotate({ identifier: "LayerTree.ReplaySnapshotResult" })
) as any as Schema.Codec<ReplaySnapshotResult>

/**
 * Replays the layer snapshot and returns canvas log.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SnapshotCommandLogParams {
  /**
   * The id of the layer snapshot.
   */
  readonly snapshotId: SnapshotId
}

/**
 * Schema for `SnapshotCommandLogParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotCommandLogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapshotId: SnapshotId
  }).annotate({ identifier: "LayerTree.SnapshotCommandLogParams" })
) as any as Schema.Codec<SnapshotCommandLogParams>

/**
 * Replays the layer snapshot and returns canvas log.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SnapshotCommandLogResult {
  /**
   * The array of canvas function calls.
   */
  readonly commandLog: ReadonlyArray<{ readonly [key: string]: unknown }>
}

/**
 * Schema for `SnapshotCommandLogResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotCommandLogResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    commandLog: Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "LayerTree.SnapshotCommandLogResult" })
) as any as Schema.Codec<SnapshotCommandLogResult>

/**
 * Provides the reasons why the given layer was composited.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const compositingReasons: Protocol.CommandDef<
  "LayerTree.compositingReasons",
  CompositingReasonsParams,
  CompositingReasonsResult
> = /*#__PURE__*/ Protocol.command(
  "LayerTree.compositingReasons",
  CompositingReasonsParams,
  CompositingReasonsResult,
  { status: "stable" }
)

/**
 * Disables compositing tree inspection.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"LayerTree.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "LayerTree.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables compositing tree inspection.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"LayerTree.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "LayerTree.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Returns the snapshot identifier.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const loadSnapshot: Protocol.CommandDef<"LayerTree.loadSnapshot", LoadSnapshotParams, LoadSnapshotResult> =
  /*#__PURE__*/ Protocol.command(
    "LayerTree.loadSnapshot",
    LoadSnapshotParams,
    LoadSnapshotResult,
    { status: "stable" }
  )

/**
 * Returns the layer snapshot identifier.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const makeSnapshot: Protocol.CommandDef<"LayerTree.makeSnapshot", MakeSnapshotParams, MakeSnapshotResult> =
  /*#__PURE__*/ Protocol.command(
    "LayerTree.makeSnapshot",
    MakeSnapshotParams,
    MakeSnapshotResult,
    { status: "stable" }
  )

/**
 * Sends `LayerTree.profileSnapshot`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const profileSnapshot: Protocol.CommandDef<
  "LayerTree.profileSnapshot",
  ProfileSnapshotParams,
  ProfileSnapshotResult
> = /*#__PURE__*/ Protocol.command(
  "LayerTree.profileSnapshot",
  ProfileSnapshotParams,
  ProfileSnapshotResult,
  { status: "stable" }
)

/**
 * Releases layer snapshot captured by the back-end.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const releaseSnapshot: Protocol.CommandDef<"LayerTree.releaseSnapshot", ReleaseSnapshotParams, void> =
  /*#__PURE__*/ Protocol.command(
    "LayerTree.releaseSnapshot",
    ReleaseSnapshotParams,
    undefined,
    { status: "stable" }
  )

/**
 * Replays the layer snapshot and returns the resulting bitmap.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const replaySnapshot: Protocol.CommandDef<
  "LayerTree.replaySnapshot",
  ReplaySnapshotParams,
  ReplaySnapshotResult
> = /*#__PURE__*/ Protocol.command(
  "LayerTree.replaySnapshot",
  ReplaySnapshotParams,
  ReplaySnapshotResult,
  { status: "stable" }
)

/**
 * Replays the layer snapshot and returns canvas log.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const snapshotCommandLog: Protocol.CommandDef<
  "LayerTree.snapshotCommandLog",
  SnapshotCommandLogParams,
  SnapshotCommandLogResult
> = /*#__PURE__*/ Protocol.command(
  "LayerTree.snapshotCommandLog",
  SnapshotCommandLogParams,
  SnapshotCommandLogResult,
  { status: "stable" }
)

/**
 * The `LayerTree.layerPainted` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const layerPainted: Protocol.EventDef<"LayerTree.layerPainted", LayerPaintedParams> = /*#__PURE__*/ Protocol
  .event(
    "LayerTree.layerPainted",
    LayerPaintedParams,
    { status: "stable" }
  )

/**
 * The `LayerTree.layerTreeDidChange` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const layerTreeDidChange: Protocol.EventDef<"LayerTree.layerTreeDidChange", LayerTreeDidChangeParams> =
  /*#__PURE__*/ Protocol.event(
    "LayerTree.layerTreeDidChange",
    LayerTreeDidChangeParams,
    { status: "stable" }
  )
