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
import * as Redactable from "effect/Redactable"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as NetworkRequestImpl from "./internal/networkRequest.ts"
import * as Redaction from "./internal/redaction.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
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
 * - If the request finishes, fails, is canceled or its page goes away before its sent headers are known, this
 *   returns the available sent headers, or the request event's headers if none were reported. Those can omit
 *   network additions such as `Cookie`.
 * - `target` is the page or context the request was seen on.
 * - Strider keeps the last 1000 redirect hops; for an older request, this gives its event's headers.
 *
 * **Gotchas**
 *
 * On Chromium, awaiting this before letting the same request's response proceed waits until the deadline. Let
 * the response proceed first, or read `request.headers` immediately if its possible omissions are acceptable.
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
