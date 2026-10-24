/**
 * Routes intercept requests, and their handlers decide what happens to each one.
 *
 * A route registers one phase: a request before it is sent (the default), its response before the page sees
 * it, or its authentication challenge. A handler returns a `Decision` valid at its phase, so a paused request
 * is never left hanging. A handler that fails, is interrupted, runs out of time, or returns a decision the
 * backend can't apply gets the default decision, `continue`, and its failure is logged. Requests and responses
 * are Effect's HTTP types: a fulfilled response is an `HttpServerResponse`, and a change to a request is a
 * function over `HttpClientRequest`. Routes compose by precedence: the page's before its context's, and the
 * most recent first.
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
import type * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as RouteDecision from "./internal/routeDecision.ts"
import type * as NetworkRequest from "./NetworkRequest.ts"
import type * as NetworkResponse from "./NetworkResponse.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as Watchable from "./Watchable.ts"

const DecisionTypeId = RouteDecision.TypeId

/**
 * Where a request is paused: before it is sent, when its response starts, or at an authentication challenge.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Phase = "request" | "response" | "auth"

/**
 * What happens to an intercepted request: a decision valid at the phases `P`.
 *
 * **Details**
 *
 * A decision valid at more phases is accepted where fewer are asked for, so `Route.continue`, valid at every
 * phase, is a decision for any handler, while `Route.provideCredentials` is one only for an `auth` route.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Decision<in P extends Phase = Phase> {
  readonly [DecisionTypeId]: (phase: P) => void
}

/**
 * Checks whether a value is a `Decision`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDecision = (u: unknown): u is Decision<never> => Predicate.hasProperty(u, DecisionTypeId)

/**
 * An authentication challenge, as the server sent it, its scheme lowercased (`"basic"`).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Challenge {
  readonly origin: string
  readonly scheme: string
  readonly realm: string
}

/**
 * What every paused request offers.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Paused {
  /**
   * The request as paused; fixed.
   */
  readonly request: NetworkRequest.NetworkRequest
  /**
   * The request's body, as it was sent; `None` without one.
   */
  readonly requestBody: Effect.Effect<Option.Option<Uint8Array>, RouteError | Target.TargetGone>
}

/**
 * A request paused before it is sent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestPhase extends Paused {
  readonly phase: "request"
}

/**
 * A request paused when its response starts, before the page sees it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponsePhase extends Paused {
  readonly phase: "response"
  /**
   * The response's status and headers; fixed.
   */
  readonly response: NetworkResponse.NetworkResponse
  /**
   * The response's body; `Unsupported` where the backend can't read a paused response
   * (`interception.responseBody`: CDP only).
   */
  readonly responseBody: Effect.Effect<Uint8Array, RouteError | Target.TargetGone>
}

/**
 * A request paused at an authentication challenge.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AuthPhase extends Paused {
  readonly phase: "auth"
  readonly challenge: Challenge
}

/**
 * A request paused at the phase `P`, waiting for its handler's decision.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Intercepted<P extends Phase = Phase> = Extract<RequestPhase | ResponsePhase | AuthPhase, { phase: P }>

/**
 * A route handler: decides what happens to each request paused at its phase.
 *
 * **Details**
 *
 * A failure `E` is logged, and the default decision, `continue`, applies.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Handler<E, R, P extends Phase = "request"> = (
  intercepted: Intercepted<P>
) => Effect.Effect<Decision<P>, E, R>

/**
 * Settings for `route`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options<P extends Phase = "request"> {
  /**
   * Which phase the route sees.
   *
   * @default "request"
   */
  readonly phase?: P | undefined
}

// A value, so its export needs a binding at run time
const _continue: Decision<Phase> = RouteDecision.make({ _tag: "Continue" })

export {
  /**
   * Lets the request continue unchanged; at the `auth` phase, the page gets the challenge's response.
   *
   * **Details**
   *
   * At the `auth` phase, the browser's own prompt is never shown: headless, it waits forever.
   *
   * @stability unstable
   * @category constructors
   * @since 0.1.0
   */
  _continue as continue
}

/**
 * Lets the request continue, changed by `change`; only what changed is sent.
 *
 * **Gotchas**
 *
 * A change the backend can't apply fails the decision with `Unsupported`, and the default applies: Firefox
 * can't send a request to a new URL (`interception.continueUrl`).
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
export const continueWith = (
  change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
): Decision<"request"> => RouteDecision.make({ _tag: "ContinueWith", change })

/**
 * Answers the request with a response, without contacting the server; at the `response` phase, replaces the
 * server's.
 *
 * **Details**
 *
 * The response is read whole, with its cookies as `Set-Cookie` headers. A fulfilled cross-origin response
 * needs CORS headers, as the server's would.
 *
 * **Gotchas**
 *
 * Firefox can't fulfill at the `response` phase (`interception.responseFulfill`).
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
export const fulfill = (response: HttpServerResponse.HttpServerResponse): Decision<"request" | "response"> =>
  RouteDecision.make({ _tag: "Fulfill", response })

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
 * **Gotchas**
 *
 * A reason other than `"failed"` is CDP's alone (`interception.abortReason`): Firefox and WebKit report one
 * failure for every reason.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const abort = (reason?: AbortReason | undefined): Decision<"request" | "response"> =>
  RouteDecision.make({ _tag: "Abort", reason: reason ?? "failed" })

/**
 * Passes the request to the next matching route, or lets the default decide when there is none.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const fallthrough: Decision<Phase> = RouteDecision.make({ _tag: "Fallthrough" })

/**
 * Answers an authentication challenge.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const provideCredentials = (credentials: {
  readonly username: string
  readonly password: Redacted.Redacted<string>
}): Decision<"auth"> => RouteDecision.make({ _tag: "ProvideCredentials", ...credentials })

/**
 * The handle `route` returns.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Registration extends Declaration.Registration {
  /**
   * How many requests this route was asked about.
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
 * Error for a route that couldn't be registered, or a body a handler couldn't read.
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
