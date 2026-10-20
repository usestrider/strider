/**
 * The session module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as BrowsingContext from "./BrowsingContext.ts"

/**
 * `AutodetectProxyConfiguration`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AutodetectProxyConfiguration {
  readonly proxyType: "autodetect"
}

/**
 * Schema for `AutodetectProxyConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AutodetectProxyConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    proxyType: Schema.Literal("autodetect")
  }).annotate({ identifier: "session.AutodetectProxyConfiguration" })
) as any as Schema.Codec<AutodetectProxyConfiguration>

/**
 * `CapabilitiesRequest`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CapabilitiesRequest {
  readonly alwaysMatch?: CapabilityRequest | undefined
  readonly firstMatch?: ReadonlyArray<CapabilityRequest> | undefined
}

/**
 * Schema for `CapabilitiesRequest`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CapabilitiesRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    alwaysMatch: Schema.optional(CapabilityRequest),
    firstMatch: Schema.optional(Schema.Array(CapabilityRequest))
  }).annotate({ identifier: "session.CapabilitiesRequest" })
) as any as Schema.Codec<CapabilitiesRequest>

/**
 * `CapabilityRequest`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CapabilityRequest {
  readonly acceptInsecureCerts?: boolean | undefined
  readonly browserName?: string | undefined
  readonly browserVersion?: string | undefined
  readonly platformName?: string | undefined
  readonly proxy?: ProxyConfiguration | undefined
  readonly unhandledPromptBehavior?: UserPromptHandler | undefined
}

/**
 * Schema for `CapabilityRequest`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CapabilityRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    acceptInsecureCerts: Schema.optional(Schema.Boolean),
    browserName: Schema.optional(Schema.String),
    browserVersion: Schema.optional(Schema.String),
    platformName: Schema.optional(Schema.String),
    proxy: Schema.optional(ProxyConfiguration),
    unhandledPromptBehavior: Schema.optional(UserPromptHandler)
  }).annotate({ identifier: "session.CapabilityRequest" })
) as any as Schema.Codec<CapabilityRequest>

/**
 * `CapabilityResponse`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CapabilityResponse {
  readonly acceptInsecureCerts: boolean
  readonly browserName: string
  readonly browserVersion: string
  readonly platformName: string
  readonly setWindowRect: boolean
  readonly userAgent: string
  readonly proxy?: ProxyConfiguration | undefined
  readonly unhandledPromptBehavior?: UserPromptHandler | undefined
  readonly webSocketUrl?: string | undefined
}

/**
 * Schema for `CapabilityResponse`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CapabilityResponse = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    acceptInsecureCerts: Schema.Boolean,
    browserName: Schema.String,
    browserVersion: Schema.String,
    platformName: Schema.String,
    setWindowRect: Schema.Boolean,
    userAgent: Schema.String,
    proxy: Schema.optional(ProxyConfiguration),
    unhandledPromptBehavior: Schema.optional(UserPromptHandler),
    webSocketUrl: Schema.optional(Schema.String)
  }).annotate({ identifier: "session.CapabilityResponse" })
) as any as Schema.Codec<CapabilityResponse>

/**
 * `DirectProxyConfiguration`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DirectProxyConfiguration {
  readonly proxyType: "direct"
}

/**
 * Schema for `DirectProxyConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DirectProxyConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    proxyType: Schema.Literal("direct")
  }).annotate({ identifier: "session.DirectProxyConfiguration" })
) as any as Schema.Codec<DirectProxyConfiguration>

/**
 * `EndResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EndResult = { readonly [key: string]: unknown }

/**
 * Schema for `EndResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EndResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<EndResult>

/**
 * `ManualProxyConfiguration`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ManualProxyConfiguration {
  readonly proxyType: "manual"
  readonly httpProxy?: string | undefined
  readonly sslProxy?: string | undefined
  readonly socksProxy?: string | undefined
  readonly socksVersion?: number | undefined
  readonly noProxy?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `ManualProxyConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ManualProxyConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    proxyType: Schema.Literal("manual"),
    httpProxy: Schema.optional(Schema.String),
    sslProxy: Schema.optional(Schema.String),
    socksProxy: Schema.optional(Schema.String),
    socksVersion: Schema.optional(Schema.Int),
    noProxy: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "session.ManualProxyConfiguration" })
) as any as Schema.Codec<ManualProxyConfiguration>

/**
 * `NewParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NewParameters {
  readonly capabilities: CapabilitiesRequest
}

/**
 * Schema for `NewParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NewParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    capabilities: CapabilitiesRequest
  }).annotate({ identifier: "session.NewParameters" })
) as any as Schema.Codec<NewParameters>

/**
 * `NewResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NewResult {
  readonly sessionId: string
  readonly capabilities: CapabilityResponse
}

/**
 * Schema for `NewResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NewResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: Schema.String,
    capabilities: CapabilityResponse
  }).annotate({ identifier: "session.NewResult" })
) as any as Schema.Codec<NewResult>

/**
 * `PacProxyConfiguration`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PacProxyConfiguration {
  readonly proxyType: "pac"
  readonly proxyAutoconfigUrl: string
}

/**
 * Schema for `PacProxyConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PacProxyConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    proxyType: Schema.Literal("pac"),
    proxyAutoconfigUrl: Schema.String
  }).annotate({ identifier: "session.PacProxyConfiguration" })
) as any as Schema.Codec<PacProxyConfiguration>

/**
 * `ProxyConfiguration`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ProxyConfiguration =
  | AutodetectProxyConfiguration
  | DirectProxyConfiguration
  | ManualProxyConfiguration
  | PacProxyConfiguration
  | SystemProxyConfiguration

/**
 * Schema for `ProxyConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProxyConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([
    AutodetectProxyConfiguration,
    DirectProxyConfiguration,
    ManualProxyConfiguration,
    PacProxyConfiguration,
    SystemProxyConfiguration
  ])
) as any as Schema.Codec<ProxyConfiguration>

/**
 * `StatusResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StatusResult {
  readonly ready: boolean
  readonly message: string
}

/**
 * Schema for `StatusResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StatusResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ready: Schema.Boolean,
    message: Schema.String
  }).annotate({ identifier: "session.StatusResult" })
) as any as Schema.Codec<StatusResult>

/**
 * `SubscribeParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SubscribeParameters {
  readonly events: ReadonlyArray<string>
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SubscribeParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SubscribeParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    events: Schema.Array(Schema.String),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "session.SubscribeParameters" })
) as any as Schema.Codec<SubscribeParameters>

/**
 * `SubscribeResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SubscribeResult {
  readonly subscription: Subscription
}

/**
 * Schema for `SubscribeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SubscribeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    subscription: Subscription
  }).annotate({ identifier: "session.SubscribeResult" })
) as any as Schema.Codec<SubscribeResult>

/**
 * `Subscription`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Subscription = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Session/Subscription">

/**
 * Schema for `Subscription`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Subscription = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Session/Subscription")
) as any as Schema.Codec<Subscription>

/**
 * `SystemProxyConfiguration`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SystemProxyConfiguration {
  readonly proxyType: "system"
}

/**
 * Schema for `SystemProxyConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SystemProxyConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    proxyType: Schema.Literal("system")
  }).annotate({ identifier: "session.SystemProxyConfiguration" })
) as any as Schema.Codec<SystemProxyConfiguration>

/**
 * `UnsubscribeByAttributesRequest`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UnsubscribeByAttributesRequest {
  readonly events: ReadonlyArray<string>
}

/**
 * Schema for `UnsubscribeByAttributesRequest`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UnsubscribeByAttributesRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    events: Schema.Array(Schema.String)
  }).annotate({ identifier: "session.UnsubscribeByAttributesRequest" })
) as any as Schema.Codec<UnsubscribeByAttributesRequest>

/**
 * `UnsubscribeByIDRequest`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UnsubscribeByIDRequest {
  readonly subscriptions: ReadonlyArray<Subscription>
}

/**
 * Schema for `UnsubscribeByIDRequest`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UnsubscribeByIDRequest = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    subscriptions: Schema.Array(Subscription)
  }).annotate({ identifier: "session.UnsubscribeByIDRequest" })
) as any as Schema.Codec<UnsubscribeByIDRequest>

/**
 * `UnsubscribeParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UnsubscribeParameters = UnsubscribeByAttributesRequest | UnsubscribeByIDRequest

/**
 * Schema for `UnsubscribeParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UnsubscribeParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([UnsubscribeByAttributesRequest, UnsubscribeByIDRequest])
) as any as Schema.Codec<UnsubscribeParameters>

/**
 * `UnsubscribeResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UnsubscribeResult = { readonly [key: string]: unknown }

/**
 * Schema for `UnsubscribeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UnsubscribeResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<UnsubscribeResult>

/**
 * `UserPromptHandler`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UserPromptHandler {
  readonly alert?: UserPromptHandlerType | undefined
  readonly beforeUnload?: UserPromptHandlerType | undefined
  readonly confirm?: UserPromptHandlerType | undefined
  readonly default?: UserPromptHandlerType | undefined
  readonly file?: UserPromptHandlerType | undefined
  readonly prompt?: UserPromptHandlerType | undefined
}

/**
 * Schema for `UserPromptHandler`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPromptHandler = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    alert: Schema.optional(UserPromptHandlerType),
    beforeUnload: Schema.optional(UserPromptHandlerType),
    confirm: Schema.optional(UserPromptHandlerType),
    default: Schema.optional(UserPromptHandlerType),
    file: Schema.optional(UserPromptHandlerType),
    prompt: Schema.optional(UserPromptHandlerType)
  }).annotate({ identifier: "session.UserPromptHandler" })
) as any as Schema.Codec<UserPromptHandler>

/**
 * `UserPromptHandlerType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UserPromptHandlerType =
  | "accept"
  | "dismiss"
  | "ignore"
  | (string & {})

/**
 * Schema for `UserPromptHandlerType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserPromptHandlerType = Schema.String as any as Schema.Codec<UserPromptHandlerType>

/**
 * Sends `session.end`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const end: Protocol.CommandDef<"session.end", void, void> = /*#__PURE__*/ Protocol.command(
  "session.end",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `session.new`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const new_: Protocol.CommandDef<"session.new", NewParameters, NewResult> = /*#__PURE__*/ Protocol.command(
  "session.new",
  NewParameters,
  NewResult,
  { status: "stable" }
)

/**
 * Sends `session.status`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const status: Protocol.CommandDef<"session.status", void, StatusResult> = /*#__PURE__*/ Protocol.command(
  "session.status",
  undefined,
  StatusResult,
  { status: "stable" }
)

/**
 * Sends `session.subscribe`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const subscribe: Protocol.CommandDef<"session.subscribe", SubscribeParameters, SubscribeResult> =
  /*#__PURE__*/ Protocol.command(
    "session.subscribe",
    SubscribeParameters,
    SubscribeResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "session.unsubscribe", param: "subscriptions", from: "/subscription", list: true }]
    }
  )

/**
 * Sends `session.unsubscribe`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const unsubscribe: Protocol.CommandDef<"session.unsubscribe", UnsubscribeParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "session.unsubscribe",
    UnsubscribeParameters,
    undefined,
    { status: "stable" }
  )
