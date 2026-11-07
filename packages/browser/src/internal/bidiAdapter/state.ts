/**
 * The BiDi adapter's state: its tables from BiDi's ids to L1's, and the kit's pieces, in one object every module of
 * the adapter takes (`adapterKit.ts`).
 *
 * Identity: user contexts are keyed by BiDi's user context (`"default"` for the default one), navigables by their
 * browsing context, realms by BiDi's realm, navigations by BiDi's navigation id (or one made up for a navigation
 * BiDi gives none), requests by BiDi's request id. Every event arrives on the connection's one session.
 */
import type * as Deferred from "effect/Deferred"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as BrowserBidi from "../../bidi-protocol/Browser.ts"
import type * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import type * as Network from "../../bidi-protocol/Network.ts"
import type * as Script from "../../bidi-protocol/Script.ts"
import type * as Dialog from "../../Dialog.ts"
import type * as Download from "../../Download.ts"
import type * as NetworkRequest from "../../NetworkRequest.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Retired from "../retired.ts"

// ── Entries ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ContextEntry {
  readonly id: UserContext.Id
  /** BiDi's id: `"default"` for the default context. */
  readonly bidi: BrowserBidi.UserContext
  removing: boolean
}

export interface NavigableEntry extends Kit.NavigableNode<NavigableEntry> {
  readonly bidi: BrowsingContext.BrowsingContext
  readonly context: ContextEntry
  /** The page: itself for a top-level context. */
  readonly page: NavigableEntry
  closing: L1Target.CloseReason | undefined
  document: DocumentEntry | undefined
  /** Main-world realms created for the next document, before it commits. */
  readonly pendingRealms: Array<RealmEntry>
  /** A successful traversal awaiting its replacement main realm, correlated to its reservation. */
  restoring: {
    readonly navigation: PageNavigation.Id
    readonly arrived: (realm: RealmEntry) => void
  } | undefined
  /** Navigations started by a command that the browser hasn't announced yet, oldest first. */
  readonly expected: Kit.Expectations
  /** Commands awaiting replies; unknown error commits wait for their navigation identities. */
  readonly navigationCommands: Set<PageNavigation.Id>
  readonly commandNavigations: Map<string, Kit.Expected>
  /** Only unresolved terminal correlation waits; observation and other lifecycle events never wait behind it. */
  readonly pendingTerminals: Array<{
    readonly kind: "commit" | "failure" | "abort"
    readonly params: BrowsingContext.NavigationInfo
    readonly document?: L1Target.DocumentId | undefined
    readonly rejected?: (Kit.Expected & { readonly bidi?: string | undefined }) | undefined
  }>
  /** The last failure can still install its error document. */
  failedNavigation: (Kit.Expected & { readonly bidi?: string | undefined }) | undefined
  readonly navigations: Map<string, NavigationEntry>
  /** The documents it had, by URL: what a restore from the back/forward cache restores. */
  readonly past: Map<string, L1Target.DocumentId>
}

export interface DocumentEntry {
  readonly id: L1Target.DocumentId
  readonly navigable: NavigableEntry
  url: string
  generation: number
  /** The navigation that created it, whose readiness events are this document's. */
  navigation: string | undefined
  readonly realms: Set<RealmEntry>
  hadMainRealm: boolean
  complete: boolean
}

export interface RealmEntry extends Kit.RealmNode {
  readonly bidi: Script.Realm
  readonly navigable: NavigableEntry | undefined
  readonly world: Adapter.World
  readonly origin: string
}

export interface NavigationEntry extends Kit.NavigationNode {
  readonly bidi: string
  readonly navigable: NavigableEntry
  readonly url: string
  readonly sameDocument: boolean
  /** A move through history, which may restore a document from the back/forward cache. */
  readonly traversal: boolean
  documentHop: NetworkRequest.HopId | undefined
  status: number | undefined
}

export interface RequestEntry {
  readonly id: NetworkRequest.Id
  readonly bidi: Network.Request
  redirects: number
  hop: NetworkRequest.HopId
  readonly navigable: NavigableEntry | undefined
  readonly navigation: NavigationEntry | undefined
  readonly finished: Deferred.Deferred<void, string>
  /** A route fulfilled it, which Firefox reports as an ordinary response. */
  fulfilled: boolean
  /**
   * Each hop's request body size, `null` where Firefox doesn't say: a request's data is its first body, which a
   * hop that sent none still answers with (QUIRKS.md, Q183).
   */
  readonly bodySizes: Array<number | null>
}

export type Phase = "request" | "response" | "auth"

export type ObligationEntry =
  | {
    readonly _tag: "PausedRequest"
    readonly id: Adapter.ObligationId
    readonly request: Network.Request
    readonly phase: Phase
    /** The headers it was sent with, which a new body's `Content-Length` replaces one of. */
    readonly headers: ReadonlyArray<Network.Header>
  }
  | {
    readonly _tag: "Prompt"
    readonly id: Adapter.ObligationId
    readonly prompt: Dialog.PromptId
    readonly context: BrowsingContext.BrowsingContext
  }
  | {
    readonly _tag: "FileChooser"
    readonly id: Adapter.ObligationId
    readonly context: BrowsingContext.BrowsingContext
    readonly element: Script.SharedId | undefined
  }

export interface InterceptEntry {
  readonly registration: Adapter.RegistrationId
  readonly bidi: Network.Intercept
  readonly scope: Adapter.DeclarationScope
  readonly globs: ReadonlyArray<RegExp>
  readonly phases: ReadonlyArray<Phase>
}

export interface DownloadEntry {
  readonly id: Download.Id
  path: string | undefined
}

export interface HandleEntry {
  readonly handle: Script.Handle
  readonly realm: Script.Realm
}

// ── The state ─────────────────────────────────────────────────────────────────────────────────────────────

export interface State {
  /** Connection-owned declaration cleanup can finish after its caller stops waiting. */
  readonly cleanupScope: Scope.Scope
  readonly options: Adapter.ConnectOptions
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  /** The connection's one session, once the client is made: the fold never needs it. */
  readonly root: () => ProtocolClient.Session
  /** Sends a command on the session. */
  readonly send: <M extends string, P, A>(
    command: Protocol.Command<M, P, A>
  ) => Effect.Effect<A, Protocol.ProtocolError>
  readonly registry: Declarations.Registry
  readonly defaultContext: UserContext.Id
  readonly contexts: Map<UserContext.Id, ContextEntry>
  readonly contextsByBidi: Map<string, ContextEntry>
  readonly navigables: Map<string, NavigableEntry>
  readonly navigablesById: Map<L1Target.NavigableId, NavigableEntry>
  /** Why each page that ended did, for an operation that names it after. */
  readonly endedPages: Map<L1Target.NavigableId, L1Target.CloseReason>
  readonly documents: Map<L1Target.DocumentId, DocumentEntry>
  readonly realms: Map<string, RealmEntry>
  readonly realmsById: Map<L1Target.RealmId, RealmEntry>
  /** The page of each dedicated worker, from its owner. */
  readonly workerPages: Map<RealmEntry, NavigableEntry>
  readonly navigations: Map<string, NavigationEntry>
  readonly requests: Map<string, RequestEntry>
  readonly hops: Map<NetworkRequest.HopId, RequestEntry>
  /** Retires a finished request by its BiDi id: finished requests stay answerable while there is room (Q177). */
  readonly retire: (key: string) => void
  readonly obligations: Map<Adapter.ObligationId, ObligationEntry>
  readonly downloads: Map<string, DownloadEntry>
  readonly downloadsById: Map<Download.Id, DownloadEntry>
  readonly handles: Map<Adapter.HandleId, HandleEntry>
  readonly intercepts: Map<Adapter.RegistrationId, InterceptEntry>
  /** Body collections' data collectors. */
  readonly collectors: Map<Adapter.RegistrationId, Network.Collector>
  /** A request data collector for each intercept with a request phase, so a route can read a body. */
  readonly requestCollectors: Map<Adapter.RegistrationId, Network.Collector>
  /** Permissions granted, by context, as `[origin, name]` JSON: BiDi has no reset, so they are set back. */
  readonly granted: Map<UserContext.Id, Set<string>>
  /** The preload scripts registered, in order. */
  preloads: ReadonlyArray<Script.PreloadScript>
  /** Contexts reported now existed before the connection: they are adopted. */
  adopting: boolean
}

/** A connection's empty state, with its default context mapped to BiDi's `"default"`. */
export const make = (options: {
  readonly cleanupScope: Scope.Scope
  readonly connect: Adapter.ConnectOptions
  readonly ids: Kit.Ids
  readonly buffer: Kit.FactBuffer
  readonly control: ProtocolClient.FoldControl
  readonly root: () => ProtocolClient.Session
}): State => {
  const requests = new Map<string, RequestEntry>()
  const hops = new Map<NetworkRequest.HopId, RequestEntry>()
  const defaultContext: ContextEntry = {
    id: options.ids.userContext(),
    bidi: "default" as BrowserBidi.UserContext,
    removing: false
  }
  const state: State = {
    cleanupScope: options.cleanupScope,
    options: options.connect,
    ids: options.ids,
    buffer: options.buffer,
    control: options.control,
    root: options.root,
    send: (command) => Protocol.on(command, options.root()),
    registry: Declarations.make(),
    defaultContext: defaultContext.id,
    contexts: new Map([[defaultContext.id, defaultContext]]),
    contextsByBidi: new Map([[defaultContext.bidi, defaultContext]]),
    navigables: new Map(),
    navigablesById: new Map(),
    endedPages: new Map(),
    documents: new Map(),
    realms: new Map(),
    realmsById: new Map(),
    workerPages: new Map(),
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
    downloads: new Map(),
    downloadsById: new Map(),
    handles: new Map(),
    intercepts: new Map(),
    collectors: new Map(),
    requestCollectors: new Map(),
    granted: new Map(),
    preloads: [],
    adopting: true
  }
  return state
}

/** What a fold handler gets beside the event's params: every event is the one session's. */
export interface Event {
  readonly state: State
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────

export const navigableOf = (state: State, context: string | null | undefined) =>
  context === null || context === undefined ? undefined : state.navigables.get(context)

/** Where a navigable sits, for the declarations registry. */
export const placement = (navigable: NavigableEntry): Declarations.Placement => ({
  page: navigable.page.id,
  context: navigable.context.id
})

/** The contexts or user contexts a scope names, as BiDi's commands take them; the browser's names neither. */
export const scopeParams = (
  state: State,
  scope: Adapter.DeclarationScope
): {
  readonly userContexts?: ReadonlyArray<BrowserBidi.UserContext>
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext>
} => {
  switch (scope._tag) {
    case "Browser":
      return {}
    case "UserContext":
      return { userContexts: [state.contexts.get(scope.context)?.bidi ?? ("default" as BrowserBidi.UserContext)] }
    case "Page":
      return { contexts: [state.navigablesById.get(scope.page)?.bidi ?? ("" as BrowsingContext.BrowsingContext)] }
  }
}

// ── Lookups: an id this connection minted that ended is Gone, any other Foreign ───────────────────────────

const pageGone = (state: State, id: L1Target.NavigableId) =>
  Kit.gone({ _tag: "Page", id }, state.endedPages.get(id) ?? new L1Target.Vanished({}))

/** A page or a frame. */
export const navigableById = (
  state: State,
  id: L1Target.NavigableId
): Effect.Effect<NavigableEntry, Adapter.AdapterError> =>
  Kit.lookup(
    state.ids,
    state.navigablesById,
    id,
    () =>
      state.endedPages.has(id) ? pageGone(state, id) : Kit.gone({ _tag: "Frame", id }, new L1Target.FrameDetached({})),
    (navigable) => !navigable.removed
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
    state.realmsById,
    id,
    () => Kit.gone({ _tag: "Realm", id }, new L1Target.RealmDestroyed({})),
    (realm) => !realm.ended
  )
