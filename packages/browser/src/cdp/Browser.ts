/**
 * The Browser domain defines methods and events for browser managing.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Page from "./Page.ts"
import * as Target from "./Target.ts"

/**
 * Browser window bounds information
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Bounds {
  /**
   * The offset from the left edge of the screen to the window in pixels.
   */
  readonly left?: number | undefined
  /**
   * The offset from the top edge of the screen to the window in pixels.
   */
  readonly top?: number | undefined
  /**
   * The window width in pixels.
   */
  readonly width?: number | undefined
  /**
   * The window height in pixels.
   */
  readonly height?: number | undefined
  /**
   * The window state. Default to normal.
   */
  readonly windowState?: WindowState | undefined
}

/**
 * Schema for `Bounds`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Bounds = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    left: Schema.optional(Schema.Int),
    top: Schema.optional(Schema.Int),
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    windowState: Schema.optional(WindowState)
  }).annotate({ identifier: "Browser.Bounds" })
) as any as Schema.Codec<Bounds>

/**
 * Browser command ids used by executeBrowserCommand.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type BrowserCommandId =
  | "openTabSearch"
  | "closeTabSearch"
  | "openGlic"
  | (string & {})

/**
 * Schema for `BrowserCommandId`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BrowserCommandId = Schema.String as any as Schema.Codec<BrowserCommandId>

/**
 * `BrowserContextID`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type BrowserContextID = Brand.Branded<string, "~@usestrider/browser/cdp/Browser/BrowserContextID">

/**
 * Schema for `BrowserContextID`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BrowserContextID = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Browser/BrowserContextID")
) as any as Schema.Codec<BrowserContextID>

/**
 * Chrome histogram bucket.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Bucket {
  /**
   * Minimum value (inclusive).
   */
  readonly low: number
  /**
   * Maximum value (exclusive).
   */
  readonly high: number
  /**
   * Number of samples.
   */
  readonly count: number
}

/**
 * Schema for `Bucket`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Bucket = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    low: Schema.Int,
    high: Schema.Int,
    count: Schema.Int
  }).annotate({ identifier: "Browser.Bucket" })
) as any as Schema.Codec<Bucket>

/**
 * Chrome histogram.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Histogram {
  /**
   * Name.
   */
  readonly name: string
  /**
   * Sum of sample values.
   */
  readonly sum: number
  /**
   * Total number of samples.
   */
  readonly count: number
  /**
   * Buckets.
   */
  readonly buckets: ReadonlyArray<Bucket>
}

/**
 * Schema for `Histogram`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Histogram = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    sum: Schema.Int,
    count: Schema.Int,
    buckets: Schema.Array(Bucket)
  }).annotate({ identifier: "Browser.Histogram" })
) as any as Schema.Codec<Histogram>

/**
 * Definition of PermissionDescriptor defined in the Permissions API:
 * https://w3c.github.io/permissions/#dom-permissiondescriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PermissionDescriptor {
  /**
   * Name of permission.
   * See https://cs.chromium.org/chromium/src/third_party/blink/renderer/modules/permissions/permission_descriptor.idl for valid permission names.
   */
  readonly name: string
  /**
   * For "midi" permission, may also specify sysex control.
   */
  readonly sysex?: boolean | undefined
  /**
   * For "push" permission, may specify userVisibleOnly.
   * Note that userVisibleOnly = true is the only currently supported type.
   */
  readonly userVisibleOnly?: boolean | undefined
  /**
   * For "clipboard" permission, may specify allowWithoutSanitization.
   */
  readonly allowWithoutSanitization?: boolean | undefined
  /**
   * For "fullscreen" permission, must specify allowWithoutGesture:true.
   */
  readonly allowWithoutGesture?: boolean | undefined
  /**
   * For "camera" permission, may specify panTiltZoom.
   */
  readonly panTiltZoom?: boolean | undefined
}

/**
 * Schema for `PermissionDescriptor`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    sysex: Schema.optional(Schema.Boolean),
    userVisibleOnly: Schema.optional(Schema.Boolean),
    allowWithoutSanitization: Schema.optional(Schema.Boolean),
    allowWithoutGesture: Schema.optional(Schema.Boolean),
    panTiltZoom: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Browser.PermissionDescriptor" })
) as any as Schema.Codec<PermissionDescriptor>

/**
 * `PermissionSetting` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PermissionSetting =
  | "granted"
  | "denied"
  | "prompt"
  | (string & {})

/**
 * Schema for `PermissionSetting`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionSetting = Schema.String as any as Schema.Codec<PermissionSetting>

/**
 * `PermissionType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PermissionType =
  | "ar"
  | "audioCapture"
  | "automaticFullscreen"
  | "backgroundFetch"
  | "backgroundSync"
  | "cameraPanTiltZoom"
  | "capturedSurfaceControl"
  | "clipboardReadWrite"
  | "clipboardSanitizedWrite"
  | "displayCapture"
  | "durableStorage"
  | "geolocation"
  | "handTracking"
  | "idleDetection"
  | "keyboardLock"
  | "localFonts"
  | "localNetwork"
  | "localNetworkAccess"
  | "loopbackNetwork"
  | "midi"
  | "midiSysex"
  | "nfc"
  | "notifications"
  | "paymentHandler"
  | "periodicBackgroundSync"
  | "pointerLock"
  | "protectedMediaIdentifier"
  | "sensors"
  | "smartCard"
  | "speakerSelection"
  | "storageAccess"
  | "topLevelStorageAccess"
  | "videoCapture"
  | "vr"
  | "wakeLockScreen"
  | "wakeLockSystem"
  | "webAppInstallation"
  | "webPrinting"
  | "windowManagement"
  | (string & {})

/**
 * Schema for `PermissionType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionType = Schema.String as any as Schema.Codec<PermissionType>

/**
 * `WindowID`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type WindowID = Brand.Branded<number, "~@usestrider/browser/cdp/Browser/WindowID">

/**
 * Schema for `WindowID`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WindowID = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Browser/WindowID")
) as any as Schema.Codec<WindowID>

/**
 * The state of the browser window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type WindowState =
  | "normal"
  | "minimized"
  | "maximized"
  | "fullscreen"
  | (string & {})

/**
 * Schema for `WindowState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WindowState = Schema.String as any as Schema.Codec<WindowState>

/**
 * Adds or updates a mock camera in the shared video capture device list for
 * test automation. The mock camera is not scoped to a particular page or
 * frame and is removed when the DevTools session that created it disconnects.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddMockCameraParams {
  /**
   * Required non-empty identifier for the mock camera. This is mapped to an
   * internal virtual-device identifier and is not the MediaDeviceInfo.deviceId
   * exposed to the page.
   */
  readonly deviceId: string
}

/**
 * Schema for `AddMockCameraParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddMockCameraParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    deviceId: Schema.String
  }).annotate({ identifier: "Browser.AddMockCameraParams" })
) as any as Schema.Codec<AddMockCameraParams>

/**
 * Allows a site to use privacy sandbox features that require enrollment
 * without the site actually being enrolled. Only supported on page targets.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddPrivacySandboxEnrollmentOverrideParams {
  readonly url: string
}

/**
 * Schema for `AddPrivacySandboxEnrollmentOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddPrivacySandboxEnrollmentOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String
  }).annotate({ identifier: "Browser.AddPrivacySandboxEnrollmentOverrideParams" })
) as any as Schema.Codec<AddPrivacySandboxEnrollmentOverrideParams>

/**
 * Cancel a download if in progress
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CancelDownloadParams {
  /**
   * Global unique identifier of the download.
   */
  readonly guid: string
  /**
   * BrowserContext to perform the action in. When omitted, default browser context is used.
   */
  readonly browserContextId?: BrowserContextID | undefined
}

/**
 * Schema for `CancelDownloadParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CancelDownloadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    guid: Schema.String,
    browserContextId: Schema.optional(BrowserContextID)
  }).annotate({ identifier: "Browser.CancelDownloadParams" })
) as any as Schema.Codec<CancelDownloadParams>

/**
 * Fired when download makes progress. Last call has |done| == true.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DownloadProgressParams {
  /**
   * Global unique identifier of the download.
   */
  readonly guid: string
  /**
   * Total expected bytes to download.
   */
  readonly totalBytes: number
  /**
   * Total bytes received.
   */
  readonly receivedBytes: number
  /**
   * Download status.
   */
  readonly state: DownloadProgressParamsState
  /**
   * If download is "completed", provides the path of the downloaded file.
   * Depending on the platform, it is not guaranteed to be set, nor the file
   * is guaranteed to exist.
   */
  readonly filePath?: string | undefined
}

/**
 * Schema for `DownloadProgressParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DownloadProgressParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    guid: Schema.String,
    totalBytes: Schema.Number,
    receivedBytes: Schema.Number,
    state: DownloadProgressParamsState,
    filePath: Schema.optional(Schema.String)
  }).annotate({ identifier: "Browser.DownloadProgressParams" })
) as any as Schema.Codec<DownloadProgressParams>

/**
 * Download status.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DownloadProgressParamsState =
  | "inProgress"
  | "completed"
  | "canceled"
  | (string & {})

/**
 * Schema for `DownloadProgressParamsState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadProgressParamsState = Schema.String as any as Schema.Codec<DownloadProgressParamsState>

/**
 * Fired when page is about to start a download.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DownloadWillBeginParams {
  /**
   * Id of the frame that caused the download to begin.
   */
  readonly frameId: Page.FrameId
  /**
   * Global unique identifier of the download.
   */
  readonly guid: string
  /**
   * URL of the resource being downloaded.
   */
  readonly url: string
  /**
   * Suggested file name of the resource (the actual name of the file saved on disk may differ).
   */
  readonly suggestedFilename: string
}

/**
 * Schema for `DownloadWillBeginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DownloadWillBeginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId,
    guid: Schema.String,
    url: Schema.String,
    suggestedFilename: Schema.String
  }).annotate({ identifier: "Browser.DownloadWillBeginParams" })
) as any as Schema.Codec<DownloadWillBeginParams>

/**
 * Invoke custom browser commands used by telemetry.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ExecuteBrowserCommandParams {
  readonly commandId: BrowserCommandId
}

/**
 * Schema for `ExecuteBrowserCommandParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ExecuteBrowserCommandParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    commandId: BrowserCommandId
  }).annotate({ identifier: "Browser.ExecuteBrowserCommandParams" })
) as any as Schema.Codec<ExecuteBrowserCommandParams>

/**
 * Returns the command line switches for the browser process if, and only if
 * --enable-automation is on the commandline.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetBrowserCommandLineResult {
  /**
   * Commandline parameters
   */
  readonly arguments: ReadonlyArray<string>
}

/**
 * Schema for `GetBrowserCommandLineResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetBrowserCommandLineResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    arguments: Schema.Array(Schema.String)
  }).annotate({ identifier: "Browser.GetBrowserCommandLineResult" })
) as any as Schema.Codec<GetBrowserCommandLineResult>

/**
 * Gets the current globally-applied privacy control status
 * See https://www.w3.org/TR/gpc/#get-global-privacy-control
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetGlobalPrivacyControlResult {
  readonly gpc: boolean
}

/**
 * Schema for `GetGlobalPrivacyControlResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetGlobalPrivacyControlResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gpc: Schema.Boolean
  }).annotate({ identifier: "Browser.GetGlobalPrivacyControlResult" })
) as any as Schema.Codec<GetGlobalPrivacyControlResult>

/**
 * Get a Chrome histogram by name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHistogramParams {
  /**
   * Requested histogram name.
   */
  readonly name: string
  /**
   * If true, retrieve delta since last delta call.
   */
  readonly delta?: boolean | undefined
}

/**
 * Schema for `GetHistogramParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHistogramParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    delta: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Browser.GetHistogramParams" })
) as any as Schema.Codec<GetHistogramParams>

/**
 * Get a Chrome histogram by name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHistogramResult {
  /**
   * Histogram.
   */
  readonly histogram: Histogram
}

/**
 * Schema for `GetHistogramResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHistogramResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    histogram: Histogram
  }).annotate({ identifier: "Browser.GetHistogramResult" })
) as any as Schema.Codec<GetHistogramResult>

/**
 * Get Chrome histograms.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHistogramsParams {
  /**
   * Requested substring in name. Only histograms which have query as a
   * substring in their name are extracted. An empty or absent query returns
   * all histograms.
   */
  readonly query?: string | undefined
  /**
   * If true, retrieve delta since last delta call.
   */
  readonly delta?: boolean | undefined
}

/**
 * Schema for `GetHistogramsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHistogramsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    query: Schema.optional(Schema.String),
    delta: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Browser.GetHistogramsParams" })
) as any as Schema.Codec<GetHistogramsParams>

/**
 * Get Chrome histograms.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHistogramsResult {
  /**
   * Histograms.
   */
  readonly histograms: ReadonlyArray<Histogram>
}

/**
 * Schema for `GetHistogramsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHistogramsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    histograms: Schema.Array(Histogram)
  }).annotate({ identifier: "Browser.GetHistogramsResult" })
) as any as Schema.Codec<GetHistogramsResult>

/**
 * Returns version information.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetVersionResult {
  /**
   * Protocol version.
   */
  readonly protocolVersion: string
  /**
   * Product name.
   */
  readonly product: string
  /**
   * Product revision.
   */
  readonly revision: string
  /**
   * User-Agent.
   */
  readonly userAgent: string
  /**
   * V8 version.
   */
  readonly jsVersion: string
}

/**
 * Schema for `GetVersionResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetVersionResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocolVersion: Schema.String,
    product: Schema.String,
    revision: Schema.String,
    userAgent: Schema.String,
    jsVersion: Schema.String
  }).annotate({ identifier: "Browser.GetVersionResult" })
) as any as Schema.Codec<GetVersionResult>

/**
 * Get position and size of the browser window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetWindowBoundsParams {
  /**
   * Browser window id.
   */
  readonly windowId: WindowID
}

/**
 * Schema for `GetWindowBoundsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetWindowBoundsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    windowId: WindowID
  }).annotate({ identifier: "Browser.GetWindowBoundsParams" })
) as any as Schema.Codec<GetWindowBoundsParams>

/**
 * Get position and size of the browser window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetWindowBoundsResult {
  /**
   * Bounds information of the window. When window state is 'minimized', the restored window
   * position and size are returned.
   */
  readonly bounds: Bounds
}

/**
 * Schema for `GetWindowBoundsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetWindowBoundsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bounds: Bounds
  }).annotate({ identifier: "Browser.GetWindowBoundsResult" })
) as any as Schema.Codec<GetWindowBoundsResult>

/**
 * Get the browser window that contains the devtools target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetWindowForTargetParams {
  /**
   * Devtools agent host id. If called as a part of the session, associated targetId is used.
   */
  readonly targetId?: Target.TargetID | undefined
}

/**
 * Schema for `GetWindowForTargetParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetWindowForTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.optional(Target.TargetID)
  }).annotate({ identifier: "Browser.GetWindowForTargetParams" })
) as any as Schema.Codec<GetWindowForTargetParams>

/**
 * Get the browser window that contains the devtools target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetWindowForTargetResult {
  /**
   * Browser window id.
   */
  readonly windowId: WindowID
  /**
   * Bounds information of the window. When window state is 'minimized', the restored window
   * position and size are returned.
   */
  readonly bounds: Bounds
}

/**
 * Schema for `GetWindowForTargetResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetWindowForTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    windowId: WindowID,
    bounds: Bounds
  }).annotate({ identifier: "Browser.GetWindowForTargetResult" })
) as any as Schema.Codec<GetWindowForTargetResult>

/**
 * Reset all permission management for all origins.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResetPermissionsParams {
  /**
   * BrowserContext to reset permissions. When omitted, default browser context is used.
   */
  readonly browserContextId?: BrowserContextID | undefined
}

/**
 * Schema for `ResetPermissionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResetPermissionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(BrowserContextID)
  }).annotate({ identifier: "Browser.ResetPermissionsParams" })
) as any as Schema.Codec<ResetPermissionsParams>

/**
 * Set size of the browser contents resizing browser window as necessary.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetContentsSizeParams {
  /**
   * Browser window id.
   */
  readonly windowId: WindowID
  /**
   * The window contents width in DIP. Assumes current width if omitted.
   * Must be specified if 'height' is omitted.
   */
  readonly width?: number | undefined
  /**
   * The window contents height in DIP. Assumes current height if omitted.
   * Must be specified if 'width' is omitted.
   */
  readonly height?: number | undefined
}

/**
 * Schema for `SetContentsSizeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetContentsSizeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    windowId: WindowID,
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Browser.SetContentsSizeParams" })
) as any as Schema.Codec<SetContentsSizeParams>

/**
 * Set dock tile details, platform-specific.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDockTileParams {
  readonly badgeLabel?: string | undefined
  /**
   * Png encoded image. (Encoded as a base64 string when passed over JSON)
   */
  readonly image?: string | undefined
}

/**
 * Schema for `SetDockTileParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDockTileParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    badgeLabel: Schema.optional(Schema.String),
    image: Schema.optional(Schema.String)
  }).annotate({ identifier: "Browser.SetDockTileParams" })
) as any as Schema.Codec<SetDockTileParams>

/**
 * Set the behavior when downloading a file.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDownloadBehaviorParams {
  /**
   * Whether to allow all or deny all download requests, or use default Chrome behavior if
   * available (otherwise deny). |allowAndName| allows download and names files according to
   * their download guids.
   */
  readonly behavior: SetDownloadBehaviorParamsBehavior
  /**
   * BrowserContext to set download behavior. When omitted, default browser context is used.
   */
  readonly browserContextId?: BrowserContextID | undefined
  /**
   * The default path to save downloaded files to. This is required if behavior is set to 'allow'
   * or 'allowAndName'.
   */
  readonly downloadPath?: string | undefined
  /**
   * Whether to emit download events (defaults to false).
   */
  readonly eventsEnabled?: boolean | undefined
}

/**
 * Schema for `SetDownloadBehaviorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDownloadBehaviorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    behavior: SetDownloadBehaviorParamsBehavior,
    browserContextId: Schema.optional(BrowserContextID),
    downloadPath: Schema.optional(Schema.String),
    eventsEnabled: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Browser.SetDownloadBehaviorParams" })
) as any as Schema.Codec<SetDownloadBehaviorParams>

/**
 * Whether to allow all or deny all download requests, or use default Chrome behavior if
 * available (otherwise deny). |allowAndName| allows download and names files according to
 * their download guids.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetDownloadBehaviorParamsBehavior =
  | "deny"
  | "allow"
  | "allowAndName"
  | "default"
  | (string & {})

/**
 * Schema for `SetDownloadBehaviorParamsBehavior`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDownloadBehaviorParamsBehavior = Schema.String as any as Schema.Codec<SetDownloadBehaviorParamsBehavior>

/**
 * Sets and then gets the current globally-applied privacy control status
 * See https://www.w3.org/TR/gpc/#set-global-privacy-control
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetGlobalPrivacyControlParams {
  readonly gpc: boolean
}

/**
 * Schema for `SetGlobalPrivacyControlParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetGlobalPrivacyControlParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gpc: Schema.Boolean
  }).annotate({ identifier: "Browser.SetGlobalPrivacyControlParams" })
) as any as Schema.Codec<SetGlobalPrivacyControlParams>

/**
 * Sets and then gets the current globally-applied privacy control status
 * See https://www.w3.org/TR/gpc/#set-global-privacy-control
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetGlobalPrivacyControlResult {
  readonly gpc: boolean
}

/**
 * Schema for `SetGlobalPrivacyControlResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetGlobalPrivacyControlResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gpc: Schema.Boolean
  }).annotate({ identifier: "Browser.SetGlobalPrivacyControlResult" })
) as any as Schema.Codec<SetGlobalPrivacyControlResult>

/**
 * Set permission settings for given embedding and embedded origins.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPermissionParams {
  /**
   * Descriptor of permission to override.
   */
  readonly permission: PermissionDescriptor
  /**
   * Setting of the permission.
   */
  readonly setting: PermissionSetting
  /**
   * Embedding origin the permission applies to, all origins if not specified.
   */
  readonly origin?: string | undefined
  /**
   * Embedded origin the permission applies to. It is ignored unless the embedding origin is
   * present and valid. If the embedding origin is provided but the embedded origin isn't, the
   * embedding origin is used as the embedded origin.
   */
  readonly embeddedOrigin?: string | undefined
  /**
   * Context to override. When omitted, default browser context is used.
   */
  readonly browserContextId?: BrowserContextID | undefined
}

/**
 * Schema for `SetPermissionParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPermissionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    permission: PermissionDescriptor,
    setting: PermissionSetting,
    origin: Schema.optional(Schema.String),
    embeddedOrigin: Schema.optional(Schema.String),
    browserContextId: Schema.optional(BrowserContextID)
  }).annotate({ identifier: "Browser.SetPermissionParams" })
) as any as Schema.Codec<SetPermissionParams>

/**
 * Set position and/or size of the browser window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetWindowBoundsParams {
  /**
   * Browser window id.
   */
  readonly windowId: WindowID
  /**
   * New window bounds. The 'minimized', 'maximized' and 'fullscreen' states cannot be combined
   * with 'left', 'top', 'width' or 'height'. Leaves unspecified fields unchanged.
   */
  readonly bounds: Bounds
}

/**
 * Schema for `SetWindowBoundsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetWindowBoundsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    windowId: WindowID,
    bounds: Bounds
  }).annotate({ identifier: "Browser.SetWindowBoundsParams" })
) as any as Schema.Codec<SetWindowBoundsParams>

/**
 * Adds or updates a mock camera in the shared video capture device list for
 * test automation. The mock camera is not scoped to a particular page or
 * frame and is removed when the DevTools session that created it disconnects.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addMockCamera: Protocol.CommandDef<"Browser.addMockCamera", AddMockCameraParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.addMockCamera",
    AddMockCameraParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Allows a site to use privacy sandbox features that require enrollment
 * without the site actually being enrolled. Only supported on page targets.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addPrivacySandboxEnrollmentOverride: Protocol.CommandDef<
  "Browser.addPrivacySandboxEnrollmentOverride",
  AddPrivacySandboxEnrollmentOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Browser.addPrivacySandboxEnrollmentOverride",
  AddPrivacySandboxEnrollmentOverrideParams,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Cancel a download if in progress
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const cancelDownload: Protocol.CommandDef<"Browser.cancelDownload", CancelDownloadParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.cancelDownload",
    CancelDownloadParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Close browser gracefully.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const close: Protocol.CommandDef<"Browser.close", void, void> = /*#__PURE__*/ Protocol.command(
  "Browser.close",
  undefined,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Crashes browser on the main thread.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const crash: Protocol.CommandDef<"Browser.crash", void, void> = /*#__PURE__*/ Protocol.command(
  "Browser.crash",
  undefined,
  undefined,
  { status: "experimental", session: "browser" }
)

/**
 * Crashes GPU process.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const crashGpuProcess: Protocol.CommandDef<"Browser.crashGpuProcess", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Browser.crashGpuProcess",
    undefined,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Invoke custom browser commands used by telemetry.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const executeBrowserCommand: Protocol.CommandDef<
  "Browser.executeBrowserCommand",
  ExecuteBrowserCommandParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Browser.executeBrowserCommand",
  ExecuteBrowserCommandParams,
  undefined,
  { status: "experimental", session: "browser" }
)

/**
 * Returns the command line switches for the browser process if, and only if
 * --enable-automation is on the commandline.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getBrowserCommandLine: Protocol.CommandDef<
  "Browser.getBrowserCommandLine",
  void,
  GetBrowserCommandLineResult
> = /*#__PURE__*/ Protocol.command(
  "Browser.getBrowserCommandLine",
  undefined,
  GetBrowserCommandLineResult,
  { status: "experimental", session: "browser" }
)

/**
 * Gets the current globally-applied privacy control status
 * See https://www.w3.org/TR/gpc/#get-global-privacy-control
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getGlobalPrivacyControl: Protocol.CommandDef<
  "Browser.getGlobalPrivacyControl",
  void,
  GetGlobalPrivacyControlResult
> = /*#__PURE__*/ Protocol.command(
  "Browser.getGlobalPrivacyControl",
  undefined,
  GetGlobalPrivacyControlResult,
  { status: "experimental", session: "browser" }
)

/**
 * Get a Chrome histogram by name.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getHistogram: Protocol.CommandDef<"Browser.getHistogram", GetHistogramParams, GetHistogramResult> =
  /*#__PURE__*/ Protocol.command(
    "Browser.getHistogram",
    GetHistogramParams,
    GetHistogramResult,
    { status: "experimental", session: "browser" }
  )

/**
 * Get Chrome histograms.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getHistograms: Protocol.CommandDef<"Browser.getHistograms", GetHistogramsParams, GetHistogramsResult> =
  /*#__PURE__*/ Protocol.command(
    "Browser.getHistograms",
    GetHistogramsParams,
    GetHistogramsResult,
    { status: "experimental", session: "browser" }
  )

/**
 * Returns version information.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getVersion: Protocol.CommandDef<"Browser.getVersion", void, GetVersionResult> = /*#__PURE__*/ Protocol
  .command(
    "Browser.getVersion",
    undefined,
    GetVersionResult,
    { status: "stable", session: "browser" }
  )

/**
 * Get position and size of the browser window.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getWindowBounds: Protocol.CommandDef<
  "Browser.getWindowBounds",
  GetWindowBoundsParams,
  GetWindowBoundsResult
> = /*#__PURE__*/ Protocol.command(
  "Browser.getWindowBounds",
  GetWindowBoundsParams,
  GetWindowBoundsResult,
  { status: "experimental", session: "browser" }
)

/**
 * Get the browser window that contains the devtools target.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getWindowForTarget: Protocol.CommandDef<
  "Browser.getWindowForTarget",
  GetWindowForTargetParams,
  GetWindowForTargetResult
> = /*#__PURE__*/ Protocol.command(
  "Browser.getWindowForTarget",
  GetWindowForTargetParams,
  GetWindowForTargetResult,
  { status: "experimental", session: "browser" }
)

/**
 * Reset all permission management for all origins.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resetPermissions: Protocol.CommandDef<"Browser.resetPermissions", ResetPermissionsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.resetPermissions",
    ResetPermissionsParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Set size of the browser contents resizing browser window as necessary.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setContentsSize: Protocol.CommandDef<"Browser.setContentsSize", SetContentsSizeParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.setContentsSize",
    SetContentsSizeParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Set dock tile details, platform-specific.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDockTile: Protocol.CommandDef<"Browser.setDockTile", SetDockTileParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Browser.setDockTile",
    SetDockTileParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Set the behavior when downloading a file.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDownloadBehavior: Protocol.CommandDef<"Browser.setDownloadBehavior", SetDownloadBehaviorParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.setDownloadBehavior",
    SetDownloadBehaviorParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Sets and then gets the current globally-applied privacy control status
 * See https://www.w3.org/TR/gpc/#set-global-privacy-control
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setGlobalPrivacyControl: Protocol.CommandDef<
  "Browser.setGlobalPrivacyControl",
  SetGlobalPrivacyControlParams,
  SetGlobalPrivacyControlResult
> = /*#__PURE__*/ Protocol.command(
  "Browser.setGlobalPrivacyControl",
  SetGlobalPrivacyControlParams,
  SetGlobalPrivacyControlResult,
  { status: "experimental", session: "browser" }
)

/**
 * Set permission settings for given embedding and embedded origins.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPermission: Protocol.CommandDef<"Browser.setPermission", SetPermissionParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.setPermission",
    SetPermissionParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Set position and/or size of the browser window.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setWindowBounds: Protocol.CommandDef<"Browser.setWindowBounds", SetWindowBoundsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Browser.setWindowBounds",
    SetWindowBoundsParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Fired when download makes progress. Last call has |done| == true.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const downloadProgress: Protocol.EventDef<"Browser.downloadProgress", DownloadProgressParams> =
  /*#__PURE__*/ Protocol.event(
    "Browser.downloadProgress",
    DownloadProgressParams,
    { status: "experimental" }
  )

/**
 * Fired when page is about to start a download.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const downloadWillBegin: Protocol.EventDef<"Browser.downloadWillBegin", DownloadWillBeginParams> =
  /*#__PURE__*/ Protocol.event(
    "Browser.downloadWillBegin",
    DownloadWillBeginParams,
    { status: "experimental" }
  )
