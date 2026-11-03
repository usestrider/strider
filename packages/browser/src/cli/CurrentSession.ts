/**
 * What `strider run` gives a segment: the live CLI session, and its pages by name.
 *
 * A segment is a file whose default export is made with `Segment.make`, which `strider run` runs in a live CLI session with a scope
 * of its own. It finds the session's pages by name, such as the `shop` that `page new --name shop` gave one.
 * Programs and tests never make a session; they pass pages around as values.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"

/**
 * Schema for a page name chosen with `--name`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PageName = Schema.String.pipe(Schema.brand("~@usestrider/browser/cli/CurrentSession/PageName"))

/**
 * A page name chosen with `--name`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PageName = typeof PageName.Type

/**
 * The live session a segment runs against.
 *
 * @stability experimental
 * @category services
 * @since 0.1.0
 */
export interface CurrentSession {
  /**
   * The session's one context.
   */
  readonly context: UserContext.UserContext
  /**
   * Gets the page with this name, or fails at once with `PageNotFound` when there is none.
   *
   * **Example** (Adding to the cart on the session's `shop` page)
   *
   * ```ts import.meta.vitest
   * import { CurrentSession, Segment } from "@usestrider/browser/cli"
   * import { Effect, Schema } from "effect"
   *
   * export default Segment.make(
   *   Schema.Record(Schema.String, Schema.Never),
   *   Effect.fnUntraced(function*() {
   *     const session = yield* CurrentSession.CurrentSession
   *     const shop = yield* session.page("shop")
   *     yield* shop.getByRole("button", { name: "Add to cart" }).click()
   *   })
   * )
   * ```
   */
  page(name: PageName | string): Effect.Effect<Page.Page, PageNotFound>
  /**
   * Keeps a page the segment opened, so it stays open after the segment ends: the session's scope owns it from
   * then on, and it is named `name`, or else the next of `p1`, `p2`…, which `keep` returns. A page the
   * segment returns is named without being kept, so it closes with the segment unless something else owns it,
   * such as a session page that opened it as a popup.
   *
   * **Example** (Opening a page that outlives the segment)
   *
   * ```ts import.meta.vitest
   * import { CurrentSession, Segment } from "@usestrider/browser/cli"
   * import { Effect, Schema } from "effect"
   *
   * export default Segment.make(
   *   Schema.Record(Schema.String, Schema.Never),
   *   Effect.fnUntraced(function*() {
   *     const session = yield* CurrentSession.CurrentSession
   *     const orders = yield* session.context.newPage
   *     yield* orders.goto("https://shop.example.com/orders")
   *     yield* session.keep(orders, "orders")
   *   })
   * )
   * ```
   */
  keep(page: Page.Page, name?: PageName | string): Effect.Effect<PageName, NameTaken>
}

/**
 * The service tag for `CurrentSession`, provided only by `strider run`.
 *
 * **Example** (Paying in a popup from a segment)
 *
 * ```ts import.meta.vitest
 * import { Popup } from "@usestrider/browser"
 * import { CurrentSession, Segment } from "@usestrider/browser/cli"
 * import { Effect, Schema } from "effect"
 *
 * export default Segment.make(
 *   Schema.Record(Schema.String, Schema.Never),
 *   Effect.fnUntraced(function*() {
 *     const session = yield* CurrentSession.CurrentSession
 *     const shop = yield* session.page("shop")
 *     const popups = yield* Popup.next(shop)
 *     yield* shop.getByText("Pay").click()
 *     const popup = yield* popups
 *     yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
 *     return { popup }
 *   })
 * )
 * ```
 *
 * @stability experimental
 * @category tags
 * @since 0.1.0
 */
export const CurrentSession: Context.Service<CurrentSession, CurrentSession> = Context.Service<CurrentSession>(
  "@usestrider/browser/cli/CurrentSession"
)

const PageNotFoundTypeId = "~@usestrider/browser/cli/CurrentSession/PageNotFound"

/**
 * Error for a page name the session doesn't have. Its hint lists the session's page names.
 *
 * **Example** (Opening the page when the session has none by that name)
 *
 * ```ts import.meta.vitest
 * import { CurrentSession } from "@usestrider/browser/cli"
 * import { Effect } from "effect"
 *
 * const shopPage = Effect.gen(function*() {
 *   const session = yield* CurrentSession.CurrentSession
 *   return yield* session.page("shop").pipe(
 *     Effect.catchTag(
 *       "PageNotFound",
 *       () => Effect.tap(session.context.newPage, (page) => session.keep(page, "shop"))
 *     )
 *   )
 * })
 * ```
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class PageNotFound extends Schema.TaggedError<PageNotFound>(PageNotFoundTypeId)("PageNotFound", {
  name: Schema.String,
  hint: Schema.String
}) {
  readonly [PageNotFoundTypeId] = PageNotFoundTypeId
  override get message(): string {
    return `No page named ${this.name} (${this.hint})`
  }
}

/**
 * Checks whether a value is a `PageNotFound`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isPageNotFound = (u: unknown): u is PageNotFound => Predicate.hasProperty(u, PageNotFoundTypeId)

const NameTakenTypeId = "~@usestrider/browser/cli/CurrentSession/NameTaken"

/**
 * Error for a name another page of the session already has. Its hint lists the session's page names.
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class NameTaken extends Schema.TaggedError<NameTaken>(NameTakenTypeId)("NameTaken", {
  name: Schema.String,
  hint: Schema.String
}) {
  readonly [NameTakenTypeId] = NameTakenTypeId
  override get message(): string {
    return `A page is already named ${this.name} (${this.hint})`
  }
}

/**
 * Checks whether a value is a `NameTaken`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isNameTaken = (u: unknown): u is NameTaken => Predicate.hasProperty(u, NameTakenTypeId)
