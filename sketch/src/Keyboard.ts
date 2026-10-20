/**
 * Keys sent to whatever has focus, for what locators can't express.
 *
 * Input to one page is serialized. Holding a key is a scoped acquisition: the key is released when the
 * handle's `release` runs or its scope closes, including on failure and interruption, so a failed step
 * never leaves Shift held down.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import type * as Redacted from "effect/Redacted"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

/**
 * Schema for a key value, such as `"Enter"`, `"a"` or `"ArrowDown"`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Key = Schema.String.pipe(Schema.brand("~@usestrider/browser/Keyboard/Key"))

/**
 * A key value from the UI Events `key` list, such as `"Enter"`, `"a"` or `"ArrowDown"`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Key = typeof Key.Type

/**
 * A modifier key.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Modifier = "Alt" | "Control" | "Meta" | "Shift"

/**
 * Settings for pressing one key.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PressOptions {
  /**
   * Modifiers held for the press.
   *
   * @default none
   */
  readonly modifiers?: ReadonlyArray<Modifier> | undefined
}

/**
 * Settings for typing text one key at a time.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TypeOptions {
  /**
   * The pause between keys.
   *
   * @default 0
   */
  readonly delay?: Duration.Input | undefined
}

/**
 * A key being held, released by `release` or when its scope closes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HeldKey {
  /**
   * Releases the key early. Idempotent; the scope's finalizer becomes a no-op.
   */
  readonly release: Effect.Effect<void>
}

/**
 * The keyboard of one page.
 *
 * **Example** (Selecting several options with Shift held)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const selectRange = Effect.fn("selectRange")(function*(page: Page.Page) {
 *   yield* Effect.scoped(Effect.gen(function*() {
 *     yield* page.keyboard.hold("Shift")
 *     yield* page.getByRole("option", { name: "Apples" }).click()
 *     yield* page.getByRole("option", { name: "Pears" }).click()
 *   }))
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Keyboard {
  /**
   * Presses and releases one key.
   */
  press(
    key: Key | string,
    options?: PressOptions | undefined
  ): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>
  /**
   * Types text one key at a time, with key events for each character.
   */
  pressSequentially(
    text: string | Redacted.Redacted<string>,
    options?: TypeOptions | undefined
  ): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>
  /**
   * Inserts text without key events, as an input method would.
   */
  insertText(
    text: string | Redacted.Redacted<string>
  ): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>
  /**
   * Holds a key down until the returned handle is released or its scope closes.
   */
  hold(key: Key | string): Effect.Effect<HeldKey, KeyboardError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
}

/**
 * Schema for the reasons a keyboard operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyboardErrorReason = Schema.Union([
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a keyboard operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type KeyboardErrorReason = typeof KeyboardErrorReason.Type

const KeyboardErrorTypeId = "~@usestrider/browser/Keyboard/KeyboardError"

/**
 * Error for a keyboard operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class KeyboardError extends Schema.TaggedError<KeyboardError>(KeyboardErrorTypeId)("KeyboardError", {
  operation: Schema.String,
  reason: KeyboardErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [KeyboardErrorTypeId] = KeyboardErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `KeyboardError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isKeyboardError = (u: unknown): u is KeyboardError => Predicate.hasProperty(u, KeyboardErrorTypeId)
