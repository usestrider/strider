/**
 * Page-level input, for what locators can't express: keys sent to whatever has focus, coordinates on
 * canvas-like UIs, and inputs held across other actions. (New in the sketch: API.md only named Keyboard and
 * Mouse.)
 *
 * Input to one page is serialized. Holding a key or button is a scoped acquisition: it is released when the
 * handle's `release` runs or its scope closes, and on interruption, in reverse order (CONCEPTS.md §5), so a
 * failed step never leaves Shift held down.
 */
import type { Duration, Effect, Redacted, Scope } from "effect"
import type { CssPixels, KeyName } from "./Brand.ts"
import type { ActionError, TargetGone, Timeout } from "./Errors.ts"

export type Modifier = "Alt" | "Control" | "Meta" | "Shift"
export interface Point { readonly x: CssPixels | number; readonly y: CssPixels | number }   // CSS pixels from the viewport's top left

export interface HeldInput {
  readonly release: Effect.Effect<void>                 // idempotent; the scope's finalizer becomes a no-op
}

export interface Keyboard {
  press(key: KeyName | string, options?: { readonly modifiers?: ReadonlyArray<Modifier> }): Effect.Effect<void, ActionError | TargetGone | Timeout>
  pressSequentially(text: string | Redacted.Redacted<string>, options?: { readonly delay?: Duration.Input }): Effect.Effect<void, ActionError | TargetGone | Timeout>   // delay default 0
  /** Inserts text without key events, as an input method would. */
  insertText(text: string | Redacted.Redacted<string>): Effect.Effect<void, ActionError | TargetGone | Timeout>
  hold(key: KeyName | string): Effect.Effect<HeldInput, ActionError | TargetGone | Timeout, Scope.Scope>
}

export interface Mouse {
  readonly position: Effect.Effect<Point>               // mutable state, so read through an Effect
  move(to: Point, options?: { readonly steps?: number }): Effect.Effect<void, ActionError | TargetGone | Timeout>   // steps default 1
  click(at: Point, options?: {
    readonly button?: "left" | "right" | "middle"       // default left
    readonly clickCount?: number                        // default 1
    readonly modifiers?: ReadonlyArray<Modifier>
  }): Effect.Effect<void, ActionError | TargetGone | Timeout>
  hold(button: "left" | "right" | "middle"): Effect.Effect<HeldInput, ActionError | TargetGone | Timeout, Scope.Scope>
  wheel(delta: { readonly x: CssPixels | number; readonly y: CssPixels | number }): Effect.Effect<void, ActionError | TargetGone | Timeout>
}
