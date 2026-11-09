/**
 * Scoped JavaScript WebSocket mocks and proxies. These replace the main-world constructor only in an opted-in
 * context; they do not intercept native network frames. Saved constructors, shared/service workers and
 * WebSocketStream are outside the shim. Events are synthetic, and native buffering, compression and trusted-event
 * identity are not emulated. Mock traffic is separate from NetworkConnection's native observations.
 *
 * Admission ceilings are 1 MiB per message, 256 messages or 4 MiB per direction, 16 MiB of issued reservations
 * and payload per registration, and 1024 admitted connections. Credits are assigned on demand before opening.
 * Unused issued credit counts, so a realm can overflow while capacity is reserved elsewhere. These are not
 * guaranteed usable queue capacities or bounds on process memory, encoded copies or native browser buffers.
 * Each connection receives fixed 1 MiB credits per browser direction. A realm allows 16 pending constructors;
 * the registration allows 4096 pending host envelopes, each at most 2 MiB of JSON text. A connection allows
 * 256 concurrent host sends. CDP buffers at most 64 envelopes per target while its realm is being announced.
 * Matched URLs are at most 8192 characters; at most 128 requested subprotocols
 * have at most 8192 aggregate UTF-8 bytes. Control-envelope overload fails that realm closed; other transport
 * overflow closes the affected connection. Tokens and generations prevent stale releases from granting credit.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * Schema for a routed connection's identity across realms and registrations.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/WebSocketRoute/Id"))
/**
 * A routed connection's identity.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

/**
 * Schema for the page/frame or dedicated worker that constructed a routed connection.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Origin = Schema.Union([
  Schema.TaggedStruct("Frame", { page: Target.NavigableId, frame: Target.NavigableId }),
  Schema.TaggedStruct("Worker", { realm: Target.RealmId })
])
/**
 * The owner of the originating JavaScript realm.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Origin = typeof Origin.Type

/**
 * Application message data, preserving the distinction between text and binary.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Message = Schema.Union([
  Schema.TaggedStruct("Text", { data: Schema.String }),
  Schema.TaggedStruct("Binary", { data: Schema.Uint8Array })
])
/**
 * One application message, rather than a protocol fragment or control frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Message = typeof Message.Type

/**
 * Failure to admit a message or connection within its documented ceiling.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class Overflow extends Schema.Error<Overflow>("@usestrider/browser/WebSocketRoute/Overflow")({
  _tag: Schema.tag("Overflow"),
  limit: Schema.String
}) {
  override get message(): string {
    return `WebSocket routing admission exceeded ${this.limit}`
  }
}
/**
 * Failure to use a connection in its current state.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class InvalidState extends Schema.Error<InvalidState>("@usestrider/browser/WebSocketRoute/InvalidState")({
  _tag: Schema.tag("InvalidState"),
  state: Schema.String
}) {
  override get message(): string {
    return `WebSocket connection is ${this.state}`
  }
}
/**
 * Schema for a WebSocket routing failure.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebSocketRouteErrorReason = Schema.Union([
  Overflow,
  InvalidState,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])
const ErrorTypeId = "~@usestrider/browser/WebSocketRoute/WebSocketRouteError"

/**
 * Error for registration or an operation on a routed connection.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class WebSocketRouteError extends Schema.TaggedError<WebSocketRouteError>(
  "@usestrider/browser/WebSocketRoute/WebSocketRouteError"
)("WebSocketRouteError", { reason: WebSocketRouteErrorReason, diagnostics: Diagnostics.Diagnostics }) {
  readonly [ErrorTypeId] = ErrorTypeId
  override get message(): string {
    return this.reason.message
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}
/**
 * Checks whether a value is a WebSocket routing error.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isWebSocketRouteError = (value: unknown): value is WebSocketRouteError =>
  Predicate.hasProperty(value, ErrorTypeId)

/**
 * A message, error or close observed on one routed connection. Synthetic closes remain distinct from native closes.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Event = Schema.Union([
  Schema.TaggedStruct("Message", { direction: Schema.Literals(["page", "server"]), message: Message }),
  Schema.TaggedStruct("Closed", {
    direction: Schema.Literals(["page", "server"]),
    code: Schema.Number,
    reason: Schema.String,
    wasClean: Schema.Boolean,
    provenance: Schema.Literals(["native", "synthetic"])
  }),
  Schema.TaggedStruct("Error", { message: Schema.String })
])
/**
 * An observation that never changes forwarding.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Event = typeof Event.Type
/**
 * An endpoint that receives the messages and close operations sent to it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Writable {
  send(message: Message): Effect.Effect<void, WebSocketRouteError | Target.TargetGone | Deadline.Timeout>
  /** Native codes are omitted, 1000 or 3000–4999; a reason is at most 123 UTF-8 bytes. */
  close(
    options?: { readonly code?: number | undefined; readonly reason?: string | undefined } | undefined
  ): Effect.Effect<void, WebSocketRouteError | Target.TargetGone | Deadline.Timeout>
}
/**
 * Both destinations of a proxied connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Endpoints {
  readonly page: Writable
  readonly server: Writable
}
/**
 * Handlers installed before a mock opens. An absent handler discards page messages.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MockHandlers<E, R> {
  readonly fromPage?: ((message: Message, page: Writable) => Effect.Effect<void, E, R>) | undefined
}
/**
 * Handlers installed before connecting to the server. An absent handler forwards that direction; a provided
 * handler sends explicitly or drops by returning without sending. Observing events never changes this choice.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProxyHandlers<E, R> {
  readonly fromPage?: ((message: Message, endpoints: Endpoints) => Effect.Effect<void, E, R>) | undefined
  readonly fromServer?: ((message: Message, endpoints: Endpoints) => Effect.Effect<void, E, R>) | undefined
}
/**
 * The real browser's server endpoint and negotiated protocol.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Server extends Writable {
  readonly protocol: string
}
/**
 * A connection selected once at construction. The newest matching registration wins.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Connection {
  readonly id: Id
  readonly url: Url.Url
  readonly protocols: ReadonlyArray<string>
  readonly realm: Target.RealmId
  readonly origin: Origin
  readonly page: Writable
  readonly status: Watchable.Watchable<"connecting" | "open" | "closed">
  readonly events: Effect.Effect<
    Stream.Stream<Event, Subscription.EventOverflow | Target.TargetGone>,
    never,
    Scope.Scope
  >
  open<E = never, R = never>(
    handlers: MockHandlers<E, R>,
    options?: { readonly protocol?: string | undefined } | undefined
  ): Effect.Effect<void, WebSocketRouteError | Target.TargetGone | Deadline.Timeout, R>
  connectToServer<E = never, R = never>(
    handlers: ProxyHandlers<E, R>
  ): Effect.Effect<Server, WebSocketRouteError | Target.TargetGone | Deadline.Timeout, R>
}
/**
 * The registration removed early or with its owning scope, closing only its own routed connections.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Registration extends Declaration.Registration {}
/**
 * Explicit script consent and coverage of a registration.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  readonly implementation: "script"
  /**
   * Includes dedicated workers started after registration, where supported.
   *
   * @default false
   */
  readonly workers?: boolean | undefined
  /**
   * Whether future documents must be armed before author scripts. WebKit and attached Chromium require bestEffort.
   *
   * @default "beforeAuthorScript"
   */
  readonly timing?: "beforeAuthorScript" | "bestEffort" | undefined
}
