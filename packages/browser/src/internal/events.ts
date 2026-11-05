/**
 * Events (CONCEPTS.md §9, Subscriptions and Event logs): one mechanism under every
 * event module's `next`, `stream` and `history`.
 *
 * The model's fold publishes each event to a channel, one per kind and target (a page's popups, a context's
 * automatic decisions). A channel keeps a bounded log, and offers each event to the live subscriptions whose
 * filter it matches, each into a buffer of its own; offering never blocks the fold. A subscription is live
 * once it is in its channel's set, and the fold is the only writer, so a subscription sees every event folded
 * after `next` or `stream` returns, and none before.
 *
 * Entries are L1's data. The public modules map them to what they emit (a `Page` handle, a `Dialog`) as they
 * are delivered, and filter on what an entry knows, which can grow: a popup's URL arrives with its first
 * navigation, so `revise` offers the entry again to the subscriptions it now matches.
 *
 * Delivering can take an effect: a response's body loads after the response, and a
 * navigation waited for until `load` ends after it commits. It runs in the subscriber, as `where` does, and its
 * failure fails the wait or the stream. `history` only projects, and never waits.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Deadline from "../Deadline.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Subscription from "../Subscription.ts"
import * as Target from "../Target.ts"
import { now } from "./adapter.ts"
import * as Operation from "./operation.ts"

/** One event in a channel: L1's data, when the fold received it, and its place in the channel's order. */
export interface Entry<A> {
  readonly value: A
  readonly at: MonotonicInstant.MonotonicInstant
  readonly sequence: number
}

/**
 * How a channel's target ended: normally (closed by a command, its script, or with its context), which ends
 * its streams, or not, which fails them with `TargetGone`. Either fails its waits with `TargetGone`.
 */
export interface End {
  readonly normal: boolean
  readonly reason: Target.CloseReason
}

export type Failure = Subscription.EventOverflow | Target.TargetGone | Cause.Done

interface Subscriber<A> {
  readonly onEnd: ((how: End) => void) | undefined
  readonly accepts: (entry: Entry<A>) => boolean
  readonly queue: Queue.Queue<Entry<A>, Failure>
  /** The entries offered already, so a revised entry reaches a subscription at most once. */
  readonly offered: WeakSet<Entry<A>>
  readonly bound: number
  /** The first entry it may see: none published before it subscribed, even when revised after. */
  readonly from: number
}

export interface Channel<A> {
  readonly target: Target.Description
  /** The log's cap, read at each append: the context's `eventLog`. */
  readonly cap: () => number
  readonly entries: Array<Entry<A>>
  /** Every entry the cap discarded. */
  dropped: number
  /** The sequence number of the next entry. */
  published: number
  readonly subscribers: Set<Subscriber<A>>
  end: Option.Option<End>
}

export const make = <A>(target: Target.Description, cap: () => number): Channel<A> => ({
  target,
  cap,
  entries: [],
  dropped: 0,
  published: 0,
  subscribers: new Set(),
  end: Option.none()
})

const gone = (target: Target.Description, reason: Target.CloseReason) =>
  new Target.TargetGone({ target, reason, diagnostics: Operation.diagnosticsNow() })

const offer = <A>(channel: Channel<A>, entry: Entry<A>): void => {
  for (const subscriber of channel.subscribers) {
    if (entry.sequence < subscriber.from || subscriber.offered.has(entry) || !subscriber.accepts(entry)) continue
    subscriber.offered.add(entry)
    if (Queue.offerUnsafe(subscriber.queue, entry)) continue
    // A full buffer fails its own subscription, and no other
    channel.subscribers.delete(subscriber)
    Queue.failCauseUnsafe(
      subscriber.queue,
      Cause.fail(
        new Subscription.EventOverflow({
          bound: subscriber.bound,
          at: now(),
          diagnostics: Operation.diagnosticsNow()
        })
      )
    )
  }
}

/** Logs an event and offers it to the subscriptions it matches. Never blocks: the fold calls it. */
export const publish = <A>(channel: Channel<A>, value: A): Entry<A> => {
  const entry: Entry<A> = { value, at: now(), sequence: channel.published++ }
  if (Option.isSome(channel.end)) return entry
  const cap = channel.cap()
  if (cap > 0) channel.entries.push(entry)
  else channel.dropped++
  while (channel.entries.length > cap) {
    channel.entries.shift()
    channel.dropped++
  }
  offer(channel, entry)
  return entry
}

/** Offers an entry again, after what filters read about it changed, to the subscriptions it now matches. */
export const revise = <A>(channel: Channel<A>, entry: Entry<A>): void => {
  if (Option.isNone(channel.end)) offer(channel, entry)
}

/** Ends a channel with its target: streams end, or fail with `TargetGone`; waits fail with `TargetGone`. */
export const end = <A>(channel: Channel<A>, how: End): void => {
  if (Option.isSome(channel.end)) return
  channel.end = Option.some(how)
  for (const subscriber of channel.subscribers) close(channel, subscriber, how)
  channel.subscribers.clear()
}

const close = <A>(channel: Channel<A>, subscriber: Subscriber<A>, how: End): void => {
  if (subscriber.onEnd !== undefined) {
    subscriber.onEnd(how)
    Queue.shutdownUnsafe(subscriber.queue)
  } else if (how.normal) Queue.endUnsafe(subscriber.queue)
  else Queue.failCauseUnsafe(subscriber.queue, Cause.fail(gone(channel.target, how.reason)))
}

/** Adds a subscription for the scope; a channel that already ended hands back one that ended with it. */
const subscribe = <A>(
  channel: Channel<A>,
  accepts: (entry: Entry<A>) => boolean,
  bound: number,
  onEnd?: ((how: End) => void) | undefined
): Effect.Effect<Subscriber<A>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const queue = yield* Queue.make<Entry<A>, Failure>({ capacity: bound })
    const subscriber: Subscriber<A> = { accepts, queue, offered: new WeakSet(), bound, from: channel.published, onEnd }
    if (Option.isSome(channel.end)) {
      close(channel, subscriber, channel.end.value)
      return subscriber
    }
    channel.subscribers.add(subscriber)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        channel.subscribers.delete(subscriber)
        Queue.endUnsafe(queue)
      })
    )
    return subscriber
  })

/**
 * Every entry the filter accepts from now on, with no bound, for a recording that keeps them all:
 * its queue ends when the channel's target ends normally or the scope closes, and fails with `TargetGone` on
 * another end.
 */
export const recorded = <A>(
  channel: Channel<A>,
  accepts: (entry: Entry<A>) => boolean
): Effect.Effect<Queue.Dequeue<Entry<A>, Failure>, never, Scope.Scope> =>
  Effect.map(subscribe(channel, accepts, Number.POSITIVE_INFINITY), (subscriber) => subscriber.queue)

/** What a module tells the mechanism about its events. */
export interface Kind<A, B> {
  /** The operation, as errors and spans name it: `"Popup.next"`. */
  readonly operation: string
  /** What one event is called in a hint: `"a popup"`. */
  readonly noun: string
  /** The event a caller sees, made as it is delivered, and as `history` reads it. */
  readonly deliver: (value: A) => B
}

/**
 * Delivery that takes an effect, in place of `Kind.deliver`, for `next` and `stream`: its failure fails the
 * wait or the stream, and `unfinished` is the hint for a `next` whose deadline passes while it runs.
 */
export interface Delivery<A, B, DE> {
  readonly deliver: (value: A) => Effect.Effect<B, DE>
  readonly unfinished: (value: A) => string
}

const immediate = <A, B>(kind: Kind<A, B>): Delivery<A, B, never> => ({
  deliver: (value) => Effect.succeed(kind.deliver(value)),
  unfinished: () => ""
})

/**
 * `next`: subscribed when it returns, with the wait as its value. The first event the filter and
 * `where` accept completes the deferred the wait reads, or the deadline in force now fails it with
 * `Timeout{waitingForEvent}`, or its target's end with `TargetGone`. Closing the scope first interrupts it. The
 * wait is latched: running it again gives the same result.
 */
export const next = <A, B, PE, PR, DE = never>(
  kind: Kind<A, B>,
  channel: Channel<A>,
  accepts: (entry: Entry<A>) => boolean,
  where: Subscription.Where<B, PE, PR> | undefined,
  delivery: Delivery<A, B, DE> = immediate(kind) as Delivery<A, B, DE>
): Effect.Effect<
  Effect.Effect<B, PE | DE | Target.TargetGone | Deadline.Timeout>,
  never,
  Scope.Scope | PR
> =>
  Effect.gen(function*() {
    // The wait is an operation of its own, which outlives `next`: its deadline is the one in force now
    const record = yield* Operation.start(kind.operation)
    const context = yield* Effect.context<PR>()
    const since = channel.published
    const subscribed = now()
    // A child scope releases completed waits before their acquiring scope closes.
    const lifetime = yield* Effect.flatMap(Effect.scope, (scope) => Scope.fork(scope))
    const deferred = Deferred.makeUnsafe<B, PE | DE | Target.TargetGone | Deadline.Timeout>()
    let outcome: Exit.Exit<B, PE | DE | Target.TargetGone | Deadline.Timeout> | undefined
    let subscriber: Subscriber<A> | undefined
    const release = () => {
      if (subscriber === undefined) return
      channel.subscribers.delete(subscriber)
      Queue.shutdownUnsafe(subscriber.queue)
    }
    // The fold can latch target end without running delivery, predicates or finalizers.
    const commit = (exit: Exit.Exit<B, PE | DE | Target.TargetGone | Deadline.Timeout>, notify = true) => {
      if (outcome === undefined) {
        outcome = exit
        release()
      }
      if (notify) Deferred.doneUnsafe(deferred, outcome)
    }
    const registered = yield* subscribe(channel, accepts, Number.POSITIVE_INFINITY, (how) =>
      commit(Exit.fail(gone(channel.target, how.reason)))).pipe(Effect.provideService(Scope.Scope, lifetime))
    subscriber = registered
    if (outcome !== undefined) {
      release()
    }
    // The entry being delivered, if the deadline passes while it is
    let delivering: Option.Option<A> = Option.none()
    const take: Effect.Effect<B, PE | DE | Target.TargetGone | Subscription.EventOverflow | Cause.Done> = Effect.gen(
      function*() {
        while (true) {
          if (outcome !== undefined) {
            return yield* Effect.interrupt
          }
          const entry = yield* Queue.take(registered.queue)
          if (outcome !== undefined) {
            return yield* Effect.interrupt
          }
          delivering = Option.some(entry.value)
          const event = yield* delivery.deliver(entry.value)
          delivering = Option.none()
          if (outcome !== undefined) {
            return yield* Effect.interrupt
          }
          if (where === undefined || (yield* Effect.provideContext(where(event), context))) {
            return event
          }
        }
      }
    )
    const missed = (): Option.Option<string> => {
      if (Option.isSome(delivering)) {
        return Option.some(delivery.unfinished(delivering.value))
      }
      const late = channel.entries.filter((entry) =>
        entry.sequence < since && accepts(entry)
      ).at(-1)
      return late === undefined ? Option.none() : Option.some(
        `${kind.noun} came ${
          Math.round((subscribed - late.at) / 1e6)
        } ms before ${kind.operation} subscribed; call ${kind.operation} before the action that causes it`
      )
    }
    const work = take.pipe(
      Effect.catch((failure): Effect.Effect<never, PE | DE | Target.TargetGone | Deadline.Timeout> => {
        if (Deadline.isTimeout(failure) || Target.isTargetGone(failure)) {
          return Effect.fail(failure)
        }
        if (Cause.isDone(failure)) {
          // Its target ended normally, which a wait still fails on; or its scope closed, which interrupts it
          return Option.isSome(channel.end)
            ? Effect.fail(gone(channel.target, channel.end.value.reason))
            : Effect.interrupt
        }
        // A `next` buffer has no bound, so it never overflows
        return Subscription.isEventOverflow(failure)
          ? Effect.interrupt
          : Effect.fail(failure as PE | DE)
      })
    )
    const complete = (exit: Exit.Exit<B, PE | DE | Target.TargetGone | Deadline.Timeout>) => {
      commit(exit, false)
      return Scope.close(lifetime, Exit.void)
    }
    // The deadline can commit while delivery is blocked, just as target end can.
    yield* record.bound(Effect.never, missed, "waitingForEvent").pipe(
      Effect.onExit(complete),
      Effect.forkIn(lifetime)
    )
    yield* Effect.raceFirst(work, Deferred.await(deferred)).pipe(
      Effect.onExit(complete),
      Effect.forkIn(lifetime)
    )
    // Registered last: scope cancellation commits before interrupting either worker.
    yield* Scope.addFinalizer(
      lifetime,
      Effect.withFiber((fiber) =>
        Effect.sync(() => commit(Exit.interrupt(fiber.id)))
      )
    )
    // The read side only: an effect that awaits it, which nothing can complete. Awaited inside an operation, the
    // wait is a step of it
    return Deferred.await(deferred).pipe(Operation.asStep(record))
  })

/**
 * `stream`: subscribed when it returns; every event the filter and `where` accept, from then on. It ends
 * when its target ends normally or its scope closes, and fails with `TargetGone` on another end and with
 * `EventOverflow` when its consumer falls more than `Subscription.Capacity` events behind.
 */
export const stream = <A, B, PE, PR, DE = never>(
  kind: Kind<A, B>,
  channel: Channel<A>,
  accepts: (entry: Entry<A>) => boolean,
  where: Subscription.Where<B, PE, PR> | undefined,
  delivery?: Delivery<A, B, DE>
): Effect.Effect<
  Stream.Stream<B, PE | DE | Subscription.EventOverflow | Target.TargetGone>,
  never,
  Scope.Scope | PR
> =>
  Effect.gen(function*() {
    const context = yield* Effect.context<PR>()
    const subscriber = yield* subscribe(channel, accepts, yield* Subscription.Capacity)
    const entries = Stream.fromQueue(subscriber.queue)
    const events: Stream.Stream<B, DE | Subscription.EventOverflow | Target.TargetGone> = delivery === undefined
      ? entries.pipe(Stream.map((entry) => kind.deliver(entry.value)))
      : entries.pipe(Stream.mapEffect((entry) => delivery.deliver(entry.value)))
    return where === undefined
      ? events
      : events.pipe(Stream.filterEffect((event) => Effect.provideContext(where(event), context)))
  })

/** `history`: what the log retained that the filter accepts, oldest first, and everything it dropped. */
export const history = <A, B>(
  kind: Kind<A, B>,
  channel: Channel<A>,
  accepts: (entry: Entry<A>) => boolean
): Effect.Effect<Subscription.History<B>> =>
  Effect.sync(() => ({
    entries: channel.entries.filter(accepts).map((entry) => kind.deliver(entry.value)),
    dropped: channel.dropped
  }))
