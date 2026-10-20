/**
 * Values that cross into and out of the page.
 *
 * A function's result crosses by value, and `Serialized<A>` is what actually arrives. It is defined once,
 * next to the serializer, which is the same on every backend (BiDi's remote-value types), so the type says
 * what arrives: a `Date` survives, a class instance arrives as its data, and a DOM node doesn't cross at all.
 * Handles are the opt-in alternative: references to values that stay in one realm, owned by the caller's
 * scope.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

declare const NotSerializableTypeId: unique symbol

/**
 * A compile error with a message: the type can't cross by value.
 *
 * **Details**
 *
 * It appears inside `Serialized<A>` where `A` contains something that can't cross, so the error names the
 * fix, such as "DOM nodes don't cross by value; use evaluateHandle".
 *
 * @stability unstable
 * @category utility types
 * @since 0.1.0
 */
export interface NotSerializable<Message extends string> {
  readonly [NotSerializableTypeId]: Message
}

/**
 * What arrives when a value of type `A` crosses out of the page by value.
 *
 * **Details**
 *
 * - Primitives, `Date` and `RegExp` arrive as themselves.
 * - Maps, sets and arrays arrive as mutable copies with serialized contents.
 * - Functions and symbols are dropped, including methods on objects.
 * - Class instances arrive as plain objects with their data fields.
 * - DOM nodes are a compile error; use `evaluateHandle`.
 *
 * @stability unstable
 * @category utility types
 * @since 0.1.0
 */
export type Serialized<A> = A extends string | number | boolean | bigint | null | undefined | Date | RegExp ? A
  : A extends ReadonlyMap<infer K, infer V> ? Map<Serialized<K>, Serialized<V>>
  : A extends ReadonlySet<infer T> ? Set<Serialized<T>>
  : A extends ReadonlyArray<infer T> ? Array<Serialized<T>>
  : A extends Node ? NotSerializable<"DOM nodes don't cross by value; use evaluateHandle">
  : A extends Function | symbol ? never
  : { [K in keyof A as A[K] extends Function | symbol ? never : K]: Serialized<A[K]> }

const TypeId = "~effect-browser/JSHandle"

/**
 * A reference to a value that stays in one realm.
 *
 * **Details**
 *
 * A handle is owned by the scope that acquired it and released with it, in batches unless the realm already
 * ended. Using it after its realm ends fails with `TargetGone` (`RealmDestroyed`).
 *
 * **Example** (Reading from a DOM node)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "effect-browser"
 *
 * const bodyTag = Effect.fn("bodyTag")(function*(page: Page.Page) {
 *   const body = yield* page.evaluateHandle(() => document.body)
 *   return yield* body.evaluate((element) => element.tagName)
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface JSHandle<A = unknown> extends Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  /**
   * The realm the value lives in; fixed, because a handle never moves between realms.
   */
  readonly realm: Target.RealmId
  /**
   * Calls `fn` in the handle's realm, with the value as its first argument, and returns the result by value.
   */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<Serialized<B>, JSHandleError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the handle's realm and returns its result as another handle.
   */
  evaluateHandle<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle<Awaited<B>>, JSHandleError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  /**
   * The value itself, by value.
   */
  readonly read: Effect.Effect<Serialized<A>, JSHandleError | Target.TargetGone | Deadline.Timeout>
  /**
   * Releases the handle early. Idempotent; the scope's finalizer becomes a no-op.
   */
  readonly release: Effect.Effect<void>
}

/**
 * Checks whether a value is a `JSHandle`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isJSHandle = (u: unknown): u is JSHandle => Predicate.hasProperty(u, TypeId)

/**
 * Schema for the reasons a handle operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const JSHandleErrorReason = Schema.Union([
  Reason.EvaluationThrown,
  Reason.NotSerializable,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a handle operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type JSHandleErrorReason = typeof JSHandleErrorReason.Type

const JSHandleErrorTypeId = "~effect-browser/JSHandle/JSHandleError"

/**
 * Error for a handle operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class JSHandleError extends Schema.TaggedError<JSHandleError>(JSHandleErrorTypeId)("JSHandleError", {
  operation: Schema.String,
  reason: JSHandleErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [JSHandleErrorTypeId] = JSHandleErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `JSHandleError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isJSHandleError = (u: unknown): u is JSHandleError => Predicate.hasProperty(u, JSHandleErrorTypeId)
