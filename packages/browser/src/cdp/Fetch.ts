/**
 * A domain for letting clients substitute browser's network layer with client code.
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
import * as IO from "./IO.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"

/**
 * Authorization challenge for HTTP status code 401 or 407.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallenge = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: Schema.optional(AuthChallengeSource),
    origin: Schema.String,
    scheme: Schema.String,
    realm: Schema.String
  }).annotate({ identifier: "Fetch.AuthChallenge" })
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
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthChallengeResponse = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    response: AuthChallengeResponseResponse,
    username: Schema.optional(Schema.String),
    password: Schema.optional(Schema.RedactedFromValue(Schema.String))
  }).annotate({ identifier: "Fetch.AuthChallengeResponse" })
) as any as Schema.Codec<AuthChallengeResponse>

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
 * Response HTTP header entry
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HeaderEntry {
  readonly name: string
  readonly value: string
}

/**
 * Schema for `HeaderEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HeaderEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "Fetch.HeaderEntry" })
) as any as Schema.Codec<HeaderEntry>

/**
 * Unique request identifier.
 * Note that this does not identify individual HTTP requests that are part of
 * a network request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RequestId = Brand.Branded<string, "~@usestrider/browser/cdp/Fetch/RequestId">

/**
 * Schema for `RequestId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Fetch/RequestId")
) as any as Schema.Codec<RequestId>

/**
 * `RequestPattern`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestPattern {
  /**
   * Wildcards (`'*'` -> zero or more, `'?'` -> exactly one) are allowed. Escape character is
   * backslash. Omitting is equivalent to `"*"`.
   */
  readonly urlPattern?: string | undefined
  /**
   * If set, only requests for matching resource types will be intercepted.
   */
  readonly resourceType?: Network.ResourceType | undefined
  /**
   * Stage at which to begin intercepting requests. Default is Request.
   */
  readonly requestStage?: RequestStage | undefined
}

/**
 * Schema for `RequestPattern`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestPattern = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    urlPattern: Schema.optional(Schema.String),
    resourceType: Schema.optional(Network.ResourceType),
    requestStage: Schema.optional(RequestStage)
  }).annotate({ identifier: "Fetch.RequestPattern" })
) as any as Schema.Codec<RequestPattern>

/**
 * Stages of the request to handle. Request will intercept before the request is
 * sent. Response will intercept after the response is received (but before response
 * body is received).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RequestStage =
  | "Request"
  | "Response"
  | (string & {})

/**
 * Schema for `RequestStage`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestStage = Schema.String as any as Schema.Codec<RequestStage>

/**
 * Issued when the domain is enabled with handleAuthRequests set to true.
 * The request is paused until client responds with continueWithAuth.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AuthRequiredParams {
  /**
   * Each request the page makes will have a unique id.
   */
  readonly requestId: RequestId
  /**
   * The details of the request.
   */
  readonly request: Network.Request
  /**
   * The id of the frame that initiated the request.
   */
  readonly frameId: Page.FrameId
  /**
   * How the requested resource will be used.
   */
  readonly resourceType: Network.ResourceType
  /**
   * Details of the Authorization Challenge encountered.
   * If this is set, client should respond with continueRequest that
   * contains AuthChallengeResponse.
   */
  readonly authChallenge: AuthChallenge
}

/**
 * Schema for `AuthRequiredParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthRequiredParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    request: Network.Request,
    frameId: Page.FrameId,
    resourceType: Network.ResourceType,
    authChallenge: AuthChallenge
  }).annotate({ identifier: "Fetch.AuthRequiredParams" })
) as any as Schema.Codec<AuthRequiredParams>

/**
 * Continues the request, optionally modifying some of its parameters.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueRequestParams {
  /**
   * An id the client received in requestPaused event.
   */
  readonly requestId: RequestId
  /**
   * If set, the request url will be modified in a way that's not observable by page.
   */
  readonly url?: string | undefined
  /**
   * If set, the request method is overridden.
   */
  readonly method?: string | undefined
  /**
   * If set, overrides the post data in the request. (Encoded as a base64 string when passed over JSON)
   */
  readonly postData?: string | undefined
  /**
   * If set, overrides the request headers. Note that the overrides do not
   * extend to subsequent redirect hops, if a redirect happens. Another override
   * may be applied to a different request produced by a redirect.
   */
  readonly headers?: ReadonlyArray<HeaderEntry> | undefined
  /**
   * If set, overrides response interception behavior for this request.
   */
  readonly interceptResponse?: boolean | undefined
}

/**
 * Schema for `ContinueRequestParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueRequestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    url: Schema.optional(Schema.String),
    method: Schema.optional(Schema.String),
    postData: Schema.optional(Schema.String),
    headers: Schema.optional(Schema.Array(HeaderEntry)),
    interceptResponse: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Fetch.ContinueRequestParams" })
) as any as Schema.Codec<ContinueRequestParams>

/**
 * Continues loading of the paused response, optionally modifying the
 * response headers. If either responseCode or headers are modified, all of them
 * must be present.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContinueResponseParams {
  /**
   * An id the client received in requestPaused event.
   */
  readonly requestId: RequestId
  /**
   * An HTTP response code. If absent, original response code will be used.
   */
  readonly responseCode?: number | undefined
  /**
   * A textual representation of responseCode.
   * If absent, a standard phrase matching responseCode is used.
   */
  readonly responsePhrase?: string | undefined
  /**
   * Response headers. If absent, original response headers will be used.
   */
  readonly responseHeaders?: ReadonlyArray<HeaderEntry> | undefined
  /**
   * Alternative way of specifying response headers as a \0-separated
   * series of name: value pairs. Prefer the above method unless you
   * need to represent some non-UTF8 values that can't be transmitted
   * over the protocol as text. (Encoded as a base64 string when passed over JSON)
   */
  readonly binaryResponseHeaders?: string | undefined
}

/**
 * Schema for `ContinueResponseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContinueResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    responseCode: Schema.optional(Schema.Int),
    responsePhrase: Schema.optional(Schema.String),
    responseHeaders: Schema.optional(Schema.Array(HeaderEntry)),
    binaryResponseHeaders: Schema.optional(Schema.String)
  }).annotate({ identifier: "Fetch.ContinueResponseParams" })
) as any as Schema.Codec<ContinueResponseParams>

/**
 * Continues a request supplying authChallengeResponse following authRequired event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContinueWithAuthParams {
  /**
   * An id the client received in authRequired event.
   */
  readonly requestId: RequestId
  /**
   * Response to  with an authChallenge.
   */
  readonly authChallengeResponse: AuthChallengeResponse
}

/**
 * Schema for `ContinueWithAuthParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContinueWithAuthParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    authChallengeResponse: AuthChallengeResponse
  }).annotate({ identifier: "Fetch.ContinueWithAuthParams" })
) as any as Schema.Codec<ContinueWithAuthParams>

/**
 * Enables issuing of requestPaused events. A request will be paused until client
 * calls one of failRequest, fulfillRequest or continueRequest/continueWithAuth.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * If specified, only requests matching any of these patterns will produce
   * fetchRequested event and will be paused until clients response. If not set,
   * all requests will be affected.
   */
  readonly patterns?: ReadonlyArray<RequestPattern> | undefined
  /**
   * If true, authRequired events will be issued and requests will be paused
   * expecting a call to continueWithAuth.
   */
  readonly handleAuthRequests?: boolean | undefined
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
    patterns: Schema.optional(Schema.Array(RequestPattern)),
    handleAuthRequests: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Fetch.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Causes the request to fail with specified reason.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FailRequestParams {
  /**
   * An id the client received in requestPaused event.
   */
  readonly requestId: RequestId
  /**
   * Causes the request to fail with the given reason.
   */
  readonly errorReason: Network.ErrorReason
}

/**
 * Schema for `FailRequestParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FailRequestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    errorReason: Network.ErrorReason
  }).annotate({ identifier: "Fetch.FailRequestParams" })
) as any as Schema.Codec<FailRequestParams>

/**
 * Provides response to the request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FulfillRequestParams {
  /**
   * An id the client received in requestPaused event.
   */
  readonly requestId: RequestId
  /**
   * An HTTP response code.
   */
  readonly responseCode: number
  /**
   * Response headers.
   */
  readonly responseHeaders?: ReadonlyArray<HeaderEntry> | undefined
  /**
   * Alternative way of specifying response headers as a \0-separated
   * series of name: value pairs. Prefer the above method unless you
   * need to represent some non-UTF8 values that can't be transmitted
   * over the protocol as text. (Encoded as a base64 string when passed over JSON)
   */
  readonly binaryResponseHeaders?: string | undefined
  /**
   * A response body. If absent, original response body will be used if
   * the request is intercepted at the response stage and empty body
   * will be used if the request is intercepted at the request stage. (Encoded as a base64 string when passed over JSON)
   */
  readonly body?: string | undefined
  /**
   * A textual representation of responseCode.
   * If absent, a standard phrase matching responseCode is used.
   */
  readonly responsePhrase?: string | undefined
}

/**
 * Schema for `FulfillRequestParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FulfillRequestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    responseCode: Schema.Int,
    responseHeaders: Schema.optional(Schema.Array(HeaderEntry)),
    binaryResponseHeaders: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
    responsePhrase: Schema.optional(Schema.String)
  }).annotate({ identifier: "Fetch.FulfillRequestParams" })
) as any as Schema.Codec<FulfillRequestParams>

/**
 * Causes the body of the response to be received from the server and
 * returned as a single string. May only be issued for a request that
 * is paused in the Response stage and is mutually exclusive with
 * takeResponseBodyForInterceptionAsStream. Calling other methods that
 * affect the request or disabling fetch domain before body is received
 * results in an undefined behavior.
 * Note that the response body is not available for redirects. Requests
 * paused in the _redirect received_ state may be differentiated by
 * `responseCode` and presence of `location` response header, see
 * comments to `requestPaused` for details.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetResponseBodyParams {
  /**
   * Identifier for the intercepted request to get body for.
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
  }).annotate({ identifier: "Fetch.GetResponseBodyParams" })
) as any as Schema.Codec<GetResponseBodyParams>

/**
 * Causes the body of the response to be received from the server and
 * returned as a single string. May only be issued for a request that
 * is paused in the Response stage and is mutually exclusive with
 * takeResponseBodyForInterceptionAsStream. Calling other methods that
 * affect the request or disabling fetch domain before body is received
 * results in an undefined behavior.
 * Note that the response body is not available for redirects. Requests
 * paused in the _redirect received_ state may be differentiated by
 * `responseCode` and presence of `location` response header, see
 * comments to `requestPaused` for details.
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
  }).annotate({ identifier: "Fetch.GetResponseBodyResult" })
) as any as Schema.Codec<GetResponseBodyResult>

/**
 * Issued when the domain is enabled and the request URL matches the
 * specified filter. The request is paused until the client responds
 * with one of continueRequest, failRequest or fulfillRequest.
 * The stage of the request can be determined by presence of responseErrorReason
 * and responseStatusCode -- the request is at the response stage if either
 * of these fields is present and in the request stage otherwise.
 * Redirect responses and subsequent requests are reported similarly to regular
 * responses and requests. Redirect responses may be distinguished by the value
 * of `responseStatusCode` (which is one of 301, 302, 303, 307, 308) along with
 * presence of the `location` header. Requests resulting from a redirect will
 * have `redirectedRequestId` field set.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestPausedParams {
  /**
   * Each request the page makes will have a unique id.
   */
  readonly requestId: RequestId
  /**
   * The details of the request.
   */
  readonly request: Network.Request
  /**
   * The id of the frame that initiated the request.
   */
  readonly frameId: Page.FrameId
  /**
   * How the requested resource will be used.
   */
  readonly resourceType: Network.ResourceType
  /**
   * Response error if intercepted at response stage.
   */
  readonly responseErrorReason?: Network.ErrorReason | undefined
  /**
   * Response code if intercepted at response stage.
   */
  readonly responseStatusCode?: number | undefined
  /**
   * Response status text if intercepted at response stage.
   */
  readonly responseStatusText?: string | undefined
  /**
   * Response headers if intercepted at the response stage.
   */
  readonly responseHeaders?: ReadonlyArray<HeaderEntry> | undefined
  /**
   * If the intercepted request had a corresponding Network.requestWillBeSent event fired for it,
   * then this networkId will be the same as the requestId present in the requestWillBeSent event.
   */
  readonly networkId?: Network.RequestId | undefined
  /**
   * If the request is due to a redirect response from the server, the id of the request that
   * has caused the redirect.
   */
  readonly redirectedRequestId?: RequestId | undefined
}

/**
 * Schema for `RequestPausedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestPausedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    request: Network.Request,
    frameId: Page.FrameId,
    resourceType: Network.ResourceType,
    responseErrorReason: Schema.optional(Network.ErrorReason),
    responseStatusCode: Schema.optional(Schema.Int),
    responseStatusText: Schema.optional(Schema.String),
    responseHeaders: Schema.optional(Schema.Array(HeaderEntry)),
    networkId: Schema.optional(Network.RequestId),
    redirectedRequestId: Schema.optional(RequestId)
  }).annotate({ identifier: "Fetch.RequestPausedParams" })
) as any as Schema.Codec<RequestPausedParams>

/**
 * Returns a handle to the stream representing the response body.
 * The request must be paused in the HeadersReceived stage.
 * Note that after this command the request can't be continued
 * as is -- client either needs to cancel it or to provide the
 * response body.
 * The stream only supports sequential read, IO.read will fail if the position
 * is specified.
 * This method is mutually exclusive with getResponseBody.
 * Calling other methods that affect the request or disabling fetch
 * domain before body is received results in an undefined behavior.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakeResponseBodyAsStreamParams {
  readonly requestId: RequestId
}

/**
 * Schema for `TakeResponseBodyAsStreamParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakeResponseBodyAsStreamParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Fetch.TakeResponseBodyAsStreamParams" })
) as any as Schema.Codec<TakeResponseBodyAsStreamParams>

/**
 * Returns a handle to the stream representing the response body.
 * The request must be paused in the HeadersReceived stage.
 * Note that after this command the request can't be continued
 * as is -- client either needs to cancel it or to provide the
 * response body.
 * The stream only supports sequential read, IO.read will fail if the position
 * is specified.
 * This method is mutually exclusive with getResponseBody.
 * Calling other methods that affect the request or disabling fetch
 * domain before body is received results in an undefined behavior.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakeResponseBodyAsStreamResult {
  readonly stream: IO.StreamHandle
}

/**
 * Schema for `TakeResponseBodyAsStreamResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakeResponseBodyAsStreamResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    stream: IO.StreamHandle
  }).annotate({ identifier: "Fetch.TakeResponseBodyAsStreamResult" })
) as any as Schema.Codec<TakeResponseBodyAsStreamResult>

/**
 * Continues the request, optionally modifying some of its parameters.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueRequest: Protocol.CommandDef<"Fetch.continueRequest", ContinueRequestParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Fetch.continueRequest",
    ContinueRequestParams,
    undefined,
    { status: "stable" }
  )

/**
 * Continues loading of the paused response, optionally modifying the
 * response headers. If either responseCode or headers are modified, all of them
 * must be present.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const continueResponse: Protocol.CommandDef<"Fetch.continueResponse", ContinueResponseParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Fetch.continueResponse",
    ContinueResponseParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Continues a request supplying authChallengeResponse following authRequired event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const continueWithAuth: Protocol.CommandDef<"Fetch.continueWithAuth", ContinueWithAuthParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Fetch.continueWithAuth",
    ContinueWithAuthParams,
    undefined,
    { status: "stable" }
  )

/**
 * Disables the fetch domain.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Fetch.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Fetch.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables issuing of requestPaused events. A request will be paused until client
 * calls one of failRequest, fulfillRequest or continueRequest/continueWithAuth.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Fetch.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "Fetch.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Causes the request to fail with specified reason.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const failRequest: Protocol.CommandDef<"Fetch.failRequest", FailRequestParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Fetch.failRequest",
    FailRequestParams,
    undefined,
    { status: "stable" }
  )

/**
 * Provides response to the request.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const fulfillRequest: Protocol.CommandDef<"Fetch.fulfillRequest", FulfillRequestParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Fetch.fulfillRequest",
    FulfillRequestParams,
    undefined,
    { status: "stable" }
  )

/**
 * Causes the body of the response to be received from the server and
 * returned as a single string. May only be issued for a request that
 * is paused in the Response stage and is mutually exclusive with
 * takeResponseBodyForInterceptionAsStream. Calling other methods that
 * affect the request or disabling fetch domain before body is received
 * results in an undefined behavior.
 * Note that the response body is not available for redirects. Requests
 * paused in the _redirect received_ state may be differentiated by
 * `responseCode` and presence of `location` response header, see
 * comments to `requestPaused` for details.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getResponseBody: Protocol.CommandDef<
  "Fetch.getResponseBody",
  GetResponseBodyParams,
  GetResponseBodyResult
> = /*#__PURE__*/ Protocol.command(
  "Fetch.getResponseBody",
  GetResponseBodyParams,
  GetResponseBodyResult,
  { status: "stable" }
)

/**
 * Returns a handle to the stream representing the response body.
 * The request must be paused in the HeadersReceived stage.
 * Note that after this command the request can't be continued
 * as is -- client either needs to cancel it or to provide the
 * response body.
 * The stream only supports sequential read, IO.read will fail if the position
 * is specified.
 * This method is mutually exclusive with getResponseBody.
 * Calling other methods that affect the request or disabling fetch
 * domain before body is received results in an undefined behavior.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const takeResponseBodyAsStream: Protocol.CommandDef<
  "Fetch.takeResponseBodyAsStream",
  TakeResponseBodyAsStreamParams,
  TakeResponseBodyAsStreamResult
> = /*#__PURE__*/ Protocol.command(
  "Fetch.takeResponseBodyAsStream",
  TakeResponseBodyAsStreamParams,
  TakeResponseBodyAsStreamResult,
  { status: "stable", createsResource: true, release: [{ method: "IO.close", param: "handle", from: "/stream" }] }
)

/**
 * Issued when the domain is enabled with handleAuthRequests set to true.
 * The request is paused until client responds with continueWithAuth.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const authRequired: Protocol.EventDef<"Fetch.authRequired", AuthRequiredParams> = /*#__PURE__*/ Protocol.event(
  "Fetch.authRequired",
  AuthRequiredParams,
  { status: "stable" }
)

/**
 * Issued when the domain is enabled and the request URL matches the
 * specified filter. The request is paused until the client responds
 * with one of continueRequest, failRequest or fulfillRequest.
 * The stage of the request can be determined by presence of responseErrorReason
 * and responseStatusCode -- the request is at the response stage if either
 * of these fields is present and in the request stage otherwise.
 * Redirect responses and subsequent requests are reported similarly to regular
 * responses and requests. Redirect responses may be distinguished by the value
 * of `responseStatusCode` (which is one of 301, 302, 303, 307, 308) along with
 * presence of the `location` header. Requests resulting from a redirect will
 * have `redirectedRequestId` field set.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const requestPaused: Protocol.EventDef<"Fetch.requestPaused", RequestPausedParams> = /*#__PURE__*/ Protocol
  .event(
    "Fetch.requestPaused",
    RequestPausedParams,
    { status: "stable" }
  )
