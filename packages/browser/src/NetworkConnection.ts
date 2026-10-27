/**
 * Long-lived connections a page opens: WebSockets and EventSource streams.
 *
 * A connection is reported when it opens, to its page and context. Its frames are a separate subscription,
 * because most tests care that a socket opened and only some care what crossed it.
 *
 * **Gotchas**
 *
 * Connections are a capability, `networkConnections`. CDP reports both kinds with their frames; patched WebKit
 * reports WebSockets, and an `EventSource` only as its request; BiDi reports a WebSocket's handshake as a
 * request and nothing after it, so subscribing there fails with `Unsupported`, as asking WebKit for
 * `kind: "eventSource"` does.
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
 * **Example** (Watching the first frames of a chat socket)
 *
 * ```ts import.meta.vitest
 * import { Console, Effect, Stream } from "effect"
 * import { NetworkConnection, Page } from "@usestrider/browser"
 *
 * const watchChat = Effect.fn("watchChat")(function*(page: Page.Page) {
 *   const opened = yield* NetworkConnection.next(page, { kind: "webSocket", url: "wss://chat.example.com/*" })
 *   yield* page.getByRole("button", { name: "Open chat" }).click()
 *   const chat = yield* opened
 *   const frames = yield* chat.frames
 *   yield* frames.pipe(Stream.take(3), Stream.runForEach((frame) => Console.log(frame.direction)))
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NetworkConnection extends Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  readonly id: Id
  /**
   * Which kind of connection; fixed at open.
   */
  readonly kind: Kind
  /**
   * The URL it connected to; fixed at open.
   */
  readonly url: Url.Url
  /**
   * When it opened, in wall-clock time; fixed at open.
   */
  readonly openedAt: DateTime.Utc
  /**
   * Frames from now on; subscribed when this returns.
   */
  readonly frames: Effect.Effect<
    Stream.Stream<Frame, Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope
  >
  /**
   * Waits as long as the connection is open, then gives the reason it ended: `NetworkConnectionClosed` when the
   * page or the server closed it.
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
 * Subscribes to connections and returns the first match, latched.
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
 * Reads the connections a log retained; never waits.
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
