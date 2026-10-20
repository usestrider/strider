/**
 * The Emulation domain.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Credentials for HTTP authentication.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AuthCredentials {
  readonly username: string
  readonly password: Redacted.Redacted<string>
  /**
   * When specified, the credentials are only used for challenges from the matching origin.
   */
  readonly origin?: string | undefined
}

/**
 * Schema for `AuthCredentials`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthCredentials = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    username: Schema.String,
    password: Schema.RedactedFromValue(Schema.String),
    origin: Schema.optional(Schema.String)
  }).annotate({ identifier: "Emulation.AuthCredentials" })
) as any as Schema.Codec<AuthCredentials>

/**
 * Overrides the permissions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GrantPermissionsParams {
  readonly origin: string
  readonly permissions: ReadonlyArray<string>
}

/**
 * Schema for `GrantPermissionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GrantPermissionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    permissions: Schema.Array(Schema.String)
  }).annotate({ identifier: "Emulation.GrantPermissionsParams" })
) as any as Schema.Codec<GrantPermissionsParams>

/**
 * Makes page focused for test.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetActiveAndFocusedParams {
  readonly active?: boolean | undefined
}

/**
 * Schema for `SetActiveAndFocusedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetActiveAndFocusedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    active: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Emulation.SetActiveAndFocusedParams" })
) as any as Schema.Codec<SetActiveAndFocusedParams>

/**
 * Credentials to use during HTTP authentication. The first credentials with matching origin are used. When missing, automation handling of authentication challenges is disabled.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAuthCredentialsParams {
  readonly credentials?: ReadonlyArray<AuthCredentials> | undefined
}

/**
 * Schema for `SetAuthCredentialsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAuthCredentialsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    credentials: Schema.optional(Schema.Array(AuthCredentials))
  }).annotate({ identifier: "Emulation.SetAuthCredentialsParams" })
) as any as Schema.Codec<SetAuthCredentialsParams>

/**
 * Overrides device metrics with provided values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDeviceMetricsOverrideParams {
  readonly width: number
  readonly height: number
  readonly fixedLayout: boolean
  readonly deviceScaleFactor?: number | undefined
}

/**
 * Schema for `SetDeviceMetricsOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDeviceMetricsOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Int,
    height: Schema.Int,
    fixedLayout: Schema.Boolean,
    deviceScaleFactor: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Emulation.SetDeviceMetricsOverrideParams" })
) as any as Schema.Codec<SetDeviceMetricsOverrideParams>

/**
 * Allows to disable script execution for the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetJavaScriptEnabledParams {
  readonly enabled: boolean
}

/**
 * Schema for `SetJavaScriptEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetJavaScriptEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetJavaScriptEnabledParams" })
) as any as Schema.Codec<SetJavaScriptEnabledParams>

/**
 * Overrides window.orientation with provided value.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetOrientationOverrideParams {
  readonly angle?: number | undefined
}

/**
 * Schema for `SetOrientationOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetOrientationOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    angle: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Emulation.SetOrientationOverrideParams" })
) as any as Schema.Codec<SetOrientationOverrideParams>

/**
 * Overrides the permissions.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const grantPermissions: Protocol.CommandDef<"Emulation.grantPermissions", GrantPermissionsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.grantPermissions",
    GrantPermissionsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Clears permission overrides.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resetPermissions: Protocol.CommandDef<"Emulation.resetPermissions", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Emulation.resetPermissions",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Makes page focused for test.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setActiveAndFocused: Protocol.CommandDef<
  "Emulation.setActiveAndFocused",
  SetActiveAndFocusedParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setActiveAndFocused",
  SetActiveAndFocusedParams,
  undefined,
  { status: "stable" }
)

/**
 * Credentials to use during HTTP authentication. The first credentials with matching origin are used. When missing, automation handling of authentication challenges is disabled.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAuthCredentials: Protocol.CommandDef<"Emulation.setAuthCredentials", SetAuthCredentialsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.setAuthCredentials",
    SetAuthCredentialsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Overrides device metrics with provided values.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDeviceMetricsOverride: Protocol.CommandDef<
  "Emulation.setDeviceMetricsOverride",
  SetDeviceMetricsOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDeviceMetricsOverride",
  SetDeviceMetricsOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Allows to disable script execution for the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setJavaScriptEnabled: Protocol.CommandDef<
  "Emulation.setJavaScriptEnabled",
  SetJavaScriptEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setJavaScriptEnabled",
  SetJavaScriptEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Overrides window.orientation with provided value.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setOrientationOverride: Protocol.CommandDef<
  "Emulation.setOrientationOverride",
  SetOrientationOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setOrientationOverride",
  SetOrientationOverrideParams,
  undefined,
  { status: "stable" }
)
