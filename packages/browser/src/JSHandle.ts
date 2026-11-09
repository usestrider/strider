/**
 * Handles to values in the page, and the type of what an evaluation returns by value.
 *
 * An evaluated function's result comes back by value, and `Serialized<A>` is the type of what arrives, the same on
 * every backend: a `Date` survives, a class instance arrives as its data and a DOM node doesn't come back at all.
 * A handle is the alternative you opt into: a reference to a value that stays in the page, in one realm, released
 * when the caller's scope closes.
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
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

declare const NotSerializableTypeId: unique symbol

/**
 * A compile error with a message, for a type that can't cross by value.
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

const TypeId = "~@usestrider/browser/JSHandle"

/**
 * A reference to a value that stays in one realm.
 *
 * **Details**
 *
 * A handle belongs to the scope that acquired it, and is released when that scope closes, in one command with the
 * scope's other handles in its realm. Using it after its realm ends fails with `TargetGone` (`RealmDestroyed`).
 *
 * **Example** (Reading from a DOM node)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
   *
   * **Details**
   *
   * Arguments cross by value: undefined, null, strings, numbers (including NaN, -0 and infinities), booleans,
   * bigints, Date, RegExp, Map and Set retain their types recursively inside arrays and objects. Objects copy
   * their own enumerable string keys.
   * Handles passed as arguments refer to their existing values in the same realm. These argument rules are
   * separate from `JSHandle.Serialized`, which describes the returned value.
   *
   * **Example** (Passing an argument)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const hasClass = Effect.fn("hasClass")(function*(page: Page.Page, name: string) {
   *   const body = yield* page.evaluateHandle(() => document.body)
   *   return yield* body.evaluate(
   *     (element, className) => element.classList.contains(className),
   *     name
   *   )
   * })
   * ```
   */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<Serialized<B>, JSHandleError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the handle's realm and returns its result as another handle.
   *
   * **Example** (Following a reference)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const searchAction = Effect.fn("searchAction")(function*(page: Page.Page) {
   *   const body = yield* page.evaluateHandle(() => document.body)
   *   const form = yield* body.evaluateHandle((element) =>
   *     element.querySelector("form[role=search]")
   *   )
   *   return yield* form.evaluate((element) => element?.getAttribute("action") ?? "")
   * })
   * ```
   */
  evaluateHandle<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle<Awaited<B>>, JSHandleError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  /**
   * The value itself, by value.
   *
   * **Example** (Reading what the page collected)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const typedValues = Effect.fn("typedValues")(function*(page: Page.Page) {
   *   const values = yield* page.evaluateHandle(() => {
   *     const seen: Array<string> = []
   *     document.addEventListener(
   *       "input",
   *       (event) => seen.push((event.target as HTMLInputElement).value)
   *     )
   *     return seen
   *   })
   *   yield* page.getByLabel("Quantity").fill("3")
   *   return yield* values.read
   * })
   * ```
   */
  readonly read: Effect.Effect<Serialized<A>, JSHandleError | Target.TargetGone | Deadline.Timeout>
  /**
   * Releases the handle before its scope closes. Releasing it again does nothing, and neither does the scope when
   * it closes.
   *
   * **Example** (Releasing a handle early)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const bodyText = Effect.fn("bodyText")(function*(page: Page.Page) {
   *   const body = yield* page.evaluateHandle(() => document.body)
   *   const text = yield* body.evaluate((element) => element.innerText)
   *   yield* body.release
   *   return text
   * })
   * ```
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

const JSHandleErrorTypeId = "~@usestrider/browser/JSHandle/JSHandleError"

/**
 * Error for a handle operation that failed.
 *
 * **Example** (Falling back when the page's code throws)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const pageConfig = Effect.fn("pageConfig")(function*(page: Page.Page) {
 *   const body = yield* page.evaluateHandle(() => document.body)
 *   const parsed = body.evaluate((element): Record<string, string> =>
 *     JSON.parse(element.dataset["config"] ?? "")
 *   )
 *   return yield* parsed.pipe(
 *     Effect.catchReason("JSHandleError", "EvaluationThrown", () => Effect.succeed({}))
 *   )
 * })
 * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
