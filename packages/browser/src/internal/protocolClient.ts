/**
 * The protocol client every backend shares (PROTOCOL.md, Protocol client and Ingestion pipeline, steps 1 and 4):
 * one reader that routes replies to their pending commands and events to their session's subscribers. A
 * backend supplies its `Wire`: the envelope, the session lifecycle its events announce, and its error matchers.
 *
 * Everything the reader does is synchronous and never waits on a consumer. Results and event parameters are
 * decoded by whoever asked for them, in their own fiber, so a payload that doesn't match its codec fails that
 * caller or subscriber, not the connection.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
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

/** The session lifecycle a backend's events announce, applied by the reader before the event is published. */
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

/** The client: the root session, the sessions the lifecycle has attached, and the connection's end. */
export interface Client {
  readonly root: Protocol.ProtocolSession
  readonly session: (key: Protocol.SessionKey) => Protocol.ProtocolSession | undefined
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

interface Pending {
  readonly session: SessionState
  readonly method: string
  readonly reply: Deferred.Deferred<unknown, Protocol.ProtocolError>
}

interface SessionState {
  readonly key: Protocol.SessionKey | undefined
  readonly parent: SessionState | undefined
  readonly children: Set<SessionState>
  readonly pending: Set<Pending>
  readonly subscribers: Map<string, Set<Queue.Queue<unknown, Protocol.ProtocolError | Cause.Done>>>
  readonly ended: Deferred.Deferred<Protocol.SessionEnded>
  endedWith: Protocol.SessionEnded | undefined
  readonly handle: Protocol.ProtocolSession
}

const failure = (reason: Protocol.ProtocolError["reason"]) => new Protocol.ProtocolError({ reason })

/**
 * Starts a client on a transport. The reader runs in the scope; closing the scope stops it.
 */
export const make = Effect.fnUntraced(function*(transport: Transport.Transport, wire: Wire) {
  const pending = new Map<number, Pending>()
  const sessions = new Map<Protocol.SessionKey, SessionState>()
  const closed = yield* Deferred.make<ConnectionLost>()
  let nextId = 1
  let lost: ConnectionLost | undefined

  const end = (state: SessionState, why: Protocol.SessionEnded["why"]): void => {
    if (state.endedWith !== undefined) return
    const reason = new Protocol.SessionEnded({ why })
    state.endedWith = reason
    if (state.key !== undefined && sessions.get(state.key) === state) sessions.delete(state.key)
    state.parent?.children.delete(state)
    for (const child of state.children) end(child, why)
    for (const entry of state.pending) Deferred.doneUnsafe(entry.reply, Effect.fail(failure(reason)))
    for (const queues of state.subscribers.values()) {
      for (const queue of queues) Queue.failCauseUnsafe(queue, Cause.fail(failure(reason)))
    }
    Deferred.doneUnsafe(state.ended, Effect.succeed(reason))
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
    const id = nextId++
    const entry: Pending = { session: state, method, reply: Deferred.makeUnsafe() }
    pending.set(id, entry)
    state.pending.add(entry)
    const raw = yield* transport.send(wire.encode(id, method, encoded, state.key)).pipe(
      Effect.catch(() => Effect.fail(failure(new Protocol.SessionEnded({ why: "connectionLost" })))),
      Effect.andThen(Deferred.await(entry.reply)),
      // Interrupting the caller abandons the reply: a late one finds no entry and is dropped.
      Effect.ensuring(Effect.sync(() => {
        pending.delete(id)
        state.pending.delete(entry)
      }))
    )
    if (definition.Result === undefined) return undefined as A
    return yield* Schema.decodeUnknownEffect(definition.Result)(raw).pipe(
      Effect.mapError((error) => failure(new Protocol.Decode({ method, issue: error.message })))
    )
  })

  const subscribe = Effect.fnUntraced(function*<M extends string, A>(
    state: SessionState,
    event: Protocol.EventDef<M, A>,
    options?: Protocol.SubscribeOptions | undefined
  ) {
    const buffer = options?.buffer ?? "lossless"
    const queue = yield* (buffer === "lossless"
      ? Queue.unbounded<unknown, Protocol.ProtocolError | Cause.Done>()
      : Queue.sliding<unknown, Protocol.ProtocolError | Cause.Done>(buffer.sliding))
    if (state.endedWith !== undefined) {
      Queue.failCauseUnsafe(queue, Cause.fail(failure(state.endedWith)))
    } else {
      let queues = state.subscribers.get(event.method)
      if (queues === undefined) {
        queues = new Set()
        state.subscribers.set(event.method, queues)
      }
      queues.add(queue)
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const queues = state.subscribers.get(event.method)
        queues?.delete(queue)
        if (queues?.size === 0) state.subscribers.delete(event.method)
      }).pipe(Effect.andThen(Queue.shutdown(queue)))
    )
    const stream = Stream.fromQueue(queue)
    const Params = event.Params
    if (Params === undefined) return stream as Stream.Stream<A, Protocol.ProtocolError>
    const decode = Schema.decodeUnknownEffect(Params)
    return stream.pipe(
      Stream.mapEffect((params) =>
        decode(params).pipe(
          Effect.mapError((error) => failure(new Protocol.Decode({ method: event.method, issue: error.message })))
        )
      )
    )
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
      handle: {
        key,
        send: (command) => send(state, command),
        subscribe: (event, options) => subscribe(state, event, options),
        ended: Effect.suspend(() => Deferred.await(state.ended))
      }
    }
    parent?.children.add(state)
    if (key !== undefined) sessions.set(key, state)
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

  const loseConnection = (reason: ConnectionLost): void => {
    if (lost !== undefined) return
    lost = reason
    end(root, "connectionLost")
    Deferred.doneUnsafe(closed, Effect.succeed(reason))
  }

  const dispatch = (message: string): void => {
    if (lost !== undefined) return
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
        pending.delete(incoming.id)
        entry.session.pending.delete(entry)
        Deferred.doneUnsafe(
          entry.reply,
          incoming._tag === "Reply"
            ? Effect.succeed(incoming.result)
            : Effect.fail(failure(classify(wire.errors, entry.method, incoming.error)))
        )
        return
      }
      case "Event": {
        wire.lifecycle(incoming, lifecycle)
        const state = incoming.key === undefined ? root : sessions.get(incoming.key)
        if (state === undefined || state.endedWith !== undefined) return
        const queues = state.subscribers.get(incoming.method)
        if (queues === undefined) return
        for (const queue of queues) Queue.offerUnsafe(queue, incoming.params)
        return
      }
    }
  }

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
    Effect.sync(() =>
      loseConnection(new ConnectionLost({ initiator: "local", description: "The connection was closed" }))
    )
  )

  return {
    root: root.handle,
    session: (key) => sessions.get(key)?.handle,
    closed: Deferred.await(closed)
  } satisfies Client
}) as (transport: Transport.Transport, wire: Wire) => Effect.Effect<Client, never, Scope.Scope>
