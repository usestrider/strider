/**
 * State (principle 16). A read-only view of an entity's state, folded from protocol events.
 *
 * `yield*` reads the current value. `changes` starts with the current value, conflates, and ends after the
 * terminal state, emitted as data. `waitFor` is level-triggered, so skipped stages don't matter, and runs
 * under the deadline. Reads that need a round trip (DOM reads, `title`) are plain Effects, never Watchables.
 */
import type { Effect, Predicate, Stream } from "effect"
import type { TargetGone, Timeout } from "./Errors.ts"

export interface Watchable<A> extends Effect.Effect<A> {
  readonly changes: Stream.Stream<A>
  waitFor<B extends A>(refinement: Predicate.Refinement<A, B>): Effect.Effect<B, Timeout | TargetGone>
  waitFor(predicate: Predicate.Predicate<A>): Effect.Effect<A, Timeout | TargetGone>
  map<B>(f: (a: A) => B): Watchable<B>                  // derived from the same source, so never glitchy
}
