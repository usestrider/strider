/**
 * Locators find elements, and act on them or read them.
 *
 * A locator is a value: a description of how to find elements, resolved again on every attempt, so it never
 * goes stale. Chained queries are relative to their parent. Reads are one-shot and never retry; retrying
 * assertions are `Expect`. A ref from a snapshot is the one exception to re-resolution: it is pinned to one
 * node and fails with `StaleRef` rather than rebinding.
 *
 * Before acting, a locator checks actionability: the CONCEPTS.md §8 predicates, checked in one injected round
 * trip per attempt. The checks are named, adjustable per call with `checks`, and reported in errors. An
 * action needs exactly one match, so ambiguity fails at once with the candidates and a suggested locator. An
 * action dispatches at most once.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Equal from "effect/Equal"
import type * as Inspectable from "effect/Inspectable"
import type * as Option from "effect/Option"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as AriaRole from "./AriaRole.ts"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FileInput from "./FileInput.ts"
import type * as JSHandle from "./JSHandle.ts"
import type * as Keyboard from "./Keyboard.ts"
import type * as Mouse from "./Mouse.ts"
import * as Reason from "./Reason.ts"
import type * as Snapshot from "./Snapshot.ts"
import type * as Target from "./Target.ts"

const TypeId = "~@usestrider/browser/Locator"

/**
 * Settings for `getByRole`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RoleOptions {
  /**
   * The accessible name. A string matches as a case-insensitive substring unless `exact` is set; a `RegExp`
   * is used as given.
   *
   * @default any name
   */
  readonly name?: string | RegExp | undefined
  /**
   * Match `name` exactly and case-sensitively.
   *
   * @default false
   */
  readonly exact?: boolean | undefined
  /**
   * Match elements hidden from the accessibility tree too.
   *
   * @default false
   */
  readonly includeHidden?: boolean | undefined
}

/**
 * Settings for the text queries: `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText` and
 * `getByTitle`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TextOptions {
  /**
   * Match a string exactly and case-sensitively, instead of as a case-insensitive substring.
   *
   * @default false
   */
  readonly exact?: boolean | undefined
}

/**
 * The queries every locator, frame and page offers, returning `L`.
 *
 * **Details**
 *
 * `L` carries access: a `ReadonlyPage`'s queries return `ReadonlyLocator`s, which can read but not act.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Queries<L> {
  /**
   * Elements with this ARIA role, and optionally this accessible name.
   */
  getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): L
  /**
   * Elements whose rendered text matches.
   */
  getByText(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Form controls whose label matches.
   */
  getByLabel(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Inputs whose placeholder matches.
   */
  getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Images and areas whose alt text matches.
   */
  getByAltText(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Elements whose `title` attribute matches.
   */
  getByTitle(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Elements whose `data-testid` attribute is `id`.
   */
  getByTestId(id: string): L
  /**
   * Elements matching a CSS selector. A malformed selector fails with `InvalidInput` when used, at once.
   */
  locator(css: string): L
}

/**
 * Settings for narrowing a locator with `filter`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FilterOptions {
  /**
   * Keep elements that contain a match for this relative locator.
   */
  readonly has?: RelativeLocator | undefined
  /**
   * Keep elements that contain no match for this relative locator.
   */
  readonly hasNot?: RelativeLocator | undefined
  /**
   * Keep elements whose text contains this.
   */
  readonly hasText?: string | RegExp | undefined
  /**
   * Keep elements whose text doesn't contain this.
   */
  readonly hasNotText?: string | RegExp | undefined
  /**
   * Keep only visible elements, or only hidden ones.
   */
  readonly visible?: boolean | undefined
}

/**
 * A locator that can read but not act, as handed out by a page you may only inspect.
 *
 * **Details**
 *
 * Equal by value: two locators built the same way from the same page are equal.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadonlyLocator
  extends Queries<ReadonlyLocator>, Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable
{
  readonly [TypeId]: typeof TypeId
  /**
   * Enters an iframe, found by this locator's query for its element.
   */
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
  /**
   * Narrows the matches.
   */
  filter(options: FilterOptions): ReadonlyLocator
  /**
   * Elements that match both locators.
   */
  and(other: ReadonlyLocator): ReadonlyLocator
  /**
   * Elements that match either locator.
   */
  or(other: ReadonlyLocator): ReadonlyLocator
  /**
   * The match at `index`, counting from 0. Positional, and says so in errors.
   */
  nth(index: number): ReadonlyLocator
  /**
   * The first match; `nth(0)`.
   */
  readonly first: ReadonlyLocator
  /**
   * The last match.
   */
  readonly last: ReadonlyLocator
  /**
   * A label used in errors and traces instead of the query.
   */
  describe(label: string): ReadonlyLocator
  /**
   * How many elements match now.
   */
  readonly count: Effect.Effect<number, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * The rendered text of the one match (`innerText`).
   */
  readonly readText: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * The value of the one matching form control.
   */
  readonly readValue: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * The HTML of the one match (`outerHTML`).
   */
  readonly readHtml: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * An attribute of the one match, or `None` when it is absent.
   */
  readAttribute(name: string): Effect.Effect<Option.Option<string>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is visible now.
   */
  readonly isVisible: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is enabled now.
   */
  readonly isEnabled: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is checked now.
   */
  readonly isChecked: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * One locator per current match, each pinned to its position with `nth`.
   */
  readonly all: Effect.Effect<ReadonlyArray<ReadonlyLocator>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * A snapshot of the one match's subtree.
   */
  snapshot(
    options?: Snapshot.Options | undefined
  ): Effect.Effect<Snapshot.Snapshot<ReadonlyLocator>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the isolated world with the one match as its first argument, and returns the result by
   * value.
   */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (element: Element, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<B>, LocatorError | Target.TargetGone | Deadline.Timeout>
}

/**
 * The actionability checks an action runs before it dispatches.
 *
 * **Details**
 *
 * Each action documents which checks it runs. Turning one off is explicit and is recorded in the action's
 * span. `stable` waits for the element's box to stay put for some animation frames; the default count is per
 * backend and shown in spans and errors.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Checks {
  readonly visible?: boolean | undefined
  readonly enabled?: boolean | undefined
  readonly editable?: boolean | undefined
  readonly notInert?: boolean | undefined
  readonly inViewport?: boolean | undefined
  readonly receivesPointer?: boolean | undefined
  readonly stable?: boolean | { readonly frames: number } | undefined
}

/**
 * Settings every action takes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ActionOptions {
  /**
   * Overrides for the action's checks.
   *
   * @default every check the action documents
   */
  readonly checks?: Checks | undefined
  /**
   * Run every check and dispatch nothing.
   *
   * @default false
   */
  readonly trial?: boolean | undefined
}

/**
 * Settings for actions that use the pointer.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PointerOptions extends ActionOptions {
  /**
   * Where to point, from the element's padding box.
   *
   * @default the centre of the padding box
   */
  readonly position?: Mouse.Point | undefined
  /**
   * Modifiers held for the action.
   *
   * @default none
   */
  readonly modifiers?: ReadonlyArray<Keyboard.Modifier> | undefined
}

/**
 * Settings for `click` and `dblclick`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClickOptions extends PointerOptions {
  /**
   * The button to click.
   *
   * @default "left"
   */
  readonly button?: Mouse.Button | undefined
}

/**
 * Settings for `dragTo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DragOptions extends PointerOptions {
  /**
   * Where to drop, from the target's padding box.
   *
   * @default the centre of the target's padding box
   */
  readonly targetPosition?: Mouse.Point | undefined
  /**
   * Intermediate pointer moves between source and target.
   *
   * @default 1
   */
  readonly steps?: number | undefined
}

/**
 * Settings for `press`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PressOptions extends ActionOptions, Keyboard.PressOptions {}

/**
 * Settings for `pressSequentially`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TypeOptions extends ActionOptions, Keyboard.TypeOptions {}

/**
 * Which option of a `<select>` to choose, by value, label or index; which one is always stated.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SelectOption =
  | { readonly value: string }
  | { readonly label: string }
  | { readonly index: number }

type ActionEffect = Effect.Effect<void, LocatorError | Target.TargetGone | Deadline.Timeout>

/**
 * A locator that can act, as handed out by a page you control.
 *
 * **Details**
 *
 * Each action checks actionability, then dispatches at most once. Every action takes a trailing `options`,
 * whose `checks` override the documented checks.
 *
 * **Example** (Filling and submitting a form)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const signIn = Effect.fn("signIn")(function*(page: Page.Page) {
 *   yield* page.getByLabel("Email").fill("me@example.com")
 *   yield* page.getByLabel("Password").fill(yield* Config.Redacted("PASSWORD"))
 *   yield* page.getByRole("button", { name: "Sign in" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Locator extends ReadonlyLocator {
  getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): Locator
  getByText(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByLabel(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByAltText(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByTitle(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByTestId(id: string): Locator
  locator(css: string): Locator
  frame(iframe: ReadonlyLocator): FrameLocator
  filter(options: FilterOptions): Locator
  and(other: ReadonlyLocator): Locator
  or(other: ReadonlyLocator): Locator
  nth(index: number): Locator
  readonly first: Locator
  readonly last: Locator
  describe(label: string): Locator
  readonly all: Effect.Effect<ReadonlyArray<Locator>, LocatorError | Target.TargetGone | Deadline.Timeout>
  snapshot(
    options?: Snapshot.Options | undefined
  ): Effect.Effect<Snapshot.Snapshot<Locator>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Clicks the one match. Checks: visible, stable, enabled, notInert, inViewport (scrolling it into view),
   * receivesPointer.
   */
  click(options?: ClickOptions | undefined): ActionEffect
  /**
   * Double-clicks the one match, with the same checks as `click`.
   */
  dblclick(options?: ClickOptions | undefined): ActionEffect
  /**
   * Taps the one match with a touch event, with the same checks as `click`.
   */
  tap(options?: PointerOptions | undefined): ActionEffect
  /**
   * Moves the pointer over the one match. Checks: visible, stable, enabled, notInert, inViewport,
   * receivesPointer.
   */
  hover(options?: PointerOptions | undefined): ActionEffect
  /**
   * Checks a checkbox or radio, and confirms it became checked. Checks as `click`.
   */
  check(options?: PointerOptions | undefined): ActionEffect
  /**
   * Unchecks a checkbox, and confirms it became unchecked. Checks as `click`.
   */
  uncheck(options?: PointerOptions | undefined): ActionEffect
  /**
   * Focuses the one match. Checks: visible, notInert.
   */
  focus(options?: ActionOptions | undefined): ActionEffect
  /**
   * Clears an input or editable element. Checks: visible, enabled, editable, notInert.
   */
  clear(options?: ActionOptions | undefined): ActionEffect
  /**
   * Scrolls the one match into view. Checks: visible, stable.
   */
  scrollIntoView(options?: ActionOptions | undefined): ActionEffect
  /**
   * Replaces the value of an input or editable element. Checks: visible, enabled, editable, notInert.
   *
   * **Details**
   *
   * A `Redacted` value is typed into the page but never shown in spans, traces or errors.
   */
  fill(value: string | Redacted.Redacted<string>, options?: ActionOptions | undefined): ActionEffect
  /**
   * Focuses the one match and presses one key.
   */
  press(key: Keyboard.Key | string, options?: PressOptions | undefined): ActionEffect
  /**
   * Focuses the one match and types text one key at a time.
   */
  pressSequentially(text: string | Redacted.Redacted<string>, options?: TypeOptions | undefined): ActionEffect
  /**
   * Chooses options of a `<select>`, by value, label or index.
   */
  selectOption(
    choice: SelectOption | ReadonlyArray<SelectOption>,
    options?: ActionOptions | undefined
  ): ActionEffect
  /**
   * Sets the files of a file input.
   */
  setInputFiles(
    files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>,
    options?: ActionOptions | undefined
  ): ActionEffect
  /**
   * Drags the one match onto `target`.
   */
  dragTo(target: ReadonlyLocator, options?: DragOptions | undefined): ActionEffect
}

/**
 * Checks whether a value is a locator.
 *
 * **Gotchas**
 *
 * This identifies the kind, not the access: it narrows to `ReadonlyLocator`. A locator that can act comes
 * only from a page you control.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isLocator = (u: unknown): u is ReadonlyLocator => Predicate.hasProperty(u, TypeId)

declare const RelativeLocatorTypeId: unique symbol

/**
 * A query relative to the element being filtered, valid only inside `filter({ has })`.
 *
 * **Details**
 *
 * A page-rooted locator in `has` would match anywhere on the page, so it is a type error.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RelativeLocator extends Queries<RelativeLocator> {
  readonly [RelativeLocatorTypeId]: typeof RelativeLocatorTypeId
}

/**
 * The queries that build a `RelativeLocator`.
 *
 * **Example** (Rows that contain a Delete button)
 *
 * ```ts import.meta.vitest
 * import { Locator, Page } from "@usestrider/browser"
 *
 * const deletableRows = (page: Page.Page) =>
 *   page.getByRole("row").filter({ has: Locator.relative.getByRole("button", { name: "Delete" }) })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const relative: Queries<RelativeLocator>

/**
 * An iframe's document, entered by its element; lazy like any locator.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadonlyFrameLocator extends Queries<ReadonlyLocator> {
  /**
   * The iframe element.
   */
  readonly owner: ReadonlyLocator
  /**
   * Enters a nested iframe.
   */
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
}

/**
 * An iframe's document on a page you control, whose locators can act.
 *
 * **Example** (Paying inside an embedded form)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const pay = Effect.fn("pay")(function*(page: Page.Page) {
 *   const payment = page.frame(page.locator("iframe#payment"))
 *   yield* payment.getByLabel("Card number").fill("4242 4242 4242 4242")
 *   yield* payment.getByRole("button", { name: "Pay" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameLocator extends ReadonlyFrameLocator {
  getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): Locator
  getByText(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByLabel(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByAltText(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByTitle(text: string | RegExp, options?: TextOptions | undefined): Locator
  getByTestId(id: string): Locator
  locator(css: string): Locator
  frame(iframe: ReadonlyLocator): FrameLocator
}

/**
 * Reason for an action or read that matched more than one element.
 *
 * **Details**
 *
 * `candidates` describes each match, and `suggestions` are locators that would match one, such as
 * `getByRole('button', { name: 'Save' })`.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class StrictViolation extends Schema.Error<StrictViolation>("@usestrider/browser/Locator/StrictViolation")({
  _tag: Schema.tag("StrictViolation"),
  candidates: Schema.Array(Schema.Struct({ description: Schema.String, visible: Schema.Boolean })),
  suggestions: Schema.Array(Schema.String),
  hint: Schema.String
}) {
  override get message(): string {
    return `${this.candidates.length} matches (${this.hint})`
  }
}

/**
 * Reason for a snapshot ref that no longer points at its node.
 *
 * **Details**
 *
 * - `Replaced`: the document was replaced by a navigation.
 * - `Detached`: the node was removed.
 * - `Suspended`: the document is in the back/forward cache.
 * - `BindingLost`: the page re-rendered the node.
 * - `OtherSnapshot`: the ref belongs to a different snapshot's generation.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class StaleRef extends Schema.Error<StaleRef>("@usestrider/browser/Locator/StaleRef")({
  _tag: Schema.tag("StaleRef"),
  why: Schema.Literals(["Replaced", "Detached", "Suspended", "BindingLost", "OtherSnapshot"]),
  hint: Schema.String
}) {
  override get message(): string {
    return `Stale ref: ${this.why} (${this.hint})`
  }
}

/**
 * Reason for an input action on an element that can't take input.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NotEditable extends Schema.Error<NotEditable>("@usestrider/browser/Locator/NotEditable")({
  _tag: Schema.tag("NotEditable"),
  element: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `${this.element} is not editable (${this.hint})`
  }
}

/**
 * Reason for a local file that couldn't be read for upload.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class FileUnreadable extends Schema.Error<FileUnreadable>("@usestrider/browser/Locator/FileUnreadable")({
  _tag: Schema.tag("FileUnreadable"),
  path: Schema.String,
  hint: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return `Can't read ${this.path} (${this.hint})`
  }
}

/**
 * Schema for the reasons a locator operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LocatorErrorReason = Schema.Union([
  StrictViolation,
  StaleRef,
  NotEditable,
  FileUnreadable,
  Reason.InvalidInput,
  Reason.EvaluationThrown,
  Reason.NotSerializable,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a locator operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LocatorErrorReason = typeof LocatorErrorReason.Type

const LocatorErrorTypeId = "~@usestrider/browser/Locator/LocatorError"

/**
 * Error for a locator action or read that failed.
 *
 * **Details**
 *
 * `operation` names what was attempted, such as `click`, and `locator` describes the query, or its
 * `describe` label. Ambiguity, a bad selector and a stale ref fail at once; only waiting for checks to pass
 * uses the deadline.
 *
 * **Example** (Recovering from an ambiguous locator)
 *
 * ```ts import.meta.vitest
 * import { Console, Effect } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const save = Effect.fn("save")(function*(page: Page.Page) {
 *   yield* page.getByText("Save").click().pipe(
 *     Effect.catchReason("LocatorError", "StrictViolation", (reason) => Console.log(reason.suggestions))
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class LocatorError extends Schema.TaggedError<LocatorError>(LocatorErrorTypeId)("LocatorError", {
  operation: Schema.String,
  locator: Schema.String,
  reason: LocatorErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [LocatorErrorTypeId] = LocatorErrorTypeId
  override get message(): string {
    return `${this.operation} ${this.locator}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `LocatorError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isLocatorError = (u: unknown): u is LocatorError => Predicate.hasProperty(u, LocatorErrorTypeId)
