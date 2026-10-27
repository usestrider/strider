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
 * - `yield*` reads the current value.
 * - `changes` starts with the current value, skips consecutive repeats, and ends after the terminal state, which
 *   is emitted as data.
 * - `waitFor` checks the current value first, then each change. It runs under the deadline.
 * - `map` derives a watchable from the same source, so derived values never disagree with their source.
 *
 * **Example** (Reading the current path)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const currentPath = Effect.fn("currentPath")(function*(page: Page.ObservedPage) {
 *   const url = yield* page.url
 *   return new URL(url).pathname
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
   *
   * **Example** (Logging each URL a page visits)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Stream } from "effect"
   *
   * const logVisits = Effect.fn("logVisits")(function*(page: Page.ObservedPage) {
   *   yield* page.url.changes.pipe(Stream.runForEach((url) => Effect.log(`Visited ${url}`)))
   * })
   * ```
   */
  readonly changes: Stream.Stream<A>
  /**
   * Waits until the value satisfies `refinement`, checking the current value first, and gives it narrowed.
   *
   * **Example** (Reading a download's size once it starts)
   *
   * ```ts import.meta.vitest
   * import { Download } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const expectedSize = Effect.fn("expectedSize")(function*(download: Download.Download) {
   *   const progress = yield* download.status.waitFor((status) =>
   *     status._tag === "InProgress"
   *   )
   *   return progress.total
   * })
   * ```
   */
  waitFor<B extends A>(
    refinement: Predicate.Refinement<A, B>
  ): Effect.Effect<B, Deadline.Timeout | Target.TargetGone | Ended>
  /**
   * Waits until the value satisfies `predicate`, checking the current value first.
   *
   * **Example** (Waiting for a page to finish loading)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const loaded = Effect.fn("loaded")(function*(page: Page.ObservedPage) {
   *   yield* page.status.waitFor((status) =>
   *     status._tag === "Open" && status.document.readiness === "complete"
   *   )
   * })
   * ```
   */
  waitFor(predicate: Predicate.Predicate<A>): Effect.Effect<A, Deadline.Timeout | Target.TargetGone | Ended>
  /**
   * Derives a watchable from the same source.
   *
   * **Example** (Watching which site a page is on)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Stream } from "effect"
   *
   * const logOrigins = Effect.fn("logOrigins")(function*(page: Page.ObservedPage) {
   *   const origin = page.url.map((url) => new URL(url).origin)
   *   yield* origin.changes.pipe(
   *     Stream.runForEach((value) => Effect.log(`Now on ${value}`))
   *   )
   * })
   * ```
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
 * Error for a `waitFor` whose value settled on one that doesn't satisfy it, such as a download's status once the
 * download completed.
 *
 * **Details**
 *
 * No other value will come, though what the watchable describes is still there. `value` is the final value.
 * When what it describes ends instead, such as a page that closed, the wait fails with `TargetGone`.
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
