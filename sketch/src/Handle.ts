/**
 * Values that cross into and out of the page.
 *
 * `Serialized<A>` is what actually arrives when a function's result crosses by value. It is defined once,
 * next to our serializer, which is the same on every backend (BiDi's remote-value types), so the type says
 * what arrives. Handles are the opt-in alternative: references into one realm, owned by the caller's scope.
 */
import type { Effect, Scope } from "effect"
import type { RealmId } from "./Brand.ts"
import type { EvaluationError, TargetGone, Timeout } from "./Errors.ts"

declare const NotSerializableTypeId: unique symbol
/** A compile error with a message: the type can't cross by value. */
export interface NotSerializable<Message extends string> { readonly [NotSerializableTypeId]: Message }

export type Serialized<A> =
  A extends string | number | boolean | bigint | null | undefined | Date | RegExp ? A
  : A extends ReadonlyMap<infer K, infer V> ? Map<Serialized<K>, Serialized<V>>
  : A extends ReadonlySet<infer T> ? Set<Serialized<T>>
  : A extends ReadonlyArray<infer T> ? Array<Serialized<T>>
  : A extends Node ? NotSerializable<"DOM nodes don't cross by value; use evaluateHandle">
  : A extends Function | symbol ? never
  : { [K in keyof A as A[K] extends Function | symbol ? never : K]: Serialized<A[K]> }   // class instances arrive as their data

/**
 * A reference to a value in one realm. Owned by the scope that acquired it and released with it, in batches
 * unless the realm already ended. Using it after its realm ends fails with `TargetGone{RealmDestroyed}`.
 * (New in the sketch: API.md only named `JSHandle`.)
 */
export interface JSHandle<A = unknown> {
  readonly realm: RealmId                               // fixed: a handle never moves between realms
  /** Calls `fn` in the handle's realm with the value as its first argument. */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args
  ): Effect.Effect<Serialized<B>, EvaluationError | TargetGone | Timeout>
  evaluateHandle<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args
  ): Effect.Effect<JSHandle<Awaited<B>>, EvaluationError | TargetGone | Timeout, Scope.Scope>
  /** The value itself, by value. */
  readonly read: Effect.Effect<Serialized<A>, EvaluationError | TargetGone | Timeout>
  /** Early release; idempotent, and the scope's finalizer becomes a no-op. */
  readonly release: Effect.Effect<void>
}
