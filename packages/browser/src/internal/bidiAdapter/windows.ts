/**
 * Windows kept for reuse. A page Strider opened has a window of its own; when it closes, the window is kept with a
 * blank tab in the page's user context, and that context's next page opens as a tab in front of it. Building a window
 * costs Firefox's main process far more than a tab, and BiDi's commands wait on that process. The blank tabs are the
 * adapter's own: they never reach the model, its events or a rebuild from the tree. Being in the context, they close
 * with it, and so do its idle windows.
 */
import * as Effect from "effect/Effect"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import type { State } from "./state.ts"

/** The idle windows each user context keeps at most; a window beyond them is closed. */
export const maxIdle = 2

export interface Windows {
  /** Blank tab creations not yet answered, by user context: a blank top-level context there is held back meanwhile. */
  readonly pending: Map<string, number>
  /** Contexts held back while a blank tab's creation was unanswered, folded once it answers if they aren't it. */
  readonly parked: Array<BrowsingContext.Info>
  /** The blank tabs, by BiDi context, with their user context. */
  readonly blanks: Map<string, string>
  /** Each user context's idle windows, by their blank tab, oldest first. */
  readonly idle: Map<string, Array<string>>
  /** Each page alone in a window Strider opened, by BiDi context, with the window's blank tab once it has one. */
  readonly pages: Map<string, string | undefined>
  /** The pages whose close is adding their window's blank tab, which a refused close takes away again. */
  readonly added: Set<string>
}

const all = new WeakMap<State, Windows>()

export const of = (state: State): Windows => {
  let windows = all.get(state)
  if (windows === undefined) {
    windows = { pending: new Map(), parked: [], blanks: new Map(), idle: new Map(), pages: new Map(), added: new Set() }
    all.set(state, windows)
  }
  return windows
}

/** Whether a context is one of the adapter's blank tabs, which the model never holds. */
export const hidden = (state: State, context: string): boolean => all.get(state)?.blanks.has(context) ?? false

/** Whether a new context could be a blank tab still being created: top-level, blank and unopened, in its context. */
export const mayBeBlank = (state: State, info: BrowsingContext.Info): boolean =>
  info.userContext !== null && (of(state).pending.get(info.userContext) ?? 0) > 0 &&
  (info.parent === null || info.parent === undefined) && info.originalOpener === null && info.url === "about:blank"

/** Closes a blank tab, and with it its window, when nothing else is in it. A failure leaves it for the browser's end. */
export const close = (state: State, blank: string) =>
  Effect.ignore(state.send(BrowsingContext.close({ context: blank as BrowsingContext.BrowsingContext })))

/** Forgets a blank tab that ended, wherever it was idle. */
export const ended = (state: State, blank: string) => {
  const windows = of(state)
  const context = windows.blanks.get(blank)
  windows.blanks.delete(blank)
  const idle = context === undefined ? undefined : windows.idle.get(context)
  const at = idle?.indexOf(blank) ?? -1
  if (at !== -1) idle!.splice(at, 1)
}

/** Puts a window on its context's idle list, by its blank tab: the windows beyond `maxIdle`, oldest first, to close. */
export const idle = (state: State, blank: string): ReadonlyArray<string> => {
  const windows = of(state)
  const context = windows.blanks.get(blank)
  if (context === undefined) return []
  const list = windows.idle.get(context) ?? []
  windows.idle.set(context, list)
  list.push(blank)
  return list.splice(0, Math.max(0, list.length - maxIdle))
}

/** Takes a context's newest idle window, by its blank tab. */
export const take = (state: State, context: string): string | undefined => of(state).idle.get(context)?.pop()

/**
 * The blank tab a page's close added, when a beforeunload prompt refused the close: the page stays, alone in its
 * window again once the tab closes. A reused window's blank tab, there before the close, stays.
 */
export const refused = (state: State, page: string): string | undefined => {
  const windows = of(state)
  if (!windows.added.delete(page)) return undefined
  const blank = windows.pages.get(page)
  windows.pages.set(page, undefined)
  return blank !== undefined && windows.blanks.has(blank) ? blank : undefined
}
