/**
 * Windows kept for reuse. A page Strider opened has a window of its own; when it closes, the window is kept with a
 * blank tab in the default user context, and the next page opens as a tab beside it. Building a window costs Firefox's
 * main process far more than a tab, and BiDi's commands wait on that process. The blank tabs are the adapter's own:
 * they never reach the model, its events or a rebuild from the tree.
 */
import type * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import type { State } from "./state.ts"

/** The idle windows kept at most; a window beyond them is closed. */
export const maxIdle = 2

export interface Windows {
  /** Blank tab creations not yet answered: a default-context blank top-level context seen meanwhile is held back. */
  pending: number
  /** Contexts held back while a blank tab's creation was unanswered, folded once it answers if they aren't it. */
  readonly parked: Array<BrowsingContext.Info>
  /** The blank tabs, by BiDi context. */
  readonly blanks: Set<string>
  /** Idle windows, by their blank tab, oldest first. */
  readonly idle: Array<string>
  /** Each page alone in a window Strider opened, by BiDi context, with the window's blank tab once it has one. */
  readonly pages: Map<string, string | undefined>
}

const all = new WeakMap<State, Windows>()

export const of = (state: State): Windows => {
  let windows = all.get(state)
  if (windows === undefined) {
    windows = { pending: 0, parked: [], blanks: new Set(), idle: [], pages: new Map() }
    all.set(state, windows)
  }
  return windows
}

/** Whether a context is one of the adapter's blank tabs, which the model never holds. */
export const hidden = (state: State, context: string): boolean => all.get(state)?.blanks.has(context) ?? false

/** Whether a new context could be a blank tab still being created: top-level, blank, unopened, in the default context. */
export const mayBeBlank = (state: State, info: BrowsingContext.Info): boolean =>
  of(state).pending > 0 && (info.parent === null || info.parent === undefined) && info.originalOpener === null &&
  info.userContext === "default" && info.url === "about:blank"
