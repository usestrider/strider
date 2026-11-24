/**
 * The CDP adapter's state: its tables from CDP's ids to L1's, and the kit's pieces, in one object every module of
 * the adapter takes (`adapterKit.ts`).
 *
 * Identity: frames are keyed by frame id, documents by loader id, realms by `uniqueId` (context ids repeat after a
 * process swap), navigations by loader id, requests by session and request id.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import type * as Input from "../../cdp/Input.ts"
import type * as Network from "../../cdp/Network.ts"
import type * as Dialog from "../../Dialog.ts"
import type * as Download from "../../Download.ts"
import type * as NetworkConnection from "../../NetworkConnection.ts"
import type * as NetworkRequest from "../../NetworkRequest.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import * as Groups from "../objectGroups.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Retired from "../retired.ts"

// ── Entries ───────────────────────────────────────────────────────────────────────────────────────────────

export type ContextGate = (
  state: State,
  target: TargetEntry,
  page: PageEntry | undefined,
  waiting: boolean,
  adopted: boolean
) => Effect.Effect<ProtocolClient.Synced, Adapter.AdapterError | import("../../protocol/Protocol.ts").ProtocolError>
export type WorkerGate = (
  state: State,
  target: TargetEntry,
  waiting: boolean
) => Effect.Effect<ProtocolClient.Synced, Adapter.AdapterError | import("../../protocol/Protocol.ts").ProtocolError>

export class ContextEntry {
  declare requestSizes?: Map<string, import("../requestSizes.ts").Collector> | undefined
  declare requestTiming?: Map<string, import("../requestTiming.ts").Collector> | undefined
  declare proxy?: Adapter.ProxyOptions | undefined
  declare readonly id: UserContext.Id
  /** CDP's id; the default context's too, once a page in it reports it. */
  declare browserContextId: string | undefined
  declare readonly isDefault: boolean
  /** Focus is emulated for the context's whole life: its pages are tabs, which render only with it. */
  declare focusEmulated?: boolean | undefined
  /** The context's pages ignore certificate errors: it accepts them, or its client certificate proxy checks them. */
  declare ignoreCertificateErrors?: boolean | undefined
  /**
   * The context's overrides whose releases were skipped because its removal was to follow, by kind, which a removal
   * the browser refuses releases after all (`restoreContext`).
   */
  declare retiredOverrides?: Map<Adapter.Override["_tag"], Adapter.Declaration> | undefined
  declare removing: boolean
  declare disposed?: boolean | undefined
  declare lifecycleLock?: Semaphore.Semaphore | undefined
  /**
   * A declaration gave its downloads a directory, and the context still answers for it: set as the declaration is
   * registered, or as the context is made while a browser-wide one is in force (`keepEndedFramesIfDeclared`), kept
   * while the context retires, and cleared when the declaration is released with the context left open or when the
   * context is removed.
   */
  declare keepsEndedFrames?: boolean | undefined
  /** The ids of its frames that have ended, which `State.retiredFrames` holds (`retireFrame`). */
  declare retiredFrames?: Set<string> | undefined
  declare gate: ContextGate
  declare workerGate: WorkerGate
  constructor(id: UserContext.Id, browserContextId: string | undefined, isDefault: boolean) {
    this.id = id
    this.browserContextId = browserContextId
    this.isDefault = isDefault
    this.removing = false
  }
}

/** Serialize context commands with disposal; removal in progress alone does not prove it succeeded. */
export const contextLock = (context: ContextEntry) => context.lifecycleLock ??= Semaphore.makeUnsafe(1)

export type TargetKind = "page" | "iframe" | "worker" | "service_worker" | "shared_worker" | "other"

export interface TargetEntry {
  event: DispatchContext
  proxyAuth?: Map<string, { readonly networkId: string | undefined; attempted: boolean }> | undefined
  readonly kind: TargetKind
  readonly targetId: string
  readonly session: ProtocolClient.Session
  readonly page: PageEntry | undefined
  /** For an out-of-process frame: the frame its session owns. */
  readonly frame: FrameEntry | undefined
  readonly url: string
  /** For a worker: its realm, once its context is created. */
  realm: RealmEntry | undefined
  /**
   * For a dedicated worker attached waiting for the debugger: done once its script has loaded, or it has ended.
   * Evaluations in its realm wait on it (`Evaluation.evaluate`).
   */
  scriptLoaded?: Deferred.Deferred<void> | undefined
  /** The intercept patterns last applied, so a change is applied once. */
  intercepts: string
  /**
   * Whether the HTTP cache was last set off, so a change is sent once; Chromium's default is on, and `"unknown"`
   * after a reply that failed or never came.
   */
  cacheDisabled?: boolean | "unknown" | undefined
  /** The cache command still unanswered, with the value it sets, which a declaration wanting that value awaits. */
  cacheConfirmation?:
    | {
      readonly disabled: boolean
      readonly fiber: Fiber.Fiber<void, import("../../protocol/Protocol.ts").ProtocolError>
    }
    | undefined
  /** Each init script bundle's identifier in Chromium, by its key, written under `scriptLock`. */
  readonly scripts: Map<string, string>
  /**
   * The init script identifiers whose removal Chromium never answered, so may still be installed, written under
   * `scriptLock`: each write sends their removal again.
   */
  unconfirmedScripts?: Set<string> | undefined
  ended: boolean
  /** Original renderer dimensions, retained until restoration completes; null means the original is unknown. */
  viewport?: { readonly width: number; readonly height: number } | null | undefined
  /** For a page: the browser window that holds it, once read. */
  windowId?: number | undefined
  overrideLock?: Semaphore.Semaphore | undefined
  viewportLock?: Semaphore.Semaphore | undefined
  scriptLock?: Semaphore.Semaphore | undefined
}

/** A session pointer input goes on, and the origin of its viewport in the page's coordinates. */
export interface PointerTarget {
  readonly target: TargetEntry
  readonly x: number
  readonly y: number
}

export interface PageEntry {
  readonly id: L1Target.NavigableId
  readonly targetId: string
  readonly context: ContextEntry
  readonly target: TargetEntry
  /** For a popup: the target id of the page that opened it, which may not be tracked. */
  readonly openerId?: string | undefined
  readonly ready: Deferred.Deferred<void, Adapter.AdapterError>
  /**
   * Done once the page's initial sync has the frame tree's reply: events received after it are folded, not
   * discarded, so a declaration may write to the page from then on. The page's end also completes it.
   */
  readonly treeRead: Deferred.Deferred<void>
  closing: L1Target.CloseReason | undefined
  /**
   * A close that runs `beforeunload` was sent and its prompt, if any, hasn't refused it: the page's end is the
   * command's, unless its context was removed, whose end stays its own. Kept apart from `closing`, since the page
   * stays usable until the prompt is answered.
   */
  closeRequested: boolean
  ended: boolean
}

export interface FrameEntry extends Kit.NavigableNode<FrameEntry> {
  readonly frameId: string
  readonly page: PageEntry
  /** The session that owns the frame now: its page's, or its own when out of process. */
  owner: TargetEntry
  document: DocumentEntry | undefined
  /** Navigations started by a command that the browser hasn't announced yet, oldest first. */
  readonly expected: Kit.Expectations
  readonly navigations: Map<string, NavigationEntry>
  /**
   * Navigations that failed, by loader id, until the frame's next commit: Chromium commits a failed
   * navigation's error page under its loader id after the failure is reported, with no new navigation.
   */
  readonly failed: Map<string, NavigationEntry>
  /** Main-world realms created during a traversal, for the document it restores. */
  readonly pendingRealms: Array<RealmEntry>
}

export interface DocumentEntry {
  readonly id: L1Target.DocumentId
  readonly frame: FrameEntry
  loaderId: string | undefined
  url: string
  generation: number
  readonly realms: Set<RealmEntry>
}

export interface RealmEntry extends Kit.RealmNode {
  readonly uniqueId: string
  readonly contextId: number
  readonly target: TargetEntry
  readonly frame: FrameEntry | undefined
  readonly world: Adapter.World
  readonly origin: string
}

/**
 * Why a page is closing, once something closes it: a close command's, or its context's removal. A page that closes
 * itself, by script, has no reason until its session ends.
 */
export const closingReason = (state: State, page: PageEntry): L1Target.CloseReason | undefined =>
  page.closing ?? (page.context.removing
    ? new L1Target.PageClosed({ by: "userContextRemoved" })
    : page.closeRequested
    ? new L1Target.PageClosed({ by: "command" })
    : state.browserEnd)

/** Why a realm's page is closing, once a close command or its context's removal closes it. */
export const closingOf = (state: State, realm: RealmEntry) => (): L1Target.CloseReason | undefined => {
  const page = realm.frame?.page ?? realm.target.page
  return page === undefined ? state.browserEnd : closingReason(state, page)
}

/** Why a realm ends when the browser destroys it: its page's reason while the page closes, else `RealmDestroyed`. */
export const realmEnd = (state: State, realm: RealmEntry): L1Target.CloseReason =>
  closingOf(state, realm)() ?? new L1Target.RealmDestroyed({})

export interface NavigationEntry extends Kit.NavigationNode {
  readonly frame: FrameEntry
  readonly loaderId: string
  readonly url: string
  readonly sameDocument: boolean
  /** A move through history, which may restore a document from the back/forward cache. */
  readonly traversal: boolean
  documentHop: NetworkRequest.HopId | undefined
  status: number | undefined
  /** Whether the document request's latest hop has had its response; a redirect starts a hop with none. */
  responded: boolean
  failed: string | undefined
}

/** A hop's headers as the network sent or received them, from an `ExtraInfo` event. */
export interface ExtraInfo {
  readonly statusCode?: number | undefined
  readonly phase: "request" | "response"
  readonly headers: Network.Headers
}

/** Shared by a Fetch pause and its Network hop, even when the pause comes first. */
export interface Attribution {
  readonly target: TargetEntry
  fulfilled: boolean
  fetchId?: string | undefined
}

export interface RequestEntry {
  readonly id: NetworkRequest.Id
  readonly target: TargetEntry
  readonly requestId: string
  redirects: number
  hop: NetworkRequest.HopId
  url: string
  readonly frame: FrameEntry | undefined
  readonly navigation: NavigationEntry | undefined
  /** Completes when the last hop finishes loading, or fails with the browser's error text. */
  readonly finished: Deferred.Deferred<void, string>
  /** `Network.requestServedFromCache` came for the current hop: `responseReceived` doesn't say so. */
  servedFromCache: boolean
  /**
   * Whether the current hop's response came over the network as itself, not from a cache, a service worker or a
   * route, and not a 304's revalidation: only then are its byte counts its own.
   */
  network: boolean
  /** The current hop's route attribution, shared with its Fetch pauses. */
  attribution: Attribution
  /** What the `Network` domain calls it: `Fetch` calls a `fetch()` an `XHR`. */
  readonly resourceType: NetworkRequest.ResourceType
  /** The current hop's headers as received, from `responseReceivedExtraInfo` (QUIRKS.md, Q158). */
  received: Network.Headers | undefined
  /** The current hop's headers as the request event gave them, and whether the headers sent were reported. */
  requestHeaders: Network.Headers
  sentReported: boolean
  /**
   * `ExtraInfo` no hop has said it is owed, in the order it came: a hop says whether it gets one only as it ends,
   * by its redirect or its response, and the network's events can overtake the page's, so this can be the
   * current hop's or a later one's.
   */
  readonly ahead: Array<ExtraInfo>
  /**
   * Hops that ended saying `ExtraInfo` would come, before it did: the next of each phase is theirs, oldest first.
   */
  readonly owed: Array<{ readonly hop: NetworkRequest.HopId; readonly phase: ExtraInfo["phase"] }>
  /**
   * Each hop's request body: whether it had one, and its bytes as the event carried them, kept where a body
   * collection covers the page (Q164).
   */
  readonly sentBodies: Array<{ readonly hasBody: boolean; readonly carried: Option.Option<Uint8Array> }>
  /**
   * A response that said `hasExtraInfo`, held until its `ExtraInfo` arrives, with the facts that came after it
   * (QUIRKS.md, Q158).
   */
  held: { readonly response: Network.Response; readonly after: Array<Adapter.Fact> } | undefined
}

export type ObligationEntry =
  | {
    readonly _tag: "PausedRequest"
    readonly id: Adapter.ObligationId
    readonly target: TargetEntry
    readonly requestId: string
    readonly phase: "request" | "response" | "auth"
    /** The hop's attribution, shared with Network even if its request has not arrived yet. */
    readonly attribution: Attribution | undefined
    /** The request's body, as `Fetch.requestPaused` carried it. */
    readonly body: Option.Option<Uint8Array>
    /** The `Network` domain's id for it, which a body too large to carry is read by. */
    readonly networkId: string | undefined
    readonly hasBody: boolean
  }
  | {
    readonly _tag: "Prompt"
    readonly id: Adapter.ObligationId
    readonly prompt: Dialog.PromptId
    readonly target: TargetEntry
    readonly beforeUnload: boolean
  }
  | {
    readonly _tag: "FileChooser"
    readonly id: Adapter.ObligationId
    readonly target: TargetEntry
    readonly backendNodeId: number | undefined
  }

export interface DownloadEntry {
  readonly id: Download.Id
  readonly guid: string
  readonly directory: Option.Option<string>
  /** The context it was started in, which canceling it names. */
  readonly context: ContextEntry | undefined
  ended: boolean
}

export interface HandleEntry {
  readonly target: TargetEntry
  /** The realm it was made in, which takes it when it ends. */
  readonly realm: RealmEntry
  readonly objectId: string
  /** The object group it was made in (Q132). */
  readonly group: string | undefined
}

/** An HTML drag Chromium started and the adapter intercepted, until it is dropped. */
export interface DragEntry {
  readonly data: Input.DragData
  entered: boolean
  /** Where its last drag event went, on the session it went on, in that session's coordinates. */
  at: { readonly target: TargetEntry; readonly x: number; readonly y: number } | undefined
  /** Announced after the gesture that started it was released (QUIRKS.md, Q88). */
  readonly stale: boolean
}

// ── The state ─────────────────────────────────────────────────────────────────────────────────────────────

export interface CaptureGuard {
  readonly page: L1Target.NavigableId
  readonly document: L1Target.DocumentId | undefined
  readonly replaced: (document: L1Target.DocumentId, received: number) => void
}

export interface State extends Kit.Ending {
  readonly handlers: Kit.Handlers<Event>
  readonly cleanupScope: Scope.Scope
  readonly captures: Set<CaptureGuard>
  readonly options: Adapter.ConnectOptions
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  /** The browser's session, once the client is made: the fold never needs it. */
  readonly root: () => ProtocolClient.Session
  readonly registry: Declarations.Registry
  readonly defaultContext: UserContext.Id
  readonly contexts: Map<UserContext.Id, ContextEntry>
  readonly contextsByCdp: Map<string, ContextEntry>
  readonly targets: Map<ProtocolClient.Session, TargetEntry>
  readonly targetsById: Map<string, TargetEntry>
  /**
   * Page ids given out before their page is known: an attached browser can list a popup before its opener, so the
   * popup names the opener by the id its opener then takes.
   */
  readonly reservedIds: Map<
    string,
    { readonly id: L1Target.NavigableId; readonly popups: Set<L1Target.NavigableId> }
  >
  readonly pages: Map<L1Target.NavigableId, PageEntry>
  /** Why each page that ended did, for an operation that names it after. */
  readonly endedPages: Map<L1Target.NavigableId, L1Target.CloseReason>
  readonly frames: Map<string, FrameEntry>
  readonly navigables: Map<L1Target.NavigableId, FrameEntry>
  readonly documents: Map<L1Target.DocumentId, DocumentEntry>
  readonly documentsByLoader: Map<string, DocumentEntry>
  readonly realms: Map<L1Target.RealmId, RealmEntry>
  readonly realmsByContext: Map<string, RealmEntry>
  readonly realmsByUnique: Map<string, RealmEntry>
  readonly navigations: Map<string, NavigationEntry>
  readonly requests: Map<string, RequestEntry>
  readonly hops: Map<NetworkRequest.HopId, RequestEntry>
  /** Retires a finished request by its key: finished requests stay answerable while there is room (Q177). */
  readonly retire: (key: string) => void
  /** A Fetch pause preceding its Network request shares this hop record until the request arrives or ends. */
  readonly pendingAttribution: Map<string, Attribution>
  /**
   * The `Network` ids of request chains a context's credentials were sent for, by `credentialsScope`. A Fetch
   * pause names its chain before Network reports it, so the one attempt is counted from the first pause.
   */
  readonly credentialsAttempted: Map<string, Set<string>>
  /** ExtraInfo that came before its request, by request key; a few hundred at most. */
  readonly earlyHeaders: Map<string, Array<ExtraInfo>>
  /** Requests the browser answers itself (`data:`, `blob:`), by request key, until they end: their ExtraInfo is dropped; a few hundred at most. */
  readonly answeredLocally: Set<string>
  /** Requests a route failed, by their `Network` key: an abort a route made has nothing after it to end it. */
  readonly routeFailed: Set<string>
  readonly obligations: Map<Adapter.ObligationId, ObligationEntry>
  readonly downloads: Map<string, DownloadEntry>
  /**
   * The context of each ended frame, by frame id, of a context that keeps them (`ContextEntry.keepsEndedFrames`),
   * until it stops or is removed: Chromium can announce a download after the frame that started it has gone, and
   * removing the context waits for it before the directory is removed.
   */
  readonly retiredFrames: Map<string, ContextEntry>
  readonly downloadsById: Map<Download.Id, DownloadEntry>
  readonly handles: Map<Adapter.HandleId, HandleEntry>
  readonly groups: Groups.Groups
  readonly connections: Map<string, NetworkConnection.Id>
  /** HTML drags Chromium started and the adapter intercepted, by page, until they are dropped or the page ends. */
  readonly drags: Map<L1Target.NavigableId, DragEntry>
  readonly interceptingDrags: Set<L1Target.NavigableId>
  /** The buttons each page's last mouse event left held, until the page ends. */
  readonly heldButtons: Map<L1Target.NavigableId, number>
  /**
   * The session, and its origin in the page's coordinates, that a page's touch input naming no frame went on when
   * the touch started, until it ends or is canceled; the touch input between goes there too, while it lasts.
   */
  readonly touchCapture: Map<L1Target.NavigableId, PointerTarget>
  /**
   * The session each page's held press went to, with the origin of its viewport in the page's, until every button
   * is released or that frame detaches: the frame the press reached keeps the mouse, as a real mouse's frame does.
   */
  readonly pressedOn: Map<
    L1Target.NavigableId,
    PointerTarget
  >
  /** Pages whose held Escape canceled an intercepted drag: its release is the drag's too, and isn't sent. */
  readonly escapeCanceled: Set<L1Target.NavigableId>
  /** The frames each page's held press landed in, where its gesture named them, until every button is released or the frame detaches. */
  readonly pressedIn: Map<L1Target.NavigableId, ReadonlyArray<FrameEntry>>
  /** A worker no page owns belongs to the context its target names. */
  readonly workerContexts: Map<TargetEntry, ContextEntry>
  /** Targets attached now existed before the connection: they are adopted. */
  attachedAtConnect: boolean
  defaultUserAgent: string
}

/** A connection's empty state, with the release that retiring a request needs (`responses.ts`). */
export const make = (options: {
  readonly cleanupScope: Scope.Scope
  readonly connect: Adapter.ConnectOptions
  readonly handlers: Kit.Handlers<Event>
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  readonly root: () => ProtocolClient.Session
  readonly release: (state: State, request: RequestEntry) => void
}): State => {
  const requests = new Map<string, RequestEntry>()
  const hops = new Map<NetworkRequest.HopId, RequestEntry>()
  const state: State = {
    handlers: options.handlers,
    cleanupScope: options.cleanupScope,
    captures: new Set(),
    options: options.connect,
    ids: options.ids,
    buffer: options.buffer,
    control: options.control,
    root: options.root,
    registry: Declarations.make(),
    defaultContext: options.ids.userContext(),
    contexts: new Map(),
    contextsByCdp: new Map(),
    targets: new Map(),
    targetsById: new Map(),
    reservedIds: new Map(),
    pages: new Map(),
    endedPages: new Map(),
    frames: new Map(),
    navigables: new Map(),
    documents: new Map(),
    documentsByLoader: new Map(),
    realms: new Map(),
    realmsByContext: new Map(),
    realmsByUnique: new Map(),
    navigations: new Map(),
    requests,
    hops,
    retire: Retired.make((key: string) => {
      const request = requests.get(key)
      if (request === undefined) return
      // A response still waiting for its headers goes with the ones it has
      options.release(state, request)
      requests.delete(key)
      for (let hop = 0; hop <= request.redirects; hop++) hops.delete(state.ids.hop(request.id, hop))
    }),
    pendingAttribution: new Map(),
    credentialsAttempted: new Map(),
    earlyHeaders: new Map(),
    answeredLocally: new Set(),
    routeFailed: new Set(),
    obligations: new Map(),
    downloads: new Map(),
    retiredFrames: new Map(),
    downloadsById: new Map(),
    handles: new Map(),
    groups: Groups.make(),
    connections: new Map(),
    drags: new Map(),
    interceptingDrags: new Set(),
    heldButtons: new Map(),
    touchCapture: new Map(),
    pressedIn: new Map(),
    pressedOn: new Map(),
    escapeCanceled: new Set(),
    workerContexts: new Map(),
    attachedAtConnect: true,
    defaultUserAgent: ""
  }
  return state
}

/** What a fold handler gets beside the event's params: the state, and the target whose session sent it. */
export interface Event {
  readonly state: State
  readonly target: TargetEntry | undefined
}

/** The native target's cached dispatch. Ordinary targets share the connection's default table. */
export interface DispatchContext extends Event {
  target: TargetEntry | undefined
  handlers: Kit.Handlers<Event>
}
export const dispatchContext = (state: State, target: TargetEntry | undefined): DispatchContext => ({
  state,
  target,
  handlers: state.handlers
})

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────

export const contextKey = (target: TargetEntry, contextId: number) => `${target.session.key ?? ""}|${contextId}`

export const requestKey = (target: TargetEntry, requestId: string) => `${target.session.key ?? ""}|${requestId}`

/**
 * What a request's `Network` id is unique within for credentials: its page, whose own and whose dedicated
 * workers' requests share ids, or the target itself when it has none.
 */
export const credentialsScope = (target: TargetEntry) =>
  target.page !== undefined ? pageCredentialsScope(target.page) : `session|${target.session.key ?? ""}`

export const pageCredentialsScope = (page: PageEntry) => `page|${page.id}`

export const frameOf = (state: State, frameId: string | undefined) =>
  frameId === undefined ? undefined : state.frames.get(frameId)

/** Where a page sits, for the declarations registry. */
export const placement = (page: PageEntry): Declarations.Placement => ({ page: page.id, context: page.context.id })

/**
 * Where a target's declarations are read: its page's, or for a service or shared worker, which has no page, its
 * context's. A worker of no context Strider knows has none, and takes no declaration.
 */
export const placementOf = (state: State, target: TargetEntry): Declarations.Placement | undefined => {
  if (target.page !== undefined) return placement(target.page)
  const context = state.workerContexts.get(target)
  return context === undefined ? undefined : { context: context.id }
}

/** A service or shared worker: a worker with no page, whose declarations are its context's. */
export const pageless = (target: TargetEntry) => target.kind === "service_worker" || target.kind === "shared_worker"

/** Where a context's downloads go, if a declaration allows them to a directory. */
export const downloadDirectory = (state: State, context: UserContext.Id) => {
  const behavior = state.registry.downloads(context)
  return Option.isSome(behavior) && behavior.value._tag === "Allow"
    ? Option.fromUndefinedOr(behavior.value.directory)
    : Option.none<string>()
}

/**
 * Starts keeping a new context's ended frames when a browser-wide declaration in force gives its downloads a
 * directory, as one registered later does for the contexts it finds.
 */
export const keepEndedFramesIfDeclared = (state: State, context: ContextEntry) => {
  if (!context.isDefault && Option.isSome(downloadDirectory(state, context.id))) context.keepsEndedFrames = true
}

/**
 * Keeps which context a frame that ended belonged to, while a declaration has given the context's downloads a
 * directory (`ContextEntry.keepsEndedFrames`), whether registered for it or browser-wide, through the context's
 * retirement: a download Chromium announces after the frame has gone is that context's. Nothing is kept for the
 * default context, which is never removed, or for one already disposed.
 */
export const retireFrame = (state: State, context: ContextEntry, frameId: string) => {
  if (context.isDefault || context.disposed || context.keepsEndedFrames !== true) return
  state.retiredFrames.set(frameId, context)
  ;(context.retiredFrames ??= new Set()).add(frameId)
}

/**
 * Forgets the frames of `context` that ended, and stops keeping them: when the declaration that gave its downloads a
 * directory is released with the context left open, and when the context is removed.
 */
export const forgetRetiredFrames = (state: State, context: ContextEntry) => {
  context.keepsEndedFrames = false
  for (const frameId of context.retiredFrames ?? []) state.retiredFrames.delete(frameId)
  context.retiredFrames = undefined
}

// ── Lookups: an id this connection minted that ended is Gone, any other Foreign ───────────────────────────

const pageGone = (state: State, id: L1Target.NavigableId) =>
  Kit.gone({ _tag: "Page", id }, state.endedPages.get(id) ?? new L1Target.Vanished({}))

/** A page as the model holds it now, even while its initial sync runs: for what must not wait on that sync. */
export const pageNow = (state: State, id: L1Target.NavigableId): Effect.Effect<PageEntry, Adapter.AdapterError> =>
  Kit.lookup(state.ids, state.pages, id, () => pageGone(state, id), (page) => !page.ended)

// A page Strider didn't open (a persistent profile's first tab, a tab open when it attached) is listed as it
// attaches, before its initial sync has applied the frame tree. The sync discards every event received before the
// tree's reply, since the tree stands for them, so a command sent to the page in that window loses the events it
// causes: a navigation's commit, its requests, a paused request no one continues (which also keeps Chromium from
// answering the tree). An operation on a page therefore waits for the sync before it sends anything, as `newPage`
// does, and whatever the page commits before then is the document it opened with, not a navigation after it.
// Nothing the sync runs goes through here. An operation that can cause events waits; a release, such as a forced
// close, or a decision on something already known, such as answering an open prompt, uses `pageNow`, since a sync
// can hang.
const synced = <A>(page: PageEntry, found: Effect.Effect<A, Adapter.AdapterError>) =>
  Deferred.isDoneUnsafe(page.ready) ? found : Effect.andThen(Effect.ignore(Deferred.await(page.ready)), found)

/** A page, once its initial sync is applied. */
export const pageOf = (state: State, id: L1Target.NavigableId): Effect.Effect<PageEntry, Adapter.AdapterError> =>
  Effect.flatMap(pageNow(state, id), (page) => synced(page, pageNow(state, id)))

/** A frame, once its page's initial sync is applied. */
export const frameById = (state: State, id: L1Target.NavigableId): Effect.Effect<FrameEntry, Adapter.AdapterError> =>
  Effect.flatMap(frameNow(state, id), (frame) => synced(frame.page, frameNow(state, id)))

const frameNow = (state: State, id: L1Target.NavigableId): Effect.Effect<FrameEntry, Adapter.AdapterError> =>
  Kit.lookup(
    state.ids,
    state.navigables,
    id,
    () =>
      state.endedPages.has(id) ? pageGone(state, id) : Kit.gone({ _tag: "Frame", id }, new L1Target.FrameDetached({})),
    (frame) => !frame.removed
  )

export const contextOf = (state: State, id: UserContext.Id): Effect.Effect<ContextEntry, Adapter.AdapterError> =>
  Kit.lookup(
    state.ids,
    state.contexts,
    id,
    () => Kit.gone({ _tag: "UserContext" }, new L1Target.UserContextRemoved({}))
  )

export const documentOf = (
  state: State,
  id: L1Target.DocumentId
): Effect.Effect<DocumentEntry, Adapter.AdapterError> =>
  Kit.lookup(
    state.ids,
    state.documents,
    id,
    () => Kit.gone({ _tag: "Document", id }, new L1Target.DocumentReplaced({}))
  )

export const realmOf = (state: State, id: L1Target.RealmId): Effect.Effect<RealmEntry, Adapter.AdapterError> =>
  Kit.lookup(
    state.ids,
    state.realms,
    id,
    () => Kit.gone({ _tag: "Realm", id }, new L1Target.RealmDestroyed({})),
    (realm) => !realm.ended
  )
