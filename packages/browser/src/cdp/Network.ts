/**
 * Network domain allows tracking network activities of the page. It exposes information about http,
 * file, data and other requests and responses, their headers, bodies, timing, etc.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"
import * as Emulation from "./Emulation.ts"
import * as IO from "./IO.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"
import * as Security from "./Security.ts"

/**
 * Encapsulates the script ancestry and the root script filter list rule that
 * caused the resource or element to be labeled as an ad.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdAncestry {
  /**
   * A chain of `AdScriptIdentifier`s representing the ancestry of an ad
   * script that led to the creation of a resource or element. The chain is
   * ordered from the script itself (lowest level) up to its root ancestor
   * that was flagged by a filter list.
   */
  readonly ancestryChain: ReadonlyArray<AdScriptIdentifier>
  /**
   * The filter list rule that caused the root (last) script in
   * `ancestryChain` to be tagged as an ad.
   */
  readonly rootScriptFilterlistRule?: string | undefined
}

/**
 * Schema for `AdAncestry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdAncestry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ancestryChain: Schema.Array(AdScriptIdentifier),
    rootScriptFilterlistRule: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.AdAncestry" })
) as any as Schema.Codec<AdAncestry>

/**
 * Represents the provenance of an ad resource or element. Only one of
 * `filterlistRule` or `adScriptAncestry` can be set. If `filterlistRule`
 * is provided, the resource URL directly matches a filter list rule. If
 * `adScriptAncestry` is provided, an ad script initiated the resource fetch or
 * appended the element to the DOM. If neither is provided, the entity is
 * known to be an ad, but provenance tracking information is unavailable.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdProvenance {
  /**
   * The filterlist rule that matched, if any.
   */
  readonly filterlistRule?: string | undefined
  /**
   * The script ancestry that created the ad, if any.
   * Note: depending on the context, this may represent the full ancestry up
   * to the root script, or it may contain only one script representing the
   * immediate ancestor.
   */
  readonly adScriptAncestry?: AdAncestry | undefined
}

/**
 * Schema for `AdProvenance`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdProvenance = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filterlistRule: Schema.optional(Schema.String),
    adScriptAncestry: Schema.optional(AdAncestry)
  }).annotate({ identifier: "Network.AdProvenance" })
) as any as Schema.Codec<AdProvenance>

/**
 * Identifies the script on the stack that caused a resource or element to be
 * labeled as an ad. For resources, this indicates the context that triggered
 * the fetch. For elements, this indicates the context that caused the element
 * to be appended to the DOM.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdScriptIdentifier {
  /**
   * The script's V8 identifier.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * V8's debugging ID for the v8::Context.
   */
  readonly debuggerId: Runtime.UniqueDebuggerId
  /**
   * The script's url (or generated name based on id if inline script).
   */
  readonly name: string
}

/**
 * Schema for `AdScriptIdentifier`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdScriptIdentifier = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId,
    debuggerId: Runtime.UniqueDebuggerId,
    name: Schema.String
  }).annotate({ identifier: "Network.AdScriptIdentifier" })
) as any as Schema.Codec<AdScriptIdentifier>

/**
 * The reason why Chrome uses a specific transport protocol for HTTP semantics.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AlternateProtocolUsage =
  | "alternativeJobWonWithoutRace"
  | "alternativeJobWonRace"
  | "mainJobWonRace"
  | "mappingMissing"
  | "broken"
  | "dnsAlpnH3JobWonWithoutRace"
  | "dnsAlpnH3JobWonRace"
  | "unspecifiedReason"
  | (string & {})

/**
 * Schema for `AlternateProtocolUsage`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AlternateProtocolUsage = Schema.String as any as Schema.Codec<AlternateProtocolUsage>

/**
 * A cookie associated with the request which may or may not be sent with it.
 * Includes the cookies itself and reasons for blocking or exemption.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AssociatedCookie {
  /**
   * The cookie object representing the cookie which was not sent.
   */
  readonly cookie: Cookie
  /**
   * The reason(s) the cookie was blocked. If empty means the cookie is included.
   */
  readonly blockedReasons: ReadonlyArray<CookieBlockedReason>
  /**
   * The reason the cookie should have been blocked by 3PCD but is exempted. A cookie could
   * only have at most one exemption reason.
   */
  readonly exemptionReason?: CookieExemptionReason | undefined
}

/**
 * Schema for `AssociatedCookie`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AssociatedCookie = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookie: Cookie,
    blockedReasons: Schema.Array(CookieBlockedReason),
    exemptionReason: Schema.optional(CookieExemptionReason)
  }).annotate({ identifier: "Network.AssociatedCookie" })
) as any as Schema.Codec<AssociatedCookie, unknown>

/**
 * Authorization challenge for HTTP status code 401 or 407.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AuthChallenge {
  /**
   * Source of the authentication challenge.
   */
  readonly source?: AuthChallengeSource | undefined
  /**
   * Origin of the challenger.
   */
  readonly origin: string
  /**
   * The authentication scheme used, such as basic or digest
   */
  readonly scheme: string
  /**
   * The realm of the challenge. May be empty.
   */
  readonly realm: string
}

/**
 * Schema for `AuthChallenge`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallenge = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: Schema.optional(AuthChallengeSource),
    origin: Schema.String,
    scheme: Schema.String,
    realm: Schema.String
  }).annotate({ identifier: "Network.AuthChallenge" })
) as any as Schema.Codec<AuthChallenge>

/**
 * Source of the authentication challenge.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AuthChallengeSource =
  | "Server"
  | "Proxy"
  | (string & {})

/**
 * Schema for `AuthChallengeSource`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallengeSource = Schema.String as any as Schema.Codec<AuthChallengeSource>

/**
 * Response to an AuthChallenge.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AuthChallengeResponse {
  /**
   * The decision on what to do in response to the authorization challenge.  Default means
   * deferring to the default behavior of the net stack, which will likely either the Cancel
   * authentication or display a popup dialog box.
   */
  readonly response: AuthChallengeResponseResponse
  /**
   * The username to provide, possibly empty. Should only be set if response is
   * ProvideCredentials.
   */
  readonly username?: string | undefined
  /**
   * The password to provide, possibly empty. Should only be set if response is
   * ProvideCredentials.
   */
  readonly password?: Redacted.Redacted<string> | undefined
}

/**
 * Schema for `AuthChallengeResponse`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallengeResponse = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    response: AuthChallengeResponseResponse,
    username: Schema.optional(Schema.String),
    password: Schema.optional(Schema.RedactedFromValue(Schema.String))
  }).annotate({ identifier: "Network.AuthChallengeResponse" })
) as any as Schema.Codec<AuthChallengeResponse, unknown>

/**
 * The decision on what to do in response to the authorization challenge.  Default means
 * deferring to the default behavior of the net stack, which will likely either the Cancel
 * authentication or display a popup dialog box.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AuthChallengeResponseResponse =
  | "Default"
  | "CancelAuth"
  | "ProvideCredentials"
  | (string & {})

/**
 * Schema for `AuthChallengeResponseResponse`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallengeResponseResponse = Schema.String as any as Schema.Codec<AuthChallengeResponseResponse>

/**
 * `BlockPattern`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BlockPattern {
  /**
   * URL pattern to match. Patterns use the URLPattern constructor string syntax
   * (https://urlpattern.spec.whatwg.org/) and must be absolute. Example: `*://*:*\/*.css`.
   */
  readonly urlPattern: string
  /**
   * Whether or not to block the pattern. If false, a matching request will not be blocked even if it matches a later
   * `BlockPattern`.
   */
  readonly block: boolean
}

/**
 * Schema for `BlockPattern`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BlockPattern = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    urlPattern: Schema.String,
    block: Schema.Boolean
  }).annotate({ identifier: "Network.BlockPattern" })
) as any as Schema.Codec<BlockPattern>

/**
 * The reason why request was blocked.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BlockedReason =
  | "other"
  | "csp"
  | "mixed-content"
  | "origin"
  | "inspector"
  | "integrity"
  | "subresource-filter"
  | "content-type"
  | "coep-frame-resource-needs-coep-header"
  | "coop-sandboxed-iframe-cannot-navigate-to-coop-page"
  | "corp-not-same-origin"
  | "corp-not-same-origin-after-defaulted-to-same-origin-by-coep"
  | "corp-not-same-origin-after-defaulted-to-same-origin-by-dip"
  | "corp-not-same-origin-after-defaulted-to-same-origin-by-coep-and-dip"
  | "corp-not-same-site"
  | "sri-message-signature-mismatch"
  | (string & {})

/**
 * Schema for `BlockedReason`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BlockedReason = Schema.String as any as Schema.Codec<BlockedReason>

/**
 * A cookie which was not stored from a response with the corresponding reason.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BlockedSetCookieWithReason {
  /**
   * The reason(s) this cookie was blocked.
   */
  readonly blockedReasons: ReadonlyArray<SetCookieBlockedReason>
  /**
   * The string representing this individual cookie as it would appear in the header.
   * This is not the entire "cookie" or "set-cookie" header which could have multiple cookies.
   */
  readonly cookieLine: string
  /**
   * The cookie object which represents the cookie which was not stored. It is optional because
   * sometimes complete cookie information is not available, such as in the case of parsing
   * errors.
   */
  readonly cookie?: Cookie | undefined
}

/**
 * Schema for `BlockedSetCookieWithReason`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BlockedSetCookieWithReason = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    blockedReasons: Schema.Array(SetCookieBlockedReason),
    cookieLine: Schema.String,
    cookie: Schema.optional(Cookie)
  }).annotate({ identifier: "Network.BlockedSetCookieWithReason" })
) as any as Schema.Codec<BlockedSetCookieWithReason, unknown>

/**
 * Information about the cached resource.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CachedResource {
  /**
   * Resource URL. This is the url of the original network request.
   */
  readonly url: string
  /**
   * Type of this resource.
   */
  readonly type: ResourceType
  /**
   * Cached response data.
   */
  readonly response?: Response | undefined
  /**
   * Cached response body size.
   */
  readonly bodySize: number
}

/**
 * Schema for `CachedResource`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CachedResource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    type: ResourceType,
    response: Schema.optional(Response),
    bodySize: Schema.Number
  }).annotate({ identifier: "Network.CachedResource" })
) as any as Schema.Codec<CachedResource>

/**
 * Whether the request complied with Certificate Transparency policy.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CertificateTransparencyCompliance =
  | "unknown"
  | "not-compliant"
  | "compliant"
  | (string & {})

/**
 * Schema for `CertificateTransparencyCompliance`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CertificateTransparencyCompliance = Schema.String as any as Schema.Codec<CertificateTransparencyCompliance>

/**
 * Session event details specific to challenges.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ChallengeEventDetails {
  /**
   * The result of a challenge.
   */
  readonly challengeResult: ChallengeEventDetailsChallengeResult
  /**
   * The challenge set.
   */
  readonly challenge: string
}

/**
 * Schema for `ChallengeEventDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ChallengeEventDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    challengeResult: ChallengeEventDetailsChallengeResult,
    challenge: Schema.String
  }).annotate({ identifier: "Network.ChallengeEventDetails" })
) as any as Schema.Codec<ChallengeEventDetails>

/**
 * The result of a challenge.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ChallengeEventDetailsChallengeResult =
  | "Success"
  | "NoSessionId"
  | "NoSessionMatch"
  | "CantSetBoundCookie"
  | (string & {})

/**
 * Schema for `ChallengeEventDetailsChallengeResult`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChallengeEventDetailsChallengeResult = Schema.String as any as Schema.Codec<
  ChallengeEventDetailsChallengeResult
>

/**
 * `ClientSecurityState`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClientSecurityState {
  readonly initiatorIsSecureContext: boolean
  readonly initiatorIPAddressSpace: IPAddressSpace
  readonly localNetworkAccessRequestPolicy: LocalNetworkAccessRequestPolicy
}

/**
 * Schema for `ClientSecurityState`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClientSecurityState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    initiatorIsSecureContext: Schema.Boolean,
    initiatorIPAddressSpace: IPAddressSpace,
    localNetworkAccessRequestPolicy: LocalNetworkAccessRequestPolicy
  }).annotate({ identifier: "Network.ClientSecurityState" })
) as any as Schema.Codec<ClientSecurityState>

/**
 * `ConnectTiming`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ConnectTiming {
  /**
   * Timing's requestTime is a baseline in seconds, while the other numbers are ticks in
   * milliseconds relatively to this requestTime. Matches ResourceTiming's requestTime for
   * the same request (but not for redirected requests).
   */
  readonly requestTime: number
}

/**
 * Schema for `ConnectTiming`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ConnectTiming = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestTime: Schema.Number
  }).annotate({ identifier: "Network.ConnectTiming" })
) as any as Schema.Codec<ConnectTiming>

/**
 * The underlying connection technology that the browser is supposedly using.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ConnectionType =
  | "none"
  | "cellular2g"
  | "cellular3g"
  | "cellular4g"
  | "bluetooth"
  | "ethernet"
  | "wifi"
  | "wimax"
  | "other"
  | (string & {})

/**
 * Schema for `ConnectionType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConnectionType = Schema.String as any as Schema.Codec<ConnectionType>

/**
 * `ContentSecurityPolicySource` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ContentSecurityPolicySource =
  | "HTTP"
  | "Meta"
  | (string & {})

/**
 * Schema for `ContentSecurityPolicySource`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContentSecurityPolicySource = Schema.String as any as Schema.Codec<ContentSecurityPolicySource>

/**
 * `ContentSecurityPolicyStatus`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContentSecurityPolicyStatus {
  readonly effectiveDirectives: string
  readonly isEnforced: boolean
  readonly source: ContentSecurityPolicySource
}

/**
 * Schema for `ContentSecurityPolicyStatus`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContentSecurityPolicyStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    effectiveDirectives: Schema.String,
    isEnforced: Schema.Boolean,
    source: ContentSecurityPolicySource
  }).annotate({ identifier: "Network.ContentSecurityPolicyStatus" })
) as any as Schema.Codec<ContentSecurityPolicyStatus>

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
   * Cookie expiration date as the number of seconds since the UNIX epoch.
   * The value is set to -1 if the expiry date is not set.
   * The value can be null for values that cannot be represented in
   * JSON (±Inf).
   */
  readonly expires: number
  /**
   * Cookie size.
   */
  readonly size: number
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly: boolean
  /**
   * True if cookie is secure.
   */
  readonly secure: boolean
  /**
   * True in case of session cookie.
   */
  readonly session: boolean
  /**
   * Cookie SameSite type.
   */
  readonly sameSite?: CookieSameSite | undefined
  /**
   * Cookie Priority
   */
  readonly priority?: CookiePriority | undefined
  /**
   * Cookie source scheme type.
   */
  readonly sourceScheme?: CookieSourceScheme | undefined
  /**
   * Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.
   * An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.
   * This is a temporary ability and it will be removed in the future.
   */
  readonly sourcePort?: number | undefined
  /**
   * Cookie partition key.
   */
  readonly partitionKey?: CookiePartitionKey | undefined
  /**
   * True if cookie partition key is opaque.
   */
  readonly partitionKeyOpaque?: boolean | undefined
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
    size: Schema.Int,
    httpOnly: Schema.Boolean,
    secure: Schema.Boolean,
    session: Schema.Boolean,
    sameSite: Schema.optional(CookieSameSite),
    priority: Schema.optional(CookiePriority),
    sourceScheme: Schema.optional(CookieSourceScheme),
    sourcePort: Schema.optional(Schema.Int),
    partitionKey: Schema.optional(CookiePartitionKey),
    partitionKeyOpaque: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.Cookie" })
) as any as Schema.Codec<Cookie, unknown>

/**
 * Types of reasons why a cookie may not be sent with a request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookieBlockedReason =
  | "SecureOnly"
  | "NotOnPath"
  | "DomainMismatch"
  | "SameSiteStrict"
  | "SameSiteLax"
  | "SameSiteUnspecifiedTreatedAsLax"
  | "SameSiteNoneInsecure"
  | "UserPreferences"
  | "ThirdPartyPhaseout"
  | "ThirdPartyBlockedInFirstPartySet"
  | "UnknownError"
  | "SchemefulSameSiteStrict"
  | "SchemefulSameSiteLax"
  | "SchemefulSameSiteUnspecifiedTreatedAsLax"
  | "NameValuePairExceedsMaxSize"
  | "PortMismatch"
  | "SchemeMismatch"
  | "AnonymousContext"
  | (string & {})

/**
 * Schema for `CookieBlockedReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieBlockedReason = Schema.String as any as Schema.Codec<CookieBlockedReason>

/**
 * Types of reasons why a cookie should have been blocked by 3PCD but is exempted for the request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookieExemptionReason =
  | "None"
  | "UserSetting"
  | "EnterprisePolicy"
  | "StorageAccess"
  | "TopLevelStorageAccess"
  | "Scheme"
  | "SameSiteNoneCookiesInSandbox"
  | (string & {})

/**
 * Schema for `CookieExemptionReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieExemptionReason = Schema.String as any as Schema.Codec<CookieExemptionReason>

/**
 * Cookie parameter object
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CookieParam {
  /**
   * Cookie name.
   */
  readonly name: string
  /**
   * Cookie value.
   */
  readonly value: Redacted.Redacted<string>
  /**
   * The request-URI to associate with the setting of the cookie. This value can affect the
   * default domain, path, source port, and source scheme values of the created cookie.
   */
  readonly url?: string | undefined
  /**
   * Cookie domain.
   */
  readonly domain?: string | undefined
  /**
   * Cookie path.
   */
  readonly path?: string | undefined
  /**
   * True if cookie is secure.
   */
  readonly secure?: boolean | undefined
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly?: boolean | undefined
  /**
   * Cookie SameSite type.
   */
  readonly sameSite?: CookieSameSite | undefined
  /**
   * Cookie expiration date, session cookie if not set
   */
  readonly expires?: TimeSinceEpoch | undefined
  /**
   * Cookie Priority.
   */
  readonly priority?: CookiePriority | undefined
  /**
   * Cookie source scheme type.
   */
  readonly sourceScheme?: CookieSourceScheme | undefined
  /**
   * Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.
   * An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.
   * This is a temporary ability and it will be removed in the future.
   */
  readonly sourcePort?: number | undefined
  /**
   * Cookie partition key. If not set, the cookie will be set as not partitioned.
   */
  readonly partitionKey?: CookiePartitionKey | undefined
}

/**
 * Schema for `CookieParam`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieParam = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
    url: Schema.optional(Schema.String),
    domain: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    secure: Schema.optional(Schema.Boolean),
    httpOnly: Schema.optional(Schema.Boolean),
    sameSite: Schema.optional(CookieSameSite),
    expires: Schema.optional(TimeSinceEpoch),
    priority: Schema.optional(CookiePriority),
    sourceScheme: Schema.optional(CookieSourceScheme),
    sourcePort: Schema.optional(Schema.Int),
    partitionKey: Schema.optional(CookiePartitionKey)
  }).annotate({ identifier: "Network.CookieParam" })
) as any as Schema.Codec<CookieParam, unknown>

/**
 * cookiePartitionKey object
 * The representation of the components of the key that are created by the cookiePartitionKey class contained in net/cookies/cookie_partition_key.h.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CookiePartitionKey {
  /**
   * The site of the top-level URL the browser was visiting at the start
   * of the request to the endpoint that set the cookie.
   */
  readonly topLevelSite: string
  /**
   * Indicates if the cookie has any ancestors that are cross-site to the topLevelSite.
   */
  readonly hasCrossSiteAncestor: boolean
}

/**
 * Schema for `CookiePartitionKey`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookiePartitionKey = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    topLevelSite: Schema.String,
    hasCrossSiteAncestor: Schema.Boolean
  }).annotate({ identifier: "Network.CookiePartitionKey" })
) as any as Schema.Codec<CookiePartitionKey>

/**
 * Represents the cookie's 'Priority' status:
 * https://tools.ietf.org/html/draft-west-cookie-priority-00
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookiePriority =
  | "Low"
  | "Medium"
  | "High"
  | (string & {})

/**
 * Schema for `CookiePriority`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookiePriority = Schema.String as any as Schema.Codec<CookiePriority>

/**
 * Represents the cookie's 'SameSite' status:
 * https://tools.ietf.org/html/draft-west-first-party-cookies
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CookieSameSite =
  | "Strict"
  | "Lax"
  | "None"
  | (string & {})

/**
 * Schema for `CookieSameSite`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieSameSite = Schema.String as any as Schema.Codec<CookieSameSite>

/**
 * Represents the source scheme of the origin that originally set the cookie.
 * A value of "Unset" allows protocol clients to emulate legacy cookie scope for the scheme.
 * This is a temporary ability and it will be removed in the future.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookieSourceScheme =
  | "Unset"
  | "NonSecure"
  | "Secure"
  | (string & {})

/**
 * Schema for `CookieSourceScheme`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieSourceScheme = Schema.String as any as Schema.Codec<CookieSourceScheme>

/**
 * The reason why request was blocked.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CorsError =
  | "DisallowedByMode"
  | "InvalidResponse"
  | "WildcardOriginNotAllowed"
  | "MissingAllowOriginHeader"
  | "MultipleAllowOriginValues"
  | "InvalidAllowOriginValue"
  | "AllowOriginMismatch"
  | "InvalidAllowCredentials"
  | "CorsDisabledScheme"
  | "PreflightInvalidStatus"
  | "PreflightDisallowedRedirect"
  | "PreflightWildcardOriginNotAllowed"
  | "PreflightMissingAllowOriginHeader"
  | "PreflightMultipleAllowOriginValues"
  | "PreflightInvalidAllowOriginValue"
  | "PreflightAllowOriginMismatch"
  | "PreflightInvalidAllowCredentials"
  | "PreflightMissingAllowExternal"
  | "PreflightInvalidAllowExternal"
  | "InvalidAllowMethodsPreflightResponse"
  | "InvalidAllowHeadersPreflightResponse"
  | "MethodDisallowedByPreflightResponse"
  | "HeaderDisallowedByPreflightResponse"
  | "RedirectContainsCredentials"
  | "InsecureLocalNetwork"
  | "InvalidLocalNetworkAccess"
  | "NoCorsRedirectModeNotFollow"
  | "LocalNetworkAccessPermissionDenied"
  | (string & {})

/**
 * Schema for `CorsError`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CorsError = Schema.String as any as Schema.Codec<CorsError>

/**
 * `CorsErrorStatus`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CorsErrorStatus {
  readonly corsError: CorsError
  readonly failedParameter: string
}

/**
 * Schema for `CorsErrorStatus`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CorsErrorStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    corsError: CorsError,
    failedParameter: Schema.String
  }).annotate({ identifier: "Network.CorsErrorStatus" })
) as any as Schema.Codec<CorsErrorStatus>

/**
 * Session event details specific to creation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CreationEventDetails {
  /**
   * The result of the fetch attempt.
   */
  readonly fetchResult: DeviceBoundSessionFetchResult
  /**
   * The session if there was a newly created session. This is populated for
   * all successful creation events.
   */
  readonly newSession?: DeviceBoundSession | undefined
  /**
   * Details about a failed device bound session network request if there was
   * one.
   */
  readonly failedRequest?: DeviceBoundSessionFailedRequest | undefined
}

/**
 * Schema for `CreationEventDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CreationEventDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fetchResult: DeviceBoundSessionFetchResult,
    newSession: Schema.optional(DeviceBoundSession),
    failedRequest: Schema.optional(DeviceBoundSessionFailedRequest)
  }).annotate({ identifier: "Network.CreationEventDetails" })
) as any as Schema.Codec<CreationEventDetails>

/**
 * `CrossOriginEmbedderPolicyStatus`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CrossOriginEmbedderPolicyStatus {
  readonly value: CrossOriginEmbedderPolicyValue
  readonly reportOnlyValue: CrossOriginEmbedderPolicyValue
  readonly reportingEndpoint?: string | undefined
  readonly reportOnlyReportingEndpoint?: string | undefined
}

/**
 * Schema for `CrossOriginEmbedderPolicyStatus`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CrossOriginEmbedderPolicyStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: CrossOriginEmbedderPolicyValue,
    reportOnlyValue: CrossOriginEmbedderPolicyValue,
    reportingEndpoint: Schema.optional(Schema.String),
    reportOnlyReportingEndpoint: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.CrossOriginEmbedderPolicyStatus" })
) as any as Schema.Codec<CrossOriginEmbedderPolicyStatus>

/**
 * `CrossOriginEmbedderPolicyValue` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CrossOriginEmbedderPolicyValue =
  | "None"
  | "Credentialless"
  | "RequireCorp"
  | (string & {})

/**
 * Schema for `CrossOriginEmbedderPolicyValue`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CrossOriginEmbedderPolicyValue = Schema.String as any as Schema.Codec<CrossOriginEmbedderPolicyValue>

/**
 * `CrossOriginOpenerPolicyStatus`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CrossOriginOpenerPolicyStatus {
  readonly value: CrossOriginOpenerPolicyValue
  readonly reportOnlyValue: CrossOriginOpenerPolicyValue
  readonly reportingEndpoint?: string | undefined
  readonly reportOnlyReportingEndpoint?: string | undefined
}

/**
 * Schema for `CrossOriginOpenerPolicyStatus`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CrossOriginOpenerPolicyStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: CrossOriginOpenerPolicyValue,
    reportOnlyValue: CrossOriginOpenerPolicyValue,
    reportingEndpoint: Schema.optional(Schema.String),
    reportOnlyReportingEndpoint: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.CrossOriginOpenerPolicyStatus" })
) as any as Schema.Codec<CrossOriginOpenerPolicyStatus>

/**
 * `CrossOriginOpenerPolicyValue` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CrossOriginOpenerPolicyValue =
  | "SameOrigin"
  | "SameOriginAllowPopups"
  | "RestrictProperties"
  | "UnsafeNone"
  | "SameOriginPlusCoep"
  | "RestrictPropertiesPlusCoep"
  | "NoopenerAllowPopups"
  | (string & {})

/**
 * Schema for `CrossOriginOpenerPolicyValue`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CrossOriginOpenerPolicyValue = Schema.String as any as Schema.Codec<CrossOriginOpenerPolicyValue>

/**
 * A device bound session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSession {
  /**
   * The site and session ID of the session.
   */
  readonly key: DeviceBoundSessionKey
  /**
   * See comments on `net::device_bound_sessions::Session::refresh_url_`.
   */
  readonly refreshUrl: string
  /**
   * See comments on `net::device_bound_sessions::Session::inclusion_rules_`.
   */
  readonly inclusionRules: DeviceBoundSessionInclusionRules
  /**
   * See comments on `net::device_bound_sessions::Session::cookie_cravings_`.
   */
  readonly cookieCravings: ReadonlyArray<DeviceBoundSessionCookieCraving>
  /**
   * See comments on `net::device_bound_sessions::Session::expiry_date_`.
   */
  readonly expiryDate: TimeSinceEpoch
  /**
   * See comments on `net::device_bound_sessions::Session::cached_challenge__`.
   */
  readonly cachedChallenge?: string | undefined
  /**
   * See comments on `net::device_bound_sessions::Session::allowed_refresh_initiators_`.
   */
  readonly allowedRefreshInitiators: ReadonlyArray<string>
}

/**
 * Schema for `DeviceBoundSession`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSession = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: DeviceBoundSessionKey,
    refreshUrl: Schema.String,
    inclusionRules: DeviceBoundSessionInclusionRules,
    cookieCravings: Schema.Array(DeviceBoundSessionCookieCraving),
    expiryDate: TimeSinceEpoch,
    cachedChallenge: Schema.optional(Schema.String),
    allowedRefreshInitiators: Schema.Array(Schema.String)
  }).annotate({ identifier: "Network.DeviceBoundSession" })
) as any as Schema.Codec<DeviceBoundSession>

/**
 * A device bound session's cookie craving.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionCookieCraving {
  /**
   * The name of the craving.
   */
  readonly name: string
  /**
   * The domain of the craving.
   */
  readonly domain: string
  /**
   * The path of the craving.
   */
  readonly path: string
  /**
   * The `Secure` attribute of the craving attributes.
   */
  readonly secure: boolean
  /**
   * The `HttpOnly` attribute of the craving attributes.
   */
  readonly httpOnly: boolean
  /**
   * The `SameSite` attribute of the craving attributes.
   */
  readonly sameSite?: CookieSameSite | undefined
}

/**
 * Schema for `DeviceBoundSessionCookieCraving`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionCookieCraving = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    domain: Schema.String,
    path: Schema.String,
    secure: Schema.Boolean,
    httpOnly: Schema.Boolean,
    sameSite: Schema.optional(CookieSameSite)
  }).annotate({ identifier: "Network.DeviceBoundSessionCookieCraving" })
) as any as Schema.Codec<DeviceBoundSessionCookieCraving>

/**
 * A unique identifier for a device bound session event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DeviceBoundSessionEventId = Brand.Branded<
  string,
  "~@usestrider/browser/cdp/Network/DeviceBoundSessionEventId"
>

/**
 * Schema for `DeviceBoundSessionEventId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionEventId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Network/DeviceBoundSessionEventId")
) as any as Schema.Codec<DeviceBoundSessionEventId>

/**
 * Details about a failed device bound session network request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionFailedRequest {
  /**
   * The failed request URL.
   */
  readonly requestUrl: string
  /**
   * The net error of the response if it was not OK.
   */
  readonly netError?: string | undefined
  /**
   * The response code if the net error was OK and the response code was not
   * 200.
   */
  readonly responseError?: number | undefined
  /**
   * The body of the response if the net error was OK, the response code was
   * not 200, and the response body was not empty.
   */
  readonly responseErrorBody?: string | undefined
}

/**
 * Schema for `DeviceBoundSessionFailedRequest`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionFailedRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestUrl: Schema.String,
    netError: Schema.optional(Schema.String),
    responseError: Schema.optional(Schema.Int),
    responseErrorBody: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.DeviceBoundSessionFailedRequest" })
) as any as Schema.Codec<DeviceBoundSessionFailedRequest>

/**
 * A fetch result for a device bound session creation or refresh.
 * LINT.IfChange(DeviceBoundSessionFetchResult)
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DeviceBoundSessionFetchResult =
  | "Success"
  | "SigningKeyGenerationError"
  | "AttestationKeyGenerationError"
  | "SigningError"
  | "TransientSigningError"
  | "ServerRequestedTermination"
  | "InvalidSessionId"
  | "InvalidChallenge"
  | "TooManyChallenges"
  | "InvalidFetcherUrl"
  | "InvalidRefreshUrl"
  | "TransientHttpError"
  | "ScopeOriginSameSiteMismatch"
  | "RefreshUrlSameSiteMismatch"
  | "MismatchedSessionId"
  | "MissingScope"
  | "NoCredentials"
  | "SubdomainRegistrationWellKnownUnavailable"
  | "SubdomainRegistrationUnauthorized"
  | "SubdomainRegistrationWellKnownMalformed"
  | "SessionProviderWellKnownUnavailable"
  | "RelyingPartyWellKnownUnavailable"
  | "FederatedKeyThumbprintMismatch"
  | "InvalidFederatedSessionUrl"
  | "InvalidFederatedKey"
  | "TooManyRelyingOriginLabels"
  | "BoundCookieSetForbidden"
  | "NetError"
  | "ProxyError"
  | "EmptySessionConfig"
  | "InvalidCredentialsConfig"
  | "InvalidCredentialsType"
  | "InvalidCredentialsEmptyName"
  | "InvalidCredentialsCookie"
  | "PersistentHttpError"
  | "RegistrationAttemptedChallenge"
  | "InvalidScopeOrigin"
  | "ScopeOriginContainsPath"
  | "RefreshInitiatorNotString"
  | "RefreshInitiatorInvalidHostPattern"
  | "InvalidScopeSpecification"
  | "MissingScopeSpecificationType"
  | "EmptyScopeSpecificationDomain"
  | "EmptyScopeSpecificationPath"
  | "InvalidScopeSpecificationType"
  | "InvalidScopeIncludeSite"
  | "MissingScopeIncludeSite"
  | "FederatedNotAuthorizedByProvider"
  | "FederatedNotAuthorizedByRelyingParty"
  | "SessionProviderWellKnownMalformed"
  | "SessionProviderWellKnownHasProviderOrigin"
  | "RelyingPartyWellKnownMalformed"
  | "RelyingPartyWellKnownHasRelyingOrigins"
  | "InvalidFederatedSessionProviderSessionMissing"
  | "InvalidFederatedSessionWrongProviderOrigin"
  | "InvalidCredentialsCookieCreationTime"
  | "InvalidCredentialsCookieName"
  | "InvalidCredentialsCookieParsing"
  | "InvalidCredentialsCookieUnpermittedAttribute"
  | "InvalidCredentialsCookieInvalidDomain"
  | "InvalidCredentialsCookiePrefix"
  | "InvalidScopeRulePath"
  | "InvalidScopeRuleHostPattern"
  | "ScopeRuleOriginScopedHostPatternMismatch"
  | "ScopeRuleSiteScopedHostPatternMismatch"
  | "SigningQuotaExceeded"
  | "InvalidConfigJson"
  | "InvalidFederatedSessionProviderFailedToRestoreKey"
  | "FailedToUnwrapKey"
  | "SessionDeletedDuringRefresh"
  | "CrossOriginRegistrationSiteNotIncluded"
  | "InvalidPreProvisionedKeyInitiatorMissing"
  | "PreProvisionedKeyAccessNotGranted"
  | "PreProvisionedKeyNotFound"
  | "AttestationCertificationError"
  | "AttestationSigningError"
  | (string & {})

/**
 * Schema for `DeviceBoundSessionFetchResult`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionFetchResult = Schema.String as any as Schema.Codec<DeviceBoundSessionFetchResult>

/**
 * A device bound session's inclusion rules.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionInclusionRules {
  /**
   * See comments on `net::device_bound_sessions::SessionInclusionRules::origin_`.
   */
  readonly origin: string
  /**
   * Whether the whole site is included. See comments on
   * `net::device_bound_sessions::SessionInclusionRules::include_site_` for more
   * details; this boolean is true if that value is populated.
   */
  readonly includeSite: boolean
  /**
   * See comments on `net::device_bound_sessions::SessionInclusionRules::url_rules_`.
   */
  readonly urlRules: ReadonlyArray<DeviceBoundSessionUrlRule>
}

/**
 * Schema for `DeviceBoundSessionInclusionRules`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionInclusionRules = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    includeSite: Schema.Boolean,
    urlRules: Schema.Array(DeviceBoundSessionUrlRule)
  }).annotate({ identifier: "Network.DeviceBoundSessionInclusionRules" })
) as any as Schema.Codec<DeviceBoundSessionInclusionRules>

/**
 * Unique identifier for a device bound session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionKey {
  /**
   * The site the session is set up for.
   */
  readonly site: string
  /**
   * The id of the session.
   */
  readonly id: string
}

/**
 * Schema for `DeviceBoundSessionKey`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionKey = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    site: Schema.String,
    id: Schema.String
  }).annotate({ identifier: "Network.DeviceBoundSessionKey" })
) as any as Schema.Codec<DeviceBoundSessionKey>

/**
 * A device bound session's inclusion URL rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionUrlRule {
  /**
   * See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::rule_type`.
   */
  readonly ruleType: DeviceBoundSessionUrlRuleRuleType
  /**
   * See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::host_pattern`.
   */
  readonly hostPattern: string
  /**
   * See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::path_prefix`.
   */
  readonly pathPrefix: string
}

/**
 * Schema for `DeviceBoundSessionUrlRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionUrlRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleType: DeviceBoundSessionUrlRuleRuleType,
    hostPattern: Schema.String,
    pathPrefix: Schema.String
  }).annotate({ identifier: "Network.DeviceBoundSessionUrlRule" })
) as any as Schema.Codec<DeviceBoundSessionUrlRule>

/**
 * See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::rule_type`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DeviceBoundSessionUrlRuleRuleType =
  | "Exclude"
  | "Include"
  | (string & {})

/**
 * Schema for `DeviceBoundSessionUrlRuleRuleType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionUrlRuleRuleType = Schema.String as any as Schema.Codec<DeviceBoundSessionUrlRuleRuleType>

/**
 * How a device bound session was used during a request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionWithUsage {
  /**
   * The key for the session.
   */
  readonly sessionKey: DeviceBoundSessionKey
  /**
   * How the session was used (or not used).
   */
  readonly usage: DeviceBoundSessionWithUsageUsage
}

/**
 * Schema for `DeviceBoundSessionWithUsage`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionWithUsage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionKey: DeviceBoundSessionKey,
    usage: DeviceBoundSessionWithUsageUsage
  }).annotate({ identifier: "Network.DeviceBoundSessionWithUsage" })
) as any as Schema.Codec<DeviceBoundSessionWithUsage>

/**
 * How the session was used (or not used).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DeviceBoundSessionWithUsageUsage =
  | "NotInScope"
  | "InScopeRefreshNotYetNeeded"
  | "InScopeRefreshNotAllowed"
  | "ProactiveRefreshNotPossible"
  | "ProactiveRefreshAttempted"
  | "Deferred"
  | (string & {})

/**
 * Schema for `DeviceBoundSessionWithUsageUsage`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionWithUsageUsage = Schema.String as any as Schema.Codec<DeviceBoundSessionWithUsageUsage>

/**
 * `DirectSocketDnsQueryType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DirectSocketDnsQueryType =
  | "ipv4"
  | "ipv6"
  | (string & {})

/**
 * Schema for `DirectSocketDnsQueryType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectSocketDnsQueryType = Schema.String as any as Schema.Codec<DirectSocketDnsQueryType>

/**
 * `DirectTCPSocketOptions`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketOptions {
  /**
   * TCP_NODELAY option
   */
  readonly noDelay: boolean
  /**
   * Expected to be unsigned integer.
   */
  readonly keepAliveDelay?: number | undefined
  /**
   * Expected to be unsigned integer.
   */
  readonly sendBufferSize?: number | undefined
  /**
   * Expected to be unsigned integer.
   */
  readonly receiveBufferSize?: number | undefined
  readonly dnsQueryType?: DirectSocketDnsQueryType | undefined
}

/**
 * Schema for `DirectTCPSocketOptions`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketOptions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    noDelay: Schema.Boolean,
    keepAliveDelay: Schema.optional(Schema.Number),
    sendBufferSize: Schema.optional(Schema.Number),
    receiveBufferSize: Schema.optional(Schema.Number),
    dnsQueryType: Schema.optional(DirectSocketDnsQueryType)
  }).annotate({ identifier: "Network.DirectTCPSocketOptions" })
) as any as Schema.Codec<DirectTCPSocketOptions>

/**
 * `DirectUDPMessage`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPMessage {
  readonly data: string
  /**
   * Null for connected mode.
   */
  readonly remoteAddr?: string | undefined
  /**
   * Null for connected mode.
   * Expected to be unsigned integer.
   */
  readonly remotePort?: number | undefined
}

/**
 * Schema for `DirectUDPMessage`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPMessage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String,
    remoteAddr: Schema.optional(Schema.String),
    remotePort: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Network.DirectUDPMessage" })
) as any as Schema.Codec<DirectUDPMessage>

/**
 * `DirectUDPSocketOptions`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketOptions {
  readonly remoteAddr?: string | undefined
  /**
   * Unsigned int 16.
   */
  readonly remotePort?: number | undefined
  readonly localAddr?: string | undefined
  /**
   * Unsigned int 16.
   */
  readonly localPort?: number | undefined
  readonly dnsQueryType?: DirectSocketDnsQueryType | undefined
  /**
   * Expected to be unsigned integer.
   */
  readonly sendBufferSize?: number | undefined
  /**
   * Expected to be unsigned integer.
   */
  readonly receiveBufferSize?: number | undefined
  readonly multicastLoopback?: boolean | undefined
  /**
   * Unsigned int 8.
   */
  readonly multicastTimeToLive?: number | undefined
  readonly multicastAllowAddressSharing?: boolean | undefined
}

/**
 * Schema for `DirectUDPSocketOptions`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketOptions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    remoteAddr: Schema.optional(Schema.String),
    remotePort: Schema.optional(Schema.Int),
    localAddr: Schema.optional(Schema.String),
    localPort: Schema.optional(Schema.Int),
    dnsQueryType: Schema.optional(DirectSocketDnsQueryType),
    sendBufferSize: Schema.optional(Schema.Number),
    receiveBufferSize: Schema.optional(Schema.Number),
    multicastLoopback: Schema.optional(Schema.Boolean),
    multicastTimeToLive: Schema.optional(Schema.Int),
    multicastAllowAddressSharing: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.DirectUDPSocketOptions" })
) as any as Schema.Codec<DirectUDPSocketOptions>

/**
 * Network level fetch failure reason.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ErrorReason =
  | "Failed"
  | "Aborted"
  | "TimedOut"
  | "AccessDenied"
  | "ConnectionClosed"
  | "ConnectionReset"
  | "ConnectionRefused"
  | "ConnectionAborted"
  | "ConnectionFailed"
  | "NameNotResolved"
  | "InternetDisconnected"
  | "AddressUnreachable"
  | "BlockedByClient"
  | "BlockedByResponse"
  | (string & {})

/**
 * Schema for `ErrorReason`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ErrorReason = Schema.String as any as Schema.Codec<ErrorReason>

/**
 * A cookie should have been blocked by 3PCD but is exempted and stored from a response with the
 * corresponding reason. A cookie could only have at most one exemption reason.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ExemptedSetCookieWithReason {
  /**
   * The reason the cookie was exempted.
   */
  readonly exemptionReason: CookieExemptionReason
  /**
   * The string representing this individual cookie as it would appear in the header.
   */
  readonly cookieLine: string
  /**
   * The cookie object representing the cookie.
   */
  readonly cookie: Cookie
}

/**
 * Schema for `ExemptedSetCookieWithReason`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ExemptedSetCookieWithReason = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    exemptionReason: CookieExemptionReason,
    cookieLine: Schema.String,
    cookie: Cookie
  }).annotate({ identifier: "Network.ExemptedSetCookieWithReason" })
) as any as Schema.Codec<ExemptedSetCookieWithReason, unknown>

/**
 * Request / response headers as keys / values of JSON object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Headers = { readonly [key: string]: unknown }

/**
 * Schema for `Headers`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Headers = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<Headers>

/**
 * `IPAddressSpace` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type IPAddressSpace =
  | "Loopback"
  | "Local"
  | "Public"
  | "Unknown"
  | (string & {})

/**
 * Schema for `IPAddressSpace`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IPAddressSpace = Schema.String as any as Schema.Codec<IPAddressSpace>

/**
 * Information about the request initiator.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Initiator {
  /**
   * Type of this initiator.
   */
  readonly type: InitiatorType
  /**
   * Initiator JavaScript stack trace, set for Script only.
   * Requires the Debugger domain to be enabled.
   */
  readonly stack?: Runtime.StackTrace | undefined
  /**
   * Initiator URL, set for Parser type or for Script type (when script is importing module) or for SignedExchange type.
   */
  readonly url?: string | undefined
  /**
   * Initiator line number, set for Parser type or for Script type (when script is importing
   * module) (0-based).
   */
  readonly lineNumber?: number | undefined
  /**
   * Initiator column number, set for Parser type or for Script type (when script is importing
   * module) (0-based).
   */
  readonly columnNumber?: number | undefined
  /**
   * Set if another request triggered this request (e.g. preflight).
   */
  readonly requestId?: RequestId | undefined
}

/**
 * Schema for `Initiator`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Initiator = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: InitiatorType,
    stack: Schema.optional(Runtime.StackTrace),
    url: Schema.optional(Schema.String),
    lineNumber: Schema.optional(Schema.Number),
    columnNumber: Schema.optional(Schema.Number),
    requestId: Schema.optional(RequestId)
  }).annotate({ identifier: "Network.Initiator" })
) as any as Schema.Codec<Initiator, unknown>

/**
 * Type of this initiator.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InitiatorType =
  | "parser"
  | "script"
  | "preload"
  | "SignedExchange"
  | "preflight"
  | "FedCM"
  | "other"
  | (string & {})

/**
 * Schema for `InitiatorType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InitiatorType = Schema.String as any as Schema.Codec<InitiatorType>

/**
 * An options object that may be extended later to better support CORS,
 * CORB and streaming.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadNetworkResourceOptions {
  readonly disableCache: boolean
  readonly includeCredentials: boolean
}

/**
 * Schema for `LoadNetworkResourceOptions`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadNetworkResourceOptions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    disableCache: Schema.Boolean,
    includeCredentials: Schema.Boolean
  }).annotate({ identifier: "Network.LoadNetworkResourceOptions" })
) as any as Schema.Codec<LoadNetworkResourceOptions>

/**
 * An object providing the result of a network resource load.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadNetworkResourcePageResult {
  readonly success: boolean
  /**
   * Optional values used for error reporting.
   */
  readonly netError?: number | undefined
  readonly netErrorName?: string | undefined
  readonly httpStatusCode?: number | undefined
  /**
   * If successful, one of the following two fields holds the result.
   */
  readonly stream?: IO.StreamHandle | undefined
  /**
   * Response headers.
   */
  readonly headers?: Headers | undefined
}

/**
 * Schema for `LoadNetworkResourcePageResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadNetworkResourcePageResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    success: Schema.Boolean,
    netError: Schema.optional(Schema.Number),
    netErrorName: Schema.optional(Schema.String),
    httpStatusCode: Schema.optional(Schema.Number),
    stream: Schema.optional(IO.StreamHandle),
    headers: Schema.optional(Headers)
  }).annotate({ identifier: "Network.LoadNetworkResourcePageResult" })
) as any as Schema.Codec<LoadNetworkResourcePageResult>

/**
 * Unique loader identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LoaderId = Brand.Branded<string, "~@usestrider/browser/cdp/Network/LoaderId">

/**
 * Schema for `LoaderId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoaderId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Network/LoaderId")
) as any as Schema.Codec<LoaderId>

/**
 * `LocalNetworkAccessRequestPolicy` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type LocalNetworkAccessRequestPolicy =
  | "Allow"
  | "BlockFromInsecureToMorePrivate"
  | "WarnFromInsecureToMorePrivate"
  | "PermissionBlock"
  | "PermissionWarn"
  | (string & {})

/**
 * Schema for `LocalNetworkAccessRequestPolicy`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LocalNetworkAccessRequestPolicy = Schema.String as any as Schema.Codec<LocalNetworkAccessRequestPolicy>

/**
 * Monotonically increasing time in seconds since an arbitrary point in the past.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MonotonicTime = number

/**
 * Schema for `MonotonicTime`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MonotonicTime = Schema.Number as any as Schema.Codec<MonotonicTime>

/**
 * `NetworkConditions`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NetworkConditions {
  /**
   * Only matching requests will be affected by these conditions. Patterns use the URLPattern constructor string
   * syntax (https://urlpattern.spec.whatwg.org/) and must be absolute. If the pattern is empty, all requests are
   * matched (including p2p connections).
   */
  readonly urlPattern: string
  /**
   * Minimum latency from request sent to response headers received (ms).
   */
  readonly latency: number
  /**
   * Maximal aggregated download throughput (bytes/sec). -1 disables download throttling.
   */
  readonly downloadThroughput: number
  /**
   * Maximal aggregated upload throughput (bytes/sec).  -1 disables upload throttling.
   */
  readonly uploadThroughput: number
  /**
   * Connection type if known.
   */
  readonly connectionType?: ConnectionType | undefined
  /**
   * WebRTC packet loss (percent, 0-100). 0 disables packet loss emulation, 100 drops all the packets.
   */
  readonly packetLoss?: number | undefined
  /**
   * WebRTC packet queue length (packet). 0 removes any queue length limitations.
   */
  readonly packetQueueLength?: number | undefined
  /**
   * WebRTC packetReordering feature.
   */
  readonly packetReordering?: boolean | undefined
  /**
   * True to emulate internet disconnection.
   */
  readonly offline?: boolean | undefined
}

/**
 * Schema for `NetworkConditions`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NetworkConditions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    urlPattern: Schema.String,
    latency: Schema.Number,
    downloadThroughput: Schema.Number,
    uploadThroughput: Schema.Number,
    connectionType: Schema.optional(ConnectionType),
    packetLoss: Schema.optional(Schema.Number),
    packetQueueLength: Schema.optional(Schema.Int),
    packetReordering: Schema.optional(Schema.Boolean),
    offline: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.NetworkConditions" })
) as any as Schema.Codec<NetworkConditions>

/**
 * Post data entry for HTTP request
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PostDataEntry {
  readonly bytes?: string | undefined
}

/**
 * Schema for `PostDataEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PostDataEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bytes: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.PostDataEntry" })
) as any as Schema.Codec<PostDataEntry>

/**
 * Session event details specific to refresh.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RefreshEventDetails {
  /**
   * The result of a refresh.
   * LINT.IfChange(DeviceBoundSessionRefreshResult)
   */
  readonly refreshResult: RefreshEventDetailsRefreshResult
  /**
   * LINT.ThenChange(//net/device_bound_sessions/refresh_result.h:DeviceBoundSessionRefreshResult,//content/browser/devtools/protocol/network_handler.cc:DeviceBoundSessionRefreshResult)
   * If there was a fetch attempt, the result of that.
   */
  readonly fetchResult?: DeviceBoundSessionFetchResult | undefined
  /**
   * The session display if there was a newly created session. This is populated
   * for any refresh event that modifies the session config.
   */
  readonly newSession?: DeviceBoundSession | undefined
  /**
   * See comments on `net::device_bound_sessions::RefreshEventResult::was_fully_proactive_refresh`.
   */
  readonly wasFullyProactiveRefresh: boolean
  /**
   * Details about a failed device bound session network request if there was
   * one.
   */
  readonly failedRequest?: DeviceBoundSessionFailedRequest | undefined
}

/**
 * Schema for `RefreshEventDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RefreshEventDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    refreshResult: RefreshEventDetailsRefreshResult,
    fetchResult: Schema.optional(DeviceBoundSessionFetchResult),
    newSession: Schema.optional(DeviceBoundSession),
    wasFullyProactiveRefresh: Schema.Boolean,
    failedRequest: Schema.optional(DeviceBoundSessionFailedRequest)
  }).annotate({ identifier: "Network.RefreshEventDetails" })
) as any as Schema.Codec<RefreshEventDetails>

/**
 * The result of a refresh.
 * LINT.IfChange(DeviceBoundSessionRefreshResult)
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RefreshEventDetailsRefreshResult =
  | "Refreshed"
  | "InitializedService"
  | "Unreachable"
  | "ServerError"
  | "FatalError"
  | "SigningQuotaExceeded"
  | "RefreshedAsWaiter"
  | "TransientSigningError"
  | "InScopeRefreshNotYetNeeded"
  | (string & {})

/**
 * Schema for `RefreshEventDetailsRefreshResult`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RefreshEventDetailsRefreshResult = Schema.String as any as Schema.Codec<RefreshEventDetailsRefreshResult>

/**
 * The render-blocking behavior of a resource request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RenderBlockingBehavior =
  | "Blocking"
  | "InBodyParserBlocking"
  | "NonBlocking"
  | "NonBlockingDynamic"
  | "PotentiallyBlocking"
  | (string & {})

/**
 * Schema for `RenderBlockingBehavior`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RenderBlockingBehavior = Schema.String as any as Schema.Codec<RenderBlockingBehavior>

/**
 * `ReportId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ReportId = Brand.Branded<string, "~@usestrider/browser/cdp/Network/ReportId">

/**
 * Schema for `ReportId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Network/ReportId")
) as any as Schema.Codec<ReportId>

/**
 * The status of a Reporting API report.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ReportStatus =
  | "Queued"
  | "Pending"
  | "MarkedForRemoval"
  | "Success"
  | (string & {})

/**
 * Schema for `ReportStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportStatus = Schema.String as any as Schema.Codec<ReportStatus>

/**
 * `ReportingApiEndpoint`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportingApiEndpoint {
  /**
   * The URL of the endpoint to which reports may be delivered.
   */
  readonly url: string
  /**
   * Name of the endpoint group.
   */
  readonly groupName: string
}

/**
 * Schema for `ReportingApiEndpoint`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportingApiEndpoint = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    groupName: Schema.String
  }).annotate({ identifier: "Network.ReportingApiEndpoint" })
) as any as Schema.Codec<ReportingApiEndpoint>

/**
 * An object representing a report generated by the Reporting API.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportingApiReport {
  readonly id: ReportId
  /**
   * The URL of the document that triggered the report.
   */
  readonly initiatorUrl: string
  /**
   * The name of the endpoint group that should be used to deliver the report.
   */
  readonly destination: string
  /**
   * The type of the report (specifies the set of data that is contained in the report body).
   */
  readonly type: string
  /**
   * When the report was generated.
   */
  readonly timestamp: TimeSinceEpoch
  /**
   * How many uploads deep the related request was.
   */
  readonly depth: number
  /**
   * The number of delivery attempts made so far, not including an active attempt.
   */
  readonly completedAttempts: number
  readonly body: { readonly [key: string]: unknown }
  readonly status: ReportStatus
}

/**
 * Schema for `ReportingApiReport`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportingApiReport = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: ReportId,
    initiatorUrl: Schema.String,
    destination: Schema.String,
    type: Schema.String,
    timestamp: TimeSinceEpoch,
    depth: Schema.Int,
    completedAttempts: Schema.Int,
    body: Schema.Record(Schema.String, Schema.Unknown),
    status: ReportStatus
  }).annotate({ identifier: "Network.ReportingApiReport" })
) as any as Schema.Codec<ReportingApiReport>

/**
 * HTTP request data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Request {
  /**
   * Request URL (without fragment).
   */
  readonly url: string
  /**
   * Fragment of the requested URL starting with hash, if present.
   */
  readonly urlFragment?: string | undefined
  /**
   * HTTP request method.
   */
  readonly method: string
  /**
   * HTTP request headers.
   */
  readonly headers: Headers
  /**
   * True when the request has POST data. Note that postData might still be omitted when this flag is true when the data is too long.
   */
  readonly hasPostData?: boolean | undefined
  /**
   * Request body elements (post data broken into individual entries).
   */
  readonly postDataEntries?: ReadonlyArray<PostDataEntry> | undefined
  /**
   * The mixed content type of the request.
   */
  readonly mixedContentType?: Security.MixedContentType | undefined
  /**
   * Priority of the resource request at the time request is sent.
   */
  readonly initialPriority: ResourcePriority
  /**
   * The referrer policy of the request, as defined in https://www.w3.org/TR/referrer-policy/
   */
  readonly referrerPolicy: RequestReferrerPolicy
  /**
   * Whether is loaded via link preload.
   */
  readonly isLinkPreload?: boolean | undefined
  /**
   * Set for requests when the TrustToken API is used. Contains the parameters
   * passed by the developer (e.g. via "fetch") as understood by the backend.
   */
  readonly trustTokenParams?: TrustTokenParams | undefined
  /**
   * True if this resource request is considered to be the 'same site' as the
   * request corresponding to the main frame.
   */
  readonly isSameSite?: boolean | undefined
  /**
   * True when the resource request is ad-related.
   */
  readonly isAdRelated?: boolean | undefined
}

/**
 * Schema for `Request`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Request = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    urlFragment: Schema.optional(Schema.String),
    method: Schema.String,
    headers: Headers,
    hasPostData: Schema.optional(Schema.Boolean),
    postDataEntries: Schema.optional(Schema.Array(PostDataEntry)),
    mixedContentType: Schema.optional(Security.MixedContentType),
    initialPriority: ResourcePriority,
    referrerPolicy: RequestReferrerPolicy,
    isLinkPreload: Schema.optional(Schema.Boolean),
    trustTokenParams: Schema.optional(TrustTokenParams),
    isSameSite: Schema.optional(Schema.Boolean),
    isAdRelated: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.Request" })
) as any as Schema.Codec<Request>

/**
 * The referrer policy of the request, as defined in https://www.w3.org/TR/referrer-policy/
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RequestReferrerPolicy =
  | "unsafe-url"
  | "no-referrer-when-downgrade"
  | "no-referrer"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | (string & {})

/**
 * Schema for `RequestReferrerPolicy`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestReferrerPolicy = Schema.String as any as Schema.Codec<RequestReferrerPolicy>

/**
 * Unique network request identifier.
 * Note that this does not identify individual HTTP requests that are part of
 * a network request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RequestId = Brand.Branded<string, "~@usestrider/browser/cdp/Network/RequestId">

/**
 * Schema for `RequestId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Network/RequestId")
) as any as Schema.Codec<RequestId>

/**
 * Loading priority of a resource request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResourcePriority =
  | "VeryLow"
  | "Low"
  | "Medium"
  | "High"
  | "VeryHigh"
  | (string & {})

/**
 * Schema for `ResourcePriority`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResourcePriority = Schema.String as any as Schema.Codec<ResourcePriority>

/**
 * Timing information for the request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResourceTiming {
  /**
   * Timing's requestTime is a baseline in seconds, while the other numbers are ticks in
   * milliseconds relatively to this requestTime.
   */
  readonly requestTime: number
  /**
   * Started resolving proxy.
   */
  readonly proxyStart: number
  /**
   * Finished resolving proxy.
   */
  readonly proxyEnd: number
  /**
   * Started DNS address resolve.
   */
  readonly dnsStart: number
  /**
   * Finished DNS address resolve.
   */
  readonly dnsEnd: number
  /**
   * Started connecting to the remote host.
   */
  readonly connectStart: number
  /**
   * Connected to the remote host.
   */
  readonly connectEnd: number
  /**
   * Started SSL handshake.
   */
  readonly sslStart: number
  /**
   * Finished SSL handshake.
   */
  readonly sslEnd: number
  /**
   * Started running ServiceWorker.
   */
  readonly workerStart?: number | undefined
  /**
   * Finished Starting ServiceWorker.
   */
  readonly workerReady?: number | undefined
  /**
   * Started fetch event.
   */
  readonly workerFetchStart?: number | undefined
  /**
   * Settled fetch event respondWith promise.
   */
  readonly workerRespondWithSettled?: number | undefined
  /**
   * Started ServiceWorker static routing source evaluation.
   */
  readonly workerRouterEvaluationStart?: number | undefined
  /**
   * Started cache lookup when the source was evaluated to `cache`.
   */
  readonly workerCacheLookupStart?: number | undefined
  /**
   * Started sending request.
   */
  readonly sendStart: number
  /**
   * Finished sending request.
   */
  readonly sendEnd: number
  /**
   * Time the server started pushing request.
   */
  readonly pushStart?: number | undefined
  /**
   * Time the server finished pushing request.
   */
  readonly pushEnd?: number | undefined
  /**
   * Started receiving response headers.
   */
  readonly receiveHeadersStart?: number | undefined
  /**
   * Finished receiving response headers.
   */
  readonly receiveHeadersEnd: number
}

/**
 * Schema for `ResourceTiming`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResourceTiming = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestTime: Schema.Number,
    proxyStart: Schema.Number,
    proxyEnd: Schema.Number,
    dnsStart: Schema.Number,
    dnsEnd: Schema.Number,
    connectStart: Schema.Number,
    connectEnd: Schema.Number,
    sslStart: Schema.Number,
    sslEnd: Schema.Number,
    workerStart: Schema.optional(Schema.Number),
    workerReady: Schema.optional(Schema.Number),
    workerFetchStart: Schema.optional(Schema.Number),
    workerRespondWithSettled: Schema.optional(Schema.Number),
    workerRouterEvaluationStart: Schema.optional(Schema.Number),
    workerCacheLookupStart: Schema.optional(Schema.Number),
    sendStart: Schema.Number,
    sendEnd: Schema.Number,
    pushStart: Schema.optional(Schema.Number),
    pushEnd: Schema.optional(Schema.Number),
    receiveHeadersStart: Schema.optional(Schema.Number),
    receiveHeadersEnd: Schema.Number
  }).annotate({ identifier: "Network.ResourceTiming" })
) as any as Schema.Codec<ResourceTiming>

/**
 * Resource type as it was perceived by the rendering engine.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResourceType =
  | "Document"
  | "Stylesheet"
  | "Image"
  | "Media"
  | "Font"
  | "Script"
  | "TextTrack"
  | "XHR"
  | "Fetch"
  | "Prefetch"
  | "EventSource"
  | "WebSocket"
  | "Manifest"
  | "SignedExchange"
  | "Ping"
  | "CSPViolationReport"
  | "Preflight"
  | "FedCM"
  | "Other"
  | (string & {})

/**
 * Schema for `ResourceType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResourceType = Schema.String as any as Schema.Codec<ResourceType>

/**
 * HTTP response data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Response {
  /**
   * Response URL. This URL can be different from CachedResource.url in case of redirect.
   */
  readonly url: string
  /**
   * HTTP response status code.
   */
  readonly status: number
  /**
   * HTTP response status text.
   */
  readonly statusText: string
  /**
   * HTTP response headers.
   */
  readonly headers: Headers
  /**
   * Resource mimeType as determined by the browser.
   */
  readonly mimeType: string
  /**
   * Resource charset as determined by the browser (if applicable).
   */
  readonly charset: string
  /**
   * Refined HTTP request headers that were actually transmitted over the network.
   */
  readonly requestHeaders?: Headers | undefined
  /**
   * Specifies whether physical connection was actually reused for this request.
   */
  readonly connectionReused: boolean
  /**
   * Physical connection id that was actually used for this request.
   */
  readonly connectionId: number
  /**
   * Remote IP address.
   */
  readonly remoteIPAddress?: string | undefined
  /**
   * Remote port.
   */
  readonly remotePort?: number | undefined
  /**
   * Specifies that the request was served from the disk cache.
   */
  readonly fromDiskCache?: boolean | undefined
  /**
   * Specifies that the request was served from the ServiceWorker.
   */
  readonly fromServiceWorker?: boolean | undefined
  /**
   * Specifies that the request was served from the prefetch cache.
   */
  readonly fromPrefetchCache?: boolean | undefined
  /**
   * Specifies that the request was served from the prefetch cache.
   */
  readonly fromEarlyHints?: boolean | undefined
  /**
   * Information about how ServiceWorker Static Router API was used. If this
   * field is set with `matchedSourceType` field, a matching rule is found.
   * If this field is set without `matchedSource`, no matching rule is found.
   * Otherwise, the API is not used.
   */
  readonly serviceWorkerRouterInfo?: ServiceWorkerRouterInfo | undefined
  /**
   * Total number of bytes received for this request so far.
   */
  readonly encodedDataLength: number
  /**
   * Timing information for the given request.
   */
  readonly timing?: ResourceTiming | undefined
  /**
   * Response source of response from ServiceWorker.
   */
  readonly serviceWorkerResponseSource?: ServiceWorkerResponseSource | undefined
  /**
   * The time at which the returned response was generated.
   */
  readonly responseTime?: TimeSinceEpoch | undefined
  /**
   * Cache Storage Cache Name.
   */
  readonly cacheStorageCacheName?: string | undefined
  /**
   * Protocol used to fetch this request.
   */
  readonly protocol?: string | undefined
  /**
   * The reason why Chrome uses a specific transport protocol for HTTP semantics.
   */
  readonly alternateProtocolUsage?: AlternateProtocolUsage | undefined
  /**
   * Security state of the request resource.
   */
  readonly securityState: Security.SecurityState
  /**
   * Security details for the request.
   */
  readonly securityDetails?: SecurityDetails | undefined
}

/**
 * Schema for `Response`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Response = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    status: Schema.Int,
    statusText: Schema.String,
    headers: Headers,
    mimeType: Schema.String,
    charset: Schema.String,
    requestHeaders: Schema.optional(Headers),
    connectionReused: Schema.Boolean,
    connectionId: Schema.Number,
    remoteIPAddress: Schema.optional(Schema.String),
    remotePort: Schema.optional(Schema.Int),
    fromDiskCache: Schema.optional(Schema.Boolean),
    fromServiceWorker: Schema.optional(Schema.Boolean),
    fromPrefetchCache: Schema.optional(Schema.Boolean),
    fromEarlyHints: Schema.optional(Schema.Boolean),
    serviceWorkerRouterInfo: Schema.optional(ServiceWorkerRouterInfo),
    encodedDataLength: Schema.Number,
    timing: Schema.optional(ResourceTiming),
    serviceWorkerResponseSource: Schema.optional(ServiceWorkerResponseSource),
    responseTime: Schema.optional(TimeSinceEpoch),
    cacheStorageCacheName: Schema.optional(Schema.String),
    protocol: Schema.optional(Schema.String),
    alternateProtocolUsage: Schema.optional(AlternateProtocolUsage),
    securityState: Security.SecurityState,
    securityDetails: Schema.optional(SecurityDetails)
  }).annotate({ identifier: "Network.Response" })
) as any as Schema.Codec<Response>

/**
 * Security details about a request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SecurityDetails {
  /**
   * Protocol name (e.g. "TLS 1.2" or "QUIC").
   */
  readonly protocol: string
  /**
   * Key Exchange used by the connection, or the empty string if not applicable.
   */
  readonly keyExchange: string
  /**
   * (EC)DH group used by the connection, if applicable.
   */
  readonly keyExchangeGroup?: string | undefined
  /**
   * Cipher name.
   */
  readonly cipher: string
  /**
   * TLS MAC. Note that AEAD ciphers do not have separate MACs.
   */
  readonly mac?: string | undefined
  /**
   * Certificate ID value.
   */
  readonly certificateId: Security.CertificateId
  /**
   * Certificate subject name.
   */
  readonly subjectName: string
  /**
   * Subject Alternative Name (SAN) DNS names and IP addresses.
   */
  readonly sanList: ReadonlyArray<string>
  /**
   * Name of the issuing CA.
   */
  readonly issuer: string
  /**
   * Certificate valid from date.
   */
  readonly validFrom: TimeSinceEpoch
  /**
   * Certificate valid to (expiration) date
   */
  readonly validTo: TimeSinceEpoch
  /**
   * List of signed certificate timestamps (SCTs).
   */
  readonly signedCertificateTimestampList: ReadonlyArray<SignedCertificateTimestamp>
  /**
   * Whether the request complied with Certificate Transparency policy
   */
  readonly certificateTransparencyCompliance: CertificateTransparencyCompliance
  /**
   * The signature algorithm used by the server in the TLS server signature,
   * represented as a TLS SignatureScheme code point. Omitted if not
   * applicable or not known.
   */
  readonly serverSignatureAlgorithm?: number | undefined
  /**
   * Whether the connection used Encrypted ClientHello
   */
  readonly encryptedClientHello: boolean
}

/**
 * Schema for `SecurityDetails`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SecurityDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: Schema.String,
    keyExchange: Schema.String,
    keyExchangeGroup: Schema.optional(Schema.String),
    cipher: Schema.String,
    mac: Schema.optional(Schema.String),
    certificateId: Security.CertificateId,
    subjectName: Schema.String,
    sanList: Schema.Array(Schema.String),
    issuer: Schema.String,
    validFrom: TimeSinceEpoch,
    validTo: TimeSinceEpoch,
    signedCertificateTimestampList: Schema.Array(SignedCertificateTimestamp),
    certificateTransparencyCompliance: CertificateTransparencyCompliance,
    serverSignatureAlgorithm: Schema.optional(Schema.Int),
    encryptedClientHello: Schema.Boolean
  }).annotate({ identifier: "Network.SecurityDetails" })
) as any as Schema.Codec<SecurityDetails>

/**
 * `SecurityIsolationStatus`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SecurityIsolationStatus {
  readonly coop?: CrossOriginOpenerPolicyStatus | undefined
  readonly coep?: CrossOriginEmbedderPolicyStatus | undefined
  readonly csp?: ReadonlyArray<ContentSecurityPolicyStatus> | undefined
}

/**
 * Schema for `SecurityIsolationStatus`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SecurityIsolationStatus = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    coop: Schema.optional(CrossOriginOpenerPolicyStatus),
    coep: Schema.optional(CrossOriginEmbedderPolicyStatus),
    csp: Schema.optional(Schema.Array(ContentSecurityPolicyStatus))
  }).annotate({ identifier: "Network.SecurityIsolationStatus" })
) as any as Schema.Codec<SecurityIsolationStatus>

/**
 * Source of serviceworker response.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ServiceWorkerResponseSource =
  | "cache-storage"
  | "http-cache"
  | "fallback-code"
  | "network"
  | (string & {})

/**
 * Schema for `ServiceWorkerResponseSource`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerResponseSource = Schema.String as any as Schema.Codec<ServiceWorkerResponseSource>

/**
 * `ServiceWorkerRouterInfo`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRouterInfo {
  /**
   * ID of the rule matched. If there is a matched rule, this field will
   * be set, otherwiser no value will be set.
   */
  readonly ruleIdMatched?: number | undefined
  /**
   * The router source of the matched rule. If there is a matched rule, this
   * field will be set, otherwise no value will be set.
   */
  readonly matchedSourceType?: ServiceWorkerRouterSource | undefined
  /**
   * The actual router source used.
   */
  readonly actualSourceType?: ServiceWorkerRouterSource | undefined
}

/**
 * Schema for `ServiceWorkerRouterInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleIdMatched: Schema.optional(Schema.Int),
    matchedSourceType: Schema.optional(ServiceWorkerRouterSource),
    actualSourceType: Schema.optional(ServiceWorkerRouterSource)
  }).annotate({ identifier: "Network.ServiceWorkerRouterInfo" })
) as any as Schema.Codec<ServiceWorkerRouterInfo>

/**
 * Source of service worker router.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ServiceWorkerRouterSource =
  | "network"
  | "cache"
  | "fetch-event"
  | "race-network-and-fetch-handler"
  | "race-network-and-cache"
  | (string & {})

/**
 * Schema for `ServiceWorkerRouterSource`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterSource = Schema.String as any as Schema.Codec<ServiceWorkerRouterSource>

/**
 * Types of reasons why a cookie may not be stored from a response.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SetCookieBlockedReason =
  | "SecureOnly"
  | "SameSiteStrict"
  | "SameSiteLax"
  | "SameSiteUnspecifiedTreatedAsLax"
  | "SameSiteNoneInsecure"
  | "UserPreferences"
  | "ThirdPartyPhaseout"
  | "ThirdPartyBlockedInFirstPartySet"
  | "SyntaxError"
  | "SchemeNotSupported"
  | "OverwriteSecure"
  | "InvalidDomain"
  | "InvalidPrefix"
  | "UnknownError"
  | "SchemefulSameSiteStrict"
  | "SchemefulSameSiteLax"
  | "SchemefulSameSiteUnspecifiedTreatedAsLax"
  | "NameValuePairExceedsMaxSize"
  | "DisallowedCharacter"
  | "NoCookieContent"
  | (string & {})

/**
 * Schema for `SetCookieBlockedReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieBlockedReason = Schema.String as any as Schema.Codec<SetCookieBlockedReason>

/**
 * Details of a signed certificate timestamp (SCT).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SignedCertificateTimestamp {
  /**
   * Validation status.
   */
  readonly status: string
  /**
   * Origin.
   */
  readonly origin: string
  /**
   * Log name / description.
   */
  readonly logDescription: string
  /**
   * Log ID.
   */
  readonly logId: string
  /**
   * Issuance date. Unlike TimeSinceEpoch, this contains the number of
   * milliseconds since January 1, 1970, UTC, not the number of seconds.
   */
  readonly timestamp: number
  /**
   * Hash algorithm.
   */
  readonly hashAlgorithm: string
  /**
   * Signature algorithm.
   */
  readonly signatureAlgorithm: string
  /**
   * Signature data.
   */
  readonly signatureData: string
}

/**
 * Schema for `SignedCertificateTimestamp`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SignedCertificateTimestamp = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    status: Schema.String,
    origin: Schema.String,
    logDescription: Schema.String,
    logId: Schema.String,
    timestamp: Schema.Number,
    hashAlgorithm: Schema.String,
    signatureAlgorithm: Schema.String,
    signatureData: Schema.String
  }).annotate({ identifier: "Network.SignedCertificateTimestamp" })
) as any as Schema.Codec<SignedCertificateTimestamp>

/**
 * Information about a signed exchange response.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SignedExchangeError {
  /**
   * Error message.
   */
  readonly message: string
  /**
   * The index of the signature which caused the error.
   */
  readonly signatureIndex?: number | undefined
  /**
   * The field which caused the error.
   */
  readonly errorField?: SignedExchangeErrorField | undefined
}

/**
 * Schema for `SignedExchangeError`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SignedExchangeError = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.String,
    signatureIndex: Schema.optional(Schema.Int),
    errorField: Schema.optional(SignedExchangeErrorField)
  }).annotate({ identifier: "Network.SignedExchangeError" })
) as any as Schema.Codec<SignedExchangeError>

/**
 * Field type for a signed exchange related error.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SignedExchangeErrorField =
  | "signatureSig"
  | "signatureIntegrity"
  | "signatureCertUrl"
  | "signatureCertSha256"
  | "signatureValidityUrl"
  | "signatureTimestamps"
  | (string & {})

/**
 * Schema for `SignedExchangeErrorField`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SignedExchangeErrorField = Schema.String as any as Schema.Codec<SignedExchangeErrorField>

/**
 * Information about a signed exchange header.
 * https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#cbor-representation
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SignedExchangeHeader {
  /**
   * Signed exchange request URL.
   */
  readonly requestUrl: string
  /**
   * Signed exchange response code.
   */
  readonly responseCode: number
  /**
   * Signed exchange response headers.
   */
  readonly responseHeaders: Headers
  /**
   * Signed exchange response signature.
   */
  readonly signatures: ReadonlyArray<SignedExchangeSignature>
  /**
   * Signed exchange header integrity hash in the form of `sha256-<base64-hash-value>`.
   */
  readonly headerIntegrity: string
}

/**
 * Schema for `SignedExchangeHeader`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SignedExchangeHeader = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestUrl: Schema.String,
    responseCode: Schema.Int,
    responseHeaders: Headers,
    signatures: Schema.Array(SignedExchangeSignature),
    headerIntegrity: Schema.String
  }).annotate({ identifier: "Network.SignedExchangeHeader" })
) as any as Schema.Codec<SignedExchangeHeader>

/**
 * Information about a signed exchange response.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SignedExchangeInfo {
  /**
   * The outer response of signed HTTP exchange which was received from network.
   */
  readonly outerResponse: Response
  /**
   * Whether network response for the signed exchange was accompanied by
   * extra headers.
   */
  readonly hasExtraInfo: boolean
  /**
   * Information about the signed exchange header.
   */
  readonly header?: SignedExchangeHeader | undefined
  /**
   * Security details for the signed exchange header.
   */
  readonly securityDetails?: SecurityDetails | undefined
  /**
   * Errors occurred while handling the signed exchange.
   */
  readonly errors?: ReadonlyArray<SignedExchangeError> | undefined
}

/**
 * Schema for `SignedExchangeInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SignedExchangeInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    outerResponse: Response,
    hasExtraInfo: Schema.Boolean,
    header: Schema.optional(SignedExchangeHeader),
    securityDetails: Schema.optional(SecurityDetails),
    errors: Schema.optional(Schema.Array(SignedExchangeError))
  }).annotate({ identifier: "Network.SignedExchangeInfo" })
) as any as Schema.Codec<SignedExchangeInfo>

/**
 * Information about a signed exchange signature.
 * https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#rfc.section.3.1
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SignedExchangeSignature {
  /**
   * Signed exchange signature label.
   */
  readonly label: string
  /**
   * The hex string of signed exchange signature.
   */
  readonly signature: string
  /**
   * Signed exchange signature integrity.
   */
  readonly integrity: string
  /**
   * Signed exchange signature cert Url.
   */
  readonly certUrl?: string | undefined
  /**
   * The hex string of signed exchange signature cert sha256.
   */
  readonly certSha256?: string | undefined
  /**
   * Signed exchange signature validity Url.
   */
  readonly validityUrl: string
  /**
   * Signed exchange signature date.
   */
  readonly date: number
  /**
   * Signed exchange signature expires.
   */
  readonly expires: number
  /**
   * The encoded certificates.
   */
  readonly certificates?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `SignedExchangeSignature`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SignedExchangeSignature = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    label: Schema.String,
    signature: Schema.String,
    integrity: Schema.String,
    certUrl: Schema.optional(Schema.String),
    certSha256: Schema.optional(Schema.String),
    validityUrl: Schema.String,
    date: Schema.Int,
    expires: Schema.Int,
    certificates: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Network.SignedExchangeSignature" })
) as any as Schema.Codec<SignedExchangeSignature>

/**
 * Session event details specific to termination.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TerminationEventDetails {
  /**
   * The reason for a session being deleted.
   */
  readonly deletionReason: TerminationEventDetailsDeletionReason
}

/**
 * Schema for `TerminationEventDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TerminationEventDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    deletionReason: TerminationEventDetailsDeletionReason
  }).annotate({ identifier: "Network.TerminationEventDetails" })
) as any as Schema.Codec<TerminationEventDetails>

/**
 * The reason for a session being deleted.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TerminationEventDetailsDeletionReason =
  | "Expired"
  | "FailedToRestoreKey"
  | "FailedToUnwrapKey"
  | "StoragePartitionCleared"
  | "ClearBrowsingData"
  | "ServerRequested"
  | "InvalidSessionParams"
  | "RefreshFatalError"
  | "DevTools"
  | "Replaced"
  | (string & {})

/**
 * Schema for `TerminationEventDetailsDeletionReason`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TerminationEventDetailsDeletionReason = Schema.String as any as Schema.Codec<
  TerminationEventDetailsDeletionReason
>

/**
 * UTC time in seconds, counted from January 1, 1970.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TimeSinceEpoch = number

/**
 * Schema for `TimeSinceEpoch`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TimeSinceEpoch = Schema.Number as any as Schema.Codec<TimeSinceEpoch>

/**
 * `TrustTokenOperationType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type TrustTokenOperationType =
  | "Issuance"
  | "Redemption"
  | "Signing"
  | (string & {})

/**
 * Schema for `TrustTokenOperationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrustTokenOperationType = Schema.String as any as Schema.Codec<TrustTokenOperationType>

/**
 * Determines what type of Trust Token operation is executed and
 * depending on the type, some additional parameters. The values
 * are specified in third_party/blink/renderer/core/fetch/trust_token.idl.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrustTokenParams {
  readonly operation: TrustTokenOperationType
  /**
   * Only set for "token-redemption" operation and determine whether
   * to request a fresh SRR or use a still valid cached SRR.
   */
  readonly refreshPolicy: TrustTokenParamsRefreshPolicy
  /**
   * Origins of issuers from whom to request tokens or redemption
   * records.
   */
  readonly issuers?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `TrustTokenParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrustTokenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    operation: TrustTokenOperationType,
    refreshPolicy: TrustTokenParamsRefreshPolicy,
    issuers: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Network.TrustTokenParams" })
) as any as Schema.Codec<TrustTokenParams>

/**
 * Only set for "token-redemption" operation and determine whether
 * to request a fresh SRR or use a still valid cached SRR.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TrustTokenParamsRefreshPolicy =
  | "UseCached"
  | "Refresh"
  | (string & {})

/**
 * Schema for `TrustTokenParamsRefreshPolicy`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrustTokenParamsRefreshPolicy = Schema.String as any as Schema.Codec<TrustTokenParamsRefreshPolicy>

/**
 * WebSocket message data. This represents an entire WebSocket message, not just a fragmented frame as the name suggests.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketFrame {
  /**
   * WebSocket message opcode.
   */
  readonly opcode: number
  /**
   * WebSocket message mask.
   */
  readonly mask: boolean
  /**
   * WebSocket message payload data.
   * If the opcode is 1, this is a text message and payloadData is a UTF-8 string.
   * If the opcode isn't 1, then payloadData is a base64 encoded string representing binary data.
   */
  readonly payloadData: string
}

/**
 * Schema for `WebSocketFrame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketFrame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    opcode: Schema.Number,
    mask: Schema.Boolean,
    payloadData: Schema.String
  }).annotate({ identifier: "Network.WebSocketFrame" })
) as any as Schema.Codec<WebSocketFrame>

/**
 * WebSocket request data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketRequest {
  /**
   * HTTP request headers.
   */
  readonly headers: Headers
}

/**
 * Schema for `WebSocketRequest`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    headers: Headers
  }).annotate({ identifier: "Network.WebSocketRequest" })
) as any as Schema.Codec<WebSocketRequest>

/**
 * WebSocket response data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketResponse {
  /**
   * HTTP response status code.
   */
  readonly status: number
  /**
   * HTTP response status text.
   */
  readonly statusText: string
  /**
   * HTTP response headers.
   */
  readonly headers: Headers
  /**
   * HTTP response headers text.
   */
  readonly headersText?: string | undefined
  /**
   * HTTP request headers.
   */
  readonly requestHeaders?: Headers | undefined
  /**
   * HTTP request headers text.
   */
  readonly requestHeadersText?: string | undefined
}

/**
 * Schema for `WebSocketResponse`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketResponse = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    status: Schema.Int,
    statusText: Schema.String,
    headers: Headers,
    headersText: Schema.optional(Schema.String),
    requestHeaders: Schema.optional(Headers),
    requestHeadersText: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.WebSocketResponse" })
) as any as Schema.Codec<WebSocketResponse>

/**
 * Configures storing response bodies outside of renderer, so that these survive
 * a cross-process navigation.
 * If maxTotalBufferSize is not set, durable messages are disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ConfigureDurableMessagesParams {
  /**
   * Buffer size in bytes to use when preserving network payloads (XHRs, etc).
   */
  readonly maxTotalBufferSize?: number | undefined
  /**
   * Per-resource buffer size in bytes to use when preserving network payloads (XHRs, etc).
   */
  readonly maxResourceBufferSize?: number | undefined
}

/**
 * Schema for `ConfigureDurableMessagesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ConfigureDurableMessagesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxTotalBufferSize: Schema.optional(Schema.Int),
    maxResourceBufferSize: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Network.ConfigureDurableMessagesParams" })
) as any as Schema.Codec<ConfigureDurableMessagesParams>

/**
 * Fired when data chunk was received over the network.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DataReceivedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Data chunk length.
   */
  readonly dataLength: number
  /**
   * Actual bytes received (might be less than dataLength for compressed encodings).
   */
  readonly encodedDataLength: number
  /**
   * Data that was received. (Encoded as a base64 string when passed over JSON)
   */
  readonly data?: string | undefined
}

/**
 * Schema for `DataReceivedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DataReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    dataLength: Schema.Int,
    encodedDataLength: Schema.Int,
    data: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.DataReceivedParams" })
) as any as Schema.Codec<DataReceivedParams>

/**
 * Deletes browser cookies with matching name and url or domain/path/partitionKey pair.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteCookiesParams {
  /**
   * Name of the cookies to remove.
   */
  readonly name: string
  /**
   * If specified, deletes all the cookies with the given name where domain and path match
   * provided URL.
   */
  readonly url?: string | undefined
  /**
   * If specified, deletes only cookies with the exact domain.
   */
  readonly domain?: string | undefined
  /**
   * If specified, deletes only cookies with the exact path.
   */
  readonly path?: string | undefined
  /**
   * If specified, deletes only cookies with the the given name and partitionKey where
   * all partition key attributes match the cookie partition key attribute.
   */
  readonly partitionKey?: CookiePartitionKey | undefined
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
    name: Schema.String,
    url: Schema.optional(Schema.String),
    domain: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    partitionKey: Schema.optional(CookiePartitionKey)
  }).annotate({ identifier: "Network.DeleteCookiesParams" })
) as any as Schema.Codec<DeleteCookiesParams>

/**
 * Deletes a device bound session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeleteDeviceBoundSessionParams {
  readonly key: DeviceBoundSessionKey
}

/**
 * Schema for `DeleteDeviceBoundSessionParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeleteDeviceBoundSessionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: DeviceBoundSessionKey
  }).annotate({ identifier: "Network.DeleteDeviceBoundSessionParams" })
) as any as Schema.Codec<DeleteDeviceBoundSessionParams>

/**
 * Triggered when a device bound session event occurs.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionEventOccurredParams {
  /**
   * A unique identifier for this session event.
   */
  readonly eventId: DeviceBoundSessionEventId
  /**
   * The site this session event is associated with.
   */
  readonly site: string
  /**
   * Whether this event was considered successful.
   */
  readonly succeeded: boolean
  /**
   * The session ID this event is associated with. May not be populated for
   * failed events.
   */
  readonly sessionId?: string | undefined
  /**
   * The below are the different session event type details. Exactly one is populated.
   */
  readonly creationEventDetails?: CreationEventDetails | undefined
  readonly refreshEventDetails?: RefreshEventDetails | undefined
  readonly terminationEventDetails?: TerminationEventDetails | undefined
  readonly challengeEventDetails?: ChallengeEventDetails | undefined
}

/**
 * Schema for `DeviceBoundSessionEventOccurredParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionEventOccurredParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventId: DeviceBoundSessionEventId,
    site: Schema.String,
    succeeded: Schema.Boolean,
    sessionId: Schema.optional(Schema.String),
    creationEventDetails: Schema.optional(CreationEventDetails),
    refreshEventDetails: Schema.optional(RefreshEventDetails),
    terminationEventDetails: Schema.optional(TerminationEventDetails),
    challengeEventDetails: Schema.optional(ChallengeEventDetails)
  }).annotate({ identifier: "Network.DeviceBoundSessionEventOccurredParams" })
) as any as Schema.Codec<DeviceBoundSessionEventOccurredParams>

/**
 * Triggered when the initial set of device bound sessions is added.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceBoundSessionsAddedParams {
  /**
   * The device bound sessions.
   */
  readonly sessions: ReadonlyArray<DeviceBoundSession>
}

/**
 * Schema for `DeviceBoundSessionsAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceBoundSessionsAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessions: Schema.Array(DeviceBoundSession)
  }).annotate({ identifier: "Network.DeviceBoundSessionsAddedParams" })
) as any as Schema.Codec<DeviceBoundSessionsAddedParams>

/**
 * Fired when direct_socket.TCPSocket is aborted.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketAbortedParams {
  readonly identifier: RequestId
  readonly errorMessage: ErrorReason
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectTCPSocketAbortedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketAbortedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    errorMessage: ErrorReason,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectTCPSocketAbortedParams" })
) as any as Schema.Codec<DirectTCPSocketAbortedParams>

/**
 * Fired when data is received from tcp direct socket stream.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketChunkReceivedParams {
  readonly identifier: RequestId
  readonly data: string
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectTCPSocketChunkReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketChunkReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    data: Schema.String,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectTCPSocketChunkReceivedParams" })
) as any as Schema.Codec<DirectTCPSocketChunkReceivedParams>

/**
 * Fired when data is sent to tcp direct socket stream.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketChunkSentParams {
  readonly identifier: RequestId
  readonly data: string
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectTCPSocketChunkSentParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketChunkSentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    data: Schema.String,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectTCPSocketChunkSentParams" })
) as any as Schema.Codec<DirectTCPSocketChunkSentParams>

/**
 * Fired when direct_socket.TCPSocket is closed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketClosedParams {
  readonly identifier: RequestId
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectTCPSocketClosedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketClosedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectTCPSocketClosedParams" })
) as any as Schema.Codec<DirectTCPSocketClosedParams>

/**
 * Fired upon direct_socket.TCPSocket creation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketCreatedParams {
  readonly identifier: RequestId
  readonly remoteAddr: string
  /**
   * Unsigned int 16.
   */
  readonly remotePort: number
  readonly options: DirectTCPSocketOptions
  readonly timestamp: MonotonicTime
  readonly initiator?: Initiator | undefined
}

/**
 * Schema for `DirectTCPSocketCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    remoteAddr: Schema.String,
    remotePort: Schema.Int,
    options: DirectTCPSocketOptions,
    timestamp: MonotonicTime,
    initiator: Schema.optional(Initiator)
  }).annotate({ identifier: "Network.DirectTCPSocketCreatedParams" })
) as any as Schema.Codec<DirectTCPSocketCreatedParams, unknown>

/**
 * Fired when direct_socket.TCPSocket connection is opened.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectTCPSocketOpenedParams {
  readonly identifier: RequestId
  readonly remoteAddr: string
  /**
   * Expected to be unsigned integer.
   */
  readonly remotePort: number
  readonly timestamp: MonotonicTime
  readonly localAddr?: string | undefined
  /**
   * Expected to be unsigned integer.
   */
  readonly localPort?: number | undefined
}

/**
 * Schema for `DirectTCPSocketOpenedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectTCPSocketOpenedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    remoteAddr: Schema.String,
    remotePort: Schema.Int,
    timestamp: MonotonicTime,
    localAddr: Schema.optional(Schema.String),
    localPort: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Network.DirectTCPSocketOpenedParams" })
) as any as Schema.Codec<DirectTCPSocketOpenedParams>

/**
 * Fired when direct_socket.UDPSocket is aborted.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketAbortedParams {
  readonly identifier: RequestId
  readonly errorMessage: ErrorReason
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectUDPSocketAbortedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketAbortedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    errorMessage: ErrorReason,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectUDPSocketAbortedParams" })
) as any as Schema.Codec<DirectUDPSocketAbortedParams>

/**
 * Fired when message is received from udp direct socket stream.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketChunkReceivedParams {
  readonly identifier: RequestId
  readonly message: DirectUDPMessage
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectUDPSocketChunkReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketChunkReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    message: DirectUDPMessage,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectUDPSocketChunkReceivedParams" })
) as any as Schema.Codec<DirectUDPSocketChunkReceivedParams>

/**
 * Fired when message is sent to udp direct socket stream.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketChunkSentParams {
  readonly identifier: RequestId
  readonly message: DirectUDPMessage
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectUDPSocketChunkSentParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketChunkSentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    message: DirectUDPMessage,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectUDPSocketChunkSentParams" })
) as any as Schema.Codec<DirectUDPSocketChunkSentParams>

/**
 * Fired when direct_socket.UDPSocket is closed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketClosedParams {
  readonly identifier: RequestId
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `DirectUDPSocketClosedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketClosedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.DirectUDPSocketClosedParams" })
) as any as Schema.Codec<DirectUDPSocketClosedParams>

/**
 * Fired upon direct_socket.UDPSocket creation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketCreatedParams {
  readonly identifier: RequestId
  readonly options: DirectUDPSocketOptions
  readonly timestamp: MonotonicTime
  readonly initiator?: Initiator | undefined
}

/**
 * Schema for `DirectUDPSocketCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    options: DirectUDPSocketOptions,
    timestamp: MonotonicTime,
    initiator: Schema.optional(Initiator)
  }).annotate({ identifier: "Network.DirectUDPSocketCreatedParams" })
) as any as Schema.Codec<DirectUDPSocketCreatedParams, unknown>

/**
 * `directUDPSocketJoinedMulticastGroup.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketJoinedMulticastGroupParams {
  readonly identifier: RequestId
  readonly IPAddress: string
}

/**
 * Schema for `DirectUDPSocketJoinedMulticastGroupParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketJoinedMulticastGroupParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    IPAddress: Schema.String
  }).annotate({ identifier: "Network.DirectUDPSocketJoinedMulticastGroupParams" })
) as any as Schema.Codec<DirectUDPSocketJoinedMulticastGroupParams>

/**
 * `directUDPSocketLeftMulticastGroup.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketLeftMulticastGroupParams {
  readonly identifier: RequestId
  readonly IPAddress: string
}

/**
 * Schema for `DirectUDPSocketLeftMulticastGroupParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketLeftMulticastGroupParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    IPAddress: Schema.String
  }).annotate({ identifier: "Network.DirectUDPSocketLeftMulticastGroupParams" })
) as any as Schema.Codec<DirectUDPSocketLeftMulticastGroupParams>

/**
 * Fired when direct_socket.UDPSocket connection is opened.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DirectUDPSocketOpenedParams {
  readonly identifier: RequestId
  readonly localAddr: string
  /**
   * Expected to be unsigned integer.
   */
  readonly localPort: number
  readonly timestamp: MonotonicTime
  readonly remoteAddr?: string | undefined
  /**
   * Expected to be unsigned integer.
   */
  readonly remotePort?: number | undefined
}

/**
 * Schema for `DirectUDPSocketOpenedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DirectUDPSocketOpenedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: RequestId,
    localAddr: Schema.String,
    localPort: Schema.Int,
    timestamp: MonotonicTime,
    remoteAddr: Schema.optional(Schema.String),
    remotePort: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Network.DirectUDPSocketOpenedParams" })
) as any as Schema.Codec<DirectUDPSocketOpenedParams>

/**
 * Activates emulation of network conditions for individual requests using URL match patterns. Unlike the deprecated
 * Network.emulateNetworkConditions this method does not affect `navigator` state. Use Network.overrideNetworkState to
 * explicitly modify `navigator` behavior.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EmulateNetworkConditionsByRuleParams {
  /**
   * True to emulate offline service worker.
   */
  readonly emulateOfflineServiceWorker?: boolean | undefined
  /**
   * Configure conditions for matching requests. If multiple entries match a request, the first entry wins.  Global
   * conditions can be configured by leaving the urlPattern for the conditions empty. These global conditions are
   * also applied for throttling of p2p connections.
   */
  readonly matchedNetworkConditions: ReadonlyArray<NetworkConditions>
}

/**
 * Schema for `EmulateNetworkConditionsByRuleParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EmulateNetworkConditionsByRuleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    emulateOfflineServiceWorker: Schema.optional(Schema.Boolean),
    matchedNetworkConditions: Schema.Array(NetworkConditions)
  }).annotate({ identifier: "Network.EmulateNetworkConditionsByRuleParams" })
) as any as Schema.Codec<EmulateNetworkConditionsByRuleParams>

/**
 * Activates emulation of network conditions for individual requests using URL match patterns. Unlike the deprecated
 * Network.emulateNetworkConditions this method does not affect `navigator` state. Use Network.overrideNetworkState to
 * explicitly modify `navigator` behavior.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EmulateNetworkConditionsByRuleResult {
  /**
   * An id for each entry in matchedNetworkConditions. The id will be included in the requestWillBeSentExtraInfo for
   * requests affected by a rule.
   */
  readonly ruleIds: ReadonlyArray<string>
}

/**
 * Schema for `EmulateNetworkConditionsByRuleResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EmulateNetworkConditionsByRuleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleIds: Schema.Array(Schema.String)
  }).annotate({ identifier: "Network.EmulateNetworkConditionsByRuleResult" })
) as any as Schema.Codec<EmulateNetworkConditionsByRuleResult>

/**
 * Enables network tracking, network events will now be delivered to the client.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * Buffer size in bytes to use when preserving network payloads (XHRs, etc).
   * This is the maximum number of bytes that will be collected by this
   * DevTools session.
   */
  readonly maxTotalBufferSize?: number | undefined
  /**
   * Per-resource buffer size in bytes to use when preserving network payloads (XHRs, etc).
   */
  readonly maxResourceBufferSize?: number | undefined
  /**
   * Longest post body size (in bytes) that would be included in requestWillBeSent notification
   */
  readonly maxPostDataSize?: number | undefined
  /**
   * Whether DirectSocket chunk send/receive events should be reported.
   */
  readonly reportDirectSocketTraffic?: boolean | undefined
  /**
   * Enable storing response bodies outside of renderer, so that these survive
   * a cross-process navigation. Requires maxTotalBufferSize to be set.
   * Currently defaults to false. This field is being deprecated in favor of the dedicated
   * configureDurableMessages command, due to the possibility of deadlocks when awaiting
   * Network.enable before issuing Runtime.runIfWaitingForDebugger.
   */
  readonly enableDurableMessages?: boolean | undefined
}

/**
 * Schema for `EnableParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EnableParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxTotalBufferSize: Schema.optional(Schema.Int),
    maxResourceBufferSize: Schema.optional(Schema.Int),
    maxPostDataSize: Schema.optional(Schema.Int),
    reportDirectSocketTraffic: Schema.optional(Schema.Boolean),
    enableDurableMessages: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Sets up tracking device bound sessions and fetching of initial set of sessions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableDeviceBoundSessionsParams {
  /**
   * Whether to enable or disable events.
   */
  readonly enable: boolean
}

/**
 * Schema for `EnableDeviceBoundSessionsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EnableDeviceBoundSessionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enable: Schema.Boolean
  }).annotate({ identifier: "Network.EnableDeviceBoundSessionsParams" })
) as any as Schema.Codec<EnableDeviceBoundSessionsParams>

/**
 * Enables tracking for the Reporting API, events generated by the Reporting API will now be delivered to the client.
 * Enabling triggers 'reportingApiReportAdded' for all existing reports.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableReportingApiParams {
  /**
   * Whether to enable or disable events for the Reporting API
   */
  readonly enable: boolean
}

/**
 * Schema for `EnableReportingApiParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EnableReportingApiParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enable: Schema.Boolean
  }).annotate({ identifier: "Network.EnableReportingApiParams" })
) as any as Schema.Codec<EnableReportingApiParams>

/**
 * Fired when EventSource message is received.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EventSourceMessageReceivedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Message type.
   */
  readonly eventName: string
  /**
   * Message identifier.
   */
  readonly eventId: string
  /**
   * Message content.
   */
  readonly data: string
}

/**
 * Schema for `EventSourceMessageReceivedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventSourceMessageReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    eventName: Schema.String,
    eventId: Schema.String,
    data: Schema.String
  }).annotate({ identifier: "Network.EventSourceMessageReceivedParams" })
) as any as Schema.Codec<EventSourceMessageReceivedParams>

/**
 * Fetches the schemeful site for a specific origin.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FetchSchemefulSiteParams {
  /**
   * The URL origin.
   */
  readonly origin: string
}

/**
 * Schema for `FetchSchemefulSiteParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FetchSchemefulSiteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Network.FetchSchemefulSiteParams" })
) as any as Schema.Codec<FetchSchemefulSiteParams>

/**
 * Fetches the schemeful site for a specific origin.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FetchSchemefulSiteResult {
  /**
   * The corresponding schemeful site.
   */
  readonly schemefulSite: string
}

/**
 * Schema for `FetchSchemefulSiteResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FetchSchemefulSiteResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    schemefulSite: Schema.String
  }).annotate({ identifier: "Network.FetchSchemefulSiteResult" })
) as any as Schema.Codec<FetchSchemefulSiteResult>

/**
 * Returns the DER-encoded certificate.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCertificateParams {
  /**
   * Origin to get certificate for.
   */
  readonly origin: string
}

/**
 * Schema for `GetCertificateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCertificateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String
  }).annotate({ identifier: "Network.GetCertificateParams" })
) as any as Schema.Codec<GetCertificateParams>

/**
 * Returns the DER-encoded certificate.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCertificateResult {
  readonly tableNames: ReadonlyArray<string>
}

/**
 * Schema for `GetCertificateResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCertificateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    tableNames: Schema.Array(Schema.String)
  }).annotate({ identifier: "Network.GetCertificateResult" })
) as any as Schema.Codec<GetCertificateResult>

/**
 * Returns all browser cookies for the current URL. Depending on the backend support, will return
 * detailed cookie information in the `cookies` field.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesParams {
  /**
   * The list of URLs for which applicable cookies will be fetched.
   * If not specified, it's assumed to be set to the list containing
   * the URLs of the page and all of its subframes.
   */
  readonly urls?: ReadonlyArray<string> | undefined
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
    urls: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Network.GetCookiesParams" })
) as any as Schema.Codec<GetCookiesParams>

/**
 * Returns all browser cookies for the current URL. Depending on the backend support, will return
 * detailed cookie information in the `cookies` field.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCookiesResult {
  /**
   * Array of cookie objects.
   */
  readonly cookies: ReadonlyArray<Cookie>
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
    cookies: Schema.Array(Cookie)
  }).annotate({ identifier: "Network.GetCookiesResult" })
) as any as Schema.Codec<GetCookiesResult, unknown>

/**
 * Returns post data sent with the request. Returns an error when no data was sent with the request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRequestPostDataParams {
  /**
   * Identifier of the network request to get content for.
   */
  readonly requestId: RequestId
}

/**
 * Schema for `GetRequestPostDataParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRequestPostDataParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Network.GetRequestPostDataParams" })
) as any as Schema.Codec<GetRequestPostDataParams>

/**
 * Returns post data sent with the request. Returns an error when no data was sent with the request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRequestPostDataResult {
  /**
   * Request body string, omitting files from multipart requests
   */
  readonly postData: string
  /**
   * True, if content was sent as base64.
   */
  readonly base64Encoded: boolean
}

/**
 * Schema for `GetRequestPostDataResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRequestPostDataResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    postData: Schema.String,
    base64Encoded: Schema.Boolean
  }).annotate({ identifier: "Network.GetRequestPostDataResult" })
) as any as Schema.Codec<GetRequestPostDataResult>

/**
 * Returns content served for the given request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetResponseBodyParams {
  /**
   * Identifier of the network request to get content for.
   */
  readonly requestId: RequestId
}

/**
 * Schema for `GetResponseBodyParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetResponseBodyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Network.GetResponseBodyParams" })
) as any as Schema.Codec<GetResponseBodyParams>

/**
 * Returns content served for the given request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetResponseBodyResult {
  /**
   * Response body.
   */
  readonly body: string
  /**
   * True, if content was sent as base64.
   */
  readonly base64Encoded: boolean
}

/**
 * Schema for `GetResponseBodyResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetResponseBodyResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    body: Schema.String,
    base64Encoded: Schema.Boolean
  }).annotate({ identifier: "Network.GetResponseBodyResult" })
) as any as Schema.Codec<GetResponseBodyResult>

/**
 * Returns information about the COEP/COOP isolation status.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSecurityIsolationStatusParams {
  /**
   * If no frameId is provided, the status of the target is provided.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `GetSecurityIsolationStatusParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSecurityIsolationStatusParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Network.GetSecurityIsolationStatusParams" })
) as any as Schema.Codec<GetSecurityIsolationStatusParams>

/**
 * Returns information about the COEP/COOP isolation status.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetSecurityIsolationStatusResult {
  readonly status: SecurityIsolationStatus
}

/**
 * Schema for `GetSecurityIsolationStatusResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetSecurityIsolationStatusResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    status: SecurityIsolationStatus
  }).annotate({ identifier: "Network.GetSecurityIsolationStatusResult" })
) as any as Schema.Codec<GetSecurityIsolationStatusResult>

/**
 * Fetches the resource and returns the content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadNetworkResourceParams {
  /**
   * Frame id to get the resource for. Mandatory for frame targets, and
   * should be omitted for worker targets.
   */
  readonly frameId?: Page.FrameId | undefined
  /**
   * URL of the resource to get content for.
   */
  readonly url: string
  /**
   * Options for the request.
   */
  readonly options: LoadNetworkResourceOptions
}

/**
 * Schema for `LoadNetworkResourceParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadNetworkResourceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Schema.optional(Page.FrameId),
    url: Schema.String,
    options: LoadNetworkResourceOptions
  }).annotate({ identifier: "Network.LoadNetworkResourceParams" })
) as any as Schema.Codec<LoadNetworkResourceParams>

/**
 * Fetches the resource and returns the content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LoadNetworkResourceResult {
  readonly resource: LoadNetworkResourcePageResult
}

/**
 * Schema for `LoadNetworkResourceResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoadNetworkResourceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    resource: LoadNetworkResourcePageResult
  }).annotate({ identifier: "Network.LoadNetworkResourceResult" })
) as any as Schema.Codec<LoadNetworkResourceResult>

/**
 * Fired when HTTP request has failed to load.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadingFailedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Resource type.
   */
  readonly type: ResourceType
  /**
   * Error message. List of network errors: https://cs.chromium.org/chromium/src/net/base/net_error_list.h
   */
  readonly errorText: string
  /**
   * True if loading was canceled.
   */
  readonly canceled?: boolean | undefined
  /**
   * The reason why loading was blocked, if any.
   */
  readonly blockedReason?: BlockedReason | undefined
  /**
   * The reason why loading was blocked by CORS, if any.
   */
  readonly corsErrorStatus?: CorsErrorStatus | undefined
}

/**
 * Schema for `LoadingFailedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadingFailedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    type: ResourceType,
    errorText: Schema.String,
    canceled: Schema.optional(Schema.Boolean),
    blockedReason: Schema.optional(BlockedReason),
    corsErrorStatus: Schema.optional(CorsErrorStatus)
  }).annotate({ identifier: "Network.LoadingFailedParams" })
) as any as Schema.Codec<LoadingFailedParams>

/**
 * Fired when HTTP request has finished loading.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadingFinishedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Total number of bytes received for this request.
   */
  readonly encodedDataLength: number
}

/**
 * Schema for `LoadingFinishedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadingFinishedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    encodedDataLength: Schema.Number
  }).annotate({ identifier: "Network.LoadingFinishedParams" })
) as any as Schema.Codec<LoadingFinishedParams>

/**
 * Override the state of navigator.onLine and navigator.connection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OverrideNetworkStateParams {
  /**
   * True to emulate internet disconnection.
   */
  readonly offline: boolean
  /**
   * Minimum latency from request sent to response headers received (ms).
   */
  readonly latency: number
  /**
   * Maximal aggregated download throughput (bytes/sec). -1 disables download throttling.
   */
  readonly downloadThroughput: number
  /**
   * Maximal aggregated upload throughput (bytes/sec).  -1 disables upload throttling.
   */
  readonly uploadThroughput: number
  /**
   * Connection type if known.
   */
  readonly connectionType?: ConnectionType | undefined
}

/**
 * Schema for `OverrideNetworkStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OverrideNetworkStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    offline: Schema.Boolean,
    latency: Schema.Number,
    downloadThroughput: Schema.Number,
    uploadThroughput: Schema.Number,
    connectionType: Schema.optional(ConnectionType)
  }).annotate({ identifier: "Network.OverrideNetworkStateParams" })
) as any as Schema.Codec<OverrideNetworkStateParams>

/**
 * This method sends a new XMLHttpRequest which is identical to the original one. The following
 * parameters should be identical: method, url, async, request body, extra headers, withCredentials
 * attribute, user, password.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReplayXHRParams {
  /**
   * Identifier of XHR to replay.
   */
  readonly requestId: RequestId
}

/**
 * Schema for `ReplayXHRParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReplayXHRParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Network.ReplayXHRParams" })
) as any as Schema.Codec<ReplayXHRParams>

/**
 * `reportingApiEndpointsChangedForOrigin.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportingApiEndpointsChangedForOriginParams {
  /**
   * Origin of the document(s) which configured the endpoints.
   */
  readonly origin: string
  readonly endpoints: ReadonlyArray<ReportingApiEndpoint>
}

/**
 * Schema for `ReportingApiEndpointsChangedForOriginParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportingApiEndpointsChangedForOriginParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    endpoints: Schema.Array(ReportingApiEndpoint)
  }).annotate({ identifier: "Network.ReportingApiEndpointsChangedForOriginParams" })
) as any as Schema.Codec<ReportingApiEndpointsChangedForOriginParams>

/**
 * Is sent whenever a new report is added.
 * And after 'enableReportingApi' for all existing reports.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportingApiReportAddedParams {
  readonly report: ReportingApiReport
}

/**
 * Schema for `ReportingApiReportAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportingApiReportAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    report: ReportingApiReport
  }).annotate({ identifier: "Network.ReportingApiReportAddedParams" })
) as any as Schema.Codec<ReportingApiReportAddedParams>

/**
 * `reportingApiReportUpdated.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportingApiReportUpdatedParams {
  readonly report: ReportingApiReport
}

/**
 * Schema for `ReportingApiReportUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportingApiReportUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    report: ReportingApiReport
  }).annotate({ identifier: "Network.ReportingApiReportUpdatedParams" })
) as any as Schema.Codec<ReportingApiReportUpdatedParams>

/**
 * Fired if request ended up loading from cache.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestServedFromCacheParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
}

/**
 * Schema for `RequestServedFromCacheParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestServedFromCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Network.RequestServedFromCacheParams" })
) as any as Schema.Codec<RequestServedFromCacheParams>

/**
 * Fired when page is about to send HTTP request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestWillBeSentParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Loader identifier. Empty string if the request is fetched from worker.
   */
  readonly loaderId: LoaderId
  /**
   * URL of the document this request is loaded for.
   */
  readonly documentURL: string
  /**
   * Request data.
   */
  readonly request: Request
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Timestamp.
   */
  readonly wallTime: TimeSinceEpoch
  /**
   * Request initiator.
   */
  readonly initiator: Initiator
  /**
   * In the case that redirectResponse is populated, this flag indicates whether
   * requestWillBeSentExtraInfo and responseReceivedExtraInfo events will be or were emitted
   * for the request which was just redirected.
   */
  readonly redirectHasExtraInfo?: boolean | undefined
  /**
   * Redirect response data.
   */
  readonly redirectResponse?: Response | undefined
  /**
   * Type of this resource.
   */
  readonly type?: ResourceType | undefined
  /**
   * Frame identifier.
   */
  readonly frameId?: Page.FrameId | undefined
  /**
   * Whether the request is initiated by a user gesture. Defaults to false.
   */
  readonly hasUserGesture?: boolean | undefined
  /**
   * The render-blocking behavior of the request.
   */
  readonly renderBlockingBehavior?: RenderBlockingBehavior | undefined
}

/**
 * Schema for `RequestWillBeSentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestWillBeSentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    loaderId: LoaderId,
    documentURL: Schema.String,
    request: Request,
    timestamp: MonotonicTime,
    wallTime: TimeSinceEpoch,
    initiator: Initiator,
    redirectHasExtraInfo: Schema.optional(Schema.Boolean),
    redirectResponse: Schema.optional(Response),
    type: Schema.optional(ResourceType),
    frameId: Schema.optional(Page.FrameId),
    hasUserGesture: Schema.optional(Schema.Boolean),
    renderBlockingBehavior: Schema.optional(RenderBlockingBehavior)
  }).annotate({ identifier: "Network.RequestWillBeSentParams" })
) as any as Schema.Codec<RequestWillBeSentParams, unknown>

/**
 * Fired when additional information about a requestWillBeSent event is available from the
 * network stack. Not every requestWillBeSent event will have an additional
 * requestWillBeSentExtraInfo fired for it, and there is no guarantee whether requestWillBeSent
 * or requestWillBeSentExtraInfo will be fired first for the same request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RequestWillBeSentExtraInfoParams {
  /**
   * Request identifier. Used to match this information to an existing requestWillBeSent event.
   */
  readonly requestId: RequestId
  /**
   * A list of cookies potentially associated to the requested URL. This includes both cookies sent with
   * the request and the ones not sent; the latter are distinguished by having blockedReasons field set.
   */
  readonly associatedCookies: ReadonlyArray<AssociatedCookie>
  /**
   * Raw request headers as they will be sent over the wire.
   */
  readonly headers: Headers
  /**
   * Connection timing information for the request.
   */
  readonly connectTiming?: ConnectTiming | undefined
  /**
   * How the request site's device bound sessions were used during this request.
   */
  readonly deviceBoundSessionUsages?: ReadonlyArray<DeviceBoundSessionWithUsage> | undefined
  /**
   * The client security state set for the request.
   */
  readonly clientSecurityState?: ClientSecurityState | undefined
  /**
   * Whether the site has partitioned cookies stored in a partition different than the current one.
   */
  readonly siteHasCookieInOtherPartition?: boolean | undefined
  /**
   * The network conditions id if this request was affected by network conditions configured via
   * emulateNetworkConditionsByRule.
   */
  readonly appliedNetworkConditionsId?: string | undefined
}

/**
 * Schema for `RequestWillBeSentExtraInfoParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestWillBeSentExtraInfoParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    associatedCookies: Schema.Array(AssociatedCookie),
    headers: Headers,
    connectTiming: Schema.optional(ConnectTiming),
    deviceBoundSessionUsages: Schema.optional(Schema.Array(DeviceBoundSessionWithUsage)),
    clientSecurityState: Schema.optional(ClientSecurityState),
    siteHasCookieInOtherPartition: Schema.optional(Schema.Boolean),
    appliedNetworkConditionsId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.RequestWillBeSentExtraInfoParams" })
) as any as Schema.Codec<RequestWillBeSentExtraInfoParams, unknown>

/**
 * Fired when resource loading priority is changed
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResourceChangedPriorityParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * New priority
   */
  readonly newPriority: ResourcePriority
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `ResourceChangedPriorityParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResourceChangedPriorityParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    newPriority: ResourcePriority,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.ResourceChangedPriorityParams" })
) as any as Schema.Codec<ResourceChangedPriorityParams>

/**
 * Fired when HTTP response is available.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseReceivedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Loader identifier. Empty string if the request is fetched from worker.
   */
  readonly loaderId: LoaderId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Resource type.
   */
  readonly type: ResourceType
  /**
   * Response data.
   */
  readonly response: Response
  /**
   * Indicates whether requestWillBeSentExtraInfo and responseReceivedExtraInfo events will be
   * or were emitted for this request.
   */
  readonly hasExtraInfo?: boolean | undefined
  /**
   * Frame identifier.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `ResponseReceivedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    loaderId: LoaderId,
    timestamp: MonotonicTime,
    type: ResourceType,
    response: Response,
    hasExtraInfo: Schema.optional(Schema.Boolean),
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "Network.ResponseReceivedParams" })
) as any as Schema.Codec<ResponseReceivedParams>

/**
 * Fired when 103 Early Hints headers is received in addition to the common response.
 * Not every responseReceived event will have an responseReceivedEarlyHints fired.
 * Only one responseReceivedEarlyHints may be fired for eached responseReceived event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResponseReceivedEarlyHintsParams {
  /**
   * Request identifier. Used to match this information to another responseReceived event.
   */
  readonly requestId: RequestId
  /**
   * Raw response headers as they were received over the wire.
   * Duplicate headers in the response are represented as a single key with their values
   * concatentated using `\n` as the separator.
   * See also `headersText` that contains verbatim text for HTTP/1.*.
   */
  readonly headers: Headers
}

/**
 * Schema for `ResponseReceivedEarlyHintsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResponseReceivedEarlyHintsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    headers: Headers
  }).annotate({ identifier: "Network.ResponseReceivedEarlyHintsParams" })
) as any as Schema.Codec<ResponseReceivedEarlyHintsParams>

/**
 * Fired when additional information about a responseReceived event is available from the network
 * stack. Not every responseReceived event will have an additional responseReceivedExtraInfo for
 * it, and responseReceivedExtraInfo may be fired before or after responseReceived.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResponseReceivedExtraInfoParams {
  /**
   * Request identifier. Used to match this information to another responseReceived event.
   */
  readonly requestId: RequestId
  /**
   * A list of cookies which were not stored from the response along with the corresponding
   * reasons for blocking. The cookies here may not be valid due to syntax errors, which
   * are represented by the invalid cookie line string instead of a proper cookie.
   */
  readonly blockedCookies: ReadonlyArray<BlockedSetCookieWithReason>
  /**
   * Raw response headers as they were received over the wire.
   * Duplicate headers in the response are represented as a single key with their values
   * concatentated using `\n` as the separator.
   * See also `headersText` that contains verbatim text for HTTP/1.*.
   */
  readonly headers: Headers
  /**
   * The IP address space of the resource. The address space can only be determined once the transport
   * established the connection, so we can't send it in `requestWillBeSentExtraInfo`.
   */
  readonly resourceIPAddressSpace: IPAddressSpace
  /**
   * The status code of the response. This is useful in cases the request failed and no responseReceived
   * event is triggered, which is the case for, e.g., CORS errors. This is also the correct status code
   * for cached requests, where the status in responseReceived is a 200 and this will be 304.
   */
  readonly statusCode: number
  /**
   * Raw response header text as it was received over the wire. The raw text may not always be
   * available, such as in the case of HTTP/2 or QUIC.
   */
  readonly headersText?: string | undefined
  /**
   * The cookie partition key that will be used to store partitioned cookies set in this response.
   * Only sent when partitioned cookies are enabled.
   */
  readonly cookiePartitionKey?: CookiePartitionKey | undefined
  /**
   * True if partitioned cookies are enabled, but the partition key is not serializable to string.
   */
  readonly cookiePartitionKeyOpaque?: boolean | undefined
  /**
   * A list of cookies which should have been blocked by 3PCD but are exempted and stored from
   * the response with the corresponding reason.
   */
  readonly exemptedCookies?: ReadonlyArray<ExemptedSetCookieWithReason> | undefined
}

/**
 * Schema for `ResponseReceivedExtraInfoParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResponseReceivedExtraInfoParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    blockedCookies: Schema.Array(BlockedSetCookieWithReason),
    headers: Headers,
    resourceIPAddressSpace: IPAddressSpace,
    statusCode: Schema.Int,
    headersText: Schema.optional(Schema.String),
    cookiePartitionKey: Schema.optional(CookiePartitionKey),
    cookiePartitionKeyOpaque: Schema.optional(Schema.Boolean),
    exemptedCookies: Schema.optional(Schema.Array(ExemptedSetCookieWithReason))
  }).annotate({ identifier: "Network.ResponseReceivedExtraInfoParams" })
) as any as Schema.Codec<ResponseReceivedExtraInfoParams, unknown>

/**
 * Searches for given string in response content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SearchInResponseBodyParams {
  /**
   * Identifier of the network response to search.
   */
  readonly requestId: RequestId
  /**
   * String to search for.
   */
  readonly query: string
  /**
   * If true, search is case sensitive.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats string parameter as regex.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `SearchInResponseBodyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResponseBodyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    query: Schema.String,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.SearchInResponseBodyParams" })
) as any as Schema.Codec<SearchInResponseBodyParams>

/**
 * Searches for given string in response content.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SearchInResponseBodyResult {
  /**
   * List of search matches.
   */
  readonly result: ReadonlyArray<Debugger.SearchMatch>
}

/**
 * Schema for `SearchInResponseBodyResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SearchInResponseBodyResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(Debugger.SearchMatch)
  }).annotate({ identifier: "Network.SearchInResponseBodyResult" })
) as any as Schema.Codec<SearchInResponseBodyResult>

/**
 * Specifies whether to attach a page script stack id in requests
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAttachDebugStackParams {
  /**
   * Whether to attach a page script stack for debugging purpose.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetAttachDebugStackParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAttachDebugStackParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Network.SetAttachDebugStackParams" })
) as any as Schema.Codec<SetAttachDebugStackParams>

/**
 * Blocks URLs from loading.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBlockedURLsParams {
  /**
   * Patterns to match in the order in which they are given. These patterns
   * also take precedence over any wildcard patterns defined in `urls`.
   */
  readonly urlPatterns?: ReadonlyArray<BlockPattern> | undefined
}

/**
 * Schema for `SetBlockedURLsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBlockedURLsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    urlPatterns: Schema.optional(Schema.Array(BlockPattern))
  }).annotate({ identifier: "Network.SetBlockedURLsParams" })
) as any as Schema.Codec<SetBlockedURLsParams>

/**
 * Toggles ignoring of service worker for each request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetBypassServiceWorkerParams {
  /**
   * Bypass service worker and load from network.
   */
  readonly bypass: boolean
}

/**
 * Schema for `SetBypassServiceWorkerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetBypassServiceWorkerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bypass: Schema.Boolean
  }).annotate({ identifier: "Network.SetBypassServiceWorkerParams" })
) as any as Schema.Codec<SetBypassServiceWorkerParams>

/**
 * Toggles ignoring cache for each request. If `true`, cache will not be used.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCacheDisabledParams {
  /**
   * Cache disabled state.
   */
  readonly cacheDisabled: boolean
}

/**
 * Schema for `SetCacheDisabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCacheDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheDisabled: Schema.Boolean
  }).annotate({ identifier: "Network.SetCacheDisabledParams" })
) as any as Schema.Codec<SetCacheDisabledParams>

/**
 * Sets a cookie with the given cookie data; may overwrite equivalent cookies if they exist.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieParams {
  /**
   * Cookie name.
   */
  readonly name: string
  /**
   * Cookie value.
   */
  readonly value: Redacted.Redacted<string>
  /**
   * The request-URI to associate with the setting of the cookie. This value can affect the
   * default domain, path, source port, and source scheme values of the created cookie.
   */
  readonly url?: string | undefined
  /**
   * Cookie domain.
   */
  readonly domain?: string | undefined
  /**
   * Cookie path.
   */
  readonly path?: string | undefined
  /**
   * True if cookie is secure.
   */
  readonly secure?: boolean | undefined
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly?: boolean | undefined
  /**
   * Cookie SameSite type.
   */
  readonly sameSite?: CookieSameSite | undefined
  /**
   * Cookie expiration date, session cookie if not set
   */
  readonly expires?: TimeSinceEpoch | undefined
  /**
   * Cookie Priority type.
   */
  readonly priority?: CookiePriority | undefined
  /**
   * Cookie source scheme type.
   */
  readonly sourceScheme?: CookieSourceScheme | undefined
  /**
   * Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.
   * An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.
   * This is a temporary ability and it will be removed in the future.
   */
  readonly sourcePort?: number | undefined
  /**
   * Cookie partition key. If not set, the cookie will be set as not partitioned.
   */
  readonly partitionKey?: CookiePartitionKey | undefined
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
    name: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
    url: Schema.optional(Schema.String),
    domain: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    secure: Schema.optional(Schema.Boolean),
    httpOnly: Schema.optional(Schema.Boolean),
    sameSite: Schema.optional(CookieSameSite),
    expires: Schema.optional(TimeSinceEpoch),
    priority: Schema.optional(CookiePriority),
    sourceScheme: Schema.optional(CookieSourceScheme),
    sourcePort: Schema.optional(Schema.Int),
    partitionKey: Schema.optional(CookiePartitionKey)
  }).annotate({ identifier: "Network.SetCookieParams" })
) as any as Schema.Codec<SetCookieParams, unknown>

/**
 * Sets a cookie with the given cookie data; may overwrite equivalent cookies if they exist.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieResult {
}

/**
 * Schema for `SetCookieResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({}).annotate({ identifier: "Network.SetCookieResult" })
) as any as Schema.Codec<SetCookieResult>

/**
 * Sets Controls for third-party cookie access
 * Page reload is required before the new cookie behavior will be observed
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetCookieControlsParams {
  /**
   * Whether 3pc restriction is enabled.
   */
  readonly enableThirdPartyCookieRestriction: boolean
}

/**
 * Schema for `SetCookieControlsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieControlsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enableThirdPartyCookieRestriction: Schema.Boolean
  }).annotate({ identifier: "Network.SetCookieControlsParams" })
) as any as Schema.Codec<SetCookieControlsParams>

/**
 * Sets given cookies.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookiesParams {
  /**
   * Cookies to be set.
   */
  readonly cookies: ReadonlyArray<CookieParam>
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
    cookies: Schema.Array(CookieParam)
  }).annotate({ identifier: "Network.SetCookiesParams" })
) as any as Schema.Codec<SetCookiesParams, unknown>

/**
 * Specifies whether to always send extra HTTP headers with the requests from this page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetExtraHTTPHeadersParams {
  /**
   * Map with extra HTTP headers.
   */
  readonly headers: Headers
}

/**
 * Schema for `SetExtraHTTPHeadersParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetExtraHTTPHeadersParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    headers: Headers
  }).annotate({ identifier: "Network.SetExtraHTTPHeadersParams" })
) as any as Schema.Codec<SetExtraHTTPHeadersParams>

/**
 * Allows overriding user agent with the given string.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetUserAgentOverrideParams {
  /**
   * User agent to use.
   */
  readonly userAgent: string
  /**
   * Browser language to emulate.
   */
  readonly acceptLanguage?: string | undefined
  /**
   * The platform navigator.platform should return.
   */
  readonly platform?: string | undefined
  /**
   * To be sent in Sec-CH-UA-* headers and returned in navigator.userAgentData
   */
  readonly userAgentMetadata?: Emulation.UserAgentMetadata | undefined
}

/**
 * Schema for `SetUserAgentOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetUserAgentOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userAgent: Schema.String,
    acceptLanguage: Schema.optional(Schema.String),
    platform: Schema.optional(Schema.String),
    userAgentMetadata: Schema.optional(Emulation.UserAgentMetadata)
  }).annotate({ identifier: "Network.SetUserAgentOverrideParams" })
) as any as Schema.Codec<SetUserAgentOverrideParams>

/**
 * Fired when a signed exchange was received over the network
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SignedExchangeReceivedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Information about the signed exchange response.
   */
  readonly info: SignedExchangeInfo
}

/**
 * Schema for `SignedExchangeReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SignedExchangeReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    info: SignedExchangeInfo
  }).annotate({ identifier: "Network.SignedExchangeReceivedParams" })
) as any as Schema.Codec<SignedExchangeReceivedParams>

/**
 * Enables streaming of the response for the given requestId.
 * If enabled, the dataReceived event contains the data that was received during streaming.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StreamResourceContentParams {
  /**
   * Identifier of the request to stream.
   */
  readonly requestId: RequestId
}

/**
 * Schema for `StreamResourceContentParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StreamResourceContentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Network.StreamResourceContentParams" })
) as any as Schema.Codec<StreamResourceContentParams>

/**
 * Enables streaming of the response for the given requestId.
 * If enabled, the dataReceived event contains the data that was received during streaming.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StreamResourceContentResult {
  /**
   * Data that has been buffered until streaming is enabled. (Encoded as a base64 string when passed over JSON)
   */
  readonly bufferedData: string
}

/**
 * Schema for `StreamResourceContentResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StreamResourceContentResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bufferedData: Schema.String
  }).annotate({ identifier: "Network.StreamResourceContentResult" })
) as any as Schema.Codec<StreamResourceContentResult>

/**
 * Fired exactly once for each Trust Token operation. Depending on
 * the type of the operation and whether the operation succeeded or
 * failed, the event is fired before the corresponding request was sent
 * or after the response was received.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrustTokenOperationDoneParams {
  /**
   * Detailed success or error status of the operation.
   * 'AlreadyExists' also signifies a successful operation, as the result
   * of the operation already exists und thus, the operation was abort
   * preemptively (e.g. a cache hit).
   */
  readonly status: TrustTokenOperationDoneParamsStatus
  readonly type: TrustTokenOperationType
  readonly requestId: RequestId
  /**
   * Top level origin. The context in which the operation was attempted.
   */
  readonly topLevelOrigin?: string | undefined
  /**
   * Origin of the issuer in case of a "Issuance" or "Redemption" operation.
   */
  readonly issuerOrigin?: string | undefined
  /**
   * The number of obtained Trust Tokens on a successful "Issuance" operation.
   */
  readonly issuedTokenCount?: number | undefined
}

/**
 * Schema for `TrustTokenOperationDoneParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrustTokenOperationDoneParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    status: TrustTokenOperationDoneParamsStatus,
    type: TrustTokenOperationType,
    requestId: RequestId,
    topLevelOrigin: Schema.optional(Schema.String),
    issuerOrigin: Schema.optional(Schema.String),
    issuedTokenCount: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Network.TrustTokenOperationDoneParams" })
) as any as Schema.Codec<TrustTokenOperationDoneParams>

/**
 * Detailed success or error status of the operation.
 * 'AlreadyExists' also signifies a successful operation, as the result
 * of the operation already exists und thus, the operation was abort
 * preemptively (e.g. a cache hit).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TrustTokenOperationDoneParamsStatus =
  | "Ok"
  | "InvalidArgument"
  | "MissingIssuerKeys"
  | "FailedPrecondition"
  | "ResourceExhausted"
  | "AlreadyExists"
  | "ResourceLimited"
  | "Unauthorized"
  | "BadResponse"
  | "InternalError"
  | "UnknownError"
  | "FulfilledLocally"
  | "SiteIssuerLimit"
  | (string & {})

/**
 * Schema for `TrustTokenOperationDoneParamsStatus`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrustTokenOperationDoneParamsStatus = Schema.String as any as Schema.Codec<
  TrustTokenOperationDoneParamsStatus
>

/**
 * Fired when WebSocket is closed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketClosedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `WebSocketClosedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketClosedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.WebSocketClosedParams" })
) as any as Schema.Codec<WebSocketClosedParams>

/**
 * Fired upon WebSocket creation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketCreatedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * WebSocket request URL.
   */
  readonly url: string
  /**
   * Request initiator.
   */
  readonly initiator?: Initiator | undefined
}

/**
 * Schema for `WebSocketCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    url: Schema.String,
    initiator: Schema.optional(Initiator)
  }).annotate({ identifier: "Network.WebSocketCreatedParams" })
) as any as Schema.Codec<WebSocketCreatedParams, unknown>

/**
 * Fired when WebSocket message error occurs.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketFrameErrorParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * WebSocket error message.
   */
  readonly errorMessage: string
}

/**
 * Schema for `WebSocketFrameErrorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketFrameErrorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    errorMessage: Schema.String
  }).annotate({ identifier: "Network.WebSocketFrameErrorParams" })
) as any as Schema.Codec<WebSocketFrameErrorParams>

/**
 * Fired when WebSocket message is received.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketFrameReceivedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * WebSocket response data.
   */
  readonly response: WebSocketFrame
}

/**
 * Schema for `WebSocketFrameReceivedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketFrameReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    response: WebSocketFrame
  }).annotate({ identifier: "Network.WebSocketFrameReceivedParams" })
) as any as Schema.Codec<WebSocketFrameReceivedParams>

/**
 * Fired when WebSocket message is sent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketFrameSentParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * WebSocket response data.
   */
  readonly response: WebSocketFrame
}

/**
 * Schema for `WebSocketFrameSentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketFrameSentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    response: WebSocketFrame
  }).annotate({ identifier: "Network.WebSocketFrameSentParams" })
) as any as Schema.Codec<WebSocketFrameSentParams>

/**
 * Fired when WebSocket handshake response becomes available.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketHandshakeResponseReceivedParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * WebSocket response data.
   */
  readonly response: WebSocketResponse
}

/**
 * Schema for `WebSocketHandshakeResponseReceivedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketHandshakeResponseReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    response: WebSocketResponse
  }).annotate({ identifier: "Network.WebSocketHandshakeResponseReceivedParams" })
) as any as Schema.Codec<WebSocketHandshakeResponseReceivedParams>

/**
 * Fired when WebSocket is about to initiate handshake.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketWillSendHandshakeRequestParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * UTC Timestamp.
   */
  readonly wallTime: TimeSinceEpoch
  /**
   * WebSocket request data.
   */
  readonly request: WebSocketRequest
}

/**
 * Schema for `WebSocketWillSendHandshakeRequestParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketWillSendHandshakeRequestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    timestamp: MonotonicTime,
    wallTime: TimeSinceEpoch,
    request: WebSocketRequest
  }).annotate({ identifier: "Network.WebSocketWillSendHandshakeRequestParams" })
) as any as Schema.Codec<WebSocketWillSendHandshakeRequestParams>

/**
 * Fired when WebTransport is disposed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebTransportClosedParams {
  /**
   * WebTransport identifier.
   */
  readonly transportId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `WebTransportClosedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebTransportClosedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    transportId: RequestId,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.WebTransportClosedParams" })
) as any as Schema.Codec<WebTransportClosedParams>

/**
 * Fired when WebTransport handshake is finished.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebTransportConnectionEstablishedParams {
  /**
   * WebTransport identifier.
   */
  readonly transportId: RequestId
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
}

/**
 * Schema for `WebTransportConnectionEstablishedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebTransportConnectionEstablishedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    transportId: RequestId,
    timestamp: MonotonicTime
  }).annotate({ identifier: "Network.WebTransportConnectionEstablishedParams" })
) as any as Schema.Codec<WebTransportConnectionEstablishedParams>

/**
 * Fired upon WebTransport creation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebTransportCreatedParams {
  /**
   * WebTransport identifier.
   */
  readonly transportId: RequestId
  /**
   * WebTransport request URL.
   */
  readonly url: string
  /**
   * Timestamp.
   */
  readonly timestamp: MonotonicTime
  /**
   * Request initiator.
   */
  readonly initiator?: Initiator | undefined
}

/**
 * Schema for `WebTransportCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebTransportCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    transportId: RequestId,
    url: Schema.String,
    timestamp: MonotonicTime,
    initiator: Schema.optional(Initiator)
  }).annotate({ identifier: "Network.WebTransportCreatedParams" })
) as any as Schema.Codec<WebTransportCreatedParams, unknown>

/**
 * Clears browser cache.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearBrowserCache: Protocol.CommandDef<"Network.clearBrowserCache", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Network.clearBrowserCache",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Clears browser cookies.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearBrowserCookies: Protocol.CommandDef<"Network.clearBrowserCookies", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.clearBrowserCookies",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Configures storing response bodies outside of renderer, so that these survive
 * a cross-process navigation.
 * If maxTotalBufferSize is not set, durable messages are disabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const configureDurableMessages: Protocol.CommandDef<
  "Network.configureDurableMessages",
  ConfigureDurableMessagesParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.configureDurableMessages",
  ConfigureDurableMessagesParams,
  undefined,
  { status: "experimental" }
)

/**
 * Deletes browser cookies with matching name and url or domain/path/partitionKey pair.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteCookies: Protocol.CommandDef<"Network.deleteCookies", DeleteCookiesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.deleteCookies",
    DeleteCookiesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Deletes a device bound session.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const deleteDeviceBoundSession: Protocol.CommandDef<
  "Network.deleteDeviceBoundSession",
  DeleteDeviceBoundSessionParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.deleteDeviceBoundSession",
  DeleteDeviceBoundSessionParams,
  undefined,
  { status: "experimental" }
)

/**
 * Disables network tracking, prevents network events from being sent to the client.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Network.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Network.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Activates emulation of network conditions for individual requests using URL match patterns. Unlike the deprecated
 * Network.emulateNetworkConditions this method does not affect `navigator` state. Use Network.overrideNetworkState to
 * explicitly modify `navigator` behavior.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const emulateNetworkConditionsByRule: Protocol.CommandDef<
  "Network.emulateNetworkConditionsByRule",
  EmulateNetworkConditionsByRuleParams,
  EmulateNetworkConditionsByRuleResult
> = /*#__PURE__*/ Protocol.command(
  "Network.emulateNetworkConditionsByRule",
  EmulateNetworkConditionsByRuleParams,
  EmulateNetworkConditionsByRuleResult,
  { status: "experimental" }
)

/**
 * Enables network tracking, network events will now be delivered to the client.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Network.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "Network.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets up tracking device bound sessions and fetching of initial set of sessions.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enableDeviceBoundSessions: Protocol.CommandDef<
  "Network.enableDeviceBoundSessions",
  EnableDeviceBoundSessionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.enableDeviceBoundSessions",
  EnableDeviceBoundSessionsParams,
  undefined,
  { status: "experimental" }
)

/**
 * Enables tracking for the Reporting API, events generated by the Reporting API will now be delivered to the client.
 * Enabling triggers 'reportingApiReportAdded' for all existing reports.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enableReportingApi: Protocol.CommandDef<"Network.enableReportingApi", EnableReportingApiParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.enableReportingApi",
    EnableReportingApiParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Fetches the schemeful site for a specific origin.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const fetchSchemefulSite: Protocol.CommandDef<
  "Network.fetchSchemefulSite",
  FetchSchemefulSiteParams,
  FetchSchemefulSiteResult
> = /*#__PURE__*/ Protocol.command(
  "Network.fetchSchemefulSite",
  FetchSchemefulSiteParams,
  FetchSchemefulSiteResult,
  { status: "experimental" }
)

/**
 * Returns the DER-encoded certificate.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getCertificate: Protocol.CommandDef<"Network.getCertificate", GetCertificateParams, GetCertificateResult> =
  /*#__PURE__*/ Protocol.command(
    "Network.getCertificate",
    GetCertificateParams,
    GetCertificateResult,
    { status: "experimental" }
  )

/**
 * Returns all browser cookies for the current URL. Depending on the backend support, will return
 * detailed cookie information in the `cookies` field.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getCookies: Protocol.CommandDef<"Network.getCookies", GetCookiesParams, GetCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Network.getCookies",
    GetCookiesParams,
    GetCookiesResult,
    { status: "stable" }
  )

/**
 * Returns post data sent with the request. Returns an error when no data was sent with the request.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getRequestPostData: Protocol.CommandDef<
  "Network.getRequestPostData",
  GetRequestPostDataParams,
  GetRequestPostDataResult
> = /*#__PURE__*/ Protocol.command(
  "Network.getRequestPostData",
  GetRequestPostDataParams,
  GetRequestPostDataResult,
  { status: "stable" }
)

/**
 * Returns content served for the given request.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getResponseBody: Protocol.CommandDef<
  "Network.getResponseBody",
  GetResponseBodyParams,
  GetResponseBodyResult
> = /*#__PURE__*/ Protocol.command(
  "Network.getResponseBody",
  GetResponseBodyParams,
  GetResponseBodyResult,
  { status: "stable" }
)

/**
 * Returns information about the COEP/COOP isolation status.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getSecurityIsolationStatus: Protocol.CommandDef<
  "Network.getSecurityIsolationStatus",
  GetSecurityIsolationStatusParams,
  GetSecurityIsolationStatusResult
> = /*#__PURE__*/ Protocol.command(
  "Network.getSecurityIsolationStatus",
  GetSecurityIsolationStatusParams,
  GetSecurityIsolationStatusResult,
  { status: "experimental" }
)

/**
 * Fetches the resource and returns the content.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const loadNetworkResource: Protocol.CommandDef<
  "Network.loadNetworkResource",
  LoadNetworkResourceParams,
  LoadNetworkResourceResult
> = /*#__PURE__*/ Protocol.command(
  "Network.loadNetworkResource",
  LoadNetworkResourceParams,
  LoadNetworkResourceResult,
  { status: "experimental" }
)

/**
 * Override the state of navigator.onLine and navigator.connection.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const overrideNetworkState: Protocol.CommandDef<
  "Network.overrideNetworkState",
  OverrideNetworkStateParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.overrideNetworkState",
  OverrideNetworkStateParams,
  undefined,
  { status: "experimental" }
)

/**
 * This method sends a new XMLHttpRequest which is identical to the original one. The following
 * parameters should be identical: method, url, async, request body, extra headers, withCredentials
 * attribute, user, password.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const replayXHR: Protocol.CommandDef<"Network.replayXHR", ReplayXHRParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Network.replayXHR",
    ReplayXHRParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Searches for given string in response content.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const searchInResponseBody: Protocol.CommandDef<
  "Network.searchInResponseBody",
  SearchInResponseBodyParams,
  SearchInResponseBodyResult
> = /*#__PURE__*/ Protocol.command(
  "Network.searchInResponseBody",
  SearchInResponseBodyParams,
  SearchInResponseBodyResult,
  { status: "experimental" }
)

/**
 * Specifies whether to attach a page script stack id in requests
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setAttachDebugStack: Protocol.CommandDef<"Network.setAttachDebugStack", SetAttachDebugStackParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.setAttachDebugStack",
    SetAttachDebugStackParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Blocks URLs from loading.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setBlockedURLs: Protocol.CommandDef<"Network.setBlockedURLs", SetBlockedURLsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.setBlockedURLs",
    SetBlockedURLsParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Toggles ignoring of service worker for each request.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setBypassServiceWorker: Protocol.CommandDef<
  "Network.setBypassServiceWorker",
  SetBypassServiceWorkerParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setBypassServiceWorker",
  SetBypassServiceWorkerParams,
  undefined,
  { status: "stable" }
)

/**
 * Toggles ignoring cache for each request. If `true`, cache will not be used.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCacheDisabled: Protocol.CommandDef<"Network.setCacheDisabled", SetCacheDisabledParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.setCacheDisabled",
    SetCacheDisabledParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets a cookie with the given cookie data; may overwrite equivalent cookies if they exist.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCookie: Protocol.CommandDef<"Network.setCookie", SetCookieParams, SetCookieResult> =
  /*#__PURE__*/ Protocol.command(
    "Network.setCookie",
    SetCookieParams,
    SetCookieResult,
    { status: "stable" }
  )

/**
 * Sets Controls for third-party cookie access
 * Page reload is required before the new cookie behavior will be observed
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setCookieControls: Protocol.CommandDef<"Network.setCookieControls", SetCookieControlsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.setCookieControls",
    SetCookieControlsParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Sets given cookies.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCookies: Protocol.CommandDef<"Network.setCookies", SetCookiesParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Network.setCookies",
    SetCookiesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Specifies whether to always send extra HTTP headers with the requests from this page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setExtraHTTPHeaders: Protocol.CommandDef<"Network.setExtraHTTPHeaders", SetExtraHTTPHeadersParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.setExtraHTTPHeaders",
    SetExtraHTTPHeadersParams,
    undefined,
    { status: "stable" }
  )

/**
 * Allows overriding user agent with the given string.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setUserAgentOverride: Protocol.CommandDef<
  "Network.setUserAgentOverride",
  SetUserAgentOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setUserAgentOverride",
  SetUserAgentOverrideParams,
  undefined,
  { status: "stable", redirect: "Emulation" }
)

/**
 * Enables streaming of the response for the given requestId.
 * If enabled, the dataReceived event contains the data that was received during streaming.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const streamResourceContent: Protocol.CommandDef<
  "Network.streamResourceContent",
  StreamResourceContentParams,
  StreamResourceContentResult
> = /*#__PURE__*/ Protocol.command(
  "Network.streamResourceContent",
  StreamResourceContentParams,
  StreamResourceContentResult,
  { status: "experimental" }
)

/**
 * Fired when data chunk was received over the network.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const dataReceived: Protocol.EventDef<"Network.dataReceived", DataReceivedParams> = /*#__PURE__*/ Protocol.event(
  "Network.dataReceived",
  DataReceivedParams,
  { status: "stable" }
)

/**
 * Triggered when a device bound session event occurs.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const deviceBoundSessionEventOccurred: Protocol.EventDef<
  "Network.deviceBoundSessionEventOccurred",
  DeviceBoundSessionEventOccurredParams
> = /*#__PURE__*/ Protocol.event(
  "Network.deviceBoundSessionEventOccurred",
  DeviceBoundSessionEventOccurredParams,
  { status: "experimental" }
)

/**
 * Triggered when the initial set of device bound sessions is added.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const deviceBoundSessionsAdded: Protocol.EventDef<
  "Network.deviceBoundSessionsAdded",
  DeviceBoundSessionsAddedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.deviceBoundSessionsAdded",
  DeviceBoundSessionsAddedParams,
  { status: "experimental" }
)

/**
 * Fired when direct_socket.TCPSocket is aborted.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directTCPSocketAborted: Protocol.EventDef<"Network.directTCPSocketAborted", DirectTCPSocketAbortedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directTCPSocketAborted",
    DirectTCPSocketAbortedParams,
    { status: "experimental" }
  )

/**
 * Fired when data is received from tcp direct socket stream.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directTCPSocketChunkReceived: Protocol.EventDef<
  "Network.directTCPSocketChunkReceived",
  DirectTCPSocketChunkReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.directTCPSocketChunkReceived",
  DirectTCPSocketChunkReceivedParams,
  { status: "experimental" }
)

/**
 * Fired when data is sent to tcp direct socket stream.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directTCPSocketChunkSent: Protocol.EventDef<
  "Network.directTCPSocketChunkSent",
  DirectTCPSocketChunkSentParams
> = /*#__PURE__*/ Protocol.event(
  "Network.directTCPSocketChunkSent",
  DirectTCPSocketChunkSentParams,
  { status: "experimental" }
)

/**
 * Fired when direct_socket.TCPSocket is closed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directTCPSocketClosed: Protocol.EventDef<"Network.directTCPSocketClosed", DirectTCPSocketClosedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directTCPSocketClosed",
    DirectTCPSocketClosedParams,
    { status: "experimental" }
  )

/**
 * Fired upon direct_socket.TCPSocket creation.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directTCPSocketCreated: Protocol.EventDef<"Network.directTCPSocketCreated", DirectTCPSocketCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directTCPSocketCreated",
    DirectTCPSocketCreatedParams,
    { status: "experimental" }
  )

/**
 * Fired when direct_socket.TCPSocket connection is opened.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directTCPSocketOpened: Protocol.EventDef<"Network.directTCPSocketOpened", DirectTCPSocketOpenedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directTCPSocketOpened",
    DirectTCPSocketOpenedParams,
    { status: "experimental" }
  )

/**
 * Fired when direct_socket.UDPSocket is aborted.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketAborted: Protocol.EventDef<"Network.directUDPSocketAborted", DirectUDPSocketAbortedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directUDPSocketAborted",
    DirectUDPSocketAbortedParams,
    { status: "experimental" }
  )

/**
 * Fired when message is received from udp direct socket stream.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketChunkReceived: Protocol.EventDef<
  "Network.directUDPSocketChunkReceived",
  DirectUDPSocketChunkReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.directUDPSocketChunkReceived",
  DirectUDPSocketChunkReceivedParams,
  { status: "experimental" }
)

/**
 * Fired when message is sent to udp direct socket stream.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketChunkSent: Protocol.EventDef<
  "Network.directUDPSocketChunkSent",
  DirectUDPSocketChunkSentParams
> = /*#__PURE__*/ Protocol.event(
  "Network.directUDPSocketChunkSent",
  DirectUDPSocketChunkSentParams,
  { status: "experimental" }
)

/**
 * Fired when direct_socket.UDPSocket is closed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketClosed: Protocol.EventDef<"Network.directUDPSocketClosed", DirectUDPSocketClosedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directUDPSocketClosed",
    DirectUDPSocketClosedParams,
    { status: "experimental" }
  )

/**
 * Fired upon direct_socket.UDPSocket creation.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketCreated: Protocol.EventDef<"Network.directUDPSocketCreated", DirectUDPSocketCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directUDPSocketCreated",
    DirectUDPSocketCreatedParams,
    { status: "experimental" }
  )

/**
 * The `Network.directUDPSocketJoinedMulticastGroup` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketJoinedMulticastGroup: Protocol.EventDef<
  "Network.directUDPSocketJoinedMulticastGroup",
  DirectUDPSocketJoinedMulticastGroupParams
> = /*#__PURE__*/ Protocol.event(
  "Network.directUDPSocketJoinedMulticastGroup",
  DirectUDPSocketJoinedMulticastGroupParams,
  { status: "experimental" }
)

/**
 * The `Network.directUDPSocketLeftMulticastGroup` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketLeftMulticastGroup: Protocol.EventDef<
  "Network.directUDPSocketLeftMulticastGroup",
  DirectUDPSocketLeftMulticastGroupParams
> = /*#__PURE__*/ Protocol.event(
  "Network.directUDPSocketLeftMulticastGroup",
  DirectUDPSocketLeftMulticastGroupParams,
  { status: "experimental" }
)

/**
 * Fired when direct_socket.UDPSocket connection is opened.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const directUDPSocketOpened: Protocol.EventDef<"Network.directUDPSocketOpened", DirectUDPSocketOpenedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.directUDPSocketOpened",
    DirectUDPSocketOpenedParams,
    { status: "experimental" }
  )

/**
 * Fired when EventSource message is received.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const eventSourceMessageReceived: Protocol.EventDef<
  "Network.eventSourceMessageReceived",
  EventSourceMessageReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.eventSourceMessageReceived",
  EventSourceMessageReceivedParams,
  { status: "stable" }
)

/**
 * Fired when HTTP request has failed to load.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const loadingFailed: Protocol.EventDef<"Network.loadingFailed", LoadingFailedParams> = /*#__PURE__*/ Protocol
  .event(
    "Network.loadingFailed",
    LoadingFailedParams,
    { status: "stable" }
  )

/**
 * Fired when HTTP request has finished loading.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const loadingFinished: Protocol.EventDef<"Network.loadingFinished", LoadingFinishedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.loadingFinished",
    LoadingFinishedParams,
    { status: "stable" }
  )

/**
 * Fired once security policy has been updated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const policyUpdated: Protocol.EventDef<"Network.policyUpdated", void> = /*#__PURE__*/ Protocol.event(
  "Network.policyUpdated",
  undefined,
  { status: "experimental" }
)

/**
 * The `Network.reportingApiEndpointsChangedForOrigin` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const reportingApiEndpointsChangedForOrigin: Protocol.EventDef<
  "Network.reportingApiEndpointsChangedForOrigin",
  ReportingApiEndpointsChangedForOriginParams
> = /*#__PURE__*/ Protocol.event(
  "Network.reportingApiEndpointsChangedForOrigin",
  ReportingApiEndpointsChangedForOriginParams,
  { status: "experimental" }
)

/**
 * Is sent whenever a new report is added.
 * And after 'enableReportingApi' for all existing reports.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const reportingApiReportAdded: Protocol.EventDef<
  "Network.reportingApiReportAdded",
  ReportingApiReportAddedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.reportingApiReportAdded",
  ReportingApiReportAddedParams,
  { status: "experimental" }
)

/**
 * The `Network.reportingApiReportUpdated` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const reportingApiReportUpdated: Protocol.EventDef<
  "Network.reportingApiReportUpdated",
  ReportingApiReportUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.reportingApiReportUpdated",
  ReportingApiReportUpdatedParams,
  { status: "experimental" }
)

/**
 * Fired if request ended up loading from cache.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const requestServedFromCache: Protocol.EventDef<"Network.requestServedFromCache", RequestServedFromCacheParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.requestServedFromCache",
    RequestServedFromCacheParams,
    { status: "stable" }
  )

/**
 * Fired when page is about to send HTTP request.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const requestWillBeSent: Protocol.EventDef<"Network.requestWillBeSent", RequestWillBeSentParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.requestWillBeSent",
    RequestWillBeSentParams,
    { status: "stable" }
  )

/**
 * Fired when additional information about a requestWillBeSent event is available from the
 * network stack. Not every requestWillBeSent event will have an additional
 * requestWillBeSentExtraInfo fired for it, and there is no guarantee whether requestWillBeSent
 * or requestWillBeSentExtraInfo will be fired first for the same request.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const requestWillBeSentExtraInfo: Protocol.EventDef<
  "Network.requestWillBeSentExtraInfo",
  RequestWillBeSentExtraInfoParams
> = /*#__PURE__*/ Protocol.event(
  "Network.requestWillBeSentExtraInfo",
  RequestWillBeSentExtraInfoParams,
  { status: "experimental" }
)

/**
 * Fired when resource loading priority is changed
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const resourceChangedPriority: Protocol.EventDef<
  "Network.resourceChangedPriority",
  ResourceChangedPriorityParams
> = /*#__PURE__*/ Protocol.event(
  "Network.resourceChangedPriority",
  ResourceChangedPriorityParams,
  { status: "experimental" }
)

/**
 * Fired when HTTP response is available.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const responseReceived: Protocol.EventDef<"Network.responseReceived", ResponseReceivedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.responseReceived",
    ResponseReceivedParams,
    { status: "stable" }
  )

/**
 * Fired when 103 Early Hints headers is received in addition to the common response.
 * Not every responseReceived event will have an responseReceivedEarlyHints fired.
 * Only one responseReceivedEarlyHints may be fired for eached responseReceived event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const responseReceivedEarlyHints: Protocol.EventDef<
  "Network.responseReceivedEarlyHints",
  ResponseReceivedEarlyHintsParams
> = /*#__PURE__*/ Protocol.event(
  "Network.responseReceivedEarlyHints",
  ResponseReceivedEarlyHintsParams,
  { status: "experimental" }
)

/**
 * Fired when additional information about a responseReceived event is available from the network
 * stack. Not every responseReceived event will have an additional responseReceivedExtraInfo for
 * it, and responseReceivedExtraInfo may be fired before or after responseReceived.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const responseReceivedExtraInfo: Protocol.EventDef<
  "Network.responseReceivedExtraInfo",
  ResponseReceivedExtraInfoParams
> = /*#__PURE__*/ Protocol.event(
  "Network.responseReceivedExtraInfo",
  ResponseReceivedExtraInfoParams,
  { status: "experimental" }
)

/**
 * Fired when a signed exchange was received over the network
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const signedExchangeReceived: Protocol.EventDef<"Network.signedExchangeReceived", SignedExchangeReceivedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.signedExchangeReceived",
    SignedExchangeReceivedParams,
    { status: "experimental" }
  )

/**
 * Fired exactly once for each Trust Token operation. Depending on
 * the type of the operation and whether the operation succeeded or
 * failed, the event is fired before the corresponding request was sent
 * or after the response was received.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const trustTokenOperationDone: Protocol.EventDef<
  "Network.trustTokenOperationDone",
  TrustTokenOperationDoneParams
> = /*#__PURE__*/ Protocol.event(
  "Network.trustTokenOperationDone",
  TrustTokenOperationDoneParams,
  { status: "experimental" }
)

/**
 * Fired when WebSocket is closed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketClosed: Protocol.EventDef<"Network.webSocketClosed", WebSocketClosedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webSocketClosed",
    WebSocketClosedParams,
    { status: "stable" }
  )

/**
 * Fired upon WebSocket creation.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketCreated: Protocol.EventDef<"Network.webSocketCreated", WebSocketCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webSocketCreated",
    WebSocketCreatedParams,
    { status: "stable" }
  )

/**
 * Fired when WebSocket message error occurs.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketFrameError: Protocol.EventDef<"Network.webSocketFrameError", WebSocketFrameErrorParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webSocketFrameError",
    WebSocketFrameErrorParams,
    { status: "stable" }
  )

/**
 * Fired when WebSocket message is received.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketFrameReceived: Protocol.EventDef<"Network.webSocketFrameReceived", WebSocketFrameReceivedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webSocketFrameReceived",
    WebSocketFrameReceivedParams,
    { status: "stable" }
  )

/**
 * Fired when WebSocket message is sent.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketFrameSent: Protocol.EventDef<"Network.webSocketFrameSent", WebSocketFrameSentParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webSocketFrameSent",
    WebSocketFrameSentParams,
    { status: "stable" }
  )

/**
 * Fired when WebSocket handshake response becomes available.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketHandshakeResponseReceived: Protocol.EventDef<
  "Network.webSocketHandshakeResponseReceived",
  WebSocketHandshakeResponseReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.webSocketHandshakeResponseReceived",
  WebSocketHandshakeResponseReceivedParams,
  { status: "stable" }
)

/**
 * Fired when WebSocket is about to initiate handshake.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webSocketWillSendHandshakeRequest: Protocol.EventDef<
  "Network.webSocketWillSendHandshakeRequest",
  WebSocketWillSendHandshakeRequestParams
> = /*#__PURE__*/ Protocol.event(
  "Network.webSocketWillSendHandshakeRequest",
  WebSocketWillSendHandshakeRequestParams,
  { status: "stable" }
)

/**
 * Fired when WebTransport is disposed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webTransportClosed: Protocol.EventDef<"Network.webTransportClosed", WebTransportClosedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webTransportClosed",
    WebTransportClosedParams,
    { status: "stable" }
  )

/**
 * Fired when WebTransport handshake is finished.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webTransportConnectionEstablished: Protocol.EventDef<
  "Network.webTransportConnectionEstablished",
  WebTransportConnectionEstablishedParams
> = /*#__PURE__*/ Protocol.event(
  "Network.webTransportConnectionEstablished",
  WebTransportConnectionEstablishedParams,
  { status: "stable" }
)

/**
 * Fired upon WebTransport creation.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const webTransportCreated: Protocol.EventDef<"Network.webTransportCreated", WebTransportCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.webTransportCreated",
    WebTransportCreatedParams,
    { status: "stable" }
  )
