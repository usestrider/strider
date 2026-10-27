/**
 * Pages opened by another page, such as with `window.open` or a `target="_blank"` link.
 *
 * A popup comes with its opener's access: waiting on a `Page` gives a `Page`, and waiting on an observed page gives
 * an observed one. Seeing a popup doesn't make it yours: it belongs to the scope that owns its opener, which closes
 * it. A popup is reported as soon as it appears, before it loads, so a handler or a route registered on it then is
 * in place for its first document. `next`, `history` and the context's `pages` give the same `Page` for it.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
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

// ── Implementation ──

type Behind = Handles.Behind<Model.PageEntry>

const accepts =
  (_behind: Behind, matches: Option.Option<(url: string) => boolean>) => (entry: Events.Entry<Model.PopupEvent>) =>
    Option.isNone(matches) || (Option.isSome(entry.value.url) && matches.value(entry.value.url.value))

// A popup is delivered as its handle: a `Page` when the connection controls it for life, as it does an owned page's
// popups, and an observed page otherwise, `LeaveOpen`
const kind = (behind: Behind, operation: string): Events.Kind<Model.PopupEvent, Page.Page> => ({
  operation,
  noun: "a popup",
  deliver: (event) => behind.runtime.observed(event.page) as Page.Page
})

/** Compiles the filter, failing with `InvalidInput` for a pattern that doesn't, then subscribes or reads. */
const subscribe = <A, R>(
  target: Page.ObservedPage,
  filter: Filter | undefined,
  operation: string,
  subscribe: (behind: Behind, matches: Option.Option<(url: string) => boolean>) => Effect.Effect<A, never, R>
): Effect.Effect<A, Subscription.SubscriptionError, R> =>
  Effect.suspend(() => {
    const behind = Handles.page(target)
    // A backend that can't say which page opened a page reports no popups (QUIRKS.md, Q212)
    return Filters.requires(behind.runtime, operation, "popups.opener").pipe(
      Effect.andThen(Filters.url(operation, filter?.url)),
      Effect.flatMap((matches) => subscribe(behind, matches))
    )
  })

/**
 * Subscribes to the popups a page opens and returns the wait: an effect that gives the first match, with its
 * opener's access, the same each time it runs.
 *
 * **Example** (A popup with a dialog inside it)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Dialog, Page, Popup } from "@usestrider/browser"
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
} = (<PE, PR>(
  target: Page.ObservedPage,
  filter?: Filter,
  where?: Subscription.Where<Page.Page, PE, PR>
) =>
  subscribe(
    target,
    filter,
    "Popup.next",
    (behind, matches) =>
      Events.next(kind(behind, "Popup.next"), behind.entry.events.popup, accepts(behind, matches), where)
  ).pipe(
    Operation.named("Popup.next")
  )) as typeof next

/**
 * Subscribes to the popups a page opens and emits every match from now on.
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
} = (<PE, PR>(
  target: Page.ObservedPage,
  filter?: Filter,
  where?: Subscription.Where<Page.Page, PE, PR>
) =>
  subscribe(
    target,
    filter,
    "Popup.stream",
    (behind, matches) =>
      Events.stream(kind(behind, "Popup.stream"), behind.entry.events.popup, accepts(behind, matches), where)
  )) as typeof stream

/**
 * Reads the popups still in the page's event log; never waits.
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
} = ((target: Page.ObservedPage, filter?: Filter) =>
  subscribe(
    target,
    filter,
    "Popup.history",
    (behind, matches) =>
      Events.history(kind(behind, "Popup.history"), behind.entry.events.popup, accepts(behind, matches))
  )) as typeof history
