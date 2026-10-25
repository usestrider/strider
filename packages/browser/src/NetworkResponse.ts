/**
 * Responses a page or context receives: the event, and, when asked for, their bodies.
 *
 * A `NetworkResponse` is metadata for one redirect hop: data, immutable, with Effect's `Headers`. A body is
 * collected only when a subscription asks for it with a decoder, because collecting bodies costs memory and
 * needs inspect access. A collected body becomes a `CapturedResponse`: owned bytes that outlive the page, read
 * with Effect's own `HttpIncomingMessage` decoders.
 *
 * A response is reported when it arrives, to the page and context whose request it answers. With a `body`, it
 * is delivered once its body has loaded, up to `BodyLimit`, and been decoded.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as ByteSize from "effect/ByteSize"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import type * as Headers from "effect/http/Headers"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import type * as HttpMethod from "effect/http/HttpMethod"
import * as UrlParams from "effect/http/UrlParams"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as Adapter from "./internal/adapter.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
import type * as Runtime from "./internal/runtime.ts"
import * as Spans from "./internal/spans.ts"
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
 *   way, which its `network.servedBy` capability says.
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
 * The metadata of one redirect hop's response.
 *
 * **Details**
 *
 * `servedBy` says what answered: the network, a cache, a service worker or a route. A request that fails has
 * no response, so nothing to say.
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
  servedBy: ServedBy,
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
 * Reference to the largest response body a subscription collects; 10 MiB unless set.
 *
 * **Details**
 *
 * It is read when a subscription with a `body` starts, and declared to the browser with it. A larger body
 * fails with `BodyUnavailable{overLimit}`. Effect's `HttpIncomingMessage.MaxBodySize` bounds what this program
 * reads, and is a separate setting.
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
 * Sets the largest response body every subscription inside an effect collects.
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

// ── Implementation ──

const kind = (operation: string): Events.Kind<Model.ResponseEvent, NetworkResponse> => ({
  operation,
  noun: "a response",
  deliver: (event) => event.response
})

type AnyFilter = Filter & { readonly body?: BodyDecoder<unknown, unknown, unknown> | undefined }

const subscription = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: AnyFilter | undefined,
  operation: string
) =>
  Effect.suspend(() => {
    const found = Handles.target(target)
    const method = Filters.among<string>(filter?.method)
    const status = filter?.status
    const statusMatches = (code: StatusCode) =>
      status === undefined ? true : typeof status === "function" ? status(code) : code === status
    return Effect.map(Filters.url(operation, filter?.url), (matches) => ({
      found,
      kind: kind(operation),
      channel: found.behind.entry.events.response,
      accepts: (entry: Events.Entry<Model.ResponseEvent>) =>
        Filters.urlMatches(matches, entry.value.response.url) && method(entry.value.hop.request.method) &&
        statusMatches(entry.value.response.status)
    }))
  })

const responseError = (url: Url.Url, reason: ResponseErrorReason) =>
  new ResponseError({ url, reason, diagnostics: Operation.diagnostics(Operation.operationId()) })

const unavailable = (url: Url.Url, why: BodyUnavailable["why"], hint: string) =>
  responseError(url, new BodyUnavailable({ why, hint }))

const charset = (headers: Headers.Headers) => {
  const match = /charset=([^;]+)/i.exec(headers["content-type"] ?? "")
  try {
    return new TextDecoder(match?.[1]?.trim() ?? "utf-8")
  } catch {
    return new TextDecoder("utf-8")
  }
}

const IncomingTypeId = "~effect/http/HttpIncomingMessage"

/** A response with its owned body: also an `HttpIncomingMessage`, so Effect's decoders read it. */
const captured = <B>(response: NetworkResponse, bytes: Uint8Array, body: B): CapturedResponse<B> => {
  const text = Effect.sync(() => charset(response.headers).decode(bytes))
  const message: HttpIncomingMessage.HttpIncomingMessage<ResponseError> = {
    [IncomingTypeId]: IncomingTypeId,
    headers: response.headers,
    remoteAddress: Option.none(),
    text,
    json: Effect.flatMap(text, (text) =>
      Effect.try({
        try: () => JSON.parse(text),
        catch: (error) =>
          responseError(
            response.url,
            new Reason.BackendFailure({
              kind: "IncompatibleResponse",
              method: "json",
              metadata: {},
              hint: `The body isn't JSON: ${String(error)}`
            })
          )
      })),
    urlParamsBody: Effect.map(text, (text) => UrlParams.fromInput(new URLSearchParams(text))),
    arrayBuffer: Effect.sync(() => bytes.slice().buffer),
    stream: Stream.succeed(bytes),
    toString() {
      return `CapturedResponse(${response.url})`
    },
    toJSON() {
      return HttpIncomingMessage.inspect(this, { _id: "CapturedResponse", url: response.url, status: response.status })
    },
    [Inspectable.NodeInspectSymbol]() {
      return this.toJSON()
    }
  } as HttpIncomingMessage.HttpIncomingMessage<ResponseError>
  return Object.assign(Object.create(Object.getPrototypeOf(response)), response, message, { body })
}

/**
 * Delivers a response with its body: once its hop ends, the bytes, then the decoder, with the requirements
 * captured when it subscribed. `wait` bounds the wait for the hop's end, when it is given.
 */
const delivery = <B, DE, DR>(
  runtime: Runtime.Runtime,
  decoder: BodyDecoder<B, DE, DR>,
  context: Context.Context<DR>,
  limit: number,
  wait: Option.Option<Duration.Duration>
): Events.Delivery<Model.ResponseEvent, CapturedResponse<B>, DE | ResponseError> => ({
  deliver: Effect.fnUntraced(function*({ hop, response }) {
    const url = response.url
    if (response.status >= 300 && response.status < 400 && response.headers["location"] !== undefined) {
      return yield* Effect.fail(unavailable(url, "redirect", "A redirect hop has no body; its next hop has one"))
    }
    const ended = yield* Option.match(wait, {
      onNone: () => Effect.map(Deferred.await(hop.end), Option.some),
      onSome: (duration) => Effect.timeoutOption(Deferred.await(hop.end), duration)
    })
    if (Option.isNone(ended)) {
      return yield* Effect.fail(unavailable(
        url,
        "streaming",
        `The response didn't finish loading within ${Duration.format(Option.getOrThrow(wait))}, as a stream doesn't`
      ))
    }
    const end = ended.value
    if (end._tag === "Failed") {
      return yield* Effect.fail(
        unavailable(url, "failed", `The request failed after its response started: ${end.error}`)
      )
    }
    if (end._tag === "Forgotten") {
      return yield* Effect.fail(unavailable(url, "evicted", "Too many requests were in flight to keep this one"))
    }
    if (end.encodedBytes > limit) {
      return yield* Effect.fail(
        unavailable(url, "overLimit", `The body is ${end.encodedBytes} bytes, over BodyLimit's ${limit}`)
      )
    }
    const bytes = yield* runtime.model.adapter.responseBody(response.hop).pipe(
      Effect.mapError((error) => unavailable(url, "evicted", `The browser no longer has it: ${error.message}`))
    )
    const message = captured(response, bytes, undefined)
    const body = yield* Effect.provideContext(decoder(message), context)
    return captured(response, bytes, body)
  }),
  unfinished: ({ response }) => `A response from ${response.url} matched, but its body hadn't finished loading`
})

/** Declares body collection for the target in the caller's scope, before the subscription returns. */
const collect = (
  found: ReturnType<typeof Handles.target>,
  operation: string,
  limit: number
): Effect.Effect<void, Subscription.SubscriptionError, Scope.Scope> => {
  const { runtime, entry } = found.behind
  const scope: Adapter.DeclarationScope = found._tag === "Page"
    ? { _tag: "Page", page: (entry as Model.PageEntry).id }
    : { _tag: "UserContext", context: (entry as Model.ContextEntry).id }
  return runtime.model.adapter.declare(scope, { _tag: "BodyCollection", maxBytes: limit }).pipe(
    Effect.asVoid,
    Effect.mapError((error) => {
      const mapped = Operation.fromAdapter(error, Operation.operationId(), runtime.backend)
      return new Subscription.SubscriptionError({
        operation,
        reason: mapped._tag === "Gone"
          ? new Reason.BackendFailure({
            kind: "Rejected",
            method: "BodyCollection",
            metadata: {},
            hint: mapped.error.message
          })
          : mapped.reason,
        diagnostics: Operation.diagnostics(Operation.operationId())
      })
    })
  )
}

/**
 * Subscribes to responses and returns the first match, latched.
 *
 * **Details**
 *
 * With `body`, collection is set up before this returns, which needs inspect access: a `ReadonlyPage` or a
 * `UserContext`. Without it, only metadata is delivered. `url` is required either way. A response with a body
 * matches once the body has loaded and been decoded, within the deadline in force here.
 *
 * **Example** (A response body, decoded and filtered)
 *
 * ```ts import.meta.vitest
 * import { Effect, Schema } from "effect"
 * import { HttpIncomingMessage } from "effect/http"
 * import { NetworkResponse, Page } from "@usestrider/browser"
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
    Subscription.SubscriptionError,
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
} = ((
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: AnyFilter,
  where?: Subscription.Where<any, unknown, unknown>
) =>
  Effect.flatMap(subscription(target, filter, "NetworkResponse.next"), ({ accepts, channel, found, kind }) => {
    const decoder = filter.body
    if (decoder === undefined) return Events.next(kind, channel, accepts, where)
    return Effect.gen(function*() {
      const limit = ByteSize.toNumberUnsafe(yield* BodyLimit)
      yield* collect(found, "NetworkResponse.next", limit)
      const context = yield* Effect.context<unknown>()
      return yield* Events.next(
        kind as unknown as Events.Kind<Model.ResponseEvent, CapturedResponse<unknown>>,
        channel,
        accepts,
        where,
        delivery(found.behind.runtime, decoder, context, limit, Option.none())
      )
    })
  }).pipe(Spans.operation("NetworkResponse.next"))) as typeof next

/**
 * Subscribes to responses and emits every match from now on, with bodies when `body` is given.
 *
 * **Details**
 *
 * Each body has `Deadline.DefaultBudget`, as read here, to finish loading; one that doesn't, such as an event
 * stream's, fails the stream with `BodyUnavailable{streaming}`.
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
} = ((
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: AnyFilter,
  where?: Subscription.Where<any, unknown, unknown>
) =>
  Effect.flatMap(subscription(target, filter, "NetworkResponse.stream"), ({ accepts, channel, found, kind }) => {
    const decoder = filter?.body
    if (decoder === undefined) return Events.stream(kind, channel, accepts, where)
    return Effect.gen(function*() {
      const limit = ByteSize.toNumberUnsafe(yield* BodyLimit)
      const budget = yield* Deadline.DefaultBudget
      yield* collect(found, "NetworkResponse.stream", limit)
      const context = yield* Effect.context<unknown>()
      return yield* Events.stream(
        kind as unknown as Events.Kind<Model.ResponseEvent, CapturedResponse<unknown>>,
        channel,
        accepts,
        where,
        delivery(found.behind.runtime, decoder, context, limit, Option.some(budget))
      )
    })
  })) as typeof stream

/**
 * Reads the responses a log retained; metadata only, never bodies, and never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<NetworkResponse>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkResponse.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )

/**
 * Reason for a body that wasn't available to read.
 *
 * **Details**
 *
 * - `notCollected`: no subscription asked for it.
 * - `evicted`: the browser discarded it before it was read.
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
