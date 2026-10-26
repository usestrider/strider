/**
 * The IndexedDB domain.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Data entry.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DataEntry {
  /**
   * Key.
   */
  readonly key: Runtime.RemoteObject
  /**
   * Primary key.
   */
  readonly primaryKey: Runtime.RemoteObject
  /**
   * Value.
   */
  readonly value: Runtime.RemoteObject
}

/**
 * Schema for `DataEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DataEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: Runtime.RemoteObject,
    primaryKey: Runtime.RemoteObject,
    value: Runtime.RemoteObject
  }).annotate({ identifier: "IndexedDB.DataEntry" })
) as any as Schema.Codec<DataEntry>

/**
 * Database with an array of object stores.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DatabaseWithObjectStores {
  /**
   * Database name.
   */
  readonly name: string
  /**
   * Database version.
   */
  readonly version: number
  /**
   * Object stores in this database.
   */
  readonly objectStores: ReadonlyArray<ObjectStore>
}

/**
 * Schema for `DatabaseWithObjectStores`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DatabaseWithObjectStores = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    version: Schema.Number,
    objectStores: Schema.Array(ObjectStore)
  }).annotate({ identifier: "IndexedDB.DatabaseWithObjectStores" })
) as any as Schema.Codec<DatabaseWithObjectStores>

/**
 * Key.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Key {
  /**
   * Key type.
   */
  readonly type: KeyType
  /**
   * Number value.
   */
  readonly number?: number | undefined
  /**
   * String value.
   */
  readonly string?: string | undefined
  /**
   * Date value.
   */
  readonly date?: number | undefined
  /**
   * Array value.
   */
  readonly array?: ReadonlyArray<Key> | undefined
}

/**
 * Schema for `Key`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Key = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: KeyType,
    number: Schema.optional(Schema.Number),
    string: Schema.optional(Schema.String),
    date: Schema.optional(Schema.Number),
    array: Schema.optional(Schema.Array(Key))
  }).annotate({ identifier: "IndexedDB.Key" })
) as any as Schema.Codec<Key>

/**
 * Key type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type KeyType =
  | "number"
  | "string"
  | "date"
  | "array"
  | (string & {})

/**
 * Schema for `KeyType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyType = Schema.String as any as Schema.Codec<KeyType>

/**
 * Key path.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface KeyPath {
  /**
   * Key path type.
   */
  readonly type: KeyPathType
  /**
   * String value.
   */
  readonly string?: string | undefined
  /**
   * Array value.
   */
  readonly array?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `KeyPath`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyPath = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: KeyPathType,
    string: Schema.optional(Schema.String),
    array: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "IndexedDB.KeyPath" })
) as any as Schema.Codec<KeyPath>

/**
 * Key path type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type KeyPathType =
  | "null"
  | "string"
  | "array"
  | (string & {})

/**
 * Schema for `KeyPathType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyPathType = Schema.String as any as Schema.Codec<KeyPathType>

/**
 * Key range.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface KeyRange {
  /**
   * Lower bound.
   */
  readonly lower?: Key | undefined
  /**
   * Upper bound.
   */
  readonly upper?: Key | undefined
  /**
   * If true lower bound is open.
   */
  readonly lowerOpen: boolean
  /**
   * If true upper bound is open.
   */
  readonly upperOpen: boolean
}

/**
 * Schema for `KeyRange`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyRange = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lower: Schema.optional(Key),
    upper: Schema.optional(Key),
    lowerOpen: Schema.Boolean,
    upperOpen: Schema.Boolean
  }).annotate({ identifier: "IndexedDB.KeyRange" })
) as any as Schema.Codec<KeyRange>

/**
 * Object store.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObjectStore {
  /**
   * Object store name.
   */
  readonly name: string
  /**
   * Object store key path.
   */
  readonly keyPath: KeyPath
  /**
   * If true, object store has auto increment flag set.
   */
  readonly autoIncrement: boolean
  /**
   * Indexes in this object store.
   */
  readonly indexes: ReadonlyArray<ObjectStoreIndex>
}

/**
 * Schema for `ObjectStore`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectStore = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    keyPath: KeyPath,
    autoIncrement: Schema.Boolean,
    indexes: Schema.Array(ObjectStoreIndex)
  }).annotate({ identifier: "IndexedDB.ObjectStore" })
) as any as Schema.Codec<ObjectStore>

/**
 * Object store index.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObjectStoreIndex {
  /**
   * Index name.
   */
  readonly name: string
  /**
   * Index key path.
   */
  readonly keyPath: KeyPath
  /**
   * If true, index is unique.
   */
  readonly unique: boolean
  /**
   * If true, index allows multiple entries for a key.
   */
  readonly multiEntry: boolean
}

/**
 * Schema for `ObjectStoreIndex`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectStoreIndex = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    keyPath: KeyPath,
    unique: Schema.Boolean,
    multiEntry: Schema.Boolean
  }).annotate({ identifier: "IndexedDB.ObjectStoreIndex" })
) as any as Schema.Codec<ObjectStoreIndex>

/**
 * Clears all entries from an object store.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClearObjectStoreParams {
  /**
   * Security origin.
   */
  readonly securityOrigin: string
  /**
   * Database name.
   */
  readonly databaseName: string
  /**
   * Object store name.
   */
  readonly objectStoreName: string
}

/**
 * Schema for `ClearObjectStoreParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClearObjectStoreParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.String,
    databaseName: Schema.String,
    objectStoreName: Schema.String
  }).annotate({ identifier: "IndexedDB.ClearObjectStoreParams" })
) as any as Schema.Codec<ClearObjectStoreParams>

/**
 * Requests data from object store or index.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestDataParams {
  /**
   * Security origin.
   */
  readonly securityOrigin: string
  /**
   * Database name.
   */
  readonly databaseName: string
  /**
   * Object store name.
   */
  readonly objectStoreName: string
  /**
   * Index name, empty string for object store data requests.
   */
  readonly indexName: string
  /**
   * Number of records to skip.
   */
  readonly skipCount: number
  /**
   * Number of records to fetch.
   */
  readonly pageSize: number
  /**
   * Key range.
   */
  readonly keyRange?: KeyRange | undefined
}

/**
 * Schema for `RequestDataParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestDataParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.String,
    databaseName: Schema.String,
    objectStoreName: Schema.String,
    indexName: Schema.String,
    skipCount: Schema.Int,
    pageSize: Schema.Int,
    keyRange: Schema.optional(KeyRange)
  }).annotate({ identifier: "IndexedDB.RequestDataParams" })
) as any as Schema.Codec<RequestDataParams>

/**
 * Requests data from object store or index.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestDataResult {
  /**
   * Array of object store data entries.
   */
  readonly objectStoreDataEntries: ReadonlyArray<DataEntry>
  /**
   * If true, there are more entries to fetch in the given range.
   */
  readonly hasMore: boolean
}

/**
 * Schema for `RequestDataResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestDataResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectStoreDataEntries: Schema.Array(DataEntry),
    hasMore: Schema.Boolean
  }).annotate({ identifier: "IndexedDB.RequestDataResult" })
) as any as Schema.Codec<RequestDataResult>

/**
 * Requests database with given name in given frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestDatabaseParams {
  /**
   * Security origin.
   */
  readonly securityOrigin: string
  /**
   * Database name.
   */
  readonly databaseName: string
}

/**
 * Schema for `RequestDatabaseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestDatabaseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.String,
    databaseName: Schema.String
  }).annotate({ identifier: "IndexedDB.RequestDatabaseParams" })
) as any as Schema.Codec<RequestDatabaseParams>

/**
 * Requests database with given name in given frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestDatabaseResult {
  /**
   * Database with an array of object stores.
   */
  readonly databaseWithObjectStores: DatabaseWithObjectStores
}

/**
 * Schema for `RequestDatabaseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestDatabaseResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    databaseWithObjectStores: DatabaseWithObjectStores
  }).annotate({ identifier: "IndexedDB.RequestDatabaseResult" })
) as any as Schema.Codec<RequestDatabaseResult>

/**
 * Requests database names for given security origin.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestDatabaseNamesParams {
  /**
   * Security origin.
   */
  readonly securityOrigin: string
}

/**
 * Schema for `RequestDatabaseNamesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestDatabaseNamesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.String
  }).annotate({ identifier: "IndexedDB.RequestDatabaseNamesParams" })
) as any as Schema.Codec<RequestDatabaseNamesParams>

/**
 * Requests database names for given security origin.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestDatabaseNamesResult {
  /**
   * Database names for origin.
   */
  readonly databaseNames: ReadonlyArray<string>
}

/**
 * Schema for `RequestDatabaseNamesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestDatabaseNamesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    databaseNames: Schema.Array(Schema.String)
  }).annotate({ identifier: "IndexedDB.RequestDatabaseNamesResult" })
) as any as Schema.Codec<RequestDatabaseNamesResult>

/**
 * Clears all entries from an object store.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearObjectStore: Protocol.CommandDef<"IndexedDB.clearObjectStore", ClearObjectStoreParams, void> =
  /*#__PURE__*/ Protocol.command(
    "IndexedDB.clearObjectStore",
    ClearObjectStoreParams,
    undefined,
    { status: "stable" }
  )

/**
 * Disables events from backend.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"IndexedDB.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "IndexedDB.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables events from backend.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"IndexedDB.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "IndexedDB.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Requests data from object store or index.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestData: Protocol.CommandDef<"IndexedDB.requestData", RequestDataParams, RequestDataResult> =
  /*#__PURE__*/ Protocol.command(
    "IndexedDB.requestData",
    RequestDataParams,
    RequestDataResult,
    { status: "stable" }
  )

/**
 * Requests database with given name in given frame.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestDatabase: Protocol.CommandDef<
  "IndexedDB.requestDatabase",
  RequestDatabaseParams,
  RequestDatabaseResult
> = /*#__PURE__*/ Protocol.command(
  "IndexedDB.requestDatabase",
  RequestDatabaseParams,
  RequestDatabaseResult,
  { status: "stable" }
)

/**
 * Requests database names for given security origin.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestDatabaseNames: Protocol.CommandDef<
  "IndexedDB.requestDatabaseNames",
  RequestDatabaseNamesParams,
  RequestDatabaseNamesResult
> = /*#__PURE__*/ Protocol.command(
  "IndexedDB.requestDatabaseNames",
  RequestDatabaseNamesParams,
  RequestDatabaseNamesResult,
  { status: "stable" }
)
