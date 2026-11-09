/**
 * The protocol client's ingestion (PROTOCOL.md, Ingestion pipeline): the queue from the reader to the worker,
 * and the worker.
 *
 * - **The worker** takes events in the order they were received. For each, it decodes and folds the events the
 *   fold needs, then publishes to subscribers, so the model is updated before anyone sees the event. It never
 *   waits on commands or on subscribers; a subscriber's buffer fills or slides on its own.
 * - **Syncs.** A session the lifecycle attaches is held until the fold syncs it: its events are published but
 *   not folded until a snapshot of its state is in, and then those after the snapshot are folded on top.
 * - **Integrity.** Each session's queued events are limited in count and bytes. Going past a limit, or a folded
 *   event that won't decode, makes the session's model unavailable: the fold is told, and syncs the session
 *   again. A sync that fails, or that falls behind the same limits, ends the session with `modelUnavailable`.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FiberSet from "effect/FiberSet"
import * as Queue from "effect/Queue"
import type * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Protocol from "../protocol/Protocol.ts"
import type { Fold, FoldControl, IntegrityFailure, Limits, Session, Synced } from "./protocolClient.ts"
import { matches, type Subscriber } from "./subscriberBuffer.ts"

/** What ingestion keeps for one session. */
export interface Ingest {
  readonly session: Session
  readonly subscribers: Map<string, Set<Subscriber>>
  /** Complete once the worker has delivered the end. */
  readonly ended: Deferred.Deferred<Protocol.SessionEnded>
  /** Set when the end is queued: nothing is synced after it. */
  ending: Protocol.SessionEnded | undefined
  /** Set once the worker has delivered the end: subscribers are done and `ended` is complete. */
  finished: boolean
  queuedEvents: number
  queuedBytes: number
  /** Advanced by an overload, which discards every event queued before it. */
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

interface QueuedEvent {
  readonly _tag: "Event"
  readonly received: number
  readonly ingest: Ingest
  readonly method: string
  readonly params: unknown
  readonly bytes: number
  /** The session's overload epoch when queued; an overload discards every event queued before it. */
  readonly epoch: number
}

type Work =
  | QueuedEvent
  | { readonly _tag: "Overloaded"; readonly ingest: Ingest; readonly failure: IntegrityFailure }
  | { readonly _tag: "Synced"; readonly ingest: Ingest; readonly synced: Synced }
  | { readonly _tag: "End"; readonly ingest: Ingest; readonly reason: Protocol.SessionEnded }
  | { readonly _tag: "Run"; readonly effect: Effect.Effect<void>; readonly done: Deferred.Deferred<void> }

/** What ingestion needs from the client. */
export interface Options {
  readonly fold: ((control: FoldControl) => Fold) | undefined
  readonly limits: Limits
  /** The decoder for an event's parameters, under the connection's validation. */
  readonly decoder: (
    codec: Schema.Codec<unknown, unknown>,
    method: string
  ) => (params: unknown) => Effect.Effect<unknown, Protocol.ProtocolError>
  readonly session: (key: Protocol.SessionKey) => Session | undefined
  /** Ends a session, which then queues its end here. */
  readonly end: (session: Session, why: Protocol.SessionEnded["why"]) => void
  /** Whether the connection is lost, after which `FoldControl.run` runs nothing. */
  readonly lost: () => boolean
}

/** The ingestion of one connection. */
export interface Ingestion {
  /** Starts ingesting a session; one the lifecycle attached is held until the fold syncs it. */
  readonly track: (session: Session, attached: boolean, received: number) => Ingest
  /** Queues an event the reader received, and checks the session's limits. */
  readonly event: (ingest: Ingest, received: number, method: string, params: unknown, message: string) => void
  /** Queues a session's end, after every event received before it. */
  readonly end: (ingest: Ingest, reason: Protocol.SessionEnded, received: number) => void
  /** Waits until every event queued for the session so far has been folded and published. */
  readonly drained: (ingest: Ingest) => Effect.Effect<void>
  /** The worker, which runs until it is interrupted or the fold fails. */
  readonly worker: Effect.Effect<never>
  /** Delivers every end the worker hasn't, at once: for when the worker is gone. */
  readonly finishAll: Effect.Effect<void>
}

const nonAscii = /[\u0080-￿]/

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

/** Starts a connection's ingestion; syncs run in the scope. */
export const make: (options: Options) => Effect.Effect<Ingestion, never, Scope.Scope> = Effect.fnUntraced(
  function*(options: Options) {
    const { limits } = options
    const inbox = yield* Queue.unbounded<Work>()
    const run = yield* FiberSet.makeRuntime()
    const ingests = new WeakMap<Session, Ingest>()
    const live = new Set<Ingest>()
    const runs = new Set<Deferred.Deferred<void>>()
    const control: FoldControl = {
      sync: (session, sync) => {
        const ingest = ingests.get(session)
        if (ingest === undefined || ingest.ending !== undefined) return
        ingest.holding = true
        run(
          sync.pipe(
            Effect.matchCause({
              onFailure: () => options.end(session, "modelUnavailable"),
              onSuccess: (synced) => Queue.offerUnsafe(inbox, { _tag: "Synced", ingest, synced })
            })
          )
        )
      },
      session: options.session,
      run: (effect) =>
        Effect.suspend(() => {
          if (options.lost()) return Effect.void
          const done = Deferred.makeUnsafe<void>()
          runs.add(done)
          Queue.offerUnsafe(inbox, { _tag: "Run", effect, done })
          return Deferred.await(done)
        })
    }
    const fold = options.fold?.(control)
    const foldDecoders = new Map(
      [...(fold?.events.values() ?? [])].map((event) =>
        [
          event.method,
          event.Params === undefined
            ? (params: unknown) => Effect.succeed(params)
            : options.decoder(event.Params, event.method)
        ] as const
      )
    )

    const track = (session: Session, attached: boolean, received: number): Ingest => {
      const ingest: Ingest = {
        session,
        subscribers: new Map(),
        ended: Deferred.makeUnsafe(),
        ending: undefined,
        finished: false,
        queuedEvents: 0,
        queuedBytes: 0,
        epoch: 0,
        lastQueued: received,
        processed: received,
        holding: fold !== undefined && attached,
        held: [],
        heldBytes: 0,
        drains: []
      }
      ingests.set(session, ingest)
      live.add(ingest)
      return ingest
    }

    const event = (ingest: Ingest, received: number, method: string, params: unknown, message: string): void => {
      const accepts = fold?.eventScopes?.get(method)
      if (accepts !== undefined && !accepts(ingest.session) && !ingest.subscribers.has(method)) return
      const bytes = utf8Length(message)
      ingest.queuedEvents++
      ingest.queuedBytes += bytes
      ingest.lastQueued = received
      Queue.offerUnsafe(inbox, { _tag: "Event", received, ingest, method, params, bytes, epoch: ingest.epoch })
      if (ingest.queuedEvents > limits.events || ingest.queuedBytes > limits.bytes) {
        // Everything queued for this session so far, this event included, is discarded
        const failure: IntegrityFailure = { _tag: "Overloaded", events: ingest.queuedEvents, bytes: ingest.queuedBytes }
        ingest.epoch++
        ingest.queuedEvents = 0
        ingest.queuedBytes = 0
        Queue.offerUnsafe(inbox, { _tag: "Overloaded", ingest, failure })
      }
    }

    const end = (ingest: Ingest, reason: Protocol.SessionEnded, received: number): void => {
      ingest.ending = reason
      // Subscribers end after the events received before the end
      ingest.lastQueued = received
      Queue.offerUnsafe(inbox, { _tag: "End", ingest, reason })
    }

    const drained = (ingest: Ingest): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (ingest.finished || ingest.processed >= ingest.lastQueued) return Effect.void
        const done = Deferred.makeUnsafe<void>()
        ingest.drains.push({ target: ingest.lastQueued, done })
        return Deferred.await(done)
      })

    // The fold hears of the end first, as of any event; then subscribers and waiters do.
    const finish = Effect.fnUntraced(function*(ingest: Ingest, reason: Protocol.SessionEnded) {
      if (ingest.finished) return
      ingest.finished = true
      live.delete(ingest)
      if (fold !== undefined) yield* fold.ended(ingest.session, reason)
      const ended = new Protocol.ProtocolError({ reason })
      for (const subscribers of ingest.subscribers.values()) {
        for (const subscriber of subscribers) subscriber.buffer.end(ended)
      }
      ingest.subscribers.clear()
      for (const drain of ingest.drains) Deferred.doneUnsafe(drain.done, Effect.void)
      ingest.drains = []
      Deferred.doneUnsafe(ingest.ended, Effect.succeed(reason))
    })

    const finishAll = Effect.suspend(() =>
      Effect.forEach(
        [...live],
        (ingest) => finish(ingest, ingest.ending ?? new Protocol.SessionEnded({ why: "connectionLost" })),
        { discard: true }
      ).pipe(
        Effect.andThen(Effect.sync(() => {
          for (const done of runs) Deferred.doneUnsafe(done, Effect.void)
          runs.clear()
        }))
      )
    )

    // ── The worker ──

    const advance = (ingest: Ingest, through: number): void => {
      if (through > ingest.processed) ingest.processed = through
      if (ingest.drains.length === 0) return
      ingest.drains = ingest.drains.filter((drain) => {
        if (drain.target > ingest.processed) return true
        Deferred.doneUnsafe(drain.done, Effect.void)
        return false
      })
    }

    const subscribersOf = function*(event: QueuedEvent): Generator<Subscriber> {
      const subscribers = event.ingest.subscribers.get(event.method)
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

    const lose = Effect.fnUntraced(function*(ingest: Ingest, integrity: IntegrityFailure) {
      if (fold === undefined || ingest.holding) return
      ingest.holding = true
      yield* fold.lost(ingest.session, integrity)
    })

    // Folds one event; one that won't decode makes the session's model unavailable.
    const foldEvent = Effect.fnUntraced(function*(event: QueuedEvent) {
      const accepts = fold?.eventScopes?.get(event.method)
      if (accepts !== undefined && !accepts(event.ingest.session)) return undefined
      const decode = foldDecoders.get(event.method)
      if (decode === undefined || fold === undefined) return undefined
      const decoded = yield* Effect.result(decode(event.params))
      if (decoded._tag === "Failure") {
        const reason = decoded.failure.reason
        yield* lose(event.ingest, {
          _tag: "Undecodable",
          method: event.method,
          issue: reason._tag === "Decode" ? reason.issue : reason.message
        })
        return undefined
      }
      yield* fold.apply(event.ingest.session, event.method, decoded.success, event.received)
      return { value: decoded.success, codec: fold.events.get(event.method)!.Params }
    })

    const process = Effect.fnUntraced(function*(work: Work) {
      if (work._tag === "Run") {
        if (runs.delete(work.done)) {
          yield* work.effect
          Deferred.doneUnsafe(work.done, Effect.void)
        }
        return
      }
      const ingest = work.ingest
      if (ingest.finished) return
      switch (work._tag) {
        case "Event": {
          if (work.epoch < ingest.epoch) {
            for (const subscriber of subscribersOf(work)) subscriber.buffer.lose()
            if (fold === undefined) advance(ingest, work.received)
            return
          }
          ingest.queuedEvents--
          ingest.queuedBytes -= work.bytes
          if (ingest.holding) {
            publish(work, undefined)
            ingest.held.push(work)
            ingest.heldBytes += work.bytes
            if (ingest.held.length > limits.events || ingest.heldBytes > limits.bytes) {
              options.end(ingest.session, "modelUnavailable")
            }
            return
          }
          publish(work, yield* foldEvent(work))
          if (!ingest.holding) advance(ingest, work.received)
          return
        }
        case "Overloaded":
          return yield* lose(ingest, work.failure)
        case "Synced": {
          yield* work.synced.apply
          ingest.holding = false
          const held = ingest.held
          ingest.held = []
          ingest.heldBytes = 0
          advance(ingest, work.synced.through)
          for (let i = 0; i < held.length; i++) {
            const event = held[i]!
            if (event.received <= work.synced.through) continue
            yield* foldEvent(event)
            if (ingest.holding) {
              // Lost again: what is left waits for the next sync
              ingest.held = [...held.slice(i + 1), ...ingest.held]
              ingest.heldBytes = ingest.held.reduce((bytes, held) => bytes + held.bytes, 0)
              return
            }
            advance(ingest, event.received)
          }
          return
        }
        case "End":
          return yield* finish(ingest, work.reason)
      }
    })

    return {
      track,
      event,
      end,
      drained,
      worker: Queue.take(inbox).pipe(Effect.flatMap(process), Effect.forever),
      finishAll
    } satisfies Ingestion
  }
)
