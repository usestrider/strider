/**
 * Navigations of a page: the event, and what `goto`, `reload`, `back`, and `forward` return.
 *
 * A navigation commits a new document, changes the current one (a fragment or the History API), restores one from
 * the back/forward cache, or activates a prerendered one. An HTTP 404 or 500 still commits, with the status in its
 * response. A failed navigation is a reason of `Page.PageError`, whether it came from `goto` or was awaited with
 * `next`.
 *
 * A navigation is reported when it ends, including one `goto` started. The events are the page's own navigations,
 * and with `frames: "all"` its frames' too, each naming its frame. WebKit reports no same-document navigations
 * (`navigation.sameDocument`).
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as PageNavigationImpl from "./internal/pageNavigation.ts"
import * as NetworkResponse from "./NetworkResponse.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

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
 * Every navigation names its `page`, and the `frame` it happened in: the page's own id for the page's document, or
 * a frame's.
 *
 * - `Committed`: a new document. `response` is `None` for `about:blank`, `data:` URLs, and `blob:` URLs, which the browser
 *   answers without a network request.
 * - `SameDocument`: the document stayed, through a fragment, the History API, or an intercepted navigation.
 * - `Restored`: a document came back from the back/forward cache.
 * - `Activated`: a prerendered document became the page's.
 * - `BecameDownload`: the response was a download, and the page stayed where it was. Only `goto` with
 *   `accept: ["download"]` returns it; otherwise it fails with the `BecameDownload` reason.
 * - `NoContent`: the server answered 204 or 205, and the page stayed where it was. Only `goto` with
 *   `accept: ["noContent"]` returns it; otherwise it fails with the `NoContent` reason.
 *
 * `url` is where the page went: the committed document's URL, after any redirects, or the URL a same-document
 * navigation set; for `BecameDownload` and `NoContent`, the URL it was going to. `frame` is where it happened:
 * the page's own id, or a frame's.
 *
 * **Example** (Encoding the navigations of a context for a report)
 *
 * ```ts import.meta.vitest
 * import { PageNavigation, Subscription, UserContext } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const report = Effect.fn("report")(function*(context: UserContext.ObservedUserContext) {
 *   const log = yield* PageNavigation.history(context)
 *   return Schema.encodeUnknownSync(Subscription.History(PageNavigation.PageNavigation))(
 *     log
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageNavigation = Schema.Union([
  Schema.TaggedStruct("Committed", {
    id: Id,
    page: Target.NavigableId,
    frame: Target.NavigableId,
    url: Url.Url,
    document: Target.DocumentId,
    response: Schema.Option(NetworkResponse.NetworkResponse)
  }),
  Schema.TaggedStruct("SameDocument", {
    id: Id,
    page: Target.NavigableId,
    frame: Target.NavigableId,
    url: Url.Url,
    document: Target.DocumentId,
    via: Schema.Literals(["fragment", "historyApi", "intercepted"])
  }),
  Schema.TaggedStruct("Restored", {
    id: Id,
    page: Target.NavigableId,
    frame: Target.NavigableId,
    url: Url.Url,
    document: Target.DocumentId
  }),
  Schema.TaggedStruct("Activated", {
    id: Id,
    page: Target.NavigableId,
    frame: Target.NavigableId,
    url: Url.Url,
    document: Target.DocumentId
  }),
  Schema.TaggedStruct("BecameDownload", { id: Id, page: Target.NavigableId, frame: Target.NavigableId, url: Url.Url }),
  Schema.TaggedStruct("NoContent", {
    id: Id,
    page: Target.NavigableId,
    frame: Target.NavigableId,
    url: Url.Url,
    response: Schema.Option(NetworkResponse.NetworkResponse)
  })
])

/**
 * A navigation of a page.
 *
 * **Example** (The status a page loaded with)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const loadStatus = Effect.fn("loadStatus")(function*(page: Page.Page) {
 *   const navigation = yield* page.goto("https://shop.example.com/products/42")
 *   if (navigation._tag !== "Committed") return Option.none()
 *   return Option.map(navigation.response, (response) => response.status)
 * })
 * ```
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
  /**
   * Whose navigations to match: the page's own (`"main"`), or its frames' too (`"all"`).
   *
   * @default "main"
   */
  readonly frames?: "main" | "all" | undefined
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
 * Subscribes to the navigations of a page, or of every page in a context, and returns the wait: an effect that
 * gives the first match, the same each time it runs.
 *
 * **Details**
 *
 * On a context, the wait takes a navigation of any page in it, including pages opened after it subscribed, and
 * the navigation's `page` says which. `next(context, { waitUntil: "load" })` waits for a page in the context to
 * load.
 *
 * The wait settles on the first matching navigation to end, as `goto` would. If that navigation succeeded,
 * the wait gives its `PageNavigation` once its document reaches `waitUntil`; if it didn't, the wait fails with the
 * `PageError` that `goto` would give, such as `NavigationFailed`. `url` matches where the page went, after any
 * redirects, or, for a navigation that failed, where it was going.
 *
 * On a page the program didn't open, such as a persistent profile's first tab or a tab open in a browser it
 * attached to, the wait starts once Strider has read the page's frames. A navigation the page finishes before then
 * is the document it opens with, not a navigation the wait receives.
 *
 * **Example** (Waiting for the navigation a click causes)
 *
 * ```ts import.meta.vitest
 * import { Page, PageNavigation } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openOrders = Effect.fn("openOrders")(function*(page: Page.Page) {
 *   const orders = yield* PageNavigation.next(page, {
 *     url: "https://shop.example.com/orders"
 *   })
 *   yield* page.getByRole("link", { name: "Orders" }).click()
 *   return yield* orders
 * })
 * ```
 *
 * **Example** (Waiting for any page in a context to load)
 *
 * ```ts import.meta.vitest
 * import { Page, PageNavigation, UserContext } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openReceipt = Effect.fn("openReceipt")(
 *   function*(context: UserContext.UserContext, page: Page.Page) {
 *     const loaded = yield* PageNavigation.next(context, {
 *       url: "https://shop.example.com/receipt",
 *       waitUntil: "load"
 *     })
 *     yield* page.getByRole("link", { name: "Receipt" }).click()
 *     const navigation = yield* loaded
 *     return navigation.page
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: NextFilter | undefined,
  where?: Subscription.Where<PageNavigation, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<PageNavigation, Page.PageError | PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => PageNavigationImpl.next(target, filter, where)

/**
 * Subscribes to the navigations of a page, or of every page in a context, and emits every successful match from
 * now on: `Committed`, `SameDocument`, `Restored`, or `Activated`.
 *
 * **Details**
 *
 * On a context, the stream takes the navigations of pages opened after it subscribed too, and ends when the
 * context closes. A page's subscription and its context's each get a navigation once.
 *
 * **Example** (Logging every URL a single-page app visits)
 *
 * ```ts import.meta.vitest
 * import { Page, PageNavigation } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const logRoutes = Effect.fn("logRoutes")(function*(page: Page.ObservedPage) {
 *   const navigations = yield* PageNavigation.stream(page)
 *   yield* navigations.pipe(
 *     Stream.runForEach((navigation) => Effect.log(navigation.url)),
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
  where?: Subscription.Where<PageNavigation, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<PageNavigation, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => PageNavigationImpl.stream(target, filter, where)

/**
 * Reads the successful navigations still in the event log of a page or a context, as `stream` emits them; never
 * waits.
 *
 * **Details**
 *
 * An operation returns only after the events the browser sent before answering it have been handled, so what
 * it caused is here once it returns, as far as the browser reported it by then and the log still keeps it.
 * The exception is a target whose state is still being read, as when it has just attached or its events
 * overflowed: its events reach the log once that read completes.
 *
 * **Example** (The URLs a page has visited)
 *
 * ```ts import.meta.vitest
 * import { Page, PageNavigation } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const visited = Effect.fn("visited")(function*(page: Page.ObservedPage) {
 *   const navigations = yield* PageNavigation.history(page)
 *   return navigations.entries.map((navigation) => navigation.url)
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
): Effect.Effect<Subscription.History<PageNavigation>, Subscription.SubscriptionError> =>
  PageNavigationImpl.history(target, filter)

/** ` to <url>`, where a reason knows where its navigation was going; nothing where it doesn't. */
const going = (url: Option.Option<Url.Url>): string =>
  Option.match(url, { onNone: () => "", onSome: (to) => ` to ${to}` })

/**
 * Reason for a navigation that failed at the network level, such as a DNS failure.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NavigationFailed
  extends Schema.Error<NavigationFailed>("@usestrider/browser/PageNavigation/NavigationFailed")({
    _tag: Schema.tag("NavigationFailed"),
    url: Schema.Option(Url.Url),
    netError: Schema.String,
    hint: Schema.String
  })
{
  override get message(): string {
    return `Navigation${going(this.url)} failed: ${this.netError} (${this.hint})`
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
    return `Navigation${going(this.url)} canceled by ${this.why} (${this.hint})`
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
    return `Navigation${going(this.url)} superseded by ${this.by} (${this.hint})`
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
    return `The navigation${going(this.url)} became a download (${this.hint})`
  }
}

/**
 * Reason for a navigation the server answered without content (204 or 205), unless the call accepted it.
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
    return `The server answered the navigation${going(this.url)} without content, 204 or 205 (${this.hint})`
  }
}
