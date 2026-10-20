/**
 * Responses a page or context receives: the event, and, when asked for, their bodies.
 *
 * A `NetworkResponse` is metadata for one redirect hop: data, immutable, with Effect's `Headers`. A body is
 * collected only when a subscription asks for it with a decoder, because collecting bodies costs memory and
 * needs inspect access. A collected body becomes a `CapturedResponse`: owned bytes that outlive the page, read
 * with Effect's own `HttpIncomingMessage` decoders.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import type * as HttpMethod from "effect/http/HttpMethod"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import * as NetworkRequest from "./NetworkRequest.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
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
 * The metadata of one redirect hop's response.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class NetworkResponse extends Schema.Class<NetworkResponse>("@usestrider/browser/NetworkResponse")({
  hop: NetworkRequest.HopId,
  url: Url.Url,
  status: StatusCode,
  headers: Schema.Headers,
  at: MonotonicInstant.MonotonicInstant
}) {}

/**
 * A response whose body was collected and decoded.
 *
 * **Details**
 *
 * It is also an `HttpIncomingMessage`, so Effect's decoders read the owned bytes again if needed. `body` is
 * what the subscription's decoder produced.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CapturedResponse<B> extends NetworkResponse, HttpIncomingMessage.HttpIncomingMessage<ResponseError> {
  readonly body: B
}

/**
 * Reads a collected body. Effect's own decoders fit as they are: `HttpIncomingMessage.schemaBodyJson(schema)`,
 * or a function reading `.text` or `.arrayBuffer`.
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
 * Subscribes to responses and returns the first match, latched.
 *
 * **Details**
 *
 * With `body`, collection is set up before this returns, which needs inspect access: a `ReadonlyPage` or a
 * `UserContext`. Without it, only metadata is delivered. `url` is required either way.
 *
 * **Example** (A response body, decoded and filtered)
 *
 * ```ts import.meta.vitest
 * import { Effect, Schema } from "effect"
 * import { HttpIncomingMessage } from "effect/http"
 * import { Deferred, NetworkResponse, Page } from "@usestrider/browser"
 *
 * const Cart = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
 *
 * const addToCart = Effect.fn("addToCart")(function*(page: Page.Page) {
 *   const added = yield* NetworkResponse.next(
 *     page,
 *     { url: "https://shop.example.com/api/cart", method: "POST", body: HttpIncomingMessage.schemaBodyJson(Cart) },
 *     (response) => Effect.succeed(response.body.items.length > 0)
 *   )
 *   yield* page.getByRole("button", { name: "Add to cart" }).click()
 *   const response = yield* Deferred.await(added)
 *   return response.body.items
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: {
  <B, DE, DR, PE = never, PR = never>(
    target: Page.ReadonlyPage | UserContext.UserContext,
    filter: Filter & {
      readonly url: Url.Pattern | string
      readonly body: BodyDecoder<B, DE, DR>
    },
    where?: Subscription.Where<CapturedResponse<B>, PE, PR> | undefined
  ): Effect.Effect<
    Deferred.ReadonlyDeferred<CapturedResponse<B>, DE | PE | ResponseError | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | DR | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter: Filter & { readonly url: Url.Pattern | string },
    where?: Subscription.Where<NetworkResponse, PE, PR> | undefined
  ): Effect.Effect<
    Deferred.ReadonlyDeferred<NetworkResponse, PE | ResponseError | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
}

/**
 * Subscribes to responses and emits every match from now on, with bodies when `body` is given.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: {
  <B, DE, DR, PE = never, PR = never>(
    target: Page.ReadonlyPage | UserContext.UserContext,
    filter: Filter & { readonly body: BodyDecoder<B, DE, DR> },
    where?: Subscription.Where<CapturedResponse<B>, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<CapturedResponse<B>, DE | PE | ResponseError | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
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
}

/**
 * Reads the responses a log retained; metadata only, never bodies, and never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<NetworkResponse>>

/**
 * Reason for a body that wasn't available to read.
 *
 * **Details**
 *
 * - `notCollected`: no subscription asked for it.
 * - `evicted`: the browser discarded it before it was read.
 * - `redirect`: redirect hops have no body.
 * - `streaming`: the response is a stream, such as server-sent events.
 * - `overLimit`: it exceeded the collection limit.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BodyUnavailable
  extends Schema.Error<BodyUnavailable>("@usestrider/browser/NetworkResponse/BodyUnavailable")({
    _tag: Schema.tag("BodyUnavailable"),
    why: Schema.Literals(["notCollected", "evicted", "redirect", "streaming", "overLimit"]),
    hint: Schema.String
  })
{
  override get message(): string {
    return `Body unavailable: ${this.why} (${this.hint})`
  }
}

/**
 * Schema for the reasons reading a response can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResponseErrorReason = Schema.Union([BodyUnavailable, Reason.BackendFailure])

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
}

/**
 * Checks whether a value is a `ResponseError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isResponseError = (u: unknown): u is ResponseError => Predicate.hasProperty(u, ResponseErrorTypeId)
