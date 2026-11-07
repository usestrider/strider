/**
 * Frames, documents and navigations on CDP: the `Page` domain's events, and the commands that navigate.
 *
 * Outcomes are reported only on affirmative evidence (PROTOCOL.md, CDP specifics): a navigation is correlated
 * by the loader id in `Page.frameStartedNavigating` or `Page.navigate`'s reply, a command's navigation is matched
 * to the browser's by URL, first in, first out, and a same-document one by frame and order.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Page from "../../cdp/Page.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import { frameUrl, initiatedAs, isSameDocument } from "./mapping.ts"
import { type Event, frameById, frameOf, pageOf, type State } from "./state.ts"
import { addFrame, commit, endNavigation, removeFrame, startNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Page.frameAttached, (params, { state, target }) => {
      if (target === undefined || state.frames.has(params.frameId)) return
      const parent = state.frames.get(params.parentFrameId)
      if (parent === undefined) return
      const frame = addFrame(state, params.frameId, parent, target)
      commit(
        state,
        frame,
        { loaderId: `initial:${frame.frameId}`, url: "about:blank", origin: "null" },
        () => ({ _tag: "InitialBlank" }),
        undefined,
        "cdp:Page.frameAttached"
      )
    })
    .on(Page.frameDetached, (params, { state }) => {
      const frame = state.frames.get(params.frameId)
      if (frame === undefined || params.reason === "swap") return
      removeFrame(state, frame, new L1Target.FrameDetached({}), "cdp:Page.frameDetached")
    })
    .on(Page.frameStartedNavigating, (params, { state }) => {
      const frame = state.frames.get(params.frameId)
      if (frame === undefined) return
      startNavigation(
        state,
        frame,
        params.loaderId,
        params.url,
        initiatedAs(params.navigationType),
        isSameDocument(params.navigationType)
      )
    })
    .on(Page.frameNavigated, (params, { state, target }) => {
      if (target === undefined) return
      const f = params.frame
      const url = frameUrl(f)
      let frame = state.frames.get(f.id)
      if (frame === undefined) {
        const parent = frameOf(state, f.parentId)
        if (parent === undefined) return
        frame = addFrame(state, f.id, parent, target)
      }
      const errorPage = f.url.startsWith("chrome-error://")
      // The error page of a navigation that already failed: its document, not a navigation of its own, which
      // would replace one started since
      const failed = errorPage ? frame.failed.get(f.loaderId) : undefined
      frame.failed.clear()
      if (failed !== undefined) {
        commit(
          state,
          frame,
          { loaderId: f.loaderId, url, origin: f.securityOrigin },
          () => ({ _tag: "ErrorPage", navigation: failed.id }),
          failed,
          "cdp:Page.frameNavigated"
        )
        return
      }
      const restored = params.type === "BackForwardCacheRestore"
      // A restore commits under the restored document's loader id, not the traversal's
      const navigation = state.navigations.get(f.loaderId) ??
        (restored ? [...frame.navigations.values()].find((pending) => pending.traversal) : undefined) ??
        startNavigation(state, frame, f.loaderId, url, "crossDocument", false)
      const previous = state.documentsByLoader.get(f.loaderId)
      const document = commit(
        state,
        frame,
        { loaderId: f.loaderId, url, origin: f.securityOrigin },
        (navigation) =>
          restored && previous !== undefined
            ? { _tag: "Restored", navigation: navigation!.id, from: previous.id }
            : errorPage
            ? { _tag: "ErrorPage", navigation: navigation!.id }
            : { _tag: "Navigation", navigation: navigation!.id },
        navigation,
        "cdp:Page.frameNavigated"
      )
      endNavigation(
        state,
        navigation,
        errorPage
          ? { _tag: "Failed", error: navigation.failed ?? "error page", errorDocument: Option.some(document.id) }
          : restored
          ? { _tag: "Restored", document: document.id }
          : { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
        "cdp:Page.frameNavigated"
      )
    })
    .on(Page.navigatedWithinDocument, (params, { state }) => {
      const frame = state.frames.get(params.frameId)
      const document = frame?.document
      if (frame === undefined || document === undefined) return
      const via = params.navigationType === "fragment" ? "fragment" : "historyApi"
      let navigation = [...frame.navigations.values()].find((navigation) =>
        navigation.sameDocument && Kit.normalize(navigation.url) === Kit.normalize(params.url)
      )
      if (navigation === undefined) {
        navigation = startNavigation(
          state,
          frame,
          `same:${frame.frameId}:${params.url}:${Math.random()}`,
          params.url,
          via,
          true
        )
      }
      document.url = params.url
      state.buffer.emit({
        _tag: "DocumentUrlChanged",
        document: document.id,
        url: Urls.reported(params.url),
        navigation: navigation.id,
        via
      })
      endNavigation(
        state,
        navigation,
        { _tag: "SameDocument", document: document.id, via },
        "cdp:Page.navigatedWithinDocument"
      )
    })
    .on(Page.documentOpened, (params, { state }) => {
      const document = state.frames.get(params.frame.id)?.document
      if (document === undefined) return
      document.generation++
      state.buffer.emit({ _tag: "DocumentOpened", document: document.id, generation: document.generation })
    })
    .on(Page.lifecycleEvent, (params, { state }) => {
      const document = state.frames.get(params.frameId)?.document
      if (document === undefined) return
      if (document.loaderId?.startsWith("initial:") && params.name === "init") {
        state.documentsByLoader.delete(document.loaderId)
        document.loaderId = params.loaderId
        state.documentsByLoader.set(params.loaderId, document)
      }
      if (document.loaderId !== params.loaderId) return
      if (params.name === "DOMContentLoaded") {
        state.buffer.emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
      } else if (params.name === "load") {
        state.buffer.emit({ _tag: "DocumentReadiness", document: document.id, readiness: "complete" })
      }
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

// Chromium says a page isn't attached for a moment while it swaps documents, as just after a navigation commits
// (recorded 2026-10-20); a command refused for that never ran, so it is sent again as the refusal comes back, with
// no delay of ours: the browser's answers pace it. After a commit the moment is a fraction of a millisecond; a
// back/forward-cache restore's is longer (QUIRKS.md, Q6)
export const whileSwapping = <A>(effect: Effect.Effect<A, Protocol.ProtocolError>) =>
  effect.pipe(Effect.retry({
    while: (error) =>
      error.reason._tag === "Rejected" && error.reason.reason === "Unrecognized" &&
      error.reason.description === "Not attached to an active page",
    times: 10_000
  }))

export const navigate = Effect.fnUntraced(function*(
  state: State,
  navigable: L1Target.NavigableId,
  url: string,
  options: { readonly referrer: Option.Option<string> }
) {
  const frame = yield* frameById(state, navigable)
  const id = Kit.expect(state.ids, frame.expected, url)
  const reply = yield* Kit.protocol(
    Page.navigate({
      url,
      frameId: frame.frameId as Page.FrameId,
      ...(Option.isSome(options.referrer) ? { referrer: options.referrer.value } : {})
    }).pipe(Protocol.on(frame.owner.session))
  ).pipe(Effect.tapError(() => Effect.sync(() => Kit.unexpect(frame.expected, id))))
  if (reply.errorText !== undefined && reply.loaderId === undefined) {
    // A command that never started a navigation: its id ends at once, with the browser's reason
    yield* Kit.neverStarted(state.buffer, {
      drained: frame.owner.session.drainObserved,
      expectations: frame.expected,
      navigable: frame.id,
      navigation: id,
      url,
      error: reply.errorText,
      evidence: "cdp:Page.navigate"
    })
  }
  return id
})

export const reload = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: { readonly ignoreCache: boolean }) {
    const page = yield* pageOf(state, id)
    const frame = state.navigables.get(page.id)!
    const navigation = Kit.expect(state.ids, frame.expected, frame.document?.url ?? "")
    yield* Kit.protocol(
      whileSwapping(Page.reload({ ignoreCache: options.ignoreCache }).pipe(Protocol.on(page.target.session)))
    )
    return navigation
  }
)

export const traverse = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId, delta: number) {
  const page = yield* pageOf(state, id)
  const frame = state.navigables.get(page.id)!
  const history = yield* Kit.protocol(
    whileSwapping(Page.getNavigationHistory().pipe(Protocol.on(page.target.session)))
  )
  const entry = history.entries[history.currentIndex + delta]
  if (entry === undefined) return Option.none<PageNavigation.Id>()
  const navigation = Kit.expect(state.ids, frame.expected, entry.url)
  yield* Kit.protocol(
    whileSwapping(Page.navigateToHistoryEntry({ entryId: entry.id }).pipe(Protocol.on(page.target.session)))
  )
  return Option.some(navigation)
})
