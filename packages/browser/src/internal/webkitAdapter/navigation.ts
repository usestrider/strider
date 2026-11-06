/**
 * Frames and navigations on stock WebKit. Its inspector has no navigate command: attached, a navigation goes by
 * script; launched, a page's goes through Automation (`automation.ts`). Either way, its events report it as any.
 *
 * - **Readiness.** WebKit can report a document's `load` before its `DOMContentLoaded`; a document is reported
 *   interactive, then complete, whichever arrives first. A complete document that loads again was reopened
 *   (`document.open()`), which WebKit reports no other way, so it starts a new generation.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as Page from "../../webkit-stock-protocol/Page.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Kit from "../adapterKit.ts"
import { realmFor } from "./evaluation.ts"
import { beforeNavigation } from "./network.ts"
import { type Event, frameById, frameKey, loaderKey, pageOf, realmOf, type State, targetOf } from "./state.ts"
import { addFrame, commit, endNavigation, errorPage, removeFrame, startNavigation, withoutFragment } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Page.frameDetached, (params, { state, target }) => {
      if (target === undefined) return
      const frame = state.frames.get(frameKey(target, params.frameId))
      if (frame === undefined || frame.parent === undefined) return
      removeFrame(state, frame, new L1Target.FrameDetached({}), "webkit:Page.frameDetached")
    })
    .on(Page.frameNavigated, (params, { state, target }) => {
      if (target === undefined) return
      const f = params.frame
      const key = frameKey(target, f.id)
      const loader = loaderKey(target, f.loaderId)
      let frame = state.frames.get(key)
      if (frame === undefined) {
        const parent = f.parentId === undefined ? undefined : state.frames.get(frameKey(target, f.parentId))
        if (parent === undefined) return
        frame = addFrame(state, key, parent)
      }
      const failed = state.navigations.has(loader) ? undefined : errorPage(state, frame, loader, f.url)
      if (failed !== undefined) {
        commit(
          state,
          frame,
          { loaderId: loader, url: f.url, origin: f.securityOrigin },
          { _tag: "ErrorPage", navigation: failed },
          "webkit:Page.frameNavigated"
        )
        return
      }
      const navigation = state.navigations.get(loader) ??
        startNavigation(state, frame, loader, f.url, "crossDocument", false)
      const document = commit(
        state,
        frame,
        { loaderId: loader, url: f.url, origin: f.securityOrigin },
        { _tag: "Navigation", navigation: navigation.id },
        "webkit:Page.frameNavigated"
      )
      endNavigation(
        state,
        navigation,
        { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
        "webkit:Page.frameNavigated"
      )
    })
    .on(Page.domContentEventFired, (_, { state, target }) => {
      // Stock WebKit names no frame: its load events are the page's (QUIRKS.md, Q201)
      const document = state.frames.get(target?.mainFrameId ?? "")?.document
      if (document === undefined || document.interactive) return
      document.interactive = true
      state.buffer.emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
    })
    .on(Page.loadEventFired, (_, { state, target }) => {
      const document = state.frames.get(target?.mainFrameId ?? "")?.document
      if (document === undefined) return
      if (document.complete) {
        // A document that loads again was opened again: `document.open()` shows only this (probe 17)
        document.generation++
        document.interactive = false
        state.buffer.emit({ _tag: "DocumentOpened", document: document.id, generation: document.generation })
      }
      // WebKit can report load first: the document was interactive before it was complete
      if (!document.interactive) {
        document.interactive = true
        state.buffer.emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
      }
      document.complete = true
      state.buffer.emit({ _tag: "DocumentReadiness", document: document.id, readiness: "complete" })
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

export const reload = Effect.fnUntraced(function*(
  state: State,
  id: L1Target.NavigableId,
  options: { readonly ignoreCache: boolean }
) {
  const page = yield* pageOf(state, id)
  yield* beforeNavigation(state, page)
  const target = yield* targetOf(page)
  const navigation = Kit.expect(state.ids, page.main.expected, page.main.document?.url ?? "", "reload")
  yield* Kit.protocol(Page.reload({ ignoreCache: options.ignoreCache }).pipe(Protocol.on(target.session))).pipe(
    Effect.tapError(() => Effect.sync(() => Kit.unexpect(page.main.expected, navigation)))
  )
  return navigation
})

/** No navigate command: the frame's document goes by script, and its events report the navigation as any. */
export const navigateByScript = Effect.fnUntraced(function*(
  state: State,
  navigable: L1Target.NavigableId,
  url: string,
  options: { readonly referrer: Option.Option<string> }
) {
  if (Option.isSome(options.referrer)) {
    return yield* Effect.fail(
      Kit.unsupported("navigation.referrer", "stock WebKit navigates by script, with the document's own referrer")
    )
  }
  const frame = yield* frameById(state, navigable)
  // The page's document is known once its first snapshot is in
  yield* Deferred.await(frame.page.ready)
  yield* beforeNavigation(state, frame.page)
  if (frame.document === undefined) {
    return yield* Effect.fail(Kit.gone({ _tag: "Frame", id: navigable }, new L1Target.DocumentReplaced({})))
  }
  // A fragment of the document it shows: a navigation stock WebKit wouldn't report, so none would be seen to end
  // (QUIRKS.md, Q200)
  if (url.includes("#") && withoutFragment(url) === withoutFragment(frame.document.url)) {
    return yield* Effect.fail(
      Kit.unsupported("navigation.sameDocument", "stock WebKit's inspector reports no same-document navigation")
    )
  }
  // A main frame's script runs in whatever document it shows, so a document the browser replaced meanwhile,
  // such as with an error page, doesn't fail it; a child frame's runs in its document's realm
  const where = frame.parent === undefined
    ? { session: (yield* targetOf(frame.page)).session, contextId: undefined }
    : yield* Effect.flatMap(realmFor(state, frame.document.id, { _tag: "Main" }), (id) => realmOf(state, id))
  const id = Kit.expect(state.ids, frame.expected, url)
  yield* Kit.protocol(
    Runtime.evaluate({
      expression: `location.href = ${JSON.stringify(url)}; 0`,
      doNotPauseOnExceptionsAndMuteConsole: true,
      ...(where.contextId === undefined ? {} : { contextId: where.contextId as Runtime.ExecutionContextId })
    }).pipe(Protocol.on(where.session))
  ).pipe(Effect.tapError(() => Effect.sync(() => Kit.unexpect(frame.expected, id))))
  return id
})
