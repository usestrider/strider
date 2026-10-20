/**
 * This domain facilitates obtaining document snapshots with DOM, layout, and style information.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as DOMDebugger from "./DOMDebugger.ts"
import * as Page from "./Page.ts"

/**
 * Index of the string in the strings table.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ArrayOfStrings = ReadonlyArray<StringIndex>

/**
 * Schema for `ArrayOfStrings`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ArrayOfStrings = /*#__PURE__*/ Schema.suspend(() => Schema.Array(StringIndex)) as any as Schema.Codec<
  ArrayOfStrings
>

/**
 * A subset of the full ComputedStyle as defined by the request whitelist.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ComputedStyle {
  /**
   * Name/value pairs of computed style properties.
   */
  readonly properties: ReadonlyArray<NameValue>
}

/**
 * Schema for `ComputedStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ComputedStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    properties: Schema.Array(NameValue)
  }).annotate({ identifier: "DOMSnapshot.ComputedStyle" })
) as any as Schema.Codec<ComputedStyle>

/**
 * A Node in the DOM tree.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DOMNode {
  /**
   * `Node`'s nodeType.
   */
  readonly nodeType: number
  /**
   * `Node`'s nodeName.
   */
  readonly nodeName: string
  /**
   * `Node`'s nodeValue.
   */
  readonly nodeValue: string
  /**
   * Only set for textarea elements, contains the text value.
   */
  readonly textValue?: string | undefined
  /**
   * Only set for input elements, contains the input's associated text value.
   */
  readonly inputValue?: string | undefined
  /**
   * Only set for radio and checkbox input elements, indicates if the element has been checked
   */
  readonly inputChecked?: boolean | undefined
  /**
   * Only set for option elements, indicates if the element has been selected
   */
  readonly optionSelected?: boolean | undefined
  /**
   * `Node`'s id, corresponds to DOM.Node.backendNodeId.
   */
  readonly backendNodeId: DOM.BackendNodeId
  /**
   * The indexes of the node's child nodes in the `domNodes` array returned by `getSnapshot`, if
   * any.
   */
  readonly childNodeIndexes?: ReadonlyArray<number> | undefined
  /**
   * Attributes of an `Element` node.
   */
  readonly attributes?: ReadonlyArray<NameValue> | undefined
  /**
   * Indexes of pseudo elements associated with this node in the `domNodes` array returned by
   * `getSnapshot`, if any.
   */
  readonly pseudoElementIndexes?: ReadonlyArray<number> | undefined
  /**
   * The index of the node's related layout tree node in the `layoutTreeNodes` array returned by
   * `getSnapshot`, if any.
   */
  readonly layoutNodeIndex?: number | undefined
  /**
   * Document URL that `Document` or `FrameOwner` node points to.
   */
  readonly documentURL?: string | undefined
  /**
   * Base URL that `Document` or `FrameOwner` node uses for URL completion.
   */
  readonly baseURL?: string | undefined
  /**
   * Only set for documents, contains the document's content language.
   */
  readonly contentLanguage?: string | undefined
  /**
   * Only set for documents, contains the document's character set encoding.
   */
  readonly documentEncoding?: string | undefined
  /**
   * `DocumentType` node's publicId.
   */
  readonly publicId?: string | undefined
  /**
   * `DocumentType` node's systemId.
   */
  readonly systemId?: string | undefined
  /**
   * Frame ID for frame owner elements and also for the document node.
   */
  readonly frameId?: Page.FrameId | undefined
  /**
   * The index of a frame owner element's content document in the `domNodes` array returned by
   * `getSnapshot`, if any.
   */
  readonly contentDocumentIndex?: number | undefined
  /**
   * Type of a pseudo element node.
   */
  readonly pseudoType?: DOM.PseudoType | undefined
  /**
   * Shadow root type.
   */
  readonly shadowRootType?: DOM.ShadowRootType | undefined
  /**
   * Whether this DOM node responds to mouse clicks. This includes nodes that have had click
   * event listeners attached via JavaScript as well as anchor tags that naturally navigate when
   * clicked.
   */
  readonly isClickable?: boolean | undefined
  /**
   * Details of the node's event listeners, if any.
   */
  readonly eventListeners?: ReadonlyArray<DOMDebugger.EventListener> | undefined
  /**
   * The selected url for nodes with a srcset attribute.
   */
  readonly currentSourceURL?: string | undefined
  /**
   * The url of the script (if any) that generates this node.
   */
  readonly originURL?: string | undefined
  /**
   * Scroll offsets, set when this node is a Document.
   */
  readonly scrollOffsetX?: number | undefined
  readonly scrollOffsetY?: number | undefined
}

/**
 * Schema for `DOMNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DOMNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeType: Schema.Int,
    nodeName: Schema.String,
    nodeValue: Schema.String,
    textValue: Schema.optional(Schema.String),
    inputValue: Schema.optional(Schema.String),
    inputChecked: Schema.optional(Schema.Boolean),
    optionSelected: Schema.optional(Schema.Boolean),
    backendNodeId: DOM.BackendNodeId,
    childNodeIndexes: Schema.optional(Schema.Array(Schema.Int)),
    attributes: Schema.optional(Schema.Array(NameValue)),
    pseudoElementIndexes: Schema.optional(Schema.Array(Schema.Int)),
    layoutNodeIndex: Schema.optional(Schema.Int),
    documentURL: Schema.optional(Schema.String),
    baseURL: Schema.optional(Schema.String),
    contentLanguage: Schema.optional(Schema.String),
    documentEncoding: Schema.optional(Schema.String),
    publicId: Schema.optional(Schema.String),
    systemId: Schema.optional(Schema.String),
    frameId: Schema.optional(Page.FrameId),
    contentDocumentIndex: Schema.optional(Schema.Int),
    pseudoType: Schema.optional(DOM.PseudoType),
    shadowRootType: Schema.optional(DOM.ShadowRootType),
    isClickable: Schema.optional(Schema.Boolean),
    eventListeners: Schema.optional(Schema.Array(DOMDebugger.EventListener)),
    currentSourceURL: Schema.optional(Schema.String),
    originURL: Schema.optional(Schema.String),
    scrollOffsetX: Schema.optional(Schema.Number),
    scrollOffsetY: Schema.optional(Schema.Number)
  }).annotate({ identifier: "DOMSnapshot.DOMNode" })
) as any as Schema.Codec<DOMNode>

/**
 * Document snapshot.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DocumentSnapshot {
  /**
   * Document URL that `Document` or `FrameOwner` node points to.
   */
  readonly documentURL: StringIndex
  /**
   * Document title.
   */
  readonly title: StringIndex
  /**
   * Base URL that `Document` or `FrameOwner` node uses for URL completion.
   */
  readonly baseURL: StringIndex
  /**
   * Contains the document's content language.
   */
  readonly contentLanguage: StringIndex
  /**
   * Contains the document's character set encoding.
   */
  readonly encodingName: StringIndex
  /**
   * `DocumentType` node's publicId.
   */
  readonly publicId: StringIndex
  /**
   * `DocumentType` node's systemId.
   */
  readonly systemId: StringIndex
  /**
   * Frame ID for frame owner elements and also for the document node.
   */
  readonly frameId: StringIndex
  /**
   * A table with dom nodes.
   */
  readonly nodes: NodeTreeSnapshot
  /**
   * The nodes in the layout tree.
   */
  readonly layout: LayoutTreeSnapshot
  /**
   * The post-layout inline text nodes.
   */
  readonly textBoxes: TextBoxSnapshot
  /**
   * Horizontal scroll offset.
   */
  readonly scrollOffsetX?: number | undefined
  /**
   * Vertical scroll offset.
   */
  readonly scrollOffsetY?: number | undefined
  /**
   * Document content width.
   */
  readonly contentWidth?: number | undefined
  /**
   * Document content height.
   */
  readonly contentHeight?: number | undefined
}

/**
 * Schema for `DocumentSnapshot`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DocumentSnapshot = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    documentURL: StringIndex,
    title: StringIndex,
    baseURL: StringIndex,
    contentLanguage: StringIndex,
    encodingName: StringIndex,
    publicId: StringIndex,
    systemId: StringIndex,
    frameId: StringIndex,
    nodes: NodeTreeSnapshot,
    layout: LayoutTreeSnapshot,
    textBoxes: TextBoxSnapshot,
    scrollOffsetX: Schema.optional(Schema.Number),
    scrollOffsetY: Schema.optional(Schema.Number),
    contentWidth: Schema.optional(Schema.Number),
    contentHeight: Schema.optional(Schema.Number)
  }).annotate({ identifier: "DOMSnapshot.DocumentSnapshot" })
) as any as Schema.Codec<DocumentSnapshot>

/**
 * Details of post layout rendered text positions. The exact layout should not be regarded as
 * stable and may change between versions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InlineTextBox {
  /**
   * The bounding box in document coordinates. Note that scroll offset of the document is ignored.
   */
  readonly boundingBox: DOM.Rect
  /**
   * The starting index in characters, for this post layout textbox substring. Characters that
   * would be represented as a surrogate pair in UTF-16 have length 2.
   */
  readonly startCharacterIndex: number
  /**
   * The number of characters in this post layout textbox substring. Characters that would be
   * represented as a surrogate pair in UTF-16 have length 2.
   */
  readonly numCharacters: number
}

/**
 * Schema for `InlineTextBox`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InlineTextBox = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    boundingBox: DOM.Rect,
    startCharacterIndex: Schema.Int,
    numCharacters: Schema.Int
  }).annotate({ identifier: "DOMSnapshot.InlineTextBox" })
) as any as Schema.Codec<InlineTextBox>

/**
 * Details of an element in the DOM tree with a LayoutObject.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LayoutTreeNode {
  /**
   * The index of the related DOM node in the `domNodes` array returned by `getSnapshot`.
   */
  readonly domNodeIndex: number
  /**
   * The bounding box in document coordinates. Note that scroll offset of the document is ignored.
   */
  readonly boundingBox: DOM.Rect
  /**
   * Contents of the LayoutText, if any.
   */
  readonly layoutText?: string | undefined
  /**
   * The post-layout inline text nodes, if any.
   */
  readonly inlineTextNodes?: ReadonlyArray<InlineTextBox> | undefined
  /**
   * Index into the `computedStyles` array returned by `getSnapshot`.
   */
  readonly styleIndex?: number | undefined
  /**
   * Global paint order index, which is determined by the stacking order of the nodes. Nodes
   * that are painted together will have the same index. Only provided if includePaintOrder in
   * getSnapshot was true.
   */
  readonly paintOrder?: number | undefined
  /**
   * Set to true to indicate the element begins a new stacking context.
   */
  readonly isStackingContext?: boolean | undefined
}

/**
 * Schema for `LayoutTreeNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayoutTreeNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    domNodeIndex: Schema.Int,
    boundingBox: DOM.Rect,
    layoutText: Schema.optional(Schema.String),
    inlineTextNodes: Schema.optional(Schema.Array(InlineTextBox)),
    styleIndex: Schema.optional(Schema.Int),
    paintOrder: Schema.optional(Schema.Int),
    isStackingContext: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOMSnapshot.LayoutTreeNode" })
) as any as Schema.Codec<LayoutTreeNode>

/**
 * Table of details of an element in the DOM tree with a LayoutObject.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LayoutTreeSnapshot {
  /**
   * Index of the corresponding node in the `NodeTreeSnapshot` array returned by `captureSnapshot`.
   */
  readonly nodeIndex: ReadonlyArray<number>
  /**
   * Array of indexes specifying computed style strings, filtered according to the `computedStyles` parameter passed to `captureSnapshot`.
   */
  readonly styles: ReadonlyArray<ArrayOfStrings>
  /**
   * The absolute position bounding box.
   */
  readonly bounds: ReadonlyArray<Rectangle>
  /**
   * Contents of the LayoutText, if any.
   */
  readonly text: ReadonlyArray<StringIndex>
  /**
   * Stacking context information.
   */
  readonly stackingContexts: RareBooleanData
  /**
   * Global paint order index, which is determined by the stacking order of the nodes. Nodes
   * that are painted together will have the same index. Only provided if includePaintOrder in
   * captureSnapshot was true.
   */
  readonly paintOrders?: ReadonlyArray<number> | undefined
  /**
   * The offset rect of nodes. Only available when includeDOMRects is set to true
   */
  readonly offsetRects?: ReadonlyArray<Rectangle> | undefined
  /**
   * The scroll rect of nodes. Only available when includeDOMRects is set to true
   */
  readonly scrollRects?: ReadonlyArray<Rectangle> | undefined
  /**
   * The client rect of nodes. Only available when includeDOMRects is set to true
   */
  readonly clientRects?: ReadonlyArray<Rectangle> | undefined
  /**
   * The list of background colors that are blended with colors of overlapping elements.
   */
  readonly blendedBackgroundColors?: ReadonlyArray<StringIndex> | undefined
  /**
   * The list of computed text opacities.
   */
  readonly textColorOpacities?: ReadonlyArray<number> | undefined
}

/**
 * Schema for `LayoutTreeSnapshot`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayoutTreeSnapshot = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIndex: Schema.Array(Schema.Int),
    styles: Schema.Array(ArrayOfStrings),
    bounds: Schema.Array(Rectangle),
    text: Schema.Array(StringIndex),
    stackingContexts: RareBooleanData,
    paintOrders: Schema.optional(Schema.Array(Schema.Int)),
    offsetRects: Schema.optional(Schema.Array(Rectangle)),
    scrollRects: Schema.optional(Schema.Array(Rectangle)),
    clientRects: Schema.optional(Schema.Array(Rectangle)),
    blendedBackgroundColors: Schema.optional(Schema.Array(StringIndex)),
    textColorOpacities: Schema.optional(Schema.Array(Schema.Number))
  }).annotate({ identifier: "DOMSnapshot.LayoutTreeSnapshot" })
) as any as Schema.Codec<LayoutTreeSnapshot>

/**
 * A name/value pair.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NameValue {
  /**
   * Attribute/property name.
   */
  readonly name: string
  /**
   * Attribute/property value.
   */
  readonly value: string
}

/**
 * Schema for `NameValue`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NameValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "DOMSnapshot.NameValue" })
) as any as Schema.Codec<NameValue>

/**
 * Table containing nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodeTreeSnapshot {
  /**
   * Parent node index.
   */
  readonly parentIndex?: ReadonlyArray<number> | undefined
  /**
   * `Node`'s nodeType.
   */
  readonly nodeType?: ReadonlyArray<number> | undefined
  /**
   * Type of the shadow root the `Node` is in. String values are equal to the `ShadowRootType` enum.
   */
  readonly shadowRootType?: RareStringData | undefined
  /**
   * `Node`'s nodeName.
   */
  readonly nodeName?: ReadonlyArray<StringIndex> | undefined
  /**
   * `Node`'s nodeValue.
   */
  readonly nodeValue?: ReadonlyArray<StringIndex> | undefined
  /**
   * `Node`'s id, corresponds to DOM.Node.backendNodeId.
   */
  readonly backendNodeId?: ReadonlyArray<DOM.BackendNodeId> | undefined
  /**
   * Attributes of an `Element` node. Flatten name, value pairs.
   */
  readonly attributes?: ReadonlyArray<ArrayOfStrings> | undefined
  /**
   * Only set for textarea elements, contains the text value.
   */
  readonly textValue?: RareStringData | undefined
  /**
   * Only set for input elements, contains the input's associated text value.
   */
  readonly inputValue?: RareStringData | undefined
  /**
   * Only set for radio and checkbox input elements, indicates if the element has been checked
   */
  readonly inputChecked?: RareBooleanData | undefined
  /**
   * Only set for option elements, indicates if the element has been selected
   */
  readonly optionSelected?: RareBooleanData | undefined
  /**
   * The index of the document in the list of the snapshot documents.
   */
  readonly contentDocumentIndex?: RareIntegerData | undefined
  /**
   * Type of a pseudo element node.
   */
  readonly pseudoType?: RareStringData | undefined
  /**
   * Pseudo element identifier for this node. Only present if there is a
   * valid pseudoType.
   */
  readonly pseudoIdentifier?: RareStringData | undefined
  /**
   * Whether this DOM node responds to mouse clicks. This includes nodes that have had click
   * event listeners attached via JavaScript as well as anchor tags that naturally navigate when
   * clicked.
   */
  readonly isClickable?: RareBooleanData | undefined
  /**
   * The selected url for nodes with a srcset attribute.
   */
  readonly currentSourceURL?: RareStringData | undefined
  /**
   * The url of the script (if any) that generates this node.
   */
  readonly originURL?: RareStringData | undefined
}

/**
 * Schema for `NodeTreeSnapshot`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodeTreeSnapshot = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    parentIndex: Schema.optional(Schema.Array(Schema.Int)),
    nodeType: Schema.optional(Schema.Array(Schema.Int)),
    shadowRootType: Schema.optional(RareStringData),
    nodeName: Schema.optional(Schema.Array(StringIndex)),
    nodeValue: Schema.optional(Schema.Array(StringIndex)),
    backendNodeId: Schema.optional(Schema.Array(DOM.BackendNodeId)),
    attributes: Schema.optional(Schema.Array(ArrayOfStrings)),
    textValue: Schema.optional(RareStringData),
    inputValue: Schema.optional(RareStringData),
    inputChecked: Schema.optional(RareBooleanData),
    optionSelected: Schema.optional(RareBooleanData),
    contentDocumentIndex: Schema.optional(RareIntegerData),
    pseudoType: Schema.optional(RareStringData),
    pseudoIdentifier: Schema.optional(RareStringData),
    isClickable: Schema.optional(RareBooleanData),
    currentSourceURL: Schema.optional(RareStringData),
    originURL: Schema.optional(RareStringData)
  }).annotate({ identifier: "DOMSnapshot.NodeTreeSnapshot" })
) as any as Schema.Codec<NodeTreeSnapshot>

/**
 * `RareBooleanData`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RareBooleanData {
  readonly index: ReadonlyArray<number>
}

/**
 * Schema for `RareBooleanData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RareBooleanData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    index: Schema.Array(Schema.Int)
  }).annotate({ identifier: "DOMSnapshot.RareBooleanData" })
) as any as Schema.Codec<RareBooleanData>

/**
 * `RareIntegerData`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RareIntegerData {
  readonly index: ReadonlyArray<number>
  readonly value: ReadonlyArray<number>
}

/**
 * Schema for `RareIntegerData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RareIntegerData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    index: Schema.Array(Schema.Int),
    value: Schema.Array(Schema.Int)
  }).annotate({ identifier: "DOMSnapshot.RareIntegerData" })
) as any as Schema.Codec<RareIntegerData>

/**
 * Data that is only present on rare nodes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RareStringData {
  readonly index: ReadonlyArray<number>
  readonly value: ReadonlyArray<StringIndex>
}

/**
 * Schema for `RareStringData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RareStringData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    index: Schema.Array(Schema.Int),
    value: Schema.Array(StringIndex)
  }).annotate({ identifier: "DOMSnapshot.RareStringData" })
) as any as Schema.Codec<RareStringData>

/**
 * `Rectangle`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Rectangle = ReadonlyArray<number>

/**
 * Schema for `Rectangle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Rectangle = /*#__PURE__*/ Schema.suspend(() => Schema.Array(Schema.Number)) as any as Schema.Codec<
  Rectangle
>

/**
 * Index of the string in the strings table.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StringIndex = number

/**
 * Schema for `StringIndex`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StringIndex = Schema.Int as any as Schema.Codec<StringIndex>

/**
 * Table of details of the post layout rendered text positions. The exact layout should not be regarded as
 * stable and may change between versions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TextBoxSnapshot {
  /**
   * Index of the layout tree node that owns this box collection.
   */
  readonly layoutIndex: ReadonlyArray<number>
  /**
   * The absolute position bounding box.
   */
  readonly bounds: ReadonlyArray<Rectangle>
  /**
   * The starting index in characters, for this post layout textbox substring. Characters that
   * would be represented as a surrogate pair in UTF-16 have length 2.
   */
  readonly start: ReadonlyArray<number>
  /**
   * The number of characters in this post layout textbox substring. Characters that would be
   * represented as a surrogate pair in UTF-16 have length 2.
   */
  readonly length: ReadonlyArray<number>
}

/**
 * Schema for `TextBoxSnapshot`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TextBoxSnapshot = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    layoutIndex: Schema.Array(Schema.Int),
    bounds: Schema.Array(Rectangle),
    start: Schema.Array(Schema.Int),
    length: Schema.Array(Schema.Int)
  }).annotate({ identifier: "DOMSnapshot.TextBoxSnapshot" })
) as any as Schema.Codec<TextBoxSnapshot>

/**
 * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
 * template contents, and imported documents) in a flattened array, as well as layout and
 * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
 * flattened.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CaptureSnapshotParams {
  /**
   * Whitelist of computed styles to return.
   */
  readonly computedStyles: ReadonlyArray<string>
  /**
   * Whether to include layout object paint orders into the snapshot.
   */
  readonly includePaintOrder?: boolean | undefined
  /**
   * Whether to include DOM rectangles (offsetRects, clientRects, scrollRects) into the snapshot
   */
  readonly includeDOMRects?: boolean | undefined
  /**
   * Whether to include blended background colors in the snapshot (default: false).
   * Blended background color is achieved by blending background colors of all elements
   * that overlap with the current element.
   */
  readonly includeBlendedBackgroundColors?: boolean | undefined
  /**
   * Whether to include text color opacity in the snapshot (default: false).
   * An element might have the opacity property set that affects the text color of the element.
   * The final text color opacity is computed based on the opacity of all overlapping elements.
   */
  readonly includeTextColorOpacities?: boolean | undefined
}

/**
 * Schema for `CaptureSnapshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CaptureSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    computedStyles: Schema.Array(Schema.String),
    includePaintOrder: Schema.optional(Schema.Boolean),
    includeDOMRects: Schema.optional(Schema.Boolean),
    includeBlendedBackgroundColors: Schema.optional(Schema.Boolean),
    includeTextColorOpacities: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOMSnapshot.CaptureSnapshotParams" })
) as any as Schema.Codec<CaptureSnapshotParams>

/**
 * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
 * template contents, and imported documents) in a flattened array, as well as layout and
 * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
 * flattened.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CaptureSnapshotResult {
  /**
   * The nodes in the DOM tree. The DOMNode at index 0 corresponds to the root document.
   */
  readonly documents: ReadonlyArray<DocumentSnapshot>
  /**
   * Shared string table that all string properties refer to with indexes.
   */
  readonly strings: ReadonlyArray<string>
}

/**
 * Schema for `CaptureSnapshotResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CaptureSnapshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    documents: Schema.Array(DocumentSnapshot),
    strings: Schema.Array(Schema.String)
  }).annotate({ identifier: "DOMSnapshot.CaptureSnapshotResult" })
) as any as Schema.Codec<CaptureSnapshotResult>

/**
 * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
 * template contents, and imported documents) in a flattened array, as well as layout and
 * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
 * flattened.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const captureSnapshot: Protocol.CommandDef<
  "DOMSnapshot.captureSnapshot",
  CaptureSnapshotParams,
  CaptureSnapshotResult
> = /*#__PURE__*/ Protocol.command(
  "DOMSnapshot.captureSnapshot",
  CaptureSnapshotParams,
  CaptureSnapshotResult,
  { status: "stable" }
)

/**
 * Disables DOM snapshot agent for the given page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"DOMSnapshot.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "DOMSnapshot.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables DOM snapshot agent for the given page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"DOMSnapshot.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "DOMSnapshot.enable",
  undefined,
  undefined,
  { status: "stable" }
)
