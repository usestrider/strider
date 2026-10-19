/**
 * Routes and declarations.
 *
 * A route's handler returns the decision, so a paused request is never left hanging: a handler that fails,
 * is interrupted or leaves its scope gets the default decision (continue). Requests and responses are Effect's
 * HTTP types. Handlers compose by precedence: most specific scope first, then priority, then recency.
 * Declarations are scoped registrations and return handles (principle 19).
 */
import type { Effect, Option } from "effect"
import type { HttpClientRequest, HttpClientResponse, HttpServerResponse } from "effect/http"
import type { InitScriptId, LocalPath, NavigableId, NavigationId, RealmId } from "./Brand.ts"
import type { RouteError } from "./Errors.ts"
import type { NetworkRequest } from "./Events.ts"
import type { Watchable } from "./Watchable.ts"

export type ResourceType =
  | "document" | "stylesheet" | "image" | "media" | "font" | "script" | "fetch" | "xhr"
  | "webSocket" | "eventSource" | "manifest" | "ping" | "other"
export type Initiator =
  | { readonly _tag: "Document"; readonly navigable: NavigableId; readonly navigation: Option.Option<NavigationId> }   // None: a subresource
  | { readonly _tag: "Worker"; readonly realm: RealmId }
  | { readonly _tag: "Unattributed" }                   // e.g. a client-less service-worker fetch

declare const RouteDecisionTypeId: unique symbol
export interface RouteDecision { readonly [RouteDecisionTypeId]: "RouteDecision" }

export type RouteHandler<E, R> = (request: InterceptedRequest) => Effect.Effect<RouteDecision, E, R>   // E is logged; the default decision applies
export interface InterceptedRequest {
  readonly request: NetworkRequest                      // fixed: the request as paused at this phase
  readonly phase: "request" | "response" | "auth"       // fixed
  /** Let the browser perform it, then fulfil with a patched response (HttpServerResponse.fromClientResponse). */
  readonly fetch: Effect.Effect<HttpClientResponse.HttpClientResponse, RouteError>
  fetchWith(change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest): Effect.Effect<HttpClientResponse.HttpClientResponse, RouteError>
}
export type AbortReason =
  | "failed" | "aborted" | "timedOut" | "accessDenied" | "connectionClosed" | "connectionReset" | "connectionRefused"
  | "connectionAborted" | "connectionFailed" | "nameNotResolved" | "internetDisconnected" | "addressUnreachable"
  | "blockedByClient" | "blockedByResponse"
export declare const Route: {
  readonly continue: RouteDecision
  /** A change the backend can't apply fails with Unsupported naming the field (CDP: URL, method, headers, body; BiDi adds cookies). */
  continueWith(change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest): RouteDecision
  fulfill(response: HttpServerResponse.HttpServerResponse): RouteDecision
  readonly abort: RouteDecision                         // "failed"
  abortWith(reason: AbortReason): RouteDecision
  readonly fallthrough: RouteDecision                   // the next matching handler
  /** Auth phase only (new in the sketch). */
  provideCredentials(credentials: { readonly username: string; readonly password: import("effect").Redacted.Redacted<string> }): RouteDecision
}

export interface Registration { readonly remove: Effect.Effect<void> }   // idempotent; the scope's finalizer becomes a no-op
export interface RouteRegistration extends Registration { readonly hits: Watchable<number> }
export interface HandlerRegistration extends Registration { readonly handled: Watchable<number> }
export interface InitScript extends Registration { readonly id: InitScriptId }   // also usable in { after: [...] }

export type InitScriptSource =                          // which kind is always stated
  | (() => void)                                        // self-contained; serialized
  | { readonly source: string }
  | { readonly path: LocalPath | string }
export interface InitScriptOptions {
  readonly world?: "main" | "isolated"                  // default "main"
  readonly after?: ReadonlyArray<InitScript>            // dependencies only on equal or broader scope
  readonly timing?: "beforeAuthorScript" | "bestEffort" // default "beforeAuthorScript"; unmet, it fails with Unsupported
}
