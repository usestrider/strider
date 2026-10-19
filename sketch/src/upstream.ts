/**
 * The read side of Effect's `Deferred`, as proposed upstream (upstream/effect-readonly-deferred.md).
 *
 * Until it lands, the sketch declares the proposed shape here, so call sites read exactly as they would
 * afterwards: `yield* Deferred.await(download)`. Upstream it would be `Deferred.ReadonlyDeferred`, with
 * `Deferred<A, E>` extending it and `asReadonly` as the identity. If upstream declines, `next` returns the
 * awaiting `Effect` instead, with the same timing.
 */
import type { Effect, Option, Pipeable } from "effect"

declare const ReadonlyDeferredTypeId: unique symbol

export interface ReadonlyDeferred<out A, out E = never> extends Pipeable.Pipeable {
  readonly [ReadonlyDeferredTypeId]: {
    readonly _A: (_: never) => A                         // covariant, like Queue.Dequeue
    readonly _E: (_: never) => E
  }
}

export declare const Deferred: {
  await<A, E>(self: ReadonlyDeferred<A, E>): Effect.Effect<A, E>
  poll<A, E>(self: ReadonlyDeferred<A, E>): Effect.Effect<Option.Option<Effect.Effect<A, E>>>
  isDone<A, E>(self: ReadonlyDeferred<A, E>): Effect.Effect<boolean>
}
