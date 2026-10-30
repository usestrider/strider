/**
 * Pages, targets and workers on stock WebKit: what arrives and ends, and the gate each runs while paused.
 *
 * - **Pages are page proxies.** The transport presents each page as one, in our envelope (`webkitEnvelope.ts`):
 *   it outlives navigations. Its inspector target is the page in a web process, which a cross-site navigation
 *   replaces: the new target is provisional until `Target.didCommitProvisionalTarget`, and its main frame has a new
 *   frame id, which this maps onto the same navigable.
 * - **The gate.** A target starts paused once its page asks (`Target.setPauseOnStart`). While it is, the adapter
 *   enables `Page`, `Network`, `Console` and `Worker`, takes the resource tree (the snapshot the session is synced
 *   with), enables `Runtime`, applies the declarations in force, and resumes it with `Target.resume`, in a
 *   finalizer. A worker waits the same way until `Worker.initialized`.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Console from "../../webkit-stock-protocol/Console.ts"
import * as Network from "../../webkit-stock-protocol/Network.ts"
import * as Page from "../../webkit-stock-protocol/Page.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Target from "../../webkit-stock-protocol/Target.ts"
import * as Worker from "../../webkit-stock-protocol/Worker.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Envelope from "../webkitEnvelope.ts"
import * as WebKitWire from "../webkitWire.ts"
import { mainRealmOf } from "./console.ts"
import { configureTarget } from "./declare.ts"
import {
  type Event,
  type FrameEntry,
  frameKey,
  loaderKey,
  type PageEntry,
  placement,
  type RealmEntry,
  type State,
  type TargetEntry,
  type WorkerEntry
} from "./state.ts"
import { addFrame, commit, contextFor, endNavigation, endPage, originOf, removeRealm } from "./tree.ts"

// ── Arriving and ending ───────────────────────────────────────────────────────────────────────────────────

const pageProxyCreated = (state: State, params: Envelope.PageProxyCreatedParams) => {
  const session = state.control.session(WebKitWire.pageProxyKey(params.pageProxyId))
  if (session === undefined) return
  const context = contextFor(state, params.browserContextId)
  const id = state.ids.navigable()
  // Launched stock WebKit: a page the connection is making in this context, or one a page opened
  const pending = state.automation === undefined ? 0 : state.creating.get(params.browserContextId) ?? 0
  const launchedCreated = state.automation !== undefined && !state.attachedAtConnect && pending > 0
  const launchedPopup = state.automation !== undefined && !state.attachedAtConnect && pending === 0
  if (launchedCreated) state.creating.set(params.browserContextId, pending - 1)
  const page: PageEntry = {
    id,
    pageProxyId: params.pageProxyId,
    session,
    context,
    ready: Deferred.makeUnsafe(),
    target: undefined,
    provisional: undefined,
    main: undefined as unknown as FrameEntry,
    dialog: undefined,
    closing: undefined,
    ended: false
  }
  const main: FrameEntry = {
    frameId: "",
    id,
    page,
    parent: undefined,
    children: new Set(),
    document: undefined,
    expected: Kit.makeExpectations(),
    navigations: new Map(),
    removed: false
  }
  ;(page as { main: FrameEntry }).main = main
  state.pages.set(id, page)
  state.pagesByProxy.set(params.pageProxyId, page)
  state.navigables.set(id, main)
  state.buffer.emit({
    _tag: "PageAdded",
    page: id,
    context: context.id,
    kind: launchedPopup ? "popup" : "tab",
    // Stock WebKit's pages are the browser's own when attached; launched, one the connection asked for is made
    // here, and any other was opened by a page, which stock WebKit doesn't name (QUIRKS.md, Q212)
    origin: state.attachedAtConnect || state.automation === undefined
      ? { _tag: "Adopted", opener: Option.none() }
      : launchedCreated
      ? { _tag: "Created" }
      : { _tag: "Opened", opener: Option.none() },
    url: "about:blank"
  })
  state.control.sync(session, pageProxyGate(page))
}

const targetCreated = (state: State, page: PageEntry, params: Target.TargetCreatedParams) => {
  const info = params.targetInfo
  const session = state.control.session(WebKitWire.targetKey(page.pageProxyId, info.targetId))
  if (session === undefined || info.type !== "page") {
    if (session !== undefined) {
      state.control.sync(session, Effect.succeed({ through: 0, apply: Effect.void }))
    }
    return
  }
  const target: TargetEntry = {
    targetId: info.targetId,
    session,
    page,
    mainFrameId: undefined,
    intercepts: [],
    lastConsole: undefined,
    ended: false
  }
  state.targets.set(session, target)
  const first = page.target === undefined && page.provisional === undefined
  if (info.isProvisional === true) page.provisional = target
  else page.target = target
  state.control.sync(session, gate(state, target, first, info.isPaused === true))
}

/** A session's end: a worker's, a target's, or a page proxy's, which ends its page. */
export const ended = (state: State, session: ProtocolClient.Session, reason: Protocol.SessionEnded) => {
  const worker = state.workers.get(session)
  if (worker !== undefined) {
    state.workers.delete(session)
    if (worker.realm !== undefined) {
      removeRealm(state, worker.realm, reason.why === "connectionLost" ? Kit.closed() : { _tag: "RealmDestroyed" })
    }
    return
  }
  const target = state.targets.get(session)
  if (target !== undefined) {
    target.ended = true
    state.targets.delete(session)
    state.pausedRequests.delete(target)
    for (const realm of Array.from(state.realms.values())) {
      if (realm.target === target) {
        removeRealm(state, realm, reason.why === "connectionLost" ? Kit.closed() : { _tag: "RealmDestroyed" })
      }
    }
    const page = target.page
    if (page.provisional === target) {
      page.provisional = undefined
      if (target.mainFrameId !== undefined && state.frames.get(target.mainFrameId) === page.main) {
        state.frames.delete(target.mainFrameId)
      }
    }
    // The page keeps its ended target, which says why it ended when the page proxy reports it
    return
  }
  const page = [...state.pages.values()].find((page) => page.session === session)
  if (page === undefined) return
  const why: L1Target.CloseReason = reason.why === "connectionLost"
    ? Kit.closed()
    : reason.why === "modelUnavailable"
    ? { _tag: "ModelUnavailable" }
    : page.closing ??
      (page.context.removing
        ? { _tag: "PageClosed", by: "userContextRemoved" }
        : { _tag: "PageClosed", by: "script" })
  endPage(state, page, why, `webkit: the page proxy's session ended (${reason.why})`)
}

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Envelope.pageProxyCreated, (params, { state }) => pageProxyCreated(state, params))
    .on(Target.targetCreated, (params, { state, page }) => {
      if (page !== undefined) targetCreated(state, page, params)
    })
    .on(Target.didCommitProvisionalTarget, (params, { state, page }) => {
      const target = page?.provisional
      if (page === undefined || target === undefined || target.targetId !== params.newTargetId) return
      page.provisional = undefined
      page.target = target
      // The main frame is the same navigable under the new process's frame id
      const old = page.main.frameId
      if (target.mainFrameId !== undefined) {
        if (state.frames.get(old) === page.main && old !== target.mainFrameId) state.frames.delete(old)
        page.main.frameId = target.mainFrameId
        state.frames.set(target.mainFrameId, page.main)
      }
    })
    .on(Worker.workerCreated, (params, { state, target }) => {
      if (target === undefined) return
      const session = state.control.session(
        WebKitWire.workerKey(target.page.pageProxyId, target.targetId, params.workerId)
      )
      if (session === undefined) return
      const worker: WorkerEntry = {
        workerId: params.workerId,
        session,
        target,
        url: params.url,
        realm: undefined,
        lastConsole: undefined
      }
      const realm: RealmEntry = {
        id: state.ids.realm(),
        session,
        contextId: undefined,
        target,
        document: undefined,
        world: { _tag: "Main" },
        ended: false,
        pending: false,
        held: []
      }
      worker.realm = realm
      state.workers.set(session, worker)
      state.realms.set(realm.id, realm)
      state.buffer.emit({
        _tag: "RealmAdded",
        realm: realm.id,
        origin: originOf(params.url),
        kind: {
          _tag: "Worker",
          worker: { _tag: "Dedicated", owner: Option.fromUndefinedOr(mainRealmOf(target)?.id) },
          url: params.url,
          page: Option.some(target.page.id),
          context: Option.some(target.page.context.id)
        }
      })
      state.control.sync(session, workerGate(state, worker))
    })
    .on(Worker.workerTerminated, () => {
      // The worker's session ends with it, and its end carries everything
    })

// ── The gate ──────────────────────────────────────────────────────────────────────────────────────────────

/** Installs a resource tree: the documents it shows, which the events after it build on. */
const installTree = (state: State, target: TargetEntry, tree: Page.FrameResourceTree, first: boolean) => {
  const page = target.page
  const mainFrame = frameKey(target, tree.frame.id)
  target.mainFrameId = mainFrame
  if (page.provisional === target) {
    // The navigation it loads commits in the page's main frame, under this frame id
    state.frames.set(mainFrame, page.main)
    return
  }
  page.main.frameId = mainFrame
  state.frames.set(mainFrame, page.main)
  const visit = (node: Page.FrameResourceTree, frame: FrameEntry) => {
    const loader = node.frame.loaderId === ""
      ? `initial:${frameKey(target, node.frame.id)}`
      : loaderKey(target, node.frame.loaderId)
    if (frame.document?.loaderId !== loader || frame.document === undefined) {
      const blank = node.frame.url === "" || node.frame.url === "about:blank"
      const navigation = state.navigations.get(loader)
      const document = commit(
        state,
        frame,
        {
          loaderId: loader,
          url: node.frame.url === "" ? "about:blank" : node.frame.url,
          origin: node.frame.securityOrigin
        },
        navigation !== undefined
          ? { _tag: "Navigation", navigation: navigation.id }
          : first && blank && !state.attachedAtConnect
          ? { _tag: "InitialBlank" }
          : { _tag: "Adopted" },
        "webkit:Page.getResourceTree"
      )
      if (navigation !== undefined) {
        endNavigation(
          state,
          navigation,
          { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
          "webkit:Page.getResourceTree"
        )
      }
    }
    for (const child of node.childFrames ?? []) {
      const key = frameKey(target, child.frame.id)
      visit(child, state.frames.get(key) ?? addFrame(state, key, frame))
    }
  }
  visit(tree, page.main)
}

/** Enables the target's domains and takes its resource tree, the snapshot its session is synced with. */
export const snapshot = Effect.fnUntraced(function*(
  state: State,
  target: TargetEntry,
  first: boolean,
  configure: Effect.Effect<void, Adapter.AdapterError | Protocol.ProtocolError>
) {
  const on = Protocol.on(target.session)
  yield* Effect.all([
    Page.enable().pipe(on),
    Network.enable().pipe(on),
    Console.enable().pipe(on)
  ], { concurrency: "unbounded", discard: true })
  const { result, received } = yield* target.session.sendSequenced(Page.getResourceTree())
  // Contexts it replays arrive after the snapshot, so they are folded on top of it
  yield* Runtime.enable().pipe(on)
  yield* Worker.enable().pipe(on)
  // An adopted page's document loaded before we came, and no event will say how far: it's asked (QUIRKS.md,
  // Q201)
  const readyState = first
    ? yield* Runtime.evaluate({ expression: "document.readyState", returnByValue: true }).pipe(
      on,
      Effect.map(({ result }) => result.value as unknown),
      Effect.option
    )
    : Option.none()
  const failure = yield* configure.pipe(Effect.flip, Effect.option)
  const page = target.page
  return {
    through: received,
    apply: Effect.suspend(() => {
      installTree(state, target, result.frameTree, first)
      const adopted = page.main.document
      if (adopted !== undefined && Option.isSome(readyState)) {
        if (readyState.value === "interactive" || readyState.value === "complete") {
          adopted.interactive = true
          state.buffer.emit({ _tag: "DocumentReadiness", document: adopted.id, readiness: "interactive" })
        }
        if (readyState.value === "complete") {
          adopted.complete = true
          state.buffer.emit({ _tag: "DocumentReadiness", document: adopted.id, readiness: "complete" })
        }
      }
      if (first) {
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

const resume = (target: TargetEntry, paused: boolean) =>
  paused
    ? Target.resume({ targetId: target.targetId }).pipe(Protocol.on(target.page.session), Effect.ignore)
    : Effect.void

const gate = (state: State, target: TargetEntry, first: boolean, paused: boolean) =>
  // The window's size is the viewport, set once the page is paired (`afterPairing`)
  snapshot(state, target, first, configureTarget(state, target)).pipe(Effect.ensuring(resume(target, paused)))

const workerGate = (state: State, worker: WorkerEntry) =>
  Effect.gen(function*() {
    const on = Protocol.on(worker.session)
    yield* Effect.all([Runtime.enable().pipe(on), Console.enable().pipe(on)], {
      concurrency: "unbounded",
      discard: true
    }).pipe(Effect.ignore)
    // A new worker waits for `Worker.initialized`, so this runs before its own script
    const bundle = state.registry.workerBundle(placement(worker.target.page))
    if (Option.isSome(bundle)) yield* Runtime.evaluate({ expression: bundle.value }).pipe(on, Effect.ignore)
    return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
  }).pipe(
    Effect.ensuring(
      Worker.initialized({ workerId: worker.workerId }).pipe(Protocol.on(worker.target.session), Effect.ignore)
    )
  )

/** Stock WebKit pauses a page's new targets when asked. */
const pageProxyGate = Effect.fnUntraced(function*(page: PageEntry) {
  yield* Target.setPauseOnStart({ pauseOnStart: true }).pipe(Protocol.on(page.session), Effect.ignore)
  return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
})

/** A target whose events were lost: its model is rebuilt from a fresh resource tree, as at initialization. */
export const lost = (state: State, session: ProtocolClient.Session) => {
  const target = state.targets.get(session)
  state.control.sync(
    session,
    target !== undefined
      ? snapshot(state, target, false, Effect.void)
      : Effect.succeed({ through: 0, apply: Effect.void })
  )
}
