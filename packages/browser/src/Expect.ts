/**
 * Expectations that retry: each `Expect.to*` checks until it passes or the deadline passes.
 *
 * A locator's expectation waits in the page: it checks once, then again on each change the page makes (a DOM
 * mutation, an `input`, `change` or focus event, an animation frame), so there is no polling interval and no change
 * is missed between checks. `toHaveURL` checks the page's URL on each change. `Expect.that` checks a `Watchable` on
 * each change, and runs any other effect again every `CheckInterval`. Everything runs on the real clock, within the
 * deadline. To collect several failures, use `Effect.validate` or `Effect.all(…, { mode: "result" })`.
 *
 * Matchers that take arguments are dual: `locator.pipe(Expect.toHaveText("1 item"))` or
 * `Expect.toHaveText(locator, "1 item")`. Matchers without arguments are the function itself:
 * `locator.pipe(Expect.toBeVisible)`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as AriaPattern from "./AriaPattern.ts"
import type * as Condition from "./Condition.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ConditionImpl from "./internal/condition.ts"
import * as ExpectImpl from "./internal/expect.ts"
import * as Locator from "./Locator.ts"
import type * as Page from "./Page.ts"
import type * as Target from "./Target.ts"
import * as Watchable from "./Watchable.ts"

/**
 * A matcher that takes no arguments: the function is the expectation, as in `locator.pipe(Expect.toBeVisible)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Matcher<S> = (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>

/**
 * A matcher with arguments, usable data-first or in `pipe`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DualMatcher<S, Args extends ReadonlyArray<unknown>> {
  (...args: Args): (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>
  (subject: S, ...args: Args): Effect.Effect<void, ExpectationFailed | Target.TargetGone>
}

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
 * given.
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
  [expected: string | RegExp | ReadonlyArray<string | RegExp>]
> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string | RegExp | ReadonlyArray<string | RegExp>) =>
    ExpectImpl.toHaveText(locator, expected)
)

/**
 * Expects the text of the one match to contain `expected`. A string is matched case-sensitively, after whitespace
 * is collapsed.
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
export const toContainText: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string | RegExp) => ExpectImpl.toContainText(locator, expected)
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
 * Expects the one match to have exactly the given computed ARIA role, explicit or implicit.
 *
 * **Details**
 *
 * Retries until the deadline, including when zero or multiple elements match. Matching is case-sensitive and
 * does not follow the ARIA role hierarchy: a switch does not match `"checkbox"`. Hidden elements are included.
 * Plain elements such as `div` retain the shared engine's HTML-AAM `generic` role; Playwright reports no role
 * for them. Presentation conflicts and required-child inheritance follow the same rules as role locators and
 * snapshots. An element without a role is observed as an empty string. Failure history records the role or match count.
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
  [name: string, expected?: string | RegExp | undefined]
> = dual(
  (args) => Locator.isLocator(args[0]),
  (locator: Locator.ReadonlyLocator, name: string, expected?: string | RegExp) =>
    ExpectImpl.toHaveAttribute(locator, name, expected)
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
 * Expects the one match's accessibility tree to match a pattern.
 *
 * **Gotchas**
 *
 * A pattern's children are the node's direct children, so links in a list sit under `list` and `listitem` nodes:
 * match the list, or locate it, rather than the navigation around it.
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
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toMatchAria: DualMatcher<Locator.ReadonlyLocator, [pattern: AriaPattern.AriaPattern]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, pattern: AriaPattern.AriaPattern) => ExpectImpl.toMatchAria(locator, pattern)
)

/**
 * Expects the page's URL to match. A string must equal the whole URL; use a `RegExp` to match part of it.
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
export const toHaveURL: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]> = dual(
  2,
  (page: Page.ReadonlyPage, expected: string | RegExp) => ExpectImpl.toHaveURL(page, expected)
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
 * A `Watchable` subject is checked again on each change. Any other effect is run again every `CheckInterval`.
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
): Effect.Effect<void, E | ExpectationFailed | Target.TargetGone, R> =>
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
 * Reference to how often `Expect.that` runs a subject that isn't a `Watchable` again; 100 ms unless set.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const CheckInterval: Context.Reference<Duration.Duration> = Context.Reference<Duration.Duration>(
  "@usestrider/browser/Expect/CheckInterval",
  { defaultValue: () => Duration.millis(100) }
)

/**
 * Sets `CheckInterval` for every `Expect.that` inside an effect.
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
 *   ).pipe(
 *     Expect.withCheckInterval("500 millis")
 *   )
 * })
 * ```
 *
 * @see {@link CheckInterval} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withCheckInterval: {
  (interval: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CheckInterval, Duration.fromInputUnsafe(interval))
)

const ExpectationFailedTypeId = "~@usestrider/browser/Expect/ExpectationFailed"

/**
 * Error for an expectation that didn't pass before the deadline.
 *
 * **Details**
 *
 * - `history` contains observed values and diagnostic error entries, with repeats in a row dropped;
 *   `last` is its final entry. For locator expectations, page values must reach Strider before the deadline.
 *   If neither a page value nor a diagnostic error is recorded, `history` is empty and `last` is `Option.none()`.
 *   Values evaluated in the page but received after the deadline do not update the failure.
 * - For `Expect.that` on an effect, a check still running at the deadline records
 *   `{ error: "a check was still running at the deadline" }`, even if no check has returned a value.
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
    return `Expected ${this.subject} ${this.condition}`
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
