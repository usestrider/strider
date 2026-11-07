/**
 * Contexts, pages and downloads on CDP: `Target.createBrowserContext` (with `disposeOnDetach`),
 * `Target.createTarget`, which waits for the page's gate, `Target.closeTarget` or `Page.close` (to run
 * `beforeunload`), and the `Browser` domain's downloads.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowserCdp from "../../cdp/Browser.ts"
import * as Page from "../../cdp/Page.ts"
import * as Target from "../../cdp/Target.ts"
import type * as Download from "../../Download.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import { applyDownloads } from "./declare.ts"
import { whileSwapping } from "./navigation.ts"
import {
  type ContextEntry,
  contextOf,
  downloadDirectory,
  type DownloadEntry,
  type Event,
  frameOf,
  pageOf,
  type State
} from "./state.ts"
import { endNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(BrowserCdp.downloadWillBegin, (params, { state }) => {
      const frame = frameOf(state, params.frameId)
      const download: DownloadEntry = {
        id: state.ids.download(),
        guid: params.guid,
        directory: frame === undefined ? Option.none() : downloadDirectory(state, frame.page.context.id),
        context: frame?.page.context,
        ended: false
      }
      state.downloads.set(params.guid, download)
      state.downloadsById.set(download.id, download)
      if (frame === undefined) return
      state.buffer.emit({
        _tag: "DownloadStarted",
        download: download.id,
        page: frame.page.id,
        url: Urls.reported(params.url),
        suggestedFilename: params.suggestedFilename
      })
      // A navigation in flight on that frame, to that URL, became this download
      for (const navigation of frame.navigations.values()) {
        if (!navigation.sameDocument && Kit.normalize(navigation.url) === Kit.normalize(params.url)) {
          endNavigation(
            state,
            navigation,
            { _tag: "Download", download: Option.some(download.id) },
            "cdp:Browser.downloadWillBegin"
          )
        }
      }
    })
    .on(BrowserCdp.downloadProgress, (params, { state }) => {
      const download = state.downloads.get(params.guid)
      if (download === undefined || download.ended) return
      if (params.state === "inProgress") {
        state.buffer.emit({
          _tag: "DownloadProgress",
          download: download.id,
          receivedBytes: params.receivedBytes,
          totalBytes: params.totalBytes > 0 ? Option.some(params.totalBytes) : Option.none()
        })
        return
      }
      download.ended = true
      state.buffer.emit({
        _tag: "DownloadEnded",
        download: download.id,
        outcome: params.state === "completed"
          ? {
            _tag: "Completed",
            path: Option.fromUndefinedOr(params.filePath).pipe(
              Option.orElse(() => Option.map(download.directory, (directory) => `${directory}/${download.guid}`))
            )
          }
          : { _tag: "Canceled" }
      })
    })

// ── Contexts and pages ────────────────────────────────────────────────────────────────────────────────────

export const createUserContext = Effect.fnUntraced(function*(state: State, options: Adapter.UserContextOptions) {
  if (options.acceptInsecureCerts) {
    return yield* Effect.fail(
      Kit.unsupported("acceptInsecureCerts", "CDP ignores certificate errors browser-wide, not per context")
    )
  }
  const { browserContextId } = yield* Kit.protocol(
    Target.createBrowserContext({
      disposeOnDetach: !options.reclaimable,
      ...(Option.isSome(options.proxy)
        ? { proxyServer: options.proxy.value.server, proxyBypassList: options.proxy.value.bypass.join(",") }
        : {})
    }).pipe(Protocol.on(state.root()))
  )
  const entry: ContextEntry = { id: state.ids.userContext(), browserContextId, isDefault: false, removing: false }
  state.contexts.set(entry.id, entry)
  state.contextsByCdp.set(browserContextId, entry)
  yield* state.buffer.run(() => state.buffer.emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false }))
  yield* Kit.protocol(applyDownloads(state, entry))
  return entry.id
})

export const removeUserContext = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  if (context.isDefault || context.browserContextId === undefined) {
    return yield* Effect.fail(
      Kit.unsupported("removeDefaultContext", "The default context exists for the whole connection")
    )
  }
  // A removal under way reports the context's end
  if (context.removing) return
  context.removing = true
  const inContext = [...state.pages.values()].filter((page) => page.context === context)
  const browserContextId = context.browserContextId
  yield* Kit.protocol(
    Target.disposeBrowserContext({ browserContextId: browserContextId as BrowserCdp.BrowserContextID }).pipe(
      Protocol.on(state.root())
    )
  ).pipe(Effect.tapError(() => Effect.sync(() => context.removing = false)))
  // Chromium may answer before its pages' sessions end. The context ends after they have, which L1 waits for under
  // a budget of its own (`Model.remove`); they end with the connection at the latest
  state.buffer.start(Effect.gen(function*() {
    yield* Effect.forEach(inContext, (page) => page.target.session.ended, { discard: true })
    state.contexts.delete(id)
    state.contextsByCdp.delete(browserContextId)
    yield* state.buffer.run(() => state.buffer.emit({ _tag: "UserContextRemoved", context: id }))
  }))
})

export const createPage = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  const { targetId } = yield* Kit.protocol(
    Target.createTarget({
      url: "about:blank",
      // A window of its own, so a page opened after it doesn't put it in the background, where headless Chromium
      // renders nothing
      newWindow: true,
      ...(context.isDefault || context.browserContextId === undefined
        ? {}
        : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID })
    }).pipe(Protocol.on(state.root()))
  )
  // A tab child can attach after the root reply; its correlated page and Ready gate must both arrive
  yield* state.root().drainObserved
  const page = yield* state.buffer.waitFor(() => state.targetsById.get(targetId)?.page)
  yield* Deferred.await(page.ready)
  return page.id
})

export const closePage = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
    const page = yield* pageOf(state, id)
    if (options.runBeforeUnload) {
      yield* Kit.protocol(whileSwapping(Page.close().pipe(Protocol.on(page.target.session))))
      return
    }
    // Chromium answers a close sent while the page swaps documents, then drops it (QUIRKS.md, Q149). A page command
    // it accepts says the swap is over; this one is the browser's, so it is answered with a dialog open or the
    // page's script stuck
    yield* Kit.protocol(whileSwapping(Page.getNavigationHistory().pipe(Protocol.on(page.target.session))))
    page.closing = new L1Target.PageClosed({ by: "command" })
    yield* Kit.protocol(
      Target.closeTarget({ targetId: page.targetId as Target.TargetID }).pipe(Protocol.on(state.root()))
    )
  }
)

export const activatePage = (state: State, id: L1Target.NavigableId) =>
  pageOf(state, id).pipe(
    Effect.flatMap((page) => Kit.protocol(Page.bringToFront().pipe(Protocol.on(page.target.session))))
  )

// ── Downloads ─────────────────────────────────────────────────────────────────────────────────────────────

const downloadOf = (state: State, id: Download.Id) =>
  Kit.lookup(state.ids, state.downloadsById, id, () => Kit.ended({ _tag: "Download", id }))

export const downloadPath = (state: State, id: Download.Id) =>
  Effect.map(
    downloadOf(state, id),
    (download) => Option.map(download.directory, (directory) => `${directory}/${download.guid}`)
  )

export const cancelDownload = (state: State, id: Download.Id) =>
  Effect.flatMap(downloadOf(state, id), (download) =>
    download.ended
      ? Effect.void
      : Kit.protocol(
        BrowserCdp.cancelDownload({
          guid: download.guid,
          ...(download.context?.browserContextId === undefined
            ? {}
            : { browserContextId: download.context.browserContextId as BrowserCdp.BrowserContextID })
        }).pipe(Protocol.on(state.root()))
      ))
