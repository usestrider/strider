/**
 * Read-only views of state that changes, kept up to date from the browser's events.
 *
 * `yield*` reads the current value, `changes` streams it, starting with the current value, and `waitFor` waits
 * until it satisfies a predicate. Reads that need a round trip to the page, such as DOM reads or `title`, are plain
 * effects, never watchables, because no event keeps them up to date.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Predicate from "effect/Predicate"
import * as P from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as Target from "./Target.ts"

const TypeId = "~@usestrider/browser/Watchable"

/**
 * A read-only view of state that changes.
 *
 * **Details**
 *
 * - `changes` starts with the current value, conflates (a slow consumer sees the latest value, not every
 *   intermediate one), and ends after the terminal state, which is emitted as data.
 * - `waitFor` checks the current value first, then each change, so values skipped in between don't matter. It
 *   runs under the deadline.
 * - `map` derives a watchable from the same source, so derived values never disagree with their source.
 *
 * **Example** (Waiting for a page to finish loading)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "@usestrider/browser"
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
  waitFor<B extends A>(
    refinement: Predicate.Refinement<A, B>
  ): Effect.Effect<B, Deadline.Timeout | Target.TargetGone | Ended>
  /**
   * Waits until the value satisfies `predicate`, checking the current value first.
   */
  waitFor(predicate: Predicate.Predicate<A>): Effect.Effect<A, Deadline.Timeout | Target.TargetGone | Ended>
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

const EndedTypeId = "~@usestrider/browser/Watchable/Ended"

/**
 * Error for a wait whose value settled on one that doesn't satisfy it, such as a download's status once the
 * download completed: no other value will come, though the download is still there.
 *
 * **Details**
 *
 * `value` is the final value. When what the watchable describes ends instead, such as a page that closed, the
 * wait fails with `TargetGone`.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class Ended extends Schema.TaggedError<Ended>(EndedTypeId)("Ended", {
  operation: Schema.String,
  value: Schema.Unknown,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [EndedTypeId] = EndedTypeId
  override get message(): string {
    return `${this.operation}: the value settled on one that doesn't satisfy the predicate, so nothing else will`
  }
}

/**
 * Checks whether a value is an `Ended`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isEnded = (u: unknown): u is Ended => P.hasProperty(u, EndedTypeId)
