/**
 * The CacheStorage domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Storage from "./Storage.ts"

/**
 * Cache identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Cache {
  /**
   * An opaque unique id of the cache.
   */
  readonly cacheId: CacheId
  /**
   * Security origin of the cache.
   */
  readonly securityOrigin: string
  /**
   * Storage key of the cache.
   */
  readonly storageKey: string
  /**
   * Storage bucket of the cache.
   */
  readonly storageBucket?: Storage.StorageBucket | undefined
  /**
   * The name of the cache.
   */
  readonly cacheName: string
}

/**
 * Schema for `Cache`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Cache = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheId: CacheId,
    securityOrigin: Schema.String,
    storageKey: Schema.String,
    storageBucket: Schema.optional(Storage.StorageBucket),
    cacheName: Schema.String
  }).annotate({ identifier: "CacheStorage.Cache" })
) as any as Schema.Codec<Cache>

/**
 * Unique identifier of the Cache object.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CacheId = Brand.Branded<string, "~@usestrider/browser/cdp/CacheStorage/CacheId">

/**
 * Schema for `CacheId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CacheId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/CacheStorage/CacheId")
) as any as Schema.Codec<CacheId>

/**
 * Cached response
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CachedResponse {
  /**
   * Entry content, base64-encoded. (Encoded as a base64 string when passed over JSON)
   */
  readonly body: string
}

/**
 * Schema for `CachedResponse`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CachedResponse = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    body: Schema.String
  }).annotate({ identifier: "CacheStorage.CachedResponse" })
) as any as Schema.Codec<CachedResponse>

/**
 * type of HTTP response cached
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CachedResponseType =
  | "basic"
  | "cors"
  | "default"
  | "error"
  | "opaqueResponse"
  | "opaqueRedirect"
  | (string & {})

/**
 * Schema for `CachedResponseType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CachedResponseType = Schema.String as any as Schema.Codec<CachedResponseType>

/**
 * Data entry.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DataEntry {
  /**
   * Request URL.
   */
  readonly requestURL: string
  /**
   * Request method.
   */
  readonly requestMethod: string
  /**
   * Request headers
   */
  readonly requestHeaders: ReadonlyArray<Header>
  /**
   * Number of seconds since epoch.
   */
  readonly responseTime: number
  /**
   * HTTP response status code.
   */
  readonly responseStatus: number
  /**
   * HTTP response status text.
   */
  readonly responseStatusText: string
  /**
   * HTTP response type
   */
  readonly responseType: CachedResponseType
  /**
   * Response headers
   */
  readonly responseHeaders: ReadonlyArray<Header>
}

/**
 * Schema for `DataEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DataEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestURL: Schema.String,
    requestMethod: Schema.String,
    requestHeaders: Schema.Array(Header),
    responseTime: Schema.Number,
    responseStatus: Schema.Int,
    responseStatusText: Schema.String,
    responseType: CachedResponseType,
    responseHeaders: Schema.Array(Header)
  }).annotate({ identifier: "CacheStorage.DataEntry" })
) as any as Schema.Codec<DataEntry>

/**
 * `Header`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Header {
  readonly name: string
  readonly value: string
}

/**
 * Schema for `Header`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Header = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "CacheStorage.Header" })
) as any as Schema.Codec<Header>

/**
 * Deletes a cache.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeleteCacheParams {
  /**
   * Id of cache for deletion.
   */
  readonly cacheId: CacheId
}

/**
 * Schema for `DeleteCacheParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeleteCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheId: CacheId
  }).annotate({ identifier: "CacheStorage.DeleteCacheParams" })
) as any as Schema.Codec<DeleteCacheParams>

/**
 * Deletes a cache entry.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeleteEntryParams {
  /**
   * Id of cache where the entry will be deleted.
   */
  readonly cacheId: CacheId
  /**
   * URL spec of the request.
   */
  readonly request: string
}

/**
 * Schema for `DeleteEntryParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeleteEntryParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheId: CacheId,
    request: Schema.String
  }).annotate({ identifier: "CacheStorage.DeleteEntryParams" })
) as any as Schema.Codec<DeleteEntryParams>

/**
 * Requests cache names.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestCacheNamesParams {
  /**
   * At least and at most one of securityOrigin, storageKey, storageBucket must be specified.
   * Security origin.
   */
  readonly securityOrigin?: string | undefined
  /**
   * Storage key.
   */
  readonly storageKey?: string | undefined
  /**
   * Storage bucket. If not specified, it uses the default bucket.
   */
  readonly storageBucket?: Storage.StorageBucket | undefined
}

/**
 * Schema for `RequestCacheNamesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestCacheNamesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.optional(Schema.String),
    storageKey: Schema.optional(Schema.String),
    storageBucket: Schema.optional(Storage.StorageBucket)
  }).annotate({ identifier: "CacheStorage.RequestCacheNamesParams" })
) as any as Schema.Codec<RequestCacheNamesParams>

/**
 * Requests cache names.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestCacheNamesResult {
  /**
   * Caches for the security origin.
   */
  readonly caches: ReadonlyArray<Cache>
}

/**
 * Schema for `RequestCacheNamesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestCacheNamesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    caches: Schema.Array(Cache)
  }).annotate({ identifier: "CacheStorage.RequestCacheNamesResult" })
) as any as Schema.Codec<RequestCacheNamesResult>

/**
 * Fetches cache entry.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestCachedResponseParams {
  /**
   * Id of cache that contains the entry.
   */
  readonly cacheId: CacheId
  /**
   * URL spec of the request.
   */
  readonly requestURL: string
  /**
   * headers of the request.
   */
  readonly requestHeaders: ReadonlyArray<Header>
}

/**
 * Schema for `RequestCachedResponseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestCachedResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheId: CacheId,
    requestURL: Schema.String,
    requestHeaders: Schema.Array(Header)
  }).annotate({ identifier: "CacheStorage.RequestCachedResponseParams" })
) as any as Schema.Codec<RequestCachedResponseParams>

/**
 * Fetches cache entry.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestCachedResponseResult {
  /**
   * Response read from the cache.
   */
  readonly response: CachedResponse
}

/**
 * Schema for `RequestCachedResponseResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestCachedResponseResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    response: CachedResponse
  }).annotate({ identifier: "CacheStorage.RequestCachedResponseResult" })
) as any as Schema.Codec<RequestCachedResponseResult>

/**
 * Requests data from cache.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestEntriesParams {
  /**
   * ID of cache to get entries from.
   */
  readonly cacheId: CacheId
  /**
   * Number of records to skip.
   */
  readonly skipCount?: number | undefined
  /**
   * Number of records to fetch.
   */
  readonly pageSize?: number | undefined
  /**
   * If present, only return the entries containing this substring in the path
   */
  readonly pathFilter?: string | undefined
}

/**
 * Schema for `RequestEntriesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestEntriesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheId: CacheId,
    skipCount: Schema.optional(Schema.Int),
    pageSize: Schema.optional(Schema.Int),
    pathFilter: Schema.optional(Schema.String)
  }).annotate({ identifier: "CacheStorage.RequestEntriesParams" })
) as any as Schema.Codec<RequestEntriesParams>

/**
 * Requests data from cache.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestEntriesResult {
  /**
   * Array of object store data entries.
   */
  readonly cacheDataEntries: ReadonlyArray<DataEntry>
  /**
   * Count of returned entries from this storage. If pathFilter is empty, it
   * is the count of all entries from this storage.
   */
  readonly returnCount: number
}

/**
 * Schema for `RequestEntriesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestEntriesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheDataEntries: Schema.Array(DataEntry),
    returnCount: Schema.Number
  }).annotate({ identifier: "CacheStorage.RequestEntriesResult" })
) as any as Schema.Codec<RequestEntriesResult>

/**
 * Deletes a cache.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const deleteCache: Protocol.CommandDef<"CacheStorage.deleteCache", DeleteCacheParams, void> =
  /*#__PURE__*/ Protocol.command(
    "CacheStorage.deleteCache",
    DeleteCacheParams,
    undefined,
    { status: "stable" }
  )

/**
 * Deletes a cache entry.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const deleteEntry: Protocol.CommandDef<"CacheStorage.deleteEntry", DeleteEntryParams, void> =
  /*#__PURE__*/ Protocol.command(
    "CacheStorage.deleteEntry",
    DeleteEntryParams,
    undefined,
    { status: "stable" }
  )

/**
 * Requests cache names.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const requestCacheNames: Protocol.CommandDef<
  "CacheStorage.requestCacheNames",
  RequestCacheNamesParams,
  RequestCacheNamesResult
> = /*#__PURE__*/ Protocol.command(
  "CacheStorage.requestCacheNames",
  RequestCacheNamesParams,
  RequestCacheNamesResult,
  { status: "stable" }
)

/**
 * Fetches cache entry.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const requestCachedResponse: Protocol.CommandDef<
  "CacheStorage.requestCachedResponse",
  RequestCachedResponseParams,
  RequestCachedResponseResult
> = /*#__PURE__*/ Protocol.command(
  "CacheStorage.requestCachedResponse",
  RequestCachedResponseParams,
  RequestCachedResponseResult,
  { status: "stable" }
)

/**
 * Requests data from cache.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const requestEntries: Protocol.CommandDef<
  "CacheStorage.requestEntries",
  RequestEntriesParams,
  RequestEntriesResult
> = /*#__PURE__*/ Protocol.command(
  "CacheStorage.requestEntries",
  RequestEntriesParams,
  RequestEntriesResult,
  { status: "stable" }
)
