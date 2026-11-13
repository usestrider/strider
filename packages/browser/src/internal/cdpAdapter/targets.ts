/**
 * Targets on CDP: what attaches and ends, and the gate each one runs while paused.
 *
 * - **Attaching.** The browser session auto-attaches pages, service workers and shared workers; each page's
 *   session auto-attaches its out-of-process frames and its workers. A launched browser pauses every new page
 *   before its scripts run; an attached one pauses only frames and workers of pages it attached to, so a user's
 *   tab is never paused (probe 22).
 * - **The gate** writes domain enablement, the frame tree snapshot, Runtime's replay, auto-attachment and the
 *   declarations before resuming a paused target, then collects their replies. Waiting for renderer replies
 *   before resume deadlocks a popup in a new browsing context group. Resume also runs on failure. The gate
 *   never waits on another target: a paused popup blocks its opener.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Debugger from "../../cdp/Debugger.ts"
import * as Fetch from "../../cdp/Fetch.ts"
import * as Inspector from "../../cdp/Inspector.ts"
import * as Network from "../../cdp/Network.ts"
import * as Page from "../../cdp/Page.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import * as Target from "../../cdp/Target.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as Kit from "../adapterKit.ts"
import * as ProtocolClient from "../protocolClient.ts"
import * as Urls from "../urls.ts"
import { configureTarget, type Setup } from "./declare.ts"
import * as Evaluation from "./evaluation.ts"
import { frameUrl, targetKind } from "./mapping.ts"
import {
  ContextEntry,
  dispatchContext,
  type Event,
  type FrameEntry,
  type PageEntry,
  placement,
  type State,
  type TargetEntry
} from "./state.ts"
import { addFrame, commit, contextFor, endNavigation, endPage, newFrame, removeRealm } from "./tree.ts"
import * as WebSocketBridge from "./webSocketBridge.ts"

// ── Attaching and ending ──────────────────────────────────────────────────────────────────────────────────

// A new browsing context group's renderer may not exist until the first response is answered. These
// decisions and their network/navigation attribution are independent of the frame snapshot and must run
// even while its renderer replies are pending. Network history must retain the first request too.
const initialProgress = (method: string) =>
  method.startsWith("Network.") || method === Page.frameStartedNavigating.method ||
  method === Fetch.requestPaused.method || method === Fetch.authRequired.method

const newTarget = (
  state: State,
  kind: TargetEntry["kind"],
  info: Target.TargetInfo,
  session: ProtocolClient.Session,
  page: PageEntry | undefined,
  frame: FrameEntry | undefined
): TargetEntry => {
  ProtocolClient.setTargetKind(session, kind)
  const target: TargetEntry = {
    event: undefined as unknown as import("./state.ts").DispatchContext,
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
  }
  target.event = dispatchContext(state, target)
  return target
}

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
      const target = newTarget(state, kind, info, session, undefined, undefined)
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
      entry.event.target = entry
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
      state.control.sync(
        session,
        context.gate(state, entry, page, params.waitingForDebugger, state.attachedAtConnect),
        params.waitingForDebugger ? initialProgress : undefined
      )
      return
    }
    case "iframe": {
      const frame = state.frames.get(info.targetId)
      const target = newTarget(state, kind, info, session, frame?.page ?? parentPage, frame)
      state.targets.set(session, target)
      state.targetsById.set(info.targetId, target)
      if (frame !== undefined) frame.owner = target
      state.control.sync(session, gate(state, target, target.page, params.waitingForDebugger, false))
      return
    }
    case "worker":
    case "service_worker":
    case "shared_worker": {
      const target = newTarget(state, kind, info, session, kind === "worker" ? parentPage : undefined, undefined)
      state.targets.set(session, target)
      state.targetsById.set(info.targetId, target)
      const context = target.page?.context ?? (info.browserContextId === undefined
        ? undefined
        : state.contextsByCdp.get(info.browserContextId))
      if (context !== undefined) {
        state.workerContexts.set(target, context)
        state.control.sync(session, context.workerGate(state, target, params.waitingForDebugger))
      } else state.control.sync(session, workerGate(state, target, params.waitingForDebugger))
      return
    }
    case "other": {
      state.targets.set(session, newTarget(state, kind, info, session, undefined, undefined))
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
  // A resync cannot recover discarded chunks. Keep independent native totals, but never publish an undercount.
  for (const request of state.requests.values()) {
    if (request.target.session !== session) continue
    const sizes = request.frame?.page.context.requestSizes?.get(request.hop)
    if (sizes !== undefined) sizes.decoded = undefined
  }
  const target = state.targets.get(session)
  if (target?.kind === "page" && target.page !== undefined) {
    state.control.sync(session, snapshot(state, target, target.page, false, false).pipe(Effect.scoped))
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

interface InitialSnapshot {
  readonly result: Page.GetFrameTreeResult
  readonly received: number
  readonly failure: Option.Option<Protocol.ProtocolError>
}

const snapshot = Effect.fnUntraced(function*(
  state: State,
  target: TargetEntry,
  page: PageEntry | undefined,
  adopted: boolean,
  configure: boolean,
  waiting = false,
  release = Effect.void
): Effect.fn.Return<ProtocolClient.Synced, Protocol.ProtocolError, Scope.Scope> {
  const on = Protocol.on(target.session)
  const autoAttach = Target.setAutoAttach({
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: "service_worker", exclude: true }, { type: "shared_worker", exclude: true }, {}]
  })
  const initialized = waiting
    ? Effect.gen(function*(): Effect.fn.Return<InitialSnapshot, Protocol.ProtocolError, Scope.Scope> {
      const scope = yield* Effect.scope
      const replies: Array<Effect.Effect<void, Protocol.ProtocolError>> = []
      const declarations: Array<Effect.Effect<void, Protocol.ProtocolError>> = []
      const setup: Setup = {
        send: Effect.fnUntraced(function*(command, receive) {
          const reply = yield* target.session.start(command, scope)
          declarations.push(reply.pipe(Effect.tap(({ result }) => Effect.sync(() => receive?.(result))), Effect.asVoid))
        })
      }
      const enable: Setup["send"] = Effect.fnUntraced(function*(command) {
        replies.push((yield* target.session.start(command, scope)).pipe(Effect.asVoid))
      })
      yield* enable(Page.enable())
      yield* enable(Page.setLifecycleEventsEnabled({ enabled: true }))
      yield* enable(Network.enable({}))
      const tree = yield* target.session.start(Page.getFrameTree(), scope)
      // Runtime's replay follows the tree on the wire, so its contexts survive the snapshot's boundary.
      replies.push((yield* target.session.start(Runtime.enable(), scope)).pipe(Effect.asVoid))
      // Browser-owned workers must not wait on a second session here.
      replies.push((yield* target.session.start(autoAttach, scope)).pipe(Effect.asVoid))
      const written = page === undefined ? Effect.void : configureTarget(state, target, page, setup)
      const writeFailure = yield* written.pipe(Effect.flip, Effect.option)
      yield* release
      const [snapshot, , declarationFailure] = yield* Effect.all([
        tree,
        Effect.all(replies, { concurrency: "unbounded", discard: true }),
        Effect.all(declarations.map((reply) => reply.pipe(Effect.flip, Effect.option)), { concurrency: "unbounded" })
          .pipe(
            Effect.map((failures) => failures.find(Option.isSome) ?? Option.none())
          )
      ], { concurrency: "unbounded" })
      return { ...snapshot, failure: Option.orElse(writeFailure, () => declarationFailure) }
    })
    : Effect.gen(function*(): Effect.fn.Return<InitialSnapshot, Protocol.ProtocolError, Scope.Scope> {
      yield* Effect.all([
        Page.enable().pipe(on),
        Page.setLifecycleEventsEnabled({ enabled: true }).pipe(on),
        Network.enable({}).pipe(on)
      ], { concurrency: "unbounded", discard: true })
      const tree = yield* target.session.sendSequenced(Page.getFrameTree())
      yield* Runtime.enable().pipe(on)
      yield* autoAttach.pipe(on)
      const failure = yield* (configure && page !== undefined ? configureTarget(state, target, page) : Effect.void)
        .pipe(Effect.flip, Effect.option)
      return { ...tree, failure }
    })
  const { result, received, failure } = yield* initialized
  return {
    through: received,
    apply: Effect.suspend(() => {
      installTree(state, target, result.frameTree, adopted)
      if (page !== undefined && target.kind === "page") {
        if (failure._tag === "Some") {
          state.buffer.emit({ _tag: "PageInitializationFailed", page: page.id, description: failure.value.message })
          Deferred.doneUnsafe(
            page.ready,
            Effect.fail(Kit.protocolError(failure.value))
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

const gate = Effect.fnUntraced(
  function*(state: State, target: TargetEntry, page: PageEntry | undefined, waiting: boolean, adopted: boolean) {
    let resumed = false
    const release = resume(target.session, waiting).pipe(Effect.tap(() =>
      Effect.sync(() => {
        resumed = true
      })
    ))
    // Only a page's setup is staged: queued and sent together with the resume. An iframe that is waiting for the
    // debugger resumes only after its setup ends, so that setup must not await a reply from its renderer, which
    // stays paused until then (a `Page.createIsolatedWorld` there hangs the page's load).
    const staged = waiting && target.kind === "page"
    return yield* snapshot(
      state,
      target,
      page,
      adopted,
      true,
      staged,
      release
    ).pipe(
      staged ? Effect.onError(() => resumed ? Effect.void : release) : Effect.ensuring(release),
      Effect.scoped
    )
  }
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

// Ordinary contexts share the original gates. Only an opted-in context gets own gate properties.
ContextEntry.prototype.gate = gate
ContextEntry.prototype.workerGate = workerGate

export const webSocketGate: import("./state.ts").ContextGate = Effect.fnUntraced(
  function*(state, target, page, waiting, adopted) {
    if (target.kind !== "page" || target.url !== "" || page === undefined) {
      return yield* gate(state, target, page, waiting, adopted)
    }
    const bundles = state.registry.bundles(placement(page))
    const bridges = bundles.get("")?.webSockets
    if (bridges === undefined) return yield* gate(state, target, page, waiting, adopted)
    const scope = yield* Scope.fork(state.cleanupScope)
    const contexts: Array<Runtime.ExecutionContextCreatedParams> = []
    const main = yield* Deferred.make<void>()
    const events = yield* target.session.subscribe(Runtime.executionContextCreated).pipe(Scope.provide(scope))
    yield* events.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          contexts.push(event)
          if ((event.context.auxData as { isDefault?: boolean } | undefined)?.isDefault) {
            Deferred.doneUnsafe(main, Effect.void)
          }
        })
      ),
      Effect.forkIn(scope)
    )
    return yield* Effect.gen(function*() {
      const on = Protocol.on(target.session)
      const bindings = yield* WebSocketBridge.prepare(state, target, bridges, false)
      yield* Effect.all([
        Page.enable().pipe(on),
        Runtime.enable().pipe(on),
        ...bindings.map((binding) => binding.pipe(on)),
        ...[...bundles].map(([key, bundle]) =>
          Page.addScriptToEvaluateOnNewDocument({
            source: bundle.source,
            ...(bundle.world._tag === "Isolated" ? { worldName: bundle.world.name } : {})
          }).pipe(on, Effect.tap(({ identifier }) => Effect.sync(() => target.scripts.set(key, identifier))))
        ),
        Runtime.runIfWaitingForDebugger().pipe(on)
      ], { concurrency: "unbounded", discard: true })
      yield* Deferred.await(main)
      const synced = yield* gate(state, target, page, waiting, adopted)
      const live: Array<Runtime.ExecutionContextCreatedParams> = []
      for (const event of contexts) {
        if (
          Exit.isSuccess(
            yield* Runtime.evaluate({ expression: "0", uniqueContextId: event.context.uniqueId }).pipe(on, Effect.exit)
          )
        ) live.push(event)
      }
      return {
        through: synced.through,
        apply: synced.apply.pipe(Effect.andThen(Effect.suspend(() => {
          for (const event of live) {
            if (event.context.uniqueId === undefined || !state.realmsByUnique.has(event.context.uniqueId)) {
              Evaluation.contextCreated(event, { state, target })
            }
          }
          WebSocketBridge.flush(state, target)
          return state.buffer.flush
        })))
      }
    }).pipe(Effect.ensuring(Scope.close(scope, Exit.void)))
  }
)

export const webSocketWorkerGate: import("./state.ts").WorkerGate = Effect.fnUntraced(
  function*(state, target, waiting) {
    const bindings = yield* WebSocketBridge.prepare(state, target, undefined, false)
    const results = yield* Effect.all([
      Effect.forEach(bindings, (binding) => binding.pipe(Protocol.on(target.session)), { discard: true }),
      workerGate(state, target, waiting)
    ], { concurrency: "unbounded" })
    return results[1]
  }
)

let gateUsers: WeakMap<ContextEntry, { total: number; workers: number }> | undefined
export const installWebSocketGates = Effect.fnUntraced(
  function*(context: ContextEntry, scope: Scope.Scope, workers: boolean) {
    gateUsers ??= new WeakMap()
    let users = gateUsers.get(context)
    if (users === undefined) {
      users = { total: 0, workers: 0 }
      gateUsers.set(context, users)
    }
    users.total++
    context.gate = webSocketGate
    if (workers) {
      users.workers++
      context.workerGate = webSocketWorkerGate
    }
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        users.total--
        if (workers) users.workers--
        if (users.workers === 0 && Object.hasOwn(context, "workerGate")) {
          delete (context as Partial<ContextEntry>).workerGate
        }
        if (users.total === 0) {
          delete (context as Partial<ContextEntry>).gate
          gateUsers!.delete(context)
        }
      })
    )
  }
)

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
