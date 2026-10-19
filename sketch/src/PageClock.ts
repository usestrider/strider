/**
 * Page time: one timeline per scope (a page, or a whole context), covering every document and frame across
 * navigations, because a test's time must not reset when the page navigates. Each operation is appended to a
 * log that new documents replay. Readiness uses native rendering, so a paused clock never stalls `click`, and
 * nothing advances page time implicitly. Page time never touches library deadlines; TestClock never touches
 * the page. `adjust` and `setTime` mean what they mean on TestClock.
 */
import type { DateTime, Duration, Effect, Scope } from "effect"
import type { ClockError, DeclarationError } from "./Errors.ts"
import type { Registration } from "./Network.ts"

export type PageClockMode =
  | { readonly mode: "fixed"; readonly at: DateTime.DateTime.Input }       // wall time frozen at `at`; timers run
  | { readonly mode: "offset"; readonly by: Duration.Input }               // wall time shifted; everything else real
  | { readonly mode: "controlled"; readonly at: DateTime.DateTime.Input }  // wall time, monotonic time, timers and frames move only when told

export interface PageClock {
  install(mode: PageClockMode): Effect.Effect<Registration, DeclarationError, Scope.Scope>   // needs before-author-script timing
  adjust(duration: Duration.Input): Effect.Effect<void, ClockError>        // controlled: advances, firing every due timer in order
  setTime(at: DateTime.DateTime.Input): Effect.Effect<void, ClockError>    // fixed or controlled: jumps; due timers fire at most once
  readonly resume: Effect.Effect<void, ClockError>                         // real time again, from now
}
