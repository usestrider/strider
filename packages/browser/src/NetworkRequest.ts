/**
 * The requests a page or context sends, as events and as the data routes and responses refer to.
 *
 * A `NetworkRequest` is one redirect hop, as immutable data with Effect's `Headers`. It's a Schema, so it can be
 * encoded for export. Header values that carry credentials, such as cookies and authorization, are redacted.
 *
 * A request is reported when it's sent, to the page and context that made it: a frame's requests reach its page,
 * and a worker's reach its page or context. Firefox and WebKit attribute a dedicated worker's requests to its
 * page's document, as `initiator` shows.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as ByteSize from "effect/ByteSize"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import type * as Headers from "effect/http/Headers"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import type * as HttpMethod from "effect/http/HttpMethod"
import * as Option from "effect/Option"
import * as Redactable from "effect/Redactable"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as NetworkRequestImpl from "./internal/networkRequest.ts"
import * as Redaction from "./internal/redaction.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as NetworkResponse from "./NetworkResponse.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for the id of a request, shared by its redirect hops.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/NetworkRequest/Id"))

/**
 * Id of a request, shared by its redirect hops.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

/**
 * Schema for the id of one redirect hop of a request.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HopId = Schema.String.pipe(Schema.brand("~@usestrider/browser/NetworkRequest/HopId"))

/**
 * Id of one redirect hop of a request: the request id and how many redirects preceded it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type HopId = typeof HopId.Type

/**
 * Schema for what kind of resource a request loads.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResourceType = Schema.Literals([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "fetch",
  "xhr",
  "webSocket",
  "eventSource",
  "manifest",
  "ping",
  "other"
])

/**
 * What kind of resource a request loads.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResourceType = typeof ResourceType.Type

/**
 * Schema for what started a request.
 *
 * **Details**
 *
 * - `Document`: a page or frame. `navigation` is set for a navigation request and `None` for a subresource.
 * - `Worker`: a worker's realm.
 * - `Unattributed`: nothing the browser could name, such as a service worker's fetch with no client.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Initiator = Schema.Union([
  Schema.TaggedStruct("Document", {
    navigable: Target.NavigableId,
    // PageNavigation.Id's brand, declared here so the module graph stays acyclic
    navigation: Schema.Option(Schema.String.pipe(Schema.brand("~@usestrider/browser/PageNavigation/Id")))
  }),
  Schema.TaggedStruct("Worker", { realm: Target.RealmId }),
  Schema.TaggedStruct("Unattributed", {})
])

/**
 * What started a request.
 *
 * **Example** (Telling navigations from subresources)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest } from "@usestrider/browser"
 * import { Option } from "effect"
 *
 * const isNavigation = (request: NetworkRequest.NetworkRequest) =>
 *   request.initiator._tag === "Document" && Option.isSome(request.initiator.navigation)
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Initiator = typeof Initiator.Type

/**
 * Schema for the HTTP methods Effect's `HttpMethod` names.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Method = Schema.Literals(
  [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
    "TRACE",
    "QUERY"
  ] as const satisfies ReadonlyArray<HttpMethod.HttpMethod>
)

/**
 * One redirect hop of a request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class NetworkRequest extends Schema.Class<NetworkRequest>("@usestrider/browser/NetworkRequest")({
  hop: HopId,
  method: Method,
  url: Url.Url,
  headers: Schema.Headers,
  resourceType: ResourceType,
  initiator: Initiator,
  at: MonotonicInstant.MonotonicInstant
}) {
  [Redactable.symbolRedactable](context: Context.Context<never>): unknown {
    return Redaction.withUrl("NetworkRequest", this, context)
  }
}

/**
 * Which requests to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match requests to URLs matching this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
  /**
   * Match requests with this method.
   *
   * @default any method
   */
  readonly method?: HttpMethod.HttpMethod | undefined
  /**
   * Match requests for these kinds of resource.
   *
   * @default any kind
   */
  readonly resourceType?: ResourceType | ReadonlyArray<ResourceType> | undefined
}

/**
 * Subscribes to requests and returns the wait: an effect whose value is the first match, the same each time it
 * runs.
 *
 * **Details**
 *
 * `url` is required here, unlike in `stream` and `history`. A `body` decoder declares scoped collection before
 * this returns and needs inspect access. Capture starts when a matching request arrives, without waiting for
 * its response. The decoded result is owned and available as `Option`; `None` means the native protocol indicates no payload.
 * Firefox reports both an empty payload and no payload that way. Stock WebKit refuses empty or missing reports
 * because they cannot establish completeness. Missing or incomplete data fails instead.
 * Collection also ends when borrowed inspect access is released; an expired grant fails with `TargetGone`.
 * Without `body`, this collects no body data.
 *
 * Text uses the declared charset, or UTF-8 by default; unknown charsets fall back to UTF-8 and invalid sequences
 * are replaced. Stock WebKit preserves its protocol-reported text and refuses exact-byte reads; its multipart
 * reports can omit files and are refused. Chromium's multipart fallback can also omit files. A redirected hop
 * whose bytes cannot be addressed independently fails with `BodyUnavailable`, rather than reading another hop.
 *
 * **Example** (Waiting for the order request)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const placeOrder = Effect.fn("placeOrder")(function*(page: Page.Page) {
 *   const sent = yield* NetworkRequest.next(page, {
 *     url: "https://shop.example.com/api/orders",
 *     method: "POST"
 *   })
 *   yield* page.getByRole("button", { name: "Place order" }).click()
 *   const request = yield* sent
 *   return request.headers["content-type"]
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
    filter: Filter & { readonly url: Url.Pattern | string; readonly body: BodyDecoder<B, DE, DR> },
    where?: Subscription.Where<CapturedRequest<B>, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<CapturedRequest<B>, DE | PE | RequestError | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope | DR | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter: Filter & { readonly url: Url.Pattern | string; readonly body?: never },
    where?: Subscription.Where<NetworkRequest, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<NetworkRequest, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
} = NetworkRequestImpl.next as typeof next

/**
 * Subscribes to requests and emits every match from now on, decoding bodies when requested.
 *
 * **Details**
 *
 * With `body`, capture starts when this returns, even before consumption. Its scope owns collection and
 * outstanding reads. Each body read and decoder uses the `Deadline.DefaultBudget` read at acquisition;
 * failures fail the stream. Without `body`, only immutable request metadata is delivered.
 *
 * **Example** (Logging fetches until the page closes)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Console, Effect, Stream } from "effect"
 *
 * const logFetches = Effect.fn("logFetches")(function*(page: Page.ObservedPage) {
 *   const requests = yield* NetworkRequest.stream(page, { resourceType: "fetch" })
 *   yield* requests.pipe(
 *     Stream.runForEach((request) => Console.log(request.method, request.url)),
 *     Effect.forkScoped
 *   )
 * })
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
    where?: Subscription.Where<CapturedRequest<B>, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<
      CapturedRequest<B>,
      DE | PE | RequestError | Subscription.EventOverflow | Target.TargetGone | Deadline.Timeout
    >,
    Subscription.SubscriptionError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope | DR | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: (Filter & { readonly body?: never }) | undefined,
    where?: Subscription.Where<NetworkRequest, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<NetworkRequest, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
} = NetworkRequestImpl.stream as typeof stream

/**
 * Reads the requests the target's event log kept (`UserContext.Options.eventLog`); never waits.
 *
 * **Example** (Counting the images a page loaded)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const countImages = Effect.fn("countImages")(function*(page: Page.ObservedPage) {
 *   const images = yield* NetworkRequest.history(page, { resourceType: "image" })
 *   return { count: images.entries.length, complete: images.dropped === 0 }
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<NetworkRequest>, Subscription.SubscriptionError> =>
  NetworkRequestImpl.history(target, filter)

/**
 * Converts a captured request to an `HttpClientRequest`, to replay it with Effect's `HttpClient`.
 *
 * **Gotchas**
 *
 * - The result has the request's method, URL and headers, and no body: a replay of a `POST` sets one.
 * - Header values are whole, so a replay sends the credentials the page put in, such as an `Authorization`
 *   header. Effect's `Headers` still redact them wherever the result is logged or inspected.
 * - On Chromium and WebKit, the headers leave out what the network adds, `Cookie` among them. On Firefox they
 *   include the `Cookie` the browser sent, so the replay sends it too.
 *
 * **Example** (Replaying a search request)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { HttpClient } from "effect/http"
 *
 * const replaySearch = Effect.fn("replaySearch")(function*(page: Page.Page) {
 *   const searched = yield* NetworkRequest.next(page, {
 *     url: "https://shop.example.com/api/search?*"
 *   })
 *   yield* page.goto("https://shop.example.com/search?q=boots")
 *   const request = yield* searched
 *   const response = yield* HttpClient.execute(
 *     NetworkRequest.toHttpClientRequest(request)
 *   )
 *   return response.status
 * })
 * ```
 *
 * @stability unstable
 * @category converting
 * @since 0.1.0
 */
export const toHttpClientRequest = (request: NetworkRequest): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.make(request.method)(request.url, { headers: request.headers })

/**
 * Gives a request's sent headers, waiting until the browser can attribute them to that request.
 *
 * **Details**
 *
 * - A request's `headers` are the ones its event gives, which on Chromium and WebKit leave out what the network
 *   adds, such as `Cookie`. On Chromium this can wait for response or redirect information even after the extra
 *   headers arrive, so they cannot be confused with another redirect hop's headers. On WebKit it waits for the
 *   response. On Firefox it returns at once. The operation's deadline bounds the wait.
 * - If the request finishes, fails, is canceled, is evicted from retention, or loses its frame, worker, context, page
 *   or browser connection before its sent headers are known, this
 *   returns the available sent headers, or the request event's headers if none were reported. Those can omit
 *   network additions such as `Cookie`.
 * - `target` is the page or context the request was seen on.
 * - Strider keeps the last 1000 redirect hops; for an older request, this gives its event's headers.
 *
 * **Gotchas**
 *
 * In a request-phase route handler, awaiting this before continuing the request prevents it from being sent.
 * On Chromium, awaiting this before letting the same response proceed also waits until the deadline. Continue
 * the route first, then inspect sent headers outside its handler, or read `request.headers` immediately if its possible omissions are acceptable.
 *
 * WebKit never reports `Cookie` among the headers sent (`network.headersSent` is partial there).
 *
 * **Example** (Checking that a request sent cookies)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const sentSession = Effect.fn("sentSession")(function*(page: Page.Page) {
 *   const sent = yield* NetworkRequest.next(page, {
 *     url: "https://app.example.com/api/session"
 *   })
 *   yield* page.goto("https://app.example.com")
 *   const headers = yield* NetworkRequest.headersSent(page, yield* sent)
 *   return headers["cookie"] !== undefined
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const headersSent = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest
): Effect.Effect<Headers.Headers, Deadline.Timeout> => NetworkRequestImpl.headersSent(target, request)

/**
 * A request whose collected body has been decoded; `None` means the native protocol indicates no payload.
 *
 * **Details**
 *
 * The decoder result is owned by the caller and outlives the subscription and page. Browsers can conflate an
 * empty body with no body; unavailable or incomplete data fails instead of producing `None`. Stock WebKit
 * refuses empty or missing native text, which cannot establish completeness.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CapturedRequest<B> extends NetworkRequest {
  readonly body: Option.Option<B>
}

/**
 * Reads collected request data with Effect's HTTP decoders, using `text`, `arrayBuffer`, `json` or `urlParamsBody`.
 *
 * **Gotchas**
 *
 * Stock WebKit supplies reported text only: exact-byte reads (`arrayBuffer` and `stream`) fail. Multipart bodies
 * whose completeness cannot be established fail before decoding. URL-encoded forms retain duplicate keys.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BodyDecoder<B, DE, DR> = (
  message: HttpIncomingMessage.HttpIncomingMessage<RequestError>
) => Effect.Effect<B, DE, DR>

/**
 * Reference to the largest request body a subscription collects; 10 MiB unless set.
 *
 * **Details**
 *
 * Read when a subscription with `body` starts. Each subscription enforces its own limit. For stock WebKit's
 * reported text, the limit counts its UTF-8 representation; the protocol does not expose the original bytes.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const BodyLimit: Context.Reference<ByteSize.ByteSize> = Context.Reference<ByteSize.ByteSize>(
  "@usestrider/browser/NetworkRequest/BodyLimit",
  { defaultValue: () => ByteSize.mebibytes(10) }
)

/**
 * Sets the collection limit for request body subscriptions acquired inside an effect.
 *
 * **Example** (Bounding a submitted form)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const submittedForm = (page: Page.ReadonlyPage) =>
 *   NetworkRequest.next(page, {
 *     url: "https://example.com/submit",
 *     body: (message) => message.urlParamsBody
 *   }).pipe(NetworkRequest.withBodyLimit("1 MiB"))
 * ```
 *
 * @see {@link BodyLimit} for the reference it sets
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
 * Reason for a body the browser cannot supply, including a redirect hop whose data has been replaced.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BodyUnavailable
  extends Schema.Error<BodyUnavailable>("@usestrider/browser/NetworkRequest/BodyUnavailable")({
    _tag: Schema.tag("BodyUnavailable"),
    why: Schema.Literals(["notCollected", "redirect", "unavailable", "unsupportedRepresentation"]),
    hint: Schema.String
  })
{
  override get message(): string {
    return `Request body unavailable: ${this.why} (${this.hint})`
  }
}

/**
 * Reason for request data that exceeds its collection limit or is incomplete; no partial data reaches a decoder.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BodyTruncated extends Schema.Error<BodyTruncated>("@usestrider/browser/NetworkRequest/BodyTruncated")({
  _tag: Schema.tag("BodyTruncated"),
  why: Schema.Literals(["overLimit", "incomplete"]),
  hint: Schema.String
}) {
  override get message(): string {
    return `Request body incomplete: ${this.why} (${this.hint})`
  }
}

/**
 * Reason for a collected request body that cannot be parsed as JSON.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class MalformedBody extends Schema.Error<MalformedBody>("@usestrider/browser/NetworkRequest/MalformedBody")({
  _tag: Schema.tag("MalformedBody"),
  expected: Schema.Literal("json"),
  hint: Schema.String
}) {
  override get message(): string {
    return `Request body is not ${this.expected}: ${this.hint}`
  }
}

/**
 * Reason a request's live observation is unavailable.
 *
 * **Details**
 *
 * `notRetained` includes unknown, evicted, copied or decoded request snapshots. `foreignTarget` means the
 * request belongs to another page or context. `ownerLost` means its page, context, frame, worker or browser
 * connection is gone. `timingNotEnabled` means its context did not opt into timing collection.
 * None of these proves that the network request failed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class RequestUnavailable
  extends Schema.Error<RequestUnavailable>("@usestrider/browser/NetworkRequest/RequestUnavailable")({
    _tag: Schema.tag("RequestUnavailable"),
    why: Schema.Literals(["notRetained", "foreignTarget", "ownerLost", "timingNotEnabled"])
  })
{
  override get message(): string {
    return `Request observation unavailable: ${this.why}`
  }
}

/**
 * Reason a request's response association is no longer available.
 *
 * **Details**
 *
 * `evicted` means the bounded request index forgot the hop. `foreignTarget` means the retained hop belongs to
 * another page or context. `released` means the acquiring scope closed. `targetClosed` means the target closed
 * before a response arrived. A network failure without a response instead succeeds with `Option.none`.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ResponseUnavailable
  extends Schema.Error<ResponseUnavailable>("@usestrider/browser/NetworkRequest/ResponseUnavailable")({
    _tag: Schema.tag("ResponseUnavailable"),
    why: Schema.Literals(["evicted", "foreignTarget", "released", "targetClosed"])
  })
{
  override get message(): string {
    return `Request response unavailable: ${this.why}`
  }
}

/**
 * Schema for the reasons reading a request body, timing or response association can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestErrorReason = Schema.Union([
  BodyUnavailable,
  RequestUnavailable,
  ResponseUnavailable,
  BodyTruncated,
  MalformedBody,
  Reason.BackendFailure,
  Reason.Unsupported
])

/**
 * The reasons reading a request body, timing or response association can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RequestErrorReason = typeof RequestErrorReason.Type

/**
 * Error for a request body, timing or response association that could not be read.
 *
 * **Details**
 *
 * Body collection failures include the request URL; timing and response association failures may omit it.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class RequestError
  extends Schema.TaggedError<RequestError>("@usestrider/browser/NetworkRequest/RequestError")("RequestError", {
    hop: HopId,
    url: Schema.optional(Url.Url),
    reason: RequestErrorReason,
    diagnostics: Diagnostics.Diagnostics
  })
{
  override get message(): string {
    return this.reason.message
  }
}

/**
 * A snapshot of a request hop's native timings, with unavailable phases represented by `None`.
 *
 * **Details**
 *
 * `startTime` is milliseconds since the Unix epoch. Every other value is milliseconds from that same
 * hop's native baseline. A missing value proves neither completion nor failure. Earlier snapshots never
 * change. Connection reuse, cache responses and missing browser evidence can leave phases unavailable.
 * `requestStart` can describe browser-reported cache access as well as request sending. Cache reuse can omit
 * a second observable request entirely. Source labels alone do not establish whether the server was contacted.
 * `secureConnectionStart` is currently unavailable; TLS phase mapping is not advertised.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Timing extends Schema.Class<Timing>("@usestrider/browser/NetworkRequest/Timing")({
  startTime: Schema.Option(Schema.Number),
  domainLookupStart: Schema.Option(Schema.Number),
  domainLookupEnd: Schema.Option(Schema.Number),
  connectStart: Schema.Option(Schema.Number),
  connectEnd: Schema.Option(Schema.Number),
  secureConnectionStart: Schema.Option(Schema.Number),
  requestStart: Schema.Option(Schema.Number),
  responseStart: Schema.Option(Schema.Number),
  responseEnd: Schema.Option(Schema.Number)
}) {}

/**
 * Reads the timing observed so far for an original request, without waiting or sending browser commands.
 *
 * **Details**
 *
 * Create the context with `requestTiming: true` before opening its pages. Omitted or false configuration
 * collects no timing state. Reads otherwise fail with `RequestError` / `RequestUnavailable`.
 * The original request must remain in the bounded 1000-hop index with live page, context, frame or worker
 * and connection owners. Copied, decoded, evicted and foreign requests refuse. Save the returned Schema
 * snapshot to retain it beyond those owners. History does not pin timing observations.
 *
 * `responseEnd` appears only after successful transfer completion, including redirect hops. A failure after
 * headers preserves earlier phases with no successful end. Redirect end can be an observation bound from
 * the next request event. Response-header boundaries differ by backend; unknown origins leave dependent
 * values unavailable. Chromium reports header start when present, Firefox its native response start, and
 * stock WebKit its native response-header start. WebKit's ambiguous zero phases and redirect origins are
 * unavailable. Worker requests without a page-attributed native timing collector have unavailable phases.
 *
 * **Example** (Opting into timings)
 *
 * ```ts import.meta.vitest
 * import { Browser, NetworkRequest } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const inspect = Effect.fn("inspect")(function*() {
 *   const context = yield* Browser.newContext({ requestTiming: true })
 *   const page = yield* context.newPage
 *   const sent = yield* NetworkRequest.next(page, { url: "https://example.com/" })
 *   yield* page.goto("https://example.com")
 *   return yield* NetworkRequest.timing(page, yield* sent)
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const timing = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest
): Effect.Effect<Timing, RequestError> => NetworkRequestImpl.timing(target, request)

/**
 * Retains one request hop in the caller's scope and returns a wait for its response, without collecting its body.
 *
 * **Details**
 *
 * Acquire on the page or context that observed the request, while it is still among the last 1000 retained hops.
 * Each redirect hop has its own response. The returned effect gives an already-arrived response immediately, or
 * waits under the deadline in force when it runs. A request that ends without a response gives `Option.none`.
 * In-flight model eviction fails with `ResponseUnavailable`; scope closure releases the hop and fails pending
 * and subsequent waits with `released`. Closing the target before arrival fails with `targetClosed`.
 * Only this explicit acquisition retains the hop beyond a lookup; it enables no browser instrumentation or body capture.
 *
 * **Gotchas**
 *
 * Awaiting a response inside a request-phase route handler before continuing that request prevents it from being
 * sent. Continue the request first. Response bodies require a separate `NetworkResponse` body subscription set
 * up before the request.
 *
 * **Example** (Finding the response to an observed request)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const status = Effect.fn("status")(function*(page: Page.Page) {
 *   const sent = yield* NetworkRequest.next(page, { url: "https://example.com/" })
 *   yield* page.goto("https://example.com/")
 *   const response = yield* NetworkRequest.response(page, yield* sent)
 *   return yield* response
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const response = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest
): Effect.Effect<
  Effect.Effect<Option.Option<NetworkResponse.NetworkResponse>, RequestError | Deadline.Timeout>,
  RequestError,
  Scope.Scope
> => NetworkRequestImpl.response(target, request)
