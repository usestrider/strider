/**
 * Audits domain allows investigation of page violations and possible improvements.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Information about a cookie that is affected by an inspector issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AffectedCookie {
  /**
   * The following three properties uniquely identify a cookie
   */
  readonly name: string
  readonly path: string
  readonly domain: string
}

/**
 * Schema for `AffectedCookie`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AffectedCookie = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    domain: Schema.String
  }).annotate({ identifier: "Audits.AffectedCookie" })
) as any as Schema.Codec<AffectedCookie>

/**
 * Information about the frame affected by an inspector issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AffectedFrame {
  readonly frameId: Page.FrameId
}

/**
 * Schema for `AffectedFrame`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AffectedFrame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId
  }).annotate({ identifier: "Audits.AffectedFrame" })
) as any as Schema.Codec<AffectedFrame>

/**
 * Information about a request that is affected by an inspector issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AffectedRequest {
  /**
   * The unique request id.
   */
  readonly requestId?: Network.RequestId | undefined
  readonly url: string
}

/**
 * Schema for `AffectedRequest`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AffectedRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.optional(Network.RequestId),
    url: Schema.String
  }).annotate({ identifier: "Audits.AffectedRequest" })
) as any as Schema.Codec<AffectedRequest>

/**
 * Details for a request that has been blocked with the BLOCKED_BY_RESPONSE
 * code. Currently only used for COEP/COOP, but may be extended to include
 * some CSP errors in the future.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BlockedByResponseIssueDetails {
  readonly request: AffectedRequest
  readonly parentFrame?: AffectedFrame | undefined
  readonly blockedFrame?: AffectedFrame | undefined
  readonly reason: BlockedByResponseReason
}

/**
 * Schema for `BlockedByResponseIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BlockedByResponseIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: AffectedRequest,
    parentFrame: Schema.optional(AffectedFrame),
    blockedFrame: Schema.optional(AffectedFrame),
    reason: BlockedByResponseReason
  }).annotate({ identifier: "Audits.BlockedByResponseIssueDetails" })
) as any as Schema.Codec<BlockedByResponseIssueDetails>

/**
 * Enum indicating the reason a response has been blocked. These reasons are
 * refinements of the net error BLOCKED_BY_RESPONSE.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type BlockedByResponseReason =
  | "CoepFrameResourceNeedsCoepHeader"
  | "CoopSandboxedIFrameCannotNavigateToCoopPage"
  | "CorpNotSameOrigin"
  | "CorpNotSameOriginAfterDefaultedToSameOriginByCoep"
  | "CorpNotSameOriginAfterDefaultedToSameOriginByDip"
  | "CorpNotSameOriginAfterDefaultedToSameOriginByCoepAndDip"
  | "CorpNotSameSite"
  | "SRIMessageSignatureMismatch"
  | (string & {})

/**
 * Schema for `BlockedByResponseReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BlockedByResponseReason = Schema.String as any as Schema.Codec<BlockedByResponseReason>

/**
 * This issue warns about sites in the redirect chain of a finished navigation
 * that may be flagged as trackers and have their state cleared if they don't
 * receive a user interaction. Note that in this context 'site' means eTLD+1.
 * For example, if the URL `https://example.test:80/bounce` was in the
 * redirect chain, the site reported would be `example.test`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BounceTrackingIssueDetails {
  readonly trackingSites: ReadonlyArray<string>
}

/**
 * Schema for `BounceTrackingIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BounceTrackingIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    trackingSites: Schema.Array(Schema.String)
  }).annotate({ identifier: "Audits.BounceTrackingIssueDetails" })
) as any as Schema.Codec<BounceTrackingIssueDetails>

/**
 * This issue tracks client hints related issues. It's used to deprecate old
 * features, encourage the use of new ones, and provide general guidance.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClientHintIssueDetails {
  readonly sourceCodeLocation: SourceCodeLocation
  readonly clientHintIssueReason: ClientHintIssueReason
}

/**
 * Schema for `ClientHintIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClientHintIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceCodeLocation: SourceCodeLocation,
    clientHintIssueReason: ClientHintIssueReason
  }).annotate({ identifier: "Audits.ClientHintIssueDetails" })
) as any as Schema.Codec<ClientHintIssueDetails>

/**
 * `ClientHintIssueReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ClientHintIssueReason =
  | "MetaTagAllowListInvalidOrigin"
  | "MetaTagModifiedHTML"
  | (string & {})

/**
 * Schema for `ClientHintIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClientHintIssueReason = Schema.String as any as Schema.Codec<ClientHintIssueReason>

/**
 * `ConnectionAllowlistError` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ConnectionAllowlistError =
  | "InvalidHeader"
  | "MoreThanOneList"
  | "ItemNotInnerList"
  | "InvalidAllowlistItemType"
  | "ReportingEndpointNotToken"
  | "InvalidUrlPattern"
  | "IFrameAttributeLoosensEmbeddingRequirement"
  | "InvalidAllowConnectionAllowlistFrom"
  | "EmbeddingRequirementNotSatisfied"
  | (string & {})

/**
 * Schema for `ConnectionAllowlistError`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ConnectionAllowlistError = Schema.String as any as Schema.Codec<ConnectionAllowlistError>

/**
 * `ConnectionAllowlistIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ConnectionAllowlistIssueDetails {
  readonly error: ConnectionAllowlistError
  readonly request: AffectedRequest
}

/**
 * Schema for `ConnectionAllowlistIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ConnectionAllowlistIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    error: ConnectionAllowlistError,
    request: AffectedRequest
  }).annotate({ identifier: "Audits.ConnectionAllowlistIssueDetails" })
) as any as Schema.Codec<ConnectionAllowlistIssueDetails>

/**
 * `ContentSecurityPolicyIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContentSecurityPolicyIssueDetails {
  /**
   * The url not included in allowed sources.
   */
  readonly blockedURL?: string | undefined
  /**
   * Specific directive that is violated, causing the CSP issue.
   */
  readonly violatedDirective: string
  readonly isReportOnly: boolean
  readonly contentSecurityPolicyViolationType: ContentSecurityPolicyViolationType
  readonly frameAncestor?: AffectedFrame | undefined
  readonly sourceCodeLocation?: SourceCodeLocation | undefined
  readonly violatingNodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `ContentSecurityPolicyIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContentSecurityPolicyIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    blockedURL: Schema.optional(Schema.String),
    violatedDirective: Schema.String,
    isReportOnly: Schema.Boolean,
    contentSecurityPolicyViolationType: ContentSecurityPolicyViolationType,
    frameAncestor: Schema.optional(AffectedFrame),
    sourceCodeLocation: Schema.optional(SourceCodeLocation),
    violatingNodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "Audits.ContentSecurityPolicyIssueDetails" })
) as any as Schema.Codec<ContentSecurityPolicyIssueDetails>

/**
 * `ContentSecurityPolicyViolationType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ContentSecurityPolicyViolationType =
  | "kInlineViolation"
  | "kEvalViolation"
  | "kURLViolation"
  | "kSRIViolation"
  | "kTrustedTypesSinkViolation"
  | "kTrustedTypesPolicyViolation"
  | "kWasmEvalViolation"
  | (string & {})

/**
 * Schema for `ContentSecurityPolicyViolationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContentSecurityPolicyViolationType = Schema.String as any as Schema.Codec<
  ContentSecurityPolicyViolationType
>

/**
 * This issue warns about third-party sites that are accessing cookies on the
 * current page, and have been permitted due to having a global metadata grant.
 * Note that in this context 'site' means eTLD+1. For example, if the URL
 * `https://example.test:80/web_page` was accessing cookies, the site reported
 * would be `example.test`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CookieDeprecationMetadataIssueDetails {
  readonly allowedSites: ReadonlyArray<string>
  readonly optOutPercentage: number
  readonly isOptOutTopLevel: boolean
  readonly operation: CookieOperation
}

/**
 * Schema for `CookieDeprecationMetadataIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieDeprecationMetadataIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    allowedSites: Schema.Array(Schema.String),
    optOutPercentage: Schema.Number,
    isOptOutTopLevel: Schema.Boolean,
    operation: CookieOperation
  }).annotate({ identifier: "Audits.CookieDeprecationMetadataIssueDetails" })
) as any as Schema.Codec<CookieDeprecationMetadataIssueDetails>

/**
 * `CookieExclusionReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookieExclusionReason =
  | "ExcludeSameSiteUnspecifiedTreatedAsLax"
  | "ExcludeSameSiteNoneInsecure"
  | "ExcludeSameSiteLax"
  | "ExcludeSameSiteStrict"
  | "ExcludeDomainNonASCII"
  | "ExcludeThirdPartyCookieBlockedInFirstPartySet"
  | "ExcludeThirdPartyPhaseout"
  | "ExcludePortMismatch"
  | "ExcludeSchemeMismatch"
  | (string & {})

/**
 * Schema for `CookieExclusionReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieExclusionReason = Schema.String as any as Schema.Codec<CookieExclusionReason>

/**
 * This information is currently necessary, as the front-end has a difficult
 * time finding a specific cookie. With this, we can convey specific error
 * information without the cookie.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CookieIssueDetails {
  /**
   * If AffectedCookie is not set then rawCookieLine contains the raw
   * Set-Cookie header string. This hints at a problem where the
   * cookie line is syntactically or semantically malformed in a way
   * that no valid cookie could be created.
   */
  readonly cookie?: AffectedCookie | undefined
  readonly rawCookieLine?: string | undefined
  readonly cookieWarningReasons: ReadonlyArray<CookieWarningReason>
  readonly cookieExclusionReasons: ReadonlyArray<CookieExclusionReason>
  /**
   * Optionally identifies the site-for-cookies and the cookie url, which
   * may be used by the front-end as additional context.
   */
  readonly operation: CookieOperation
  readonly siteForCookies?: string | undefined
  readonly cookieUrl?: string | undefined
  readonly request?: AffectedRequest | undefined
  /**
   * The recommended solution to the issue.
   */
  readonly insight?: CookieIssueInsight | undefined
}

/**
 * Schema for `CookieIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookie: Schema.optional(AffectedCookie),
    rawCookieLine: Schema.optional(Schema.String),
    cookieWarningReasons: Schema.Array(CookieWarningReason),
    cookieExclusionReasons: Schema.Array(CookieExclusionReason),
    operation: CookieOperation,
    siteForCookies: Schema.optional(Schema.String),
    cookieUrl: Schema.optional(Schema.String),
    request: Schema.optional(AffectedRequest),
    insight: Schema.optional(CookieIssueInsight)
  }).annotate({ identifier: "Audits.CookieIssueDetails" })
) as any as Schema.Codec<CookieIssueDetails>

/**
 * Information about the suggested solution to a cookie issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CookieIssueInsight {
  readonly type: InsightType
  /**
   * Link to table entry in third-party cookie migration readiness list.
   */
  readonly tableEntryUrl?: string | undefined
}

/**
 * Schema for `CookieIssueInsight`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieIssueInsight = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: InsightType,
    tableEntryUrl: Schema.optional(Schema.String)
  }).annotate({ identifier: "Audits.CookieIssueInsight" })
) as any as Schema.Codec<CookieIssueInsight>

/**
 * `CookieOperation` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookieOperation =
  | "SetCookie"
  | "ReadCookie"
  | (string & {})

/**
 * Schema for `CookieOperation`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieOperation = Schema.String as any as Schema.Codec<CookieOperation>

/**
 * `CookieWarningReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CookieWarningReason =
  | "WarnSameSiteUnspecifiedCrossSiteContext"
  | "WarnSameSiteNoneInsecure"
  | "WarnSameSiteUnspecifiedLaxAllowUnsafe"
  | "WarnSameSiteStrictLaxDowngradeStrict"
  | "WarnSameSiteStrictCrossDowngradeStrict"
  | "WarnSameSiteStrictCrossDowngradeLax"
  | "WarnSameSiteLaxCrossDowngradeStrict"
  | "WarnSameSiteLaxCrossDowngradeLax"
  | "WarnAttributeValueExceedsMaxSize"
  | "WarnDomainNonASCII"
  | "WarnThirdPartyPhaseout"
  | "WarnCrossSiteRedirectDowngradeChangesInclusion"
  | "WarnDeprecationTrialMetadata"
  | "WarnThirdPartyCookieHeuristic"
  | (string & {})

/**
 * Schema for `CookieWarningReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CookieWarningReason = Schema.String as any as Schema.Codec<CookieWarningReason>

/**
 * Details for a CORS related issue, e.g. a warning or error related to
 * CORS RFC1918 enforcement.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CorsIssueDetails {
  readonly corsErrorStatus: Network.CorsErrorStatus
  readonly isWarning: boolean
  readonly request: AffectedRequest
  readonly location?: SourceCodeLocation | undefined
  readonly initiatorOrigin?: string | undefined
  readonly resourceIPAddressSpace?: Network.IPAddressSpace | undefined
  readonly clientSecurityState?: Network.ClientSecurityState | undefined
}

/**
 * Schema for `CorsIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CorsIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    corsErrorStatus: Network.CorsErrorStatus,
    isWarning: Schema.Boolean,
    request: AffectedRequest,
    location: Schema.optional(SourceCodeLocation),
    initiatorOrigin: Schema.optional(Schema.String),
    resourceIPAddressSpace: Schema.optional(Network.IPAddressSpace),
    clientSecurityState: Schema.optional(Network.ClientSecurityState)
  }).annotate({ identifier: "Audits.CorsIssueDetails" })
) as any as Schema.Codec<CorsIssueDetails>

/**
 * This issue tracks information needed to print a deprecation message.
 * https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/frame/third_party/blink/renderer/core/frame/deprecation/README.md
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeprecationIssueDetails {
  readonly affectedFrame?: AffectedFrame | undefined
  readonly sourceCodeLocation: SourceCodeLocation
  /**
   * One of the deprecation names from third_party/blink/renderer/core/frame/deprecation/deprecation.json5
   */
  readonly type: string
}

/**
 * Schema for `DeprecationIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeprecationIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    affectedFrame: Schema.optional(AffectedFrame),
    sourceCodeLocation: SourceCodeLocation,
    type: Schema.String
  }).annotate({ identifier: "Audits.DeprecationIssueDetails" })
) as any as Schema.Codec<DeprecationIssueDetails>

/**
 * This issue warns about errors in the select or summary element content model.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ElementAccessibilityIssueDetails {
  readonly nodeId: DOM.BackendNodeId
  readonly elementAccessibilityIssueReason: ElementAccessibilityIssueReason
  readonly hasDisallowedAttributes: boolean
}

/**
 * Schema for `ElementAccessibilityIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ElementAccessibilityIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.BackendNodeId,
    elementAccessibilityIssueReason: ElementAccessibilityIssueReason,
    hasDisallowedAttributes: Schema.Boolean
  }).annotate({ identifier: "Audits.ElementAccessibilityIssueDetails" })
) as any as Schema.Codec<ElementAccessibilityIssueDetails>

/**
 * `ElementAccessibilityIssueReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ElementAccessibilityIssueReason =
  | "DisallowedSelectChild"
  | "DisallowedOptGroupChild"
  | "NonPhrasingContentOptionChild"
  | "InteractiveContentOptionChild"
  | "InteractiveContentLegendChild"
  | "InteractiveContentSummaryDescendant"
  | (string & {})

/**
 * Schema for `ElementAccessibilityIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ElementAccessibilityIssueReason = Schema.String as any as Schema.Codec<ElementAccessibilityIssueReason>

/**
 * `EmailVerificationRequestIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EmailVerificationRequestIssueDetails {
  readonly emailVerificationRequestIssueReason: EmailVerificationRequestIssueReason
}

/**
 * Schema for `EmailVerificationRequestIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EmailVerificationRequestIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    emailVerificationRequestIssueReason: EmailVerificationRequestIssueReason
  }).annotate({ identifier: "Audits.EmailVerificationRequestIssueDetails" })
) as any as Schema.Codec<EmailVerificationRequestIssueDetails>

/**
 * Represents the failure reason when an email verification request fails.
 * Should be updated alongside EmailVerificationRequestResult in
 * third_party/blink/public/mojom/devtools/inspector_issue.mojom.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type EmailVerificationRequestIssueReason =
  | "InvalidEmail"
  | "DnsFetchFailed"
  | "DnsInvalidRecord"
  | "WellKnownHttpNotFound"
  | "WellKnownNoResponse"
  | "WellKnownInvalidResponse"
  | "WellKnownListEmpty"
  | "WellKnownInvalidContentType"
  | "WellKnownMissingIssuanceEndpoint"
  | "WellKnownIssuanceEndpointCrossOrigin"
  | "WellKnownUnsupportedSigningAlgorithm"
  | "TokenHttpNotFound"
  | "TokenNoResponse"
  | "TokenInvalidResponse"
  | "TokenInvalidContentType"
  | "TokenMalformedSdJwt"
  | "TokenInvalidSdJwt"
  | "KeyBindingSigningFailed"
  | "RpOriginIsOpaque"
  | "WellKnownMissingAccountsEndpoint"
  | "UserLoggedOut"
  | "WellKnownAccountsEndpointCrossOrigin"
  | "AccountsHttpNotFound"
  | "AccountsNoResponse"
  | "AccountsInvalidResponse"
  | "AccountsInvalidContentType"
  | "AccountsEmptyList"
  | "EmailVerificationWellKnownHttpNotFound"
  | "EmailVerificationWellKnownNoResponse"
  | "EmailVerificationWellKnownInvalidResponse"
  | "EmailVerificationWellKnownInvalidContentType"
  | "JwksHttpNotFound"
  | "JwksInvalidResponse"
  | "TokenVerificationSdJwtUnsupportedHeaderAlg"
  | "TokenVerificationSdJwtInvalidTyp"
  | "TokenVerificationSdJwtMissingIss"
  | "TokenVerificationSdJwtMissingIat"
  | "TokenVerificationSdJwtMissingCnf"
  | "TokenVerificationSdJwtMissingEmail"
  | "TokenVerificationSdJwtInvalidIssuedAt"
  | "TokenVerificationSdJwtInvalidIssuer"
  | "TokenVerificationSdJwtJwksMissingKeys"
  | "TokenVerificationSdJwtSignatureFailed"
  | "TokenVerificationSdJwtInvalidEmailVerified"
  | "TokenVerificationSdJwtInvalidEmail"
  | "TokenVerificationSdJwtInvalidHolderKey"
  | "TokenVerificationKbInvalidTyp"
  | "TokenVerificationKbMissingAud"
  | "TokenVerificationKbMissingNonce"
  | "TokenVerificationKbMissingIat"
  | "TokenVerificationKbMissingSdHash"
  | "TokenVerificationKbInvalidIssuedAt"
  | "TokenVerificationKbInvalidAudience"
  | "TokenVerificationKbInvalidNonce"
  | "TokenVerificationKbInvalidSdHash"
  | "TokenVerificationKbMissingCnf"
  | "TokenVerificationKbSignatureFailed"
  | "CrossOriginIframeNotSupported"
  | (string & {})

/**
 * Schema for `EmailVerificationRequestIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EmailVerificationRequestIssueReason = Schema.String as any as Schema.Codec<
  EmailVerificationRequestIssueReason
>

/**
 * `FailedRequestInfo`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FailedRequestInfo {
  /**
   * The URL that failed to load.
   */
  readonly url: string
  /**
   * The failure message for the failed request.
   */
  readonly failureMessage: string
  readonly requestId?: Network.RequestId | undefined
}

/**
 * Schema for `FailedRequestInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FailedRequestInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    failureMessage: Schema.String,
    requestId: Schema.optional(Network.RequestId)
  }).annotate({ identifier: "Audits.FailedRequestInfo" })
) as any as Schema.Codec<FailedRequestInfo>

/**
 * `FederatedAuthRequestIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FederatedAuthRequestIssueDetails {
  readonly federatedAuthRequestIssueReason: FederatedAuthRequestIssueReason
}

/**
 * Schema for `FederatedAuthRequestIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FederatedAuthRequestIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    federatedAuthRequestIssueReason: FederatedAuthRequestIssueReason
  }).annotate({ identifier: "Audits.FederatedAuthRequestIssueDetails" })
) as any as Schema.Codec<FederatedAuthRequestIssueDetails>

/**
 * Represents the failure reason when a federated authentication reason fails.
 * Should be updated alongside RequestIdTokenStatus in
 * third_party/blink/public/mojom/devtools/inspector_issue.mojom to include
 * all cases except for success.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type FederatedAuthRequestIssueReason =
  | "ShouldEmbargo"
  | "TooManyRequests"
  | "WellKnownHttpNotFound"
  | "WellKnownNoResponse"
  | "WellKnownBlockedByConnectionAllowlist"
  | "WellKnownInvalidResponse"
  | "WellKnownListEmpty"
  | "WellKnownInvalidContentType"
  | "ConfigNotInWellKnown"
  | "WellKnownTooBig"
  | "ConfigHttpNotFound"
  | "ConfigNoResponse"
  | "ConfigBlockedByConnectionAllowlist"
  | "ConfigInvalidResponse"
  | "ConfigInvalidContentType"
  | "IdpNotPotentiallyTrustworthy"
  | "DisabledInSettings"
  | "DisabledInFlags"
  | "ErrorFetchingSignin"
  | "InvalidSigninResponse"
  | "AccountsHttpNotFound"
  | "AccountsNoResponse"
  | "AccountsBlockedByConnectionAllowlist"
  | "AccountsInvalidResponse"
  | "AccountsListEmpty"
  | "AccountsInvalidContentType"
  | "IdTokenHttpNotFound"
  | "IdTokenNoResponse"
  | "IdTokenBlockedByConnectionAllowlist"
  | "IdTokenInvalidResponse"
  | "IdTokenIdpErrorResponse"
  | "IdTokenCrossSiteIdpErrorResponse"
  | "IdTokenInvalidRequest"
  | "IdTokenInvalidContentType"
  | "ErrorIdToken"
  | "Canceled"
  | "RpPageNotVisible"
  | "SilentMediationFailure"
  | "NotSignedInWithIdp"
  | "MissingTransientUserActivation"
  | "ReplacedByActiveMode"
  | "RelyingPartyOriginIsOpaque"
  | "TypeNotMatching"
  | "UiDismissedNoEmbargo"
  | "CorsError"
  | "SuppressedBySegmentationPlatform"
  | "PopupBlockedByConnectionAllowlist"
  | (string & {})

/**
 * Schema for `FederatedAuthRequestIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FederatedAuthRequestIssueReason = Schema.String as any as Schema.Codec<FederatedAuthRequestIssueReason>

/**
 * `FederatedAuthUserInfoRequestIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FederatedAuthUserInfoRequestIssueDetails {
  readonly federatedAuthUserInfoRequestIssueReason: FederatedAuthUserInfoRequestIssueReason
}

/**
 * Schema for `FederatedAuthUserInfoRequestIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FederatedAuthUserInfoRequestIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    federatedAuthUserInfoRequestIssueReason: FederatedAuthUserInfoRequestIssueReason
  }).annotate({ identifier: "Audits.FederatedAuthUserInfoRequestIssueDetails" })
) as any as Schema.Codec<FederatedAuthUserInfoRequestIssueDetails>

/**
 * Represents the failure reason when a getUserInfo() call fails.
 * Should be updated alongside FederatedAuthUserInfoRequestResult in
 * third_party/blink/public/mojom/devtools/inspector_issue.mojom.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type FederatedAuthUserInfoRequestIssueReason =
  | "NotSameOrigin"
  | "NotIframe"
  | "NotPotentiallyTrustworthy"
  | "NoApiPermission"
  | "NotSignedInWithIdp"
  | "NoAccountSharingPermission"
  | "InvalidConfigOrWellKnown"
  | "InvalidAccountsResponse"
  | "NoReturningUserFromFetchedAccounts"
  | (string & {})

/**
 * Schema for `FederatedAuthUserInfoRequestIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FederatedAuthUserInfoRequestIssueReason = Schema.String as any as Schema.Codec<
  FederatedAuthUserInfoRequestIssueReason
>

/**
 * Depending on the concrete errorType, different properties are set.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GenericIssueDetails {
  /**
   * Issues with the same errorType are aggregated in the frontend.
   */
  readonly errorType: GenericIssueErrorType
  readonly frameId?: Page.FrameId | undefined
  readonly violatingNodeId?: DOM.BackendNodeId | undefined
  readonly violatingNodeAttribute?: string | undefined
  readonly request?: AffectedRequest | undefined
}

/**
 * Schema for `GenericIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GenericIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    errorType: GenericIssueErrorType,
    frameId: Schema.optional(Page.FrameId),
    violatingNodeId: Schema.optional(DOM.BackendNodeId),
    violatingNodeAttribute: Schema.optional(Schema.String),
    request: Schema.optional(AffectedRequest)
  }).annotate({ identifier: "Audits.GenericIssueDetails" })
) as any as Schema.Codec<GenericIssueDetails>

/**
 * `GenericIssueErrorType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type GenericIssueErrorType =
  | "FormLabelForNameError"
  | "FormDuplicateIdForInputError"
  | "FormInputWithNoLabelError"
  | "FormAutocompleteAttributeEmptyError"
  | "FormEmptyIdAndNameAttributesForInputError"
  | "FormAriaLabelledByToNonExistingIdError"
  | "FormInputAssignedAutocompleteValueToIdOrNameAttributeError"
  | "FormLabelHasNeitherForNorNestedInputError"
  | "FormLabelForMatchesNonExistingIdError"
  | "FormInputHasWrongButWellIntendedAutocompleteValueError"
  | "ResponseWasBlockedByORB"
  | "NavigationEntryMarkedSkippable"
  | "BackUINavigationWouldSkipAd"
  | "AutofillAndManualTextPolicyControlledFeaturesInfo"
  | "AutofillPolicyControlledFeatureInfo"
  | "ManualTextPolicyControlledFeatureInfo"
  | "FormModelContextParameterMissingTitleAndDescription"
  | "FormModelContextMissingToolName"
  | "FormModelContextMissingToolDescription"
  | "FormModelContextRequiredParameterMissingName"
  | "FormModelContextParameterMissingName"
  | (string & {})

/**
 * Schema for `GenericIssueErrorType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GenericIssueErrorType = Schema.String as any as Schema.Codec<GenericIssueErrorType>

/**
 * `HeavyAdIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HeavyAdIssueDetails {
  /**
   * The resolution status, either blocking the content or warning.
   */
  readonly resolution: HeavyAdResolutionStatus
  /**
   * The reason the ad was blocked, total network or cpu or peak cpu.
   */
  readonly reason: HeavyAdReason
  /**
   * The frame that was blocked.
   */
  readonly frame: AffectedFrame
}

/**
 * Schema for `HeavyAdIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HeavyAdIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    resolution: HeavyAdResolutionStatus,
    reason: HeavyAdReason,
    frame: AffectedFrame
  }).annotate({ identifier: "Audits.HeavyAdIssueDetails" })
) as any as Schema.Codec<HeavyAdIssueDetails>

/**
 * `HeavyAdReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type HeavyAdReason =
  | "NetworkTotalLimit"
  | "CpuTotalLimit"
  | "CpuPeakLimit"
  | (string & {})

/**
 * Schema for `HeavyAdReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HeavyAdReason = Schema.String as any as Schema.Codec<HeavyAdReason>

/**
 * `HeavyAdResolutionStatus` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type HeavyAdResolutionStatus =
  | "HeavyAdBlocked"
  | "HeavyAdWarning"
  | (string & {})

/**
 * Schema for `HeavyAdResolutionStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HeavyAdResolutionStatus = Schema.String as any as Schema.Codec<HeavyAdResolutionStatus>

/**
 * Represents the category of insight that a cookie issue falls under.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type InsightType =
  | "GitHubResource"
  | "GracePeriod"
  | "Heuristics"
  | (string & {})

/**
 * Schema for `InsightType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InsightType = Schema.String as any as Schema.Codec<InsightType>

/**
 * An inspector issue reported from the back-end.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InspectorIssue {
  readonly code: InspectorIssueCode
  readonly details: InspectorIssueDetails
  /**
   * A unique id for this issue. May be omitted if no other entity (e.g.
   * exception, CDP message, etc.) is referencing this issue.
   */
  readonly issueId?: IssueId | undefined
}

/**
 * Schema for `InspectorIssue`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectorIssue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    code: InspectorIssueCode,
    details: InspectorIssueDetails,
    issueId: Schema.optional(IssueId)
  }).annotate({ identifier: "Audits.InspectorIssue" })
) as any as Schema.Codec<InspectorIssue>

/**
 * A unique identifier for the type of issue. Each type may use one of the
 * optional fields in InspectorIssueDetails to convey more specific
 * information about the kind of issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type InspectorIssueCode =
  | "CookieIssue"
  | "MixedContentIssue"
  | "BlockedByResponseIssue"
  | "HeavyAdIssue"
  | "ContentSecurityPolicyIssue"
  | "SharedArrayBufferIssue"
  | "CorsIssue"
  | "QuirksModeIssue"
  | "PartitioningBlobURLIssue"
  | "NavigatorUserAgentIssue"
  | "GenericIssue"
  | "DeprecationIssue"
  | "ClientHintIssue"
  | "FederatedAuthRequestIssue"
  | "BounceTrackingIssue"
  | "CookieDeprecationMetadataIssue"
  | "StylesheetLoadingIssue"
  | "FederatedAuthUserInfoRequestIssue"
  | "PropertyRuleIssue"
  | "SharedDictionaryIssue"
  | "ElementAccessibilityIssue"
  | "SRIMessageSignatureIssue"
  | "UnencodedDigestIssue"
  | "ConnectionAllowlistIssue"
  | "UserReidentificationIssue"
  | "PermissionElementIssue"
  | "PerformanceIssue"
  | "SelectivePermissionsInterventionIssue"
  | "EmailVerificationRequestIssue"
  | "LazyLoadImageIssue"
  | "WebInstallIssue"
  | (string & {})

/**
 * Schema for `InspectorIssueCode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectorIssueCode = Schema.String as any as Schema.Codec<InspectorIssueCode>

/**
 * This struct holds a list of optional fields with additional information
 * specific to the kind of issue. When adding a new issue code, please also
 * add a new optional field to this type.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InspectorIssueDetails {
  readonly cookieIssueDetails?: CookieIssueDetails | undefined
  readonly mixedContentIssueDetails?: MixedContentIssueDetails | undefined
  readonly blockedByResponseIssueDetails?: BlockedByResponseIssueDetails | undefined
  readonly heavyAdIssueDetails?: HeavyAdIssueDetails | undefined
  readonly contentSecurityPolicyIssueDetails?: ContentSecurityPolicyIssueDetails | undefined
  readonly sharedArrayBufferIssueDetails?: SharedArrayBufferIssueDetails | undefined
  readonly corsIssueDetails?: CorsIssueDetails | undefined
  readonly quirksModeIssueDetails?: QuirksModeIssueDetails | undefined
  readonly partitioningBlobURLIssueDetails?: PartitioningBlobURLIssueDetails | undefined
  readonly genericIssueDetails?: GenericIssueDetails | undefined
  readonly deprecationIssueDetails?: DeprecationIssueDetails | undefined
  readonly clientHintIssueDetails?: ClientHintIssueDetails | undefined
  readonly federatedAuthRequestIssueDetails?: FederatedAuthRequestIssueDetails | undefined
  readonly bounceTrackingIssueDetails?: BounceTrackingIssueDetails | undefined
  readonly cookieDeprecationMetadataIssueDetails?: CookieDeprecationMetadataIssueDetails | undefined
  readonly stylesheetLoadingIssueDetails?: StylesheetLoadingIssueDetails | undefined
  readonly propertyRuleIssueDetails?: PropertyRuleIssueDetails | undefined
  readonly federatedAuthUserInfoRequestIssueDetails?: FederatedAuthUserInfoRequestIssueDetails | undefined
  readonly sharedDictionaryIssueDetails?: SharedDictionaryIssueDetails | undefined
  readonly elementAccessibilityIssueDetails?: ElementAccessibilityIssueDetails | undefined
  readonly sriMessageSignatureIssueDetails?: SRIMessageSignatureIssueDetails | undefined
  readonly unencodedDigestIssueDetails?: UnencodedDigestIssueDetails | undefined
  readonly connectionAllowlistIssueDetails?: ConnectionAllowlistIssueDetails | undefined
  readonly userReidentificationIssueDetails?: UserReidentificationIssueDetails | undefined
  readonly permissionElementIssueDetails?: PermissionElementIssueDetails | undefined
  readonly performanceIssueDetails?: PerformanceIssueDetails | undefined
  readonly selectivePermissionsInterventionIssueDetails?: SelectivePermissionsInterventionIssueDetails | undefined
  readonly emailVerificationRequestIssueDetails?: EmailVerificationRequestIssueDetails | undefined
  readonly lazyLoadImageIssueDetails?: LazyLoadImageIssueDetails | undefined
  readonly webInstallIssueDetails?: WebInstallIssueDetails | undefined
}

/**
 * Schema for `InspectorIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InspectorIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookieIssueDetails: Schema.optional(CookieIssueDetails),
    mixedContentIssueDetails: Schema.optional(MixedContentIssueDetails),
    blockedByResponseIssueDetails: Schema.optional(BlockedByResponseIssueDetails),
    heavyAdIssueDetails: Schema.optional(HeavyAdIssueDetails),
    contentSecurityPolicyIssueDetails: Schema.optional(ContentSecurityPolicyIssueDetails),
    sharedArrayBufferIssueDetails: Schema.optional(SharedArrayBufferIssueDetails),
    corsIssueDetails: Schema.optional(CorsIssueDetails),
    quirksModeIssueDetails: Schema.optional(QuirksModeIssueDetails),
    partitioningBlobURLIssueDetails: Schema.optional(PartitioningBlobURLIssueDetails),
    genericIssueDetails: Schema.optional(GenericIssueDetails),
    deprecationIssueDetails: Schema.optional(DeprecationIssueDetails),
    clientHintIssueDetails: Schema.optional(ClientHintIssueDetails),
    federatedAuthRequestIssueDetails: Schema.optional(FederatedAuthRequestIssueDetails),
    bounceTrackingIssueDetails: Schema.optional(BounceTrackingIssueDetails),
    cookieDeprecationMetadataIssueDetails: Schema.optional(CookieDeprecationMetadataIssueDetails),
    stylesheetLoadingIssueDetails: Schema.optional(StylesheetLoadingIssueDetails),
    propertyRuleIssueDetails: Schema.optional(PropertyRuleIssueDetails),
    federatedAuthUserInfoRequestIssueDetails: Schema.optional(FederatedAuthUserInfoRequestIssueDetails),
    sharedDictionaryIssueDetails: Schema.optional(SharedDictionaryIssueDetails),
    elementAccessibilityIssueDetails: Schema.optional(ElementAccessibilityIssueDetails),
    sriMessageSignatureIssueDetails: Schema.optional(SRIMessageSignatureIssueDetails),
    unencodedDigestIssueDetails: Schema.optional(UnencodedDigestIssueDetails),
    connectionAllowlistIssueDetails: Schema.optional(ConnectionAllowlistIssueDetails),
    userReidentificationIssueDetails: Schema.optional(UserReidentificationIssueDetails),
    permissionElementIssueDetails: Schema.optional(PermissionElementIssueDetails),
    performanceIssueDetails: Schema.optional(PerformanceIssueDetails),
    selectivePermissionsInterventionIssueDetails: Schema.optional(SelectivePermissionsInterventionIssueDetails),
    emailVerificationRequestIssueDetails: Schema.optional(EmailVerificationRequestIssueDetails),
    lazyLoadImageIssueDetails: Schema.optional(LazyLoadImageIssueDetails),
    webInstallIssueDetails: Schema.optional(WebInstallIssueDetails)
  }).annotate({ identifier: "Audits.InspectorIssueDetails" })
) as any as Schema.Codec<InspectorIssueDetails>

/**
 * A unique id for a DevTools inspector issue. Allows other entities (e.g.
 * exceptions, CDP message, console messages, etc.) to reference an issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type IssueId = Brand.Branded<string, "~@usestrider/browser/cdp/Audits/IssueId">

/**
 * Schema for `IssueId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IssueId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Audits/IssueId")
) as any as Schema.Codec<IssueId>

/**
 * Details for issues about lazy-loaded images without explicit dimensions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LazyLoadImageIssueDetails {
  /**
   * DOM node of the problematic HTMLImageElement.
   */
  readonly nodeId: DOM.BackendNodeId
  /**
   * URL or src attribute of the image.
   */
  readonly url: string
  /**
   * Frame containing the image.
   */
  readonly frameId: Page.FrameId
}

/**
 * Schema for `LazyLoadImageIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LazyLoadImageIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.BackendNodeId,
    url: Schema.String,
    frameId: Page.FrameId
  }).annotate({ identifier: "Audits.LazyLoadImageIssueDetails" })
) as any as Schema.Codec<LazyLoadImageIssueDetails>

/**
 * `MixedContentIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface MixedContentIssueDetails {
  /**
   * The type of resource causing the mixed content issue (css, js, iframe,
   * form,...). Marked as optional because it is mapped to from
   * blink::mojom::RequestContextType, which will be replaced
   * by network::mojom::RequestDestination
   */
  readonly resourceType?: MixedContentResourceType | undefined
  /**
   * The way the mixed content issue is being resolved.
   */
  readonly resolutionStatus: MixedContentResolutionStatus
  /**
   * The unsafe http url causing the mixed content issue.
   */
  readonly insecureURL: string
  /**
   * The url responsible for the call to an unsafe url.
   */
  readonly mainResourceURL: string
  /**
   * The mixed content request.
   * Does not always exist (e.g. for unsafe form submission urls).
   */
  readonly request?: AffectedRequest | undefined
  /**
   * Optional because not every mixed content issue is necessarily linked to a frame.
   */
  readonly frame?: AffectedFrame | undefined
}

/**
 * Schema for `MixedContentIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MixedContentIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    resourceType: Schema.optional(MixedContentResourceType),
    resolutionStatus: MixedContentResolutionStatus,
    insecureURL: Schema.String,
    mainResourceURL: Schema.String,
    request: Schema.optional(AffectedRequest),
    frame: Schema.optional(AffectedFrame)
  }).annotate({ identifier: "Audits.MixedContentIssueDetails" })
) as any as Schema.Codec<MixedContentIssueDetails>

/**
 * `MixedContentResolutionStatus` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type MixedContentResolutionStatus =
  | "MixedContentBlocked"
  | "MixedContentAutomaticallyUpgraded"
  | "MixedContentWarning"
  | (string & {})

/**
 * Schema for `MixedContentResolutionStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MixedContentResolutionStatus = Schema.String as any as Schema.Codec<MixedContentResolutionStatus>

/**
 * `MixedContentResourceType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type MixedContentResourceType =
  | "Audio"
  | "Beacon"
  | "CSPReport"
  | "Download"
  | "EventSource"
  | "Favicon"
  | "Font"
  | "Form"
  | "Frame"
  | "Image"
  | "Import"
  | "JSON"
  | "Manifest"
  | "Ping"
  | "PluginData"
  | "PluginResource"
  | "Prefetch"
  | "Resource"
  | "Script"
  | "ServiceWorker"
  | "SharedWorker"
  | "SpeculationRules"
  | "Stylesheet"
  | "Track"
  | "Video"
  | "Worker"
  | "XMLHttpRequest"
  | "XSLT"
  | (string & {})

/**
 * Schema for `MixedContentResourceType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MixedContentResourceType = Schema.String as any as Schema.Codec<MixedContentResourceType>

/**
 * `PartitioningBlobURLInfo` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PartitioningBlobURLInfo =
  | "BlockedCrossPartitionFetching"
  | "EnforceNoopenerForNavigation"
  | (string & {})

/**
 * Schema for `PartitioningBlobURLInfo`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PartitioningBlobURLInfo = Schema.String as any as Schema.Codec<PartitioningBlobURLInfo>

/**
 * `PartitioningBlobURLIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PartitioningBlobURLIssueDetails {
  /**
   * The BlobURL that failed to load.
   */
  readonly url: string
  /**
   * Additional information about the Partitioning Blob URL issue.
   */
  readonly partitioningBlobURLInfo: PartitioningBlobURLInfo
}

/**
 * Schema for `PartitioningBlobURLIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PartitioningBlobURLIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    partitioningBlobURLInfo: PartitioningBlobURLInfo
  }).annotate({ identifier: "Audits.PartitioningBlobURLIssueDetails" })
) as any as Schema.Codec<PartitioningBlobURLIssueDetails>

/**
 * Details for a performance issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PerformanceIssueDetails {
  readonly performanceIssueType: PerformanceIssueType
  readonly sourceCodeLocation?: SourceCodeLocation | undefined
}

/**
 * Schema for `PerformanceIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PerformanceIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    performanceIssueType: PerformanceIssueType,
    sourceCodeLocation: Schema.optional(SourceCodeLocation)
  }).annotate({ identifier: "Audits.PerformanceIssueDetails" })
) as any as Schema.Codec<PerformanceIssueDetails>

/**
 * `PerformanceIssueType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PerformanceIssueType =
  | "DocumentCookie"
  | (string & {})

/**
 * Schema for `PerformanceIssueType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PerformanceIssueType = Schema.String as any as Schema.Codec<PerformanceIssueType>

/**
 * This issue warns about improper usage of the <permission> element.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PermissionElementIssueDetails {
  readonly issueType: PermissionElementIssueType
  /**
   * The value of the type attribute.
   */
  readonly type?: string | undefined
  /**
   * The node ID of the <permission> element.
   */
  readonly nodeId?: DOM.BackendNodeId | undefined
  /**
   * True if the issue is a warning, false if it is an error.
   */
  readonly isWarning?: boolean | undefined
  /**
   * Fields for message construction:
   * Used for messages that reference a specific permission name
   */
  readonly permissionName?: string | undefined
  /**
   * Used for messages about occlusion
   */
  readonly occluderNodeInfo?: string | undefined
  /**
   * Used for messages about occluder's parent
   */
  readonly occluderParentNodeInfo?: string | undefined
  /**
   * Used for messages about activation disabled reason
   */
  readonly disableReason?: string | undefined
}

/**
 * Schema for `PermissionElementIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionElementIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    issueType: PermissionElementIssueType,
    type: Schema.optional(Schema.String),
    nodeId: Schema.optional(DOM.BackendNodeId),
    isWarning: Schema.optional(Schema.Boolean),
    permissionName: Schema.optional(Schema.String),
    occluderNodeInfo: Schema.optional(Schema.String),
    occluderParentNodeInfo: Schema.optional(Schema.String),
    disableReason: Schema.optional(Schema.String)
  }).annotate({ identifier: "Audits.PermissionElementIssueDetails" })
) as any as Schema.Codec<PermissionElementIssueDetails>

/**
 * `PermissionElementIssueType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PermissionElementIssueType =
  | "InvalidType"
  | "FencedFrameDisallowed"
  | "CspFrameAncestorsMissing"
  | "PermissionsPolicyBlocked"
  | "PaddingRightUnsupported"
  | "PaddingBottomUnsupported"
  | "InsetBoxShadowUnsupported"
  | "RequestInProgress"
  | "UntrustedEvent"
  | "RegistrationFailed"
  | "TypeNotSupported"
  | "InvalidTypeActivation"
  | "SecurityChecksFailed"
  | "ActivationDisabled"
  | "GeolocationDeprecated"
  | "InvalidDisplayStyle"
  | "NonOpaqueColor"
  | "LowContrast"
  | "FontSizeTooSmall"
  | "FontSizeTooLarge"
  | "InvalidSizeValue"
  | "NonSecureContext"
  | "MissingTransientUserActivation"
  | (string & {})

/**
 * Schema for `PermissionElementIssueType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PermissionElementIssueType = Schema.String as any as Schema.Codec<PermissionElementIssueType>

/**
 * This issue warns about errors in property rules that lead to property
 * registrations being ignored.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PropertyRuleIssueDetails {
  /**
   * Source code position of the property rule.
   */
  readonly sourceCodeLocation: SourceCodeLocation
  /**
   * Reason why the property rule was discarded.
   */
  readonly propertyRuleIssueReason: PropertyRuleIssueReason
  /**
   * The value of the property rule property that failed to parse
   */
  readonly propertyValue?: string | undefined
}

/**
 * Schema for `PropertyRuleIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PropertyRuleIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceCodeLocation: SourceCodeLocation,
    propertyRuleIssueReason: PropertyRuleIssueReason,
    propertyValue: Schema.optional(Schema.String)
  }).annotate({ identifier: "Audits.PropertyRuleIssueDetails" })
) as any as Schema.Codec<PropertyRuleIssueDetails>

/**
 * `PropertyRuleIssueReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PropertyRuleIssueReason =
  | "InvalidSyntax"
  | "InvalidInitialValue"
  | "InvalidInherits"
  | "InvalidName"
  | (string & {})

/**
 * Schema for `PropertyRuleIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PropertyRuleIssueReason = Schema.String as any as Schema.Codec<PropertyRuleIssueReason>

/**
 * Details for issues about documents in Quirks Mode
 * or Limited Quirks Mode that affects page layouting.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface QuirksModeIssueDetails {
  /**
   * If false, it means the document's mode is "quirks"
   * instead of "limited-quirks".
   */
  readonly isLimitedQuirksMode: boolean
  readonly documentNodeId: DOM.BackendNodeId
  readonly url: string
  readonly frameId: Page.FrameId
  readonly loaderId: Network.LoaderId
}

/**
 * Schema for `QuirksModeIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const QuirksModeIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isLimitedQuirksMode: Schema.Boolean,
    documentNodeId: DOM.BackendNodeId,
    url: Schema.String,
    frameId: Page.FrameId,
    loaderId: Network.LoaderId
  }).annotate({ identifier: "Audits.QuirksModeIssueDetails" })
) as any as Schema.Codec<QuirksModeIssueDetails>

/**
 * `SRIMessageSignatureError` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SRIMessageSignatureError =
  | "MissingSignatureHeader"
  | "MissingSignatureInputHeader"
  | "InvalidSignatureHeader"
  | "InvalidSignatureInputHeader"
  | "SignatureHeaderValueIsNotByteSequence"
  | "SignatureHeaderValueIsParameterized"
  | "SignatureHeaderValueIsIncorrectLength"
  | "SignatureInputHeaderMissingLabel"
  | "SignatureInputHeaderValueNotInnerList"
  | "SignatureInputHeaderValueMissingComponents"
  | "SignatureInputHeaderInvalidComponentType"
  | "SignatureInputHeaderInvalidComponentName"
  | "SignatureInputHeaderInvalidHeaderComponentParameter"
  | "SignatureInputHeaderInvalidDerivedComponentParameter"
  | "SignatureInputHeaderKeyIdLength"
  | "SignatureInputHeaderInvalidParameter"
  | "SignatureInputHeaderMissingRequiredParameters"
  | "ValidationFailedSignatureExpired"
  | "ValidationFailedInvalidLength"
  | "ValidationFailedSignatureMismatch"
  | "ValidationFailedIntegrityMismatch"
  | "SignatureBaseUnknownDerivedComponent"
  | "SignatureBaseMissingHeader"
  | "SignatureBaseInvalidUnencodedDigest"
  | "SignatureBaseUnsupportedComponent"
  | (string & {})

/**
 * Schema for `SRIMessageSignatureError`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SRIMessageSignatureError = Schema.String as any as Schema.Codec<SRIMessageSignatureError>

/**
 * `SRIMessageSignatureIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SRIMessageSignatureIssueDetails {
  readonly error: SRIMessageSignatureError
  readonly signatureBase: string
  readonly integrityAssertions: ReadonlyArray<string>
  readonly request: AffectedRequest
}

/**
 * Schema for `SRIMessageSignatureIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SRIMessageSignatureIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    error: SRIMessageSignatureError,
    signatureBase: Schema.String,
    integrityAssertions: Schema.Array(Schema.String),
    request: AffectedRequest
  }).annotate({ identifier: "Audits.SRIMessageSignatureIssueDetails" })
) as any as Schema.Codec<SRIMessageSignatureIssueDetails>

/**
 * The issue warns about blocked calls to privacy sensitive APIs via the
 * Selective Permissions Intervention.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SelectivePermissionsInterventionIssueDetails {
  /**
   * Which API was intervened on.
   */
  readonly apiName: string
  /**
   * Why the ad script using the API is considered an ad.
   */
  readonly adAncestry: Network.AdAncestry
  /**
   * The stack trace at the time of the intervention.
   */
  readonly stackTrace?: Runtime.StackTrace | undefined
}

/**
 * Schema for `SelectivePermissionsInterventionIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SelectivePermissionsInterventionIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    apiName: Schema.String,
    adAncestry: Network.AdAncestry,
    stackTrace: Schema.optional(Runtime.StackTrace)
  }).annotate({ identifier: "Audits.SelectivePermissionsInterventionIssueDetails" })
) as any as Schema.Codec<SelectivePermissionsInterventionIssueDetails>

/**
 * Details for a issue arising from an SAB being instantiated in, or
 * transferred to a context that is not cross-origin isolated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SharedArrayBufferIssueDetails {
  readonly sourceCodeLocation: SourceCodeLocation
  readonly isWarning: boolean
  readonly type: SharedArrayBufferIssueType
}

/**
 * Schema for `SharedArrayBufferIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SharedArrayBufferIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceCodeLocation: SourceCodeLocation,
    isWarning: Schema.Boolean,
    type: SharedArrayBufferIssueType
  }).annotate({ identifier: "Audits.SharedArrayBufferIssueDetails" })
) as any as Schema.Codec<SharedArrayBufferIssueDetails>

/**
 * `SharedArrayBufferIssueType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SharedArrayBufferIssueType =
  | "TransferIssue"
  | "CreationIssue"
  | (string & {})

/**
 * Schema for `SharedArrayBufferIssueType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SharedArrayBufferIssueType = Schema.String as any as Schema.Codec<SharedArrayBufferIssueType>

/**
 * `SharedDictionaryError` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SharedDictionaryError =
  | "UseErrorCrossOriginNoCorsRequest"
  | "UseErrorDictionaryLoadFailure"
  | "UseErrorMatchingDictionaryNotUsed"
  | "UseErrorUnexpectedContentDictionaryHeader"
  | "WriteErrorCossOriginNoCorsRequest"
  | "WriteErrorDisallowedBySettings"
  | "WriteErrorExpiredResponse"
  | "WriteErrorFeatureDisabled"
  | "WriteErrorInsufficientResources"
  | "WriteErrorInvalidMatchField"
  | "WriteErrorInvalidStructuredHeader"
  | "WriteErrorInvalidTTLField"
  | "WriteErrorNavigationRequest"
  | "WriteErrorNoMatchField"
  | "WriteErrorNonIntegerTTLField"
  | "WriteErrorNonListMatchDestField"
  | "WriteErrorNonSecureContext"
  | "WriteErrorNonStringIdField"
  | "WriteErrorNonStringInMatchDestList"
  | "WriteErrorInvalidMatchDestList"
  | "WriteErrorNonStringMatchField"
  | "WriteErrorNonTokenTypeField"
  | "WriteErrorRequestAborted"
  | "WriteErrorShuttingDown"
  | "WriteErrorTooLongIdField"
  | "WriteErrorUnsupportedType"
  | (string & {})

/**
 * Schema for `SharedDictionaryError`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SharedDictionaryError = Schema.String as any as Schema.Codec<SharedDictionaryError>

/**
 * `SharedDictionaryIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SharedDictionaryIssueDetails {
  readonly sharedDictionaryError: SharedDictionaryError
  readonly request: AffectedRequest
}

/**
 * Schema for `SharedDictionaryIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SharedDictionaryIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sharedDictionaryError: SharedDictionaryError,
    request: AffectedRequest
  }).annotate({ identifier: "Audits.SharedDictionaryIssueDetails" })
) as any as Schema.Codec<SharedDictionaryIssueDetails>

/**
 * `SourceCodeLocation`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SourceCodeLocation {
  readonly scriptId?: Runtime.ScriptId | undefined
  readonly url: string
  readonly lineNumber: number
  readonly columnNumber: number
}

/**
 * Schema for `SourceCodeLocation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SourceCodeLocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Schema.optional(Runtime.ScriptId),
    url: Schema.String,
    lineNumber: Schema.Int,
    columnNumber: Schema.Int
  }).annotate({ identifier: "Audits.SourceCodeLocation" })
) as any as Schema.Codec<SourceCodeLocation>

/**
 * `StyleSheetLoadingIssueReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StyleSheetLoadingIssueReason =
  | "LateImportRule"
  | "RequestFailed"
  | (string & {})

/**
 * Schema for `StyleSheetLoadingIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetLoadingIssueReason = Schema.String as any as Schema.Codec<StyleSheetLoadingIssueReason>

/**
 * This issue warns when a referenced stylesheet couldn't be loaded.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StylesheetLoadingIssueDetails {
  /**
   * Source code position that referenced the failing stylesheet.
   */
  readonly sourceCodeLocation: SourceCodeLocation
  /**
   * Reason why the stylesheet couldn't be loaded.
   */
  readonly styleSheetLoadingIssueReason: StyleSheetLoadingIssueReason
  /**
   * Contains additional info when the failure was due to a request.
   */
  readonly failedRequestInfo?: FailedRequestInfo | undefined
}

/**
 * Schema for `StylesheetLoadingIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StylesheetLoadingIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceCodeLocation: SourceCodeLocation,
    styleSheetLoadingIssueReason: StyleSheetLoadingIssueReason,
    failedRequestInfo: Schema.optional(FailedRequestInfo)
  }).annotate({ identifier: "Audits.StylesheetLoadingIssueDetails" })
) as any as Schema.Codec<StylesheetLoadingIssueDetails>

/**
 * `UnencodedDigestError` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type UnencodedDigestError =
  | "MalformedDictionary"
  | "UnknownAlgorithm"
  | "IncorrectDigestType"
  | "IncorrectDigestLength"
  | (string & {})

/**
 * Schema for `UnencodedDigestError`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UnencodedDigestError = Schema.String as any as Schema.Codec<UnencodedDigestError>

/**
 * `UnencodedDigestIssueDetails`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UnencodedDigestIssueDetails {
  readonly error: UnencodedDigestError
  readonly request: AffectedRequest
}

/**
 * Schema for `UnencodedDigestIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UnencodedDigestIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    error: UnencodedDigestError,
    request: AffectedRequest
  }).annotate({ identifier: "Audits.UnencodedDigestIssueDetails" })
) as any as Schema.Codec<UnencodedDigestIssueDetails>

/**
 * This issue warns about uses of APIs that may be considered misuse to
 * re-identify users.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UserReidentificationIssueDetails {
  readonly type: UserReidentificationIssueType
  /**
   * Applies to BlockedFrameNavigation and BlockedSubresource issue types.
   */
  readonly request?: AffectedRequest | undefined
  /**
   * Applies to NoisedCanvasReadback issue type.
   */
  readonly sourceCodeLocation?: SourceCodeLocation | undefined
}

/**
 * Schema for `UserReidentificationIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UserReidentificationIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: UserReidentificationIssueType,
    request: Schema.optional(AffectedRequest),
    sourceCodeLocation: Schema.optional(SourceCodeLocation)
  }).annotate({ identifier: "Audits.UserReidentificationIssueDetails" })
) as any as Schema.Codec<UserReidentificationIssueDetails>

/**
 * `UserReidentificationIssueType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type UserReidentificationIssueType =
  | "BlockedFrameNavigation"
  | "BlockedSubresource"
  | "NoisedCanvasReadback"
  | (string & {})

/**
 * Schema for `UserReidentificationIssueType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UserReidentificationIssueType = Schema.String as any as Schema.Codec<UserReidentificationIssueType>

/**
 * This issue reports a failure involving a web app manifest used by a Web
 * Install operation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WebInstallIssueDetails {
  readonly manifestUrl?: string | undefined
  readonly reason: WebInstallIssueReason
}

/**
 * Schema for `WebInstallIssueDetails`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WebInstallIssueDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    manifestUrl: Schema.optional(Schema.String),
    reason: WebInstallIssueReason
  }).annotate({ identifier: "Audits.WebInstallIssueDetails" })
) as any as Schema.Codec<WebInstallIssueDetails>

/**
 * `WebInstallIssueReason` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type WebInstallIssueReason =
  | "ManifestParsingOrNetworkError"
  | "StartUrlInvalid"
  | "ManifestMissingNameOrShortName"
  | "ManifestMissingId"
  | "NoManifest"
  | (string & {})

/**
 * Schema for `WebInstallIssueReason`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WebInstallIssueReason = Schema.String as any as Schema.Codec<WebInstallIssueReason>

/**
 * Runs the form issues check for the target page. Found issues are reported
 * using Audits.issueAdded event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CheckFormsIssuesResult {
  readonly formIssues: ReadonlyArray<GenericIssueDetails>
}

/**
 * Schema for `CheckFormsIssuesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CheckFormsIssuesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    formIssues: Schema.Array(GenericIssueDetails)
  }).annotate({ identifier: "Audits.CheckFormsIssuesResult" })
) as any as Schema.Codec<CheckFormsIssuesResult>

/**
 * Returns the response body and size if it were re-encoded with the specified settings. Only
 * applies to images.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetEncodedResponseParams {
  /**
   * Identifier of the network request to get content for.
   */
  readonly requestId: Network.RequestId
  /**
   * The encoding to use.
   */
  readonly encoding: GetEncodedResponseParamsEncoding
  /**
   * The quality of the encoding (0-1). (defaults to 1)
   */
  readonly quality?: number | undefined
  /**
   * Whether to only return the size information (defaults to false).
   */
  readonly sizeOnly?: boolean | undefined
}

/**
 * Schema for `GetEncodedResponseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetEncodedResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Network.RequestId,
    encoding: GetEncodedResponseParamsEncoding,
    quality: Schema.optional(Schema.Number),
    sizeOnly: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Audits.GetEncodedResponseParams" })
) as any as Schema.Codec<GetEncodedResponseParams>

/**
 * The encoding to use.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type GetEncodedResponseParamsEncoding =
  | "webp"
  | "jpeg"
  | "png"
  | (string & {})

/**
 * Schema for `GetEncodedResponseParamsEncoding`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetEncodedResponseParamsEncoding = Schema.String as any as Schema.Codec<GetEncodedResponseParamsEncoding>

/**
 * Returns the response body and size if it were re-encoded with the specified settings. Only
 * applies to images.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetEncodedResponseResult {
  /**
   * The encoded body as a base64 string. Omitted if sizeOnly is true. (Encoded as a base64 string when passed over JSON)
   */
  readonly body?: string | undefined
  /**
   * Size before re-encoding.
   */
  readonly originalSize: number
  /**
   * Size after re-encoding.
   */
  readonly encodedSize: number
}

/**
 * Schema for `GetEncodedResponseResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetEncodedResponseResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    body: Schema.optional(Schema.String),
    originalSize: Schema.Int,
    encodedSize: Schema.Int
  }).annotate({ identifier: "Audits.GetEncodedResponseResult" })
) as any as Schema.Codec<GetEncodedResponseResult>

/**
 * `issueAdded.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface IssueAddedParams {
  readonly issue: InspectorIssue
}

/**
 * Schema for `IssueAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IssueAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    issue: InspectorIssue
  }).annotate({ identifier: "Audits.IssueAddedParams" })
) as any as Schema.Codec<IssueAddedParams>

/**
 * Runs the form issues check for the target page. Found issues are reported
 * using Audits.issueAdded event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const checkFormsIssues: Protocol.CommandDef<"Audits.checkFormsIssues", void, CheckFormsIssuesResult> =
  /*#__PURE__*/ Protocol.command(
    "Audits.checkFormsIssues",
    undefined,
    CheckFormsIssuesResult,
    { status: "stable" }
  )

/**
 * Disables issues domain, prevents further issues from being reported to the client.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Audits.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Audits.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables issues domain, sends the issues collected so far to the client by means of the
 * `issueAdded` event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Audits.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Audits.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Returns the response body and size if it were re-encoded with the specified settings. Only
 * applies to images.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getEncodedResponse: Protocol.CommandDef<
  "Audits.getEncodedResponse",
  GetEncodedResponseParams,
  GetEncodedResponseResult
> = /*#__PURE__*/ Protocol.command(
  "Audits.getEncodedResponse",
  GetEncodedResponseParams,
  GetEncodedResponseResult,
  { status: "stable" }
)

/**
 * The `Audits.issueAdded` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const issueAdded: Protocol.EventDef<"Audits.issueAdded", IssueAddedParams> = /*#__PURE__*/ Protocol.event(
  "Audits.issueAdded",
  IssueAddedParams,
  { status: "stable" }
)
