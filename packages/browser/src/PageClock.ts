/**
 * Page time: the clock a page's scripts read, under your control.
 *
 * One timeline covers a page, or a whole context, across every document and frame, so time doesn't reset when the
 * page navigates: each operation reaches every current document, and a new document starts where the timeline is.
 * Readiness checks use the browser's own rendering, so a paused clock never stalls `click`, and nothing advances
 * page time unless you do. Page time never touches Strider's deadlines, and `TestClock` never touches the page.
 * `adjust` and `setTime` mean what they mean on `TestClock`.
 *
 * **Details**
 *
 * The clock is a script Strider runs in each document's main world before the page's own. It replaces `Date` and
 * `performance.now`, and in controlled mode the timers and animation frames. Its controls are on a symbol, which a
 * page that lists the window's symbols can find.
 *
 * **Gotchas**
 *
 * - Workers keep real time unless the clock is installed with `workers: true`, which Firefox can't do. CSS
 *   animations and `document.timeline` always keep real time.
 * - A document loaded before `install` gets the clock then; what its scripts read before that keeps real time.
 * - A page's clock and its context's can't both be installed: one timeline covers a page.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as DateTime from "effect/DateTime"
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

/**
 * How the page's clock behaves once installed.
 *
 * **Details**
 *
 * - `fixed`: wall time frozen at `at`; timers still run.
 * - `offset`: wall time shifted by `by`; everything else real.
 * - `controlled`: wall time, monotonic time, timers and animation frames move only when you call `adjust` or
 *   `setTime`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Mode =
  | { readonly mode: "fixed"; readonly at: DateTime.DateTime.Input }
  | { readonly mode: "offset"; readonly by: Duration.Input }
  | { readonly mode: "controlled"; readonly at: DateTime.DateTime.Input }

/**
 * Settings for `install`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InstallOptions {
  /**
   * Whether the pages' dedicated workers get the clock too, on the same timeline: a running worker gets it at
   * once, and a later one before its own script. `adjust`, `setTime` and `resume` reach workers as they reach
   * documents. Fails with `Unsupported` on Firefox (`initScripts.workers`).
   *
   * @default false
   */
  readonly workers?: boolean | undefined
}

/**
 * The clock of a page or context.
 *
 * **Example** (Paused application time)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const sessionExpires = Effect.fn("sessionExpires")(function*(page: Page.Page) {
 *   yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
 *   yield* page.goto("https://app.example.com/session")
 *   yield* page.getByRole("button", { name: "Start" }).click()
 *   yield* page.clock.adjust("5 minutes")
 *   yield* page.getByText("Session expired").pipe(Expect.toBeVisible)
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PageClock {
  /**
   * Installs the clock in every current and later document of the page or context, until the registration is
   * removed or its scope closes. Removing it affects later documents only: a document it reached keeps the clock.
   * Fails with `Conflict` when a clock, installed on a page or on its context, already covers any of the same pages.
   *
   * **Example** (Freezing the date)
   *
   * ```ts import.meta.vitest
   * import { Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const newYearBanner = Effect.fn("newYearBanner")(function*(page: Page.Page) {
   *   yield* page.clock.install({ mode: "fixed", at: "2027-01-01T08:00:00Z" })
   *   yield* page.goto("https://shop.example.com")
   *   yield* page.getByText("Happy New Year").pipe(Expect.toBeVisible)
   * })
   * ```
   */
  install(
    mode: Mode,
    options?: InstallOptions | undefined
  ): Effect.Effect<
    Declaration.Registration,
    Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >
  /**
   * Advances a controlled clock, firing every due timer in order, an interval as often as it falls due. Fails with
   * `WrongMode` on a `fixed` or `offset` clock.
   *
   * **Example** (Letting a toast time out)
   *
   * ```ts import.meta.vitest
   * import { Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const toastHides = Effect.fn("toastHides")(function*(page: Page.Page) {
   *   yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
   *   yield* page.goto("https://shop.example.com/products/42")
   *   yield* page.getByRole("button", { name: "Add to cart" }).click()
   *   yield* page.getByRole("status").pipe(Expect.toBeVisible)
   *   yield* page.clock.adjust("5 seconds")
   *   yield* page.getByRole("status").pipe(Expect.toBeHidden)
   * })
   * ```
   */
  adjust(duration: Duration.Input): Effect.Effect<void, PageClockError | Target.TargetGone | Deadline.Timeout>
  /**
   * Jumps a fixed or controlled clock to `at`; due timers fire at most once.
   *
   * **Example** (Jumping past the end of a sale)
   *
   * ```ts import.meta.vitest
   * import { Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const saleEnds = Effect.fn("saleEnds")(function*(page: Page.Page) {
   *   yield* page.clock.install({ mode: "controlled", at: "2026-11-30T23:59:00Z" })
   *   yield* page.goto("https://shop.example.com/sale")
   *   yield* page.clock.setTime("2026-12-01T00:00:01Z")
   *   yield* page.getByText("The sale has ended").pipe(Expect.toBeVisible)
   * })
   * ```
   */
  setTime(at: DateTime.DateTime.Input): Effect.Effect<void, PageClockError | Target.TargetGone | Deadline.Timeout>
  /**
   * Lets the clock run in real time again, from the time it shows now: it becomes an `offset` clock, and the
   * timers waiting on a controlled clock become real timers.
   *
   * **Example** (Advancing a day, then running in real time)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const tomorrow = Effect.fn("tomorrow")(function*(page: Page.Page) {
   *   yield* page.clock.install({ mode: "controlled", at: "2026-06-01T09:00:00Z" })
   *   yield* page.goto("https://app.example.com/calendar")
   *   yield* page.clock.adjust("1 day")
   *   yield* page.clock.resume
   * })
   * ```
   */
  readonly resume: Effect.Effect<void, PageClockError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Reason for a clock operation with no clock installed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NotInstalled extends Schema.Error<NotInstalled>("@usestrider/browser/PageClock/NotInstalled")({
  _tag: Schema.tag("NotInstalled"),
  hint: Schema.String
}) {
  override get message(): string {
    return `No clock is installed (${this.hint})`
  }
}

/**
 * Reason for a clock operation the installed mode doesn't allow, such as `adjust` on a `fixed` clock.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class WrongMode extends Schema.Error<WrongMode>("@usestrider/browser/PageClock/WrongMode")({
  _tag: Schema.tag("WrongMode"),
  mode: Schema.Literals(["fixed", "offset", "controlled"]),
  hint: Schema.String
}) {
  override get message(): string {
    return `Not allowed on a ${this.mode} clock (${this.hint})`
  }
}

/**
 * Schema for the reasons a clock operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageClockErrorReason = Schema.Union([NotInstalled, WrongMode, Reason.InvalidInput, Reason.BackendFailure])

/**
 * The reasons a clock operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PageClockErrorReason = typeof PageClockErrorReason.Type

const PageClockErrorTypeId = "~@usestrider/browser/PageClock/PageClockError"

/**
 * Error for a clock operation that failed.
 *
 * **Example** (Advancing only a controlled clock)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const skipAhead = Effect.fn("skipAhead")(function*(page: Page.Page) {
 *   yield* page.clock.adjust("10 minutes").pipe(
 *     Effect.catchReason(
 *       "PageClockError",
 *       "WrongMode",
 *       (reason) => Effect.logWarning(`A ${reason.mode} clock can't be advanced`)
 *     )
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class PageClockError extends Schema.TaggedError<PageClockError>(PageClockErrorTypeId)("PageClockError", {
  operation: Schema.String,
  reason: PageClockErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [PageClockErrorTypeId] = PageClockErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `PageClockError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isPageClockError = (u: unknown): u is PageClockError => Predicate.hasProperty(u, PageClockErrorTypeId)
