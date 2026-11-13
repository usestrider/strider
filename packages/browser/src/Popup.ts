/**
 * Pages opened by another page, such as with `window.open` or a `target="_blank"` link.
 *
 * A popup has its opener's access: waiting on a `Page` gives a `Page`, and on an observed page an observed one. It
 * belongs to the scope that owns its opener, and closes when that scope does. It is reported as soon as it appears,
 * before it loads, so a handler or route registered on it at once is in place for its first document. `next`,
 * `history`, and the context's `pages` give the same `Page` for it.
 *
 * On a backend without the `popups.opener` capability, such as WebKit, `next`, `stream`, and `history` fail with
 * `Unsupported`, because the browser doesn't say which page opened another; wait for the new page in the context's
 * `pages` instead.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as PopupImpl from "./internal/popup.ts"
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
   * Match popups whose first URL matches this pattern: the URL of the popup's first navigation, which every
   * browser reports after the popup appears. A popup that never navigates matches no pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
}

/**
 * Subscribes to the popups a page opens and returns the wait: an effect that gives the first match, with its
 * opener's access, the same each time it runs.
 *
 * **Gotchas**
 *
 * On a backend without the `popups.opener` capability, such as WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (A popup with a dialog inside it)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Page, Popup } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const connect = Effect.fn("connect")(function*(page: Page.Page) {
 *   const popups = yield* Popup.next(page)
 *   yield* page.getByText("Connect account").click()
 *   const popup = yield* popups
 *   yield* Dialog.handle(popup, Dialog.acceptAll)
 *   yield* popup.getByRole("button", { name: "Allow" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next: {
  <PE = never, PR = never>(
    target: Page.Page,
    filter?: Filter | undefined,
    where?: Subscription.Where<Page.Page, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<Page.Page, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  <PE = never, PR = never>(
    target: Page.ObservedPage,
    filter?: Filter | undefined,
    where?: Subscription.Where<Page.ObservedPage, PE, PR> | undefined
  ): Effect.Effect<
    Effect.Effect<Page.ObservedPage, PE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
} = PopupImpl.next as typeof next

/**
 * Subscribes to the popups a page opens and emits every match from now on.
 *
 * **Gotchas**
 *
 * On a backend without the `popups.opener` capability, such as WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (Closing every popup a page opens)
 *
 * ```ts import.meta.vitest
 * import { Page, Popup } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const closePopups = Effect.fn("closePopups")(function*(page: Page.Page) {
 *   const popups = yield* Popup.stream(page)
 *   yield* popups.pipe(Stream.runForEach((popup) => popup.close()), Effect.forkScoped)
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream: {
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
} = PopupImpl.stream as typeof stream

/**
 * Reads the popups still in the page's event log; never waits.
 *
 * **Gotchas**
 *
 * On a backend without the `popups.opener` capability, such as WebKit, it fails with `SubscriptionError`, reason
 * `Unsupported`.
 *
 * **Example** (The URL of the last popup)
 *
 * ```ts import.meta.vitest
 * import { Page, Popup } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const lastPopupUrl = Effect.fn("lastPopupUrl")(function*(page: Page.Page) {
 *   const popups = yield* Popup.history(page)
 *   const last = popups.entries.at(-1)
 *   return last === undefined ? undefined : yield* last.url
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history: {
  (
    target: Page.Page,
    filter?: Filter | undefined
  ): Effect.Effect<Subscription.History<Page.Page>, Subscription.SubscriptionError>
  (
    target: Page.ObservedPage,
    filter?: Filter | undefined
  ): Effect.Effect<Subscription.History<Page.ObservedPage>, Subscription.SubscriptionError>
} = PopupImpl.history as typeof history
