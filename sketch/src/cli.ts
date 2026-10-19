/**
 * effect-browser/cli: only what `eb run` provides to a segment, a file whose default export is an Effect run
 * against a live session (CLI.md). Programs and tests never construct a session; they pass pages as values.
 */
import { Context } from "effect"
import type { Cause, Effect } from "effect"
import type { PageName } from "./Brand.ts"
import type { Page } from "./Page.ts"
import type { UserContext } from "./UserContext.ts"

export interface PageNotFound extends Cause.YieldableError {
  readonly _tag: "PageNotFound"
  readonly name: string
  readonly hint: string                                 // lists the session's pages; names only, never generated handles like p2
}

export class CurrentSession extends Context.Service<CurrentSession, {
  readonly context: UserContext                         // the session's one context: newPage, pages
  page(name: PageName | string): Effect.Effect<Page, PageNotFound>   // by name only; generated handles are tokens (principle 14)
}>()("effect-browser/cli/CurrentSession") {}
