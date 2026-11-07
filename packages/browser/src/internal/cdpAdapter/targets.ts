/**
 * Targets on CDP: what attaches and ends, and the gate each one runs while paused.
 *
 * - **Attaching.** The browser session auto-attaches pages, service workers and shared workers; each page's
 *   session auto-attaches its out-of-process frames and its workers. A launched browser pauses every new page
 *   before its scripts run; an attached one pauses only frames and workers of pages it attached to, so a user's
 *   tab is never paused (probe 22).
 * - **The gate** runs while a target is paused: enable `Page`, `Network` and lifecycle events, take the frame tree
 *   (the snapshot the session is synced with), enable `Runtime`, auto-attach the target's own frames and workers,
 *   apply the declarations in force, and resume, in a finalizer. It never waits on another target: a paused popup
 *   blocks its opener.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Debugger from "../../cdp/Debugger.ts"
import * as Inspector from "../../cdp/Inspector.ts"
import * as Network from "../../cdp/Network.ts"
import * as Page from "../../cdp/Page.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import * as Target from "../../cdp/Target.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Urls from "../urls.ts"
import { configureTarget, initializePrerender } from "./declare.ts"
import { frameUrl, targetKind } from "./mapping.ts"
import { release as releaseResponse } from "./responses.ts"
import { type Event, type FrameEntry, type PageEntry, placement, type State, type TargetEntry } from "./state.ts"
import {
  addFrame,
  commit,
  contextFor,
  endNavigation,
  endPage,
  newFrame,
  removeFrame,
  removeRealm,
  startNavigation
} from "./tree.ts"

// ── Attaching and ending ──────────────────────────────────────────────────────────────────────────────────

const newTarget = (
  kind: TargetEntry["kind"],
  info: Target.TargetInfo,
  session: ProtocolClient.Session,
  page: PageEntry | undefined,
  frame: FrameEntry | undefined
): TargetEntry => ({
  kind,
  targetId: info.targetId,
  session,
  page,
  frame,
  url: info.url,
  realm: undefined,
  intercepts: "",
  scripts: new Map(),
  ended: false
})

const attached = (state: State, parent: TargetEntry | undefined, params: Target.AttachedToTargetParams) => {
  const session = state.control.session(params.sessionId as string as Protocol.SessionKey)
  if (session === undefined) return
  const info = params.targetInfo
  const kind = targetKind(info.type)
  const parentPage = parent?.page
  switch (kind) {
    case "tab": {
      const entry = newTarget(kind, info, session, undefined, undefined)
      entry.adopted = state.attachedAtConnect
      state.targets.set(session, entry)
      state.targetsById.set(info.targetId, entry)
      state.control.sync(
        session,
        Target.setAutoAttach({
          autoAttach: true,
          waitForDebuggerOnStart: state.options.ownership === "launched",
          flatten: true,
          filter: [{ type: "page" }, { exclude: true }]
        }).pipe(
          Protocol.on(session),
          Effect.ensuring(resume(session, params.waitingForDebugger)),
          Effect.as({ through: 0, apply: Effect.void })
        )
      )
      return
    }
    case "page": {
      const adopted = parent?.kind === "tab" ? parent.adopted === true : state.attachedAtConnect
      const context = contextFor(state, info.browserContextId)
      const opener = info.openerId === undefined ? undefined : state.targetsById.get(info.openerId)?.page
      const target = newTarget(kind, info, session, undefined, undefined)
      const page: PageEntry = {
        id: state.ids.navigable(),
        targetId: info.targetId,
        context,
        target,
        ready: Deferred.makeUnsafe(),
        closing: undefined,
        ended: false
      }
      const entry: TargetEntry = {
        ...target,
        page,
        tab: parent?.kind === "tab" ? parent : undefined,
        prerender: parent?.kind === "tab" && info.subtype === "prerender"
      }
      page.target = entry
      if (entry.tab !== undefined && !entry.prerender) entry.tab.tabPage = page
      state.targets.set(session, entry)
      state.targetsById.set(info.targetId, entry)
      state.pages.set(page.id, page)
      // The main frame's id is the target's
      const main = newFrame({ frameId: info.targetId, id: page.id, page, parent: undefined, owner: entry })
      state.frames.set(info.targetId, main)
      state.navigables.set(page.id, main)
      const openerId = Option.fromUndefinedOr(opener?.id)
      state.buffer.emit({
        _tag: "PageAdded",
        page: page.id,
        context: context.id,
        kind: entry.prerender ? "prerender" : info.openerId === undefined ? "tab" : "popup",
        prerenderOf: entry.prerender ? entry.tab?.tabPage?.id : undefined,
        origin: adopted
          ? { _tag: "Adopted", opener: openerId }
          : info.openerId === undefined
          ? { _tag: "Created" }
          : { _tag: "Opened", opener: openerId },
        url: Urls.reported(info.url)
      })
      if (entry.prerender) {
        entry.initialized = Deferred.makeUnsafe()
        const initialize = initializePrerender(state, entry, page, entry.tab?.tabPage?.target.viewport).pipe(
          Effect.andThen(Page.getFrameTree().pipe(Protocol.on(session))),
          Effect.flatMap(({ frameTree }) =>
            session.drainObserved.pipe(Effect.andThen(state.buffer.run(() => {
              if (entry.ended) return
              installTree(state, entry, frameTree, false)
              state.buffer.emit({ _tag: "PageReady", page: page.id })
              Deferred.doneUnsafe(page.ready, Effect.void)
            })))
          ),
          Effect.catch((error) =>
            state.buffer.run(() => {
              state.buffer.emit({ _tag: "PageInitializationFailed", page: page.id, description: error.message })
              endPage(state, page, new L1Target.ModelUnavailable({}), "cdp: prerender declaration setup failed")
              Deferred.doneUnsafe(
                page.ready,
                Effect.fail(error._tag === "AdapterError" ? error : Kit.protocolError(error))
              )
            })
          ),
          Effect.ensuring(resume(session, params.waitingForDebugger)),
          Effect.ensuring(Deferred.succeed(entry.initialized, undefined))
        )
        state.control.sync(
          session,
          Effect.succeed({ through: 0, apply: Effect.sync(() => state.buffer.start(initialize)) })
        )
      } else {
        // A tab's startup hold can reach its initial child even when that child's event reports false.
        state.control.sync(
          session,
          gate(state, entry, page, params.waitingForDebugger || entry.tab !== undefined, adopted)
        )
      }
      return
    }
    case "iframe": {
      const frame = state.frames.get(info.targetId)
      const target = newTarget(kind, info, session, frame?.page ?? parentPage, frame)
      state.targets.set(session, target)
      state.targetsById.set(info.targetId, target)
      if (frame !== undefined) frame.owner = target
      state.control.sync(session, gate(state, target, target.page, params.waitingForDebugger, false))
      return
    }
    case "worker":
    case "service_worker":
    case "shared_worker": {
      const target = newTarget(kind, info, session, kind === "worker" ? parentPage : undefined, undefined)
      state.targets.set(session, target)
      state.targetsById.set(info.targetId, target)
      const context = info.browserContextId === undefined
        ? undefined
        : state.contextsByCdp.get(info.browserContextId)
      if (context !== undefined) state.workerContexts.set(target, context)
      state.control.sync(session, workerGate(state, target, params.waitingForDebugger))
      return
    }
    case "other": {
      state.targets.set(session, newTarget(kind, info, session, undefined, undefined))
      state.control.sync(
        session,
        resume(session, params.waitingForDebugger).pipe(
          Effect.as({ through: 0, apply: Effect.void } satisfies ProtocolClient.Synced)
        )
      )
      return
    }
  }
}

/** Promotes only a known speculative child of this tab; native identity alone never closes the tab. */
const activatePrerender = (state: State, tab: TargetEntry, target: TargetEntry) => {
  const page = tab.tabPage
  const speculative = target.page
  if (
    page === undefined || speculative === undefined || speculative === page || page.ended || speculative.ended ||
    target.ended
  ) return
  const incoming = state.frames.get(target.targetId)
  const outgoing = state.frames.get(page.targetId)
  const document = incoming?.document
  if (incoming === undefined || outgoing === undefined || document === undefined) return
  const navigation = [...outgoing.navigations.values()].findLast((navigation) =>
    !navigation.ended && navigation.url === document.url
  )
  for (const child of Array.from(outgoing.children)) {
    removeFrame(state, child, new L1Target.FrameDetached({}), "cdp: prerender replaced the active document")
  }
  const replaced = outgoing.document
  if (replaced !== undefined) {
    for (const realm of replaced.realms) removeRealm(state, realm, new L1Target.DocumentReplaced({}))
    state.documents.delete(replaced.id)
    if (replaced.loaderId !== undefined && state.documentsByLoader.get(replaced.loaderId) === replaced) {
      state.documentsByLoader.delete(replaced.loaderId)
    }
  }
  state.frames.delete(outgoing.frameId)
  state.navigables.delete(speculative.id)
  outgoing.removed = true
  incoming.id = page.id
  const move = (frame: FrameEntry) => {
    frame.page = page
    if (frame.owner.page === speculative) frame.owner.page = page
    for (const child of frame.children) move(child)
  }
  move(incoming)
  state.navigables.set(page.id, incoming)
  page.targetId = target.targetId
  page.target = target
  target.page = page
  target.prerender = false
  speculative.ended = true
  state.endedPages.set(speculative.id, new L1Target.PrerenderActivated({}))
  state.pages.delete(speculative.id)
  state.heldButtons.delete(speculative.id)
  state.drags.delete(speculative.id)
  for (const each of state.targets.values()) if (each.page === speculative) each.page = page
  state.buffer.emit({
    _tag: "PrerenderActivated",
    page: page.id,
    prerender: speculative.id,
    document: document.id,
    replaced: Option.fromUndefinedOr(replaced?.id)
  })
  const activated = navigation ??
    startNavigation(state, incoming, `activation:${document.loaderId}`, document.url, "prerenderActivation", false)
  state.buffer.emit({
    _tag: "NavigationStarted",
    navigation: activated.id,
    navigable: page.id,
    url: Urls.reported(document.url),
    initiatedAs: "prerenderActivation"
  })
  page.lastActivation = activated.id
  endNavigation(
    state,
    activated,
    { _tag: "Activated", document: document.id },
    "cdp: known tab child lost prerender subtype"
  )
}

/** Retires native-session resources; a tab parent owns the public tab lifetime across primary-child replacement. */
export const ended = (state: State, session: ProtocolClient.Session, reason: Protocol.SessionEnded) => {
  const target = state.targets.get(session)
  if (target === undefined || target.ended) return
  target.ended = true
  for (const [key, pending] of state.pendingAttribution) {
    if (pending.target === target) state.pendingAttribution.delete(key)
  }
  for (const [key, request] of state.requests) {
    if (request.target !== target) continue
    const why = "The request's browser session ended"
    if (Deferred.doneUnsafe(request.finished, Effect.fail(why))) {
      releaseResponse(state, request)
      state.buffer.emit({ _tag: "RequestUnavailable", hop: request.hop, why, at: Adapter.now() })
      state.retire(key)
    }
  }
  for (const [id, obligation] of state.obligations) {
    if (obligation.target !== target) continue
    state.obligations.delete(id)
    state.buffer.emit({
      _tag: "ObligationEnded",
      obligation: id,
      reason: "targetGone",
      evidence: "cdp: native session ended"
    })
  }
  for (const [key, connection] of state.connections) {
    if (!key.startsWith(`${target.session.key ?? ""}|`)) continue
    state.connections.delete(key)
    state.buffer.emit({ _tag: "ConnectionClosed", connection })
  }
  state.targets.delete(session)
  if (state.targetsById.get(target.targetId) === target) state.targetsById.delete(target.targetId)
  state.workerContexts.delete(target)
  for (const realm of Array.from(state.realms.values())) {
    if (realm.target === target) {
      removeRealm(state, realm, reason.why === "connectionLost" ? Kit.closed() : new L1Target.RealmDestroyed({}))
    }
  }
  switch (target.kind) {
    case "tab": {
      if (target.tabPage !== undefined) {
        endPage(
          state,
          target.tabPage,
          reason.why === "connectionLost"
            ? Kit.closed()
            : target.tabPage.closing ??
              new L1Target.PageClosed({ by: target.tabPage.context.removing ? "userContextRemoved" : "script" }),
          "cdp: native tab ended"
        )
      }
      return
    }
    case "page": {
      // Promotion detaches the old primary child before announcing the promoted child on the same tab.
      // The native tab's end, rather than this child transport, owns the public tab's lifetime.
      if (target.tab !== undefined && !target.prerender && !target.tab.ended && reason.why === "detached") return
      const page = target.page!
      const why: L1Target.CloseReason = reason.why === "connectionLost"
        ? Kit.closed()
        : reason.why === "modelUnavailable"
        ? new L1Target.ModelUnavailable({})
        : page.closing ?? (page.context.removing
          ? new L1Target.PageClosed({ by: "userContextRemoved" })
          : new L1Target.PageClosed({ by: "script" }))
      endPage(state, page, why, `cdp: the page's session ended (${reason.why})`)
      return
    }
    case "iframe": {
      // The frame moved back into its parent's process, which now owns it
      const frame = target.frame
      if (frame !== undefined && !frame.removed && frame.parent !== undefined) frame.owner = frame.parent.owner
      return
    }
    default:
      return
  }
}

/** The session's model can't be trusted: a page's is rebuilt from a fresh frame tree, as at initialization. */
export const lost = (state: State, session: ProtocolClient.Session) => {
  const target = state.targets.get(session)
  if (target?.kind === "page" && target.page !== undefined) {
    state.control.sync(session, snapshot(state, target, target.page, false, Effect.void))
  } else {
    state.control.sync(session, Effect.succeed({ through: 0, apply: Effect.void }))
  }
}

// ── The gate ──────────────────────────────────────────────────────────────────────────────────────────────

const resume = (session: ProtocolClient.Session, waiting: boolean) =>
  waiting ? Runtime.runIfWaitingForDebugger().pipe(Protocol.on(session), Effect.ignore) : Effect.void

/** Installs a frame tree snapshot: the documents it shows, which the events after it build on. */
const installTree = (state: State, target: TargetEntry, tree: Page.FrameTree, adopted: boolean): void => {
  const visit = (node: Page.FrameTree, parent: FrameEntry | undefined) => {
    let frame = state.frames.get(node.frame.id)
    if (frame === undefined) {
      if (parent === undefined) return
      frame = addFrame(state, node.frame.id, parent, target)
    }
    frame.owner = target
    if (frame.document?.loaderId !== node.frame.loaderId) {
      const navigation = state.navigations.get(node.frame.loaderId)
      const document = commit(
        state,
        frame,
        { loaderId: node.frame.loaderId, url: frameUrl(node.frame), origin: node.frame.securityOrigin },
        (navigation) =>
          navigation !== undefined
            ? { _tag: "Navigation", navigation: navigation.id }
            : adopted || node.frame.url !== "about:blank"
            ? { _tag: "Adopted" }
            : { _tag: "InitialBlank" },
        navigation,
        "cdp:Page.getFrameTree"
      )
      if (navigation !== undefined) {
        endNavigation(
          state,
          navigation,
          { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
          "cdp:Page.getFrameTree"
        )
      }
    }
    for (const child of node.childFrames ?? []) visit(child, frame)
  }
  visit(tree, target.frame?.parent)
}

const snapshot = Effect.fnUntraced(function*(
  state: State,
  target: TargetEntry,
  page: PageEntry | undefined,
  adopted: boolean,
  configure: Effect.Effect<void, Adapter.AdapterError | Protocol.ProtocolError>
) {
  const on = Protocol.on(target.session)
  yield* Effect.all([
    Page.enable().pipe(on),
    Page.setLifecycleEventsEnabled({ enabled: true }).pipe(on),
    Network.enable({}).pipe(on)
  ], { concurrency: "unbounded", discard: true })
  const { result, received } = yield* target.session.sendSequenced(Page.getFrameTree())
  // Contexts it replays arrive after the snapshot, so they are folded on top of it
  yield* Runtime.enable().pipe(on)
  // Service and shared workers belong to the browser, whose session attaches them; attached here too, a service
  // worker would wait for two sessions
  yield* Target.setAutoAttach({
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: "service_worker", exclude: true }, { type: "shared_worker", exclude: true }, {}]
  }).pipe(on)
  const failure = yield* configure.pipe(Effect.flip, Effect.option)
  return {
    through: received,
    apply: Effect.suspend(() => {
      installTree(state, target, result.frameTree, adopted)
      if (page !== undefined && target.kind === "page") {
        if (failure._tag === "Some") {
          state.buffer.emit({ _tag: "PageInitializationFailed", page: page.id, description: failure.value.message })
          Deferred.doneUnsafe(
            page.ready,
            Effect.fail(failure.value._tag === "AdapterError" ? failure.value : Kit.protocolError(failure.value))
          )
        } else {
          state.buffer.emit({ _tag: "PageReady", page: page.id })
          Deferred.doneUnsafe(page.ready, Effect.void)
        }
      }
      return state.buffer.flush
    })
  } satisfies ProtocolClient.Synced
})

const gate = (state: State, target: TargetEntry, page: PageEntry | undefined, waiting: boolean, adopted: boolean) =>
  snapshot(state, target, page, adopted, page === undefined ? Effect.void : configureTarget(state, target, page)).pipe(
    Effect.ensuring(resume(target.session, waiting))
  )

// A service worker waiting for the debugger hasn't started, and answers `Runtime.enable` only once it has
// (recorded): the domains are enabled and the worker resumed in one go, in that order, before any reply.
const workerGate = Effect.fnUntraced(function*(state: State, target: TargetEntry, waiting: boolean) {
  const on = Protocol.on(target.session)
  // A dedicated worker that gets init scripts pauses before its first script, where its global is whole: one
  // waiting for the debugger has no timers yet (QUIRKS.md, Q187)
  const scripted = target.kind === "worker" && target.page !== undefined && waiting &&
    Option.isSome(state.registry.workerBundle(placement(target.page)))
  if (scripted) {
    yield* Effect.all([
      Debugger.enable({}).pipe(on),
      Debugger.setInstrumentationBreakpoint({ instrumentation: "beforeScriptExecution" }).pipe(on)
    ], { discard: true }).pipe(Effect.ignore)
  }
  yield* Effect.all([Runtime.enable().pipe(on), Network.enable({}).pipe(on), resume(target.session, waiting)], {
    concurrency: "unbounded",
    discard: true
  }).pipe(Effect.ignore)
  return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
})

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Target.attachedToTarget, (params, { state, target }) => attached(state, target, params))
    .on(Target.targetInfoChanged, (params, { state, target: parent }) => {
      const target = state.targetsById.get(params.targetInfo.targetId)
      if (
        parent?.kind !== "tab" || target?.tab !== parent || target.prerender !== true ||
        params.targetInfo.subtype !== undefined
      ) return
      state.buffer.later(
        Deferred.await(target.page!.ready).pipe(
          Effect.andThen(state.buffer.run(() => activatePrerender(state, parent, target))),
          Effect.catch(() =>
            state.buffer.run(() => {
              if (parent.tabPage !== undefined) {
                endPage(
                  state,
                  parent.tabPage,
                  new L1Target.ModelUnavailable({}),
                  "cdp: promoted child failed initialization"
                )
              }
              if (target.page !== undefined) {
                endPage(
                  state,
                  target.page,
                  new L1Target.ModelUnavailable({}),
                  "cdp: promoted child failed initialization"
                )
              }
            })
          )
        )
      )
    })
    // The session's own end, delivered by `ended`, carries everything
    .on(Target.detachedFromTarget, () => {})
    // A dedicated worker paused before its first script by its gate's breakpoint: its init scripts run, and it
    // goes on
    .on(Debugger.paused, (params, { state, target }) => {
      if (target === undefined || target.kind !== "worker" || params.reason !== "instrumentation") return
      const on = Protocol.on(target.session)
      const bundle = target.page === undefined
        ? Option.none<string>()
        : state.registry.workerBundle(placement(target.page))
      state.buffer.later(
        Effect.all([
          Option.isNone(bundle) ? Effect.void : Runtime.evaluate({ expression: bundle.value }).pipe(on),
          // Disabling the debugger clears its breakpoint
          Debugger.resume({}).pipe(on),
          Debugger.disable().pipe(on)
        ], { discard: true })
      )
    })
    .on(Target.targetCrashed, (params, { state }) => {
      const page = state.targetsById.get(params.targetId)?.page
      if (page !== undefined) endPage(state, page, new L1Target.PageCrashed({}), "cdp:Target.targetCrashed")
    })
    .on(Inspector.targetCrashed, (_params, { state, target }) => {
      if (target?.kind === "page" && target.page !== undefined) {
        endPage(state, target.page, new L1Target.PageCrashed({}), "cdp:Inspector.targetCrashed")
      }
    })
