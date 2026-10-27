/**
 * Pointer input at coordinates, for interfaces such as canvases that locators can't reach.
 *
 * Input to one page is sent in order, one gesture at a time. Holding a button is scoped, and the button is released
 * on failure and interruption, as a held key is.
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
import type * as Keyboard from "./Keyboard.ts"
import type * as Pixels from "./Pixels.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

/**
 * A point in CSS pixels from the viewport's top left corner.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Point {
  readonly x: Pixels.Css | number
  readonly y: Pixels.Css | number
}

/**
 * A mouse button.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Button = "left" | "right" | "middle"

/**
 * Settings for moving the pointer.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MoveOptions {
  /**
   * How many move events to send on the way, the last of them at the point.
   *
   * @default 1
   */
  readonly steps?: number | undefined
}

/**
 * Settings for clicking at a point.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClickOptions {
  /**
   * The button to click.
   *
   * @default "left"
   */
  readonly button?: Button | undefined
  /**
   * Clicks in a row: 2 is a double click.
   *
   * @default 1
   */
  readonly clickCount?: number | undefined
  /**
   * Modifiers held for the click.
   *
   * @default none
   */
  readonly modifiers?: ReadonlyArray<Keyboard.Modifier> | undefined
}

/**
 * A mouse button being held, released by `release` or when its scope closes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HeldButton {
  /**
   * Releases the button early. Running it again does nothing, and neither does closing the scope.
   */
  readonly release: Effect.Effect<void>
}

/**
 * The mouse of one page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Mouse {
  /**
   * Where the pointer is now; read through an effect because it changes.
   */
  readonly position: Effect.Effect<Point>
  /**
   * Moves the pointer to a point.
   */
  move(
    to: Point,
    options?: MoveOptions | undefined
  ): Effect.Effect<void, MouseError | Target.TargetGone | Deadline.Timeout>
  /**
   * Clicks at a point, with no actionability checks: there is no element to check.
   */
  click(
    at: Point,
    options?: ClickOptions | undefined
  ): Effect.Effect<void, MouseError | Target.TargetGone | Deadline.Timeout>
  /**
   * Holds a button down until the returned handle is released or its scope closes.
   */
  hold(button: Button): Effect.Effect<HeldButton, MouseError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  /**
   * Scrolls by a delta in CSS pixels, at the pointer's position.
   */
  wheel(delta: Point): Effect.Effect<void, MouseError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Schema for the reasons a mouse operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MouseErrorReason = Schema.Union([
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a mouse operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MouseErrorReason = typeof MouseErrorReason.Type

const MouseErrorTypeId = "~@usestrider/browser/Mouse/MouseError"

/**
 * Error for a mouse operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class MouseError extends Schema.TaggedError<MouseError>(MouseErrorTypeId)("MouseError", {
  operation: Schema.String,
  reason: MouseErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [MouseErrorTypeId] = MouseErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `MouseError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isMouseError = (u: unknown): u is MouseError => Predicate.hasProperty(u, MouseErrorTypeId)
