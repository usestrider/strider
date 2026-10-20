/**
 * This domain exposes DOM read/write operations. Each DOM Node is represented with its mirror object that has an <code>id</code>. This <code>id</code> can be used to get additional information on the Node, resolve it into the JavaScript object wrapper, etc. It is important that client receives DOM events only for the nodes that are known to the client. Backend keeps track of the nodes that were sent to the client and never sends the same node twice. It is client's responsibility to collect information about the nodes that were sent to the client.<p>Note that <code>iframe</code> owner elements will return corresponding document elements as their child nodes.</p>
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as CSS from "./CSS.ts"
import * as Debugger from "./Debugger.ts"
import * as Network from "./Network.ts"
import * as Runtime from "./Runtime.ts"

/**
 * A structure holding accessibility properties.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AccessibilityProperties {
  /**
   * <code>DOMNode</code> id of the accessibility object referenced by aria-activedescendant.
   */
  readonly activeDescendantNodeId?: NodeId | undefined
  /**
   * Value of \@aria-busy on current or ancestor node.
   */
  readonly busy?: boolean | undefined
  /**
   * Checked state of certain form controls.
   */
  readonly checked?: AccessibilityPropertiesChecked | undefined
  /**
   * Array of <code>DOMNode</code> ids of the accessibility tree children if available.
   */
  readonly childNodeIds?: ReadonlyArray<NodeId> | undefined
  /**
   * Array of <code>DOMNode</code> ids of any nodes referenced via \@aria-controls.
   */
  readonly controlledNodeIds?: ReadonlyArray<NodeId> | undefined
  /**
   * Current item within a container or set of related elements.
   */
  readonly current?: AccessibilityPropertiesCurrent | undefined
  /**
   * Disabled state of form controls.
   */
  readonly disabled?: boolean | undefined
  /**
   * Heading level of a heading element.
   */
  readonly headingLevel?: number | undefined
  /**
   * The hierarchical level of an element.
   */
  readonly hierarchyLevel?: number | undefined
  /**
   * Whether an element is a popup button.
   */
  readonly isPopUpButton?: boolean | undefined
  /**
   * Indicates whether there is an existing AX object for the DOM node. If this is false, all the other properties will be default values.
   */
  readonly exists: boolean
  /**
   * Expanded state.
   */
  readonly expanded?: boolean | undefined
  /**
   * Array of <code>DOMNode</code> ids of any nodes referenced via \@aria-flowto.
   */
  readonly flowedNodeIds?: ReadonlyArray<NodeId> | undefined
  /**
   * Focused state. Only defined on focusable elements.
   */
  readonly focused?: boolean | undefined
  /**
   * Indicates whether the accessibility of the associated AX object node is ignored, whether heuristically or explicitly.
   */
  readonly ignored?: boolean | undefined
  /**
   * State indicating whether the accessibility of the associated AX object node is ignored by default for node type.
   */
  readonly ignoredByDefault?: boolean | undefined
  /**
   * Invalid status of form controls.
   */
  readonly invalid?: AccessibilityPropertiesInvalid | undefined
  /**
   * Hidden state. True if node or an ancestor is hidden via CSS or explicit \@aria-hidden, to clarify why the element is ignored.
   */
  readonly hidden?: boolean | undefined
  /**
   * Computed label value for the node, sometimes calculated by referencing other nodes.
   */
  readonly label: string
  /**
   * Value of \@aria-atomic.
   */
  readonly liveRegionAtomic?: boolean | undefined
  /**
   * Token value(s) of element's \@aria-relevant attribute. Array of string values matching $ref LiveRegionRelevant. FIXME: Enum values blocked by http://webkit.org/b/133711
   */
  readonly liveRegionRelevant?: ReadonlyArray<string> | undefined
  /**
   * Value of element's \@aria-live attribute.
   */
  readonly liveRegionStatus?: AccessibilityPropertiesLiveRegionStatus | undefined
  /**
   * <code>DOMNode</code> id of node or closest ancestor node that has a mousedown, mouseup, or click event handler.
   */
  readonly mouseEventNodeId?: NodeId | undefined
  /**
   * Target <code>DOMNode</code> id.
   */
  readonly nodeId: NodeId
  /**
   * Array of <code>DOMNode</code> ids of any nodes referenced via \@aria-owns.
   */
  readonly ownedNodeIds?: ReadonlyArray<NodeId> | undefined
  /**
   * <code>DOMNode</code> id of the accessibility tree parent object if available.
   */
  readonly parentNodeId?: NodeId | undefined
  /**
   * Pressed state for toggle buttons.
   */
  readonly pressed?: boolean | undefined
  /**
   * Readonly state of text controls.
   */
  readonly readonly?: boolean | undefined
  /**
   * Required state of form controls.
   */
  readonly required?: boolean | undefined
  /**
   * Computed value for first recognized role token, default role per element, or overridden role.
   */
  readonly role: string
  /**
   * Selected state of certain form controls.
   */
  readonly selected?: boolean | undefined
  /**
   * Array of <code>DOMNode</code> ids of any children marked as selected.
   */
  readonly selectedChildNodeIds?: ReadonlyArray<NodeId> | undefined
  /**
   * On / off state of switch form controls.
   */
  readonly switchState?: AccessibilityPropertiesSwitchState | undefined
}

/**
 * Schema for `AccessibilityProperties`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityProperties = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    activeDescendantNodeId: Schema.optional(NodeId),
    busy: Schema.optional(Schema.Boolean),
    checked: Schema.optional(AccessibilityPropertiesChecked),
    childNodeIds: Schema.optional(Schema.Array(NodeId)),
    controlledNodeIds: Schema.optional(Schema.Array(NodeId)),
    current: Schema.optional(AccessibilityPropertiesCurrent),
    disabled: Schema.optional(Schema.Boolean),
    headingLevel: Schema.optional(Schema.Number),
    hierarchyLevel: Schema.optional(Schema.Number),
    isPopUpButton: Schema.optional(Schema.Boolean),
    exists: Schema.Boolean,
    expanded: Schema.optional(Schema.Boolean),
    flowedNodeIds: Schema.optional(Schema.Array(NodeId)),
    focused: Schema.optional(Schema.Boolean),
    ignored: Schema.optional(Schema.Boolean),
    ignoredByDefault: Schema.optional(Schema.Boolean),
    invalid: Schema.optional(AccessibilityPropertiesInvalid),
    hidden: Schema.optional(Schema.Boolean),
    label: Schema.String,
    liveRegionAtomic: Schema.optional(Schema.Boolean),
    liveRegionRelevant: Schema.optional(Schema.Array(Schema.String)),
    liveRegionStatus: Schema.optional(AccessibilityPropertiesLiveRegionStatus),
    mouseEventNodeId: Schema.optional(NodeId),
    nodeId: NodeId,
    ownedNodeIds: Schema.optional(Schema.Array(NodeId)),
    parentNodeId: Schema.optional(NodeId),
    pressed: Schema.optional(Schema.Boolean),
    readonly: Schema.optional(Schema.Boolean),
    required: Schema.optional(Schema.Boolean),
    role: Schema.String,
    selected: Schema.optional(Schema.Boolean),
    selectedChildNodeIds: Schema.optional(Schema.Array(NodeId)),
    switchState: Schema.optional(AccessibilityPropertiesSwitchState)
  }).annotate({ identifier: "DOM.AccessibilityProperties" })
) as any as Schema.Codec<AccessibilityProperties>

/**
 * Checked state of certain form controls.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AccessibilityPropertiesChecked =
  | "true"
  | "false"
  | "mixed"
  | (string & {})

/**
 * Schema for `AccessibilityPropertiesChecked`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityPropertiesChecked = Schema.String as any as Schema.Codec<AccessibilityPropertiesChecked>

/**
 * Current item within a container or set of related elements.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AccessibilityPropertiesCurrent =
  | "true"
  | "false"
  | "page"
  | "step"
  | "location"
  | "date"
  | "time"
  | (string & {})

/**
 * Schema for `AccessibilityPropertiesCurrent`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityPropertiesCurrent = Schema.String as any as Schema.Codec<AccessibilityPropertiesCurrent>

/**
 * Invalid status of form controls.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AccessibilityPropertiesInvalid =
  | "true"
  | "false"
  | "grammar"
  | "spelling"
  | (string & {})

/**
 * Schema for `AccessibilityPropertiesInvalid`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityPropertiesInvalid = Schema.String as any as Schema.Codec<AccessibilityPropertiesInvalid>

/**
 * Value of element's \@aria-live attribute.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AccessibilityPropertiesLiveRegionStatus =
  | "assertive"
  | "polite"
  | "off"
  | (string & {})

/**
 * Schema for `AccessibilityPropertiesLiveRegionStatus`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityPropertiesLiveRegionStatus = Schema.String as any as Schema.Codec<
  AccessibilityPropertiesLiveRegionStatus
>

/**
 * On / off state of switch form controls.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AccessibilityPropertiesSwitchState =
  | "off"
  | "on"
  | (string & {})

/**
 * Schema for `AccessibilityPropertiesSwitchState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityPropertiesSwitchState = Schema.String as any as Schema.Codec<
  AccessibilityPropertiesSwitchState
>

/**
 * A structure holding media element's audio-specific statistics and configurations.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AudioMediaStats {
  /**
   * The data rate of the primary audio track in bits/s.
   */
  readonly bitrate: number
  /**
   * The codec string of the primary audio track. (E.g., "hvc1.1.6.L123.B0")
   */
  readonly codec: string
  /**
   * A human readable version of the `codec` parameter.
   */
  readonly humanReadableCodecString: string
  /**
   * The number of audio channels in the primary audio track.
   */
  readonly numberOfChannels: number
  /**
   * The sample rate of the primary audio track in hertz.
   */
  readonly sampleRate: number
  /**
   * Whether the track contains protected contents
   */
  readonly isProtected?: boolean | undefined
}

/**
 * Schema for `AudioMediaStats`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AudioMediaStats = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bitrate: Schema.Int,
    codec: Schema.String,
    humanReadableCodecString: Schema.String,
    numberOfChannels: Schema.Int,
    sampleRate: Schema.Number,
    isProtected: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.AudioMediaStats" })
) as any as Schema.Codec<AudioMediaStats>

/**
 * Custom element state.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CustomElementState =
  | "builtin"
  | "custom"
  | "waiting"
  | "failed"
  | (string & {})

/**
 * Schema for `CustomElementState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CustomElementState = Schema.String as any as Schema.Codec<CustomElementState>

/**
 * Relationship between data that is associated with a node and the node itself.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DataBinding {
  /**
   * The binding key that is specified.
   */
  readonly binding: string
  /**
   * A more descriptive name for the type of binding that represents this paritcular data relationship
   */
  readonly type?: string | undefined
  /**
   * The value that is resolved to with this data binding relationship.
   */
  readonly value: string
}

/**
 * Schema for `DataBinding`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DataBinding = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    binding: Schema.String,
    type: Schema.optional(Schema.String),
    value: Schema.String
  }).annotate({ identifier: "DOM.DataBinding" })
) as any as Schema.Codec<DataBinding>

/**
 * A structure holding event listener properties.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EventListener {
  readonly eventListenerId: EventListenerId
  /**
   * <code>EventListener</code>'s type.
   */
  readonly type: string
  /**
   * <code>EventListener</code>'s useCapture.
   */
  readonly useCapture: boolean
  /**
   * <code>EventListener</code>'s isAttribute.
   */
  readonly isAttribute: boolean
  /**
   * The target <code>DOMNode</code> id if the event listener is for a node.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * True if the event listener was added to the window.
   */
  readonly onWindow?: boolean | undefined
  /**
   * Handler code location.
   */
  readonly location?: Debugger.Location | undefined
  /**
   * Event handler function name.
   */
  readonly handlerName?: string | undefined
  /**
   * <code>EventListener</code>'s passive.
   */
  readonly passive?: boolean | undefined
  /**
   * <code>EventListener</code>'s once.
   */
  readonly once?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly hasBreakpoint?: boolean | undefined
}

/**
 * Schema for `EventListener`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventListener = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventListenerId: EventListenerId,
    type: Schema.String,
    useCapture: Schema.Boolean,
    isAttribute: Schema.Boolean,
    nodeId: Schema.optional(NodeId),
    onWindow: Schema.optional(Schema.Boolean),
    location: Schema.optional(Debugger.Location),
    handlerName: Schema.optional(Schema.String),
    passive: Schema.optional(Schema.Boolean),
    once: Schema.optional(Schema.Boolean),
    disabled: Schema.optional(Schema.Boolean),
    hasBreakpoint: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.EventListener" })
) as any as Schema.Codec<EventListener>

/**
 * Unique event listener identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EventListenerId = Brand.Branded<number, "~@usestrider/browser/webkit-protocol/DOM/EventListenerId">

/**
 * Schema for `EventListenerId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventListenerId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/DOM/EventListenerId")
) as any as Schema.Codec<EventListenerId>

/**
 * Configuration data for flex overlays.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FlexOverlayConfig {
  /**
   * The primary color to use for the flex overlay.
   */
  readonly flexColor: RGBAColor
  /**
   * Show labels for flex order. If not specified, the default value is false.
   */
  readonly showOrderNumbers?: boolean | undefined
}

/**
 * Schema for `FlexOverlayConfig`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FlexOverlayConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    flexColor: RGBAColor,
    showOrderNumbers: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.FlexOverlayConfig" })
) as any as Schema.Codec<FlexOverlayConfig>

/**
 * Configuration data for grid overlays.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GridOverlayConfig {
  /**
   * The primary color to use for the grid overlay.
   */
  readonly gridColor: RGBAColor
  /**
   * Show labels for grid line names. If not specified, the default value is false.
   */
  readonly showLineNames?: boolean | undefined
  /**
   * Show labels for grid line numbers. If not specified, the default value is false.
   */
  readonly showLineNumbers?: boolean | undefined
  /**
   * Show grid lines that extend beyond the bounds of the grid. If not specified, the default value is false.
   */
  readonly showExtendedGridLines?: boolean | undefined
  /**
   * Show grid track size information. If not specified, the default value is false.
   */
  readonly showTrackSizes?: boolean | undefined
  /**
   * Show labels for grid area names. If not specified, the default value is false.
   */
  readonly showAreaNames?: boolean | undefined
  /**
   * Show labels for grid item order. If not specified, the default value is false.
   */
  readonly showOrderNumbers?: boolean | undefined
}

/**
 * Schema for `GridOverlayConfig`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GridOverlayConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gridColor: RGBAColor,
    showLineNames: Schema.optional(Schema.Boolean),
    showLineNumbers: Schema.optional(Schema.Boolean),
    showExtendedGridLines: Schema.optional(Schema.Boolean),
    showTrackSizes: Schema.optional(Schema.Boolean),
    showAreaNames: Schema.optional(Schema.Boolean),
    showOrderNumbers: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GridOverlayConfig" })
) as any as Schema.Codec<GridOverlayConfig>

/**
 * Configuration data for the highlighting of page elements.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HighlightConfig {
  /**
   * Whether the node info tooltip should be shown (default: false).
   */
  readonly showInfo?: boolean | undefined
  /**
   * The content box highlight fill color (default: transparent).
   */
  readonly contentColor?: RGBAColor | undefined
  /**
   * The padding highlight fill color (default: transparent).
   */
  readonly paddingColor?: RGBAColor | undefined
  /**
   * The border highlight fill color (default: transparent).
   */
  readonly borderColor?: RGBAColor | undefined
  /**
   * The margin highlight fill color (default: transparent).
   */
  readonly marginColor?: RGBAColor | undefined
}

/**
 * Schema for `HighlightConfig`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightConfig = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    showInfo: Schema.optional(Schema.Boolean),
    contentColor: Schema.optional(RGBAColor),
    paddingColor: Schema.optional(RGBAColor),
    borderColor: Schema.optional(RGBAColor),
    marginColor: Schema.optional(RGBAColor)
  }).annotate({ identifier: "DOM.HighlightConfig" })
) as any as Schema.Codec<HighlightConfig>

/**
 * A structure containing metadata describing spatial video properties.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ImmersiveVideoMetadata {
  /**
   * The kind of immersive video.
   */
  readonly kind: VideoProjectionMetadataKind
  readonly width: number
  readonly height: number
  /**
   * The horizontal field-of-view measurement, in degrees
   */
  readonly horizontalFieldOfView?: number | undefined
  /**
   * The distance between the centers of the lenses in a camera system, in micrometers
   */
  readonly stereoCameraBaseline?: number | undefined
  /**
   * The relative shift of the left and right eye images, as a percentage
   */
  readonly horizontalDisparityAdjustment?: number | undefined
}

/**
 * Schema for `ImmersiveVideoMetadata`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ImmersiveVideoMetadata = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    kind: VideoProjectionMetadataKind,
    width: Schema.Number,
    height: Schema.Number,
    horizontalFieldOfView: Schema.optional(Schema.Int),
    stereoCameraBaseline: Schema.optional(Schema.Int),
    horizontalDisparityAdjustment: Schema.optional(Schema.Int)
  }).annotate({ identifier: "DOM.ImmersiveVideoMetadata" })
) as any as Schema.Codec<ImmersiveVideoMetadata>

/**
 * Token values of \@aria-relevant attribute.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LiveRegionRelevant =
  | "additions"
  | "removals"
  | "text"
  | (string & {})

/**
 * Schema for `LiveRegionRelevant`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LiveRegionRelevant = Schema.String as any as Schema.Codec<LiveRegionRelevant>

/**
 * A structure holding media element statistics and configurations.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MediaStats {
  readonly audio?: AudioMediaStats | undefined
  readonly video?: VideoMediaStats | undefined
  /**
   * The ratio between physical screen pixels and CSS pixels.
   */
  readonly devicePixelRatio?: number | undefined
  /**
   * The viewport size occupied by the media element.
   */
  readonly viewport?: ViewportSize | undefined
  readonly quality?: VideoPlaybackQuality | undefined
  /**
   * The source type of the media element.
   */
  readonly source?: string | undefined
}

/**
 * Schema for `MediaStats`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MediaStats = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    audio: Schema.optional(AudioMediaStats),
    video: Schema.optional(VideoMediaStats),
    devicePixelRatio: Schema.optional(Schema.Number),
    viewport: Schema.optional(ViewportSize),
    quality: Schema.optional(VideoPlaybackQuality),
    source: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOM.MediaStats" })
) as any as Schema.Codec<MediaStats>

/**
 * DOM interaction is implemented in terms of mirror objects that represent the actual DOM nodes. DOMNode is a base node mirror type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Node {
  /**
   * Node identifier that is passed into the rest of the DOM messages as the <code>nodeId</code>. Backend will only push node with given <code>id</code> once. It is aware of all requested nodes and will only fire DOM events for nodes known to the client.
   */
  readonly nodeId: NodeId
  /**
   * <code>Node</code>'s nodeType.
   */
  readonly nodeType: number
  /**
   * <code>Node</code>'s nodeName.
   */
  readonly nodeName: string
  /**
   * <code>Node</code>'s localName.
   */
  readonly localName: string
  /**
   * <code>Node</code>'s nodeValue.
   */
  readonly nodeValue: string
  /**
   * Identifier of the containing frame.
   */
  readonly frameId?: Network.FrameId | undefined
  /**
   * Child count for <code>Container</code> nodes.
   */
  readonly childNodeCount?: number | undefined
  /**
   * Child nodes of this node when requested with children.
   */
  readonly children?: ReadonlyArray<Node> | undefined
  /**
   * Attributes of the <code>Element</code> node in the form of flat array <code>[name1, value1, name2, value2]</code>.
   */
  readonly attributes?: ReadonlyArray<string> | undefined
  /**
   * Document URL that <code>Document</code> or <code>FrameOwner</code> node points to.
   */
  readonly documentURL?: string | undefined
  /**
   * Base URL that <code>Document</code> or <code>FrameOwner</code> node uses for URL completion.
   */
  readonly baseURL?: string | undefined
  /**
   * <code>DocumentType</code>'s publicId.
   */
  readonly publicId?: string | undefined
  /**
   * <code>DocumentType</code>'s systemId.
   */
  readonly systemId?: string | undefined
  /**
   * <code>Document</code>'s XML version in case of XML documents.
   */
  readonly xmlVersion?: string | undefined
  /**
   * <code>Attr</code>'s name.
   */
  readonly name?: string | undefined
  /**
   * <code>Attr</code>'s value.
   */
  readonly value?: string | undefined
  /**
   * Pseudo element type for this node.
   */
  readonly pseudoType?: PseudoType | undefined
  /**
   * Shadow root type.
   */
  readonly shadowRootType?: ShadowRootType | undefined
  /**
   * Custom element state.
   */
  readonly customElementState?: CustomElementState | undefined
  /**
   * Content document for frame owner elements.
   */
  readonly contentDocument?: Node | undefined
  /**
   * Shadow root list for given element host.
   */
  readonly shadowRoots?: ReadonlyArray<Node> | undefined
  /**
   * Content document fragment for template elements
   */
  readonly templateContent?: Node | undefined
  /**
   * Pseudo elements associated with this node.
   */
  readonly pseudoElements?: ReadonlyArray<Node> | undefined
  /**
   * Computed SHA-256 Content Security Policy hash source for given element.
   */
  readonly contentSecurityPolicyHash?: string | undefined
  /**
   * Relevant information about the layout of the node. When not provided, the layout of the node is not important to Web Inspector.
   */
  readonly layoutFlags?: ReadonlyArray<string> | undefined
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
    nodeType: Schema.Int,
    nodeName: Schema.String,
    localName: Schema.String,
    nodeValue: Schema.String,
    frameId: Schema.optional(Network.FrameId),
    childNodeCount: Schema.optional(Schema.Int),
    children: Schema.optional(Schema.Array(Node)),
    attributes: Schema.optional(Schema.Array(Schema.String)),
    documentURL: Schema.optional(Schema.String),
    baseURL: Schema.optional(Schema.String),
    publicId: Schema.optional(Schema.String),
    systemId: Schema.optional(Schema.String),
    xmlVersion: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    value: Schema.optional(Schema.String),
    pseudoType: Schema.optional(PseudoType),
    shadowRootType: Schema.optional(ShadowRootType),
    customElementState: Schema.optional(CustomElementState),
    contentDocument: Schema.optional(Node),
    shadowRoots: Schema.optional(Schema.Array(Node)),
    templateContent: Schema.optional(Node),
    pseudoElements: Schema.optional(Schema.Array(Node)),
    contentSecurityPolicyHash: Schema.optional(Schema.String),
    layoutFlags: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "DOM.Node" })
) as any as Schema.Codec<Node>

/**
 * Unique DOM node identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NodeId = Brand.Branded<number, "~@usestrider/browser/webkit-protocol/DOM/NodeId">

/**
 * Schema for `NodeId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/DOM/NodeId")
) as any as Schema.Codec<NodeId>

/**
 * Pseudo element type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PseudoType =
  | "before"
  | "after"
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
export interface RGBAColor {
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
 * Schema for `RGBAColor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RGBAColor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    r: Schema.Int,
    g: Schema.Int,
    b: Schema.Int,
    a: Schema.optional(Schema.Number)
  }).annotate({ identifier: "DOM.RGBAColor" })
) as any as Schema.Codec<RGBAColor>

/**
 * `Rect`.
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
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int,
    height: Schema.Int
  }).annotate({ identifier: "DOM.Rect" })
) as any as Schema.Codec<Rect>

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
 * An object referencing a node and a pseudo-element, primarily used to identify an animation effect target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Styleable {
  readonly nodeId: NodeId
  readonly pseudoId?: CSS.PseudoId | undefined
}

/**
 * Schema for `Styleable`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Styleable = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    pseudoId: Schema.optional(CSS.PseudoId)
  }).annotate({ identifier: "DOM.Styleable" })
) as any as Schema.Codec<Styleable>

/**
 * WebCodecs VideoColorSpace
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VideoColorSpace {
  /**
   * A flag indicating whether the colorspace is Full range (true) or Video range (false)
   */
  readonly fullRange?: boolean | undefined
  /**
   * The matrix specification of the colorspace
   */
  readonly matrix?: string | undefined
  /**
   * The color primaries specification of the colorspace
   */
  readonly primaries?: string | undefined
  /**
   * The transfer function specification of the colorspace
   */
  readonly transfer?: string | undefined
}

/**
 * Schema for `VideoColorSpace`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VideoColorSpace = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fullRange: Schema.optional(Schema.Boolean),
    matrix: Schema.optional(Schema.String),
    primaries: Schema.optional(Schema.String),
    transfer: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOM.VideoColorSpace" })
) as any as Schema.Codec<VideoColorSpace>

/**
 * A structure holding media element's audio-specific statistics and configurations.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VideoMediaStats {
  /**
   * The data rate of the video track in bits/s.
   */
  readonly bitrate: number
  /**
   * The codec string of the video track. (E.g., "hvc1.1.6.L123.B0")
   */
  readonly codec: string
  /**
   * A human readable version of the `codec` parameter.
   */
  readonly humanReadableCodecString: string
  readonly colorSpace: VideoColorSpace
  /**
   * The nominal frame rate of video track in frames per second.
   */
  readonly framerate: number
  /**
   * The native height of the video track in CSS pixels
   */
  readonly height: number
  /**
   * The native width of the video track in CSS pixels
   */
  readonly width: number
  readonly immersiveVideoMetadata?: ImmersiveVideoMetadata | undefined
  /**
   * Whether the track contains protected contents
   */
  readonly isProtected?: boolean | undefined
}

/**
 * Schema for `VideoMediaStats`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VideoMediaStats = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bitrate: Schema.Int,
    codec: Schema.String,
    humanReadableCodecString: Schema.String,
    colorSpace: VideoColorSpace,
    framerate: Schema.Number,
    height: Schema.Int,
    width: Schema.Int,
    immersiveVideoMetadata: Schema.optional(ImmersiveVideoMetadata),
    isProtected: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.VideoMediaStats" })
) as any as Schema.Codec<VideoMediaStats>

/**
 * A count of frames enqueued for display by the media element, and a subset count of dropped and display composited frames.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VideoPlaybackQuality {
  /**
   * The number of frames of the total which were composited by the display.
   */
  readonly displayCompositedVideoFrames: number
  /**
   * The number of frames of the total which were dropped without being displayed.
   */
  readonly droppedVideoFrames: number
  /**
   * The total number of frames enqueued for display by the media element.
   */
  readonly totalVideoFrames: number
}

/**
 * Schema for `VideoPlaybackQuality`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VideoPlaybackQuality = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    displayCompositedVideoFrames: Schema.Int,
    droppedVideoFrames: Schema.Int,
    totalVideoFrames: Schema.Int
  }).annotate({ identifier: "DOM.VideoPlaybackQuality" })
) as any as Schema.Codec<VideoPlaybackQuality>

/**
 * Video Projection Metadata Kind.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type VideoProjectionMetadataKind =
  | "unknown"
  | "rectilinear"
  | "equirectangular"
  | "half-equirectangular"
  | "equi-angular-cubemap"
  | "parametric"
  | "pyramid"
  | "apple-immersive-video"
  | (string & {})

/**
 * Schema for `VideoProjectionMetadataKind`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VideoProjectionMetadataKind = Schema.String as any as Schema.Codec<VideoProjectionMetadataKind>

/**
 * `ViewportSize`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ViewportSize {
  readonly width: number
  readonly height: number
}

/**
 * Schema for `ViewportSize`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ViewportSize = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Number,
    height: Schema.Number
  }).annotate({ identifier: "DOM.ViewportSize" })
) as any as Schema.Codec<ViewportSize>

/**
 * Fired when <code>Element</code>'s attribute is modified.
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
 * Fired when <code>Element</code>'s attribute is removed.
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
   * Attribute name.
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
 * Mirrors <code>DOMCharacterDataModified</code> event.
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
 * Fired when <code>Container</code>'s child node count has changed.
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
 * Mirrors <code>DOMNodeInserted</code> event.
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
) as any as Schema.Codec<ChildNodeInsertedParams>

/**
 * Mirrors <code>DOMNodeRemoved</code> event.
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
 * Called when the custom element state is changed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CustomElementStateChangedParams {
  /**
   * Element id.
   */
  readonly nodeId: NodeId
  /**
   * Custom element state.
   */
  readonly customElementState: CustomElementState
}

/**
 * Schema for `CustomElementStateChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CustomElementStateChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    customElementState: CustomElementState
  }).annotate({ identifier: "DOM.CustomElementStateChangedParams" })
) as any as Schema.Codec<CustomElementStateChangedParams>

/**
 * Returns node description.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DescribeNodeParams {
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId: Runtime.RemoteObjectId
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
    objectId: Runtime.RemoteObjectId
  }).annotate({ identifier: "DOM.DescribeNodeParams" })
) as any as Schema.Codec<DescribeNodeParams>

/**
 * Returns node description.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DescribeNodeResult {
  /**
   * Frame ID for frame owner elements.
   */
  readonly contentFrameId?: Network.FrameId | undefined
  /**
   * ID of the owning frame element.
   */
  readonly ownerFrameId?: Network.FrameId | undefined
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
    contentFrameId: Schema.optional(Network.FrameId),
    ownerFrameId: Schema.optional(Network.FrameId)
  }).annotate({ identifier: "DOM.DescribeNodeResult" })
) as any as Schema.Codec<DescribeNodeResult>

/**
 * Called when an event listener is added to a node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DidAddEventListenerParams {
  readonly nodeId: NodeId
}

/**
 * Schema for `DidAddEventListenerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DidAddEventListenerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.DidAddEventListenerParams" })
) as any as Schema.Codec<DidAddEventListenerParams>

/**
 * Called when an event is fired on a node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DidFireEventParams {
  readonly nodeId: NodeId
  readonly eventName: string
  /**
   * Time when the event was fired
   */
  readonly timestamp: Network.Timestamp
  /**
   * Holds ancillary information about the event or its target.
   */
  readonly data?: { readonly [key: string]: unknown } | undefined
}

/**
 * Schema for `DidFireEventParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DidFireEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    eventName: Schema.String,
    timestamp: Network.Timestamp,
    data: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "DOM.DidFireEventParams" })
) as any as Schema.Codec<DidFireEventParams>

/**
 * Discards search results from the session with the given id. <code>getSearchResults</code> should no longer be called for that search.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DiscardSearchResultsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    searchId: Schema.String
  }).annotate({ identifier: "DOM.DiscardSearchResultsParams" })
) as any as Schema.Codec<DiscardSearchResultsParams>

/**
 * Focuses the given element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FocusParams {
  /**
   * Id of the node to focus.
   */
  readonly nodeId: NodeId
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
    nodeId: NodeId
  }).annotate({ identifier: "DOM.FocusParams" })
) as any as Schema.Codec<FocusParams>

/**
 * Returns a dictionary of accessibility properties for the node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAccessibilityPropertiesForNodeParams {
  /**
   * Id of the node for which to get accessibility properties.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetAccessibilityPropertiesForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAccessibilityPropertiesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetAccessibilityPropertiesForNodeParams" })
) as any as Schema.Codec<GetAccessibilityPropertiesForNodeParams>

/**
 * Returns a dictionary of accessibility properties for the node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAccessibilityPropertiesForNodeResult {
  /**
   * Dictionary of relevant accessibility properties.
   */
  readonly properties: AccessibilityProperties
}

/**
 * Schema for `GetAccessibilityPropertiesForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAccessibilityPropertiesForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    properties: AccessibilityProperties
  }).annotate({ identifier: "DOM.GetAccessibilityPropertiesForNodeResult" })
) as any as Schema.Codec<GetAccessibilityPropertiesForNodeResult>

/**
 * Returns all data that has been associated with the node and is available for data binding. Only in builds compiled with `defined(ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS) && ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAssociatedDataForNodeParams {
  /**
   * Id of the node to get associated data for.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetAssociatedDataForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAssociatedDataForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetAssociatedDataForNodeParams" })
) as any as Schema.Codec<GetAssociatedDataForNodeParams>

/**
 * Returns all data that has been associated with the node and is available for data binding. Only in builds compiled with `defined(ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS) && ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAssociatedDataForNodeResult {
  /**
   * Associated data bound to this node. Sent as a JSON string.
   */
  readonly associatedData?: string | undefined
}

/**
 * Schema for `GetAssociatedDataForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAssociatedDataForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    associatedData: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOM.GetAssociatedDataForNodeResult" })
) as any as Schema.Codec<GetAssociatedDataForNodeResult>

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
 * Returns quads that describe node position on the page. This method
 * might return multiple quads for inline nodes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetContentQuadsParams {
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId: Runtime.RemoteObjectId
}

/**
 * Schema for `GetContentQuadsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetContentQuadsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId
  }).annotate({ identifier: "DOM.GetContentQuadsParams" })
) as any as Schema.Codec<GetContentQuadsParams>

/**
 * Returns quads that describe node position on the page. This method
 * might return multiple quads for inline nodes.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetContentQuadsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    quads: Schema.Array(Quad)
  }).annotate({ identifier: "DOM.GetContentQuadsResult" })
) as any as Schema.Codec<GetContentQuadsResult>

/**
 * Returns all data binding relationships between data that is associated with the node and the node itself. Only in builds compiled with `defined(ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS) && ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDataBindingsForNodeParams {
  /**
   * Id of the node to get data bindings for.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetDataBindingsForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDataBindingsForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetDataBindingsForNodeParams" })
) as any as Schema.Codec<GetDataBindingsForNodeParams>

/**
 * Returns all data binding relationships between data that is associated with the node and the node itself. Only in builds compiled with `defined(ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS) && ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDataBindingsForNodeResult {
  /**
   * Array of binding relationships between data and node
   */
  readonly dataBindings: ReadonlyArray<DataBinding>
}

/**
 * Schema for `GetDataBindingsForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDataBindingsForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataBindings: Schema.Array(DataBinding)
  }).annotate({ identifier: "DOM.GetDataBindingsForNodeResult" })
) as any as Schema.Codec<GetDataBindingsForNodeResult>

/**
 * Returns the root DOM node to the caller.
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
) as any as Schema.Codec<GetDocumentResult>

/**
 * Returns event listeners relevant to the node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetEventListenersForNodeParams {
  /**
   * Id of the node to get listeners for.
   */
  readonly nodeId: NodeId
  /**
   * Controls whether ancestor event listeners are included. Defaults to true.
   */
  readonly includeAncestors?: boolean | undefined
}

/**
 * Schema for `GetEventListenersForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetEventListenersForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    includeAncestors: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.GetEventListenersForNodeParams" })
) as any as Schema.Codec<GetEventListenersForNodeParams>

/**
 * Returns event listeners relevant to the node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetEventListenersForNodeResult {
  /**
   * Array of relevant listeners.
   */
  readonly listeners: ReadonlyArray<EventListener>
}

/**
 * Schema for `GetEventListenersForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetEventListenersForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    listeners: Schema.Array(EventListener)
  }).annotate({ identifier: "DOM.GetEventListenersForNodeResult" })
) as any as Schema.Codec<GetEventListenersForNodeResult>

/**
 * Returns media stats for the selected node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetMediaStatsParams {
  /**
   * Id of the node to retrieve mediastats for.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `GetMediaStatsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetMediaStatsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.GetMediaStatsParams" })
) as any as Schema.Codec<GetMediaStatsParams>

/**
 * Returns media stats for the selected node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetMediaStatsResult {
  /**
   * An interleaved array of node attribute names and values.
   */
  readonly mediaStats: MediaStats
}

/**
 * Schema for `GetMediaStatsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetMediaStatsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mediaStats: MediaStats
  }).annotate({ identifier: "DOM.GetMediaStatsResult" })
) as any as Schema.Codec<GetMediaStatsResult>

/**
 * Returns node's HTML markup.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetOuterHTMLParams {
  /**
   * Id of the node to get markup for.
   */
  readonly nodeId: NodeId
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
    nodeId: NodeId
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
 * Returns search results from given <code>fromIndex</code> to given <code>toIndex</code> from the sarch with the given identifier.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Returns search results from given <code>fromIndex</code> to given <code>toIndex</code> from the sarch with the given identifier.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSearchResultsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.GetSearchResultsResult" })
) as any as Schema.Codec<GetSearchResultsResult>

/**
 * Gets the list of builtin DOM event names.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetSupportedEventNamesResult {
  readonly eventNames: ReadonlyArray<string>
}

/**
 * Schema for `GetSupportedEventNamesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSupportedEventNamesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventNames: Schema.Array(Schema.String)
  }).annotate({ identifier: "DOM.GetSupportedEventNamesResult" })
) as any as Schema.Codec<GetSupportedEventNamesResult>

/**
 * Hides a flex overlay for a node that begins a 'flex' layout context. The command has no effect if <code>nodeId</code> is specified and invalid, or if there is not currently an overlay set for the <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HideFlexOverlayParams {
  /**
   * The node for which a flex overlay should be hidden. If a <code>nodeId</code> is not specified, all flex overlays will be hidden.
   */
  readonly nodeId?: NodeId | undefined
}

/**
 * Schema for `HideFlexOverlayParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HideFlexOverlayParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.HideFlexOverlayParams" })
) as any as Schema.Codec<HideFlexOverlayParams>

/**
 * Hides a grid overlay for a node that begins a 'grid' layout context. The command has no effect if <code>nodeId</code> is specified and invalid, or if there is not currently an overlay set for the <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HideGridOverlayParams {
  /**
   * The node for which a grid overlay should be hidden. If a <code>nodeId</code> is not specified, all grid overlays will be hidden.
   */
  readonly nodeId?: NodeId | undefined
}

/**
 * Schema for `HideGridOverlayParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HideGridOverlayParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.HideGridOverlayParams" })
) as any as Schema.Codec<HideGridOverlayParams>

/**
 * Highlights owner element of the frame with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HighlightFrameParams {
  /**
   * Identifier of the frame to highlight.
   */
  readonly frameId: Network.FrameId
  /**
   * The content box highlight fill color (default: transparent).
   */
  readonly contentColor?: RGBAColor | undefined
  /**
   * The content box highlight outline color (default: transparent).
   */
  readonly contentOutlineColor?: RGBAColor | undefined
}

/**
 * Schema for `HighlightFrameParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightFrameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId,
    contentColor: Schema.optional(RGBAColor),
    contentOutlineColor: Schema.optional(RGBAColor)
  }).annotate({ identifier: "DOM.HighlightFrameParams" })
) as any as Schema.Codec<HighlightFrameParams>

/**
 * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or objectId must be specified. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HighlightNodeParams {
  /**
   * Identifier of the node to highlight.
   */
  readonly nodeId?: NodeId | undefined
  /**
   * JavaScript object id of the node to be highlighted.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * A descriptor for the highlight appearance.
   */
  readonly highlightConfig: HighlightConfig
  /**
   * If provided, used to configure a grid overlay shown during element selection. This overrides DOM.showGridOverlay.
   */
  readonly gridOverlayConfig?: GridOverlayConfig | undefined
  /**
   * If provided, used to configure a flex overlay shown during element selection. This overrides DOM.showFlexOverlay.
   */
  readonly flexOverlayConfig?: FlexOverlayConfig | undefined
  /**
   * Whether the rulers should be shown during element selection. This overrides Page.setShowRulers.
   */
  readonly showRulers?: boolean | undefined
}

/**
 * Schema for `HighlightNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(NodeId),
    objectId: Schema.optional(Runtime.RemoteObjectId),
    highlightConfig: HighlightConfig,
    gridOverlayConfig: Schema.optional(GridOverlayConfig),
    flexOverlayConfig: Schema.optional(FlexOverlayConfig),
    showRulers: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.HighlightNodeParams" })
) as any as Schema.Codec<HighlightNodeParams>

/**
 * Highlights each DOM node in the given list. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HighlightNodeListParams {
  readonly nodeIds: ReadonlyArray<NodeId>
  readonly highlightConfig: HighlightConfig
  /**
   * If provided, used to configure a grid overlay shown during element selection. This overrides DOM.showGridOverlay.
   */
  readonly gridOverlayConfig?: GridOverlayConfig | undefined
  /**
   * If provided, used to configure a flex overlay shown during element selection. This overrides DOM.showFlexOverlay.
   */
  readonly flexOverlayConfig?: FlexOverlayConfig | undefined
  /**
   * Whether the rulers should be shown during element selection. This overrides Page.setShowRulers.
   */
  readonly showRulers?: boolean | undefined
}

/**
 * Schema for `HighlightNodeListParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightNodeListParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId),
    highlightConfig: HighlightConfig,
    gridOverlayConfig: Schema.optional(GridOverlayConfig),
    flexOverlayConfig: Schema.optional(FlexOverlayConfig),
    showRulers: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.HighlightNodeListParams" })
) as any as Schema.Codec<HighlightNodeListParams>

/**
 * Highlights given quad. Coordinates are absolute with respect to the main frame viewport.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HighlightQuadParams {
  /**
   * Quad to highlight
   */
  readonly quad: Quad
  /**
   * The highlight fill color (default: transparent).
   */
  readonly color?: RGBAColor | undefined
  /**
   * The highlight outline color (default: transparent).
   */
  readonly outlineColor?: RGBAColor | undefined
  /**
   * Indicates whether the provided parameters are in page coordinates or in viewport coordinates (the default).
   */
  readonly usePageCoordinates?: boolean | undefined
}

/**
 * Schema for `HighlightQuadParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightQuadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    quad: Quad,
    color: Schema.optional(RGBAColor),
    outlineColor: Schema.optional(RGBAColor),
    usePageCoordinates: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.HighlightQuadParams" })
) as any as Schema.Codec<HighlightQuadParams>

/**
 * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
 *
 * @stability unstable
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
  readonly color?: RGBAColor | undefined
  /**
   * The highlight outline color (default: transparent).
   */
  readonly outlineColor?: RGBAColor | undefined
  /**
   * Indicates whether the provided parameters are in page coordinates or in viewport coordinates (the default).
   */
  readonly usePageCoordinates?: boolean | undefined
}

/**
 * Schema for `HighlightRectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightRectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int,
    height: Schema.Int,
    color: Schema.optional(RGBAColor),
    outlineColor: Schema.optional(RGBAColor),
    usePageCoordinates: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.HighlightRectParams" })
) as any as Schema.Codec<HighlightRectParams>

/**
 * Highlights all DOM nodes that match a given selector. A string containing a CSS selector must be specified. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HighlightSelectorParams {
  /**
   * A CSS selector for finding matching nodes to highlight.
   */
  readonly selectorString: string
  /**
   * Identifier of the frame which will be searched using the selector.  If not provided, the main frame will be used.
   */
  readonly frameId?: string | undefined
  /**
   * A descriptor for the highlight appearance.
   */
  readonly highlightConfig: HighlightConfig
  /**
   * If provided, used to configure a grid overlay shown during element selection. This overrides DOM.showGridOverlay.
   */
  readonly gridOverlayConfig?: GridOverlayConfig | undefined
  /**
   * If provided, used to configure a flex overlay shown during element selection. This overrides DOM.showFlexOverlay.
   */
  readonly flexOverlayConfig?: FlexOverlayConfig | undefined
  /**
   * Whether the rulers should be shown during element selection. This overrides Page.setShowRulers.
   */
  readonly showRulers?: boolean | undefined
}

/**
 * Schema for `HighlightSelectorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HighlightSelectorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    selectorString: Schema.String,
    frameId: Schema.optional(Schema.String),
    highlightConfig: HighlightConfig,
    gridOverlayConfig: Schema.optional(GridOverlayConfig),
    flexOverlayConfig: Schema.optional(FlexOverlayConfig),
    showRulers: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.HighlightSelectorParams" })
) as any as Schema.Codec<HighlightSelectorParams>

/**
 * Fired when <code>Element</code>'s inline style is modified via a CSS property modification.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InlineStyleInvalidatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.InlineStyleInvalidatedParams" })
) as any as Schema.Codec<InlineStyleInvalidatedParams>

/**
 * `insertAdjacentHTML.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InsertAdjacentHTMLParams {
  readonly nodeId: NodeId
  readonly position: string
  readonly html: string
}

/**
 * Schema for `InsertAdjacentHTMLParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InsertAdjacentHTMLParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    position: Schema.String,
    html: Schema.String
  }).annotate({ identifier: "DOM.InsertAdjacentHTMLParams" })
) as any as Schema.Codec<InsertAdjacentHTMLParams>

/**
 * Inspect a particular node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InspectParams {
  /**
   * Equivalent of Inspector.inspect but with a nodeId instead of a RemoteObject. Useful for augmented contexts.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `InspectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InspectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.InspectParams" })
) as any as Schema.Codec<InspectParams>

/**
 * Moves node into the new container, places it before the given anchor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MoveToParams {
  /**
   * Id of the node to drop.
   */
  readonly nodeId: NodeId
  /**
   * Id of the element to drop into.
   */
  readonly targetNodeId: NodeId
  /**
   * Drop node before given one.
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
 * Searches for a given string in the DOM tree. Use <code>getSearchResults</code> to access search results or <code>cancelSearch</code> to end this search session.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformSearchParams {
  /**
   * Plain text or query selector or XPath search query.
   */
  readonly query: string
  /**
   * Ids of nodes to use as starting points for the search.
   */
  readonly nodeIds?: ReadonlyArray<NodeId> | undefined
  /**
   * If true, search is case sensitive.
   */
  readonly caseSensitive?: boolean | undefined
}

/**
 * Schema for `PerformSearchParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformSearchParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    query: Schema.String,
    nodeIds: Schema.optional(Schema.Array(NodeId)),
    caseSensitive: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.PerformSearchParams" })
) as any as Schema.Codec<PerformSearchParams>

/**
 * Searches for a given string in the DOM tree. Use <code>getSearchResults</code> to access search results or <code>cancelSearch</code> to end this search session.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Called when an element enters/exits a power efficient playback state. Only in builds compiled with `defined(ENABLE_VIDEO) && ENABLE_VIDEO`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PowerEfficientPlaybackStateChangedParams {
  readonly nodeId: NodeId
  readonly timestamp: Network.Timestamp
  readonly isPowerEfficient: boolean
}

/**
 * Schema for `PowerEfficientPlaybackStateChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PowerEfficientPlaybackStateChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    timestamp: Network.Timestamp,
    isPowerEfficient: Schema.Boolean
  }).annotate({ identifier: "DOM.PowerEfficientPlaybackStateChangedParams" })
) as any as Schema.Codec<PowerEfficientPlaybackStateChangedParams>

/**
 * Called when a pseudo element is added to an element.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PseudoElementAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentId: NodeId,
    pseudoElement: Node
  }).annotate({ identifier: "DOM.PseudoElementAddedParams" })
) as any as Schema.Codec<PseudoElementAddedParams>

/**
 * Called when a pseudo element is removed from an element.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Requests that the node is sent to the caller given its path.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PushNodeByPathToFrontendParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    path: Schema.String
  }).annotate({ identifier: "DOM.PushNodeByPathToFrontendParams" })
) as any as Schema.Codec<PushNodeByPathToFrontendParams>

/**
 * Requests that the node is sent to the caller given its path.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PushNodeByPathToFrontendResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.PushNodeByPathToFrontendResult" })
) as any as Schema.Codec<PushNodeByPathToFrontendResult>

/**
 * Executes <code>querySelector</code> on a given node.
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
 * Executes <code>querySelector</code> on a given node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QuerySelectorResult {
  /**
   * Query selector result.
   */
  readonly nodeId?: NodeId | undefined
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
    nodeId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.QuerySelectorResult" })
) as any as Schema.Codec<QuerySelectorResult>

/**
 * Executes <code>querySelectorAll</code> on a given node.
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
 * Executes <code>querySelectorAll</code> on a given node.
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
 * Remove any breakpoints on the given event listener.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveBreakpointForEventListenerParams {
  readonly eventListenerId: EventListenerId
}

/**
 * Schema for `RemoveBreakpointForEventListenerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveBreakpointForEventListenerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventListenerId: EventListenerId
  }).annotate({ identifier: "DOM.RemoveBreakpointForEventListenerParams" })
) as any as Schema.Codec<RemoveBreakpointForEventListenerParams>

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
 * Requests the list of assigned nodes for the <code>HTMLSlotElement</code> with the given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestAssignedNodesParams {
  readonly slotElementId: NodeId
}

/**
 * Schema for `RequestAssignedNodesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestAssignedNodesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    slotElementId: NodeId
  }).annotate({ identifier: "DOM.RequestAssignedNodesParams" })
) as any as Schema.Codec<RequestAssignedNodesParams>

/**
 * Requests the list of assigned nodes for the <code>HTMLSlotElement</code> with the given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestAssignedNodesResult {
  readonly assignedNodeIds: ReadonlyArray<NodeId>
}

/**
 * Schema for `RequestAssignedNodesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestAssignedNodesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    assignedNodeIds: Schema.Array(NodeId)
  }).annotate({ identifier: "DOM.RequestAssignedNodesResult" })
) as any as Schema.Codec<RequestAssignedNodesResult>

/**
 * Requests the <code>HTMLSlotElement</code> that the node with the given id is assigned to.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestAssignedSlotParams {
  readonly nodeId: NodeId
}

/**
 * Schema for `RequestAssignedSlotParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestAssignedSlotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.RequestAssignedSlotParams" })
) as any as Schema.Codec<RequestAssignedSlotParams>

/**
 * Requests the <code>HTMLSlotElement</code> that the node with the given id is assigned to.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestAssignedSlotResult {
  /**
   * Not provided if the given node is not assigned to a <code>HTMLSlotElement</code>.
   */
  readonly slotElementId?: NodeId | undefined
}

/**
 * Schema for `RequestAssignedSlotResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestAssignedSlotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    slotElementId: Schema.optional(NodeId)
  }).annotate({ identifier: "DOM.RequestAssignedSlotResult" })
) as any as Schema.Codec<RequestAssignedSlotResult>

/**
 * Requests that children of the node with given id are returned to the caller in form of <code>setChildNodes</code> events where not only immediate children are retrieved, but all children down to the specified depth.
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
   * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the entire subtree or provide an integer larger than 0.
   */
  readonly depth?: number | undefined
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
    depth: Schema.optional(Schema.Int)
  }).annotate({ identifier: "DOM.RequestChildNodesParams" })
) as any as Schema.Codec<RequestChildNodesParams>

/**
 * Requests that the node is sent to the caller given the JavaScript node object reference. All nodes that form the path from the node to the root are also sent to the client as a series of <code>setChildNodes</code> notifications.
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
 * Requests that the node is sent to the caller given the JavaScript node object reference. All nodes that form the path from the node to the root are also sent to the client as a series of <code>setChildNodes</code> notifications.
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
 * Resolves JavaScript node object for given node id.
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
   * Source element handle.
   */
  readonly objectId?: Runtime.RemoteObjectId | undefined
  /**
   * Id of the frame to resolve the owner element.
   */
  readonly frameId?: Network.FrameId | undefined
  /**
   * Specifies in which execution context to adopt to.
   */
  readonly executionContextId?: Runtime.ExecutionContextId | undefined
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
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
    objectId: Schema.optional(Runtime.RemoteObjectId),
    frameId: Schema.optional(Network.FrameId),
    executionContextId: Schema.optional(Runtime.ExecutionContextId),
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOM.ResolveNodeParams" })
) as any as Schema.Codec<ResolveNodeParams>

/**
 * Resolves JavaScript node object for given node id.
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
 * Scrolls the given rect into view if not already in the viewport.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScrollIntoViewIfNeededParams {
  /**
   * JavaScript object id of the node wrapper.
   */
  readonly objectId: Runtime.RemoteObjectId
  /**
   * Rect relative to the node's border box, in CSS pixels.
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
    objectId: Runtime.RemoteObjectId,
    rect: Schema.optional(Rect)
  }).annotate({ identifier: "DOM.ScrollIntoViewIfNeededParams" })
) as any as Schema.Codec<ScrollIntoViewIfNeededParams>

/**
 * Controls whether any DOM commands work for nodes inside a UserAgent shadow tree.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAllowEditingUserAgentShadowTreesParams {
  readonly allow: boolean
}

/**
 * Schema for `SetAllowEditingUserAgentShadowTreesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAllowEditingUserAgentShadowTreesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    allow: Schema.Boolean
  }).annotate({ identifier: "DOM.SetAllowEditingUserAgentShadowTreesParams" })
) as any as Schema.Codec<SetAllowEditingUserAgentShadowTreesParams>

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
 * Sets attributes on element with given id. This method is useful when user edits some existing attribute value and types in several attribute name/value pairs.
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
   * Attribute name to replace with new attributes derived from text in case text parsed successfully.
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
 * Set a breakpoint on the given event listener.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBreakpointForEventListenerParams {
  readonly eventListenerId: EventListenerId
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: Debugger.BreakpointOptions | undefined
}

/**
 * Schema for `SetBreakpointForEventListenerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakpointForEventListenerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventListenerId: EventListenerId,
    options: Schema.optional(Debugger.BreakpointOptions)
  }).annotate({ identifier: "DOM.SetBreakpointForEventListenerParams" })
) as any as Schema.Codec<SetBreakpointForEventListenerParams>

/**
 * Fired when backend wants to provide client with the missing DOM structure. This happens upon most of the calls requesting node ids.
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
) as any as Schema.Codec<SetChildNodesParams>

/**
 * Enable/disable the given event listener. A disabled event listener will not fire.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEventListenerDisabledParams {
  readonly eventListenerId: EventListenerId
  readonly disabled: boolean
}

/**
 * Schema for `SetEventListenerDisabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEventListenerDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventListenerId: EventListenerId,
    disabled: Schema.Boolean
  }).annotate({ identifier: "DOM.SetEventListenerDisabledParams" })
) as any as Schema.Codec<SetEventListenerDisabledParams>

/**
 * Sets input files for given <input type=file>
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInputFilesParams {
  /**
   * Input element handle.
   */
  readonly objectId: Runtime.RemoteObjectId
  /**
   * File paths to set
   */
  readonly paths: ReadonlyArray<string>
}

/**
 * Schema for `SetInputFilesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInputFilesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId,
    paths: Schema.Array(Schema.String)
  }).annotate({ identifier: "DOM.SetInputFilesParams" })
) as any as Schema.Codec<SetInputFilesParams>

/**
 * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted. Backend then generates 'inspect' command upon element selection. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInspectModeEnabledParams {
  /**
   * True to enable inspection mode, false to disable it.
   */
  readonly enabled: boolean
  /**
   * A descriptor for the highlight appearance of hovered-over nodes. May be omitted if <code>enabled == false</code>.
   */
  readonly highlightConfig?: HighlightConfig | undefined
  /**
   * If provided, used to configure a grid overlay shown during element selection. This overrides DOM.showGridOverlay.
   */
  readonly gridOverlayConfig?: GridOverlayConfig | undefined
  /**
   * If provided, used to configure a flex overlay shown during element selection. This overrides DOM.showFlexOverlay.
   */
  readonly flexOverlayConfig?: FlexOverlayConfig | undefined
  /**
   * Whether the rulers should be shown during element selection. This overrides Page.setShowRulers.
   */
  readonly showRulers?: boolean | undefined
}

/**
 * Schema for `SetInspectModeEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInspectModeEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    highlightConfig: Schema.optional(HighlightConfig),
    gridOverlayConfig: Schema.optional(GridOverlayConfig),
    flexOverlayConfig: Schema.optional(FlexOverlayConfig),
    showRulers: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOM.SetInspectModeEnabledParams" })
) as any as Schema.Codec<SetInspectModeEnabledParams>

/**
 * Enables console to refer to the node with given id via $0 (see Command Line API for more details).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInspectedNodeParams {
  /**
   * DOM node id to be accessible by means of $0 command line API.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `SetInspectedNodeParams`.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShadowRootPushedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hostId: NodeId,
    root: Node
  }).annotate({ identifier: "DOM.ShadowRootPushedParams" })
) as any as Schema.Codec<ShadowRootPushedParams>

/**
 * Shows a flex overlay for a node that begins a 'flex' layout context. The command has no effect if <code>nodeId</code> is invalid or the associated node does not begin a 'flex' layout context. A node can only have one flex overlay at a time; subsequent calls with the same <code>nodeId</code> will override earlier calls.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ShowFlexOverlayParams {
  /**
   * The node for which a flex overlay should be shown.
   */
  readonly nodeId: NodeId
  /**
   * Configuration options for the flex overlay.
   */
  readonly flexOverlayConfig: FlexOverlayConfig
}

/**
 * Schema for `ShowFlexOverlayParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShowFlexOverlayParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    flexOverlayConfig: FlexOverlayConfig
  }).annotate({ identifier: "DOM.ShowFlexOverlayParams" })
) as any as Schema.Codec<ShowFlexOverlayParams>

/**
 * Shows a grid overlay for a node that begins a 'grid' layout context. The command has no effect if <code>nodeId</code> is invalid or the associated node does not begin a 'grid' layout context. A node can only have one grid overlay at a time; subsequent calls with the same <code>nodeId</code> will override earlier calls.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ShowGridOverlayParams {
  /**
   * The node for which a grid overlay should be shown.
   */
  readonly nodeId: NodeId
  /**
   * Configuration options for the grid overlay.
   */
  readonly gridOverlayConfig: GridOverlayConfig
}

/**
 * Schema for `ShowGridOverlayParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShowGridOverlayParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId,
    gridOverlayConfig: GridOverlayConfig
  }).annotate({ identifier: "DOM.ShowGridOverlayParams" })
) as any as Schema.Codec<ShowGridOverlayParams>

/**
 * Fired when a detached DOM node is about to be destroyed. Currently, this event will only be fired when a DOM node that is detached is about to be destructed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WillDestroyDOMNodeParams {
  /**
   * Id of the node that will be destroyed.
   */
  readonly nodeId: NodeId
}

/**
 * Schema for `WillDestroyDOMNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WillDestroyDOMNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.WillDestroyDOMNodeParams" })
) as any as Schema.Codec<WillDestroyDOMNodeParams>

/**
 * Called after a request has been made to remove an event listener from a node.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WillRemoveEventListenerParams {
  readonly nodeId: NodeId
}

/**
 * Schema for `WillRemoveEventListenerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WillRemoveEventListenerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: NodeId
  }).annotate({ identifier: "DOM.WillRemoveEventListenerParams" })
) as any as Schema.Codec<WillRemoveEventListenerParams>

/**
 * Returns node description.
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
 * Discards search results from the session with the given id. <code>getSearchResults</code> should no longer be called for that search.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const discardSearchResults: Protocol.CommandDef<"DOM.discardSearchResults", DiscardSearchResultsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.discardSearchResults",
    DiscardSearchResultsParams,
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
 * Returns a dictionary of accessibility properties for the node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAccessibilityPropertiesForNode: Protocol.CommandDef<
  "DOM.getAccessibilityPropertiesForNode",
  GetAccessibilityPropertiesForNodeParams,
  GetAccessibilityPropertiesForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getAccessibilityPropertiesForNode",
  GetAccessibilityPropertiesForNodeParams,
  GetAccessibilityPropertiesForNodeResult,
  { status: "stable" }
)

/**
 * Returns all data that has been associated with the node and is available for data binding. Only in builds compiled with `defined(ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS) && ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAssociatedDataForNode: Protocol.CommandDef<
  "DOM.getAssociatedDataForNode",
  GetAssociatedDataForNodeParams,
  GetAssociatedDataForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getAssociatedDataForNode",
  GetAssociatedDataForNodeParams,
  GetAssociatedDataForNodeResult,
  { status: "stable" }
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
 * Returns quads that describe node position on the page. This method
 * might return multiple quads for inline nodes.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getContentQuads: Protocol.CommandDef<"DOM.getContentQuads", GetContentQuadsParams, GetContentQuadsResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getContentQuads",
    GetContentQuadsParams,
    GetContentQuadsResult,
    { status: "stable" }
  )

/**
 * Returns all data binding relationships between data that is associated with the node and the node itself. Only in builds compiled with `defined(ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS) && ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getDataBindingsForNode: Protocol.CommandDef<
  "DOM.getDataBindingsForNode",
  GetDataBindingsForNodeParams,
  GetDataBindingsForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getDataBindingsForNode",
  GetDataBindingsForNodeParams,
  GetDataBindingsForNodeResult,
  { status: "stable" }
)

/**
 * Returns the root DOM node to the caller.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getDocument: Protocol.CommandDef<"DOM.getDocument", void, GetDocumentResult> = /*#__PURE__*/ Protocol
  .command(
    "DOM.getDocument",
    undefined,
    GetDocumentResult,
    { status: "stable" }
  )

/**
 * Returns event listeners relevant to the node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getEventListenersForNode: Protocol.CommandDef<
  "DOM.getEventListenersForNode",
  GetEventListenersForNodeParams,
  GetEventListenersForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getEventListenersForNode",
  GetEventListenersForNodeParams,
  GetEventListenersForNodeResult,
  { status: "stable" }
)

/**
 * Returns media stats for the selected node.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getMediaStats: Protocol.CommandDef<"DOM.getMediaStats", GetMediaStatsParams, GetMediaStatsResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.getMediaStats",
    GetMediaStatsParams,
    GetMediaStatsResult,
    { status: "stable" }
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
 * Returns search results from given <code>fromIndex</code> to given <code>toIndex</code> from the sarch with the given identifier.
 *
 * @stability unstable
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
  { status: "stable" }
)

/**
 * Gets the list of builtin DOM event names.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getSupportedEventNames: Protocol.CommandDef<
  "DOM.getSupportedEventNames",
  void,
  GetSupportedEventNamesResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.getSupportedEventNames",
  undefined,
  GetSupportedEventNamesResult,
  { status: "stable" }
)

/**
 * Hides a flex overlay for a node that begins a 'flex' layout context. The command has no effect if <code>nodeId</code> is specified and invalid, or if there is not currently an overlay set for the <code>nodeId</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const hideFlexOverlay: Protocol.CommandDef<"DOM.hideFlexOverlay", HideFlexOverlayParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.hideFlexOverlay",
    HideFlexOverlayParams,
    undefined,
    { status: "stable" }
  )

/**
 * Hides a grid overlay for a node that begins a 'grid' layout context. The command has no effect if <code>nodeId</code> is specified and invalid, or if there is not currently an overlay set for the <code>nodeId</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const hideGridOverlay: Protocol.CommandDef<"DOM.hideGridOverlay", HideGridOverlayParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.hideGridOverlay",
    HideGridOverlayParams,
    undefined,
    { status: "stable" }
  )

/**
 * Hides DOM node highlight.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const hideHighlight: Protocol.CommandDef<"DOM.hideHighlight", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.hideHighlight",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Highlights owner element of the frame with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightFrame: Protocol.CommandDef<"DOM.highlightFrame", HighlightFrameParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.highlightFrame",
    HighlightFrameParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or objectId must be specified. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightNode: Protocol.CommandDef<"DOM.highlightNode", HighlightNodeParams, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.highlightNode",
    HighlightNodeParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights each DOM node in the given list. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightNodeList: Protocol.CommandDef<"DOM.highlightNodeList", HighlightNodeListParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.highlightNodeList",
    HighlightNodeListParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights given quad. Coordinates are absolute with respect to the main frame viewport.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightQuad: Protocol.CommandDef<"DOM.highlightQuad", HighlightQuadParams, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.highlightQuad",
    HighlightQuadParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightRect: Protocol.CommandDef<"DOM.highlightRect", HighlightRectParams, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.highlightRect",
    HighlightRectParams,
    undefined,
    { status: "stable" }
  )

/**
 * Highlights all DOM nodes that match a given selector. A string containing a CSS selector must be specified. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const highlightSelector: Protocol.CommandDef<"DOM.highlightSelector", HighlightSelectorParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.highlightSelector",
    HighlightSelectorParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `DOM.insertAdjacentHTML`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const insertAdjacentHTML: Protocol.CommandDef<"DOM.insertAdjacentHTML", InsertAdjacentHTMLParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.insertAdjacentHTML",
    InsertAdjacentHTMLParams,
    undefined,
    { status: "stable" }
  )

/**
 * Marks last undoable state.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const markUndoableState: Protocol.CommandDef<"DOM.markUndoableState", void, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.markUndoableState",
    undefined,
    undefined,
    { status: "stable" }
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
 * Searches for a given string in the DOM tree. Use <code>getSearchResults</code> to access search results or <code>cancelSearch</code> to end this search session.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const performSearch: Protocol.CommandDef<"DOM.performSearch", PerformSearchParams, PerformSearchResult> =
  /*#__PURE__*/ Protocol.command(
    "DOM.performSearch",
    PerformSearchParams,
    PerformSearchResult,
    { status: "stable" }
  )

/**
 * Requests that the node is sent to the caller given its path.
 *
 * @stability unstable
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
  { status: "stable" }
)

/**
 * Executes <code>querySelector</code> on a given node.
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
 * Executes <code>querySelectorAll</code> on a given node.
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
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const redo: Protocol.CommandDef<"DOM.redo", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.redo",
  undefined,
  undefined,
  { status: "stable" }
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
 * Remove any breakpoints on the given event listener.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeBreakpointForEventListener: Protocol.CommandDef<
  "DOM.removeBreakpointForEventListener",
  RemoveBreakpointForEventListenerParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.removeBreakpointForEventListener",
  RemoveBreakpointForEventListenerParams,
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
 * Requests the list of assigned nodes for the <code>HTMLSlotElement</code> with the given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestAssignedNodes: Protocol.CommandDef<
  "DOM.requestAssignedNodes",
  RequestAssignedNodesParams,
  RequestAssignedNodesResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.requestAssignedNodes",
  RequestAssignedNodesParams,
  RequestAssignedNodesResult,
  { status: "stable" }
)

/**
 * Requests the <code>HTMLSlotElement</code> that the node with the given id is assigned to.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestAssignedSlot: Protocol.CommandDef<
  "DOM.requestAssignedSlot",
  RequestAssignedSlotParams,
  RequestAssignedSlotResult
> = /*#__PURE__*/ Protocol.command(
  "DOM.requestAssignedSlot",
  RequestAssignedSlotParams,
  RequestAssignedSlotResult,
  { status: "stable" }
)

/**
 * Requests that children of the node with given id are returned to the caller in form of <code>setChildNodes</code> events where not only immediate children are retrieved, but all children down to the specified depth.
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
 * Requests that the node is sent to the caller given the JavaScript node object reference. All nodes that form the path from the node to the root are also sent to the client as a series of <code>setChildNodes</code> notifications.
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
 * Resolves JavaScript node object for given node id.
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
 * Scrolls the given rect into view if not already in the viewport.
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
 * Controls whether any DOM commands work for nodes inside a UserAgent shadow tree.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAllowEditingUserAgentShadowTrees: Protocol.CommandDef<
  "DOM.setAllowEditingUserAgentShadowTrees",
  SetAllowEditingUserAgentShadowTreesParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.setAllowEditingUserAgentShadowTrees",
  SetAllowEditingUserAgentShadowTreesParams,
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
 * Sets attributes on element with given id. This method is useful when user edits some existing attribute value and types in several attribute name/value pairs.
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
 * Set a breakpoint on the given event listener.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBreakpointForEventListener: Protocol.CommandDef<
  "DOM.setBreakpointForEventListener",
  SetBreakpointForEventListenerParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.setBreakpointForEventListener",
  SetBreakpointForEventListenerParams,
  undefined,
  { status: "stable" }
)

/**
 * Enable/disable the given event listener. A disabled event listener will not fire.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEventListenerDisabled: Protocol.CommandDef<
  "DOM.setEventListenerDisabled",
  SetEventListenerDisabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.setEventListenerDisabled",
  SetEventListenerDisabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets input files for given <input type=file>
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInputFiles: Protocol.CommandDef<"DOM.setInputFiles", SetInputFilesParams, void> = /*#__PURE__*/ Protocol
  .command(
    "DOM.setInputFiles",
    SetInputFilesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted. Backend then generates 'inspect' command upon element selection. Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInspectModeEnabled: Protocol.CommandDef<
  "DOM.setInspectModeEnabled",
  SetInspectModeEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOM.setInspectModeEnabled",
  SetInspectModeEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Enables console to refer to the node with given id via $0 (see Command Line API for more details).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInspectedNode: Protocol.CommandDef<"DOM.setInspectedNode", SetInspectedNodeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.setInspectedNode",
    SetInspectedNodeParams,
    undefined,
    { status: "stable" }
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
 * Shows a flex overlay for a node that begins a 'flex' layout context. The command has no effect if <code>nodeId</code> is invalid or the associated node does not begin a 'flex' layout context. A node can only have one flex overlay at a time; subsequent calls with the same <code>nodeId</code> will override earlier calls.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const showFlexOverlay: Protocol.CommandDef<"DOM.showFlexOverlay", ShowFlexOverlayParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.showFlexOverlay",
    ShowFlexOverlayParams,
    undefined,
    { status: "stable" }
  )

/**
 * Shows a grid overlay for a node that begins a 'grid' layout context. The command has no effect if <code>nodeId</code> is invalid or the associated node does not begin a 'grid' layout context. A node can only have one grid overlay at a time; subsequent calls with the same <code>nodeId</code> will override earlier calls.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const showGridOverlay: Protocol.CommandDef<"DOM.showGridOverlay", ShowGridOverlayParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOM.showGridOverlay",
    ShowGridOverlayParams,
    undefined,
    { status: "stable" }
  )

/**
 * Undoes the last performed action.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const undo: Protocol.CommandDef<"DOM.undo", void, void> = /*#__PURE__*/ Protocol.command(
  "DOM.undo",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fired when <code>Element</code>'s attribute is modified.
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
 * Fired when <code>Element</code>'s attribute is removed.
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
 * Mirrors <code>DOMCharacterDataModified</code> event.
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
 * Fired when <code>Container</code>'s child node count has changed.
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
 * Mirrors <code>DOMNodeInserted</code> event.
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
 * Mirrors <code>DOMNodeRemoved</code> event.
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
 * Called when the custom element state is changed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const customElementStateChanged: Protocol.EventDef<
  "DOM.customElementStateChanged",
  CustomElementStateChangedParams
> = /*#__PURE__*/ Protocol.event(
  "DOM.customElementStateChanged",
  CustomElementStateChangedParams,
  { status: "stable" }
)

/**
 * Called when an event listener is added to a node.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const didAddEventListener: Protocol.EventDef<"DOM.didAddEventListener", DidAddEventListenerParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.didAddEventListener",
    DidAddEventListenerParams,
    { status: "stable" }
  )

/**
 * Called when an event is fired on a node.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const didFireEvent: Protocol.EventDef<"DOM.didFireEvent", DidFireEventParams> = /*#__PURE__*/ Protocol.event(
  "DOM.didFireEvent",
  DidFireEventParams,
  { status: "stable" }
)

/**
 * Fired when <code>Document</code> has been totally updated. Node ids are no longer valid.
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
 * Fired when <code>Element</code>'s inline style is modified via a CSS property modification.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const inlineStyleInvalidated: Protocol.EventDef<"DOM.inlineStyleInvalidated", InlineStyleInvalidatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.inlineStyleInvalidated",
    InlineStyleInvalidatedParams,
    { status: "stable" }
  )

/**
 * Inspect a particular node.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const inspect: Protocol.EventDef<"DOM.inspect", InspectParams> = /*#__PURE__*/ Protocol.event(
  "DOM.inspect",
  InspectParams,
  { status: "stable" }
)

/**
 * Called when an element enters/exits a power efficient playback state. Only in builds compiled with `defined(ENABLE_VIDEO) && ENABLE_VIDEO`.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const powerEfficientPlaybackStateChanged: Protocol.EventDef<
  "DOM.powerEfficientPlaybackStateChanged",
  PowerEfficientPlaybackStateChangedParams
> = /*#__PURE__*/ Protocol.event(
  "DOM.powerEfficientPlaybackStateChanged",
  PowerEfficientPlaybackStateChangedParams,
  { status: "stable" }
)

/**
 * Called when a pseudo element is added to an element.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const pseudoElementAdded: Protocol.EventDef<"DOM.pseudoElementAdded", PseudoElementAddedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.pseudoElementAdded",
    PseudoElementAddedParams,
    { status: "stable" }
  )

/**
 * Called when a pseudo element is removed from an element.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const pseudoElementRemoved: Protocol.EventDef<"DOM.pseudoElementRemoved", PseudoElementRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.pseudoElementRemoved",
    PseudoElementRemovedParams,
    { status: "stable" }
  )

/**
 * Fired when backend wants to provide client with the missing DOM structure. This happens upon most of the calls requesting node ids.
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
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const shadowRootPopped: Protocol.EventDef<"DOM.shadowRootPopped", ShadowRootPoppedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.shadowRootPopped",
    ShadowRootPoppedParams,
    { status: "stable" }
  )

/**
 * Called when shadow root is pushed into the element.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const shadowRootPushed: Protocol.EventDef<"DOM.shadowRootPushed", ShadowRootPushedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.shadowRootPushed",
    ShadowRootPushedParams,
    { status: "stable" }
  )

/**
 * Fired when a detached DOM node is about to be destroyed. Currently, this event will only be fired when a DOM node that is detached is about to be destructed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const willDestroyDOMNode: Protocol.EventDef<"DOM.willDestroyDOMNode", WillDestroyDOMNodeParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.willDestroyDOMNode",
    WillDestroyDOMNodeParams,
    { status: "stable" }
  )

/**
 * Called after a request has been made to remove an event listener from a node.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const willRemoveEventListener: Protocol.EventDef<"DOM.willRemoveEventListener", WillRemoveEventListenerParams> =
  /*#__PURE__*/ Protocol.event(
    "DOM.willRemoveEventListener",
    WillRemoveEventListenerParams,
    { status: "stable" }
  )
