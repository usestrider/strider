/**
 * Routes intercept a page's or context's requests, and a route's handler decides what happens to each one.
 *
 * A route works at one phase: before the request is sent (the default), when its response starts or at an
 * authentication challenge. Its handler returns an Effect that produces a `Decision` valid at that phase. A
 * handler that fails, is interrupted, runs out of time or returns a decision the backend can't apply gets the
 * default, `continue`, and
 * its failure is logged. A fulfilled response is an `HttpServerResponse`, and a change to a request is a function
 * of `HttpClientRequest`. The page's routes are asked before its context's, the most recent first.
 *
 * **Gotchas**
 *
 * This module uses `effect/http`'s types, which Effect marks unstable, so it can change when they do.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Headers from "effect/http/Headers"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import type * as Har from "./Har.ts"
import * as HarReplay from "./internal/harReplay.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as RouteDecision from "./internal/routeDecision.ts"
import type * as NetworkRequest from "./NetworkRequest.ts"
import type * as NetworkResponse from "./NetworkResponse.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as Watchable from "./Watchable.ts"

const DecisionTypeId = RouteDecision.TypeId

/**
 * Where a request is paused: before it's sent, when its response starts or at an authentication challenge.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Phase = "request" | "response" | "auth"

/**
 * What happens to an intercepted request: the value produced by a handler's Effect, valid at the phases `P`.
 *
 * **Details**
 *
 * A decision valid at more phases is assignable where fewer are required: `Decision<Phase>` is assignable to
 * `Decision<"request">`, while `Decision<"auth">` is not. `Route.continue` produces a decision valid at every
 * phase; `Route.provideCredentials` returns an Effect producing a decision valid at `auth`. With an explicit
 * `phase` option, a route handler must produce a decision compatible with that phase.
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
 * An authentication challenge as the server sent it, with its scheme lowercased (`"basic"`).
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
   * The request as it was when paused, which doesn't change.
   */
  readonly request: NetworkRequest.NetworkRequest
  /**
   * The request's body as it was sent, or `None` if it has none.
   *
   * **Example** (Logging the orders a page places)
   *
   * ```ts import.meta.vitest
   * import { Page, Route } from "@usestrider/browser"
   * import { Console, Effect, Option } from "effect"
   *
   * const logOrders = Effect.fn("logOrders")(function*(page: Page.Page) {
   *   yield* page.route(
   *     "https://shop.example.com/api/orders",
   *     ({ requestBody }) =>
   *       requestBody.pipe(
   *         Effect.tap((body) =>
   *           Console.log(Option.map(body, (bytes) => new TextDecoder().decode(bytes)))
   *         ),
   *         Effect.andThen(Route.continue)
   *       )
   *   )
   * })
   * ```
   */
  readonly requestBody: Effect.Effect<Option.Option<Uint8Array>, RouteError | Target.TargetGone | Deadline.Timeout>
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
   * The response's status and headers, which don't change.
   */
  readonly response: NetworkResponse.NetworkResponse
  /**
   * The response's body. It fails with `Unsupported` where the backend can't read a paused response
   * (`interception.responseBody`: CDP only).
   *
   * **Example** (Rewriting a response's body)
   *
   * ```ts import.meta.vitest
   * import { Page, Route } from "@usestrider/browser"
   * import { Effect } from "effect"
   * import { HttpServerResponse } from "effect/http"
   *
   * const showProPlan = Effect.fn("showProPlan")(function*(page: Page.Page) {
   *   yield* page.route(
   *     "https://app.example.com/api/plan",
   *     ({ responseBody }) =>
   *       Effect.flatMap(responseBody, (bytes) => {
   *         const text = new TextDecoder().decode(bytes).replace("Free", "Pro")
   *         return Route.fulfill(
   *           HttpServerResponse.text(text, { contentType: "application/json" })
   *         )
   *       }),
   *     { phase: "response" }
   *   )
   * })
   * ```
   */
  readonly responseBody: Effect.Effect<Uint8Array, RouteError | Target.TargetGone | Deadline.Timeout>
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
export type Intercepted<P extends Phase = Phase> = {
  readonly request: RequestPhase
  readonly response: ResponsePhase
  readonly auth: AuthPhase
}[P]

/**
 * A route handler: decides what happens to each request paused at its phase.
 *
 * **Details**
 *
 * A failure `E` is logged, and the default decision, `continue`, applies. A handler valid at more phases
 * can be used where fewer phases are selected: it accepts all of their inputs and returns decisions valid
 * at every selected phase.
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
   * Which phase the route sees. Response-only handlers require an explicit `"response"`, and authentication
   * handlers require an explicit `"auth"`. If this may be omitted, the handler must also handle `"request"`.
   *
   * @default "request"
   */
  readonly phase?: P | undefined
}

// A value, so its export needs a binding at run time
const _continue: Effect.Effect<Decision<Phase>> = Effect.succeed(RouteDecision.make({ _tag: "Continue" }))

export {
  /**
   * Lets the request continue unchanged; at the `auth` phase, the page gets the challenge's response.
   *
   * **Details**
   *
   * At the `auth` phase, the browser never shows its own prompt.
   *
   * **Example** (Logging API calls without changing them)
   *
   * ```ts import.meta.vitest
   * import { Page, Route } from "@usestrider/browser"
   * import { Console, Effect } from "effect"
   *
   * const logApiCalls = Effect.fn("logApiCalls")(function*(page: Page.Page) {
   *   yield* page.route(
   *     "https://shop.example.com/api/**",
   *     ({ request }) =>
   *       Effect.andThen(Console.log(request.method, request.url), Route.continue)
   *   )
   * })
   * ```
   *
   * @stability unstable
   * @category constructors
   * @since 0.1.0
   */
  _continue as continue
}

/**
 * A change to a response paused at the `response` phase: what the page sees instead of what the server sent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResponseChange {
  /**
   * The status, with its standard phrase.
   *
   * @default the server's
   */
  readonly status?: number | undefined
  /**
   * The headers, which replace all of the server's: to change one, start from the paused response's `headers`.
   *
   * @default the server's
   */
  readonly headers?: Headers.Input | undefined
}

/**
 * Lets the request continue, changed by `change`.
 *
 * **Details**
 *
 * Only what the change altered is sent to the browser, so adding a header doesn't send the body again. At the
 * `response` phase, the change sets the status or headers, and the body stays as the server sent it.
 *
 * **Gotchas**
 *
 * A change the backend can't apply fails the decision with `Unsupported`, and the default applies: Firefox
 * can't send a request to a new URL (`interception.continueUrl`), and WebKit can't change a response it paused
 * (`interception.responseHeaders`).
 *
 * **Example** (Adding a header to API calls)
 *
 * ```ts import.meta.vitest
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { HttpClientRequest } from "effect/http"
 *
 * const tagApiCalls = Effect.fn("tagApiCalls")(function*(page: Page.Page) {
 *   yield* page.route(
 *     "https://shop.example.com/api/**",
 *     () => Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))
 *   )
 * })
 * ```
 *
 * **Example** (Letting a response be cached)
 *
 * ```ts import.meta.vitest
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { Headers } from "effect/http"
 *
 * const cacheable = Effect.fn("cacheable")(function*(page: Page.Page) {
 *   yield* page.route(
 *     "https://shop.example.com/static/**",
 *     ({ response }) =>
 *       Route.continueWith({
 *         headers: Headers.set(response.headers, "cache-control", "max-age=60")
 *       }),
 *     { phase: "response" }
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const continueWith: {
  (
    change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
  ): Effect.Effect<Decision<"request">>
  (change: ResponseChange): Effect.Effect<Decision<"response">>
} = ((
  change: ((request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest) | ResponseChange
) =>
  typeof change === "function"
    ? Effect.succeed(RouteDecision.make({ _tag: "ContinueWith", change }))
    : Effect.succeed(RouteDecision.make({
      _tag: "ContinueResponse",
      status: change.status,
      headers: change.headers === undefined ? undefined : Headers.fromInput(change.headers)
    }))) as never

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
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { HttpServerResponse } from "effect/http"
 *
 * const stubUser = Effect.fn("stubUser")(function*(page: Page.Page) {
 *   yield* page.route(
 *     "https://shop.example.com/api/user",
 *     () => Route.fulfill(HttpServerResponse.jsonUnsafe({ name: "Ada" }))
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const fulfill = (
  response: HttpServerResponse.HttpServerResponse
): Effect.Effect<Decision<"request" | "response">> => Effect.succeed(RouteDecision.make({ _tag: "Fulfill", response }))

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
 * A reason other than `"failed"` is CDP's alone (`interception.abortReason`): Firefox and WebKit report the same
 * failure for every reason, so on them the decision fails with `Unsupported`, and the default applies.
 *
 * **Example** (Blocking images)
 *
 * ```ts import.meta.vitest
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const blockImages = Effect.fn("blockImages")(function*(page: Page.Page) {
 *   yield* page.route(
 *     "https://shop.example.com/images/**",
 *     () => Route.abort()
 *   )
 *   yield* page.goto("https://shop.example.com")
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const abort = (reason?: AbortReason | undefined): Effect.Effect<Decision<"request" | "response">> =>
  Effect.succeed(RouteDecision.make({ _tag: "Abort", reason: reason ?? "failed" }))

/**
 * Passes the request to the next matching route, or lets the default decide when there is none.
 *
 * **Example** (Stubbing only the cart's POST requests)
 *
 * ```ts import.meta.vitest
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { HttpServerResponse } from "effect/http"
 *
 * const stubAddToCart = Effect.fn("stubAddToCart")(function*(page: Page.Page) {
 *   yield* page.route(
 *     "https://shop.example.com/api/cart",
 *     ({ request }) =>
 *       request.method === "POST"
 *         ? Route.fulfill(HttpServerResponse.empty())
 *         : Route.fallthrough
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const fallthrough: Effect.Effect<Decision<Phase>> = Effect.succeed(RouteDecision.make({ _tag: "Fallthrough" }))

/**
 * Settings for `fromHar`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FromHarOptions {
  /**
   * What happens to a request that no entry matches: it fails with a network error, or passes to the next
   * matching route.
   *
   * @default "abort"
   */
  readonly notFound?: "abort" | "fallthrough" | undefined
}

/**
 * Reads a recorded HAR and gives a route handler that answers requests from it.
 *
 * **Details**
 *
 * - `path` names a HAR, or the zip `Har.record` writes with `content: "attach"`, told apart by its contents, not
 *   its extension.
 * - An entry matches a request by method and URL, and by body where both have one; the latest match wins.
 * - Its response is fulfilled as recorded, a redirect as a redirect. The body is replayed decoded, so the headers
 *   that describe its encoding or length are dropped, as is a `Set-Cookie` whose value the export redacted.
 * - An entry that failed without a response fails the request.
 * - A request no entry matches is aborted, or falls through with `notFound: "fallthrough"`.
 * - The route's pattern decides which requests the HAR answers.
 *
 * **Gotchas**
 *
 * Bodies are matched only where the HAR has them: an export writes requests' bodies when it includes
 * `"requestBodies"`. A response recorded with `content: "omit"` is replayed with an empty body.
 *
 * **Example** (Answering a page's API calls from a recording)
 *
 * ```ts import.meta.vitest
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const offline = Effect.fn("offline")(function*(page: Page.Page) {
 *   yield* page.route("https://shop.example.com/api/**", yield* Route.fromHar("api.har"))
 *   yield* page.goto("https://shop.example.com/cart")
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const fromHar: (
  path: FilePath.Local | string,
  options?: FromHarOptions | undefined
) => Effect.Effect<Handler<never, never, "request">, Har.HarError, FileSystem.FileSystem> = HarReplay.fromHar

/**
 * Answers an authentication challenge.
 *
 * **Gotchas**
 *
 * - An `auth` route fails with `Unsupported` on WebKit, which answers challenges only from credentials set in
 *   advance (`interception.auth`).
 * - Without an `auth` route, a challenge in a context Strider created gets the server's response, such as its `401`
 *   page, on Chromium and Firefox. On Chromium only a document's does: a `fetch`'s or an image's waits on the
 *   browser's prompt until it times out (`network.challenges`).
 *
 * **Example** (Signing in to a page behind HTTP authentication)
 *
 * ```ts import.meta.vitest
 * import { Page, Route } from "@usestrider/browser"
 * import { Effect, Redacted } from "effect"
 *
 * const openAdmin = Effect.fn("openAdmin")(function*(page: Page.Page) {
 *   yield* page.route(
 *     "https://app.example.com/**",
 *     () =>
 *       Route.provideCredentials({
 *         username: "ada",
 *         password: Redacted.make("hunter2")
 *       }),
 *     { phase: "auth" }
 *   )
 *   yield* page.goto("https://app.example.com/admin")
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const provideCredentials = (credentials: {
  readonly username: string
  readonly password: Redacted.Redacted<string>
}): Effect.Effect<Decision<"auth">> =>
  Effect.succeed(RouteDecision.make({ _tag: "ProvideCredentials", ...credentials }))

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
   *
   * **Example** (Waiting until a stub has answered)
   *
   * ```ts import.meta.vitest
   * import { Page, Route } from "@usestrider/browser"
   * import { Effect } from "effect"
   * import { HttpServerResponse } from "effect/http"
   *
   * const stubProducts = Effect.fn("stubProducts")(function*(page: Page.Page) {
   *   const stub = yield* page.route(
   *     "https://shop.example.com/api/products",
   *     () => Route.fulfill(HttpServerResponse.jsonUnsafe([]))
   *   )
   *   yield* page.goto("https://shop.example.com")
   *   yield* stub.hits.waitFor((hits) => hits > 0)
   * })
   * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
