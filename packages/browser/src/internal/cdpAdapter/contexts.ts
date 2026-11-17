/**
 * Contexts, pages and downloads on CDP: `Target.createBrowserContext` (with `disposeOnDetach`),
 * `Target.createTarget`, which waits for the page's gate, `Target.closeTarget` or `Page.close` (to run
 * `beforeunload`), and the `Browser` domain's downloads.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
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
import { applyDownloads, restoreContext } from "./declare.ts"
import { whileSwapping } from "./navigation.ts"
import {
  ContextEntry,
  contextLock,
  contextOf,
  downloadDirectory,
  type DownloadEntry,
  type Event,
  forgetRetiredFrames,
  frameOf,
  keepEndedFramesIfDeclared,
  pageNow,
  pageOf,
  type State
} from "./state.ts"
import { endNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(BrowserCdp.downloadWillBegin, (params, { state }) => {
      const frame = frameOf(state, params.frameId)
      // A frame that has ended still names its context, which the download's end is waited for by
      const context = frame?.page.context ?? state.retiredFrames.get(params.frameId)
      const download: DownloadEntry = {
        id: state.ids.download(),
        guid: params.guid,
        directory: context === undefined ? Option.none() : downloadDirectory(state, context.id),
        context,
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
  const certificateProxy = Option.getOrUndefined(options.certificateProxy ?? Option.none())
  if ((options.acceptInsecureCerts || certificateProxy !== undefined) && options.reclaimable) {
    return yield* Effect.fail(
      Kit.unsupported(
        certificateProxy === undefined ? "acceptInsecureCerts" : "clientCertificates",
        "Each page's certificate override ends with the connection, which a reclaimable context outlives"
      )
    )
  }
  const { browserContextId } = yield* Kit.protocol(
    Target.createBrowserContext({
      disposeOnDetach: !options.reclaimable,
      ...(Option.isSome(options.proxy)
        ? { proxyServer: options.proxy.value.server, proxyBypassList: options.proxy.value.bypass.join(",") }
        : certificateProxy !== undefined
        // HTTPS and WebSocket over TLS only, loopback included, so local sites get the certificate too
        ? { proxyServer: `https=127.0.0.1:${certificateProxy}`, proxyBypassList: "<-loopback>" }
        : {})
    }).pipe(Protocol.on(state.root()))
  )
  const entry = new ContextEntry(state.ids.userContext(), browserContextId, false)
  if (options.focusEmulated) entry.focusEmulated = true
  if (options.acceptInsecureCerts || certificateProxy !== undefined) entry.ignoreCertificateErrors = true
  if (options.requestSizes) entry.requestSizes = new Map()
  if (options.requestTiming) entry.requestTiming = new Map()
  entry.proxy = Option.getOrUndefined(options.proxy)
  state.contexts.set(entry.id, entry)
  state.contextsByCdp.set(browserContextId, entry)
  keepEndedFramesIfDeclared(state, entry)
  yield* state.buffer.run(() =>
    state.buffer.emit({
      _tag: "UserContextAdded",
      context: entry.id,
      isDefault: false,
      ...(options.requestTiming ? { requestTiming: true } : {}),
      ...(options.requestSizes ? { requestSizes: true } : {})
    })
  )
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
  const browserContextId = context.browserContextId
  const removal = contextLock(context).withPermits(1)(Effect.gen(function*() {
    // A successful disposal is final even while page-session shutdown is still pending.
    if (context.disposed) return
    context.removing = true
    const inContext = [...state.pages.values()].filter((page) => page.context === context)
    const behavior = state.registry.downloads(context.id)
    // A retiring context's downloads declaration is released before this, but Chromium keeps its behavior until the
    // disposal
    const allowed = context.keepsEndedFrames === true || (Option.isSome(behavior) && behavior.value._tag === "Allow")
    yield* Effect.gen(function*() {
      // While the context has pages or frames that ended, Chromium can still start a download in it, during the
      // disposal too; denied, none starts. A refused disposal applies the declarations' behavior again
      if (allowed && (inContext.length > 0 || (context.retiredFrames?.size ?? 0) > 0)) {
        yield* Kit.protocol(
          BrowserCdp.setDownloadBehavior({
            behavior: "deny",
            browserContextId: browserContextId as BrowserCdp.BrowserContextID,
            eventsEnabled: true
          }).pipe(Protocol.on(state.root()))
        )
      }
      yield* Kit.protocol(
        Target.disposeBrowserContext({ browserContextId: browserContextId as BrowserCdp.BrowserContextID }).pipe(
          Protocol.on(state.root())
        )
      )
    }).pipe(Effect.onExit((exit) =>
      Effect.sync(() => {
        if (Exit.isFailure(exit)) context.removing = false
      })
    ))
    context.disposed = true
    context.requestSizes?.clear()
    // Chromium may answer before its pages' sessions end, and before it cancels the context's downloads, which it
    // reports after the reply, a download that was completing having moved its file into the context's directory
    // meanwhile. The context ends after both. Its pages' sessions end with the connection at the latest; a download
    // Chromium never reports ended keeps this wait until the connection's scope closes. L1 waits for the context's
    // end under a budget of its own (`Model.remove`), which also ends when the connection is lost
    state.buffer.start(Effect.gen(function*() {
      let downloads: Array<DownloadEntry> = []
      yield* state.buffer.run(() => {
        downloads = [...state.downloads.values()].filter((download) => download.context === context && !download.ended)
      })
      yield* Effect.all([
        Effect.forEach(inContext, (page) => page.target.session.ended, { discard: true }),
        state.buffer.waitFor(() => downloads.every((download) => download.ended) ? true : undefined)
      ], { concurrency: "unbounded", discard: true })
      context.proxy = undefined
      forgetRetiredFrames(state, context)
      state.contexts.delete(id)
      state.contextsByCdp.delete(browserContextId)
      yield* state.buffer.run(() => state.buffer.emit({ _tag: "UserContextRemoved", context: id }))
    }))
  }))
  // A removal the browser refused leaves the context in place: what its declarations' releases left alone because
  // this removal was to follow is applied again: its download behavior (no declaration in force says "default"),
  // its interception and its file chooser dialog
  yield* removal.pipe(
    Effect.onError(() =>
      // Independent resets: one that fails doesn't skip the others
      Effect.all([applyDownloads(state, context).pipe(Effect.ignore), restoreContext(state, context)], {
        discard: true
      })
    )
  )
})

export const createPage = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  // Where focus is emulated for the context's life, every page reports it, so a tab behind another still renders.
  // A declaration that can be released or overridden later doesn't last as long as the tab, so it doesn't decide.
  const { targetId } = yield* Kit.protocol(
    Target.createTarget({
      url: "about:blank",
      // Otherwise a window of its own, so a page opened after it doesn't put it in the background, where headless
      // Chromium renders nothing
      ...(context.focusEmulated ? {} : { newWindow: true }),
      ...(context.isDefault || context.browserContextId === undefined
        ? {}
        : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID })
    }).pipe(Protocol.on(state.root()))
  )
  // The target attached before the reply; its attach is folded once this returns
  yield* state.root().drainObserved
  const page = state.targetsById.get(targetId)?.page
  if (page === undefined) {
    return yield* Effect.fail(Kit.gone({ _tag: "Browser" }, new L1Target.Vanished({})))
  }
  yield* Deferred.await(page.ready)
  return page.id
})

export const closePage = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
    // A close that runs `beforeunload` can open a prompt, an event the page's initial sync would hold while Chromium
    // withholds the frame tree, so it waits for the sync. A forced close causes nothing the model needs, and must
    // not wait on a sync a paused request or an open prompt holds up.
    const page = yield* (options.runBeforeUnload ? pageOf : pageNow)(state, id)
    if (options.runBeforeUnload) {
      page.closeRequested = true
      yield* Kit.protocol(whileSwapping(Page.close().pipe(Protocol.on(page.target.session)))).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            page.closeRequested = false
          })
        )
      )
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
