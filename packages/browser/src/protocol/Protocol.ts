/**
 * The protocol layer's client contract (L0): commands and events as data, the session they run on, and the
 * errors a session reports.
 *
 * Generated modules (`@usestrider/browser/cdp`) declare each command and event with `command` and `event`:
 * a method name, codecs and traits, and no behavior. Behavior lives in the session, so a change to how
 * commands are sent never needs a regeneration. A command is a yieldable value: `yield* Page.navigate({ url })`
 * runs on the `ProtocolSession` in context, and `Protocol.on(session)` picks one explicitly.
 *
 * **Gotchas**
 *
 * This is the raw protocol, for power users. Nothing here tracks state, waits for readiness or classifies
 * failures beyond the protocol's own; the API in `@usestrider/browser` does that.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"

/**
 * What the spec says about a command or event, plus our own annotations.
 *
 * **Details**
 *
 * - `status`: the spec's stability.
 * - `session`: `"browser"` for commands sent on the browser session rather than a target's.
 * - `compensation`: what must be undone if the caller is interrupted after the command was sent, such as
 *   releasing held input.
 * - `createsResource`: the reply hands out something with a remote lifetime, so a late reply is routed to an
 *   owner that adopts or releases it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Traits {
  readonly status: "stable" | "experimental" | "deprecated"
  readonly session?: "browser" | "target" | undefined
  readonly compensation?: string | undefined
  readonly createsResource?: true | undefined
  readonly redirect?: string | undefined
}

/**
 * The arguments a command takes: none, optional parameters, or required ones.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type CommandArgs<P> = [P] extends [void] ? [] : {} extends P ? [params?: P] : [params: P]

/**
 * A command, ready to run on a session: an effect, plus the method and parameters it sends.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Command<M extends string, P, A> extends Effect.Effect<A, ProtocolError, ProtocolSession> {
  readonly method: M
  readonly params: P
  /**
   * The definition this command came from, whose codecs the session encodes and decodes with.
   */
  readonly definition: CommandDef<M, P, A>
}

/**
 * A command's definition: call it with parameters to get a `Command`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CommandDef<M extends string, P, A> {
  (...args: CommandArgs<P>): Command<M, P, A>
  readonly method: M
  /**
   * The parameters' codec, or `undefined` for a command that takes none.
   */
  readonly Params: Schema.Codec<P, unknown> | undefined
  /**
   * The result's codec, or `undefined` for a command that returns nothing.
   */
  readonly Result: Schema.Codec<A, unknown> | undefined
  readonly traits: Traits
}

/**
 * An event's definition: its method and the codec of its parameters.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EventDef<M extends string, A> {
  readonly method: M
  /**
   * The parameters' codec, or `undefined` for an event that carries none.
   */
  readonly Params: Schema.Codec<A, unknown> | undefined
  readonly traits: Traits
}

/**
 * Declares a command. Generated modules call this; it does nothing until the command runs.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const command = <M extends string, P, A>(
  method: M,
  Params: Schema.Codec<P, unknown> | undefined,
  Result: Schema.Codec<A, unknown> | undefined,
  traits: Traits
): CommandDef<M, P, A> => {
  const make = (...args: ReadonlyArray<unknown>): Command<M, P, A> => {
    const self: Command<M, P, A> = Object.assign(
      Effect.flatMap(Effect.service(ProtocolSession), (session) => session.send(self)),
      { method, params: args[0] as P, definition }
    )
    return self
  }
  const definition = Object.assign(make, { method, Params, Result, traits }) as CommandDef<M, P, A>
  return definition
}

/**
 * Declares an event. Generated modules call this.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const event = <M extends string, A>(
  method: M,
  Params: Schema.Codec<A, unknown> | undefined,
  traits: Traits
): EventDef<M, A> => ({ method, Params, traits })

/**
 * Schema for the key that routes messages to a session: a CDP `sessionId`, a BiDi routing key, a WebKit
 * target id.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SessionKey = Schema.String.pipe(Schema.brand("~@usestrider/browser/protocol/Protocol/SessionKey"))

/**
 * The key that routes messages to a session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SessionKey = typeof SessionKey.Type

/**
 * Settings for a subscription.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SubscribeOptions {
  /**
   * `"lossless"` keeps every event until it is read; `{ sliding }` keeps only the newest `sliding` events and
   * drops older unread ones.
   *
   * @default "lossless"
   */
  readonly buffer?: "lossless" | { readonly sliding: number } | undefined
}

/**
 * One protocol session: a browser's, or one target's.
 *
 * **Details**
 *
 * Commands sent on a session reply in any order; events arrive in order, per session only. A subscription is
 * live by the time `subscribe` returns, so code order is subscription order.
 *
 * A session ends when the browser detaches it, when its parent session ends, or when the connection is lost.
 * Then pending commands fail and subscriptions end, both with `SessionEnded`.
 *
 * @stability experimental
 * @category services
 * @since 0.1.0
 */
export interface ProtocolSession {
  /**
   * The key the protocol routes this session's messages by, or `undefined` for the browser's own session.
   */
  readonly key: SessionKey | undefined
  /**
   * Sends a command and waits for its reply. Interrupting the caller abandons the reply; it never cancels the
   * command, which no protocol can do.
   */
  send<M extends string, P, A>(command: Command<M, P, A>): Effect.Effect<A, ProtocolError>
  /**
   * Subscribes to an event; live by the time this returns. Each event's parameters are decoded as the stream
   * is read, so one that doesn't match its codec fails this stream with `Decode` and no other.
   */
  subscribe<M extends string, A>(
    event: EventDef<M, A>,
    options?: SubscribeOptions | undefined
  ): Effect.Effect<Stream.Stream<A, ProtocolError>, never, Scope.Scope>
  /**
   * Waits as long as the session lives, then gives the reason it ended.
   */
  readonly ended: Effect.Effect<SessionEnded>
}

/**
 * The service tag for `ProtocolSession`.
 *
 * @stability experimental
 * @category tags
 * @since 0.1.0
 */
export const ProtocolSession: Context.Service<ProtocolSession, ProtocolSession> = Context.Service(
  "@usestrider/browser/protocol/Protocol/ProtocolSession"
)

/**
 * Runs a command on a given session instead of the one in context.
 *
 * @stability experimental
 * @category combinators
 * @since 0.1.0
 */
export const on: {
  (session: ProtocolSession): <M extends string, P, A>(command: Command<M, P, A>) => Effect.Effect<A, ProtocolError>
  <M extends string, P, A>(command: Command<M, P, A>, session: ProtocolSession): Effect.Effect<A, ProtocolError>
} = dual(
  2,
  <M extends string, P, A>(command: Command<M, P, A>, session: ProtocolSession): Effect.Effect<A, ProtocolError> =>
    Effect.provideService(command, ProtocolSession, session)
)

/**
 * Why the browser rejected a command, normalized across backends.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RejectReason = "NoSuchTarget" | "NoSuchFrame" | "NoSuchNode" | "InvalidArgument" | "Unrecognized"

/**
 * Reason for a command the browser rejected.
 *
 * **Details**
 *
 * Each backend's error matcher table maps the reply onto `reason`; a reply that nothing matches is
 * `Unrecognized`, never a guess. `code` and `message` are the browser's, sanitized and kept as evidence.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class Rejected extends Schema.Error<Rejected>("@usestrider/browser/protocol/Protocol/Rejected")({
  _tag: Schema.tag("Rejected"),
  method: Schema.String,
  reason: Schema.Literals(["NoSuchTarget", "NoSuchFrame", "NoSuchNode", "InvalidArgument", "Unrecognized"]),
  code: Schema.Union([Schema.Number, Schema.String]),
  description: Schema.String
}) {
  override get message(): string {
    return `${this.method} rejected: ${this.reason} (${this.description})`
  }
}

/**
 * Reason for a reply or event that didn't match its codec.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class Decode extends Schema.Error<Decode>("@usestrider/browser/protocol/Protocol/Decode")({
  _tag: Schema.tag("Decode"),
  method: Schema.String,
  issue: Schema.String
}) {
  override get message(): string {
    return `${this.method} didn't decode: ${this.issue}`
  }
}

/**
 * Reason for a command whose parameters didn't match their codec, so it was never sent.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class Encode extends Schema.Error<Encode>("@usestrider/browser/protocol/Protocol/Encode")({
  _tag: Schema.tag("Encode"),
  method: Schema.String,
  issue: Schema.String
}) {
  override get message(): string {
    return `${this.method}'s parameters didn't encode: ${this.issue}`
  }
}

/**
 * Reason for a session that ended before the reply arrived.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class SessionEnded extends Schema.Error<SessionEnded>("@usestrider/browser/protocol/Protocol/SessionEnded")({
  _tag: Schema.tag("SessionEnded"),
  why: Schema.Literals(["detached", "targetDestroyed", "connectionLost", "swapped"])
}) {
  override get message(): string {
    return `The session ended: ${this.why}`
  }
}

/**
 * Reason for a command the connected browser doesn't implement.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class Unsupported extends Schema.Error<Unsupported>("@usestrider/browser/protocol/Protocol/Unsupported")({
  _tag: Schema.tag("Unsupported"),
  method: Schema.String
}) {
  override get message(): string {
    return `${this.method} is unsupported`
  }
}

const ProtocolErrorTypeId = "~@usestrider/browser/protocol/Protocol/ProtocolError"

/**
 * Error for a command or subscription that failed at the protocol level.
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class ProtocolError extends Schema.TaggedError<ProtocolError>(ProtocolErrorTypeId)("ProtocolError", {
  reason: Schema.Union([Rejected, Encode, Decode, SessionEnded, Unsupported])
}) {
  readonly [ProtocolErrorTypeId] = ProtocolErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `ProtocolError`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isProtocolError = (u: unknown): u is ProtocolError => Predicate.hasProperty(u, ProtocolErrorTypeId)
