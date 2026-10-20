/**
 * Navigations of a page: the event, and the success value of `goto`, `reload`, `back` and `forward`.
 *
 * A navigation either commits a new document, changes the current one (a fragment or the History API),
 * restores one from the back/forward cache, or activates a prerendered one. An HTTP 404 or 500 still commits:
 * the status is in the response. Failures are reasons of `Page.PageError`, so recovery reads the same whether
 * the navigation came from `goto` or was awaited with `next`.
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
import * as NetworkResponse from "./NetworkResponse.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"

/**
 * Schema for the id of one navigation.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/PageNavigation/Id"))

/**
 * Id of one navigation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

/**
 * Schema for a navigation of a page.
 *
 * **Details**
 *
 * - `Committed`: a new document. `response` is `None` for `about:blank`, `data:` URLs and similar.
 * - `SameDocument`: the document stayed, through a fragment, the History API, or an intercepted navigation.
 * - `Restored`: a document came back from the back/forward cache.
 * - `Activated`: a prerendered document became the page's.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageNavigation = Schema.Union([
  Schema.TaggedStruct("Committed", {
    id: Id,
    document: Target.DocumentId,
    response: Schema.Option(NetworkResponse.NetworkResponse)
  }),
  Schema.TaggedStruct("SameDocument", {
    id: Id,
    document: Target.DocumentId,
    via: Schema.Literals(["fragment", "historyApi", "intercepted"])
  }),
  Schema.TaggedStruct("Restored", { id: Id, document: Target.DocumentId }),
  Schema.TaggedStruct("Activated", { id: Id, document: Target.DocumentId })
])

/**
 * A navigation of a page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PageNavigation = typeof PageNavigation.Type

/**
 * How far a navigation must get before the wait for it ends.
 *
 * **Details**
 *
 * `"commit"` ends when the new document is committed, `"domContentLoaded"` and `"load"` when those events
 * fire. The choice is recorded in the operation's span.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LoadState = "commit" | "domContentLoaded" | "load"

/**
 * Which navigations to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match navigations to URLs matching this pattern.
   *
   * @default any URL
   */
  readonly url?: Url.Pattern | string | undefined
}

/**
 * Which navigation to wait for, and how far it must get.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NextFilter extends Filter {
  /**
   * How far the navigation must get before the wait ends.
   *
   * @default "commit"
   */
  readonly waitUntil?: LoadState | undefined
}

/**
 * Subscribes to a page's navigations and returns the first match, latched.
 *
 * **Example** (Waiting for the navigation a click causes)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Deferred, Page, PageNavigation } from "@usestrider/browser"
 *
 * const openOrders = Effect.fn("openOrders")(function*(page: Page.Page) {
 *   const orders = yield* PageNavigation.next(page, { url: "https://shop.example.com/orders" })
 *   yield* page.getByRole("link", { name: "Orders" }).click()
 *   return yield* Deferred.await(orders)
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: NextFilter | undefined,
  where?: Subscription.Where<PageNavigation, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<PageNavigation, Page.PageError | PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to a page's navigations and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: Filter | undefined,
  where?: Subscription.Where<PageNavigation, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<PageNavigation, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the navigations a page's log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.ObservedPage,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<PageNavigation>>

/**
 * Reason for a navigation that failed at the network level, such as a DNS failure.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NavigationFailed extends Schema.Error<NavigationFailed>("@usestrider/browser/PageNavigation/NavigationFailed")({
  _tag: Schema.tag("NavigationFailed"),
  url: Schema.Option(Url.Url),
  netError: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Navigation failed: ${this.netError} (${this.hint})`
  }
}

/**
 * Reason for a navigation that was canceled before it committed.
 *
 * **Details**
 *
 * `why` says who stopped it: a `beforeunload` prompt, the page's `navigate` event, the sandbox, an unloading
 * document, or another traversal in progress.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NavigationCanceled extends Schema.Error<NavigationCanceled>(
  "@usestrider/browser/PageNavigation/NavigationCanceled"
)({
  _tag: Schema.tag("NavigationCanceled"),
  url: Schema.Option(Url.Url),
  why: Schema.Literals(["beforeunload", "navigateEvent", "sandbox", "unloading", "traversalInProgress"]),
  hint: Schema.String
}) {
  override get message(): string {
    return `Navigation canceled by ${this.why} (${this.hint})`
  }
}

/**
 * Reason for a navigation replaced by a later one before it committed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NavigationSuperseded extends Schema.Error<NavigationSuperseded>(
  "@usestrider/browser/PageNavigation/NavigationSuperseded"
)({
  _tag: Schema.tag("NavigationSuperseded"),
  url: Schema.Option(Url.Url),
  by: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Navigation superseded by ${this.by} (${this.hint})`
  }
}

/**
 * Reason for a navigation that became a download, unless the call accepted downloads.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BecameDownload extends Schema.Error<BecameDownload>("@usestrider/browser/PageNavigation/BecameDownload")({
  _tag: Schema.tag("BecameDownload"),
  url: Schema.Option(Url.Url),
  hint: Schema.String
}) {
  override get message(): string {
    return `The navigation became a download (${this.hint})`
  }
}

/**
 * Reason for a navigation answered with 204 No Content, unless the call accepted it.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NoContent extends Schema.Error<NoContent>("@usestrider/browser/PageNavigation/NoContent")({
  _tag: Schema.tag("NoContent"),
  url: Schema.Option(Url.Url),
  hint: Schema.String
}) {
  override get message(): string {
    return `The server answered 204 No Content (${this.hint})`
  }
}
