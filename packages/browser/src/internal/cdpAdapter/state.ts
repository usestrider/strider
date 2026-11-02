/**
 * The CDP adapter's state: its tables from CDP's ids to L1's, and the kit's pieces, in one object every module of
 * the adapter takes (`adapterKit.ts`).
 *
 * Identity: frames are keyed by frame id, documents by loader id, realms by `uniqueId` (context ids repeat after a
 * process swap), navigations by loader id, requests by session and request id.
 */
import type * as Deferred from "effect/Deferred"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Semaphore from "effect/Semaphore"
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

export interface ContextEntry {
  readonly id: UserContext.Id
  /** CDP's id; the default context's too, once a page in it reports it. */
  browserContextId: string | undefined
  readonly isDefault: boolean
  removing: boolean
}

export type TargetKind = "page" | "iframe" | "worker" | "service_worker" | "shared_worker" | "other"

export interface TargetEntry {
  readonly kind: TargetKind
  readonly targetId: string
  readonly session: ProtocolClient.Session
  readonly page: PageEntry | undefined
  /** For an out-of-process frame: the frame its session owns. */
  readonly frame: FrameEntry | undefined
  readonly url: string
  /** For a worker: its realm, once its context is created. */
  realm: RealmEntry | undefined
  /** The intercept patterns last applied, so a change is applied once. */
  intercepts: string
  readonly scripts: Map<string, string>
  ended: boolean
  /** Original renderer dimensions, retained until viewport restoration completes. */
  viewport?: { readonly width: number; readonly height: number } | undefined
  viewportLock?: Semaphore.Semaphore | undefined
}

export interface PageEntry {
  readonly id: L1Target.NavigableId
  readonly targetId: string
  readonly context: ContextEntry
  readonly target: TargetEntry
  readonly ready: Deferred.Deferred<void, Adapter.AdapterError>
  closing: L1Target.CloseReason | undefined
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

export interface NavigationEntry extends Kit.NavigationNode {
  readonly frame: FrameEntry
  readonly loaderId: string
  readonly url: string
  readonly sameDocument: boolean
  /** A move through history, which may restore a document from the back/forward cache. */
  readonly traversal: boolean
  documentHop: NetworkRequest.HopId | undefined
  status: number | undefined
  failed: string | undefined
}

/** A hop's headers as the network sent or received them, from an `ExtraInfo` event. */
export interface ExtraInfo {
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
  /** Announced after the gesture that started it was released (QUIRKS.md, Q88). */
  readonly stale: boolean
}

// ── The state ─────────────────────────────────────────────────────────────────────────────────────────────

export interface State {
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
  /** ExtraInfo that came before its request, by request key; a few hundred at most. */
  readonly earlyHeaders: Map<string, Array<ExtraInfo>>
  /** Requests a route failed, by their `Network` key: an abort a route made has nothing after it to end it. */
  readonly routeFailed: Set<string>
  readonly obligations: Map<Adapter.ObligationId, ObligationEntry>
  readonly downloads: Map<string, DownloadEntry>
  readonly downloadsById: Map<Download.Id, DownloadEntry>
  readonly handles: Map<Adapter.HandleId, HandleEntry>
  readonly groups: Groups.Groups
  readonly connections: Map<string, NetworkConnection.Id>
  /** HTML drags Chromium started and the adapter intercepted, by page, until they are dropped or the page ends. */
  readonly drags: Map<L1Target.NavigableId, DragEntry>
  readonly interceptingDrags: Set<L1Target.NavigableId>
  /** The buttons each page's last mouse event left held, until the page ends. */
  readonly heldButtons: Map<L1Target.NavigableId, number>
  /** A worker no page owns belongs to the context its target names. */
  readonly workerContexts: Map<TargetEntry, ContextEntry>
  /** Targets attached now existed before the connection: they are adopted. */
  attachedAtConnect: boolean
  defaultUserAgent: string
}

/** A connection's empty state, with the release that retiring a request needs (`responses.ts`). */
export const make = (options: {
  readonly connect: Adapter.ConnectOptions
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  readonly root: () => ProtocolClient.Session
  readonly release: (state: State, request: RequestEntry) => void
}): State => {
  const requests = new Map<string, RequestEntry>()
  const hops = new Map<NetworkRequest.HopId, RequestEntry>()
  const state: State = {
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
    earlyHeaders: new Map(),
    routeFailed: new Set(),
    obligations: new Map(),
    downloads: new Map(),
    downloadsById: new Map(),
    handles: new Map(),
    groups: Groups.make(),
    connections: new Map(),
    drags: new Map(),
    interceptingDrags: new Set(),
    heldButtons: new Map(),
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

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────

export const contextKey = (target: TargetEntry, contextId: number) => `${target.session.key ?? ""}|${contextId}`

export const requestKey = (target: TargetEntry, requestId: string) => `${target.session.key ?? ""}|${requestId}`

export const frameOf = (state: State, frameId: string | undefined) =>
  frameId === undefined ? undefined : state.frames.get(frameId)

/** Where a page sits, for the declarations registry. */
export const placement = (page: PageEntry): Declarations.Placement => ({ page: page.id, context: page.context.id })

/** Where a context's downloads go, if a declaration allows them to a directory. */
export const downloadDirectory = (state: State, context: UserContext.Id) => {
  const behavior = state.registry.downloads(context)
  return Option.isSome(behavior) && behavior.value._tag === "Allow"
    ? Option.fromUndefinedOr(behavior.value.directory)
    : Option.none<string>()
}

// ── Lookups: an id this connection minted that ended is Gone, any other Foreign ───────────────────────────

const pageGone = (state: State, id: L1Target.NavigableId) =>
  Kit.gone({ _tag: "Page", id }, state.endedPages.get(id) ?? new L1Target.Vanished({}))

export const pageOf = (state: State, id: L1Target.NavigableId): Effect.Effect<PageEntry, Adapter.AdapterError> =>
  Kit.lookup(state.ids, state.pages, id, () => pageGone(state, id), (page) => !page.ended)

export const frameById = (state: State, id: L1Target.NavigableId): Effect.Effect<FrameEntry, Adapter.AdapterError> =>
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
