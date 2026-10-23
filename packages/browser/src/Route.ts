/**
 * Routes intercept requests, and their handlers decide what happens to each one.
 *
 * A handler returns a `Decision`, so a paused request is never left hanging. A handler that fails, is
 * interrupted, or outlives its scope gets the default decision, `continue`, and its failure is logged.
 * Requests and responses are Effect's HTTP types: a fulfilled response is an `HttpServerResponse`, and a
 * change to a request is a function over `HttpClientRequest`. Handlers compose by precedence: the most
 * specific scope first (page before context), then priority, then the most recent.
 *
 * **Gotchas**
 *
 * This module exposes `effect/http` types, which Effect marks unstable, so it can change when they do.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import type * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as NetworkRequest from "./NetworkRequest.ts"
import * as Reason from "./Reason.ts"
import * as Url from "./Url.ts"
import type * as Watchable from "./Watchable.ts"

const DecisionTypeId = "~@usestrider/browser/Route/Decision"

/**
 * What happens to an intercepted request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Decision {
  readonly [DecisionTypeId]: typeof DecisionTypeId
}

/**
 * Checks whether a value is a `Decision`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDecision = (u: unknown): u is Decision => Predicate.hasProperty(u, DecisionTypeId)

/**
 * A request paused at one phase, waiting for its handler's decision.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Intercepted {
  /**
   * The request as paused at this phase; fixed.
   */
  readonly request: NetworkRequest.NetworkRequest
  /**
   * Which phase it is paused at; fixed.
   */
  readonly phase: "request" | "response" | "auth"
  /**
   * Lets the browser perform the request and returns the response, so the handler can fulfill with a
   * patched copy (`HttpServerResponse.fromClientResponse`).
   */
  readonly fetch: Effect.Effect<HttpClientResponse.HttpClientResponse, RouteError>
  /**
   * Like `fetch`, with the request changed first.
   */
  fetchWith(
    change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, RouteError>
}

/**
 * A route handler: decides what happens to each intercepted request.
 *
 * **Details**
 *
 * A failure `E` is logged, and the default decision, `continue`, applies.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Handler<E, R> = (intercepted: Intercepted) => Effect.Effect<Decision, E, R>

// A value, so its export needs a binding at run time. Routes aren't built, so nothing reads a decision yet, and
// what each one carries is decided with them (PROTOCOL.md)
const _continue: Decision = { [DecisionTypeId]: DecisionTypeId }

export {
  /**
   * Lets the request continue unchanged.
   *
   * @stability unstable
   * @category constructors
   * @since 0.1.0
   */
  _continue as continue
}

/**
 * Lets the request continue, changed by `change`.
 *
 * **Gotchas**
 *
 * A change the backend can't apply fails with `Unsupported` naming the field. CDP can change the URL, method,
 * headers and body; BiDi can also change cookies.
 *
 * **Example** (Adding a header to API calls)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { HttpClientRequest } from "effect/http"
 * import { Page, Route } from "@usestrider/browser"
 *
 * const tagApiCalls = Effect.fn("tagApiCalls")(function*(page: Page.Page) {
 *   yield* page.route("https://shop.example.com/api/**", () =>
 *     Effect.succeed(Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))))
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const continueWith: (
  change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
) => Decision

/**
 * Answers the request with a response, without contacting the server.
 *
 * **Example** (Stubbing an API response)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { HttpServerResponse } from "effect/http"
 * import { Page, Route } from "@usestrider/browser"
 *
 * const stubUser = Effect.fn("stubUser")(function*(page: Page.Page) {
 *   yield* page.route("https://shop.example.com/api/user", () =>
 *     Effect.succeed(Route.fulfill(HttpServerResponse.jsonUnsafe({ name: "Ada" }))))
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const fulfill: (response: HttpServerResponse.HttpServerResponse) => Decision

/**
 * A network error code to fail a request with.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AbortReason =
  | "failed"
  | "aborted"
  | "timedOut"
  | "accessDenied"
  | "connectionClosed"
  | "connectionReset"
  | "connectionRefused"
  | "connectionAborted"
  | "connectionFailed"
  | "nameNotResolved"
  | "internetDisconnected"
  | "addressUnreachable"
  | "blockedByClient"
  | "blockedByResponse"

/**
 * Fails the request with a network error; `"failed"` unless a reason is given.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const abort: (reason?: AbortReason | undefined) => Decision

/**
 * Passes the request to the next matching handler, or lets it continue when there is none.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const fallthrough: Decision

/**
 * Answers an authentication challenge; valid only in the `auth` phase.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const provideCredentials: (credentials: {
  readonly username: string
  readonly password: Redacted.Redacted<string>
}) => Decision

/**
 * The handle `route` returns.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Registration extends Declaration.Registration {
  /**
   * How many requests this route has intercepted.
   */
  readonly hits: Watchable.Watchable<number>
}

/**
 * Schema for the reasons a route can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RouteErrorReason = Schema.Union([
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a route can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RouteErrorReason = typeof RouteErrorReason.Type

const RouteErrorTypeId = "~@usestrider/browser/Route/RouteError"

/**
 * Error for a route that couldn't be registered, or a fetch inside a handler that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class RouteError extends Schema.TaggedError<RouteError>(RouteErrorTypeId)("RouteError", {
  pattern: Url.Pattern,
  reason: RouteErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [RouteErrorTypeId] = RouteErrorTypeId
  override get message(): string {
    return `${this.pattern}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `RouteError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isRouteError = (u: unknown): u is RouteError => Predicate.hasProperty(u, RouteErrorTypeId)
