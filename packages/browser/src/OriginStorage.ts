/**
 * `localStorage` and `sessionStorage`, for the origin of a page's current document.
 *
 * Both belong to their page (`page.localStorage`, `page.sessionStorage`), and act on whatever origin the page is on
 * when the operation runs. Reading needs inspect access, and writing needs control. A document whose origin is
 * opaque, such as a `data:` URL's, has no storage: operations on it fail with `BackendFailure`.
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
import * as ReasonCause from "./internal/reasonCause.ts"
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
   *
   * **Example** (Reading the whole `localStorage`)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const storedSettings = Effect.fn("storedSettings")(function*(page: Page.ReadonlyPage) {
   *   const entries = yield* page.localStorage.entries
   *   return Object.fromEntries(entries)
   * })
   * ```
   */
  readonly entries: Effect.Effect<
    ReadonlyArray<readonly [key: string, value: string]>,
    OriginStorageError | Target.TargetGone | Deadline.Timeout
  >
  /**
   * The value for `key`, or `None` when it is absent.
   *
   * **Example** (Checking for a stored flag)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Option } from "effect"
   *
   * const sawTour = Effect.fn("sawTour")(function*(page: Page.ReadonlyPage) {
   *   const seen = yield* page.localStorage.get("tour-seen")
   *   return Option.isSome(seen)
   * })
   * ```
   */
  get(key: string): Effect.Effect<Option.Option<string>, OriginStorageError | Target.TargetGone | Deadline.Timeout>
}

/**
 * One origin's storage area, readable and writable.
 *
 * **Example** (Reading and writing a preference)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
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
   * Sets a value. A change, not a declaration: it isn't undone when a scope closes. A value over the origin's quota
   * fails with `InvalidInput`.
   *
   * **Example** (Signing in with a stored token)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Config, Effect } from "effect"
   *
   * const signInWithToken = Effect.fn("signInWithToken")(function*(page: Page.Page) {
   *   yield* page.goto("https://app.example.com")
   *   yield* page.localStorage.set("auth-token", yield* Config.Redacted("APP_TOKEN"))
   *   yield* page.reload()
   * })
   * ```
   */
  set(
    key: string,
    value: string | Redacted.Redacted<string>
  ): Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes a key.
   *
   * **Example** (Showing the cookie banner again)
   *
   * ```ts import.meta.vitest
   * import { Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const askAgain = Effect.fn("askAgain")(function*(page: Page.Page) {
   *   yield* page.localStorage.remove("cookie-consent")
   *   yield* page.reload()
   *   yield* page.getByRole("dialog", { name: "Cookies" }).pipe(Expect.toBeVisible)
   * })
   * ```
   */
  remove(key: string): Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes every key.
   *
   * **Example** (Starting the checkout over)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const restartCheckout = Effect.fn("restartCheckout")(function*(page: Page.Page) {
   *   yield* page.sessionStorage.clear
   *   yield* page.goto("https://shop.example.com/checkout")
   * })
   * ```
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
 * **Example** (Skipping a value over the quota)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const cacheCatalog = Effect.fn("cacheCatalog")(
 *   function*(page: Page.Page, catalog: string) {
 *     yield* page.localStorage.set("catalog", catalog).pipe(
 *       Effect.catchReason(
 *         "OriginStorageError",
 *         "InvalidInput",
 *         (reason) => Effect.logWarning(`The catalog wasn't stored: ${reason.hint}`)
 *       )
 *     )
 *   }
 * )
 * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
