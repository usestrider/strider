/**
 * The life of a page as events: frames added and removed, documents reaching `domContentLoaded` and `load`, and the
 * page closing, on one page or on every page of a context.
 *
 * A page's `frames`, `status`, and `closed` say where it is now. These events say what happened, one event for each
 * change, so a frame added and removed between two reads, or two loads in a row, are each seen.
 *
 * Each event names its `page` and its `frame`: the page's own id for the page's document, or a frame's. On a
 * context, a subscription takes the events of pages opened after it too, and a page's `Closed` comes before the
 * context's stream ends.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as PageLifecycleImpl from "./internal/pageLifecycle.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for one event in the life of a page.
 *
 * **Details**
 *
 * - `FrameAdded`: a frame was added to the page, under `parent`.
 * - `FrameRemoved`: a frame was removed, with the frames inside it, each its own event.
 * - `DomContentLoaded`: a document in `frame` was parsed, and its deferred scripts ran.
 * - `Loaded`: a document in `frame` finished loading, with its images, styles, and subframes.
 * - `Closed`: the page closed, for `reason`. For a page, `frame` is the page's own id.
 *
 * **Example** (Encoding the frames a page added for a report)
 *
 * ```ts import.meta.vitest
 * import { Page, PageLifecycle, Subscription } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const report = Effect.fn("report")(function*(page: Page.ObservedPage) {
 *   const log = yield* PageLifecycle.history(page, { events: "FrameAdded" })
 *   return Schema.encodeUnknownSync(Subscription.History(PageLifecycle.PageLifecycle))(
 *     log
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageLifecycle = Schema.Union([
  Schema.TaggedStruct("FrameAdded", {
    page: Target.NavigableId,
    frame: Target.NavigableId,
    parent: Target.NavigableId
  }),
  Schema.TaggedStruct("FrameRemoved", { page: Target.NavigableId, frame: Target.NavigableId }),
  Schema.TaggedStruct("DomContentLoaded", {
    page: Target.NavigableId,
    frame: Target.NavigableId,
    document: Target.DocumentId,
    url: Url.Url
  }),
  Schema.TaggedStruct("Loaded", {
    page: Target.NavigableId,
    frame: Target.NavigableId,
    document: Target.DocumentId,
    url: Url.Url
  }),
  Schema.TaggedStruct("Closed", { page: Target.NavigableId, frame: Target.NavigableId, reason: Target.CloseReason })
])

/**
 * One event in the life of a page.
 *
 * **Example** (Saying what happened)
 *
 * ```ts import.meta.vitest
 * import type { PageLifecycle } from "@usestrider/browser"
 *
 * const describe = (event: PageLifecycle.PageLifecycle): string => {
 *   switch (event._tag) {
 *     case "FrameAdded":
 *       return `frame ${event.frame} added`
 *     case "FrameRemoved":
 *       return `frame ${event.frame} removed`
 *     case "DomContentLoaded":
 *     case "Loaded":
 *       return `${event._tag} ${event.url}`
 *     case "Closed":
 *       return `page ${event.page} closed: ${event.reason._tag}`
 *   }
 * }
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PageLifecycle = typeof PageLifecycle.Type

/**
 * Which events to match.
 *
 * **Example** (Every load in a context, frames' included)
 *
 * ```ts import.meta.vitest
 * import { PageLifecycle, UserContext } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const loads: PageLifecycle.Filter = { events: "Loaded", frames: "all" }
 *
 * const loadedUrls = Effect.fn("loadedUrls")(
 *   function*(context: UserContext.ObservedUserContext) {
 *     const log = yield* PageLifecycle.history(context, loads)
 *     return log.entries.flatMap((event) => event._tag === "Loaded" ? [event.url] : [])
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * The kinds of event to match.
   *
   * @default every kind
   */
  readonly events?: PageLifecycle["_tag"] | ReadonlyArray<PageLifecycle["_tag"]> | undefined
  /**
   * Whose loads to match: the page's own documents, or its frames' too. Frames being added and removed, and pages
   * closing, match either way.
   *
   * @default "main"
   */
  readonly frames?: "main" | "all" | undefined
}

/**
 * Subscribes to the life of a page, or of every page in a context, and returns the wait: an effect that gives the
 * first match, the same each time it runs.
 *
 * **Example** (Waiting for a page in a context to close)
 *
 * ```ts import.meta.vitest
 * import { Page, PageLifecycle, UserContext } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const dismiss = Effect.fn("dismiss")(
 *   function*(context: UserContext.UserContext, page: Page.Page) {
 *     const closed = yield* PageLifecycle.next(context, { events: "Closed" })
 *     yield* page.getByRole("button", { name: "Close window" }).click()
 *     return yield* closed
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
  filter?: Filter | undefined,
  where?: Subscription.Where<PageLifecycle, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<PageLifecycle, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => PageLifecycleImpl.next(target, filter, where)

/**
 * Subscribes to the life of a page, or of every page in a context, and emits every match from now on.
 *
 * **Details**
 *
 * The stream ends when its target closes. On a context, the `Closed` event of each of its pages comes first. A
 * page's subscription and its context's each get an event once.
 *
 * **Example** (Logging the frames every page of a context adds)
 *
 * ```ts import.meta.vitest
 * import { PageLifecycle, UserContext } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const logFrames = Effect.fn("logFrames")(
 *   function*(context: UserContext.ObservedUserContext) {
 *     const added = yield* PageLifecycle.stream(context, { events: "FrameAdded" })
 *     yield* added.pipe(
 *       Stream.runForEach((event) => Effect.log(`${event.page} added ${event.frame}`)),
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
export const stream = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<PageLifecycle, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<PageLifecycle, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => PageLifecycleImpl.stream(target, filter, where)

/**
 * Reads the events still in the event log of a page or a context, as `stream` emits them; never waits.
 *
 * **Example** (The pages of a context that have closed)
 *
 * ```ts import.meta.vitest
 * import { PageLifecycle, UserContext } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const closedPages = Effect.fn("closedPages")(
 *   function*(context: UserContext.ObservedUserContext) {
 *     const log = yield* PageLifecycle.history(context, { events: "Closed" })
 *     return log.entries.map((event) => event.page)
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<PageLifecycle>, Subscription.SubscriptionError> =>
  PageLifecycleImpl.history(target, filter)
