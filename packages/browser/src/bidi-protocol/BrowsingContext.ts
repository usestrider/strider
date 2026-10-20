/**
 * The browsingContext module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as Script from "./Script.ts"
import * as Session from "./Session.ts"

/**
 * `AccessibilityLocator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AccessibilityLocator {
  readonly type: "accessibility"
  readonly value: AccessibilityLocatorValue
}

/**
 * Schema for `AccessibilityLocator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("accessibility"),
    value: AccessibilityLocatorValue
  }).annotate({ identifier: "browsingContext.AccessibilityLocator" })
) as any as Schema.Codec<AccessibilityLocator>

/**
 * `AccessibilityLocator.value`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AccessibilityLocatorValue {
  readonly name?: string | undefined
  readonly role?: string | undefined
}

/**
 * Schema for `AccessibilityLocatorValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AccessibilityLocatorValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    role: Schema.optional(Schema.String)
  }).annotate({ identifier: "browsingContext.AccessibilityLocatorValue" })
) as any as Schema.Codec<AccessibilityLocatorValue>

/**
 * `ActivateParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ActivateParameters {
  readonly context: BrowsingContext
}

/**
 * Schema for `ActivateParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ActivateParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext
  }).annotate({ identifier: "browsingContext.ActivateParameters" })
) as any as Schema.Codec<ActivateParameters>

/**
 * `ActivateResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ActivateResult = { readonly [key: string]: unknown }

/**
 * Schema for `ActivateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ActivateResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<ActivateResult>

/**
 * `BoxClipRectangle`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BoxClipRectangle {
  readonly type: "box"
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Schema for `BoxClipRectangle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BoxClipRectangle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("box"),
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number
  }).annotate({ identifier: "browsingContext.BoxClipRectangle" })
) as any as Schema.Codec<BoxClipRectangle>

/**
 * `BrowsingContext`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BrowsingContext = Brand.Branded<
  string,
  "~@usestrider/browser/bidi-protocol/BrowsingContext/BrowsingContext"
>

/**
 * Schema for `BrowsingContext`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowsingContext = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/BrowsingContext/BrowsingContext")
) as any as Schema.Codec<BrowsingContext>

/**
 * `CaptureScreenshotParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CaptureScreenshotParameters {
  readonly context: BrowsingContext
  readonly origin?: CaptureScreenshotParametersOrigin | undefined
  readonly format?: ImageFormat | undefined
  readonly clip?: ClipRectangle | undefined
  readonly imageSize?: ImageSize | undefined
}

/**
 * Schema for `CaptureScreenshotParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CaptureScreenshotParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    origin: Schema.optional(CaptureScreenshotParametersOrigin),
    format: Schema.optional(ImageFormat),
    clip: Schema.optional(ClipRectangle),
    imageSize: Schema.optional(ImageSize)
  }).annotate({ identifier: "browsingContext.CaptureScreenshotParameters" })
) as any as Schema.Codec<CaptureScreenshotParameters>

/**
 * `CaptureScreenshotParameters.origin` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CaptureScreenshotParametersOrigin =
  | "viewport"
  | "document"
  | (string & {})

/**
 * Schema for `CaptureScreenshotParametersOrigin`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CaptureScreenshotParametersOrigin = Schema.String as any as Schema.Codec<CaptureScreenshotParametersOrigin>

/**
 * `CaptureScreenshotResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CaptureScreenshotResult {
  readonly data: string
}

/**
 * Schema for `CaptureScreenshotResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CaptureScreenshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String
  }).annotate({ identifier: "browsingContext.CaptureScreenshotResult" })
) as any as Schema.Codec<CaptureScreenshotResult>

/**
 * `ClipRectangle`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ClipRectangle = BoxClipRectangle | ElementClipRectangle

/**
 * Schema for `ClipRectangle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClipRectangle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([BoxClipRectangle, ElementClipRectangle])
) as any as Schema.Codec<ClipRectangle>

/**
 * `CloseParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CloseParameters {
  readonly context: BrowsingContext
  readonly promptUnload?: boolean | undefined
}

/**
 * Schema for `CloseParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    promptUnload: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "browsingContext.CloseParameters" })
) as any as Schema.Codec<CloseParameters>

/**
 * `CloseResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CloseResult = { readonly [key: string]: unknown }

/**
 * Schema for `CloseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<CloseResult>

/**
 * `ContextCreatedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContextCreatedParameters {
  readonly children: InfoList | null
  readonly clientWindow: Browser.ClientWindow
  readonly context: BrowsingContext
  readonly originalOpener: BrowsingContext | null
  readonly url: string
  readonly userContext: Browser.UserContext
  readonly parent?: BrowsingContext | null | undefined
  readonly hasPlannedNavigation?: boolean | undefined
}

/**
 * Schema for `ContextCreatedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextCreatedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    children: Schema.Union([InfoList, Schema.Null]),
    clientWindow: Browser.ClientWindow,
    context: BrowsingContext,
    originalOpener: Schema.Union([BrowsingContext, Schema.Null]),
    url: Schema.String,
    userContext: Browser.UserContext,
    parent: Schema.optional(Schema.Union([BrowsingContext, Schema.Null])),
    hasPlannedNavigation: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "browsingContext.ContextCreatedParameters" })
) as any as Schema.Codec<ContextCreatedParameters>

/**
 * `ContextLocator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContextLocator {
  readonly type: "context"
  readonly value: ContextLocatorValue
}

/**
 * Schema for `ContextLocator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("context"),
    value: ContextLocatorValue
  }).annotate({ identifier: "browsingContext.ContextLocator" })
) as any as Schema.Codec<ContextLocator>

/**
 * `ContextLocator.value`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContextLocatorValue {
  readonly context: BrowsingContext
}

/**
 * Schema for `ContextLocatorValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextLocatorValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext
  }).annotate({ identifier: "browsingContext.ContextLocatorValue" })
) as any as Schema.Codec<ContextLocatorValue>

/**
 * `CreateParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateParameters {
  readonly type: CreateType
  readonly referenceContext?: BrowsingContext | undefined
  readonly background?: boolean | undefined
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `CreateParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: CreateType,
    referenceContext: Schema.optional(BrowsingContext),
    background: Schema.optional(Schema.Boolean),
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.CreateParameters" })
) as any as Schema.Codec<CreateParameters>

/**
 * `CreateResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateResult {
  readonly context: BrowsingContext
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `CreateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.CreateResult" })
) as any as Schema.Codec<CreateResult>

/**
 * `CreateType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CreateType =
  | "tab"
  | "window"
  | (string & {})

/**
 * Schema for `CreateType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateType = Schema.String as any as Schema.Codec<CreateType>

/**
 * `CssLocator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CssLocator {
  readonly type: "css"
  readonly value: string
}

/**
 * Schema for `CssLocator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CssLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("css"),
    value: Schema.String
  }).annotate({ identifier: "browsingContext.CssLocator" })
) as any as Schema.Codec<CssLocator>

/**
 * `Download`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Download = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/BrowsingContext/Download">

/**
 * Schema for `Download`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Download = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/BrowsingContext/Download")
) as any as Schema.Codec<Download>

/**
 * `DownloadCanceledParams`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadCanceledParams {
  readonly status: "canceled"
  readonly download: Download
  readonly context: BrowsingContext
  readonly navigation: Navigation | null
  readonly timestamp: number
  readonly url: string
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `DownloadCanceledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadCanceledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    status: Schema.Literal("canceled"),
    download: Download,
    context: BrowsingContext,
    navigation: Schema.Union([Navigation, Schema.Null]),
    timestamp: Schema.Int,
    url: Schema.String,
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.DownloadCanceledParams" })
) as any as Schema.Codec<DownloadCanceledParams>

/**
 * `DownloadCompleteParams`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadCompleteParams {
  readonly status: "complete"
  readonly download: Download
  readonly filepath: string | null
  readonly context: BrowsingContext
  readonly navigation: Navigation | null
  readonly timestamp: number
  readonly url: string
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `DownloadCompleteParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadCompleteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    status: Schema.Literal("complete"),
    download: Download,
    filepath: Schema.Union([Schema.String, Schema.Null]),
    context: BrowsingContext,
    navigation: Schema.Union([Navigation, Schema.Null]),
    timestamp: Schema.Int,
    url: Schema.String,
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.DownloadCompleteParams" })
) as any as Schema.Codec<DownloadCompleteParams>

/**
 * `DownloadEndParams`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DownloadEndParams = DownloadCanceledParams | DownloadCompleteParams

/**
 * Schema for `DownloadEndParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadEndParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([DownloadCanceledParams, DownloadCompleteParams])
) as any as Schema.Codec<DownloadEndParams>

/**
 * `DownloadWillBeginParams`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadWillBeginParams {
  readonly download: Download
  readonly suggestedFilename: string
  readonly context: BrowsingContext
  readonly navigation: Navigation | null
  readonly timestamp: number
  readonly url: string
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `DownloadWillBeginParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadWillBeginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    download: Download,
    suggestedFilename: Schema.String,
    context: BrowsingContext,
    navigation: Schema.Union([Navigation, Schema.Null]),
    timestamp: Schema.Int,
    url: Schema.String,
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.DownloadWillBeginParams" })
) as any as Schema.Codec<DownloadWillBeginParams>

/**
 * `ElementClipRectangle`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ElementClipRectangle {
  readonly type: "element"
  readonly element: Script.SharedReference
}

/**
 * Schema for `ElementClipRectangle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ElementClipRectangle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("element"),
    element: Script.SharedReference
  }).annotate({ identifier: "browsingContext.ElementClipRectangle" })
) as any as Schema.Codec<ElementClipRectangle>

/**
 * `GetTreeParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetTreeParameters {
  readonly maxDepth?: number | undefined
  readonly root?: BrowsingContext | undefined
}

/**
 * Schema for `GetTreeParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetTreeParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxDepth: Schema.optional(Schema.Int),
    root: Schema.optional(BrowsingContext)
  }).annotate({ identifier: "browsingContext.GetTreeParameters" })
) as any as Schema.Codec<GetTreeParameters>

/**
 * `GetTreeResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetTreeResult {
  readonly contexts: InfoList
}

/**
 * Schema for `GetTreeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contexts: InfoList
  }).annotate({ identifier: "browsingContext.GetTreeResult" })
) as any as Schema.Codec<GetTreeResult>

/**
 * `HandleUserPromptParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HandleUserPromptParameters {
  readonly context: BrowsingContext
  readonly accept?: boolean | undefined
  readonly userText?: string | undefined
}

/**
 * Schema for `HandleUserPromptParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HandleUserPromptParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    accept: Schema.optional(Schema.Boolean),
    userText: Schema.optional(Schema.String)
  }).annotate({ identifier: "browsingContext.HandleUserPromptParameters" })
) as any as Schema.Codec<HandleUserPromptParameters>

/**
 * `HandleUserPromptResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type HandleUserPromptResult = { readonly [key: string]: unknown }

/**
 * Schema for `HandleUserPromptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HandleUserPromptResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  HandleUserPromptResult
>

/**
 * `HistoryUpdatedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HistoryUpdatedParameters {
  readonly context: BrowsingContext
  readonly timestamp: number
  readonly url: string
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `HistoryUpdatedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HistoryUpdatedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    timestamp: Schema.Int,
    url: Schema.String,
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.HistoryUpdatedParameters" })
) as any as Schema.Codec<HistoryUpdatedParameters>

/**
 * `ImageFormat`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ImageFormat {
  readonly type: string
  readonly quality?: number | undefined
}

/**
 * Schema for `ImageFormat`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ImageFormat = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.String,
    quality: Schema.optional(Schema.Number)
  }).annotate({ identifier: "browsingContext.ImageFormat" })
) as any as Schema.Codec<ImageFormat>

/**
 * `ImageSize`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ImageSize {
  readonly maxWidth?: number | undefined
  readonly maxHeight?: number | undefined
}

/**
 * Schema for `ImageSize`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ImageSize = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxWidth: Schema.optional(Schema.Int),
    maxHeight: Schema.optional(Schema.Int)
  }).annotate({ identifier: "browsingContext.ImageSize" })
) as any as Schema.Codec<ImageSize>

/**
 * `Info`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Info {
  readonly children: InfoList | null
  readonly clientWindow: Browser.ClientWindow
  readonly context: BrowsingContext
  readonly originalOpener: BrowsingContext | null
  readonly url: string
  readonly userContext: Browser.UserContext
  readonly parent?: BrowsingContext | null | undefined
}

/**
 * Schema for `Info`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Info = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    children: Schema.Union([InfoList, Schema.Null]),
    clientWindow: Browser.ClientWindow,
    context: BrowsingContext,
    originalOpener: Schema.Union([BrowsingContext, Schema.Null]),
    url: Schema.String,
    userContext: Browser.UserContext,
    parent: Schema.optional(Schema.Union([BrowsingContext, Schema.Null]))
  }).annotate({ identifier: "browsingContext.Info" })
) as any as Schema.Codec<Info>

/**
 * `InfoList`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InfoList = ReadonlyArray<Info>

/**
 * Schema for `InfoList`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InfoList = /*#__PURE__*/ Schema.suspend(() => Schema.Array(Info)) as any as Schema.Codec<InfoList>

/**
 * `InnerTextLocator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InnerTextLocator {
  readonly type: "innerText"
  readonly value: string
  readonly ignoreCase?: boolean | undefined
  readonly matchType?: InnerTextLocatorMatchType | undefined
  readonly maxDepth?: number | undefined
}

/**
 * Schema for `InnerTextLocator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InnerTextLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("innerText"),
    value: Schema.String,
    ignoreCase: Schema.optional(Schema.Boolean),
    matchType: Schema.optional(InnerTextLocatorMatchType),
    maxDepth: Schema.optional(Schema.Int)
  }).annotate({ identifier: "browsingContext.InnerTextLocator" })
) as any as Schema.Codec<InnerTextLocator>

/**
 * `InnerTextLocator.matchType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InnerTextLocatorMatchType =
  | "full"
  | "partial"
  | (string & {})

/**
 * Schema for `InnerTextLocatorMatchType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InnerTextLocatorMatchType = Schema.String as any as Schema.Codec<InnerTextLocatorMatchType>

/**
 * `LocateNodesParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LocateNodesParameters {
  readonly context: BrowsingContext
  readonly locator: Locator
  readonly maxNodeCount?: number | undefined
  readonly serializationOptions?: Script.SerializationOptions | undefined
  readonly startNodes?: ReadonlyArray<Script.SharedReference> | undefined
}

/**
 * Schema for `LocateNodesParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LocateNodesParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    locator: Locator,
    maxNodeCount: Schema.optional(Schema.Int),
    serializationOptions: Schema.optional(Script.SerializationOptions),
    startNodes: Schema.optional(Schema.Array(Script.SharedReference))
  }).annotate({ identifier: "browsingContext.LocateNodesParameters" })
) as any as Schema.Codec<LocateNodesParameters>

/**
 * `LocateNodesResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LocateNodesResult {
  readonly nodes: ReadonlyArray<Script.NodeRemoteValue>
}

/**
 * Schema for `LocateNodesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LocateNodesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodes: Schema.Array(Script.NodeRemoteValue)
  }).annotate({ identifier: "browsingContext.LocateNodesResult" })
) as any as Schema.Codec<LocateNodesResult>

/**
 * `Locator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Locator = AccessibilityLocator | CssLocator | ContextLocator | InnerTextLocator | XPathLocator

/**
 * Schema for `Locator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Locator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([AccessibilityLocator, CssLocator, ContextLocator, InnerTextLocator, XPathLocator])
) as any as Schema.Codec<Locator>

/**
 * `MediaTrackConstraints`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MediaTrackConstraints {
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly frameRate?: number | undefined
}

/**
 * Schema for `MediaTrackConstraints`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MediaTrackConstraints = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    frameRate: Schema.optional(Schema.Int)
  }).annotate({ identifier: "browsingContext.MediaTrackConstraints" })
) as any as Schema.Codec<MediaTrackConstraints>

/**
 * `NavigateParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigateParameters {
  readonly context: BrowsingContext
  readonly url: string
  readonly wait?: ReadinessState | undefined
}

/**
 * Schema for `NavigateParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigateParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    url: Schema.String,
    wait: Schema.optional(ReadinessState)
  }).annotate({ identifier: "browsingContext.NavigateParameters" })
) as any as Schema.Codec<NavigateParameters>

/**
 * `NavigateResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigateResult {
  readonly navigation: Navigation | null
  readonly url: string
}

/**
 * Schema for `NavigateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    navigation: Schema.Union([Navigation, Schema.Null]),
    url: Schema.String
  }).annotate({ identifier: "browsingContext.NavigateResult" })
) as any as Schema.Codec<NavigateResult>

/**
 * `Navigation`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Navigation = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/BrowsingContext/Navigation">

/**
 * Schema for `Navigation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Navigation = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/BrowsingContext/Navigation")
) as any as Schema.Codec<Navigation>

/**
 * `NavigationInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigationInfo {
  readonly context: BrowsingContext
  readonly navigation: Navigation | null
  readonly timestamp: number
  readonly url?: string | undefined
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `NavigationInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigationInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    navigation: Schema.Union([Navigation, Schema.Null]),
    timestamp: Schema.Int,
    url: Schema.optional(Schema.String),
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "browsingContext.NavigationInfo" })
) as any as Schema.Codec<NavigationInfo>

/**
 * `PrintMarginParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PrintMarginParameters {
  readonly bottom?: number | undefined
  readonly left?: number | undefined
  readonly right?: number | undefined
  readonly top?: number | undefined
}

/**
 * Schema for `PrintMarginParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintMarginParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bottom: Schema.optional(Schema.Number),
    left: Schema.optional(Schema.Number),
    right: Schema.optional(Schema.Number),
    top: Schema.optional(Schema.Number)
  }).annotate({ identifier: "browsingContext.PrintMarginParameters" })
) as any as Schema.Codec<PrintMarginParameters>

/**
 * `PrintPageParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PrintPageParameters {
  readonly height?: number | undefined
  readonly width?: number | undefined
}

/**
 * Schema for `PrintPageParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintPageParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    height: Schema.optional(Schema.Number),
    width: Schema.optional(Schema.Number)
  }).annotate({ identifier: "browsingContext.PrintPageParameters" })
) as any as Schema.Codec<PrintPageParameters>

/**
 * `PrintParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PrintParameters {
  readonly context: BrowsingContext
  readonly background?: boolean | undefined
  readonly margin?: PrintMarginParameters | undefined
  readonly orientation?: PrintParametersOrientation | undefined
  readonly page?: PrintPageParameters | undefined
  readonly pageRanges?: ReadonlyArray<number | string> | undefined
  readonly scale?: number | undefined
  readonly shrinkToFit?: boolean | undefined
}

/**
 * Schema for `PrintParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    background: Schema.optional(Schema.Boolean),
    margin: Schema.optional(PrintMarginParameters),
    orientation: Schema.optional(PrintParametersOrientation),
    page: Schema.optional(PrintPageParameters),
    pageRanges: Schema.optional(Schema.Array(Schema.Union([Schema.Int, Schema.String]))),
    scale: Schema.optional(Schema.Number),
    shrinkToFit: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "browsingContext.PrintParameters" })
) as any as Schema.Codec<PrintParameters>

/**
 * `PrintParameters.orientation` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PrintParametersOrientation =
  | "portrait"
  | "landscape"
  | (string & {})

/**
 * Schema for `PrintParametersOrientation`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintParametersOrientation = Schema.String as any as Schema.Codec<PrintParametersOrientation>

/**
 * `PrintResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PrintResult {
  readonly data: string
}

/**
 * Schema for `PrintResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String
  }).annotate({ identifier: "browsingContext.PrintResult" })
) as any as Schema.Codec<PrintResult>

/**
 * `ReadinessState` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ReadinessState =
  | "none"
  | "interactive"
  | "complete"
  | (string & {})

/**
 * Schema for `ReadinessState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReadinessState = Schema.String as any as Schema.Codec<ReadinessState>

/**
 * `ReloadParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReloadParameters {
  readonly context: BrowsingContext
  readonly ignoreCache?: boolean | undefined
  readonly wait?: ReadinessState | undefined
}

/**
 * Schema for `ReloadParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReloadParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    ignoreCache: Schema.optional(Schema.Boolean),
    wait: Schema.optional(ReadinessState)
  }).annotate({ identifier: "browsingContext.ReloadParameters" })
) as any as Schema.Codec<ReloadParameters>

/**
 * `ReloadResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ReloadResult = NavigateResult

/**
 * Schema for `ReloadResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReloadResult = /*#__PURE__*/ Schema.suspend(() => NavigateResult) as any as Schema.Codec<ReloadResult>

/**
 * `Screencast`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Screencast = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/BrowsingContext/Screencast">

/**
 * Schema for `Screencast`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Screencast = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/BrowsingContext/Screencast")
) as any as Schema.Codec<Screencast>

/**
 * `SetBypassCSPParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBypassCSPParameters {
  readonly bypass: true | null
  readonly contexts?: ReadonlyArray<BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetBypassCSPParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBypassCSPParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bypass: Schema.Union([Schema.Literal(true), Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "browsingContext.SetBypassCSPParameters" })
) as any as Schema.Codec<SetBypassCSPParameters>

/**
 * `SetBypassCSPResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetBypassCSPResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetBypassCSPResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBypassCSPResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetBypassCSPResult
>

/**
 * `SetViewportParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetViewportParameters {
  readonly context?: BrowsingContext | undefined
  readonly viewport?: Viewport | null | undefined
  readonly devicePixelRatio?: number | null | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetViewportParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetViewportParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.optional(BrowsingContext),
    viewport: Schema.optional(Schema.Union([Viewport, Schema.Null])),
    devicePixelRatio: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "browsingContext.SetViewportParameters" })
) as any as Schema.Codec<SetViewportParameters>

/**
 * `SetViewportResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetViewportResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetViewportResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetViewportResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<SetViewportResult>

/**
 * `StartScreencastParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartScreencastParameters {
  readonly context: BrowsingContext
  readonly destinationFolder?: string | undefined
  readonly mimeType?: string | undefined
  readonly video?: MediaTrackConstraints | undefined
  readonly audio?: boolean | undefined
}

/**
 * Schema for `StartScreencastParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartScreencastParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    destinationFolder: Schema.optional(Schema.String),
    mimeType: Schema.optional(Schema.String),
    video: Schema.optional(MediaTrackConstraints),
    audio: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "browsingContext.StartScreencastParameters" })
) as any as Schema.Codec<StartScreencastParameters>

/**
 * `StartScreencastResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartScreencastResult {
  readonly screencast: Screencast
  readonly path: string
}

/**
 * Schema for `StartScreencastResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartScreencastResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screencast: Screencast,
    path: Schema.String
  }).annotate({ identifier: "browsingContext.StartScreencastResult" })
) as any as Schema.Codec<StartScreencastResult>

/**
 * `StopScreencastParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StopScreencastParameters {
  readonly screencast: Screencast
}

/**
 * Schema for `StopScreencastParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StopScreencastParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screencast: Screencast
  }).annotate({ identifier: "browsingContext.StopScreencastParameters" })
) as any as Schema.Codec<StopScreencastParameters>

/**
 * `StopScreencastResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StopScreencastResult {
  readonly path: string
  readonly error?: string | undefined
}

/**
 * Schema for `StopScreencastResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StopScreencastResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    path: Schema.String,
    error: Schema.optional(Schema.String)
  }).annotate({ identifier: "browsingContext.StopScreencastResult" })
) as any as Schema.Codec<StopScreencastResult>

/**
 * `TraverseHistoryParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TraverseHistoryParameters {
  readonly context: BrowsingContext
  readonly delta: number
}

/**
 * Schema for `TraverseHistoryParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TraverseHistoryParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    delta: Schema.Int
  }).annotate({ identifier: "browsingContext.TraverseHistoryParameters" })
) as any as Schema.Codec<TraverseHistoryParameters>

/**
 * `TraverseHistoryResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TraverseHistoryResult = { readonly [key: string]: unknown }

/**
 * Schema for `TraverseHistoryResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TraverseHistoryResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  TraverseHistoryResult
>

/**
 * `UserPromptClosedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UserPromptClosedParameters {
  readonly context: BrowsingContext
  readonly accepted: boolean
  readonly type: UserPromptType
  readonly userContext?: Browser.UserContext | undefined
  readonly userText?: string | undefined
}

/**
 * Schema for `UserPromptClosedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPromptClosedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    accepted: Schema.Boolean,
    type: UserPromptType,
    userContext: Schema.optional(Browser.UserContext),
    userText: Schema.optional(Schema.String)
  }).annotate({ identifier: "browsingContext.UserPromptClosedParameters" })
) as any as Schema.Codec<UserPromptClosedParameters>

/**
 * `UserPromptOpenedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UserPromptOpenedParameters {
  readonly context: BrowsingContext
  readonly handler: Session.UserPromptHandlerType
  readonly message: string
  readonly type: UserPromptType
  readonly userContext?: Browser.UserContext | undefined
  readonly defaultValue?: string | undefined
}

/**
 * Schema for `UserPromptOpenedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPromptOpenedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext,
    handler: Session.UserPromptHandlerType,
    message: Schema.String,
    type: UserPromptType,
    userContext: Schema.optional(Browser.UserContext),
    defaultValue: Schema.optional(Schema.String)
  }).annotate({ identifier: "browsingContext.UserPromptOpenedParameters" })
) as any as Schema.Codec<UserPromptOpenedParameters>

/**
 * `UserPromptType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UserPromptType =
  | "alert"
  | "beforeunload"
  | "confirm"
  | "prompt"
  | (string & {})

/**
 * Schema for `UserPromptType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPromptType = Schema.String as any as Schema.Codec<UserPromptType>

/**
 * `Viewport`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/**
 * Schema for `Viewport`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Viewport = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Int,
    height: Schema.Int
  }).annotate({ identifier: "browsingContext.Viewport" })
) as any as Schema.Codec<Viewport>

/**
 * `XPathLocator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface XPathLocator {
  readonly type: "xpath"
  readonly value: string
}

/**
 * Schema for `XPathLocator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const XPathLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("xpath"),
    value: Schema.String
  }).annotate({ identifier: "browsingContext.XPathLocator" })
) as any as Schema.Codec<XPathLocator>

/**
 * Sends `browsingContext.activate`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const activate: Protocol.CommandDef<"browsingContext.activate", ActivateParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.activate",
    ActivateParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.captureScreenshot`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const captureScreenshot: Protocol.CommandDef<
  "browsingContext.captureScreenshot",
  CaptureScreenshotParameters,
  CaptureScreenshotResult
> = /*#__PURE__*/ Protocol.command(
  "browsingContext.captureScreenshot",
  CaptureScreenshotParameters,
  CaptureScreenshotResult,
  { status: "stable" }
)

/**
 * Sends `browsingContext.close`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const close: Protocol.CommandDef<"browsingContext.close", CloseParameters, void> = /*#__PURE__*/ Protocol
  .command(
    "browsingContext.close",
    CloseParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.create`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const create: Protocol.CommandDef<"browsingContext.create", CreateParameters, CreateResult> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.create",
    CreateParameters,
    CreateResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "browsingContext.close", param: "context", from: "/context" }]
    }
  )

/**
 * Sends `browsingContext.getTree`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getTree: Protocol.CommandDef<"browsingContext.getTree", GetTreeParameters, GetTreeResult> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.getTree",
    GetTreeParameters,
    GetTreeResult,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.handleUserPrompt`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const handleUserPrompt: Protocol.CommandDef<
  "browsingContext.handleUserPrompt",
  HandleUserPromptParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "browsingContext.handleUserPrompt",
  HandleUserPromptParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `browsingContext.locateNodes`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const locateNodes: Protocol.CommandDef<"browsingContext.locateNodes", LocateNodesParameters, LocateNodesResult> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.locateNodes",
    LocateNodesParameters,
    LocateNodesResult,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.navigate`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const navigate: Protocol.CommandDef<"browsingContext.navigate", NavigateParameters, NavigateResult> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.navigate",
    NavigateParameters,
    NavigateResult,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.print`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const print: Protocol.CommandDef<"browsingContext.print", PrintParameters, PrintResult> = /*#__PURE__*/ Protocol
  .command(
    "browsingContext.print",
    PrintParameters,
    PrintResult,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.reload`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const reload: Protocol.CommandDef<"browsingContext.reload", ReloadParameters, ReloadResult> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.reload",
    ReloadParameters,
    ReloadResult,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.setBypassCSP`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBypassCSP: Protocol.CommandDef<"browsingContext.setBypassCSP", SetBypassCSPParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.setBypassCSP",
    SetBypassCSPParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.setViewport`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setViewport: Protocol.CommandDef<"browsingContext.setViewport", SetViewportParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.setViewport",
    SetViewportParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `browsingContext.startScreencast`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startScreencast: Protocol.CommandDef<
  "browsingContext.startScreencast",
  StartScreencastParameters,
  StartScreencastResult
> = /*#__PURE__*/ Protocol.command(
  "browsingContext.startScreencast",
  StartScreencastParameters,
  StartScreencastResult,
  {
    status: "stable",
    createsResource: true,
    release: [{ method: "browsingContext.stopScreencast", param: "screencast", from: "/screencast" }]
  }
)

/**
 * Sends `browsingContext.stopScreencast`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopScreencast: Protocol.CommandDef<
  "browsingContext.stopScreencast",
  StopScreencastParameters,
  StopScreencastResult
> = /*#__PURE__*/ Protocol.command(
  "browsingContext.stopScreencast",
  StopScreencastParameters,
  StopScreencastResult,
  { status: "stable" }
)

/**
 * Sends `browsingContext.traverseHistory`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const traverseHistory: Protocol.CommandDef<"browsingContext.traverseHistory", TraverseHistoryParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "browsingContext.traverseHistory",
    TraverseHistoryParameters,
    undefined,
    { status: "stable" }
  )

/**
 * The `browsingContext.contextCreated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const contextCreated: Protocol.EventDef<"browsingContext.contextCreated", ContextCreatedParameters> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.contextCreated",
    ContextCreatedParameters,
    { status: "stable" }
  )

/**
 * The `browsingContext.contextDestroyed` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const contextDestroyed: Protocol.EventDef<"browsingContext.contextDestroyed", Info> = /*#__PURE__*/ Protocol
  .event(
    "browsingContext.contextDestroyed",
    Info,
    { status: "stable" }
  )

/**
 * The `browsingContext.domContentLoaded` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const domContentLoaded: Protocol.EventDef<"browsingContext.domContentLoaded", NavigationInfo> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.domContentLoaded",
    NavigationInfo,
    { status: "stable" }
  )

/**
 * The `browsingContext.downloadEnd` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const downloadEnd: Protocol.EventDef<"browsingContext.downloadEnd", DownloadEndParams> = /*#__PURE__*/ Protocol
  .event(
    "browsingContext.downloadEnd",
    DownloadEndParams,
    { status: "stable" }
  )

/**
 * The `browsingContext.downloadWillBegin` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const downloadWillBegin: Protocol.EventDef<"browsingContext.downloadWillBegin", DownloadWillBeginParams> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.downloadWillBegin",
    DownloadWillBeginParams,
    { status: "stable" }
  )

/**
 * The `browsingContext.fragmentNavigated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const fragmentNavigated: Protocol.EventDef<"browsingContext.fragmentNavigated", NavigationInfo> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.fragmentNavigated",
    NavigationInfo,
    { status: "stable" }
  )

/**
 * The `browsingContext.historyUpdated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const historyUpdated: Protocol.EventDef<"browsingContext.historyUpdated", HistoryUpdatedParameters> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.historyUpdated",
    HistoryUpdatedParameters,
    { status: "stable" }
  )

/**
 * The `browsingContext.load` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const load: Protocol.EventDef<"browsingContext.load", NavigationInfo> = /*#__PURE__*/ Protocol.event(
  "browsingContext.load",
  NavigationInfo,
  { status: "stable" }
)

/**
 * The `browsingContext.navigationAborted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const navigationAborted: Protocol.EventDef<"browsingContext.navigationAborted", NavigationInfo> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.navigationAborted",
    NavigationInfo,
    { status: "stable" }
  )

/**
 * The `browsingContext.navigationCommitted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const navigationCommitted: Protocol.EventDef<"browsingContext.navigationCommitted", NavigationInfo> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.navigationCommitted",
    NavigationInfo,
    { status: "stable" }
  )

/**
 * The `browsingContext.navigationFailed` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const navigationFailed: Protocol.EventDef<"browsingContext.navigationFailed", NavigationInfo> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.navigationFailed",
    NavigationInfo,
    { status: "stable" }
  )

/**
 * The `browsingContext.navigationStarted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const navigationStarted: Protocol.EventDef<"browsingContext.navigationStarted", NavigationInfo> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.navigationStarted",
    NavigationInfo,
    { status: "stable" }
  )

/**
 * The `browsingContext.userPromptClosed` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const userPromptClosed: Protocol.EventDef<"browsingContext.userPromptClosed", UserPromptClosedParameters> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.userPromptClosed",
    UserPromptClosedParameters,
    { status: "stable" }
  )

/**
 * The `browsingContext.userPromptOpened` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const userPromptOpened: Protocol.EventDef<"browsingContext.userPromptOpened", UserPromptOpenedParameters> =
  /*#__PURE__*/ Protocol.event(
    "browsingContext.userPromptOpened",
    UserPromptOpenedParameters,
    { status: "stable" }
  )
