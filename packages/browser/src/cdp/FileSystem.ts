/**
 * The FileSystem domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"
import * as Storage from "./Storage.ts"

/**
 * `BucketFileSystemLocator`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BucketFileSystemLocator {
  /**
   * Storage key
   */
  readonly storageKey: Storage.SerializedStorageKey
  /**
   * Bucket name. Not passing a `bucketName` will retrieve the default Bucket. (https://developer.mozilla.org/en-US/docs/Web/API/Storage_API#storage_buckets)
   */
  readonly bucketName?: string | undefined
  /**
   * Path to the directory using each path component as an array item.
   */
  readonly pathComponents: ReadonlyArray<string>
}

/**
 * Schema for `BucketFileSystemLocator`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BucketFileSystemLocator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageKey: Storage.SerializedStorageKey,
    bucketName: Schema.optional(Schema.String),
    pathComponents: Schema.Array(Schema.String)
  }).annotate({ identifier: "FileSystem.BucketFileSystemLocator" })
) as any as Schema.Codec<BucketFileSystemLocator>

/**
 * `Directory`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Directory {
  readonly name: string
  readonly nestedDirectories: ReadonlyArray<string>
  /**
   * Files that are directly nested under this directory.
   */
  readonly nestedFiles: ReadonlyArray<File>
}

/**
 * Schema for `Directory`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Directory = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    nestedDirectories: Schema.Array(Schema.String),
    nestedFiles: Schema.Array(File)
  }).annotate({ identifier: "FileSystem.Directory" })
) as any as Schema.Codec<Directory>

/**
 * `File`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface File {
  readonly name: string
  /**
   * Timestamp
   */
  readonly lastModified: Network.TimeSinceEpoch
  /**
   * Size in bytes
   */
  readonly size: number
  readonly type: string
}

/**
 * Schema for `File`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const File = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    lastModified: Network.TimeSinceEpoch,
    size: Schema.Number,
    type: Schema.String
  }).annotate({ identifier: "FileSystem.File" })
) as any as Schema.Codec<File>

/**
 * `getDirectory.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDirectoryParams {
  readonly bucketFileSystemLocator: BucketFileSystemLocator
}

/**
 * Schema for `GetDirectoryParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDirectoryParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bucketFileSystemLocator: BucketFileSystemLocator
  }).annotate({ identifier: "FileSystem.GetDirectoryParams" })
) as any as Schema.Codec<GetDirectoryParams>

/**
 * `getDirectory.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDirectoryResult {
  /**
   * Returns the directory object at the path.
   */
  readonly directory: Directory
}

/**
 * Schema for `GetDirectoryResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDirectoryResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    directory: Directory
  }).annotate({ identifier: "FileSystem.GetDirectoryResult" })
) as any as Schema.Codec<GetDirectoryResult>

/**
 * Sends `FileSystem.getDirectory`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getDirectory: Protocol.CommandDef<"FileSystem.getDirectory", GetDirectoryParams, GetDirectoryResult> =
  /*#__PURE__*/ Protocol.command(
    "FileSystem.getDirectory",
    GetDirectoryParams,
    GetDirectoryResult,
    { status: "stable" }
  )
