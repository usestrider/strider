/**
 * The network module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as BrowsingContext from "./BrowsingContext.ts"
import * as Script from "./Script.ts"

/**
 * `AddDataCollectorParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddDataCollectorParameters {
  readonly dataTypes: ReadonlyArray<DataType>
  readonly maxEncodedDataSize: number
  readonly collectorType?: CollectorType | undefined
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `AddDataCollectorParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddDataCollectorParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataTypes: Schema.Array(DataType),
    maxEncodedDataSize: Schema.Int,
    collectorType: Schema.optional(CollectorType),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "network.AddDataCollectorParameters" })
) as any as Schema.Codec<AddDataCollectorParameters>

/**
 * `AddDataCollectorResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddDataCollectorResult {
  readonly collector: Collector
}

/**
 * Schema for `AddDataCollectorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddDataCollectorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    collector: Collector
  }).annotate({ identifier: "network.AddDataCollectorResult" })
) as any as Schema.Codec<AddDataCollectorResult>

/**
 * `AddInterceptParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddInterceptParameters {
  readonly phases: ReadonlyArray<InterceptPhase>
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly urlPatterns?: ReadonlyArray<UrlPattern> | undefined
}

/**
 * Schema for `AddInterceptParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddInterceptParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    phases: Schema.Array(InterceptPhase),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    urlPatterns: Schema.optional(Schema.Array(UrlPattern))
  }).annotate({ identifier: "network.AddInterceptParameters" })
) as any as Schema.Codec<AddInterceptParameters>

/**
 * `AddInterceptResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddInterceptResult {
  readonly intercept: Intercept
}

/**
 * Schema for `AddInterceptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddInterceptResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    intercept: Intercept
  }).annotate({ identifier: "network.AddInterceptResult" })
) as any as Schema.Codec<AddInterceptResult>

/**
 * `AuthChallenge`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AuthChallenge {
  readonly scheme: string
  readonly realm: string
}

/**
 * Schema for `AuthChallenge`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallenge = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scheme: Schema.String,
    realm: Schema.String
  }).annotate({ identifier: "network.AuthChallenge" })
) as any as Schema.Codec<AuthChallenge>

/**
 * `AuthCredentials`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AuthCredentials {
  readonly type: "password"
  readonly username: string
  readonly password: Redacted.Redacted<string>
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
    type: Schema.Literal("password"),
    username: Schema.String,
    password: Schema.RedactedFromValue(Schema.String)
  }).annotate({ identifier: "network.AuthCredentials" })
) as any as Schema.Codec<AuthCredentials>

/**
 * `AuthRequiredParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AuthRequiredParameters {
  readonly context: BrowsingContext.BrowsingContext | null
  readonly isBlocked: boolean
  readonly navigation: BrowsingContext.Navigation | null
  readonly redirectCount: number
  readonly request: RequestData
  readonly timestamp: number
  readonly userContext?: Browser.UserContext | null | undefined
  readonly intercepts?: ReadonlyArray<Intercept> | undefined
  readonly response: ResponseData
}

/**
 * Schema for `AuthRequiredParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthRequiredParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.Union([BrowsingContext.BrowsingContext, Schema.Null]),
    isBlocked: Schema.Boolean,
    navigation: Schema.Union([BrowsingContext.Navigation, Schema.Null]),
    redirectCount: Schema.Int,
    request: RequestData,
    timestamp: Schema.Int,
    userContext: Schema.optional(Schema.Union([Browser.UserContext, Schema.Null])),
    intercepts: Schema.optional(Schema.Array(Intercept)),
    response: ResponseData
  }).annotate({ identifier: "network.AuthRequiredParameters" })
) as any as Schema.Codec<AuthRequiredParameters>

/**
 * `Base64Value`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Base64Value {
  readonly type: "base64"
  readonly value: string
}

/**
 * Schema for `Base64Value`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Base64Value = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("base64"),
    value: Schema.String
  }).annotate({ identifier: "network.Base64Value" })
) as any as Schema.Codec<Base64Value>

/**
 * `BeforeRequestSentParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BeforeRequestSentParameters {
  readonly context: BrowsingContext.BrowsingContext | null
  readonly isBlocked: boolean
  readonly navigation: BrowsingContext.Navigation | null
  readonly redirectCount: number
  readonly request: RequestData
  readonly timestamp: number
  readonly userContext?: Browser.UserContext | null | undefined
  readonly intercepts?: ReadonlyArray<Intercept> | undefined
  readonly initiator?: Initiator | undefined
}

/**
 * Schema for `BeforeRequestSentParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BeforeRequestSentParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.Union([BrowsingContext.BrowsingContext, Schema.Null]),
    isBlocked: Schema.Boolean,
    navigation: Schema.Union([BrowsingContext.Navigation, Schema.Null]),
    redirectCount: Schema.Int,
    request: RequestData,
    timestamp: Schema.Int,
    userContext: Schema.optional(Schema.Union([Browser.UserContext, Schema.Null])),
    intercepts: Schema.optional(Schema.Array(Intercept)),
    initiator: Schema.optional(Initiator)
  }).annotate({ identifier: "network.BeforeRequestSentParameters" })
) as any as Schema.Codec<BeforeRequestSentParameters>

/**
 * `BytesValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BytesValue = StringValue | Base64Value

/**
 * Schema for `BytesValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BytesValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([StringValue, Base64Value])
) as any as Schema.Codec<BytesValue>

/**
 * `Collector`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Collector = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Network/Collector">

/**
 * Schema for `Collector`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Collector = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Network/Collector")
) as any as Schema.Codec<Collector>

/**
 * `CollectorType`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CollectorType = "blob"

/**
 * Schema for `CollectorType`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CollectorType = Schema.Literal("blob") as any as Schema.Codec<CollectorType>

/**
 * `ContinueRequestParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueRequestParameters {
  readonly request: Request
  readonly body?: BytesValue | undefined
  readonly cookies?: ReadonlyArray<CookieHeader> | undefined
  readonly headers?: ReadonlyArray<Header> | undefined
  readonly method?: string | undefined
  readonly url?: string | undefined
}

/**
 * Schema for `ContinueRequestParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueRequestParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request,
    body: Schema.optional(BytesValue),
    cookies: Schema.optional(Schema.Array(CookieHeader)),
    headers: Schema.optional(Schema.Array(Header)),
    method: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String)
  }).annotate({ identifier: "network.ContinueRequestParameters" })
) as any as Schema.Codec<ContinueRequestParameters>

/**
 * `ContinueRequestResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContinueRequestResult = { readonly [key: string]: unknown }

/**
 * Schema for `ContinueRequestResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueRequestResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  ContinueRequestResult
>

/**
 * `ContinueResponseParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueResponseParameters {
  readonly request: Request
  readonly cookies?: ReadonlyArray<SetCookieHeader> | undefined
  readonly credentials?: AuthCredentials | undefined
  readonly headers?: ReadonlyArray<Header> | undefined
  readonly reasonPhrase?: string | undefined
  readonly statusCode?: number | undefined
}

/**
 * Schema for `ContinueResponseParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueResponseParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request,
    cookies: Schema.optional(Schema.Array(SetCookieHeader)),
    credentials: Schema.optional(AuthCredentials),
    headers: Schema.optional(Schema.Array(Header)),
    reasonPhrase: Schema.optional(Schema.String),
    statusCode: Schema.optional(Schema.Int)
  }).annotate({ identifier: "network.ContinueResponseParameters" })
) as any as Schema.Codec<ContinueResponseParameters>

/**
 * `ContinueResponseResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContinueResponseResult = { readonly [key: string]: unknown }

/**
 * Schema for `ContinueResponseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueResponseResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  ContinueResponseResult
>

/**
 * `ContinueWithAuthParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContinueWithAuthParameters =
  | ContinueWithAuthParametersContinueWithAuthCredentials
  | ContinueWithAuthParametersContinueWithAuthNoCredentials

/**
 * Schema for `ContinueWithAuthParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueWithAuthParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([
    ContinueWithAuthParametersContinueWithAuthCredentials,
    ContinueWithAuthParametersContinueWithAuthNoCredentials
  ])
) as any as Schema.Codec<ContinueWithAuthParameters>

/**
 * `ContinueWithAuthParameters.ContinueWithAuthCredentials`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueWithAuthParametersContinueWithAuthCredentials {
  readonly request: Request
  readonly action: "provideCredentials"
  readonly credentials: AuthCredentials
}

/**
 * Schema for `ContinueWithAuthParametersContinueWithAuthCredentials`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueWithAuthParametersContinueWithAuthCredentials = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request,
    action: Schema.Literal("provideCredentials"),
    credentials: AuthCredentials
  }).annotate({ identifier: "network.ContinueWithAuthParametersContinueWithAuthCredentials" })
) as any as Schema.Codec<ContinueWithAuthParametersContinueWithAuthCredentials>

/**
 * `ContinueWithAuthParameters.ContinueWithAuthNoCredentials`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueWithAuthParametersContinueWithAuthNoCredentials {
  readonly request: Request
  readonly action: ContinueWithAuthParametersContinueWithAuthNoCredentialsAction
}

/**
 * Schema for `ContinueWithAuthParametersContinueWithAuthNoCredentials`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueWithAuthParametersContinueWithAuthNoCredentials = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request,
    action: ContinueWithAuthParametersContinueWithAuthNoCredentialsAction
  }).annotate({ identifier: "network.ContinueWithAuthParametersContinueWithAuthNoCredentials" })
) as any as Schema.Codec<ContinueWithAuthParametersContinueWithAuthNoCredentials>

/**
 * `ContinueWithAuthParameters.ContinueWithAuthNoCredentials.action` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContinueWithAuthParametersContinueWithAuthNoCredentialsAction =
  | "default"
  | "cancel"
  | (string & {})

/**
 * Schema for `ContinueWithAuthParametersContinueWithAuthNoCredentialsAction`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueWithAuthParametersContinueWithAuthNoCredentialsAction = Schema.String as any as Schema.Codec<
  ContinueWithAuthParametersContinueWithAuthNoCredentialsAction
>

/**
 * `ContinueWithAuthResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ContinueWithAuthResult = { readonly [key: string]: unknown }

/**
 * Schema for `ContinueWithAuthResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueWithAuthResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  ContinueWithAuthResult
>

/**
 * `Cookie`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Cookie {
  readonly name: string
  readonly value: Redacted.Redacted<BytesValue>
  readonly domain: string
  readonly path: string
  readonly size: number
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: SameSite
  readonly expiry?: number | undefined
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
    value: Schema.RedactedFromValue(BytesValue),
    domain: Schema.String,
    path: Schema.String,
    size: Schema.Int,
    httpOnly: Schema.Boolean,
    secure: Schema.Boolean,
    sameSite: SameSite,
    expiry: Schema.optional(Schema.Int)
  }).annotate({ identifier: "network.Cookie" })
) as any as Schema.Codec<Cookie>

/**
 * `CookieHeader`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CookieHeader {
  readonly name: string
  readonly value: Redacted.Redacted<BytesValue>
}

/**
 * Schema for `CookieHeader`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieHeader = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(BytesValue)
  }).annotate({ identifier: "network.CookieHeader" })
) as any as Schema.Codec<CookieHeader>

/**
 * `DataType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DataType =
  | "request"
  | "response"
  | (string & {})

/**
 * Schema for `DataType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DataType = Schema.String as any as Schema.Codec<DataType>

/**
 * `DisownDataParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DisownDataParameters {
  readonly dataType: DataType
  readonly collector: Collector
  readonly request: Request
}

/**
 * Schema for `DisownDataParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisownDataParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataType: DataType,
    collector: Collector,
    request: Request
  }).annotate({ identifier: "network.DisownDataParameters" })
) as any as Schema.Codec<DisownDataParameters>

/**
 * `DisownDataResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DisownDataResult = { readonly [key: string]: unknown }

/**
 * Schema for `DisownDataResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisownDataResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<DisownDataResult>

/**
 * `FailRequestParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FailRequestParameters {
  readonly request: Request
}

/**
 * Schema for `FailRequestParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FailRequestParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request
  }).annotate({ identifier: "network.FailRequestParameters" })
) as any as Schema.Codec<FailRequestParameters>

/**
 * `FailRequestResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FailRequestResult = { readonly [key: string]: unknown }

/**
 * Schema for `FailRequestResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FailRequestResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<FailRequestResult>

/**
 * `FetchErrorParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FetchErrorParameters {
  readonly context: BrowsingContext.BrowsingContext | null
  readonly isBlocked: boolean
  readonly navigation: BrowsingContext.Navigation | null
  readonly redirectCount: number
  readonly request: RequestData
  readonly timestamp: number
  readonly userContext?: Browser.UserContext | null | undefined
  readonly intercepts?: ReadonlyArray<Intercept> | undefined
  readonly errorText: string
}

/**
 * Schema for `FetchErrorParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FetchErrorParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.Union([BrowsingContext.BrowsingContext, Schema.Null]),
    isBlocked: Schema.Boolean,
    navigation: Schema.Union([BrowsingContext.Navigation, Schema.Null]),
    redirectCount: Schema.Int,
    request: RequestData,
    timestamp: Schema.Int,
    userContext: Schema.optional(Schema.Union([Browser.UserContext, Schema.Null])),
    intercepts: Schema.optional(Schema.Array(Intercept)),
    errorText: Schema.String
  }).annotate({ identifier: "network.FetchErrorParameters" })
) as any as Schema.Codec<FetchErrorParameters>

/**
 * `FetchTimingInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FetchTimingInfo {
  readonly timeOrigin: number
  readonly requestTime: number
  readonly redirectStart: number
  readonly redirectEnd: number
  readonly fetchStart: number
  readonly dnsStart: number
  readonly dnsEnd: number
  readonly connectStart: number
  readonly connectEnd: number
  readonly tlsStart: number
  readonly requestStart: number
  readonly responseStart: number
  readonly responseEnd: number
}

/**
 * Schema for `FetchTimingInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FetchTimingInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timeOrigin: Schema.Number,
    requestTime: Schema.Number,
    redirectStart: Schema.Number,
    redirectEnd: Schema.Number,
    fetchStart: Schema.Number,
    dnsStart: Schema.Number,
    dnsEnd: Schema.Number,
    connectStart: Schema.Number,
    connectEnd: Schema.Number,
    tlsStart: Schema.Number,
    requestStart: Schema.Number,
    responseStart: Schema.Number,
    responseEnd: Schema.Number
  }).annotate({ identifier: "network.FetchTimingInfo" })
) as any as Schema.Codec<FetchTimingInfo>

/**
 * `GetDataParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDataParameters {
  readonly dataType: DataType
  readonly collector?: Collector | undefined
  readonly disown?: boolean | undefined
  readonly request: Request
}

/**
 * Schema for `GetDataParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDataParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataType: DataType,
    collector: Schema.optional(Collector),
    disown: Schema.optional(Schema.Boolean),
    request: Request
  }).annotate({ identifier: "network.GetDataParameters" })
) as any as Schema.Codec<GetDataParameters>

/**
 * `GetDataResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDataResult {
  readonly bytes: BytesValue
}

/**
 * Schema for `GetDataResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDataResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bytes: BytesValue
  }).annotate({ identifier: "network.GetDataResult" })
) as any as Schema.Codec<GetDataResult>

/**
 * `Header`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Header {
  readonly name: string
  readonly value: BytesValue
}

/**
 * Schema for `Header`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Header = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: BytesValue
  }).annotate({ identifier: "network.Header" })
) as any as Schema.Codec<Header>

/**
 * `Initiator`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Initiator {
  readonly columnNumber?: number | undefined
  readonly lineNumber?: number | undefined
  readonly request?: Request | undefined
  readonly stackTrace?: Script.StackTrace | undefined
  readonly type?: InitiatorType | undefined
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
    columnNumber: Schema.optional(Schema.Int),
    lineNumber: Schema.optional(Schema.Int),
    request: Schema.optional(Request),
    stackTrace: Schema.optional(Script.StackTrace),
    type: Schema.optional(InitiatorType)
  }).annotate({ identifier: "network.Initiator" })
) as any as Schema.Codec<Initiator>

/**
 * `Initiator.type` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InitiatorType =
  | "parser"
  | "script"
  | "preflight"
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
 * `Intercept`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Intercept = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Network/Intercept">

/**
 * Schema for `Intercept`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Intercept = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Network/Intercept")
) as any as Schema.Codec<Intercept>

/**
 * `InterceptPhase` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InterceptPhase =
  | "beforeRequestSent"
  | "responseStarted"
  | "authRequired"
  | (string & {})

/**
 * Schema for `InterceptPhase`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InterceptPhase = Schema.String as any as Schema.Codec<InterceptPhase>

/**
 * `ProvideResponseParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProvideResponseParameters {
  readonly request: Request
  readonly body?: BytesValue | undefined
  readonly cookies?: ReadonlyArray<SetCookieHeader> | undefined
  readonly headers?: ReadonlyArray<Header> | undefined
  readonly reasonPhrase?: string | undefined
  readonly statusCode?: number | undefined
}

/**
 * Schema for `ProvideResponseParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProvideResponseParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request,
    body: Schema.optional(BytesValue),
    cookies: Schema.optional(Schema.Array(SetCookieHeader)),
    headers: Schema.optional(Schema.Array(Header)),
    reasonPhrase: Schema.optional(Schema.String),
    statusCode: Schema.optional(Schema.Int)
  }).annotate({ identifier: "network.ProvideResponseParameters" })
) as any as Schema.Codec<ProvideResponseParameters>

/**
 * `ProvideResponseResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ProvideResponseResult = { readonly [key: string]: unknown }

/**
 * Schema for `ProvideResponseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProvideResponseResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  ProvideResponseResult
>

/**
 * `RemoveDataCollectorParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveDataCollectorParameters {
  readonly collector: Collector
}

/**
 * Schema for `RemoveDataCollectorParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveDataCollectorParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    collector: Collector
  }).annotate({ identifier: "network.RemoveDataCollectorParameters" })
) as any as Schema.Codec<RemoveDataCollectorParameters>

/**
 * `RemoveDataCollectorResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoveDataCollectorResult = { readonly [key: string]: unknown }

/**
 * Schema for `RemoveDataCollectorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveDataCollectorResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  RemoveDataCollectorResult
>

/**
 * `RemoveInterceptParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveInterceptParameters {
  readonly intercept: Intercept
}

/**
 * Schema for `RemoveInterceptParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveInterceptParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    intercept: Intercept
  }).annotate({ identifier: "network.RemoveInterceptParameters" })
) as any as Schema.Codec<RemoveInterceptParameters>

/**
 * `RemoveInterceptResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoveInterceptResult = { readonly [key: string]: unknown }

/**
 * Schema for `RemoveInterceptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveInterceptResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  RemoveInterceptResult
>

/**
 * `Request`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Request = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Network/Request">

/**
 * Schema for `Request`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Request = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Network/Request")
) as any as Schema.Codec<Request>

/**
 * `RequestData`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestData {
  readonly request: Request
  readonly url: string
  readonly method: string
  readonly headers: ReadonlyArray<Header>
  readonly cookies: ReadonlyArray<Cookie>
  readonly headersSize: number
  readonly bodySize: number | null
  readonly destination: string
  readonly initiatorType: string | null
  readonly timings: FetchTimingInfo
}

/**
 * Schema for `RequestData`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    request: Request,
    url: Schema.String,
    method: Schema.String,
    headers: Schema.Array(Header),
    cookies: Schema.Array(Cookie),
    headersSize: Schema.Int,
    bodySize: Schema.Union([Schema.Int, Schema.Null]),
    destination: Schema.String,
    initiatorType: Schema.Union([Schema.String, Schema.Null]),
    timings: FetchTimingInfo
  }).annotate({ identifier: "network.RequestData" })
) as any as Schema.Codec<RequestData>

/**
 * `ResponseCompletedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseCompletedParameters {
  readonly context: BrowsingContext.BrowsingContext | null
  readonly isBlocked: boolean
  readonly navigation: BrowsingContext.Navigation | null
  readonly redirectCount: number
  readonly request: RequestData
  readonly timestamp: number
  readonly userContext?: Browser.UserContext | null | undefined
  readonly intercepts?: ReadonlyArray<Intercept> | undefined
  readonly response: ResponseData
}

/**
 * Schema for `ResponseCompletedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseCompletedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.Union([BrowsingContext.BrowsingContext, Schema.Null]),
    isBlocked: Schema.Boolean,
    navigation: Schema.Union([BrowsingContext.Navigation, Schema.Null]),
    redirectCount: Schema.Int,
    request: RequestData,
    timestamp: Schema.Int,
    userContext: Schema.optional(Schema.Union([Browser.UserContext, Schema.Null])),
    intercepts: Schema.optional(Schema.Array(Intercept)),
    response: ResponseData
  }).annotate({ identifier: "network.ResponseCompletedParameters" })
) as any as Schema.Codec<ResponseCompletedParameters>

/**
 * `ResponseContent`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseContent {
  readonly size: number
}

/**
 * Schema for `ResponseContent`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseContent = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    size: Schema.Int
  }).annotate({ identifier: "network.ResponseContent" })
) as any as Schema.Codec<ResponseContent>

/**
 * `ResponseData`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseData {
  readonly url: string
  readonly protocol: string
  readonly status: number
  readonly statusText: string
  readonly fromCache: boolean
  readonly headers: ReadonlyArray<Header>
  readonly mimeType: string
  readonly bytesReceived: number
  readonly headersSize: number | null
  readonly bodySize: number | null
  readonly content: ResponseContent
  readonly authChallenges?: ReadonlyArray<AuthChallenge> | undefined
}

/**
 * Schema for `ResponseData`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    protocol: Schema.String,
    status: Schema.Int,
    statusText: Schema.String,
    fromCache: Schema.Boolean,
    headers: Schema.Array(Header),
    mimeType: Schema.String,
    bytesReceived: Schema.Int,
    headersSize: Schema.Union([Schema.Int, Schema.Null]),
    bodySize: Schema.Union([Schema.Int, Schema.Null]),
    content: ResponseContent,
    authChallenges: Schema.optional(Schema.Array(AuthChallenge))
  }).annotate({ identifier: "network.ResponseData" })
) as any as Schema.Codec<ResponseData>

/**
 * `ResponseStartedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseStartedParameters {
  readonly context: BrowsingContext.BrowsingContext | null
  readonly isBlocked: boolean
  readonly navigation: BrowsingContext.Navigation | null
  readonly redirectCount: number
  readonly request: RequestData
  readonly timestamp: number
  readonly userContext?: Browser.UserContext | null | undefined
  readonly intercepts?: ReadonlyArray<Intercept> | undefined
  readonly response: ResponseData
}

/**
 * Schema for `ResponseStartedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseStartedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.Union([BrowsingContext.BrowsingContext, Schema.Null]),
    isBlocked: Schema.Boolean,
    navigation: Schema.Union([BrowsingContext.Navigation, Schema.Null]),
    redirectCount: Schema.Int,
    request: RequestData,
    timestamp: Schema.Int,
    userContext: Schema.optional(Schema.Union([Browser.UserContext, Schema.Null])),
    intercepts: Schema.optional(Schema.Array(Intercept)),
    response: ResponseData
  }).annotate({ identifier: "network.ResponseStartedParameters" })
) as any as Schema.Codec<ResponseStartedParameters>

/**
 * `SameSite` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SameSite =
  | "strict"
  | "lax"
  | "none"
  | "default"
  | (string & {})

/**
 * Schema for `SameSite`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SameSite = Schema.String as any as Schema.Codec<SameSite>

/**
 * `SetCacheBehaviorParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCacheBehaviorParameters {
  readonly cacheBehavior: SetCacheBehaviorParametersCacheBehavior
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
}

/**
 * Schema for `SetCacheBehaviorParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCacheBehaviorParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheBehavior: SetCacheBehaviorParametersCacheBehavior,
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext))
  }).annotate({ identifier: "network.SetCacheBehaviorParameters" })
) as any as Schema.Codec<SetCacheBehaviorParameters>

/**
 * `SetCacheBehaviorParameters.cacheBehavior` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetCacheBehaviorParametersCacheBehavior =
  | "default"
  | "bypass"
  | (string & {})

/**
 * Schema for `SetCacheBehaviorParametersCacheBehavior`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCacheBehaviorParametersCacheBehavior = Schema.String as any as Schema.Codec<
  SetCacheBehaviorParametersCacheBehavior
>

/**
 * `SetCacheBehaviorResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetCacheBehaviorResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetCacheBehaviorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCacheBehaviorResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetCacheBehaviorResult
>

/**
 * `SetCookieHeader`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCookieHeader {
  readonly name: string
  readonly value: Redacted.Redacted<BytesValue>
  readonly domain?: string | undefined
  readonly httpOnly?: boolean | undefined
  readonly expiry?: string | undefined
  readonly maxAge?: number | undefined
  readonly path?: string | undefined
  readonly sameSite?: SameSite | undefined
  readonly secure?: boolean | undefined
}

/**
 * Schema for `SetCookieHeader`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCookieHeader = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(BytesValue),
    domain: Schema.optional(Schema.String),
    httpOnly: Schema.optional(Schema.Boolean),
    expiry: Schema.optional(Schema.String),
    maxAge: Schema.optional(Schema.Int),
    path: Schema.optional(Schema.String),
    sameSite: Schema.optional(SameSite),
    secure: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "network.SetCookieHeader" })
) as any as Schema.Codec<SetCookieHeader>

/**
 * `SetExtraHeadersParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetExtraHeadersParameters {
  readonly headers: ReadonlyArray<Header>
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetExtraHeadersParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetExtraHeadersParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    headers: Schema.Array(Header),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "network.SetExtraHeadersParameters" })
) as any as Schema.Codec<SetExtraHeadersParameters>

/**
 * `SetExtraHeadersResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetExtraHeadersResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetExtraHeadersResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetExtraHeadersResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetExtraHeadersResult
>

/**
 * `StringValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StringValue {
  readonly type: "string"
  readonly value: string
}

/**
 * Schema for `StringValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StringValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("string"),
    value: Schema.String
  }).annotate({ identifier: "network.StringValue" })
) as any as Schema.Codec<StringValue>

/**
 * `UrlPattern`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UrlPattern = UrlPatternPattern | UrlPatternString

/**
 * Schema for `UrlPattern`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UrlPattern = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([UrlPatternPattern, UrlPatternString])
) as any as Schema.Codec<UrlPattern>

/**
 * `UrlPatternPattern`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UrlPatternPattern {
  readonly type: "pattern"
  readonly protocol?: string | undefined
  readonly hostname?: string | undefined
  readonly port?: string | undefined
  readonly pathname?: string | undefined
  readonly search?: string | undefined
}

/**
 * Schema for `UrlPatternPattern`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UrlPatternPattern = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("pattern"),
    protocol: Schema.optional(Schema.String),
    hostname: Schema.optional(Schema.String),
    port: Schema.optional(Schema.String),
    pathname: Schema.optional(Schema.String),
    search: Schema.optional(Schema.String)
  }).annotate({ identifier: "network.UrlPatternPattern" })
) as any as Schema.Codec<UrlPatternPattern>

/**
 * `UrlPatternString`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UrlPatternString {
  readonly type: "string"
  readonly pattern: string
}

/**
 * Schema for `UrlPatternString`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UrlPatternString = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("string"),
    pattern: Schema.String
  }).annotate({ identifier: "network.UrlPatternString" })
) as any as Schema.Codec<UrlPatternString>

/**
 * Sends `network.addDataCollector`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addDataCollector: Protocol.CommandDef<
  "network.addDataCollector",
  AddDataCollectorParameters,
  AddDataCollectorResult
> = /*#__PURE__*/ Protocol.command(
  "network.addDataCollector",
  AddDataCollectorParameters,
  AddDataCollectorResult,
  {
    status: "stable",
    createsResource: true,
    release: [{ method: "network.removeDataCollector", param: "collector", from: "/collector" }]
  }
)

/**
 * Sends `network.addIntercept`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addIntercept: Protocol.CommandDef<"network.addIntercept", AddInterceptParameters, AddInterceptResult> =
  /*#__PURE__*/ Protocol.command(
    "network.addIntercept",
    AddInterceptParameters,
    AddInterceptResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "network.removeIntercept", param: "intercept", from: "/intercept" }]
    }
  )

/**
 * Sends `network.continueRequest`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueRequest: Protocol.CommandDef<"network.continueRequest", ContinueRequestParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.continueRequest",
    ContinueRequestParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.continueResponse`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueResponse: Protocol.CommandDef<"network.continueResponse", ContinueResponseParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.continueResponse",
    ContinueResponseParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.continueWithAuth`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueWithAuth: Protocol.CommandDef<"network.continueWithAuth", ContinueWithAuthParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.continueWithAuth",
    ContinueWithAuthParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.disownData`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disownData: Protocol.CommandDef<"network.disownData", DisownDataParameters, void> = /*#__PURE__*/ Protocol
  .command(
    "network.disownData",
    DisownDataParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.failRequest`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const failRequest: Protocol.CommandDef<"network.failRequest", FailRequestParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.failRequest",
    FailRequestParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.getData`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getData: Protocol.CommandDef<"network.getData", GetDataParameters, GetDataResult> = /*#__PURE__*/ Protocol
  .command(
    "network.getData",
    GetDataParameters,
    GetDataResult,
    { status: "stable" }
  )

/**
 * Sends `network.provideResponse`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const provideResponse: Protocol.CommandDef<"network.provideResponse", ProvideResponseParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.provideResponse",
    ProvideResponseParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.removeDataCollector`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeDataCollector: Protocol.CommandDef<
  "network.removeDataCollector",
  RemoveDataCollectorParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "network.removeDataCollector",
  RemoveDataCollectorParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `network.removeIntercept`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeIntercept: Protocol.CommandDef<"network.removeIntercept", RemoveInterceptParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.removeIntercept",
    RemoveInterceptParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.setCacheBehavior`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCacheBehavior: Protocol.CommandDef<"network.setCacheBehavior", SetCacheBehaviorParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.setCacheBehavior",
    SetCacheBehaviorParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `network.setExtraHeaders`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setExtraHeaders: Protocol.CommandDef<"network.setExtraHeaders", SetExtraHeadersParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "network.setExtraHeaders",
    SetExtraHeadersParameters,
    undefined,
    { status: "stable" }
  )

/**
 * The `network.authRequired` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const authRequired: Protocol.EventDef<"network.authRequired", AuthRequiredParameters> = /*#__PURE__*/ Protocol
  .event(
    "network.authRequired",
    AuthRequiredParameters,
    { status: "stable" }
  )

/**
 * The `network.beforeRequestSent` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const beforeRequestSent: Protocol.EventDef<"network.beforeRequestSent", BeforeRequestSentParameters> =
  /*#__PURE__*/ Protocol.event(
    "network.beforeRequestSent",
    BeforeRequestSentParameters,
    { status: "stable" }
  )

/**
 * The `network.fetchError` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const fetchError: Protocol.EventDef<"network.fetchError", FetchErrorParameters> = /*#__PURE__*/ Protocol.event(
  "network.fetchError",
  FetchErrorParameters,
  { status: "stable" }
)

/**
 * The `network.responseCompleted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const responseCompleted: Protocol.EventDef<"network.responseCompleted", ResponseCompletedParameters> =
  /*#__PURE__*/ Protocol.event(
    "network.responseCompleted",
    ResponseCompletedParameters,
    { status: "stable" }
  )

/**
 * The `network.responseStarted` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const responseStarted: Protocol.EventDef<"network.responseStarted", ResponseStartedParameters> =
  /*#__PURE__*/ Protocol.event(
    "network.responseStarted",
    ResponseStartedParameters,
    { status: "stable" }
  )
