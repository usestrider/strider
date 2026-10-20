/**
 * Actions and events related to the inspected page belong to the page domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"
import * as DOM from "./DOM.ts"
import * as IO from "./IO.ts"
import * as Network from "./Network.ts"
import * as Runtime from "./Runtime.ts"

/**
 * `AdFrameExplanation` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AdFrameExplanation =
  | "ParentIsAd"
  | "CreatedByAdScript"
  | "MatchedBlockingRule"
  | (string & {})

/**
 * Schema for `AdFrameExplanation`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdFrameExplanation = Schema.String as any as Schema.Codec<AdFrameExplanation>

/**
 * Indicates whether a frame has been identified as an ad and why.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdFrameStatus {
  readonly adFrameType: AdFrameType
  readonly explanations?: ReadonlyArray<AdFrameExplanation> | undefined
}

/**
 * Schema for `AdFrameStatus`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdFrameStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    adFrameType: AdFrameType,
    explanations: Schema.optional(Schema.Array(AdFrameExplanation))
  }).annotate({ identifier: "Page.AdFrameStatus" })
) as any as Schema.Codec<AdFrameStatus>

/**
 * Indicates whether a frame has been identified as an ad.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AdFrameType =
  | "none"
  | "child"
  | "root"
  | (string & {})

/**
 * Schema for `AdFrameType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdFrameType = Schema.String as any as Schema.Codec<AdFrameType>

/**
 * Error while paring app manifest.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AppManifestError {
  /**
   * Error message.
   */
  readonly message: string
  /**
   * If critical, this is a non-recoverable parse error.
   */
  readonly critical: number
  /**
   * Error line.
   */
  readonly line: number
  /**
   * Error column.
   */
  readonly column: number
}

/**
 * Schema for `AppManifestError`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AppManifestError = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.String,
    critical: Schema.Int,
    line: Schema.Int,
    column: Schema.Int
  }).annotate({ identifier: "Page.AppManifestError" })
) as any as Schema.Codec<AppManifestError>

/**
 * Parsed app manifest properties.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AppManifestParsedProperties {
  /**
   * Computed scope value
   */
  readonly scope: string
}

/**
 * Schema for `AppManifestParsedProperties`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AppManifestParsedProperties = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scope: Schema.String
  }).annotate({ identifier: "Page.AppManifestParsedProperties" })
) as any as Schema.Codec<AppManifestParsedProperties>

/**
 * `BackForwardCacheBlockingDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BackForwardCacheBlockingDetails {
  /**
   * Url of the file where blockage happened. Optional because of tests.
   */
  readonly url?: string | undefined
  /**
   * Function name where blockage happened. Optional because of anonymous functions and tests.
   */
  readonly function?: string | undefined
  /**
   * Line number in the script (0-based).
   */
  readonly lineNumber: number
  /**
   * Column number in the script (0-based).
   */
  readonly columnNumber: number
}

/**
 * Schema for `BackForwardCacheBlockingDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackForwardCacheBlockingDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.optional(Schema.String),
    function: Schema.optional(Schema.String),
    lineNumber: Schema.Int,
    columnNumber: Schema.Int
  }).annotate({ identifier: "Page.BackForwardCacheBlockingDetails" })
) as any as Schema.Codec<BackForwardCacheBlockingDetails>

/**
 * `BackForwardCacheNotRestoredExplanation`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BackForwardCacheNotRestoredExplanation {
  /**
   * Type of the reason
   */
  readonly type: BackForwardCacheNotRestoredReasonType
  /**
   * Not restored reason
   */
  readonly reason: BackForwardCacheNotRestoredReason
  /**
   * Context associated with the reason. The meaning of this context is
   * dependent on the reason:
   * - EmbedderExtensionSentMessageToCachedFrame: the extension ID.
   */
  readonly context?: string | undefined
  readonly details?: ReadonlyArray<BackForwardCacheBlockingDetails> | undefined
}

/**
 * Schema for `BackForwardCacheNotRestoredExplanation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackForwardCacheNotRestoredExplanation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: BackForwardCacheNotRestoredReasonType,
    reason: BackForwardCacheNotRestoredReason,
    context: Schema.optional(Schema.String),
    details: Schema.optional(Schema.Array(BackForwardCacheBlockingDetails))
  }).annotate({ identifier: "Page.BackForwardCacheNotRestoredExplanation" })
) as any as Schema.Codec<BackForwardCacheNotRestoredExplanation>

/**
 * `BackForwardCacheNotRestoredExplanationTree`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BackForwardCacheNotRestoredExplanationTree {
  /**
   * URL of each frame
   */
  readonly url: string
  /**
   * Not restored reasons of each frame
   */
  readonly explanations: ReadonlyArray<BackForwardCacheNotRestoredExplanation>
  /**
   * Array of children frame
   */
  readonly children: ReadonlyArray<BackForwardCacheNotRestoredExplanationTree>
}

/**
 * Schema for `BackForwardCacheNotRestoredExplanationTree`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackForwardCacheNotRestoredExplanationTree = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    explanations: Schema.Array(BackForwardCacheNotRestoredExplanation),
    children: Schema.Array(BackForwardCacheNotRestoredExplanationTree)
  }).annotate({ identifier: "Page.BackForwardCacheNotRestoredExplanationTree" })
) as any as Schema.Codec<BackForwardCacheNotRestoredExplanationTree>

/**
 * List of not restored reasons for back-forward cache.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type BackForwardCacheNotRestoredReason =
  | "NotPrimaryMainFrame"
  | "BackForwardCacheDisabled"
  | "RelatedActiveContentsExist"
  | "HTTPStatusNotOK"
  | "SchemeNotHTTPOrHTTPS"
  | "Loading"
  | "WasGrantedMediaAccess"
  | "DisableForRenderFrameHostCalled"
  | "DomainNotAllowed"
  | "HTTPMethodNotGET"
  | "SubframeIsNavigating"
  | "Timeout"
  | "CacheLimit"
  | "JavaScriptExecution"
  | "RendererProcessKilled"
  | "RendererProcessCrashed"
  | "SchedulerTrackedFeatureUsed"
  | "ConflictingBrowsingInstance"
  | "CacheFlushed"
  | "ServiceWorkerVersionActivation"
  | "SessionRestored"
  | "ServiceWorkerPostMessage"
  | "EnteredBackForwardCacheBeforeServiceWorkerHostAdded"
  | "RenderFrameHostReused_SameSite"
  | "RenderFrameHostReused_CrossSite"
  | "ServiceWorkerClaim"
  | "IgnoreEventAndEvict"
  | "HaveInnerContents"
  | "TimeoutPuttingInCache"
  | "BackForwardCacheDisabledByLowMemory"
  | "BackForwardCacheDisabledByCommandLine"
  | "NetworkRequestDatapipeDrainedAsBytesConsumer"
  | "NetworkRequestRedirected"
  | "NetworkRequestTimeout"
  | "NetworkExceedsBufferLimit"
  | "NavigationCancelledWhileRestoring"
  | "NotMostRecentNavigationEntry"
  | "BackForwardCacheDisabledForPrerender"
  | "UserAgentOverrideDiffers"
  | "ForegroundCacheLimit"
  | "ForwardCacheDisabled"
  | "BrowsingInstanceNotSwapped"
  | "BackForwardCacheDisabledForDelegate"
  | "UnloadHandlerExistsInMainFrame"
  | "UnloadHandlerExistsInSubFrame"
  | "ServiceWorkerUnregistration"
  | "CacheControlNoStore"
  | "CacheControlNoStoreCookieModified"
  | "CacheControlNoStoreHTTPOnlyCookieModified"
  | "NoResponseHead"
  | "Unknown"
  | "ActivationNavigationsDisallowedForBug1234857"
  | "ErrorDocument"
  | "FencedFramesEmbedder"
  | "CookieDisabled"
  | "HTTPAuthRequired"
  | "CookieFlushed"
  | "BroadcastChannelOnMessage"
  | "WebViewSettingsChanged"
  | "WebViewJavaScriptObjectChanged"
  | "WebViewMessageListenerInjected"
  | "WebViewSafeBrowsingAllowlistChanged"
  | "WebViewDocumentStartJavascriptChanged"
  | "WebSocket"
  | "WebTransport"
  | "WebRTC"
  | "MainResourceHasCacheControlNoStore"
  | "MainResourceHasCacheControlNoCache"
  | "SubresourceHasCacheControlNoStore"
  | "SubresourceHasCacheControlNoCache"
  | "ContainsPlugins"
  | "DocumentLoaded"
  | "OutstandingNetworkRequestOthers"
  | "RequestedMIDIPermission"
  | "RequestedAudioCapturePermission"
  | "RequestedVideoCapturePermission"
  | "RequestedBackForwardCacheBlockedSensors"
  | "RequestedBackgroundWorkPermission"
  | "BroadcastChannel"
  | "WebXR"
  | "SharedWorker"
  | "SharedWorkerMessage"
  | "SharedWorkerWithNoActiveClient"
  | "WebLocks"
  | "WebLocksContention"
  | "WebHID"
  | "WebBluetooth"
  | "WebShare"
  | "RequestedStorageAccessGrant"
  | "WebNfc"
  | "OutstandingNetworkRequestFetch"
  | "OutstandingNetworkRequestXHR"
  | "AppBanner"
  | "Printing"
  | "WebDatabase"
  | "PictureInPicture"
  | "SpeechRecognizer"
  | "IdleManager"
  | "PaymentManager"
  | "SpeechSynthesis"
  | "KeyboardLock"
  | "WebOTPService"
  | "OutstandingNetworkRequestDirectSocket"
  | "InjectedJavascript"
  | "InjectedStyleSheet"
  | "KeepaliveRequest"
  | "IndexedDBEvent"
  | "Dummy"
  | "JsNetworkRequestReceivedCacheControlNoStoreResource"
  | "WebRTCUsedWithCCNS"
  | "WebTransportUsedWithCCNS"
  | "WebSocketUsedWithCCNS"
  | "SmartCard"
  | "LiveMediaStreamTrack"
  | "UnloadHandler"
  | "ParserAborted"
  | "ContentSecurityHandler"
  | "ContentWebAuthenticationAPI"
  | "ContentFileChooser"
  | "ContentSerial"
  | "ContentFileSystemAccess"
  | "ContentMediaDevicesDispatcherHost"
  | "ContentWebBluetooth"
  | "ContentWebUSB"
  | "ContentMediaSessionService"
  | "ContentScreenReader"
  | "ContentDiscarded"
  | "EmbedderPopupBlockerTabHelper"
  | "EmbedderSafeBrowsingTriggeredPopupBlocker"
  | "EmbedderSafeBrowsingThreatDetails"
  | "EmbedderAppBannerManager"
  | "EmbedderDomDistillerViewerSource"
  | "EmbedderDomDistillerSelfDeletingRequestDelegate"
  | "EmbedderOomInterventionTabHelper"
  | "EmbedderOfflinePage"
  | "EmbedderChromePasswordManagerClientBindCredentialManager"
  | "EmbedderPermissionRequestManager"
  | "EmbedderModalDialog"
  | "EmbedderExtensions"
  | "EmbedderExtensionMessaging"
  | "EmbedderExtensionMessagingForOpenPort"
  | "EmbedderExtensionSentMessageToCachedFrame"
  | "EmbedderExtensionFrame"
  | "EmbedderPrivilegedWebContents"
  | "RequestedByWebViewClient"
  | "PostMessageByWebViewClient"
  | "CacheControlNoStoreDeviceBoundSessionTerminated"
  | "CacheLimitPrunedOnModerateMemoryPressure"
  | "CacheLimitPrunedOnCriticalMemoryPressure"
  | (string & {})

/**
 * Schema for `BackForwardCacheNotRestoredReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackForwardCacheNotRestoredReason = Schema.String as any as Schema.Codec<BackForwardCacheNotRestoredReason>

/**
 * Types of not restored reasons for back-forward cache.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type BackForwardCacheNotRestoredReasonType =
  | "SupportPending"
  | "PageSupportNeeded"
  | "Circumstantial"
  | (string & {})

/**
 * Schema for `BackForwardCacheNotRestoredReasonType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackForwardCacheNotRestoredReasonType = Schema.String as any as Schema.Codec<
  BackForwardCacheNotRestoredReasonType
>

/**
 * `ClientNavigationDisposition` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ClientNavigationDisposition =
  | "currentTab"
  | "newTab"
  | "newWindow"
  | "download"
  | (string & {})

/**
 * Schema for `ClientNavigationDisposition`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClientNavigationDisposition = Schema.String as any as Schema.Codec<ClientNavigationDisposition>

/**
 * `ClientNavigationReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ClientNavigationReason =
  | "anchorClick"
  | "formSubmissionGet"
  | "formSubmissionPost"
  | "httpHeaderRefresh"
  | "initialFrameNavigation"
  | "metaTagRefresh"
  | "other"
  | "pageBlockInterstitial"
  | "reload"
  | "scriptInitiated"
  | (string & {})

/**
 * Schema for `ClientNavigationReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClientNavigationReason = Schema.String as any as Schema.Codec<ClientNavigationReason>

/**
 * Per-script compilation cache parameters for `Page.produceCompilationCache`
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CompilationCacheParams {
  /**
   * The URL of the script to produce a compilation cache entry for.
   */
  readonly url: string
  /**
   * A hint to the backend whether eager compilation is recommended.
   * (the actual compilation mode used is upon backend discretion).
   */
  readonly eager?: boolean | undefined
}

/**
 * Schema for `CompilationCacheParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CompilationCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    eager: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.CompilationCacheParams" })
) as any as Schema.Codec<CompilationCacheParams>

/**
 * Indicates whether the frame is cross-origin isolated and why it is the case.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CrossOriginIsolatedContextType =
  | "Isolated"
  | "NotIsolated"
  | "NotIsolatedFeatureDisabled"
  | (string & {})

/**
 * Schema for `CrossOriginIsolatedContextType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CrossOriginIsolatedContextType = Schema.String as any as Schema.Codec<CrossOriginIsolatedContextType>

/**
 * Javascript dialog type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DialogType =
  | "alert"
  | "confirm"
  | "prompt"
  | "beforeunload"
  | (string & {})

/**
 * Schema for `DialogType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DialogType = Schema.String as any as Schema.Codec<DialogType>

/**
 * `FileFilter`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FileFilter {
  readonly name?: string | undefined
  readonly accepts?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `FileFilter`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FileFilter = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    accepts: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Page.FileFilter" })
) as any as Schema.Codec<FileFilter>

/**
 * `FileHandler`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FileHandler {
  readonly action: string
  readonly name: string
  /**
   * Mimic a map, name is the key, accepts is the value.
   */
  readonly accepts?: ReadonlyArray<FileFilter> | undefined
  /**
   * Won't repeat the enums, using string for easy comparison. Same as the
   * other enums below.
   */
  readonly launchType: string
}

/**
 * Schema for `FileHandler`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FileHandler = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    action: Schema.String,
    name: Schema.String,
    accepts: Schema.optional(Schema.Array(FileFilter)),
    launchType: Schema.String
  }).annotate({ identifier: "Page.FileHandler" })
) as any as Schema.Codec<FileHandler>

/**
 * Generic font families collection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FontFamilies {
  /**
   * The standard font-family.
   */
  readonly standard?: string | undefined
  /**
   * The fixed font-family.
   */
  readonly fixed?: string | undefined
  /**
   * The serif font-family.
   */
  readonly serif?: string | undefined
  /**
   * The sansSerif font-family.
   */
  readonly sansSerif?: string | undefined
  /**
   * The cursive font-family.
   */
  readonly cursive?: string | undefined
  /**
   * The fantasy font-family.
   */
  readonly fantasy?: string | undefined
  /**
   * The math font-family.
   */
  readonly math?: string | undefined
}

/**
 * Schema for `FontFamilies`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FontFamilies = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    standard: Schema.optional(Schema.String),
    fixed: Schema.optional(Schema.String),
    serif: Schema.optional(Schema.String),
    sansSerif: Schema.optional(Schema.String),
    cursive: Schema.optional(Schema.String),
    fantasy: Schema.optional(Schema.String),
    math: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.FontFamilies" })
) as any as Schema.Codec<FontFamilies>

/**
 * Default font sizes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FontSizes {
  /**
   * Default standard font size.
   */
  readonly standard?: number | undefined
  /**
   * Default fixed font size.
   */
  readonly fixed?: number | undefined
}

/**
 * Schema for `FontSizes`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FontSizes = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    standard: Schema.optional(Schema.Int),
    fixed: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Page.FontSizes" })
) as any as Schema.Codec<FontSizes>

/**
 * Information about the Frame on the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Frame {
  /**
   * Frame unique identifier.
   */
  readonly id: FrameId
  /**
   * Parent frame identifier.
   */
  readonly parentId?: FrameId | undefined
  /**
   * Identifier of the loader associated with this frame.
   */
  readonly loaderId: Network.LoaderId
  /**
   * Frame's name as specified in the tag.
   */
  readonly name?: string | undefined
  /**
   * Frame document's URL without fragment.
   */
  readonly url: string
  /**
   * Frame document's URL fragment including the '#'.
   */
  readonly urlFragment?: string | undefined
  /**
   * Frame document's registered domain, taking the public suffixes list into account.
   * Extracted from the Frame's url.
   * Example URLs: http://www.google.com/file.html -> "google.com"
   *               http://a.b.co.uk/file.html      -> "b.co.uk"
   */
  readonly domainAndRegistry?: string | undefined
  /**
   * Frame document's security origin.
   */
  readonly securityOrigin: string
  /**
   * Additional details about the frame document's security origin.
   */
  readonly securityOriginDetails?: SecurityOriginDetails | undefined
  /**
   * Frame document's mimeType as determined by the browser.
   */
  readonly mimeType: string
  /**
   * If the frame failed to load, this contains the URL that could not be loaded. Note that unlike url above, this URL may contain a fragment.
   */
  readonly unreachableUrl?: string | undefined
  /**
   * Indicates whether this frame was tagged as an ad and why.
   */
  readonly adFrameStatus?: AdFrameStatus | undefined
  /**
   * Indicates whether the main document is a secure context and explains why that is the case.
   */
  readonly secureContextType?: SecureContextType | undefined
  /**
   * Indicates whether this is a cross origin isolated context.
   */
  readonly crossOriginIsolatedContextType?: CrossOriginIsolatedContextType | undefined
  /**
   * Indicated which gated APIs / features are available.
   */
  readonly gatedAPIFeatures?: ReadonlyArray<GatedAPIFeatures> | undefined
}

/**
 * Schema for `Frame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Frame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: FrameId,
    parentId: Schema.optional(FrameId),
    loaderId: Network.LoaderId,
    name: Schema.optional(Schema.String),
    url: Schema.String,
    urlFragment: Schema.optional(Schema.String),
    domainAndRegistry: Schema.optional(Schema.String),
    securityOrigin: Schema.String,
    securityOriginDetails: Schema.optional(SecurityOriginDetails),
    mimeType: Schema.String,
    unreachableUrl: Schema.optional(Schema.String),
    adFrameStatus: Schema.optional(AdFrameStatus),
    secureContextType: Schema.optional(SecureContextType),
    crossOriginIsolatedContextType: Schema.optional(CrossOriginIsolatedContextType),
    gatedAPIFeatures: Schema.optional(Schema.Array(GatedAPIFeatures))
  }).annotate({ identifier: "Page.Frame" })
) as any as Schema.Codec<Frame>

/**
 * Unique frame identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FrameId = Brand.Branded<string, "~@usestrider/browser/cdp/Page/FrameId">

/**
 * Schema for `FrameId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Page/FrameId")
) as any as Schema.Codec<FrameId>

/**
 * Information about the Resource on the page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameResource {
  /**
   * Resource URL.
   */
  readonly url: string
  /**
   * Type of this resource.
   */
  readonly type: Network.ResourceType
  /**
   * Resource mimeType as determined by the browser.
   */
  readonly mimeType: string
  /**
   * last-modified timestamp as reported by server.
   */
  readonly lastModified?: Network.TimeSinceEpoch | undefined
  /**
   * Resource content size.
   */
  readonly contentSize?: number | undefined
  /**
   * True if the resource failed to load.
   */
  readonly failed?: boolean | undefined
  /**
   * True if the resource was canceled during loading.
   */
  readonly canceled?: boolean | undefined
}

/**
 * Schema for `FrameResource`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameResource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    type: Network.ResourceType,
    mimeType: Schema.String,
    lastModified: Schema.optional(Network.TimeSinceEpoch),
    contentSize: Schema.optional(Schema.Number),
    failed: Schema.optional(Schema.Boolean),
    canceled: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.FrameResource" })
) as any as Schema.Codec<FrameResource>

/**
 * Information about the Frame hierarchy along with their cached resources.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameResourceTree {
  /**
   * Frame information for this tree item.
   */
  readonly frame: Frame
  /**
   * Child frames.
   */
  readonly childFrames?: ReadonlyArray<FrameResourceTree> | undefined
  /**
   * Information about frame resources.
   */
  readonly resources: ReadonlyArray<FrameResource>
}

/**
 * Schema for `FrameResourceTree`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameResourceTree = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frame: Frame,
    childFrames: Schema.optional(Schema.Array(FrameResourceTree)),
    resources: Schema.Array(FrameResource)
  }).annotate({ identifier: "Page.FrameResourceTree" })
) as any as Schema.Codec<FrameResourceTree>

/**
 * Information about the Frame hierarchy.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameTree {
  /**
   * Frame information for this tree item.
   */
  readonly frame: Frame
  /**
   * Child frames.
   */
  readonly childFrames?: ReadonlyArray<FrameTree> | undefined
}

/**
 * Schema for `FrameTree`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameTree = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frame: Frame,
    childFrames: Schema.optional(Schema.Array(FrameTree))
  }).annotate({ identifier: "Page.FrameTree" })
) as any as Schema.Codec<FrameTree>

/**
 * `GatedAPIFeatures` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type GatedAPIFeatures =
  | "SharedArrayBuffers"
  | "SharedArrayBuffersTransferAllowed"
  | "PerformanceMeasureMemory"
  | "PerformanceProfile"
  | (string & {})

/**
 * Schema for `GatedAPIFeatures`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GatedAPIFeatures = Schema.String as any as Schema.Codec<GatedAPIFeatures>

/**
 * The image definition used in both icon and screenshot.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ImageResource {
  /**
   * The src field in the definition, but changing to url in favor of
   * consistency.
   */
  readonly url: string
  readonly sizes?: string | undefined
  readonly type?: string | undefined
}

/**
 * Schema for `ImageResource`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ImageResource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    sizes: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.ImageResource" })
) as any as Schema.Codec<ImageResource>

/**
 * The installability error
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InstallabilityError {
  /**
   * The error id (e.g. 'manifest-missing-suitable-icon').
   */
  readonly errorId: string
  /**
   * The list of error arguments (e.g. {name:'minimum-icon-size-in-pixels', value:'64'}).
   */
  readonly errorArguments: ReadonlyArray<InstallabilityErrorArgument>
}

/**
 * Schema for `InstallabilityError`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InstallabilityError = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    errorId: Schema.String,
    errorArguments: Schema.Array(InstallabilityErrorArgument)
  }).annotate({ identifier: "Page.InstallabilityError" })
) as any as Schema.Codec<InstallabilityError>

/**
 * `InstallabilityErrorArgument`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InstallabilityErrorArgument {
  /**
   * Argument name (e.g. name:'minimum-icon-size-in-pixels').
   */
  readonly name: string
  /**
   * Argument value (e.g. value:'64').
   */
  readonly value: string
}

/**
 * Schema for `InstallabilityErrorArgument`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InstallabilityErrorArgument = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "Page.InstallabilityErrorArgument" })
) as any as Schema.Codec<InstallabilityErrorArgument>

/**
 * `LaunchHandler`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LaunchHandler {
  readonly clientMode: string
}

/**
 * Schema for `LaunchHandler`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LaunchHandler = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    clientMode: Schema.String
  }).annotate({ identifier: "Page.LaunchHandler" })
) as any as Schema.Codec<LaunchHandler>

/**
 * Layout viewport position and dimensions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LayoutViewport {
  /**
   * Horizontal offset relative to the document (CSS pixels).
   */
  readonly pageX: number
  /**
   * Vertical offset relative to the document (CSS pixels).
   */
  readonly pageY: number
  /**
   * Width (CSS pixels), excludes scrollbar if present.
   */
  readonly clientWidth: number
  /**
   * Height (CSS pixels), excludes scrollbar if present.
   */
  readonly clientHeight: number
}

/**
 * Schema for `LayoutViewport`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LayoutViewport = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageX: Schema.Int,
    pageY: Schema.Int,
    clientWidth: Schema.Int,
    clientHeight: Schema.Int
  }).annotate({ identifier: "Page.LayoutViewport" })
) as any as Schema.Codec<LayoutViewport>

/**
 * Navigation history entry.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigationEntry {
  /**
   * Unique id of the navigation history entry.
   */
  readonly id: number
  /**
   * URL of the navigation history entry.
   */
  readonly url: string
  /**
   * URL that the user typed in the url bar.
   */
  readonly userTypedURL: string
  /**
   * Title of the navigation history entry.
   */
  readonly title: string
  /**
   * Transition type.
   */
  readonly transitionType: TransitionType
}

/**
 * Schema for `NavigationEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigationEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.Int,
    url: Schema.String,
    userTypedURL: Schema.String,
    title: Schema.String,
    transitionType: TransitionType
  }).annotate({ identifier: "Page.NavigationEntry" })
) as any as Schema.Codec<NavigationEntry>

/**
 * The type of a frameNavigated event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type NavigationType =
  | "Navigation"
  | "BackForwardCacheRestore"
  | (string & {})

/**
 * Schema for `NavigationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NavigationType = Schema.String as any as Schema.Codec<NavigationType>

/**
 * `OriginTrial`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OriginTrial {
  readonly trialName: string
  readonly status: OriginTrialStatus
  readonly tokensWithStatus: ReadonlyArray<OriginTrialTokenWithStatus>
}

/**
 * Schema for `OriginTrial`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OriginTrial = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    trialName: Schema.String,
    status: OriginTrialStatus,
    tokensWithStatus: Schema.Array(OriginTrialTokenWithStatus)
  }).annotate({ identifier: "Page.OriginTrial" })
) as any as Schema.Codec<OriginTrial>

/**
 * Status for an Origin Trial.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type OriginTrialStatus =
  | "Enabled"
  | "ValidTokenNotProvided"
  | "OSNotSupported"
  | "TrialNotAllowed"
  | (string & {})

/**
 * Schema for `OriginTrialStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OriginTrialStatus = Schema.String as any as Schema.Codec<OriginTrialStatus>

/**
 * `OriginTrialToken`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OriginTrialToken {
  readonly origin: string
  readonly matchSubDomains: boolean
  readonly trialName: string
  readonly expiryTime: Network.TimeSinceEpoch
  readonly isThirdParty: boolean
  readonly usageRestriction: OriginTrialUsageRestriction
}

/**
 * Schema for `OriginTrialToken`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OriginTrialToken = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    matchSubDomains: Schema.Boolean,
    trialName: Schema.String,
    expiryTime: Network.TimeSinceEpoch,
    isThirdParty: Schema.Boolean,
    usageRestriction: OriginTrialUsageRestriction
  }).annotate({ identifier: "Page.OriginTrialToken" })
) as any as Schema.Codec<OriginTrialToken>

/**
 * Origin Trial(https://www.chromium.org/blink/origin-trials) support.
 * Status for an Origin Trial token.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type OriginTrialTokenStatus =
  | "Success"
  | "NotSupported"
  | "Insecure"
  | "Expired"
  | "WrongOrigin"
  | "InvalidSignature"
  | "Malformed"
  | "WrongVersion"
  | "FeatureDisabled"
  | "TokenDisabled"
  | "FeatureDisabledForUser"
  | "UnknownTrial"
  | (string & {})

/**
 * Schema for `OriginTrialTokenStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OriginTrialTokenStatus = Schema.String as any as Schema.Codec<OriginTrialTokenStatus>

/**
 * `OriginTrialTokenWithStatus`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OriginTrialTokenWithStatus {
  readonly rawTokenText: string
  /**
   * `parsedToken` is present only when the token is extractable and
   * parsable.
   */
  readonly parsedToken?: OriginTrialToken | undefined
  readonly status: OriginTrialTokenStatus
}

/**
 * Schema for `OriginTrialTokenWithStatus`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OriginTrialTokenWithStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rawTokenText: Schema.String,
    parsedToken: Schema.optional(OriginTrialToken),
    status: OriginTrialTokenStatus
  }).annotate({ identifier: "Page.OriginTrialTokenWithStatus" })
) as any as Schema.Codec<OriginTrialTokenWithStatus>

/**
 * `OriginTrialUsageRestriction` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type OriginTrialUsageRestriction =
  | "None"
  | "Subset"
  | (string & {})

/**
 * Schema for `OriginTrialUsageRestriction`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OriginTrialUsageRestriction = Schema.String as any as Schema.Codec<OriginTrialUsageRestriction>

/**
 * `PermissionsPolicyBlockLocator`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PermissionsPolicyBlockLocator {
  readonly frameId: FrameId
  readonly blockReason: PermissionsPolicyBlockReason
}

/**
 * Schema for `PermissionsPolicyBlockLocator`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionsPolicyBlockLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    blockReason: PermissionsPolicyBlockReason
  }).annotate({ identifier: "Page.PermissionsPolicyBlockLocator" })
) as any as Schema.Codec<PermissionsPolicyBlockLocator>

/**
 * Reason for a permissions policy feature to be disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PermissionsPolicyBlockReason =
  | "Header"
  | "IframeAttribute"
  | "InFencedFrameTree"
  | "InIsolatedApp"
  | (string & {})

/**
 * Schema for `PermissionsPolicyBlockReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionsPolicyBlockReason = Schema.String as any as Schema.Codec<PermissionsPolicyBlockReason>

/**
 * All Permissions Policy features. This enum should match the one defined
 * in services/network/public/cpp/permissions_policy/permissions_policy_features.json5.
 * LINT.IfChange(PermissionsPolicyFeature)
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PermissionsPolicyFeature =
  | "accelerometer"
  | "all-screens-capture"
  | "ambient-light-sensor"
  | "aria-notify"
  | "autofill"
  | "autoplay"
  | "bluetooth"
  | "browsing-topics"
  | "camera"
  | "captured-surface-control"
  | "ch-dpr"
  | "ch-device-memory"
  | "ch-downlink"
  | "ch-ect"
  | "ch-prefers-color-scheme"
  | "ch-prefers-reduced-motion"
  | "ch-prefers-reduced-transparency"
  | "ch-rtt"
  | "ch-save-data"
  | "ch-ua"
  | "ch-ua-arch"
  | "ch-ua-bitness"
  | "ch-ua-high-entropy-values"
  | "ch-ua-platform"
  | "ch-ua-model"
  | "ch-ua-mobile"
  | "ch-ua-form-factors"
  | "ch-ua-full-version"
  | "ch-ua-full-version-list"
  | "ch-ua-platform-version"
  | "ch-ua-wow64"
  | "ch-viewport-height"
  | "ch-viewport-width"
  | "ch-width"
  | "clipboard-read"
  | "clipboard-write"
  | "compute-pressure"
  | "controlled-frame"
  | "cross-origin-isolated"
  | "deferred-fetch"
  | "deferred-fetch-minimal"
  | "device-attributes"
  | "digital-credentials-create"
  | "digital-credentials-get"
  | "direct-sockets"
  | "direct-sockets-multicast"
  | "display-capture"
  | "document-domain"
  | "encrypted-media"
  | "execution-while-out-of-viewport"
  | "execution-while-not-rendered"
  | "focus-without-user-activation"
  | "fullscreen"
  | "frobulate"
  | "gamepad"
  | "geolocation"
  | "gyroscope"
  | "haptics"
  | "hid"
  | "identity-credentials-get"
  | "idle-detection"
  | "interest-cohort"
  | "keyboard-map"
  | "language-detector"
  | "language-model"
  | "local-fonts"
  | "local-network"
  | "local-network-access"
  | "loopback-network"
  | "magnetometer"
  | "manual-text"
  | "media-playback-while-not-visible"
  | "microphone"
  | "midi"
  | "on-device-speech-recognition"
  | "otp-credentials"
  | "payment"
  | "picture-in-picture"
  | "private-state-token-issuance"
  | "private-state-token-redemption"
  | "publickey-credentials-create"
  | "publickey-credentials-get"
  | "rewriter"
  | "screen-wake-lock"
  | "serial"
  | "shared-storage"
  | "shared-storage-select-url"
  | "smart-card"
  | "speaker-selection"
  | "storage-access"
  | "sub-apps"
  | "summarizer"
  | "sync-xhr"
  | "tools"
  | "translator"
  | "unload"
  | "usb"
  | "usb-unrestricted"
  | "vertical-scroll"
  | "web-app-installation"
  | "webnn"
  | "web-printing"
  | "web-share"
  | "window-management"
  | "writer"
  | "xr-spatial-tracking"
  | (string & {})

/**
 * Schema for `PermissionsPolicyFeature`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionsPolicyFeature = Schema.String as any as Schema.Codec<PermissionsPolicyFeature>

/**
 * `PermissionsPolicyFeatureState`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PermissionsPolicyFeatureState {
  readonly feature: PermissionsPolicyFeature
  readonly allowed: boolean
  readonly locator?: PermissionsPolicyBlockLocator | undefined
}

/**
 * Schema for `PermissionsPolicyFeatureState`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionsPolicyFeatureState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    feature: PermissionsPolicyFeature,
    allowed: Schema.Boolean,
    locator: Schema.optional(PermissionsPolicyBlockLocator)
  }).annotate({ identifier: "Page.PermissionsPolicyFeatureState" })
) as any as Schema.Codec<PermissionsPolicyFeatureState>

/**
 * `ProtocolHandler`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ProtocolHandler {
  readonly protocol: string
  readonly url: string
}

/**
 * Schema for `ProtocolHandler`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ProtocolHandler = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: Schema.String,
    url: Schema.String
  }).annotate({ identifier: "Page.ProtocolHandler" })
) as any as Schema.Codec<ProtocolHandler>

/**
 * The referring-policy used for the navigation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ReferrerPolicy =
  | "noReferrer"
  | "noReferrerWhenDowngrade"
  | "origin"
  | "originWhenCrossOrigin"
  | "sameOrigin"
  | "strictOrigin"
  | "strictOriginWhenCrossOrigin"
  | "unsafeUrl"
  | (string & {})

/**
 * Schema for `ReferrerPolicy`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReferrerPolicy = Schema.String as any as Schema.Codec<ReferrerPolicy>

/**
 * `RelatedApplication`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RelatedApplication {
  readonly id?: string | undefined
  readonly url: string
}

/**
 * Schema for `RelatedApplication`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RelatedApplication = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.optional(Schema.String),
    url: Schema.String
  }).annotate({ identifier: "Page.RelatedApplication" })
) as any as Schema.Codec<RelatedApplication>

/**
 * `ScopeExtension`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScopeExtension {
  /**
   * Instead of using tuple, this field always returns the serialized string
   * for easy understanding and comparison.
   */
  readonly origin: string
  readonly hasOriginWildcard: boolean
}

/**
 * Schema for `ScopeExtension`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScopeExtension = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    hasOriginWildcard: Schema.Boolean
  }).annotate({ identifier: "Page.ScopeExtension" })
) as any as Schema.Codec<ScopeExtension>

/**
 * Screencast frame metadata.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreencastFrameMetadata {
  /**
   * Top offset in DIP.
   */
  readonly offsetTop: number
  /**
   * Page scale factor.
   */
  readonly pageScaleFactor: number
  /**
   * Device screen width in DIP.
   */
  readonly deviceWidth: number
  /**
   * Device screen height in DIP.
   */
  readonly deviceHeight: number
  /**
   * Position of horizontal scroll in CSS pixels.
   */
  readonly scrollOffsetX: number
  /**
   * Position of vertical scroll in CSS pixels.
   */
  readonly scrollOffsetY: number
  /**
   * Frame swap timestamp.
   */
  readonly timestamp?: Network.TimeSinceEpoch | undefined
}

/**
 * Schema for `ScreencastFrameMetadata`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastFrameMetadata = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    offsetTop: Schema.Number,
    pageScaleFactor: Schema.Number,
    deviceWidth: Schema.Number,
    deviceHeight: Schema.Number,
    scrollOffsetX: Schema.Number,
    scrollOffsetY: Schema.Number,
    timestamp: Schema.optional(Network.TimeSinceEpoch)
  }).annotate({ identifier: "Page.ScreencastFrameMetadata" })
) as any as Schema.Codec<ScreencastFrameMetadata>

/**
 * `Screenshot`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Screenshot {
  readonly image: ImageResource
  readonly formFactor: string
  readonly label?: string | undefined
}

/**
 * Schema for `Screenshot`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Screenshot = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    image: ImageResource,
    formFactor: Schema.String,
    label: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.Screenshot" })
) as any as Schema.Codec<Screenshot>

/**
 * Font families collection for a script.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScriptFontFamilies {
  /**
   * Name of the script which these font families are defined for.
   */
  readonly script: string
  /**
   * Generic font families collection for the script.
   */
  readonly fontFamilies: FontFamilies
}

/**
 * Schema for `ScriptFontFamilies`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScriptFontFamilies = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    script: Schema.String,
    fontFamilies: FontFamilies
  }).annotate({ identifier: "Page.ScriptFontFamilies" })
) as any as Schema.Codec<ScriptFontFamilies>

/**
 * Unique script identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScriptIdentifier = Brand.Branded<string, "~@usestrider/browser/cdp/Page/ScriptIdentifier">

/**
 * Schema for `ScriptIdentifier`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptIdentifier = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Page/ScriptIdentifier")
) as any as Schema.Codec<ScriptIdentifier>

/**
 * Indicates whether the frame is a secure context and why it is the case.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SecureContextType =
  | "Secure"
  | "SecureLocalhost"
  | "InsecureScheme"
  | "InsecureAncestor"
  | (string & {})

/**
 * Schema for `SecureContextType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SecureContextType = Schema.String as any as Schema.Codec<SecureContextType>

/**
 * Additional information about the frame document's security origin.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SecurityOriginDetails {
  /**
   * Indicates whether the frame document's security origin is one
   * of the local hostnames (e.g. "localhost") or IP addresses (IPv4
   * 127.0.0.0/8 or IPv6 ::1).
   */
  readonly isLocalhost: boolean
}

/**
 * Schema for `SecurityOriginDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SecurityOriginDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isLocalhost: Schema.Boolean
  }).annotate({ identifier: "Page.SecurityOriginDetails" })
) as any as Schema.Codec<SecurityOriginDetails>

/**
 * `ShareTarget`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ShareTarget {
  readonly action: string
  readonly method: string
  readonly enctype: string
  /**
   * Embed the ShareTargetParams
   */
  readonly title?: string | undefined
  readonly text?: string | undefined
  readonly url?: string | undefined
  readonly files?: ReadonlyArray<FileFilter> | undefined
}

/**
 * Schema for `ShareTarget`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ShareTarget = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    action: Schema.String,
    method: Schema.String,
    enctype: Schema.String,
    title: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    files: Schema.optional(Schema.Array(FileFilter))
  }).annotate({ identifier: "Page.ShareTarget" })
) as any as Schema.Codec<ShareTarget>

/**
 * `Shortcut`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Shortcut {
  readonly name: string
  readonly url: string
}

/**
 * Schema for `Shortcut`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Shortcut = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    url: Schema.String
  }).annotate({ identifier: "Page.Shortcut" })
) as any as Schema.Codec<Shortcut>

/**
 * Transition type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TransitionType =
  | "link"
  | "typed"
  | "address_bar"
  | "auto_bookmark"
  | "auto_subframe"
  | "manual_subframe"
  | "generated"
  | "auto_toplevel"
  | "form_submit"
  | "reload"
  | "keyword"
  | "keyword_generated"
  | "other"
  | (string & {})

/**
 * Schema for `TransitionType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TransitionType = Schema.String as any as Schema.Codec<TransitionType>

/**
 * Viewport for capturing screenshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Viewport {
  /**
   * X offset in device independent pixels (dip).
   */
  readonly x: number
  /**
   * Y offset in device independent pixels (dip).
   */
  readonly y: number
  /**
   * Rectangle width in device independent pixels (dip).
   */
  readonly width: number
  /**
   * Rectangle height in device independent pixels (dip).
   */
  readonly height: number
  /**
   * Page scale factor.
   */
  readonly scale: number
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
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
    scale: Schema.Number
  }).annotate({ identifier: "Page.Viewport" })
) as any as Schema.Codec<Viewport>

/**
 * Visual viewport position, dimensions, and scale.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VisualViewport {
  /**
   * Horizontal offset relative to the layout viewport (CSS pixels).
   */
  readonly offsetX: number
  /**
   * Vertical offset relative to the layout viewport (CSS pixels).
   */
  readonly offsetY: number
  /**
   * Horizontal offset relative to the document (CSS pixels).
   */
  readonly pageX: number
  /**
   * Vertical offset relative to the document (CSS pixels).
   */
  readonly pageY: number
  /**
   * Width (CSS pixels), excludes scrollbar if present.
   */
  readonly clientWidth: number
  /**
   * Height (CSS pixels), excludes scrollbar if present.
   */
  readonly clientHeight: number
  /**
   * Scale relative to the ideal viewport (size at width=device-width).
   */
  readonly scale: number
  /**
   * Page zoom factor (CSS to device independent pixels ratio).
   */
  readonly zoom?: number | undefined
}

/**
 * Schema for `VisualViewport`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VisualViewport = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    offsetX: Schema.Number,
    offsetY: Schema.Number,
    pageX: Schema.Number,
    pageY: Schema.Number,
    clientWidth: Schema.Number,
    clientHeight: Schema.Number,
    scale: Schema.Number,
    zoom: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Page.VisualViewport" })
) as any as Schema.Codec<VisualViewport>

/**
 * `WebAppManifest`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WebAppManifest {
  readonly backgroundColor?: string | undefined
  /**
   * The extra description provided by the manifest.
   */
  readonly description?: string | undefined
  readonly dir?: string | undefined
  readonly display?: string | undefined
  /**
   * The overrided display mode controlled by the user.
   */
  readonly displayOverrides?: ReadonlyArray<string> | undefined
  /**
   * The handlers to open files.
   */
  readonly fileHandlers?: ReadonlyArray<FileHandler> | undefined
  readonly icons?: ReadonlyArray<ImageResource> | undefined
  readonly id?: string | undefined
  readonly lang?: string | undefined
  /**
   * TODO(crbug.com/1231886): This field is non-standard and part of a Chrome
   * experiment. See:
   * https://github.com/WICG/web-app-launch/blob/main/launch_handler.md
   */
  readonly launchHandler?: LaunchHandler | undefined
  readonly name?: string | undefined
  readonly orientation?: string | undefined
  readonly preferRelatedApplications?: boolean | undefined
  /**
   * The handlers to open protocols.
   */
  readonly protocolHandlers?: ReadonlyArray<ProtocolHandler> | undefined
  readonly relatedApplications?: ReadonlyArray<RelatedApplication> | undefined
  readonly scope?: string | undefined
  /**
   * Non-standard, see
   * https://github.com/WICG/manifest-incubations/blob/gh-pages/scope_extensions-explainer.md
   */
  readonly scopeExtensions?: ReadonlyArray<ScopeExtension> | undefined
  /**
   * The screenshots used by chromium.
   */
  readonly screenshots?: ReadonlyArray<Screenshot> | undefined
  readonly shareTarget?: ShareTarget | undefined
  readonly shortName?: string | undefined
  readonly shortcuts?: ReadonlyArray<Shortcut> | undefined
  readonly startUrl?: string | undefined
  readonly themeColor?: string | undefined
}

/**
 * Schema for `WebAppManifest`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WebAppManifest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backgroundColor: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    dir: Schema.optional(Schema.String),
    display: Schema.optional(Schema.String),
    displayOverrides: Schema.optional(Schema.Array(Schema.String)),
    fileHandlers: Schema.optional(Schema.Array(FileHandler)),
    icons: Schema.optional(Schema.Array(ImageResource)),
    id: Schema.optional(Schema.String),
    lang: Schema.optional(Schema.String),
    launchHandler: Schema.optional(LaunchHandler),
    name: Schema.optional(Schema.String),
    orientation: Schema.optional(Schema.String),
    preferRelatedApplications: Schema.optional(Schema.Boolean),
    protocolHandlers: Schema.optional(Schema.Array(ProtocolHandler)),
    relatedApplications: Schema.optional(Schema.Array(RelatedApplication)),
    scope: Schema.optional(Schema.String),
    scopeExtensions: Schema.optional(Schema.Array(ScopeExtension)),
    screenshots: Schema.optional(Schema.Array(Screenshot)),
    shareTarget: Schema.optional(ShareTarget),
    shortName: Schema.optional(Schema.String),
    shortcuts: Schema.optional(Schema.Array(Shortcut)),
    startUrl: Schema.optional(Schema.String),
    themeColor: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.WebAppManifest" })
) as any as Schema.Codec<WebAppManifest>

/**
 * Seeds compilation cache for given url. Compilation cache does not survive
 * cross-process navigation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddCompilationCacheParams {
  readonly url: string
  /**
   * Base64-encoded data (Encoded as a base64 string when passed over JSON)
   */
  readonly data: string
}

/**
 * Schema for `AddCompilationCacheParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddCompilationCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    data: Schema.String
  }).annotate({ identifier: "Page.AddCompilationCacheParams" })
) as any as Schema.Codec<AddCompilationCacheParams>

/**
 * Evaluates given script in every frame upon creation (before loading frame's scripts).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddScriptToEvaluateOnNewDocumentParams {
  readonly source: string
  /**
   * If specified, creates an isolated world with the given name and evaluates given script in it.
   * This world name will be used as the ExecutionContextDescription::name when the corresponding
   * event is emitted.
   */
  readonly worldName?: string | undefined
  /**
   * Specifies whether command line API should be available to the script, defaults
   * to false.
   */
  readonly includeCommandLineAPI?: boolean | undefined
  /**
   * If true, runs the script immediately on existing execution contexts or worlds.
   * Default: false.
   */
  readonly runImmediately?: boolean | undefined
}

/**
 * Schema for `AddScriptToEvaluateOnNewDocumentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddScriptToEvaluateOnNewDocumentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: Schema.String,
    worldName: Schema.optional(Schema.String),
    includeCommandLineAPI: Schema.optional(Schema.Boolean),
    runImmediately: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.AddScriptToEvaluateOnNewDocumentParams" })
) as any as Schema.Codec<AddScriptToEvaluateOnNewDocumentParams>

/**
 * Evaluates given script in every frame upon creation (before loading frame's scripts).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddScriptToEvaluateOnNewDocumentResult {
  /**
   * Identifier of the added script.
   */
  readonly identifier: ScriptIdentifier
}

/**
 * Schema for `AddScriptToEvaluateOnNewDocumentResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddScriptToEvaluateOnNewDocumentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: ScriptIdentifier
  }).annotate({ identifier: "Page.AddScriptToEvaluateOnNewDocumentResult" })
) as any as Schema.Codec<AddScriptToEvaluateOnNewDocumentResult>

/**
 * Fired for failed bfcache history navigations if BackForwardCache feature is enabled. Do
 * not assume any ordering with the Page.frameNavigated event. This event is fired only for
 * main-frame history navigation where the document changes (non-same-document navigations),
 * when bfcache navigation fails.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BackForwardCacheNotUsedParams {
  /**
   * The loader id for the associated navigation.
   */
  readonly loaderId: Network.LoaderId
  /**
   * The frame id of the associated frame.
   */
  readonly frameId: FrameId
  /**
   * Array of reasons why the page could not be cached. This must not be empty.
   */
  readonly notRestoredExplanations: ReadonlyArray<BackForwardCacheNotRestoredExplanation>
  /**
   * Tree structure of reasons why the page could not be cached for each frame.
   */
  readonly notRestoredExplanationsTree?: BackForwardCacheNotRestoredExplanationTree | undefined
}

/**
 * Schema for `BackForwardCacheNotUsedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackForwardCacheNotUsedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    loaderId: Network.LoaderId,
    frameId: FrameId,
    notRestoredExplanations: Schema.Array(BackForwardCacheNotRestoredExplanation),
    notRestoredExplanationsTree: Schema.optional(BackForwardCacheNotRestoredExplanationTree)
  }).annotate({ identifier: "Page.BackForwardCacheNotUsedParams" })
) as any as Schema.Codec<BackForwardCacheNotUsedParams>

/**
 * Capture page screenshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CaptureScreenshotParams {
  /**
   * Image compression format (defaults to png).
   */
  readonly format?: CaptureScreenshotParamsFormat | undefined
  /**
   * Compression quality from range [0..100] (jpeg only).
   */
  readonly quality?: number | undefined
  /**
   * Capture the screenshot of a given region only.
   */
  readonly clip?: Viewport | undefined
  /**
   * Capture the screenshot from the surface, rather than the view. Defaults to true.
   */
  readonly fromSurface?: boolean | undefined
  /**
   * Capture the screenshot beyond the viewport. Defaults to false.
   */
  readonly captureBeyondViewport?: boolean | undefined
  /**
   * Optimize image encoding for speed, not for resulting size (defaults to false)
   */
  readonly optimizeForSpeed?: boolean | undefined
}

/**
 * Schema for `CaptureScreenshotParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CaptureScreenshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    format: Schema.optional(CaptureScreenshotParamsFormat),
    quality: Schema.optional(Schema.Int),
    clip: Schema.optional(Viewport),
    fromSurface: Schema.optional(Schema.Boolean),
    captureBeyondViewport: Schema.optional(Schema.Boolean),
    optimizeForSpeed: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.CaptureScreenshotParams" })
) as any as Schema.Codec<CaptureScreenshotParams>

/**
 * Image compression format (defaults to png).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CaptureScreenshotParamsFormat =
  | "jpeg"
  | "png"
  | "webp"
  | (string & {})

/**
 * Schema for `CaptureScreenshotParamsFormat`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CaptureScreenshotParamsFormat = Schema.String as any as Schema.Codec<CaptureScreenshotParamsFormat>

/**
 * Capture page screenshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CaptureScreenshotResult {
  /**
   * Base64-encoded image data. (Encoded as a base64 string when passed over JSON)
   */
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
  }).annotate({ identifier: "Page.CaptureScreenshotResult" })
) as any as Schema.Codec<CaptureScreenshotResult>

/**
 * Returns a snapshot of the page as a string. For MHTML format, the serialization includes
 * iframes, shadow DOM, external resources, and element-inline styles.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CaptureSnapshotParams {
  /**
   * Format (defaults to mhtml).
   */
  readonly format?: CaptureSnapshotParamsFormat | undefined
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
    format: Schema.optional(CaptureSnapshotParamsFormat)
  }).annotate({ identifier: "Page.CaptureSnapshotParams" })
) as any as Schema.Codec<CaptureSnapshotParams>

/**
 * Format (defaults to mhtml).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CaptureSnapshotParamsFormat =
  | "mhtml"
  | (string & {})

/**
 * Schema for `CaptureSnapshotParamsFormat`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CaptureSnapshotParamsFormat = Schema.String as any as Schema.Codec<CaptureSnapshotParamsFormat>

/**
 * Returns a snapshot of the page as a string. For MHTML format, the serialization includes
 * iframes, shadow DOM, external resources, and element-inline styles.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CaptureSnapshotResult {
  /**
   * Serialized page data.
   */
  readonly data: string
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
    data: Schema.String
  }).annotate({ identifier: "Page.CaptureSnapshotResult" })
) as any as Schema.Codec<CaptureSnapshotResult>

/**
 * Issued for every compilation cache generated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CompilationCacheProducedParams {
  readonly url: string
  /**
   * Base64-encoded data (Encoded as a base64 string when passed over JSON)
   */
  readonly data: string
}

/**
 * Schema for `CompilationCacheProducedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CompilationCacheProducedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    data: Schema.String
  }).annotate({ identifier: "Page.CompilationCacheProducedParams" })
) as any as Schema.Codec<CompilationCacheProducedParams>

/**
 * Creates an isolated world for the given frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateIsolatedWorldParams {
  /**
   * Id of the frame in which the isolated world should be created.
   */
  readonly frameId: FrameId
  /**
   * An optional name which is reported in the Execution Context.
   */
  readonly worldName?: string | undefined
  /**
   * Whether or not universal access should be granted to the isolated world. This is a powerful
   * option, use with caution.
   */
  readonly grantUniveralAccess?: boolean | undefined
  /**
   * An optional content security policy to set for the isolated world.
   * If omitted, any existing CSP for the world will be cleared.
   * Note that clearing or updating the CSP does not immediately affect the active
   * context in the same document because LocalDOMWindow caches the
   * ContentSecurityPolicy object. The change takes effect on subsequent
   * navigations when a new window context is created.
   */
  readonly contentSecurityPolicy?: string | undefined
}

/**
 * Schema for `CreateIsolatedWorldParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateIsolatedWorldParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    worldName: Schema.optional(Schema.String),
    grantUniveralAccess: Schema.optional(Schema.Boolean),
    contentSecurityPolicy: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.CreateIsolatedWorldParams" })
) as any as Schema.Codec<CreateIsolatedWorldParams>

/**
 * Creates an isolated world for the given frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateIsolatedWorldResult {
  /**
   * Execution context of the isolated world.
   */
  readonly executionContextId: Runtime.ExecutionContextId
}

/**
 * Schema for `CreateIsolatedWorldResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateIsolatedWorldResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    executionContextId: Runtime.ExecutionContextId
  }).annotate({ identifier: "Page.CreateIsolatedWorldResult" })
) as any as Schema.Codec<CreateIsolatedWorldResult>

/**
 * Fired when opening document to write to.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DocumentOpenedParams {
  /**
   * Frame object.
   */
  readonly frame: Frame
}

/**
 * Schema for `DocumentOpenedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DocumentOpenedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frame: Frame
  }).annotate({ identifier: "Page.DocumentOpenedParams" })
) as any as Schema.Codec<DocumentOpenedParams>

/**
 * `domContentEventFired.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DomContentEventFiredParams {
  readonly timestamp: Network.MonotonicTime
}

/**
 * Schema for `DomContentEventFiredParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DomContentEventFiredParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Network.MonotonicTime
  }).annotate({ identifier: "Page.DomContentEventFiredParams" })
) as any as Schema.Codec<DomContentEventFiredParams>

/**
 * Enables page domain notifications.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * If true, the `Page.fileChooserOpened` event will be emitted regardless of the state set by
   * `Page.setInterceptFileChooserDialog` command (default: false).
   */
  readonly enableFileChooserOpenedEvent?: boolean | undefined
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
    enableFileChooserOpenedEvent: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Emitted only when `page.interceptFileChooser` is enabled.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FileChooserOpenedParams {
  /**
   * Id of the frame containing input node.
   */
  readonly frameId?: FrameId | undefined
  /**
   * Input mode.
   */
  readonly mode: FileChooserOpenedParamsMode
  /**
   * Input node id. Only present for file choosers opened via an `<input type="file">` element.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `FileChooserOpenedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileChooserOpenedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Schema.optional(FrameId),
    mode: FileChooserOpenedParamsMode,
    backendNodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "Page.FileChooserOpenedParams" })
) as any as Schema.Codec<FileChooserOpenedParams>

/**
 * Input mode.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FileChooserOpenedParamsMode =
  | "selectSingle"
  | "selectMultiple"
  | (string & {})

/**
 * Schema for `FileChooserOpenedParamsMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileChooserOpenedParamsMode = Schema.String as any as Schema.Codec<FileChooserOpenedParamsMode>

/**
 * Fired when frame has been attached to its parent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameAttachedParams {
  /**
   * Id of the frame that has been attached.
   */
  readonly frameId: FrameId
  /**
   * Parent frame identifier.
   */
  readonly parentFrameId: FrameId
  /**
   * JavaScript stack trace of when frame was attached, only set if frame initiated from script.
   */
  readonly stack?: Runtime.StackTrace | undefined
}

/**
 * Schema for `FrameAttachedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameAttachedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    parentFrameId: FrameId,
    stack: Schema.optional(Runtime.StackTrace)
  }).annotate({ identifier: "Page.FrameAttachedParams" })
) as any as Schema.Codec<FrameAttachedParams>

/**
 * Fired when frame has been detached from its parent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameDetachedParams {
  /**
   * Id of the frame that has been detached.
   */
  readonly frameId: FrameId
  readonly reason?: FrameDetachedParamsReason | undefined
}

/**
 * Schema for `FrameDetachedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameDetachedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    reason: Schema.optional(FrameDetachedParamsReason)
  }).annotate({ identifier: "Page.FrameDetachedParams" })
) as any as Schema.Codec<FrameDetachedParams>

/**
 * `frameDetached.Params.reason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type FrameDetachedParamsReason =
  | "remove"
  | "swap"
  | (string & {})

/**
 * Schema for `FrameDetachedParamsReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameDetachedParamsReason = Schema.String as any as Schema.Codec<FrameDetachedParamsReason>

/**
 * Fired once navigation of the frame has completed. Frame is now associated with the new loader.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameNavigatedParams {
  /**
   * Frame object.
   */
  readonly frame: Frame
  readonly type?: NavigationType | undefined
}

/**
 * Schema for `FrameNavigatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameNavigatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frame: Frame,
    type: Schema.optional(NavigationType)
  }).annotate({ identifier: "Page.FrameNavigatedParams" })
) as any as Schema.Codec<FrameNavigatedParams>

/**
 * Fired when a renderer-initiated navigation is requested.
 * Navigation may still be cancelled after the event is issued.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameRequestedNavigationParams {
  /**
   * Id of the frame that is being navigated.
   */
  readonly frameId: FrameId
  /**
   * The reason for the navigation.
   */
  readonly reason: ClientNavigationReason
  /**
   * The destination URL for the requested navigation.
   */
  readonly url: string
  /**
   * The disposition for the navigation.
   */
  readonly disposition: ClientNavigationDisposition
}

/**
 * Schema for `FrameRequestedNavigationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameRequestedNavigationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    reason: ClientNavigationReason,
    url: Schema.String,
    disposition: ClientNavigationDisposition
  }).annotate({ identifier: "Page.FrameRequestedNavigationParams" })
) as any as Schema.Codec<FrameRequestedNavigationParams>

/**
 * Fired when frame has started loading.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameStartedLoadingParams {
  /**
   * Id of the frame that has started loading.
   */
  readonly frameId: FrameId
}

/**
 * Schema for `FrameStartedLoadingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameStartedLoadingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId
  }).annotate({ identifier: "Page.FrameStartedLoadingParams" })
) as any as Schema.Codec<FrameStartedLoadingParams>

/**
 * Fired when a navigation starts. This event is fired for both
 * renderer-initiated and browser-initiated navigations. For renderer-initiated
 * navigations, the event is fired after `frameRequestedNavigation`.
 * Navigation may still be cancelled after the event is issued. Multiple events
 * can be fired for a single navigation, for example, when a same-document
 * navigation becomes a cross-document navigation (such as in the case of a
 * frameset).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameStartedNavigatingParams {
  /**
   * ID of the frame that is being navigated.
   */
  readonly frameId: FrameId
  /**
   * The URL the navigation started with. The final URL can be different.
   */
  readonly url: string
  /**
   * Loader identifier. Even though it is present in case of same-document
   * navigation, the previously committed loaderId would not change unless
   * the navigation changes from a same-document to a cross-document
   * navigation.
   */
  readonly loaderId: Network.LoaderId
  readonly navigationType: FrameStartedNavigatingParamsNavigationType
}

/**
 * Schema for `FrameStartedNavigatingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameStartedNavigatingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    url: Schema.String,
    loaderId: Network.LoaderId,
    navigationType: FrameStartedNavigatingParamsNavigationType
  }).annotate({ identifier: "Page.FrameStartedNavigatingParams" })
) as any as Schema.Codec<FrameStartedNavigatingParams>

/**
 * `frameStartedNavigating.Params.navigationType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FrameStartedNavigatingParamsNavigationType =
  | "reload"
  | "reloadBypassingCache"
  | "restore"
  | "restoreWithPost"
  | "historySameDocument"
  | "historyDifferentDocument"
  | "sameDocument"
  | "differentDocument"
  | (string & {})

/**
 * Schema for `FrameStartedNavigatingParamsNavigationType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameStartedNavigatingParamsNavigationType = Schema.String as any as Schema.Codec<
  FrameStartedNavigatingParamsNavigationType
>

/**
 * Fired when frame has stopped loading.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameStoppedLoadingParams {
  /**
   * Id of the frame that has stopped loading.
   */
  readonly frameId: FrameId
}

/**
 * Schema for `FrameStoppedLoadingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameStoppedLoadingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId
  }).annotate({ identifier: "Page.FrameStoppedLoadingParams" })
) as any as Schema.Codec<FrameStoppedLoadingParams>

/**
 * Fired before frame subtree is detached. Emitted before any frame of the
 * subtree is actually detached.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FrameSubtreeWillBeDetachedParams {
  /**
   * Id of the frame that is the root of the subtree that will be detached.
   */
  readonly frameId: FrameId
}

/**
 * Schema for `FrameSubtreeWillBeDetachedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FrameSubtreeWillBeDetachedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId
  }).annotate({ identifier: "Page.FrameSubtreeWillBeDetachedParams" })
) as any as Schema.Codec<FrameSubtreeWillBeDetachedParams>

/**
 * Generates a report for testing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GenerateTestReportParams {
  /**
   * Message to be displayed in the report.
   */
  readonly message: string
  /**
   * Specifies the endpoint group to deliver the report to.
   */
  readonly group?: string | undefined
}

/**
 * Schema for `GenerateTestReportParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GenerateTestReportParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.String,
    group: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.GenerateTestReportParams" })
) as any as Schema.Codec<GenerateTestReportParams>

/**
 * `getAdScriptAncestry.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAdScriptAncestryParams {
  readonly frameId: FrameId
}

/**
 * Schema for `GetAdScriptAncestryParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAdScriptAncestryParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId
  }).annotate({ identifier: "Page.GetAdScriptAncestryParams" })
) as any as Schema.Codec<GetAdScriptAncestryParams>

/**
 * `getAdScriptAncestry.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAdScriptAncestryResult {
  /**
   * The ancestry chain of ad script identifiers leading to this frame's
   * creation, along with the root script's filterlist rule. The ancestry
   * chain is ordered from the most immediate script (in the frame creation
   * stack) to more distant ancestors (that created the immediately preceding
   * script). Only sent if frame is labelled as an ad and ids are available.
   */
  readonly adScriptAncestry?: Network.AdAncestry | undefined
}

/**
 * Schema for `GetAdScriptAncestryResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAdScriptAncestryResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    adScriptAncestry: Schema.optional(Network.AdAncestry)
  }).annotate({ identifier: "Page.GetAdScriptAncestryResult" })
) as any as Schema.Codec<GetAdScriptAncestryResult>

/**
 * Get the annotated page content for the main frame.
 * This is an experimental command that is subject to change.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAnnotatedPageContentParams {
  /**
   * Whether to include actionable information. Defaults to true.
   */
  readonly includeActionableInformation?: boolean | undefined
}

/**
 * Schema for `GetAnnotatedPageContentParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAnnotatedPageContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    includeActionableInformation: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.GetAnnotatedPageContentParams" })
) as any as Schema.Codec<GetAnnotatedPageContentParams>

/**
 * Get the annotated page content for the main frame.
 * This is an experimental command that is subject to change.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAnnotatedPageContentResult {
  /**
   * The annotated page content as a base64 encoded protobuf.
   * The format is defined by the `AnnotatedPageContent` message in
   * components/optimization_guide/proto/features/common_quality_data.proto (Encoded as a base64 string when passed over JSON)
   */
  readonly content: string
}

/**
 * Schema for `GetAnnotatedPageContentResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAnnotatedPageContentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    content: Schema.String
  }).annotate({ identifier: "Page.GetAnnotatedPageContentResult" })
) as any as Schema.Codec<GetAnnotatedPageContentResult>

/**
 * Returns the unique (PWA) app id.
 * Only returns values if the feature flag 'WebAppEnableManifestId' is enabled
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAppIdResult {
  /**
   * App id, either from manifest's id attribute or computed from start_url
   */
  readonly appId?: string | undefined
  /**
   * Recommendation for manifest's id attribute to match current id computed from start_url
   */
  readonly recommendedId?: string | undefined
}

/**
 * Schema for `GetAppIdResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAppIdResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    appId: Schema.optional(Schema.String),
    recommendedId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.GetAppIdResult" })
) as any as Schema.Codec<GetAppIdResult>

/**
 * Gets the processed manifest for this current document.
 *   This API always waits for the manifest to be loaded.
 *   If manifestId is provided, and it does not match the manifest of the
 *     current document, this API errors out.
 *   If there is not a loaded page, this API errors out immediately.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAppManifestParams {
  readonly manifestId?: string | undefined
}

/**
 * Schema for `GetAppManifestParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAppManifestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.GetAppManifestParams" })
) as any as Schema.Codec<GetAppManifestParams>

/**
 * Gets the processed manifest for this current document.
 *   This API always waits for the manifest to be loaded.
 *   If manifestId is provided, and it does not match the manifest of the
 *     current document, this API errors out.
 *   If there is not a loaded page, this API errors out immediately.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAppManifestResult {
  /**
   * Manifest location.
   */
  readonly url: string
  readonly errors: ReadonlyArray<AppManifestError>
  /**
   * Manifest content.
   */
  readonly data?: string | undefined
  readonly manifest?: WebAppManifest | undefined
}

/**
 * Schema for `GetAppManifestResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAppManifestResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    errors: Schema.Array(AppManifestError),
    data: Schema.optional(Schema.String),
    manifest: Schema.optional(WebAppManifest)
  }).annotate({ identifier: "Page.GetAppManifestResult" })
) as any as Schema.Codec<GetAppManifestResult>

/**
 * Returns present frame tree structure.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetFrameTreeResult {
  /**
   * Present frame tree structure.
   */
  readonly frameTree: FrameTree
}

/**
 * Schema for `GetFrameTreeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetFrameTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameTree: FrameTree
  }).annotate({ identifier: "Page.GetFrameTreeResult" })
) as any as Schema.Codec<GetFrameTreeResult>

/**
 * `getInstallabilityErrors.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetInstallabilityErrorsResult {
  readonly installabilityErrors: ReadonlyArray<InstallabilityError>
}

/**
 * Schema for `GetInstallabilityErrorsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetInstallabilityErrorsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    installabilityErrors: Schema.Array(InstallabilityError)
  }).annotate({ identifier: "Page.GetInstallabilityErrorsResult" })
) as any as Schema.Codec<GetInstallabilityErrorsResult>

/**
 * Returns metrics relating to the layouting of the page, such as viewport bounds/scale.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetLayoutMetricsResult {
  /**
   * Metrics relating to the layout viewport in CSS pixels.
   */
  readonly cssLayoutViewport: LayoutViewport
  /**
   * Metrics relating to the visual viewport in CSS pixels.
   */
  readonly cssVisualViewport: VisualViewport
  /**
   * Size of scrollable area in CSS pixels.
   */
  readonly cssContentSize: DOM.Rect
}

/**
 * Schema for `GetLayoutMetricsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetLayoutMetricsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cssLayoutViewport: LayoutViewport,
    cssVisualViewport: VisualViewport,
    cssContentSize: DOM.Rect
  }).annotate({ identifier: "Page.GetLayoutMetricsResult" })
) as any as Schema.Codec<GetLayoutMetricsResult>

/**
 * Returns navigation history for the current page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetNavigationHistoryResult {
  /**
   * Index of the current navigation history entry.
   */
  readonly currentIndex: number
  /**
   * Array of navigation history entries.
   */
  readonly entries: ReadonlyArray<NavigationEntry>
}

/**
 * Schema for `GetNavigationHistoryResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetNavigationHistoryResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    currentIndex: Schema.Int,
    entries: Schema.Array(NavigationEntry)
  }).annotate({ identifier: "Page.GetNavigationHistoryResult" })
) as any as Schema.Codec<GetNavigationHistoryResult>

/**
 * Get Origin Trials on given frame.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetOriginTrialsParams {
  readonly frameId: FrameId
}

/**
 * Schema for `GetOriginTrialsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetOriginTrialsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId
  }).annotate({ identifier: "Page.GetOriginTrialsParams" })
) as any as Schema.Codec<GetOriginTrialsParams>

/**
 * Get Origin Trials on given frame.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetOriginTrialsResult {
  readonly originTrials: ReadonlyArray<OriginTrial>
}

/**
 * Schema for `GetOriginTrialsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetOriginTrialsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    originTrials: Schema.Array(OriginTrial)
  }).annotate({ identifier: "Page.GetOriginTrialsResult" })
) as any as Schema.Codec<GetOriginTrialsResult>

/**
 * Get Permissions Policy state on given frame.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPermissionsPolicyStateParams {
  readonly frameId: FrameId
}

/**
 * Schema for `GetPermissionsPolicyStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPermissionsPolicyStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId
  }).annotate({ identifier: "Page.GetPermissionsPolicyStateParams" })
) as any as Schema.Codec<GetPermissionsPolicyStateParams>

/**
 * Get Permissions Policy state on given frame.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPermissionsPolicyStateResult {
  readonly states: ReadonlyArray<PermissionsPolicyFeatureState>
}

/**
 * Schema for `GetPermissionsPolicyStateResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPermissionsPolicyStateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    states: Schema.Array(PermissionsPolicyFeatureState)
  }).annotate({ identifier: "Page.GetPermissionsPolicyStateResult" })
) as any as Schema.Codec<GetPermissionsPolicyStateResult>

/**
 * Returns content of the given resource.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetResourceContentParams {
  /**
   * Frame id to get resource for.
   */
  readonly frameId: FrameId
  /**
   * URL of the resource to get content for.
   */
  readonly url: string
}

/**
 * Schema for `GetResourceContentParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetResourceContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    url: Schema.String
  }).annotate({ identifier: "Page.GetResourceContentParams" })
) as any as Schema.Codec<GetResourceContentParams>

/**
 * Returns content of the given resource.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetResourceContentResult {
  /**
   * Resource content.
   */
  readonly content: string
  /**
   * True, if content was served as base64.
   */
  readonly base64Encoded: boolean
}

/**
 * Schema for `GetResourceContentResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetResourceContentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    content: Schema.String,
    base64Encoded: Schema.Boolean
  }).annotate({ identifier: "Page.GetResourceContentResult" })
) as any as Schema.Codec<GetResourceContentResult>

/**
 * Returns present frame / resource tree structure.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetResourceTreeResult {
  /**
   * Present frame / resource tree structure.
   */
  readonly frameTree: FrameResourceTree
}

/**
 * Schema for `GetResourceTreeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetResourceTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameTree: FrameResourceTree
  }).annotate({ identifier: "Page.GetResourceTreeResult" })
) as any as Schema.Codec<GetResourceTreeResult>

/**
 * Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HandleJavaScriptDialogParams {
  /**
   * Whether to accept or dismiss the dialog.
   */
  readonly accept: boolean
  /**
   * The text to enter into the dialog prompt before accepting. Used only if this is a prompt
   * dialog.
   */
  readonly promptText?: string | undefined
}

/**
 * Schema for `HandleJavaScriptDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HandleJavaScriptDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    accept: Schema.Boolean,
    promptText: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.HandleJavaScriptDialogParams" })
) as any as Schema.Codec<HandleJavaScriptDialogParams>

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) has been
 * closed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface JavascriptDialogClosedParams {
  /**
   * Frame id.
   */
  readonly frameId?: FrameId | undefined
  /**
   * Whether dialog was confirmed.
   */
  readonly result: boolean
  /**
   * User input in case of prompt.
   */
  readonly userInput: string
}

/**
 * Schema for `JavascriptDialogClosedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const JavascriptDialogClosedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Schema.optional(FrameId),
    result: Schema.Boolean,
    userInput: Schema.String
  }).annotate({ identifier: "Page.JavascriptDialogClosedParams" })
) as any as Schema.Codec<JavascriptDialogClosedParams>

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to
 * open.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface JavascriptDialogOpeningParams {
  /**
   * Frame url.
   */
  readonly url: string
  /**
   * Frame id.
   */
  readonly frameId?: FrameId | undefined
  /**
   * Message that will be displayed by the dialog.
   */
  readonly message: string
  /**
   * Dialog type.
   */
  readonly type: DialogType
  /**
   * True iff browser is capable showing or acting on the given dialog. When browser has no
   * dialog handler for given target, calling alert while Page domain is engaged will stall
   * the page execution. Execution can be resumed via calling Page.handleJavaScriptDialog.
   */
  readonly hasBrowserHandler: boolean
  /**
   * Default dialog prompt.
   */
  readonly defaultPrompt?: string | undefined
}

/**
 * Schema for `JavascriptDialogOpeningParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const JavascriptDialogOpeningParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    frameId: Schema.optional(FrameId),
    message: Schema.String,
    type: DialogType,
    hasBrowserHandler: Schema.Boolean,
    defaultPrompt: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.JavascriptDialogOpeningParams" })
) as any as Schema.Codec<JavascriptDialogOpeningParams>

/**
 * Fired for lifecycle events (navigation, load, paint, etc) in the current
 * target (including local frames).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LifecycleEventParams {
  /**
   * Id of the frame.
   */
  readonly frameId: FrameId
  /**
   * Loader identifier. Empty string if the request is fetched from worker.
   */
  readonly loaderId: Network.LoaderId
  readonly name: string
  readonly timestamp: Network.MonotonicTime
}

/**
 * Schema for `LifecycleEventParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LifecycleEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    loaderId: Network.LoaderId,
    name: Schema.String,
    timestamp: Network.MonotonicTime
  }).annotate({ identifier: "Page.LifecycleEventParams" })
) as any as Schema.Codec<LifecycleEventParams>

/**
 * `loadEventFired.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadEventFiredParams {
  readonly timestamp: Network.MonotonicTime
}

/**
 * Schema for `LoadEventFiredParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadEventFiredParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Network.MonotonicTime
  }).annotate({ identifier: "Page.LoadEventFiredParams" })
) as any as Schema.Codec<LoadEventFiredParams>

/**
 * Navigates current page to the given URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigateParams {
  /**
   * URL to navigate the page to.
   */
  readonly url: string
  /**
   * Referrer URL.
   */
  readonly referrer?: string | undefined
  /**
   * Intended transition type.
   */
  readonly transitionType?: TransitionType | undefined
  /**
   * Frame id to navigate, if not specified navigates the top frame.
   */
  readonly frameId?: FrameId | undefined
  /**
   * Referrer-policy used for the navigation.
   */
  readonly referrerPolicy?: ReferrerPolicy | undefined
}

/**
 * Schema for `NavigateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    referrer: Schema.optional(Schema.String),
    transitionType: Schema.optional(TransitionType),
    frameId: Schema.optional(FrameId),
    referrerPolicy: Schema.optional(ReferrerPolicy)
  }).annotate({ identifier: "Page.NavigateParams" })
) as any as Schema.Codec<NavigateParams>

/**
 * Navigates current page to the given URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigateResult {
  /**
   * Frame id that has navigated (or failed to navigate)
   */
  readonly frameId: FrameId
  /**
   * Loader identifier. This is omitted in case of same-document navigation,
   * as the previously committed loaderId would not change.
   */
  readonly loaderId?: Network.LoaderId | undefined
  /**
   * User friendly error message, present if and only if navigation has failed.
   */
  readonly errorText?: string | undefined
  /**
   * Whether the navigation resulted in a download.
   */
  readonly isDownload?: boolean | undefined
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
    frameId: FrameId,
    loaderId: Schema.optional(Network.LoaderId),
    errorText: Schema.optional(Schema.String),
    isDownload: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.NavigateResult" })
) as any as Schema.Codec<NavigateResult>

/**
 * Navigates current page to the given history entry.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigateToHistoryEntryParams {
  /**
   * Unique id of the entry to navigate to.
   */
  readonly entryId: number
}

/**
 * Schema for `NavigateToHistoryEntryParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigateToHistoryEntryParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    entryId: Schema.Int
  }).annotate({ identifier: "Page.NavigateToHistoryEntryParams" })
) as any as Schema.Codec<NavigateToHistoryEntryParams>

/**
 * Fired when same-document navigation happens, e.g. due to history API usage or anchor navigation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NavigatedWithinDocumentParams {
  /**
   * Id of the frame.
   */
  readonly frameId: FrameId
  /**
   * Frame's new url.
   */
  readonly url: string
  /**
   * Navigation type
   */
  readonly navigationType: NavigatedWithinDocumentParamsNavigationType
}

/**
 * Schema for `NavigatedWithinDocumentParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NavigatedWithinDocumentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    url: Schema.String,
    navigationType: NavigatedWithinDocumentParamsNavigationType
  }).annotate({ identifier: "Page.NavigatedWithinDocumentParams" })
) as any as Schema.Codec<NavigatedWithinDocumentParams>

/**
 * Navigation type
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NavigatedWithinDocumentParamsNavigationType =
  | "fragment"
  | "historyApi"
  | "other"
  | (string & {})

/**
 * Schema for `NavigatedWithinDocumentParamsNavigationType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigatedWithinDocumentParamsNavigationType = Schema.String as any as Schema.Codec<
  NavigatedWithinDocumentParamsNavigationType
>

/**
 * Print page as PDF.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PrintToPDFParams {
  /**
   * Paper orientation. Defaults to false.
   */
  readonly landscape?: boolean | undefined
  /**
   * Display header and footer. Defaults to false.
   */
  readonly displayHeaderFooter?: boolean | undefined
  /**
   * Print background graphics. Defaults to false.
   */
  readonly printBackground?: boolean | undefined
  /**
   * Scale of the webpage rendering. Defaults to 1.
   */
  readonly scale?: number | undefined
  /**
   * Paper width in inches. Defaults to 8.5 inches.
   */
  readonly paperWidth?: number | undefined
  /**
   * Paper height in inches. Defaults to 11 inches.
   */
  readonly paperHeight?: number | undefined
  /**
   * Top margin in inches. Defaults to 1cm (~0.4 inches).
   */
  readonly marginTop?: number | undefined
  /**
   * Bottom margin in inches. Defaults to 1cm (~0.4 inches).
   */
  readonly marginBottom?: number | undefined
  /**
   * Left margin in inches. Defaults to 1cm (~0.4 inches).
   */
  readonly marginLeft?: number | undefined
  /**
   * Right margin in inches. Defaults to 1cm (~0.4 inches).
   */
  readonly marginRight?: number | undefined
  /**
   * Paper ranges to print, one based, e.g., '1-5, 8, 11-13'. Pages are
   * printed in the document order, not in the order specified, and no
   * more than once.
   * Defaults to empty string, which implies the entire document is printed.
   * The page numbers are quietly capped to actual page count of the
   * document, and ranges beyond the end of the document are ignored.
   * If this results in no pages to print, an error is reported.
   * It is an error to specify a range with start greater than end.
   */
  readonly pageRanges?: string | undefined
  /**
   * HTML template for the print header. Should be valid HTML markup with following
   * classes used to inject printing values into them:
   * - `date`: formatted print date
   * - `title`: document title
   * - `url`: document location
   * - `pageNumber`: current page number
   * - `totalPages`: total pages in the document
   *
   * For example, `<span class=title></span>` would generate span containing the title.
   */
  readonly headerTemplate?: string | undefined
  /**
   * HTML template for the print footer. Should use the same format as the `headerTemplate`.
   */
  readonly footerTemplate?: string | undefined
  /**
   * Whether or not to prefer page size as defined by css. Defaults to false,
   * in which case the content will be scaled to fit the paper size.
   */
  readonly preferCSSPageSize?: boolean | undefined
  /**
   * return as stream
   */
  readonly transferMode?: PrintToPDFParamsTransferMode | undefined
  /**
   * Whether or not to generate tagged (accessible) PDF. Defaults to embedder choice.
   */
  readonly generateTaggedPDF?: boolean | undefined
  /**
   * Whether or not to embed the document outline into the PDF.
   */
  readonly generateDocumentOutline?: boolean | undefined
}

/**
 * Schema for `PrintToPDFParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintToPDFParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    landscape: Schema.optional(Schema.Boolean),
    displayHeaderFooter: Schema.optional(Schema.Boolean),
    printBackground: Schema.optional(Schema.Boolean),
    scale: Schema.optional(Schema.Number),
    paperWidth: Schema.optional(Schema.Number),
    paperHeight: Schema.optional(Schema.Number),
    marginTop: Schema.optional(Schema.Number),
    marginBottom: Schema.optional(Schema.Number),
    marginLeft: Schema.optional(Schema.Number),
    marginRight: Schema.optional(Schema.Number),
    pageRanges: Schema.optional(Schema.String),
    headerTemplate: Schema.optional(Schema.String),
    footerTemplate: Schema.optional(Schema.String),
    preferCSSPageSize: Schema.optional(Schema.Boolean),
    transferMode: Schema.optional(PrintToPDFParamsTransferMode),
    generateTaggedPDF: Schema.optional(Schema.Boolean),
    generateDocumentOutline: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.PrintToPDFParams" })
) as any as Schema.Codec<PrintToPDFParams>

/**
 * return as stream
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PrintToPDFParamsTransferMode =
  | "ReturnAsBase64"
  | "ReturnAsStream"
  | (string & {})

/**
 * Schema for `PrintToPDFParamsTransferMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrintToPDFParamsTransferMode = Schema.String as any as Schema.Codec<PrintToPDFParamsTransferMode>

/**
 * Print page as PDF.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PrintToPDFResult {
  /**
   * Base64-encoded pdf data. Empty if |returnAsStream| is specified. (Encoded as a base64 string when passed over JSON)
   */
  readonly data: string
  /**
   * A handle of the stream that holds resulting PDF data.
   */
  readonly stream?: IO.StreamHandle | undefined
}

/**
 * Schema for `PrintToPDFResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrintToPDFResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String,
    stream: Schema.optional(IO.StreamHandle)
  }).annotate({ identifier: "Page.PrintToPDFResult" })
) as any as Schema.Codec<PrintToPDFResult>

/**
 * Requests backend to produce compilation cache for the specified scripts.
 * `scripts` are appended to the list of scripts for which the cache
 * would be produced. The list may be reset during page navigation.
 * When script with a matching URL is encountered, the cache is optionally
 * produced upon backend discretion, based on internal heuristics.
 * See also: `Page.compilationCacheProduced`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ProduceCompilationCacheParams {
  readonly scripts: ReadonlyArray<CompilationCacheParams>
}

/**
 * Schema for `ProduceCompilationCacheParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ProduceCompilationCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scripts: Schema.Array(CompilationCacheParams)
  }).annotate({ identifier: "Page.ProduceCompilationCacheParams" })
) as any as Schema.Codec<ProduceCompilationCacheParams>

/**
 * Reloads given page optionally ignoring the cache.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReloadParams {
  /**
   * If true, browser cache is ignored (as if the user pressed Shift+refresh).
   */
  readonly ignoreCache?: boolean | undefined
  /**
   * If set, the script will be injected into all frames of the inspected page after reload.
   * Argument will be ignored if reloading dataURL origin.
   */
  readonly scriptToEvaluateOnLoad?: string | undefined
  /**
   * If set, an error will be thrown if the target page's main frame's
   * loader id does not match the provided id. This prevents accidentally
   * reloading an unintended target in case there's a racing navigation.
   */
  readonly loaderId?: Network.LoaderId | undefined
}

/**
 * Schema for `ReloadParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReloadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ignoreCache: Schema.optional(Schema.Boolean),
    scriptToEvaluateOnLoad: Schema.optional(Schema.String),
    loaderId: Schema.optional(Network.LoaderId)
  }).annotate({ identifier: "Page.ReloadParams" })
) as any as Schema.Codec<ReloadParams>

/**
 * Removes given script from the list.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveScriptToEvaluateOnNewDocumentParams {
  readonly identifier: ScriptIdentifier
}

/**
 * Schema for `RemoveScriptToEvaluateOnNewDocumentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveScriptToEvaluateOnNewDocumentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: ScriptIdentifier
  }).annotate({ identifier: "Page.RemoveScriptToEvaluateOnNewDocumentParams" })
) as any as Schema.Codec<RemoveScriptToEvaluateOnNewDocumentParams>

/**
 * Compressed image data requested by the `startScreencast`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreencastFrameParams {
  /**
   * Base64-encoded compressed image. (Encoded as a base64 string when passed over JSON)
   */
  readonly data: string
  /**
   * Screencast frame metadata.
   */
  readonly metadata: ScreencastFrameMetadata
  /**
   * Frame number.
   */
  readonly sessionId: number
}

/**
 * Schema for `ScreencastFrameParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastFrameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String,
    metadata: ScreencastFrameMetadata,
    sessionId: Schema.Int
  }).annotate({ identifier: "Page.ScreencastFrameParams" })
) as any as Schema.Codec<ScreencastFrameParams>

/**
 * Acknowledges that a screencast frame has been received by the frontend.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreencastFrameAckParams {
  /**
   * Frame number.
   */
  readonly sessionId: number
}

/**
 * Schema for `ScreencastFrameAckParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastFrameAckParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: Schema.Int
  }).annotate({ identifier: "Page.ScreencastFrameAckParams" })
) as any as Schema.Codec<ScreencastFrameAckParams>

/**
 * Fired when the page with currently enabled screencast was shown or hidden `.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreencastVisibilityChangedParams {
  /**
   * True if the page is visible.
   */
  readonly visible: boolean
}

/**
 * Schema for `ScreencastVisibilityChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastVisibilityChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    visible: Schema.Boolean
  }).annotate({ identifier: "Page.ScreencastVisibilityChangedParams" })
) as any as Schema.Codec<ScreencastVisibilityChangedParams>

/**
 * Searches for given string in resource content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SearchInResourceParams {
  /**
   * Frame id for resource to search in.
   */
  readonly frameId: FrameId
  /**
   * URL of the resource to search in.
   */
  readonly url: string
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
 * Schema for `SearchInResourceParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResourceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    url: Schema.String,
    query: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.SearchInResourceParams" })
) as any as Schema.Codec<SearchInResourceParams>

/**
 * Searches for given string in resource content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SearchInResourceResult {
  /**
   * List of search matches.
   */
  readonly result: ReadonlyArray<Debugger.SearchMatch>
}

/**
 * Schema for `SearchInResourceResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResourceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(Debugger.SearchMatch)
  }).annotate({ identifier: "Page.SearchInResourceResult" })
) as any as Schema.Codec<SearchInResourceResult>

/**
 * Enable Chrome's experimental ad filter on all sites.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAdBlockingEnabledParams {
  /**
   * Whether to block ads.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetAdBlockingEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAdBlockingEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Page.SetAdBlockingEnabledParams" })
) as any as Schema.Codec<SetAdBlockingEnabledParams>

/**
 * Enable page Content Security Policy by-passing.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBypassCSPParams {
  /**
   * Whether to bypass page CSP.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetBypassCSPParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBypassCSPParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Page.SetBypassCSPParams" })
) as any as Schema.Codec<SetBypassCSPParams>

/**
 * Sets given markup as the document's HTML.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDocumentContentParams {
  /**
   * Frame id to set HTML for.
   */
  readonly frameId: FrameId
  /**
   * HTML content to set.
   */
  readonly html: string
}

/**
 * Schema for `SetDocumentContentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDocumentContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    html: Schema.String
  }).annotate({ identifier: "Page.SetDocumentContentParams" })
) as any as Schema.Codec<SetDocumentContentParams>

/**
 * Set generic font families.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetFontFamiliesParams {
  /**
   * Specifies font families to set. If a font family is not specified, it won't be changed.
   */
  readonly fontFamilies: FontFamilies
  /**
   * Specifies font families to set for individual scripts.
   */
  readonly forScripts?: ReadonlyArray<ScriptFontFamilies> | undefined
}

/**
 * Schema for `SetFontFamiliesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetFontFamiliesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fontFamilies: FontFamilies,
    forScripts: Schema.optional(Schema.Array(ScriptFontFamilies))
  }).annotate({ identifier: "Page.SetFontFamiliesParams" })
) as any as Schema.Codec<SetFontFamiliesParams>

/**
 * Set default font sizes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetFontSizesParams {
  /**
   * Specifies font sizes to set. If a font size is not specified, it won't be changed.
   */
  readonly fontSizes: FontSizes
}

/**
 * Schema for `SetFontSizesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetFontSizesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fontSizes: FontSizes
  }).annotate({ identifier: "Page.SetFontSizesParams" })
) as any as Schema.Codec<SetFontSizesParams>

/**
 * Intercept file chooser requests and transfer control to protocol clients.
 * When file chooser interception is enabled, native file chooser dialog is not shown.
 * Instead, a protocol event `Page.fileChooserOpened` is emitted.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInterceptFileChooserDialogParams {
  readonly enabled: boolean
  /**
   * If true, cancels the dialog by emitting relevant events (if any)
   * in addition to not showing it if the interception is enabled
   * (default: false).
   */
  readonly cancel?: boolean | undefined
}

/**
 * Schema for `SetInterceptFileChooserDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInterceptFileChooserDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    cancel: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.SetInterceptFileChooserDialogParams" })
) as any as Schema.Codec<SetInterceptFileChooserDialogParams>

/**
 * Controls whether page will emit lifecycle events.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetLifecycleEventsEnabledParams {
  /**
   * If true, starts emitting lifecycle events.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetLifecycleEventsEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLifecycleEventsEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Page.SetLifecycleEventsEnabledParams" })
) as any as Schema.Codec<SetLifecycleEventsEnabledParams>

/**
 * Enable/disable prerendering manually.
 *
 * This command is a short-term solution for https://crbug.com/1440085.
 * See https://docs.google.com/document/d/12HVmFxYj5Jc-eJr5OmWsa2bqTJsbgGLKI6ZIyx0_wpA
 * for more details.
 *
 * TODO(https://crbug.com/1440085): Remove this once Puppeteer supports tab targets.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPrerenderingAllowedParams {
  readonly isAllowed: boolean
}

/**
 * Schema for `SetPrerenderingAllowedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPrerenderingAllowedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isAllowed: Schema.Boolean
  }).annotate({ identifier: "Page.SetPrerenderingAllowedParams" })
) as any as Schema.Codec<SetPrerenderingAllowedParams>

/**
 * Extensions for Custom Handlers API:
 * https://html.spec.whatwg.org/multipage/system-state.html#rph-automation
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetRPHRegistrationModeParams {
  readonly mode: SetRPHRegistrationModeParamsMode
}

/**
 * Schema for `SetRPHRegistrationModeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetRPHRegistrationModeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mode: SetRPHRegistrationModeParamsMode
  }).annotate({ identifier: "Page.SetRPHRegistrationModeParams" })
) as any as Schema.Codec<SetRPHRegistrationModeParams>

/**
 * `setRPHRegistrationMode.Params.mode` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetRPHRegistrationModeParamsMode =
  | "none"
  | "autoAccept"
  | "autoReject"
  | (string & {})

/**
 * Schema for `SetRPHRegistrationModeParamsMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetRPHRegistrationModeParamsMode = Schema.String as any as Schema.Codec<SetRPHRegistrationModeParamsMode>

/**
 * Sets the Secure Payment Confirmation transaction mode.
 * https://w3c.github.io/secure-payment-confirmation/#sctn-automation-set-spc-transaction-mode
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSPCTransactionModeParams {
  readonly mode: SetSPCTransactionModeParamsMode
}

/**
 * Schema for `SetSPCTransactionModeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSPCTransactionModeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mode: SetSPCTransactionModeParamsMode
  }).annotate({ identifier: "Page.SetSPCTransactionModeParams" })
) as any as Schema.Codec<SetSPCTransactionModeParams>

/**
 * `setSPCTransactionMode.Params.mode` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetSPCTransactionModeParamsMode =
  | "none"
  | "autoAccept"
  | "autoChooseToAuthAnotherWay"
  | "autoReject"
  | "autoOptOut"
  | (string & {})

/**
 * Schema for `SetSPCTransactionModeParamsMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetSPCTransactionModeParamsMode = Schema.String as any as Schema.Codec<SetSPCTransactionModeParamsMode>

/**
 * Tries to update the web lifecycle state of the page.
 * It will transition the page to the given state according to:
 * https://github.com/WICG/web-lifecycle/
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetWebLifecycleStateParams {
  /**
   * Target lifecycle state
   */
  readonly state: SetWebLifecycleStateParamsState
}

/**
 * Schema for `SetWebLifecycleStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetWebLifecycleStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    state: SetWebLifecycleStateParamsState
  }).annotate({ identifier: "Page.SetWebLifecycleStateParams" })
) as any as Schema.Codec<SetWebLifecycleStateParams>

/**
 * Target lifecycle state
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetWebLifecycleStateParamsState =
  | "frozen"
  | "active"
  | (string & {})

/**
 * Schema for `SetWebLifecycleStateParamsState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetWebLifecycleStateParamsState = Schema.String as any as Schema.Codec<SetWebLifecycleStateParamsState>

/**
 * Starts screencast video recording.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartScreenRecordingParams {
  readonly audio?: boolean | undefined
  /**
   * Maximum frame width in pixels.
   */
  readonly maxWidth?: number | undefined
  /**
   * Maximum frame height in pixels.
   */
  readonly maxHeight?: number | undefined
  /**
   * Maximum frame rate in frames per second.
   */
  readonly frameRate?: number | undefined
}

/**
 * Schema for `StartScreenRecordingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartScreenRecordingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    audio: Schema.optional(Schema.Boolean),
    maxWidth: Schema.optional(Schema.Int),
    maxHeight: Schema.optional(Schema.Int),
    frameRate: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Page.StartScreenRecordingParams" })
) as any as Schema.Codec<StartScreenRecordingParams>

/**
 * Starts screencast video recording.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartScreenRecordingResult {
  /**
   * A handle of the stream that holds resulting screencast data.
   */
  readonly stream?: IO.StreamHandle | undefined
}

/**
 * Schema for `StartScreenRecordingResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartScreenRecordingResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stream: Schema.optional(IO.StreamHandle)
  }).annotate({ identifier: "Page.StartScreenRecordingResult" })
) as any as Schema.Codec<StartScreenRecordingResult>

/**
 * Starts sending each frame using the `screencastFrame` event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartScreencastParams {
  /**
   * Image compression format.
   */
  readonly format?: StartScreencastParamsFormat | undefined
  /**
   * Compression quality from range [0..100].
   */
  readonly quality?: number | undefined
  /**
   * Maximum screenshot width.
   */
  readonly maxWidth?: number | undefined
  /**
   * Maximum screenshot height.
   */
  readonly maxHeight?: number | undefined
  /**
   * Send every n-th frame. Must be a positive integer.
   */
  readonly everyNthFrame?: number | undefined
  /**
   * Maximum number of frames sent until screencastFrameAck is required.
   * Defaults to 3. Must be a positive integer.
   */
  readonly maxFramesInFlight?: number | undefined
  /**
   * By default, after screencastFrameAck arrives, the next produced frame is sent.
   * Passing this flag enables storing the last produced frame in memory, which is
   * immediately sent upon screencastFrameAck. This way, overall performance is
   * traded for a better latency.
   */
  readonly sendLastFrame?: boolean | undefined
}

/**
 * Schema for `StartScreencastParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartScreencastParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    format: Schema.optional(StartScreencastParamsFormat),
    quality: Schema.optional(Schema.Int),
    maxWidth: Schema.optional(Schema.Int),
    maxHeight: Schema.optional(Schema.Int),
    everyNthFrame: Schema.optional(Schema.Int),
    maxFramesInFlight: Schema.optional(Schema.Int),
    sendLastFrame: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.StartScreencastParams" })
) as any as Schema.Codec<StartScreencastParams>

/**
 * Image compression format.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StartScreencastParamsFormat =
  | "jpeg"
  | "png"
  | (string & {})

/**
 * Schema for `StartScreencastParamsFormat`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartScreencastParamsFormat = Schema.String as any as Schema.Codec<StartScreencastParamsFormat>

/**
 * Stops screencast video recording.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopScreenRecordingResult {
  /**
   * A handle of the stream that holds resulting screencast data.
   */
  readonly stream?: IO.StreamHandle | undefined
}

/**
 * Schema for `StopScreenRecordingResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopScreenRecordingResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stream: Schema.optional(IO.StreamHandle)
  }).annotate({ identifier: "Page.StopScreenRecordingResult" })
) as any as Schema.Codec<StopScreenRecordingResult>

/**
 * Fired when a new window is going to be opened, via window.open(), link click, form submission,
 * etc.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WindowOpenParams {
  /**
   * The URL for the new window.
   */
  readonly url: string
  /**
   * Window name.
   */
  readonly windowName: string
  /**
   * An array of enabled window features.
   */
  readonly windowFeatures: ReadonlyArray<string>
  /**
   * Whether or not it was triggered by user gesture.
   */
  readonly userGesture: boolean
}

/**
 * Schema for `WindowOpenParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WindowOpenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    windowName: Schema.String,
    windowFeatures: Schema.Array(Schema.String),
    userGesture: Schema.Boolean
  }).annotate({ identifier: "Page.WindowOpenParams" })
) as any as Schema.Codec<WindowOpenParams>

/**
 * Seeds compilation cache for given url. Compilation cache does not survive
 * cross-process navigation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addCompilationCache: Protocol.CommandDef<"Page.addCompilationCache", AddCompilationCacheParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.addCompilationCache",
    AddCompilationCacheParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Evaluates given script in every frame upon creation (before loading frame's scripts).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addScriptToEvaluateOnNewDocument: Protocol.CommandDef<
  "Page.addScriptToEvaluateOnNewDocument",
  AddScriptToEvaluateOnNewDocumentParams,
  AddScriptToEvaluateOnNewDocumentResult
> = /*#__PURE__*/ Protocol.command(
  "Page.addScriptToEvaluateOnNewDocument",
  AddScriptToEvaluateOnNewDocumentParams,
  AddScriptToEvaluateOnNewDocumentResult,
  { status: "stable", createsResource: true }
)

/**
 * Brings page to front (activates tab).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const bringToFront: Protocol.CommandDef<"Page.bringToFront", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.bringToFront",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Capture page screenshot.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const captureScreenshot: Protocol.CommandDef<
  "Page.captureScreenshot",
  CaptureScreenshotParams,
  CaptureScreenshotResult
> = /*#__PURE__*/ Protocol.command(
  "Page.captureScreenshot",
  CaptureScreenshotParams,
  CaptureScreenshotResult,
  { status: "stable" }
)

/**
 * Returns a snapshot of the page as a string. For MHTML format, the serialization includes
 * iframes, shadow DOM, external resources, and element-inline styles.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const captureSnapshot: Protocol.CommandDef<
  "Page.captureSnapshot",
  CaptureSnapshotParams,
  CaptureSnapshotResult
> = /*#__PURE__*/ Protocol.command(
  "Page.captureSnapshot",
  CaptureSnapshotParams,
  CaptureSnapshotResult,
  { status: "experimental" }
)

/**
 * Clears seeded compilation cache.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearCompilationCache: Protocol.CommandDef<"Page.clearCompilationCache", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.clearCompilationCache",
    undefined,
    undefined,
    { status: "experimental" }
  )

/**
 * Tries to close page, running its beforeunload hooks, if any.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const close: Protocol.CommandDef<"Page.close", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.close",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Crashes renderer on the IO thread, generates minidumps.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const crash: Protocol.CommandDef<"Page.crash", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.crash",
  undefined,
  undefined,
  { status: "experimental" }
)

/**
 * Creates an isolated world for the given frame.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createIsolatedWorld: Protocol.CommandDef<
  "Page.createIsolatedWorld",
  CreateIsolatedWorldParams,
  CreateIsolatedWorldResult
> = /*#__PURE__*/ Protocol.command(
  "Page.createIsolatedWorld",
  CreateIsolatedWorldParams,
  CreateIsolatedWorldResult,
  { status: "stable", createsResource: true }
)

/**
 * Disables page domain notifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Page.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables page domain notifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Page.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "Page.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Generates a report for testing.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const generateTestReport: Protocol.CommandDef<"Page.generateTestReport", GenerateTestReportParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.generateTestReport",
    GenerateTestReportParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Sends `Page.getAdScriptAncestry`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAdScriptAncestry: Protocol.CommandDef<
  "Page.getAdScriptAncestry",
  GetAdScriptAncestryParams,
  GetAdScriptAncestryResult
> = /*#__PURE__*/ Protocol.command(
  "Page.getAdScriptAncestry",
  GetAdScriptAncestryParams,
  GetAdScriptAncestryResult,
  { status: "experimental" }
)

/**
 * Get the annotated page content for the main frame.
 * This is an experimental command that is subject to change.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAnnotatedPageContent: Protocol.CommandDef<
  "Page.getAnnotatedPageContent",
  GetAnnotatedPageContentParams,
  GetAnnotatedPageContentResult
> = /*#__PURE__*/ Protocol.command(
  "Page.getAnnotatedPageContent",
  GetAnnotatedPageContentParams,
  GetAnnotatedPageContentResult,
  { status: "experimental" }
)

/**
 * Returns the unique (PWA) app id.
 * Only returns values if the feature flag 'WebAppEnableManifestId' is enabled
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAppId: Protocol.CommandDef<"Page.getAppId", void, GetAppIdResult> = /*#__PURE__*/ Protocol.command(
  "Page.getAppId",
  undefined,
  GetAppIdResult,
  { status: "experimental" }
)

/**
 * Gets the processed manifest for this current document.
 *   This API always waits for the manifest to be loaded.
 *   If manifestId is provided, and it does not match the manifest of the
 *     current document, this API errors out.
 *   If there is not a loaded page, this API errors out immediately.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAppManifest: Protocol.CommandDef<"Page.getAppManifest", GetAppManifestParams, GetAppManifestResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.getAppManifest",
    GetAppManifestParams,
    GetAppManifestResult,
    { status: "stable" }
  )

/**
 * Returns present frame tree structure.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getFrameTree: Protocol.CommandDef<"Page.getFrameTree", void, GetFrameTreeResult> = /*#__PURE__*/ Protocol
  .command(
    "Page.getFrameTree",
    undefined,
    GetFrameTreeResult,
    { status: "stable" }
  )

/**
 * Sends `Page.getInstallabilityErrors`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getInstallabilityErrors: Protocol.CommandDef<
  "Page.getInstallabilityErrors",
  void,
  GetInstallabilityErrorsResult
> = /*#__PURE__*/ Protocol.command(
  "Page.getInstallabilityErrors",
  undefined,
  GetInstallabilityErrorsResult,
  { status: "experimental" }
)

/**
 * Returns metrics relating to the layouting of the page, such as viewport bounds/scale.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getLayoutMetrics: Protocol.CommandDef<"Page.getLayoutMetrics", void, GetLayoutMetricsResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.getLayoutMetrics",
    undefined,
    GetLayoutMetricsResult,
    { status: "stable" }
  )

/**
 * Returns navigation history for the current page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getNavigationHistory: Protocol.CommandDef<"Page.getNavigationHistory", void, GetNavigationHistoryResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.getNavigationHistory",
    undefined,
    GetNavigationHistoryResult,
    { status: "stable" }
  )

/**
 * Get Origin Trials on given frame.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getOriginTrials: Protocol.CommandDef<
  "Page.getOriginTrials",
  GetOriginTrialsParams,
  GetOriginTrialsResult
> = /*#__PURE__*/ Protocol.command(
  "Page.getOriginTrials",
  GetOriginTrialsParams,
  GetOriginTrialsResult,
  { status: "experimental" }
)

/**
 * Get Permissions Policy state on given frame.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getPermissionsPolicyState: Protocol.CommandDef<
  "Page.getPermissionsPolicyState",
  GetPermissionsPolicyStateParams,
  GetPermissionsPolicyStateResult
> = /*#__PURE__*/ Protocol.command(
  "Page.getPermissionsPolicyState",
  GetPermissionsPolicyStateParams,
  GetPermissionsPolicyStateResult,
  { status: "experimental" }
)

/**
 * Returns content of the given resource.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getResourceContent: Protocol.CommandDef<
  "Page.getResourceContent",
  GetResourceContentParams,
  GetResourceContentResult
> = /*#__PURE__*/ Protocol.command(
  "Page.getResourceContent",
  GetResourceContentParams,
  GetResourceContentResult,
  { status: "experimental" }
)

/**
 * Returns present frame / resource tree structure.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getResourceTree: Protocol.CommandDef<"Page.getResourceTree", void, GetResourceTreeResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.getResourceTree",
    undefined,
    GetResourceTreeResult,
    { status: "experimental" }
  )

/**
 * Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const handleJavaScriptDialog: Protocol.CommandDef<
  "Page.handleJavaScriptDialog",
  HandleJavaScriptDialogParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.handleJavaScriptDialog",
  HandleJavaScriptDialogParams,
  undefined,
  { status: "stable" }
)

/**
 * Navigates current page to the given URL.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const navigate: Protocol.CommandDef<"Page.navigate", NavigateParams, NavigateResult> = /*#__PURE__*/ Protocol
  .command(
    "Page.navigate",
    NavigateParams,
    NavigateResult,
    { status: "stable" }
  )

/**
 * Navigates current page to the given history entry.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const navigateToHistoryEntry: Protocol.CommandDef<
  "Page.navigateToHistoryEntry",
  NavigateToHistoryEntryParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.navigateToHistoryEntry",
  NavigateToHistoryEntryParams,
  undefined,
  { status: "stable" }
)

/**
 * Print page as PDF.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const printToPDF: Protocol.CommandDef<"Page.printToPDF", PrintToPDFParams, PrintToPDFResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.printToPDF",
    PrintToPDFParams,
    PrintToPDFResult,
    { status: "stable", createsResource: true }
  )

/**
 * Requests backend to produce compilation cache for the specified scripts.
 * `scripts` are appended to the list of scripts for which the cache
 * would be produced. The list may be reset during page navigation.
 * When script with a matching URL is encountered, the cache is optionally
 * produced upon backend discretion, based on internal heuristics.
 * See also: `Page.compilationCacheProduced`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const produceCompilationCache: Protocol.CommandDef<
  "Page.produceCompilationCache",
  ProduceCompilationCacheParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.produceCompilationCache",
  ProduceCompilationCacheParams,
  undefined,
  { status: "experimental" }
)

/**
 * Reloads given page optionally ignoring the cache.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const reload: Protocol.CommandDef<"Page.reload", ReloadParams, void> = /*#__PURE__*/ Protocol.command(
  "Page.reload",
  ReloadParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes given script from the list.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeScriptToEvaluateOnNewDocument: Protocol.CommandDef<
  "Page.removeScriptToEvaluateOnNewDocument",
  RemoveScriptToEvaluateOnNewDocumentParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.removeScriptToEvaluateOnNewDocument",
  RemoveScriptToEvaluateOnNewDocumentParams,
  undefined,
  { status: "stable" }
)

/**
 * Resets navigation history for the current page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resetNavigationHistory: Protocol.CommandDef<"Page.resetNavigationHistory", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.resetNavigationHistory",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Acknowledges that a screencast frame has been received by the frontend.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const screencastFrameAck: Protocol.CommandDef<"Page.screencastFrameAck", ScreencastFrameAckParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.screencastFrameAck",
    ScreencastFrameAckParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Searches for given string in resource content.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const searchInResource: Protocol.CommandDef<
  "Page.searchInResource",
  SearchInResourceParams,
  SearchInResourceResult
> = /*#__PURE__*/ Protocol.command(
  "Page.searchInResource",
  SearchInResourceParams,
  SearchInResourceResult,
  { status: "experimental" }
)

/**
 * Enable Chrome's experimental ad filter on all sites.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setAdBlockingEnabled: Protocol.CommandDef<"Page.setAdBlockingEnabled", SetAdBlockingEnabledParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setAdBlockingEnabled",
    SetAdBlockingEnabledParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Enable page Content Security Policy by-passing.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBypassCSP: Protocol.CommandDef<"Page.setBypassCSP", SetBypassCSPParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Page.setBypassCSP",
    SetBypassCSPParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets given markup as the document's HTML.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDocumentContent: Protocol.CommandDef<"Page.setDocumentContent", SetDocumentContentParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setDocumentContent",
    SetDocumentContentParams,
    undefined,
    { status: "stable" }
  )

/**
 * Set generic font families.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setFontFamilies: Protocol.CommandDef<"Page.setFontFamilies", SetFontFamiliesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setFontFamilies",
    SetFontFamiliesParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Set default font sizes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setFontSizes: Protocol.CommandDef<"Page.setFontSizes", SetFontSizesParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Page.setFontSizes",
    SetFontSizesParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Intercept file chooser requests and transfer control to protocol clients.
 * When file chooser interception is enabled, native file chooser dialog is not shown.
 * Instead, a protocol event `Page.fileChooserOpened` is emitted.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInterceptFileChooserDialog: Protocol.CommandDef<
  "Page.setInterceptFileChooserDialog",
  SetInterceptFileChooserDialogParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setInterceptFileChooserDialog",
  SetInterceptFileChooserDialogParams,
  undefined,
  { status: "stable" }
)

/**
 * Controls whether page will emit lifecycle events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setLifecycleEventsEnabled: Protocol.CommandDef<
  "Page.setLifecycleEventsEnabled",
  SetLifecycleEventsEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setLifecycleEventsEnabled",
  SetLifecycleEventsEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Enable/disable prerendering manually.
 *
 * This command is a short-term solution for https://crbug.com/1440085.
 * See https://docs.google.com/document/d/12HVmFxYj5Jc-eJr5OmWsa2bqTJsbgGLKI6ZIyx0_wpA
 * for more details.
 *
 * TODO(https://crbug.com/1440085): Remove this once Puppeteer supports tab targets.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPrerenderingAllowed: Protocol.CommandDef<
  "Page.setPrerenderingAllowed",
  SetPrerenderingAllowedParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setPrerenderingAllowed",
  SetPrerenderingAllowedParams,
  undefined,
  { status: "experimental" }
)

/**
 * Extensions for Custom Handlers API:
 * https://html.spec.whatwg.org/multipage/system-state.html#rph-automation
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setRPHRegistrationMode: Protocol.CommandDef<
  "Page.setRPHRegistrationMode",
  SetRPHRegistrationModeParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setRPHRegistrationMode",
  SetRPHRegistrationModeParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sets the Secure Payment Confirmation transaction mode.
 * https://w3c.github.io/secure-payment-confirmation/#sctn-automation-set-spc-transaction-mode
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSPCTransactionMode: Protocol.CommandDef<
  "Page.setSPCTransactionMode",
  SetSPCTransactionModeParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setSPCTransactionMode",
  SetSPCTransactionModeParams,
  undefined,
  { status: "experimental" }
)

/**
 * Tries to update the web lifecycle state of the page.
 * It will transition the page to the given state according to:
 * https://github.com/WICG/web-lifecycle/
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setWebLifecycleState: Protocol.CommandDef<"Page.setWebLifecycleState", SetWebLifecycleStateParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setWebLifecycleState",
    SetWebLifecycleStateParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Starts screencast video recording.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startScreenRecording: Protocol.CommandDef<
  "Page.startScreenRecording",
  StartScreenRecordingParams,
  StartScreenRecordingResult
> = /*#__PURE__*/ Protocol.command(
  "Page.startScreenRecording",
  StartScreenRecordingParams,
  StartScreenRecordingResult,
  { status: "experimental" }
)

/**
 * Starts sending each frame using the `screencastFrame` event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startScreencast: Protocol.CommandDef<"Page.startScreencast", StartScreencastParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.startScreencast",
    StartScreencastParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Force the page stop all navigations and pending resource fetches.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopLoading: Protocol.CommandDef<"Page.stopLoading", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.stopLoading",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Stops screencast video recording.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopScreenRecording: Protocol.CommandDef<"Page.stopScreenRecording", void, StopScreenRecordingResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.stopScreenRecording",
    undefined,
    StopScreenRecordingResult,
    { status: "experimental" }
  )

/**
 * Stops sending each frame in the `screencastFrame`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopScreencast: Protocol.CommandDef<"Page.stopScreencast", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.stopScreencast",
  undefined,
  undefined,
  { status: "experimental" }
)

/**
 * Pauses page execution. Can be resumed using generic Runtime.runIfWaitingForDebugger.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const waitForDebugger: Protocol.CommandDef<"Page.waitForDebugger", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.waitForDebugger",
  undefined,
  undefined,
  { status: "experimental" }
)

/**
 * Fired for failed bfcache history navigations if BackForwardCache feature is enabled. Do
 * not assume any ordering with the Page.frameNavigated event. This event is fired only for
 * main-frame history navigation where the document changes (non-same-document navigations),
 * when bfcache navigation fails.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const backForwardCacheNotUsed: Protocol.EventDef<"Page.backForwardCacheNotUsed", BackForwardCacheNotUsedParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.backForwardCacheNotUsed",
    BackForwardCacheNotUsedParams,
    { status: "experimental" }
  )

/**
 * Issued for every compilation cache generated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const compilationCacheProduced: Protocol.EventDef<
  "Page.compilationCacheProduced",
  CompilationCacheProducedParams
> = /*#__PURE__*/ Protocol.event(
  "Page.compilationCacheProduced",
  CompilationCacheProducedParams,
  { status: "experimental" }
)

/**
 * Fired when opening document to write to.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const documentOpened: Protocol.EventDef<"Page.documentOpened", DocumentOpenedParams> = /*#__PURE__*/ Protocol
  .event(
    "Page.documentOpened",
    DocumentOpenedParams,
    { status: "experimental" }
  )

/**
 * The `Page.domContentEventFired` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const domContentEventFired: Protocol.EventDef<"Page.domContentEventFired", DomContentEventFiredParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.domContentEventFired",
    DomContentEventFiredParams,
    { status: "stable" }
  )

/**
 * Emitted only when `page.interceptFileChooser` is enabled.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const fileChooserOpened: Protocol.EventDef<"Page.fileChooserOpened", FileChooserOpenedParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.fileChooserOpened",
    FileChooserOpenedParams,
    { status: "stable" }
  )

/**
 * Fired when frame has been attached to its parent.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const frameAttached: Protocol.EventDef<"Page.frameAttached", FrameAttachedParams> = /*#__PURE__*/ Protocol.event(
  "Page.frameAttached",
  FrameAttachedParams,
  { status: "stable" }
)

/**
 * Fired when frame has been detached from its parent.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const frameDetached: Protocol.EventDef<"Page.frameDetached", FrameDetachedParams> = /*#__PURE__*/ Protocol.event(
  "Page.frameDetached",
  FrameDetachedParams,
  { status: "stable" }
)

/**
 * Fired once navigation of the frame has completed. Frame is now associated with the new loader.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const frameNavigated: Protocol.EventDef<"Page.frameNavigated", FrameNavigatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Page.frameNavigated",
    FrameNavigatedParams,
    { status: "stable" }
  )

/**
 * Fired when a renderer-initiated navigation is requested.
 * Navigation may still be cancelled after the event is issued.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const frameRequestedNavigation: Protocol.EventDef<
  "Page.frameRequestedNavigation",
  FrameRequestedNavigationParams
> = /*#__PURE__*/ Protocol.event(
  "Page.frameRequestedNavigation",
  FrameRequestedNavigationParams,
  { status: "experimental" }
)

/**
 * The `Page.frameResized` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const frameResized: Protocol.EventDef<"Page.frameResized", void> = /*#__PURE__*/ Protocol.event(
  "Page.frameResized",
  undefined,
  { status: "experimental" }
)

/**
 * Fired when frame has started loading.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const frameStartedLoading: Protocol.EventDef<"Page.frameStartedLoading", FrameStartedLoadingParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.frameStartedLoading",
    FrameStartedLoadingParams,
    { status: "experimental" }
  )

/**
 * Fired when a navigation starts. This event is fired for both
 * renderer-initiated and browser-initiated navigations. For renderer-initiated
 * navigations, the event is fired after `frameRequestedNavigation`.
 * Navigation may still be cancelled after the event is issued. Multiple events
 * can be fired for a single navigation, for example, when a same-document
 * navigation becomes a cross-document navigation (such as in the case of a
 * frameset).
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const frameStartedNavigating: Protocol.EventDef<"Page.frameStartedNavigating", FrameStartedNavigatingParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.frameStartedNavigating",
    FrameStartedNavigatingParams,
    { status: "experimental" }
  )

/**
 * Fired when frame has stopped loading.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const frameStoppedLoading: Protocol.EventDef<"Page.frameStoppedLoading", FrameStoppedLoadingParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.frameStoppedLoading",
    FrameStoppedLoadingParams,
    { status: "experimental" }
  )

/**
 * Fired before frame subtree is detached. Emitted before any frame of the
 * subtree is actually detached.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const frameSubtreeWillBeDetached: Protocol.EventDef<
  "Page.frameSubtreeWillBeDetached",
  FrameSubtreeWillBeDetachedParams
> = /*#__PURE__*/ Protocol.event(
  "Page.frameSubtreeWillBeDetached",
  FrameSubtreeWillBeDetachedParams,
  { status: "experimental" }
)

/**
 * Fired when interstitial page was hidden
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const interstitialHidden: Protocol.EventDef<"Page.interstitialHidden", void> = /*#__PURE__*/ Protocol.event(
  "Page.interstitialHidden",
  undefined,
  { status: "stable" }
)

/**
 * Fired when interstitial page was shown
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const interstitialShown: Protocol.EventDef<"Page.interstitialShown", void> = /*#__PURE__*/ Protocol.event(
  "Page.interstitialShown",
  undefined,
  { status: "stable" }
)

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) has been
 * closed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const javascriptDialogClosed: Protocol.EventDef<"Page.javascriptDialogClosed", JavascriptDialogClosedParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.javascriptDialogClosed",
    JavascriptDialogClosedParams,
    { status: "stable" }
  )

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to
 * open.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const javascriptDialogOpening: Protocol.EventDef<"Page.javascriptDialogOpening", JavascriptDialogOpeningParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.javascriptDialogOpening",
    JavascriptDialogOpeningParams,
    { status: "stable" }
  )

/**
 * Fired for lifecycle events (navigation, load, paint, etc) in the current
 * target (including local frames).
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const lifecycleEvent: Protocol.EventDef<"Page.lifecycleEvent", LifecycleEventParams> = /*#__PURE__*/ Protocol
  .event(
    "Page.lifecycleEvent",
    LifecycleEventParams,
    { status: "stable" }
  )

/**
 * The `Page.loadEventFired` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const loadEventFired: Protocol.EventDef<"Page.loadEventFired", LoadEventFiredParams> = /*#__PURE__*/ Protocol
  .event(
    "Page.loadEventFired",
    LoadEventFiredParams,
    { status: "stable" }
  )

/**
 * Fired when same-document navigation happens, e.g. due to history API usage or anchor navigation.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const navigatedWithinDocument: Protocol.EventDef<"Page.navigatedWithinDocument", NavigatedWithinDocumentParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.navigatedWithinDocument",
    NavigatedWithinDocumentParams,
    { status: "experimental" }
  )

/**
 * Compressed image data requested by the `startScreencast`.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const screencastFrame: Protocol.EventDef<"Page.screencastFrame", ScreencastFrameParams> = /*#__PURE__*/ Protocol
  .event(
    "Page.screencastFrame",
    ScreencastFrameParams,
    { status: "experimental" }
  )

/**
 * Fired when the page with currently enabled screencast was shown or hidden `.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const screencastVisibilityChanged: Protocol.EventDef<
  "Page.screencastVisibilityChanged",
  ScreencastVisibilityChangedParams
> = /*#__PURE__*/ Protocol.event(
  "Page.screencastVisibilityChanged",
  ScreencastVisibilityChangedParams,
  { status: "experimental" }
)

/**
 * Fired when a new window is going to be opened, via window.open(), link click, form submission,
 * etc.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const windowOpen: Protocol.EventDef<"Page.windowOpen", WindowOpenParams> = /*#__PURE__*/ Protocol.event(
  "Page.windowOpen",
  WindowOpenParams,
  { status: "stable" }
)
