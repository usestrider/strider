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
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Urls from "../urls.ts"
import { configureTarget } from "./declare.ts"
import { frameUrl, targetKind } from "./mapping.ts"
import { type Event, type FrameEntry, type PageEntry, placement, type State, type TargetEntry } from "./state.ts"
import { addFrame, commit, contextFor, endNavigation, endPage, newFrame, removeRealm } from "./tree.ts"

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
    case "page": {
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
      const entry = { ...target, page }
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
        kind: info.openerId === undefined ? "tab" : "popup",
        origin: state.attachedAtConnect
          ? { _tag: "Adopted", opener: openerId }
          : info.openerId === undefined
          ? { _tag: "Created" }
          : { _tag: "Opened", opener: openerId },
        url: Urls.reported(info.url)
      })
      state.control.sync(session, gate(state, entry, page, params.waitingForDebugger, state.attachedAtConnect))
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

/** A session ended: its target's realms end, and a page's session takes the page with it. */
export const ended = (state: State, session: ProtocolClient.Session, reason: Protocol.SessionEnded) => {
  const target = state.targets.get(session)
  if (target === undefined || target.ended) return
  target.ended = true
  target.proxyAuth?.clear()
  for (const [key, pending] of state.pendingAttribution) {
    if (pending.target === target) state.pendingAttribution.delete(key)
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
    case "page": {
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
