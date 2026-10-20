/**
 * This domain allows interacting with the FedCM dialog.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Corresponds to IdentityRequestAccount
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Account {
  readonly accountId: string
  readonly email: string
  readonly name: string
  readonly givenName: string
  readonly pictureUrl: string
  readonly idpConfigUrl: string
  readonly idpLoginUrl: string
  readonly loginState: LoginState
  /**
   * These two are only set if the loginState is signUp
   */
  readonly termsOfServiceUrl?: string | undefined
  readonly privacyPolicyUrl?: string | undefined
}

/**
 * Schema for `Account`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Account = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    accountId: Schema.String,
    email: Schema.String,
    name: Schema.String,
    givenName: Schema.String,
    pictureUrl: Schema.String,
    idpConfigUrl: Schema.String,
    idpLoginUrl: Schema.String,
    loginState: LoginState,
    termsOfServiceUrl: Schema.optional(Schema.String),
    privacyPolicyUrl: Schema.optional(Schema.String)
  }).annotate({ identifier: "FedCm.Account" })
) as any as Schema.Codec<Account>

/**
 * The URLs that each account has
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AccountUrlType =
  | "TermsOfService"
  | "PrivacyPolicy"
  | (string & {})

/**
 * Schema for `AccountUrlType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AccountUrlType = Schema.String as any as Schema.Codec<AccountUrlType>

/**
 * The buttons on the FedCM dialog.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DialogButton =
  | "ConfirmIdpLoginContinue"
  | "ErrorGotIt"
  | "ErrorMoreDetails"
  | (string & {})

/**
 * Schema for `DialogButton`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DialogButton = Schema.String as any as Schema.Codec<DialogButton>

/**
 * The types of FedCM dialogs.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DialogType =
  | "AccountChooser"
  | "AutoReauthn"
  | "ConfirmIdpLogin"
  | "Error"
  | (string & {})

/**
 * Schema for `DialogType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DialogType = Schema.String as any as Schema.Codec<DialogType>

/**
 * Whether this is a sign-up or sign-in action for this account, i.e.
 * whether this account has ever been used to sign in to this RP before.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type LoginState =
  | "SignIn"
  | "SignUp"
  | (string & {})

/**
 * Schema for `LoginState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LoginState = Schema.String as any as Schema.Codec<LoginState>

/**
 * `clickDialogButton.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClickDialogButtonParams {
  readonly dialogId: string
  readonly dialogButton: DialogButton
}

/**
 * Schema for `ClickDialogButtonParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClickDialogButtonParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dialogId: Schema.String,
    dialogButton: DialogButton
  }).annotate({ identifier: "FedCm.ClickDialogButtonParams" })
) as any as Schema.Codec<ClickDialogButtonParams>

/**
 * Triggered when a dialog is closed, either by user action, JS abort,
 * or a command below.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DialogClosedParams {
  readonly dialogId: string
}

/**
 * Schema for `DialogClosedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DialogClosedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dialogId: Schema.String
  }).annotate({ identifier: "FedCm.DialogClosedParams" })
) as any as Schema.Codec<DialogClosedParams>

/**
 * `dialogShown.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DialogShownParams {
  readonly dialogId: string
  readonly dialogType: DialogType
  readonly accounts: ReadonlyArray<Account>
  /**
   * These exist primarily so that the caller can verify the
   * RP context was used appropriately.
   */
  readonly title: string
  readonly subtitle?: string | undefined
}

/**
 * Schema for `DialogShownParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DialogShownParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dialogId: Schema.String,
    dialogType: DialogType,
    accounts: Schema.Array(Account),
    title: Schema.String,
    subtitle: Schema.optional(Schema.String)
  }).annotate({ identifier: "FedCm.DialogShownParams" })
) as any as Schema.Codec<DialogShownParams>

/**
 * `dismissDialog.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DismissDialogParams {
  readonly dialogId: string
  readonly triggerCooldown?: boolean | undefined
}

/**
 * Schema for `DismissDialogParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DismissDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dialogId: Schema.String,
    triggerCooldown: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "FedCm.DismissDialogParams" })
) as any as Schema.Codec<DismissDialogParams>

/**
 * `enable.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * Allows callers to disable the promise rejection delay that would
   * normally happen, if this is unimportant to what's being tested.
   * (step 4 of https://fedidcg.github.io/FedCM/#browser-api-rp-sign-in)
   */
  readonly disableRejectionDelay?: boolean | undefined
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
    disableRejectionDelay: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "FedCm.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * `openUrl.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OpenUrlParams {
  readonly dialogId: string
  readonly accountIndex: number
  readonly accountUrlType: AccountUrlType
}

/**
 * Schema for `OpenUrlParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OpenUrlParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dialogId: Schema.String,
    accountIndex: Schema.Int,
    accountUrlType: AccountUrlType
  }).annotate({ identifier: "FedCm.OpenUrlParams" })
) as any as Schema.Codec<OpenUrlParams>

/**
 * `selectAccount.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SelectAccountParams {
  readonly dialogId: string
  readonly accountIndex: number
}

/**
 * Schema for `SelectAccountParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SelectAccountParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dialogId: Schema.String,
    accountIndex: Schema.Int
  }).annotate({ identifier: "FedCm.SelectAccountParams" })
) as any as Schema.Codec<SelectAccountParams>

/**
 * Sends `FedCm.clickDialogButton`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clickDialogButton: Protocol.CommandDef<"FedCm.clickDialogButton", ClickDialogButtonParams, void> =
  /*#__PURE__*/ Protocol.command(
    "FedCm.clickDialogButton",
    ClickDialogButtonParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `FedCm.disable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"FedCm.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "FedCm.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `FedCm.dismissDialog`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const dismissDialog: Protocol.CommandDef<"FedCm.dismissDialog", DismissDialogParams, void> =
  /*#__PURE__*/ Protocol.command(
    "FedCm.dismissDialog",
    DismissDialogParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `FedCm.enable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"FedCm.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "FedCm.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `FedCm.openUrl`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const openUrl: Protocol.CommandDef<"FedCm.openUrl", OpenUrlParams, void> = /*#__PURE__*/ Protocol.command(
  "FedCm.openUrl",
  OpenUrlParams,
  undefined,
  { status: "stable" }
)

/**
 * Resets the cooldown time, if any, to allow the next FedCM call to show
 * a dialog even if one was recently dismissed by the user.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const resetCooldown: Protocol.CommandDef<"FedCm.resetCooldown", void, void> = /*#__PURE__*/ Protocol.command(
  "FedCm.resetCooldown",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `FedCm.selectAccount`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const selectAccount: Protocol.CommandDef<"FedCm.selectAccount", SelectAccountParams, void> =
  /*#__PURE__*/ Protocol.command(
    "FedCm.selectAccount",
    SelectAccountParams,
    undefined,
    { status: "stable" }
  )

/**
 * Triggered when a dialog is closed, either by user action, JS abort,
 * or a command below.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const dialogClosed: Protocol.EventDef<"FedCm.dialogClosed", DialogClosedParams> = /*#__PURE__*/ Protocol.event(
  "FedCm.dialogClosed",
  DialogClosedParams,
  { status: "stable" }
)

/**
 * The `FedCm.dialogShown` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const dialogShown: Protocol.EventDef<"FedCm.dialogShown", DialogShownParams> = /*#__PURE__*/ Protocol.event(
  "FedCm.dialogShown",
  DialogShownParams,
  { status: "stable" }
)
