/**
 * Query and modify DOM storage.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * DOM Storage item.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Item = ReadonlyArray<string>

/**
 * Schema for `Item`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Item = /*#__PURE__*/ Schema.suspend(() => Schema.Array(Schema.String)) as any as Schema.Codec<Item>

/**
 * DOM Storage identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StorageId {
  /**
   * Security origin for the storage.
   */
  readonly securityOrigin: string
  /**
   * Whether the storage is local storage (not session storage).
   */
  readonly isLocalStorage: boolean
}

/**
 * Schema for `StorageId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StorageId = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityOrigin: Schema.String,
    isLocalStorage: Schema.Boolean
  }).annotate({ identifier: "DOMStorage.StorageId" })
) as any as Schema.Codec<StorageId>

/**
 * `clearDOMStorageItems.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClearDOMStorageItemsParams {
  readonly storageId: StorageId
}

/**
 * Schema for `ClearDOMStorageItemsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClearDOMStorageItemsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    storageId: StorageId
  }).annotate({ identifier: "DOMStorage.ClearDOMStorageItemsParams" })
) as any as Schema.Codec<ClearDOMStorageItemsParams>

/**
 * `domStorageItemAdded.Params`.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DomStorageItemsClearedParams {
  readonly storageId: StorageId
}

/**
 * Schema for `DomStorageItemsClearedParams`.
 *
 * @stability unstable
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDOMStorageItemsParams {
  readonly storageId: StorageId
}

/**
 * Schema for `GetDOMStorageItemsParams`.
 *
 * @stability unstable
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDOMStorageItemsResult {
  readonly entries: ReadonlyArray<Item>
}

/**
 * Schema for `GetDOMStorageItemsResult`.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * Sends `DOMStorage.clearDOMStorageItems`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearDOMStorageItems: Protocol.CommandDef<
  "DOMStorage.clearDOMStorageItems",
  ClearDOMStorageItemsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMStorage.clearDOMStorageItems",
  ClearDOMStorageItemsParams,
  undefined,
  { status: "stable" }
)

/**
 * Disables storage tracking, prevents storage events from being sent to the client.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
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
