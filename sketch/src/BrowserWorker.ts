/**
 * Workers: dedicated workers of a page, and shared and service workers of a context.
 *
 * Like popups, a worker arrives with its owner's access: waiting on a `Page` or a `UserContext` gives a
 * `BrowserWorker` you can evaluate in, and waiting on something you only observe gives an observed one.
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
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as JSHandle from "./JSHandle.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Which kind of worker.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Kind = "dedicated" | "shared" | "service"

const TypeId = "~effect-browser/BrowserWorker"

/**
 * A worker you can observe but not evaluate in.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObservedBrowserWorker extends Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  /**
   * The worker's realm; fixed.
   */
  readonly realm: Target.RealmId
  /**
   * Which kind of worker; fixed.
   */
  readonly kind: Kind
  /**
   * The worker's script URL; fixed, because a worker's script never changes.
   */
  readonly url: Url.Url
  /**
   * Waits as long as the worker lives, then gives the reason it ended.
   */
  readonly closed: Effect.Effect<Target.CloseReason>
}

/**
 * A worker you can evaluate in.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BrowserWorker extends ObservedBrowserWorker {
  /**
   * Calls `fn` in the worker and returns the result by value.
   *
   * **Details**
   *
   * Workers have no isolated world, so evaluating in one needs control of its owner.
   */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<B>, BrowserWorkerError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Checks whether a value is a worker.
 *
 * **Gotchas**
 *
 * This identifies the kind, not the access: it narrows to `ObservedBrowserWorker`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isBrowserWorker = (u: unknown): u is ObservedBrowserWorker => Predicate.hasProperty(u, TypeId)

/**
 * Which workers to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match workers whose script URL matches this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
  /**
   * Match workers of this kind.
   *
   * @default any kind
   */
  readonly kind?: Kind | undefined
}

/**
 * Subscribes to workers and returns the first match, latched, with its owner's access.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: {
  <PE = never, PR = never>(
    target: Page.Page | UserContext.UserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<BrowserWorker, PE, PR> | undefined
  ): Effect.Effect<
    Deferred.ReadonlyDeferred<BrowserWorker, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<ObservedBrowserWorker, PE, PR> | undefined
  ): Effect.Effect<
    Deferred.ReadonlyDeferred<ObservedBrowserWorker, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
}

/**
 * Subscribes to workers and emits every match from now on, with their owner's access.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: {
  <PE = never, PR = never>(
    target: Page.Page | UserContext.UserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<BrowserWorker, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<BrowserWorker, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<ObservedBrowserWorker, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<ObservedBrowserWorker, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
}

/**
 * Reads the workers a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: {
  (
    target: Page.Page | UserContext.UserContext,
    filter?: Filter | undefined
  ): Effect.Effect<Subscription.History<BrowserWorker>>
  (
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: Filter | undefined
  ): Effect.Effect<Subscription.History<ObservedBrowserWorker>>
}

/**
 * Schema for the reasons evaluating in a worker can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowserWorkerErrorReason = Schema.Union([
  Reason.EvaluationThrown,
  Reason.NotSerializable,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons evaluating in a worker can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BrowserWorkerErrorReason = typeof BrowserWorkerErrorReason.Type

const BrowserWorkerErrorTypeId = "~effect-browser/BrowserWorker/BrowserWorkerError"

/**
 * Error for an evaluation in a worker that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class BrowserWorkerError extends Schema.TaggedError<BrowserWorkerError>(BrowserWorkerErrorTypeId)(
  "BrowserWorkerError",
  {
    reason: BrowserWorkerErrorReason,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [BrowserWorkerErrorTypeId] = BrowserWorkerErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `BrowserWorkerError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isBrowserWorkerError = (u: unknown): u is BrowserWorkerError =>
  Predicate.hasProperty(u, BrowserWorkerErrorTypeId)
