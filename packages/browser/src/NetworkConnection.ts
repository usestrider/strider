/**
 * Long-lived connections a page opens: WebSockets and EventSource streams.
 *
 * A connection is reported when it opens. Its frames are a separate subscription, because most tests care
 * that a socket opened and only some care what crossed it.
 *
 * **Gotchas**
 *
 * Frames are a capability: CDP reports them, and BiDi has no equivalent yet, so `frames` fails with
 * `Unsupported` there.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as DateTime from "effect/DateTime"
import type * as Effect from "effect/Effect"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
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
 * import { Deferred, NetworkConnection, Page } from "@usestrider/browser"
 *
 * const watchChat = Effect.fn("watchChat")(function*(page: Page.Page) {
 *   const opened = yield* NetworkConnection.next(page, { kind: "webSocket", url: "wss://chat.example.com/*" })
 *   yield* page.getByRole("button", { name: "Open chat" }).click()
 *   const chat = yield* Deferred.await(opened)
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
   * Waits as long as the connection is open, then gives the reason it ended.
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

/**
 * Subscribes to connections and returns the first match, latched.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<NetworkConnection, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<NetworkConnection, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to connections and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<NetworkConnection, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<NetworkConnection, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the connections a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<NetworkConnection>>
