/**
 * This domain allows configuring virtual authenticators to test the WebAuthn
 * API.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `AuthenticatorId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AuthenticatorId = Brand.Branded<string, "~@usestrider/browser/cdp/WebAuthn/AuthenticatorId">

/**
 * Schema for `AuthenticatorId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AuthenticatorId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/WebAuthn/AuthenticatorId")
) as any as Schema.Codec<AuthenticatorId>

/**
 * `AuthenticatorProtocol` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AuthenticatorProtocol =
  | "u2f"
  | "ctap2"
  | (string & {})

/**
 * Schema for `AuthenticatorProtocol`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AuthenticatorProtocol = Schema.String as any as Schema.Codec<AuthenticatorProtocol>

/**
 * LINT.IfChange(AuthenticatorTransport)
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AuthenticatorTransport =
  | "usb"
  | "nfc"
  | "ble"
  | "cable"
  | "hybrid"
  | "smart-card"
  | "internal"
  | (string & {})

/**
 * Schema for `AuthenticatorTransport`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AuthenticatorTransport = Schema.String as any as Schema.Codec<AuthenticatorTransport>

/**
 * `Credential`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Credential {
  readonly credentialId: string
  readonly isResidentCredential: boolean
  /**
   * Relying Party ID the credential is scoped to. Must be set when adding a
   * credential.
   */
  readonly rpId?: string | undefined
  /**
   * The ECDSA P-256 private key in PKCS#8 format. (Encoded as a base64 string when passed over JSON)
   */
  readonly privateKey: string
  /**
   * An opaque byte sequence with a maximum size of 64 bytes mapping the
   * credential to a specific user. (Encoded as a base64 string when passed over JSON)
   */
  readonly userHandle?: string | undefined
  /**
   * Signature counter. Must be equal to or greater than -1.
   * If -1, the credential won't have an associated signature counter, and
   * every assertion operation will report a value of 0.
   * See https://w3c.github.io/webauthn/#signature-counter
   */
  readonly signCount: number
  /**
   * The large blob associated with the credential.
   * See https://w3c.github.io/webauthn/#sctn-large-blob-extension (Encoded as a base64 string when passed over JSON)
   */
  readonly largeBlob?: string | undefined
  /**
   * Assertions returned by this credential will have the backup eligibility
   * (BE) flag set to this value. Defaults to the authenticator's
   * defaultBackupEligibility value.
   */
  readonly backupEligibility?: boolean | undefined
  /**
   * Assertions returned by this credential will have the backup state (BS)
   * flag set to this value. Defaults to the authenticator's
   * defaultBackupState value.
   */
  readonly backupState?: boolean | undefined
  /**
   * The credential's user.name property. Equivalent to empty if not set.
   * https://w3c.github.io/webauthn/#dom-publickeycredentialentity-name
   */
  readonly userName?: string | undefined
  /**
   * The credential's user.displayName property. Equivalent to empty if
   * not set.
   * https://w3c.github.io/webauthn/#dom-publickeycredentialuserentity-displayname
   */
  readonly userDisplayName?: string | undefined
  /**
   * The CMTG keys associated with the credential.
   */
  readonly cmtgKeys?: ReadonlyArray<string> | undefined
  /**
   * The 0-based index of the active key in cmtgKeys.
   */
  readonly activeCmtgKeyIndex?: number | undefined
  /**
   * If true, the authenticator will generate a new CMTG key on the next operation.
   */
  readonly generateCmtgKeyOnNextOperation?: boolean | undefined
}

/**
 * Schema for `Credential`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Credential = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    credentialId: Schema.String,
    isResidentCredential: Schema.Boolean,
    rpId: Schema.optional(Schema.String),
    privateKey: Schema.String,
    userHandle: Schema.optional(Schema.String),
    signCount: Schema.Number,
    largeBlob: Schema.optional(Schema.String),
    backupEligibility: Schema.optional(Schema.Boolean),
    backupState: Schema.optional(Schema.Boolean),
    userName: Schema.optional(Schema.String),
    userDisplayName: Schema.optional(Schema.String),
    cmtgKeys: Schema.optional(Schema.Array(Schema.String)),
    activeCmtgKeyIndex: Schema.optional(Schema.Int),
    generateCmtgKeyOnNextOperation: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "WebAuthn.Credential" })
) as any as Schema.Codec<Credential>

/**
 * `Ctap2Version` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Ctap2Version =
  | "ctap2_0"
  | "ctap2_1"
  | "ctap2_2"
  | (string & {})

/**
 * Schema for `Ctap2Version`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Ctap2Version = Schema.String as any as Schema.Codec<Ctap2Version>

/**
 * `VirtualAuthenticatorOptions`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface VirtualAuthenticatorOptions {
  readonly protocol: AuthenticatorProtocol
  /**
   * Defaults to ctap2_0. Ignored if |protocol| == u2f.
   */
  readonly ctap2Version?: Ctap2Version | undefined
  readonly transport: AuthenticatorTransport
  /**
   * Defaults to false.
   */
  readonly hasResidentKey?: boolean | undefined
  /**
   * Defaults to false.
   */
  readonly hasUserVerification?: boolean | undefined
  /**
   * If set to true, the authenticator will support the largeBlob extension.
   * https://w3c.github.io/webauthn#largeBlob
   * Defaults to false.
   */
  readonly hasLargeBlob?: boolean | undefined
  /**
   * If set to true, the authenticator will support the credBlob extension.
   * https://fidoalliance.org/specs/fido-v2.1-rd-20201208/fido-client-to-authenticator-protocol-v2.1-rd-20201208.html#sctn-credBlob-extension
   * Defaults to false.
   */
  readonly hasCredBlob?: boolean | undefined
  /**
   * If set to true, the authenticator will support the minPinLength extension.
   * https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html#sctn-minpinlength-extension
   * Defaults to false.
   */
  readonly hasMinPinLength?: boolean | undefined
  /**
   * If set to true, the authenticator will support the prf extension.
   * https://w3c.github.io/webauthn/#prf-extension
   * Defaults to false.
   */
  readonly hasPrf?: boolean | undefined
  /**
   * If set to true, the authenticator will support the hmac-secret extension.
   * https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html#sctn-hmac-secret-extension
   * Defaults to false.
   */
  readonly hasHmacSecret?: boolean | undefined
  /**
   * If set to true, the authenticator will support the hmac-secret-mc extension.
   * https://fidoalliance.org/specs/fido-v2.2-rd-20241003/fido-client-to-authenticator-protocol-v2.2-rd-20241003.html#sctn-hmac-secret-make-cred-extension
   * Defaults to false.
   */
  readonly hasHmacSecretMc?: boolean | undefined
  /**
   * If set to true, the authenticator will support the cmtgKey (Credential
   * Manager Trust Group Key) extension.
   * https://github.com/w3c/webauthn/pull/2377
   * Defaults to false.
   */
  readonly hasCmtgKey?: boolean | undefined
  /**
   * If set to true, tests of user presence will succeed immediately.
   * Otherwise, they will not be resolved. Defaults to true.
   */
  readonly automaticPresenceSimulation?: boolean | undefined
  /**
   * Sets whether User Verification succeeds or fails for an authenticator.
   * Defaults to false.
   */
  readonly isUserVerified?: boolean | undefined
  /**
   * Credentials created by this authenticator will have the backup
   * eligibility (BE) flag set to this value. Defaults to false.
   * https://w3c.github.io/webauthn/#sctn-credential-backup
   */
  readonly defaultBackupEligibility?: boolean | undefined
  /**
   * Credentials created by this authenticator will have the backup state
   * (BS) flag set to this value. Defaults to false.
   * https://w3c.github.io/webauthn/#sctn-credential-backup
   */
  readonly defaultBackupState?: boolean | undefined
}

/**
 * Schema for `VirtualAuthenticatorOptions`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VirtualAuthenticatorOptions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: AuthenticatorProtocol,
    ctap2Version: Schema.optional(Ctap2Version),
    transport: AuthenticatorTransport,
    hasResidentKey: Schema.optional(Schema.Boolean),
    hasUserVerification: Schema.optional(Schema.Boolean),
    hasLargeBlob: Schema.optional(Schema.Boolean),
    hasCredBlob: Schema.optional(Schema.Boolean),
    hasMinPinLength: Schema.optional(Schema.Boolean),
    hasPrf: Schema.optional(Schema.Boolean),
    hasHmacSecret: Schema.optional(Schema.Boolean),
    hasHmacSecretMc: Schema.optional(Schema.Boolean),
    hasCmtgKey: Schema.optional(Schema.Boolean),
    automaticPresenceSimulation: Schema.optional(Schema.Boolean),
    isUserVerified: Schema.optional(Schema.Boolean),
    defaultBackupEligibility: Schema.optional(Schema.Boolean),
    defaultBackupState: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "WebAuthn.VirtualAuthenticatorOptions" })
) as any as Schema.Codec<VirtualAuthenticatorOptions>

/**
 * Adds the credential to the specified authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddCredentialParams {
  readonly authenticatorId: AuthenticatorId
  readonly credential: Credential
}

/**
 * Schema for `AddCredentialParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddCredentialParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credential: Credential
  }).annotate({ identifier: "WebAuthn.AddCredentialParams" })
) as any as Schema.Codec<AddCredentialParams>

/**
 * Creates and adds a virtual authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddVirtualAuthenticatorParams {
  readonly options: VirtualAuthenticatorOptions
}

/**
 * Schema for `AddVirtualAuthenticatorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddVirtualAuthenticatorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    options: VirtualAuthenticatorOptions
  }).annotate({ identifier: "WebAuthn.AddVirtualAuthenticatorParams" })
) as any as Schema.Codec<AddVirtualAuthenticatorParams>

/**
 * Creates and adds a virtual authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddVirtualAuthenticatorResult {
  readonly authenticatorId: AuthenticatorId
}

/**
 * Schema for `AddVirtualAuthenticatorResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddVirtualAuthenticatorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId
  }).annotate({ identifier: "WebAuthn.AddVirtualAuthenticatorResult" })
) as any as Schema.Codec<AddVirtualAuthenticatorResult>

/**
 * Clears all the credentials from the specified device.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearCredentialsParams {
  readonly authenticatorId: AuthenticatorId
}

/**
 * Schema for `ClearCredentialsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearCredentialsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId
  }).annotate({ identifier: "WebAuthn.ClearCredentialsParams" })
) as any as Schema.Codec<ClearCredentialsParams>

/**
 * Triggered when a credential is added to an authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CredentialAddedParams {
  readonly authenticatorId: AuthenticatorId
  readonly credential: Credential
}

/**
 * Schema for `CredentialAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CredentialAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credential: Credential
  }).annotate({ identifier: "WebAuthn.CredentialAddedParams" })
) as any as Schema.Codec<CredentialAddedParams>

/**
 * Triggered when a credential is used in a webauthn assertion.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CredentialAssertedParams {
  readonly authenticatorId: AuthenticatorId
  readonly credential: Credential
}

/**
 * Schema for `CredentialAssertedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CredentialAssertedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credential: Credential
  }).annotate({ identifier: "WebAuthn.CredentialAssertedParams" })
) as any as Schema.Codec<CredentialAssertedParams>

/**
 * Triggered when a credential is deleted, e.g. through
 * PublicKeyCredential.signalUnknownCredential().
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CredentialDeletedParams {
  readonly authenticatorId: AuthenticatorId
  readonly credentialId: string
}

/**
 * Schema for `CredentialDeletedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CredentialDeletedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credentialId: Schema.String
  }).annotate({ identifier: "WebAuthn.CredentialDeletedParams" })
) as any as Schema.Codec<CredentialDeletedParams>

/**
 * Triggered when a credential is updated, e.g. through
 * PublicKeyCredential.signalCurrentUserDetails().
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CredentialUpdatedParams {
  readonly authenticatorId: AuthenticatorId
  readonly credential: Credential
}

/**
 * Schema for `CredentialUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CredentialUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credential: Credential
  }).annotate({ identifier: "WebAuthn.CredentialUpdatedParams" })
) as any as Schema.Codec<CredentialUpdatedParams>

/**
 * Enable the WebAuthn domain and start intercepting credential storage and
 * retrieval with a virtual authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * Whether to enable the WebAuthn user interface. Enabling the UI is
   * recommended for debugging and demo purposes, as it is closer to the real
   * experience. Disabling the UI is recommended for automated testing.
   * Supported at the embedder's discretion if UI is available.
   * Defaults to false.
   */
  readonly enableUI?: boolean | undefined
}

/**
 * Schema for `EnableParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EnableParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enableUI: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "WebAuthn.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Returns a single credential stored in the given virtual authenticator that
 * matches the credential ID.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCredentialParams {
  readonly authenticatorId: AuthenticatorId
  readonly credentialId: string
}

/**
 * Schema for `GetCredentialParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCredentialParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credentialId: Schema.String
  }).annotate({ identifier: "WebAuthn.GetCredentialParams" })
) as any as Schema.Codec<GetCredentialParams>

/**
 * Returns a single credential stored in the given virtual authenticator that
 * matches the credential ID.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCredentialResult {
  readonly credential: Credential
}

/**
 * Schema for `GetCredentialResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCredentialResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    credential: Credential
  }).annotate({ identifier: "WebAuthn.GetCredentialResult" })
) as any as Schema.Codec<GetCredentialResult>

/**
 * Returns all the credentials stored in the given virtual authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCredentialsParams {
  readonly authenticatorId: AuthenticatorId
}

/**
 * Schema for `GetCredentialsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCredentialsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId
  }).annotate({ identifier: "WebAuthn.GetCredentialsParams" })
) as any as Schema.Codec<GetCredentialsParams>

/**
 * Returns all the credentials stored in the given virtual authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCredentialsResult {
  readonly credentials: ReadonlyArray<Credential>
}

/**
 * Schema for `GetCredentialsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCredentialsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    credentials: Schema.Array(Credential)
  }).annotate({ identifier: "WebAuthn.GetCredentialsResult" })
) as any as Schema.Codec<GetCredentialsResult>

/**
 * Removes a credential from the authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveCredentialParams {
  readonly authenticatorId: AuthenticatorId
  readonly credentialId: string
}

/**
 * Schema for `RemoveCredentialParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveCredentialParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credentialId: Schema.String
  }).annotate({ identifier: "WebAuthn.RemoveCredentialParams" })
) as any as Schema.Codec<RemoveCredentialParams>

/**
 * Removes the given authenticator.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveVirtualAuthenticatorParams {
  readonly authenticatorId: AuthenticatorId
}

/**
 * Schema for `RemoveVirtualAuthenticatorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveVirtualAuthenticatorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId
  }).annotate({ identifier: "WebAuthn.RemoveVirtualAuthenticatorParams" })
) as any as Schema.Codec<RemoveVirtualAuthenticatorParams>

/**
 * Sets whether tests of user presence will succeed immediately (if true) or fail to resolve (if false) for an authenticator.
 * The default is true.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAutomaticPresenceSimulationParams {
  readonly authenticatorId: AuthenticatorId
  readonly enabled: boolean
}

/**
 * Schema for `SetAutomaticPresenceSimulationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAutomaticPresenceSimulationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    enabled: Schema.Boolean
  }).annotate({ identifier: "WebAuthn.SetAutomaticPresenceSimulationParams" })
) as any as Schema.Codec<SetAutomaticPresenceSimulationParams>

/**
 * Allows setting credential properties.
 * https://w3c.github.io/webauthn/#sctn-automation-set-credential-properties
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetCredentialPropertiesParams {
  readonly authenticatorId: AuthenticatorId
  readonly credentialId: string
  readonly backupEligibility?: boolean | undefined
  readonly backupState?: boolean | undefined
  readonly activeCmtgKeyIndex?: number | undefined
  readonly generateCmtgKeyOnNextOperation?: boolean | undefined
  /**
   * Must be equal to or greater than -1.
   * If -1, the signature counter is removed from the credential, and every
   * assertion operation will report a value of 0.
   * See https://w3c.github.io/webauthn/#signature-counter
   */
  readonly signCount?: number | undefined
}

/**
 * Schema for `SetCredentialPropertiesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetCredentialPropertiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    credentialId: Schema.String,
    backupEligibility: Schema.optional(Schema.Boolean),
    backupState: Schema.optional(Schema.Boolean),
    activeCmtgKeyIndex: Schema.optional(Schema.Int),
    generateCmtgKeyOnNextOperation: Schema.optional(Schema.Boolean),
    signCount: Schema.optional(Schema.Number)
  }).annotate({ identifier: "WebAuthn.SetCredentialPropertiesParams" })
) as any as Schema.Codec<SetCredentialPropertiesParams>

/**
 * Resets parameters isBogusSignature, isBadUV, isBadUP to false if they are not present.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetResponseOverrideBitsParams {
  readonly authenticatorId: AuthenticatorId
  /**
   * If isBogusSignature is set, overrides the signature in the authenticator response to be zero.
   * Defaults to false.
   */
  readonly isBogusSignature?: boolean | undefined
  /**
   * If isBadUV is set, overrides the UV bit in the flags in the authenticator response to
   * be zero. Defaults to false.
   */
  readonly isBadUV?: boolean | undefined
  /**
   * If isBadUP is set, overrides the UP bit in the flags in the authenticator response to
   * be zero. Defaults to false.
   */
  readonly isBadUP?: boolean | undefined
}

/**
 * Schema for `SetResponseOverrideBitsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetResponseOverrideBitsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    isBogusSignature: Schema.optional(Schema.Boolean),
    isBadUV: Schema.optional(Schema.Boolean),
    isBadUP: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "WebAuthn.SetResponseOverrideBitsParams" })
) as any as Schema.Codec<SetResponseOverrideBitsParams>

/**
 * Sets whether User Verification succeeds or fails for an authenticator.
 * The default is true.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetUserVerifiedParams {
  readonly authenticatorId: AuthenticatorId
  readonly isUserVerified: boolean
}

/**
 * Schema for `SetUserVerifiedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetUserVerifiedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: AuthenticatorId,
    isUserVerified: Schema.Boolean
  }).annotate({ identifier: "WebAuthn.SetUserVerifiedParams" })
) as any as Schema.Codec<SetUserVerifiedParams>

/**
 * Adds the credential to the specified authenticator.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addCredential: Protocol.CommandDef<"WebAuthn.addCredential", AddCredentialParams, void> =
  /*#__PURE__*/ Protocol.command(
    "WebAuthn.addCredential",
    AddCredentialParams,
    undefined,
    { status: "stable" }
  )

/**
 * Creates and adds a virtual authenticator.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addVirtualAuthenticator: Protocol.CommandDef<
  "WebAuthn.addVirtualAuthenticator",
  AddVirtualAuthenticatorParams,
  AddVirtualAuthenticatorResult
> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.addVirtualAuthenticator",
  AddVirtualAuthenticatorParams,
  AddVirtualAuthenticatorResult,
  { status: "stable" }
)

/**
 * Clears all the credentials from the specified device.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearCredentials: Protocol.CommandDef<"WebAuthn.clearCredentials", ClearCredentialsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "WebAuthn.clearCredentials",
    ClearCredentialsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Disable the WebAuthn domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"WebAuthn.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable the WebAuthn domain and start intercepting credential storage and
 * retrieval with a virtual authenticator.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"WebAuthn.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Returns a single credential stored in the given virtual authenticator that
 * matches the credential ID.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getCredential: Protocol.CommandDef<"WebAuthn.getCredential", GetCredentialParams, GetCredentialResult> =
  /*#__PURE__*/ Protocol.command(
    "WebAuthn.getCredential",
    GetCredentialParams,
    GetCredentialResult,
    { status: "stable" }
  )

/**
 * Returns all the credentials stored in the given virtual authenticator.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getCredentials: Protocol.CommandDef<
  "WebAuthn.getCredentials",
  GetCredentialsParams,
  GetCredentialsResult
> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.getCredentials",
  GetCredentialsParams,
  GetCredentialsResult,
  { status: "stable" }
)

/**
 * Removes a credential from the authenticator.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeCredential: Protocol.CommandDef<"WebAuthn.removeCredential", RemoveCredentialParams, void> =
  /*#__PURE__*/ Protocol.command(
    "WebAuthn.removeCredential",
    RemoveCredentialParams,
    undefined,
    { status: "stable" }
  )

/**
 * Removes the given authenticator.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeVirtualAuthenticator: Protocol.CommandDef<
  "WebAuthn.removeVirtualAuthenticator",
  RemoveVirtualAuthenticatorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.removeVirtualAuthenticator",
  RemoveVirtualAuthenticatorParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets whether tests of user presence will succeed immediately (if true) or fail to resolve (if false) for an authenticator.
 * The default is true.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setAutomaticPresenceSimulation: Protocol.CommandDef<
  "WebAuthn.setAutomaticPresenceSimulation",
  SetAutomaticPresenceSimulationParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.setAutomaticPresenceSimulation",
  SetAutomaticPresenceSimulationParams,
  undefined,
  { status: "stable" }
)

/**
 * Allows setting credential properties.
 * https://w3c.github.io/webauthn/#sctn-automation-set-credential-properties
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setCredentialProperties: Protocol.CommandDef<
  "WebAuthn.setCredentialProperties",
  SetCredentialPropertiesParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.setCredentialProperties",
  SetCredentialPropertiesParams,
  undefined,
  { status: "stable" }
)

/**
 * Resets parameters isBogusSignature, isBadUV, isBadUP to false if they are not present.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setResponseOverrideBits: Protocol.CommandDef<
  "WebAuthn.setResponseOverrideBits",
  SetResponseOverrideBitsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "WebAuthn.setResponseOverrideBits",
  SetResponseOverrideBitsParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets whether User Verification succeeds or fails for an authenticator.
 * The default is true.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setUserVerified: Protocol.CommandDef<"WebAuthn.setUserVerified", SetUserVerifiedParams, void> =
  /*#__PURE__*/ Protocol.command(
    "WebAuthn.setUserVerified",
    SetUserVerifiedParams,
    undefined,
    { status: "stable" }
  )

/**
 * Triggered when a credential is added to an authenticator.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const credentialAdded: Protocol.EventDef<"WebAuthn.credentialAdded", CredentialAddedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAuthn.credentialAdded",
    CredentialAddedParams,
    { status: "stable" }
  )

/**
 * Triggered when a credential is used in a webauthn assertion.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const credentialAsserted: Protocol.EventDef<"WebAuthn.credentialAsserted", CredentialAssertedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAuthn.credentialAsserted",
    CredentialAssertedParams,
    { status: "stable" }
  )

/**
 * Triggered when a credential is deleted, e.g. through
 * PublicKeyCredential.signalUnknownCredential().
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const credentialDeleted: Protocol.EventDef<"WebAuthn.credentialDeleted", CredentialDeletedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAuthn.credentialDeleted",
    CredentialDeletedParams,
    { status: "stable" }
  )

/**
 * Triggered when a credential is updated, e.g. through
 * PublicKeyCredential.signalCurrentUserDetails().
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const credentialUpdated: Protocol.EventDef<"WebAuthn.credentialUpdated", CredentialUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAuthn.credentialUpdated",
    CredentialUpdatedParams,
    { status: "stable" }
  )
