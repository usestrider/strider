/**
 * Keys sent to whatever has focus, for what an action on a locator can't express.
 *
 * Input to one page is sent in order, one gesture at a time. Holding a key is scoped: the key is released when the
 * handle's `release` runs or its scope closes, on failure and interruption too, so a step that fails never leaves
 * Shift held down.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

/**
 * Schema for a key name: a key value, such as `"Enter"`, `"a"`, or `"ArrowDown"`, or a key's code, such as
 * `"ControlRight"`, `"Numpad1"`, or `"KeyW"`, as `Keyboard.Key` describes.
 *
 * **Example** (Steering with the keys a game reads by place)
 *
 * ```ts import.meta.vitest
 * import { Keyboard, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const forward = Schema.decodeUnknownSync(Keyboard.Key)("KeyW")
 *
 * const steer = Effect.fn("steer")(function*(page: Page.Page) {
 *   yield* page.keyboard.press(forward)
 *   yield* page.keyboard.press("ShiftRight")
 *   yield* page.keyboard.press("Numpad8")
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Key = Schema.String.pipe(Schema.brand("~@usestrider/browser/Keyboard/Key"))

/**
 * A key name: a key value from the UI Events `key` list, such as `"Enter"`, `"a"`, or `"ArrowDown"`, or a key's
 * place on the keyboard, as its UI Events `code`, such as `"ControlRight"`, `"Numpad1"`, or `"KeyW"`.
 *
 * **Details**
 *
 * A key value or a character names what is typed, wherever the layout has it. A code names a place: the key the
 * page gets is what the context's layout types there, so `"KeyW"` types `w` on `us` and `z` on `fr`, and its
 * Shift character when Shift is held. `"Shift"`, `"Control"`, `"Alt"`, and `"Meta"` are the left-hand keys, the
 * same as `"ShiftLeft"` and the rest; `"ShiftRight"` and the others name the right-hand ones. The numeric keypad
 * types with Num Lock on: `"Numpad1"` types `1`, and `"NumpadEnter"` is an Enter. The audio and media keys
 * (`"AudioVolumeMute"`, `"AudioVolumeDown"`, `"AudioVolumeUp"`, `"MediaTrackNext"`, `"MediaTrackPrevious"`,
 * `"MediaPlayPause"`) are their own key values. Each key event's `location` says where its key is: left, right,
 * numpad, or standard.
 *
 * **Gotchas**
 *
 * - Only Chromium sends the media keys; Firefox and WebKit refuse them with `Unsupported` (`input.mediaKeys`).
 * - Firefox and WebKit send a character rather than a place, so a code whose character, with Shift held or not, a
 *   US keyboard has elsewhere fails there with `Unsupported` (`input.keyboardLayout`): `"KeyQ"` on `fr`, which types
 *   `a`, or `"Digit2"` with Shift on `de`, which types `"`. WebKit has no keypad Enter, and refuses `"NumpadEnter"`
 *   the same way.
 * - On Firefox, `"NumpadEnter"` reports its `location` as left (1), as WebDriver's own key table places it.
 * - Firefox and WebKit can't hold both sides of a modifier: a hold or press of `"ShiftRight"` while `"ShiftLeft"` is
 *   held or asked for as a modifier (`{ modifiers: ["Shift"] }`), or the reverse, fails with `Unsupported`
 *   (`input.modifierSides`) before anything is sent.
 *
 * **Example** (Steering with the keys a game reads by place)
 *
 * ```ts import.meta.vitest
 * import { Keyboard, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const forward = Schema.decodeUnknownSync(Keyboard.Key)("KeyW")
 *
 * const steer = Effect.fn("steer")(function*(page: Page.Page) {
 *   yield* page.keyboard.press(forward)
 *   yield* page.keyboard.press("ShiftRight")
 *   yield* page.keyboard.press("Numpad8")
 * })
 * ```
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
 * A keyboard layout, from Unicode CLDR's Windows layouts: which key, with which modifiers, types each character.
 *
 * **Details**
 *
 * `us` is the default (`UserContext.Options.keyboardLayout`); `uk`, `de`, `fr`, `es`, and `it` are the common
 * European ones. A character the layout types with Shift or AltGr is typed with them held. One that only a dead
 * key reaches is typed as the dead key, then the key it combines with. One the layout has no key for is typed as
 * a key of its own, with an empty `code`. The page sees the layout's `key` and `code` (on Firefox, only the
 * `key`); the browser's own layout doesn't change.
 *
 * **Gotchas**
 *
 * WebKit types characters and named keys, not a layout's physical keys, so a character that needs a dead key fails
 * there with `Unsupported` (`input.keyboardLayout`).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Layout = "us" | "uk" | "de" | "fr" | "es" | "it"

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
   * Releases the key early. Running it again does nothing, and neither does closing the scope.
   *
   * **Example** (Releasing Shift before the next click)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const selectAndAdd = Effect.fn("selectAndAdd")(function*(page: Page.Page) {
   *   yield* Effect.scoped(Effect.gen(function*() {
   *     const shift = yield* page.keyboard.hold("Shift")
   *     yield* page.getByRole("option", { name: "Pears" }).click()
   *     yield* shift.release
   *     yield* page.getByRole("button", { name: "Add to cart" }).click()
   *   }))
   * })
   * ```
   */
  readonly release: Effect.Effect<void>
}

/**
 * The keyboard of one page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Keyboard {
  /**
   * Presses and releases one key: a key value such as `"Enter"`, one character, or a key's code such as
   * `"ControlRight"` or `"Numpad1"` (`Keyboard.Key`). Anything else fails with `InvalidInput`.
   *
   * **Details**
   *
   * `"Shift"`, `"Control"`, `"Alt"`, and `"Meta"` press the left-hand keys. The numeric keypad types with Num Lock
   * on, so `"Numpad1"` types `1`. A letter's code types what the context's layout puts there.
   *
   * @default `"Shift"`, `"Control"`, `"Alt"`, and `"Meta"` press the left-hand keys; the keypad types with Num Lock on
   *
   * **Example** (Closing a menu with Escape)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const closeMenu = Effect.fn("closeMenu")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Account" }).click()
   *   yield* page.keyboard.press("Escape")
   * })
   * ```
   */
  press(
    key: Key | string,
    options?: PressOptions | undefined
  ): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>
  /**
   * Types text one key at a time, with key events for each character.
   *
   * **Example** (Typing a PIN slowly)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Redacted } from "effect"
   *
   * const enterPin = Effect.fn("enterPin")(
   *   function*(page: Page.Page, pin: Redacted.Redacted<string>) {
   *     yield* page.getByLabel("PIN").click()
   *     yield* page.keyboard.pressSequentially(pin, { delay: "100 millis" })
   *   }
   * )
   * ```
   */
  pressSequentially(
    text: string | Redacted.Redacted<string>,
    options?: TypeOptions | undefined
  ): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>
  /**
   * Inserts text without key events, as an input method would, into the focused element, in whichever frame
   * holds the focus.
   *
   * **Details**
   *
   * The page gets a cancelable `beforeinput` (`insertText`, with the whole text) and then `input`; a page that
   * cancels the `beforeinput` gets nothing inserted. A newline goes into a textarea or a contenteditable element as
   * a line break, and never submits a form. Chromium inserts the text with its own command. Firefox and stock
   * WebKit insert it with the page's editing command (`execCommand("insertText")`).
   *
   * **Gotchas**
   *
   * - Firefox's editing command fires no `beforeinput`, so on Firefox Strider dispatches it itself, and it is
   *   untrusted: its `isTrusted` is `false`.
   *
   * **Example** (Entering text an input method composes)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const searchInJapanese = Effect.fn("searchInJapanese")(function*(page: Page.Page) {
   *   yield* page.getByRole("searchbox").click()
   *   yield* page.keyboard.insertText("東京")
   * })
   * ```
   */
  insertText(
    text: string | Redacted.Redacted<string>
  ): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>
  /**
   * Holds a key down until the returned handle is released or its scope closes. Input sent meanwhile carries it,
   * so a click while Shift is held is a Shift-click.
   *
   * **Example** (Selecting several options with Shift held)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const selectRange = Effect.fn("selectRange")(function*(page: Page.Page) {
   *   yield* Effect.scoped(Effect.gen(function*() {
   *     yield* page.keyboard.hold("Shift")
   *     yield* page.getByRole("option", { name: "Apples" }).click()
   *     yield* page.getByRole("option", { name: "Pears" }).click()
   *   }))
   * })
   * ```
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
 * **Example** (Pressing a shortcut from configuration)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const pressShortcut = Effect.fn("pressShortcut")(
 *   function*(page: Page.Page, key: string) {
 *     yield* page.keyboard.press(key).pipe(
 *       Effect.catchReason(
 *         "KeyboardError",
 *         "InvalidInput",
 *         (invalid) => Effect.logWarning(invalid.hint)
 *       )
 *     )
 *   }
 * )
 * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
