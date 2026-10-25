/**
 * Requests a page or context makes: the event, and the data every route and response refers to.
 *
 * A `NetworkRequest` is one redirect hop, immutable, with Effect's `Headers`; classified header values, such
 * as cookies and authorization, are redacted. It is data (a Schema), so it can be encoded for export.
 *
 * A request is reported when it is sent, to the page and context that made it: a frame's requests reach its
 * page, and a worker's its page or context. Firefox and WebKit attribute a dedicated worker's requests to its
 * page's document, as `initiator` says.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpMethod from "effect/http/HttpMethod"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import * as Spans from "./internal/spans.ts"
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
}) {}

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

// ── Implementation ──

const kind = (operation: string): Events.Kind<NetworkRequest, NetworkRequest> => ({
  operation,
  noun: "a request",
  deliver: (request) => request
})

const subscription = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: Filter | undefined,
  operation: string
) =>
  Effect.suspend(() => {
    const channel = Handles.target(target).behind.entry.events.request
    const method = Filters.among<string>(filter?.method)
    const resourceType = Filters.among(filter?.resourceType)
    return Effect.map(Filters.url(operation, filter?.url), (matches) => ({
      kind: kind(operation),
      channel,
      accepts: (entry: Events.Entry<NetworkRequest>) =>
        Filters.urlMatches(matches, entry.value.url) && method(entry.value.method) &&
        resourceType(entry.value.resourceType)
    }))
  })

/**
 * Subscribes to requests and returns the first match, latched.
 *
 * **Gotchas**
 *
 * `url` is required here: "the next request of any kind" is almost never what a test means.
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
> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkRequest.next"),
    ({ accepts, channel, kind }) => Events.next(kind, channel, accepts, where)
  ).pipe(Spans.operation("NetworkRequest.next"))

/**
 * Subscribes to requests and emits every match from now on.
 *
 * **Example** (Logging fetches until the page closes)
 *
 * ```ts import.meta.vitest
 * import { Console, Effect, Stream } from "effect"
 * import { NetworkRequest, Page } from "@usestrider/browser"
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
> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkRequest.stream"),
    ({ accepts, channel, kind }) => Events.stream(kind, channel, accepts, where)
  )

/**
 * Reads the requests a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<NetworkRequest>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkRequest.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )

/**
 * Converts a captured request to an `HttpClientRequest`, to replay it with Effect's `HttpClient`.
 *
 * **Gotchas**
 *
 * Redacted header values stay redacted in the result. Replaying a request that needs them means setting them
 * again explicitly.
 *
 * @stability unstable
 * @category converting
 * @since 0.1.0
 */
export const toHttpClientRequest = (request: NetworkRequest): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.make(request.method)(request.url, { headers: request.headers })
