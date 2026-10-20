/**
 * The read side of Effect's `Deferred`, as proposed upstream (upstream/effect-readonly-deferred.md).
 *
 * An event wait (`Download.next(page)`) subscribes at once and hands back the result as a `ReadonlyDeferred`
 * that the library completes. Callers can await it, poll it, or check it, but never complete it. Until the
 * proposal lands, this module declares the proposed shape so call sites read exactly as they would afterwards:
 * `yield* Deferred.await(download)`. Upstream, `Deferred<A, E>` would extend `ReadonlyDeferred<A, E>` and
 * `asReadonly` would be the identity.
 *
 * **Gotchas**
 *
 * This module shares its name with Effect's `Deferred`. It is removed once Effect ships the read side. If
 * Effect declines, `next` returns the awaiting `Effect` instead, with the same timing.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Types from "effect/Types"

const TypeId = "~@usestrider/browser/Deferred/ReadonlyDeferred"

/**
 * A result that someone else completes, and that you can only read.
 *
 * **Details**
 *
 * Covariant in both parameters, like `Queue.Dequeue`, so a `ReadonlyDeferred<Page>` is usable wherever a
 * `ReadonlyDeferred<ObservedPage>` is expected.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReadonlyDeferred<out A, out E = never> extends Pipeable.Pipeable {
  readonly [TypeId]: {
    readonly _A: Types.Covariant<A>
    readonly _E: Types.Covariant<E>
  }
}

declare const _await: <A, E>(self: ReadonlyDeferred<A, E>) => Effect.Effect<A, E>

export {
  /**
   * Waits for the result, suspending the fiber until it is completed.
   *
   * **Details**
   *
   * For an event wait, the library completes the deferred with the match, with `TargetGone` as soon as its
   * owner ends, or with `Timeout` at the deadline that was in force at `next`.
   *
   * @stability experimental
   * @category getters
   * @since 0.1.0
   */
  _await as await
}

/**
 * Returns the result if it is already completed, without waiting.
 *
 * @stability experimental
 * @category getters
 * @since 0.1.0
 */
export declare const poll: <A, E>(self: ReadonlyDeferred<A, E>) => Effect.Effect<Option.Option<Effect.Effect<A, E>>>

/**
 * Checks whether the result is completed, without waiting.
 *
 * @stability experimental
 * @category getters
 * @since 0.1.0
 */
export declare const isDone: <A, E>(self: ReadonlyDeferred<A, E>) => Effect.Effect<boolean>

/**
 * Checks whether a value is a `ReadonlyDeferred`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isReadonlyDeferred = (u: unknown): u is ReadonlyDeferred<unknown, unknown> =>
  Predicate.hasProperty(u, TypeId)
