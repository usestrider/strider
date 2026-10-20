/**
 * Errors a page or its workers threw and didn't catch, and promise rejections nothing handled.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * One uncaught error or unhandled rejection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class UncaughtException extends Schema.Class<UncaughtException>("@usestrider/browser/UncaughtException")({
  kind: Schema.Literals(["thrown", "unhandledRejection"]),
  name: Schema.String,
  message: Schema.String,
  stack: Schema.Option(Schema.String),
  origin: Target.EventOrigin,
  at: MonotonicInstant.MonotonicInstant
}) {}

/**
 * Which uncaught exceptions to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match exceptions whose message contains this string or matches this expression.
   *
   * @default any message
   */
  readonly message?: string | RegExp | undefined
}

/**
 * Subscribes to uncaught exceptions and returns the first match, latched.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<UncaughtException, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<UncaughtException, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to uncaught exceptions and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<UncaughtException, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<UncaughtException, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the uncaught exceptions a log retained; never waits.
 *
 * **Example** (Errors so far, and whether the log dropped any)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page, UncaughtException } from "@usestrider/browser"
 *
 * const errorsSoFar = Effect.fn("errorsSoFar")(function*(page: Page.ObservedPage) {
 *   const errors = yield* UncaughtException.history(page)
 *   return { count: errors.entries.length, dropped: errors.dropped }
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<UncaughtException>>
