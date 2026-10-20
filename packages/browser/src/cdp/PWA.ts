/**
 * This domain allows interacting with the browser to control PWAs.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Target from "./Target.ts"

/**
 * If user prefers opening the app in browser or an app window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DisplayMode =
  | "standalone"
  | "browser"
  | (string & {})

/**
 * Schema for `DisplayMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisplayMode = Schema.String as any as Schema.Codec<DisplayMode>

/**
 * `FileHandler`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FileHandler {
  readonly action: string
  readonly accepts: ReadonlyArray<FileHandlerAccept>
  readonly displayName: string
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
    accepts: Schema.Array(FileHandlerAccept),
    displayName: Schema.String
  }).annotate({ identifier: "PWA.FileHandler" })
) as any as Schema.Codec<FileHandler>

/**
 * The following types are the replica of
 * https://crsrc.org/c/chrome/browser/web_applications/proto/web_app_os_integration_state.proto;drc=9910d3be894c8f142c977ba1023f30a656bc13fc;l=67
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FileHandlerAccept {
  /**
   * New name of the mimetype according to
   * https://www.iana.org/assignments/media-types/media-types.xhtml
   */
  readonly mediaType: string
  readonly fileExtensions: ReadonlyArray<string>
}

/**
 * Schema for `FileHandlerAccept`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FileHandlerAccept = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mediaType: Schema.String,
    fileExtensions: Schema.Array(Schema.String)
  }).annotate({ identifier: "PWA.FileHandlerAccept" })
) as any as Schema.Codec<FileHandlerAccept>

/**
 * Changes user settings of the web app identified by its manifestId. If the
 * app was not installed, this command returns an error. Unset parameters will
 * be ignored; unrecognized values will cause an error.
 *
 * Unlike the ones defined in the manifest files of the web apps, these
 * settings are provided by the browser and controlled by the users, they
 * impact the way the browser handling the web apps.
 *
 * See the comment of each parameter.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ChangeAppUserSettingsParams {
  readonly manifestId: string
  /**
   * If user allows the links clicked on by the user in the app's scope, or
   * extended scope if the manifest has scope extensions and the flags
   * `DesktopPWAsLinkCapturingWithScopeExtensions` and
   * `WebAppEnableScopeExtensions` are enabled.
   *
   * Note, the API does not support resetting the linkCapturing to the
   * initial value, uninstalling and installing the web app again will reset
   * it.
   *
   * TODO(crbug.com/339453269): Setting this value on ChromeOS is not
   * supported yet.
   */
  readonly linkCapturing?: boolean | undefined
  readonly displayMode?: DisplayMode | undefined
}

/**
 * Schema for `ChangeAppUserSettingsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ChangeAppUserSettingsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String,
    linkCapturing: Schema.optional(Schema.Boolean),
    displayMode: Schema.optional(DisplayMode)
  }).annotate({ identifier: "PWA.ChangeAppUserSettingsParams" })
) as any as Schema.Codec<ChangeAppUserSettingsParams>

/**
 * Returns the following OS state for the given manifest id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetOsAppStateParams {
  /**
   * The id from the webapp's manifest file, commonly it's the url of the
   * site installing the webapp. See
   * https://web.dev/learn/pwa/web-app-manifest.
   */
  readonly manifestId: string
}

/**
 * Schema for `GetOsAppStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetOsAppStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String
  }).annotate({ identifier: "PWA.GetOsAppStateParams" })
) as any as Schema.Codec<GetOsAppStateParams>

/**
 * Returns the following OS state for the given manifest id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetOsAppStateResult {
  readonly badgeCount: number
  readonly fileHandlers: ReadonlyArray<FileHandler>
}

/**
 * Schema for `GetOsAppStateResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetOsAppStateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    badgeCount: Schema.Int,
    fileHandlers: Schema.Array(FileHandler)
  }).annotate({ identifier: "PWA.GetOsAppStateResult" })
) as any as Schema.Codec<GetOsAppStateResult>

/**
 * Installs the given manifest identity, optionally using the given installUrlOrBundleUrl
 *
 * IWA-specific install description:
 * manifestId corresponds to isolated-app:// + web_package::SignedWebBundleId
 *
 * File installation mode:
 * The installUrlOrBundleUrl can be either file:// or http(s):// pointing
 * to a signed web bundle (.swbn). In this case SignedWebBundleId must correspond to
 * The .swbn file's signing key.
 *
 * Dev proxy installation mode:
 * installUrlOrBundleUrl must be http(s):// that serves dev mode IWA.
 * web_package::SignedWebBundleId must be of type dev proxy.
 *
 * The advantage of dev proxy mode is that all changes to IWA
 * automatically will be reflected in the running app without
 * reinstallation.
 *
 * To generate bundle id for proxy mode:
 * 1. Generate 32 random bytes.
 * 2. Add a specific suffix at the end following the documentation
 *    https://github.com/WICG/isolated-web-apps/blob/main/Scheme.md#suffix
 * 3. Encode the entire sequence using Base32 without padding.
 *
 * If Chrome is not in IWA dev
 * mode, the installation will fail, regardless of the state of the allowlist.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InstallParams {
  readonly manifestId: string
  /**
   * The location of the app or bundle overriding the one derived from the
   * manifestId.
   */
  readonly installUrlOrBundleUrl?: string | undefined
}

/**
 * Schema for `InstallParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InstallParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String,
    installUrlOrBundleUrl: Schema.optional(Schema.String)
  }).annotate({ identifier: "PWA.InstallParams" })
) as any as Schema.Codec<InstallParams>

/**
 * Launches the installed web app, or an url in the same web app instead of the
 * default start url if it is provided. Returns a page Target.TargetID which
 * can be used to attach to via Target.attachToTarget or similar APIs.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LaunchParams {
  readonly manifestId: string
  readonly url?: string | undefined
}

/**
 * Schema for `LaunchParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LaunchParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String,
    url: Schema.optional(Schema.String)
  }).annotate({ identifier: "PWA.LaunchParams" })
) as any as Schema.Codec<LaunchParams>

/**
 * Launches the installed web app, or an url in the same web app instead of the
 * default start url if it is provided. Returns a page Target.TargetID which
 * can be used to attach to via Target.attachToTarget or similar APIs.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LaunchResult {
  /**
   * ID of the tab target created as a result.
   */
  readonly targetId: Target.TargetID
}

/**
 * Schema for `LaunchResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LaunchResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Target.TargetID
  }).annotate({ identifier: "PWA.LaunchResult" })
) as any as Schema.Codec<LaunchResult>

/**
 * Opens one or more local files from an installed web app identified by its
 * manifestId. The web app needs to have file handlers registered to process
 * the files. The API returns one or more page Target.TargetIDs which can be
 * used to attach to via Target.attachToTarget or similar APIs.
 * If some files in the parameters cannot be handled by the web app, they will
 * be ignored. If none of the files can be handled, this API returns an error.
 * If no files are provided as the parameter, this API also returns an error.
 *
 * According to the definition of the file handlers in the manifest file, one
 * Target.TargetID may represent a page handling one or more files. The order
 * of the returned Target.TargetIDs is not guaranteed.
 *
 * TODO(crbug.com/339454034): Check the existences of the input files.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LaunchFilesInAppParams {
  readonly manifestId: string
  readonly files: ReadonlyArray<string>
}

/**
 * Schema for `LaunchFilesInAppParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LaunchFilesInAppParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String,
    files: Schema.Array(Schema.String)
  }).annotate({ identifier: "PWA.LaunchFilesInAppParams" })
) as any as Schema.Codec<LaunchFilesInAppParams>

/**
 * Opens one or more local files from an installed web app identified by its
 * manifestId. The web app needs to have file handlers registered to process
 * the files. The API returns one or more page Target.TargetIDs which can be
 * used to attach to via Target.attachToTarget or similar APIs.
 * If some files in the parameters cannot be handled by the web app, they will
 * be ignored. If none of the files can be handled, this API returns an error.
 * If no files are provided as the parameter, this API also returns an error.
 *
 * According to the definition of the file handlers in the manifest file, one
 * Target.TargetID may represent a page handling one or more files. The order
 * of the returned Target.TargetIDs is not guaranteed.
 *
 * TODO(crbug.com/339454034): Check the existences of the input files.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LaunchFilesInAppResult {
  /**
   * IDs of the tab targets created as the result.
   */
  readonly targetIds: ReadonlyArray<Target.TargetID>
}

/**
 * Schema for `LaunchFilesInAppResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LaunchFilesInAppResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetIds: Schema.Array(Target.TargetID)
  }).annotate({ identifier: "PWA.LaunchFilesInAppResult" })
) as any as Schema.Codec<LaunchFilesInAppResult>

/**
 * Opens the current page in its web app identified by the manifest id, needs
 * to be called on a page target. This function returns immediately without
 * waiting for the app to finish loading.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OpenCurrentPageInAppParams {
  readonly manifestId: string
}

/**
 * Schema for `OpenCurrentPageInAppParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OpenCurrentPageInAppParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String
  }).annotate({ identifier: "PWA.OpenCurrentPageInAppParams" })
) as any as Schema.Codec<OpenCurrentPageInAppParams>

/**
 * Uninstalls the given manifest_id and closes any opened app windows.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UninstallParams {
  readonly manifestId: string
}

/**
 * Schema for `UninstallParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UninstallParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestId: Schema.String
  }).annotate({ identifier: "PWA.UninstallParams" })
) as any as Schema.Codec<UninstallParams>

/**
 * Changes user settings of the web app identified by its manifestId. If the
 * app was not installed, this command returns an error. Unset parameters will
 * be ignored; unrecognized values will cause an error.
 *
 * Unlike the ones defined in the manifest files of the web apps, these
 * settings are provided by the browser and controlled by the users, they
 * impact the way the browser handling the web apps.
 *
 * See the comment of each parameter.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const changeAppUserSettings: Protocol.CommandDef<
  "PWA.changeAppUserSettings",
  ChangeAppUserSettingsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "PWA.changeAppUserSettings",
  ChangeAppUserSettingsParams,
  undefined,
  { status: "stable" }
)

/**
 * Returns the following OS state for the given manifest id.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getOsAppState: Protocol.CommandDef<"PWA.getOsAppState", GetOsAppStateParams, GetOsAppStateResult> =
  /*#__PURE__*/ Protocol.command(
    "PWA.getOsAppState",
    GetOsAppStateParams,
    GetOsAppStateResult,
    { status: "stable" }
  )

/**
 * Installs the given manifest identity, optionally using the given installUrlOrBundleUrl
 *
 * IWA-specific install description:
 * manifestId corresponds to isolated-app:// + web_package::SignedWebBundleId
 *
 * File installation mode:
 * The installUrlOrBundleUrl can be either file:// or http(s):// pointing
 * to a signed web bundle (.swbn). In this case SignedWebBundleId must correspond to
 * The .swbn file's signing key.
 *
 * Dev proxy installation mode:
 * installUrlOrBundleUrl must be http(s):// that serves dev mode IWA.
 * web_package::SignedWebBundleId must be of type dev proxy.
 *
 * The advantage of dev proxy mode is that all changes to IWA
 * automatically will be reflected in the running app without
 * reinstallation.
 *
 * To generate bundle id for proxy mode:
 * 1. Generate 32 random bytes.
 * 2. Add a specific suffix at the end following the documentation
 *    https://github.com/WICG/isolated-web-apps/blob/main/Scheme.md#suffix
 * 3. Encode the entire sequence using Base32 without padding.
 *
 * If Chrome is not in IWA dev
 * mode, the installation will fail, regardless of the state of the allowlist.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const install: Protocol.CommandDef<"PWA.install", InstallParams, void> = /*#__PURE__*/ Protocol.command(
  "PWA.install",
  InstallParams,
  undefined,
  { status: "stable" }
)

/**
 * Launches the installed web app, or an url in the same web app instead of the
 * default start url if it is provided. Returns a page Target.TargetID which
 * can be used to attach to via Target.attachToTarget or similar APIs.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const launch: Protocol.CommandDef<"PWA.launch", LaunchParams, LaunchResult> = /*#__PURE__*/ Protocol.command(
  "PWA.launch",
  LaunchParams,
  LaunchResult,
  { status: "stable" }
)

/**
 * Opens one or more local files from an installed web app identified by its
 * manifestId. The web app needs to have file handlers registered to process
 * the files. The API returns one or more page Target.TargetIDs which can be
 * used to attach to via Target.attachToTarget or similar APIs.
 * If some files in the parameters cannot be handled by the web app, they will
 * be ignored. If none of the files can be handled, this API returns an error.
 * If no files are provided as the parameter, this API also returns an error.
 *
 * According to the definition of the file handlers in the manifest file, one
 * Target.TargetID may represent a page handling one or more files. The order
 * of the returned Target.TargetIDs is not guaranteed.
 *
 * TODO(crbug.com/339454034): Check the existences of the input files.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const launchFilesInApp: Protocol.CommandDef<
  "PWA.launchFilesInApp",
  LaunchFilesInAppParams,
  LaunchFilesInAppResult
> = /*#__PURE__*/ Protocol.command(
  "PWA.launchFilesInApp",
  LaunchFilesInAppParams,
  LaunchFilesInAppResult,
  { status: "stable" }
)

/**
 * Opens the current page in its web app identified by the manifest id, needs
 * to be called on a page target. This function returns immediately without
 * waiting for the app to finish loading.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const openCurrentPageInApp: Protocol.CommandDef<"PWA.openCurrentPageInApp", OpenCurrentPageInAppParams, void> =
  /*#__PURE__*/ Protocol.command(
    "PWA.openCurrentPageInApp",
    OpenCurrentPageInAppParams,
    undefined,
    { status: "stable" }
  )

/**
 * Uninstalls the given manifest_id and closes any opened app windows.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const uninstall: Protocol.CommandDef<"PWA.uninstall", UninstallParams, void> = /*#__PURE__*/ Protocol.command(
  "PWA.uninstall",
  UninstallParams,
  undefined,
  { status: "stable" }
)
