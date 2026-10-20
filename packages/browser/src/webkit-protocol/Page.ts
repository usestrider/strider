/**
 * Actions and events related to the inspected page belong to the page domain.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as GenericTypes from "./GenericTypes.ts"
import * as Network from "./Network.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Cookie object
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Cookie {
  /**
   * Cookie name.
   */
  readonly name: string
  /**
   * Cookie value.
   */
  readonly value: Redacted.Redacted<string>
  /**
   * Cookie domain.
   */
  readonly domain: string
  /**
   * Cookie path.
   */
  readonly path: string
  /**
   * Cookie expires.
   */
  readonly expires: number
  /**
   * True in case of session cookie.
   */
  readonly session: boolean
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly: boolean
  /**
   * True if cookie is secure.
   */
  readonly secure: boolean
  /**
   * Cookie Same-Site policy.
   */
  readonly sameSite: CookieSameSitePolicy
  /**
   * Cookie partition key. If null and partitioned property is true, then key must be computed.
   */
  readonly partitionKey?: string | undefined
}

/**
 * Schema for `Cookie`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Cookie = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
    domain: Schema.String,
    path: Schema.String,
    expires: Schema.Number,
    session: Schema.Boolean,
    httpOnly: Schema.Boolean,
    secure: Schema.Boolean,
    sameSite: CookieSameSitePolicy,
    partitionKey: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.Cookie" })
) as any as Schema.Codec<Cookie>

/**
 * Same-Site policy of a cookie.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CookieSameSitePolicy =
  | "None"
  | "Lax"
  | "Strict"
  | (string & {})

/**
 * Schema for `CookieSameSitePolicy`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieSameSitePolicy = Schema.String as any as Schema.Codec<CookieSameSitePolicy>

/**
 * Coordinate system used by supplied coordinates.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CoordinateSystem =
  | "Viewport"
  | "Page"
  | (string & {})

/**
 * Schema for `CoordinateSystem`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CoordinateSystem = Schema.String as any as Schema.Codec<CoordinateSystem>

/**
 * Page forced-colors media query override.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ForcedColors =
  | "Active"
  | "None"
  | (string & {})

/**
 * Schema for `ForcedColors`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ForcedColors = Schema.String as any as Schema.Codec<ForcedColors>

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
  readonly id: string
  /**
   * Parent frame identifier.
   */
  readonly parentId?: string | undefined
  /**
   * Identifier of the loader associated with this frame.
   */
  readonly loaderId: Network.LoaderId
  /**
   * Frame's name as specified in the tag.
   */
  readonly name?: string | undefined
  /**
   * Frame document's URL.
   */
  readonly url: string
  /**
   * Frame document's security origin.
   */
  readonly securityOrigin: string
  /**
   * Frame document's mimeType as determined by the browser.
   */
  readonly mimeType: string
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
    id: Schema.String,
    parentId: Schema.optional(Schema.String),
    loaderId: Network.LoaderId,
    name: Schema.optional(Schema.String),
    url: Schema.String,
    securityOrigin: Schema.String,
    mimeType: Schema.String
  }).annotate({ identifier: "Page.Frame" })
) as any as Schema.Codec<Frame>

/**
 * `FrameResource`.
 *
 * @stability unstable
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
  readonly type: ResourceType
  /**
   * Resource mimeType as determined by the browser.
   */
  readonly mimeType: string
  /**
   * True if the resource failed to load.
   */
  readonly failed?: boolean | undefined
  /**
   * True if the resource was canceled during loading.
   */
  readonly canceled?: boolean | undefined
  /**
   * URL of source map associated with this resource (if any).
   */
  readonly sourceMapURL?: string | undefined
  /**
   * Identifier for the context of where the load originated. In general this is the target identifier. For Workers this will be the workerId.
   */
  readonly targetId?: string | undefined
}

/**
 * Schema for `FrameResource`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameResource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    type: ResourceType,
    mimeType: Schema.String,
    failed: Schema.optional(Schema.Boolean),
    canceled: Schema.optional(Schema.Boolean),
    sourceMapURL: Schema.optional(Schema.String),
    targetId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.FrameResource" })
) as any as Schema.Codec<FrameResource>

/**
 * Information about the Frame hierarchy along with their cached resources.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Image format used to encode a captured snapshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | (string & {})

/**
 * Schema for `ImageFormat`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ImageFormat = Schema.String as any as Schema.Codec<ImageFormat>

/**
 * `Insets`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * Schema for `Insets`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Insets = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    top: Schema.Number,
    right: Schema.Number,
    bottom: Schema.Number,
    left: Schema.Number
  }).annotate({ identifier: "Page.Insets" })
) as any as Schema.Codec<Insets>

/**
 * Resource type as it was perceived by the rendering engine.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResourceType =
  | "Document"
  | "StyleSheet"
  | "Image"
  | "Font"
  | "Script"
  | "XHR"
  | "Fetch"
  | "Ping"
  | "Beacon"
  | "WebSocket"
  | "EventSource"
  | "Other"
  | (string & {})

/**
 * Schema for `ResourceType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResourceType = Schema.String as any as Schema.Codec<ResourceType>

/**
 * Search result for resource.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchResult {
  /**
   * Resource URL.
   */
  readonly url: string
  /**
   * Resource frame id.
   */
  readonly frameId: Network.FrameId
  /**
   * Number of matches in the resource content.
   */
  readonly matchesCount: number
  /**
   * Network request id.
   */
  readonly requestId?: Network.RequestId | undefined
}

/**
 * Schema for `SearchResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    frameId: Network.FrameId,
    matchesCount: Schema.Number,
    requestId: Schema.optional(Network.RequestId)
  }).annotate({ identifier: "Page.SearchResult" })
) as any as Schema.Codec<SearchResult>

/**
 * List of settings able to be overridden by WebInspector.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Setting =
  | "PrivateClickMeasurementDebugModeEnabled"
  | "AuthorAndUserStylesEnabled"
  | "FixedBackgroundsPaintRelativeToDocument"
  | "FullScreenEnabled"
  | "ICECandidateFilteringEnabled"
  | "ITPDebugModeEnabled"
  | "ImagesEnabled"
  | "InputTypeMonthEnabled"
  | "InputTypeWeekEnabled"
  | "MediaCaptureRequiresSecureConnection"
  | "MockCaptureDevicesEnabled"
  | "NeedsSiteSpecificQuirks"
  | "NotificationsEnabled"
  | "PointerLockEnabled"
  | "PushAPIEnabled"
  | "ScriptEnabled"
  | "ShowDebugBorders"
  | "ShowRepaintCounter"
  | "WebSecurityEnabled"
  | "DeviceOrientationEventEnabled"
  | "SpeechRecognitionEnabled"
  | (string & {})

/**
 * Schema for `Setting`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Setting = Schema.String as any as Schema.Codec<Setting>

/**
 * A user preference that can be overriden by Web Inspector, like an accessibility preference.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UserPreference {
  /**
   * Preference name.
   */
  readonly name: UserPreferenceName
  /**
   * Preference value.
   */
  readonly value: UserPreferenceValue
}

/**
 * Schema for `UserPreference`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPreference = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: UserPreferenceName,
    value: UserPreferenceValue
  }).annotate({ identifier: "Page.UserPreference" })
) as any as Schema.Codec<UserPreference>

/**
 * User preference name.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UserPreferenceName =
  | "PrefersReducedMotion"
  | "PrefersContrast"
  | "PrefersColorScheme"
  | (string & {})

/**
 * Schema for `UserPreferenceName`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPreferenceName = Schema.String as any as Schema.Codec<UserPreferenceName>

/**
 * User preference value.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UserPreferenceValue =
  | "NoPreference"
  | "Reduce"
  | "More"
  | "Light"
  | "Dark"
  | (string & {})

/**
 * Schema for `UserPreferenceValue`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPreferenceValue = Schema.String as any as Schema.Codec<UserPreferenceValue>

/**
 * Grab an archive of the page. Only in builds compiled with `(defined(ENABLE_WEB_ARCHIVE) && ENABLE_WEB_ARCHIVE) && (defined(USE_CF) && USE_CF)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ArchiveResult {
  /**
   * Base64-encoded web archive.
   */
  readonly data: string
}

/**
 * Schema for `ArchiveResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ArchiveResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String
  }).annotate({ identifier: "Page.ArchiveResult" })
) as any as Schema.Codec<ArchiveResult>

/**
 * Creates an user world for every loaded frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateUserWorldParams {
  /**
   * Isolated world name, will be used as an execution context name.
   */
  readonly name: string
}

/**
 * Schema for `CreateUserWorldParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateUserWorldParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String
  }).annotate({ identifier: "Page.CreateUserWorldParams" })
) as any as Schema.Codec<CreateUserWorldParams>

/**
 * Fired when the default value of a user preference changes at the system level.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DefaultUserPreferencesDidChangeParams {
  /**
   * List of user preferences that can be overriden and their new system (default) values.
   */
  readonly preferences: ReadonlyArray<UserPreference>
}

/**
 * Schema for `DefaultUserPreferencesDidChangeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DefaultUserPreferencesDidChangeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    preferences: Schema.Array(UserPreference)
  }).annotate({ identifier: "Page.DefaultUserPreferencesDidChangeParams" })
) as any as Schema.Codec<DefaultUserPreferencesDidChangeParams>

/**
 * Deletes browser cookie with given name, domain, and path.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteCookieParams {
  /**
   * Name of the cookie to remove.
   */
  readonly cookieName: string
  /**
   * URL to match cookie domain and path.
   */
  readonly url: string
}

/**
 * Schema for `DeleteCookieParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteCookieParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookieName: Schema.String,
    url: Schema.String
  }).annotate({ identifier: "Page.DeleteCookieParams" })
) as any as Schema.Codec<DeleteCookieParams>

/**
 * Fired when page has received navigation policy decision.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DidCheckNavigationPolicyParams {
  /**
   * Id of the frame.
   */
  readonly frameId: Network.FrameId
  /**
   * True if the navigation will not continue in this frame.
   */
  readonly cancel?: boolean | undefined
}

/**
 * Schema for `DidCheckNavigationPolicyParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DidCheckNavigationPolicyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId,
    cancel: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.DidCheckNavigationPolicyParams" })
) as any as Schema.Codec<DidCheckNavigationPolicyParams>

/**
 * `domContentEventFired.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DomContentEventFiredParams {
  readonly timestamp: number
  /**
   * Id of the frame that has fired DOMContentLoaded event.
   */
  readonly frameId: Network.FrameId
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
    timestamp: Schema.Number,
    frameId: Network.FrameId
  }).annotate({ identifier: "Page.DomContentEventFiredParams" })
) as any as Schema.Codec<DomContentEventFiredParams>

/**
 * Fired when the page shows file chooser for it's <input type=file>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FileChooserOpenedParams {
  /**
   * Frame where file chooser is opened.
   */
  readonly frameId: Network.FrameId
  /**
   * Input element.
   */
  readonly element: Runtime.RemoteObject
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
    frameId: Network.FrameId,
    element: Runtime.RemoteObject
  }).annotate({ identifier: "Page.FileChooserOpenedParams" })
) as any as Schema.Codec<FileChooserOpenedParams>

/**
 * Fired when frame has been attached to its parent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameAttachedParams {
  /**
   * Id of the frame that has been detached.
   */
  readonly frameId: Network.FrameId
  /**
   * Parent frame id if non-root.
   */
  readonly parentFrameId?: Network.FrameId | undefined
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
    frameId: Network.FrameId,
    parentFrameId: Schema.optional(Network.FrameId)
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
  readonly frameId: Network.FrameId
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
    frameId: Network.FrameId
  }).annotate({ identifier: "Page.FrameDetachedParams" })
) as any as Schema.Codec<FrameDetachedParams>

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
    frame: Frame
  }).annotate({ identifier: "Page.FrameNavigatedParams" })
) as any as Schema.Codec<FrameNavigatedParams>

/**
 * Returns all browser cookies. Depending on the backend support, will return detailed cookie information in the <code>cookies</code> field.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesResult {
  /**
   * Array of cookie objects.
   */
  readonly cookies: ReadonlyArray<Cookie>
}

/**
 * Schema for `GetCookiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetCookiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookies: Schema.Array(Cookie)
  }).annotate({ identifier: "Page.GetCookiesResult" })
) as any as Schema.Codec<GetCookiesResult>

/**
 * Returns content of the given resource.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetResourceContentParams {
  /**
   * Frame id to get resource for.
   */
  readonly frameId: Network.FrameId
  /**
   * URL of the resource to get content for.
   */
  readonly url: string
}

/**
 * Schema for `GetResourceContentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetResourceContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId,
    url: Schema.String
  }).annotate({ identifier: "Page.GetResourceContentParams" })
) as any as Schema.Codec<GetResourceContentParams>

/**
 * Returns content of the given resource.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetResourceTreeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameTree: FrameResourceTree
  }).annotate({ identifier: "Page.GetResourceTreeResult" })
) as any as Schema.Codec<GetResourceTreeResult>

/**
 * Insert text into the current selection of the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InsertTextParams {
  /**
   * Text to insert.
   */
  readonly text: Redacted.Redacted<string>
}

/**
 * Schema for `InsertTextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InsertTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.RedactedFromValue(Schema.String)
  }).annotate({ identifier: "Page.InsertTextParams" })
) as any as Schema.Codec<InsertTextParams>

/**
 * `loadEventFired.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadEventFiredParams {
  readonly timestamp: number
  /**
   * Id of the frame that has fired load event.
   */
  readonly frameId: Network.FrameId
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
    timestamp: Schema.Number,
    frameId: Network.FrameId
  }).annotate({ identifier: "Page.LoadEventFiredParams" })
) as any as Schema.Codec<LoadEventFiredParams>

/**
 * Fired when same-document navigation happens, e.g. due to history API usage or anchor navigation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigatedWithinDocumentParams {
  /**
   * Id of the frame.
   */
  readonly frameId: Network.FrameId
  /**
   * Frame's new url.
   */
  readonly url: string
}

/**
 * Schema for `NavigatedWithinDocumentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigatedWithinDocumentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId,
    url: Schema.String
  }).annotate({ identifier: "Page.NavigatedWithinDocumentParams" })
) as any as Schema.Codec<NavigatedWithinDocumentParams>

/**
 * Override's the navigator.platform of the inspected page
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OverridePlatformParams {
  /**
   * Value to override the platform with. If this value is not provided, the override is removed. Overrides are removed when Web Inspector closes/disconnects.
   */
  readonly value?: string | undefined
}

/**
 * Schema for `OverridePlatformParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OverridePlatformParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.OverridePlatformParams" })
) as any as Schema.Codec<OverridePlatformParams>

/**
 * Allows the frontend to override the inspected page's settings.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OverrideSettingParams {
  readonly setting: Setting
  /**
   * Value to override the setting with. If this value is not provided, the override is removed. Overrides are removed when Web Inspector closes/disconnects.
   */
  readonly value?: boolean | undefined
}

/**
 * Schema for `OverrideSettingParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OverrideSettingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    setting: Setting,
    value: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.OverrideSettingParams" })
) as any as Schema.Codec<OverrideSettingParams>

/**
 * Override's the user agent of the inspected page
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OverrideUserAgentParams {
  /**
   * Value to override the user agent with. If this value is not provided, the override is removed. Overrides are removed when Web Inspector closes/disconnects.
   */
  readonly value?: string | undefined
}

/**
 * Schema for `OverrideUserAgentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OverrideUserAgentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.OverrideUserAgentParams" })
) as any as Schema.Codec<OverrideUserAgentParams>

/**
 * Allows the frontend to override the user's preferences on the inspected page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OverrideUserPreferenceParams {
  readonly name: UserPreferenceName
  /**
   * Value to override the user preference with. If this value is not provided, the override is removed. Overrides are removed when Web Inspector closes/disconnects.
   */
  readonly value?: UserPreferenceValue | undefined
}

/**
 * Schema for `OverrideUserPreferenceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OverrideUserPreferenceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: UserPreferenceName,
    value: Schema.optional(UserPreferenceValue)
  }).annotate({ identifier: "Page.OverrideUserPreferenceParams" })
) as any as Schema.Codec<OverrideUserPreferenceParams>

/**
 * Reloads the main frame of the inspected page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReloadParams {
  /**
   * If true, the page is reloaded from its origin without using cached resources.
   */
  readonly ignoreCache?: boolean | undefined
  /**
   * If true, all cached subresources will be revalidated when the main resource loads. Otherwise, only expired cached subresources will be revalidated (the default behavior for most WebKit clients).
   */
  readonly revalidateAllResources?: boolean | undefined
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
    revalidateAllResources: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.ReloadParams" })
) as any as Schema.Codec<ReloadParams>

/**
 * Searches for given string in resource content.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchInResourceParams {
  /**
   * Frame id for resource to search in.
   */
  readonly frameId: Network.FrameId
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
  /**
   * Request id for resource to search in.
   */
  readonly requestId?: Network.RequestId | undefined
}

/**
 * Schema for `SearchInResourceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResourceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId,
    url: Schema.String,
    query: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean),
    requestId: Schema.optional(Network.RequestId)
  }).annotate({ identifier: "Page.SearchInResourceParams" })
) as any as Schema.Codec<SearchInResourceParams>

/**
 * Searches for given string in resource content.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchInResourceResult {
  /**
   * List of search matches.
   */
  readonly result: ReadonlyArray<GenericTypes.SearchMatch>
}

/**
 * Schema for `SearchInResourceResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResourceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(GenericTypes.SearchMatch)
  }).annotate({ identifier: "Page.SearchInResourceResult" })
) as any as Schema.Codec<SearchInResourceResult>

/**
 * Searches for given string in frame / resource tree structure.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchInResourcesParams {
  /**
   * String to search for.
   */
  readonly text: string
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
 * Schema for `SearchInResourcesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResourcesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.SearchInResourcesParams" })
) as any as Schema.Codec<SearchInResourcesParams>

/**
 * Searches for given string in frame / resource tree structure.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchInResourcesResult {
  /**
   * List of search results.
   */
  readonly result: ReadonlyArray<SearchResult>
}

/**
 * Schema for `SearchInResourcesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResourcesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(SearchResult)
  }).annotate({ identifier: "Page.SearchInResourcesResult" })
) as any as Schema.Codec<SearchInResourcesResult>

/**
 * `setBootstrapScript.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBootstrapScriptParams {
  /**
   * If `source` is provided (and not empty), it will be injected into all future global objects as soon as they're created. Omitting `source` will stop this from happening.
   */
  readonly source?: string | undefined
}

/**
 * Schema for `SetBootstrapScriptParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBootstrapScriptParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.SetBootstrapScriptParams" })
) as any as Schema.Codec<SetBootstrapScriptParams>

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
 * Sets a new browser cookie with the given name, domain, and path.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieParams {
  readonly cookie: Cookie
  /**
   * If true, then cookie's partition key should be set.
   */
  readonly shouldPartition?: boolean | undefined
}

/**
 * Schema for `SetCookieParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookie: Cookie,
    shouldPartition: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Page.SetCookieParams" })
) as any as Schema.Codec<SetCookieParams>

/**
 * Sets or clears an override of the default background color of the frame. This override is used if the content does not specify one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDefaultBackgroundColorOverrideParams {
  /**
   * RGBA of the default background color. If not specified, any existing override will be cleared.
   */
  readonly color?: DOM.RGBAColor | undefined
}

/**
 * Schema for `SetDefaultBackgroundColorOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDefaultBackgroundColorOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    color: Schema.optional(DOM.RGBAColor)
  }).annotate({ identifier: "Page.SetDefaultBackgroundColorOverrideParams" })
) as any as Schema.Codec<SetDefaultBackgroundColorOverrideParams>

/**
 * Emulates the given media for CSS media queries.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEmulatedMediaParams {
  /**
   * Media type to emulate. Empty string disables the override.
   */
  readonly media: string
}

/**
 * Schema for `SetEmulatedMediaParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulatedMediaParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    media: Schema.String
  }).annotate({ identifier: "Page.SetEmulatedMediaParams" })
) as any as Schema.Codec<SetEmulatedMediaParams>

/**
 * Forces the forced-colors media query for the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetForcedColorsParams {
  readonly forcedColors?: ForcedColors | undefined
}

/**
 * Schema for `SetForcedColorsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetForcedColorsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    forcedColors: Schema.optional(ForcedColors)
  }).annotate({ identifier: "Page.SetForcedColorsParams" })
) as any as Schema.Codec<SetForcedColorsParams>

/**
 * Intercepts file chooser dialog
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInterceptFileChooserDialogParams {
  /**
   * True to enable.
   */
  readonly enabled: boolean
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
    enabled: Schema.Boolean
  }).annotate({ identifier: "Page.SetInterceptFileChooserDialogParams" })
) as any as Schema.Codec<SetInterceptFileChooserDialogParams>

/**
 * Overrides screen size exposed to DOM and used in media queries for testing with provided values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetScreenSizeOverrideParams {
  /**
   * Screen width
   */
  readonly width?: number | undefined
  /**
   * Screen height
   */
  readonly height?: number | undefined
}

/**
 * Schema for `SetScreenSizeOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScreenSizeOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Page.SetScreenSizeOverrideParams" })
) as any as Schema.Codec<SetScreenSizeOverrideParams>

/**
 * Requests that backend shows paint rectangles
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetShowPaintRectsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Boolean
  }).annotate({ identifier: "Page.SetShowPaintRectsParams" })
) as any as Schema.Codec<SetShowPaintRectsParams>

/**
 * Requests that backend draw rulers in the inspector overlay Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetShowRulersParams {
  /**
   * True for showing rulers
   */
  readonly result: boolean
}

/**
 * Schema for `SetShowRulersParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetShowRulersParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Boolean
  }).annotate({ identifier: "Page.SetShowRulersParams" })
) as any as Schema.Codec<SetShowRulersParams>

/**
 * Enables time zone emulation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTimeZoneParams {
  readonly timeZone?: string | undefined
}

/**
 * Schema for `SetTimeZoneParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTimeZoneParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timeZone: Schema.optional(Schema.String)
  }).annotate({ identifier: "Page.SetTimeZoneParams" })
) as any as Schema.Codec<SetTimeZoneParams>

/**
 * Enables touch events on platforms that lack them.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTouchEmulationEnabledParams {
  /**
   * Whether touch should be enabled.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetTouchEmulationEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTouchEmulationEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Page.SetTouchEmulationEnabledParams" })
) as any as Schema.Codec<SetTouchEmulationEnabledParams>

/**
 * Capture a snapshot of the specified node that does not include unrelated layers.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SnapshotNodeParams {
  /**
   * Id of the node to snapshot.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `SnapshotNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "Page.SnapshotNodeParams" })
) as any as Schema.Codec<SnapshotNodeParams>

/**
 * Capture a snapshot of the specified node that does not include unrelated layers.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SnapshotNodeResult {
  /**
   * Base64-encoded image data (PNG).
   */
  readonly dataURL: string
}

/**
 * Schema for `SnapshotNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataURL: Schema.String
  }).annotate({ identifier: "Page.SnapshotNodeResult" })
) as any as Schema.Codec<SnapshotNodeResult>

/**
 * Capture a snapshot of the page within the specified rectangle and coordinate system.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SnapshotRectParams {
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
   * Indicates the coordinate system of the supplied rectangle.
   */
  readonly coordinateSystem: CoordinateSystem
  /**
   * By default, screenshot is inflated by device scale factor to avoid blurry image. This flag disables it.
   */
  readonly omitDeviceScaleFactor?: boolean | undefined
  /**
   * Image format of the resulting snapshot. Defaults to "png".
   */
  readonly format?: ImageFormat | undefined
  /**
   * Compression quality from 0 to 100 (ignored for the "png" format). For "jpeg" it defaults to 80. For "webp", omitting the quality or setting it to 100 produces a lossless image; any other value uses lossy compression at that quality.
   */
  readonly quality?: number | undefined
}

/**
 * Schema for `SnapshotRectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotRectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int,
    height: Schema.Int,
    coordinateSystem: CoordinateSystem,
    omitDeviceScaleFactor: Schema.optional(Schema.Boolean),
    format: Schema.optional(ImageFormat),
    quality: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Page.SnapshotRectParams" })
) as any as Schema.Codec<SnapshotRectParams>

/**
 * Capture a snapshot of the page within the specified rectangle and coordinate system.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SnapshotRectResult {
  /**
   * Base64-encoded image data.
   */
  readonly dataURL: string
}

/**
 * Schema for `SnapshotRectResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SnapshotRectResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataURL: Schema.String
  }).annotate({ identifier: "Page.SnapshotRectResult" })
) as any as Schema.Codec<SnapshotRectResult>

/**
 * Fired when page is about to check policy for newly triggered navigation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WillCheckNavigationPolicyParams {
  /**
   * Id of the frame.
   */
  readonly frameId: Network.FrameId
}

/**
 * Schema for `WillCheckNavigationPolicyParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WillCheckNavigationPolicyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId
  }).annotate({ identifier: "Page.WillCheckNavigationPolicyParams" })
) as any as Schema.Codec<WillCheckNavigationPolicyParams>

/**
 * Grab an archive of the page. Only in builds compiled with `(defined(ENABLE_WEB_ARCHIVE) && ENABLE_WEB_ARCHIVE) && (defined(USE_CF) && USE_CF)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const archive: Protocol.CommandDef<"Page.archive", void, ArchiveResult> = /*#__PURE__*/ Protocol.command(
  "Page.archive",
  undefined,
  ArchiveResult,
  { status: "stable" }
)

/**
 * Crashes the page process
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const crash: Protocol.CommandDef<"Page.crash", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.crash",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Creates an user world for every loaded frame.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createUserWorld: Protocol.CommandDef<"Page.createUserWorld", CreateUserWorldParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.createUserWorld",
    CreateUserWorldParams,
    undefined,
    { status: "stable", createsResource: true }
  )

/**
 * Deletes browser cookie with given name, domain, and path.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteCookie: Protocol.CommandDef<"Page.deleteCookie", DeleteCookieParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Page.deleteCookie",
    DeleteCookieParams,
    undefined,
    { status: "stable" }
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
export const enable: Protocol.CommandDef<"Page.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Returns all browser cookies. Depending on the backend support, will return detailed cookie information in the <code>cookies</code> field.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getCookies: Protocol.CommandDef<"Page.getCookies", void, GetCookiesResult> = /*#__PURE__*/ Protocol
  .command(
    "Page.getCookies",
    undefined,
    GetCookiesResult,
    { status: "stable" }
  )

/**
 * Returns content of the given resource.
 *
 * @stability unstable
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
  { status: "stable" }
)

/**
 * Returns present frame / resource tree structure.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getResourceTree: Protocol.CommandDef<"Page.getResourceTree", void, GetResourceTreeResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.getResourceTree",
    undefined,
    GetResourceTreeResult,
    { status: "stable" }
  )

/**
 * Goes back in the history.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const goBack: Protocol.CommandDef<"Page.goBack", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.goBack",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Goes forward in the history.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const goForward: Protocol.CommandDef<"Page.goForward", void, void> = /*#__PURE__*/ Protocol.command(
  "Page.goForward",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Insert text into the current selection of the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const insertText: Protocol.CommandDef<"Page.insertText", InsertTextParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Page.insertText",
    InsertTextParams,
    undefined,
    { status: "stable" }
  )

/**
 * Override's the navigator.platform of the inspected page
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const overridePlatform: Protocol.CommandDef<"Page.overridePlatform", OverridePlatformParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.overridePlatform",
    OverridePlatformParams,
    undefined,
    { status: "stable" }
  )

/**
 * Allows the frontend to override the inspected page's settings.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const overrideSetting: Protocol.CommandDef<"Page.overrideSetting", OverrideSettingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.overrideSetting",
    OverrideSettingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Override's the user agent of the inspected page
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const overrideUserAgent: Protocol.CommandDef<"Page.overrideUserAgent", OverrideUserAgentParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.overrideUserAgent",
    OverrideUserAgentParams,
    undefined,
    { status: "stable" }
  )

/**
 * Allows the frontend to override the user's preferences on the inspected page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const overrideUserPreference: Protocol.CommandDef<
  "Page.overrideUserPreference",
  OverrideUserPreferenceParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.overrideUserPreference",
  OverrideUserPreferenceParams,
  undefined,
  { status: "stable" }
)

/**
 * Reloads the main frame of the inspected page.
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
 * Searches for given string in resource content.
 *
 * @stability unstable
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
  { status: "stable" }
)

/**
 * Searches for given string in frame / resource tree structure.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const searchInResources: Protocol.CommandDef<
  "Page.searchInResources",
  SearchInResourcesParams,
  SearchInResourcesResult
> = /*#__PURE__*/ Protocol.command(
  "Page.searchInResources",
  SearchInResourcesParams,
  SearchInResourcesResult,
  { status: "stable" }
)

/**
 * Sends `Page.setBootstrapScript`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBootstrapScript: Protocol.CommandDef<"Page.setBootstrapScript", SetBootstrapScriptParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setBootstrapScript",
    SetBootstrapScriptParams,
    undefined,
    { status: "stable" }
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
 * Sets a new browser cookie with the given name, domain, and path.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCookie: Protocol.CommandDef<"Page.setCookie", SetCookieParams, void> = /*#__PURE__*/ Protocol.command(
  "Page.setCookie",
  SetCookieParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets or clears an override of the default background color of the frame. This override is used if the content does not specify one.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDefaultBackgroundColorOverride: Protocol.CommandDef<
  "Page.setDefaultBackgroundColorOverride",
  SetDefaultBackgroundColorOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setDefaultBackgroundColorOverride",
  SetDefaultBackgroundColorOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Emulates the given media for CSS media queries.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEmulatedMedia: Protocol.CommandDef<"Page.setEmulatedMedia", SetEmulatedMediaParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setEmulatedMedia",
    SetEmulatedMediaParams,
    undefined,
    { status: "stable" }
  )

/**
 * Forces the forced-colors media query for the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setForcedColors: Protocol.CommandDef<"Page.setForcedColors", SetForcedColorsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setForcedColors",
    SetForcedColorsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Intercepts file chooser dialog
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
 * Overrides screen size exposed to DOM and used in media queries for testing with provided values.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setScreenSizeOverride: Protocol.CommandDef<
  "Page.setScreenSizeOverride",
  SetScreenSizeOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setScreenSizeOverride",
  SetScreenSizeOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Requests that backend shows paint rectangles
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setShowPaintRects: Protocol.CommandDef<"Page.setShowPaintRects", SetShowPaintRectsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setShowPaintRects",
    SetShowPaintRectsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Requests that backend draw rulers in the inspector overlay Only in builds compiled with `!(defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setShowRulers: Protocol.CommandDef<"Page.setShowRulers", SetShowRulersParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Page.setShowRulers",
    SetShowRulersParams,
    undefined,
    { status: "stable" }
  )

/**
 * Enables time zone emulation.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTimeZone: Protocol.CommandDef<"Page.setTimeZone", SetTimeZoneParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Page.setTimeZone",
    SetTimeZoneParams,
    undefined,
    { status: "stable" }
  )

/**
 * Enables touch events on platforms that lack them.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTouchEmulationEnabled: Protocol.CommandDef<
  "Page.setTouchEmulationEnabled",
  SetTouchEmulationEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Page.setTouchEmulationEnabled",
  SetTouchEmulationEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Capture a snapshot of the specified node that does not include unrelated layers.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const snapshotNode: Protocol.CommandDef<"Page.snapshotNode", SnapshotNodeParams, SnapshotNodeResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.snapshotNode",
    SnapshotNodeParams,
    SnapshotNodeResult,
    { status: "stable" }
  )

/**
 * Capture a snapshot of the page within the specified rectangle and coordinate system.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const snapshotRect: Protocol.CommandDef<"Page.snapshotRect", SnapshotRectParams, SnapshotRectResult> =
  /*#__PURE__*/ Protocol.command(
    "Page.snapshotRect",
    SnapshotRectParams,
    SnapshotRectResult,
    { status: "stable" }
  )

/**
 * Ensures that the scroll regions are up to date.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const updateScrollingState: Protocol.CommandDef<"Page.updateScrollingState", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Page.updateScrollingState",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Fired when the default value of a user preference changes at the system level.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const defaultUserPreferencesDidChange: Protocol.EventDef<
  "Page.defaultUserPreferencesDidChange",
  DefaultUserPreferencesDidChangeParams
> = /*#__PURE__*/ Protocol.event(
  "Page.defaultUserPreferencesDidChange",
  DefaultUserPreferencesDidChangeParams,
  { status: "stable" }
)

/**
 * Fired when page has received navigation policy decision.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const didCheckNavigationPolicy: Protocol.EventDef<
  "Page.didCheckNavigationPolicy",
  DidCheckNavigationPolicyParams
> = /*#__PURE__*/ Protocol.event(
  "Page.didCheckNavigationPolicy",
  DidCheckNavigationPolicyParams,
  { status: "stable" }
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
 * Fired when the page shows file chooser for it's <input type=file>.
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
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const navigatedWithinDocument: Protocol.EventDef<"Page.navigatedWithinDocument", NavigatedWithinDocumentParams> =
  /*#__PURE__*/ Protocol.event(
    "Page.navigatedWithinDocument",
    NavigatedWithinDocumentParams,
    { status: "stable" }
  )

/**
 * Fired when page is about to check policy for newly triggered navigation.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const willCheckNavigationPolicy: Protocol.EventDef<
  "Page.willCheckNavigationPolicy",
  WillCheckNavigationPolicyParams
> = /*#__PURE__*/ Protocol.event(
  "Page.willCheckNavigationPolicy",
  WillCheckNavigationPolicyParams,
  { status: "stable" }
)
