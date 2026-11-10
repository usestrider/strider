/**
 * Mocks WebSocket connections in a browser context, or lets them reach the real server while a handler watches and
 * changes selected messages.
 *
 * **Details**
 *
 * Browsers offer no way to intercept WebSocket messages, so a route replaces the page's `WebSocket` constructor
 * with a script of its own, and `routeWebSocket` asks for that choice with `implementation: "script"`. A message
 * is at most 1 MiB. A registration serves at most 14 mocked connections, or 7 proxied ones, at a time. Going over
 * a limit closes the connection with an error and an abnormal close, and never drops a message silently.
 *
 * **Gotchas**
 *
 * Page scripts can see and interfere with the replacement. It does not reach sockets opened before the route,
 * constructors a page saved earlier, `WebSocketStream`, or shared and service workers. The events a mocked socket
 * fires are synthetic: native event trust, buffering, compression and wire fragments are not reproduced.
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
export const Initiator = Schema.Union([
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
export type Initiator = typeof Initiator.Type

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
  limit: Schema.Literals(["1 MiB message", "2 MiB or 256 pending host sends", "14 MiB browser reservations"])
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
  state: Schema.Literals(["connecting", "open", "closed", "already opened"])
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
/**
 * The reasons a WebSocket routing operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type WebSocketRouteErrorReason = typeof WebSocketRouteErrorReason.Type
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
 * Settings for closing one side of a connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CloseOptions {
  /**
   * The close code: 1000 or in 3000–4999.
   *
   * @default 1005 as the page sees it, the code of a native close without one
   */
  readonly code?: number | undefined
  /**
   * The close reason, at most 123 UTF-8 bytes.
   *
   * @default ""
   */
  readonly reason?: string | undefined
}
/**
 * Settings for opening a mocked connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OpenOptions {
  /**
   * The subprotocol the page sees as chosen, one of those it requested.
   *
   * @default "" (none chosen)
   */
  readonly protocol?: string | undefined
}
/**
 * One side of a connection that messages and a close can be sent to: the page, or the real server.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Writable {
  /**
   * Sends a message to this side. Text stays text and binary keeps its exact bytes. It fails with `InvalidState`
   * while the connection is not open and with `Overflow` past the limits.
   *
   * **Example** (Greeting the page)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const greet = (page: WebSocketRoute.Writable) =>
   *   page.send({ _tag: "Text", data: "hello" })
   * ```
   */
  send(message: Message): Effect.Effect<void, WebSocketRouteError | Target.TargetGone | Deadline.Timeout>
  /**
   * Closes this side with a code and reason that the page sees in its `close` event, or the real server receives as a
   * native close. A code outside 1000 and 3000–4999, or a reason over 123 UTF-8 bytes, fails with `InvalidInput`.
   *
   * **Example** (Ending the connection with a code)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const end = (page: WebSocketRoute.Writable) =>
   *   page.close({ code: 4001, reason: "session expired" })
   * ```
   */
  close(
    options?: CloseOptions | undefined
  ): Effect.Effect<void, WebSocketRouteError | Target.TargetGone | Deadline.Timeout>
}
/**
 * Both sides of a proxied connection, given to the handlers of `connectToServer`.
 *
 * **Example** (Answering the page without bothering the server)
 *
 * ```ts import.meta.vitest
 * import { WebSocketRoute } from "@usestrider/browser"
 *
 * const answerPings = (
 *   message: WebSocketRoute.Message,
 *   endpoints: WebSocketRoute.Endpoints
 * ) =>
 *   message._tag === "Text" && message.data === "ping"
 *     ? endpoints.page.send({ _tag: "Text", data: "pong" })
 *     : endpoints.server.send(message)
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Endpoints {
  /** The page's socket. Sending here is what the page receives. */
  readonly page: Writable
  /** The real server. Sending here is what the server receives. */
  readonly server: Writable
}
/**
 * Handlers installed before a mock opens. Without `fromPage`, messages from the page are discarded; `reply` sends
 * to the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MockHandlers<E, R> {
  readonly fromPage?: ((message: Message, reply: Writable) => Effect.Effect<void, E, R>) | undefined
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
 * The real server of a proxied connection: send to it or close it, and read the subprotocol it chose.
 *
 * **Example** (Reading the negotiated subprotocol)
 *
 * ```ts import.meta.vitest
 * import { WebSocketRoute } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const chosen = (connection: WebSocketRoute.Connection) =>
 *   connection.connectToServer({}).pipe(Effect.map((server) => server.protocol))
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Server extends Writable {
  /** The subprotocol the server chose, or an empty string when it chose none. */
  readonly protocol: string
}
/**
 * One WebSocket the page constructed that matches a route, handed once to the newest matching registration.
 *
 * **Details**
 *
 * The socket stays connecting until the handler calls `open` or `connectToServer`. If the handler returns without
 * doing either, the page sees an `error` event and then a close with code 1006, as for a server it cannot reach.
 * The handler has the default operation budget (`Deadline.DefaultBudget`, 30 seconds unless set) to decide, and
 * its connection closes the same way if it does not. Work it does after deciding has no deadline and runs until
 * the connection closes.
 *
 * **Gotchas**
 *
 * Later registrations do not take over sockets that already exist.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Connection {
  /**
   * Names this connection in logs and traces.
   *
   * **Example** (Reading it)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const label = (connection: WebSocketRoute.Connection) => `socket ${connection.id}`
   * ```
   */
  readonly id: Id
  /**
   * The URL the page constructed, with `http` and `https` turned into `ws` and `wss`.
   *
   * **Example** (Reading it)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const target = (connection: WebSocketRoute.Connection) => connection.url
   * ```
   */
  readonly url: Url.Url
  /**
   * The subprotocols the page asked for, in its order.
   *
   * **Example** (Reading it)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const wantsChat = (connection: WebSocketRoute.Connection) =>
   *   connection.protocols.includes("chat")
   * ```
   */
  readonly protocols: ReadonlyArray<string>
  /**
   * The JavaScript realm that constructed the socket.
   *
   * **Example** (Reading it)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const where = (connection: WebSocketRoute.Connection) => connection.realm
   * ```
   */
  readonly realm: Target.RealmId
  /**
   * The frame or dedicated worker that constructed the socket.
   *
   * **Example** (Reading it)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const fromWorker = (connection: WebSocketRoute.Connection) =>
   *   connection.initiator._tag === "Worker"
   * ```
   */
  readonly initiator: Initiator
  /**
   * The page's side of the socket, for sending messages to it.
   *
   * **Example** (Pushing a message from a mock)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const push = Effect.fn("push")(function*(connection: WebSocketRoute.Connection) {
   *   yield* connection.open({})
   *   yield* connection.page.send({ _tag: "Text", data: "welcome" })
   * })
   * ```
   */
  readonly page: Writable
  /**
   * Whether the connection is `"connecting"`, `"open"` or `"closed"`. A proxied connection stays connecting until
   * the real server accepts it.
   *
   * **Example** (Waiting for the connection to close)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const state = (connection: WebSocketRoute.Connection) => connection.status
   * ```
   */
  readonly status: Watchable.Watchable<"connecting" | "open" | "closed">
  /**
   * A stream of what happens on the connection: messages in either direction, closes and errors. It only watches;
   * it never changes what is forwarded. It fails with `EventOverflow` if the reader falls too far behind.
   *
   * **Example** (Logging the messages)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   * import { Effect, Stream } from "effect"
   *
   * const log = Effect.fn("log")(function*(connection: WebSocketRoute.Connection) {
   *   const events = yield* connection.events
   *   yield* events.pipe(
   *     Stream.runForEach((event) => Effect.log(event._tag)),
   *     Effect.forkScoped
   *   )
   *   yield* connection.open({})
   * })
   * ```
   */
  readonly events: Effect.Effect<
    Stream.Stream<Event, Subscription.EventOverflow | Target.TargetGone>,
    never,
    Scope.Scope
  >
  /**
   * Answers the page with a mock instead of connecting to the server. It fails with `InvalidState` if the
   * connection was already opened or connected.
   *
   * **Example** (Echoing every message)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   *
   * const echo = (connection: WebSocketRoute.Connection) =>
   *   connection.open({ fromPage: (message, reply) => reply.send(message) })
   * ```
   */
  open<E = never, R = never>(
    handlers: MockHandlers<E, R>,
    options?: OpenOptions | undefined
  ): Effect.Effect<void, WebSocketRouteError | Target.TargetGone | Deadline.Timeout, R>
  /**
   * Connects the page's socket to the real server from inside the page, so cookies, origin and TLS stay the
   * browser's own. Messages are forwarded unchanged unless a handler takes a direction over. It fails with
   * `InvalidState` if the connection was already opened or connected.
   *
   * **Example** (Dropping messages the server must not see)
   *
   * ```ts import.meta.vitest
   * import { WebSocketRoute } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const quiet = (connection: WebSocketRoute.Connection) =>
   *   connection.connectToServer({
   *     fromPage: (message, endpoints) =>
   *       message._tag === "Text" && message.data === "telemetry"
   *         ? Effect.void
   *         : endpoints.server.send(message)
   *   })
   * ```
   */
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
