/**
 * The raw protocol client: commands and events as data, the session they run on, and the errors a session
 * reports.
 *
 * The generated modules (`@usestrider/browser/cdp`, `/bidi-protocol`, `/webkit-stock-protocol`, and
 * `/webkit-automation-protocol`) declare each command and event with `command` and `event`: a method name, codecs,
 * and traits, and no behavior. Behavior lives in the session. A command is a yieldable value:
 * `yield* Page.navigate({ url })` runs on the `ProtocolSession` in context, and `Protocol.on(session)` picks one
 * explicitly.
 *
 * **Gotchas**
 *
 * This is the raw protocol, for power users. Nothing here tracks state, waits for readiness, or classifies
 * failures beyond the protocol's own; the API in `@usestrider/browser` does that.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"

/**
 * What the spec says about a command or event, plus Strider's own annotations.
 *
 * **Details**
 *
 * - `status`: the spec's stability.
 * - `session`: `"browser"` for commands sent on the browser session rather than a target's.
 * - `compensation`: what must be undone if the caller is interrupted after the command was sent, such as
 *   releasing held input.
 * - `createsResource`: the reply hands out something with a remote lifetime, so a late reply goes to
 *   `CurrentLateReplyHandler`, which adopts or releases it.
 * - `release`: the commands that release what the reply hands out, each taking one parameter from the
 *   result. `from` is a JSON pointer into the result as sent, where `*` stands for every element of a list.
 * - `redirect`: the domain the spec points to for this command instead, such as `Overlay` for
 *   `DOM.hideHighlight`.
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
  readonly release?: ReadonlyArray<Release> | undefined
  readonly redirect?: string | undefined
}

/**
 * One command that releases a resource a reply handed out: `method`, with `param` taken from the result at
 * the JSON pointer `from`, or a list of it when `list` is set.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Release {
  readonly method: string
  readonly param: string
  readonly from: string
  /** Maps non-overlapping parameter pointers to singular reply pointers, without wildcards. A missing source skips this release. */
  readonly paramsFrom?: Readonly<Record<string, string>> | undefined
  readonly list?: true | undefined
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
 * **Example** (Running a command on the session in context)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const product = Effect.fn("product")(function*(session: Protocol.ProtocolSession) {
 *   const version = yield* Browser.getVersion().pipe(
 *     Effect.provideService(Protocol.ProtocolSession, session)
 *   )
 *   return version.product
 * })
 * ```
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
 * Declares a command from its method, codecs, and traits; nothing is sent until the command runs. The generated
 * modules call it.
 *
 * **Example** (Declaring a command by hand)
 *
 * ```ts import.meta.vitest
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Schema } from "effect"
 *
 * const getWindowForTarget = Protocol.command(
 *   "Browser.getWindowForTarget",
 *   Schema.Struct({ targetId: Schema.optional(Schema.String) }),
 *   Schema.Struct({ windowId: Schema.Int }),
 *   { status: "experimental", session: "browser" }
 * )
 * ```
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
 * Declares an event from its method, codec, and traits. The generated modules call it.
 *
 * **Example** (Declaring an event by hand)
 *
 * ```ts import.meta.vitest
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Schema } from "effect"
 *
 * const visibilityChanged = Protocol.event(
 *   "Page.screencastVisibilityChanged",
 *   Schema.Struct({ visible: Schema.Boolean }),
 *   { status: "experimental" }
 * )
 * ```
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
 * Schema for the key that routes messages to a session: a CDP `sessionId`, or, on WebKit, the page proxy, target,
 * and worker ids on the session's path.
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
 * A filter on an event's parameters, as data: the values some of its fields must equal, nested as the parameters
 * are. It's applied before an event is buffered, so excluded events take no buffer space.
 *
 * **Example** (Following one frame's navigations)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser/cdp"
 * import type { Protocol } from "@usestrider/browser/protocol"
 * import { Effect, Stream } from "effect"
 *
 * const navigations = Effect.fn("navigations")(
 *   function*(page: Protocol.ProtocolSession, frameId: Page.FrameId) {
 *     const navigated = yield* page.subscribe(Page.frameNavigated, {
 *       prefilter: { frame: { id: frameId } }
 *     })
 *     return yield* navigated.pipe(Stream.take(1), Stream.runCollect)
 *   }
 * )
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Prefilter<A> = A extends ReadonlyArray<unknown> ? never : {
  readonly [K in keyof A]?: NonNullable<A[K]> extends string | number | boolean ? A[K]
    : Prefilter<NonNullable<A[K]>>
}

/**
 * Settings for a subscription that keeps every event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SubscribeOptions<A> {
  /**
   * Keeps up to `lossless` unread events. One more fails the subscription with `EventOverflow`; nothing is
   * dropped silently.
   *
   * @default { lossless: 10_000 }
   */
  readonly buffer?: { readonly lossless: number } | undefined
  /**
   * Only events whose parameters match.
   *
   * @default every event
   */
  readonly prefilter?: Prefilter<A> | undefined
}

/**
 * Settings for a subscription that keeps only the newest events, and marks where it dropped older ones with a
 * `Gap`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SlidingOptions<A> {
  /**
   * Keeps the newest `sliding` unread events; older ones are dropped, and a `Gap` takes their place.
   */
  readonly buffer: { readonly sliding: number }
  /**
   * Only events whose parameters match.
   *
   * @default every event
   */
  readonly prefilter?: Prefilter<A> | undefined
}

/**
 * Where a sliding subscription dropped events, and how many.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class Gap extends Schema.TaggedClass<Gap>("@usestrider/browser/protocol/Protocol/Gap")("Gap", {
  dropped: Schema.Int
}) {}

/**
 * Checks whether an element of a sliding subscription is a `Gap`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isGap = (u: unknown): u is Gap => u instanceof Gap

/**
 * A reply that arrived after its caller stopped waiting, to a command that hands out something with a remote
 * lifetime.
 *
 * **Details**
 *
 * `result` is the reply as sent, not decoded. `release` sends the command's release commands (its `release`
 * trait) on the same session and ignores their failures; for a command with none, it does nothing.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LateReply {
  readonly session: ProtocolSession
  readonly method: string
  readonly params: unknown
  readonly result: unknown
  readonly release: Effect.Effect<void>
}

/**
 * One protocol session: a browser's, or one target's.
 *
 * **Details**
 *
 * Commands sent on a session reply in any order; events arrive in order, per session only. A subscription is
 * live by the time `subscribe` returns, so code order is subscription order, and it sees only events received
 * after that.
 *
 * A session ends when the browser detaches it, when its parent session ends, or when the connection is lost.
 * Then pending commands fail at once, and subscriptions end with `SessionEnded` after the events received
 * before the end.
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
   * Sends a command and waits for its reply, for at most `CommandTimeout`, or until the deadline of the operation of
   * `@usestrider/browser` it is sent in. Interrupting the caller, or running
   * out of time, abandons the reply; it never cancels the command, which no protocol can do. A late reply to
   * a command that creates a resource goes to `CurrentLateReplyHandler`.
   *
   * **Example** (Reading a page's title)
   *
   * ```ts import.meta.vitest
   * import { Runtime } from "@usestrider/browser/cdp"
   * import type { Protocol } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const title = Effect.fn("title")(function*(page: Protocol.ProtocolSession) {
   *   const { result } = yield* page.send(
   *     Runtime.evaluate({ expression: "document.title", returnByValue: true })
   *   )
   *   return String(result.value)
   * })
   * ```
   */
  send<M extends string, P, A>(command: Command<M, P, A>): Effect.Effect<A, ProtocolError>
  /**
   * Subscribes to an event, keeping only the newest events; live by the time this returns. A `Gap` marks
   * where older events were dropped.
   *
   * **Example** (Logging console calls without falling behind)
   *
   * ```ts import.meta.vitest
   * import { Runtime } from "@usestrider/browser/cdp"
   * import { Protocol } from "@usestrider/browser/protocol"
   * import { Effect, Stream } from "effect"
   *
   * const logConsole = Effect.fn("logConsole")(function*(page: Protocol.ProtocolSession) {
   *   const calls = yield* page.subscribe(Runtime.consoleAPICalled, {
   *     buffer: { sliding: 100 }
   *   })
   *   yield* calls.pipe(
   *     Stream.runForEach((call) =>
   *       Protocol.isGap(call)
   *         ? Effect.logWarning(`${call.dropped} calls dropped`)
   *         : Effect.log(call.type)
   *     ),
   *     Effect.forkScoped
   *   )
   * })
   * ```
   */
  subscribe<M extends string, A>(
    event: EventDef<M, A>,
    options: SlidingOptions<A>
  ): Effect.Effect<Stream.Stream<A | Gap, ProtocolError>, never, Scope.Scope>
  /**
   * Subscribes to an event; live by the time this returns. Each event's parameters are decoded as the stream
   * is read, so one that doesn't match its codec fails this stream with `Decode` and no other.
   *
   * **Example** (Waiting for a reload's `load` event)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser/cdp"
   * import { Protocol } from "@usestrider/browser/protocol"
   * import { Effect, Stream } from "effect"
   *
   * const reload = Effect.fn("reload")(function*(page: Protocol.ProtocolSession) {
   *   const loads = yield* page.subscribe(Page.loadEventFired)
   *   yield* Page.reload().pipe(Protocol.on(page))
   *   return yield* Stream.runHead(loads)
   * })
   * ```
   */
  subscribe<M extends string, A>(
    event: EventDef<M, A>,
    options?: SubscribeOptions<A> | undefined
  ): Effect.Effect<Stream.Stream<A, ProtocolError>, never, Scope.Scope>
  /**
   * Waits until every event this session received before the call has been processed: applied to Strider's
   * model of the browser, where there is one, and published to subscriptions.
   *
   * **Gotchas**
   *
   * It's a local barrier, not proof that everything a command caused has arrived: an event the browser
   * hasn't sent yet isn't waited for.
   *
   * **Example** (Publishing the events received before a checkpoint)
   *
   * ```ts import.meta.vitest
   * import { Runtime } from "@usestrider/browser/cdp"
   * import { Protocol } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const checkpoint = Effect.fn("checkpoint")(function*(page: Protocol.ProtocolSession) {
   *   yield* Runtime.evaluate({ expression: "console.log('checkpoint')" }).pipe(
   *     Protocol.on(page)
   *   )
   *   // Every event received before this point is now in each subscription's buffer
   *   yield* page.drainObserved
   * })
   * ```
   */
  readonly drainObserved: Effect.Effect<void>
  /**
   * Waits as long as the session lives, then gives the reason it ended.
   *
   * **Example** (Logging why a session ended)
   *
   * ```ts import.meta.vitest
   * import type { Protocol } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const watch = Effect.fn("watch")(function*(page: Protocol.ProtocolSession) {
   *   const ended = yield* page.ended
   *   yield* Effect.logInfo(`The page's session ended: ${ended.why}`)
   * })
   * ```
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
export const ProtocolSession: Context.Service<ProtocolSession, ProtocolSession> = Context.Service<ProtocolSession>(
  "@usestrider/browser/protocol/Protocol/ProtocolSession"
)

/**
 * Runs a command on a given session instead of the one in context.
 *
 * **Example** (Navigating a target's session)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const navigate = Effect.fn("navigate")(function*(page: Protocol.ProtocolSession) {
 *   return yield* Page.navigate({ url: "https://shop.example.com" }).pipe(
 *     Protocol.on(page)
 *   )
 * })
 * ```
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
 * Reference to how long a command waits for its reply before failing with `NoReply`; 30 seconds unless set.
 *
 * **Details**
 *
 * It applies to the commands sent here and outside an operation of `@usestrider/browser`, such as its cleanup.
 * Inside an operation, the operation's deadline replaces it: each command waits for its reply until the deadline.
 * It runs on the live clock, as the browser does, so `TestClock` never moves it. `Duration.infinity` waits until
 * the reply arrives or the session ends.
 *
 * @stability experimental
 * @category references
 * @since 0.1.0
 */
export const CommandTimeout: Context.Reference<Duration.Duration> = Context.Reference(
  "@usestrider/browser/protocol/Protocol/CommandTimeout",
  { defaultValue: () => Duration.seconds(30) }
)

/**
 * Sets how long the commands an effect sends wait for their replies.
 *
 * **Example** (Giving a slow evaluation more time)
 *
 * ```ts import.meta.vitest
 * import { Runtime } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 *
 * const settle = Runtime.evaluate({
 *   expression: "new Promise((r) => setTimeout(r, 60_000))",
 *   awaitPromise: true
 * })
 *   .pipe(Protocol.withCommandTimeout("2 minutes"))
 * ```
 *
 * @stability experimental
 * @category combinators
 * @since 0.1.0
 */
export const withCommandTimeout: {
  (timeout: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, timeout: Duration.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, timeout: Duration.Input): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CommandTimeout, Duration.fromInputUnsafe(timeout))
)

/**
 * How results and event parameters are checked: `"decode"` runs each through its codec; `"trust"` skips the
 * codecs that would only check, and still runs those that transform, such as a sensitive value becoming
 * `Redacted`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Validation = "decode" | "trust"

/**
 * Reference to how results and event parameters are checked; `"decode"` unless set.
 *
 * **Details**
 *
 * `"trust"` is for hot paths you have measured. A payload that drifted from the spec then arrives typed as if
 * it hadn't, so a failure shows up later and further from its cause. Provide it for a whole program with
 * `Layer.succeed(Protocol.CurrentValidation, "trust")`, or for one effect with `withValidation`.
 *
 * @stability experimental
 * @category references
 * @since 0.1.0
 */
export const CurrentValidation: Context.Reference<Validation> = Context.Reference(
  "@usestrider/browser/protocol/Protocol/CurrentValidation",
  { defaultValue: (): Validation => "decode" }
)

/**
 * Sets how the results and event parameters an effect reads are checked.
 *
 * **Example** (Skipping the checks on a large snapshot)
 *
 * ```ts import.meta.vitest
 * import { DOMSnapshot } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 *
 * const snapshot = DOMSnapshot.captureSnapshot({ computedStyles: [] }).pipe(
 *   Protocol.withValidation("trust")
 * )
 * ```
 *
 * @stability experimental
 * @category combinators
 * @since 0.1.0
 */
export const withValidation: {
  (validation: Validation): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, validation: Validation): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, validation: Validation): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CurrentValidation, validation)
)

/**
 * Reference to what happens to a late reply that hands out a resource; unless set, the resource is released.
 *
 * **Details**
 *
 * For a command whose `createsResource` trait is set, the session keeps waiting for the reply after its caller
 * is interrupted or times out. When the reply arrives, the handler in the caller's context at send time
 * receives it, in a fiber of its own; the default runs `release`.
 *
 * @stability experimental
 * @category references
 * @since 0.1.0
 */
export const CurrentLateReplyHandler: Context.Reference<(reply: LateReply) => Effect.Effect<void>> = Context
  .Reference("@usestrider/browser/protocol/Protocol/CurrentLateReplyHandler", {
    defaultValue: () => (reply: LateReply) => reply.release
  })

/**
 * Sets what happens to late replies that hand out resources, for the commands an effect sends.
 *
 * **Example** (Recording a page created too late)
 *
 * ```ts import.meta.vitest
 * import { Target } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const open = Target.createTarget({ url: "about:blank" }).pipe(
 *   Effect.timeout("5 seconds"),
 *   Protocol.withLateReplyHandler((late) =>
 *     Effect.logWarning(`${late.method} replied after its caller gave up`).pipe(
 *       Effect.andThen(late.release)
 *     )
 *   )
 * )
 * ```
 *
 * @stability experimental
 * @category combinators
 * @since 0.1.0
 */
export const withLateReplyHandler: {
  (
    handler: (reply: LateReply) => Effect.Effect<void>
  ): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, handler: (reply: LateReply) => Effect.Effect<void>): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, handler: (reply: LateReply) => Effect.Effect<void>): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CurrentLateReplyHandler, handler)
)

/**
 * Why the browser rejected a command, normalized across backends.
 *
 * **Details**
 *
 * - `NoSuchTarget`: the target, window or browsing context the command named doesn't exist.
 * - `NoSuchFrame`: the frame the command named doesn't exist.
 * - `NoSuchNode`: the DOM node the command named doesn't exist.
 * - `NoSuchObject`: the browser no longer holds the JavaScript object the command named. On WebKit this means the
 *   page context the object was made in was discarded, as when the page navigates; that reply can arrive before
 *   the event that announces the navigation. WebKit also gives it for an object id that isn't one it made, so a
 *   malformed id gets it too.
 * - `InvalidArgument`: the command's parameters were refused.
 * - `Unrecognized`: a rejection the backend's error table doesn't know, never a guess.
 *
 * **Example** (Telling a discarded object from other rejections)
 *
 * ```ts import.meta.vitest
 * import { Protocol } from "@usestrider/browser/protocol"
 *
 * const discarded = (reason: Protocol.RejectReason) => reason === "NoSuchObject"
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RejectReason =
  | "NoSuchTarget"
  | "NoSuchFrame"
  | "NoSuchNode"
  | "NoSuchObject"
  | "InvalidArgument"
  | "Unrecognized"

/**
 * Reason for a command the browser rejected.
 *
 * **Details**
 *
 * Each backend's error table maps the reply onto `reason`; a reply that nothing matches is `Unrecognized`,
 * never a guess. `code` and `description` are the browser's own code and message, as it sent them.
 *
 * `target` names the kind of target the command was sent to, on CDP: `page`, `iframe`, `worker`,
 * `service_worker`, `shared_worker`, or `other`. It is absent for a command sent to the browser's own session,
 * and on the other backends.
 *
 * **Example** (Reading why a command was rejected)
 *
 * ```ts import.meta.vitest
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const objectGone = Effect.fn("objectGone")(
 *   function*(command: Protocol.Command<string, unknown, unknown>) {
 *     const error = yield* Effect.flip(command)
 *     return error.reason._tag === "Rejected" && error.reason.reason === "NoSuchObject"
 *   }
 * )
 * ```
 *
 * **Example** (Saying where a command was refused)
 *
 * ```ts import.meta.vitest
 * import { Emulation } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const clear = (session: Protocol.ProtocolSession) =>
 *   Emulation.clearDeviceMetricsOverride().pipe(
 *     Protocol.on(session),
 *     Effect.catchReason(
 *       "ProtocolError",
 *       "Rejected",
 *       (rejected) =>
 *         Effect.logWarning(
 *           `refused on ${rejected.target ?? "the browser"}: ${rejected.description}`
 *         )
 *     )
 *   )
 * ```
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class Rejected extends Schema.Error<Rejected>("@usestrider/browser/protocol/Protocol/Rejected")({
  _tag: Schema.tag("Rejected"),
  method: Schema.String,
  reason: Schema.Literals([
    "NoSuchTarget",
    "NoSuchFrame",
    "NoSuchNode",
    "NoSuchObject",
    "InvalidArgument",
    "Unrecognized"
  ]),
  code: Schema.Union([Schema.Number, Schema.String]),
  description: Schema.String,
  target: Schema.optional(Schema.String)
}) {
  override get message(): string {
    return `${this.method} rejected${
      this.target === undefined ? "" : ` on the ${this.target} target`
    }: ${this.reason} (${this.description})`
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
 * Reason for a session that ended, which fails the commands still waiting for replies and ends its
 * subscriptions.
 *
 * **Details**
 *
 * `why` is `detached` when the browser detached the session or no longer knows it, `targetDestroyed` when its
 * target went away, `connectionLost` when the connection ended, `swapped` when the target moved to a new
 * session, and `modelUnavailable` when the session's events could no longer be followed and a fresh snapshot of
 * its state couldn't be taken.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class SessionEnded extends Schema.Error<SessionEnded>("@usestrider/browser/protocol/Protocol/SessionEnded")({
  _tag: Schema.tag("SessionEnded"),
  why: Schema.Literals(["detached", "targetDestroyed", "connectionLost", "swapped", "modelUnavailable"])
}) {
  override get message(): string {
    return `The session ended: ${this.why}`
  }
}

/**
 * Reason for a command that got no reply within `CommandTimeout`.
 *
 * **Details**
 *
 * The command may still run: no protocol can cancel one. A late reply is dropped, or, for a command that
 * creates a resource, handed to `CurrentLateReplyHandler`.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class NoReply extends Schema.Error<NoReply>("@usestrider/browser/protocol/Protocol/NoReply")({
  _tag: Schema.tag("NoReply"),
  method: Schema.String,
  timeout: Schema.Duration
}) {
  override get message(): string {
    return `${this.method} got no reply within ${Duration.format(this.timeout)}`
  }
}

/**
 * Reason for a subscription that fell further behind than its buffer allows.
 *
 * **Details**
 *
 * A subscription that keeps every event fails rather than drop one. `capacity` is its buffer's size; read
 * faster, filter with a `prefilter`, or subscribe with a larger buffer.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class EventOverflow extends Schema.Error<EventOverflow>("@usestrider/browser/protocol/Protocol/EventOverflow")({
  _tag: Schema.tag("EventOverflow"),
  method: Schema.String,
  capacity: Schema.Int
}) {
  override get message(): string {
    return `The subscription to ${this.method} fell more than ${this.capacity} events behind`
  }
}

/**
 * Reason for a command, or an argument of one, that the connected browser doesn't implement.
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
 * **Example** (Reading a page that may have closed)
 *
 * ```ts import.meta.vitest
 * import { Runtime } from "@usestrider/browser/cdp"
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect, Option } from "effect"
 *
 * const titleIfOpen = Effect.fn("titleIfOpen")(function*(page: Protocol.ProtocolSession) {
 *   return yield* Runtime.evaluate({ expression: "document.title", returnByValue: true })
 *     .pipe(
 *       Protocol.on(page),
 *       Effect.map(({ result }) => Option.some(String(result.value))),
 *       Effect.catchReason("ProtocolError", "SessionEnded", () => Effect.succeedNone)
 *     )
 * })
 * ```
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class ProtocolError extends Schema.TaggedError<ProtocolError>(ProtocolErrorTypeId)("ProtocolError", {
  reason: Schema.Union([Rejected, Encode, Decode, SessionEnded, Unsupported, NoReply, EventOverflow])
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
