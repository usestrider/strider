/**
 * Query and modify storage (cookies for now) under Site Isolation. Backed by the NetworkProcess-owned cookie store via API::HTTPCookieStore, so cross-origin iframe cookies are visible. The flat read also surfaces partitioned (CHIPS) cookies, each labeled with its partitionKey.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Cookie object.
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
   * True in case of session cookie.
   */
  readonly session: boolean
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly: boolean
  /**
   * True if cookie is secure.
   */
  readonly secure: boolean
  /**
   * Cookie Same-Site policy.
   */
  readonly sameSite: CookieSameSitePolicy
  /**
   * Cookie partition key.
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
    session: Schema.Boolean,
    httpOnly: Schema.Boolean,
    secure: Schema.Boolean,
    sameSite: CookieSameSitePolicy,
    partitionKey: Schema.optional(Schema.String)
  }).annotate({ identifier: "Storage.Cookie" })
) as any as Schema.Codec<Cookie>

/**
 * Filter parameters for cookie retrieval and deletion. Every provided field narrows the result set.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CookieFilter {
  /**
   * The name of the cookie.
   */
  readonly name?: string | undefined
  /**
   * The value of the cookie.
   */
  readonly value?: Redacted.Redacted<string> | undefined
  /**
   * The domain of the cookie.
   */
  readonly domain?: string | undefined
  /**
   * The path of the cookie.
   */
  readonly path?: string | undefined
  /**
   * If the cookie is HTTP only.
   */
  readonly httpOnly?: boolean | undefined
  /**
   * If the cookie is secure.
   */
  readonly secure?: boolean | undefined
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
    value: Schema.optional(Schema.RedactedFromValue(Schema.String)),
    domain: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    httpOnly: Schema.optional(Schema.Boolean),
    secure: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Storage.CookieFilter" })
) as any as Schema.Codec<CookieFilter>

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
 * Describes a storage partition. Omit to target the inspected page's default data store. Type 'context' targets the inspected page's main-frame origin.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PartitionDescriptor {
  /**
   * The type of partition descriptor.
   */
  readonly type: PartitionDescriptorType
}

/**
 * Schema for `PartitionDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PartitionDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: PartitionDescriptorType
  }).annotate({ identifier: "Storage.PartitionDescriptor" })
) as any as Schema.Codec<PartitionDescriptor>

/**
 * The type of storage partition descriptor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PartitionDescriptorType =
  | "context"
  | (string & {})

/**
 * Schema for `PartitionDescriptorType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PartitionDescriptorType = Schema.String as any as Schema.Codec<PartitionDescriptorType>

/**
 * Identifies the storage partition a cookie belongs to. At least one of 'userContext' or 'sourceOrigin' is present.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PartitionKey {
  /**
   * The user context identifier of the partition.
   */
  readonly userContext?: string | undefined
  /**
   * The serialization of the origin of resources that can access the storage partition.
   */
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
  }).annotate({ identifier: "Storage.PartitionKey" })
) as any as Schema.Codec<PartitionKey>

/**
 * Removes zero or more cookies which match the provided filter, within the given partition. A filter is required; omitting it fails rather than deleting every cookie.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteCookiesParams {
  /**
   * Filter parameters for cookie deletion. Required in practice: a request with no filter is rejected to avoid an accidental clear of the entire store.
   */
  readonly filter?: CookieFilter | undefined
  /**
   * The storage partition in which to delete cookies. Defaults to the origin of the inspected page's main frame.
   */
  readonly partition?: PartitionDescriptor | undefined
}

/**
 * Schema for `DeleteCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filter: Schema.optional(CookieFilter),
    partition: Schema.optional(PartitionDescriptor)
  }).annotate({ identifier: "Storage.DeleteCookiesParams" })
) as any as Schema.Codec<DeleteCookiesParams>

/**
 * Removes zero or more cookies which match the provided filter, within the given partition. A filter is required; omitting it fails rather than deleting every cookie.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteCookiesResult {
  /**
   * The storage partition key the cookies were deleted from.
   */
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
  }).annotate({ identifier: "Storage.DeleteCookiesResult" })
) as any as Schema.Codec<DeleteCookiesResult>

/**
 * Retrieves zero or more cookies which match the provided filter, within the given partition.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesParams {
  /**
   * Filter parameters for cookie retrieval.
   */
  readonly filter?: CookieFilter | undefined
  /**
   * The storage partition in which to get cookies. Defaults to the origin of the inspected page's main frame.
   */
  readonly partition?: PartitionDescriptor | undefined
}

/**
 * Schema for `GetCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filter: Schema.optional(CookieFilter),
    partition: Schema.optional(PartitionDescriptor)
  }).annotate({ identifier: "Storage.GetCookiesParams" })
) as any as Schema.Codec<GetCookiesParams>

/**
 * Retrieves zero or more cookies which match the provided filter, within the given partition.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesResult {
  /**
   * The list of matching cookies.
   */
  readonly cookies: ReadonlyArray<Cookie>
  /**
   * The storage partition key the cookies came from.
   */
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
    cookies: Schema.Array(Cookie),
    partitionKey: PartitionKey
  }).annotate({ identifier: "Storage.GetCookiesResult" })
) as any as Schema.Codec<GetCookiesResult>

/**
 * Creates a new cookie, replacing any cookie in the partition which matches.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieParams {
  /**
   * The cookie to set.
   */
  readonly cookie: Cookie
  /**
   * The storage partition in which to set the cookie. Defaults to the origin of the inspected page's main frame.
   */
  readonly partition?: PartitionDescriptor | undefined
}

/**
 * Schema for `SetCookieParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookie: Cookie,
    partition: Schema.optional(PartitionDescriptor)
  }).annotate({ identifier: "Storage.SetCookieParams" })
) as any as Schema.Codec<SetCookieParams>

/**
 * Creates a new cookie, replacing any cookie in the partition which matches.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieResult {
  /**
   * The storage partition key the cookie was set in.
   */
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
  }).annotate({ identifier: "Storage.SetCookieResult" })
) as any as Schema.Codec<SetCookieResult>

/**
 * Removes zero or more cookies which match the provided filter, within the given partition. A filter is required; omitting it fails rather than deleting every cookie.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteCookies: Protocol.CommandDef<"Storage.deleteCookies", DeleteCookiesParams, DeleteCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Storage.deleteCookies",
    DeleteCookiesParams,
    DeleteCookiesResult,
    { status: "stable" }
  )

/**
 * Marks the Storage domain disabled for this target. Counterpart to enable; a no-op beyond lifecycle bookkeeping.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Storage.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Storage.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Marks the Storage domain enabled for this target. No tracking is started; cookies are read on demand from the authoritative store, so this is effectively a no-op kept for domain-lifecycle symmetry.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Storage.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Storage.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Retrieves zero or more cookies which match the provided filter, within the given partition.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getCookies: Protocol.CommandDef<"Storage.getCookies", GetCookiesParams, GetCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Storage.getCookies",
    GetCookiesParams,
    GetCookiesResult,
    { status: "stable" }
  )

/**
 * Creates a new cookie, replacing any cookie in the partition which matches.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCookie: Protocol.CommandDef<"Storage.setCookie", SetCookieParams, SetCookieResult> =
  /*#__PURE__*/ Protocol.command(
    "Storage.setCookie",
    SetCookieParams,
    SetCookieResult,
    { status: "stable" }
  )
