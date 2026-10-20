/**
 * A transport the test plays the browser on: it reads what the client sent and writes what arrives.
 */
import { Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

export interface Sent {
  readonly id: number
  readonly method: string
  readonly params?: Record<string, unknown>
  readonly sessionId?: string
}

export const makeBrowser = Effect.gen(function*() {
  const inbox = yield* Queue.unbounded<string, Transport.TransportError | Cause.Done>()
  const sent = yield* Queue.unbounded<Sent>()
  const lost = yield* Deferred.make<Transport.ConnectionLost>()
  let reason: Transport.ConnectionLost | undefined
  const transport: Transport.Transport = {
    send: (message) =>
      Effect.suspend(() =>
        reason === undefined
          ? Queue.offer(sent, JSON.parse(message)).pipe(Effect.asVoid)
          : Effect.fail(new Transport.TransportError({ reason }))
      ),
    messages: Stream.fromQueue(inbox),
    closed: Deferred.await(lost)
  }
  return {
    transport,
    next: Queue.take(sent),
    pending: Queue.size(sent),
    /** Waits until the client has read everything received so far. */
    delivered: Effect.gen(function*() {
      while ((yield* Queue.size(inbox)) > 0) yield* Effect.yieldNow
      yield* Effect.yieldNow
    }),
    receive: (message: object) => Queue.offer(inbox, JSON.stringify(message)).pipe(Effect.asVoid),
    receiveRaw: (message: string) => Queue.offer(inbox, message).pipe(Effect.asVoid),
    lose: (description: string) =>
      Effect.sync(() => {
        reason = new Transport.ConnectionLost({ initiator: "remote", description })
        Queue.failCauseUnsafe(inbox, Cause.fail(new Transport.TransportError({ reason })))
        Deferred.doneUnsafe(lost, Effect.succeed(reason))
      })
  }
})

export type FakeBrowser = Effect.Success<typeof makeBrowser>
