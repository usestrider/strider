/**
 * The responses a page or context receives, with their bodies when a subscription asks for them.
 *
 * A `NetworkResponse` is the status and headers of one redirect hop, as immutable data with Effect's `Headers`. A
 * body is collected only for a subscription given a `body` decoder, which needs inspect access. It arrives as a
 * `CapturedResponse`, whose bytes outlive the page and which Effect's `HttpIncomingMessage` decoders read.
 *
 * A response is reported to the page and context whose request it answers: when it arrives, or, with a `body`,
 * once the body has loaded, up to `BodyLimit`, and been decoded.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as ByteSize from "effect/ByteSize"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import type * as HttpMethod from "effect/http/HttpMethod"
import * as Predicate from "effect/Predicate"
import * as Redactable from "effect/Redactable"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as NetworkResponseImpl from "./internal/networkResponse.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Redaction from "./internal/redaction.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import * as NetworkRequest from "./NetworkRequest.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for an HTTP status code, from 100 to 599.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StatusCode = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  Schema.brand("~@usestrider/browser/NetworkResponse/StatusCode")
)

/**
 * An HTTP status code; a number, so it goes wherever Effect's HTTP modules expect a status.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StatusCode = typeof StatusCode.Type

/**
 * Schema for what answered a request.
 *
 * **Details**
 *
 * - `network`: the server, over the network.
 * - `cache`: the browser's HTTP cache, in memory or on disk.
 * - `serviceWorker`: a service worker's `respondWith`, whether the worker made the response or fetched it.
 * - `cacheOrServiceWorker`: not the network, and the browser doesn't say which. Firefox reports both the same
 *   way, as its `network.servedBy` entry in `browser.capabilities` says.
 * - `route`: a route that fulfilled the request.
 * - `unknown`: the browser says it doesn't know, as WebKit can.
 *
 * **Gotchas**
 *
 * A script or stylesheet reused from the memory cache within the same document produces no request at all on
 * Chromium and WebKit, so it has no response to describe; Firefox reports it as `cacheOrServiceWorker`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ServedBy = Schema.Literals([
  "network",
  "cache",
  "serviceWorker",
  "cacheOrServiceWorker",
  "route",
  "unknown"
])

/**
 * What answered a request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ServedBy = typeof ServedBy.Type

/**
 * The status and headers of one redirect hop's response.
 *
 * **Details**
 *
 * - `servedBy` says what answered: the network, a cache, a service worker or a route.
 * - `statusText` is the status line's reason phrase as the browser reports it, empty for HTTP/2 and later.
 * - `httpVersion` is the protocol as the browser names it, such as `http/1.1` or `h2`. It's `None` where the
 *   browser doesn't report it with the response, as WebKit doesn't: it reports it only when the response ends.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class NetworkResponse extends Schema.Class<NetworkResponse>("@usestrider/browser/NetworkResponse")({
  hop: NetworkRequest.HopId,
  url: Url.Url,
  status: StatusCode,
  statusText: Schema.String,
  httpVersion: Schema.Option(Schema.String),
  headers: Schema.Headers,
  servedBy: ServedBy,
  at: MonotonicInstant.MonotonicInstant
}) {
  [Redactable.symbolRedactable](context: Context.Context<never>): unknown {
    return Redaction.withUrl("NetworkResponse", this, context)
  }
}

/**
 * A response whose body was collected and decoded.
 *
 * **Details**
 *
 * `body` is what the subscription's decoder produced. It's also an `HttpIncomingMessage`, so Effect's decoders
 * can read its bytes again.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CapturedResponse<B> extends NetworkResponse, HttpIncomingMessage.HttpIncomingMessage<ResponseError> {
  readonly body: B
}

/**
 * A function that reads a collected body, such as Effect's `HttpIncomingMessage.schemaBodyJson(schema)` or one
 * reading `.text` or `.arrayBuffer`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BodyDecoder<B, DE, DR> = (
  message: HttpIncomingMessage.HttpIncomingMessage<ResponseError>
) => Effect.Effect<B, DE, DR>

/**
 * Which responses to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match responses from URLs matching this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
  /**
   * Match responses to requests with this method.
   *
   * @default any method
   */
  readonly method?: HttpMethod.HttpMethod | undefined
  /**
   * Match responses with this status, or whose status satisfies the predicate.
   *
   * @default any status
   */
  readonly status?: StatusCode | number | ((status: StatusCode) => boolean) | undefined
}

/**
 * Reference to the largest response body a subscription collects; 10 MiB unless set.
 *
 * **Details**
 *
 * It's read when a subscription with a `body` starts, and declared to the browser with it; `Har.record` and
 * `Trace.record` with `network` read it too. A larger body fails with `BodyUnavailable`, `why: "overLimit"`.
 * Effect's `HttpIncomingMessage.MaxBodySize` bounds what this program reads, and is a separate setting.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const BodyLimit: Context.Reference<ByteSize.ByteSize> = Context.Reference<ByteSize.ByteSize>(
  "@usestrider/browser/NetworkResponse/BodyLimit",
  { defaultValue: () => ByteSize.mebibytes(10) }
)

/**
 * Sets the largest response body that the subscriptions started inside an effect collect.
 *
 * **Example** (Collecting a large export)
 *
 * ```ts import.meta.vitest
 * import { NetworkResponse, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const exportReport = Effect.fn("exportReport")(function*(page: Page.Page) {
 *   const exported = yield* NetworkResponse.next(page, {
 *     url: "https://app.example.com/api/report",
 *     body: (message) => message.arrayBuffer
 *   }).pipe(NetworkResponse.withBodyLimit("50 MiB"))
 *   yield* page.getByRole("button", { name: "Export" }).click()
 *   const response = yield* exported
 *   return response.body.byteLength
 * })
 * ```
 *
 * @see {@link BodyLimit} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withBodyLimit: {
  (limit: ByteSize.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, limit: ByteSize.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, limit: ByteSize.Input): Effect.Effect<A, E, R> =>
    Effect.provideService(self, BodyLimit, ByteSize.fromInputUnsafe(limit))
)

/**
 * Subscribes to responses and returns the wait: an effect whose value is the first match, the same each time it
 * runs.
 *
 * **Details**
 *
 * `url` is required. Without `body`, only the status and headers are delivered. With it, body collection is set
 * up before this returns, which needs inspect access (a `ReadonlyPage` or a `UserContext`), and a response
 * matches once its body has loaded and been decoded, within the deadline in force when `next` is called.
 *
 * On Firefox, a terminal 3xx response without a `Location` header fails body collection immediately with
 * `Unsupported`, capability `"network.responseBody.terminalRedirect"`: Firefox does not answer the native body
 * command for it. Chromium and WebKit can collect this body.
 *
 * On WebKit, response-body collection makes navigation and reload wait for the responded, committed main
 * document to finish loading and for document body reads already started on the page to settle. Unresponded or
 * uncommitted loads and unfinished iframe loads do not delay dispatch. This interruptible wait uses the existing
 * navigation deadline with no grace. An indefinitely streaming main document can consume that deadline and
 * cause `Deadline.Timeout`; close the scopes owning all response-body collection before navigating if preserving
 * the body is unnecessary. Navigation started by page scripts or input is outside this coordination.
 *
 * **Example** (Waiting for the cart's response)
 *
 * ```ts import.meta.vitest
 * import { NetworkResponse, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 * import { HttpIncomingMessage } from "effect/http"
 *
 * const Cart = Schema.Struct({
 *   items: Schema.Array(Schema.Struct({ id: Schema.String }))
 * })
 *
 * const addToCart = Effect.fn("addToCart")(function*(page: Page.Page) {
 *   const added = yield* NetworkResponse.next(
 *     page,
 *     {
 *       url: "https://shop.example.com/api/cart",
 *       method: "POST",
 *       body: HttpIncomingMessage.schemaBodyJson(Cart)
 *     },
 *     (response) => Effect.succeed(response.body.items.length > 0)
 *   )
 *   yield* page.getByRole("button", { name: "Add to cart" }).click()
 *   const response = yield* added
 *   return response.body.items
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next: {
  <B, DE, DR, PE = never, PR = never>(
    target: Page.ReadonlyPage | UserContext.UserContext,
    filter: Filter & {
      readonly url: Url.Pattern | string
      readonly body: BodyDecoder<B, DE, DR>
    },
    where?: Subscription.Where<CapturedResponse<B>, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<
      CapturedResponse<B>,
      DE | PE | ResponseError | Target.TargetGone | Deadline.Timeout
    >,
    Subscription.SubscriptionError | Deadline.Timeout,
    Scope.Scope | DR | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter: Filter & { readonly url: Url.Pattern | string },
    where?: Subscription.Where<NetworkResponse, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<NetworkResponse, PE | ResponseError | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
} = NetworkResponseImpl.next as typeof next

/**
 * Subscribes to responses and emits every match from now on, with bodies when `body` is given.
 *
 * **Details**
 *
 * Each body has `Deadline.DefaultBudget`, as read when `stream` is called, to finish loading. One that doesn't,
 * such as an event stream's, fails the stream with `BodyUnavailable`, `why: "streaming"`.
 * Firefox terminal 3xx responses without a `Location` header fail body collection immediately with
 * `Unsupported`, capability `"network.responseBody.terminalRedirect"`, because Firefox does not answer the
 * native body command for them.
 *
 * **Example** (Logging server errors)
 *
 * ```ts import.meta.vitest
 * import { NetworkResponse, Page } from "@usestrider/browser"
 * import { Console, Effect, Stream } from "effect"
 *
 * const logServerErrors = Effect.fn("logServerErrors")(
 *   function*(page: Page.ObservedPage) {
 *     const failures = yield* NetworkResponse.stream(page, {
 *       status: (status) => status >= 500
 *     })
 *     yield* failures.pipe(
 *       Stream.runForEach((response) => Console.log(response.status, response.url)),
 *       Effect.forkScoped
 *     )
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream: {
  <B, DE, DR, PE = never, PR = never>(
    target: Page.ReadonlyPage | UserContext.UserContext,
    filter: Filter & { readonly body: BodyDecoder<B, DE, DR> },
    where?: Subscription.Where<CapturedResponse<B>, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<CapturedResponse<B>, DE | PE | ResponseError | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError | Deadline.Timeout,
    Scope.Scope | DR | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<NetworkResponse, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<NetworkResponse, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
} = NetworkResponseImpl.stream as typeof stream

/**
 * Reads the responses the target's event log kept (`UserContext.Options.eventLog`), without their bodies; never
 * waits.
 *
 * **Example** (Listing the failed responses so far)
 *
 * ```ts import.meta.vitest
 * import { NetworkResponse, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const failedResponses = Effect.fn("failedResponses")(
 *   function*(page: Page.ObservedPage) {
 *     const history = yield* NetworkResponse.history(page, {
 *       status: (status) => status >= 400
 *     })
 *     return history.entries.map((response) => `${response.status} ${response.url}`)
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<NetworkResponse>, Subscription.SubscriptionError> =>
  NetworkResponseImpl.history(target, filter)

/**
 * Reason for a body that wasn't available to read.
 *
 * **Details**
 *
 * - `notCollected`: no subscription asked for it.
 * - `evicted`: the browser discarded it, or too many requests were in flight for Strider to keep it, before it
 *   was read.
 * - `redirect`: redirect hops have no body.
 * - `streaming`: the response is a stream, such as server-sent events.
 * - `overLimit`: it exceeded the collection limit, `BodyLimit`.
 * - `failed`: the request failed after its response started.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BodyUnavailable
  extends Schema.Error<BodyUnavailable>("@usestrider/browser/NetworkResponse/BodyUnavailable")({
    _tag: Schema.tag("BodyUnavailable"),
    why: Schema.Literals(["notCollected", "evicted", "redirect", "streaming", "overLimit", "failed"]),
    hint: Schema.String
  })
{
  override get message(): string {
    return `Body unavailable: ${this.why} (${this.hint})`
  }
}

/**
 * Reason for a body that isn't what it was read as, such as `json` of a body that isn't JSON: the response is at
 * fault, not the browser.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class MalformedBody extends Schema.Error<MalformedBody>("@usestrider/browser/NetworkResponse/MalformedBody")({
  _tag: Schema.tag("MalformedBody"),
  expected: Schema.Literal("json"),
  hint: Schema.String
}) {
  override get message(): string {
    return `The body isn't ${this.expected}: ${this.hint}`
  }
}

/**
 * Schema for the reasons reading a response can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseErrorReason = Schema.Union([
  BodyUnavailable,
  MalformedBody,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons reading a response can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResponseErrorReason = typeof ResponseErrorReason.Type

const ResponseErrorTypeId = "~@usestrider/browser/NetworkResponse/ResponseError"

/**
 * Error for a response body that couldn't be read.
 *
 * **Example** (Going on without a body that wasn't available)
 *
 * ```ts import.meta.vitest
 * import { NetworkResponse, Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const exportText = Effect.fn("exportText")(function*(page: Page.Page) {
 *   const exported = yield* NetworkResponse.next(page, {
 *     url: "https://app.example.com/api/export",
 *     body: (message) => message.text
 *   })
 *   yield* page.getByRole("button", { name: "Export" }).click()
 *   return yield* exported.pipe(
 *     Effect.map((response) => Option.some(response.body)),
 *     Effect.catchReason("ResponseError", "BodyUnavailable", () => Effect.succeedNone)
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ResponseError extends Schema.TaggedError<ResponseError>(ResponseErrorTypeId)("ResponseError", {
  url: Url.Url,
  reason: ResponseErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [ResponseErrorTypeId] = ResponseErrorTypeId
  override get message(): string {
    return this.reason.message
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `ResponseError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isResponseError = (u: unknown): u is ResponseError => Predicate.hasProperty(u, ResponseErrorTypeId)
