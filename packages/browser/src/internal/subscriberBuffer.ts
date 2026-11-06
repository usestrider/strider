/**
 * A protocol subscription's buffer (PROTOCOL.md, Ingestion pipeline): what the worker has published to one
 * subscriber and the subscriber hasn't read. The worker offers to it without ever waiting. A lossless buffer
 * that is full fails with `EventOverflow`; a sliding one drops its oldest event and leaves a `Gap` in its place.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/** One event published to a subscriber. */
export interface Delivery {
  readonly params: unknown
  /** Already decoded by the fold, with the subscriber's own codec. */
  readonly decoded: boolean
}

export type Item = Delivery | Protocol.Gap

/** A subscription, as the worker publishes to it. */
export interface Subscriber {
  /** The receive sequence number when it subscribed: it sees only events received after. */
  readonly from: number
  readonly prefilter: object | undefined
  readonly Params: Schema.Codec<any, unknown> | undefined
  readonly buffer: SubscriberBuffer
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

/**
 * A subscriber's buffer. Lossless buffers fail with `EventOverflow` rather than drop; sliding ones drop the
 * oldest event and leave a `Gap` where it was. Gaps take no capacity, and a terminal signal needs no space:
 * it is delivered after what is already buffered.
 */
export class SubscriberBuffer {
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

  /** Ends the buffer after what it holds: with an error, or normally with `null`. */
  end(error: Protocol.ProtocolError | null): void {
    if (this.terminal !== undefined) return
    this.terminal = error
    this.wake()
  }

  /** Takes everything buffered, waiting for something if there's nothing. */
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
    this.end(
      new Protocol.ProtocolError({
        reason: new Protocol.EventOverflow({ method: this.method, capacity: this.capacity })
      })
    )
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
