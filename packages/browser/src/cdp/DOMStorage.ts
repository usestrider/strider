/**
 * Query and modify DOM storage.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * DOM Storage item.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Item = ReadonlyArray<string>

/**
 * Schema for `Item`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Item = /*#__PURE__*/ Schema.suspend(() => Schema.Array(Schema.String)) as any as Schema.Codec<Item>

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
 * DOM Storage identifier.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StorageId {
  /**
   * Security origin for the storage.
   */
  readonly securityOrigin?: string | undefined
  /**
   * Represents a key by which DOM Storage keys its CachedStorageAreas
   */
  readonly storageKey?: SerializedStorageKey | undefined
  /**
   * Whether the storage is local storage (not session storage).
   */
  readonly isLocalStorage: boolean
}

/**
 * Schema for `StorageId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StorageId = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.optional(Schema.String),
    storageKey: Schema.optional(SerializedStorageKey),
    isLocalStorage: Schema.Boolean
  }).annotate({ identifier: "DOMStorage.StorageId" })
) as any as Schema.Codec<StorageId>

/**
 * `clear.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearParams {
  readonly storageId: StorageId
}

/**
 * Schema for `ClearParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId
  }).annotate({ identifier: "DOMStorage.ClearParams" })
) as any as Schema.Codec<ClearParams>

/**
 * `domStorageItemAdded.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DomStorageItemAddedParams {
  readonly storageId: StorageId
  readonly key: string
  readonly newValue: string
}

/**
 * Schema for `DomStorageItemAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DomStorageItemAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId,
    key: Schema.String,
    newValue: Schema.String
  }).annotate({ identifier: "DOMStorage.DomStorageItemAddedParams" })
) as any as Schema.Codec<DomStorageItemAddedParams>

/**
 * `domStorageItemRemoved.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DomStorageItemRemovedParams {
  readonly storageId: StorageId
  readonly key: string
}

/**
 * Schema for `DomStorageItemRemovedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DomStorageItemRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId,
    key: Schema.String
  }).annotate({ identifier: "DOMStorage.DomStorageItemRemovedParams" })
) as any as Schema.Codec<DomStorageItemRemovedParams>

/**
 * `domStorageItemUpdated.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DomStorageItemUpdatedParams {
  readonly storageId: StorageId
  readonly key: string
  readonly oldValue: string
  readonly newValue: string
}

/**
 * Schema for `DomStorageItemUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DomStorageItemUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId,
    key: Schema.String,
    oldValue: Schema.String,
    newValue: Schema.String
  }).annotate({ identifier: "DOMStorage.DomStorageItemUpdatedParams" })
) as any as Schema.Codec<DomStorageItemUpdatedParams>

/**
 * `domStorageItemsCleared.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DomStorageItemsClearedParams {
  readonly storageId: StorageId
}

/**
 * Schema for `DomStorageItemsClearedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DomStorageItemsClearedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId
  }).annotate({ identifier: "DOMStorage.DomStorageItemsClearedParams" })
) as any as Schema.Codec<DomStorageItemsClearedParams>

/**
 * `getDOMStorageItems.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDOMStorageItemsParams {
  readonly storageId: StorageId
}

/**
 * Schema for `GetDOMStorageItemsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDOMStorageItemsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId
  }).annotate({ identifier: "DOMStorage.GetDOMStorageItemsParams" })
) as any as Schema.Codec<GetDOMStorageItemsParams>

/**
 * `getDOMStorageItems.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDOMStorageItemsResult {
  readonly entries: ReadonlyArray<Item>
}

/**
 * Schema for `GetDOMStorageItemsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDOMStorageItemsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    entries: Schema.Array(Item)
  }).annotate({ identifier: "DOMStorage.GetDOMStorageItemsResult" })
) as any as Schema.Codec<GetDOMStorageItemsResult>

/**
 * `removeDOMStorageItem.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveDOMStorageItemParams {
  readonly storageId: StorageId
  readonly key: string
}

/**
 * Schema for `RemoveDOMStorageItemParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveDOMStorageItemParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId,
    key: Schema.String
  }).annotate({ identifier: "DOMStorage.RemoveDOMStorageItemParams" })
) as any as Schema.Codec<RemoveDOMStorageItemParams>

/**
 * `setDOMStorageItem.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDOMStorageItemParams {
  readonly storageId: StorageId
  readonly key: string
  readonly value: string
}

/**
 * Schema for `SetDOMStorageItemParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDOMStorageItemParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId,
    key: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "DOMStorage.SetDOMStorageItemParams" })
) as any as Schema.Codec<SetDOMStorageItemParams>

/**
 * Sends `DOMStorage.clear`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clear: Protocol.CommandDef<"DOMStorage.clear", ClearParams, void> = /*#__PURE__*/ Protocol.command(
  "DOMStorage.clear",
  ClearParams,
  undefined,
  { status: "stable" }
)

/**
 * Disables storage tracking, prevents storage events from being sent to the client.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"DOMStorage.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "DOMStorage.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables storage tracking, storage events will now be delivered to the client.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"DOMStorage.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "DOMStorage.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `DOMStorage.getDOMStorageItems`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getDOMStorageItems: Protocol.CommandDef<
  "DOMStorage.getDOMStorageItems",
  GetDOMStorageItemsParams,
  GetDOMStorageItemsResult
> = /*#__PURE__*/ Protocol.command(
  "DOMStorage.getDOMStorageItems",
  GetDOMStorageItemsParams,
  GetDOMStorageItemsResult,
  { status: "stable" }
)

/**
 * Sends `DOMStorage.removeDOMStorageItem`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeDOMStorageItem: Protocol.CommandDef<
  "DOMStorage.removeDOMStorageItem",
  RemoveDOMStorageItemParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMStorage.removeDOMStorageItem",
  RemoveDOMStorageItemParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `DOMStorage.setDOMStorageItem`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDOMStorageItem: Protocol.CommandDef<"DOMStorage.setDOMStorageItem", SetDOMStorageItemParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOMStorage.setDOMStorageItem",
    SetDOMStorageItemParams,
    undefined,
    { status: "stable" }
  )

/**
 * The `DOMStorage.domStorageItemAdded` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const domStorageItemAdded: Protocol.EventDef<"DOMStorage.domStorageItemAdded", DomStorageItemAddedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOMStorage.domStorageItemAdded",
    DomStorageItemAddedParams,
    { status: "stable" }
  )

/**
 * The `DOMStorage.domStorageItemRemoved` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const domStorageItemRemoved: Protocol.EventDef<"DOMStorage.domStorageItemRemoved", DomStorageItemRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOMStorage.domStorageItemRemoved",
    DomStorageItemRemovedParams,
    { status: "stable" }
  )

/**
 * The `DOMStorage.domStorageItemUpdated` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const domStorageItemUpdated: Protocol.EventDef<"DOMStorage.domStorageItemUpdated", DomStorageItemUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "DOMStorage.domStorageItemUpdated",
    DomStorageItemUpdatedParams,
    { status: "stable" }
  )

/**
 * The `DOMStorage.domStorageItemsCleared` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const domStorageItemsCleared: Protocol.EventDef<
  "DOMStorage.domStorageItemsCleared",
  DomStorageItemsClearedParams
> = /*#__PURE__*/ Protocol.event(
  "DOMStorage.domStorageItemsCleared",
  DomStorageItemsClearedParams,
  { status: "stable" }
)
