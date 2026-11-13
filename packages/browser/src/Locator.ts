/**
 * Locators: how to find elements on a page, and the actions and reads that use them.
 *
 * A locator describes how to find elements and is resolved again on every attempt, so it never goes stale. A query
 * on a locator searches inside its matches. Reads happen once and never retry; the expectations that retry are
 * `Expect`. A ref from a snapshot is the exception: it's pinned to one node, and fails with `StaleRef` rather than
 * finding another.
 *
 * Before acting, a locator checks that its element is ready: visible, stable, enabled, and the rest of the action's
 * checks, tested in the page together on each attempt. The checks are named, can be turned off per call with
 * `checks`, and are reported in errors. An action needs exactly one match, so an ambiguous locator fails at once,
 * listing what it matched. An action dispatches at most once.
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
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Steps from "./internal/steps.ts"
import type * as JSHandle from "./JSHandle.ts"
import type * as Keyboard from "./Keyboard.ts"
import type * as Mouse from "./Mouse.ts"
import * as Reason from "./Reason.ts"
import type * as Snapshot from "./Snapshot.ts"
import type * as Target from "./Target.ts"

const TypeId = "~@usestrider/browser/Locator"

/**
 * Schema for an element's border box in main-frame viewport CSS pixels.
 *
 * **Details**
 *
 * Scrolling can make `x` and `y` negative. Width and height can be zero.
 *
 * **Example** (Decoding a box)
 *
 * ```ts import.meta.vitest
 * import { Locator } from "@usestrider/browser"
 * import { Schema } from "effect"
 *
 * const box = Schema.decodeUnknownSync(Locator.BoundingBox)({
 *   x: -10,
 *   y: 20,
 *   width: 100,
 *   height: 30
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BoundingBox = Schema.Struct({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
})

/**
 * An element's border box in main-frame viewport CSS pixels.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BoundingBox = typeof BoundingBox.Type

/**
 * Settings for `getByRole`.
 *
 * **Details**
 *
 * State filters must be supported by the requested role. Unsupported combinations fail when the
 * locator is used, including when its scope matches nothing or a frame is missing; construction does not throw.
 * Locator operations fail with `LocatorError` whose reason is `InvalidInput` for `"selector"`.
 * Expectations fail with `ExpectationFailed`, as they do for invalid CSS selectors.
 * `disabled` is supported for every role.
 *
 * On stock WebKit, use `includeHidden: true` for native options, which the current visibility
 * rules exclude; `checkVisibility` reports false for these options.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RoleOptions {
  /**
   * Match a native heading level (1–6), or a positive integer from aria-level on heading, listitem, row,
   * or treeitem. Native headings take precedence over aria-level.
   *
   * **Example** (Filter by level)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   *
   * declare const page: Page.Page
   *
   * const target = page.getByRole("heading", { level: 2 })
   * ```
   *
   * @default any level
   */
  readonly level?: number | undefined
  /**
   * Match native checked state or aria-checked on checkbox, radio, switch, menuitemcheckbox,
   * menuitemradio, option, or treeitem. ARIA keywords are ASCII case-insensitive without trimming.
   * Mixed matches false on radio, menuitemradio, and switch; on the other four roles it matches
   * neither boolean. Native indeterminate inputs match neither boolean. Absent, empty, undefined,
   * and unrecognized values match neither boolean on option/treeitem and false on the other roles.
   *
   * **Example** (Filter by checked)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   *
   * declare const page: Page.Page
   *
   * const target = page.getByRole("checkbox", { checked: true })
   * ```
   *
   * @default any checked state
   */
  readonly checked?: boolean | undefined
  /**
   * Match aria-pressed on buttons. Mixed matches neither boolean; absent or invalid values match false.
   * Keywords are ASCII case-insensitive without trimming, shared with snapshot pressed markers.
   *
   * **Example** (Filter by pressed)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   *
   * declare const page: Page.Page
   *
   * const target = page.getByRole("button", { pressed: true })
   * ```
   *
   * @default any pressed state
   */
  readonly pressed?: boolean | undefined
  /**
   * Match aria-expanded on roles that support expansion, or the open state of details with a supported role.
   * Absent ARIA values match neither boolean; present values other than ASCII case-insensitive "true" match false,
   * without trimming. Native details.open takes precedence over aria-expanded.
   * Snapshots share this reader and also mark ordinary open details as expanded, but its group role
   * does not support expanded filters. No expansion state is inferred for summary.
   *
   * **Example** (Filter by expanded)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   *
   * declare const page: Page.Page
   *
   * const target = page.getByRole("button", { expanded: false })
   * ```
   *
   * @default any expanded state
   */
  readonly expanded?: boolean | undefined
  /**
   * Match a native option’s selected property or aria-selected on gridcell, option, row, tab, rowheader,
   * columnheader, or treeitem. Absent or invalid ARIA values match false.
   * Keywords are ASCII case-insensitive without trimming. Native option selection takes precedence over
   * aria-selected in filters and snapshots, even when browser accessibility state follows ARIA instead.
   *
   * **Example** (Filter by selected)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   *
   * declare const page: Page.Page
   *
   * const target = page.getByRole("tab", { selected: true })
   * ```
   *
   * @default any selected state
   */
  readonly selected?: boolean | undefined
  /**
   * Match native disabled controls (including disabled fieldsets and optgroups) or inherited
   * aria-disabled. An option inherits native disabled state from its optgroup or fieldset, but not its select.
   * These explicit native rules give the same filter matches across browsers; enabled reads, expectations,
   * and action checks still use the browser's `:disabled` result and can differ for options and optgroups.
   * Unlike Playwright, the disabled `<fieldset>` element itself also matches; aria-disabled is
   * case-sensitive, applies on any role, and false on a descendant does not cancel a disabled ancestor.
   *
   * **Example** (Filter by disabled)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   *
   * declare const page: Page.Page
   *
   * const target = page.getByRole("button", { disabled: false })
   * ```
   *
   * @default any disabled state
   */
  readonly disabled?: boolean | undefined

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
 * Settings for the text queries: `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText`, and
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
 * The queries every locator, frame, and page offers, returning `L`.
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
   *
   * **Details**
   *
   * An element's role is the first token of its `role` attribute that Strider knows, or else its implicit
   * role under HTML-AAM, and its name is computed under accname 1.2. Elements outside the accessibility tree
   * (`aria-hidden`, `display: none`, `visibility: hidden`, the `hidden` attribute) aren't matched unless
   * `includeHidden` is set.
   *
   * Roles that prohibit naming, such as generic, paragraph, and code, have an empty name even with an author
   * label. Their descendants and referenced labels can still contribute to another element's name; an explicit
   * nameable role overrides the implicit role.
   *
   * **Example** (Clicking Save, not Save draft)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const save = Effect.fn("save")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Save", exact: true }).click()
   * })
   * ```
   */
  getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): L
  /**
   * The smallest elements whose text matches.
   *
   * **Details**
   *
   * An element matches when its text does and no child element's does, so `<p>1 <b>item</b></p>` is found by
   * `"1 item"`. An element's text is its text content through open shadow roots, without `script`, `style`,
   * `noscript`, and `template`, with a button-like `input`'s value, and with whitespace collapsed and trimmed; it
   * isn't `innerText`, which depends on layout and differs between browsers. A string matches as a case-insensitive
   * substring, or with `exact` as the whole text, case-sensitively; a `RegExp` is tested as given. The document's
   * `head` isn't searched.
   *
   * **Example** (Reading an order number)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const confirmation = Effect.fn("confirmation")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByText(/^Order #\d+ confirmed$/).readText
   * })
   * ```
   */
  getByText(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Form controls whose label matches.
   *
   * **Example** (Filling a field by its label)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const enterEmail = Effect.fn("enterEmail")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Email").fill("me@example.com")
   * })
   * ```
   */
  getByLabel(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Inputs whose placeholder matches.
   *
   * **Example** (Searching from a field with no label)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const search = Effect.fn("search")(function*(page: Page.Page) {
   *   yield* page.getByPlaceholder("Search products").fill("headphones")
   * })
   * ```
   */
  getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Images and areas whose alt text matches.
   *
   * **Example** (Opening a product from its photo)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openProduct = Effect.fn("openProduct")(function*(page: Page.Page) {
   *   yield* page.getByAltText("Wireless headphones").click()
   * })
   * ```
   */
  getByAltText(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Elements whose `title` attribute matches.
   *
   * **Example** (Clicking an icon button by its tooltip)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const removeItem = Effect.fn("removeItem")(function*(page: Page.Page) {
   *   yield* page.getByTitle("Remove from cart").click()
   * })
   * ```
   */
  getByTitle(text: string | RegExp, options?: TextOptions | undefined): L
  /**
   * Elements whose `data-testid` attribute is `id`.
   *
   * **Example** (Reading the cart badge)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const cartCount = Effect.fn("cartCount")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByTestId("cart-count").readText
   * })
   * ```
   */
  getByTestId(id: string): L
  /**
   * Elements matching a CSS selector. A malformed selector fails with `InvalidInput` as soon as the locator is
   * used, without waiting.
   *
   * **Example** (Submitting a form found by CSS)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const placeOrder = Effect.fn("placeOrder")(function*(page: Page.Page) {
   *   yield* page.locator("form#checkout button[type=submit]").click()
   * })
   * ```
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
   * Keep elements whose text contains this, case-insensitively.
   */
  readonly hasText?: string | RegExp | undefined
  /**
   * Keep elements whose text doesn't contain this, case-insensitively.
   */
  readonly hasNotText?: string | RegExp | undefined
  /**
   * Keep only visible elements, or only hidden ones.
   *
   * **Details**
   *
   * An element with `opacity: 0` on itself or any ancestor counts as hidden: `visible: true` excludes it,
   * and `visible: false` includes it.
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
   * Enters an iframe inside this locator's matches, found by `iframe`'s query.
   *
   * **Gotchas**
   *
   * An `iframe` from another page or frame is a mistake in the program, so it throws at once instead of failing as an
   * effect.
   *
   * **Example** (Filling a card field in a checkout's iframe)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const enterCard = Effect.fn("enterCard")(function*(page: Page.Page) {
   *   const checkout = page.getByRole("region", { name: "Checkout" })
   *   const card = checkout.frame(checkout.locator("iframe"))
   *   yield* card.getByLabel("Card number").fill("4242 4242 4242 4242")
   * })
   * ```
   */
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
  /**
   * Narrows the matches.
   *
   * **Example** (Removing one item from the cart)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const removeHeadphones = Effect.fn("removeHeadphones")(function*(page: Page.Page) {
   *   yield* page.getByRole("listitem")
   *     .filter({ hasText: "Headphones" })
   *     .getByRole("button", { name: "Remove" })
   *     .click()
   * })
   * ```
   */
  filter(options: FilterOptions): ReadonlyLocator
  /**
   * Elements that match both locators.
   *
   * **Gotchas**
   *
   * A locator from another page or frame is a mistake in the program, so it throws at once instead of failing as an
   * effect.
   *
   * **Example** (Clicking a button that also has a tooltip)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const subscribe = Effect.fn("subscribe")(function*(page: Page.Page) {
   *   yield* page.getByRole("button").and(page.getByTitle("Subscribe to the newsletter"))
   *     .click()
   * })
   * ```
   */
  and(other: ReadonlyLocator): ReadonlyLocator
  /**
   * Elements that match either locator.
   *
   * **Gotchas**
   *
   * A locator from another page or frame is a mistake in the program, so it throws at once instead of failing as an
   * effect.
   *
   * **Example** (Waiting for whichever appears first)
   *
   * ```ts import.meta.vitest
   * import { Expect, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const signedInOrAsked = Effect.fn("signedInOrAsked")(
   *   function*(page: Page.ReadonlyPage) {
   *     const account = page.getByRole("button", { name: "Account" })
   *     const signIn = page.getByRole("button", { name: "Sign in" })
   *     yield* account.or(signIn).first.pipe(Expect.toBeVisible)
   *   }
   * )
   * ```
   */
  or(other: ReadonlyLocator): ReadonlyLocator
  /**
   * The match at `index`, counting from 0. Negative indexes and indexes past the end match nothing.
   * Errors and traces keep `nth(index)`, including `nth(0)` and `nth(-1)`.
   *
   * **Example** (Reading the third result)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const thirdResult = Effect.fn("thirdResult")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("listitem").nth(2).readText
   * })
   * ```
   */
  nth(index: number): ReadonlyLocator
  /**
   * The first match. An empty list matches nothing. Errors and traces name it as `first`.
   *
   * **Example** (Opening the first search result)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openFirst = Effect.fn("openFirst")(function*(page: Page.Page) {
   *   yield* page.getByRole("listitem").first.getByRole("link").click()
   * })
   * ```
   */
  readonly first: ReadonlyLocator
  /**
   * The last match. An empty list matches nothing. Errors and traces name it as `last`.
   *
   * **Example** (Reading the newest message)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const newestMessage = Effect.fn("newestMessage")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("log").getByRole("listitem").last.readText
   * })
   * ```
   */
  readonly last: ReadonlyLocator
  /**
   * Gives the locator a label, which errors and traces show instead of the query.
   *
   * **Example** (Naming a locator built from CSS)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const checkout = Effect.fn("checkout")(function*(page: Page.Page) {
   *   const button = page.locator("#cart > div:nth-child(3) button").describe(
   *     "the checkout button"
   *   )
   *   yield* button.click()
   * })
   * ```
   */
  describe(label: string): ReadonlyLocator
  /**
   * How many elements match now.
   *
   * **Example** (Counting search results)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const resultCount = Effect.fn("resultCount")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("listitem").count
   * })
   * ```
   */
  readonly count: Effect.Effect<number, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * The text of the one match, as `getByText` sees it: its text content with whitespace collapsed, not
   * `innerText`.
   *
   * **Example** (Reading the order total)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const orderTotal = Effect.fn("orderTotal")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByTestId("order-total").readText
   * })
   * ```
   */
  readonly readText: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * The one matching element's border box in main-frame viewport CSS pixels, or `None` when it has no layout box.
   *
   * **Details**
   *
   * Reads immediately without scrolling, focusing, or waiting for visibility. Hidden and transparent elements
   * retain their boxes, including zero-size boxes. The browser's own axis-aligned rect is composed through
   * child frames, including borders and padding; scrolling can make coordinates negative. Target transforms,
   * motion paths, and camera clipping follow `getBoundingClientRect`, rather than an original-corner hull.
   * Missing and multiple matches fail with `NoMatch` and `StrictViolation`. Chromium and WebKit use native
   * frame point conversion. Firefox supports positive axis-aligned frame scaling, CSS zoom, and translation;
   * rotation, skew, reflection, 3D, perspective, and motion paths on frame ancestors fail with descriptive
   * typed `Unsupported`. Browser defaults stay unchanged; no launch profile or preference is required.
   *
   * **Example** (Reading an element's position)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const position = Effect.fn("position")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("button", { name: "Save" }).boundingBox
   * })
   * ```
   */
  readonly boundingBox: Effect.Effect<Option.Option<BoundingBox>, LocatorError | Target.TargetGone | Deadline.Timeout>

  /**
   * The value of the one matching form control.
   *
   * **Example** (Reading a quantity field)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const quantity = Effect.fn("quantity")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByLabel("Quantity").readValue
   * })
   * ```
   */
  readonly readValue: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * The HTML of the one match (`outerHTML`).
   *
   * **Example** (Reading an article's markup)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const articleHtml = Effect.fn("articleHtml")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("article").readHtml
   * })
   * ```
   */
  readonly readHtml: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * An attribute of the one match, or `None` when it is absent.
   *
   * **Example** (Reading a link's address)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const invoiceHref = Effect.fn("invoiceHref")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("link", { name: "Download invoice" }).readAttribute(
   *     "href"
   *   )
   * })
   * ```
   */
  readAttribute(name: string): Effect.Effect<Option.Option<string>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is visible now; `false` when nothing matches or the element has `opacity: 0` on
   * itself or any ancestor.
   *
   * **Example** (Dismissing a banner only when it shows)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const dismissCookies = Effect.fn("dismissCookies")(function*(page: Page.Page) {
   *   const accept = page.getByRole("button", { name: "Accept cookies" })
   *   if (yield* accept.isVisible) yield* accept.click()
   * })
   * ```
   */
  readonly isVisible: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is editable now, using the same rules as fill and toBeEditable.
   *
   * **Details**
   *
   * Text inputs, settable inputs (date, datetime-local, month, week, time, color, and range),
   * textareas, and inherited contenteditable elements qualify when enabled and not read-only.
   * Native disabled state, including disabled fieldsets, and aria-disabled="true" on the element
   * or an ancestor disable editing. Native readOnly or aria-readonly="true" on the element
   * prevent editing. ARIA tokens are case-sensitive. Visibility and inertness are not checked.
   * Other kinds, including selects, checkboxes, and ARIA-only textboxes, return false.
   *
   * **Gotchas**
   *
   * Fails with NoMatch or StrictViolation unless exactly one element matches; never waits.
   * Unlike Playwright, unsupported kinds return false, and only kinds supported by Strider's
   * editing actions qualify. Strider also honors aria-readonly on native inputs and contenteditable
   * elements, and aria-disabled on ancestors regardless of role. Use toBeEditable when the state
   * needs time to change.
   *
   * **Example** (Reading whether a name can be changed)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const canRename = Effect.fn("canRename")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("textbox", { name: "Name" }).isEditable
   * })
   * ```
   */
  readonly isEditable: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is enabled now.
   *
   * **Example** (Reading whether checkout is available)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const canCheckout = Effect.fn("canCheckout")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("button", { name: "Checkout" }).isEnabled
   * })
   * ```
   */
  readonly isEnabled: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Whether the one match is checked now.
   *
   * **Details**
   *
   * Native checkbox and radio inputs use their checked property, including when indeterminate.
   * ARIA roles checkbox, radio, switch, menuitemcheckbox, menuitemradio, option, and treeitem use
   * aria-checked keywords ASCII case-insensitively, without trimming. True reads true; false and
   * mixed read false. Absent, empty, undefined, and unrecognized values read false on the first five
   * roles; on option/treeitem they fail with WrongElement, as do check/uncheck before input.
   * Use explicit true, false, or mixed tokens to make option/treeitem checkable.
   * Selection through aria-selected is independent. Other elements fail with WrongElement.
   *
   * **Example** (Reading a preference)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const wantsOffers = Effect.fn("wantsOffers")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("checkbox", { name: "Email me offers" }).isChecked
   * })
   * ```
   */
  readonly isChecked: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * One locator per current match, each pinned to its position with `nth`.
   *
   * **Example** (Reading every product name)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const productNames = Effect.fn("productNames")(function*(page: Page.ReadonlyPage) {
   *   const products = yield* page.getByRole("listitem").all
   *   return yield* Effect.forEach(products, (product) => product.readText)
   * })
   * ```
   */
  readonly all: Effect.Effect<ReadonlyArray<ReadonlyLocator>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * A snapshot of the one match's subtree.
   *
   * **Example** (Describing the cart to an agent)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const cartOutline = Effect.fn("cartOutline")(function*(page: Page.ReadonlyPage) {
   *   const snapshot = yield* page.getByRole("region", { name: "Cart" }).snapshot({
   *     sources: "aria"
   *   })
   *   return snapshot.text
   * })
   * ```
   */
  snapshot(
    options?: Snapshot.Options | undefined
  ): Effect.Effect<Snapshot.Snapshot<ReadonlyLocator>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the isolated world with the one match as its first argument, and returns the result by
   * value.
   *
   * **Example** (Reading an image's natural width)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const photoWidth = Effect.fn("photoWidth")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByAltText("Product photo").evaluate((image) =>
   *     (image as HTMLImageElement).naturalWidth
   *   )
   * })
   * ```
   */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (element: Element, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<B>, LocatorError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the isolated world with an array of all current matches, and returns its result by value.
   *
   * **Details**
   *
   * Resolves once without waiting or requiring a unique match; no matches passes an empty array. Array membership
   * is a snapshot taken before the callback is dispatched. The DOM may change between resolution and invocation;
   * the elements remain live and may be detached. Synchronous callback code runs in one JavaScript turn, but an
   * async callback can observe changes across awaits. Its promise is awaited within the operation's deadline.
   * A timeout after dispatch does not stop code already running in the page.
   *
   * Arguments and results use the same serialization as `evaluate`; DOM nodes cannot return by value. Functions
   * must be self-contained. No array handle is retained. Requires inspect access and isolated-world support;
   * backends without isolated worlds fail with `Unsupported`.
   *
   * **Example** (Reading all product names together)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const productNames = Effect.fn("productNames")(function*(page: Page.ReadonlyPage) {
   *   return yield* page.getByRole("listitem").evaluateAll((items) =>
   *     items.map((item) => item.textContent)
   *   )
   * })
   * ```
   */
  evaluateAll<Args extends ReadonlyArray<unknown>, B>(
    fn: (elements: Array<Element>, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<B>, LocatorError | Target.TargetGone | Deadline.Timeout>
}

/**
 * The checks an action runs on its element before it dispatches.
 *
 * **Details**
 *
 * With `inViewport` enabled, an action scrolls when no viewport fragment remains or an ancestor scroller
 * wholly clips the target, including scrollers in parent documents. Non-scrollable clipping and overlay
 * coverage alone do not scroll. Disabling `receivesPointer` preserves
 * this scrolling; disabling `inViewport` prevents it. Explicit positions remain padding-box offsets.
 *
 * Each action documents which checks it runs. An override is recorded in the action's span. `stable` waits for
 * the element's box to stay the same for 2 animation frames, or as many as `{ frames }` says, and a timeout says
 * how many. `rendered` defaults on for pointer actions and off for the rest. With it off, checks run against
 * current layout immediately, including the check just before input; retry waits and stability samples still
 * follow rendering frames. Stability starts from the current rectangle and supplies its own rendering updates;
 * enabling `rendered` adds no frame to that observation window. Actions with `rendered` disabled do not report
 * the no-frame timeout hint. A drawn frame does not guarantee hydration: wait for application readiness before filling a server-rendered input that hydration
 * could reset, or enable `rendered` for that call when a frame is sufficient.
 *
 * An action needs its element reachable; visible means a person can see it. Actions accept `opacity: 0` on
 * the element or any ancestor. For that element, `isVisible` returns false, `Expect.toBeVisible` waits,
 * `filter({ visible: true })` excludes it, and `filter({ visible: false })` includes it. Opacity alone does
 * not make an action wait for a fade-in.
 *
 * The action's `visible` check requires CSS visibility, content visibility, and a nonempty box. Pointer actions
 * also check that the point receives input. Non-pointer actions do not hit-test: `fill` and `clear` check enabled,
 * editable, and not inert; `focus`, `press`, and `pressSequentially` check not inert; `blur` has no checks by default; `selectOption` checks enabled;
 * `selectText` checks only visibility; `scrollIntoView` checks stability. `setInputFiles` runs no readiness checks.
 *
 * **Example** (Clicking a button that keeps pulsing)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const claimOffer = Effect.fn("claimOffer")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Claim offer" }).click({
 *     checks: { stable: false }
 *   })
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Checks {
  /**
   * Wait for a drawn frame before checking the target, independently of stability sampling.
   *
   * @default true for pointer actions; false for other actions
   */
  readonly rendered?: boolean | undefined
  readonly visible?: boolean | undefined
  readonly enabled?: boolean | undefined
  readonly editable?: boolean | undefined
  readonly notInert?: boolean | undefined
  readonly inViewport?: boolean | undefined
  readonly receivesPointer?: boolean | undefined
  readonly stable?: boolean | { readonly frames: number } | undefined
}

/**
 * Settings for actions with configurable readiness checks.
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
 * Settings for constructing and dispatching a DOM event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DispatchEventOptions {
  /**
   * Resolve the single target without constructing or dispatching an event.
   *
   * @default false
   */
  readonly trial?: boolean | undefined
  /**
   * The native constructor in the target document. No constructor is emulated.
   *
   * @default "Event"
   */
  readonly eventClass?:
    | "Event"
    | "CustomEvent"
    | "MouseEvent"
    | "KeyboardEvent"
    | "PointerEvent"
    | "FocusEvent"
    | "WheelEvent"
    | "InputEvent"
    | "DragEvent"
    | "TouchEvent"
    | "DeviceOrientationEvent"
    | "DeviceMotionEvent"
    | undefined
  /**
   * Constructor initialization, serialized by value as evaluation arguments are.
   *
   * @default { bubbles: true, cancelable: true, composed: true }
   */
  readonly init?: Readonly<Record<string, unknown>> | undefined
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
   * Where to point, from the top left of the element's padding box.
   * With no position, client rectangles are clipped by the viewport and all parent frames.
   * With `receivesPointer` enabled, the first centre hitting the target or a descendant and its iframe in every parent is selected,
   * allowing a later line when an earlier one is covered. Only centres are probed; if none hits, the check reports `Covered`.
   * Candidates are produced anew under the input permit.
   * Disabling `receivesPointer` uses the first geometric centre without coverage probes.
   * Explicit positions are never replaced by another fragment. The point stays inside its rectangle after integer rounding
   * when that rectangle contains an integer point. A target with no visible rectangle has no default point,
   * even when actionability checks are disabled.
   *
   * @default the first reachable fragment centre, or the first geometric centre when receivesPointer is disabled
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
   * Where to drop, from the top left of the target's padding box.
   * The target is checked without `receivesPointer`: its default is the first geometric fragment centre,
   * even when covered. It follows the same viewport/frame clipping and rounding rules as `position`.
   *
   * @default the centre of the target's first nonempty client rectangle after viewport and parent-frame clipping
   */
  readonly targetPosition?: Mouse.Point | undefined
  /**
   * Intermediate pointer moves between source and target.
   *
   * @default 1
   */
  readonly steps?: number | undefined
  /**
   * How an HTML drag (the element or an ancestor is `draggable`) is made. With `"native"`, the browser makes it
   * from input, which needs `input.dragAndDrop` (Chromium). With `"synthetic"`, the page dispatches the events
   * itself, `dragstart` to `dragend`, sharing one `DataTransfer`, and the events are untrusted. An element that
   * isn't draggable is dragged with pointer events either way.
   *
   * @default "native"
   */
  readonly html?: "native" | "synthetic" | undefined
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
 * Which option of a `<select>` to choose, by its value, its label, or its index; the object names which.
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
 * Each action checks that its element is ready, then dispatches at most once. Every action takes a trailing
 * `options`, whose `checks` override the documented checks.
 *
 * **Example** (Filling and submitting a form)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Config, Effect } from "effect"
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
  /**
   * Dispatches one untrusted DOM event on the single match, polling for attachment every 50 milliseconds
   * without readiness checks.
   *
   * **Details**
   *
   * The constructor is explicit: `Event` by default, regardless of the event name. Choose `MouseEvent` for
   * mouse fields, or `CustomEvent` for `detail`. Bubbles, cancelable, and composed default to true; `init`
   * can override them. Initialization crosses by value using the evaluation serialization rules; nested
   * handles and DOM nodes cannot cross. The target document constructs the event in an isolated world where
   * supported, otherwise in its main world.
   *
   * A missing constructor fails with `Unsupported`; rejected initialization fails with `InvalidInput`.
   * No trusted input, focus, or scrolling is sent. Cancellation by a listener still succeeds. Dispatch is
   * retried only if the resolved node detached before dispatch; once sent it is never retried. A timeout
   * can report that the event may have been dispatched. `trial` resolves
   * and checks the target without constructing or dispatching an event.
   *
   * **Example** (Sending application data)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const notify = Effect.fn("notify")(function*(page: Page.Page) {
   *   yield* page.locator("#editor").dispatchEvent("updated", {
   *     eventClass: "CustomEvent",
   *     init: { detail: { saved: true } }
   *   })
   * })
   * ```
   */
  dispatchEvent(type: string, options?: DispatchEventOptions | undefined): ActionEffect

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
   *
   * **Details**
   *
   * - The click is a move to the action point, then a press and a release, carrying the keys and buttons the page
   *   holds.
   * - The gesture is guarded: the first of its pointer, mouse, touch, and click events must land in the element. If
   *   the page covered it between the checks and the input, the gesture is stopped before the page's handlers see
   *   it, and the action checks again.
   * - `modifiers` are pressed before the gesture and released after it. On a backend without
   *   `input.pointerModifiers`, an action with modifiers fails with `Unsupported` before anything is sent.
   *
   * **Gotchas**
   *
   * On stock WebKit, a `mousedown` handler that opens a dialog causes the browser to lose the `mouseup` and
   * `click` events, even though this operation can succeed.
   *
   * A click that fails, or is cut short, after it may have pressed a button leaves that button's release to the next
   * gesture: when the browser didn't confirm the release, it is sent again before that gesture, which can deliver
   * one extra `mouseup` to a page that already got the first.
   *
   * **Example** (Adding to the cart)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const addToCart = Effect.fn("addToCart")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Add to cart" }).click()
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
   */
  click(options?: ClickOptions | undefined): ActionEffect
  /**
   * Double-clicks the one match, with the same checks and guard as `click`: two clicks, the second with a click
   * count of 2, so the page sees `dblclick`.
   *
   * **Example** (Opening a file from a list)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openInvoice = Effect.fn("openInvoice")(function*(page: Page.Page) {
   *   yield* page.getByRole("row", { name: "invoice-1042.pdf" }).dblclick()
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
   */
  dblclick(options?: ClickOptions | undefined): ActionEffect
  /**
   * Taps the one match: a touch start and end at the action point, with the same checks and guard as `click`.
   *
   * **Gotchas**
   *
   * No backend needs touch emulation for it. On WebKit, which has no touch input, it fails with `Unsupported`
   * before anything is sent. Firefox on the desktop dispatches touch events to listeners but has no `ontouchstart`
   * attribute.
   *
   * **Example** (Opening the menu on a phone layout)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openMenu = Effect.fn("openMenu")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Menu" }).tap()
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
   */
  tap(options?: PointerOptions | undefined): ActionEffect
  /**
   * Moves the pointer over the one match. Checks: visible, stable, enabled, notInert, inViewport,
   * receivesPointer.
   *
   * **Details**
   *
   * Unlike `click`, it isn't guarded: if the page covers the element after the checks, whatever covers it gets the
   * move.
   *
   * **Example** (Signing out from a menu that opens on hover)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const signOut = Effect.fn("signOut")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Account" }).hover()
   *   yield* page.getByRole("menuitem", { name: "Sign out" }).click()
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
   */
  hover(options?: PointerOptions | undefined): ActionEffect
  /**
   * Checks a checkbox, a radio, or an ARIA checkable, and confirms it became checked. Checks: the same as `click`.
   *
   * **Details**
   *
   * Checked state follows `isChecked`, including its supported ARIA roles and optional checkability. If
   * it's already checked, nothing is sent. Otherwise it clicks and reads the state again; a click that
   * didn't check it fails with `StateUnchanged{expected: "checked"}`. The selected element's own checked
   * state takes precedence. Otherwise a selected label, or an ordinary descendant's nearest DOM label,
   * supplies its associated control. The selected element remains the click target and position origin.
   * When input is needed, the enabled check applies to both the selected element and that control,
   * using native disabled, fieldset and ARIA-disabled state. If that control stays disabled, the action
   * fails with `Timeout`, its history showing `Disabled`, and no input is sent.
   * Set `checks: { enabled: false }` to skip this check.
   * Trial actions check readiness without input; already-correct state still succeeds immediately.
   *
   * Association follows DOM parents without crossing a shadow root and uses only the label's control,
   * never the ancestor label's ARIA state. Descendant fallback checks the selected node, its DOM
   * ancestors, and ancestors added by slots in open shadow roots, stopping before the associated DOM
   * label. Interactive ancestors above that label are outside this guard.
   *
   * Fallback refuses buttons, inputs, selects, textareas, details, summaries, frames, embeds, objects,
   * links with href (including SVG links with namespaced xlink:href), images with usemap, audio/video
   * with controls, editable content, and ARIA widget roles: button, checkbox, combobox, grid, gridcell,
   * link, listbox, menu, menubar, menuitem, menuitemcheckbox, menuitemradio, option, radio, radiogroup,
   * scrollbar, searchbox, separator, slider, spinbutton, switch, tab, tablist, textbox, tree, treegrid,
   * and treeitem. Refusal is `WrongElement` before input, even when the associated control already
   * matches. Missing or non-checkable associations also fail with `WrongElement`.
   *
   * Slot-added controls can be inspected only in open shadow roots. A control inside a closed shadow
   * root can receive input before the action fails with `StateUnchanged`. Public `isChecked` and checked
   * expectations still read only the selected element's own state.
   *
   * **Example** (Accepting the terms)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const acceptTerms = Effect.fn("acceptTerms")(function*(page: Page.Page) {
   *   yield* page.getByRole("checkbox", { name: "I accept the terms" }).check()
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
   */
  check(options?: PointerOptions | undefined): ActionEffect
  /**
   * Unchecks a checkbox or an ARIA checkable, and confirms it became unchecked. Checks: the same as
   * `click`.
   *
   * **Details**
   *
   * It follows `check`, using the checked state and optional checkability described by `isChecked`. The
   * selected element's own checked state takes precedence. Otherwise a selected label, or an ordinary
   * descendant's nearest DOM label, supplies its associated control. The selected element remains the
   * click target and position origin. If already unchecked, nothing is sent. A checked native radio
   * fails with `WrongElement` before input, including with `trial: true`; check another radio in its
   * group instead. Page-managed ARIA radios can be unchecked. Otherwise it clicks and reads the state
   * again, failing with `StateUnchanged{expected: "unchecked"}` if the state stays checked. When input is
   * needed, the enabled check applies to both the selected element and its associated control, including
   * native, fieldset and ARIA-disabled state. If that control stays disabled, the action fails with
   * `Timeout`, its history showing `Disabled`, and no input is sent.
   * `checks: { enabled: false }` skips this check; trial checks the same readiness without input.
   *
   * Association follows DOM parents without crossing a shadow root and uses only the label's control,
   * never the ancestor label's ARIA state. Descendant fallback checks the selected node, its DOM
   * ancestors, and ancestors added by slots in open shadow roots, stopping before the associated DOM
   * label. Interactive ancestors above that label are outside this guard.
   *
   * Fallback refuses buttons, inputs, selects, textareas, details, summaries, frames, embeds, objects,
   * links with href (including SVG links with namespaced xlink:href), images with usemap, audio/video
   * with controls, editable content, and ARIA widget roles: button, checkbox, combobox, grid, gridcell,
   * link, listbox, menu, menubar, menuitem, menuitemcheckbox, menuitemradio, option, radio, radiogroup,
   * scrollbar, searchbox, separator, slider, spinbutton, switch, tab, tablist, textbox, tree, treegrid,
   * and treeitem. Refusal is `WrongElement` before input, even when the associated control already
   * matches. Missing or non-checkable associations also fail with `WrongElement`.
   *
   * Slot-added controls can be inspected only in open shadow roots. A control inside a closed shadow
   * root can receive input before the action fails with `StateUnchanged`. Public `isChecked` and checked
   * expectations still read only the selected element's own state.
   *
   * **Example** (Opting out of offers)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const optOut = Effect.fn("optOut")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Email me offers").uncheck()
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
   */
  uncheck(options?: PointerOptions | undefined): ActionEffect
  /**
   * Focuses the one match, from an isolated world of Strider's. Checks: visible, notInert.
   *
   * **Example** (Focusing the search field)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const focusSearch = Effect.fn("focusSearch")(function*(page: Page.Page) {
   *   yield* page.getByRole("searchbox").focus()
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  focus(options?: ActionOptions | undefined): ActionEffect
  /**
   * Removes focus from the one match through its native blur method.
   *
   * **Details**
   *
   * Waits for exactly one match without visibility, enabled, or inert checks by default. An unfocused element
   * is unchanged. Calls the element's native blur method through Strider's engine without sending keyboard
   * or pointer input. Uses an isolated world where the backend provides one; stock WebKit shares the page world.
   * Events follow the browser's native behavior. In stock WebKitGTK's MiniBrowser, when the page doesn't
   * have focus (`document.hasFocus()` is false), the element gets `focusout` but no `blur` event.
   * Missing matches wait until the deadline; several matches fail with `StrictViolation`.
   *
   * **Example** (Leaving an email field)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const leaveEmail = Effect.fn("leaveEmail")(function*(page: Page.Page) {
   *   const email = page.getByLabel("Email")
   *   yield* email.fill("ada@example.com")
   *   yield* email.blur()
   * })
   * ```
   */
  blur(options?: ActionOptions | undefined): ActionEffect

  /**
   * Clears an input or editable element. Checks: visible, enabled, editable, notInert.
   *
   * **Details**
   *
   * It's `fill("")`: the contents are selected and deleted with a key, or a value that isn't typed is set to empty.
   *
   * **Example** (Removing a coupon code)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const removeCoupon = Effect.fn("removeCoupon")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Coupon code").clear()
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  clear(options?: ActionOptions | undefined): ActionEffect
  /**
   * Scrolls the one match into view, from an isolated world of Strider's. Checks: visible, stable.
   *
   * **Example** (Scrolling to the footer)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const toFooter = Effect.fn("toFooter")(function*(page: Page.Page) {
   *   yield* page.getByRole("contentinfo").scrollIntoView()
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  scrollIntoView(options?: ActionOptions | undefined): ActionEffect
  /**
   * Replaces the value of an input or editable element. Checks: visible, enabled, editable, notInert.
   *
   * **Details**
   *
   * - A text input, a textarea, or a `contenteditable` element is focused and its contents selected from an
   *   isolated world of Strider's, then the value is inserted as text, as an input method would.
   * - An input whose value isn't typed (`date`, `time`, `color`, `range`, and their kin) has it set from that
   *   world, with `input` then `change` dispatched. Equivalent browser serialization is accepted, such as
   *   lowercase color hex or omitted zero seconds. A malformed value, or a range value changed by clamping
   *   or rounding, fails with `InvalidInput` without changing the value or dispatching those events.
   *   Validation runs before and after focus; changes made by a focus handler remain on refusal.
   * - An element that can't be edited fails at once with `NotEditable`. A read-only one is waited for, and a
   *   timeout reports it as `ReadOnly`.
   * - The value must be a string, including inside `Redacted`; other runtime values fail with `InvalidInput`
   *   before contacting the browser.
   * - A number input takes an empty string to clear, or a finite HTML floating-point string: an optional minus,
   *   digits with an optional fractional part (or a leading decimal point and digits), and an optional exponent
   *   such as `1e2`. Whitespace, a leading plus, a trailing decimal point, hexadecimal, and non-finite values fail
   *   with `InvalidInput` before focus, selection, or mutation. The input's min, max, and step don't restrict fill.
   * - In a design-mode document, filling a non-input target blurs a different active input or textarea,
   *   including one inside open shadow roots. The target is resolved and its effective checks run again
   *   after blur handlers, before selection. If refocusing prevents preparation until the deadline,
   *   the timeout reports focus preparation in its history.
   * - Firefox cannot focus inputs in top-level design-mode documents. Filling one is unsupported:
   *   native typing can insert into the document body instead. Strider does not change design mode
   *   or synthesize input to work around this browser limitation.
   * - A `Redacted` value is typed into the page but never shown in spans, traces, or errors.
   *
   * **Example** (Choosing a delivery date)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const deliverOn = Effect.fn("deliverOn")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Delivery date").fill("2026-12-24")
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  fill(value: string | Redacted.Redacted<string>, options?: ActionOptions | undefined): ActionEffect
  /**
   * Focuses the one match and presses one key. Checks: visible, notInert.
   *
   * **Details**
   *
   * A key is a UI Events `key` value (`"Enter"`, `"a"`, `"ArrowDown"`) or one character; anything else fails with
   * `InvalidInput`. `modifiers` are pressed before it and released after, and Shift turns `"a"` into `"A"`.
   *
   * **Example** (Submitting a search with Enter)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const search = Effect.fn("search")(function*(page: Page.Page) {
   *   yield* page.getByRole("searchbox").fill("headphones")
   *   yield* page.getByRole("searchbox").press("Enter")
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  press(key: Keyboard.Key | string, options?: PressOptions | undefined): ActionEffect
  /**
   * Focuses the one match and types text one key at a time. Checks: visible, notInert.
   *
   * **Details**
   *
   * Accepts a string or a `Redacted` string; any other value fails with `InvalidInput` before contacting the browser.
   * `\n` is Enter and `\t` is Tab; `delay` waits between keys. A `Redacted` text is never shown in spans, traces, or
   * errors.
   *
   * **Example** (Typing into an autocomplete)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const chooseCity = Effect.fn("chooseCity")(function*(page: Page.Page) {
   *   yield* page.getByRole("combobox", { name: "City" }).pressSequentially("Lisbon", {
   *     delay: "50 millis"
   *   })
   *   yield* page.getByRole("option", { name: "Lisbon, Portugal" }).click()
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  pressSequentially(text: string | Redacted.Redacted<string>, options?: TypeOptions | undefined): ActionEffect
  /**
   * Selects the matched element's text without changing its contents.
   *
   * **Details**
   *
   * Waits for one visible match under the current deadline. Labels and their noninteractive descendants
   * select the associated control; descendants of buttons and button, checkbox, or radio roles target
   * that interactive ancestor. Inputs and textareas use native `select()`; other elements use a DOM
   * range over their contents, including nested text. Attempts to focus the target; an unfocusable
   * element can still have its contents selected. Requires owned access on every backend.
   *
   * **Gotchas**
   *
   * Native input selection depends on the browser and input type: number inputs support selection,
   * while inputs without selectable text, such as checkboxes, can succeed without selecting text.
   * Multiple matches fail with `StrictViolation`; an absent or hidden match waits until the deadline.
   * Checks only the matched element's visibility, before label retargeting, with no viewport, pointer
   * hit test, enabled, editable, or inert check. Native focus may scroll. `trial: true` checks without
   * focus or selection; `checks: { visible: false }` skips visibility. There is no blanket force option.
   * Focus and selection handlers can change the resulting selection; this operation does not lock it.
   *
   * **Example** (Selecting a field's text)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const selectName = Effect.fn("selectName")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Name").selectText()
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   * @stability unstable
   * @since 0.1.0
   */
  selectText(options?: ActionOptions | undefined): ActionEffect

  /**
   * Chooses options of a `<select>`, by value, label, or index. Checks: visible, enabled.
   *
   * **Details**
   *
   * The options are chosen from an isolated world of Strider's, with `input` and `change` dispatched as for a
   * user's choice. An option that isn't there yet is waited for, and a timeout reports it as `NoSuchOption`. Any
   * element but a `<select>` fails at once with `WrongElement`.
   *
   * **Example** (Choosing a country)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const shipToPortugal = Effect.fn("shipToPortugal")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Country").selectOption({ label: "Portugal" })
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  selectOption(
    choice: SelectOption | ReadonlyArray<SelectOption>,
    options?: ActionOptions | undefined
  ): ActionEffect
  /**
   * Sets the files of a file input. Checks: none.
   *
   * **Details**
   *
   * Launched browsers read local paths directly; relative paths require the captured Effect `Path` service.
   * Attached browsers transfer local files through captured `FileSystem` and `Path` services. A local read failure
   * is `FileUnreadable`; an element other than a file input is `WrongElement`. Launched local paths can combine
   * with remote paths; attached local files can combine with bytes. Mixing native paths and transferred files
   * fails with `InvalidInput` before changing selection. Multiple files for an input without `multiple` also
   * fail with `InvalidInput` before selection or events change. An empty list clears the input. Stock WebKit currently appends native paths on
   * multiple inputs rather than replacing an existing selection. See `FileInput.local` for deployment caveats.
   *
   * **Example** (Uploading a receipt)
   *
   * ```ts import.meta.vitest
   * import { FileInput, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const uploadReceipt = Effect.fn("uploadReceipt")(function*(page: Page.Page) {
   *   yield* page.getByLabel("Receipt").setInputFiles(FileInput.local("./receipt.pdf"))
   * })
   * ```
   *
   * @default checks.rendered: false; check current layout immediately
   */
  setInputFiles(
    files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>,
    options?: ActionOptions | undefined
  ): ActionEffect
  /**
   * Drags the one match onto `target`, with the same checks and guard as `click`. The target's checks are
   * visible, enabled, notInert, and inViewport. The rendered override applies to both endpoints.
   *
   * **Details**
   *
   * - The drag is a press at the element's action point, `steps` moves with the button held, and a release at the
   *   target's, which drives pages that drag with pointer events.
   * - An HTML drag (`draggable="true"` on the element or an ancestor) needs `input.dragAndDrop`, which Chromium
   *   has; elsewhere it fails with `Unsupported` before anything is sent.
   * - With `html: "synthetic"`, the page dispatches the drag's events itself, on every backend: `dragstart` and
   *   `drag` on the element, `dragenter` and `dragover` where the target's point is, then `drop` there if a
   *   `dragover` handler accepted it, or `dragleave`, and `dragend` on the element.
   * - The element and the target must be in one document.
   *
   * **Gotchas**
   *
   * - In a synthetic drag, only Firefox lets `dragend` see the `dropEffect` the target set: Chromium and WebKit
   *   ignore a `dropEffect` set on a `DataTransfer` that a script made, so `dragend` sees `"none"` there.
   * - A `target` from another page is a mistake in the program, so it throws at once instead of failing as an
   *   effect.
   *
   * **Example** (Moving a card to another column)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const markShipped = Effect.fn("markShipped")(function*(page: Page.Page) {
   *   const card = page.getByRole("listitem").filter({ hasText: "Order 1042" })
   *   yield* card.dragTo(page.getByRole("list", { name: "Shipped" }))
   * })
   * ```
   *
   * @default checks.rendered: true; wait for a drawn frame
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

const RelativeLocatorTypeId = "~@usestrider/browser/Locator/RelativeLocator"

/**
 * A query relative to the element being filtered, valid only in `filter`'s `has` and `hasNot`.
 *
 * **Details**
 *
 * A locator that starts from the page would match anywhere on the page, so passing one to `has` or `hasNot` is a
 * type error.
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
 * **Example** (Finding the rows that have a Delete button)
 *
 * ```ts import.meta.vitest
 * import { Locator, Page } from "@usestrider/browser"
 *
 * const deletableRows = (page: Page.Page) =>
 *   page.getByRole("row").filter({
 *     has: Locator.relative.getByRole("button", { name: "Delete" })
 *   })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const relative: Queries<RelativeLocator> = Steps.relative

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
   *
   * **Example** (Waiting for an embedded form to show)
   *
   * ```ts import.meta.vitest
   * import { Expect, Locator } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const paymentShown = Effect.fn("paymentShown")(
   *   function*(payment: Locator.ReadonlyFrameLocator) {
   *     yield* payment.owner.pipe(Expect.toBeVisible)
   *   }
   * )
   * ```
   */
  readonly owner: ReadonlyLocator
  /**
   * Enters a nested iframe, found by a locator built from this frame locator.
   *
   * **Gotchas**
   *
   * An `iframe` from another page or frame is a mistake in the program, so it throws at once instead of failing as an
   * effect.
   *
   * **Example** (Reaching a card field two iframes deep)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const enterCard = Effect.fn("enterCard")(function*(page: Page.Page) {
   *   const checkout = page.frame(page.locator("iframe#checkout"))
   *   const card = checkout.frame(checkout.locator("iframe#card"))
   *   yield* card.getByLabel("Card number").fill("4242 4242 4242 4242")
   * })
   * ```
   */
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
}

/**
 * An iframe's document on a page you control, whose locators can act.
 *
 * **Example** (Paying inside an embedded form)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
 * `candidates` describes each match. When exactly one of them is visible, `suggestions` holds the locator with
 * `.filter({ visible: true })` added, which matches it; otherwise it's empty.
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
 * - `BindingLost`: Strider's script in the page was installed again, and the refs it gave went with it.
 * - `OtherSnapshot`: no snapshot of this document gave the ref.
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
 * Reason for a read that found nothing to read: a read never waits, so it fails at once.
 *
 * **Example** (Reading a banner that may not be there)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const promotion = Effect.fn("promotion")(function*(page: Page.ReadonlyPage) {
 *   return yield* page.getByTestId("promo-banner").readText.pipe(
 *     Effect.map(Option.some),
 *     Effect.catchReason("LocatorError", "NoMatch", () => Effect.succeedNone)
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NoMatch extends Schema.Error<NoMatch>("@usestrider/browser/Locator/NoMatch")({
  _tag: Schema.tag("NoMatch"),
  hint: Schema.String
}) {
  override get message(): string {
    return `Nothing matched (${this.hint})`
  }
}

/**
 * Reason for an action or read that the matched element's kind doesn't support, such as `readValue` of a `div`
 * or `check` of a button.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class WrongElement extends Schema.Error<WrongElement>("@usestrider/browser/Locator/WrongElement")({
  _tag: Schema.tag("WrongElement"),
  expected: Schema.String,
  element: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Expected ${this.expected}, found ${this.element} (${this.hint})`
  }
}

/**
 * Reason for a `check` or `uncheck` whose click didn't change the element's state, such as when the page
 * prevented it.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class StateUnchanged extends Schema.Error<StateUnchanged>("@usestrider/browser/Locator/StateUnchanged")({
  _tag: Schema.tag("StateUnchanged"),
  expected: Schema.Literals(["checked", "unchecked"]),
  hint: Schema.String
}) {
  override get message(): string {
    return `The element didn't become ${this.expected} (${this.hint})`
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
  NoMatch,
  WrongElement,
  StateUnchanged,
  NotEditable,
  FileUnreadable,
  Reason.InvalidInput,
  Reason.EvaluationThrown,
  Reason.NotSerializable,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure,
  Reason.PromptBlocking,
  Reason.LocatorHandlerFailed
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
 * `operation` names what was attempted, such as `Locator.click`, and `locator` describes the query, or its
 * `describe` label. Ambiguity, a bad selector, and a stale ref fail at once; only waiting for checks to pass
 * uses the deadline.
 *
 * **Example** (Recovering from an ambiguous locator)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Console, Effect } from "effect"
 *
 * const save = Effect.fn("save")(function*(page: Page.Page) {
 *   yield* page.getByText("Save").click().pipe(
 *     Effect.catchReason(
 *       "LocatorError",
 *       "StrictViolation",
 *       (reason) => Console.log(reason.suggestions)
 *     )
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
