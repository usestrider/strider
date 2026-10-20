/**
 * Page time: the clock a page's scripts see, under your control.
 *
 * One timeline per scope, a page or a whole context, covers every document and frame across navigations,
 * because a test's time must not reset when the page navigates. Each operation is appended to a log that new
 * documents replay. Readiness checks use native rendering, so a paused clock never stalls `click`, and nothing
 * advances page time implicitly. Page time never touches library deadlines, and `TestClock` never touches the
 * page. `adjust` and `setTime` mean what they mean on `TestClock`.
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
   * Installs the clock while the registration lives. Needs before-author-script timing.
   */
  install(mode: Mode): Effect.Effect<Declaration.Registration, Declaration.DeclarationError, Scope.Scope>
  /**
   * Advances a controlled clock, firing every due timer in order.
   */
  adjust(duration: Duration.Input): Effect.Effect<void, PageClockError>
  /**
   * Jumps a fixed or controlled clock to `at`; due timers fire at most once.
   */
  setTime(at: DateTime.DateTime.Input): Effect.Effect<void, PageClockError>
  /**
   * Returns to real time, from now.
   */
  readonly resume: Effect.Effect<void, PageClockError>
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
export const PageClockErrorReason = Schema.Union([NotInstalled, WrongMode, Reason.BackendFailure])

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
