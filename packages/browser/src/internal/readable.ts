/**
 * An entity's state as its readers have it (CONCEPTS.md §2): read and watched, never written. The fold holds the
 * `SubscriptionRef` behind it and is the only writer, which the types enforce: nothing else is handed the ref.
 */
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"

export interface Readable<S> {
  /** The state, when the effect runs. */
  readonly get: Effect.Effect<S>
  /** The state now, then each state after it. */
  readonly changes: Stream.Stream<S>
  /** The state now, for a projection that runs where no effect does, such as a watchable's. */
  readonly getUnsafe: () => S
}

/** The read side of `ref`. */
export const of = <S>(ref: SubscriptionRef.SubscriptionRef<S>): Readable<S> => ({
  get: SubscriptionRef.get(ref),
  changes: SubscriptionRef.changes(ref),
  getUnsafe: () => SubscriptionRef.getUnsafe(ref)
})
