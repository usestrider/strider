/**
 * Defines commands and events for browser extensions.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Detailed information about an extension.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ExtensionInfo {
  /**
   * Extension id.
   */
  readonly id: string
  /**
   * Extension name.
   */
  readonly name: string
  /**
   * Extension version.
   */
  readonly version: string
  /**
   * The path from which the extension was loaded.
   */
  readonly path: string
  /**
   * Extension enabled status.
   */
  readonly enabled: boolean
}

/**
 * Schema for `ExtensionInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    version: Schema.String,
    path: Schema.String,
    enabled: Schema.Boolean
  }).annotate({ identifier: "Extensions.ExtensionInfo" })
) as any as Schema.Codec<ExtensionInfo>

/**
 * Storage areas.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StorageArea =
  | "session"
  | "local"
  | "sync"
  | "managed"
  | (string & {})

/**
 * Schema for `StorageArea`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageArea = Schema.String as any as Schema.Codec<StorageArea>

/**
 * Clears extension storage in the given `storageArea`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearStorageItemsParams {
  /**
   * ID of extension.
   */
  readonly id: string
  /**
   * StorageArea to remove data from.
   */
  readonly storageArea: StorageArea
}

/**
 * Schema for `ClearStorageItemsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearStorageItemsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    storageArea: StorageArea
  }).annotate({ identifier: "Extensions.ClearStorageItemsParams" })
) as any as Schema.Codec<ClearStorageItemsParams>

/**
 * Gets a list of all unpacked extensions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetExtensionsResult {
  readonly extensions: ReadonlyArray<ExtensionInfo>
}

/**
 * Schema for `GetExtensionsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetExtensionsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extensions: Schema.Array(ExtensionInfo)
  }).annotate({ identifier: "Extensions.GetExtensionsResult" })
) as any as Schema.Codec<GetExtensionsResult>

/**
 * Gets data from extension storage in the given `storageArea`. If `keys` is
 * specified, these are used to filter the result.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStorageItemsParams {
  /**
   * ID of extension.
   */
  readonly id: string
  /**
   * StorageArea to retrieve data from.
   */
  readonly storageArea: StorageArea
  /**
   * Keys to retrieve.
   */
  readonly keys?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `GetStorageItemsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStorageItemsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    storageArea: StorageArea,
    keys: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Extensions.GetStorageItemsParams" })
) as any as Schema.Codec<GetStorageItemsParams>

/**
 * Gets data from extension storage in the given `storageArea`. If `keys` is
 * specified, these are used to filter the result.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStorageItemsResult {
  readonly data: { readonly [key: string]: unknown }
}

/**
 * Schema for `GetStorageItemsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStorageItemsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Extensions.GetStorageItemsResult" })
) as any as Schema.Codec<GetStorageItemsResult>

/**
 * Installs an unpacked extension from the filesystem similar to
 * --load-extension CLI flags. Returns extension ID once the extension
 * has been installed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadUnpackedParams {
  /**
   * Absolute file path.
   */
  readonly path: string
  /**
   * Enable the extension in incognito
   */
  readonly enableInIncognito?: boolean | undefined
}

/**
 * Schema for `LoadUnpackedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadUnpackedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    path: Schema.String,
    enableInIncognito: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Extensions.LoadUnpackedParams" })
) as any as Schema.Codec<LoadUnpackedParams>

/**
 * Installs an unpacked extension from the filesystem similar to
 * --load-extension CLI flags. Returns extension ID once the extension
 * has been installed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadUnpackedResult {
  /**
   * Extension id.
   */
  readonly id: string
}

/**
 * Schema for `LoadUnpackedResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadUnpackedResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String
  }).annotate({ identifier: "Extensions.LoadUnpackedResult" })
) as any as Schema.Codec<LoadUnpackedResult>

/**
 * Removes `keys` from extension storage in the given `storageArea`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveStorageItemsParams {
  /**
   * ID of extension.
   */
  readonly id: string
  /**
   * StorageArea to remove data from.
   */
  readonly storageArea: StorageArea
  /**
   * Keys to remove.
   */
  readonly keys: ReadonlyArray<string>
}

/**
 * Schema for `RemoveStorageItemsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveStorageItemsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    storageArea: StorageArea,
    keys: Schema.Array(Schema.String)
  }).annotate({ identifier: "Extensions.RemoveStorageItemsParams" })
) as any as Schema.Codec<RemoveStorageItemsParams>

/**
 * Sets `values` in extension storage in the given `storageArea`. The provided `values`
 * will be merged with existing values in the storage area.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetStorageItemsParams {
  /**
   * ID of extension.
   */
  readonly id: string
  /**
   * StorageArea to set data in.
   */
  readonly storageArea: StorageArea
  /**
   * Values to set.
   */
  readonly values: { readonly [key: string]: unknown }
}

/**
 * Schema for `SetStorageItemsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetStorageItemsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    storageArea: StorageArea,
    values: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Extensions.SetStorageItemsParams" })
) as any as Schema.Codec<SetStorageItemsParams>

/**
 * Runs an extension default action.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TriggerActionParams {
  /**
   * Extension id.
   */
  readonly id: string
  /**
   * A tab target ID to trigger the default extension action on.
   */
  readonly targetId: string
}

/**
 * Schema for `TriggerActionParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TriggerActionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    targetId: Schema.String
  }).annotate({ identifier: "Extensions.TriggerActionParams" })
) as any as Schema.Codec<TriggerActionParams>

/**
 * Uninstalls an unpacked extension (others not supported) from the profile.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UninstallParams {
  /**
   * Extension id.
   */
  readonly id: string
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
    id: Schema.String
  }).annotate({ identifier: "Extensions.UninstallParams" })
) as any as Schema.Codec<UninstallParams>

/**
 * Clears extension storage in the given `storageArea`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearStorageItems: Protocol.CommandDef<"Extensions.clearStorageItems", ClearStorageItemsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Extensions.clearStorageItems",
    ClearStorageItemsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Gets a list of all unpacked extensions.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getExtensions: Protocol.CommandDef<"Extensions.getExtensions", void, GetExtensionsResult> =
  /*#__PURE__*/ Protocol.command(
    "Extensions.getExtensions",
    undefined,
    GetExtensionsResult,
    { status: "stable" }
  )

/**
 * Gets data from extension storage in the given `storageArea`. If `keys` is
 * specified, these are used to filter the result.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getStorageItems: Protocol.CommandDef<
  "Extensions.getStorageItems",
  GetStorageItemsParams,
  GetStorageItemsResult
> = /*#__PURE__*/ Protocol.command(
  "Extensions.getStorageItems",
  GetStorageItemsParams,
  GetStorageItemsResult,
  { status: "stable" }
)

/**
 * Installs an unpacked extension from the filesystem similar to
 * --load-extension CLI flags. Returns extension ID once the extension
 * has been installed.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const loadUnpacked: Protocol.CommandDef<"Extensions.loadUnpacked", LoadUnpackedParams, LoadUnpackedResult> =
  /*#__PURE__*/ Protocol.command(
    "Extensions.loadUnpacked",
    LoadUnpackedParams,
    LoadUnpackedResult,
    { status: "stable" }
  )

/**
 * Removes `keys` from extension storage in the given `storageArea`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeStorageItems: Protocol.CommandDef<"Extensions.removeStorageItems", RemoveStorageItemsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Extensions.removeStorageItems",
    RemoveStorageItemsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets `values` in extension storage in the given `storageArea`. The provided `values`
 * will be merged with existing values in the storage area.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setStorageItems: Protocol.CommandDef<"Extensions.setStorageItems", SetStorageItemsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Extensions.setStorageItems",
    SetStorageItemsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Runs an extension default action.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const triggerAction: Protocol.CommandDef<"Extensions.triggerAction", TriggerActionParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Extensions.triggerAction",
    TriggerActionParams,
    undefined,
    { status: "stable" }
  )

/**
 * Uninstalls an unpacked extension (others not supported) from the profile.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const uninstall: Protocol.CommandDef<"Extensions.uninstall", UninstallParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Extensions.uninstall",
    UninstallParams,
    undefined,
    { status: "stable" }
  )
