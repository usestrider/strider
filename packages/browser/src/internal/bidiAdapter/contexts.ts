/**
 * User contexts, pages and downloads on BiDi. Preload scripts and native user-context settings cover future
 * pages. A new user context receives its effective viewport default without rewriting existing contexts;
 * viewport precedence for existing pages is resolved by the declaration registry.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowserBidi from "../../bidi-protocol/Browser.ts"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import type * as Download from "../../Download.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import * as Cleanup from "./cleanup.ts"
import { applyKind } from "./declare.ts"
import {
  type ContextEntry,
  contextOf,
  type DownloadEntry,
  type Event,
  navigableById,
  navigableOf,
  type State
} from "./state.ts"
import { addNavigable, endNavigation, removeNavigable } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(BrowsingContext.contextCreated, (params, { state }) => {
      addNavigable(state, params, state.adopting)
    })
    .on(BrowsingContext.contextDestroyed, (params, { state }) => {
      const navigable = state.navigables.get(params.context)
      if (navigable === undefined) return
      removeNavigable(
        state,
        navigable,
        navigable.parent !== undefined
          ? new L1Target.FrameDetached({})
          : navigable.closing ?? (navigable.context.removing
            ? new L1Target.PageClosed({ by: "userContextRemoved" })
            : new L1Target.PageClosed({ by: "script" })),
        "bidi:browsingContext.contextDestroyed"
      )
    })
    .on(BrowsingContext.downloadWillBegin, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      const download: DownloadEntry = { id: state.ids.download(), path: undefined }
      state.downloads.set(params.download, download)
      state.downloadsById.set(download.id, download)
      if (navigable !== undefined) {
        state.buffer.emit({
          _tag: "DownloadStarted",
          download: download.id,
          page: navigable.page.id,
          url: Urls.reported(params.url),
          suggestedFilename: params.suggestedFilename
        })
      }
      const navigation = params.navigation === null ? undefined : state.navigations.get(params.navigation)
      if (navigation !== undefined) {
        endNavigation(
          state,
          navigation,
          { _tag: "Download", download: Option.some(download.id) },
          "bidi:browsingContext.downloadWillBegin"
        )
      }
    })
    .on(BrowsingContext.downloadEnd, (params, { state }) => {
      const download = state.downloads.get(params.download)
      if (download === undefined) return
      state.downloads.delete(params.download)
      if (params.status === "complete") {
        download.path = "filepath" in params && params.filepath !== null ? params.filepath : undefined
        state.buffer.emit({
          _tag: "DownloadEnded",
          download: download.id,
          outcome: { _tag: "Completed", path: Option.fromUndefinedOr(download.path) }
        })
      } else {
        state.buffer.emit({ _tag: "DownloadEnded", download: download.id, outcome: { _tag: "Canceled" } })
      }
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

export const createUserContext = Effect.fnUntraced(function*(state: State, options: Adapter.UserContextOptions) {
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      // Keep ownership of a successful create reply until setup has installed its rollback path.
      const { userContext } = yield* Kit.protocol(state.send(BrowserBidi.createUserContext({
        ...(options.acceptInsecureCerts ? { acceptInsecureCerts: true } : {}),
        ...(Option.isSome(options.proxy)
          ? {
            proxy: {
              proxyType: "manual",
              httpProxy: options.proxy.value.server,
              sslProxy: options.proxy.value.server,
              noProxy: [...options.proxy.value.bypass]
            }
          }
          : {})
      })))
      const entry: ContextEntry = { id: state.ids.userContext(), bidi: userContext, removing: false }
      state.contexts.set(entry.id, entry)
      state.contextsByBidi.set(userContext, entry)
      // Announce before setup: any pages observed during setup must have a known parent context.
      yield* state.buffer.run(() =>
        state.buffer.emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
      )
      // Seed only this context; every failure, including interruption, attempts rollback under a fresh budget.
      yield* Kit.protocol(applyKind(state, "Viewport", { _tag: "UserContext", context: entry.id })).pipe(
        restore,
        Effect.onError(() =>
          Cleanup.report(
            Cleanup.bounded(removeUserContext(state, entry.id)),
            `BiDi context ${entry.id} initialization rollback could not confirm removal`
          )
        )
      )
      return entry.id
    })
  )
})

export const removeUserContext = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  if (context.bidi === "default") {
    return yield* Effect.fail(
      Kit.unsupported("removeDefaultContext", "The default context exists for the whole connection")
    )
  }
  // A removal under way reports the context's end
  if (context.removing) return
  context.removing = true
  return yield* Effect.gen(function*() {
    yield* Kit.protocol(state.send(BrowserBidi.removeUserContext({ userContext: context.bidi })))
    // The command closes the context's navigables before it answers, and their `contextDestroyed` events come
    // before the reply on the one connection: once they are folded, its pages have ended, so the context ends now
    yield* state.root().drainObserved
    yield* state.buffer.run(() => {
      // A successful removal confirms every page ended, even if no separate destruction event was observed.
      for (const page of [...state.navigables.values()]) {
        if (page.context === context && page.parent === undefined) {
          removeNavigable(
            state,
            page,
            new L1Target.PageClosed({ by: "userContextRemoved" }),
            "bidi:browser.removeUserContext"
          )
        }
      }
      state.contexts.delete(id)
      state.contextsByBidi.delete(context.bidi)
      state.buffer.emit({ _tag: "UserContextRemoved", context: id })
    })
  }).pipe(Effect.onError(() => Effect.sync(() => context.removing = false)))
})

export const createPage = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  // A window of its own, as Chromium's pages are (QUIRKS.md, Q70): a tab behind another renders about once a
  // second, too seldom to act on, and a window keeps rendering whichever page came last (Q71)
  const created = yield* Kit.protocol(
    state.send(BrowsingContext.create({ type: "window", userContext: context.bidi }))
  )
  // The context was announced before the reply; it is folded once this returns
  yield* state.root().drainObserved
  const navigable = state.navigables.get(created.context)
  if (navigable === undefined) {
    return yield* Effect.fail(Kit.gone({ _tag: "Browser" }, new L1Target.Vanished({})))
  }
  return navigable.id
})

export const closePage = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
    const navigable = yield* navigableById(state, id)
    if (!options.runBeforeUnload) navigable.closing = new L1Target.PageClosed({ by: "command" })
    // The reply may wait on a beforeunload prompt, which the context's end reports
    state.buffer.start(
      state.send(BrowsingContext.close({ context: navigable.bidi, promptUnload: options.runBeforeUnload }))
    )
  }
)

export const activatePage = (state: State, id: L1Target.NavigableId) =>
  navigableById(state, id).pipe(
    Effect.flatMap((navigable) => Kit.protocol(state.send(BrowsingContext.activate({ context: navigable.bidi }))))
  )

const downloadOf = (state: State, id: Download.Id) =>
  Kit.lookup(state.ids, state.downloadsById, id, () => Kit.ended({ _tag: "Download", id }))

export const downloadPath = (state: State, id: Download.Id) =>
  Effect.map(downloadOf(state, id), (download) => Option.fromUndefinedOr(download.path))

export const cancelDownload = (state: State, id: Download.Id) =>
  Effect.flatMap(
    downloadOf(state, id),
    () => Effect.fail(Kit.unsupported("downloads.cancel", "WebDriver BiDi has no command to cancel a download"))
  )
