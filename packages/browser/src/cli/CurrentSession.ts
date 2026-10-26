/**
 * What `strider run` provides to a segment (`@usestrider/browser/cli`).
 *
 * A segment is a file whose default export is an effect, run against a live CLI session (CLI.md). Programs
 * and tests never construct a session; they pass pages as values. Pages are found by name only: generated
 * handles such as `p2` are tokens, not names.
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
   * The page with this name; fails at once when there is none.
   */
  page(name: PageName | string): Effect.Effect<Page.Page, PageNotFound>
  /**
   * Keeps a page the segment opened once the segment ends: its ownership moves from the segment's scope to the
   * session's, and it is named into the session, `name` or the next `p1`, `p2`…, whose name it returns
   * (review 22). A page the segment returns is named without being kept, so it closes with the segment unless
   * something else owns it, such as a session page that opened it as a popup.
   */
  keep(page: Page.Page, name?: PageName | string): Effect.Effect<PageName, NameTaken>
}

/**
 * The service tag for `CurrentSession`, provided only by `strider run`.
 *
 * **Example** (A segment that pays in a popup)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Popup } from "@usestrider/browser"
 * import { CurrentSession } from "@usestrider/browser/cli"
 *
 * export default Effect.gen(function*() {
 *   const session = yield* CurrentSession.CurrentSession
 *   const shop = yield* session.page("shop")
 *   const popups = yield* Popup.next(shop)
 *   yield* shop.getByText("Pay").click()
 *   const popup = yield* popups
 *   yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
 *   return { popup }
 * })
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
 * Error for a name another of the session's pages has. Its hint lists the session's page names.
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
