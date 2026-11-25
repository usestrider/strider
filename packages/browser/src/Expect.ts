/**
 * Expectations that retry: each `Expect.to*` checks until it passes or the deadline passes.
 *
 * A locator's expectation waits in the page: it checks once, then again on each change the page makes (a DOM
 * mutation, an `input`, `change`, or focus event, an animation frame), so there is no polling interval and no change
 * is missed between checks. `toHaveJSProperty` is the exception: a property assignment is no change the page
 * reports, so it reads the property again as `withChecks` sets. `toHaveURL` checks the page's URL on each change.
 * `Expect.that` checks a `Watchable` on each change, and runs any other effect again as `withChecks` sets.
 * Everything runs on the real clock, within the deadline. To collect several failures, use `Effect.validate` or `Effect.all(…, { mode: "result" })`.
 *
 * Matchers that take arguments are dual: `locator.pipe(Expect.toHaveText("1 item"))` or
 * `Expect.toHaveText(locator, "1 item")`. Matchers without arguments are the function itself:
 * `locator.pipe(Expect.toBeVisible)`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as AriaPattern from "./AriaPattern.ts"
import type * as Condition from "./Condition.ts"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ConditionImpl from "./internal/condition.ts"
import * as ExpectImpl from "./internal/expect.ts"
import * as OperationImpl from "./internal/operation.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Locator from "./Locator.ts"
import * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
import * as Watchable from "./Watchable.ts"

/**
 * A matcher that takes no arguments: the function is the expectation, as in `locator.pipe(Expect.toBeVisible)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Matcher<S> = (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone | Deadline.Timeout>

/**
 * A matcher with arguments, usable data-first or in `pipe`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DualMatcher<S, Args extends ReadonlyArray<unknown>> {
  (...args: Args): (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone | Deadline.Timeout>
  (subject: S, ...args: Args): Effect.Effect<void, ExpectationFailed | Target.TargetGone | Deadline.Timeout>
}

/**
 * Expects the locator to match exactly one element connected to the document, including a shadow tree.
 *
 * **Details**
 *
 * Hidden elements count as attached. Missing or multiple matches retry until the deadline.
 * A failure is an `ExpectationFailed` with observed `{ matches: number }` entries.
 * Uses the locator's page and access grant; a closed page fails with `TargetGone`.
 *
 * **Example** (Waiting for document attachment)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const wait = Effect.fn("wait")(function*(page: Page.ReadonlyPage) {
 *   yield* page.locator("#status").pipe(Expect.toBeAttached)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeAttached: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeAttached(locator)

/**
 * Expects the locator to match no elements in the document, including its shadow trees.
 *
 * **Details**
 *
 * Hidden elements remain attached. One or multiple matches retry until the deadline.
 * A failure is an `ExpectationFailed` with observed `{ matches: number }` entries.
 * Uses the locator's page and access grant; a closed page fails with `TargetGone`.
 *
 * **Example** (Waiting for document attachment)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const wait = Effect.fn("wait")(function*(page: Page.ReadonlyPage) {
 *   yield* page.locator("#status").pipe(Expect.toBeDetached)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeDetached: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeDetached(locator)

/**
 * Expects the one match to be visible.
 *
 * **Details**
 *
 * An element with `opacity: 0` on itself or any ancestor counts as hidden, so this waits for it to become visible.
 *
 * **Example** (Waiting for a welcome message)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const welcomed = Effect.fn("welcomed")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeVisible: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeVisible(locator)

/**
 * Expects the one match to intersect the viewport at the requested ratio.
 *
 * **Details**
 *
 * Uses the browser's intersection ratio, including clipping by ancestors. A positive ratio is required even
 * when `ratio` is zero. Opacity and overlapping elements do not affect the ratio. With `inViewport: false`,
 * waits for the condition's inverse, and also passes when nothing matches. Multiple matches never pass.
 * Observation belongs to this expectation and is released when it ends; it does not scroll the element.
 *
 * **Example** (Waiting for half a card)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const card = Effect.fn("card")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("article").pipe(Expect.toBeInViewport({ ratio: 0.5 }))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeInViewport: DualMatcher<Locator.ReadonlyLocator, [
  options?: {
    /** Minimum intersection ratio. @default 0 */
    readonly ratio?: number | undefined
    /** Whether to require intersection or its inverse. @default true */
    readonly inViewport?: boolean | undefined
  } | undefined
]> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    options?: { readonly ratio?: number | undefined; readonly inViewport?: boolean | undefined } | undefined
  ) => ExpectImpl.toBeInViewport(locator, options)
)

/**
 * Expects no match to be visible: passes when every match is hidden, or when nothing matches.
 *
 * **Example** (Waiting for a spinner to go)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const loaded = Effect.fn("loaded")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("progressbar").pipe(Expect.toBeHidden)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeHidden: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeHidden(locator)

/**
 * Expects the one match to be enabled.
 *
 * **Details**
 *
 * An element inside a button, or inside an element with the role `button`, `checkbox`, or `radio`, is enabled only
 * when it and the nearest such control both are. The control is found through shadow roots and the slots the
 * element is assigned to: a span inside a disabled button is disabled. Inputs, textareas, selects, and editable
 * content are read on themselves alone. Native `disabled`, a disabled `fieldset`, and `aria-disabled` all count.
 *
 * **Example** (Checking that a complete form can be submitted)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const orderReady = Effect.fn("orderReady")(function*(page: Page.Page) {
 *   yield* page.getByLabel("Card number").fill("4242 4242 4242 4242")
 *   yield* page.getByRole("button", { name: "Place order" }).pipe(Expect.toBeEnabled)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeEnabled: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeEnabled(locator)

/**
 * Expects the one match to be disabled.
 *
 * **Details**
 *
 * An element inside a button, or inside an element with the role `button`, `checkbox`, or `radio`, is enabled only
 * when it and the nearest such control both are. The control is found through shadow roots and the slots the
 * element is assigned to: a span inside a disabled button is disabled. Inputs, textareas, selects, and editable
 * content are read on themselves alone. Native `disabled`, a disabled `fieldset`, and `aria-disabled` all count.
 *
 * **Example** (Checking that a sold-out item can't be added)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const soldOut = Effect.fn("soldOut")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("button", { name: "Add to cart" }).pipe(Expect.toBeDisabled)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeDisabled: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeDisabled(locator)

/**
 * Expects the one match to be checked.
 *
 * **Example** (Checking the default shipping option)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const standardShipping = Effect.fn("standardShipping")(
 *   function*(page: Page.ReadonlyPage) {
 *     yield* page.getByRole("radio", { name: "Standard shipping" }).pipe(
 *       Expect.toBeChecked
 *     )
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeChecked: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeChecked(locator)

/**
 * Expects the one match to have focus.
 *
 * **Example** (Checking that a dialog focuses its first field)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openSignIn = Effect.fn("openSignIn")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Sign in" }).click()
 *   yield* page.getByLabel("Email").pipe(Expect.toBeFocused)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeFocused: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeFocused(locator)

/**
 * Expects the one match to have an empty value or no text apart from whitespace.
 *
 * **Details**
 *
 * Inputs and textareas use their current value without trimming. Other elements use trimmed
 * `textContent`, including descendant text. Missing or multiple matches keep retrying until the
 * deadline. Failure evidence reports match counts or whether the element is empty.
 *
 * **Example** (Waiting for a field to clear)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const cleared = Effect.fn("cleared")(function*(page: Page.Page) {
 *   yield* page.getByLabel("Search").pipe(Expect.toBeEmpty)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeEmpty: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeEmpty(locator)

/**
 * Expects the one match to accept input.
 *
 * **Example** (Waiting for an address field to unlock)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const editAddress = Effect.fn("editAddress")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Edit address" }).click()
 *   yield* page.getByLabel("Street").pipe(Expect.toBeEditable)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeEditable: Matcher<Locator.ReadonlyLocator> = (locator) => ExpectImpl.toBeEditable(locator)

/**
 * Expects the one match's text to match `expected`, or, given a list, as many matches as the list has entries,
 * each matching its entry in order.
 *
 * **Details**
 *
 * A string must equal the whole text, case-sensitively, after whitespace is collapsed; a `RegExp` is tested as
 * given. `ignoreCase: true` compares strings without case and sets a regular expression's `i` flag;
 * `ignoreCase: false` clears it; left out, regular expressions keep their flags. Case is folded without regard to
 * the browser's locale. The text is the element's text content, which includes hidden descendants;
 * `useInnerText: true` reads its rendered `innerText` instead, and the text content still for an element that
 * isn't an HTML element, such as an SVG one.
 *
 * **Gotchas**
 *
 * `innerText` depends on layout and CSS, such as `display: none` and `text-transform`, and browsers compute it
 * differently in places, so the same page can give different text in each.
 *
 * **Example** (Checking the cart's items in order)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const cartItems = Effect.fn("cartItems")(function*(page: Page.ReadonlyPage) {
 *   const items = page.getByRole("list", { name: "Cart" }).getByRole("listitem")
 *   yield* items.pipe(Expect.toHaveText(["Headphones", /^Charger/]))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveText: DualMatcher<
  Locator.ReadonlyLocator,
  [expected: string | RegExp | ReadonlyArray<string | RegExp>, options?: TextOptions | undefined]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    expected: string | RegExp | ReadonlyArray<string | RegExp>,
    options?: TextOptions | undefined
  ) => ExpectImpl.toHaveText(locator, expected, options)
)

/**
 * The options of `toHaveText` and `toContainText`: whether to ignore case, and whether to read the rendered text.
 *
 * **Example** (Matching a heading's rendered text in any case)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const options: Expect.TextOptions = { ignoreCase: true, useInnerText: true }
 *
 * const checkHeading = Effect.fn("checkHeading")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("heading").pipe(Expect.toHaveText("order placed", options))
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TextOptions {
  /**
   * Compares strings without case, and sets a regular expression's `i` flag; `false` clears it. Case is folded
   * without regard to the browser's locale, as the `i` flag folds it.
   *
   * @default undefined: strings match case, and regular expressions keep their flags
   */
  readonly ignoreCase?: boolean | undefined
  /**
   * Reads each element's rendered `innerText` instead of its text content, with whitespace collapsed alike. An
   * element that isn't an HTML element, such as an SVG one, has no `innerText`, so its text content is read.
   *
   * @default false
   */
  readonly useInnerText?: boolean | undefined
}

/**
 * Expects the one match's accessible name to match `expected`, retrying until the deadline.
 *
 * **Details**
 *
 * Strings match the whole name after whitespace is collapsed on both sides, so a non-breaking space matches a
 * space. Regular expressions test the computed name, which keeps non-breaking spaces.
 * `ignoreCase` overrides a regular expression's `i` flag when supplied, and folds a string's case without regard
 * to the browser's locale; otherwise strings are case-sensitive
 * and regular expressions keep their flags. Hidden elements have an empty name; hidden labels can name a
 * visible element. Roles that prohibit naming, such as generic, paragraph, and code, have an empty name;
 * their content can still contribute to another element's name. An explicit nameable role can override the
 * implicit role. Missing or multiple matches keep retrying and fail with their match count.
 *
 * **Example** (Checking a save button's accessible name)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const checkSave = Effect.fn("checkSave")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByTestId("save").pipe(Expect.toHaveAccessibleName("Save changes"))
 *   yield* Expect.toHaveAccessibleName(page.getByTestId("save"), /save/, {
 *     ignoreCase: true
 *   })
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveAccessibleName: DualMatcher<
  Locator.ReadonlyLocator,
  [expected: string | RegExp, options?: { readonly ignoreCase?: boolean | undefined } | undefined]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    expected: string | RegExp,
    options?: { readonly ignoreCase?: boolean | undefined } | undefined
  ) => ExpectImpl.toHaveAccessibleName(locator, expected, options)
)

/**
 * Expects the one match's accessible description to match `expected`, retrying until the deadline.
 *
 * **Details**
 *
 * The description comes from the first of these that applies, even when its text is empty: the elements
 * `aria-describedby` names, joined by a space, when at least one of its IDs names an element; `aria-description`,
 * when present; a table's caption or a button, submit, or reset input's `value`, when that didn't give the element
 * its name; a `summary` element's content, when `aria-label` or `aria-labelledby` gave it its name; and the `title`
 * attribute, when it isn't the element's name. An element named there counts even when it's hidden, with its
 * hidden content; a hidden element itself has an empty description. Strings and regular expressions match as in `toHaveAccessibleName`, and so does
 * `ignoreCase`. `not` negates only the comparison: missing or multiple matches keep retrying and fail with their
 * match count, with or without it.
 *
 * **Example** (Checking a field's hint)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const checkHint = Effect.fn("checkHint")(function*(page: Page.ReadonlyPage) {
 *   const password = page.getByLabel("Password")
 *   yield* password.pipe(Expect.toHaveAccessibleDescription("At least 12 characters"))
 *   yield* Expect.toHaveAccessibleDescription(password, /characters/, {
 *     ignoreCase: true
 *   })
 *   yield* password.pipe(Expect.toHaveAccessibleDescription("", { not: true }))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveAccessibleDescription: DualMatcher<
  Locator.ReadonlyLocator,
  [
    expected: string | RegExp,
    options?: {
      /** Compares without regard to case, replacing a regular expression's `i` flag. @default undefined */
      readonly ignoreCase?: boolean | undefined
      /** Negates the comparison; still requires exactly one match. @default false */
      readonly not?: boolean | undefined
    } | undefined
  ]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    expected: string | RegExp,
    options?: { readonly ignoreCase?: boolean | undefined; readonly not?: boolean | undefined } | undefined
  ) => ExpectImpl.toHaveAccessibleDescription(locator, expected, options)
)

/**
 * Expects the one match's accessible error message to match `expected`, retrying until the deadline.
 *
 * **Details**
 *
 * The error message is the text of the elements `aria-errormessage` names, joined by a space, while the element is
 * invalid: its `aria-invalid` is set to anything but a blank value or exactly `false` (in any case), or the browser's
 * own validation finds its value invalid, as a `required` field left empty or an email field holding no address.
 * Otherwise it's empty. An element named there counts even when it's hidden. Strings and regular expressions
 * match as in `toHaveAccessibleName`, and so does `ignoreCase`. `not` negates only the comparison: missing or
 * multiple matches keep retrying and fail with their match count, with or without it.
 *
 * **Example** (Checking a field's error)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const checkError = Effect.fn("checkError")(function*(page: Page.Page) {
 *   const email = page.getByLabel("Email")
 *   yield* email.fill("not an address")
 *   yield* email.pipe(Expect.toHaveAccessibleErrorMessage("Enter a valid email address"))
 *   yield* Expect.toHaveAccessibleErrorMessage(email, /valid email/, { ignoreCase: true })
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveAccessibleErrorMessage: DualMatcher<
  Locator.ReadonlyLocator,
  [
    expected: string | RegExp,
    options?: {
      /** Compares without regard to case, replacing a regular expression's `i` flag. @default undefined */
      readonly ignoreCase?: boolean | undefined
      /** Negates the comparison; still requires exactly one match. @default false */
      readonly not?: boolean | undefined
    } | undefined
  ]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    expected: string | RegExp,
    options?: { readonly ignoreCase?: boolean | undefined; readonly not?: boolean | undefined } | undefined
  ) => ExpectImpl.toHaveAccessibleErrorMessage(locator, expected, options)
)

/**
 * Expects the one match's class string to match `expected`, or, given a list, as many matches as the list has entries,
 * each matching its entry in order.
 *
 * **Details**
 *
 * Strings compare the whole class string, preserving case, whitespace, and class order. Regular expressions
 * are tested as given. Missing class attributes are empty strings. Scalars retry zero or multiple matches;
 * an empty array passes when nothing matches. Failures include the observed class strings or match count.
 *
 * **Example** (Checking item classes in order)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const cartItems = Effect.fn("cartItems")(function*(page: Page.ReadonlyPage) {
 *   const items = page.getByRole("list", { name: "Cart" }).getByRole("listitem")
 *   yield* items.pipe(Expect.toHaveClass(["selected", /^pending/]))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveClass: DualMatcher<
  Locator.ReadonlyLocator,
  [expected: string | RegExp | ReadonlyArray<string | RegExp>]
> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string | RegExp | ReadonlyArray<string | RegExp>) =>
    ExpectImpl.toHaveClass(locator, expected)
)

/**
 * Expects the text of the one match to contain `expected`, or, given a list, the entries to be contained in
 * matches in the same order, each entry in a later match than the one before.
 *
 * **Details**
 *
 * A string is matched case-sensitively, after whitespace is collapsed; a `RegExp` is tested as given.
 * `ignoreCase` and `useInnerText` work as in `toHaveText`. A list needs no entry for every match: `["a", "c"]`
 * passes for matches whose texts are `a`, `b`, and `c`, but not for `c`, `b`, and `a`. An empty list passes only
 * when nothing matches.
 *
 * **Gotchas**
 *
 * With `useInnerText`, the text depends on layout and can differ between browsers, as in `toHaveText`.
 *
 * **Example** (Waiting for a save to be confirmed)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const saved = Effect.fn("saved")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("status").pipe(Expect.toContainText("Saved"))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toContainText: DualMatcher<
  Locator.ReadonlyLocator,
  [expected: string | RegExp | ReadonlyArray<string | RegExp>, options?: TextOptions | undefined]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    expected: string | RegExp | ReadonlyArray<string | RegExp>,
    options?: TextOptions | undefined
  ) => ExpectImpl.toContainText(locator, expected, options)
)

/**
 * Expects the value of the one matching form control to match.
 *
 * **Example** (Checking a quantity after a click)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const addOne = Effect.fn("addOne")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Increase quantity" }).click()
 *   yield* page.getByLabel("Quantity").pipe(Expect.toHaveValue("2"))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveValue: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string | RegExp) => ExpectImpl.toHaveValue(locator, expected)
)

/**
 * Expects the selected values of one multiple select to match in option order.
 *
 * **Details**
 *
 * Strings match exactly, including whitespace; regular expressions test each value.
 * An empty array expects no selected options. Labels resolve to their associated control.
 * Missing or multiple matches and controls other than a multiple select retry until the deadline,
 * then fail with `ExpectationFailed` evidence.
 *
 * **Example** (Checking selected colors)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const colors = Effect.fn("colors")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByLabel("Colors").pipe(Expect.toHaveValues(["red", /green/]))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveValues: DualMatcher<Locator.ReadonlyLocator, [expected: ReadonlyArray<string | RegExp>]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: ReadonlyArray<string | RegExp>) =>
    ExpectImpl.toHaveValues(locator, expected)
)

/**
 * Expects the one match to have exactly the given computed ARIA role, explicit or implicit.
 *
 * **Details**
 *
 * Retries until the deadline, including when zero or multiple elements match. Matching is case-sensitive and
 * does not follow the ARIA role hierarchy: a switch does not match `"checkbox"`. Hidden elements are included.
 * Plain elements such as `div` retain the shared engine's HTML-AAM `generic` role; Playwright reports no role
 * for them. Presentation conflicts and required-child inheritance follow the same rules as role locators and
 * snapshots. Tabindex focusability follows HTML integer parsing, so `"2abc"` counts and non-ASCII leading
 * whitespace does not; pinned Playwright uses JavaScript number conversion and differs on those inputs.
 * An element without a role is observed as an empty string. Failure history records the role or match count.
 *
 * **Example** (Checking a custom control's role)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const checkSave = Effect.fn("checkSave")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByTestId("save").pipe(Expect.toHaveRole("button"))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveRole: DualMatcher<Locator.ReadonlyLocator, [expected: string]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string) => ExpectImpl.toHaveRole(locator, expected)
)

/**
 * Expects the one match to have the attribute, with a matching value when one is given.
 *
 * **Details**
 *
 * A string must equal the whole value as written; a `RegExp` is tested as given. `ignoreCase: true` compares the
 * value without case and sets a regular expression's `i` flag; `ignoreCase: false` clears it. Case is folded
 * without regard to the browser's locale.
 *
 * **Example** (Checking that a menu opened)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openMenu = Effect.fn("openMenu")(function*(page: Page.Page) {
 *   const menu = page.getByRole("button", { name: "Menu" })
 *   yield* menu.click()
 *   yield* menu.pipe(Expect.toHaveAttribute("aria-expanded", "true"))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveAttribute: DualMatcher<
  Locator.ReadonlyLocator,
  [
    name: string,
    expected?: string | RegExp | undefined,
    options?: {
      /** Compares the value without regard to case, replacing a regular expression's `i` flag. @default undefined */
      readonly ignoreCase?: boolean | undefined
    } | undefined
  ]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (
    locator: Locator.ReadonlyLocator,
    name: string,
    expected?: string | RegExp | undefined,
    options?: { readonly ignoreCase?: boolean | undefined } | undefined
  ) => ExpectImpl.toHaveAttribute(locator, name, expected, options)
)

/**
 * Expects the one match's computed CSS property to equal a string or match a regular expression.
 *
 * **Details**
 *
 * Strings compare exactly, without whitespace normalization. CSS values use the browser's serialization.
 * Missing and multiple matches retry until exactly one matches, including with `not: true`.
 * Unlike Playwright's immediate strictness error, multiple matches fail at the deadline with match-count evidence.
 * Failure history records the computed string, or the match count when there is no single element.
 *
 * **Example** (Waiting for a layout)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const layout = Effect.fn("layout")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("navigation").pipe(Expect.toHaveCSS("display", "flex"))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveCSS: DualMatcher<
  Locator.ReadonlyLocator,
  [
    name: string,
    expected: string | RegExp,
    options?: {
      /** Negates the value comparison; still requires exactly one match. @default false */
      readonly not?: boolean | undefined
      /** Reads the named pseudo-element instead of the element. @default undefined */
      readonly pseudo?: "before" | "after" | undefined
    } | undefined
  ]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (locator: Locator.ReadonlyLocator, name: string, expected: string | RegExp, options?: {
    readonly not?: boolean | undefined
    readonly pseudo?: "before" | "after" | undefined
  }) => ExpectImpl.toHaveCSS(locator, name, expected, options)
)

/**
 * Expects a JavaScript property of the one match to deeply equal a value, read where the page's own scripts set it.
 *
 * **When to use**
 *
 * Use to check state a page keeps on an element rather than in its markup: a DOM property such as `checked`, or
 * a value a script assigned, such as `element.model = { … }`.
 *
 * **Details**
 *
 * `path` is a property name or a dotted path into nested objects (`"model.user.name"`). A step through a value that
 * isn't an object, or that lacks the key, reads `undefined`. Each check reads the path in the page's own JavaScript
 * world and returns the value by value, then compares it with `expected`: Dates by time, regular expressions by
 * source and flags, arrays, Maps and Sets by their entries, plain objects by their own enumerable keys, and `NaN`
 * equals `NaN`. Missing and multiple matches, a value that can't be returned by value, and a mismatch are checked
 * again until the deadline, and exactly one element must match, including with `not: true`. Failure history records
 * the value read, or the match count when there is no single element.
 *
 * A property assignment is no change the page reports, so instead of waiting on page events the matcher reads the
 * property again as `withChecks` sets: every 100 ms unless set.
 *
 * **Gotchas**
 *
 * - The read runs among the page's own scripts, so a getter the page defined runs and can see it; that is why it
 *   needs a `Locator` and refuses a `ReadonlyLocator`.
 * - A key that contains a dot can't be named in `path`.
 * - `withChecks` sets how often the read runs, and so how often a getter of the page's on the path runs.
 *
 * **Example** (Checking state a script set)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const subscribed = Effect.fn("subscribed")(function*(page: Page.Page) {
 *   yield* page.getByRole("checkbox", { name: "Subscribe" }).pipe(
 *     Expect.toHaveJSProperty("checked", true)
 *   )
 *   yield* page.locator("#profile").pipe(Expect.toHaveJSProperty("model.plan", "pro"))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveJSProperty: DualMatcher<
  Locator.Locator,
  [
    path: string,
    expected: unknown,
    options?: {
      /** Negates the value comparison; still requires exactly one match. @default false */
      readonly not?: boolean | undefined
    } | undefined
  ]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (locator: Locator.Locator, path: string, expected: unknown, options?: { readonly not?: boolean | undefined }) =>
    ExpectImpl.toHaveJSProperty(locator, path, expected, options)
)

/**
 * Expects exactly `count` matches.
 *
 * **Example** (Checking how many results a search gave)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const threeResults = Effect.fn("threeResults")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("listitem").pipe(Expect.toHaveCount(3))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveCount: DualMatcher<Locator.ReadonlyLocator, [count: number]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, count: number) => ExpectImpl.toHaveCount(locator, count)
)

/**
 * Expects a function you pass to return `true` on a locator's one match, checking again each time the page signals a
 * change until it does.
 *
 * **When to use**
 *
 * Use to wait for something about an element that no other matcher states, such as a property the page sets or a
 * computed value. For a check the program computes, such as on a value it read, use `Expect.that`; that is why
 * there is no form that takes an `Effect`, which would be `Expect.that` again.
 *
 * **Details**
 *
 * The function runs in the page, in Strider's own world of the match's document, never in the page's scripts' own,
 * and gets the match first, then the arguments, which cross as they do for `locator.evaluate`: by value, or a handle
 * as what it holds. A promise it returns is awaited. Only `true` passes.
 *
 * On each check it runs the page's locator handlers, finds the one match again, and calls the function; while
 * the function is pending, the handlers run again on each change signal, so one can dismiss what it waits on. A
 * handler still running when the function answers finishes first, and then the answer counts: it isn't checked again. It checks
 * again after each change signal the other locator matchers check on (a mutation, an input, change or focus event,
 * or an animation frame), including one that came while the function ran. Each check reads the page as it is then,
 * so a state that comes and goes between two checks isn't seen. While nothing matches, or several elements
 * do, it keeps waiting, and a failure says how many matched; with no match, it names the nearest match and
 * suggests locators, as the other matchers do. It returns nothing: to read a value once it passes, call
 * `locator.evaluate`.
 *
 * **Gotchas**
 *
 * If the function throws, or its promise rejects, the expectation fails at once with the `LocatorError` that
 * `locator.evaluate` gives, rather than waiting. On stock WebKit, which gives Strider no world of its own, it fails
 * as `Unsupported`, as `locator.evaluate` does there.
 *
 * **Example** (Waiting for a menu button to expand)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const expanded = Effect.fn("expanded")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByRole("button", { name: "Menu" }).pipe(
 *     Expect.toSatisfy(
 *       (button, name: string) => button.getAttribute(name) === "true",
 *       "aria-expanded"
 *     )
 *   )
 * })
 * ```
 *
 * @see that
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toSatisfy: {
  <Args extends ReadonlyArray<unknown>>(
    fn: (element: Element, ...args: Args) => boolean | Promise<boolean>,
    ...args: Args
  ): (
    locator: Locator.ReadonlyLocator
  ) => Effect.Effect<void, ExpectationFailed | Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
  <Args extends ReadonlyArray<unknown>>(
    locator: Locator.ReadonlyLocator,
    fn: (element: Element, ...args: Args) => boolean | Promise<boolean>,
    ...args: Args
  ): Effect.Effect<void, ExpectationFailed | Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
} = dual(
  (args) => Locator.isLocator(args[0]),
  (locator: Locator.ReadonlyLocator, fn: Function, ...args: ReadonlyArray<unknown>) =>
    ExpectImpl.toSatisfy(locator, fn, args)
)

/**
 * Expects the accessibility tree of a locator's one match, or of a page, to match a pattern.
 *
 * **Details**
 *
 * A locator's pattern is matched against its match's node; a page's against its `document` node, named by the
 * page's title, in the main frame. Both are the roots `snapshot({ sources: "aria" })` returns. Use
 * `AriaPattern.anywhere` to match a node at any depth beneath the subject.
 *
 * Neither form sees an iframe's contents: the tree it matches stops at each `iframe` node, unlike a snapshot, which
 * includes them. To match inside a frame, locate the subject through `page.frame`.
 *
 * With `not: true`, it waits until the subject doesn't match. A locator's missing and multiple matches retry until
 * exactly one matches, with `not` too. A failure's last observed value is the subject's tree as text.
 *
 * **Gotchas**
 *
 * A node pattern's children are the node's direct children, so links in a list sit under `list` and `listitem`
 * nodes: match the list, locate it, or use `AriaPattern.anywhere`, rather than the navigation around it.
 *
 * **Example** (Checking the navigation for an Orders link)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const hasOrdersLink = (page: Page.ReadonlyPage) =>
 *   page.getByRole("navigation").pipe(Expect.toMatchAria(
 *     AriaPattern.node(
 *       "navigation",
 *       "Main",
 *       AriaPattern.including(
 *         AriaPattern.node("link", "Orders", AriaPattern.unchecked)
 *       )
 *     )
 *   ))
 * ```
 *
 * **Example** (Checking a page for a heading at any depth)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const hasHeading = (page: Page.ReadonlyPage) =>
 *   page.pipe(Expect.toMatchAria(
 *     AriaPattern.anywhere(
 *       AriaPattern.including(
 *         AriaPattern.node("heading", "Orders", AriaPattern.unchecked)
 *       )
 *     )
 *   ))
 * ```
 *
 * **Example** (Checking a form inside an iframe)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const paymentForm = (page: Page.ReadonlyPage) =>
 *   page.frame(page.locator("#payment")).getByRole("form").pipe(Expect.toMatchAria(
 *     AriaPattern.anywhere(
 *       AriaPattern.including(
 *         AriaPattern.node("textbox", "Card number", AriaPattern.unchecked)
 *       )
 *     )
 *   ))
 * ```
 *
 * **Example** (Waiting for a dialog's error to go)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const errorGone = (page: Page.ReadonlyPage) =>
 *   page.getByRole("dialog").pipe(Expect.toMatchAria(
 *     AriaPattern.anywhere(
 *       AriaPattern.including(
 *         AriaPattern.node("alert", "", AriaPattern.unchecked)
 *       )
 *     ),
 *     { not: true }
 *   ))
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toMatchAria: DualMatcher<
  Locator.ReadonlyLocator | Page.ReadonlyPage,
  [
    pattern: AriaPattern.AriaPattern,
    options?: {
      /** Waits until the subject doesn't match instead. @default false */
      readonly not?: boolean | undefined
    } | undefined
  ]
> = dual(
  (args) => !AriaPattern.isAriaPattern(args[0]),
  (
    subject: Locator.ReadonlyLocator | Page.ReadonlyPage,
    pattern: AriaPattern.AriaPattern,
    options?: { readonly not?: boolean | undefined }
  ) => ExpectImpl.toMatchAria(subject, pattern, options)
)

/**
 * Expects the page's URL to match. A string must equal the whole URL; use a `RegExp` to match part of it.
 *
 * **Details**
 *
 * `ignoreCase: true` compares a string without case and sets a regular expression's `i` flag;
 * `ignoreCase: false` clears it; left out, a string matches case and a regular expression keeps its flags. Case is
 * folded without regard to the browser's locale.
 *
 * **Example** (Landing on the account page after signing in)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const signIn = Effect.fn("signIn")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Sign in" }).click()
 *   yield* page.pipe(Expect.toHaveURL(/\/account$/))
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveURL: DualMatcher<
  Page.ReadonlyPage,
  [
    expected: string | RegExp,
    options?: {
      /** Compares without regard to case, replacing a regular expression's `i` flag. @default undefined */
      readonly ignoreCase?: boolean | undefined
    } | undefined
  ]
> = dual(
  (args) => Page.isPage(args[0]),
  (
    page: Page.ReadonlyPage,
    expected: string | RegExp,
    options?: { readonly ignoreCase?: boolean | undefined } | undefined
  ) => ExpectImpl.toHaveURL(page, expected, options)
)

/**
 * Expects the page's title to match.
 *
 * **Example** (Checking the confirmation page's title)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const confirmed = Effect.fn("confirmed")(function*(page: Page.ReadonlyPage) {
 *   yield* Expect.toHaveTitle(page, "Order confirmed | Shop")
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveTitle: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]> = dual(
  2,
  (page: Page.ReadonlyPage, expected: string | RegExp) => ExpectImpl.toHaveTitle(page, expected)
)

/**
 * Expects an effect's value to satisfy a condition, checking until it does or the deadline passes.
 *
 * **Details**
 *
 * A `Watchable` subject is checked again on each change. Any other effect is run again as `withChecks` sets: every
 * 100 ms unless set. Each check is a round trip, so a state that appears and disappears between two checks isn't seen.
 * Direct `page.url` and `page.title` subjects classify failed observations as URLs and titles for trace export.
 * The export preset applies through rethrows of the same failure. User transformations (including
 * `Watchable.map` and `Effect.map`) and reconstructed failures do not retain that source classification.
 * Condition descriptions are user-authored text exported as written; classification does not infer secrets.
 *
 * **Example** (Waiting for a download to complete)
 *
 * ```ts import.meta.vitest
 * import { Condition, Download, Expect } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const completed = (download: Download.Download) =>
 *   Expect.that(
 *     download.status,
 *     Condition.make("completed", (status) => status._tag === "Completed")
 *   )
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const that = <A, E, R>(
  subject: Effect.Effect<A, E, R>,
  condition: Condition.Condition<A>
): Effect.Effect<void, E | ExpectationFailed | Target.TargetGone | Deadline.Timeout, R> =>
  Watchable.isWatchable(subject)
    ? ExpectImpl.watching(
      subject as Watchable.Watchable<A>,
      (value: A) => ConditionImpl.holds(condition, value),
      "that",
      "the subject",
      ConditionImpl.describe(condition)
    )
    : ExpectImpl.polling(subject, condition)

/**
 * When an expectation that can't wait on its subject checks it again: on a page's animation frames, on its DOM
 * mutations, or at an interval.
 *
 * **Details**
 *
 * It applies to `Expect.that` on an effect that isn't a `Watchable`, and to `toHaveJSProperty`. Each check is a
 * round trip to the page, so a state that appears and disappears between two checks isn't seen. Every strategy
 * stops at the expectation's deadline.
 *
 * @see {@link withChecks} to set it
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Checks =
  | { readonly _tag: "AnimationFrame"; readonly page: Page.ReadonlyPage }
  | { readonly _tag: "Mutation"; readonly page: Page.ReadonlyPage }
  | { readonly _tag: "Interval"; readonly interval: Duration.Input }

/**
 * The strategies `withChecks` takes: `animationFrame`, `mutation`, and `interval`.
 *
 * **Example** (Choosing when a page function is checked again)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const itemsShown = Effect.fn("itemsShown")(
 *   function*(page: Page.Page, rendersOnFrames: boolean) {
 *     const checks = rendersOnFrames
 *       ? Expect.Checks.animationFrame(page)
 *       : Expect.Checks.mutation(page)
 *     yield* Expect.that(
 *       page.evaluateInMainWorld(() => document.querySelectorAll("li").length > 0),
 *       Condition.make("shown", (shown: boolean) => shown)
 *     ).pipe(Expect.withChecks(checks))
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const Checks: {
  /**
   * Checks again at the page's next animation frame after each check.
   *
   * **Details**
   *
   * Use when the page changes state that only a script can read, such as a global variable, on each render.
   *
   * **Gotchas**
   *
   * - A page that stops rendering frames, such as a tab in the background, checks nothing more until the deadline.
   * - A state that appears and disappears between two checks isn't seen.
   *
   * **Example** (Waiting for a global a page sets as it renders)
   *
   * ```ts import.meta.vitest
   * import { Condition, Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const rendered = Effect.fn("rendered")(function*(page: Page.Page) {
   *   yield* Expect.that(
   *     page.evaluateInMainWorld(() => (window as { ready?: boolean }).ready === true),
   *     Condition.make("ready", (ready: boolean) => ready)
   *   ).pipe(Expect.withChecks(Expect.Checks.animationFrame(page)))
   * })
   * ```
   */
  readonly animationFrame: (page: Page.ReadonlyPage) => Checks
  /**
   * Checks again after each DOM mutation of the page's main document, and only then.
   *
   * **Details**
   *
   * A change a script makes without touching the DOM, such as to a global variable, isn't checked until the DOM
   * changes. A state that appears and disappears between two checks isn't seen.
   *
   * **Example** (Waiting for a counter the page renders)
   *
   * ```ts import.meta.vitest
   * import { Condition, Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const counted = Effect.fn("counted")(function*(page: Page.Page) {
   *   yield* Expect.that(
   *     page.evaluateInMainWorld(() => document.querySelectorAll("li").length),
   *     Condition.make("at least three", (count: number) => count >= 3)
   *   ).pipe(Expect.withChecks(Expect.Checks.mutation(page)))
   * })
   * ```
   */
  readonly mutation: (page: Page.ReadonlyPage) => Checks
  /**
   * Checks again once `interval` has passed since each check ended.
   *
   * **Details**
   *
   * The interval must be positive and finite; `withChecks` fails with `InvalidInput` when the expectation runs
   * otherwise. A state that appears and disappears between two checks isn't seen.
   *
   * **Example** (Polling saved state less often)
   *
   * ```ts import.meta.vitest
   * import { Condition, Expect, Page } from "@usestrider/browser"
   * import { Effect, Option } from "effect"
   *
   * const cartSaved = Effect.fn("cartSaved")(function*(page: Page.ReadonlyPage) {
   *   yield* Expect.that(
   *     page.localStorage.get("cart"),
   *     Condition.make("saved", Option.isSome)
   *   ).pipe(Expect.withChecks(Expect.Checks.interval("500 millis")))
   * })
   * ```
   */
  readonly interval: (interval: Duration.Input) => Checks
} = {
  animationFrame: (page) => ({ _tag: "AnimationFrame", page }),
  mutation: (page) => ({ _tag: "Mutation", page }),
  interval: (interval) => ({ _tag: "Interval", interval })
}

/**
 * Sets when every `Expect.that` and `toHaveJSProperty` inside an effect checks again.
 *
 * **Details**
 *
 * An interval that isn't positive and finite fails with `ExpectError` and `InvalidInput` when the effect runs,
 * before anything inside it does.
 *
 * **Example** (Checking a page function on each animation frame)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const loaded = Effect.fn("loaded")(function*(page: Page.Page) {
 *   yield* Expect.that(
 *     page.evaluateInMainWorld(() => document.fonts.status),
 *     Condition.make("loaded", (status: string) => status === "loaded")
 *   ).pipe(
 *     Expect.withChecks(Expect.Checks.animationFrame(page))
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withChecks: {
  (checks: Checks): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ExpectError, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, checks: Checks): Effect.Effect<A, E | ExpectError, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, checks: Checks): Effect.Effect<A, E | ExpectError, R> =>
    Effect.suspend((): Effect.Effect<A, E | ExpectError, R> => {
      if (checks._tag === "Interval" && ExpectImpl.intervalMillis(checks.interval) === undefined) {
        return Effect.fail(
          new ExpectError({
            operation: "Expect.withChecks",
            reason: new Reason.InvalidInput({
              input: "check interval",
              expected: "a positive, finite duration",
              hint: `got ${ExpectImpl.showInterval(checks.interval)}`
            }),
            diagnostics: OperationImpl.diagnosticsNow()
          })
        )
      }
      return Effect.provideService(self, ExpectImpl.CheckCadence, checks)
    })
)

const ExpectErrorTypeId = "~@usestrider/browser/Expect/ExpectError"

/**
 * Error for an expectation's setting that can't be used, such as a check interval that isn't positive.
 *
 * **Example** (Reporting an interval read from configuration)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const saved = Effect.fn("saved")(function*(page: Page.ReadonlyPage, millis: number) {
 *   yield* Expect.that(
 *     page.localStorage.get("cart"),
 *     Condition.make("saved", Option.isSome)
 *   ).pipe(
 *     Expect.withChecks(Expect.Checks.interval(millis)),
 *     Effect.catchTag("ExpectError", (error) => Effect.logError(error.message))
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ExpectError extends Schema.TaggedError<ExpectError>(ExpectErrorTypeId)(
  "ExpectError",
  {
    operation: Schema.String,
    reason: Reason.InvalidInput,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [ExpectErrorTypeId] = ExpectErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is an `ExpectError`.
 *
 * **Example** (Telling a bad setting from an unmet expectation)
 *
 * ```ts import.meta.vitest
 * import { Condition, Expect, Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const saved = Effect.fn("saved")(function*(page: Page.ReadonlyPage, millis: number) {
 *   yield* Expect.that(
 *     page.localStorage.get("cart"),
 *     Condition.make("saved", Option.isSome)
 *   ).pipe(
 *     Expect.withChecks(Expect.Checks.interval(millis)),
 *     Effect.tapError((error) =>
 *       Expect.isExpectError(error)
 *         ? Effect.logError("bad check interval", error.reason)
 *         : Effect.void
 *     )
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isExpectError = (u: unknown): u is ExpectError => Predicate.hasProperty(u, ExpectErrorTypeId)

const ExpectationFailedTypeId = "~@usestrider/browser/Expect/ExpectationFailed"

/**
 * Error for an expectation that didn't pass before the deadline, or that a locator handler's callback failed while
 * the expectation was waiting.
 *
 * **Details**
 *
 * - When a locator handler's callback fails with a typed error, `handlerFailure` is set, and holds that error as
 *   `error`, unchanged and unserialized; `message` names the handler's failure rather than the unmet condition.
 *   Narrow `error` yourself: it can be any value the callback failed with. A callback that exceeds the deadline
 *   fails the expectation with `Deadline.Timeout` instead, and a callback that loses its page fails with
 *   `TargetGone`; neither is wrapped here.
 * - `history` contains observed values and diagnostic error entries, with repeats in a row dropped;
 *   `last` is its final entry. For locator expectations, page values must reach Strider before the deadline.
 *   If neither a page value nor a diagnostic error is recorded, `history` is empty and `last` is `Option.none()`.
 *   The first locator check returns its observation immediately; later checks may wait for changes.
 *   Values evaluated in the page but received after the deadline do not update the failure.
 * - For `Expect.that` on an effect, `last` is the last value a check returned. Only when no check returned a
 *   value does a check still running at the deadline record `{ error: "a check was still running at the deadline" }`.
 *   No check starts once the deadline has passed.
 * - `checks` says how many checks ran and what triggered them.
 * - `nearest`, when nothing matched, is an accessibility snapshot of what the locator's first steps found, up to
 *   the step that matched nothing.
 * - `suggestions`, when nothing matched a `getByRole` with a name, are locators for elements with that role and a
 *   similar name.
 *
 * **Example** (Logging a failed expectation as a warning)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const cartCount = Effect.fn("cartCount")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByTestId("cart-count").pipe(
 *     Expect.toHaveText("2"),
 *     Effect.catchTag(
 *       "ExpectationFailed",
 *       (error) => Effect.logWarning(error.message, error.last)
 *     )
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ExpectationFailed extends Schema.TaggedError<ExpectationFailed>(ExpectationFailedTypeId)(
  "ExpectationFailed",
  {
    handlerFailure: Schema.optional(Reason.LocatorHandlerFailed),
    subject: Schema.String,
    condition: Schema.String,
    last: Schema.Option(Diagnostics.ObservedValue),
    history: Schema.Array(Diagnostics.ObservedValue),
    elapsed: Schema.Duration,
    checks: Schema.Struct({
      count: Schema.Int,
      triggeredBy: Schema.Array(Schema.Literals(["initial", "change", "interval"]))
    }),
    nearest: Schema.Option(Schema.String),
    suggestions: Schema.Array(Schema.String),
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [ExpectationFailedTypeId] = ExpectationFailedTypeId
  override get message(): string {
    return this.handlerFailure === undefined
      ? `Expected ${this.subject} ${this.condition}`
      : this.handlerFailure.message
  }
}

/**
 * Checks whether a value is an `ExpectationFailed`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isExpectationFailed = (u: unknown): u is ExpectationFailed =>
  Predicate.hasProperty(u, ExpectationFailedTypeId)
