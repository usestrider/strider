/**
 * The Playwright domain.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"

/**
 * Id of Browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContextID = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Playwright/ContextID">

/**
 * Schema for `ContextID`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextID = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Playwright/ContextID")
) as any as Schema.Codec<ContextID>

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
   * True if cookie is http-only.
   */
  readonly httpOnly: boolean
  /**
   * True if cookie is secure.
   */
  readonly secure: boolean
  /**
   * True if cookie is session cookie.
   */
  readonly session: boolean
  /**
   * Cookie Same-Site policy.
   */
  readonly sameSite: CookieSameSitePolicy
  /**
   * Cookie partition key for partitioned (CHIPS) cookies.
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
    httpOnly: Schema.Boolean,
    secure: Schema.Boolean,
    session: Schema.Boolean,
    sameSite: CookieSameSitePolicy,
    partitionKey: Schema.optional(Schema.String)
  }).annotate({ identifier: "Playwright.Cookie" })
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
 * Geolocation
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Geolocation {
  /**
   * Mock latitude
   */
  readonly timestamp: number
  /**
   * Mock latitude
   */
  readonly latitude: number
  /**
   * Mock longitude
   */
  readonly longitude: number
  /**
   * Mock accuracy
   */
  readonly accuracy: number
}

/**
 * Schema for `Geolocation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Geolocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    latitude: Schema.Number,
    longitude: Schema.Number,
    accuracy: Schema.Number
  }).annotate({ identifier: "Playwright.Geolocation" })
) as any as Schema.Codec<Geolocation>

/**
 * Name-value pair
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NameValue {
  readonly name: string
  readonly value: string
}

/**
 * Schema for `NameValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NameValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "Playwright.NameValue" })
) as any as Schema.Codec<NameValue>

/**
 * Origin object
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OriginStorage {
  /**
   * Origin.
   */
  readonly origin: string
  /**
   * Storage entries.
   */
  readonly items: ReadonlyArray<NameValue>
}

/**
 * Schema for `OriginStorage`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OriginStorage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    items: Schema.Array(NameValue)
  }).annotate({ identifier: "Playwright.OriginStorage" })
) as any as Schema.Codec<OriginStorage>

/**
 * Id of WebPageProxy.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PageProxyID = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Playwright/PageProxyID">

/**
 * Schema for `PageProxyID`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageProxyID = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Playwright/PageProxyID")
) as any as Schema.Codec<PageProxyID>

/**
 * Cookie object
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieParam {
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
  readonly expires?: number | undefined
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly?: boolean | undefined
  /**
   * True if cookie is secure.
   */
  readonly secure?: boolean | undefined
  /**
   * True if cookie is session cookie.
   */
  readonly session?: boolean | undefined
  /**
   * Cookie Same-Site policy.
   */
  readonly sameSite?: CookieSameSitePolicy | undefined
  /**
   * Cookie partition key for partitioned (CHIPS) cookies.
   */
  readonly partitionKey?: string | undefined
}

/**
 * Schema for `SetCookieParam`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieParam = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
    domain: Schema.String,
    path: Schema.String,
    expires: Schema.optional(Schema.Number),
    httpOnly: Schema.optional(Schema.Boolean),
    secure: Schema.optional(Schema.Boolean),
    session: Schema.optional(Schema.Boolean),
    sameSite: Schema.optional(CookieSameSitePolicy),
    partitionKey: Schema.optional(Schema.String)
  }).annotate({ identifier: "Playwright.SetCookieParam" })
) as any as Schema.Codec<SetCookieParam>

/**
 * Cancels a current running download.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CancelDownloadParams {
  readonly uuid: string
}

/**
 * Schema for `CancelDownloadParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CancelDownloadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    uuid: Schema.String
  }).annotate({ identifier: "Playwright.CancelDownloadParams" })
) as any as Schema.Codec<CancelDownloadParams>

/**
 * Clears browser memory cache.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClearMemoryCacheParams {
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
}

/**
 * Schema for `ClearMemoryCacheParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClearMemoryCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID)
  }).annotate({ identifier: "Playwright.ClearMemoryCacheParams" })
) as any as Schema.Codec<ClearMemoryCacheParams>

/**
 * Closes the page, destroying the page proxy. Works for both live and crashed pages.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClosePageParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  /**
   * Whether to run the beforeunload page handlers.
   */
  readonly runBeforeUnload?: boolean | undefined
}

/**
 * Schema for `ClosePageParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClosePageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID,
    runBeforeUnload: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Playwright.ClosePageParams" })
) as any as Schema.Codec<ClosePageParams>

/**
 * Creates new ephemeral browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateContextParams {
  /**
   * Proxy server, similar to the one passed to --proxy-server
   */
  readonly proxyServer?: string | undefined
  /**
   * Proxy bypass list, similar to the one passed to --proxy-bypass-list
   */
  readonly proxyBypassList?: string | undefined
  /**
   * Wether to use storage partitioning. Be default Playwright disables the partitioning.
   */
  readonly enableStoragePartitioning?: boolean | undefined
}

/**
 * Schema for `CreateContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    proxyServer: Schema.optional(Schema.String),
    proxyBypassList: Schema.optional(Schema.String),
    enableStoragePartitioning: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Playwright.CreateContextParams" })
) as any as Schema.Codec<CreateContextParams>

/**
 * Creates new ephemeral browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateContextResult {
  /**
   * Unique identifier of the context.
   */
  readonly browserContextId: ContextID
}

/**
 * Schema for `CreateContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateContextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: ContextID
  }).annotate({ identifier: "Playwright.CreateContextResult" })
) as any as Schema.Codec<CreateContextResult>

/**
 * `createPage.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreatePageParams {
  /**
   * JSON Inspector Protocol message (command) to be dispatched on the backend.
   */
  readonly browserContextId?: ContextID | undefined
}

/**
 * Schema for `CreatePageParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreatePageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID)
  }).annotate({ identifier: "Playwright.CreatePageParams" })
) as any as Schema.Codec<CreatePageParams>

/**
 * `createPage.Result`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreatePageResult {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
}

/**
 * Schema for `CreatePageResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreatePageResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID
  }).annotate({ identifier: "Playwright.CreatePageResult" })
) as any as Schema.Codec<CreatePageResult>

/**
 * Deletes cookies in the given browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteAllCookiesParams {
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
}

/**
 * Schema for `DeleteAllCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteAllCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID)
  }).annotate({ identifier: "Playwright.DeleteAllCookiesParams" })
) as any as Schema.Codec<DeleteAllCookiesParams>

/**
 * Deletes browser context previously created with createContect. The command will automatically close all pages that use the context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteContextParams {
  /**
   * Identifier of the context to delete.
   */
  readonly browserContextId: ContextID
}

/**
 * Schema for `DeleteContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: ContextID
  }).annotate({ identifier: "Playwright.DeleteContextParams" })
) as any as Schema.Codec<DeleteContextParams>

/**
 * `downloadCreated.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadCreatedParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  /**
   * Unique identifier of the originating frame.
   */
  readonly frameId: Network.FrameId
  readonly uuid: string
  readonly url: string
}

/**
 * Schema for `DownloadCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID,
    frameId: Network.FrameId,
    uuid: Schema.String,
    url: Schema.String
  }).annotate({ identifier: "Playwright.DownloadCreatedParams" })
) as any as Schema.Codec<DownloadCreatedParams>

/**
 * `downloadFilenameSuggested.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadFilenameSuggestedParams {
  readonly uuid: string
  readonly suggestedFilename: string
}

/**
 * Schema for `DownloadFilenameSuggestedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadFilenameSuggestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    uuid: Schema.String,
    suggestedFilename: Schema.String
  }).annotate({ identifier: "Playwright.DownloadFilenameSuggestedParams" })
) as any as Schema.Codec<DownloadFilenameSuggestedParams>

/**
 * `downloadFinished.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadFinishedParams {
  readonly uuid: string
  readonly error: string
}

/**
 * Schema for `DownloadFinishedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadFinishedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    uuid: Schema.String,
    error: Schema.String
  }).annotate({ identifier: "Playwright.DownloadFinishedParams" })
) as any as Schema.Codec<DownloadFinishedParams>

/**
 * Returns all cookies in the given browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAllCookiesParams {
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
}

/**
 * Schema for `GetAllCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAllCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID)
  }).annotate({ identifier: "Playwright.GetAllCookiesParams" })
) as any as Schema.Codec<GetAllCookiesParams>

/**
 * Returns all cookies in the given browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAllCookiesResult {
  /**
   * Cookies.
   */
  readonly cookies: ReadonlyArray<Cookie>
}

/**
 * Schema for `GetAllCookiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAllCookiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookies: Schema.Array(Cookie)
  }).annotate({ identifier: "Playwright.GetAllCookiesResult" })
) as any as Schema.Codec<GetAllCookiesResult>

/**
 * `getInfo.Result`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetInfoResult {
  /**
   * Name of the operating system where the browser is running (macOS, Linux or Windows).
   */
  readonly os: string
}

/**
 * Schema for `GetInfoResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetInfoResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    os: Schema.String
  }).annotate({ identifier: "Playwright.GetInfoResult" })
) as any as Schema.Codec<GetInfoResult>

/**
 * Grants read access for the specified files to the web process of the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GrantFileReadAccessParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  /**
   * Id of the frame to navigate.
   */
  readonly paths: ReadonlyArray<string>
}

/**
 * Schema for `GrantFileReadAccessParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GrantFileReadAccessParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID,
    paths: Schema.Array(Schema.String)
  }).annotate({ identifier: "Playwright.GrantFileReadAccessParams" })
) as any as Schema.Codec<GrantFileReadAccessParams>

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
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  /**
   * Id of the frame to navigate.
   */
  readonly frameId?: Network.FrameId | undefined
  /**
   * Referrer URL.
   */
  readonly referrer?: string | undefined
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
    pageProxyId: PageProxyID,
    frameId: Schema.optional(Network.FrameId),
    referrer: Schema.optional(Schema.String)
  }).annotate({ identifier: "Playwright.NavigateParams" })
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
   * Identifier of the loader associated with the navigation.
   */
  readonly loaderId?: Network.LoaderId | undefined
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
    loaderId: Schema.optional(Network.LoaderId)
  }).annotate({ identifier: "Playwright.NavigateResult" })
) as any as Schema.Codec<NavigateResult>

/**
 * `pageProxyCreated.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PageProxyCreatedParams {
  /**
   * Unique identifier of the context.
   */
  readonly browserContextId: ContextID
  readonly pageProxyId: PageProxyID
  /**
   * Unique identifier of the opening page. Only set for pages created by window.open().
   */
  readonly openerId?: PageProxyID | undefined
}

/**
 * Schema for `PageProxyCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageProxyCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: ContextID,
    pageProxyId: PageProxyID,
    openerId: Schema.optional(PageProxyID)
  }).annotate({ identifier: "Playwright.PageProxyCreatedParams" })
) as any as Schema.Codec<PageProxyCreatedParams>

/**
 * `pageProxyDestroyed.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PageProxyDestroyedParams {
  readonly pageProxyId: PageProxyID
}

/**
 * Schema for `PageProxyDestroyedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageProxyDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID
  }).annotate({ identifier: "Playwright.PageProxyDestroyedParams" })
) as any as Schema.Codec<PageProxyDestroyedParams>

/**
 * Fired when provisional load fails.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProvisionalLoadFailedParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  /**
   * Identifier of the loader associated with the navigation.
   */
  readonly loaderId: Network.LoaderId
  /**
   * Localized error string.
   */
  readonly error: string
}

/**
 * Schema for `ProvisionalLoadFailedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProvisionalLoadFailedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID,
    loaderId: Network.LoaderId,
    error: Schema.String
  }).annotate({ identifier: "Playwright.ProvisionalLoadFailedParams" })
) as any as Schema.Codec<ProvisionalLoadFailedParams>

/**
 * Sets cookies in the given browser context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookiesParams {
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
  /**
   * Cookies.
   */
  readonly cookies: ReadonlyArray<SetCookieParam>
}

/**
 * Schema for `SetCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID),
    cookies: Schema.Array(SetCookieParam)
  }).annotate({ identifier: "Playwright.SetCookiesParams" })
) as any as Schema.Codec<SetCookiesParams>

/**
 * Allows to override download behavior.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDownloadBehaviorParams {
  readonly behavior?: SetDownloadBehaviorParamsBehavior | undefined
  readonly downloadPath?: string | undefined
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
}

/**
 * Schema for `SetDownloadBehaviorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDownloadBehaviorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    behavior: Schema.optional(SetDownloadBehaviorParamsBehavior),
    downloadPath: Schema.optional(Schema.String),
    browserContextId: Schema.optional(ContextID)
  }).annotate({ identifier: "Playwright.SetDownloadBehaviorParams" })
) as any as Schema.Codec<SetDownloadBehaviorParams>

/**
 * `setDownloadBehavior.Params.behavior` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetDownloadBehaviorParamsBehavior =
  | "allow"
  | "deny"
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
 * Overrides the geolocation position or error.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetGeolocationOverrideParams {
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
  /**
   * Geolocation to set, if missing emulates position unavailable.
   */
  readonly geolocation?: Geolocation | undefined
}

/**
 * Schema for `SetGeolocationOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGeolocationOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID),
    geolocation: Schema.optional(Geolocation)
  }).annotate({ identifier: "Playwright.SetGeolocationOverrideParams" })
) as any as Schema.Codec<SetGeolocationOverrideParams>

/**
 * Change whether all certificate errors should be ignored.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetIgnoreCertificateErrorsParams {
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
  readonly ignore: boolean
}

/**
 * Schema for `SetIgnoreCertificateErrorsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetIgnoreCertificateErrorsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(ContextID),
    ignore: Schema.Boolean
  }).annotate({ identifier: "Playwright.SetIgnoreCertificateErrorsParams" })
) as any as Schema.Codec<SetIgnoreCertificateErrorsParams>

/**
 * Allows to set locale language for context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetLanguagesParams {
  readonly languages: ReadonlyArray<string>
  /**
   * Browser context id.
   */
  readonly browserContextId?: ContextID | undefined
}

/**
 * Schema for `SetLanguagesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLanguagesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    languages: Schema.Array(Schema.String),
    browserContextId: Schema.optional(ContextID)
  }).annotate({ identifier: "Playwright.SetLanguagesParams" })
) as any as Schema.Codec<SetLanguagesParams>

/**
 * Changes page zoom factor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPageZoomFactorParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  readonly zoomFactor: number
}

/**
 * Schema for `SetPageZoomFactorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPageZoomFactorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID,
    zoomFactor: Schema.Number
  }).annotate({ identifier: "Playwright.SetPageZoomFactorParams" })
) as any as Schema.Codec<SetPageZoomFactorParams>

/**
 * Capture a snapshot of the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakePageScreenshotParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
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
   * By default, screenshot is inflated by device scale factor to avoid blurry image. This flag disables it.
   */
  readonly omitDeviceScaleFactor?: boolean | undefined
}

/**
 * Schema for `TakePageScreenshotParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakePageScreenshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageProxyId: PageProxyID,
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int,
    height: Schema.Int,
    omitDeviceScaleFactor: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Playwright.TakePageScreenshotParams" })
) as any as Schema.Codec<TakePageScreenshotParams>

/**
 * Capture a snapshot of the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakePageScreenshotResult {
  /**
   * Base64-encoded image data (PNG).
   */
  readonly dataURL: string
}

/**
 * Schema for `TakePageScreenshotResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakePageScreenshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataURL: Schema.String
  }).annotate({ identifier: "Playwright.TakePageScreenshotResult" })
) as any as Schema.Codec<TakePageScreenshotResult>

/**
 * Fired when page opens a new window.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WindowOpenParams {
  /**
   * Unique identifier of the page proxy.
   */
  readonly pageProxyId: PageProxyID
  readonly url: string
  readonly windowFeatures: ReadonlyArray<string>
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
    pageProxyId: PageProxyID,
    url: Schema.String,
    windowFeatures: Schema.Array(Schema.String)
  }).annotate({ identifier: "Playwright.WindowOpenParams" })
) as any as Schema.Codec<WindowOpenParams>

/**
 * Cancels a current running download.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const cancelDownload: Protocol.CommandDef<"Playwright.cancelDownload", CancelDownloadParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.cancelDownload",
    CancelDownloadParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Clears browser memory cache.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearMemoryCache: Protocol.CommandDef<"Playwright.clearMemoryCache", ClearMemoryCacheParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.clearMemoryCache",
    ClearMemoryCacheParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Close browser.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const close: Protocol.CommandDef<"Playwright.close", void, void> = /*#__PURE__*/ Protocol.command(
  "Playwright.close",
  undefined,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Closes the page, destroying the page proxy. Works for both live and crashed pages.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const closePage: Protocol.CommandDef<"Playwright.closePage", ClosePageParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Playwright.closePage",
    ClosePageParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Creates new ephemeral browser context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createContext: Protocol.CommandDef<"Playwright.createContext", CreateContextParams, CreateContextResult> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.createContext",
    CreateContextParams,
    CreateContextResult,
    {
      status: "stable",
      session: "browser",
      createsResource: true,
      release: [{ method: "Playwright.deleteContext", param: "browserContextId", from: "/browserContextId" }]
    }
  )

/**
 * Sends `Playwright.createPage`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createPage: Protocol.CommandDef<"Playwright.createPage", CreatePageParams, CreatePageResult> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.createPage",
    CreatePageParams,
    CreatePageResult,
    {
      status: "stable",
      session: "browser",
      createsResource: true,
      release: [{ method: "Playwright.closePage", param: "pageProxyId", from: "/pageProxyId" }]
    }
  )

/**
 * Deletes cookies in the given browser context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteAllCookies: Protocol.CommandDef<"Playwright.deleteAllCookies", DeleteAllCookiesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.deleteAllCookies",
    DeleteAllCookiesParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Deletes browser context previously created with createContect. The command will automatically close all pages that use the context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteContext: Protocol.CommandDef<"Playwright.deleteContext", DeleteContextParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.deleteContext",
    DeleteContextParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Sends `Playwright.disable`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Playwright.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Playwright.disable",
  undefined,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Sends `Playwright.enable`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Playwright.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Playwright.enable",
  undefined,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Returns all cookies in the given browser context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAllCookies: Protocol.CommandDef<"Playwright.getAllCookies", GetAllCookiesParams, GetAllCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.getAllCookies",
    GetAllCookiesParams,
    GetAllCookiesResult,
    { status: "stable", session: "browser" }
  )

/**
 * Sends `Playwright.getInfo`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getInfo: Protocol.CommandDef<"Playwright.getInfo", void, GetInfoResult> = /*#__PURE__*/ Protocol.command(
  "Playwright.getInfo",
  undefined,
  GetInfoResult,
  { status: "stable", session: "browser" }
)

/**
 * Grants read access for the specified files to the web process of the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const grantFileReadAccess: Protocol.CommandDef<
  "Playwright.grantFileReadAccess",
  GrantFileReadAccessParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Playwright.grantFileReadAccess",
  GrantFileReadAccessParams,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Navigates current page to the given URL.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const navigate: Protocol.CommandDef<"Playwright.navigate", NavigateParams, NavigateResult> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.navigate",
    NavigateParams,
    NavigateResult,
    { status: "stable", session: "browser" }
  )

/**
 * Sets cookies in the given browser context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCookies: Protocol.CommandDef<"Playwright.setCookies", SetCookiesParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Playwright.setCookies",
    SetCookiesParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Allows to override download behavior.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDownloadBehavior: Protocol.CommandDef<
  "Playwright.setDownloadBehavior",
  SetDownloadBehaviorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Playwright.setDownloadBehavior",
  SetDownloadBehaviorParams,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Overrides the geolocation position or error.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setGeolocationOverride: Protocol.CommandDef<
  "Playwright.setGeolocationOverride",
  SetGeolocationOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Playwright.setGeolocationOverride",
  SetGeolocationOverrideParams,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Change whether all certificate errors should be ignored.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setIgnoreCertificateErrors: Protocol.CommandDef<
  "Playwright.setIgnoreCertificateErrors",
  SetIgnoreCertificateErrorsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Playwright.setIgnoreCertificateErrors",
  SetIgnoreCertificateErrorsParams,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Allows to set locale language for context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setLanguages: Protocol.CommandDef<"Playwright.setLanguages", SetLanguagesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.setLanguages",
    SetLanguagesParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Changes page zoom factor.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPageZoomFactor: Protocol.CommandDef<"Playwright.setPageZoomFactor", SetPageZoomFactorParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Playwright.setPageZoomFactor",
    SetPageZoomFactorParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Capture a snapshot of the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const takePageScreenshot: Protocol.CommandDef<
  "Playwright.takePageScreenshot",
  TakePageScreenshotParams,
  TakePageScreenshotResult
> = /*#__PURE__*/ Protocol.command(
  "Playwright.takePageScreenshot",
  TakePageScreenshotParams,
  TakePageScreenshotResult,
  { status: "stable", session: "browser" }
)

/**
 * The `Playwright.downloadCreated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const downloadCreated: Protocol.EventDef<"Playwright.downloadCreated", DownloadCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Playwright.downloadCreated",
    DownloadCreatedParams,
    { status: "stable" }
  )

/**
 * The `Playwright.downloadFilenameSuggested` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const downloadFilenameSuggested: Protocol.EventDef<
  "Playwright.downloadFilenameSuggested",
  DownloadFilenameSuggestedParams
> = /*#__PURE__*/ Protocol.event(
  "Playwright.downloadFilenameSuggested",
  DownloadFilenameSuggestedParams,
  { status: "stable" }
)

/**
 * The `Playwright.downloadFinished` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const downloadFinished: Protocol.EventDef<"Playwright.downloadFinished", DownloadFinishedParams> =
  /*#__PURE__*/ Protocol.event(
    "Playwright.downloadFinished",
    DownloadFinishedParams,
    { status: "stable" }
  )

/**
 * The `Playwright.pageProxyCreated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const pageProxyCreated: Protocol.EventDef<"Playwright.pageProxyCreated", PageProxyCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Playwright.pageProxyCreated",
    PageProxyCreatedParams,
    { status: "stable" }
  )

/**
 * The `Playwright.pageProxyDestroyed` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const pageProxyDestroyed: Protocol.EventDef<"Playwright.pageProxyDestroyed", PageProxyDestroyedParams> =
  /*#__PURE__*/ Protocol.event(
    "Playwright.pageProxyDestroyed",
    PageProxyDestroyedParams,
    { status: "stable" }
  )

/**
 * Fired when provisional load fails.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const provisionalLoadFailed: Protocol.EventDef<"Playwright.provisionalLoadFailed", ProvisionalLoadFailedParams> =
  /*#__PURE__*/ Protocol.event(
    "Playwright.provisionalLoadFailed",
    ProvisionalLoadFailedParams,
    { status: "stable" }
  )

/**
 * Fired when page opens a new window.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const windowOpen: Protocol.EventDef<"Playwright.windowOpen", WindowOpenParams> = /*#__PURE__*/ Protocol.event(
  "Playwright.windowOpen",
  WindowOpenParams,
  { status: "stable" }
)
