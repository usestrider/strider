/**
 * Read-only views of state that changes, folded from protocol events (principle 16).
 *
 * `yield*` reads the current value. `changes` streams it, starting with the current value. `waitFor` waits
 * until it satisfies a predicate. Reads that need a round trip to the page, such as DOM reads or `title`, are
 * plain effects, never watchables, because there is no event to fold them from.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Predicate from "effect/Predicate"
import * as P from "effect/Predicate"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Target from "./Target.ts"

const TypeId = "~effect-browser/Watchable"

/**
 * A read-only view of state that changes.
 *
 * **Details**
 *
 * - `changes` starts with the current value, conflates (a slow consumer sees the latest value, not every
 *   intermediate one), and ends after the terminal state, which is emitted as data.
 * - `waitFor` is level-triggered: it checks the current value first, so stages skipped between checks don't
 *   matter. It runs under the deadline.
 * - `map` derives a watchable from the same source, so derived values never disagree with their source.
 *
 * **Example** (Waiting for a page to finish loading)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "effect-browser"
 *
 * const loaded = Effect.fn("loaded")(function*(page: Page.ObservedPage) {
 *   yield* page.status.waitFor((status) => status._tag === "Open" && status.document.readiness === "complete")
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Watchable<A> extends Effect.Effect<A> {
  readonly [TypeId]: typeof TypeId
  /**
   * The current value, then each change; ends after the terminal state.
   */
  readonly changes: Stream.Stream<A>
  /**
   * Waits until the value satisfies `refinement`, checking the current value first.
   */
  waitFor<B extends A>(refinement: Predicate.Refinement<A, B>): Effect.Effect<B, Deadline.Timeout | Target.TargetGone>
  /**
   * Waits until the value satisfies `predicate`, checking the current value first.
   */
  waitFor(predicate: Predicate.Predicate<A>): Effect.Effect<A, Deadline.Timeout | Target.TargetGone>
  /**
   * Derives a watchable from the same source.
   */
  map<B>(f: (a: A) => B): Watchable<B>
}

/**
 * Checks whether a value is a `Watchable`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isWatchable = (u: unknown): u is Watchable<unknown> => P.hasProperty(u, TypeId)
