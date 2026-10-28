/**
 * Navigations of a page: the event, and what `goto`, `reload`, `back` and `forward` return.
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
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Navigated from "./internal/navigated.ts"
import * as Operation from "./internal/operation.ts"
import type * as Runtime from "./internal/runtime.ts"
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
 * - `BecameDownload`: the response was a download, and the page stayed where it was. Only `goto` with
 *   `accept: ["download"]` returns it; otherwise it fails with the `BecameDownload` reason.
 * - `NoContent`: the server answered 204 or 205, and the page stayed where it was. Only `goto` with
 *   `accept: ["noContent"]` returns it; otherwise it fails with the `NoContent` reason.
 *
 * `url` is where the page went: the committed document's URL, after any redirects, or the URL a same-document
 * navigation set; for `BecameDownload` and `NoContent`, the URL it was going to. `frame` is where it happened:
 * the page's own id, or a frame's.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageNavigation = Schema.Union([
  Schema.TaggedStruct("Committed", {
    id: Id,
    frame: Target.NavigableId,
    url: Url.Url,
    document: Target.DocumentId,
    response: Schema.Option(NetworkResponse.NetworkResponse)
  }),
  Schema.TaggedStruct("SameDocument", {
    id: Id,
    frame: Target.NavigableId,
    url: Url.Url,
    document: Target.DocumentId,
    via: Schema.Literals(["fragment", "historyApi", "intercepted"])
  }),
  Schema.TaggedStruct("Restored", { id: Id, frame: Target.NavigableId, url: Url.Url, document: Target.DocumentId }),
  Schema.TaggedStruct("Activated", { id: Id, frame: Target.NavigableId, url: Url.Url, document: Target.DocumentId }),
  Schema.TaggedStruct("BecameDownload", { id: Id, frame: Target.NavigableId, url: Url.Url }),
  Schema.TaggedStruct("NoContent", {
    id: Id,
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

// ── Implementation ──

const kind = (
  runtime: Runtime.Runtime,
  operation: string
): Events.Kind<Model.NavigationEvent, PageNavigation> => ({
  operation,
  noun: "a navigation",
  // Only a navigation that got somewhere is delivered as one (`succeeded` accepts nothing else)
  deliver: (event) =>
    Option.getOrThrow(Navigated.succeeded(runtime.model, event.navigation, event.frame, event.url, event.outcome))
})

const succeeded = (event: Model.NavigationEvent) =>
  event.outcome._tag === "Committed" || event.outcome._tag === "SameDocument" || event.outcome._tag === "Restored" ||
  event.outcome._tag === "Activated"

const subscription = (target: Page.ObservedPage, filter: Filter | undefined, operation: string) =>
  Effect.suspend(() => {
    const behind = Handles.page(target)
    const all = filter?.frames === "all"
    return Effect.map(Filters.url(operation, filter?.url), (matches) => {
      const ours = (entry: Events.Entry<Model.NavigationEvent>) => all || entry.value.frame === behind.entry.id
      return {
        behind,
        kind: kind(behind.runtime, operation),
        channel: behind.entry.events.navigation,
        matches: (entry: Events.Entry<Model.NavigationEvent>) =>
          ours(entry) && Filters.urlMatches(matches, entry.value.url),
        accepts: (entry: Events.Entry<Model.NavigationEvent>) =>
          ours(entry) && succeeded(entry.value) && Filters.urlMatches(matches, entry.value.url)
      }
    })
  })

/**
 * Subscribes to a page's navigations and returns the wait: an effect that gives the first match, the same each
 * time it runs.
 *
 * **Details**
 *
 * The wait settles on the first matching navigation to end, as `goto` would. If that navigation succeeded,
 * the wait gives its `PageNavigation` once its document reaches `waitUntil`; if it didn't, the wait fails with the
 * `PageError` that `goto` would give, such as `NavigationFailed`. `url` matches where the page went, after any
 * redirects, or, for a navigation that failed, where it was going.
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
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: NextFilter | undefined,
  where?: Subscription.Where<PageNavigation, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<PageNavigation, Page.PageError | PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(subscription(target, filter, "PageNavigation.next"), ({ behind, channel, kind, matches }) => {
    const waitUntil = filter?.waitUntil ?? "commit"
    const { model } = behind.runtime
    const delivery: Events.Delivery<Model.NavigationEvent, PageNavigation, Page.PageError> = {
      deliver: Effect.fnUntraced(function*(event) {
        const result = yield* behind.runtime.settle(
          "PageNavigation.next",
          event.navigation,
          event.frame,
          Option.some(event.url as Url.Url),
          event.url,
          event.outcome,
          Operation.operationId()
        )
        // The deadline is `next`'s, which bounds the whole wait
        yield* Navigated.reached(model, result, waitUntil, Option.none())
        return result
      }),
      unfinished: (event) => `A navigation to ${event.url} committed, but its document hadn't reached ${waitUntil}`
    }
    return Events.next(kind, channel, matches, where, delivery)
  }).pipe(
    Operation.named("PageNavigation.next", {
      attributes: { "browser.navigation.wait_until": filter?.waitUntil ?? "commit" }
    })
  )

/**
 * Subscribes to a page's navigations and emits every successful match from now on: `Committed`, `SameDocument`,
 * `Restored` or `Activated`.
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
  target: Page.ObservedPage,
  filter?: Filter | undefined,
  where?: Subscription.Where<PageNavigation, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<PageNavigation, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "PageNavigation.stream"),
    ({ accepts, channel, kind }) => Events.stream(kind, channel, accepts, where)
  )

/**
 * Reads the successful navigations still in the page's event log, as `stream` emits them; never waits.
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
  target: Page.ObservedPage,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<PageNavigation>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "PageNavigation.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )

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
