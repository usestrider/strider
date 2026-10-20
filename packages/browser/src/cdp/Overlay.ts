/**
 * This domain provides various functionality related to drawing atop the inspected page.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Style information for drawing a box.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BoxStyle {
  /**
   * The background color for the box (default: transparent)
   */
  readonly fillColor?: DOM.RGBA | undefined
  /**
   * The hatching color for the box (default: transparent)
   */
  readonly hatchColor?: DOM.RGBA | undefined
}

/**
 * Schema for `BoxStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BoxStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fillColor: Schema.optional(DOM.RGBA),
    hatchColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.BoxStyle" })
) as any as Schema.Codec<BoxStyle>

/**
 * `ColorFormat` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ColorFormat =
  | "rgb"
  | "hsl"
  | "hwb"
  | "hex"
  | (string & {})

/**
 * Schema for `ColorFormat`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ColorFormat = Schema.String as any as Schema.Codec<ColorFormat>

/**
 * `ContainerQueryContainerHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContainerQueryContainerHighlightConfig {
  /**
   * The style of the container border.
   */
  readonly containerBorder?: LineStyle | undefined
  /**
   * The style of the descendants' borders.
   */
  readonly descendantBorder?: LineStyle | undefined
}

/**
 * Schema for `ContainerQueryContainerHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContainerQueryContainerHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    containerBorder: Schema.optional(LineStyle),
    descendantBorder: Schema.optional(LineStyle)
  }).annotate({ identifier: "Overlay.ContainerQueryContainerHighlightConfig" })
) as any as Schema.Codec<ContainerQueryContainerHighlightConfig>

/**
 * `ContainerQueryHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContainerQueryHighlightConfig {
  /**
   * A descriptor for the highlight appearance of container query containers.
   */
  readonly containerQueryContainerHighlightConfig: ContainerQueryContainerHighlightConfig
  /**
   * Identifier of the container node to highlight.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `ContainerQueryHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContainerQueryHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    containerQueryContainerHighlightConfig: ContainerQueryContainerHighlightConfig,
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.ContainerQueryHighlightConfig" })
) as any as Schema.Codec<ContainerQueryHighlightConfig>

/**
 * `ContrastAlgorithm` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ContrastAlgorithm =
  | "aa"
  | "aaa"
  | "apca"
  | (string & {})

/**
 * Schema for `ContrastAlgorithm`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContrastAlgorithm = Schema.String as any as Schema.Codec<ContrastAlgorithm>

/**
 * Configuration for a display cutout.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DisplayCutoutConfig {
  /**
   * A rectangle representing the cutout bounds.
   */
  readonly rect: DOM.Rect
  /**
   * Shape used to draw the cutout.
   */
  readonly shape: DisplayCutoutShape
  /**
   * Border radius for rounded cutout shapes.
   */
  readonly borderRadius?: number | undefined
  /**
   * Upper shoulder radius for notch cutout shapes.
   */
  readonly upperRadius?: number | undefined
  /**
   * Lower transition radius for notch cutout shapes.
   */
  readonly lowerRadius?: number | undefined
  /**
   * Center x coordinate for circle cutout shapes.
   */
  readonly cx?: number | undefined
  /**
   * Center y coordinate for circle cutout shapes.
   */
  readonly cy?: number | undefined
  /**
   * Radius for circle cutout shapes.
   */
  readonly radius?: number | undefined
  /**
   * The cutout fill color (default: black).
   */
  readonly contentColor?: DOM.RGBA | undefined
}

/**
 * Schema for `DisplayCutoutConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisplayCutoutConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rect: DOM.Rect,
    shape: DisplayCutoutShape,
    borderRadius: Schema.optional(Schema.Int),
    upperRadius: Schema.optional(Schema.Int),
    lowerRadius: Schema.optional(Schema.Int),
    cx: Schema.optional(Schema.Int),
    cy: Schema.optional(Schema.Int),
    radius: Schema.optional(Schema.Int),
    contentColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.DisplayCutoutConfig" })
) as any as Schema.Codec<DisplayCutoutConfig>

/**
 * Supported display cutout shapes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DisplayCutoutShape =
  | "pill"
  | "notch"
  | "circle"
  | "rectangle"
  | (string & {})

/**
 * Schema for `DisplayCutoutShape`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisplayCutoutShape = Schema.String as any as Schema.Codec<DisplayCutoutShape>

/**
 * Configuration data for the highlighting of Flex container elements.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FlexContainerHighlightConfig {
  /**
   * The style of the container border
   */
  readonly containerBorder?: LineStyle | undefined
  /**
   * The style of the separator between lines
   */
  readonly lineSeparator?: LineStyle | undefined
  /**
   * The style of the separator between items
   */
  readonly itemSeparator?: LineStyle | undefined
  /**
   * Style of content-distribution space on the main axis (justify-content).
   */
  readonly mainDistributedSpace?: BoxStyle | undefined
  /**
   * Style of content-distribution space on the cross axis (align-content).
   */
  readonly crossDistributedSpace?: BoxStyle | undefined
  /**
   * Style of empty space caused by row gaps (gap/row-gap).
   */
  readonly rowGapSpace?: BoxStyle | undefined
  /**
   * Style of empty space caused by columns gaps (gap/column-gap).
   */
  readonly columnGapSpace?: BoxStyle | undefined
  /**
   * Style of the self-alignment line (align-items).
   */
  readonly crossAlignment?: LineStyle | undefined
}

/**
 * Schema for `FlexContainerHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FlexContainerHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    containerBorder: Schema.optional(LineStyle),
    lineSeparator: Schema.optional(LineStyle),
    itemSeparator: Schema.optional(LineStyle),
    mainDistributedSpace: Schema.optional(BoxStyle),
    crossDistributedSpace: Schema.optional(BoxStyle),
    rowGapSpace: Schema.optional(BoxStyle),
    columnGapSpace: Schema.optional(BoxStyle),
    crossAlignment: Schema.optional(LineStyle)
  }).annotate({ identifier: "Overlay.FlexContainerHighlightConfig" })
) as any as Schema.Codec<FlexContainerHighlightConfig>

/**
 * Configuration data for the highlighting of Flex item elements.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FlexItemHighlightConfig {
  /**
   * Style of the box representing the item's base size
   */
  readonly baseSizeBox?: BoxStyle | undefined
  /**
   * Style of the border around the box representing the item's base size
   */
  readonly baseSizeBorder?: LineStyle | undefined
  /**
   * Style of the arrow representing if the item grew or shrank
   */
  readonly flexibilityArrow?: LineStyle | undefined
}

/**
 * Schema for `FlexItemHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FlexItemHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    baseSizeBox: Schema.optional(BoxStyle),
    baseSizeBorder: Schema.optional(LineStyle),
    flexibilityArrow: Schema.optional(LineStyle)
  }).annotate({ identifier: "Overlay.FlexItemHighlightConfig" })
) as any as Schema.Codec<FlexItemHighlightConfig>

/**
 * `FlexNodeHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FlexNodeHighlightConfig {
  /**
   * A descriptor for the highlight appearance of flex containers.
   */
  readonly flexContainerHighlightConfig: FlexContainerHighlightConfig
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `FlexNodeHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FlexNodeHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    flexContainerHighlightConfig: FlexContainerHighlightConfig,
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.FlexNodeHighlightConfig" })
) as any as Schema.Codec<FlexNodeHighlightConfig>

/**
 * Configuration data for the highlighting of Grid elements.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GridHighlightConfig {
  /**
   * Whether the extension lines from grid cells to the rulers should be shown (default: false).
   */
  readonly showGridExtensionLines?: boolean | undefined
  /**
   * Show Positive line number labels (default: false).
   */
  readonly showPositiveLineNumbers?: boolean | undefined
  /**
   * Show Negative line number labels (default: false).
   */
  readonly showNegativeLineNumbers?: boolean | undefined
  /**
   * Show area name labels (default: false).
   */
  readonly showAreaNames?: boolean | undefined
  /**
   * Show line name labels (default: false).
   */
  readonly showLineNames?: boolean | undefined
  /**
   * Show track size labels (default: false).
   */
  readonly showTrackSizes?: boolean | undefined
  /**
   * The grid container border highlight color (default: transparent).
   */
  readonly gridBorderColor?: DOM.RGBA | undefined
  /**
   * The row line color (default: transparent).
   */
  readonly rowLineColor?: DOM.RGBA | undefined
  /**
   * The column line color (default: transparent).
   */
  readonly columnLineColor?: DOM.RGBA | undefined
  /**
   * Whether the grid border is dashed (default: false).
   */
  readonly gridBorderDash?: boolean | undefined
  /**
   * Whether row lines are dashed (default: false).
   */
  readonly rowLineDash?: boolean | undefined
  /**
   * Whether column lines are dashed (default: false).
   */
  readonly columnLineDash?: boolean | undefined
  /**
   * The row gap highlight fill color (default: transparent).
   */
  readonly rowGapColor?: DOM.RGBA | undefined
  /**
   * The row gap hatching fill color (default: transparent).
   */
  readonly rowHatchColor?: DOM.RGBA | undefined
  /**
   * The column gap highlight fill color (default: transparent).
   */
  readonly columnGapColor?: DOM.RGBA | undefined
  /**
   * The column gap hatching fill color (default: transparent).
   */
  readonly columnHatchColor?: DOM.RGBA | undefined
  /**
   * The named grid areas border color (Default: transparent).
   */
  readonly areaBorderColor?: DOM.RGBA | undefined
  /**
   * The grid container background color (Default: transparent).
   */
  readonly gridBackgroundColor?: DOM.RGBA | undefined
}

/**
 * Schema for `GridHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GridHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    showGridExtensionLines: Schema.optional(Schema.Boolean),
    showPositiveLineNumbers: Schema.optional(Schema.Boolean),
    showNegativeLineNumbers: Schema.optional(Schema.Boolean),
    showAreaNames: Schema.optional(Schema.Boolean),
    showLineNames: Schema.optional(Schema.Boolean),
    showTrackSizes: Schema.optional(Schema.Boolean),
    gridBorderColor: Schema.optional(DOM.RGBA),
    rowLineColor: Schema.optional(DOM.RGBA),
    columnLineColor: Schema.optional(DOM.RGBA),
    gridBorderDash: Schema.optional(Schema.Boolean),
    rowLineDash: Schema.optional(Schema.Boolean),
    columnLineDash: Schema.optional(Schema.Boolean),
    rowGapColor: Schema.optional(DOM.RGBA),
    rowHatchColor: Schema.optional(DOM.RGBA),
    columnGapColor: Schema.optional(DOM.RGBA),
    columnHatchColor: Schema.optional(DOM.RGBA),
    areaBorderColor: Schema.optional(DOM.RGBA),
    gridBackgroundColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.GridHighlightConfig" })
) as any as Schema.Codec<GridHighlightConfig>

/**
 * Configurations for Persistent Grid Highlight
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GridNodeHighlightConfig {
  /**
   * A descriptor for the highlight appearance.
   */
  readonly gridHighlightConfig: GridHighlightConfig
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GridNodeHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GridNodeHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gridHighlightConfig: GridHighlightConfig,
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.GridNodeHighlightConfig" })
) as any as Schema.Codec<GridNodeHighlightConfig>

/**
 * Configuration data for the highlighting of page elements.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HighlightConfig {
  /**
   * Whether the node info tooltip should be shown (default: false).
   */
  readonly showInfo?: boolean | undefined
  /**
   * Whether the node styles in the tooltip (default: false).
   */
  readonly showStyles?: boolean | undefined
  /**
   * Whether the rulers should be shown (default: false).
   */
  readonly showRulers?: boolean | undefined
  /**
   * Whether the a11y info should be shown (default: true).
   */
  readonly showAccessibilityInfo?: boolean | undefined
  /**
   * Whether the extension lines from node to the rulers should be shown (default: false).
   */
  readonly showExtensionLines?: boolean | undefined
  /**
   * The content box highlight fill color (default: transparent).
   */
  readonly contentColor?: DOM.RGBA | undefined
  /**
   * The padding highlight fill color (default: transparent).
   */
  readonly paddingColor?: DOM.RGBA | undefined
  /**
   * The border highlight fill color (default: transparent).
   */
  readonly borderColor?: DOM.RGBA | undefined
  /**
   * The margin highlight fill color (default: transparent).
   */
  readonly marginColor?: DOM.RGBA | undefined
  /**
   * The event target element highlight fill color (default: transparent).
   */
  readonly eventTargetColor?: DOM.RGBA | undefined
  /**
   * The shape outside fill color (default: transparent).
   */
  readonly shapeColor?: DOM.RGBA | undefined
  /**
   * The shape margin fill color (default: transparent).
   */
  readonly shapeMarginColor?: DOM.RGBA | undefined
  /**
   * The grid layout color (default: transparent).
   */
  readonly cssGridColor?: DOM.RGBA | undefined
  /**
   * The color format used to format color styles (default: hex).
   */
  readonly colorFormat?: ColorFormat | undefined
  /**
   * The grid layout highlight configuration (default: all transparent).
   */
  readonly gridHighlightConfig?: GridHighlightConfig | undefined
  /**
   * The flex container highlight configuration (default: all transparent).
   */
  readonly flexContainerHighlightConfig?: FlexContainerHighlightConfig | undefined
  /**
   * The flex item highlight configuration (default: all transparent).
   */
  readonly flexItemHighlightConfig?: FlexItemHighlightConfig | undefined
  /**
   * The contrast algorithm to use for the contrast ratio (default: aa).
   */
  readonly contrastAlgorithm?: ContrastAlgorithm | undefined
  /**
   * The container query container highlight configuration (default: all transparent).
   */
  readonly containerQueryContainerHighlightConfig?: ContainerQueryContainerHighlightConfig | undefined
}

/**
 * Schema for `HighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    showInfo: Schema.optional(Schema.Boolean),
    showStyles: Schema.optional(Schema.Boolean),
    showRulers: Schema.optional(Schema.Boolean),
    showAccessibilityInfo: Schema.optional(Schema.Boolean),
    showExtensionLines: Schema.optional(Schema.Boolean),
    contentColor: Schema.optional(DOM.RGBA),
    paddingColor: Schema.optional(DOM.RGBA),
    borderColor: Schema.optional(DOM.RGBA),
    marginColor: Schema.optional(DOM.RGBA),
    eventTargetColor: Schema.optional(DOM.RGBA),
    shapeColor: Schema.optional(DOM.RGBA),
    shapeMarginColor: Schema.optional(DOM.RGBA),
    cssGridColor: Schema.optional(DOM.RGBA),
    colorFormat: Schema.optional(ColorFormat),
    gridHighlightConfig: Schema.optional(GridHighlightConfig),
    flexContainerHighlightConfig: Schema.optional(FlexContainerHighlightConfig),
    flexItemHighlightConfig: Schema.optional(FlexItemHighlightConfig),
    contrastAlgorithm: Schema.optional(ContrastAlgorithm),
    containerQueryContainerHighlightConfig: Schema.optional(ContainerQueryContainerHighlightConfig)
  }).annotate({ identifier: "Overlay.HighlightConfig" })
) as any as Schema.Codec<HighlightConfig>

/**
 * Configuration for dual screen hinge
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HingeConfig {
  /**
   * A rectangle represent hinge
   */
  readonly rect: DOM.Rect
  /**
   * The content box highlight fill color (default: a dark color).
   */
  readonly contentColor?: DOM.RGBA | undefined
  /**
   * The content box highlight outline color (default: transparent).
   */
  readonly outlineColor?: DOM.RGBA | undefined
}

/**
 * Schema for `HingeConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HingeConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rect: DOM.Rect,
    contentColor: Schema.optional(DOM.RGBA),
    outlineColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.HingeConfig" })
) as any as Schema.Codec<HingeConfig>

/**
 * `InspectMode` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type InspectMode =
  | "searchForNode"
  | "searchForUAShadowDOM"
  | "captureAreaScreenshot"
  | "none"
  | (string & {})

/**
 * Schema for `InspectMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectMode = Schema.String as any as Schema.Codec<InspectMode>

/**
 * `InspectedElementAnchorConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InspectedElementAnchorConfig {
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Identifier of the backend node to highlight.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `InspectedElementAnchorConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectedElementAnchorConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(DOM.NodeId),
    backendNodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "Overlay.InspectedElementAnchorConfig" })
) as any as Schema.Codec<InspectedElementAnchorConfig>

/**
 * `IsolatedElementHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface IsolatedElementHighlightConfig {
  /**
   * A descriptor for the highlight appearance of an element in isolation mode.
   */
  readonly isolationModeHighlightConfig: IsolationModeHighlightConfig
  /**
   * Identifier of the isolated element to highlight.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `IsolatedElementHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IsolatedElementHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isolationModeHighlightConfig: IsolationModeHighlightConfig,
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.IsolatedElementHighlightConfig" })
) as any as Schema.Codec<IsolatedElementHighlightConfig>

/**
 * `IsolationModeHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface IsolationModeHighlightConfig {
  /**
   * The fill color of the resizers (default: transparent).
   */
  readonly resizerColor?: DOM.RGBA | undefined
  /**
   * The fill color for resizer handles (default: transparent).
   */
  readonly resizerHandleColor?: DOM.RGBA | undefined
  /**
   * The fill color for the mask covering non-isolated elements (default: transparent).
   */
  readonly maskColor?: DOM.RGBA | undefined
}

/**
 * Schema for `IsolationModeHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IsolationModeHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    resizerColor: Schema.optional(DOM.RGBA),
    resizerHandleColor: Schema.optional(DOM.RGBA),
    maskColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.IsolationModeHighlightConfig" })
) as any as Schema.Codec<IsolationModeHighlightConfig>

/**
 * Style information for drawing a line.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LineStyle {
  /**
   * The color of the line (default: transparent)
   */
  readonly color?: DOM.RGBA | undefined
  /**
   * The line pattern (default: solid)
   */
  readonly pattern?: LineStylePattern | undefined
}

/**
 * Schema for `LineStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LineStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    color: Schema.optional(DOM.RGBA),
    pattern: Schema.optional(LineStylePattern)
  }).annotate({ identifier: "Overlay.LineStyle" })
) as any as Schema.Codec<LineStyle>

/**
 * The line pattern (default: solid)
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type LineStylePattern =
  | "dashed"
  | "dotted"
  | (string & {})

/**
 * Schema for `LineStylePattern`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LineStylePattern = Schema.String as any as Schema.Codec<LineStylePattern>

/**
 * `ScrollSnapContainerHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScrollSnapContainerHighlightConfig {
  /**
   * The style of the snapport border (default: transparent)
   */
  readonly snapportBorder?: LineStyle | undefined
  /**
   * The style of the snap area border (default: transparent)
   */
  readonly snapAreaBorder?: LineStyle | undefined
  /**
   * The margin highlight fill color (default: transparent).
   */
  readonly scrollMarginColor?: DOM.RGBA | undefined
  /**
   * The padding highlight fill color (default: transparent).
   */
  readonly scrollPaddingColor?: DOM.RGBA | undefined
}

/**
 * Schema for `ScrollSnapContainerHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScrollSnapContainerHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    snapportBorder: Schema.optional(LineStyle),
    snapAreaBorder: Schema.optional(LineStyle),
    scrollMarginColor: Schema.optional(DOM.RGBA),
    scrollPaddingColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.ScrollSnapContainerHighlightConfig" })
) as any as Schema.Codec<ScrollSnapContainerHighlightConfig>

/**
 * `ScrollSnapHighlightConfig`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScrollSnapHighlightConfig {
  /**
   * A descriptor for the highlight appearance of scroll snap containers.
   */
  readonly scrollSnapContainerHighlightConfig: ScrollSnapContainerHighlightConfig
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `ScrollSnapHighlightConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScrollSnapHighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scrollSnapContainerHighlightConfig: ScrollSnapContainerHighlightConfig,
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.ScrollSnapHighlightConfig" })
) as any as Schema.Codec<ScrollSnapHighlightConfig>

/**
 * Configuration data for drawing the source order of an elements children.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SourceOrderConfig {
  /**
   * the color to outline the given element in.
   */
  readonly parentOutlineColor: DOM.RGBA
  /**
   * the color to outline the child elements in.
   */
  readonly childOutlineColor: DOM.RGBA
}

/**
 * Schema for `SourceOrderConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SourceOrderConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentOutlineColor: DOM.RGBA,
    childOutlineColor: DOM.RGBA
  }).annotate({ identifier: "Overlay.SourceOrderConfig" })
) as any as Schema.Codec<SourceOrderConfig>

/**
 * Configuration for Window Controls Overlay
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WindowControlsOverlayConfig {
  /**
   * Whether the title bar CSS should be shown when emulating the Window Controls Overlay.
   */
  readonly showCSS: boolean
  /**
   * Selected platforms to show the overlay.
   */
  readonly selectedPlatform: string
  /**
   * The theme color defined in app manifest.
   */
  readonly themeColor: string
}

/**
 * Schema for `WindowControlsOverlayConfig`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WindowControlsOverlayConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    showCSS: Schema.Boolean,
    selectedPlatform: Schema.String,
    themeColor: Schema.String
  }).annotate({ identifier: "Overlay.WindowControlsOverlayConfig" })
) as any as Schema.Codec<WindowControlsOverlayConfig>

/**
 * For Persistent Grid testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetGridHighlightObjectsForTestParams {
  /**
   * Ids of the node to get highlight object for.
   */
  readonly nodeIds: ReadonlyArray<DOM.NodeId>
}

/**
 * Schema for `GetGridHighlightObjectsForTestParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetGridHighlightObjectsForTestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(DOM.NodeId)
  }).annotate({ identifier: "Overlay.GetGridHighlightObjectsForTestParams" })
) as any as Schema.Codec<GetGridHighlightObjectsForTestParams>

/**
 * For Persistent Grid testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetGridHighlightObjectsForTestResult {
  /**
   * Grid Highlight data for the node ids provided.
   */
  readonly highlights: { readonly [key: string]: unknown }
}

/**
 * Schema for `GetGridHighlightObjectsForTestResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetGridHighlightObjectsForTestResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    highlights: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Overlay.GetGridHighlightObjectsForTestResult" })
) as any as Schema.Codec<GetGridHighlightObjectsForTestResult>

/**
 * For testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHighlightObjectForTestParams {
  /**
   * Id of the node to get highlight object for.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Whether to include distance info.
   */
  readonly includeDistance?: boolean | undefined
  /**
   * Whether to include style info.
   */
  readonly includeStyle?: boolean | undefined
  /**
   * The color format to get config with (default: hex).
   */
  readonly colorFormat?: ColorFormat | undefined
  /**
   * Whether to show accessibility info (default: true).
   */
  readonly showAccessibilityInfo?: boolean | undefined
}

/**
 * Schema for `GetHighlightObjectForTestParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHighlightObjectForTestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    includeDistance: Schema.optional(Schema.Boolean),
    includeStyle: Schema.optional(Schema.Boolean),
    colorFormat: Schema.optional(ColorFormat),
    showAccessibilityInfo: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Overlay.GetHighlightObjectForTestParams" })
) as any as Schema.Codec<GetHighlightObjectForTestParams>

/**
 * For testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHighlightObjectForTestResult {
  /**
   * Highlight data for the node.
   */
  readonly highlight: { readonly [key: string]: unknown }
}

/**
 * Schema for `GetHighlightObjectForTestResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHighlightObjectForTestResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    highlight: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Overlay.GetHighlightObjectForTestResult" })
) as any as Schema.Codec<GetHighlightObjectForTestResult>

/**
 * For Source Order Viewer testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSourceOrderHighlightObjectForTestParams {
  /**
   * Id of the node to highlight.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetSourceOrderHighlightObjectForTestParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSourceOrderHighlightObjectForTestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.GetSourceOrderHighlightObjectForTestParams" })
) as any as Schema.Codec<GetSourceOrderHighlightObjectForTestParams>

/**
 * For Source Order Viewer testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSourceOrderHighlightObjectForTestResult {
  /**
   * Source order highlight data for the node id provided.
   */
  readonly highlight: { readonly [key: string]: unknown }
}

/**
 * Schema for `GetSourceOrderHighlightObjectForTestResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSourceOrderHighlightObjectForTestResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    highlight: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Overlay.GetSourceOrderHighlightObjectForTestResult" })
) as any as Schema.Codec<GetSourceOrderHighlightObjectForTestResult>

/**
 * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or
 * objectId must be specified.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HighlightNodeParams {
  /**
   * A descriptor for the highlight appearance.
   */
  readonly highlightConfig: HighlightConfig
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Identifier of the backend node to highlight.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * JavaScript object id of the node to be highlighted.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * Selectors to highlight relevant nodes.
   */
  readonly selector?: string | undefined
}

/**
 * Schema for `HighlightNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HighlightNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    highlightConfig: HighlightConfig,
    nodeId: Schema.optional(DOM.NodeId),
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    selector: Schema.optional(Schema.String)
  }).annotate({ identifier: "Overlay.HighlightNodeParams" })
) as any as Schema.Codec<HighlightNodeParams>

/**
 * Highlights given quad. Coordinates are absolute with respect to the main frame viewport.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HighlightQuadParams {
  /**
   * Quad to highlight
   */
  readonly quad: DOM.Quad
  /**
   * The highlight fill color (default: transparent).
   */
  readonly color?: DOM.RGBA | undefined
  /**
   * The highlight outline color (default: transparent).
   */
  readonly outlineColor?: DOM.RGBA | undefined
}

/**
 * Schema for `HighlightQuadParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HighlightQuadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    quad: DOM.Quad,
    color: Schema.optional(DOM.RGBA),
    outlineColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.HighlightQuadParams" })
) as any as Schema.Codec<HighlightQuadParams>

/**
 * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
 * Issue: the method does not handle device pixel ratio (DPR) correctly.
 * The coordinates currently have to be adjusted by the client
 * if DPR is not 1 (see crbug.com/437807128).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HighlightRectParams {
  /**
   * X coordinate
   */
  readonly x: number
  /**
   * Y coordinate
   */
  readonly y: number
  /**
   * Rectangle width
   */
  readonly width: number
  /**
   * Rectangle height
   */
  readonly height: number
  /**
   * The highlight fill color (default: transparent).
   */
  readonly color?: DOM.RGBA | undefined
  /**
   * The highlight outline color (default: transparent).
   */
  readonly outlineColor?: DOM.RGBA | undefined
}

/**
 * Schema for `HighlightRectParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HighlightRectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int,
    height: Schema.Int,
    color: Schema.optional(DOM.RGBA),
    outlineColor: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Overlay.HighlightRectParams" })
) as any as Schema.Codec<HighlightRectParams>

/**
 * Highlights the source order of the children of the DOM node with given id or with the given
 * JavaScript object wrapper. Either nodeId or objectId must be specified.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HighlightSourceOrderParams {
  /**
   * A descriptor for the appearance of the overlay drawing.
   */
  readonly sourceOrderConfig: SourceOrderConfig
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Identifier of the backend node to highlight.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * JavaScript object id of the node to be highlighted.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
}

/**
 * Schema for `HighlightSourceOrderParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HighlightSourceOrderParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceOrderConfig: SourceOrderConfig,
    nodeId: Schema.optional(DOM.NodeId),
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId)
  }).annotate({ identifier: "Overlay.HighlightSourceOrderParams" })
) as any as Schema.Codec<HighlightSourceOrderParams>

/**
 * Fired when the node should be inspected. This happens after call to `setInspectMode` or when
 * user manually inspects an element.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InspectNodeRequestedParams {
  /**
   * Id of the node to inspect.
   */
  readonly backendNodeId: DOM.BackendNodeId
}

/**
 * Schema for `InspectNodeRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectNodeRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeId: DOM.BackendNodeId
  }).annotate({ identifier: "Overlay.InspectNodeRequestedParams" })
) as any as Schema.Codec<InspectNodeRequestedParams>

/**
 * Fired when user asks to show the Inspect panel.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InspectPanelShowRequestedParams {
  /**
   * Id of the node to show in the panel.
   */
  readonly backendNodeId: DOM.BackendNodeId
}

/**
 * Schema for `InspectPanelShowRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectPanelShowRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeId: DOM.BackendNodeId
  }).annotate({ identifier: "Overlay.InspectPanelShowRequestedParams" })
) as any as Schema.Codec<InspectPanelShowRequestedParams>

/**
 * Fired when user asks to restore the Inspected Element floating window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InspectedElementWindowRestoredParams {
  /**
   * Id of the node to restore the floating window for.
   */
  readonly backendNodeId: DOM.BackendNodeId
}

/**
 * Schema for `InspectedElementWindowRestoredParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectedElementWindowRestoredParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeId: DOM.BackendNodeId
  }).annotate({ identifier: "Overlay.InspectedElementWindowRestoredParams" })
) as any as Schema.Codec<InspectedElementWindowRestoredParams>

/**
 * Fired when the node should be highlighted. This happens after call to `setInspectMode`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodeHighlightRequestedParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `NodeHighlightRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodeHighlightRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Overlay.NodeHighlightRequestedParams" })
) as any as Schema.Codec<NodeHighlightRequestedParams>

/**
 * Fired when user asks to capture screenshot of some area on the page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreenshotRequestedParams {
  /**
   * Viewport to capture, in device independent pixels (dip).
   */
  readonly viewport: Page.Viewport
}

/**
 * Schema for `ScreenshotRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreenshotRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    viewport: Page.Viewport
  }).annotate({ identifier: "Overlay.ScreenshotRequestedParams" })
) as any as Schema.Codec<ScreenshotRequestedParams>

/**
 * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted.
 * Backend then generates 'inspectNodeRequested' event upon element selection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetInspectModeParams {
  /**
   * Set an inspection mode.
   */
  readonly mode: InspectMode
  /**
   * A descriptor for the highlight appearance of hovered-over nodes. May be omitted if `enabled
   * == false`.
   */
  readonly highlightConfig?: HighlightConfig | undefined
}

/**
 * Schema for `SetInspectModeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetInspectModeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mode: InspectMode,
    highlightConfig: Schema.optional(HighlightConfig)
  }).annotate({ identifier: "Overlay.SetInspectModeParams" })
) as any as Schema.Codec<SetInspectModeParams>

/**
 * `setPausedInDebuggerMessage.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPausedInDebuggerMessageParams {
  /**
   * The message to display, also triggers resume and step over controls.
   */
  readonly message?: string | undefined
}

/**
 * Schema for `SetPausedInDebuggerMessageParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPausedInDebuggerMessageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.optional(Schema.String)
  }).annotate({ identifier: "Overlay.SetPausedInDebuggerMessageParams" })
) as any as Schema.Codec<SetPausedInDebuggerMessageParams>

/**
 * Highlights owner element of all frames detected to be ads.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowAdHighlightsParams {
  /**
   * True for showing ad highlights
   */
  readonly show: boolean
}

/**
 * Schema for `SetShowAdHighlightsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowAdHighlightsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    show: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowAdHighlightsParams" })
) as any as Schema.Codec<SetShowAdHighlightsParams>

/**
 * `setShowContainerQueryOverlays.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowContainerQueryOverlaysParams {
  /**
   * An array of node identifiers and descriptors for the highlight appearance.
   */
  readonly containerQueryHighlightConfigs: ReadonlyArray<ContainerQueryHighlightConfig>
}

/**
 * Schema for `SetShowContainerQueryOverlaysParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowContainerQueryOverlaysParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    containerQueryHighlightConfigs: Schema.Array(ContainerQueryHighlightConfig)
  }).annotate({ identifier: "Overlay.SetShowContainerQueryOverlaysParams" })
) as any as Schema.Codec<SetShowContainerQueryOverlaysParams>

/**
 * Requests that backend shows debug borders on layers
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowDebugBordersParams {
  /**
   * True for showing debug borders
   */
  readonly show: boolean
}

/**
 * Schema for `SetShowDebugBordersParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowDebugBordersParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    show: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowDebugBordersParams" })
) as any as Schema.Codec<SetShowDebugBordersParams>

/**
 * Add a display cutout overlay.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowDisplayCutoutParams {
  /**
   * display cutout data, null means hide display cutout
   */
  readonly displayCutoutConfig?: DisplayCutoutConfig | undefined
}

/**
 * Schema for `SetShowDisplayCutoutParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowDisplayCutoutParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    displayCutoutConfig: Schema.optional(DisplayCutoutConfig)
  }).annotate({ identifier: "Overlay.SetShowDisplayCutoutParams" })
) as any as Schema.Codec<SetShowDisplayCutoutParams>

/**
 * Requests that backend shows the FPS counter
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowFPSCounterParams {
  /**
   * True for showing the FPS counter
   */
  readonly show: boolean
}

/**
 * Schema for `SetShowFPSCounterParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowFPSCounterParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    show: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowFPSCounterParams" })
) as any as Schema.Codec<SetShowFPSCounterParams>

/**
 * `setShowFlexOverlays.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowFlexOverlaysParams {
  /**
   * An array of node identifiers and descriptors for the highlight appearance.
   */
  readonly flexNodeHighlightConfigs: ReadonlyArray<FlexNodeHighlightConfig>
}

/**
 * Schema for `SetShowFlexOverlaysParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowFlexOverlaysParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    flexNodeHighlightConfigs: Schema.Array(FlexNodeHighlightConfig)
  }).annotate({ identifier: "Overlay.SetShowFlexOverlaysParams" })
) as any as Schema.Codec<SetShowFlexOverlaysParams>

/**
 * Highlight multiple elements with the CSS Grid overlay.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowGridOverlaysParams {
  /**
   * An array of node identifiers and descriptors for the highlight appearance.
   */
  readonly gridNodeHighlightConfigs: ReadonlyArray<GridNodeHighlightConfig>
}

/**
 * Schema for `SetShowGridOverlaysParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowGridOverlaysParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gridNodeHighlightConfigs: Schema.Array(GridNodeHighlightConfig)
  }).annotate({ identifier: "Overlay.SetShowGridOverlaysParams" })
) as any as Schema.Codec<SetShowGridOverlaysParams>

/**
 * Add a dual screen device hinge
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowHingeParams {
  /**
   * hinge data, null means hideHinge
   */
  readonly hingeConfig?: HingeConfig | undefined
}

/**
 * Schema for `SetShowHingeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowHingeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hingeConfig: Schema.optional(HingeConfig)
  }).annotate({ identifier: "Overlay.SetShowHingeParams" })
) as any as Schema.Codec<SetShowHingeParams>

/**
 * `setShowInspectedElementAnchor.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowInspectedElementAnchorParams {
  /**
   * Node identifier for which to show an anchor for.
   */
  readonly inspectedElementAnchorConfig: InspectedElementAnchorConfig
}

/**
 * Schema for `SetShowInspectedElementAnchorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowInspectedElementAnchorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    inspectedElementAnchorConfig: InspectedElementAnchorConfig
  }).annotate({ identifier: "Overlay.SetShowInspectedElementAnchorParams" })
) as any as Schema.Codec<SetShowInspectedElementAnchorParams>

/**
 * Show elements in isolation mode with overlays.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowIsolatedElementsParams {
  /**
   * An array of node identifiers and descriptors for the highlight appearance.
   */
  readonly isolatedElementHighlightConfigs: ReadonlyArray<IsolatedElementHighlightConfig>
}

/**
 * Schema for `SetShowIsolatedElementsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowIsolatedElementsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isolatedElementHighlightConfigs: Schema.Array(IsolatedElementHighlightConfig)
  }).annotate({ identifier: "Overlay.SetShowIsolatedElementsParams" })
) as any as Schema.Codec<SetShowIsolatedElementsParams>

/**
 * Requests that backend shows layout shift regions
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowLayoutShiftRegionsParams {
  /**
   * True for showing layout shift regions
   */
  readonly result: boolean
}

/**
 * Schema for `SetShowLayoutShiftRegionsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowLayoutShiftRegionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowLayoutShiftRegionsParams" })
) as any as Schema.Codec<SetShowLayoutShiftRegionsParams>

/**
 * Requests that backend shows paint rectangles
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowPaintRectsParams {
  /**
   * True for showing paint rectangles
   */
  readonly result: boolean
}

/**
 * Schema for `SetShowPaintRectsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowPaintRectsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowPaintRectsParams" })
) as any as Schema.Codec<SetShowPaintRectsParams>

/**
 * Requests that backend shows scroll bottleneck rects
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowScrollBottleneckRectsParams {
  /**
   * True for showing scroll bottleneck rects
   */
  readonly show: boolean
}

/**
 * Schema for `SetShowScrollBottleneckRectsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowScrollBottleneckRectsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    show: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowScrollBottleneckRectsParams" })
) as any as Schema.Codec<SetShowScrollBottleneckRectsParams>

/**
 * `setShowScrollSnapOverlays.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowScrollSnapOverlaysParams {
  /**
   * An array of node identifiers and descriptors for the highlight appearance.
   */
  readonly scrollSnapHighlightConfigs: ReadonlyArray<ScrollSnapHighlightConfig>
}

/**
 * Schema for `SetShowScrollSnapOverlaysParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowScrollSnapOverlaysParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scrollSnapHighlightConfigs: Schema.Array(ScrollSnapHighlightConfig)
  }).annotate({ identifier: "Overlay.SetShowScrollSnapOverlaysParams" })
) as any as Schema.Codec<SetShowScrollSnapOverlaysParams>

/**
 * Paints viewport size upon main frame resize.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowViewportSizeOnResizeParams {
  /**
   * Whether to paint size or not.
   */
  readonly show: boolean
}

/**
 * Schema for `SetShowViewportSizeOnResizeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowViewportSizeOnResizeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    show: Schema.Boolean
  }).annotate({ identifier: "Overlay.SetShowViewportSizeOnResizeParams" })
) as any as Schema.Codec<SetShowViewportSizeOnResizeParams>

/**
 * Show Window Controls Overlay for PWA
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetShowWindowControlsOverlayParams {
  /**
   * Window Controls Overlay data, null means hide Window Controls Overlay
   */
  readonly windowControlsOverlayConfig?: WindowControlsOverlayConfig | undefined
}

/**
 * Schema for `SetShowWindowControlsOverlayParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetShowWindowControlsOverlayParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    windowControlsOverlayConfig: Schema.optional(WindowControlsOverlayConfig)
  }).annotate({ identifier: "Overlay.SetShowWindowControlsOverlayParams" })
) as any as Schema.Codec<SetShowWindowControlsOverlayParams>

/**
 * Disables domain notifications.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Overlay.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Overlay.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables domain notifications.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Overlay.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Overlay.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * For Persistent Grid testing.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getGridHighlightObjectsForTest: Protocol.CommandDef<
  "Overlay.getGridHighlightObjectsForTest",
  GetGridHighlightObjectsForTestParams,
  GetGridHighlightObjectsForTestResult
> = /*#__PURE__*/ Protocol.command(
  "Overlay.getGridHighlightObjectsForTest",
  GetGridHighlightObjectsForTestParams,
  GetGridHighlightObjectsForTestResult,
  { status: "stable" }
)

/**
 * For testing.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getHighlightObjectForTest: Protocol.CommandDef<
  "Overlay.getHighlightObjectForTest",
  GetHighlightObjectForTestParams,
  GetHighlightObjectForTestResult
> = /*#__PURE__*/ Protocol.command(
  "Overlay.getHighlightObjectForTest",
  GetHighlightObjectForTestParams,
  GetHighlightObjectForTestResult,
  { status: "stable" }
)

/**
 * For Source Order Viewer testing.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getSourceOrderHighlightObjectForTest: Protocol.CommandDef<
  "Overlay.getSourceOrderHighlightObjectForTest",
  GetSourceOrderHighlightObjectForTestParams,
  GetSourceOrderHighlightObjectForTestResult
> = /*#__PURE__*/ Protocol.command(
  "Overlay.getSourceOrderHighlightObjectForTest",
  GetSourceOrderHighlightObjectForTestParams,
  GetSourceOrderHighlightObjectForTestResult,
  { status: "stable" }
)

/**
 * Hides any highlight.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const hideHighlight: Protocol.CommandDef<"Overlay.hideHighlight", void, void> = /*#__PURE__*/ Protocol.command(
  "Overlay.hideHighlight",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or
 * objectId must be specified.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const highlightNode: Protocol.CommandDef<"Overlay.highlightNode", HighlightNodeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.highlightNode",
    HighlightNodeParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights given quad. Coordinates are absolute with respect to the main frame viewport.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const highlightQuad: Protocol.CommandDef<"Overlay.highlightQuad", HighlightQuadParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.highlightQuad",
    HighlightQuadParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
 * Issue: the method does not handle device pixel ratio (DPR) correctly.
 * The coordinates currently have to be adjusted by the client
 * if DPR is not 1 (see crbug.com/437807128).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const highlightRect: Protocol.CommandDef<"Overlay.highlightRect", HighlightRectParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.highlightRect",
    HighlightRectParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights the source order of the children of the DOM node with given id or with the given
 * JavaScript object wrapper. Either nodeId or objectId must be specified.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const highlightSourceOrder: Protocol.CommandDef<
  "Overlay.highlightSourceOrder",
  HighlightSourceOrderParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.highlightSourceOrder",
  HighlightSourceOrderParams,
  undefined,
  { status: "stable" }
)

/**
 * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted.
 * Backend then generates 'inspectNodeRequested' event upon element selection.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setInspectMode: Protocol.CommandDef<"Overlay.setInspectMode", SetInspectModeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setInspectMode",
    SetInspectModeParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `Overlay.setPausedInDebuggerMessage`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPausedInDebuggerMessage: Protocol.CommandDef<
  "Overlay.setPausedInDebuggerMessage",
  SetPausedInDebuggerMessageParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setPausedInDebuggerMessage",
  SetPausedInDebuggerMessageParams,
  undefined,
  { status: "stable" }
)

/**
 * Highlights owner element of all frames detected to be ads.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowAdHighlights: Protocol.CommandDef<"Overlay.setShowAdHighlights", SetShowAdHighlightsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowAdHighlights",
    SetShowAdHighlightsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `Overlay.setShowContainerQueryOverlays`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowContainerQueryOverlays: Protocol.CommandDef<
  "Overlay.setShowContainerQueryOverlays",
  SetShowContainerQueryOverlaysParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowContainerQueryOverlays",
  SetShowContainerQueryOverlaysParams,
  undefined,
  { status: "stable" }
)

/**
 * Requests that backend shows debug borders on layers
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowDebugBorders: Protocol.CommandDef<"Overlay.setShowDebugBorders", SetShowDebugBordersParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowDebugBorders",
    SetShowDebugBordersParams,
    undefined,
    { status: "stable" }
  )

/**
 * Add a display cutout overlay.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowDisplayCutout: Protocol.CommandDef<
  "Overlay.setShowDisplayCutout",
  SetShowDisplayCutoutParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowDisplayCutout",
  SetShowDisplayCutoutParams,
  undefined,
  { status: "stable" }
)

/**
 * Requests that backend shows the FPS counter
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowFPSCounter: Protocol.CommandDef<"Overlay.setShowFPSCounter", SetShowFPSCounterParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowFPSCounter",
    SetShowFPSCounterParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `Overlay.setShowFlexOverlays`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowFlexOverlays: Protocol.CommandDef<"Overlay.setShowFlexOverlays", SetShowFlexOverlaysParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowFlexOverlays",
    SetShowFlexOverlaysParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlight multiple elements with the CSS Grid overlay.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowGridOverlays: Protocol.CommandDef<"Overlay.setShowGridOverlays", SetShowGridOverlaysParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowGridOverlays",
    SetShowGridOverlaysParams,
    undefined,
    { status: "stable" }
  )

/**
 * Add a dual screen device hinge
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowHinge: Protocol.CommandDef<"Overlay.setShowHinge", SetShowHingeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowHinge",
    SetShowHingeParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `Overlay.setShowInspectedElementAnchor`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowInspectedElementAnchor: Protocol.CommandDef<
  "Overlay.setShowInspectedElementAnchor",
  SetShowInspectedElementAnchorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowInspectedElementAnchor",
  SetShowInspectedElementAnchorParams,
  undefined,
  { status: "stable" }
)

/**
 * Show elements in isolation mode with overlays.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowIsolatedElements: Protocol.CommandDef<
  "Overlay.setShowIsolatedElements",
  SetShowIsolatedElementsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowIsolatedElements",
  SetShowIsolatedElementsParams,
  undefined,
  { status: "stable" }
)

/**
 * Requests that backend shows layout shift regions
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowLayoutShiftRegions: Protocol.CommandDef<
  "Overlay.setShowLayoutShiftRegions",
  SetShowLayoutShiftRegionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowLayoutShiftRegions",
  SetShowLayoutShiftRegionsParams,
  undefined,
  { status: "stable" }
)

/**
 * Requests that backend shows paint rectangles
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowPaintRects: Protocol.CommandDef<"Overlay.setShowPaintRects", SetShowPaintRectsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Overlay.setShowPaintRects",
    SetShowPaintRectsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Requests that backend shows scroll bottleneck rects
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowScrollBottleneckRects: Protocol.CommandDef<
  "Overlay.setShowScrollBottleneckRects",
  SetShowScrollBottleneckRectsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowScrollBottleneckRects",
  SetShowScrollBottleneckRectsParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `Overlay.setShowScrollSnapOverlays`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowScrollSnapOverlays: Protocol.CommandDef<
  "Overlay.setShowScrollSnapOverlays",
  SetShowScrollSnapOverlaysParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowScrollSnapOverlays",
  SetShowScrollSnapOverlaysParams,
  undefined,
  { status: "stable" }
)

/**
 * Paints viewport size upon main frame resize.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowViewportSizeOnResize: Protocol.CommandDef<
  "Overlay.setShowViewportSizeOnResize",
  SetShowViewportSizeOnResizeParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowViewportSizeOnResize",
  SetShowViewportSizeOnResizeParams,
  undefined,
  { status: "stable" }
)

/**
 * Show Window Controls Overlay for PWA
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setShowWindowControlsOverlay: Protocol.CommandDef<
  "Overlay.setShowWindowControlsOverlay",
  SetShowWindowControlsOverlayParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Overlay.setShowWindowControlsOverlay",
  SetShowWindowControlsOverlayParams,
  undefined,
  { status: "stable" }
)

/**
 * Fired when user cancels the inspect mode.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const inspectModeCanceled: Protocol.EventDef<"Overlay.inspectModeCanceled", void> = /*#__PURE__*/ Protocol.event(
  "Overlay.inspectModeCanceled",
  undefined,
  { status: "stable" }
)

/**
 * Fired when the node should be inspected. This happens after call to `setInspectMode` or when
 * user manually inspects an element.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const inspectNodeRequested: Protocol.EventDef<"Overlay.inspectNodeRequested", InspectNodeRequestedParams> =
  /*#__PURE__*/ Protocol.event(
    "Overlay.inspectNodeRequested",
    InspectNodeRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when user asks to show the Inspect panel.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const inspectPanelShowRequested: Protocol.EventDef<
  "Overlay.inspectPanelShowRequested",
  InspectPanelShowRequestedParams
> = /*#__PURE__*/ Protocol.event(
  "Overlay.inspectPanelShowRequested",
  InspectPanelShowRequestedParams,
  { status: "stable" }
)

/**
 * Fired when user asks to restore the Inspected Element floating window.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const inspectedElementWindowRestored: Protocol.EventDef<
  "Overlay.inspectedElementWindowRestored",
  InspectedElementWindowRestoredParams
> = /*#__PURE__*/ Protocol.event(
  "Overlay.inspectedElementWindowRestored",
  InspectedElementWindowRestoredParams,
  { status: "stable" }
)

/**
 * Fired when the node should be highlighted. This happens after call to `setInspectMode`.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const nodeHighlightRequested: Protocol.EventDef<"Overlay.nodeHighlightRequested", NodeHighlightRequestedParams> =
  /*#__PURE__*/ Protocol.event(
    "Overlay.nodeHighlightRequested",
    NodeHighlightRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when user asks to capture screenshot of some area on the page.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const screenshotRequested: Protocol.EventDef<"Overlay.screenshotRequested", ScreenshotRequestedParams> =
  /*#__PURE__*/ Protocol.event(
    "Overlay.screenshotRequested",
    ScreenshotRequestedParams,
    { status: "stable" }
  )
