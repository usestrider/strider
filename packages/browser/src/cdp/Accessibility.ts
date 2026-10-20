/**
 * The Accessibility domain.
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
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"

/**
 * A node in the accessibility tree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AXNode {
  /**
   * Unique identifier for this node.
   */
  readonly nodeId: AXNodeId
  /**
   * Whether this node is ignored for accessibility
   */
  readonly ignored: boolean
  /**
   * Collection of reasons why this node is hidden.
   */
  readonly ignoredReasons?: ReadonlyArray<AXProperty> | undefined
  /**
   * This `Node`'s role, whether explicit or implicit.
   */
  readonly role?: AXValue | undefined
  /**
   * This `Node`'s Chrome raw role.
   */
  readonly chromeRole?: AXValue | undefined
  /**
   * The accessible name for this `Node`.
   */
  readonly name?: AXValue | undefined
  /**
   * The accessible description for this `Node`.
   */
  readonly description?: AXValue | undefined
  /**
   * The value for this `Node`.
   */
  readonly value?: AXValue | undefined
  /**
   * All other properties
   */
  readonly properties?: ReadonlyArray<AXProperty> | undefined
  /**
   * ID for this node's parent.
   */
  readonly parentId?: AXNodeId | undefined
  /**
   * IDs for each of this node's child nodes.
   */
  readonly childIds?: ReadonlyArray<AXNodeId> | undefined
  /**
   * The backend ID for the associated DOM node, if any.
   */
  readonly backendDOMNodeId?: DOM.BackendNodeId | undefined
  /**
   * The frame ID for the frame associated with this nodes document.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `AXNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: AXNodeId,
    ignored: Schema.Boolean,
    ignoredReasons: Schema.optional(Schema.Array(AXProperty)),
    role: Schema.optional(AXValue),
    chromeRole: Schema.optional(AXValue),
    name: Schema.optional(AXValue),
    description: Schema.optional(AXValue),
    value: Schema.optional(AXValue),
    properties: Schema.optional(Schema.Array(AXProperty)),
    parentId: Schema.optional(AXNodeId),
    childIds: Schema.optional(Schema.Array(AXNodeId)),
    backendDOMNodeId: Schema.optional(DOM.BackendNodeId),
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Accessibility.AXNode" })
) as any as Schema.Codec<AXNode>

/**
 * Unique accessibility node identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AXNodeId = Brand.Branded<string, "~@usestrider/browser/cdp/Accessibility/AXNodeId">

/**
 * Schema for `AXNodeId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXNodeId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Accessibility/AXNodeId")
) as any as Schema.Codec<AXNodeId>

/**
 * `AXProperty`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AXProperty {
  /**
   * The name of this property.
   */
  readonly name: AXPropertyName
  /**
   * The value of this property.
   */
  readonly value: AXValue
}

/**
 * Schema for `AXProperty`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXProperty = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: AXPropertyName,
    value: AXValue
  }).annotate({ identifier: "Accessibility.AXProperty" })
) as any as Schema.Codec<AXProperty>

/**
 * Values of AXProperty name:
 * - from 'busy' to 'roledescription': states which apply to every AX node
 * - from 'live' to 'root': attributes which apply to nodes in live regions
 * - from 'autocomplete' to 'valuetext': attributes which apply to widgets
 * - from 'checked' to 'selected': states which apply to widgets
 * - from 'activedescendant' to 'owns': relationships between elements other than parent/child/sibling
 * - from 'activeFullscreenElement' to 'uninteresting': reasons why this noode is hidden
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AXPropertyName =
  | "actions"
  | "busy"
  | "disabled"
  | "editable"
  | "focusable"
  | "focused"
  | "hidden"
  | "hiddenRoot"
  | "invalid"
  | "keyshortcuts"
  | "settable"
  | "roledescription"
  | "live"
  | "atomic"
  | "relevant"
  | "root"
  | "autocomplete"
  | "hasPopup"
  | "level"
  | "multiselectable"
  | "orientation"
  | "multiline"
  | "readonly"
  | "required"
  | "valuemin"
  | "valuemax"
  | "valuetext"
  | "checked"
  | "expanded"
  | "modal"
  | "pressed"
  | "selected"
  | "activedescendant"
  | "controls"
  | "describedby"
  | "details"
  | "errormessage"
  | "flowto"
  | "labelledby"
  | "owns"
  | "url"
  | "activeFullscreenElement"
  | "activeModalDialog"
  | "activeAriaModalDialog"
  | "ariaHiddenElement"
  | "ariaHiddenSubtree"
  | "emptyAlt"
  | "emptyText"
  | "inertElement"
  | "inertSubtree"
  | "labelContainer"
  | "labelFor"
  | "notRendered"
  | "notVisible"
  | "presentationalRole"
  | "probablyPresentational"
  | "inactiveCarouselTabContent"
  | "uninteresting"
  | (string & {})

/**
 * Schema for `AXPropertyName`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXPropertyName = Schema.String as any as Schema.Codec<AXPropertyName>

/**
 * `AXRelatedNode`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AXRelatedNode {
  /**
   * The BackendNodeId of the related DOM node.
   */
  readonly backendDOMNodeId: DOM.BackendNodeId
  /**
   * The IDRef value provided, if any.
   */
  readonly idref?: string | undefined
  /**
   * The text alternative of this node in the current context.
   */
  readonly text?: string | undefined
}

/**
 * Schema for `AXRelatedNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXRelatedNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backendDOMNodeId: DOM.BackendNodeId,
    idref: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String)
  }).annotate({ identifier: "Accessibility.AXRelatedNode" })
) as any as Schema.Codec<AXRelatedNode>

/**
 * A single computed AX property.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AXValue {
  /**
   * The type of this value.
   */
  readonly type: AXValueType
  /**
   * The computed value of this property.
   */
  readonly value?: unknown | undefined
  /**
   * One or more related nodes, if applicable.
   */
  readonly relatedNodes?: ReadonlyArray<AXRelatedNode> | undefined
  /**
   * The sources which contributed to the computation of this property.
   */
  readonly sources?: ReadonlyArray<AXValueSource> | undefined
}

/**
 * Schema for `AXValue`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: AXValueType,
    value: Schema.optional(Schema.Unknown),
    relatedNodes: Schema.optional(Schema.Array(AXRelatedNode)),
    sources: Schema.optional(Schema.Array(AXValueSource))
  }).annotate({ identifier: "Accessibility.AXValue" })
) as any as Schema.Codec<AXValue>

/**
 * Enum of possible native property sources (as a subtype of a particular AXValueSourceType).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AXValueNativeSourceType =
  | "description"
  | "figcaption"
  | "label"
  | "labelfor"
  | "labelwrapped"
  | "legend"
  | "rubyannotation"
  | "tablecaption"
  | "title"
  | "other"
  | (string & {})

/**
 * Schema for `AXValueNativeSourceType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXValueNativeSourceType = Schema.String as any as Schema.Codec<AXValueNativeSourceType>

/**
 * A single source for a computed AX property.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AXValueSource {
  /**
   * What type of source this is.
   */
  readonly type: AXValueSourceType
  /**
   * The value of this property source.
   */
  readonly value?: AXValue | undefined
  /**
   * The name of the relevant attribute, if any.
   */
  readonly attribute?: string | undefined
  /**
   * The value of the relevant attribute, if any.
   */
  readonly attributeValue?: AXValue | undefined
  /**
   * Whether this source is superseded by a higher priority source.
   */
  readonly superseded?: boolean | undefined
  /**
   * The native markup source for this value, e.g. a `<label>` element.
   */
  readonly nativeSource?: AXValueNativeSourceType | undefined
  /**
   * The value, such as a node or node list, of the native source.
   */
  readonly nativeSourceValue?: AXValue | undefined
  /**
   * Whether the value for this property is invalid.
   */
  readonly invalid?: boolean | undefined
  /**
   * Reason for the value being invalid, if it is.
   */
  readonly invalidReason?: string | undefined
}

/**
 * Schema for `AXValueSource`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXValueSource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: AXValueSourceType,
    value: Schema.optional(AXValue),
    attribute: Schema.optional(Schema.String),
    attributeValue: Schema.optional(AXValue),
    superseded: Schema.optional(Schema.Boolean),
    nativeSource: Schema.optional(AXValueNativeSourceType),
    nativeSourceValue: Schema.optional(AXValue),
    invalid: Schema.optional(Schema.Boolean),
    invalidReason: Schema.optional(Schema.String)
  }).annotate({ identifier: "Accessibility.AXValueSource" })
) as any as Schema.Codec<AXValueSource>

/**
 * Enum of possible property sources.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AXValueSourceType =
  | "attribute"
  | "implicit"
  | "style"
  | "contents"
  | "placeholder"
  | "relatedElement"
  | (string & {})

/**
 * Schema for `AXValueSourceType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXValueSourceType = Schema.String as any as Schema.Codec<AXValueSourceType>

/**
 * Enum of possible property types.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AXValueType =
  | "boolean"
  | "tristate"
  | "booleanOrUndefined"
  | "idref"
  | "idrefList"
  | "integer"
  | "node"
  | "nodeList"
  | "number"
  | "string"
  | "computedString"
  | "token"
  | "tokenList"
  | "domRelation"
  | "role"
  | "internalRole"
  | "valueUndefined"
  | (string & {})

/**
 * Schema for `AXValueType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AXValueType = Schema.String as any as Schema.Codec<AXValueType>

/**
 * Fetches a node and all ancestors up to and including the root.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAXNodeAndAncestorsParams {
  /**
   * Identifier of the node to get.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Identifier of the backend node to get.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper to get.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
}

/**
 * Schema for `GetAXNodeAndAncestorsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAXNodeAndAncestorsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(DOM.NodeId),
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId)
  }).annotate({ identifier: "Accessibility.GetAXNodeAndAncestorsParams" })
) as any as Schema.Codec<GetAXNodeAndAncestorsParams>

/**
 * Fetches a node and all ancestors up to and including the root.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAXNodeAndAncestorsResult {
  readonly nodes: ReadonlyArray<AXNode>
}

/**
 * Schema for `GetAXNodeAndAncestorsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAXNodeAndAncestorsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(AXNode)
  }).annotate({ identifier: "Accessibility.GetAXNodeAndAncestorsResult" })
) as any as Schema.Codec<GetAXNodeAndAncestorsResult>

/**
 * Fetches a particular accessibility node by AXNodeId.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetChildAXNodesParams {
  readonly id: AXNodeId
  /**
   * The frame in whose document the node resides.
   * If omitted, the root frame is used.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `GetChildAXNodesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetChildAXNodesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: AXNodeId,
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Accessibility.GetChildAXNodesParams" })
) as any as Schema.Codec<GetChildAXNodesParams>

/**
 * Fetches a particular accessibility node by AXNodeId.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetChildAXNodesResult {
  readonly nodes: ReadonlyArray<AXNode>
}

/**
 * Schema for `GetChildAXNodesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetChildAXNodesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(AXNode)
  }).annotate({ identifier: "Accessibility.GetChildAXNodesResult" })
) as any as Schema.Codec<GetChildAXNodesResult>

/**
 * Fetches the entire accessibility tree for the root Document
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFullAXTreeParams {
  /**
   * The maximum depth at which descendants of the root node should be retrieved.
   * If omitted, the full tree is returned.
   */
  readonly depth?: number | undefined
  /**
   * The frame for whose document the AX tree should be retrieved.
   * If omitted, the root frame is used.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `GetFullAXTreeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFullAXTreeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    depth: Schema.optional(Schema.Int),
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Accessibility.GetFullAXTreeParams" })
) as any as Schema.Codec<GetFullAXTreeParams>

/**
 * Fetches the entire accessibility tree for the root Document
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFullAXTreeResult {
  readonly nodes: ReadonlyArray<AXNode>
}

/**
 * Schema for `GetFullAXTreeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFullAXTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(AXNode)
  }).annotate({ identifier: "Accessibility.GetFullAXTreeResult" })
) as any as Schema.Codec<GetFullAXTreeResult>

/**
 * Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPartialAXTreeParams {
  /**
   * Identifier of the node to get the partial accessibility tree for.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Identifier of the backend node to get the partial accessibility tree for.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper to get the partial accessibility tree for.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * Whether to fetch this node's ancestors, siblings and children. Defaults to true.
   */
  readonly fetchRelatives?: boolean | undefined
}

/**
 * Schema for `GetPartialAXTreeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPartialAXTreeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(DOM.NodeId),
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    fetchRelatives: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Accessibility.GetPartialAXTreeParams" })
) as any as Schema.Codec<GetPartialAXTreeParams>

/**
 * Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPartialAXTreeResult {
  /**
   * The `Accessibility.AXNode` for this DOM node, if it exists, plus its ancestors, siblings and
   * children, if requested.
   */
  readonly nodes: ReadonlyArray<AXNode>
}

/**
 * Schema for `GetPartialAXTreeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPartialAXTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(AXNode)
  }).annotate({ identifier: "Accessibility.GetPartialAXTreeResult" })
) as any as Schema.Codec<GetPartialAXTreeResult>

/**
 * Fetches the root node.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRootAXNodeParams {
  /**
   * The frame in whose document the node resides.
   * If omitted, the root frame is used.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `GetRootAXNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRootAXNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Accessibility.GetRootAXNodeParams" })
) as any as Schema.Codec<GetRootAXNodeParams>

/**
 * Fetches the root node.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRootAXNodeResult {
  readonly node: AXNode
}

/**
 * Schema for `GetRootAXNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRootAXNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    node: AXNode
  }).annotate({ identifier: "Accessibility.GetRootAXNodeResult" })
) as any as Schema.Codec<GetRootAXNodeResult>

/**
 * The loadComplete event mirrors the load complete event sent by the browser to assistive
 * technology when the web page has finished loading.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadCompleteParams {
  /**
   * New document root node.
   */
  readonly root: AXNode
}

/**
 * Schema for `LoadCompleteParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadCompleteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    root: AXNode
  }).annotate({ identifier: "Accessibility.LoadCompleteParams" })
) as any as Schema.Codec<LoadCompleteParams>

/**
 * The nodesUpdated event is sent every time a previously requested node has changed the in tree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodesUpdatedParams {
  /**
   * Updated node data.
   */
  readonly nodes: ReadonlyArray<AXNode>
}

/**
 * Schema for `NodesUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodesUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(AXNode)
  }).annotate({ identifier: "Accessibility.NodesUpdatedParams" })
) as any as Schema.Codec<NodesUpdatedParams>

/**
 * Query a DOM node's accessibility subtree for accessible name and role.
 * This command computes the name and role for all nodes in the subtree, including those that are
 * ignored for accessibility, and returns those that match the specified name and role. If no DOM
 * node is specified, or the DOM node does not exist, the command returns an error. If neither
 * `accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface QueryAXTreeParams {
  /**
   * Identifier of the node for the root to query.
   */
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Identifier of the backend node for the root to query.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * JavaScript object id of the node wrapper for the root to query.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * Find nodes with this computed name.
   */
  readonly accessibleName?: string | undefined
  /**
   * Find nodes with this computed role.
   */
  readonly role?: string | undefined
}

/**
 * Schema for `QueryAXTreeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const QueryAXTreeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(DOM.NodeId),
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    accessibleName: Schema.optional(Schema.String),
    role: Schema.optional(Schema.String)
  }).annotate({ identifier: "Accessibility.QueryAXTreeParams" })
) as any as Schema.Codec<QueryAXTreeParams>

/**
 * Query a DOM node's accessibility subtree for accessible name and role.
 * This command computes the name and role for all nodes in the subtree, including those that are
 * ignored for accessibility, and returns those that match the specified name and role. If no DOM
 * node is specified, or the DOM node does not exist, the command returns an error. If neither
 * `accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface QueryAXTreeResult {
  /**
   * A list of `Accessibility.AXNode` matching the specified attributes,
   * including nodes that are ignored for accessibility.
   */
  readonly nodes: ReadonlyArray<AXNode>
}

/**
 * Schema for `QueryAXTreeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const QueryAXTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(AXNode)
  }).annotate({ identifier: "Accessibility.QueryAXTreeResult" })
) as any as Schema.Codec<QueryAXTreeResult>

/**
 * Disables the accessibility domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Accessibility.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Accessibility.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables the accessibility domain which causes `AXNodeId`s to remain consistent between method calls.
 * This turns on accessibility for the page, which can impact performance until accessibility is disabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Accessibility.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Accessibility.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fetches a node and all ancestors up to and including the root.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAXNodeAndAncestors: Protocol.CommandDef<
  "Accessibility.getAXNodeAndAncestors",
  GetAXNodeAndAncestorsParams,
  GetAXNodeAndAncestorsResult
> = /*#__PURE__*/ Protocol.command(
  "Accessibility.getAXNodeAndAncestors",
  GetAXNodeAndAncestorsParams,
  GetAXNodeAndAncestorsResult,
  { status: "experimental" }
)

/**
 * Fetches a particular accessibility node by AXNodeId.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getChildAXNodes: Protocol.CommandDef<
  "Accessibility.getChildAXNodes",
  GetChildAXNodesParams,
  GetChildAXNodesResult
> = /*#__PURE__*/ Protocol.command(
  "Accessibility.getChildAXNodes",
  GetChildAXNodesParams,
  GetChildAXNodesResult,
  { status: "experimental" }
)

/**
 * Fetches the entire accessibility tree for the root Document
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getFullAXTree: Protocol.CommandDef<
  "Accessibility.getFullAXTree",
  GetFullAXTreeParams,
  GetFullAXTreeResult
> = /*#__PURE__*/ Protocol.command(
  "Accessibility.getFullAXTree",
  GetFullAXTreeParams,
  GetFullAXTreeResult,
  { status: "experimental" }
)

/**
 * Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getPartialAXTree: Protocol.CommandDef<
  "Accessibility.getPartialAXTree",
  GetPartialAXTreeParams,
  GetPartialAXTreeResult
> = /*#__PURE__*/ Protocol.command(
  "Accessibility.getPartialAXTree",
  GetPartialAXTreeParams,
  GetPartialAXTreeResult,
  { status: "experimental" }
)

/**
 * Fetches the root node.
 * Requires `enable()` to have been called previously.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getRootAXNode: Protocol.CommandDef<
  "Accessibility.getRootAXNode",
  GetRootAXNodeParams,
  GetRootAXNodeResult
> = /*#__PURE__*/ Protocol.command(
  "Accessibility.getRootAXNode",
  GetRootAXNodeParams,
  GetRootAXNodeResult,
  { status: "experimental" }
)

/**
 * Query a DOM node's accessibility subtree for accessible name and role.
 * This command computes the name and role for all nodes in the subtree, including those that are
 * ignored for accessibility, and returns those that match the specified name and role. If no DOM
 * node is specified, or the DOM node does not exist, the command returns an error. If neither
 * `accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const queryAXTree: Protocol.CommandDef<"Accessibility.queryAXTree", QueryAXTreeParams, QueryAXTreeResult> =
  /*#__PURE__*/ Protocol.command(
    "Accessibility.queryAXTree",
    QueryAXTreeParams,
    QueryAXTreeResult,
    { status: "experimental" }
  )

/**
 * The loadComplete event mirrors the load complete event sent by the browser to assistive
 * technology when the web page has finished loading.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const loadComplete: Protocol.EventDef<"Accessibility.loadComplete", LoadCompleteParams> = /*#__PURE__*/ Protocol
  .event(
    "Accessibility.loadComplete",
    LoadCompleteParams,
    { status: "experimental" }
  )

/**
 * The nodesUpdated event is sent every time a previously requested node has changed the in tree.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const nodesUpdated: Protocol.EventDef<"Accessibility.nodesUpdated", NodesUpdatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Accessibility.nodesUpdated",
    NodesUpdatedParams,
    { status: "experimental" }
  )
