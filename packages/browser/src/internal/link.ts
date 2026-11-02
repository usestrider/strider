/**
 * The state every transport shares: the inbox its `messages` read, the loss its `closed` waits for, and sends
 * that fail at once after the loss. A transport owns how bytes move; a link owns what `Transport.Transport`
 * promises about them:
 *
 * - **Order.** `messages` delivers what `receive` was given, in order, to its one consumer.
 * - **One loss.** The first `lose` wins; later ones, and `receive` after it, do nothing.
 * - **Drain, then fail.** After the loss, `messages` delivers what was received before it, then fails with
 *   `TransportError` carrying the loss. `closed` gives the loss.
 * - **Fail fast.** `whenOpen(write)` runs `write` only while the connection isn't lost, and otherwise fails with
 *   the loss at once, so nothing waits on a connection that's gone.
 *
 * Everything but `whenOpen` is synchronous, so a transport can call it from a platform callback. A link carries
 * text, as `Transport.Transport` does, unless a connection beneath one carries messages of its own framing.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as Transport from "../protocol/Transport.ts"

/** A transport's shared state. */
export interface Link<A = string> {
  /** Queues a message for `messages`. Ignored after the loss. */
  readonly receive: (message: A) => void
  /** Loses the connection, if it isn't lost already. */
  readonly lose: (reason: Transport.ConnectionLost) => void
  /** The loss, or `undefined` while the connection lives. */
  readonly lost: () => Transport.ConnectionLost | undefined
  /** Runs `write` while the connection lives; fails with the loss after it. */
  readonly whenOpen: <E>(write: Effect.Effect<void, E>) => Effect.Effect<void, E | Transport.TransportError>
  readonly messages: Stream.Stream<A, Transport.TransportError>
  readonly closed: Effect.Effect<Transport.ConnectionLost>
}

/** Makes a link, open until its first `lose`. */
export const make = <A = string>(): Effect.Effect<Link<A>> =>
  Effect.map(
    Effect.all([
      Deferred.make<Transport.ConnectionLost>(),
      Queue.unbounded<A, Transport.TransportError | Cause.Done>()
    ]),
    ([lost, inbox]) => {
      let reason: Transport.ConnectionLost | undefined
      return {
        receive: (message) => {
          Queue.offerUnsafe(inbox, message)
        },
        lose: (next) => {
          if (reason !== undefined) return
          reason = next
          Deferred.doneUnsafe(lost, Effect.succeed(next))
          Queue.failCauseUnsafe(inbox, Cause.fail(new Transport.TransportError({ reason: next })))
        },
        lost: () => reason,
        whenOpen: <E>(write: Effect.Effect<void, E>) =>
          Effect.suspend((): Effect.Effect<void, E | Transport.TransportError> =>
            reason === undefined ? write : Effect.fail(new Transport.TransportError({ reason }))
          ),
        messages: Stream.fromQueue(inbox),
        closed: Deferred.await(lost)
      } satisfies Link<A>
    }
  )
