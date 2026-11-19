/**
 * Frames of a page, held by their identity, at three access levels: `ObservedFrame` ⊂ `ReadonlyFrame` ⊂ `Frame`,
 * as pages are.
 *
 * A frame handle keeps to one frame through the frame's own navigations, and ends when the frame is removed from
 * its page. A frame locator (`page.frame(iframe)`) is different: it finds its iframe again on each use, so it
 * follows an iframe that is replaced; `frameLocator.resolve` gives the frame it holds now.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import type * as JSHandle from "./JSHandle.ts"
import * as Page from "./Page.ts"
import type * as PageNavigation from "./PageNavigation.ts"
import type * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * Schema for a frame's state: attached to its page, with its URL and its current document once one has committed,
 * or detached.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Status = Schema.Union([
  Schema.TaggedStruct("Attached", { url: Url.Url, document: Schema.Option(Page.DocumentStatus) }),
  Schema.TaggedStruct("Detached", {})
])

/**
 * A frame's state: attached to its page, with its URL and its current document once one has committed, or
 * detached.
 *
 * **Example** (Waiting for a frame's document to load)
 *
 * ```ts import.meta.vitest
 * import type { Frame } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const loaded = Effect.fn("loaded")(function*(frame: Frame.ObservedFrame) {
 *   yield* frame.status.waitFor((status) =>
 *     status._tag === "Attached" && Option.isSome(status.document) &&
 *     status.document.value.readiness === "complete"
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Status = typeof Status.Type

/**
 * A frame of a page that can be watched: its id, its page, and its state.
 *
 * **Example** (Reading a frame's URL)
 *
 * ```ts import.meta.vitest
 * import type { Frame } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const urlOf = Effect.fn("urlOf")(function*(frame: Frame.ObservedFrame) {
 *   const status = yield* frame.status
 *   return status._tag === "Attached" ? status.url : undefined
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObservedFrame {
  /** The frame's id, as `page.frames` shows it; the page's own id for its top frame. */
  readonly id: Target.NavigableId
  /** The page the frame is in. */
  readonly page: Page.ObservedPage
  /**
   * The frame's state; ends with `Detached`, or when its page closes. Waiting for a readiness on it is waiting for
   * the frame's load state.
   */
  readonly status: Watchable.Watchable<Status>
}

/**
 * A frame that can be read: an `ObservedFrame` that evaluates in an isolated world of its document.
 *
 * **Example** (Reading a frame's heading)
 *
 * ```ts import.meta.vitest
 * import type { Frame } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const heading = Effect.fn("heading")(function*(frame: Frame.ReadonlyFrame) {
 *   return yield* frame.evaluate(() => document.querySelector("h1")?.textContent ?? null)
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadonlyFrame extends ObservedFrame {
  /**
   * Calls `fn` in an isolated world of the frame's current document, where the document's own globals are
   * invisible, and returns its result by value. It has `Page.evaluate`'s rules, and fails with `Unsupported` on
   * WebKit, which has no isolated worlds.
   */
  evaluate<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<A>, Page.PageError | Target.TargetGone | Deadline.Timeout>
}

/**
 * A frame that can be driven: a `ReadonlyFrame` that navigates, and evaluates among its document's own scripts.
 *
 * **Example** (Navigating a frame)
 *
 * ```ts import.meta.vitest
 * import type { Frame } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const open = Effect.fn("open")(function*(frame: Frame.Frame) {
 *   yield* frame.goto("https://example.com/", { waitUntil: "load" })
 *   return yield* frame.evaluateInMainWorld(() => document.title)
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Frame extends ReadonlyFrame {
  /**
   * Navigates the frame to `url`, and returns the navigation once the frame's new document reaches `waitUntil`.
   * The page's own document stays where it is. A frame removed before then fails the navigation with `TargetGone`.
   * On WebKit the frame navigates by script, so `referrer` isn't available.
   */
  goto(
    url: string,
    options?: Page.GotoOptions | undefined
  ): Effect.Effect<PageNavigation.PageNavigation, Page.PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` among the frame's own scripts, in its current document's main world, and returns its result by
   * value. It has `Page.evaluateInMainWorld`'s rules.
   */
  evaluateInMainWorld<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<A>, Page.PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the same world as `Page.evaluateHandle`, in the frame's current document, and returns a handle
   * on its result, released when the scope closes.
   */
  evaluateHandle<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.JSHandle<Awaited<A>>, Page.PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
}
