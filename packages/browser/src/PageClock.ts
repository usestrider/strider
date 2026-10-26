/**
 * Page time: the clock a page's scripts see, under your control.
 *
 * One timeline per scope, a page or a whole context, covers every document and frame across navigations,
 * because a test's time must not reset when the page navigates: each operation reaches every current document,
 * and a new one starts where the timeline is. Readiness checks use native rendering, so a paused clock never
 * stalls `click`, and nothing advances page time implicitly. Page time never touches library deadlines, and
 * `TestClock` never touches the page. `adjust` and `setTime` mean what they mean on `TestClock`.
 *
 * **Details**
 *
 * No backend has a clock to drive, so this one is the library's: a script in each document's main world, before
 * the page's own, that replaces `Date`, `performance.now`, and in controlled mode the timers and animation
 * frames. Its controls are on a symbol a page that enumerates the window's symbols can find.
 *
 * **Gotchas**
 *
 * - Workers keep real time unless the clock is installed with `workers: true` (review 22), which Firefox can't
 *   do; CSS animations and `document.timeline` always do.
 * - A document loaded before `install` gets the clock then; what its scripts captured before keeps real time.
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
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

/**
 * How the page's clock behaves once installed.
 *
 * **Details**
 *
 * - `fixed`: wall time frozen at `at`; timers still run.
 * - `offset`: wall time shifted by `by`; everything else real.
 * - `controlled`: wall time, monotonic time, timers and animation frames move only when told.
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
   * Whether dedicated workers started from now on get the clock too, before their own script, on the same
   * timeline: `adjust`, `setTime` and `resume` reach them as they reach documents (review 22). `Unsupported` on
   * Firefox (`initScripts.workers`).
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
 * import { Effect } from "effect"
 * import { Expect, Page } from "@usestrider/browser"
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
   * Installs the clock while the registration lives, in every current document of the scope and every later one.
   * Removing it affects later documents only. A clock already installed on the page or its context is a
   * `Conflict`.
   */
  install(
    mode: Mode,
    options?: InstallOptions | undefined
  ): Effect.Effect<Declaration.Registration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope>
  /**
   * Advances a controlled clock, firing every due timer in order, an interval as often as it falls due.
   */
  adjust(duration: Duration.Input): Effect.Effect<void, PageClockError | Target.TargetGone>
  /**
   * Jumps a fixed or controlled clock to `at`; due timers fire at most once.
   */
  setTime(at: DateTime.DateTime.Input): Effect.Effect<void, PageClockError | Target.TargetGone>
  /**
   * Returns to real time, from the time the clock shows now: the clock becomes an offset, and the timers waiting
   * on a controlled clock move to real ones.
   */
  readonly resume: Effect.Effect<void, PageClockError | Target.TargetGone>
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
}

/**
 * Checks whether a value is a `PageClockError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isPageClockError = (u: unknown): u is PageClockError => Predicate.hasProperty(u, PageClockErrorTypeId)
