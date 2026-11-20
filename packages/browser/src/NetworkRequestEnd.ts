/**
 * The ends of the requests a page or a context makes: each request hop either finishes, with whatever HTTP
 * status it had, or fails, with the browser's error text. Each end is a `NetworkRequest.End`.
 *
 * An end is reported to the request's page and its context, as the request itself is. Only an end the browser
 * reports is an event: a request still in flight when its page, context or browser connection closes reports none.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as NetworkRequestEndImpl from "./internal/networkRequestEnd.ts"
import type * as NetworkRequest from "./NetworkRequest.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Which request ends to match: the request's own fields, as `NetworkRequest.Filter` takes them, and how it ended.
 *
 * **Example** (Matching failed API calls)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequestEnd } from "@usestrider/browser"
 *
 * const failedApiCalls: NetworkRequestEnd.Filter = {
 *   url: "https://shop.example.com/api/**",
 *   resourceType: "fetch",
 *   end: "failed"
 * }
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter extends NetworkRequest.Filter {
  /**
   * Match requests that ended this way.
   *
   * @default either way
   */
  readonly end?: "finished" | "failed" | ReadonlyArray<"finished" | "failed"> | undefined
}

/**
 * Subscribes to request ends and returns the wait: an effect whose value is the first match, the same each time
 * it runs.
 *
 * **Details**
 *
 * `url` is required here, unlike in `stream` and `history`. Only ends that happen after this returns match.
 *
 * **Example** (Waiting for the order request to finish)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequestEnd, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const placeOrder = Effect.fn("placeOrder")(function*(page: Page.Page) {
 *   const ended = yield* NetworkRequestEnd.next(page, {
 *     url: "https://shop.example.com/api/orders"
 *   })
 *   yield* page.getByRole("button", { name: "Place order" }).click()
 *   const end = yield* ended
 *   return end._tag === "Failed" ? end.failure.errorText : "finished"
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: Filter & { readonly url: Url.Pattern | string },
  where?: Subscription.Where<NetworkRequest.End, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<NetworkRequest.End, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => NetworkRequestEndImpl.next(target, filter, where)

/**
 * Subscribes to request ends and emits every match from now on.
 *
 * **Example** (Logging failed requests until the page closes)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequestEnd, Page } from "@usestrider/browser"
 * import { Console, Effect, Stream } from "effect"
 *
 * const logFailures = Effect.fn("logFailures")(function*(page: Page.ObservedPage) {
 *   const failed = yield* NetworkRequestEnd.stream(page, { end: "failed" })
 *   yield* failed.pipe(
 *     Stream.runForEach((end) =>
 *       Console.log(end.request.url, end._tag === "Failed" ? end.failure.errorText : "")
 *     ),
 *     Effect.forkScoped
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<NetworkRequest.End, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<NetworkRequest.End, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => NetworkRequestEndImpl.stream(target, filter, where)

/**
 * Reads the request ends the target's event log kept (`UserContext.Options.eventLog`); never waits.
 *
 * **Example** (Counting the requests that failed)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequestEnd, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const countFailures = Effect.fn("countFailures")(function*(page: Page.ObservedPage) {
 *   const failed = yield* NetworkRequestEnd.history(page, { end: "failed" })
 *   return failed.entries.length
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<NetworkRequest.End>, Subscription.SubscriptionError> =>
  NetworkRequestEndImpl.history(target, filter)
