/**
 * Network domain allows tracking network activities of the page. It exposes information about http, file, data and other requests and responses, their headers, bodies, timing, etc.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Console from "./Console.ts"
import * as DOM from "./DOM.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"
import * as Security from "./Security.ts"

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
  readonly type: Page.ResourceType
  /**
   * Cached response data.
   */
  readonly response?: Response | undefined
  /**
   * Cached response body size.
   */
  readonly bodySize: number
  /**
   * URL of source map associated with this resource (if any).
   */
  readonly sourceMapURL?: string | undefined
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
    type: Page.ResourceType,
    response: Schema.optional(Response),
    bodySize: Schema.Number,
    sourceMapURL: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.CachedResource" })
) as any as Schema.Codec<CachedResource>

/**
 * Unique frame identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FrameId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Network/FrameId">

/**
 * Schema for `FrameId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Network/FrameId")
) as any as Schema.Codec<FrameId>

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
   */
  readonly stackTrace?: Console.StackTrace | undefined
  /**
   * Initiator URL, set for Parser type only.
   */
  readonly url?: string | undefined
  /**
   * Initiator line number, set for Parser type only.
   */
  readonly lineNumber?: number | undefined
  /**
   * Set if the load was triggered by a DOM node, in addition to the other initiator information.
   */
  readonly nodeId?: DOM.NodeId | undefined
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
    stackTrace: Schema.optional(Console.StackTrace),
    url: Schema.optional(Schema.String),
    lineNumber: Schema.optional(Schema.Number),
    nodeId: Schema.optional(DOM.NodeId)
  }).annotate({ identifier: "Network.Initiator" })
) as any as Schema.Codec<Initiator>

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
 * Unique loader identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LoaderId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Network/LoaderId">

/**
 * Schema for `LoaderId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoaderId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Network/LoaderId")
) as any as Schema.Codec<LoaderId>

/**
 * Network load metrics.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Metrics {
  /**
   * Network protocol. ALPN Protocol ID Identification Sequence, as per RFC 7301 (for example, http/2, http/1.1, spdy/3.1)
   */
  readonly protocol?: string | undefined
  /**
   * Network priority.
   */
  readonly priority?: MetricsPriority | undefined
  /**
   * Connection identifier.
   */
  readonly connectionIdentifier?: string | undefined
  /**
   * Remote IP address.
   */
  readonly remoteAddress?: string | undefined
  /**
   * Refined HTTP request headers that were actually transmitted over the network.
   */
  readonly requestHeaders?: Headers | undefined
  /**
   * Total HTTP request header bytes sent over the network.
   */
  readonly requestHeaderBytesSent?: number | undefined
  /**
   * Total HTTP request body bytes sent over the network.
   */
  readonly requestBodyBytesSent?: number | undefined
  /**
   * Total HTTP response header bytes received over the network.
   */
  readonly responseHeaderBytesReceived?: number | undefined
  /**
   * Total HTTP response body bytes received over the network.
   */
  readonly responseBodyBytesReceived?: number | undefined
  /**
   * Total decoded response body size in bytes.
   */
  readonly responseBodyDecodedSize?: number | undefined
  /**
   * Connection information for the completed request.
   */
  readonly securityConnection?: Security.Connection | undefined
  /**
   * Whether or not the connection was proxied through a server. If <code>true</code>, the <code>remoteAddress</code> will be for the proxy server, not the server that provided the resource to the proxy server.
   */
  readonly isProxyConnection?: boolean | undefined
}

/**
 * Schema for `Metrics`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Metrics = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: Schema.optional(Schema.String),
    priority: Schema.optional(MetricsPriority),
    connectionIdentifier: Schema.optional(Schema.String),
    remoteAddress: Schema.optional(Schema.String),
    requestHeaders: Schema.optional(Headers),
    requestHeaderBytesSent: Schema.optional(Schema.Number),
    requestBodyBytesSent: Schema.optional(Schema.Number),
    responseHeaderBytesReceived: Schema.optional(Schema.Number),
    responseBodyBytesReceived: Schema.optional(Schema.Number),
    responseBodyDecodedSize: Schema.optional(Schema.Number),
    securityConnection: Schema.optional(Security.Connection),
    isProxyConnection: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.Metrics" })
) as any as Schema.Codec<Metrics>

/**
 * Network priority.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MetricsPriority =
  | "low"
  | "medium"
  | "high"
  | (string & {})

/**
 * Schema for `MetricsPriority`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MetricsPriority = Schema.String as any as Schema.Codec<MetricsPriority>

/**
 * Different stages of a network request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NetworkStage =
  | "request"
  | "response"
  | (string & {})

/**
 * Schema for `NetworkStage`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NetworkStage = Schema.String as any as Schema.Codec<NetworkStage>

/**
 * Controls how much referrer information is sent with the request
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ReferrerPolicy =
  | "empty-string"
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "same-origin"
  | "origin"
  | "strict-origin"
  | "origin-when-cross-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url"
  | (string & {})

/**
 * Schema for `ReferrerPolicy`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReferrerPolicy = Schema.String as any as Schema.Codec<ReferrerPolicy>

/**
 * HTTP request data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Request {
  /**
   * Request URL.
   */
  readonly url: string
  /**
   * HTTP request method.
   */
  readonly method: string
  /**
   * HTTP request headers.
   */
  readonly headers: Headers
  /**
   * HTTP POST request data.
   */
  readonly postData?: string | undefined
  /**
   * The level of included referrer information.
   */
  readonly referrerPolicy?: ReferrerPolicy | undefined
  /**
   * The base64 cryptographic hash of the resource.
   */
  readonly integrity?: string | undefined
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
    method: Schema.String,
    headers: Headers,
    postData: Schema.optional(Schema.String),
    referrerPolicy: Schema.optional(ReferrerPolicy),
    integrity: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.Request" })
) as any as Schema.Codec<Request>

/**
 * Unique request identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RequestId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Network/RequestId">

/**
 * Schema for `RequestId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Network/RequestId")
) as any as Schema.Codec<RequestId>

/**
 * Different stages of a network request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResourceErrorType =
  | "General"
  | "AccessControl"
  | "Cancellation"
  | "Timeout"
  | (string & {})

/**
 * Schema for `ResourceErrorType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResourceErrorType = Schema.String as any as Schema.Codec<ResourceErrorType>

/**
 * Timing information for the request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResourceTiming {
  /**
   * Request is initiated
   */
  readonly startTime: Timestamp
  /**
   * Started redirect resolution.
   */
  readonly redirectStart: Timestamp
  /**
   * Finished redirect resolution.
   */
  readonly redirectEnd: Timestamp
  /**
   * Resource fetching started.
   */
  readonly fetchStart: Timestamp
  /**
   * Started DNS address resolve in milliseconds relative to fetchStart.
   */
  readonly domainLookupStart: number
  /**
   * Finished DNS address resolve in milliseconds relative to fetchStart.
   */
  readonly domainLookupEnd: number
  /**
   * Started connecting to the remote host in milliseconds relative to fetchStart.
   */
  readonly connectStart: number
  /**
   * Connected to the remote host in milliseconds relative to fetchStart.
   */
  readonly connectEnd: number
  /**
   * Started SSL handshake in milliseconds relative to fetchStart.
   */
  readonly secureConnectionStart: number
  /**
   * Started sending request in milliseconds relative to fetchStart.
   */
  readonly requestStart: number
  /**
   * Started receiving response headers in milliseconds relative to fetchStart.
   */
  readonly responseStart: number
  /**
   * Finished receiving response headers in milliseconds relative to fetchStart.
   */
  readonly responseEnd: number
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
    startTime: Timestamp,
    redirectStart: Timestamp,
    redirectEnd: Timestamp,
    fetchStart: Timestamp,
    domainLookupStart: Schema.Number,
    domainLookupEnd: Schema.Number,
    connectStart: Schema.Number,
    connectEnd: Schema.Number,
    secureConnectionStart: Schema.Number,
    requestStart: Schema.Number,
    responseStart: Schema.Number,
    responseEnd: Schema.Number
  }).annotate({ identifier: "Network.ResourceTiming" })
) as any as Schema.Codec<ResourceTiming>

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
   * Specifies where the response came from.
   */
  readonly source: ResponseSource
  /**
   * Refined HTTP request headers that were actually transmitted over the network.
   */
  readonly requestHeaders?: Headers | undefined
  /**
   * Timing information for the given request.
   */
  readonly timing?: ResourceTiming | undefined
  /**
   * The security information for the given request.
   */
  readonly security?: Security.Security | undefined
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
    source: ResponseSource,
    requestHeaders: Schema.optional(Headers),
    timing: Schema.optional(ResourceTiming),
    security: Schema.optional(Security.Security)
  }).annotate({ identifier: "Network.Response" })
) as any as Schema.Codec<Response>

/**
 * Specifies where the response came from.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResponseSource =
  | "unknown"
  | "network"
  | "memory-cache"
  | "disk-cache"
  | "service-worker"
  | "inspector-override"
  | (string & {})

/**
 * Schema for `ResponseSource`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseSource = Schema.String as any as Schema.Codec<ResponseSource>

/**
 * Elapsed seconds since frontend connected.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Timestamp = number

/**
 * Schema for `Timestamp`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Timestamp = Schema.Number as any as Schema.Codec<Timestamp>

/**
 * Number of seconds since epoch.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Walltime = number

/**
 * Schema for `Walltime`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Walltime = Schema.Number as any as Schema.Codec<Walltime>

/**
 * WebSocket frame data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WebSocketFrame {
  /**
   * WebSocket frame opcode.
   */
  readonly opcode: number
  /**
   * WebSocket frame mask.
   */
  readonly mask: boolean
  /**
   * WebSocket frame payload data, binary frames (opcode = 2) are base64-encoded.
   */
  readonly payloadData: string
  /**
   * WebSocket frame payload length in bytes.
   */
  readonly payloadLength: number
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
    payloadData: Schema.String,
    payloadLength: Schema.Number
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
   * HTTP response headers.
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
    headers: Headers
  }).annotate({ identifier: "Network.WebSocketResponse" })
) as any as Schema.Codec<WebSocketResponse>

/**
 * Add an interception.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddInterceptionParams {
  /**
   * URL pattern to intercept, intercept everything if not specified or empty
   */
  readonly url: string
  /**
   * Stage to intercept.
   */
  readonly stage: NetworkStage
  /**
   * If false, ignores letter casing of `url` parameter.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats `url` parameter as a regular expression.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `AddInterceptionParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddInterceptionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    stage: NetworkStage,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.AddInterceptionParams" })
) as any as Schema.Codec<AddInterceptionParams>

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
  readonly timestamp: Timestamp
  /**
   * Data chunk length.
   */
  readonly dataLength: number
  /**
   * Actual bytes received (might be less than dataLength for compressed encodings).
   */
  readonly encodedDataLength: number
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
    timestamp: Timestamp,
    dataLength: Schema.Int,
    encodedDataLength: Schema.Int
  }).annotate({ identifier: "Network.DataReceivedParams" })
) as any as Schema.Codec<DataReceivedParams>

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
 * Fetches a serialized secure certificate for the given requestId to be displayed via InspectorFrontendHost.showCertificate.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetSerializedCertificateParams {
  readonly requestId: RequestId
}

/**
 * Schema for `GetSerializedCertificateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSerializedCertificateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId
  }).annotate({ identifier: "Network.GetSerializedCertificateParams" })
) as any as Schema.Codec<GetSerializedCertificateParams>

/**
 * Fetches a serialized secure certificate for the given requestId to be displayed via InspectorFrontendHost.showCertificate.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetSerializedCertificateResult {
  /**
   * Represents a base64 encoded WebCore::CertificateInfo object.
   */
  readonly serializedCertificate: string
}

/**
 * Schema for `GetSerializedCertificateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSerializedCertificateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    serializedCertificate: Schema.String
  }).annotate({ identifier: "Network.GetSerializedCertificateResult" })
) as any as Schema.Codec<GetSerializedCertificateResult>

/**
 * Continue request or response without modifications.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InterceptContinueParams {
  /**
   * Identifier for the intercepted Network request or response to continue.
   */
  readonly requestId: RequestId
  /**
   * Stage to continue.
   */
  readonly stage: NetworkStage
}

/**
 * Schema for `InterceptContinueParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InterceptContinueParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    stage: NetworkStage
  }).annotate({ identifier: "Network.InterceptContinueParams" })
) as any as Schema.Codec<InterceptContinueParams>

/**
 * Fail request with given error type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InterceptRequestWithErrorParams {
  /**
   * Identifier for the intercepted Network request to fail.
   */
  readonly requestId: RequestId
  /**
   * Deliver error reason for the request failure.
   */
  readonly errorType: ResourceErrorType
}

/**
 * Schema for `InterceptRequestWithErrorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InterceptRequestWithErrorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    errorType: ResourceErrorType
  }).annotate({ identifier: "Network.InterceptRequestWithErrorParams" })
) as any as Schema.Codec<InterceptRequestWithErrorParams>

/**
 * Provide response for an intercepted request. Request completely bypasses the network in this case and is immediately fulfilled with the provided data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InterceptRequestWithResponseParams {
  /**
   * Identifier for the intercepted Network response to modify.
   */
  readonly requestId: RequestId
  readonly content: string
  /**
   * True, if content was sent as base64.
   */
  readonly base64Encoded: boolean
  /**
   * MIME Type for the data.
   */
  readonly mimeType: string
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
}

/**
 * Schema for `InterceptRequestWithResponseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InterceptRequestWithResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    content: Schema.String,
    base64Encoded: Schema.Boolean,
    mimeType: Schema.String,
    status: Schema.Int,
    statusText: Schema.String,
    headers: Headers
  }).annotate({ identifier: "Network.InterceptRequestWithResponseParams" })
) as any as Schema.Codec<InterceptRequestWithResponseParams>

/**
 * Replace intercepted request with the provided one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InterceptWithRequestParams {
  /**
   * Identifier for the intercepted Network request or response to continue.
   */
  readonly requestId: RequestId
  /**
   * HTTP request url.
   */
  readonly url?: string | undefined
  /**
   * HTTP request method.
   */
  readonly method?: string | undefined
  /**
   * HTTP response headers. Pass through original values if unmodified.
   */
  readonly headers?: Headers | undefined
  /**
   * HTTP POST request data, base64-encoded.
   */
  readonly postData?: string | undefined
}

/**
 * Schema for `InterceptWithRequestParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InterceptWithRequestParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    url: Schema.optional(Schema.String),
    method: Schema.optional(Schema.String),
    headers: Schema.optional(Headers),
    postData: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.InterceptWithRequestParams" })
) as any as Schema.Codec<InterceptWithRequestParams>

/**
 * Provide response content for an intercepted response.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InterceptWithResponseParams {
  /**
   * Identifier for the intercepted Network response to modify.
   */
  readonly requestId: RequestId
  readonly content: string
  /**
   * True, if content was sent as base64.
   */
  readonly base64Encoded: boolean
  /**
   * MIME Type for the data.
   */
  readonly mimeType?: string | undefined
  /**
   * HTTP response status code. Pass through original values if unmodified.
   */
  readonly status?: number | undefined
  /**
   * HTTP response status text. Pass through original values if unmodified.
   */
  readonly statusText?: string | undefined
  /**
   * HTTP response headers. Pass through original values if unmodified.
   */
  readonly headers?: Headers | undefined
}

/**
 * Schema for `InterceptWithResponseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InterceptWithResponseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    content: Schema.String,
    base64Encoded: Schema.Boolean,
    mimeType: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Int),
    statusText: Schema.optional(Schema.String),
    headers: Schema.optional(Headers)
  }).annotate({ identifier: "Network.InterceptWithResponseParams" })
) as any as Schema.Codec<InterceptWithResponseParams>

/**
 * Loads a resource in the context of a frame on the inspected page without cross origin checks.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadResourceParams {
  /**
   * Frame to load the resource from.
   */
  readonly frameId: FrameId
  /**
   * URL of the resource to load.
   */
  readonly url: string
}

/**
 * Schema for `LoadResourceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadResourceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: FrameId,
    url: Schema.String
  }).annotate({ identifier: "Network.LoadResourceParams" })
) as any as Schema.Codec<LoadResourceParams>

/**
 * Loads a resource in the context of a frame on the inspected page without cross origin checks.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadResourceResult {
  /**
   * Resource content.
   */
  readonly content: string
  /**
   * Resource mimeType.
   */
  readonly mimeType: string
  /**
   * HTTP response status code.
   */
  readonly status: number
}

/**
 * Schema for `LoadResourceResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadResourceResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    content: Schema.String,
    mimeType: Schema.String,
    status: Schema.Int
  }).annotate({ identifier: "Network.LoadResourceResult" })
) as any as Schema.Codec<LoadResourceResult>

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
  readonly timestamp: Timestamp
  /**
   * User friendly error message.
   */
  readonly errorText: string
  /**
   * True if loading was canceled.
   */
  readonly canceled?: boolean | undefined
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
    timestamp: Timestamp,
    errorText: Schema.String,
    canceled: Schema.optional(Schema.Boolean)
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
  readonly timestamp: Timestamp
  /**
   * URL of source map associated with this resource (if any).
   */
  readonly sourceMapURL?: string | undefined
  /**
   * Network metrics.
   */
  readonly metrics?: Metrics | undefined
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
    timestamp: Timestamp,
    sourceMapURL: Schema.optional(Schema.String),
    metrics: Schema.optional(Metrics)
  }).annotate({ identifier: "Network.LoadingFinishedParams" })
) as any as Schema.Codec<LoadingFinishedParams>

/**
 * Remove an interception.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveInterceptionParams {
  readonly url: string
  /**
   * Stage to intercept.
   */
  readonly stage: NetworkStage
  /**
   * If false, ignores letter casing of `url` parameter.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats `url` parameter as a regular expression.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `RemoveInterceptionParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveInterceptionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    stage: NetworkStage,
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Network.RemoveInterceptionParams" })
) as any as Schema.Codec<RemoveInterceptionParams>

/**
 * Fired when HTTP request has been intercepted. The frontend must respond with <code>Network.interceptContinue</code>, <code>Network.interceptWithRequest</code>` or <code>Network.interceptWithResponse</code>` to resolve this request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestInterceptedParams {
  /**
   * Identifier for this intercepted network. Corresponds with an earlier <code>Network.requestWillBeSent</code>.
   */
  readonly requestId: RequestId
  /**
   * Original request content that would proceed if this is continued.
   */
  readonly request: Request
}

/**
 * Schema for `RequestInterceptedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestInterceptedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    request: Request
  }).annotate({ identifier: "Network.RequestInterceptedParams" })
) as any as Schema.Codec<RequestInterceptedParams>

/**
 * Fired when HTTP request has been served from memory cache.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestServedFromMemoryCacheParams {
  /**
   * Request identifier.
   */
  readonly requestId: RequestId
  /**
   * Frame identifier.
   */
  readonly frameId: FrameId
  /**
   * Loader identifier.
   */
  readonly loaderId: LoaderId
  /**
   * URL of the document this request is loaded for.
   */
  readonly documentURL: string
  /**
   * Timestamp.
   */
  readonly timestamp: Timestamp
  /**
   * Request initiator.
   */
  readonly initiator: Initiator
  /**
   * Cached resource data.
   */
  readonly resource: CachedResource
}

/**
 * Schema for `RequestServedFromMemoryCacheParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestServedFromMemoryCacheParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    frameId: FrameId,
    loaderId: LoaderId,
    documentURL: Schema.String,
    timestamp: Timestamp,
    initiator: Initiator,
    resource: CachedResource
  }).annotate({ identifier: "Network.RequestServedFromMemoryCacheParams" })
) as any as Schema.Codec<RequestServedFromMemoryCacheParams>

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
   * Frame identifier.
   */
  readonly frameId: FrameId
  /**
   * Loader identifier.
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
  readonly timestamp: Timestamp
  readonly walltime: Walltime
  /**
   * Request initiator.
   */
  readonly initiator: Initiator
  /**
   * Redirect response data.
   */
  readonly redirectResponse?: Response | undefined
  /**
   * Resource type.
   */
  readonly type?: Page.ResourceType | undefined
  /**
   * Identifier for the context of where the load originated. In general this is the target identifier. For Workers this will be the workerId.
   */
  readonly targetId?: string | undefined
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
    frameId: FrameId,
    loaderId: LoaderId,
    documentURL: Schema.String,
    request: Request,
    timestamp: Timestamp,
    walltime: Walltime,
    initiator: Initiator,
    redirectResponse: Schema.optional(Response),
    type: Schema.optional(Page.ResourceType),
    targetId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.RequestWillBeSentParams" })
) as any as Schema.Codec<RequestWillBeSentParams>

/**
 * Resolves JavaScript WebSocket object for given request id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveWebSocketParams {
  /**
   * Identifier of the WebSocket resource to resolve.
   */
  readonly requestId: RequestId
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
}

/**
 * Schema for `ResolveWebSocketParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveWebSocketParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "Network.ResolveWebSocketParams" })
) as any as Schema.Codec<ResolveWebSocketParams>

/**
 * Resolves JavaScript WebSocket object for given request id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveWebSocketResult {
  /**
   * JavaScript object wrapper for given node.
   */
  readonly object: Runtime.RemoteObject
}

/**
 * Schema for `ResolveWebSocketResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveWebSocketResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: Runtime.RemoteObject
  }).annotate({ identifier: "Network.ResolveWebSocketResult" })
) as any as Schema.Codec<ResolveWebSocketResult>

/**
 * Fired when HTTP response has been intercepted. The frontend must response with <code>Network.interceptContinue</code> or <code>Network.interceptWithResponse</code>` to continue this response.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseInterceptedParams {
  /**
   * Identifier for this intercepted network. Corresponds with an earlier <code>Network.requestWillBeSent</code>.
   */
  readonly requestId: RequestId
  /**
   * Original response content that would proceed if this is continued.
   */
  readonly response: Response
}

/**
 * Schema for `ResponseInterceptedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseInterceptedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: RequestId,
    response: Response
  }).annotate({ identifier: "Network.ResponseInterceptedParams" })
) as any as Schema.Codec<ResponseInterceptedParams>

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
   * Frame identifier.
   */
  readonly frameId: FrameId
  /**
   * Loader identifier.
   */
  readonly loaderId: LoaderId
  /**
   * Timestamp.
   */
  readonly timestamp: Timestamp
  /**
   * Resource type.
   */
  readonly type: Page.ResourceType
  /**
   * Response data.
   */
  readonly response: Response
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
    frameId: FrameId,
    loaderId: LoaderId,
    timestamp: Timestamp,
    type: Page.ResourceType,
    response: Response
  }).annotate({ identifier: "Network.ResponseReceivedParams" })
) as any as Schema.Codec<ResponseReceivedParams>

/**
 * Toggles whether resource data is cleared on page navigations / reloads.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetClearResourceDataOnNavigateParams {
  /**
   * Whether to clear resource data on navigations.
   */
  readonly clearResourceDataOnNavigate: boolean
}

/**
 * Schema for `SetClearResourceDataOnNavigateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetClearResourceDataOnNavigateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    clearResourceDataOnNavigate: Schema.Boolean
  }).annotate({ identifier: "Network.SetClearResourceDataOnNavigateParams" })
) as any as Schema.Codec<SetClearResourceDataOnNavigateParams>

/**
 * Emulate offline state overriding the actual state.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEmulateOfflineStateParams {
  /**
   * True to emulate offline.
   */
  readonly offline: boolean
}

/**
 * Schema for `SetEmulateOfflineStateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulateOfflineStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    offline: Schema.Boolean
  }).annotate({ identifier: "Network.SetEmulateOfflineStateParams" })
) as any as Schema.Codec<SetEmulateOfflineStateParams>

/**
 * Emulate various network conditions (e.g. bytes per second, latency, etc.). Only in builds compiled with `defined(ENABLE_INSPECTOR_NETWORK_THROTTLING) && ENABLE_INSPECTOR_NETWORK_THROTTLING`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEmulatedConditionsParams {
  /**
   * Limits the bytes per second of requests if positive. Removes any limits if zero or not provided.
   */
  readonly bytesPerSecondLimit?: number | undefined
}

/**
 * Schema for `SetEmulatedConditionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulatedConditionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    bytesPerSecondLimit: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Network.SetEmulatedConditionsParams" })
) as any as Schema.Codec<SetEmulatedConditionsParams>

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
 * Enable interception of network requests.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetInterceptionEnabledParams {
  readonly enabled: boolean
}

/**
 * Schema for `SetInterceptionEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetInterceptionEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Network.SetInterceptionEnabledParams" })
) as any as Schema.Codec<SetInterceptionEnabledParams>

/**
 * Toggles whether the resource cache may be used when loading resources in the inspected page. If <code>true</code>, the resource cache will not be used when loading resources.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetResourceCachingDisabledParams {
  /**
   * Whether to prevent usage of the resource cache.
   */
  readonly disabled: boolean
}

/**
 * Schema for `SetResourceCachingDisabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetResourceCachingDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    disabled: Schema.Boolean
  }).annotate({ identifier: "Network.SetResourceCachingDisabledParams" })
) as any as Schema.Codec<SetResourceCachingDisabledParams>

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
  readonly timestamp: Timestamp
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
    timestamp: Timestamp
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
    url: Schema.String
  }).annotate({ identifier: "Network.WebSocketCreatedParams" })
) as any as Schema.Codec<WebSocketCreatedParams>

/**
 * Fired when WebSocket frame error occurs.
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
  readonly timestamp: Timestamp
  /**
   * WebSocket frame error message.
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
    timestamp: Timestamp,
    errorMessage: Schema.String
  }).annotate({ identifier: "Network.WebSocketFrameErrorParams" })
) as any as Schema.Codec<WebSocketFrameErrorParams>

/**
 * Fired when WebSocket frame is received.
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
  readonly timestamp: Timestamp
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
    timestamp: Timestamp,
    response: WebSocketFrame
  }).annotate({ identifier: "Network.WebSocketFrameReceivedParams" })
) as any as Schema.Codec<WebSocketFrameReceivedParams>

/**
 * Fired when WebSocket frame is sent.
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
  readonly timestamp: Timestamp
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
    timestamp: Timestamp,
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
  readonly timestamp: Timestamp
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
    timestamp: Timestamp,
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
  readonly timestamp: Timestamp
  readonly walltime: Walltime
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
    timestamp: Timestamp,
    walltime: Walltime,
    request: WebSocketRequest
  }).annotate({ identifier: "Network.WebSocketWillSendHandshakeRequestParams" })
) as any as Schema.Codec<WebSocketWillSendHandshakeRequestParams>

/**
 * Add an interception.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addInterception: Protocol.CommandDef<"Network.addInterception", AddInterceptionParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.addInterception",
    AddInterceptionParams,
    undefined,
    { status: "stable" }
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
 * Enables network tracking, network events will now be delivered to the client.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Network.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Network.enable",
  undefined,
  undefined,
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
 * Fetches a serialized secure certificate for the given requestId to be displayed via InspectorFrontendHost.showCertificate.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getSerializedCertificate: Protocol.CommandDef<
  "Network.getSerializedCertificate",
  GetSerializedCertificateParams,
  GetSerializedCertificateResult
> = /*#__PURE__*/ Protocol.command(
  "Network.getSerializedCertificate",
  GetSerializedCertificateParams,
  GetSerializedCertificateResult,
  { status: "stable" }
)

/**
 * Continue request or response without modifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const interceptContinue: Protocol.CommandDef<"Network.interceptContinue", InterceptContinueParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.interceptContinue",
    InterceptContinueParams,
    undefined,
    { status: "stable" }
  )

/**
 * Fail request with given error type.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const interceptRequestWithError: Protocol.CommandDef<
  "Network.interceptRequestWithError",
  InterceptRequestWithErrorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.interceptRequestWithError",
  InterceptRequestWithErrorParams,
  undefined,
  { status: "stable" }
)

/**
 * Provide response for an intercepted request. Request completely bypasses the network in this case and is immediately fulfilled with the provided data.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const interceptRequestWithResponse: Protocol.CommandDef<
  "Network.interceptRequestWithResponse",
  InterceptRequestWithResponseParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.interceptRequestWithResponse",
  InterceptRequestWithResponseParams,
  undefined,
  { status: "stable" }
)

/**
 * Replace intercepted request with the provided one.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const interceptWithRequest: Protocol.CommandDef<
  "Network.interceptWithRequest",
  InterceptWithRequestParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.interceptWithRequest",
  InterceptWithRequestParams,
  undefined,
  { status: "stable" }
)

/**
 * Provide response content for an intercepted response.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const interceptWithResponse: Protocol.CommandDef<
  "Network.interceptWithResponse",
  InterceptWithResponseParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.interceptWithResponse",
  InterceptWithResponseParams,
  undefined,
  { status: "stable" }
)

/**
 * Loads a resource in the context of a frame on the inspected page without cross origin checks.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const loadResource: Protocol.CommandDef<"Network.loadResource", LoadResourceParams, LoadResourceResult> =
  /*#__PURE__*/ Protocol.command(
    "Network.loadResource",
    LoadResourceParams,
    LoadResourceResult,
    { status: "stable" }
  )

/**
 * Remove an interception.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeInterception: Protocol.CommandDef<"Network.removeInterception", RemoveInterceptionParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Network.removeInterception",
    RemoveInterceptionParams,
    undefined,
    { status: "stable" }
  )

/**
 * Resolves JavaScript WebSocket object for given request id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveWebSocket: Protocol.CommandDef<
  "Network.resolveWebSocket",
  ResolveWebSocketParams,
  ResolveWebSocketResult
> = /*#__PURE__*/ Protocol.command(
  "Network.resolveWebSocket",
  ResolveWebSocketParams,
  ResolveWebSocketResult,
  { status: "stable" }
)

/**
 * Toggles whether resource data is cleared on page navigations / reloads.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setClearResourceDataOnNavigate: Protocol.CommandDef<
  "Network.setClearResourceDataOnNavigate",
  SetClearResourceDataOnNavigateParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setClearResourceDataOnNavigate",
  SetClearResourceDataOnNavigateParams,
  undefined,
  { status: "stable" }
)

/**
 * Emulate offline state overriding the actual state.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEmulateOfflineState: Protocol.CommandDef<
  "Network.setEmulateOfflineState",
  SetEmulateOfflineStateParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setEmulateOfflineState",
  SetEmulateOfflineStateParams,
  undefined,
  { status: "stable" }
)

/**
 * Emulate various network conditions (e.g. bytes per second, latency, etc.). Only in builds compiled with `defined(ENABLE_INSPECTOR_NETWORK_THROTTLING) && ENABLE_INSPECTOR_NETWORK_THROTTLING`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEmulatedConditions: Protocol.CommandDef<
  "Network.setEmulatedConditions",
  SetEmulatedConditionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setEmulatedConditions",
  SetEmulatedConditionsParams,
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
 * Enable interception of network requests.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setInterceptionEnabled: Protocol.CommandDef<
  "Network.setInterceptionEnabled",
  SetInterceptionEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setInterceptionEnabled",
  SetInterceptionEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Toggles whether the resource cache may be used when loading resources in the inspected page. If <code>true</code>, the resource cache will not be used when loading resources.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setResourceCachingDisabled: Protocol.CommandDef<
  "Network.setResourceCachingDisabled",
  SetResourceCachingDisabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Network.setResourceCachingDisabled",
  SetResourceCachingDisabledParams,
  undefined,
  { status: "stable" }
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
 * Fired when HTTP request has been intercepted. The frontend must respond with <code>Network.interceptContinue</code>, <code>Network.interceptWithRequest</code>` or <code>Network.interceptWithResponse</code>` to resolve this request.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const requestIntercepted: Protocol.EventDef<"Network.requestIntercepted", RequestInterceptedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.requestIntercepted",
    RequestInterceptedParams,
    { status: "stable" }
  )

/**
 * Fired when HTTP request has been served from memory cache.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const requestServedFromMemoryCache: Protocol.EventDef<
  "Network.requestServedFromMemoryCache",
  RequestServedFromMemoryCacheParams
> = /*#__PURE__*/ Protocol.event(
  "Network.requestServedFromMemoryCache",
  RequestServedFromMemoryCacheParams,
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
 * Fired when HTTP response has been intercepted. The frontend must response with <code>Network.interceptContinue</code> or <code>Network.interceptWithResponse</code>` to continue this response.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const responseIntercepted: Protocol.EventDef<"Network.responseIntercepted", ResponseInterceptedParams> =
  /*#__PURE__*/ Protocol.event(
    "Network.responseIntercepted",
    ResponseInterceptedParams,
    { status: "stable" }
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
 * Fired when WebSocket frame error occurs.
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
 * Fired when WebSocket frame is received.
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
 * Fired when WebSocket frame is sent.
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
