/**
 * The Security domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"

/**
 * The action to take when a certificate error occurs. continue will continue processing the
 * request and cancel will cancel the request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CertificateErrorAction =
  | "continue"
  | "cancel"
  | (string & {})

/**
 * Schema for `CertificateErrorAction`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CertificateErrorAction = Schema.String as any as Schema.Codec<CertificateErrorAction>

/**
 * An internal certificate ID value.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CertificateId = Brand.Branded<number, "~@usestrider/browser/cdp/Security/CertificateId">

/**
 * Schema for `CertificateId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CertificateId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Security/CertificateId")
) as any as Schema.Codec<CertificateId>

/**
 * Details about the security state of the page certificate.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CertificateSecurityState {
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
   * Page certificate.
   */
  readonly certificate: ReadonlyArray<string>
  /**
   * Certificate subject name.
   */
  readonly subjectName: string
  /**
   * Name of the issuing CA.
   */
  readonly issuer: string
  /**
   * Certificate valid from date.
   */
  readonly validFrom: Network.TimeSinceEpoch
  /**
   * Certificate valid to (expiration) date
   */
  readonly validTo: Network.TimeSinceEpoch
  /**
   * The highest priority network error code, if the certificate has an error.
   */
  readonly certificateNetworkError?: string | undefined
  /**
   * True if the certificate uses a weak signature algorithm.
   */
  readonly certificateHasWeakSignature: boolean
  /**
   * True if the certificate has a SHA1 signature in the chain.
   */
  readonly certificateHasSha1Signature: boolean
  /**
   * True if modern SSL
   */
  readonly modernSSL: boolean
  /**
   * True if the connection is using an obsolete SSL protocol.
   */
  readonly obsoleteSslProtocol: boolean
  /**
   * True if the connection is using an obsolete SSL key exchange.
   */
  readonly obsoleteSslKeyExchange: boolean
  /**
   * True if the connection is using an obsolete SSL cipher.
   */
  readonly obsoleteSslCipher: boolean
  /**
   * True if the connection is using an obsolete SSL signature.
   */
  readonly obsoleteSslSignature: boolean
}

/**
 * Schema for `CertificateSecurityState`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CertificateSecurityState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: Schema.String,
    keyExchange: Schema.String,
    keyExchangeGroup: Schema.optional(Schema.String),
    cipher: Schema.String,
    mac: Schema.optional(Schema.String),
    certificate: Schema.Array(Schema.String),
    subjectName: Schema.String,
    issuer: Schema.String,
    validFrom: Network.TimeSinceEpoch,
    validTo: Network.TimeSinceEpoch,
    certificateNetworkError: Schema.optional(Schema.String),
    certificateHasWeakSignature: Schema.Boolean,
    certificateHasSha1Signature: Schema.Boolean,
    modernSSL: Schema.Boolean,
    obsoleteSslProtocol: Schema.Boolean,
    obsoleteSslKeyExchange: Schema.Boolean,
    obsoleteSslCipher: Schema.Boolean,
    obsoleteSslSignature: Schema.Boolean
  }).annotate({ identifier: "Security.CertificateSecurityState" })
) as any as Schema.Codec<CertificateSecurityState>

/**
 * A description of mixed content (HTTP resources on HTTPS pages), as defined by
 * https://www.w3.org/TR/mixed-content/#categories
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MixedContentType =
  | "blockable"
  | "optionally-blockable"
  | "none"
  | (string & {})

/**
 * Schema for `MixedContentType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MixedContentType = Schema.String as any as Schema.Codec<MixedContentType>

/**
 * `SafetyTipInfo`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SafetyTipInfo {
  /**
   * Describes whether the page triggers any safety tips or reputation warnings. Default is unknown.
   */
  readonly safetyTipStatus: SafetyTipStatus
  /**
   * The URL the safety tip suggested ("Did you mean?"). Only filled in for lookalike matches.
   */
  readonly safeUrl?: string | undefined
}

/**
 * Schema for `SafetyTipInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SafetyTipInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    safetyTipStatus: SafetyTipStatus,
    safeUrl: Schema.optional(Schema.String)
  }).annotate({ identifier: "Security.SafetyTipInfo" })
) as any as Schema.Codec<SafetyTipInfo>

/**
 * `SafetyTipStatus` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SafetyTipStatus =
  | "badReputation"
  | "lookalike"
  | (string & {})

/**
 * Schema for `SafetyTipStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SafetyTipStatus = Schema.String as any as Schema.Codec<SafetyTipStatus>

/**
 * The security level of a page or resource.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SecurityState =
  | "unknown"
  | "neutral"
  | "insecure"
  | "secure"
  | "info"
  | "insecure-broken"
  | (string & {})

/**
 * Schema for `SecurityState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SecurityState = Schema.String as any as Schema.Codec<SecurityState>

/**
 * An explanation of an factor contributing to the security state.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SecurityStateExplanation {
  /**
   * Security state representing the severity of the factor being explained.
   */
  readonly securityState: SecurityState
  /**
   * Title describing the type of factor.
   */
  readonly title: string
  /**
   * Short phrase describing the type of factor.
   */
  readonly summary: string
  /**
   * Full text explanation of the factor.
   */
  readonly description: string
  /**
   * The type of mixed content described by the explanation.
   */
  readonly mixedContentType: MixedContentType
  /**
   * Page certificate.
   */
  readonly certificate: ReadonlyArray<string>
  /**
   * Recommendations to fix any issues.
   */
  readonly recommendations?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `SecurityStateExplanation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SecurityStateExplanation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityState: SecurityState,
    title: Schema.String,
    summary: Schema.String,
    description: Schema.String,
    mixedContentType: MixedContentType,
    certificate: Schema.Array(Schema.String),
    recommendations: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Security.SecurityStateExplanation" })
) as any as Schema.Codec<SecurityStateExplanation>

/**
 * Security state information about the page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface VisibleSecurityState {
  /**
   * The security level of the page.
   */
  readonly securityState: SecurityState
  /**
   * Security state details about the page certificate.
   */
  readonly certificateSecurityState?: CertificateSecurityState | undefined
  /**
   * The type of Safety Tip triggered on the page. Note that this field will be set even if the Safety Tip UI was not actually shown.
   */
  readonly safetyTipInfo?: SafetyTipInfo | undefined
  /**
   * Array of security state issues ids.
   */
  readonly securityStateIssueIds: ReadonlyArray<string>
}

/**
 * Schema for `VisibleSecurityState`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VisibleSecurityState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    securityState: SecurityState,
    certificateSecurityState: Schema.optional(CertificateSecurityState),
    safetyTipInfo: Schema.optional(SafetyTipInfo),
    securityStateIssueIds: Schema.Array(Schema.String)
  }).annotate({ identifier: "Security.VisibleSecurityState" })
) as any as Schema.Codec<VisibleSecurityState>

/**
 * Enable/disable whether all certificate errors should be ignored.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetIgnoreCertificateErrorsParams {
  /**
   * If true, all certificate errors will be ignored.
   */
  readonly ignore: boolean
}

/**
 * Schema for `SetIgnoreCertificateErrorsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetIgnoreCertificateErrorsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ignore: Schema.Boolean
  }).annotate({ identifier: "Security.SetIgnoreCertificateErrorsParams" })
) as any as Schema.Codec<SetIgnoreCertificateErrorsParams>

/**
 * The security state of the page changed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface VisibleSecurityStateChangedParams {
  /**
   * Security state information about the page.
   */
  readonly visibleSecurityState: VisibleSecurityState
}

/**
 * Schema for `VisibleSecurityStateChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VisibleSecurityStateChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    visibleSecurityState: VisibleSecurityState
  }).annotate({ identifier: "Security.VisibleSecurityStateChangedParams" })
) as any as Schema.Codec<VisibleSecurityStateChangedParams>

/**
 * Disables tracking security state changes.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Security.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Security.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables tracking security state changes.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Security.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Security.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable/disable whether all certificate errors should be ignored.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setIgnoreCertificateErrors: Protocol.CommandDef<
  "Security.setIgnoreCertificateErrors",
  SetIgnoreCertificateErrorsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Security.setIgnoreCertificateErrors",
  SetIgnoreCertificateErrorsParams,
  undefined,
  { status: "stable" }
)

/**
 * The security state of the page changed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const visibleSecurityStateChanged: Protocol.EventDef<
  "Security.visibleSecurityStateChanged",
  VisibleSecurityStateChangedParams
> = /*#__PURE__*/ Protocol.event(
  "Security.visibleSecurityStateChanged",
  VisibleSecurityStateChangedParams,
  { status: "experimental" }
)
