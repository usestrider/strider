/**
 * The WebKit adapter's state: its tables from WebKit's ids to L1's, and the kit's pieces, in one object every module
 * of the adapter takes (`adapterKit.ts`).
 *
 * Identity: stock WebKit numbers frames, loaders and requests from `0.1` in each web process (QUIRKS.md, Q195), and
 * a page's targets are its processes, so each is keyed by the session of the target that named it: frames
 * (`frameKey`), loaders (`loaderKey`), requests (`requestKey`) and execution contexts (`contextKey`). Commands take
 * the target's own ids, as WebKit gave them.
 */
import type * as Cache from "effect/Cache"
import type * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Semaphore from "effect/Semaphore"
import type * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Browser from "../../Browser.ts"
import type * as Dialog from "../../Dialog.ts"
import type * as NetworkConnection from "../../NetworkConnection.ts"
import type * as NetworkRequest from "../../NetworkRequest.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import type * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Automation from "../../webkit-automation-protocol/Automation.ts"
import type * as Console from "../../webkit-stock-protocol/Console.ts"
import type * as Network from "../../webkit-stock-protocol/Network.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import * as Groups from "../objectGroups.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Retired from "../retired.ts"
import type * as WebKitAutomation from "../webkitAutomation.ts"
import * as WebKitWire from "../webkitWire.ts"

// ── Entries ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ContextEntry {
  readonly requestTiming?: Map<string, import("../requestTiming.ts").Collector> | undefined
  readonly id: UserContext.Id
  /** WebKit's id; the default context's too, once a page in it reports it. */
  browserContextId: string | undefined
  readonly isDefault: boolean
  removing: boolean
}

export interface PageEntry {
  event: Event
  readonly id: L1Target.NavigableId
  readonly pageProxyId: string
  readonly session: ProtocolClient.Session
  readonly context: ContextEntry
  /** Document body reads still using this page’s resources, independent of the bounded request history. */
  readonly retaining: Set<RequestEntry>
  readonly popup: boolean
  readonly ready: Deferred.Deferred<void, Adapter.AdapterError>
  /** The committed target, and the one a cross-site navigation is loading in. */
  target: TargetEntry | undefined
  provisional: TargetEntry | undefined
  readonly main: FrameEntry
  /** The open dialog's obligation, so that only an open dialog is answered. */
  dialog: Adapter.ObligationId | undefined
  viewportFailure?: Adapter.AdapterError | undefined
  closing: L1Target.CloseReason | undefined
  ended: boolean
}

export interface TargetEntry {
  event: Event
  readonly targetId: string
  readonly session: ProtocolClient.Session
  readonly page: PageEntry
  /** The main frame's key in this target's process (`frameKey`). */
  mainFrameId: string | undefined
  /** The intercepts last applied, so that a change is applied once. */
  intercepts: ReadonlyArray<{ readonly url: string; readonly stage: "request" | "response" }>
  /** The last message, which a repeat count update repeats. */
  lastConsole: Console.ConsoleMessage | undefined
  ended: boolean
}

export interface WorkerEntry {
  event: Event
  readonly workerId: string
  readonly session: ProtocolClient.Session
  readonly target: TargetEntry
  readonly url: string
  realm: RealmEntry | undefined
  lastConsole: Console.ConsoleMessage | undefined
}

export interface FrameEntry extends Kit.NavigableNode<FrameEntry> {
  /** The frame's key in its current target (`frameKey`). */
  frameId: string
  readonly page: PageEntry
  document: DocumentEntry | undefined
  /** Navigations started by a command that the browser hasn't announced yet, oldest first. */
  readonly expected: Kit.Expectations
  readonly navigations: Map<string, NavigationEntry>
}

export interface DocumentEntry {
  readonly id: L1Target.DocumentId
  readonly frame: FrameEntry
  /** Its loader's key (`loaderKey`). */
  loaderId: string
  url: string
  readonly realms: Set<RealmEntry>
  interactive: boolean
  complete: boolean
  generation: number
}

export interface RealmEntry extends Kit.RealmNode {
  /** The session evaluations go to: the target's, or the worker's. */
  readonly session: ProtocolClient.Session
  /** The execution context; `undefined` for a worker's global scope. */
  readonly contextId: number | undefined
  readonly target: TargetEntry
  readonly document: DocumentEntry | undefined
  readonly world: Adapter.World
}

export interface NavigationEntry extends Kit.NavigationNode {
  readonly frame: FrameEntry
  /** Its loader's key (`loaderKey`). */
  readonly loaderId: string
  readonly url: string
  readonly sameDocument: boolean
  documentHop: NetworkRequest.HopId | undefined
  status: number | undefined
  /** Whether its response asked to be saved, `Content-Disposition: attachment`. */
  attachment: boolean
}

export interface RequestEntry {
  readonly id: NetworkRequest.Id
  readonly session: ProtocolClient.Session
  /** WebKit's id, its target's own. */
  readonly requestId: string
  /** The request event’s loader key, when reported. */
  readonly loaderId: string | undefined
  redirects: number
  hop: NetworkRequest.HopId
  /** The last hop a response was reported for: WebKit can report one twice. */
  responded: NetworkRequest.HopId | undefined
  url: string
  readonly frame: FrameEntry | undefined
  readonly navigation: NavigationEntry | undefined
  readonly worker: WorkerEntry | undefined
  /** Completes when the last hop finishes loading, or fails with the browser's error text. */
  readonly finished: Deferred.Deferred<void, string>
  /** A route fulfilled it. */
  fulfilled: boolean
  /** What its events called it: a pause doesn't say. */
  readonly resourceType: NetworkRequest.ResourceType
  /** Each hop's body, as `Network.requestWillBeSent` carried it, text (Q164; Q221). */
  readonly postData: Array<string | undefined>
  /** The current hop's headers as the request event gave them, which leave its cookies out (Q158). */
  requestHeaders: Network.Headers
  /**
   * A document's response body, read as its load finished where a body collection is declared: WebKit forgets it
   * once the page navigates on (Q179).
   */
  kept: Deferred.Deferred<Uint8Array, Adapter.AdapterError> | undefined
}

export type ObligationEntry =
  | {
    readonly _tag: "PausedRequest"
    readonly id: Adapter.ObligationId
    readonly target: TargetEntry
    readonly requestId: string
    readonly phase: "request" | "response"
    /** The request's body, as stock WebKit's text (QUIRKS.md, Q221). */
    readonly postData: string | undefined
  }
  | {
    readonly _tag: "Prompt"
    readonly id: Adapter.ObligationId
    readonly prompt: Dialog.PromptId
    readonly page: PageEntry
    /** The answer sent, reported when the dialog closes. */
    answer: { readonly accepted: boolean; readonly userText: Option.Option<string> } | undefined
  }

export interface HandleEntry {
  readonly session: ProtocolClient.Session
  /** The realm it was made in, whose anchor its group shares. */
  readonly realm: L1Target.RealmId
  readonly objectId: string
  /** The object group it was made in (Q132). */
  readonly group: string | undefined
}

// ── The state ─────────────────────────────────────────────────────────────────────────────────────────────

export interface State {
  readonly handlers: Kit.Handlers<Event>
  readonly options: Adapter.ConnectOptions
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  /** The browser's session, once the client is made: the fold never needs it. */
  readonly root: () => ProtocolClient.Session
  readonly capabilities: SubscriptionRef.SubscriptionRef<Browser.CapabilitySet>
  readonly registry: Declarations.Registry
  readonly defaultContext: UserContext.Id
  readonly contexts: Map<UserContext.Id, ContextEntry>
  readonly contextsByWk: Map<string, ContextEntry>
  readonly pages: Map<L1Target.NavigableId, PageEntry>
  /** Why each page that ended did, for an operation that names it after. */
  readonly endedPages: Map<L1Target.NavigableId, L1Target.CloseReason>
  readonly pagesByProxy: Map<string, PageEntry>
  readonly targets: Map<ProtocolClient.Session, TargetEntry>
  readonly workers: Map<ProtocolClient.Session, WorkerEntry>
  readonly frames: Map<string, FrameEntry>
  readonly navigables: Map<L1Target.NavigableId, FrameEntry>
  readonly documents: Map<L1Target.DocumentId, DocumentEntry>
  readonly realms: Map<L1Target.RealmId, RealmEntry>
  readonly realmsByContext: Map<string, RealmEntry>
  readonly navigations: Map<string, NavigationEntry>
  readonly requests: Map<string, RequestEntry>
  readonly hops: Map<NetworkRequest.HopId, RequestEntry>
  /** Retires a finished request by its key: finished requests stay answerable while there is room (Q177). */
  readonly retire: (key: string) => void
  readonly obligations: Map<Adapter.ObligationId, ObligationEntry>
  readonly handles: Map<Adapter.HandleId, HandleEntry>
  readonly groups: Groups.Groups
  /** Each realm's helper (`webkitUtility.ts`), installed on first use; a failure is forgotten at once. */
  readonly helpers: Cache.Cache<L1Target.RealmId, string, Adapter.AdapterError>
  /** Each object group's anchor in a realm, an object made in it, by `anchorKey` (QUIRKS.md, Q132 and Q185). */
  readonly anchors: Cache.Cache<string, string, Adapter.AdapterError>
  readonly connections: Map<string, NetworkConnection.Id>
  /** Requests each target has paused and not resolved: its interception stays on while there are any. */
  readonly pausedRequests: Map<TargetEntry, number>
  /** A failed navigation whose error page loads next, by its frame (QUIRKS.md, Q199). */
  readonly errorPageFor: Map<FrameEntry, PageNavigation.Id>
  /** The navigation each error page's loader stands for. */
  readonly errorLoaders: Map<string, PageNavigation.Id>
  /** Targets attached now existed before the connection: they are adopted. */
  attachedAtConnect: boolean
  /** Launched: the browser processes, a context's each, whose Automation sessions make and drive pages. */
  readonly automation: WebKitAutomation.Group | undefined
  /** Launched stock WebKit's pages being made, by context, so the page announced next in it is the one made. */
  readonly creating: Map<string, number>
  /** Each page's Automation handle, once paired, and the handles paired (QUIRKS.md, Q219). */
  readonly pageHandles: Map<PageEntry, Automation.BrowsingContextHandle>
  readonly pairedHandles: Set<string>
  readonly pairing: Semaphore.Semaphore
  /** The window's size less the viewport's, measured once per process: its toolbar. */
  readonly chrome: Map<string, { readonly width: number; readonly height: number }>
  /** Each page's window as it was before its first resize, to restore when the viewport is released. */
  readonly naturalViewports: WeakMap<PageEntry, { readonly width: number; readonly height: number }>
  readonly naturalWindows: WeakMap<PageEntry, { readonly width: number; readonly height: number }>
  /** Each process's wheel state so far: a session's wheel scrolls by the difference (QUIRKS.md, Q223). */
  readonly wheelStates: Map<string, { width: number; height: number }>
  /** Each frame's Automation handle, once found. */
  readonly frameHandles: WeakMap<FrameEntry, Automation.FrameHandle>
}

/** A connection's empty state. */
export const make = (options: {
  readonly connect: Adapter.ConnectOptions
  readonly handlers: Kit.Handlers<Event>
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  readonly root: () => ProtocolClient.Session
  readonly capabilities: SubscriptionRef.SubscriptionRef<Browser.CapabilitySet>
  readonly helpers: Cache.Cache<L1Target.RealmId, string, Adapter.AdapterError>
  readonly anchors: Cache.Cache<string, string, Adapter.AdapterError>
  readonly pairing: Semaphore.Semaphore
  readonly automation: WebKitAutomation.Group | undefined
}): State => {
  const requests = new Map<string, RequestEntry>()
  const hops = new Map<NetworkRequest.HopId, RequestEntry>()
  const defaultContext = options.ids.userContext()
  return {
    handlers: options.handlers,
    options: options.connect,
    ids: options.ids,
    buffer: options.buffer,
    control: options.control,
    root: options.root,
    capabilities: options.capabilities,
    registry: Declarations.make(),
    defaultContext,
    contexts: new Map([[defaultContext, {
      id: defaultContext,
      browserContextId: undefined,
      isDefault: true,
      removing: false
    }]]),
    contextsByWk: new Map(),
    pages: new Map(),
    endedPages: new Map(),
    pagesByProxy: new Map(),
    targets: new Map(),
    workers: new Map(),
    frames: new Map(),
    navigables: new Map(),
    documents: new Map(),
    realms: new Map(),
    realmsByContext: new Map(),
    navigations: new Map(),
    requests,
    hops,
    retire: Retired.make((key: string) => {
      const request = requests.get(key)
      if (request === undefined) return
      requests.delete(key)
      for (let hop = 0; hop <= request.redirects; hop++) hops.delete(options.ids.hop(request.id, hop))
    }),
    obligations: new Map(),
    handles: new Map(),
    groups: Groups.make(),
    helpers: options.helpers,
    anchors: options.anchors,
    connections: new Map(),
    pausedRequests: new Map(),
    errorPageFor: new Map(),
    errorLoaders: new Map(),
    attachedAtConnect: true,
    automation: options.automation,
    creating: new Map(),
    pageHandles: new Map(),
    pairedHandles: new Set(),
    pairing: options.pairing,
    chrome: new Map(),
    naturalViewports: new WeakMap(),
    naturalWindows: new WeakMap(),
    wheelStates: new Map(),
    frameHandles: new WeakMap()
  }
}

/** What a fold handler gets beside the event's params: the state, and where the session that sent it is. */
export interface Event {
  state: State
  handlers: Kit.Handlers<Event>
  readonly session: ProtocolClient.Session
  readonly page: PageEntry | undefined
  readonly target: TargetEntry | undefined
  readonly worker: WorkerEntry | undefined
}

/** A prebound native dispatch context; its default table is shared and has no optional feature probes. */
export const eventContext = (
  state: State,
  session: ProtocolClient.Session,
  page: PageEntry | undefined,
  target: TargetEntry | undefined,
  worker: WorkerEntry | undefined
): Event => ({ state, handlers: state.handlers, session, page, target, worker })

/** Where a session is: a worker's, a target's, or a page proxy's. */
export const eventOf = (state: State, session: ProtocolClient.Session): Event => {
  const worker = state.workers.get(session)
  if (worker !== undefined) return worker.event
  const target = state.targets.get(session)
  if (target !== undefined) return target.event
  const key = session.key
  if (key === undefined) return eventContext(state, session, undefined, undefined, undefined)
  const route = WebKitWire.route(key)
  const page = state.pagesByProxy.get(route.pageProxyId)
  return page !== undefined && page.session === session
    ? page.event
    : eventContext(page?.event.state ?? state, session, page, undefined, undefined)
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────

export const contextKey = (target: TargetEntry, contextId: number) => `${target.session.key ?? ""}|${contextId}`

export const requestKey = (session: ProtocolClient.Session, requestId: string) => `${session.key ?? ""}|${requestId}`

/** A frame's key: its id, which its target's process numbered. */
export const frameKey = (target: TargetEntry, frameId: string) => `${target.session.key ?? ""}|${frameId}`

/** A loader's key: its id, which its target's process numbered. */
export const loaderKey = (target: TargetEntry, loaderId: string) => `${target.session.key ?? ""}|${loaderId}`

/** An object group's anchor's key: the realm it's made in, and the group. */
export const anchorKey = (realm: L1Target.RealmId, group: string) => JSON.stringify([realm, group])

/** The realm an anchor's key names. */
export const anchorRealm = (key: string): L1Target.RealmId => (JSON.parse(key) as [L1Target.RealmId, string])[0]

/** The group an anchor's key names. */
export const anchorGroup = (key: string): string => (JSON.parse(key) as [string, string])[1]

/** Where a page sits, for the declarations registry. */
export const placement = (page: PageEntry): Declarations.Placement => ({ page: page.id, context: page.context.id })

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

/** A page's committed target, which ends when the page does, or crashes. */
export const targetOf = (page: PageEntry): Effect.Effect<TargetEntry, Adapter.AdapterError> =>
  Effect.suspend(() =>
    page.target === undefined || page.target.ended
      ? Effect.fail(Kit.gone({ _tag: "Page", id: page.id }, page.closing ?? new L1Target.PageCrashed({})))
      : Effect.succeed(page.target)
  )

/**
 * A command's reply, or `None` where the browser refused it or its target went; one that got no reply, as when its
 * operation's deadline passed, still fails.
 */
export const answered = <A, R>(effect: Effect.Effect<A, Protocol.ProtocolError, R>) =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catchIf((error) => error.reason._tag !== "NoReply", () => Effect.succeedNone),
    Kit.protocol
  )
