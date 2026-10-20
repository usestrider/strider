/**
 * The storage module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08), and the Permissions spec's module. Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as BrowsingContext from "./BrowsingContext.ts"
import * as Network from "./Network.ts"

/**
 * `BrowsingContextPartitionDescriptor`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BrowsingContextPartitionDescriptor {
  readonly type: "context"
  readonly context: BrowsingContext.BrowsingContext
}

/**
 * Schema for `BrowsingContextPartitionDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowsingContextPartitionDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("context"),
    context: BrowsingContext.BrowsingContext
  }).annotate({ identifier: "storage.BrowsingContextPartitionDescriptor" })
) as any as Schema.Codec<BrowsingContextPartitionDescriptor>

/**
 * `CookieFilter`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CookieFilter {
  readonly name?: string | undefined
  readonly value?: Network.BytesValue | undefined
  readonly domain?: string | undefined
  readonly path?: string | undefined
  readonly size?: number | undefined
  readonly httpOnly?: boolean | undefined
  readonly secure?: boolean | undefined
  readonly sameSite?: Network.SameSite | undefined
  readonly expiry?: number | undefined
}

/**
 * Schema for `CookieFilter`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieFilter = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    value: Schema.optional(Network.BytesValue),
    domain: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    size: Schema.optional(Schema.Int),
    httpOnly: Schema.optional(Schema.Boolean),
    secure: Schema.optional(Schema.Boolean),
    sameSite: Schema.optional(Network.SameSite),
    expiry: Schema.optional(Schema.Int)
  }).annotate({ identifier: "storage.CookieFilter" })
) as any as Schema.Codec<CookieFilter>

/**
 * `DeleteCookiesParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteCookiesParameters {
  readonly filter?: CookieFilter | undefined
  readonly partition?: PartitionDescriptor | undefined
}

/**
 * Schema for `DeleteCookiesParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteCookiesParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filter: Schema.optional(CookieFilter),
    partition: Schema.optional(PartitionDescriptor)
  }).annotate({ identifier: "storage.DeleteCookiesParameters" })
) as any as Schema.Codec<DeleteCookiesParameters>

/**
 * `DeleteCookiesResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteCookiesResult {
  readonly partitionKey: PartitionKey
}

/**
 * Schema for `DeleteCookiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteCookiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    partitionKey: PartitionKey
  }).annotate({ identifier: "storage.DeleteCookiesResult" })
) as any as Schema.Codec<DeleteCookiesResult>

/**
 * `GetCookiesParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesParameters {
  readonly filter?: CookieFilter | undefined
  readonly partition?: PartitionDescriptor | undefined
}

/**
 * Schema for `GetCookiesParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetCookiesParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filter: Schema.optional(CookieFilter),
    partition: Schema.optional(PartitionDescriptor)
  }).annotate({ identifier: "storage.GetCookiesParameters" })
) as any as Schema.Codec<GetCookiesParameters>

/**
 * `GetCookiesResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesResult {
  readonly cookies: ReadonlyArray<Network.Cookie>
  readonly partitionKey: PartitionKey
}

/**
 * Schema for `GetCookiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetCookiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookies: Schema.Array(Network.Cookie),
    partitionKey: PartitionKey
  }).annotate({ identifier: "storage.GetCookiesResult" })
) as any as Schema.Codec<GetCookiesResult>

/**
 * `PartialCookie`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PartialCookie {
  readonly name: string
  readonly value: Redacted.Redacted<Network.BytesValue>
  readonly domain: string
  readonly path?: string | undefined
  readonly httpOnly?: boolean | undefined
  readonly secure?: boolean | undefined
  readonly sameSite?: Network.SameSite | undefined
  readonly expiry?: number | undefined
}

/**
 * Schema for `PartialCookie`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PartialCookie = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(Network.BytesValue),
    domain: Schema.String,
    path: Schema.optional(Schema.String),
    httpOnly: Schema.optional(Schema.Boolean),
    secure: Schema.optional(Schema.Boolean),
    sameSite: Schema.optional(Network.SameSite),
    expiry: Schema.optional(Schema.Int)
  }).annotate({ identifier: "storage.PartialCookie" })
) as any as Schema.Codec<PartialCookie>

/**
 * `PartitionDescriptor`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PartitionDescriptor = BrowsingContextPartitionDescriptor | StorageKeyPartitionDescriptor

/**
 * Schema for `PartitionDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PartitionDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([BrowsingContextPartitionDescriptor, StorageKeyPartitionDescriptor])
) as any as Schema.Codec<PartitionDescriptor>

/**
 * `PartitionKey`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PartitionKey {
  readonly userContext?: string | undefined
  readonly sourceOrigin?: string | undefined
}

/**
 * Schema for `PartitionKey`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PartitionKey = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userContext: Schema.optional(Schema.String),
    sourceOrigin: Schema.optional(Schema.String)
  }).annotate({ identifier: "storage.PartitionKey" })
) as any as Schema.Codec<PartitionKey>

/**
 * `SetCookieParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieParameters {
  readonly cookie: PartialCookie
  readonly partition?: PartitionDescriptor | undefined
}

/**
 * Schema for `SetCookieParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookie: PartialCookie,
    partition: Schema.optional(PartitionDescriptor)
  }).annotate({ identifier: "storage.SetCookieParameters" })
) as any as Schema.Codec<SetCookieParameters>

/**
 * `SetCookieResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieResult {
  readonly partitionKey: PartitionKey
}

/**
 * Schema for `SetCookieResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    partitionKey: PartitionKey
  }).annotate({ identifier: "storage.SetCookieResult" })
) as any as Schema.Codec<SetCookieResult>

/**
 * `StorageKeyPartitionDescriptor`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StorageKeyPartitionDescriptor {
  readonly type: "storageKey"
  readonly userContext?: string | undefined
  readonly sourceOrigin?: string | undefined
}

/**
 * Schema for `StorageKeyPartitionDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StorageKeyPartitionDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("storageKey"),
    userContext: Schema.optional(Schema.String),
    sourceOrigin: Schema.optional(Schema.String)
  }).annotate({ identifier: "storage.StorageKeyPartitionDescriptor" })
) as any as Schema.Codec<StorageKeyPartitionDescriptor>

/**
 * Sends `storage.deleteCookies`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteCookies: Protocol.CommandDef<"storage.deleteCookies", DeleteCookiesParameters, DeleteCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "storage.deleteCookies",
    DeleteCookiesParameters,
    DeleteCookiesResult,
    { status: "stable" }
  )

/**
 * Sends `storage.getCookies`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getCookies: Protocol.CommandDef<"storage.getCookies", GetCookiesParameters, GetCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "storage.getCookies",
    GetCookiesParameters,
    GetCookiesResult,
    { status: "stable" }
  )

/**
 * Sends `storage.setCookie`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCookie: Protocol.CommandDef<"storage.setCookie", SetCookieParameters, SetCookieResult> =
  /*#__PURE__*/ Protocol.command(
    "storage.setCookie",
    SetCookieParameters,
    SetCookieResult,
    { status: "stable" }
  )
