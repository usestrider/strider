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
 * - **The reader** is synchronous and never waits on a consumer. It numbers every message it receives, resolves
 *   replies, applies the session lifecycle, and queues events. A message it can't parse ends the connection.
 * - **The worker** takes events in the order they were received. For each, it decodes and folds the events the
 *   fold needs, then publishes to subscribers, so the model is updated before anyone sees the event. It never
 *   waits on commands or on subscribers; a subscriber's buffer fills or slides on its own.
 * - **Syncs.** A session the lifecycle attaches is held until the fold syncs it: its events are published but
 *   not folded until a snapshot of its state is in, and then those after the snapshot are folded on top.
 * - **Integrity.** Each session's queued events are limited in count and bytes. Going past a limit, or a folded
 *   event that won't decode, makes the session's model unavailable: the fold is told, and syncs the session
 *   again. A sync that fails, or that falls behind the same limits, ends the session with `modelUnavailable`.
 * - **Decoding** of results and event parameters happens in the fiber that asked for them, so a payload that
 *   doesn't match its codec fails that caller or subscriber, not the connection.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Protocol from "../protocol/Protocol.ts"
import * as Transport from "../protocol/Transport.ts"
import { ConnectionLost } from "../protocol/Transport.ts"

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
  /** Decodes an envelope. Throws on one that is malformed, which ends the connection. */
  readonly decode: (message: string) => Incoming
  readonly lifecycle: (event: Extract<Incoming, { _tag: "Event" }>, sessions: Lifecycle) => void
  readonly errors: ReadonlyArray<ErrorMatcher>
}

/** The most a session may have queued for the worker before its model is unavailable. */
export interface Limits {
  readonly events: number
  /** Bytes of message text, as UTF-8. */
  readonly bytes: number
}

/** 10,000 events or 256 MiB per session. */
export const defaultLimits: Limits = { events: 10_000, bytes: 256 * 1024 * 1024 }

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
   * session with `modelUnavailable`.
   */
  readonly sync: (session: Session, sync: Effect.Effect<Synced, unknown>) => void
  readonly session: (key: Protocol.SessionKey) => Session | undefined
  /**
   * Runs an effect in the worker, after every event received so far, and waits for it: for what an operation
   * learns from a reply rather than an event, so that it reaches the model in order. If the connection ends
   * first, the effect doesn't run.
   */
  readonly run: (effect: Effect.Effect<void>) => Effect.Effect<void>
}

/**
 * An adapter's model of each session, kept up to date by the worker. Every hook runs in the worker, in
 * receive order, and must never wait on a command, a subscriber or user code.
 */
export interface Fold {
  /** The events the fold needs, by method. Each is decoded before it is folded. */
  readonly events: ReadonlyMap<string, Protocol.EventDef<string, any>>
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

/**
 * Classifies an error reply with a table. A reply that no row matches is `Rejected{Unrecognized}`, never a
 * guess.
 */
export const classify = (
  table: ReadonlyArray<ErrorMatcher>,
  method: string,
  error: WireError
): Protocol.Rejected | Protocol.Unsupported | Protocol.SessionEnded => {
  const becomes: Classification = match(table, error)?.becomes ?? { _tag: "Rejected", reason: "Unrecognized" }
  switch (becomes._tag) {
    case "Unsupported":
      return new Protocol.Unsupported({ method })
    case "SessionEnded":
      return new Protocol.SessionEnded({ why: becomes.why })
    case "Rejected":
      return new Protocol.Rejected({ method, reason: becomes.reason, code: error.code, description: error.message })
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

const nonAscii = /[\u0080-\uffff]/

/** The UTF-8 length of a string, without encoding it. */
export const utf8Length = (text: string): number => {
  if (!nonAscii.test(text)) return text.length
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** The values at a JSON pointer, where `*` stands for every element of a list. */
export const valuesAt = (value: unknown, pointer: string): ReadonlyArray<unknown> => {
  let current: ReadonlyArray<unknown> = [value]
  for (const segment of pointer.slice(1).split("/")) {
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

/** Whether raw parameters match a prefilter: every field it names, nested as the parameters are. */
export const matches = (prefilter: object, params: unknown): boolean => {
  if (typeof params !== "object" || params === null) return false
  for (const [key, expected] of Object.entries(prefilter)) {
    if (expected === undefined) continue
    const actual = (params as Record<string, unknown>)[key]
    if (typeof expected === "object" && expected !== null) {
      if (!matches(expected, actual)) return false
    } else if (actual !== expected) return false
  }
  return true
}

// ── Subscriber buffers ────────────────────────────────────────────────────────────────────────────────────

interface Delivery {
  readonly params: unknown
  /** Already decoded by the fold, with the subscriber's own codec. */
  readonly decoded: boolean
}

type Item = Delivery | Protocol.Gap

/**
 * A subscriber's buffer. Lossless buffers fail with `EventOverflow` rather than drop; sliding ones drop the
 * oldest event and leave a `Gap` where it was. Gaps take no capacity, and a terminal signal needs no space:
 * it is delivered after what is already buffered.
 */
class SubscriberBuffer {
  private items: Array<Item> = []
  private head = 0
  private events = 0
  private waiter: Deferred.Deferred<void> | undefined
  /** `undefined` while open; `null` once ended normally. */
  private terminal: Protocol.ProtocolError | null | undefined
  readonly method: string
  readonly capacity: number
  readonly sliding: boolean
  constructor(method: string, capacity: number, sliding: boolean) {
    this.method = method
    this.capacity = capacity
    this.sliding = sliding
  }

  offer(delivery: Delivery): void {
    if (this.terminal !== undefined) return
    if (this.events >= this.capacity) {
      if (!this.sliding) return this.overflow()
      this.dropOldest()
    }
    this.items.push(delivery)
    this.events++
    this.wake()
  }

  /** An event this subscriber would have received was discarded upstream. */
  lose(): void {
    if (this.terminal !== undefined) return
    if (!this.sliding) return this.overflow()
    const last = this.items.length > this.head ? this.items[this.items.length - 1] : undefined
    if (last !== undefined && Protocol.isGap(last)) {
      this.items[this.items.length - 1] = new Protocol.Gap({ dropped: last.dropped + 1 })
    } else this.items.push(new Protocol.Gap({ dropped: 1 }))
    this.wake()
  }

  end(error: Protocol.ProtocolError | null): void {
    if (this.terminal !== undefined) return
    this.terminal = error
    this.wake()
  }

  readonly pull: Effect.Effect<readonly [Item, ...Array<Item>], Protocol.ProtocolError | Cause.Done> = Effect.suspend(
    () => {
      if (this.head < this.items.length) {
        const batch = this.items.slice(this.head) as [Item, ...Array<Item>]
        this.items = []
        this.head = 0
        this.events = 0
        return Effect.succeed(batch)
      }
      if (this.terminal === null) return Cause.done()
      if (this.terminal !== undefined) return Effect.fail(this.terminal)
      this.waiter ??= Deferred.makeUnsafe<void>()
      return Effect.andThen(Deferred.await(this.waiter), this.pull)
    }
  )

  private overflow(): void {
    this.end(failure(new Protocol.EventOverflow({ method: this.method, capacity: this.capacity })))
  }

  /** Drops the oldest event; a gap takes its place, merged with one already in front of it. */
  private dropOldest(): void {
    const first = this.items[this.head]!
    if (Protocol.isGap(first)) {
      this.head++
      this.items[this.head] = new Protocol.Gap({ dropped: first.dropped + 1 })
    } else {
      this.items[this.head] = new Protocol.Gap({ dropped: 1 })
    }
    this.events--
  }

  private wake(): void {
    if (this.waiter === undefined) return
    const waiter = this.waiter
    this.waiter = undefined
    Deferred.doneUnsafe(waiter, Effect.void)
  }
}

// ── The client ────────────────────────────────────────────────────────────────────────────────────────────

interface Pending {
  readonly id: number
  readonly session: SessionState
  readonly method: string
  readonly params: unknown
  readonly release: ReadonlyArray<Protocol.Release>
  readonly reply: Deferred.Deferred<unknown, Protocol.ProtocolError>
  /** The receive sequence number of the reply. */
  received: number
  replied: boolean
  raw: unknown
  /** Set once the caller stopped waiting on a command that creates a resource. */
  late: ((reply: Protocol.LateReply) => Effect.Effect<void>) | undefined
}

interface Subscriber {
  readonly from: number
  readonly prefilter: object | undefined
  readonly Params: Schema.Codec<any, unknown> | undefined
  readonly buffer: SubscriberBuffer
}

interface QueuedEvent {
  readonly _tag: "Event"
  readonly received: number
  readonly state: SessionState
  readonly method: string
  readonly params: unknown
  readonly bytes: number
  /** The session's overload epoch when queued; an overload discards every event queued before it. */
  readonly epoch: number
}

type Work =
  | QueuedEvent
  | { readonly _tag: "Overloaded"; readonly state: SessionState; readonly failure: IntegrityFailure }
  | { readonly _tag: "Synced"; readonly state: SessionState; readonly synced: Synced }
  | { readonly _tag: "End"; readonly state: SessionState; readonly reason: Protocol.SessionEnded }
  | {
    readonly _tag: "Run"
    readonly state: SessionState
    readonly effect: Effect.Effect<void>
    readonly done: Deferred.Deferred<void>
  }

interface SessionState {
  readonly key: Protocol.SessionKey | undefined
  readonly parent: SessionState | undefined
  readonly children: Set<SessionState>
  readonly pending: Set<Pending>
  readonly subscribers: Map<string, Set<Subscriber>>
  readonly ended: Deferred.Deferred<Protocol.SessionEnded>
  /** Set when the session ends: sends fail from then on. */
  endedWith: Protocol.SessionEnded | undefined
  /** Set once the worker has delivered the end: subscribers are done and `ended` is complete. */
  finished: boolean
  readonly handle: Session
  // Ingestion
  queuedEvents: number
  queuedBytes: number
  epoch: number
  /** The receive sequence of the last event queued for this session. */
  lastQueued: number
  /** The receive sequence of the last event the worker folded and published. */
  processed: number
  /** Events are held for the fold until a sync completes. */
  holding: boolean
  held: Array<QueuedEvent>
  heldBytes: number
  drains: Array<{ readonly target: number; readonly done: Deferred.Deferred<void> }>
}

/**
 * Starts a client on a transport. The reader and the worker run in the scope; closing the scope stops them
 * and ends every session.
 */
export const make = Effect.fnUntraced(function*(transport: Transport.Transport, wire: Wire, options?: Options) {
  const limits = options?.limits ?? defaultLimits
  const validation = yield* Protocol.CurrentValidation
  const pending = new Map<number, Pending>()
  const sessions = new Map<Protocol.SessionKey, SessionState>()
  const live = new Set<SessionState>()
  const inbox = yield* Queue.unbounded<Work>()
  const closed = yield* Deferred.make<ConnectionLost>()
  const run = yield* FiberSet.makeRuntime()
  const states = new WeakMap<Session, SessionState>()
  const control: FoldControl = {
    sync: (session, sync) => {
      const state = states.get(session)
      if (state === undefined || state.endedWith !== undefined) return
      state.holding = true
      run(
        sync.pipe(
          Effect.matchCause({
            onFailure: () => end(state, "modelUnavailable"),
            onSuccess: (synced) => Queue.offerUnsafe(inbox, { _tag: "Synced", state, synced })
          })
        )
      )
    },
    session: (key) => sessions.get(key)?.handle,
    run: (effect) =>
      Effect.suspend(() => {
        if (lost !== undefined) return Effect.void
        const done = Deferred.makeUnsafe<void>()
        runs.add(done)
        Queue.offerUnsafe(inbox, { _tag: "Run", state: root, effect, done })
        return Deferred.await(done)
      })
  }
  const runs = new Set<Deferred.Deferred<void>>()
  const fold = options?.fold?.(control)
  const foldDecoders = new Map(
    [...(fold?.events.values() ?? [])].map((event) =>
      [
        event.method,
        event.Params === undefined
          ? (params: unknown) => Effect.succeed(params)
          : decoder(event.Params, event.method, validation)
      ] as const
    )
  )
  let nextId = 1
  let received = 0
  let lost: ConnectionLost | undefined

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
      if (entry.late === undefined) Deferred.doneUnsafe(entry.reply, Effect.fail(failure(reason)))
    }
    state.pending.clear()
    // Subscribers end after the events received before the end
    state.lastQueued = received
    Queue.offerUnsafe(inbox, { _tag: "End", state, reason })
  }

  // The fold hears of the end first, as of any event; then subscribers and waiters do.
  const finish = Effect.fnUntraced(function*(state: SessionState, reason: Protocol.SessionEnded) {
    if (state.finished) return
    state.finished = true
    live.delete(state)
    if (fold !== undefined) yield* fold.ended(state.handle, reason)
    for (const subscribers of state.subscribers.values()) {
      for (const subscriber of subscribers) subscriber.buffer.end(failure(reason))
    }
    state.subscribers.clear()
    for (const drain of state.drains) Deferred.doneUnsafe(drain.done, Effect.void)
    state.drains = []
    Deferred.doneUnsafe(state.ended, Effect.succeed(reason))
  })

  const loseConnection = (reason: ConnectionLost): void => {
    if (lost !== undefined) return
    lost = reason
    end(root, "connectionLost")
    Deferred.doneUnsafe(closed, Effect.succeed(reason))
  }

  // Delivers every end at once, without waiting for the worker: for when the worker is gone.
  const finishAll = Effect.suspend(() =>
    Effect.forEach(
      [...live],
      (state) => finish(state, state.endedWith ?? new Protocol.SessionEnded({ why: "connectionLost" })),
      { discard: true }
    ).pipe(
      Effect.andThen(Effect.sync(() => {
        for (const done of runs) Deferred.doneUnsafe(done, Effect.void)
        runs.clear()
      }))
    )
  )

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
    const release = Effect.forEach(
      entry.release.flatMap((release) =>
        valuesAt(entry.raw, release.from).map((value) =>
          [release.method, { [release.param]: release.list === true ? [value] : value }] as const
        )
      ),
      ([method, params]) => Effect.ignore(sendRaw(state, method, params)),
      { discard: true }
    )
    run(handler({ session: state.handle, method: entry.method, params: entry.params, result: entry.raw, release }))
  }

  const send = Effect.fnUntraced(function*<M extends string, P, A>(
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
    const timeout = yield* Protocol.CommandTimeout
    const onLate = definition.traits.createsResource === true ? yield* Protocol.CurrentLateReplyHandler : undefined
    const decode = definition.Result === undefined
      ? undefined
      : decoder(definition.Result, method, yield* Protocol.CurrentValidation)
    const entry = register(state, method, encoded, definition.traits.release ?? [])
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
    const awaited = Duration.isFinite(timeout)
      ? Effect.timeoutOrElse(Deferred.await(entry.reply), {
        duration: timeout,
        orElse: () => Effect.andThen(abandon, Effect.fail(failure(new Protocol.NoReply({ method, timeout }))))
      })
      : Deferred.await(entry.reply)
    return yield* transport.send(wire.encode(entry.id, method, encoded, state.key)).pipe(
      Effect.catch(() =>
        Effect.andThen(
          Effect.sync(() => unregister(entry)),
          Effect.fail(failure(new Protocol.SessionEnded({ why: "connectionLost" })))
        )
      ),
      Effect.andThen(awaited),
      Effect.flatMap((raw) => decode === undefined ? Effect.succeed(undefined as A) : decode(raw)),
      Effect.map((result) => {
        consumed = true
        return { result, received: entry.received }
      }),
      Effect.onInterrupt(() => abandon)
    )
  })

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
    if (state.endedWith !== undefined) {
      subscriber.buffer.end(failure(state.endedWith))
    } else {
      let subscribers = state.subscribers.get(event.method)
      if (subscribers === undefined) {
        subscribers = new Set()
        state.subscribers.set(event.method, subscribers)
      }
      subscribers.add(subscriber)
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const subscribers = state.subscribers.get(event.method)
        subscribers?.delete(subscriber)
        if (subscribers?.size === 0) state.subscribers.delete(event.method)
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

  const drainObserved = (state: SessionState): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (state.finished || state.processed >= state.lastQueued) return Effect.void
      const done = Deferred.makeUnsafe<void>()
      state.drains.push({ target: state.lastQueued, done })
      return Deferred.await(done)
    })

  const makeSession = (key: Protocol.SessionKey | undefined, parent: SessionState | undefined): SessionState => {
    const state: SessionState = {
      key,
      parent,
      children: new Set(),
      pending: new Set(),
      subscribers: new Map(),
      ended: Deferred.makeUnsafe(),
      endedWith: undefined,
      finished: false,
      handle: {
        key,
        send: (command) => Effect.map(send(state, command), ({ result }) => result),
        sendSequenced: (command) => send(state, command),
        subscribe: (event: Protocol.EventDef<string, any>, options?: any) => subscribe(state, event, options),
        drainObserved: Effect.suspend(() => drainObserved(state)),
        ended: Effect.suspend(() => Deferred.await(state.ended))
      } as Session,
      queuedEvents: 0,
      queuedBytes: 0,
      epoch: 0,
      lastQueued: received,
      processed: received,
      holding: fold !== undefined && parent !== undefined,
      held: [],
      heldBytes: 0,
      drains: []
    }
    parent?.children.add(state)
    if (key !== undefined) sessions.set(key, state)
    live.add(state)
    states.set(state.handle, state)
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

  const queueEvent = (state: SessionState, method: string, params: unknown, message: string): void => {
    const bytes = utf8Length(message)
    state.queuedEvents++
    state.queuedBytes += bytes
    state.lastQueued = received
    if (state.queuedEvents > limits.events || state.queuedBytes > limits.bytes) {
      // Everything queued for this session so far, this event included, is discarded
      const overloaded: IntegrityFailure = { _tag: "Overloaded", events: state.queuedEvents, bytes: state.queuedBytes }
      Queue.offerUnsafe(inbox, { _tag: "Event", received, state, method, params, bytes, epoch: state.epoch })
      state.epoch++
      state.queuedEvents = 0
      state.queuedBytes = 0
      Queue.offerUnsafe(inbox, { _tag: "Overloaded", state, failure: overloaded })
      return
    }
    Queue.offerUnsafe(inbox, { _tag: "Event", received, state, method, params, bytes, epoch: state.epoch })
  }

  const dispatch = (message: string): void => {
    if (lost !== undefined) return
    received++
    let incoming: Incoming
    try {
      incoming = wire.decode(message)
    } catch (cause) {
      loseConnection(
        new ConnectionLost({
          initiator: "remote",
          description: `The browser sent a malformed message: ${cause instanceof Error ? cause.message : String(cause)}`
        })
      )
      return
    }
    switch (incoming._tag) {
      case "Reply":
      case "ErrorReply": {
        const entry = pending.get(incoming.id)
        if (entry === undefined) return
        unregister(entry)
        entry.received = received
        if (incoming._tag === "ErrorReply") {
          if (entry.late === undefined) {
            Deferred.doneUnsafe(entry.reply, Effect.fail(failure(classify(wire.errors, entry.method, incoming.error))))
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
        queueEvent(state, incoming.method, incoming.params, message)
        return
      }
    }
  }

  // ── The worker ──

  const advance = (state: SessionState, through: number): void => {
    if (through > state.processed) state.processed = through
    if (state.drains.length === 0) return
    state.drains = state.drains.filter((drain) => {
      if (drain.target > state.processed) return true
      Deferred.doneUnsafe(drain.done, Effect.void)
      return false
    })
  }

  const subscribersOf = function*(event: QueuedEvent): Generator<Subscriber> {
    const subscribers = event.state.subscribers.get(event.method)
    if (subscribers === undefined) return
    for (const subscriber of subscribers) {
      if (event.received <= subscriber.from) continue
      if (subscriber.prefilter !== undefined && !matches(subscriber.prefilter, event.params)) continue
      yield subscriber
    }
  }

  const publish = (event: QueuedEvent, decoded: { readonly value: unknown; readonly codec: unknown } | undefined) => {
    for (const subscriber of subscribersOf(event)) {
      subscriber.buffer.offer(
        decoded !== undefined && decoded.codec === subscriber.Params
          ? { params: decoded.value, decoded: true }
          : { params: event.params, decoded: false }
      )
    }
  }

  const lose = Effect.fnUntraced(function*(state: SessionState, integrity: IntegrityFailure) {
    if (fold === undefined || state.holding) return
    state.holding = true
    yield* fold.lost(state.handle, integrity)
  })

  // Folds one event; one that won't decode makes the session's model unavailable.
  const foldEvent = Effect.fnUntraced(function*(event: QueuedEvent) {
    const decode = foldDecoders.get(event.method)
    if (decode === undefined || fold === undefined) return undefined
    const decoded = yield* Effect.result(decode(event.params))
    if (decoded._tag === "Failure") {
      const reason = decoded.failure.reason
      yield* lose(event.state, {
        _tag: "Undecodable",
        method: event.method,
        issue: reason._tag === "Decode" ? reason.issue : reason.message
      })
      return undefined
    }
    yield* fold.apply(event.state.handle, event.method, decoded.success, event.received)
    return { value: decoded.success, codec: fold.events.get(event.method)!.Params }
  })

  const process = Effect.fnUntraced(function*(work: Work) {
    const state = work.state
    if (work._tag === "Run") {
      if (runs.delete(work.done)) {
        yield* work.effect
        Deferred.doneUnsafe(work.done, Effect.void)
      }
      return
    }
    if (state.finished) return
    switch (work._tag) {
      case "Event": {
        if (work.epoch < state.epoch) {
          for (const subscriber of subscribersOf(work)) subscriber.buffer.lose()
          if (fold === undefined) advance(state, work.received)
          return
        }
        state.queuedEvents--
        state.queuedBytes -= work.bytes
        if (state.holding) {
          publish(work, undefined)
          state.held.push(work)
          state.heldBytes += work.bytes
          if (state.held.length > limits.events || state.heldBytes > limits.bytes) end(state, "modelUnavailable")
          return
        }
        publish(work, yield* foldEvent(work))
        if (!state.holding) advance(state, work.received)
        return
      }
      case "Overloaded":
        return yield* lose(state, work.failure)
      case "Synced": {
        yield* work.synced.apply
        state.holding = false
        const held = state.held
        state.held = []
        state.heldBytes = 0
        advance(state, work.synced.through)
        for (let i = 0; i < held.length; i++) {
          const event = held[i]!
          if (event.received <= work.synced.through) continue
          yield* foldEvent(event)
          if (state.holding) {
            // Lost again: what is left waits for the next sync
            state.held = [...held.slice(i + 1), ...state.held]
            state.heldBytes = state.held.reduce((bytes, held) => bytes + held.bytes, 0)
            return
          }
          advance(state, event.received)
        }
        return
      }
      case "End":
        return yield* finish(state, work.reason)
    }
  })

  yield* Queue.take(inbox).pipe(
    Effect.flatMap(process),
    Effect.forever,
    // A failing fold is a bug. Rather than leave everything waiting on a worker that's gone, end the connection.
    Effect.catchCause((cause) =>
      Effect.andThen(
        Effect.sync(() =>
          loseConnection(
            new ConnectionLost({ initiator: "local", description: `The event fold failed: ${Cause.pretty(cause)}` })
          )
        ),
        finishAll
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
      finishAll
    )
  )

  return {
    root: root.handle,
    session: (key) => sessions.get(key)?.handle,
    children: (session) => Array.from(states.get(session)?.children ?? [], (child) => child.handle),
    closed: Deferred.await(closed)
  } satisfies Client
}) as (transport: Transport.Transport, wire: Wire, options?: Options) => Effect.Effect<Client, never, Scope.Scope>
