/**
 * Pages opened by another page, such as with `window.open` or a `target="_blank"` link.
 *
 * A popup arrives with its opener's access: waiting on a `Page` gives a `Page`, and waiting on an observed
 * page gives an observed one. Seeing a popup acquires nothing, because it belongs to the scope that acquired
 * its opener.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"

/**
 * Which popups to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match popups whose first URL matches this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
}

/**
 * Subscribes to the popups a page opens and returns the first match, latched, with the opener's access.
 *
 * **Example** (A popup with a dialog inside it)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Deferred, Dialog, Page, Popup } from "@usestrider/browser"
 *
 * const connect = Effect.fn("connect")(function*(page: Page.Page) {
 *   const popups = yield* Popup.next(page)
 *   yield* page.getByText("Connect account").click()
 *   const popup = yield* Deferred.await(popups)
 *   yield* Dialog.handle(popup, Dialog.acceptAll)
 *   yield* popup.getByRole("button", { name: "Allow" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: {
  <PE = never, PR = never>(
    target: Page.Page,
    filter?: Filter | undefined,
    where?: Subscription.Where<Page.Page, PE, PR> | undefined
  ): Effect.Effect<
    Deferred.ReadonlyDeferred<Page.Page, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage,
    filter?: Filter | undefined,
    where?: Subscription.Where<Page.ObservedPage, PE, PR> | undefined
  ): Effect.Effect<
    Deferred.ReadonlyDeferred<Page.ObservedPage, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
}

/**
 * Subscribes to the popups a page opens and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: {
  <PE = never, PR = never>(
    target: Page.Page,
    filter?: Filter | undefined,
    where?: Subscription.Where<Page.Page, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<Page.Page, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage,
    filter?: Filter | undefined,
    where?: Subscription.Where<Page.ObservedPage, PE, PR> | undefined
  ): Effect.Effect<
    Stream.Stream<Page.ObservedPage, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
}

/**
 * Reads the popups a page's log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: {
  (target: Page.Page, filter?: Filter | undefined): Effect.Effect<Subscription.History<Page.Page>>
  (target: Page.ObservedPage, filter?: Filter | undefined): Effect.Effect<Subscription.History<Page.ObservedPage>>
}
