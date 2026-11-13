/**
 * The protocol client every backend shares (PROTOCOL.md, Protocol client and Ingestion pipeline). A backend
 * supplies its `Wire`: the envelope, the session lifecycle its events announce, and its error matchers. An
 * adapter may supply a `Fold`, which keeps a model of each session up to date.
 *
 * ```
 * transport ─► reader ─► inbox ─► worker: fold, then publish ─► subscriber buffers ─► subscriber fibers
 *              (envelope, receive sequence, replies, session lifecycle)
 * ```
 *
 * - **The reader** (here) is synchronous and never waits on a consumer. It numbers every message it receives,
 *   resolves replies, applies the session lifecycle, and queues events. A message it can't parse ends the
 *   connection.
 * - **The inbox and the worker** (`ingestion.ts`) fold each event, holding a session's events until it is synced
 *   and watching each session's limits, then publish it to the subscriber buffers (`subscriberBuffer.ts`).
 * - **Decoding** of results and event parameters happens in the fiber that asked for them, so a payload that
 *   doesn't match its codec fails that caller or subscriber, not the connection.
 *
 * This module keeps what the reader needs: the pending commands it correlates replies with, and the tree of
 * sessions the lifecycle attaches and ends.
 */
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Protocol from "../protocol/Protocol.ts"
import * as Transport from "../protocol/Transport.ts"
import { ConnectionLost } from "../protocol/Transport.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Ingestion from "./ingestion.ts"
import { type Subscriber, SubscriberBuffer } from "./subscriberBuffer.ts"
import * as Tracing from "./tracing.ts"

/** An error reply, as the browser sent it. */
export interface WireError {
  readonly code: number | string
  readonly message: string
}

/** One decoded envelope. */
export type Incoming =
  | { readonly _tag: "Reply"; readonly id: number; readonly result: unknown }
  | { readonly _tag: "ErrorReply"; readonly id: number; readonly error: WireError }
  | {
    readonly _tag: "Event"
    readonly key: Protocol.SessionKey | undefined
    readonly method: string
    readonly params: unknown
  }
  /** An envelope that carries nothing for the client, such as the reply to a wrapper around a command. */
  | { readonly _tag: "Ignore" }

/** What an error reply becomes. Tables map onto these tags and never add one. */
export type Classification =
  | { readonly _tag: "Unsupported" }
  | { readonly _tag: "SessionEnded"; readonly why: Protocol.SessionEnded["why"] }
  | { readonly _tag: "Rejected"; readonly reason: Protocol.RejectReason }

/**
 * One row of a backend's error table. Every field of `match` must match; the most specific row wins, one point
 * per field, and ties go to table order. `evidence` names the probe or recorded reply behind the row.
 */
export interface ErrorMatcher {
  readonly match: {
    readonly code?: number | string
    readonly message?: string | { readonly includes: string }
  }
  readonly becomes: Classification
  readonly evidence: string
}

/** The session lifecycle a backend's events announce, applied by the reader before the event is queued. */
export interface Lifecycle {
  readonly attached: (key: Protocol.SessionKey, parent: Protocol.SessionKey | undefined) => void
  readonly ended: (key: Protocol.SessionKey, why: Protocol.SessionEnded["why"]) => void
}

/** What a backend supplies. */
export interface Wire {
  readonly encode: (id: number, method: string, params: unknown, key: Protocol.SessionKey | undefined) => string
  /**
   * Decodes an envelope, or fails with what is wrong with it. A malformed envelope ends the connection, since
   * nothing after it can be trusted to be in step.
   */
  readonly decode: (message: string) => Result.Result<Incoming, string>
  readonly lifecycle: (event: Extract<Incoming, { _tag: "Event" }>, sessions: Lifecycle) => void
  readonly errors: ReadonlyArray<ErrorMatcher>
}

/** Whether a value is a JSON object. */
export const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u)

/** Parses a message that must be a JSON object, as every wire's envelope is. */
export const parseRecord = (message: string): Result.Result<Record<string, unknown>, string> => {
  let envelope: unknown
  try {
    envelope = JSON.parse(message)
  } catch (cause) {
    return Result.fail(cause instanceof Error ? cause.message : String(cause))
  }
  return isRecord(envelope) ? Result.succeed(envelope) : Result.fail("the envelope isn't an object")
}

/** The most a session may have queued for the worker before its model is unavailable. */
export interface Limits {
  readonly events: number
  /** Bytes of message text, as UTF-8. */
  readonly bytes: number
}

/** 10,000 events or 256 MiB per session. */
export const defaultLimits: Limits = { events: 10_000, bytes: 256 * 1024 * 1024 }

/**
 * The deadline of the operation a command is sent in, which replaces `Protocol.CommandTimeout` for it
 * (`boundedAdapter.ts`): the command waits for its reply until then, on the live clock, and then fails with
 * `NoReply`. A command in a region that can't be interrupted ends at the deadline too.
 */
export const CommandDeadline: Context.Reference<Option.Option<MonotonicInstant.MonotonicInstant>> = Context.Reference(
  "@usestrider/browser/internal/ProtocolClient/CommandDeadline",
  { defaultValue: () => Option.none() }
)

/** Why a session's model can't be trusted any more. */
export type IntegrityFailure =
  | { readonly _tag: "Undecodable"; readonly method: string; readonly issue: string }
  | { readonly _tag: "Overloaded"; readonly events: number; readonly bytes: number }

/** A session, as the client's own users see it: the public session, plus the receive sequence of replies. */
export interface Session extends Protocol.ProtocolSession {
  /** Sends a command, and also returns the receive sequence number of its reply. */
  readonly sendSequenced: <M extends string, P, A>(
    command: Protocol.Command<M, P, A>
  ) => Effect.Effect<{ readonly result: A; readonly received: number }, Protocol.ProtocolError>
  /** Writes one command now; its reply is awaited separately, and abandoned when the supplied scope closes. */
  readonly start: <M extends string, P, A>(
    command: Protocol.Command<M, P, A>,
    scope: Scope.Scope
  ) => Effect.Effect<
    Effect.Effect<{ readonly result: A; readonly received: number }, Protocol.ProtocolError>,
    Protocol.ProtocolError
  >
  /**
   * Writes the commands to the transport in order as one step, which interruption doesn't split, then waits for every
   * reply together. A failure or interruption then stops waiting; what was written can't be taken back.
   * `onWritten` runs synchronously after every transport write succeeds, before restoring interruption for replies.
   */
  readonly sendOrdered: <M extends string, P>(
    commands: ReadonlyArray<Protocol.Command<M, P, void>>,
    onWritten?: (() => void) | undefined
  ) => Effect.Effect<void, Protocol.ProtocolError>
}

/** A session's snapshot: what it installs into the model, and how far into the session's events it reaches. */
export interface Synced {
  /** The receive sequence number up to which the snapshot accounts for events; later ones are folded on top. */
  readonly through: number
  /** Installs the snapshot into the model, in the worker, before the held events are folded. */
  readonly apply: Effect.Effect<void>
}

/** What a fold may do to the client's sessions. */
export interface FoldControl {
  /**
   * Syncs a session. `sync` runs in a fiber of its own while the session's events are held; once it succeeds,
   * its snapshot is applied in the worker and the held events after it are folded. A sync that fails ends the
   * session with `modelUnavailable`. `live` selects events the snapshot does not represent, whose decisions must
   * be folded while syncing so the browser can produce the snapshot. They are never replayed.
   */
  readonly sync: (
    session: Session,
    sync: Effect.Effect<Synced, unknown>,
    live?: (method: string) => boolean
  ) => void
  readonly session: (key: Protocol.SessionKey) => Session | undefined
  /**
   * Runs an effect in the worker, after every event received so far, and waits for it: for what an operation
   * learns from a reply rather than an event, so that it reaches the model in order. If the connection ends
   * first, the effect doesn't run.
   */
  readonly run: (effect: Effect.Effect<void>) => Effect.Effect<void>
}

/**
 * An adapter's model of each session, kept up to date by the worker. State-changing hooks run in the worker,
 * in receive order, and must never wait on a command, a subscriber or user code. Event scopes also run in the reader.
 */
export interface Fold {
  /** The events the fold needs, by method. Each is decoded before it is folded. */
  readonly events: ReadonlyMap<string, Protocol.EventDef<string, any>>
  /**
   * Optional per-method session scopes, checked before queueing and before fold decoding.
   * A scoped-out event is still published to explicitly registered protocol subscribers.
   * Predicates run synchronously in the reader as well as the worker; they must only inspect state.
   */
  readonly eventScopes?: ReadonlyMap<string, (session: Session) => boolean> | undefined
  /** Folds one event, before it is published. */
  readonly apply: (session: Session, method: string, params: unknown, received: number) => Effect.Effect<void>
  /**
   * The session's model can't be trusted any more: wake whatever waits on it, and sync the session again.
   * Until it is synced, its events are held.
   */
  readonly lost: (session: Session, failure: IntegrityFailure) => Effect.Effect<void>
  /** The session ended, after every event received before the end was folded and published. */
  readonly ended: (session: Session, reason: Protocol.SessionEnded) => Effect.Effect<void>
}

/** Settings for a client. */
export interface Options {
  /** Internal timer seam: omitted clients retain the live browser clock and timers. */
  readonly replyClock?: Clock.Clock | undefined
  /**
   * The fold, given the client's control. Every session the lifecycle attaches is held until the fold syncs
   * it, so the fold must sync each one, if only with an empty snapshot.
   */
  readonly fold?: ((control: FoldControl) => Fold) | undefined
  /** @default defaultLimits */
  readonly limits?: Limits | undefined
}

/** The client: the root session, the sessions the lifecycle has attached, and the connection's end. */
export interface Client {
  readonly root: Session
  readonly session: (key: Protocol.SessionKey) => Session | undefined
  /** The sessions attached under a session and not yet ended, oldest first. */
  readonly children: (session: Session) => ReadonlyArray<Session>
  readonly closed: Effect.Effect<ConnectionLost>
}

/**
 * Finds the row of a table that matches an error reply: every field of a row must match, the most specific row
 * wins (one point per field), and ties go to table order.
 */
export const match = (table: ReadonlyArray<ErrorMatcher>, error: WireError): ErrorMatcher | undefined => {
  let best: ErrorMatcher | undefined
  let bestScore = -1
  for (const row of table) {
    let score = 0
    if (row.match.code !== undefined) {
      if (row.match.code !== error.code) continue
      score++
    }
    if (row.match.message !== undefined) {
      const expected = row.match.message
      if (typeof expected === "string" ? expected !== error.message : !error.message.includes(expected.includes)) {
        continue
      }
      score++
    }
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  return best
}

const targetKinds = new WeakMap<Protocol.ProtocolSession, string>()

/** Records the kind of target a session drives (`page`, `iframe`, `worker`), which its rejected commands then name. */
export const setTargetKind = (session: Protocol.ProtocolSession, kind: string): void => {
  targetKinds.set(session, kind)
}

/**
 * Classifies an error reply with a table. A reply that no row matches is `Rejected{Unrecognized}`, never a
 * guess.
 */
export const classify = (
  table: ReadonlyArray<ErrorMatcher>,
  method: string,
  error: WireError,
  target?: string | undefined
): Protocol.Rejected | Protocol.Unsupported | Protocol.SessionEnded => {
  const becomes: Classification = match(table, error)?.becomes ?? { _tag: "Rejected", reason: "Unrecognized" }
  switch (becomes._tag) {
    case "Unsupported":
      return new Protocol.Unsupported({ method })
    case "SessionEnded":
      return new Protocol.SessionEnded({ why: becomes.why })
    case "Rejected":
      return new Protocol.Rejected({
        method,
        reason: becomes.reason,
        code: error.code,
        description: error.message,
        ...(target === undefined ? {} : { target })
      })
  }
}

// ── Decoding ──────────────────────────────────────────────────────────────────────────────────────────────

const checksOnlyCache = new WeakMap<SchemaAST.AST, boolean>()

/**
 * Whether decoding with a schema only checks values and never changes one, so `"trust"` may skip it. A
 * transformation anywhere, such as `RedactedFromValue`, or a declaration, such as a class, needs decoding.
 */
export const checksOnly = (ast: SchemaAST.AST): boolean => {
  const cached = checksOnlyCache.get(ast)
  if (cached !== undefined) return cached
  // Provisional, so that a cycle through a suspended schema terminates
  checksOnlyCache.set(ast, true)
  let result = ast.encoding === undefined
  if (result) {
    switch (ast._tag) {
      case "Declaration":
        result = false
        break
      case "Objects":
        result = ast.propertySignatures.every((property) => checksOnly(property.type)) &&
          ast.indexSignatures.every((index) => checksOnly(index.type))
        break
      case "Arrays":
        result = ast.elements.every(checksOnly) && ast.rest.every(checksOnly)
        break
      case "Union":
        result = ast.types.every(checksOnly)
        break
      case "Suspend":
        result = checksOnly(ast.thunk())
        break
    }
  }
  checksOnlyCache.set(ast, result)
  return result
}

const failure = (reason: Protocol.ProtocolError["reason"]) => new Protocol.ProtocolError({ reason })

const decoder = <A>(
  codec: Schema.Codec<A, unknown>,
  method: string,
  validation: Protocol.Validation
): (input: unknown) => Effect.Effect<A, Protocol.ProtocolError> => {
  if (validation === "trust" && checksOnly(codec.ast)) return (input) => Effect.succeed(input as A)
  const decode = Schema.decodeUnknownEffect(codec)
  return (input) =>
    decode(input).pipe(Effect.mapError((error) => failure(new Protocol.Decode({ method, issue: error.message }))))
}

/** The values at a JSON pointer, where `*` stands for every element of a list. */
export const valuesAt = (value: unknown, pointer: string): ReadonlyArray<unknown> => {
  let current: ReadonlyArray<unknown> = [value]
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~")
    const next: Array<unknown> = []
    for (const item of current) {
      if (segment === "*") {
        if (Array.isArray(item)) next.push(...item)
      } else if (typeof item === "object" && item !== null && segment in item) {
        next.push((item as Record<string, unknown>)[segment])
      }
    }
    current = next
  }
  return current.filter((item) => item !== undefined)
}

// ── The client ────────────────────────────────────────────────────────────────────────────────────────────

/** Internal receipt hook: called synchronously before reply decoding or event folding. */
export const ReplyReceived = Context.Reference<((received: number) => void) | undefined>(
  "strider/internal/ReplyReceived",
  {
    defaultValue: () => undefined
  }
)

/** Synchronous command outcome, including replies whose waiter was abandoned. Resource owners use this
 * before the waiting fiber can consume a reply or be interrupted. It does not imply result decoding succeeded. */
export const ReplyOutcome = Context.Reference<((outcome: "success" | "failure" | "sessionEnded") => void) | undefined>(
  "strider/internal/ReplyOutcome",
  { defaultValue: () => undefined }
)

interface Pending {
  readonly id: number
  readonly session: SessionState
  readonly method: string
  readonly params: unknown
  readonly release: ReadonlyArray<Protocol.Release>
  readonly reply: Deferred.Deferred<unknown, Protocol.ProtocolError>
  /** The receive sequence number of the reply. */
  received: number
  onReceipt?: ((received: number) => void) | undefined
  onOutcome?: ((outcome: "success" | "failure" | "sessionEnded") => void) | undefined
  replied: boolean
  raw: unknown
  /** Set once the caller stopped waiting on a command that creates a resource. */
  late: ((reply: Protocol.LateReply) => Effect.Effect<void>) | undefined
}

/** A reply and a failing transport write can race; an owner observes only the first terminal outcome. */
const settle = (entry: Pending, outcome: "success" | "failure" | "sessionEnded"): void => {
  const notify = entry.onOutcome
  entry.onOutcome = undefined
  notify?.(outcome)
}

interface SessionState {
  readonly key: Protocol.SessionKey | undefined
  readonly parent: SessionState | undefined
  readonly children: Set<SessionState>
  readonly pending: Set<Pending>
  /** Set when the session ends: sends fail from then on. */
  endedWith: Protocol.SessionEnded | undefined
  readonly handle: Session
  readonly ingest: Ingestion.Ingest
}

/**
 * Starts a client on a transport. The reader and the worker run in the scope; closing the scope stops them
 * and ends every session.
 */
export const make: (
  transport: Transport.Transport,
  wire: Wire,
  options?: Options
) => Effect.Effect<Client, never, Scope.Scope> = Effect.fnUntraced(function*(
  transport: Transport.Transport,
  wire: Wire,
  options?: Options
) {
  const replyClock = options?.replyClock
  const replyBrowserClock = replyClock === undefined ? BrowserClock.live : BrowserClock.fromClock(replyClock)
  const validation = yield* Protocol.CurrentValidation
  const pending = new Map<number, Pending>()
  const sessions = new Map<Protocol.SessionKey, SessionState>()
  const run = yield* FiberSet.makeRuntime()
  const states = new WeakMap<Session, SessionState>()
  let nextId = 1
  let received = 0
  let lost: ConnectionLost | undefined
  const closed = yield* Deferred.make<ConnectionLost>()

  const ingestion = yield* Ingestion.make({
    fold: options?.fold,
    limits: options?.limits ?? defaultLimits,
    decoder: (codec, method) => decoder(codec, method, validation),
    session: (key) => sessions.get(key)?.handle,
    end: (session, why) => {
      const state = states.get(session)
      if (state !== undefined) end(state, why)
    },
    lost: () => lost !== undefined
  })

  // ── Ending sessions ──

  const end = (state: SessionState, why: Protocol.SessionEnded["why"]): void => {
    if (state.endedWith !== undefined) return
    const reason = new Protocol.SessionEnded({ why })
    state.endedWith = reason
    if (state.key !== undefined && sessions.get(state.key) === state) sessions.delete(state.key)
    state.parent?.children.delete(state)
    for (const child of state.children) end(child, why)
    for (const entry of state.pending) {
      pending.delete(entry.id)
      settle(entry, "sessionEnded")
      if (entry.late === undefined) Deferred.doneUnsafe(entry.reply, Effect.fail(failure(reason)))
    }
    state.pending.clear()
    ingestion.end(state.ingest, reason, received)
  }

  const loseConnection = (reason: ConnectionLost): void => {
    if (lost !== undefined) return
    lost = reason
    end(root, "connectionLost")
    Deferred.doneUnsafe(closed, Effect.succeed(reason))
  }

  // ── Commands ──

  const register = (
    state: SessionState,
    method: string,
    params: unknown,
    release: ReadonlyArray<Protocol.Release>
  ): Pending => {
    const entry: Pending = {
      id: nextId++,
      session: state,
      method,
      params,
      release,
      reply: Deferred.makeUnsafe(),
      received: 0,
      replied: false,
      raw: undefined,
      late: undefined
    }
    pending.set(entry.id, entry)
    state.pending.add(entry)
    return entry
  }

  const unregister = (entry: Pending): void => {
    pending.delete(entry.id)
    entry.session.pending.delete(entry)
  }

  // Sends without codecs, for release commands built from a raw reply.
  const sendRaw = (
    state: SessionState,
    method: string,
    params: unknown
  ): Effect.Effect<unknown, Protocol.ProtocolError> =>
    Effect.suspend(() => {
      if (state.endedWith !== undefined) return Effect.fail(failure(state.endedWith))
      const entry = register(state, method, params, [])
      return transport.send(wire.encode(entry.id, method, params, state.key)).pipe(
        Effect.catch(() => Effect.fail(failure(new Protocol.SessionEnded({ why: "connectionLost" })))),
        Effect.andThen(Deferred.await(entry.reply)),
        Effect.ensuring(Effect.sync(() => unregister(entry)))
      )
    })

  const runLate = (entry: Pending, handler: (reply: Protocol.LateReply) => Effect.Effect<void>): void => {
    const state = entry.session
    const release = Effect.suspend(() =>
      Effect.forEach(
        entry.release.flatMap((release) =>
          valuesAt(entry.raw, release.from).map((value) => {
            const params: Record<string, unknown> = { [release.param]: release.list === true ? [value] : value }
            for (const [pointer, from] of Object.entries(release.paramsFrom ?? {})) {
              const values = valuesAt(entry.raw, from)
              if (values.length !== 1) return undefined
              const keys = pointer.slice(1).split("/").map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"))
              let target = params
              for (const key of keys.slice(0, -1)) {
                target = (target[key] ??= {}) as Record<string, unknown>
              }
              target[keys[keys.length - 1]!] = values[0]
            }
            return [release.method, params] as const
          })
        ),
        (command) => command === undefined ? Effect.void : Effect.ignore(sendRaw(state, command[0], command[1])),
        { discard: true }
      )
    )
    run(handler({ session: state.handle, method: entry.method, params: entry.params, result: entry.raw, release }))
  }

  /** A registered command: writing it, the wait for its reply, and giving up on that reply. */
  const prepare = Effect.fnUntraced(function*<M extends string, P, A>(
    state: SessionState,
    command: Protocol.Command<M, P, A>
  ) {
    const { method, params, definition } = command
    if (state.endedWith !== undefined) return yield* Effect.fail(failure(state.endedWith))
    // A command whose parameters are all optional may be called with none, and then sends none.
    const encoded = definition.Params === undefined || params === undefined
      ? undefined
      : yield* Schema.encodeUnknownEffect(definition.Params)(params).pipe(
        Effect.mapError((error) => failure(new Protocol.Encode({ method, issue: error.message })))
      )
    const deadline = yield* CommandDeadline
    const timeout = Option.isSome(deadline)
      ? Duration.millis(BrowserClock.millisLeft(replyBrowserClock, deadline.value))
      : yield* Protocol.CommandTimeout
    const onLate = definition.traits.createsResource === true ? yield* Protocol.CurrentLateReplyHandler : undefined
    const decode = definition.Result === undefined
      ? undefined
      : decoder(definition.Result, method, yield* Protocol.CurrentValidation)
    const onOutcome = yield* ReplyOutcome
    const entry = register(state, method, encoded, definition.traits.release ?? [])
    entry.onOutcome = onOutcome
    entry.onReceipt = yield* ReplyReceived
    let consumed = false
    // The caller stopped waiting. A reply still to come is dropped, or handed to the late-reply handler; one
    // that arrived but wasn't consumed goes straight to the handler.
    const abandon = Effect.sync(() => {
      if (consumed) return
      if (pending.get(entry.id) === entry) {
        if (onLate === undefined) unregister(entry)
        else entry.late = onLate
      } else if (onLate !== undefined && entry.replied) {
        runLate(entry, onLate)
      }
    })
    // The browser clock rechecks the monotonic deadline when a timer fires early.
    const awaited = Duration.isFinite(timeout)
      ? Deferred.await(entry.reply).pipe(
        BrowserClock.timeoutOn(replyBrowserClock, Duration.toMillis(timeout)),
        Effect.flatMap((reply) =>
          Option.isSome(reply)
            ? Effect.succeed(reply.value)
            : Effect.andThen(abandon, Effect.fail(failure(new Protocol.NoReply({ method, timeout }))))
        )
      )
      : Deferred.await(entry.reply)
    const tracing = yield* Tracing.TraceProtocolCommands
    return {
      write: transport.send(wire.encode(entry.id, method, encoded, state.key)).pipe(
        Effect.catch(() =>
          Effect.andThen(
            Effect.sync(() => {
              unregister(entry)
              settle(entry, "failure")
            }),
            Effect.fail(failure(new Protocol.SessionEnded({ why: "connectionLost" })))
          )
        )
      ),
      reply: awaited.pipe(
        Effect.flatMap((raw) => decode === undefined ? Effect.succeed(undefined as A) : decode(raw)),
        Effect.map((result) => {
          consumed = true
          return { result, received: entry.received }
        })
      ),
      abandon,
      // `Browser.TraceProtocolCommands`: each command its own span, under the operation that sent it.
      traced: <B, E, R>(exchange: Effect.Effect<B, E, R>) =>
        tracing
          ? Effect.withSpan(exchange, method, {
            attributes: { "browser.protocol.method": method, "browser.protocol.id": entry.id }
          })
          : exchange
    }
  })

  const send = Effect.fnUntraced(function*<M extends string, P, A>(
    state: SessionState,
    command: Protocol.Command<M, P, A>
  ) {
    const { abandon, reply, traced, write } = yield* prepare(state, command)
    return yield* traced(write.pipe(Effect.andThen(reply), Effect.onInterrupt(() => abandon)))
  })

  const start = <M extends string, P, A>(state: SessionState, command: Protocol.Command<M, P, A>, scope: Scope.Scope) =>
    Effect.uninterruptible(Effect.gen(function*() {
      const prepared = yield* prepare(state, command)
      yield* Scope.addFinalizer(scope, prepared.abandon)
      yield* prepared.write
      return prepared.traced(prepared.reply)
    }))

  const sendOrdered = <M extends string, P>(
    state: SessionState,
    commands: ReadonlyArray<Protocol.Command<M, P, void>>,
    onWritten?: (() => void) | undefined
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        const started: Array<{
          readonly abandon: Effect.Effect<void>
          readonly reply: Effect.Effect<unknown, Protocol.ProtocolError>
          readonly traced: <B, E, R>(exchange: Effect.Effect<B, E, R>) => Effect.Effect<B, E, R>
        }> = []
        return Effect.forEach(commands, (command) =>
          Effect.flatMap(prepare(state, command), (prepared) => {
            started.push(prepared)
            return prepared.write
          }), { discard: true }).pipe(
            Effect.andThen(Effect.sync(() => onWritten?.())),
            Effect.andThen(restore(
              Effect.forEach(started, ({ reply, traced }) => traced(reply), { concurrency: "unbounded", discard: true })
            )),
            Effect.onError(() => Effect.forEach(started, ({ abandon }) => abandon, { discard: true }))
          )
      })
    )

  // ── Subscriptions ──

  const subscribe = Effect.fnUntraced(function*<M extends string, A>(
    state: SessionState,
    event: Protocol.EventDef<M, A>,
    options?: Protocol.SubscribeOptions<A> | Protocol.SlidingOptions<A> | undefined
  ) {
    const buffer = options?.buffer
    const sliding = buffer !== undefined && "sliding" in buffer
    const subscriber: Subscriber = {
      from: received,
      prefilter: options?.prefilter,
      Params: event.Params,
      buffer: new SubscriberBuffer(event.method, sliding ? buffer.sliding : buffer?.lossless ?? 10_000, sliding)
    }
    const all = state.ingest.subscribers
    if (state.endedWith !== undefined) {
      subscriber.buffer.end(failure(state.endedWith))
    } else {
      let subscribers = all.get(event.method)
      if (subscribers === undefined) {
        subscribers = new Set()
        all.set(event.method, subscribers)
      }
      subscribers.add(subscriber)
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const subscribers = all.get(event.method)
        subscribers?.delete(subscriber)
        if (subscribers?.size === 0) all.delete(event.method)
        subscriber.buffer.end(null)
      })
    )
    const decode = event.Params === undefined
      ? undefined
      : decoder(event.Params, event.method, yield* Protocol.CurrentValidation)
    return Stream.fromPull(Effect.succeed(subscriber.buffer.pull)).pipe(
      Stream.mapEffect((item): Effect.Effect<A | Protocol.Gap, Protocol.ProtocolError> =>
        Protocol.isGap(item)
          ? Effect.succeed(item)
          : decode === undefined || item.decoded
          ? Effect.succeed(item.params as A)
          : decode(item.params)
      )
    )
  })

  const makeSession = (key: Protocol.SessionKey | undefined, parent: SessionState | undefined): SessionState => {
    function subscribeTo<M extends string, A>(
      event: Protocol.EventDef<M, A>,
      options: Protocol.SlidingOptions<A>
    ): Effect.Effect<Stream.Stream<A | Protocol.Gap, Protocol.ProtocolError>, never, Scope.Scope>
    function subscribeTo<M extends string, A>(
      event: Protocol.EventDef<M, A>,
      options?: Protocol.SubscribeOptions<A> | undefined
    ): Effect.Effect<Stream.Stream<A, Protocol.ProtocolError>, never, Scope.Scope>
    function subscribeTo<M extends string, A>(
      event: Protocol.EventDef<M, A>,
      options?: Protocol.SubscribeOptions<A> | Protocol.SlidingOptions<A> | undefined
    ) {
      return subscribe(state, event, options)
    }
    const handle: Session = {
      key,
      send: (command) => Effect.map(send(state, command), ({ result }) => result),
      sendSequenced: (command) => send(state, command),
      start: (command, scope) => start(state, command, scope),
      sendOrdered: (commands, onWritten) => sendOrdered(state, commands, onWritten),
      subscribe: subscribeTo,
      drainObserved: Effect.suspend(() => ingestion.drained(state.ingest)),
      ended: Effect.suspend(() => Deferred.await(state.ingest.ended))
    }
    const state: SessionState = {
      key,
      parent,
      children: new Set(),
      pending: new Set(),
      endedWith: undefined,
      handle,
      ingest: ingestion.track(handle, parent !== undefined, received)
    }
    parent?.children.add(state)
    if (key !== undefined) sessions.set(key, state)
    states.set(handle, state)
    return state
  }

  const root = makeSession(undefined, undefined)

  const lifecycle: Lifecycle = {
    attached: (key, parentKey) => {
      if (sessions.has(key)) return
      const parent = parentKey === undefined ? root : sessions.get(parentKey)
      if (parent !== undefined && parent.endedWith === undefined) makeSession(key, parent)
    },
    ended: (key, why) => {
      const state = sessions.get(key)
      if (state !== undefined) end(state, why)
    }
  }

  // ── The reader ──

  const dispatch = (message: string): void => {
    if (lost !== undefined) return
    received++
    const decoded = wire.decode(message)
    if (Result.isFailure(decoded)) {
      loseConnection(
        new ConnectionLost({
          initiator: "remote",
          description: `The browser sent a malformed message: ${decoded.failure}`
        })
      )
      return
    }
    const incoming = decoded.success
    switch (incoming._tag) {
      case "Reply":
      case "ErrorReply": {
        const entry = pending.get(incoming.id)
        if (entry === undefined) return
        unregister(entry)
        entry.received = received
        entry.onReceipt?.(received)
        settle(entry, incoming._tag === "Reply" ? "success" : "failure")
        if (incoming._tag === "ErrorReply") {
          if (entry.late === undefined) {
            Deferred.doneUnsafe(entry.reply, Effect.fail(failure(classify(wire.errors, entry.method, incoming.error, targetKinds.get(entry.session.handle)))))
          }
          return
        }
        entry.replied = true
        entry.raw = incoming.result
        if (entry.late !== undefined) runLate(entry, entry.late)
        else Deferred.doneUnsafe(entry.reply, Effect.succeed(incoming.result))
        return
      }
      case "Ignore":
        return
      case "Event": {
        wire.lifecycle(incoming, lifecycle)
        const state = incoming.key === undefined ? root : sessions.get(incoming.key)
        if (state === undefined || state.endedWith !== undefined) return
        ingestion.event(state.ingest, received, incoming.method, incoming.params, message)
        return
      }
    }
  }

  yield* ingestion.worker.pipe(
    // A failing fold is a bug. Rather than leave everything waiting on a worker that's gone, end the connection.
    Effect.catchCause((cause) =>
      Effect.andThen(
        Effect.sync(() =>
          loseConnection(
            new ConnectionLost({ initiator: "local", description: `The event fold failed: ${Cause.pretty(cause)}` })
          )
        ),
        ingestion.finishAll
      )
    ),
    Effect.forkScoped
  )

  yield* transport.messages.pipe(
    Stream.runForEach((message) => Effect.sync(() => dispatch(message))),
    // Whatever stops the reader, even a defect, ends the connection: nothing may wait on a reader that's gone.
    Effect.matchCauseEffect({
      onFailure: (cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause)
          loseConnection(
            Transport.isTransportError(error)
              ? error.reason._tag === "ConnectionLost"
                ? error.reason
                : new ConnectionLost({ initiator: "remote", description: error.reason.description })
              : new ConnectionLost({
                initiator: "local",
                description: `The reader failed: ${error instanceof Error ? error.message : String(error)}`
              })
          )
        }),
      onSuccess: () =>
        Effect.sync(() =>
          loseConnection(new ConnectionLost({ initiator: "remote", description: "The messages ended" }))
        )
    }),
    Effect.forkScoped
  )
  yield* Effect.addFinalizer(() =>
    Effect.andThen(
      Effect.sync(() =>
        loseConnection(new ConnectionLost({ initiator: "local", description: "The connection was closed" }))
      ),
      // The worker stops with the scope, so the ends it hasn't delivered are delivered now.
      ingestion.finishAll
    )
  )

  return {
    root: root.handle,
    session: (key) => sessions.get(key)?.handle,
    children: (session) => Array.from(states.get(session)?.children ?? [], (child) => child.handle),
    closed: Deferred.await(closed)
  } satisfies Client
})
