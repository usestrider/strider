/**
 * Declarations: scoped registrations that change how a page or context behaves while they live
 * (principle 19).
 *
 * Routes, dialog and file-chooser handlers, init scripts, emulation overrides, permission grants and page
 * clocks are all declarations. Each requires `Scope`, returns a handle with an idempotent `remove`, and is
 * undone when its scope closes. Removing one early makes the scope's finalizer a no-op.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * The handle every declaration returns.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Registration {
  /**
   * Removes the declaration early. Idempotent; the scope's finalizer becomes a no-op.
   */
  readonly remove: Effect.Effect<void>
}

/**
 * The handle a dialog or file-chooser handler returns.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HandlerRegistration extends Registration {
  /**
   * How many obligations this handler has decided.
   */
  readonly handled: Watchable.Watchable<number>
}

/**
 * Reason for a declaration that needs to run before the page's own scripts, on a backend that can't
 * guarantee it.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class TimingUnsupported
  extends Schema.Error<TimingUnsupported>("@usestrider/browser/Declaration/TimingUnsupported")({
    _tag: Schema.tag("TimingUnsupported"),
    needed: Schema.Literal("beforeAuthorScript"),
    hint: Schema.String
  })
{
  override get message(): string {
    return `Can't guarantee ${this.needed} timing (${this.hint})`
  }
}

/**
 * Reason for a declaration that conflicts with one already in force, such as a second clock on one page.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class Conflict extends Schema.Error<Conflict>("@usestrider/browser/Declaration/Conflict")({
  _tag: Schema.tag("Conflict"),
  with: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Conflicts with ${this.with} (${this.hint})`
  }
}

/**
 * Reason for a declaration whose dependency (an init script in `after`) was already removed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DependencyReleased extends Schema.Error<DependencyReleased>(
  "@usestrider/browser/Declaration/DependencyReleased"
)({
  _tag: Schema.tag("DependencyReleased"),
  hint: Schema.String
}) {
  override get message(): string {
    return `A dependency was already removed (${this.hint})`
  }
}

/**
 * Schema for the reasons a declaration can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeclarationErrorReason = Schema.Union([
  TimingUnsupported,
  Conflict,
  DependencyReleased,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a declaration can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DeclarationErrorReason = typeof DeclarationErrorReason.Type

const DeclarationErrorTypeId = "~@usestrider/browser/Declaration/DeclarationError"

/**
 * Error for a declaration that couldn't be put in force.
 *
 * **Details**
 *
 * `declaration` names it, such as `addInitScript` or `Dialog.handle`. A declaration either takes effect as
 * stated or fails; it never applies partly.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class DeclarationError extends Schema.TaggedError<DeclarationError>(DeclarationErrorTypeId)(
  "DeclarationError",
  {
    declaration: Schema.String,
    reason: DeclarationErrorReason,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [DeclarationErrorTypeId] = DeclarationErrorTypeId
  override get message(): string {
    return `${this.declaration}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `DeclarationError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDeclarationError = (u: unknown): u is DeclarationError =>
  Predicate.hasProperty(u, DeclarationErrorTypeId)
