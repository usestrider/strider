/**
 * The browser module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08), and the Permissions spec's module. Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Session from "./Session.ts"

/**
 * `ClientWindow`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ClientWindow = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Browser/ClientWindow">

/**
 * Schema for `ClientWindow`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClientWindow = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Browser/ClientWindow")
) as any as Schema.Codec<ClientWindow>

/**
 * `ClientWindowInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClientWindowInfo {
  readonly active: boolean
  readonly clientWindow: ClientWindow
  readonly height: number
  readonly state: ClientWindowInfoState
  readonly width: number
  readonly x: number
  readonly y: number
}

/**
 * Schema for `ClientWindowInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClientWindowInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    active: Schema.Boolean,
    clientWindow: ClientWindow,
    height: Schema.Int,
    state: ClientWindowInfoState,
    width: Schema.Int,
    x: Schema.Int,
    y: Schema.Int
  }).annotate({ identifier: "browser.ClientWindowInfo" })
) as any as Schema.Codec<ClientWindowInfo>

/**
 * `ClientWindowInfo.state` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ClientWindowInfoState =
  | "fullscreen"
  | "maximized"
  | "minimized"
  | "normal"
  | (string & {})

/**
 * Schema for `ClientWindowInfoState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClientWindowInfoState = Schema.String as any as Schema.Codec<ClientWindowInfoState>

/**
 * `CloseResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CloseResult = { readonly [key: string]: unknown }

/**
 * Schema for `CloseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<CloseResult>

/**
 * `CreateUserContextParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateUserContextParameters {
  readonly acceptInsecureCerts?: boolean | undefined
  readonly proxy?: Session.ProxyConfiguration | undefined
  readonly unhandledPromptBehavior?: Session.UserPromptHandler | undefined
}

/**
 * Schema for `CreateUserContextParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateUserContextParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    acceptInsecureCerts: Schema.optional(Schema.Boolean),
    proxy: Schema.optional(Session.ProxyConfiguration),
    unhandledPromptBehavior: Schema.optional(Session.UserPromptHandler)
  }).annotate({ identifier: "browser.CreateUserContextParameters" })
) as any as Schema.Codec<CreateUserContextParameters>

/**
 * `CreateUserContextResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CreateUserContextResult = UserContextInfo

/**
 * Schema for `CreateUserContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateUserContextResult = /*#__PURE__*/ Schema.suspend(() => UserContextInfo) as any as Schema.Codec<
  CreateUserContextResult
>

/**
 * `DownloadBehavior`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DownloadBehavior = DownloadBehaviorAllowed | DownloadBehaviorDenied

/**
 * Schema for `DownloadBehavior`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadBehavior = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([DownloadBehaviorAllowed, DownloadBehaviorDenied])
) as any as Schema.Codec<DownloadBehavior>

/**
 * `DownloadBehaviorAllowed`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadBehaviorAllowed {
  readonly type: "allowed"
  readonly destinationFolder: string
}

/**
 * Schema for `DownloadBehaviorAllowed`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadBehaviorAllowed = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("allowed"),
    destinationFolder: Schema.String
  }).annotate({ identifier: "browser.DownloadBehaviorAllowed" })
) as any as Schema.Codec<DownloadBehaviorAllowed>

/**
 * `DownloadBehaviorDenied`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DownloadBehaviorDenied {
  readonly type: "denied"
}

/**
 * Schema for `DownloadBehaviorDenied`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DownloadBehaviorDenied = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("denied")
  }).annotate({ identifier: "browser.DownloadBehaviorDenied" })
) as any as Schema.Codec<DownloadBehaviorDenied>

/**
 * `GetClientWindowsResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetClientWindowsResult {
  readonly clientWindows: ReadonlyArray<ClientWindowInfo>
}

/**
 * Schema for `GetClientWindowsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetClientWindowsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    clientWindows: Schema.Array(ClientWindowInfo)
  }).annotate({ identifier: "browser.GetClientWindowsResult" })
) as any as Schema.Codec<GetClientWindowsResult>

/**
 * `GetUserContextsResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetUserContextsResult {
  readonly userContexts: ReadonlyArray<UserContextInfo>
}

/**
 * Schema for `GetUserContextsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetUserContextsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userContexts: Schema.Array(UserContextInfo)
  }).annotate({ identifier: "browser.GetUserContextsResult" })
) as any as Schema.Codec<GetUserContextsResult>

/**
 * `RemoveUserContextParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveUserContextParameters {
  readonly userContext: UserContext
}

/**
 * Schema for `RemoveUserContextParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveUserContextParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userContext: UserContext
  }).annotate({ identifier: "browser.RemoveUserContextParameters" })
) as any as Schema.Codec<RemoveUserContextParameters>

/**
 * `RemoveUserContextResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoveUserContextResult = { readonly [key: string]: unknown }

/**
 * Schema for `RemoveUserContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveUserContextResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  RemoveUserContextResult
>

/**
 * `SetClientWindowStateParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetClientWindowStateParameters =
  | SetClientWindowStateParametersClientWindowNamedState
  | SetClientWindowStateParametersClientWindowRectState

/**
 * Schema for `SetClientWindowStateParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetClientWindowStateParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([
    SetClientWindowStateParametersClientWindowRectState,
    SetClientWindowStateParametersClientWindowNamedState
  ])
) as any as Schema.Codec<SetClientWindowStateParameters>

/**
 * `SetClientWindowStateParameters.ClientWindowNamedState`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetClientWindowStateParametersClientWindowNamedState {
  readonly clientWindow: ClientWindow
  readonly state: SetClientWindowStateParametersClientWindowNamedStateState
}

/**
 * Schema for `SetClientWindowStateParametersClientWindowNamedState`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetClientWindowStateParametersClientWindowNamedState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    clientWindow: ClientWindow,
    state: SetClientWindowStateParametersClientWindowNamedStateState
  }).annotate({ identifier: "browser.SetClientWindowStateParametersClientWindowNamedState" })
) as any as Schema.Codec<SetClientWindowStateParametersClientWindowNamedState>

/**
 * `SetClientWindowStateParameters.ClientWindowNamedState.state` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetClientWindowStateParametersClientWindowNamedStateState =
  | "fullscreen"
  | "maximized"
  | "minimized"
  | (string & {})

/**
 * Schema for `SetClientWindowStateParametersClientWindowNamedStateState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetClientWindowStateParametersClientWindowNamedStateState = Schema.String as any as Schema.Codec<
  SetClientWindowStateParametersClientWindowNamedStateState
>

/**
 * `SetClientWindowStateParameters.ClientWindowRectState`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetClientWindowStateParametersClientWindowRectState {
  readonly clientWindow: ClientWindow
  readonly state: "normal"
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly x?: number | undefined
  readonly y?: number | undefined
}

/**
 * Schema for `SetClientWindowStateParametersClientWindowRectState`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetClientWindowStateParametersClientWindowRectState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    clientWindow: ClientWindow,
    state: Schema.Literal("normal"),
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    x: Schema.optional(Schema.Int),
    y: Schema.optional(Schema.Int)
  }).annotate({ identifier: "browser.SetClientWindowStateParametersClientWindowRectState" })
) as any as Schema.Codec<SetClientWindowStateParametersClientWindowRectState>

/**
 * `SetClientWindowStateResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetClientWindowStateResult = ClientWindowInfo

/**
 * Schema for `SetClientWindowStateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetClientWindowStateResult = /*#__PURE__*/ Schema.suspend(() => ClientWindowInfo) as any as Schema.Codec<
  SetClientWindowStateResult
>

/**
 * `SetDownloadBehaviorParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDownloadBehaviorParameters {
  readonly downloadBehavior: DownloadBehavior | null
  readonly userContexts?: ReadonlyArray<UserContext> | undefined
}

/**
 * Schema for `SetDownloadBehaviorParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDownloadBehaviorParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    downloadBehavior: Schema.Union([DownloadBehavior, Schema.Null]),
    userContexts: Schema.optional(Schema.Array(UserContext))
  }).annotate({ identifier: "browser.SetDownloadBehaviorParameters" })
) as any as Schema.Codec<SetDownloadBehaviorParameters>

/**
 * `SetDownloadBehaviorResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetDownloadBehaviorResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetDownloadBehaviorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDownloadBehaviorResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetDownloadBehaviorResult
>

/**
 * `UserContext`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UserContext = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Browser/UserContext">

/**
 * Schema for `UserContext`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserContext = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Browser/UserContext")
) as any as Schema.Codec<UserContext>

/**
 * `UserContextInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UserContextInfo {
  readonly userContext: UserContext
}

/**
 * Schema for `UserContextInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserContextInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userContext: UserContext
  }).annotate({ identifier: "browser.UserContextInfo" })
) as any as Schema.Codec<UserContextInfo>

/**
 * Sends `browser.close`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const close: Protocol.CommandDef<"browser.close", void, void> = /*#__PURE__*/ Protocol.command(
  "browser.close",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `browser.createUserContext`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createUserContext: Protocol.CommandDef<
  "browser.createUserContext",
  CreateUserContextParameters,
  CreateUserContextResult
> = /*#__PURE__*/ Protocol.command(
  "browser.createUserContext",
  CreateUserContextParameters,
  CreateUserContextResult,
  {
    status: "stable",
    createsResource: true,
    release: [{ method: "browser.removeUserContext", param: "userContext", from: "/userContext" }]
  }
)

/**
 * Sends `browser.getClientWindows`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getClientWindows: Protocol.CommandDef<"browser.getClientWindows", void, GetClientWindowsResult> =
  /*#__PURE__*/ Protocol.command(
    "browser.getClientWindows",
    undefined,
    GetClientWindowsResult,
    { status: "stable" }
  )

/**
 * Sends `browser.getUserContexts`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getUserContexts: Protocol.CommandDef<"browser.getUserContexts", void, GetUserContextsResult> =
  /*#__PURE__*/ Protocol.command(
    "browser.getUserContexts",
    undefined,
    GetUserContextsResult,
    { status: "stable" }
  )

/**
 * Sends `browser.removeUserContext`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeUserContext: Protocol.CommandDef<"browser.removeUserContext", RemoveUserContextParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "browser.removeUserContext",
    RemoveUserContextParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `browser.setClientWindowState`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setClientWindowState: Protocol.CommandDef<
  "browser.setClientWindowState",
  SetClientWindowStateParameters,
  SetClientWindowStateResult
> = /*#__PURE__*/ Protocol.command(
  "browser.setClientWindowState",
  SetClientWindowStateParameters,
  SetClientWindowStateResult,
  { status: "stable" }
)

/**
 * Sends `browser.setDownloadBehavior`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDownloadBehavior: Protocol.CommandDef<
  "browser.setDownloadBehavior",
  SetDownloadBehaviorParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "browser.setDownloadBehavior",
  SetDownloadBehaviorParameters,
  undefined,
  { status: "stable" }
)
