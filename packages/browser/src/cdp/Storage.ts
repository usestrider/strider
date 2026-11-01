/**
 * The Storage domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"

/**
 * A single Related Website Set object.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RelatedWebsiteSet {
  /**
   * The primary site of this set, along with the ccTLDs if there is any.
   */
  readonly primarySites: ReadonlyArray<string>
  /**
   * The associated sites of this set, along with the ccTLDs if there is any.
   */
  readonly associatedSites: ReadonlyArray<string>
  /**
   * The service sites of this set, along with the ccTLDs if there is any.
   */
  readonly serviceSites: ReadonlyArray<string>
}

/**
 * Schema for `RelatedWebsiteSet`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RelatedWebsiteSet = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    primarySites: Schema.Array(Schema.String),
    associatedSites: Schema.Array(Schema.String),
    serviceSites: Schema.Array(Schema.String)
  }).annotate({ identifier: "Storage.RelatedWebsiteSet" })
) as any as Schema.Codec<RelatedWebsiteSet>

/**
 * `SerializedStorageKey`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SerializedStorageKey = string

/**
 * Schema for `SerializedStorageKey`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SerializedStorageKey = Schema.String as any as Schema.Codec<SerializedStorageKey>

/**
 * `StorageBucket`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StorageBucket {
  readonly storageKey: SerializedStorageKey
  /**
   * If not specified, it is the default bucket of the storageKey.
   */
  readonly name?: string | undefined
}

/**
 * Schema for `StorageBucket`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageBucket = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: SerializedStorageKey,
    name: Schema.optional(Schema.String)
  }).annotate({ identifier: "Storage.StorageBucket" })
) as any as Schema.Codec<StorageBucket>

/**
 * `StorageBucketInfo`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StorageBucketInfo {
  readonly bucket: StorageBucket
  readonly id: string
  readonly expiration: Network.TimeSinceEpoch
  /**
   * Storage quota (bytes).
   */
  readonly quota: number
  readonly persistent: boolean
  readonly durability: StorageBucketsDurability
}

/**
 * Schema for `StorageBucketInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageBucketInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bucket: StorageBucket,
    id: Schema.String,
    expiration: Network.TimeSinceEpoch,
    quota: Schema.Number,
    persistent: Schema.Boolean,
    durability: StorageBucketsDurability
  }).annotate({ identifier: "Storage.StorageBucketInfo" })
) as any as Schema.Codec<StorageBucketInfo>

/**
 * `StorageBucketsDurability` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StorageBucketsDurability =
  | "relaxed"
  | "strict"
  | (string & {})

/**
 * Schema for `StorageBucketsDurability`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageBucketsDurability = Schema.String as any as Schema.Codec<StorageBucketsDurability>

/**
 * Enum of possible storage types.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StorageType =
  | "cookies"
  | "file_systems"
  | "indexeddb"
  | "local_storage"
  | "shader_cache"
  | "websql"
  | "service_workers"
  | "cache_storage"
  | "storage_buckets"
  | "all"
  | "other"
  | (string & {})

/**
 * Schema for `StorageType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageType = Schema.String as any as Schema.Codec<StorageType>

/**
 * Pair of issuer origin and number of available (signed, but not used) Trust
 * Tokens from that issuer.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrustTokens {
  readonly issuerOrigin: string
  readonly count: number
}

/**
 * Schema for `TrustTokens`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrustTokens = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    issuerOrigin: Schema.String,
    count: Schema.Number
  }).annotate({ identifier: "Storage.TrustTokens" })
) as any as Schema.Codec<TrustTokens>

/**
 * Usage for a storage type.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UsageForType {
  /**
   * Name of storage type.
   */
  readonly storageType: StorageType
  /**
   * Storage usage (bytes).
   */
  readonly usage: number
}

/**
 * Schema for `UsageForType`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UsageForType = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageType: StorageType,
    usage: Schema.Number
  }).annotate({ identifier: "Storage.UsageForType" })
) as any as Schema.Codec<UsageForType>

/**
 * A cache's contents have been modified.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CacheStorageContentUpdatedParams {
  /**
   * Origin to update.
   */
  readonly origin: string
  /**
   * Storage key to update.
   */
  readonly storageKey: string
  /**
   * Storage bucket to update.
   */
  readonly bucketId: string
  /**
   * Name of cache in origin.
   */
  readonly cacheName: string
}

/**
 * Schema for `CacheStorageContentUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CacheStorageContentUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    storageKey: Schema.String,
    bucketId: Schema.String,
    cacheName: Schema.String
  }).annotate({ identifier: "Storage.CacheStorageContentUpdatedParams" })
) as any as Schema.Codec<CacheStorageContentUpdatedParams>

/**
 * A cache has been added/deleted.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CacheStorageListUpdatedParams {
  /**
   * Origin to update.
   */
  readonly origin: string
  /**
   * Storage key to update.
   */
  readonly storageKey: string
  /**
   * Storage bucket to update.
   */
  readonly bucketId: string
}

/**
 * Schema for `CacheStorageListUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CacheStorageListUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    storageKey: Schema.String,
    bucketId: Schema.String
  }).annotate({ identifier: "Storage.CacheStorageListUpdatedParams" })
) as any as Schema.Codec<CacheStorageListUpdatedParams>

/**
 * Clears cookies.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearCookiesParams {
  /**
   * Browser context to use when called on the browser endpoint.
   */
  readonly browserContextId?: Browser.BrowserContextID | undefined
}

/**
 * Schema for `ClearCookiesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(Browser.BrowserContextID)
  }).annotate({ identifier: "Storage.ClearCookiesParams" })
) as any as Schema.Codec<ClearCookiesParams>

/**
 * Clears storage for origin.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearDataForOriginParams {
  /**
   * Security origin.
   */
  readonly origin: string
  /**
   * Comma separated list of StorageType to clear.
   */
  readonly storageTypes: string
}

/**
 * Schema for `ClearDataForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearDataForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    storageTypes: Schema.String
  }).annotate({ identifier: "Storage.ClearDataForOriginParams" })
) as any as Schema.Codec<ClearDataForOriginParams>

/**
 * Clears storage for storage key.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearDataForStorageKeyParams {
  /**
   * Storage key.
   */
  readonly storageKey: string
  /**
   * Comma separated list of StorageType to clear.
   */
  readonly storageTypes: string
}

/**
 * Schema for `ClearDataForStorageKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearDataForStorageKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Schema.String,
    storageTypes: Schema.String
  }).annotate({ identifier: "Storage.ClearDataForStorageKeyParams" })
) as any as Schema.Codec<ClearDataForStorageKeyParams>

/**
 * Removes all Trust Tokens issued by the provided issuerOrigin.
 * Leaves other stored data, including the issuer's Redemption Records, intact.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearTrustTokensParams {
  readonly issuerOrigin: string
}

/**
 * Schema for `ClearTrustTokensParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearTrustTokensParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    issuerOrigin: Schema.String
  }).annotate({ identifier: "Storage.ClearTrustTokensParams" })
) as any as Schema.Codec<ClearTrustTokensParams>

/**
 * Removes all Trust Tokens issued by the provided issuerOrigin.
 * Leaves other stored data, including the issuer's Redemption Records, intact.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearTrustTokensResult {
  /**
   * True if any tokens were deleted, false otherwise.
   */
  readonly didDeleteTokens: boolean
}

/**
 * Schema for `ClearTrustTokensResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearTrustTokensResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    didDeleteTokens: Schema.Boolean
  }).annotate({ identifier: "Storage.ClearTrustTokensResult" })
) as any as Schema.Codec<ClearTrustTokensResult>

/**
 * Deletes the Storage Bucket with the given storage key and bucket name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeleteStorageBucketParams {
  readonly bucket: StorageBucket
}

/**
 * Schema for `DeleteStorageBucketParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeleteStorageBucketParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bucket: StorageBucket
  }).annotate({ identifier: "Storage.DeleteStorageBucketParams" })
) as any as Schema.Codec<DeleteStorageBucketParams>

/**
 * Returns all browser cookies.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesParams {
  /**
   * Browser context to use when called on the browser endpoint.
   */
  readonly browserContextId?: Browser.BrowserContextID | undefined
}

/**
 * Schema for `GetCookiesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Schema.optional(Browser.BrowserContextID)
  }).annotate({ identifier: "Storage.GetCookiesParams" })
) as any as Schema.Codec<GetCookiesParams>

/**
 * Returns all browser cookies.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesResult {
  /**
   * Array of cookie objects.
   */
  readonly cookies: ReadonlyArray<Network.Cookie>
}

/**
 * Schema for `GetCookiesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCookiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookies: Schema.Array(Network.Cookie)
  }).annotate({ identifier: "Storage.GetCookiesResult" })
) as any as Schema.Codec<GetCookiesResult, unknown>

/**
 * Returns the effective Related Website Sets in use by this profile for the browser
 * session. The effective Related Website Sets will not change during a browser session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRelatedWebsiteSetsResult {
  readonly sets: ReadonlyArray<RelatedWebsiteSet>
}

/**
 * Schema for `GetRelatedWebsiteSetsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRelatedWebsiteSetsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sets: Schema.Array(RelatedWebsiteSet)
  }).annotate({ identifier: "Storage.GetRelatedWebsiteSetsResult" })
) as any as Schema.Codec<GetRelatedWebsiteSetsResult>

/**
 * Returns storage key for the given frame. If no frame ID is provided,
 * the storage key of the target executing this command is returned.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStorageKeyParams {
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `GetStorageKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStorageKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Storage.GetStorageKeyParams" })
) as any as Schema.Codec<GetStorageKeyParams>

/**
 * Returns storage key for the given frame. If no frame ID is provided,
 * the storage key of the target executing this command is returned.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStorageKeyResult {
  readonly storageKey: SerializedStorageKey
}

/**
 * Schema for `GetStorageKeyResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStorageKeyResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: SerializedStorageKey
  }).annotate({ identifier: "Storage.GetStorageKeyResult" })
) as any as Schema.Codec<GetStorageKeyResult>

/**
 * Returns the number of stored Trust Tokens per issuer for the
 * current browsing context.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetTrustTokensResult {
  readonly tokens: ReadonlyArray<TrustTokens>
}

/**
 * Schema for `GetTrustTokensResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetTrustTokensResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    tokens: Schema.Array(TrustTokens)
  }).annotate({ identifier: "Storage.GetTrustTokensResult" })
) as any as Schema.Codec<GetTrustTokensResult>

/**
 * Returns usage and quota in bytes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetUsageAndQuotaParams {
  /**
   * Security origin.
   */
  readonly origin: string
}

/**
 * Schema for `GetUsageAndQuotaParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetUsageAndQuotaParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Storage.GetUsageAndQuotaParams" })
) as any as Schema.Codec<GetUsageAndQuotaParams>

/**
 * Returns usage and quota in bytes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetUsageAndQuotaResult {
  /**
   * Storage usage (bytes).
   */
  readonly usage: number
  /**
   * Storage quota (bytes).
   */
  readonly quota: number
  /**
   * Whether or not the origin has an active storage quota override
   */
  readonly overrideActive: boolean
  /**
   * Storage usage per type (bytes).
   */
  readonly usageBreakdown: ReadonlyArray<UsageForType>
}

/**
 * Schema for `GetUsageAndQuotaResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetUsageAndQuotaResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    usage: Schema.Number,
    quota: Schema.Number,
    overrideActive: Schema.Boolean,
    usageBreakdown: Schema.Array(UsageForType)
  }).annotate({ identifier: "Storage.GetUsageAndQuotaResult" })
) as any as Schema.Codec<GetUsageAndQuotaResult>

/**
 * The origin's IndexedDB object store has been modified.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface IndexedDBContentUpdatedParams {
  /**
   * Origin to update.
   */
  readonly origin: string
  /**
   * Storage key to update.
   */
  readonly storageKey: string
  /**
   * Storage bucket to update.
   */
  readonly bucketId: string
  /**
   * Database to update.
   */
  readonly databaseName: string
  /**
   * ObjectStore to update.
   */
  readonly objectStoreName: string
}

/**
 * Schema for `IndexedDBContentUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IndexedDBContentUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    storageKey: Schema.String,
    bucketId: Schema.String,
    databaseName: Schema.String,
    objectStoreName: Schema.String
  }).annotate({ identifier: "Storage.IndexedDBContentUpdatedParams" })
) as any as Schema.Codec<IndexedDBContentUpdatedParams>

/**
 * The origin's IndexedDB database list has been modified.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface IndexedDBListUpdatedParams {
  /**
   * Origin to update.
   */
  readonly origin: string
  /**
   * Storage key to update.
   */
  readonly storageKey: string
  /**
   * Storage bucket to update.
   */
  readonly bucketId: string
}

/**
 * Schema for `IndexedDBListUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IndexedDBListUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    storageKey: Schema.String,
    bucketId: Schema.String
  }).annotate({ identifier: "Storage.IndexedDBListUpdatedParams" })
) as any as Schema.Codec<IndexedDBListUpdatedParams>

/**
 * Override quota for the specified origin
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OverrideQuotaForOriginParams {
  /**
   * Security origin.
   */
  readonly origin: string
  /**
   * The quota size (in bytes) to override the original quota with.
   * If this is called multiple times, the overridden quota will be equal to
   * the quotaSize provided in the final call. If this is called without
   * specifying a quotaSize, the quota will be reset to the default value for
   * the specified origin. If this is called multiple times with different
   * origins, the override will be maintained for each origin until it is
   * disabled (called without a quotaSize).
   */
  readonly quotaSize?: number | undefined
}

/**
 * Schema for `OverrideQuotaForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OverrideQuotaForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    quotaSize: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Storage.OverrideQuotaForOriginParams" })
) as any as Schema.Codec<OverrideQuotaForOriginParams>

/**
 * Deletes state for sites identified as potential bounce trackers, immediately.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RunBounceTrackingMitigationsResult {
  readonly deletedSites: ReadonlyArray<string>
}

/**
 * Schema for `RunBounceTrackingMitigationsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RunBounceTrackingMitigationsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    deletedSites: Schema.Array(Schema.String)
  }).annotate({ identifier: "Storage.RunBounceTrackingMitigationsResult" })
) as any as Schema.Codec<RunBounceTrackingMitigationsResult>

/**
 * Sets given cookies.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetCookiesParams {
  /**
   * Cookies to be set.
   */
  readonly cookies: ReadonlyArray<Network.CookieParam>
  /**
   * Browser context to use when called on the browser endpoint.
   */
  readonly browserContextId?: Browser.BrowserContextID | undefined
}

/**
 * Schema for `SetCookiesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookies: Schema.Array(Network.CookieParam),
    browserContextId: Schema.optional(Browser.BrowserContextID)
  }).annotate({ identifier: "Storage.SetCookiesParams" })
) as any as Schema.Codec<SetCookiesParams, unknown>

/**
 * Set tracking for a storage key's buckets.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetStorageBucketTrackingParams {
  readonly storageKey: string
  readonly enable: boolean
}

/**
 * Schema for `SetStorageBucketTrackingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetStorageBucketTrackingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Schema.String,
    enable: Schema.Boolean
  }).annotate({ identifier: "Storage.SetStorageBucketTrackingParams" })
) as any as Schema.Codec<SetStorageBucketTrackingParams>

/**
 * `storageBucketCreatedOrUpdated.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StorageBucketCreatedOrUpdatedParams {
  readonly bucketInfo: StorageBucketInfo
}

/**
 * Schema for `StorageBucketCreatedOrUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageBucketCreatedOrUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bucketInfo: StorageBucketInfo
  }).annotate({ identifier: "Storage.StorageBucketCreatedOrUpdatedParams" })
) as any as Schema.Codec<StorageBucketCreatedOrUpdatedParams>

/**
 * `storageBucketDeleted.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StorageBucketDeletedParams {
  readonly bucketId: string
}

/**
 * Schema for `StorageBucketDeletedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageBucketDeletedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bucketId: Schema.String
  }).annotate({ identifier: "Storage.StorageBucketDeletedParams" })
) as any as Schema.Codec<StorageBucketDeletedParams>

/**
 * Registers origin to be notified when an update occurs to its cache storage list.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrackCacheStorageForOriginParams {
  /**
   * Security origin.
   */
  readonly origin: string
}

/**
 * Schema for `TrackCacheStorageForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrackCacheStorageForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Storage.TrackCacheStorageForOriginParams" })
) as any as Schema.Codec<TrackCacheStorageForOriginParams>

/**
 * Registers storage key to be notified when an update occurs to its cache storage list.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrackCacheStorageForStorageKeyParams {
  /**
   * Storage key.
   */
  readonly storageKey: string
}

/**
 * Schema for `TrackCacheStorageForStorageKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrackCacheStorageForStorageKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Schema.String
  }).annotate({ identifier: "Storage.TrackCacheStorageForStorageKeyParams" })
) as any as Schema.Codec<TrackCacheStorageForStorageKeyParams>

/**
 * Registers origin to be notified when an update occurs to its IndexedDB.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrackIndexedDBForOriginParams {
  /**
   * Security origin.
   */
  readonly origin: string
}

/**
 * Schema for `TrackIndexedDBForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrackIndexedDBForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Storage.TrackIndexedDBForOriginParams" })
) as any as Schema.Codec<TrackIndexedDBForOriginParams>

/**
 * Registers storage key to be notified when an update occurs to its IndexedDB.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrackIndexedDBForStorageKeyParams {
  /**
   * Storage key.
   */
  readonly storageKey: string
}

/**
 * Schema for `TrackIndexedDBForStorageKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrackIndexedDBForStorageKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Schema.String
  }).annotate({ identifier: "Storage.TrackIndexedDBForStorageKeyParams" })
) as any as Schema.Codec<TrackIndexedDBForStorageKeyParams>

/**
 * Unregisters origin from receiving notifications for cache storage.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UntrackCacheStorageForOriginParams {
  /**
   * Security origin.
   */
  readonly origin: string
}

/**
 * Schema for `UntrackCacheStorageForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UntrackCacheStorageForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Storage.UntrackCacheStorageForOriginParams" })
) as any as Schema.Codec<UntrackCacheStorageForOriginParams>

/**
 * Unregisters storage key from receiving notifications for cache storage.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UntrackCacheStorageForStorageKeyParams {
  /**
   * Storage key.
   */
  readonly storageKey: string
}

/**
 * Schema for `UntrackCacheStorageForStorageKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UntrackCacheStorageForStorageKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Schema.String
  }).annotate({ identifier: "Storage.UntrackCacheStorageForStorageKeyParams" })
) as any as Schema.Codec<UntrackCacheStorageForStorageKeyParams>

/**
 * Unregisters origin from receiving notifications for IndexedDB.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UntrackIndexedDBForOriginParams {
  /**
   * Security origin.
   */
  readonly origin: string
}

/**
 * Schema for `UntrackIndexedDBForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UntrackIndexedDBForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Storage.UntrackIndexedDBForOriginParams" })
) as any as Schema.Codec<UntrackIndexedDBForOriginParams>

/**
 * Unregisters storage key from receiving notifications for IndexedDB.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UntrackIndexedDBForStorageKeyParams {
  /**
   * Storage key.
   */
  readonly storageKey: string
}

/**
 * Schema for `UntrackIndexedDBForStorageKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UntrackIndexedDBForStorageKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Schema.String
  }).annotate({ identifier: "Storage.UntrackIndexedDBForStorageKeyParams" })
) as any as Schema.Codec<UntrackIndexedDBForStorageKeyParams>

/**
 * Clears cookies.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearCookies: Protocol.CommandDef<"Storage.clearCookies", ClearCookiesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Storage.clearCookies",
    ClearCookiesParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Clears storage for origin.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearDataForOrigin: Protocol.CommandDef<"Storage.clearDataForOrigin", ClearDataForOriginParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Storage.clearDataForOrigin",
    ClearDataForOriginParams,
    undefined,
    { status: "stable" }
  )

/**
 * Clears storage for storage key.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearDataForStorageKey: Protocol.CommandDef<
  "Storage.clearDataForStorageKey",
  ClearDataForStorageKeyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.clearDataForStorageKey",
  ClearDataForStorageKeyParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes all Trust Tokens issued by the provided issuerOrigin.
 * Leaves other stored data, including the issuer's Redemption Records, intact.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearTrustTokens: Protocol.CommandDef<
  "Storage.clearTrustTokens",
  ClearTrustTokensParams,
  ClearTrustTokensResult
> = /*#__PURE__*/ Protocol.command(
  "Storage.clearTrustTokens",
  ClearTrustTokensParams,
  ClearTrustTokensResult,
  { status: "experimental" }
)

/**
 * Deletes the Storage Bucket with the given storage key and bucket name.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const deleteStorageBucket: Protocol.CommandDef<"Storage.deleteStorageBucket", DeleteStorageBucketParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Storage.deleteStorageBucket",
    DeleteStorageBucketParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Returns all browser cookies.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getCookies: Protocol.CommandDef<"Storage.getCookies", GetCookiesParams, GetCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Storage.getCookies",
    GetCookiesParams,
    GetCookiesResult,
    { status: "stable", session: "browser" }
  )

/**
 * Returns the effective Related Website Sets in use by this profile for the browser
 * session. The effective Related Website Sets will not change during a browser session.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getRelatedWebsiteSets: Protocol.CommandDef<
  "Storage.getRelatedWebsiteSets",
  void,
  GetRelatedWebsiteSetsResult
> = /*#__PURE__*/ Protocol.command(
  "Storage.getRelatedWebsiteSets",
  undefined,
  GetRelatedWebsiteSetsResult,
  { status: "experimental" }
)

/**
 * Returns storage key for the given frame. If no frame ID is provided,
 * the storage key of the target executing this command is returned.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getStorageKey: Protocol.CommandDef<"Storage.getStorageKey", GetStorageKeyParams, GetStorageKeyResult> =
  /*#__PURE__*/ Protocol.command(
    "Storage.getStorageKey",
    GetStorageKeyParams,
    GetStorageKeyResult,
    { status: "experimental" }
  )

/**
 * Returns the number of stored Trust Tokens per issuer for the
 * current browsing context.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getTrustTokens: Protocol.CommandDef<"Storage.getTrustTokens", void, GetTrustTokensResult> =
  /*#__PURE__*/ Protocol.command(
    "Storage.getTrustTokens",
    undefined,
    GetTrustTokensResult,
    { status: "experimental" }
  )

/**
 * Returns usage and quota in bytes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getUsageAndQuota: Protocol.CommandDef<
  "Storage.getUsageAndQuota",
  GetUsageAndQuotaParams,
  GetUsageAndQuotaResult
> = /*#__PURE__*/ Protocol.command(
  "Storage.getUsageAndQuota",
  GetUsageAndQuotaParams,
  GetUsageAndQuotaResult,
  { status: "stable" }
)

/**
 * Override quota for the specified origin
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const overrideQuotaForOrigin: Protocol.CommandDef<
  "Storage.overrideQuotaForOrigin",
  OverrideQuotaForOriginParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.overrideQuotaForOrigin",
  OverrideQuotaForOriginParams,
  undefined,
  { status: "experimental" }
)

/**
 * Deletes state for sites identified as potential bounce trackers, immediately.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const runBounceTrackingMitigations: Protocol.CommandDef<
  "Storage.runBounceTrackingMitigations",
  void,
  RunBounceTrackingMitigationsResult
> = /*#__PURE__*/ Protocol.command(
  "Storage.runBounceTrackingMitigations",
  undefined,
  RunBounceTrackingMitigationsResult,
  { status: "experimental" }
)

/**
 * Sets given cookies.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setCookies: Protocol.CommandDef<"Storage.setCookies", SetCookiesParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Storage.setCookies",
    SetCookiesParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Set tracking for a storage key's buckets.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setStorageBucketTracking: Protocol.CommandDef<
  "Storage.setStorageBucketTracking",
  SetStorageBucketTrackingParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.setStorageBucketTracking",
  SetStorageBucketTrackingParams,
  undefined,
  { status: "experimental" }
)

/**
 * Registers origin to be notified when an update occurs to its cache storage list.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trackCacheStorageForOrigin: Protocol.CommandDef<
  "Storage.trackCacheStorageForOrigin",
  TrackCacheStorageForOriginParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.trackCacheStorageForOrigin",
  TrackCacheStorageForOriginParams,
  undefined,
  { status: "stable" }
)

/**
 * Registers storage key to be notified when an update occurs to its cache storage list.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trackCacheStorageForStorageKey: Protocol.CommandDef<
  "Storage.trackCacheStorageForStorageKey",
  TrackCacheStorageForStorageKeyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.trackCacheStorageForStorageKey",
  TrackCacheStorageForStorageKeyParams,
  undefined,
  { status: "stable" }
)

/**
 * Registers origin to be notified when an update occurs to its IndexedDB.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trackIndexedDBForOrigin: Protocol.CommandDef<
  "Storage.trackIndexedDBForOrigin",
  TrackIndexedDBForOriginParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.trackIndexedDBForOrigin",
  TrackIndexedDBForOriginParams,
  undefined,
  { status: "stable" }
)

/**
 * Registers storage key to be notified when an update occurs to its IndexedDB.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trackIndexedDBForStorageKey: Protocol.CommandDef<
  "Storage.trackIndexedDBForStorageKey",
  TrackIndexedDBForStorageKeyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.trackIndexedDBForStorageKey",
  TrackIndexedDBForStorageKeyParams,
  undefined,
  { status: "stable" }
)

/**
 * Unregisters origin from receiving notifications for cache storage.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const untrackCacheStorageForOrigin: Protocol.CommandDef<
  "Storage.untrackCacheStorageForOrigin",
  UntrackCacheStorageForOriginParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.untrackCacheStorageForOrigin",
  UntrackCacheStorageForOriginParams,
  undefined,
  { status: "stable" }
)

/**
 * Unregisters storage key from receiving notifications for cache storage.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const untrackCacheStorageForStorageKey: Protocol.CommandDef<
  "Storage.untrackCacheStorageForStorageKey",
  UntrackCacheStorageForStorageKeyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.untrackCacheStorageForStorageKey",
  UntrackCacheStorageForStorageKeyParams,
  undefined,
  { status: "stable" }
)

/**
 * Unregisters origin from receiving notifications for IndexedDB.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const untrackIndexedDBForOrigin: Protocol.CommandDef<
  "Storage.untrackIndexedDBForOrigin",
  UntrackIndexedDBForOriginParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.untrackIndexedDBForOrigin",
  UntrackIndexedDBForOriginParams,
  undefined,
  { status: "stable" }
)

/**
 * Unregisters storage key from receiving notifications for IndexedDB.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const untrackIndexedDBForStorageKey: Protocol.CommandDef<
  "Storage.untrackIndexedDBForStorageKey",
  UntrackIndexedDBForStorageKeyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Storage.untrackIndexedDBForStorageKey",
  UntrackIndexedDBForStorageKeyParams,
  undefined,
  { status: "stable" }
)

/**
 * A cache's contents have been modified.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const cacheStorageContentUpdated: Protocol.EventDef<
  "Storage.cacheStorageContentUpdated",
  CacheStorageContentUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Storage.cacheStorageContentUpdated",
  CacheStorageContentUpdatedParams,
  { status: "stable" }
)

/**
 * A cache has been added/deleted.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const cacheStorageListUpdated: Protocol.EventDef<
  "Storage.cacheStorageListUpdated",
  CacheStorageListUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Storage.cacheStorageListUpdated",
  CacheStorageListUpdatedParams,
  { status: "stable" }
)

/**
 * The origin's IndexedDB object store has been modified.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const indexedDBContentUpdated: Protocol.EventDef<
  "Storage.indexedDBContentUpdated",
  IndexedDBContentUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Storage.indexedDBContentUpdated",
  IndexedDBContentUpdatedParams,
  { status: "stable" }
)

/**
 * The origin's IndexedDB database list has been modified.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const indexedDBListUpdated: Protocol.EventDef<"Storage.indexedDBListUpdated", IndexedDBListUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Storage.indexedDBListUpdated",
    IndexedDBListUpdatedParams,
    { status: "stable" }
  )

/**
 * The `Storage.storageBucketCreatedOrUpdated` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const storageBucketCreatedOrUpdated: Protocol.EventDef<
  "Storage.storageBucketCreatedOrUpdated",
  StorageBucketCreatedOrUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Storage.storageBucketCreatedOrUpdated",
  StorageBucketCreatedOrUpdatedParams,
  { status: "stable" }
)

/**
 * The `Storage.storageBucketDeleted` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const storageBucketDeleted: Protocol.EventDef<"Storage.storageBucketDeleted", StorageBucketDeletedParams> =
  /*#__PURE__*/ Protocol.event(
    "Storage.storageBucketDeleted",
    StorageBucketDeletedParams,
    { status: "stable" }
  )
