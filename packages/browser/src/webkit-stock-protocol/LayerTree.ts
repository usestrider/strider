/**
 * The LayerTree domain.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"

/**
 * An object containing the reasons why the layer was composited as properties.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CompositingReasons {
  /**
   * Composition due to association with an element with a CSS 3D transform.
   */
  readonly transform3D?: boolean | undefined
  /**
   * Composition due to association with a <video> element.
   */
  readonly video?: boolean | undefined
  /**
   * Composition due to the element being a <canvas> element.
   */
  readonly canvas?: boolean | undefined
  /**
   * Composition due to association with a plugin.
   */
  readonly plugin?: boolean | undefined
  /**
   * Composition due to association with an <iframe> element.
   */
  readonly iFrame?: boolean | undefined
  /**
   * Composition due to association with a <model> element.
   */
  readonly model?: boolean | undefined
  /**
   * Composition due to association with an element with a "backface-visibility: hidden" style.
   */
  readonly backfaceVisibilityHidden?: boolean | undefined
  /**
   * Composition due to association with an element clipping compositing descendants.
   */
  readonly clipsCompositingDescendants?: boolean | undefined
  /**
   * Composition due to association with an animated element.
   */
  readonly animation?: boolean | undefined
  /**
   * Composition due to association with an element with CSS filters applied.
   */
  readonly filters?: boolean | undefined
  /**
   * Composition due to association with an element with a "position: fixed" style.
   */
  readonly positionFixed?: boolean | undefined
  /**
   * Composition due to association with an element with a "position: sticky" style.
   */
  readonly positionSticky?: boolean | undefined
  /**
   * Composition due to association with an element with a "overflow-scrolling: touch" style.
   */
  readonly overflowScrollingTouch?: boolean | undefined
  /**
   * Composition due to association with an element establishing a stacking context.
   */
  readonly stacking?: boolean | undefined
  /**
   * Composition due to association with an element overlapping other composited elements.
   */
  readonly overlap?: boolean | undefined
  /**
   * Composition due to association with an element with descendants that have a negative z-index.
   */
  readonly negativeZIndexChildren?: boolean | undefined
  /**
   * Composition due to association with an element with composited descendants.
   */
  readonly transformWithCompositedDescendants?: boolean | undefined
  /**
   * Composition due to association with an element with opacity applied and composited descendants.
   */
  readonly opacityWithCompositedDescendants?: boolean | undefined
  /**
   * Composition due to association with a masked element and composited descendants.
   */
  readonly maskWithCompositedDescendants?: boolean | undefined
  /**
   * Composition due to association with an element with a reflection and composited descendants.
   */
  readonly reflectionWithCompositedDescendants?: boolean | undefined
  /**
   * Composition due to association with an element with CSS filters applied and composited descendants.
   */
  readonly filterWithCompositedDescendants?: boolean | undefined
  /**
   * Composition due to association with an element with CSS blending applied and composited descendants.
   */
  readonly blendingWithCompositedDescendants?: boolean | undefined
  /**
   * Composition due to association with an element isolating compositing descendants having CSS blending applied.
   */
  readonly isolatesCompositedBlendingDescendants?: boolean | undefined
  /**
   * Composition due to association with an element with perspective applied.
   */
  readonly perspective?: boolean | undefined
  /**
   * Composition due to association with an element with a "transform-style: preserve-3d" style.
   */
  readonly preserve3D?: boolean | undefined
  /**
   * Composition due to association with an element with a "will-change" style.
   */
  readonly willChange?: boolean | undefined
  /**
   * Composition due to association with the root element.
   */
  readonly root?: boolean | undefined
  /**
   * Composition due to association with an element with a "blend-mode" style.
   */
  readonly blending?: boolean | undefined
  /**
   * Composition due to association with an element that is a backdrop root
   */
  readonly backdropRoot?: boolean | undefined
}

/**
 * Schema for `CompositingReasons`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CompositingReasons = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    transform3D: Schema.optional(Schema.Boolean),
    video: Schema.optional(Schema.Boolean),
    canvas: Schema.optional(Schema.Boolean),
    plugin: Schema.optional(Schema.Boolean),
    iFrame: Schema.optional(Schema.Boolean),
    model: Schema.optional(Schema.Boolean),
    backfaceVisibilityHidden: Schema.optional(Schema.Boolean),
    clipsCompositingDescendants: Schema.optional(Schema.Boolean),
    animation: Schema.optional(Schema.Boolean),
    filters: Schema.optional(Schema.Boolean),
    positionFixed: Schema.optional(Schema.Boolean),
    positionSticky: Schema.optional(Schema.Boolean),
    overflowScrollingTouch: Schema.optional(Schema.Boolean),
    stacking: Schema.optional(Schema.Boolean),
    overlap: Schema.optional(Schema.Boolean),
    negativeZIndexChildren: Schema.optional(Schema.Boolean),
    transformWithCompositedDescendants: Schema.optional(Schema.Boolean),
    opacityWithCompositedDescendants: Schema.optional(Schema.Boolean),
    maskWithCompositedDescendants: Schema.optional(Schema.Boolean),
    reflectionWithCompositedDescendants: Schema.optional(Schema.Boolean),
    filterWithCompositedDescendants: Schema.optional(Schema.Boolean),
    blendingWithCompositedDescendants: Schema.optional(Schema.Boolean),
    isolatesCompositedBlendingDescendants: Schema.optional(Schema.Boolean),
    perspective: Schema.optional(Schema.Boolean),
    preserve3D: Schema.optional(Schema.Boolean),
    willChange: Schema.optional(Schema.Boolean),
    root: Schema.optional(Schema.Boolean),
    blending: Schema.optional(Schema.Boolean),
    backdropRoot: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "LayerTree.CompositingReasons" })
) as any as Schema.Codec<CompositingReasons>

/**
 * A rectangle.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface IntRect {
  /**
   * The x position.
   */
  readonly x: number
  /**
   * The y position.
   */
  readonly y: number
  /**
   * The width metric.
   */
  readonly width: number
  /**
   * The height metric.
   */
  readonly height: number
}

/**
 * Schema for `IntRect`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const IntRect = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int,
    height: Schema.Int
  }).annotate({ identifier: "LayerTree.IntRect" })
) as any as Schema.Codec<IntRect>

/**
 * Information about a compositing layer.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Layer {
  /**
   * The unique id for this layer.
   */
  readonly layerId: LayerId
  /**
   * The id for the node associated with this layer.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Bounds of the layer in absolute page coordinates.
   */
  readonly bounds: IntRect
  /**
   * Indicates how many time this layer has painted.
   */
  readonly paintCount: number
  /**
   * Estimated memory used by this layer.
   */
  readonly memory: number
  /**
   * The bounds of the composited layer.
   */
  readonly compositedBounds: IntRect
  /**
   * Indicates whether this layer is associated with an element hosted in a shadow tree.
   */
  readonly isInShadowTree?: boolean | undefined
  /**
   * Indicates whether this layer was used to provide a reflection for the element.
   */
  readonly isReflection?: boolean | undefined
  /**
   * Indicates whether the layer is attached to a pseudo element that is CSS generated content.
   */
  readonly isGeneratedContent?: boolean | undefined
  /**
   * Indicates whether the layer was created for a CSS anonymous block or box.
   */
  readonly isAnonymous?: boolean | undefined
  /**
   * The id for the pseudo element associated with this layer.
   */
  readonly pseudoElementId?: PseudoElementId | undefined
  /**
   * The name of the CSS pseudo-element that prompted the layer to be generated.
   */
  readonly pseudoElement?: string | undefined
}

/**
 * Schema for `Layer`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Layer = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layerId: LayerId,
    nodeId: DOM.NodeId,
    bounds: IntRect,
    paintCount: Schema.Int,
    memory: Schema.Int,
    compositedBounds: IntRect,
    isInShadowTree: Schema.optional(Schema.Boolean),
    isReflection: Schema.optional(Schema.Boolean),
    isGeneratedContent: Schema.optional(Schema.Boolean),
    isAnonymous: Schema.optional(Schema.Boolean),
    pseudoElementId: Schema.optional(PseudoElementId),
    pseudoElement: Schema.optional(Schema.String)
  }).annotate({ identifier: "LayerTree.Layer" })
) as any as Schema.Codec<Layer>

/**
 * Unique RenderLayer identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LayerId = Brand.Branded<string, "~@usestrider/browser/webkit-stock-protocol/LayerTree/LayerId">

/**
 * Schema for `LayerId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LayerId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/LayerTree/LayerId")
) as any as Schema.Codec<LayerId>

/**
 * Unique PseudoElement identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PseudoElementId = Brand.Branded<
  string,
  "~@usestrider/browser/webkit-stock-protocol/LayerTree/PseudoElementId"
>

/**
 * Schema for `PseudoElementId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PseudoElementId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/LayerTree/PseudoElementId")
) as any as Schema.Codec<PseudoElementId>

/**
 * Returns the layer tree structure of the current page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LayersForNodeParams {
  /**
   * Root of the subtree for which we want to gather layers.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `LayersForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LayersForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "LayerTree.LayersForNodeParams" })
) as any as Schema.Codec<LayersForNodeParams>

/**
 * Returns the layer tree structure of the current page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LayersForNodeResult {
  /**
   * Child layers.
   */
  readonly layers: ReadonlyArray<Layer>
}

/**
 * Schema for `LayersForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LayersForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layers: Schema.Array(Layer)
  }).annotate({ identifier: "LayerTree.LayersForNodeResult" })
) as any as Schema.Codec<LayersForNodeResult>

/**
 * Provides the reasons why the given layer was composited.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReasonsForCompositingLayerParams {
  /**
   * The id of the layer for which we want to get the reasons it was composited.
   */
  readonly layerId: LayerId
}

/**
 * Schema for `ReasonsForCompositingLayerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReasonsForCompositingLayerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layerId: LayerId
  }).annotate({ identifier: "LayerTree.ReasonsForCompositingLayerParams" })
) as any as Schema.Codec<ReasonsForCompositingLayerParams>

/**
 * Provides the reasons why the given layer was composited.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReasonsForCompositingLayerResult {
  /**
   * An object containing the reasons why the layer was composited as properties.
   */
  readonly compositingReasons: CompositingReasons
}

/**
 * Schema for `ReasonsForCompositingLayerResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReasonsForCompositingLayerResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    compositingReasons: CompositingReasons
  }).annotate({ identifier: "LayerTree.ReasonsForCompositingLayerResult" })
) as any as Schema.Codec<ReasonsForCompositingLayerResult>

/**
 * Captures a snapshot of the layer's rendered content as a PNG data URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestContentParams {
  /**
   * The id of the layer to snapshot.
   */
  readonly layerId: LayerId
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
    layerId: LayerId
  }).annotate({ identifier: "LayerTree.RequestContentParams" })
) as any as Schema.Codec<RequestContentParams>

/**
 * Captures a snapshot of the layer's rendered content as a PNG data URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestContentResult {
  /**
   * Base64-encoded PNG data URL of the layer's rendered content.
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
  }).annotate({ identifier: "LayerTree.RequestContentResult" })
) as any as Schema.Codec<RequestContentResult>

/**
 * Disables compositing tree inspection.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Returns the layer tree structure of the current page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const layersForNode: Protocol.CommandDef<"LayerTree.layersForNode", LayersForNodeParams, LayersForNodeResult> =
  /*#__PURE__*/ Protocol.command(
    "LayerTree.layersForNode",
    LayersForNodeParams,
    LayersForNodeResult,
    { status: "stable" }
  )

/**
 * Provides the reasons why the given layer was composited.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const reasonsForCompositingLayer: Protocol.CommandDef<
  "LayerTree.reasonsForCompositingLayer",
  ReasonsForCompositingLayerParams,
  ReasonsForCompositingLayerResult
> = /*#__PURE__*/ Protocol.command(
  "LayerTree.reasonsForCompositingLayer",
  ReasonsForCompositingLayerParams,
  ReasonsForCompositingLayerResult,
  { status: "stable" }
)

/**
 * Captures a snapshot of the layer's rendered content as a PNG data URL.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestContent: Protocol.CommandDef<
  "LayerTree.requestContent",
  RequestContentParams,
  RequestContentResult
> = /*#__PURE__*/ Protocol.command(
  "LayerTree.requestContent",
  RequestContentParams,
  RequestContentResult,
  { status: "stable" }
)

/**
 * The `LayerTree.layerTreeDidChange` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const layerTreeDidChange: Protocol.EventDef<"LayerTree.layerTreeDidChange", void> = /*#__PURE__*/ Protocol.event(
  "LayerTree.layerTreeDidChange",
  undefined,
  { status: "stable" }
)
