/**
 * Workers that pages and contexts start: a page's dedicated workers, and a context's shared and service workers.
 *
 * A worker has its owner's access: waiting on a `Page` or a `UserContext` gives a `BrowserWorker` you can evaluate
 * in, and waiting on a page or context you only observe gives an `ObservedBrowserWorker`.
 *
 * A worker is reported when it starts: a dedicated worker to its page and context, and a shared or service worker
 * to its context. Shared and service workers are reported on Chromium only; asking for them on Firefox or WebKit
 * fails with `Unsupported` (`workers.shared`, `workers.service`).
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as BrowserWorkerImpl from "./internal/browserWorker.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
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

const TypeId = "~@usestrider/browser/BrowserWorker"

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
   *
   * **Example** (Logging when a worker ends)
   *
   * ```ts import.meta.vitest
   * import { BrowserWorker } from "@usestrider/browser"
   * import { Console, Effect } from "effect"
   *
   * const watchWorker = Effect.fn("watchWorker")(
   *   function*(worker: BrowserWorker.ObservedBrowserWorker) {
   *     const reason = yield* worker.closed
   *     yield* Console.log(`${worker.url} ended: ${reason._tag}`)
   *   }
   * )
   * ```
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
   *
   * **Example** (Reading each worker's user agent)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const workerAgents = Effect.fn("workerAgents")(function*(page: Page.Page) {
   *   const workers = yield* page.workers
   *   return yield* Effect.forEach(
   *     workers,
   *     (worker) => worker.evaluate(() => navigator.userAgent)
   *   )
   * })
   * ```
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
   * Match workers of this kind. On a page, only `"dedicated"`: shared and service workers belong to the context,
   * and asking a page for them fails with `InvalidInput`.
   *
   * @default any kind
   */
  readonly kind?: Kind | undefined
}

/**
 * Subscribes to workers and returns the wait: an effect that gives the first match, with its owner's access, and
 * gives the same worker each time it runs.
 *
 * **Example** (Waiting for the search worker)
 *
 * ```ts import.meta.vitest
 * import { BrowserWorker, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const searchWorker = Effect.fn("searchWorker")(function*(page: Page.Page) {
 *   const started = yield* BrowserWorker.next(page, {
 *     url: "https://shop.example.com/workers/*"
 *   })
 *   yield* page.goto("https://shop.example.com/search")
 *   return yield* started
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next: {
  <PE = never, PR = never>(
    target: Page.Page | UserContext.UserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<BrowserWorker, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<BrowserWorker, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: Filter | undefined,
    where?: Subscription.Where<ObservedBrowserWorker, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<ObservedBrowserWorker, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
} = BrowserWorkerImpl.next as typeof next

/**
 * Subscribes to workers and returns a stream of every match from now on, with their owner's access.
 *
 * **Example** (Logging service workers as they start)
 *
 * ```ts import.meta.vitest
 * import { BrowserWorker, UserContext } from "@usestrider/browser"
 * import { Console, Effect, Stream } from "effect"
 *
 * const logServiceWorkers = Effect.fn("logServiceWorkers")(
 *   function*(context: UserContext.UserContext) {
 *     const workers = yield* BrowserWorker.stream(context, { kind: "service" })
 *     yield* workers.pipe(
 *       Stream.runForEach((worker) => Console.log(`service worker ${worker.url}`)),
 *       Effect.forkScoped
 *     )
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream: {
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
} = BrowserWorkerImpl.stream as typeof stream

/**
 * Reads the workers already reported, from the page's or context's event log; never waits.
 *
 * **Example** (Listing the workers a page started)
 *
 * ```ts import.meta.vitest
 * import { BrowserWorker, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const workerScripts = Effect.fn("workerScripts")(function*(page: Page.ObservedPage) {
 *   const history = yield* BrowserWorker.history(page)
 *   return history.entries.map((worker) => worker.url)
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history: {
  (
    target: Page.Page | UserContext.UserContext,
    filter?: Filter | undefined
  ): Effect.Effect<Subscription.History<BrowserWorker>, Subscription.SubscriptionError>
  (
    target: Page.ObservedPage | UserContext.ObservedUserContext,
    filter?: Filter | undefined
  ): Effect.Effect<Subscription.History<ObservedBrowserWorker>, Subscription.SubscriptionError>
} = BrowserWorkerImpl.history as typeof history

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

const BrowserWorkerErrorTypeId = "~@usestrider/browser/BrowserWorker/BrowserWorkerError"

/**
 * Error for an evaluation in a worker that failed.
 *
 * **Example** (Falling back when the worker's code throws)
 *
 * ```ts import.meta.vitest
 * import { BrowserWorker } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const cacheNames = Effect.fn("cacheNames")(
 *   function*(worker: BrowserWorker.BrowserWorker) {
 *     return yield* worker.evaluate(() => caches.keys()).pipe(
 *       Effect.catchReason(
 *         "BrowserWorkerError",
 *         "EvaluationThrown",
 *         () => Effect.succeed([])
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
