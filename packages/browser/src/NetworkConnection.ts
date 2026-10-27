/**
 * The WebSockets and event sources a page opens: connections that stay open and carry messages.
 *
 * A connection is reported to its page and context when it opens. Its frames are a separate subscription, the
 * connection's `frames`.
 *
 * **Gotchas**
 *
 * Connections are a capability, `networkConnections`:
 *
 * - CDP reports both kinds, with their frames.
 * - WebKit reports WebSockets, and an `EventSource` only as its request, so `kind: "eventSource"` fails with
 *   `Unsupported` there.
 * - BiDi reports a WebSocket's handshake as a request and nothing after it, so subscribing fails with
 *   `Unsupported`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
import type * as Runtime from "./internal/runtime.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for the id of a connection.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/NetworkConnection/Id"))

/**
 * Id of a connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

/**
 * Which kind of connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Kind = "webSocket" | "eventSource"

/**
 * One message that crossed a connection.
 *
 * **Example** (Reading a frame's payload)
 *
 * ```ts import.meta.vitest
 * import { NetworkConnection } from "@usestrider/browser"
 *
 * const describe = (frame: NetworkConnection.Frame) =>
 *   frame.payload._tag === "Text"
 *     ? frame.payload.text
 *     : `${frame.payload.bytes.length} bytes`
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Frame extends Schema.Class<Frame>("@usestrider/browser/NetworkConnection/Frame")({
  direction: Schema.Literals(["sent", "received"]),
  payload: Schema.Union([
    Schema.TaggedStruct("Text", { text: Schema.String }),
    Schema.TaggedStruct("Binary", { bytes: Schema.Uint8Array })
  ]),
  at: MonotonicInstant.MonotonicInstant
}) {}

const TypeId = "~@usestrider/browser/NetworkConnection"

/**
 * A WebSocket or EventSource connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NetworkConnection extends Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  readonly id: Id
  /**
   * Which kind of connection it is.
   */
  readonly kind: Kind
  /**
   * The URL it connected to.
   */
  readonly url: Url.Url
  /**
   * When it opened, in wall-clock time.
   */
  readonly openedAt: DateTime.Utc
  /**
   * Subscribes to the frames that cross the connection, and gives a stream of every one from then on.
   *
   * **Example** (Watching the first frames of a chat socket)
   *
   * ```ts import.meta.vitest
   * import { NetworkConnection, Page } from "@usestrider/browser"
   * import { Console, Effect, Stream } from "effect"
   *
   * const watchChat = Effect.fn("watchChat")(function*(page: Page.Page) {
   *   const opened = yield* NetworkConnection.next(page, {
   *     kind: "webSocket",
   *     url: "wss://chat.example.com/*"
   *   })
   *   yield* page.getByRole("button", { name: "Open chat" }).click()
   *   const chat = yield* opened
   *   const frames = yield* chat.frames
   *   yield* frames.pipe(
   *     Stream.take(3),
   *     Stream.runForEach((frame) => Console.log(frame.direction))
   *   )
   * })
   * ```
   */
  readonly frames: Effect.Effect<
    Stream.Stream<Frame, Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope
  >
  /**
   * Waits as long as the connection is open, then gives the reason it ended: `NetworkConnectionClosed` when the
   * page or the server closed it.
   *
   * **Example** (Checking that leaving a chat closes its socket)
   *
   * ```ts import.meta.vitest
   * import { NetworkConnection, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const leaveChat = Effect.fn("leaveChat")(
   *   function*(page: Page.Page, chat: NetworkConnection.NetworkConnection) {
   *     yield* page.getByRole("button", { name: "Leave chat" }).click()
   *     const reason = yield* chat.closed
   *     return reason._tag === "NetworkConnectionClosed"
   *   }
   * )
   * ```
   */
  readonly closed: Effect.Effect<Target.CloseReason>
}

/**
 * Checks whether a value is a `NetworkConnection`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isNetworkConnection = (u: unknown): u is NetworkConnection => Predicate.hasProperty(u, TypeId)

/**
 * Which connections to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match connections to URLs matching this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
  /**
   * Match connections of this kind.
   *
   * @default either kind
   */
  readonly kind?: Kind | undefined
}

// ── Implementation ──

const kind = (
  runtime: Runtime.Runtime,
  operation: string
): Events.Kind<Model.ConnectionEntry, NetworkConnection> => ({
  operation,
  noun: "a connection",
  deliver: (entry) => runtime.connection(entry)
})

const subscription = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: Filter | undefined,
  operation: string
) =>
  Effect.suspend(() => {
    const found = Handles.target(target)
    const runtime = found.behind.runtime
    const wanted = filter?.kind
    return Filters.requires(runtime, operation, "networkConnections").pipe(
      Effect.andThen(
        wanted === "eventSource" ? Filters.requires(runtime, operation, "networkConnections.eventSource") : Effect.void
      ),
      Effect.andThen(Filters.url(operation, filter?.url)),
      Effect.map((matches) => ({
        kind: kind(runtime, operation),
        channel: found.behind.entry.events.connection,
        accepts: (entry: Events.Entry<Model.ConnectionEntry>) =>
          Filters.urlMatches(matches, entry.value.url) && (wanted === undefined || entry.value.kind === wanted)
      }))
    )
  })

/**
 * Subscribes to connections and returns the wait: an effect whose value is the first match, the same each time it
 * runs.
 *
 * **Example** (Waiting for a product page's live stock updates)
 *
 * ```ts import.meta.vitest
 * import { NetworkConnection, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openProduct = Effect.fn("openProduct")(function*(page: Page.Page) {
 *   const opened = yield* NetworkConnection.next(page, {
 *     kind: "eventSource",
 *     url: "https://shop.example.com/api/**"
 *   })
 *   yield* page.goto("https://shop.example.com/products/boots")
 *   const updates = yield* opened
 *   return updates.url
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<NetworkConnection, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<NetworkConnection, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkConnection.next"),
    ({ accepts, channel, kind }) => Events.next(kind, channel, accepts, where)
  ).pipe(Operation.named("NetworkConnection.next"))

/**
 * Subscribes to connections and emits every match from now on.
 *
 * **Example** (Logging every WebSocket a page opens)
 *
 * ```ts import.meta.vitest
 * import { NetworkConnection, Page } from "@usestrider/browser"
 * import { Console, Effect, Stream } from "effect"
 *
 * const logSockets = Effect.fn("logSockets")(function*(page: Page.ObservedPage) {
 *   const sockets = yield* NetworkConnection.stream(page, { kind: "webSocket" })
 *   yield* sockets.pipe(
 *     Stream.runForEach((socket) => Console.log(socket.url)),
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
  where?: Subscription.Where<NetworkConnection, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<NetworkConnection, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkConnection.stream"),
    ({ accepts, channel, kind }) => Events.stream(kind, channel, accepts, where)
  )

/**
 * Reads the connections the target's event log kept (`UserContext.Options.eventLog`); never waits.
 *
 * **Example** (Listing the sockets a page has opened)
 *
 * ```ts import.meta.vitest
 * import { NetworkConnection, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openedSockets = Effect.fn("openedSockets")(function*(page: Page.ObservedPage) {
 *   const history = yield* NetworkConnection.history(page, { kind: "webSocket" })
 *   return history.entries.map((socket) => socket.url)
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
): Effect.Effect<Subscription.History<NetworkConnection>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "NetworkConnection.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )
