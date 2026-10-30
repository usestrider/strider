/**
 * This domain exposes DOM read/write operations. Each DOM Node is represented with its mirror object
 * that has an `id`. This `id` can be used to get additional information on the Node, resolve it into
 * the JavaScript object wrapper, etc. It is important that client receives DOM events only for the
 * nodes that are known to the client. Backend keeps track of the nodes that were sent to the client
 * and never sends the same node twice. It is client's responsibility to collect information about
 * the nodes that were sent to the client. Note that `iframe` owner elements will return
 * corresponding document elements as their child nodes.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Backend node with a friendly name.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BackendNode {
  /**
   * `Node`'s nodeType.
   */
  readonly nodeType: number
  /**
   * `Node`'s nodeName.
   */
  readonly nodeName: string
  readonly backendNodeId: BackendNodeId
}

/**
 * Schema for `BackendNode`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BackendNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeType: Schema.Int,
    nodeName: Schema.String,
    backendNodeId: BackendNodeId
  }).annotate({ identifier: "DOM.BackendNode" })
) as any as Schema.Codec<BackendNode>

/**
 * Unique DOM node identifier used to reference a node that may not have been pushed to the
 * front-end.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BackendNodeId = Brand.Branded<number, "~@usestrider/browser/cdp/DOM/BackendNodeId">

/**
 * Schema for `BackendNodeId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BackendNodeId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/DOM/BackendNodeId")
) as any as Schema.Codec<BackendNodeId>

/**
 * Box model.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BoxModel {
  /**
   * Content box
   */
  readonly content: Quad
  /**
   * Padding box
   */
  readonly padding: Quad
  /**
   * Border box
   */
  readonly border: Quad
  /**
   * Margin box
   */
  readonly margin: Quad
  /**
   * Node width
   */
  readonly width: number
  /**
   * Node height
   */
  readonly height: number
  /**
   * Shape outside coordinates
   */
  readonly shapeOutside?: ShapeOutsideInfo | undefined
}

/**
 * Schema for `BoxModel`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BoxModel = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    content: Quad,
    padding: Quad,
    border: Quad,
    margin: Quad,
    width: Schema.Int,
    height: Schema.Int,
    shapeOutside: Schema.optional(ShapeOutsideInfo)
  }).annotate({ identifier: "DOM.BoxModel" })
) as any as Schema.Codec<BoxModel>

/**
 * `CSSComputedStyleProperty`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSComputedStyleProperty {
  /**
   * Computed style property name.
   */
  readonly name: string
  /**
   * Computed style property value.
   */
  readonly value: string
}

/**
 * Schema for `CSSComputedStyleProperty`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSComputedStyleProperty = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "DOM.CSSComputedStyleProperty" })
) as any as Schema.Codec<CSSComputedStyleProperty>

/**
 * Document compatibility mode.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CompatibilityMode =
  | "QuirksMode"
  | "LimitedQuirksMode"
  | "NoQuirksMode"
  | (string & {})

/**
 * Schema for `CompatibilityMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CompatibilityMode = Schema.String as any as Schema.Codec<CompatibilityMode>

/**
 * A structure to hold the top-level node of a detached tree and an array of its retained descendants.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DetachedElementInfo {
  readonly treeNode: Node
  readonly retainedNodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `DetachedElementInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DetachedElementInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    treeNode: Node,
    retainedNodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.DetachedElementInfo" })
) as any as Schema.Codec<DetachedElementInfo, unknown>

/**
 * ContainerSelector logical axes
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LogicalAxes =
  | "Inline"
  | "Block"
  | "Both"
  | (string & {})

/**
 * Schema for `LogicalAxes`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LogicalAxes = Schema.String as any as Schema.Codec<LogicalAxes>

/**
 * DOM interaction is implemented in terms of mirror objects that represent the actual DOM nodes.
 * DOMNode is a base node mirror type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Node {
  /**
   * Node identifier that is passed into the rest of the DOM messages as the `nodeId`. Backend
   * will only push node with given `id` once. It is aware of all requested nodes and will only
   * fire DOM events for nodes known to the client.
   */
  readonly nodeId: NodeId
  /**
   * The id of the parent node if any.
   */
  readonly parentId?: NodeId | undefined
  /**
   * The BackendNodeId for this node.
   */
  readonly backendNodeId: BackendNodeId
  /**
   * `Node`'s nodeType.
   */
  readonly nodeType: number
  /**
   * `Node`'s nodeName.
   */
  readonly nodeName: string
  /**
   * `Node`'s localName.
   */
  readonly localName: string
  /**
   * `Node`'s nodeValue.
   */
  readonly nodeValue: string
  /**
   * Child count for `Container` nodes.
   */
  readonly childNodeCount?: number | undefined
  /**
   * Child nodes of this node when requested with children.
   */
  readonly children?: ReadonlyArray<Node> | undefined
  /**
   * Attributes of the `Element` node in the form of flat array `[name1, value1, name2, value2]`.
   */
  readonly attributes?: ReadonlyArray<string> | undefined
  /**
   * Document URL that `Document` or `FrameOwner` node points to.
   */
  readonly documentURL?: string | undefined
  /**
   * Base URL that `Document` or `FrameOwner` node uses for URL completion.
   */
  readonly baseURL?: string | undefined
  /**
   * `DocumentType`'s publicId.
   */
  readonly publicId?: string | undefined
  /**
   * `DocumentType`'s systemId.
   */
  readonly systemId?: string | undefined
  /**
   * `DocumentType`'s internalSubset.
   */
  readonly internalSubset?: string | undefined
  /**
   * `Document`'s XML version in case of XML documents.
   */
  readonly xmlVersion?: string | undefined
  /**
   * `Attr`'s name.
   */
  readonly name?: string | undefined
  /**
   * `Attr`'s value.
   */
  readonly value?: string | undefined
  /**
   * Pseudo element type for this node.
   */
  readonly pseudoType?: PseudoType | undefined
  /**
   * Pseudo element identifier for this node. Only present if there is a
   * valid pseudoType.
   */
  readonly pseudoIdentifier?: string | undefined
  /**
   * Shadow root type.
   */
  readonly shadowRootType?: ShadowRootType | undefined
  /**
   * Frame ID for frame owner elements.
   */
  readonly frameId?: Page.FrameId | undefined
  /**
   * Content document for frame owner elements.
   */
  readonly contentDocument?: Node | undefined
  /**
   * Shadow root list for given element host.
   */
  readonly shadowRoots?: ReadonlyArray<Node> | undefined
  /**
   * Content document fragment for template elements.
   */
  readonly templateContent?: Node | undefined
  /**
   * Pseudo elements associated with this node.
   */
  readonly pseudoElements?: ReadonlyArray<Node> | undefined
  /**
   * Distributed nodes for given insertion point.
   */
  readonly distributedNodes?: ReadonlyArray<BackendNode> | undefined
  /**
   * Whether the node is SVG.
   */
  readonly isSVG?: boolean | undefined
  readonly compatibilityMode?: CompatibilityMode | undefined
  readonly assignedSlot?: BackendNode | undefined
  readonly isScrollable?: boolean | undefined
  readonly affectedByStartingStyles?: boolean | undefined
  readonly adoptedStyleSheets?: ReadonlyArray<StyleSheetId> | undefined
  readonly adProvenance?: Network.AdProvenance | undefined
}

/**
 * Schema for `Node`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Node = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    parentId: Schema.optional(NodeId),
    backendNodeId: BackendNodeId,
    nodeType: Schema.Int,
    nodeName: Schema.String,
    localName: Schema.String,
    nodeValue: Schema.String,
    childNodeCount: Schema.optional(Schema.Int),
    children: Schema.optional(Schema.Array(Node)),
    attributes: Schema.optional(Schema.Array(Schema.String)),
    documentURL: Schema.optional(Schema.String),
    baseURL: Schema.optional(Schema.String),
    publicId: Schema.optional(Schema.String),
    systemId: Schema.optional(Schema.String),
    internalSubset: Schema.optional(Schema.String),
    xmlVersion: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    value: Schema.optional(Schema.String),
    pseudoType: Schema.optional(PseudoType),
    pseudoIdentifier: Schema.optional(Schema.String),
    shadowRootType: Schema.optional(ShadowRootType),
    frameId: Schema.optional(Page.FrameId),
    contentDocument: Schema.optional(Node),
    shadowRoots: Schema.optional(Schema.Array(Node)),
    templateContent: Schema.optional(Node),
    pseudoElements: Schema.optional(Schema.Array(Node)),
    distributedNodes: Schema.optional(Schema.Array(BackendNode)),
    isSVG: Schema.optional(Schema.Boolean),
    compatibilityMode: Schema.optional(CompatibilityMode),
    assignedSlot: Schema.optional(BackendNode),
    isScrollable: Schema.optional(Schema.Boolean),
    affectedByStartingStyles: Schema.optional(Schema.Boolean),
    adoptedStyleSheets: Schema.optional(Schema.Array(StyleSheetId)),
    adProvenance: Schema.optional(Network.AdProvenance)
  }).annotate({ identifier: "DOM.Node" })
) as any as Schema.Codec<Node, unknown>

/**
 * Unique DOM node identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NodeId = Brand.Branded<number, "~@usestrider/browser/cdp/DOM/NodeId">

/**
 * Schema for `NodeId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/DOM/NodeId")
) as any as Schema.Codec<NodeId>

/**
 * ContainerSelector physical axes
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PhysicalAxes =
  | "Horizontal"
  | "Vertical"
  | "Both"
  | (string & {})

/**
 * Schema for `PhysicalAxes`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PhysicalAxes = Schema.String as any as Schema.Codec<PhysicalAxes>

/**
 * Pseudo element type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PseudoType =
  | "first-line"
  | "first-letter"
  | "checkmark"
  | "before"
  | "after"
  | "expand-icon"
  | "picker-icon"
  | "interest-button"
  | "marker"
  | "backdrop"
  | "column"
  | "selection"
  | "search-text"
  | "target-text"
  | "spelling-error"
  | "grammar-error"
  | "highlight"
  | "first-line-inherited"
  | "scroll-marker"
  | "scroll-marker-group"
  | "scroll-button"
  | "scrollbar"
  | "scrollbar-thumb"
  | "scrollbar-button"
  | "scrollbar-track"
  | "scrollbar-track-piece"
  | "scrollbar-corner"
  | "resizer"
  | "input-list-button"
  | "view-transition"
  | "view-transition-group"
  | "view-transition-image-pair"
  | "view-transition-group-children"
  | "view-transition-old"
  | "view-transition-new"
  | "placeholder"
  | "file-selector-button"
  | "details-content"
  | "picker"
  | "select-listbox"
  | "permission-icon"
  | "overscroll-area-parent"
  | "overscroll-backdrop"
  | "skeleton"
  | (string & {})

/**
 * Schema for `PseudoType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PseudoType = Schema.String as any as Schema.Codec<PseudoType>

/**
 * An array of quad vertices, x immediately followed by y for each point, points clock-wise.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Quad = ReadonlyArray<number>

/**
 * Schema for `Quad`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Quad = /*#__PURE__*/ Schema.suspend(() => Schema.Array(Schema.Number)) as any as Schema.Codec<Quad>

/**
 * A structure holding an RGBA color.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RGBA {
  /**
   * The red component, in the [0-255] range.
   */
  readonly r: number
  /**
   * The green component, in the [0-255] range.
   */
  readonly g: number
  /**
   * The blue component, in the [0-255] range.
   */
  readonly b: number
  /**
   * The alpha component, in the [0-1] range (default: 1).
   */
  readonly a?: number | undefined
}

/**
 * Schema for `RGBA`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RGBA = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    r: Schema.Int,
    g: Schema.Int,
    b: Schema.Int,
    a: Schema.optional(Schema.Number)
  }).annotate({ identifier: "DOM.RGBA" })
) as any as Schema.Codec<RGBA>

/**
 * Rectangle.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Rect {
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
}

/**
 * Schema for `Rect`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Rect = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number
  }).annotate({ identifier: "DOM.Rect" })
) as any as Schema.Codec<Rect>

/**
 * Physical scroll orientation
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScrollOrientation =
  | "horizontal"
  | "vertical"
  | (string & {})

/**
 * Schema for `ScrollOrientation`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScrollOrientation = Schema.String as any as Schema.Codec<ScrollOrientation>

/**
 * Shadow root type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ShadowRootType =
  | "user-agent"
  | "open"
  | "closed"
  | (string & {})

/**
 * Schema for `ShadowRootType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShadowRootType = Schema.String as any as Schema.Codec<ShadowRootType>

/**
 * CSS Shape Outside details.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ShapeOutsideInfo {
  /**
   * Shape bounds
   */
  readonly bounds: Quad
  /**
   * Shape coordinate details
   */
  readonly shape: ReadonlyArray<unknown>
  /**
   * Margin shape bounds
   */
  readonly marginShape: ReadonlyArray<unknown>
}

/**
 * Schema for `ShapeOutsideInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShapeOutsideInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bounds: Quad,
    shape: Schema.Array(Schema.Unknown),
    marginShape: Schema.Array(Schema.Unknown)
  }).annotate({ identifier: "DOM.ShapeOutsideInfo" })
) as any as Schema.Codec<ShapeOutsideInfo>

/**
 * Unique identifier for a CSS stylesheet.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StyleSheetId = Brand.Branded<string, "~@usestrider/browser/cdp/DOM/StyleSheetId">

/**
 * Schema for `StyleSheetId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/DOM/StyleSheetId")
) as any as Schema.Codec<StyleSheetId>

/**
 * Fired when a node's ad related state changes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdRelatedStateUpdatedParams {
  /**
   * The id of the node.
   */
  readonly nodeId: NodeId
  /**
   * The provenance of the ad related node, if it is ad related.
   */
  readonly adProvenance?: Network.AdProvenance | undefined
}

/**
 * Schema for `AdRelatedStateUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdRelatedStateUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    adProvenance: Schema.optional(Network.AdProvenance)
  }).annotate({ identifier: "DOM.AdRelatedStateUpdatedParams" })
) as any as Schema.Codec<AdRelatedStateUpdatedParams>

/**
 * Fired when `Element`'s adoptedStyleSheets are modified.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdoptedStyleSheetsModifiedParams {
  /**
   * Id of the node that has changed.
   */
  readonly nodeId: NodeId
  /**
   * New adoptedStyleSheets array.
   */
  readonly adoptedStyleSheets?: ReadonlyArray<StyleSheetId> | undefined
}

/**
 * Schema for `AdoptedStyleSheetsModifiedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdoptedStyleSheetsModifiedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    adoptedStyleSheets: Schema.optional(Schema.Array(StyleSheetId))
  }).annotate({ identifier: "DOM.AdoptedStyleSheetsModifiedParams" })
) as any as Schema.Codec<AdoptedStyleSheetsModifiedParams>

/**
 * Fired when a node's starting styles changes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AffectedByStartingStylesFlagUpdatedParams {
  /**
   * The id of the node.
   */
  readonly nodeId: NodeId
  /**
   * If the node has starting styles.
   */
  readonly affectedByStartingStyles: boolean
}

/**
 * Schema for `AffectedByStartingStylesFlagUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AffectedByStartingStylesFlagUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    affectedByStartingStyles: Schema.Boolean
  }).annotate({ identifier: "DOM.AffectedByStartingStylesFlagUpdatedParams" })
) as any as Schema.Codec<AffectedByStartingStylesFlagUpdatedParams>

/**
 * Fired when `Element`'s attribute is modified.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AttributeModifiedParams {
  /**
   * Id of the node that has changed.
   */
  readonly nodeId: NodeId
  /**
   * Attribute name.
   */
  readonly name: string
  /**
   * Attribute value.
   */
  readonly value: string
}

/**
 * Schema for `AttributeModifiedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AttributeModifiedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "DOM.AttributeModifiedParams" })
) as any as Schema.Codec<AttributeModifiedParams>

/**
 * Fired when `Element`'s attribute is removed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AttributeRemovedParams {
  /**
   * Id of the node that has changed.
   */
  readonly nodeId: NodeId
  /**
   * A ttribute name.
   */
  readonly name: string
}

/**
 * Schema for `AttributeRemovedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AttributeRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    name: Schema.String
  }).annotate({ identifier: "DOM.AttributeRemovedParams" })
) as any as Schema.Codec<AttributeRemovedParams>

/**
 * Mirrors `DOMCharacterDataModified` event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CharacterDataModifiedParams {
  /**
   * Id of the node that has changed.
   */
  readonly nodeId: NodeId
  /**
   * New text value.
   */
  readonly characterData: string
}

/**
 * Schema for `CharacterDataModifiedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CharacterDataModifiedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    characterData: Schema.String
  }).annotate({ identifier: "DOM.CharacterDataModifiedParams" })
) as any as Schema.Codec<CharacterDataModifiedParams>

/**
 * Fired when `Container`'s child node count has changed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ChildNodeCountUpdatedParams {
  /**
   * Id of the node that has changed.
   */
  readonly nodeId: NodeId
  /**
   * New node count.
   */
  readonly childNodeCount: number
}

/**
 * Schema for `ChildNodeCountUpdatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChildNodeCountUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    childNodeCount: Schema.Int
  }).annotate({ identifier: "DOM.ChildNodeCountUpdatedParams" })
) as any as Schema.Codec<ChildNodeCountUpdatedParams>

/**
 * Mirrors `DOMNodeInserted` event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ChildNodeInsertedParams {
  /**
   * Id of the node that has changed.
   */
  readonly parentNodeId: NodeId
  /**
   * Id of the previous sibling.
   */
  readonly previousNodeId: NodeId
  /**
   * Inserted node data.
   */
  readonly node: Node
}

/**
 * Schema for `ChildNodeInsertedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChildNodeInsertedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentNodeId: NodeId,
    previousNodeId: NodeId,
    node: Node
  }).annotate({ identifier: "DOM.ChildNodeInsertedParams" })
) as any as Schema.Codec<ChildNodeInsertedParams, unknown>

/**
 * Mirrors `DOMNodeRemoved` event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ChildNodeRemovedParams {
  /**
   * Parent id.
   */
  readonly parentNodeId: NodeId
  /**
   * Id of the node that has been removed.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `ChildNodeRemovedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChildNodeRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentNodeId: NodeId,
    nodeId: NodeId
  }).annotate({ identifier: "DOM.ChildNodeRemovedParams" })
) as any as Schema.Codec<ChildNodeRemovedParams>

/**
 * Collects class names for the node with given id and all of it's child nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CollectClassNamesFromSubtreeParams {
  /**
   * Id of the node to collect class names.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `CollectClassNamesFromSubtreeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CollectClassNamesFromSubtreeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.CollectClassNamesFromSubtreeParams" })
) as any as Schema.Codec<CollectClassNamesFromSubtreeParams>

/**
 * Collects class names for the node with given id and all of it's child nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CollectClassNamesFromSubtreeResult {
  /**
   * Class name list.
   */
  readonly classNames: ReadonlyArray<string>
}

/**
 * Schema for `CollectClassNamesFromSubtreeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CollectClassNamesFromSubtreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    classNames: Schema.Array(Schema.String)
  }).annotate({ identifier: "DOM.CollectClassNamesFromSubtreeResult" })
) as any as Schema.Codec<CollectClassNamesFromSubtreeResult>

/**
 * Creates a deep copy of the specified node and places it into the target container before the
 * given anchor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CopyToParams {
  /**
   * Id of the node to copy.
   */
  readonly nodeId: NodeId
  /**
   * Id of the element to drop the copy into.
   */
  readonly targetNodeId: NodeId
  /**
   * Drop the copy before this node (if absent, the copy becomes the last child of
   * `targetNodeId`).
   */
  readonly insertBeforeNodeId?: NodeId | undefined
}

/**
 * Schema for `CopyToParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CopyToParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    targetNodeId: NodeId,
    insertBeforeNodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.CopyToParams" })
) as any as Schema.Codec<CopyToParams>

/**
 * Creates a deep copy of the specified node and places it into the target container before the
 * given anchor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CopyToResult {
  /**
   * Id of the node clone.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `CopyToResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CopyToResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.CopyToResult" })
) as any as Schema.Codec<CopyToResult>

/**
 * Describes node given its id, does not require domain to be enabled. Does not start tracking any
 * objects, can be used for automation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DescribeNodeParams {
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
   * entire subtree or provide an integer larger than 0.
   */
  readonly depth?: number | undefined
  /**
   * Whether or not iframes and shadow roots should be traversed when returning the subtree
   * (default is false).
   */
  readonly pierce?: boolean | undefined
}

/**
 * Schema for `DescribeNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DescribeNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    depth: Schema.optional(Schema.Int),
    pierce: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.DescribeNodeParams" })
) as any as Schema.Codec<DescribeNodeParams>

/**
 * Describes node given its id, does not require domain to be enabled. Does not start tracking any
 * objects, can be used for automation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DescribeNodeResult {
  /**
   * Node description.
   */
  readonly node: Node
}

/**
 * Schema for `DescribeNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DescribeNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    node: Node
  }).annotate({ identifier: "DOM.DescribeNodeResult" })
) as any as Schema.Codec<DescribeNodeResult, unknown>

/**
 * Discards search results from the session with the given id. `getSearchResults` should no longer
 * be called for that search.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DiscardSearchResultsParams {
  /**
   * Unique search session identifier.
   */
  readonly searchId: string
}

/**
 * Schema for `DiscardSearchResultsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DiscardSearchResultsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    searchId: Schema.String
  }).annotate({ identifier: "DOM.DiscardSearchResultsParams" })
) as any as Schema.Codec<DiscardSearchResultsParams>

/**
 * Called when distribution is changed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DistributedNodesUpdatedParams {
  /**
   * Insertion point where distributed nodes were updated.
   */
  readonly insertionPointId: NodeId
  /**
   * Distributed nodes for given insertion point.
   */
  readonly distributedNodes: ReadonlyArray<BackendNode>
}

/**
 * Schema for `DistributedNodesUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DistributedNodesUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    insertionPointId: NodeId,
    distributedNodes: Schema.Array(BackendNode)
  }).annotate({ identifier: "DOM.DistributedNodesUpdatedParams" })
) as any as Schema.Codec<DistributedNodesUpdatedParams>

/**
 * Enables DOM agent for the given page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * Whether to include whitespaces in the children array of returned Nodes.
   */
  readonly includeWhitespace?: EnableParamsIncludeWhitespace | undefined
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
    includeWhitespace: Schema.optional(EnableParamsIncludeWhitespace)
  }).annotate({ identifier: "DOM.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Whether to include whitespaces in the children array of returned Nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type EnableParamsIncludeWhitespace =
  | "none"
  | "all"
  | (string & {})

/**
 * Schema for `EnableParamsIncludeWhitespace`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EnableParamsIncludeWhitespace = Schema.String as any as Schema.Codec<EnableParamsIncludeWhitespace>

/**
 * Focuses the given element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FocusParams {
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
}

/**
 * Schema for `FocusParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FocusParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId)
  }).annotate({ identifier: "DOM.FocusParams" })
) as any as Schema.Codec<FocusParams>

/**
 * When enabling, this API forces an element to gain interest in its target,
 * keeping interest active until disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ForceShowInterestParams {
  /**
   * Id of the interest invoker HTMLElement.
   */
  readonly nodeId: NodeId
  /**
   * If true, opens and holds interest. If false, releases forced interest.
   */
  readonly enable: boolean
}

/**
 * Schema for `ForceShowInterestParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ForceShowInterestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    enable: Schema.Boolean
  }).annotate({ identifier: "DOM.ForceShowInterestParams" })
) as any as Schema.Codec<ForceShowInterestParams>

/**
 * When enabling, this API force-opens the popover identified by nodeId
 * and keeps it open until disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ForceShowPopoverParams {
  /**
   * Id of the popover HTMLElement
   */
  readonly nodeId: NodeId
  /**
   * If true, opens the popover and keeps it open. If false, closes the
   * popover if it was previously force-opened.
   */
  readonly enable: boolean
  /**
   * Optional ID of the element invoking this popover, used to establish the implicit anchor.
   * If not provided, it will fall back to the first invoker in the document, preferring
   * elements with a popovertarget attribute over those with a commandfor attribute. Note that
   * if there are multiple invokers, this is just an estimate.
   */
  readonly invokerNodeId?: BackendNodeId | undefined
}

/**
 * Schema for `ForceShowPopoverParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ForceShowPopoverParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    enable: Schema.Boolean,
    invokerNodeId: Schema.optional(BackendNodeId)
  }).annotate({ identifier: "DOM.ForceShowPopoverParams" })
) as any as Schema.Codec<ForceShowPopoverParams>

/**
 * When enabling, this API force-opens the popover identified by nodeId
 * and keeps it open until disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ForceShowPopoverResult {
  /**
   * List of popovers that were closed in order to respect popover stacking order.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `ForceShowPopoverResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ForceShowPopoverResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.ForceShowPopoverResult" })
) as any as Schema.Codec<ForceShowPopoverResult>

/**
 * Returns the target anchor element of the given anchor query according to
 * https://www.w3.org/TR/css-anchor-position-1/#target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAnchorElementParams {
  /**
   * Id of the positioned element from which to find the anchor.
   */
  readonly nodeId: NodeId
  /**
   * An optional anchor specifier, as defined in
   * https://www.w3.org/TR/css-anchor-position-1/#anchor-specifier.
   * If not provided, it will return the implicit anchor element for
   * the given positioned element.
   */
  readonly anchorSpecifier?: string | undefined
}

/**
 * Schema for `GetAnchorElementParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAnchorElementParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    anchorSpecifier: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOM.GetAnchorElementParams" })
) as any as Schema.Codec<GetAnchorElementParams>

/**
 * Returns the target anchor element of the given anchor query according to
 * https://www.w3.org/TR/css-anchor-position-1/#target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAnchorElementResult {
  /**
   * The anchor element of the given anchor query.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetAnchorElementResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAnchorElementResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetAnchorElementResult" })
) as any as Schema.Codec<GetAnchorElementResult>

/**
 * Returns attributes for the specified node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAttributesParams {
  /**
   * Id of the node to retrieve attributes for.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetAttributesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAttributesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetAttributesParams" })
) as any as Schema.Codec<GetAttributesParams>

/**
 * Returns attributes for the specified node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAttributesResult {
  /**
   * An interleaved array of node attribute names and values.
   */
  readonly attributes: ReadonlyArray<string>
}

/**
 * Schema for `GetAttributesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAttributesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    attributes: Schema.Array(Schema.String)
  }).annotate({ identifier: "DOM.GetAttributesResult" })
) as any as Schema.Codec<GetAttributesResult>

/**
 * Returns boxes for the given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBoxModelParams {
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
}

/**
 * Schema for `GetBoxModelParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBoxModelParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId)
  }).annotate({ identifier: "DOM.GetBoxModelParams" })
) as any as Schema.Codec<GetBoxModelParams>

/**
 * Returns boxes for the given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBoxModelResult {
  /**
   * Box model for the node.
   */
  readonly model: BoxModel
}

/**
 * Schema for `GetBoxModelResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBoxModelResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    model: BoxModel
  }).annotate({ identifier: "DOM.GetBoxModelResult" })
) as any as Schema.Codec<GetBoxModelResult>

/**
 * Returns the query container of the given node based on container query
 * conditions: containerName, physical and logical axes, and whether it queries
 * scroll-state or anchored elements. If no axes are provided and
 * queriesScrollState is false, the style container is returned, which is the
 * direct parent or the closest element with a matching container-name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetContainerForNodeParams {
  readonly nodeId: NodeId
  readonly containerName?: string | undefined
  readonly physicalAxes?: PhysicalAxes | undefined
  readonly logicalAxes?: LogicalAxes | undefined
  readonly queriesScrollState?: boolean | undefined
  readonly queriesAnchored?: boolean | undefined
}

/**
 * Schema for `GetContainerForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetContainerForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    containerName: Schema.optional(Schema.String),
    physicalAxes: Schema.optional(PhysicalAxes),
    logicalAxes: Schema.optional(LogicalAxes),
    queriesScrollState: Schema.optional(Schema.Boolean),
    queriesAnchored: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GetContainerForNodeParams" })
) as any as Schema.Codec<GetContainerForNodeParams>

/**
 * Returns the query container of the given node based on container query
 * conditions: containerName, physical and logical axes, and whether it queries
 * scroll-state or anchored elements. If no axes are provided and
 * queriesScrollState is false, the style container is returned, which is the
 * direct parent or the closest element with a matching container-name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetContainerForNodeResult {
  /**
   * The container node for the given node, or null if not found.
   */
  readonly nodeId?: NodeId | undefined
}

/**
 * Schema for `GetContainerForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetContainerForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.GetContainerForNodeResult" })
) as any as Schema.Codec<GetContainerForNodeResult>

/**
 * Returns quads that describe node position on the page. This method
 * might return multiple quads for inline nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetContentQuadsParams {
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
}

/**
 * Schema for `GetContentQuadsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetContentQuadsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId)
  }).annotate({ identifier: "DOM.GetContentQuadsParams" })
) as any as Schema.Codec<GetContentQuadsParams>

/**
 * Returns quads that describe node position on the page. This method
 * might return multiple quads for inline nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetContentQuadsResult {
  /**
   * Quads that describe node layout relative to viewport.
   */
  readonly quads: ReadonlyArray<Quad>
}

/**
 * Schema for `GetContentQuadsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetContentQuadsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    quads: Schema.Array(Quad)
  }).annotate({ identifier: "DOM.GetContentQuadsResult" })
) as any as Schema.Codec<GetContentQuadsResult>

/**
 * Returns list of detached nodes
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDetachedDomNodesResult {
  /**
   * The list of detached nodes
   */
  readonly detachedNodes: ReadonlyArray<DetachedElementInfo>
}

/**
 * Schema for `GetDetachedDomNodesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDetachedDomNodesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    detachedNodes: Schema.Array(DetachedElementInfo)
  }).annotate({ identifier: "DOM.GetDetachedDomNodesResult" })
) as any as Schema.Codec<GetDetachedDomNodesResult, unknown>

/**
 * Returns the root DOM node (and optionally the subtree) to the caller.
 * Implicitly enables the DOM domain events for the current target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDocumentParams {
  /**
   * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
   * entire subtree or provide an integer larger than 0.
   */
  readonly depth?: number | undefined
  /**
   * Whether or not iframes and shadow roots should be traversed when returning the subtree
   * (default is false).
   */
  readonly pierce?: boolean | undefined
}

/**
 * Schema for `GetDocumentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDocumentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    depth: Schema.optional(Schema.Int),
    pierce: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GetDocumentParams" })
) as any as Schema.Codec<GetDocumentParams>

/**
 * Returns the root DOM node (and optionally the subtree) to the caller.
 * Implicitly enables the DOM domain events for the current target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDocumentResult {
  /**
   * Resulting node.
   */
  readonly root: Node
}

/**
 * Schema for `GetDocumentResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDocumentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    root: Node
  }).annotate({ identifier: "DOM.GetDocumentResult" })
) as any as Schema.Codec<GetDocumentResult, unknown>

/**
 * Returns the NodeId of the matched element according to certain relations.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetElementByRelationParams {
  /**
   * Id of the node from which to query the relation.
   */
  readonly nodeId: NodeId
  /**
   * Type of relation to get.
   */
  readonly relation: GetElementByRelationParamsRelation
}

/**
 * Schema for `GetElementByRelationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetElementByRelationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    relation: GetElementByRelationParamsRelation
  }).annotate({ identifier: "DOM.GetElementByRelationParams" })
) as any as Schema.Codec<GetElementByRelationParams>

/**
 * Type of relation to get.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type GetElementByRelationParamsRelation =
  | "PopoverTarget"
  | "InterestTarget"
  | "CommandFor"
  | (string & {})

/**
 * Schema for `GetElementByRelationParamsRelation`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetElementByRelationParamsRelation = Schema.String as any as Schema.Codec<
  GetElementByRelationParamsRelation
>

/**
 * Returns the NodeId of the matched element according to certain relations.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetElementByRelationResult {
  /**
   * NodeId of the element matching the queried relation.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetElementByRelationResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetElementByRelationResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetElementByRelationResult" })
) as any as Schema.Codec<GetElementByRelationResult>

/**
 * Returns file information for the given
 * File wrapper.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFileInfoParams {
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId: Runtime.RemoteObjectId
}

/**
 * Schema for `GetFileInfoParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFileInfoParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId
  }).annotate({ identifier: "DOM.GetFileInfoParams" })
) as any as Schema.Codec<GetFileInfoParams>

/**
 * Returns file information for the given
 * File wrapper.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFileInfoResult {
  readonly path: string
}

/**
 * Schema for `GetFileInfoResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFileInfoResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    path: Schema.String
  }).annotate({ identifier: "DOM.GetFileInfoResult" })
) as any as Schema.Codec<GetFileInfoResult>

/**
 * Returns iframe node that owns iframe with the given domain.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFrameOwnerParams {
  readonly frameId: Page.FrameId
}

/**
 * Schema for `GetFrameOwnerParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFrameOwnerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId
  }).annotate({ identifier: "DOM.GetFrameOwnerParams" })
) as any as Schema.Codec<GetFrameOwnerParams>

/**
 * Returns iframe node that owns iframe with the given domain.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFrameOwnerResult {
  /**
   * Resulting node.
   */
  readonly backendNodeId: BackendNodeId
  /**
   * Id of the node at given coordinates, only when enabled and requested document.
   */
  readonly nodeId?: NodeId | undefined
}

/**
 * Schema for `GetFrameOwnerResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFrameOwnerResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeId: BackendNodeId,
    nodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.GetFrameOwnerResult" })
) as any as Schema.Codec<GetFrameOwnerResult>

/**
 * Returns candidate nodes that are configured as triggers for the given popover.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetImplicitAnchorCandidatesParams {
  /**
   * Id of the popover HTMLElement.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetImplicitAnchorCandidatesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetImplicitAnchorCandidatesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetImplicitAnchorCandidatesParams" })
) as any as Schema.Codec<GetImplicitAnchorCandidatesParams>

/**
 * Returns candidate nodes that are configured as triggers for the given popover.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetImplicitAnchorCandidatesResult {
  /**
   * Candidate elements that can invoke this popover.
   */
  readonly backendNodeIds: ReadonlyArray<BackendNodeId>
}

/**
 * Schema for `GetImplicitAnchorCandidatesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetImplicitAnchorCandidatesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeIds: Schema.Array(BackendNodeId)
  }).annotate({ identifier: "DOM.GetImplicitAnchorCandidatesResult" })
) as any as Schema.Codec<GetImplicitAnchorCandidatesResult>

/**
 * Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
 * either returned or not.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetNodeForLocationParams {
  /**
   * X coordinate.
   */
  readonly x: number
  /**
   * Y coordinate.
   */
  readonly y: number
  /**
   * False to skip to the nearest non-UA shadow root ancestor (default: false).
   */
  readonly includeUserAgentShadowDOM?: boolean | undefined
  /**
   * Whether to ignore pointer-events: none on elements and hit test them.
   */
  readonly ignorePointerEventsNone?: boolean | undefined
}

/**
 * Schema for `GetNodeForLocationParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetNodeForLocationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Int,
    y: Schema.Int,
    includeUserAgentShadowDOM: Schema.optional(Schema.Boolean),
    ignorePointerEventsNone: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GetNodeForLocationParams" })
) as any as Schema.Codec<GetNodeForLocationParams>

/**
 * Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
 * either returned or not.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetNodeForLocationResult {
  /**
   * Resulting node.
   */
  readonly backendNodeId: BackendNodeId
  /**
   * Frame this node belongs to.
   */
  readonly frameId: Page.FrameId
  /**
   * Id of the node at given coordinates, only when enabled and requested document.
   */
  readonly nodeId?: NodeId | undefined
}

/**
 * Schema for `GetNodeForLocationResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetNodeForLocationResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeId: BackendNodeId,
    frameId: Page.FrameId,
    nodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.GetNodeForLocationResult" })
) as any as Schema.Codec<GetNodeForLocationResult>

/**
 * Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetNodeStackTracesParams {
  /**
   * Id of the node to get stack traces for.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetNodeStackTracesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetNodeStackTracesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetNodeStackTracesParams" })
) as any as Schema.Codec<GetNodeStackTracesParams>

/**
 * Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetNodeStackTracesResult {
  /**
   * Creation stack trace, if available.
   */
  readonly creation?: Runtime.StackTrace | undefined
}

/**
 * Schema for `GetNodeStackTracesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetNodeStackTracesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    creation: Schema.optional(Runtime.StackTrace)
  }).annotate({ identifier: "DOM.GetNodeStackTracesResult" })
) as any as Schema.Codec<GetNodeStackTracesResult, unknown>

/**
 * Finds nodes with a given computed style in a subtree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetNodesForSubtreeByStyleParams {
  /**
   * Node ID pointing to the root of a subtree.
   */
  readonly nodeId: NodeId
  /**
   * The style to filter nodes by (includes nodes if any of properties matches).
   */
  readonly computedStyles: ReadonlyArray<CSSComputedStyleProperty>
  /**
   * Whether or not iframes and shadow roots in the same target should be traversed when returning the
   * results (default is false).
   */
  readonly pierce?: boolean | undefined
}

/**
 * Schema for `GetNodesForSubtreeByStyleParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetNodesForSubtreeByStyleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    computedStyles: Schema.Array(CSSComputedStyleProperty),
    pierce: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GetNodesForSubtreeByStyleParams" })
) as any as Schema.Codec<GetNodesForSubtreeByStyleParams>

/**
 * Finds nodes with a given computed style in a subtree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetNodesForSubtreeByStyleResult {
  /**
   * Resulting nodes.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `GetNodesForSubtreeByStyleResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetNodesForSubtreeByStyleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.GetNodesForSubtreeByStyleResult" })
) as any as Schema.Codec<GetNodesForSubtreeByStyleResult>

/**
 * Returns node's HTML markup.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetOuterHTMLParams {
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * Include all shadow roots. Equals to false if not specified.
   */
  readonly includeShadowDOM?: boolean | undefined
}

/**
 * Schema for `GetOuterHTMLParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetOuterHTMLParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    includeShadowDOM: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GetOuterHTMLParams" })
) as any as Schema.Codec<GetOuterHTMLParams>

/**
 * Returns node's HTML markup.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetOuterHTMLResult {
  /**
   * Outer HTML markup.
   */
  readonly outerHTML: string
}

/**
 * Schema for `GetOuterHTMLResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetOuterHTMLResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    outerHTML: Schema.String
  }).annotate({ identifier: "DOM.GetOuterHTMLResult" })
) as any as Schema.Codec<GetOuterHTMLResult>

/**
 * Returns the descendants of a container query container that have
 * container queries against this container.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetQueryingDescendantsForContainerParams {
  /**
   * Id of the container node to find querying descendants from.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetQueryingDescendantsForContainerParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetQueryingDescendantsForContainerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetQueryingDescendantsForContainerParams" })
) as any as Schema.Codec<GetQueryingDescendantsForContainerParams>

/**
 * Returns the descendants of a container query container that have
 * container queries against this container.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetQueryingDescendantsForContainerResult {
  /**
   * Descendant nodes with container queries against the given container.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `GetQueryingDescendantsForContainerResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetQueryingDescendantsForContainerResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.GetQueryingDescendantsForContainerResult" })
) as any as Schema.Codec<GetQueryingDescendantsForContainerResult>

/**
 * Returns the id of the nearest ancestor that is a relayout boundary.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRelayoutBoundaryParams {
  /**
   * Id of the node.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetRelayoutBoundaryParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRelayoutBoundaryParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetRelayoutBoundaryParams" })
) as any as Schema.Codec<GetRelayoutBoundaryParams>

/**
 * Returns the id of the nearest ancestor that is a relayout boundary.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRelayoutBoundaryResult {
  /**
   * Relayout boundary node id for the given node.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetRelayoutBoundaryResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRelayoutBoundaryResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetRelayoutBoundaryResult" })
) as any as Schema.Codec<GetRelayoutBoundaryResult>

/**
 * Returns search results from given `fromIndex` to given `toIndex` from the search with the given
 * identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSearchResultsParams {
  /**
   * Unique search session identifier.
   */
  readonly searchId: string
  /**
   * Start index of the search result to be returned.
   */
  readonly fromIndex: number
  /**
   * End index of the search result to be returned.
   */
  readonly toIndex: number
}

/**
 * Schema for `GetSearchResultsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSearchResultsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    searchId: Schema.String,
    fromIndex: Schema.Int,
    toIndex: Schema.Int
  }).annotate({ identifier: "DOM.GetSearchResultsParams" })
) as any as Schema.Codec<GetSearchResultsParams>

/**
 * Returns search results from given `fromIndex` to given `toIndex` from the search with the given
 * identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSearchResultsResult {
  /**
   * Ids of the search result nodes.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `GetSearchResultsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSearchResultsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.GetSearchResultsResult" })
) as any as Schema.Codec<GetSearchResultsResult>

/**
 * Returns NodeIds of current top layer elements.
 * Top layer is rendered closest to the user within a viewport, therefore its elements always
 * appear on top of all other content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetTopLayerElementsResult {
  /**
   * NodeIds of top layer elements
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `GetTopLayerElementsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetTopLayerElementsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.GetTopLayerElementsResult" })
) as any as Schema.Codec<GetTopLayerElementsResult>

/**
 * Fired when `Element`'s inline style is modified via a CSS property modification.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InlineStyleInvalidatedParams {
  /**
   * Ids of the nodes for which the inline styles have been invalidated.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `InlineStyleInvalidatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InlineStyleInvalidatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.InlineStyleInvalidatedParams" })
) as any as Schema.Codec<InlineStyleInvalidatedParams>

/**
 * Moves node into the new container, places it before the given anchor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MoveToParams {
  /**
   * Id of the node to move.
   */
  readonly nodeId: NodeId
  /**
   * Id of the element to drop the moved node into.
   */
  readonly targetNodeId: NodeId
  /**
   * Drop node before this one (if absent, the moved node becomes the last child of
   * `targetNodeId`).
   */
  readonly insertBeforeNodeId?: NodeId | undefined
}

/**
 * Schema for `MoveToParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MoveToParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    targetNodeId: NodeId,
    insertBeforeNodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.MoveToParams" })
) as any as Schema.Codec<MoveToParams>

/**
 * Moves node into the new container, places it before the given anchor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MoveToResult {
  /**
   * New id of the moved node.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `MoveToResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MoveToResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.MoveToResult" })
) as any as Schema.Codec<MoveToResult>

/**
 * Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
 * `cancelSearch` to end this search session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PerformSearchParams {
  /**
   * Plain text or query selector or XPath search query.
   */
  readonly query: string
  /**
   * True to search in user agent shadow DOM.
   */
  readonly includeUserAgentShadowDOM?: boolean | undefined
}

/**
 * Schema for `PerformSearchParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PerformSearchParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    query: Schema.String,
    includeUserAgentShadowDOM: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.PerformSearchParams" })
) as any as Schema.Codec<PerformSearchParams>

/**
 * Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
 * `cancelSearch` to end this search session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PerformSearchResult {
  /**
   * Unique search session identifier.
   */
  readonly searchId: string
  /**
   * Number of search results.
   */
  readonly resultCount: number
}

/**
 * Schema for `PerformSearchResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PerformSearchResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    searchId: Schema.String,
    resultCount: Schema.Int
  }).annotate({ identifier: "DOM.PerformSearchResult" })
) as any as Schema.Codec<PerformSearchResult>

/**
 * Called when a pseudo element is added to an element.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PseudoElementAddedParams {
  /**
   * Pseudo element's parent element id.
   */
  readonly parentId: NodeId
  /**
   * The added pseudo element.
   */
  readonly pseudoElement: Node
}

/**
 * Schema for `PseudoElementAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PseudoElementAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentId: NodeId,
    pseudoElement: Node
  }).annotate({ identifier: "DOM.PseudoElementAddedParams" })
) as any as Schema.Codec<PseudoElementAddedParams, unknown>

/**
 * Called when a pseudo element is removed from an element.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PseudoElementRemovedParams {
  /**
   * Pseudo element's parent element id.
   */
  readonly parentId: NodeId
  /**
   * The removed pseudo element id.
   */
  readonly pseudoElementId: NodeId
}

/**
 * Schema for `PseudoElementRemovedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PseudoElementRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentId: NodeId,
    pseudoElementId: NodeId
  }).annotate({ identifier: "DOM.PseudoElementRemovedParams" })
) as any as Schema.Codec<PseudoElementRemovedParams>

/**
 * Requests that the node is sent to the caller given its path. // FIXME, use XPath
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PushNodeByPathToFrontendParams {
  /**
   * Path to node in the proprietary format.
   */
  readonly path: string
}

/**
 * Schema for `PushNodeByPathToFrontendParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PushNodeByPathToFrontendParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    path: Schema.String
  }).annotate({ identifier: "DOM.PushNodeByPathToFrontendParams" })
) as any as Schema.Codec<PushNodeByPathToFrontendParams>

/**
 * Requests that the node is sent to the caller given its path. // FIXME, use XPath
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PushNodeByPathToFrontendResult {
  /**
   * Id of the node for given path.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `PushNodeByPathToFrontendResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PushNodeByPathToFrontendResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.PushNodeByPathToFrontendResult" })
) as any as Schema.Codec<PushNodeByPathToFrontendResult>

/**
 * Requests that a batch of nodes is sent to the caller given their backend node ids.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PushNodesByBackendIdsToFrontendParams {
  /**
   * The array of backend node ids.
   */
  readonly backendNodeIds: ReadonlyArray<BackendNodeId>
}

/**
 * Schema for `PushNodesByBackendIdsToFrontendParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PushNodesByBackendIdsToFrontendParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendNodeIds: Schema.Array(BackendNodeId)
  }).annotate({ identifier: "DOM.PushNodesByBackendIdsToFrontendParams" })
) as any as Schema.Codec<PushNodesByBackendIdsToFrontendParams>

/**
 * Requests that a batch of nodes is sent to the caller given their backend node ids.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PushNodesByBackendIdsToFrontendResult {
  /**
   * The array of ids of pushed nodes that correspond to the backend ids specified in
   * backendNodeIds.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `PushNodesByBackendIdsToFrontendResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PushNodesByBackendIdsToFrontendResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.PushNodesByBackendIdsToFrontendResult" })
) as any as Schema.Codec<PushNodesByBackendIdsToFrontendResult>

/**
 * Executes `querySelector` on a given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QuerySelectorParams {
  /**
   * Id of the node to query upon.
   */
  readonly nodeId: NodeId
  /**
   * Selector string.
   */
  readonly selector: string
}

/**
 * Schema for `QuerySelectorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const QuerySelectorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    selector: Schema.String
  }).annotate({ identifier: "DOM.QuerySelectorParams" })
) as any as Schema.Codec<QuerySelectorParams>

/**
 * Executes `querySelector` on a given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QuerySelectorResult {
  /**
   * Query selector result.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `QuerySelectorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const QuerySelectorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.QuerySelectorResult" })
) as any as Schema.Codec<QuerySelectorResult>

/**
 * Executes `querySelectorAll` on a given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QuerySelectorAllParams {
  /**
   * Id of the node to query upon.
   */
  readonly nodeId: NodeId
  /**
   * Selector string.
   */
  readonly selector: string
}

/**
 * Schema for `QuerySelectorAllParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const QuerySelectorAllParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    selector: Schema.String
  }).annotate({ identifier: "DOM.QuerySelectorAllParams" })
) as any as Schema.Codec<QuerySelectorAllParams>

/**
 * Executes `querySelectorAll` on a given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QuerySelectorAllResult {
  /**
   * Query selector result.
   */
  readonly nodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `QuerySelectorAllResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const QuerySelectorAllResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.QuerySelectorAllResult" })
) as any as Schema.Codec<QuerySelectorAllResult>

/**
 * Removes attribute with given name from an element with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveAttributeParams {
  /**
   * Id of the element to remove attribute from.
   */
  readonly nodeId: NodeId
  /**
   * Name of the attribute to remove.
   */
  readonly name: string
}

/**
 * Schema for `RemoveAttributeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveAttributeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    name: Schema.String
  }).annotate({ identifier: "DOM.RemoveAttributeParams" })
) as any as Schema.Codec<RemoveAttributeParams>

/**
 * Removes node with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveNodeParams {
  /**
   * Id of the node to remove.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `RemoveNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.RemoveNodeParams" })
) as any as Schema.Codec<RemoveNodeParams>

/**
 * Requests that children of the node with given id are returned to the caller in form of
 * `setChildNodes` events where not only immediate children are retrieved, but all children down to
 * the specified depth.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestChildNodesParams {
  /**
   * Id of the node to get children for.
   */
  readonly nodeId: NodeId
  /**
   * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
   * entire subtree or provide an integer larger than 0.
   */
  readonly depth?: number | undefined
  /**
   * Whether or not iframes and shadow roots should be traversed when returning the sub-tree
   * (default is false).
   */
  readonly pierce?: boolean | undefined
}

/**
 * Schema for `RequestChildNodesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestChildNodesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    depth: Schema.optional(Schema.Int),
    pierce: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.RequestChildNodesParams" })
) as any as Schema.Codec<RequestChildNodesParams>

/**
 * Requests that the node is sent to the caller given the JavaScript node object reference. All
 * nodes that form the path from the node to the root are also sent to the client as a series of
 * `setChildNodes` notifications.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestNodeParams {
  /**
   * JavaScript object id to convert into node.
   */
  readonly objectId: Runtime.RemoteObjectId
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
    objectId: Runtime.RemoteObjectId
  }).annotate({ identifier: "DOM.RequestNodeParams" })
) as any as Schema.Codec<RequestNodeParams>

/**
 * Requests that the node is sent to the caller given the JavaScript node object reference. All
 * nodes that form the path from the node to the root are also sent to the client as a series of
 * `setChildNodes` notifications.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestNodeResult {
  /**
   * Node id for given object.
   */
  readonly nodeId: NodeId
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
    nodeId: NodeId
  }).annotate({ identifier: "DOM.RequestNodeResult" })
) as any as Schema.Codec<RequestNodeResult>

/**
 * Resolves the JavaScript node object for a given NodeId or BackendNodeId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveNodeParams {
  /**
   * Id of the node to resolve.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Backend identifier of the node to resolve.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
  /**
   * Execution context in which to resolve the node.
   */
  readonly executionContextId?: Runtime.ExecutionContextId | undefined
}

/**
 * Schema for `ResolveNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectGroup: Schema.optional(Schema.String),
    executionContextId: Schema.optional(Runtime.ExecutionContextId)
  }).annotate({ identifier: "DOM.ResolveNodeParams" })
) as any as Schema.Codec<ResolveNodeParams>

/**
 * Resolves the JavaScript node object for a given NodeId or BackendNodeId.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveNodeResult {
  /**
   * JavaScript object wrapper for given node.
   */
  readonly object: Runtime.RemoteObject
}

/**
 * Schema for `ResolveNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: Runtime.RemoteObject
  }).annotate({ identifier: "DOM.ResolveNodeResult" })
) as any as Schema.Codec<ResolveNodeResult>

/**
 * Scrolls the specified rect of the given node into view if not already visible.
 * Note: exactly one between nodeId, backendNodeId and objectId should be passed
 * to identify the node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScrollIntoViewIfNeededParams {
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * The rect to be scrolled into view, relative to the node's border box, in CSS pixels.
   * When omitted, center of the node will be used, similar to Element.scrollIntoView.
   */
  readonly rect?: Rect | undefined
}

/**
 * Schema for `ScrollIntoViewIfNeededParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScrollIntoViewIfNeededParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    rect: Schema.optional(Rect)
  }).annotate({ identifier: "DOM.ScrollIntoViewIfNeededParams" })
) as any as Schema.Codec<ScrollIntoViewIfNeededParams>

/**
 * Fired when a node's scrollability state changes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScrollableFlagUpdatedParams {
  /**
   * The id of the node.
   */
  readonly nodeId: NodeId
  /**
   * If the node is scrollable.
   */
  readonly isScrollable: boolean
}

/**
 * Schema for `ScrollableFlagUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScrollableFlagUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    isScrollable: Schema.Boolean
  }).annotate({ identifier: "DOM.ScrollableFlagUpdatedParams" })
) as any as Schema.Codec<ScrollableFlagUpdatedParams>

/**
 * Sets attribute for an element with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAttributeValueParams {
  /**
   * Id of the element to set attribute for.
   */
  readonly nodeId: NodeId
  /**
   * Attribute name.
   */
  readonly name: string
  /**
   * Attribute value.
   */
  readonly value: string
}

/**
 * Schema for `SetAttributeValueParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAttributeValueParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "DOM.SetAttributeValueParams" })
) as any as Schema.Codec<SetAttributeValueParams>

/**
 * Sets attributes on element with given id. This method is useful when user edits some existing
 * attribute value and types in several attribute name/value pairs.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAttributesAsTextParams {
  /**
   * Id of the element to set attributes for.
   */
  readonly nodeId: NodeId
  /**
   * Text with a number of attributes. Will parse this text using HTML parser.
   */
  readonly text: string
  /**
   * Attribute name to replace with new attributes derived from text in case text parsed
   * successfully.
   */
  readonly name?: string | undefined
}

/**
 * Schema for `SetAttributesAsTextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAttributesAsTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    text: Schema.String,
    name: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOM.SetAttributesAsTextParams" })
) as any as Schema.Codec<SetAttributesAsTextParams>

/**
 * Fired when backend wants to provide client with the missing DOM structure. This happens upon
 * most of the calls requesting node ids.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetChildNodesParams {
  /**
   * Parent node id to populate with children.
   */
  readonly parentId: NodeId
  /**
   * Child nodes array.
   */
  readonly nodes: ReadonlyArray<Node>
}

/**
 * Schema for `SetChildNodesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetChildNodesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentId: NodeId,
    nodes: Schema.Array(Node)
  }).annotate({ identifier: "DOM.SetChildNodesParams" })
) as any as Schema.Codec<SetChildNodesParams, unknown>

/**
 * Sets files for the given file input element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetFileInputFilesParams {
  /**
   * Array of file paths to set.
   */
  readonly files: ReadonlyArray<string>
  /**
   * Identifier of the node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * Identifier of the backend node.
   */
  readonly backendNodeId?: BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
}

/**
 * Schema for `SetFileInputFilesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetFileInputFilesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    files: Schema.Array(Schema.String),
    nodeId: Schema.optional(NodeId),
    backendNodeId: Schema.optional(BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId)
  }).annotate({ identifier: "DOM.SetFileInputFilesParams" })
) as any as Schema.Codec<SetFileInputFilesParams>

/**
 * Enables console to refer to the node with given id via $x (see Command Line API for more details
 * $x functions).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetInspectedNodeParams {
  /**
   * DOM node id to be accessible by means of $x command line API.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `SetInspectedNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetInspectedNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.SetInspectedNodeParams" })
) as any as Schema.Codec<SetInspectedNodeParams>

/**
 * Sets node name for a node with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetNodeNameParams {
  /**
   * Id of the node to set name for.
   */
  readonly nodeId: NodeId
  /**
   * New node's name.
   */
  readonly name: string
}

/**
 * Schema for `SetNodeNameParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetNodeNameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    name: Schema.String
  }).annotate({ identifier: "DOM.SetNodeNameParams" })
) as any as Schema.Codec<SetNodeNameParams>

/**
 * Sets node name for a node with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetNodeNameResult {
  /**
   * New node's id.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `SetNodeNameResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetNodeNameResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.SetNodeNameResult" })
) as any as Schema.Codec<SetNodeNameResult>

/**
 * Sets if stack traces should be captured for Nodes. See `Node.getNodeStackTraces`. Default is disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetNodeStackTracesEnabledParams {
  /**
   * Enable or disable.
   */
  readonly enable: boolean
}

/**
 * Schema for `SetNodeStackTracesEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetNodeStackTracesEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enable: Schema.Boolean
  }).annotate({ identifier: "DOM.SetNodeStackTracesEnabledParams" })
) as any as Schema.Codec<SetNodeStackTracesEnabledParams>

/**
 * Sets node value for a node with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetNodeValueParams {
  /**
   * Id of the node to set value for.
   */
  readonly nodeId: NodeId
  /**
   * New node's value.
   */
  readonly value: string
}

/**
 * Schema for `SetNodeValueParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetNodeValueParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    value: Schema.String
  }).annotate({ identifier: "DOM.SetNodeValueParams" })
) as any as Schema.Codec<SetNodeValueParams>

/**
 * Sets node HTML markup, returns new node id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetOuterHTMLParams {
  /**
   * Id of the node to set markup for.
   */
  readonly nodeId: NodeId
  /**
   * Outer HTML markup to set.
   */
  readonly outerHTML: string
}

/**
 * Schema for `SetOuterHTMLParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetOuterHTMLParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    outerHTML: Schema.String
  }).annotate({ identifier: "DOM.SetOuterHTMLParams" })
) as any as Schema.Codec<SetOuterHTMLParams>

/**
 * Called when shadow root is popped from the element.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ShadowRootPoppedParams {
  /**
   * Host element id.
   */
  readonly hostId: NodeId
  /**
   * Shadow root id.
   */
  readonly rootId: NodeId
}

/**
 * Schema for `ShadowRootPoppedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ShadowRootPoppedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hostId: NodeId,
    rootId: NodeId
  }).annotate({ identifier: "DOM.ShadowRootPoppedParams" })
) as any as Schema.Codec<ShadowRootPoppedParams>

/**
 * Called when shadow root is pushed into the element.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ShadowRootPushedParams {
  /**
   * Host element id.
   */
  readonly hostId: NodeId
  /**
   * Shadow root.
   */
  readonly root: Node
}

/**
 * Schema for `ShadowRootPushedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ShadowRootPushedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hostId: NodeId,
    root: Node
  }).annotate({ identifier: "DOM.ShadowRootPushedParams" })
) as any as Schema.Codec<ShadowRootPushedParams, unknown>

/**
 * Collects class names for the node with given id and all of it's child nodes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const collectClassNamesFromSubtree: Protocol.CommandDef<
  "DOM.collectClassNamesFromSubtree",
  CollectClassNamesFromSubtreeParams,
  CollectClassNamesFromSubtreeResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.collectClassNamesFromSubtree",
  CollectClassNamesFromSubtreeParams,
  CollectClassNamesFromSubtreeResult,
  { status: "experimental" }
)

/**
 * Creates a deep copy of the specified node and places it into the target container before the
 * given anchor.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const copyTo: Protocol.CommandDef<"DOM.copyTo", CopyToParams, CopyToResult> = /*#__PURE__*/ Protocol.command(
  "DOM.copyTo",
  CopyToParams,
  CopyToResult,
  { status: "experimental" }
)

/**
 * Describes node given its id, does not require domain to be enabled. Does not start tracking any
 * objects, can be used for automation.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const describeNode: Protocol.CommandDef<"DOM.describeNode", DescribeNodeParams, DescribeNodeResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.describeNode",
    DescribeNodeParams,
    DescribeNodeResult,
    { status: "stable" }
  )

/**
 * Disables DOM agent for the given page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"DOM.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Discards search results from the session with the given id. `getSearchResults` should no longer
 * be called for that search.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const discardSearchResults: Protocol.CommandDef<"DOM.discardSearchResults", DiscardSearchResultsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.discardSearchResults",
    DiscardSearchResultsParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Enables DOM agent for the given page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"DOM.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "DOM.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Focuses the given element.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const focus: Protocol.CommandDef<"DOM.focus", FocusParams, void> = /*#__PURE__*/ Protocol.command(
  "DOM.focus",
  FocusParams,
  undefined,
  { status: "stable" }
)

/**
 * When enabling, this API forces an element to gain interest in its target,
 * keeping interest active until disabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const forceShowInterest: Protocol.CommandDef<"DOM.forceShowInterest", ForceShowInterestParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.forceShowInterest",
    ForceShowInterestParams,
    undefined,
    { status: "experimental" }
  )

/**
 * When enabling, this API force-opens the popover identified by nodeId
 * and keeps it open until disabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const forceShowPopover: Protocol.CommandDef<
  "DOM.forceShowPopover",
  ForceShowPopoverParams,
  ForceShowPopoverResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.forceShowPopover",
  ForceShowPopoverParams,
  ForceShowPopoverResult,
  { status: "experimental" }
)

/**
 * Returns the target anchor element of the given anchor query according to
 * https://www.w3.org/TR/css-anchor-position-1/#target.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAnchorElement: Protocol.CommandDef<
  "DOM.getAnchorElement",
  GetAnchorElementParams,
  GetAnchorElementResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getAnchorElement",
  GetAnchorElementParams,
  GetAnchorElementResult,
  { status: "experimental" }
)

/**
 * Returns attributes for the specified node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAttributes: Protocol.CommandDef<"DOM.getAttributes", GetAttributesParams, GetAttributesResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getAttributes",
    GetAttributesParams,
    GetAttributesResult,
    { status: "stable" }
  )

/**
 * Returns boxes for the given node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBoxModel: Protocol.CommandDef<"DOM.getBoxModel", GetBoxModelParams, GetBoxModelResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getBoxModel",
    GetBoxModelParams,
    GetBoxModelResult,
    { status: "stable" }
  )

/**
 * Returns the query container of the given node based on container query
 * conditions: containerName, physical and logical axes, and whether it queries
 * scroll-state or anchored elements. If no axes are provided and
 * queriesScrollState is false, the style container is returned, which is the
 * direct parent or the closest element with a matching container-name.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getContainerForNode: Protocol.CommandDef<
  "DOM.getContainerForNode",
  GetContainerForNodeParams,
  GetContainerForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getContainerForNode",
  GetContainerForNodeParams,
  GetContainerForNodeResult,
  { status: "experimental" }
)

/**
 * Returns quads that describe node position on the page. This method
 * might return multiple quads for inline nodes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getContentQuads: Protocol.CommandDef<"DOM.getContentQuads", GetContentQuadsParams, GetContentQuadsResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getContentQuads",
    GetContentQuadsParams,
    GetContentQuadsResult,
    { status: "experimental" }
  )

/**
 * Returns list of detached nodes
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getDetachedDomNodes: Protocol.CommandDef<"DOM.getDetachedDomNodes", void, GetDetachedDomNodesResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getDetachedDomNodes",
    undefined,
    GetDetachedDomNodesResult,
    { status: "experimental" }
  )

/**
 * Returns the root DOM node (and optionally the subtree) to the caller.
 * Implicitly enables the DOM domain events for the current target.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getDocument: Protocol.CommandDef<"DOM.getDocument", GetDocumentParams, GetDocumentResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getDocument",
    GetDocumentParams,
    GetDocumentResult,
    { status: "stable" }
  )

/**
 * Returns the NodeId of the matched element according to certain relations.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getElementByRelation: Protocol.CommandDef<
  "DOM.getElementByRelation",
  GetElementByRelationParams,
  GetElementByRelationResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getElementByRelation",
  GetElementByRelationParams,
  GetElementByRelationResult,
  { status: "experimental" }
)

/**
 * Returns file information for the given
 * File wrapper.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getFileInfo: Protocol.CommandDef<"DOM.getFileInfo", GetFileInfoParams, GetFileInfoResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getFileInfo",
    GetFileInfoParams,
    GetFileInfoResult,
    { status: "experimental" }
  )

/**
 * Returns iframe node that owns iframe with the given domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getFrameOwner: Protocol.CommandDef<"DOM.getFrameOwner", GetFrameOwnerParams, GetFrameOwnerResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getFrameOwner",
    GetFrameOwnerParams,
    GetFrameOwnerResult,
    { status: "experimental" }
  )

/**
 * Returns candidate nodes that are configured as triggers for the given popover.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getImplicitAnchorCandidates: Protocol.CommandDef<
  "DOM.getImplicitAnchorCandidates",
  GetImplicitAnchorCandidatesParams,
  GetImplicitAnchorCandidatesResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getImplicitAnchorCandidates",
  GetImplicitAnchorCandidatesParams,
  GetImplicitAnchorCandidatesResult,
  { status: "experimental" }
)

/**
 * Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
 * either returned or not.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getNodeForLocation: Protocol.CommandDef<
  "DOM.getNodeForLocation",
  GetNodeForLocationParams,
  GetNodeForLocationResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getNodeForLocation",
  GetNodeForLocationParams,
  GetNodeForLocationResult,
  { status: "stable" }
)

/**
 * Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getNodeStackTraces: Protocol.CommandDef<
  "DOM.getNodeStackTraces",
  GetNodeStackTracesParams,
  GetNodeStackTracesResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getNodeStackTraces",
  GetNodeStackTracesParams,
  GetNodeStackTracesResult,
  { status: "experimental" }
)

/**
 * Finds nodes with a given computed style in a subtree.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getNodesForSubtreeByStyle: Protocol.CommandDef<
  "DOM.getNodesForSubtreeByStyle",
  GetNodesForSubtreeByStyleParams,
  GetNodesForSubtreeByStyleResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getNodesForSubtreeByStyle",
  GetNodesForSubtreeByStyleParams,
  GetNodesForSubtreeByStyleResult,
  { status: "experimental" }
)

/**
 * Returns node's HTML markup.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getOuterHTML: Protocol.CommandDef<"DOM.getOuterHTML", GetOuterHTMLParams, GetOuterHTMLResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getOuterHTML",
    GetOuterHTMLParams,
    GetOuterHTMLResult,
    { status: "stable" }
  )

/**
 * Returns the descendants of a container query container that have
 * container queries against this container.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getQueryingDescendantsForContainer: Protocol.CommandDef<
  "DOM.getQueryingDescendantsForContainer",
  GetQueryingDescendantsForContainerParams,
  GetQueryingDescendantsForContainerResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getQueryingDescendantsForContainer",
  GetQueryingDescendantsForContainerParams,
  GetQueryingDescendantsForContainerResult,
  { status: "experimental" }
)

/**
 * Returns the id of the nearest ancestor that is a relayout boundary.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getRelayoutBoundary: Protocol.CommandDef<
  "DOM.getRelayoutBoundary",
  GetRelayoutBoundaryParams,
  GetRelayoutBoundaryResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getRelayoutBoundary",
  GetRelayoutBoundaryParams,
  GetRelayoutBoundaryResult,
  { status: "experimental" }
)

/**
 * Returns search results from given `fromIndex` to given `toIndex` from the search with the given
 * identifier.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getSearchResults: Protocol.CommandDef<
  "DOM.getSearchResults",
  GetSearchResultsParams,
  GetSearchResultsResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getSearchResults",
  GetSearchResultsParams,
  GetSearchResultsResult,
  { status: "experimental" }
)

/**
 * Returns NodeIds of current top layer elements.
 * Top layer is rendered closest to the user within a viewport, therefore its elements always
 * appear on top of all other content.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getTopLayerElements: Protocol.CommandDef<"DOM.getTopLayerElements", void, GetTopLayerElementsResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getTopLayerElements",
    undefined,
    GetTopLayerElementsResult,
    { status: "experimental" }
  )

/**
 * Hides any highlight.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const hideHighlight: Protocol.CommandDef<"DOM.hideHighlight", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.hideHighlight",
  undefined,
  undefined,
  { status: "stable", redirect: "Overlay" }
)

/**
 * Highlights DOM node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightNode: Protocol.CommandDef<"DOM.highlightNode", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.highlightNode",
  undefined,
  undefined,
  { status: "stable", redirect: "Overlay" }
)

/**
 * Highlights given rectangle.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightRect: Protocol.CommandDef<"DOM.highlightRect", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.highlightRect",
  undefined,
  undefined,
  { status: "stable", redirect: "Overlay" }
)

/**
 * Marks last undoable state.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const markUndoableState: Protocol.CommandDef<"DOM.markUndoableState", void, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.markUndoableState",
    undefined,
    undefined,
    { status: "experimental" }
  )

/**
 * Moves node into the new container, places it before the given anchor.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const moveTo: Protocol.CommandDef<"DOM.moveTo", MoveToParams, MoveToResult> = /*#__PURE__*/ Protocol.command(
  "DOM.moveTo",
  MoveToParams,
  MoveToResult,
  { status: "stable" }
)

/**
 * Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
 * `cancelSearch` to end this search session.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const performSearch: Protocol.CommandDef<"DOM.performSearch", PerformSearchParams, PerformSearchResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.performSearch",
    PerformSearchParams,
    PerformSearchResult,
    { status: "experimental" }
  )

/**
 * Requests that the node is sent to the caller given its path. // FIXME, use XPath
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const pushNodeByPathToFrontend: Protocol.CommandDef<
  "DOM.pushNodeByPathToFrontend",
  PushNodeByPathToFrontendParams,
  PushNodeByPathToFrontendResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.pushNodeByPathToFrontend",
  PushNodeByPathToFrontendParams,
  PushNodeByPathToFrontendResult,
  { status: "experimental" }
)

/**
 * Requests that a batch of nodes is sent to the caller given their backend node ids.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const pushNodesByBackendIdsToFrontend: Protocol.CommandDef<
  "DOM.pushNodesByBackendIdsToFrontend",
  PushNodesByBackendIdsToFrontendParams,
  PushNodesByBackendIdsToFrontendResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.pushNodesByBackendIdsToFrontend",
  PushNodesByBackendIdsToFrontendParams,
  PushNodesByBackendIdsToFrontendResult,
  { status: "experimental" }
)

/**
 * Executes `querySelector` on a given node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const querySelector: Protocol.CommandDef<"DOM.querySelector", QuerySelectorParams, QuerySelectorResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.querySelector",
    QuerySelectorParams,
    QuerySelectorResult,
    { status: "stable" }
  )

/**
 * Executes `querySelectorAll` on a given node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const querySelectorAll: Protocol.CommandDef<
  "DOM.querySelectorAll",
  QuerySelectorAllParams,
  QuerySelectorAllResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.querySelectorAll",
  QuerySelectorAllParams,
  QuerySelectorAllResult,
  { status: "stable" }
)

/**
 * Re-does the last undone action.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const redo: Protocol.CommandDef<"DOM.redo", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.redo",
  undefined,
  undefined,
  { status: "experimental" }
)

/**
 * Removes attribute with given name from an element with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeAttribute: Protocol.CommandDef<"DOM.removeAttribute", RemoveAttributeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.removeAttribute",
    RemoveAttributeParams,
    undefined,
    { status: "stable" }
  )

/**
 * Removes node with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeNode: Protocol.CommandDef<"DOM.removeNode", RemoveNodeParams, void> = /*#__PURE__*/ Protocol.command(
  "DOM.removeNode",
  RemoveNodeParams,
  undefined,
  { status: "stable" }
)

/**
 * Requests that children of the node with given id are returned to the caller in form of
 * `setChildNodes` events where not only immediate children are retrieved, but all children down to
 * the specified depth.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestChildNodes: Protocol.CommandDef<"DOM.requestChildNodes", RequestChildNodesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.requestChildNodes",
    RequestChildNodesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Requests that the node is sent to the caller given the JavaScript node object reference. All
 * nodes that form the path from the node to the root are also sent to the client as a series of
 * `setChildNodes` notifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestNode: Protocol.CommandDef<"DOM.requestNode", RequestNodeParams, RequestNodeResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.requestNode",
    RequestNodeParams,
    RequestNodeResult,
    { status: "stable" }
  )

/**
 * Resolves the JavaScript node object for a given NodeId or BackendNodeId.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveNode: Protocol.CommandDef<"DOM.resolveNode", ResolveNodeParams, ResolveNodeResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.resolveNode",
    ResolveNodeParams,
    ResolveNodeResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/object/objectId" }]
    }
  )

/**
 * Scrolls the specified rect of the given node into view if not already visible.
 * Note: exactly one between nodeId, backendNodeId and objectId should be passed
 * to identify the node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const scrollIntoViewIfNeeded: Protocol.CommandDef<
  "DOM.scrollIntoViewIfNeeded",
  ScrollIntoViewIfNeededParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.scrollIntoViewIfNeeded",
  ScrollIntoViewIfNeededParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets attribute for an element with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAttributeValue: Protocol.CommandDef<"DOM.setAttributeValue", SetAttributeValueParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.setAttributeValue",
    SetAttributeValueParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets attributes on element with given id. This method is useful when user edits some existing
 * attribute value and types in several attribute name/value pairs.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAttributesAsText: Protocol.CommandDef<"DOM.setAttributesAsText", SetAttributesAsTextParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.setAttributesAsText",
    SetAttributesAsTextParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets files for the given file input element.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setFileInputFiles: Protocol.CommandDef<"DOM.setFileInputFiles", SetFileInputFilesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.setFileInputFiles",
    SetFileInputFilesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Enables console to refer to the node with given id via $x (see Command Line API for more details
 * $x functions).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setInspectedNode: Protocol.CommandDef<"DOM.setInspectedNode", SetInspectedNodeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.setInspectedNode",
    SetInspectedNodeParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Sets node name for a node with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setNodeName: Protocol.CommandDef<"DOM.setNodeName", SetNodeNameParams, SetNodeNameResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.setNodeName",
    SetNodeNameParams,
    SetNodeNameResult,
    { status: "stable" }
  )

/**
 * Sets if stack traces should be captured for Nodes. See `Node.getNodeStackTraces`. Default is disabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setNodeStackTracesEnabled: Protocol.CommandDef<
  "DOM.setNodeStackTracesEnabled",
  SetNodeStackTracesEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.setNodeStackTracesEnabled",
  SetNodeStackTracesEnabledParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sets node value for a node with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setNodeValue: Protocol.CommandDef<"DOM.setNodeValue", SetNodeValueParams, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.setNodeValue",
    SetNodeValueParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets node HTML markup, returns new node id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setOuterHTML: Protocol.CommandDef<"DOM.setOuterHTML", SetOuterHTMLParams, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.setOuterHTML",
    SetOuterHTMLParams,
    undefined,
    { status: "stable" }
  )

/**
 * Undoes the last performed action.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const undo: Protocol.CommandDef<"DOM.undo", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.undo",
  undefined,
  undefined,
  { status: "experimental" }
)

/**
 * Fired when a node's ad related state changes.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const adRelatedStateUpdated: Protocol.EventDef<"DOM.adRelatedStateUpdated", AdRelatedStateUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.adRelatedStateUpdated",
    AdRelatedStateUpdatedParams,
    { status: "experimental" }
  )

/**
 * Fired when `Element`'s adoptedStyleSheets are modified.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const adoptedStyleSheetsModified: Protocol.EventDef<
  "DOM.adoptedStyleSheetsModified",
  AdoptedStyleSheetsModifiedParams
> = /*#__PURE__*/ Protocol.event(
  "DOM.adoptedStyleSheetsModified",
  AdoptedStyleSheetsModifiedParams,
  { status: "experimental" }
)

/**
 * Fired when a node's starting styles changes.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const affectedByStartingStylesFlagUpdated: Protocol.EventDef<
  "DOM.affectedByStartingStylesFlagUpdated",
  AffectedByStartingStylesFlagUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "DOM.affectedByStartingStylesFlagUpdated",
  AffectedByStartingStylesFlagUpdatedParams,
  { status: "experimental" }
)

/**
 * Fired when `Element`'s attribute is modified.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const attributeModified: Protocol.EventDef<"DOM.attributeModified", AttributeModifiedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.attributeModified",
    AttributeModifiedParams,
    { status: "stable" }
  )

/**
 * Fired when `Element`'s attribute is removed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const attributeRemoved: Protocol.EventDef<"DOM.attributeRemoved", AttributeRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.attributeRemoved",
    AttributeRemovedParams,
    { status: "stable" }
  )

/**
 * Mirrors `DOMCharacterDataModified` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const characterDataModified: Protocol.EventDef<"DOM.characterDataModified", CharacterDataModifiedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.characterDataModified",
    CharacterDataModifiedParams,
    { status: "stable" }
  )

/**
 * Fired when `Container`'s child node count has changed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const childNodeCountUpdated: Protocol.EventDef<"DOM.childNodeCountUpdated", ChildNodeCountUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.childNodeCountUpdated",
    ChildNodeCountUpdatedParams,
    { status: "stable" }
  )

/**
 * Mirrors `DOMNodeInserted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const childNodeInserted: Protocol.EventDef<"DOM.childNodeInserted", ChildNodeInsertedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.childNodeInserted",
    ChildNodeInsertedParams,
    { status: "stable" }
  )

/**
 * Mirrors `DOMNodeRemoved` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const childNodeRemoved: Protocol.EventDef<"DOM.childNodeRemoved", ChildNodeRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.childNodeRemoved",
    ChildNodeRemovedParams,
    { status: "stable" }
  )

/**
 * Called when distribution is changed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const distributedNodesUpdated: Protocol.EventDef<"DOM.distributedNodesUpdated", DistributedNodesUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.distributedNodesUpdated",
    DistributedNodesUpdatedParams,
    { status: "experimental" }
  )

/**
 * Fired when `Document` has been totally updated. Node ids are no longer valid.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const documentUpdated: Protocol.EventDef<"DOM.documentUpdated", void> = /*#__PURE__*/ Protocol.event(
  "DOM.documentUpdated",
  undefined,
  { status: "stable" }
)

/**
 * Fired when `Element`'s inline style is modified via a CSS property modification.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const inlineStyleInvalidated: Protocol.EventDef<"DOM.inlineStyleInvalidated", InlineStyleInvalidatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.inlineStyleInvalidated",
    InlineStyleInvalidatedParams,
    { status: "experimental" }
  )

/**
 * Called when a pseudo element is added to an element.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const pseudoElementAdded: Protocol.EventDef<"DOM.pseudoElementAdded", PseudoElementAddedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.pseudoElementAdded",
    PseudoElementAddedParams,
    { status: "experimental" }
  )

/**
 * Called when a pseudo element is removed from an element.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const pseudoElementRemoved: Protocol.EventDef<"DOM.pseudoElementRemoved", PseudoElementRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.pseudoElementRemoved",
    PseudoElementRemovedParams,
    { status: "experimental" }
  )

/**
 * Fired when a node's scrollability state changes.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const scrollableFlagUpdated: Protocol.EventDef<"DOM.scrollableFlagUpdated", ScrollableFlagUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.scrollableFlagUpdated",
    ScrollableFlagUpdatedParams,
    { status: "experimental" }
  )

/**
 * Fired when backend wants to provide client with the missing DOM structure. This happens upon
 * most of the calls requesting node ids.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const setChildNodes: Protocol.EventDef<"DOM.setChildNodes", SetChildNodesParams> = /*#__PURE__*/ Protocol.event(
  "DOM.setChildNodes",
  SetChildNodesParams,
  { status: "stable" }
)

/**
 * Called when shadow root is popped from the element.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const shadowRootPopped: Protocol.EventDef<"DOM.shadowRootPopped", ShadowRootPoppedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.shadowRootPopped",
    ShadowRootPoppedParams,
    { status: "experimental" }
  )

/**
 * Called when shadow root is pushed into the element.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const shadowRootPushed: Protocol.EventDef<"DOM.shadowRootPushed", ShadowRootPushedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.shadowRootPushed",
    ShadowRootPushedParams,
    { status: "experimental" }
  )

/**
 * Called when top layer elements are changed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const topLayerElementsUpdated: Protocol.EventDef<"DOM.topLayerElementsUpdated", void> = /*#__PURE__*/ Protocol
  .event(
    "DOM.topLayerElementsUpdated",
    undefined,
    { status: "experimental" }
  )
