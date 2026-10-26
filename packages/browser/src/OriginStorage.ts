/**
 * `localStorage` and `sessionStorage` of a page's current document's origin.
 *
 * Both are sub-handles bound to their page (`page.localStorage`, `page.sessionStorage`). They act on whatever
 * origin the page is on when the operation runs. Reading needs inspect access, and writing needs control.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

/**
 * One origin's storage area, readable only.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadonlyOriginStorage {
  /**
   * Every key and value, in storage order.
   */
  readonly entries: Effect.Effect<
    ReadonlyArray<readonly [key: string, value: string]>,
    OriginStorageError | Target.TargetGone | Deadline.Timeout
  >
  /**
   * The value for `key`, or `None` when it is absent.
   */
  get(key: string): Effect.Effect<Option.Option<string>, OriginStorageError | Target.TargetGone | Deadline.Timeout>
}

/**
 * One origin's storage area, readable and writable.
 *
 * **Example** (Reading and writing a preference)
 *
 * ```ts import.meta.vitest
 * import { Effect, Option } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const useDarkTheme = Effect.fn("useDarkTheme")(function*(page: Page.Page) {
 *   const theme = yield* page.localStorage.get("theme")
 *   yield* page.localStorage.set("theme", "dark")
 *   return Option.getOrElse(theme, () => "light")
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OriginStorage extends ReadonlyOriginStorage {
  /**
   * Sets a value. A change, not a declaration: it isn't undone when a scope closes.
   */
  set(
    key: string,
    value: string | Redacted.Redacted<string>
  ): Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes a key.
   */
  remove(key: string): Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes every key.
   */
  readonly clear: Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Schema for the reasons an origin storage operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OriginStorageErrorReason = Schema.Union([
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons an origin storage operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type OriginStorageErrorReason = typeof OriginStorageErrorReason.Type

const OriginStorageErrorTypeId = "~@usestrider/browser/OriginStorage/OriginStorageError"

/**
 * Error for an origin storage operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class OriginStorageError extends Schema.TaggedError<OriginStorageError>(OriginStorageErrorTypeId)(
  "OriginStorageError",
  {
    operation: Schema.String,
    reason: OriginStorageErrorReason,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [OriginStorageErrorTypeId] = OriginStorageErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is an `OriginStorageError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isOriginStorageError = (u: unknown): u is OriginStorageError =>
  Predicate.hasProperty(u, OriginStorageErrorTypeId)
