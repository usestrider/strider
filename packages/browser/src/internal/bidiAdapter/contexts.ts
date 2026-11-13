/**
 * User contexts, pages and downloads on BiDi. Preload scripts and native user-context settings cover future
 * pages. A new user context receives its effective viewport default without rewriting existing contexts;
 * viewport precedence for existing pages is resolved by the declaration registry.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as BrowserBidi from "../../bidi-protocol/Browser.ts"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import * as Network from "../../bidi-protocol/Network.ts"
import type * as Download from "../../Download.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import * as Cleanup from "./cleanup.ts"
import { applyKind, recoverViewport } from "./declare.ts"
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
  let settle = (_retain: boolean): void => {}
  if (Option.isSome(options.proxy)) {
    const { server, credentials } = options.proxy.value
    if (credentials !== undefined && state.options.ownership !== "launched") {
      return yield* Effect.fail(
        Kit.unsupported(
          "userContexts.proxy.credentials",
          "Firefox proxy credentials require a freshly launched browser with an owned authentication cache"
        )
      )
    }
    const binding = state.proxyBindings.get(server)
    const previous = binding?.credentials
    if (
      binding !== undefined && (previous?.username !== credentials?.username ||
        (previous !== undefined && credentials !== undefined &&
          Redacted.value(previous.password) !== Redacted.value(credentials.password)))
    ) {
      return yield* Effect.fail(
        Kit.unsupported(
          "userContexts.proxy.credentials.isolation",
          "Firefox shares cached proxy credentials between contexts; use one credential pair per proxy endpoint for the browser's lifetime"
        )
      )
    }
    // Reserve before yielding. Each creation owns one share; another pending or successful creation
    // must survive this one's confirmed rejection or unused rollback.
    const reservation = binding ?? { credentials, pending: 0, retained: false }
    reservation.pending++
    state.proxyBindings.set(server, reservation)
    let pending = true
    settle = (retain) => {
      if (!pending) return
      pending = false
      reservation.pending--
      reservation.retained ||= retain
      if (!reservation.retained && reservation.pending === 0 && state.proxyBindings.get(server) === reservation) {
        state.proxyBindings.delete(server)
      }
    }
  }
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      // Keep ownership of a successful create reply until setup has installed its rollback path.
      const { userContext } = yield* Kit.protocol(
        state.send(BrowserBidi.createUserContext({
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
        })).pipe(Effect.onError((cause) =>
          Effect.sync(() => {
            const error = Option.getOrUndefined(Cause.findErrorOption(cause))
            // Only local encode failure or a definite pre-creation refusal proves no context exists.
            // A lost/undecodable reply, interruption or unknown remote error may follow successful creation.
            if (
              error instanceof Protocol.ProtocolError &&
              (error.reason._tag === "Encode" || error.reason._tag === "Unsupported" ||
                (error.reason._tag === "Rejected" && error.reason.reason === "InvalidArgument"))
            ) settle(false)
          })
        ))
      )
      const entry: ContextEntry = {
        ...(options.requestTiming ? { requestTiming: true } : {}),
        ...(options.requestSizes ? { requestSizes: true } : {}),
        id: state.ids.userContext(),
        bidi: userContext,
        removing: false,
        proxyUsed: state.contextsByBidi.get(userContext)?.proxyUsed ?? false,
        proxy: Option.getOrUndefined(options.proxy)
      }
      state.contexts.set(entry.id, entry)
      state.contextsByBidi.set(userContext, entry)
      // Announce before setup: any pages observed during setup must have a known parent context.
      yield* state.buffer.run(() =>
        state.buffer.emit({
          _tag: "UserContextAdded",
          context: entry.id,
          isDefault: false,
          ...(options.requestTiming ? { requestTiming: true } : {}),
          ...(options.requestSizes ? { requestSizes: true } : {})
        })
      )
      // Seed only this context; every failure, including interruption, attempts rollback under a fresh budget.
      yield* Effect.gen(function*() {
        if (entry.proxy?.credentials !== undefined) {
          const { intercept } = yield* Kit.protocol(
            state.send(Network.addIntercept({ phases: ["authRequired"] }))
          )
          entry.proxyIntercept = intercept
          entry.proxyAttempts = new Set()
        }
        yield* Kit.protocol(applyKind(state, "Viewport", { _tag: "UserContext", context: entry.id }))
      }).pipe(
        restore,
        Effect.onError(() =>
          Cleanup.report(
            Cleanup.bounded(removeUserContext(state, entry.id)).pipe(Effect.tap(() =>
              Effect.sync(() => {
                settle(entry.proxyUsed === true || state.contexts.has(entry.id))
              })
            )),
            `BiDi context ${entry.id} initialization rollback could not confirm removal`
          )
        )
      )
      settle(true)
      return entry.id
    })
  ).pipe(Effect.onError(() => Effect.sync(() => settle(true))))
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
    context.proxyAttempts?.clear()
    context.proxy = undefined
    if (context.proxyIntercept !== undefined) {
      yield* Cleanup.report(
        Cleanup.bounded(Kit.protocol(state.send(Network.removeIntercept({ intercept: context.proxyIntercept })))),
        "Proxy authentication interceptor removal could not be confirmed"
      )
      context.proxyIntercept = undefined
    }
    yield* state.buffer.run(() => {
      // A successful removal confirms every page ended, even if no separate destruction event was observed.
      for (const page of Array.from(state.navigables.values())) {
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
  }).pipe(Effect.onError((cause) =>
    Effect.gen(function*() {
      context.removing = false
      if (Option.exists(Cause.findErrorOption(cause), Cleanup.sessionEnded)) return
      if (state.contexts.get(id) === context) {
        yield* recoverViewport(state, { _tag: "UserContext", context: id })
      }
    })
  ))
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
    const closing = options.runBeforeUnload ? undefined : new L1Target.PageClosed({ by: "command" })
    if (closing !== undefined) navigable.closing = closing
    // The reply may wait on a beforeunload prompt, which the context's end reports
    state.buffer.start(
      state.send(BrowsingContext.close({ context: navigable.bidi, promptUnload: options.runBeforeUnload })).pipe(
        Effect.onError((cause) =>
          Effect.gen(function*() {
            if (navigable.closing !== closing) return
            navigable.closing = undefined
            if (Option.exists(Cause.findErrorOption(cause), Cleanup.sessionEnded)) return
            if (!navigable.removed) yield* recoverViewport(state, { _tag: "Page", page: navigable.id })
          })
        )
      )
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
