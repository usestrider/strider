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
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpMethod from "effect/http/HttpMethod"
import type * as Option from "effect/Option"
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
 * `url` is required here, unlike in `stream` and `history`.
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
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: Filter & { readonly url: Url.Pattern | string },
  where?: Subscription.Where<NetworkRequest, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<NetworkRequest, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => NetworkRequestImpl.next(target, filter, where)

/**
 * Subscribes to requests and emits every match from now on.
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
export const stream = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<NetworkRequest, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<NetworkRequest, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => NetworkRequestImpl.stream(target, filter, where)

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
 * A browser-reported request failure, with the original error text and cancellation evidence.
 *
 * **Details**
 *
 * `canceled` is `Some(true)` for reported cancellation and `Some(false)` otherwise on Chromium and WebKit.
 * On BiDi it is `None`: that protocol reports error text without a cancellation flag. Error text is not a
 * portable error code and is never used to infer cancellation here.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Failure extends Schema.Class<Failure>("@usestrider/browser/NetworkRequest/Failure")({
  errorText: Schema.String,
  canceled: Schema.Option(Schema.Boolean)
}) {}

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
 * Reason redirect evidence cannot be read at this time.
 *
 * **Details**
 *
 * `evicted` means the request or its neighbor is not retained. `foreignTarget` means the retained hop belongs
 * to another page or context. `unavailable` means the snapshot was reconstructed or required response evidence
 * is missing. It also covers an absent navigation outcome when its history is disabled or incomplete. `released` ends scoped access and `targetClosed` ends access through a closed target or connection.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class RedirectUnavailable
  extends Schema.Error<RedirectUnavailable>("@usestrider/browser/NetworkRequest/RedirectUnavailable")({
    _tag: Schema.tag("RedirectUnavailable"),
    why: Schema.Literals(["evicted", "foreignTarget", "unavailable", "released", "targetClosed"])
  })
{
  override get message(): string {
    return `Redirect evidence is ${this.why}`
  }
}

/**
 * Reason the browser has not proved whether a request has a successor or ends its chain.
 *
 * **Details**
 *
 * `inFlight` means the hop has not ended. `completedRedirect` means a redirect response ended but no successor
 * or retained terminal navigation outcome proves what follows. This is distinct from missing request evidence.
 * It can persist for a manual fetch on Firefox or WebKit. Neither case waits or infers an absent link.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class RedirectUnknown
  extends Schema.Error<RedirectUnknown>("@usestrider/browser/NetworkRequest/RedirectUnknown")({
    _tag: Schema.tag("RedirectUnknown"),
    why: Schema.Literals(["inFlight", "completedRedirect"])
  })
{
  override get message(): string {
    return `Redirect successor is unknown: ${this.why}`
  }
}

/**
 * Error reading a request's response association, live observation or redirect links.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class RequestError
  extends Schema.TaggedError<RequestError>("@usestrider/browser/NetworkRequest/RequestError")("RequestError", {
    hop: HopId,
    reason: Schema.Union([RequestUnavailable, ResponseUnavailable, RedirectUnavailable, RedirectUnknown]),
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

/**
 * Reads the failure reported for a request so far, without waiting or sending browser commands.
 *
 * **Details**
 *
 * Returns `None` for a live request still in flight or one that finished successfully, including HTTP 404/503
 * responses and redirect hops. A failed transfer can have received response headers before failing.
 * `Some` preserves the failure text and cancellation evidence; it does not classify HTTP status codes.
 *
 * Pass the original request observation and its page or context. The bounded index keeps at most 1000 hops
 * across the connection, dropping completed hops first. Missing, evicted, copied and foreign requests fail
 * with `RequestError` / `RequestUnavailable`. Loss of the owning page, context, frame, worker or connection
 * makes even a completed request unavailable. Save a returned `Failure` if it must outlive that owner.
 * This read adds no retention, subscription or instrumentation.
 *
 * **Example** (Inspecting a request after an action completes)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const inspectSave = Effect.fn("inspectSave")(function*(page: Page.Page) {
 *   const sent = yield* NetworkRequest.next(page, {
 *     url: "https://app.example.com/api/save"
 *   })
 *   yield* page.getByRole("button", { name: "Save" }).click()
 *   return yield* NetworkRequest.failure(page, yield* sent)
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const failure = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest
): Effect.Effect<Option.Option<Failure>, RequestError> => NetworkRequestImpl.failure(target, request)

/**
 * Scoped access to neighboring request snapshots in the browser's bounded hop index.
 *
 * **Details**
 *
 * Both members read immediately. `None` means a proven boundary; insufficient terminal evidence fails with
 * `RedirectUnknown`, separately from `RedirectUnavailable`.
 * Pass the original snapshot received from this target, rather than a decoded or copied request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Redirects {
  /** Reads the preceding hop, or `None` for the first hop. */
  readonly from: (request: NetworkRequest) => Effect.Effect<Option.Option<NetworkRequest>, RequestError>
  /** Reads an observed successor, or `None` with terminal proof; insufficient proof fails with `RedirectUnknown`. */
  readonly to: (request: NetworkRequest) => Effect.Effect<Option.Option<NetworkRequest>, RequestError>
}

/**
 * Opens scoped access to a page's or context's redirect links without enabling additional request tracking.
 *
 * **Details**
 *
 * All backends reuse the existing connection-wide index of at most 1000 hops. Completed hops are evicted
 * oldest first, then unfinished hops if necessary. Other contexts can therefore evict evidence. This retains
 * no additional requests, installs no listeners and sends no protocol commands. Closing the scope revokes access;
 * closing the target or connection also prevents reads. Access may read requests sent before it opened.
 *
 * `from` and `to` use chain identity and hop ordinal, including when URLs repeat. They require the exact original
 * snapshot and its owning page or context. Missing hops fail with `RedirectUnavailable` (`evicted`), and a retained
 * hop owned by another target fails with `foreignTarget`. `to` gives observed links first, including Chromium's
 * canceled successor attempt for a manual fetch. Otherwise a completed failure or non-redirect response proves
 * the end. A retained committed navigation outcome naming this exact response hop also proves the end, including
 * a 302 without Location. This navigation proof comes from the page's bounded event log (`Options.eventLog`).
 *
 * Without terminal proof, `to` fails with `RedirectUnknown`: `inFlight` before completion or `completedRedirect`
 * after a redirect response. Firefox reports redirect completion before its next request, and does not expose
 * fetch redirect mode. Firefox and WebKit manual fetches can therefore remain unknown. A missing retained
 * navigation outcome cannot prove a boundary either. If the needed outcome is absent and navigation history is
 * disabled or has dropped entries, `RedirectUnavailable` (`unavailable`) preserves that retention failure.
 * Neither member waits, installs tracking or sends commands.
 *
 * **Example** (Reading a redirect's predecessor)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const predecessor = Effect.fn("predecessor")(
 *   function*(page: Page.ObservedPage, request: NetworkRequest.NetworkRequest) {
 *     const redirects = yield* NetworkRequest.redirects(page)
 *     return yield* redirects.from(request)
 *   }
 * )
 * ```
 *
 * **Example** (Treating unknown as no successor seen)
 *
 * This handles only uncertainty. Other errors remain failures. Here `None` means no successor was seen,
 * rather than proof that none exists.
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const successorSeen = Effect.fn("successorSeen")(
 *   function*(page: Page.ObservedPage, request: NetworkRequest.NetworkRequest) {
 *     const links = yield* NetworkRequest.redirects(page)
 *     return yield* links.to(request).pipe(
 *       Effect.catchReason("RequestError", "RedirectUnknown", () => Effect.succeedNone)
 *     )
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const redirects = (
  target: Page.ObservedPage | UserContext.ObservedUserContext
): Effect.Effect<Redirects, never, Scope.Scope> => NetworkRequestImpl.redirects(target)
