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
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
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
   *
   * **Gotchas**
   *
   * Stock WebKit doesn't report a child frame's readiness: there, a child frame's document stays `loading`.
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
  ): Effect.Effect<JSHandle.Serialized<A>, FrameError | Target.TargetGone | Deadline.Timeout>
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
   * On WebKit the frame navigates by script, and a child frame's `waitUntil` other than `"commit"` fails with
   * `Unsupported`, since WebKit doesn't report its readiness.
   */
  goto(
    url: string,
    options?: Page.GotoOptions | undefined
  ): Effect.Effect<PageNavigation.PageNavigation, FrameError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` among the frame's own scripts, in its current document's main world, and returns its result by
   * value. It has `Page.evaluateInMainWorld`'s rules.
   */
  evaluateInMainWorld<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<A>, FrameError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the same world as `Page.evaluateHandle`, in the frame's current document, and returns a handle
   * on its result, released when the scope closes.
   */
  evaluateHandle<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.JSHandle<Awaited<A>>, FrameError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
}

/**
 * Schema for why a frame operation failed: the reasons a page operation can fail with, for navigation and
 * evaluation.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameErrorReason = Page.PageErrorReason

/**
 * Why a frame operation failed: the reasons a page operation can fail with, for navigation and evaluation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FrameErrorReason = typeof FrameErrorReason.Type

const FrameErrorTypeId = "~@usestrider/browser/Frame/FrameError"

/**
 * Error for a frame operation that failed: its navigation or an evaluation in it.
 *
 * **Example** (Recovering from a frame's failed navigation)
 *
 * ```ts import.meta.vitest
 * import type { Frame } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const tryOpen = Effect.fn("tryOpen")(function*(frame: Frame.Frame, url: string) {
 *   return yield* frame.goto(url).pipe(
 *     Effect.map(Option.some),
 *     Effect.catchReason("FrameError", "NavigationFailed", () => Effect.succeedNone)
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class FrameError extends Schema.TaggedError<FrameError>(FrameErrorTypeId)("FrameError", {
  operation: Schema.String,
  reason: FrameErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [FrameErrorTypeId] = FrameErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `FrameError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isFrameError = (u: unknown): u is FrameError => Predicate.hasProperty(u, FrameErrorTypeId)
