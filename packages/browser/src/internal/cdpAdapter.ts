/**
 * The CDP backend adapter (PROTOCOL.md, Backend adapters; review 08). It keeps the correlation tables from
 * CDP's ids to L1's, folds CDP's events into facts, configures every new target before its scripts run, and
 * carries out L1's operations.
 *
 * - **Targets.** The browser session auto-attaches pages, service workers and shared workers; each page's
 *   session auto-attaches its out-of-process frames and its workers. A launched browser pauses every new page
 *   before its scripts run; an attached one pauses only frames and workers of pages it attached to, so a
 *   user's tab is never paused (probe 22).
 * - **The gate** runs while a target is paused: enable `Page`, `Network` and lifecycle events, take the frame
 *   tree (the snapshot the session is synced with), enable `Runtime`, auto-attach the target's own frames and
 *   workers, apply the declarations in force, and resume, in a finalizer. It never waits on another target:
 *   a paused popup blocks its opener.
 * - **Identity.** Frames are keyed by frame id, documents by loader id, realms by `uniqueId` (context ids repeat
 *   after a process swap), navigations by loader id, requests by session and request id.
 * - **Facts** follow the evidence in review 08: realms are created after commit, the initial `about:blank`
 *   realm survives into the first same-origin document, children of a replaced document end without a CDP
 *   event, and navigation outcomes are reported only on affirmative evidence.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Browser from "../Browser.ts"
import * as BrowserCdp from "../cdp/Browser.ts"
import * as DOM from "../cdp/DOM.ts"
import * as Emulation from "../cdp/Emulation.ts"
import * as Fetch from "../cdp/Fetch.ts"
import * as Input from "../cdp/Input.ts"
import * as Inspector from "../cdp/Inspector.ts"
import * as Network from "../cdp/Network.ts"
import * as Page from "../cdp/Page.ts"
import * as Runtime from "../cdp/Runtime.ts"
import * as Storage from "../cdp/Storage.ts"
import * as Target from "../cdp/Target.ts"
import * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Dialog from "../Dialog.ts"
import type * as Download from "../Download.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import * as NetworkResponse from "../NetworkResponse.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Protocol from "../protocol/Protocol.ts"
import type * as Transport from "../protocol/Transport.ts"
import type * as L1Target from "../Target.ts"
import * as UncaughtException from "../UncaughtException.ts"
import type * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
import * as CdpWire from "./cdpWire.ts"
import * as Declarations from "./declarations.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"

// ── Tables ────────────────────────────────────────────────────────────────────────────────────────────────

interface ContextEntry {
  readonly id: UserContext.Id
  /** CDP's id; the default context's too, once a page in it reports it. */
  browserContextId: string | undefined
  readonly isDefault: boolean
  removing: boolean
}

type TargetKind = "page" | "iframe" | "worker" | "service_worker" | "shared_worker" | "other"

interface TargetEntry {
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
}

interface PageEntry {
  readonly id: L1Target.NavigableId
  readonly targetId: string
  readonly context: ContextEntry
  readonly target: TargetEntry
  readonly ready: Deferred.Deferred<void, Adapter.AdapterError>
  closing: L1Target.CloseReason | undefined
  ended: boolean
}

interface FrameEntry {
  readonly frameId: string
  readonly id: L1Target.NavigableId
  readonly page: PageEntry
  readonly parent: FrameEntry | undefined
  readonly children: Set<FrameEntry>
  /** The session that owns the frame now: its page's, or its own when out of process. */
  owner: TargetEntry
  document: DocumentEntry | undefined
  /** Navigations started by a command that the browser hasn't announced yet, oldest first. */
  readonly expected: Array<{ readonly id: PageNavigation.Id; readonly url: string }>
  readonly navigations: Map<string, NavigationEntry>
  removed: boolean
}

interface DocumentEntry {
  readonly id: L1Target.DocumentId
  readonly frame: FrameEntry
  loaderId: string | undefined
  url: string
  generation: number
  readonly realms: Set<RealmEntry>
}

interface RealmEntry {
  readonly id: L1Target.RealmId
  readonly uniqueId: string
  readonly contextId: number
  readonly target: TargetEntry
  readonly frame: FrameEntry | undefined
  readonly world: Adapter.World
  ended: boolean
}

interface NavigationEntry {
  readonly id: PageNavigation.Id
  readonly frame: FrameEntry
  readonly loaderId: string
  readonly url: string
  readonly sameDocument: boolean
  documentHop: NetworkRequest.HopId | undefined
  status: number | undefined
  failed: string | undefined
  ended: boolean
}

interface RequestEntry {
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
}

type ObligationEntry =
  | {
    readonly _tag: "PausedRequest"
    readonly id: Adapter.ObligationId
    readonly target: TargetEntry
    readonly requestId: string
    readonly phase: "request" | "response" | "auth"
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

interface DownloadEntry {
  readonly id: Download.Id
  readonly guid: string
  readonly directory: string | undefined
  ended: boolean
}

interface HandleEntry {
  readonly target: TargetEntry
  readonly objectId: string
}

// ── Mapping ───────────────────────────────────────────────────────────────────────────────────────────────

const targetKind = (type: string): TargetKind =>
  type === "page" || type === "iframe" || type === "worker" || type === "service_worker" || type === "shared_worker"
    ? type
    : "other"

const resourceTypes: Readonly<Record<string, NetworkRequest.ResourceType>> = {
  Document: "document",
  Stylesheet: "stylesheet",
  Image: "image",
  Media: "media",
  Font: "font",
  Script: "script",
  XHR: "xhr",
  Fetch: "fetch",
  EventSource: "eventSource",
  WebSocket: "webSocket",
  Manifest: "manifest",
  Ping: "ping"
}

const methods = new Set(NetworkRequest.Method.literals as ReadonlyArray<string>)

const consoleLevel = (type: string): ConsoleMessage.Level =>
  type === "error" || type === "assert"
    ? "error"
    : type === "warning"
    ? "warning"
    : type === "info"
    ? "info"
    : type === "debug"
    ? "debug"
    : "log"

const initiatedAs = (type: string): Adapter.InitiatedAs =>
  type === "reload" || type === "reloadBypassingCache"
    ? "reload"
    : type === "historyDifferentDocument" || type === "historySameDocument" || type === "restore" ||
        type === "restoreWithPost"
    ? "traversal"
    : type === "sameDocument"
    ? "fragment"
    : "crossDocument"

const isSameDocument = (type: string) => type === "sameDocument" || type === "historySameDocument"

const headersOf = (headers: unknown): Headers.Headers => {
  const record: Record<string, string> = {}
  if (typeof headers === "object" && headers !== null) {
    for (const [name, value] of Object.entries(headers)) record[name] = String(value)
  }
  return Headers.fromInput(record)
}

const textOf = (value: Runtime.RemoteObject): string =>
  value.type === "string"
    ? String(value.value)
    : value.unserializableValue !== undefined
    ? value.unserializableValue
    : value.value !== undefined && value.type !== "object"
    ? String(value.value)
    : value.description ?? value.type

// Windows virtual key codes for the keys whose `text` doesn't say what they are; CDP needs them to act.
const keyCodes: Readonly<Record<string, number>> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  Meta: 91,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123
}

const keyCode = (key: string): number | undefined => {
  const known = keyCodes[key]
  if (known !== undefined) return known
  if (key.length === 1) {
    const upper = key.toUpperCase()
    if (/[A-Z0-9]/.test(upper)) return upper.charCodeAt(0)
  }
  return undefined
}

const modifierBits = (modifiers: Adapter.Modifiers): number =>
  (modifiers.alt ? 1 : 0) | (modifiers.control ? 2 : 0) | (modifiers.meta ? 4 : 0) | (modifiers.shift ? 8 : 0)

const failReasons: Readonly<Record<Extract<Adapter.Decision, { _tag: "Fail" }>["error"], string>> = {
  aborted: "Aborted",
  failed: "Failed",
  timedOut: "TimedOut",
  accessDenied: "AccessDenied",
  connectionRefused: "ConnectionRefused"
}

/** The events the fold needs. */
const foldEvents: ReadonlyArray<Protocol.EventDef<string, any>> = [
  Target.attachedToTarget,
  Target.detachedFromTarget,
  Target.targetCrashed,
  Inspector.targetCrashed,
  BrowserCdp.downloadWillBegin,
  BrowserCdp.downloadProgress,
  Page.frameAttached,
  Page.frameDetached,
  Page.frameStartedNavigating,
  Page.frameNavigated,
  Page.navigatedWithinDocument,
  Page.documentOpened,
  Page.lifecycleEvent,
  Page.javascriptDialogOpening,
  Page.javascriptDialogClosed,
  Page.fileChooserOpened,
  Runtime.executionContextCreated,
  Runtime.executionContextDestroyed,
  Runtime.executionContextsCleared,
  Runtime.consoleAPICalled,
  Runtime.exceptionThrown,
  Network.requestWillBeSent,
  Network.responseReceived,
  Network.loadingFinished,
  Network.loadingFailed,
  Network.webSocketCreated,
  Network.webSocketFrameSent,
  Network.webSocketFrameReceived,
  Network.webSocketClosed,
  Network.eventSourceMessageReceived,
  Fetch.requestPaused,
  Fetch.authRequired
]

const base64 = (bytes: Uint8Array): string => Encoding.encode(bytes)
const fromBase64 = (text: string): Uint8Array => {
  const decoded = Encoding.decode(text)
  return decoded._tag === "Success" ? decoded.success : new Uint8Array()
}

// ── Remote values ─────────────────────────────────────────────────────────────────────────────────────────

const toRemoteValue = (
  value: Runtime.DeepSerializedValue | undefined,
  documentOf: (loaderId: string) => L1Target.DocumentId | undefined
): Adapter.RemoteValue => {
  if (value === undefined) return { type: "undefined" }
  const v = value.value as any
  const type = value.type as Adapter.RemoteValue["type"]
  switch (type) {
    case "undefined":
    case "null":
      return { type }
    case "string":
    case "boolean":
    case "bigint":
    case "date":
      return { type, value: v } as Adapter.RemoteValue
    case "number":
      return { type: "number", value: v }
    case "regexp":
      return { type: "regexp", value: v }
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return {
        type,
        value: Array.isArray(v)
          ? v.map((item: Runtime.DeepSerializedValue) => toRemoteValue(item, documentOf))
          : undefined
      }
    case "object":
    case "map":
      return {
        type,
        value: Array.isArray(v)
          ? v.map(([key, item]: [unknown, Runtime.DeepSerializedValue]) =>
            [
              typeof key === "string" ? key : toRemoteValue(key as Runtime.DeepSerializedValue, documentOf),
              toRemoteValue(item, documentOf)
            ] as const
          )
          : undefined
      }
    case "node": {
      const document = typeof v?.loaderId === "string" ? documentOf(v.loaderId) : undefined
      return {
        type: "node",
        node: document !== undefined && v?.backendNodeId !== undefined
          ? { document, binding: String(v.backendNodeId) }
          : undefined,
        value: v === undefined
          ? undefined
          : {
            nodeType: v.nodeType,
            localName: v.localName,
            childNodeCount: v.childNodeCount,
            attributes: v.attributes
          }
      }
    }
    default:
      return { type } as Adapter.RemoteValue
  }
}

const toCallArgument = (
  local: Adapter.LocalValue,
  handles: ReadonlyMap<Adapter.HandleId, HandleEntry>
): Runtime.CallArgument => {
  if (local._tag === "Handle") {
    const handle = handles.get(local.handle)
    return { objectId: handle?.objectId as Runtime.RemoteObjectId }
  }
  const value = local.value
  switch (value.type) {
    case "undefined":
      return {}
    case "null":
      return { value: null }
    case "number":
      return typeof value.value === "number" ? { value: value.value } : { unserializableValue: value.value }
    case "bigint":
      return { unserializableValue: `${value.value}n` }
    case "string":
    case "boolean":
      return { value: value.value }
    default:
      return { value: plain(value) }
  }
}

// A serialized value as plain JSON, for arguments CDP takes by value.
const plain = (value: Adapter.RemoteValue): unknown => {
  switch (value.type) {
    case "undefined":
      return undefined
    case "null":
      return null
    case "string":
    case "boolean":
      return value.value
    case "number":
      return typeof value.value === "number" ? value.value : Number(value.value)
    case "array":
    case "set":
      return (value.value ?? []).map(plain)
    case "object":
    case "map":
      return Object.fromEntries(
        (value.value ?? []).map(([key, item]) => [typeof key === "string" ? key : String(plain(key)), plain(item)])
      )
    case "date":
      return value.value
    default:
      return null
  }
}

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────────────

const capabilities = (info: Browser.Info, ownership: Adapter.ConnectOptions["ownership"]) => {
  const evidence = `CDP adapter static profile, ${info.product}`
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("userContexts", "supported"),
      entry("isolatedWorlds", "supported"),
      entry("pauseOnStart.frames", "supported"),
      entry("pauseOnStart.workers", "supported"),
      entry(
        "pauseOnStart.popups",
        ownership === "launched" ? "supported" : "unsupported",
        ownership === "launched" ? [] : ["only browser-wide on CDP (probe 22); an attached browser isn't paused"]
      ),
      entry("input.native", "supported"),
      entry("interception.request", "supported"),
      entry("interception.response", "supported"),
      entry("interception.auth", "supported"),
      entry("bodies", "supported"),
      entry("console", "supported"),
      entry("prompts", "supported"),
      entry("fileChooser", "supported"),
      entry("downloads", "supported"),
      entry("screenshot", "supported"),
      entry(
        "pdf",
        info.product.includes("Headless") ? "supported" : "unknown",
        info.product.includes("Headless") ? [] : ["Chrome prints to PDF only when headless"]
      ),
      entry("evaluation.userActivation", "supported"),
      entry("webSocketFrames", "supported"),
      entry("cookies", "supported"),
      entry("permissions", "supported")
    ]
  })
}

// ── The adapter ───────────────────────────────────────────────────────────────────────────────────────────

const gone = (target: L1Target.Description, reason: L1Target.CloseReason) =>
  new Adapter.AdapterError({ reason: { _tag: "Gone", target, reason } })

const foreign = (id: string) => new Adapter.AdapterError({ reason: { _tag: "Foreign", id } })

const protocolError = Adapter.protocolError

const unsupported = (capability: string, hint: string) =>
  new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability, hint } })

const closed = (): L1Target.CloseReason => ({ _tag: "ConnectionLost" })

/**
 * Connects the CDP adapter over a transport. The connection lives as long as the scope.
 */
export const connect: (
  transport: Transport.Transport,
  options: Adapter.ConnectOptions
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(transport: Transport.Transport, options: Adapter.ConnectOptions) {
    const ids = Adapter.makeIds()
    const registry = Declarations.make()
    const contexts = new Map<UserContext.Id, ContextEntry>()
    const contextsByCdp = new Map<string, ContextEntry>()
    const targets = new Map<ProtocolClient.Session, TargetEntry>()
    const targetsById = new Map<string, TargetEntry>()
    const pages = new Map<L1Target.NavigableId, PageEntry>()
    const frames = new Map<string, FrameEntry>()
    const navigables = new Map<L1Target.NavigableId, FrameEntry>()
    const documents = new Map<L1Target.DocumentId, DocumentEntry>()
    const documentsByLoader = new Map<string, DocumentEntry>()
    const realms = new Map<L1Target.RealmId, RealmEntry>()
    const realmsByContext = new Map<string, RealmEntry>()
    const realmsByUnique = new Map<string, RealmEntry>()
    const navigations = new Map<string, NavigationEntry>()
    const requests = new Map<string, RequestEntry>()
    const hops = new Map<NetworkRequest.HopId, RequestEntry>()
    const obligations = new Map<Adapter.ObligationId, ObligationEntry>()
    const downloads = new Map<string, DownloadEntry>()
    const downloadsById = new Map<Download.Id, DownloadEntry>()
    const handles = new Map<Adapter.HandleId, HandleEntry>()
    const connections = new Map<string, NetworkConnection.Id>()
    const pausedRequests = new Map<string, number>()
    let attachedAtConnect = true
    let defaultUserAgent = ""

    let out: Array<Adapter.Fact> = []
    const emit = (fact: Adapter.Fact): void => {
      out.push(fact)
    }
    const flush = Effect.suspend(() => {
      const facts = out
      out = []
      return Effect.forEach(facts, options.sink, { discard: true })
    })

    const contextKey = (target: TargetEntry, contextId: number) => `${target.session.key ?? ""}|${contextId}`
    const requestKey = (target: TargetEntry, requestId: string) => `${target.session.key ?? ""}|${requestId}`

    // ── Ending things ──

    const removeRealm = (realm: RealmEntry, reason: L1Target.CloseReason) => {
      if (realm.ended) return
      realm.ended = true
      realms.delete(realm.id)
      realmsByContext.delete(contextKey(realm.target, realm.contextId))
      realmsByUnique.delete(realm.uniqueId)
      if (realm.target.realm === realm) realm.target.realm = undefined
      emit({ _tag: "RealmRemoved", realm: realm.id, reason })
    }

    const endNavigation = (navigation: NavigationEntry, outcome: Adapter.NavigationOutcome, evidence: string) => {
      if (navigation.ended) return
      navigation.ended = true
      navigation.frame.navigations.delete(navigation.loaderId)
      emit({ _tag: "NavigationEnded", navigation: navigation.id, outcome, evidence })
    }

    // Ends a frame and everything below it, deepest first.
    const removeFrame = (frame: FrameEntry, reason: L1Target.CloseReason, evidence: string) => {
      if (frame.removed) return
      for (const child of frame.children) removeFrame(child, reason, evidence)
      frame.removed = true
      frame.parent?.children.delete(frame)
      frames.delete(frame.frameId)
      navigables.delete(frame.id)
      if (frame.document !== undefined) {
        for (const realm of frame.document.realms) removeRealm(realm, reason)
        documents.delete(frame.document.id)
        if (frame.document.loaderId !== undefined) documentsByLoader.delete(frame.document.loaderId)
      }
      for (const navigation of frame.navigations.values()) navigation.ended = true
      emit({ _tag: "NavigableRemoved", navigable: frame.id, reason, evidence })
    }

    const endPage = (page: PageEntry, reason: L1Target.CloseReason, evidence: string) => {
      if (page.ended) return
      page.ended = true
      const main = frames.get(page.targetId)
      if (main !== undefined) removeFrame(main, reason, evidence)
      pages.delete(page.id)
      for (const [id, obligation] of obligations) {
        if (obligation.target.page === page) {
          obligations.delete(id)
          emit({ _tag: "ObligationEnded", obligation: id, reason: "targetGone", evidence })
        }
      }
      Deferred.doneUnsafe(page.ready, Effect.fail(gone({ _tag: "Page", id: page.id }, reason)))
    }

    // ── Documents ──

    const commit = (
      frame: FrameEntry,
      snapshot: { readonly loaderId: string; readonly url: string; readonly origin: string },
      createdBy: (navigation: NavigationEntry | undefined) => Adapter.DocumentCreatedBy,
      navigation: NavigationEntry | undefined,
      evidence: string
    ): DocumentEntry => {
      // Children of the document being replaced end with it: CDP doesn't say so (probe 8)
      for (const child of Array.from(frame.children)) {
        removeFrame(child, { _tag: "FrameDetached" }, "cdp: the parent's document was replaced")
      }
      const old = frame.document
      const document: DocumentEntry = {
        id: ids.document(),
        frame,
        loaderId: snapshot.loaderId,
        url: snapshot.url,
        generation: 0,
        realms: new Set()
      }
      documents.set(document.id, document)
      documentsByLoader.set(snapshot.loaderId, document)
      frame.document = document
      emit({
        _tag: "DocumentCommitted",
        document: document.id,
        navigable: frame.id,
        url: snapshot.url,
        origin: snapshot.origin,
        createdBy: createdBy(navigation),
        replaced: Option.fromUndefinedOr(old?.id),
        evidence
      })
      if (old !== undefined) {
        documents.delete(old.id)
        // A realm that survived the commit hosts the new document: the initial about:blank's (probe 2)
        for (const realm of old.realms) {
          if (realm.ended) continue
          document.realms.add(realm)
          emit({ _tag: "RealmDocumentAdded", realm: realm.id, document: document.id })
        }
      }
      return document
    }

    const startNavigation = (
      frame: FrameEntry,
      loaderId: string,
      url: string,
      type: Adapter.InitiatedAs,
      sameDocument: boolean
    ): NavigationEntry => {
      const normalized = normalize(url)
      const index = frame.expected.findIndex((expected) => normalize(expected.url) === normalized)
      const expected = index >= 0 ? frame.expected.splice(index, 1)[0] : frame.expected.shift()
      const navigation: NavigationEntry = {
        id: expected?.id ?? ids.navigation(),
        frame,
        loaderId,
        url,
        sameDocument,
        documentHop: undefined,
        status: undefined,
        failed: undefined,
        ended: false
      }
      if (!sameDocument) {
        // A frame has one cross-document navigation at a time: a new one replaces the one in flight
        for (const pending of frame.navigations.values()) {
          if (!pending.sameDocument) {
            endNavigation(pending, { _tag: "Superseded", by: navigation.id }, "cdp:Page.frameStartedNavigating")
          }
        }
      }
      frame.navigations.set(loaderId, navigation)
      navigations.set(loaderId, navigation)
      emit({ _tag: "NavigationStarted", navigation: navigation.id, navigable: frame.id, url, initiatedAs: type })
      return navigation
    }

    // ── Targets ──

    const frameOf = (frameId: string | undefined) => frameId === undefined ? undefined : frames.get(frameId)

    const addFrame = (frameId: string, parent: FrameEntry, owner: TargetEntry): FrameEntry => {
      const frame: FrameEntry = {
        frameId,
        id: ids.navigable(),
        page: parent.page,
        parent,
        children: new Set(),
        owner,
        document: undefined,
        expected: [],
        navigations: new Map(),
        removed: false
      }
      parent.children.add(frame)
      frames.set(frameId, frame)
      navigables.set(frame.id, frame)
      emit({ _tag: "FrameAdded", frame: frame.id, parent: parent.id, page: parent.page.id })
      return frame
    }

    const contextFor = (browserContextId: string | undefined): ContextEntry => {
      if (browserContextId !== undefined) {
        const known = contextsByCdp.get(browserContextId)
        if (known !== undefined) return known
        const fallback = contexts.get(defaultContext)!
        if (fallback.browserContextId === undefined && attachedAtConnect) {
          fallback.browserContextId = browserContextId
          contextsByCdp.set(browserContextId, fallback)
          return fallback
        }
        // A context someone else created
        const entry: ContextEntry = { id: ids.userContext(), browserContextId, isDefault: false, removing: false }
        contexts.set(entry.id, entry)
        contextsByCdp.set(browserContextId, entry)
        emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
        return entry
      }
      return contexts.get(defaultContext)!
    }

    const attached = (parent: TargetEntry | undefined, params: Target.AttachedToTargetParams) => {
      const session = control.session(params.sessionId as string as Protocol.SessionKey)
      if (session === undefined) return
      const info = params.targetInfo
      const kind = targetKind(info.type)
      const parentPage = parent?.page
      switch (kind) {
        case "page": {
          const context = contextFor(info.browserContextId)
          const opener = info.openerId === undefined ? undefined : targetsById.get(info.openerId)?.page
          const target: TargetEntry = {
            kind,
            targetId: info.targetId,
            session,
            page: undefined,
            frame: undefined,
            url: info.url,
            realm: undefined,
            intercepts: "",
            scripts: new Map(),
            ended: false
          }
          const page: PageEntry = {
            id: ids.navigable(),
            targetId: info.targetId,
            context,
            target,
            ready: Deferred.makeUnsafe(),
            closing: undefined,
            ended: false
          }
          const entry = { ...target, page }
          targets.set(session, entry)
          targetsById.set(info.targetId, entry)
          pages.set(page.id, page)
          // The main frame's id is the target's
          const main: FrameEntry = {
            frameId: info.targetId,
            id: page.id,
            page,
            parent: undefined,
            children: new Set(),
            owner: entry,
            document: undefined,
            expected: [],
            navigations: new Map(),
            removed: false
          }
          frames.set(info.targetId, main)
          navigables.set(page.id, main)
          const openerId = Option.fromUndefinedOr(opener?.id)
          emit({
            _tag: "PageAdded",
            page: page.id,
            context: context.id,
            kind: info.openerId === undefined ? "tab" : "popup",
            origin: attachedAtConnect
              ? { _tag: "Adopted", opener: openerId }
              : info.openerId === undefined
              ? { _tag: "Created" }
              : { _tag: "Opened", opener: openerId },
            url: info.url
          })
          control.sync(session, gate(entry, page, params.waitingForDebugger, attachedAtConnect))
          return
        }
        case "iframe": {
          const frame = frames.get(info.targetId)
          const target: TargetEntry = {
            kind,
            targetId: info.targetId,
            session,
            page: frame?.page ?? parentPage,
            frame,
            url: info.url,
            realm: undefined,
            intercepts: "",
            scripts: new Map(),
            ended: false
          }
          targets.set(session, target)
          targetsById.set(info.targetId, target)
          if (frame !== undefined) frame.owner = target
          control.sync(session, gate(target, target.page, params.waitingForDebugger, false))
          return
        }
        case "worker":
        case "service_worker":
        case "shared_worker": {
          const target: TargetEntry = {
            kind,
            targetId: info.targetId,
            session,
            page: kind === "worker" ? parentPage : undefined,
            frame: undefined,
            url: info.url,
            realm: undefined,
            intercepts: "",
            scripts: new Map(),
            ended: false
          }
          targets.set(session, target)
          targetsById.set(info.targetId, target)
          control.sync(session, workerGate(target, params.waitingForDebugger))
          return
        }
        case "other": {
          const target: TargetEntry = {
            kind,
            targetId: info.targetId,
            session,
            page: undefined,
            frame: undefined,
            url: info.url,
            realm: undefined,
            intercepts: "",
            scripts: new Map(),
            ended: false
          }
          targets.set(session, target)
          control.sync(
            session,
            resume(session, params.waitingForDebugger).pipe(
              Effect.as({ through: 0, apply: Effect.void } satisfies ProtocolClient.Synced)
            )
          )
          return
        }
      }
    }

    const ended = (session: ProtocolClient.Session, reason: Protocol.SessionEnded) => {
      const target = targets.get(session)
      if (target === undefined || target.ended) return
      target.ended = true
      targets.delete(session)
      if (targetsById.get(target.targetId) === target) targetsById.delete(target.targetId)
      for (const realm of Array.from(realms.values())) {
        if (realm.target === target) {
          removeRealm(realm, reason.why === "connectionLost" ? closed() : { _tag: "RealmDestroyed" })
        }
      }
      switch (target.kind) {
        case "page": {
          const page = target.page!
          const why: L1Target.CloseReason = reason.why === "connectionLost"
            ? closed()
            : reason.why === "modelUnavailable"
            ? { _tag: "ModelUnavailable" }
            : page.closing ?? (page.context.removing
              ? { _tag: "PageClosed", by: "userContextRemoved" }
              : { _tag: "PageClosed", by: "script" })
          endPage(page, why, `cdp: the page's session ended (${reason.why})`)
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

    // ── The fold ──

    const handlers: Record<
      string,
      (target: TargetEntry | undefined, params: any, session: ProtocolClient.Session) => void
    > = {
      [Target.attachedToTarget.method]: (target, params: Target.AttachedToTargetParams) => attached(target, params),
      [Target.detachedFromTarget.method]: () => {
        // The session's own end, delivered by `ended`, carries everything
      },
      [Target.targetCrashed.method]: (_target, params: Target.TargetCrashedParams) => {
        const page = targetsById.get(params.targetId)?.page
        if (page !== undefined) endPage(page, { _tag: "PageCrashed" }, "cdp:Target.targetCrashed")
      },
      [Inspector.targetCrashed.method]: (target) => {
        if (target?.kind === "page" && target.page !== undefined) {
          endPage(target.page, { _tag: "PageCrashed" }, "cdp:Inspector.targetCrashed")
        }
      },
      [BrowserCdp.downloadWillBegin.method]: (_target, params: BrowserCdp.DownloadWillBeginParams) => {
        const frame = frameOf(params.frameId)
        const download: DownloadEntry = {
          id: ids.download(),
          guid: params.guid,
          directory: frame === undefined ? undefined : downloadDirectory(frame.page.context.id),
          ended: false
        }
        downloads.set(params.guid, download)
        downloadsById.set(download.id, download)
        if (frame !== undefined) {
          emit({
            _tag: "DownloadStarted",
            download: download.id,
            page: frame.page.id,
            url: params.url,
            suggestedFilename: params.suggestedFilename
          })
          // A navigation in flight on that frame, to that URL, became this download
          for (const navigation of frame.navigations.values()) {
            if (!navigation.sameDocument && normalize(navigation.url) === normalize(params.url)) {
              endNavigation(
                navigation,
                { _tag: "Download", download: Option.some(download.id) },
                "cdp:Browser.downloadWillBegin"
              )
            }
          }
        }
      },
      [BrowserCdp.downloadProgress.method]: (_target, params: BrowserCdp.DownloadProgressParams) => {
        const download = downloads.get(params.guid)
        if (download === undefined || download.ended) return
        if (params.state === "inProgress") {
          emit({
            _tag: "DownloadProgress",
            download: download.id,
            receivedBytes: params.receivedBytes,
            totalBytes: params.totalBytes > 0 ? Option.some(params.totalBytes) : Option.none()
          })
          return
        }
        download.ended = true
        emit({
          _tag: "DownloadEnded",
          download: download.id,
          outcome: params.state === "completed"
            ? {
              _tag: "Completed",
              path: Option.fromUndefinedOr(
                params.filePath ??
                  (download.directory === undefined ? undefined : `${download.directory}/${download.guid}`)
              )
            }
            : { _tag: "Canceled" }
        })
      },
      [Page.frameAttached.method]: (target, params: Page.FrameAttachedParams) => {
        if (target === undefined || frames.has(params.frameId)) return
        const parent = frames.get(params.parentFrameId)
        if (parent === undefined) return
        const frame = addFrame(params.frameId, parent, target)
        commit(
          frame,
          { loaderId: `initial:${frame.frameId}`, url: "about:blank", origin: "null" },
          () => ({ _tag: "InitialBlank" }),
          undefined,
          "cdp:Page.frameAttached"
        )
      },
      [Page.frameDetached.method]: (_target, params: Page.FrameDetachedParams) => {
        const frame = frames.get(params.frameId)
        if (frame === undefined || params.reason === "swap") return
        removeFrame(frame, { _tag: "FrameDetached" }, "cdp:Page.frameDetached")
      },
      [Page.frameStartedNavigating.method]: (_target, params: Page.FrameStartedNavigatingParams) => {
        const frame = frames.get(params.frameId)
        if (frame === undefined) return
        startNavigation(
          frame,
          params.loaderId,
          params.url,
          initiatedAs(params.navigationType),
          isSameDocument(params.navigationType)
        )
      },
      [Page.frameNavigated.method]: (target, params: Page.FrameNavigatedParams) => {
        if (target === undefined) return
        const f = params.frame
        let frame = frames.get(f.id)
        if (frame === undefined) {
          const parent = frameOf(f.parentId)
          if (parent === undefined) return
          frame = addFrame(f.id, parent, target)
        }
        const navigation = navigations.get(f.loaderId) ??
          startNavigation(frame, f.loaderId, f.url, "crossDocument", false)
        const errorPage = f.url.startsWith("chrome-error://")
        const restored = params.type === "BackForwardCacheRestore"
        const previous = documentsByLoader.get(f.loaderId)
        const document = commit(
          frame,
          { loaderId: f.loaderId, url: f.url, origin: f.securityOrigin },
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
          navigation,
          errorPage
            ? { _tag: "Failed", error: navigation.failed ?? "error page", errorDocument: Option.some(document.id) }
            : restored
            ? { _tag: "Restored", document: document.id }
            : { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
          "cdp:Page.frameNavigated"
        )
      },
      [Page.navigatedWithinDocument.method]: (_target, params: Page.NavigatedWithinDocumentParams) => {
        const frame = frames.get(params.frameId)
        const document = frame?.document
        if (frame === undefined || document === undefined) return
        const via = params.navigationType === "fragment" ? "fragment" : "historyApi"
        let navigation = [...frame.navigations.values()].find((navigation) =>
          navigation.sameDocument && normalize(navigation.url) === normalize(params.url)
        )
        if (navigation === undefined) {
          navigation = startNavigation(
            frame,
            `same:${frame.frameId}:${params.url}:${Math.random()}`,
            params.url,
            via,
            true
          )
        }
        document.url = params.url
        emit({ _tag: "DocumentUrlChanged", document: document.id, url: params.url, navigation: navigation.id, via })
        endNavigation(
          navigation,
          { _tag: "SameDocument", document: document.id, via },
          "cdp:Page.navigatedWithinDocument"
        )
      },
      [Page.documentOpened.method]: (_target, params: Page.DocumentOpenedParams) => {
        const document = frames.get(params.frame.id)?.document
        if (document === undefined) return
        document.generation++
        emit({ _tag: "DocumentOpened", document: document.id, generation: document.generation })
      },
      [Page.lifecycleEvent.method]: (_target, params: Page.LifecycleEventParams) => {
        const document = frames.get(params.frameId)?.document
        if (document === undefined) return
        if (document.loaderId?.startsWith("initial:") && params.name === "init") {
          documentsByLoader.delete(document.loaderId)
          document.loaderId = params.loaderId
          documentsByLoader.set(params.loaderId, document)
        }
        if (document.loaderId !== params.loaderId) return
        if (params.name === "DOMContentLoaded") {
          emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
        } else if (params.name === "load") {
          emit({ _tag: "DocumentReadiness", document: document.id, readiness: "complete" })
        }
      },
      [Page.javascriptDialogOpening.method]: (target, params: Page.JavascriptDialogOpeningParams) => {
        const page = target?.page
        if (target === undefined || page === undefined) return
        const prompt = ids.prompt()
        const obligation = ids.obligation()
        obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, target })
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "Prompt",
            prompt,
            page: page.id,
            kind: params.type === "beforeunload"
              ? "beforeunload"
              : params.type === "alert"
              ? "alert"
              : params.type === "confirm"
              ? "confirm"
              : "prompt",
            message: params.message,
            defaultValue: params.defaultPrompt ?? ""
          }
        })
      },
      [Page.javascriptDialogClosed.method]: (target, params: Page.JavascriptDialogClosedParams) => {
        for (const [id, obligation] of obligations) {
          if (obligation._tag !== "Prompt" || obligation.target !== target) continue
          obligations.delete(id)
          emit({
            _tag: "PromptClosed",
            prompt: obligation.prompt,
            accepted: params.result,
            userText: params.userInput === "" ? Option.none() : Option.some(params.userInput)
          })
          emit({
            _tag: "ObligationEnded",
            obligation: id,
            reason: "resolved",
            evidence: "cdp:Page.javascriptDialogClosed"
          })
          return
        }
      },
      [Page.fileChooserOpened.method]: (target, params: Page.FileChooserOpenedParams) => {
        const frame = frameOf(params.frameId)
        if (target === undefined || frame === undefined) return
        const obligation = ids.obligation()
        const backendNodeId = params.backendNodeId as number | undefined
        obligations.set(obligation, { _tag: "FileChooser", id: obligation, target, backendNodeId })
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "FileChooser",
            navigable: frame.id,
            multiple: params.mode === "selectMultiple",
            element: backendNodeId === undefined || frame.document === undefined
              ? Option.none()
              : Option.some({ document: frame.document.id, binding: String(backendNodeId) })
          }
        })
      },
      [Runtime.executionContextCreated.method]: (target, params: Runtime.ExecutionContextCreatedParams) => {
        if (target === undefined) return
        const context = params.context
        const auxData = (context.auxData ?? {}) as { frameId?: string; isDefault?: boolean; type?: string }
        if (target.kind === "worker" || target.kind === "service_worker" || target.kind === "shared_worker") {
          const realm: RealmEntry = {
            id: ids.realm(),
            uniqueId: context.uniqueId ?? contextKey(target, context.id as number),
            contextId: context.id as number,
            target,
            frame: undefined,
            world: { _tag: "Main" },
            ended: false
          }
          target.realm = realm
          realms.set(realm.id, realm)
          realmsByContext.set(contextKey(target, realm.contextId), realm)
          realmsByUnique.set(realm.uniqueId, realm)
          emit({
            _tag: "RealmAdded",
            realm: realm.id,
            origin: context.origin,
            kind: {
              _tag: "Worker",
              worker: target.kind === "worker"
                ? { _tag: "Dedicated", owner: Option.none() }
                : target.kind === "shared_worker"
                ? { _tag: "Shared" }
                : { _tag: "Service", scope: Option.none() },
              url: target.url,
              page: Option.fromUndefinedOr(target.page?.id)
            }
          })
          return
        }
        const frame = frameOf(auxData.frameId)
        const document = frame?.document
        if (frame === undefined || document === undefined) return
        const realm: RealmEntry = {
          id: ids.realm(),
          uniqueId: context.uniqueId ?? contextKey(target, context.id as number),
          contextId: context.id as number,
          target,
          frame,
          world: auxData.isDefault === true ? { _tag: "Main" } : { _tag: "Isolated", name: context.name },
          ended: false
        }
        realms.set(realm.id, realm)
        realmsByContext.set(contextKey(target, realm.contextId), realm)
        realmsByUnique.set(realm.uniqueId, realm)
        document.realms.add(realm)
        emit({
          _tag: "RealmAdded",
          realm: realm.id,
          origin: context.origin,
          kind: { _tag: "Window", navigable: frame.id, document: document.id, world: realm.world }
        })
      },
      [Runtime.executionContextDestroyed.method]: (target, params: Runtime.ExecutionContextDestroyedParams) => {
        if (target === undefined || params.executionContextUniqueId === undefined) return
        const realm = realmsByUnique.get(params.executionContextUniqueId)
        if (realm !== undefined) removeRealm(realm, { _tag: "RealmDestroyed" })
      },
      [Runtime.executionContextsCleared.method]: (target) => {
        for (const realm of Array.from(realms.values())) {
          if (realm.target === target && realm.frame !== undefined) removeRealm(realm, { _tag: "RealmDestroyed" })
        }
      },
      [Runtime.consoleAPICalled.method]: (target, params: Runtime.ConsoleAPICalledParams) => {
        if (target === undefined) return
        const realm = realmsByContext.get(contextKey(target, params.executionContextId as number))
        if (realm === undefined) return
        const top = params.stackTrace?.callFrames[0]
        emit({
          _tag: "ConsoleMessage",
          realm: realm.id,
          message: new ConsoleMessage.ConsoleMessage({
            level: consoleLevel(params.type),
            text: params.args.map(textOf).join(" "),
            location: top === undefined || top.url === ""
              ? Option.none()
              : Option.some({ url: top.url as Url.Url, line: top.lineNumber, column: top.columnNumber }),
            origin: realm.frame !== undefined
              ? { _tag: "Page", page: realm.frame.page.id }
              : { _tag: "Worker", realm: realm.id },
            at: Adapter.now()
          })
        })
      },
      [Runtime.exceptionThrown.method]: (target, params: Runtime.ExceptionThrownParams) => {
        if (target === undefined) return
        const details = params.exceptionDetails
        const realm = details.executionContextId === undefined
          ? target.realm
          : realmsByContext.get(contextKey(target, details.executionContextId as number))
        const exception = details.exception
        const description = exception?.description ?? details.text
        const [first = details.text, ...rest] = description.split("\n")
        const colon = first.indexOf(": ")
        emit({
          _tag: "UncaughtException",
          realm: Option.fromUndefinedOr(realm?.id),
          exception: new UncaughtException.UncaughtException({
            kind: details.text.startsWith("Uncaught (in promise)") ? "unhandledRejection" : "thrown",
            name: exception?.className ?? (colon > 0 ? first.slice(0, colon) : "Error"),
            message: colon > 0 ? first.slice(colon + 2) : first,
            stack: rest.length > 0 ? Option.some(description) : Option.none(),
            origin: realm?.frame !== undefined
              ? { _tag: "Page", page: realm.frame.page.id }
              : realm !== undefined
              ? { _tag: "Worker", realm: realm.id }
              : { _tag: "Page", page: target.page?.id ?? ("" as L1Target.NavigableId) },
            at: Adapter.now()
          })
        })
      },
      [Network.requestWillBeSent.method]: (target, params: Network.RequestWillBeSentParams) => {
        if (target === undefined) return
        const key = requestKey(target, params.requestId)
        let request = requests.get(key)
        if (request !== undefined && params.redirectResponse !== undefined) {
          emitResponse(request, params.redirectResponse)
          emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
          hops.delete(request.hop)
          request.redirects++
          request.hop = ids.hop(request.id, request.redirects)
          request.url = params.request.url
          hops.set(request.hop, request)
        } else {
          const frame = frameOf(params.frameId)
          const navigation = params.type === "Document" ? navigations.get(params.loaderId) : undefined
          const id = ids.request()
          request = {
            id,
            target,
            requestId: params.requestId,
            redirects: 0,
            hop: ids.hop(id, 0),
            url: params.request.url,
            frame,
            navigation,
            finished: Deferred.makeUnsafe()
          }
          requests.set(key, request)
          hops.set(request.hop, request)
        }
        if (request.navigation !== undefined && (params.requestId as string) === (params.loaderId as string)) {
          request.navigation.documentHop = request.hop
        }
        emit({
          _tag: "RequestSent",
          request: new NetworkRequest.NetworkRequest({
            hop: request.hop,
            method:
              (methods.has(params.request.method) ? params.request.method : "GET") as NetworkRequest.NetworkRequest[
                "method"
              ],
            url: params.request.url as Url.Url,
            headers: headersOf(params.request.headers),
            resourceType: resourceTypes[params.type ?? "Other"] ?? "other",
            initiator: request.frame !== undefined
              ? {
                _tag: "Document",
                navigable: request.frame.id,
                navigation: Option.fromUndefinedOr(request.navigation?.id)
              }
              : target.realm !== undefined
              ? { _tag: "Worker", realm: target.realm.id }
              : { _tag: "Unattributed" },
            servedBy: "network",
            at: Adapter.now()
          })
        })
      },
      [Network.responseReceived.method]: (target, params: Network.ResponseReceivedParams) => {
        if (target === undefined) return
        const request = requests.get(requestKey(target, params.requestId))
        if (request !== undefined) emitResponse(request, params.response)
      },
      [Network.loadingFinished.method]: (target, params: Network.LoadingFinishedParams) => {
        if (target === undefined) return
        const request = requests.get(requestKey(target, params.requestId))
        if (request === undefined) return
        emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: params.encodedDataLength, at: Adapter.now() })
        Deferred.doneUnsafe(request.finished, Effect.void)
      },
      [Network.loadingFailed.method]: (target, params: Network.LoadingFailedParams) => {
        if (target === undefined) return
        const request = requests.get(requestKey(target, params.requestId))
        if (request === undefined) return
        emit({
          _tag: "RequestFailed",
          hop: request.hop,
          error: params.errorText,
          canceled: params.canceled ?? false,
          at: Adapter.now()
        })
        Deferred.doneUnsafe(request.finished, Effect.fail(params.errorText))
        const navigation = request.navigation
        if (navigation === undefined || navigation.ended || request.requestId !== navigation.loaderId) return
        navigation.failed = params.errorText
        if (navigation.status === 204 || navigation.status === 205) {
          endNavigation(navigation, { _tag: "NoContent", status: navigation.status }, "cdp:Network.loadingFailed")
        } else if (params.errorText !== "net::ERR_ABORTED") {
          // An error page may still commit under this loader; it is reported as the document it created
          endNavigation(
            navigation,
            { _tag: "Failed", error: params.errorText, errorDocument: Option.none() },
            "cdp:Network.loadingFailed"
          )
        }
        // An abort stays pending until a download, a new navigation or an error page says what it was
      },
      [Network.webSocketCreated.method]: (target, params: Network.WebSocketCreatedParams) => {
        if (target === undefined) return
        const id = ids.connection()
        connections.set(requestKey(target, params.requestId), id)
        emit({
          _tag: "ConnectionOpened",
          connection: id,
          kind: "webSocket",
          url: params.url,
          navigable: Option.fromUndefinedOr(target.page?.id)
        })
      },
      [Network.webSocketFrameSent.method]: (target, params: Network.WebSocketFrameSentParams) =>
        webSocketFrame(target, params.requestId, "sent", params.response),
      [Network.webSocketFrameReceived.method]: (target, params: Network.WebSocketFrameReceivedParams) =>
        webSocketFrame(target, params.requestId, "received", params.response),
      [Network.webSocketClosed.method]: (target, params: Network.WebSocketClosedParams) => {
        if (target === undefined) return
        const key = requestKey(target, params.requestId)
        const id = connections.get(key)
        if (id === undefined) return
        connections.delete(key)
        emit({ _tag: "ConnectionClosed", connection: id })
      },
      [Network.eventSourceMessageReceived.method]: (target, params: Network.EventSourceMessageReceivedParams) => {
        if (target === undefined) return
        const key = requestKey(target, params.requestId)
        let id = connections.get(key)
        if (id === undefined) {
          id = ids.connection()
          connections.set(key, id)
          emit({
            _tag: "ConnectionOpened",
            connection: id,
            kind: "eventSource",
            url: requests.get(key)?.url ?? "",
            navigable: Option.fromUndefinedOr(target.page?.id)
          })
        }
        emit({
          _tag: "ConnectionFrame",
          connection: id,
          frame: new NetworkConnectionFrame({
            direction: "received",
            payload: { _tag: "Text", text: params.data },
            at: Adapter.now()
          })
        })
      },
      [Fetch.requestPaused.method]: (target, params: Fetch.RequestPausedParams) => {
        if (target === undefined) return
        const request = params.networkId === undefined
          ? undefined
          : requests.get(requestKey(target, params.networkId))
        const phase = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined
          ? "response"
          : "request"
        pausedRequests.set(requestKey(target, ""), (pausedRequests.get(requestKey(target, "")) ?? 0) + 1)
        const obligation = ids.obligation()
        obligations.set(obligation, {
          _tag: "PausedRequest",
          id: obligation,
          target,
          requestId: params.requestId,
          phase
        })
        const hop = request?.hop ?? ids.hop(ids.request(), 0)
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "PausedRequest",
            request: pausedRequest(hop, params.request, params.resourceType, request, target),
            phase,
            response: params.responseStatusCode === undefined
              ? Option.none()
              : Option.some(
                new NetworkResponse.NetworkResponse({
                  hop,
                  url: params.request.url as Url.Url,
                  status: params.responseStatusCode as NetworkResponse.StatusCode,
                  headers: Headers.fromInput(
                    Object.fromEntries((params.responseHeaders ?? []).map((header) => [header.name, header.value]))
                  ),
                  at: Adapter.now()
                })
              ),
            challenge: Option.none()
          }
        })
      },
      [Fetch.authRequired.method]: (target, params: Fetch.AuthRequiredParams) => {
        if (target === undefined) return
        const obligation = ids.obligation()
        obligations.set(obligation, {
          _tag: "PausedRequest",
          id: obligation,
          target,
          requestId: params.requestId,
          phase: "auth"
        })
        const hop = ids.hop(ids.request(), 0)
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "PausedRequest",
            request: pausedRequest(hop, params.request, params.resourceType, undefined, target),
            phase: "auth",
            response: Option.none(),
            challenge: Option.some({
              origin: params.authChallenge.origin,
              scheme: params.authChallenge.scheme,
              realm: params.authChallenge.realm
            })
          }
        })
      }
    }

    const emitResponse = (request: RequestEntry, response: Network.Response) => {
      if (request.navigation !== undefined && request.requestId === request.navigation.loaderId) {
        request.navigation.status = response.status
      }
      emit({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: response.url as Url.Url,
          status: Math.min(599, Math.max(100, response.status || 200)) as NetworkResponse.StatusCode,
          headers: headersOf(response.headers),
          at: Adapter.now()
        })
      })
    }

    const webSocketFrame = (
      target: TargetEntry | undefined,
      requestId: string,
      direction: "sent" | "received",
      frame: Network.WebSocketFrame
    ) => {
      if (target === undefined) return
      const id = connections.get(requestKey(target, requestId))
      if (id === undefined) return
      emit({
        _tag: "ConnectionFrame",
        connection: id,
        frame: new NetworkConnectionFrame({
          direction,
          payload: frame.opcode === 1
            ? { _tag: "Text", text: frame.payloadData }
            : { _tag: "Binary", bytes: fromBase64(frame.payloadData) },
          at: Adapter.now()
        })
      })
    }

    const pausedRequest = (
      hop: NetworkRequest.HopId,
      request: Network.Request,
      resourceType: string,
      entry: RequestEntry | undefined,
      target: TargetEntry
    ) =>
      new NetworkRequest.NetworkRequest({
        hop,
        method: (methods.has(request.method) ? request.method : "GET") as NetworkRequest.NetworkRequest["method"],
        url: request.url as Url.Url,
        headers: headersOf(request.headers),
        resourceType: resourceTypes[resourceType] ?? "other",
        initiator: entry?.frame !== undefined
          ? { _tag: "Document", navigable: entry.frame.id, navigation: Option.fromUndefinedOr(entry.navigation?.id) }
          : target.page !== undefined
          ? { _tag: "Document", navigable: target.page.id, navigation: Option.none() }
          : { _tag: "Unattributed" },
        servedBy: "network",
        at: Adapter.now()
      })

    const makeFold = (control: ProtocolClient.FoldControl): ProtocolClient.Fold => ({
      events: new Map(foldEvents.map((event) => [event.method, event])),
      apply: (session, method, params) =>
        Effect.suspend(() => {
          const target = session.key === undefined ? undefined : targets.get(session)
          handlers[method]?.(target, params, session)
          return flush
        }),
      lost: (session) =>
        Effect.suspend(() => {
          // Rebuild the model from a fresh frame tree, as at initialization
          const target = targets.get(session)
          if (target?.kind === "page" && target.page !== undefined) {
            control.sync(session, snapshot(target, target.page, false, Effect.void))
          } else {
            control.sync(session, Effect.succeed({ through: 0, apply: Effect.void }))
          }
          return Effect.void
        }),
      ended: (session, reason) =>
        Effect.suspend(() => {
          ended(session, reason)
          return flush
        })
    })

    // ── The gate ──

    const resume = (session: ProtocolClient.Session, waiting: boolean) =>
      waiting ? Runtime.runIfWaitingForDebugger().pipe(Protocol.on(session), Effect.ignore) : Effect.void

    // Installs a frame tree snapshot: the documents it shows, which the events after it build on.
    const installTree = (
      target: TargetEntry,
      tree: Page.FrameTree,
      adopted: boolean
    ): void => {
      const visit = (node: Page.FrameTree, parent: FrameEntry | undefined) => {
        let frame = frames.get(node.frame.id)
        if (frame === undefined) {
          if (parent === undefined) return
          frame = addFrame(node.frame.id, parent, target)
        }
        frame.owner = target
        if (frame.document?.loaderId !== node.frame.loaderId) {
          const navigation = navigations.get(node.frame.loaderId)
          const document = commit(
            frame,
            { loaderId: node.frame.loaderId, url: node.frame.url, origin: node.frame.securityOrigin },
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
      yield* Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).pipe(on)
      const failure = yield* configure.pipe(Effect.flip, Effect.option)
      return {
        through: received,
        apply: Effect.suspend(() => {
          installTree(target, result.frameTree, adopted)
          if (page !== undefined && target.kind === "page") {
            if (failure._tag === "Some") {
              emit({ _tag: "PageInitializationFailed", page: page.id, description: failure.value.message })
              Deferred.doneUnsafe(
                page.ready,
                Effect.fail(
                  failure.value._tag === "AdapterError" ? failure.value : protocolError(failure.value)
                )
              )
            } else {
              emit({ _tag: "PageReady", page: page.id })
              Deferred.doneUnsafe(page.ready, Effect.void)
            }
          }
          return flush
        })
      } satisfies ProtocolClient.Synced
    })

    const gate = (target: TargetEntry, page: PageEntry | undefined, waiting: boolean, adopted: boolean) =>
      snapshot(target, page, adopted, page === undefined ? Effect.void : configureTarget(target, page)).pipe(
        Effect.ensuring(resume(target.session, waiting))
      )

    const workerGate = (target: TargetEntry, waiting: boolean) =>
      Effect.gen(function*() {
        const on = Protocol.on(target.session)
        yield* Effect.all([Runtime.enable().pipe(on), Network.enable({}).pipe(on)], {
          concurrency: "unbounded",
          discard: true
        }).pipe(Effect.ignore)
        return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
      }).pipe(Effect.ensuring(resume(target.session, waiting)))

    // ── Declarations ──

    const placement = (page: PageEntry): Declarations.Placement => ({ page: page.id, context: page.context.id })

    const downloadDirectory = (context: UserContext.Id) => {
      const behavior = registry.downloads(context)
      return behavior?._tag === "Allow" ? behavior.directory : undefined
    }

    // Requests fail offline, and `navigator.onLine` says so
    const offline = (session: ProtocolClient.Session, offline: boolean) =>
      Effect.all([
        Network.emulateNetworkConditionsByRule({
          matchedNetworkConditions: [{
            urlPattern: "",
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
            offline
          }]
        }).pipe(Protocol.on(session)),
        Network.overrideNetworkState({ offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).pipe(
          Protocol.on(session)
        )
      ], { discard: true })

    const applyOverride = (
      session: ProtocolClient.Session,
      kind: Adapter.Override["_tag"],
      override: Adapter.Override | undefined
    ): Effect.Effect<void, Protocol.ProtocolError> => {
      const on = Protocol.on(session)
      if (override === undefined) {
        switch (kind) {
          case "Viewport":
            return Emulation.clearDeviceMetricsOverride().pipe(on)
          case "UserAgent":
          case "Locale":
            return Emulation.setUserAgentOverride({ userAgent: defaultUserAgent }).pipe(
              on,
              Effect.andThen(kind === "Locale" ? Emulation.setLocaleOverride({}).pipe(on) : Effect.void)
            )
          case "TimeZone":
            return Emulation.setTimezoneOverride({ timezoneId: "" }).pipe(on)
          case "Geolocation":
            return Emulation.clearGeolocationOverride().pipe(on)
          case "Media":
            return Emulation.setEmulatedMedia({ media: "", features: [] }).pipe(on)
          case "Offline":
            return offline(session, false)
          case "ExtraHeaders":
            return Network.setExtraHTTPHeaders({ headers: {} }).pipe(on)
          case "JavaScriptEnabled":
            return Emulation.setScriptExecutionDisabled({ value: false }).pipe(on)
          case "BypassCsp":
            return Page.setBypassCSP({ enabled: false }).pipe(on)
          case "Touch":
            return Emulation.setTouchEmulationEnabled({ enabled: false }).pipe(on)
          case "FocusEmulation":
            return Emulation.setFocusEmulationEnabled({ enabled: false }).pipe(on)
          case "CacheDisabled":
            return Network.setCacheDisabled({ cacheDisabled: false }).pipe(on)
        }
      }
      switch (override._tag) {
        case "Viewport":
          return Emulation.setDeviceMetricsOverride({
            width: override.width,
            height: override.height,
            deviceScaleFactor: override.deviceScaleFactor,
            mobile: override.mobile
          }).pipe(on)
        case "UserAgent":
          return Emulation.setUserAgentOverride({
            userAgent: override.userAgent,
            ...(Option.isSome(override.platform) ? { platform: override.platform.value } : {})
          }).pipe(on)
        case "Locale":
          return Emulation.setLocaleOverride({ locale: override.locale }).pipe(
            on,
            Effect.andThen(
              Emulation.setUserAgentOverride({ userAgent: defaultUserAgent, acceptLanguage: override.locale }).pipe(on)
            )
          )
        case "TimeZone":
          return Emulation.setTimezoneOverride({ timezoneId: override.timeZone }).pipe(on)
        case "Geolocation":
          return Option.match(override.position, {
            onNone: () => Emulation.setGeolocationOverride({}).pipe(on),
            onSome: (position) => Emulation.setGeolocationOverride(position).pipe(on)
          })
        case "Media":
          return Emulation.setEmulatedMedia({
            media: Option.getOrElse(override.media, () => ""),
            features: Object.entries(override.features).map(([name, value]) => ({ name, value }))
          }).pipe(on)
        case "Offline":
          return offline(session, override.offline)
        case "ExtraHeaders":
          return Network.setExtraHTTPHeaders({ headers: override.headers }).pipe(on)
        case "JavaScriptEnabled":
          return Emulation.setScriptExecutionDisabled({ value: !override.enabled }).pipe(on)
        case "BypassCsp":
          return Page.setBypassCSP({ enabled: override.enabled }).pipe(on)
        case "Touch":
          return Emulation.setTouchEmulationEnabled({
            enabled: override.enabled,
            maxTouchPoints: override.maxTouchPoints
          }).pipe(on)
        case "FocusEmulation":
          return Emulation.setFocusEmulationEnabled({ enabled: override.enabled }).pipe(on)
        case "CacheDisabled":
          return Network.setCacheDisabled({ cacheDisabled: override.disabled }).pipe(on)
      }
    }

    const applyScripts = Effect.fnUntraced(function*(target: TargetEntry, page: PageEntry) {
      const on = Protocol.on(target.session)
      const bundles = registry.bundles(placement(page))
      for (const [key, identifier] of Array.from(target.scripts)) {
        if (!bundles.has(key)) {
          target.scripts.delete(key)
          yield* Page.removeScriptToEvaluateOnNewDocument({ identifier: identifier as Page.ScriptIdentifier }).pipe(on)
        }
      }
      for (const [key, bundle] of bundles) {
        const previous = target.scripts.get(key)
        if (previous !== undefined) {
          yield* Page.removeScriptToEvaluateOnNewDocument({ identifier: previous as Page.ScriptIdentifier }).pipe(on)
        }
        const { identifier } = yield* Page.addScriptToEvaluateOnNewDocument({
          source: bundle.source,
          ...(bundle.world._tag === "Isolated" ? { worldName: bundle.world.name } : {})
        }).pipe(on)
        target.scripts.set(key, identifier)
      }
    })

    const applyIntercepts = Effect.fnUntraced(function*(target: TargetEntry, page: PageEntry) {
      const intercepts = registry.intercepts(placement(page))
      const key = JSON.stringify(intercepts)
      if (key === target.intercepts) return
      const on = Protocol.on(target.session)
      const patterns = [
        ...intercepts.request.map((urlPattern) => ({ urlPattern, requestStage: "Request" as const })),
        ...intercepts.response.map((urlPattern) => ({ urlPattern, requestStage: "Response" as const }))
      ]
      if (patterns.length === 0 && !intercepts.auth) {
        // Never disabled while a request is paused: its decision would have nowhere to go
        if ((pausedRequests.get(requestKey(target, "")) ?? 0) === 0) yield* Fetch.disable().pipe(on)
      } else {
        yield* Fetch.enable({
          patterns: patterns.length === 0 && intercepts.auth ? [{ urlPattern: "*" }] : patterns,
          handleAuthRequests: intercepts.auth
        }).pipe(on)
      }
      target.intercepts = key
    })

    const configureTarget = Effect.fnUntraced(function*(target: TargetEntry, page: PageEntry) {
      const overrides = registry.overrides(placement(page))
      yield* Effect.forEach(overrides, ([kind, override]) => applyOverride(target.session, kind, override), {
        concurrency: "unbounded",
        discard: true
      })
      yield* applyScripts(target, page)
      yield* applyIntercepts(target, page)
      if (registry.fileChooser(placement(page)) && target.kind === "page") {
        yield* Page.setInterceptFileChooserDialog({ enabled: true }).pipe(Protocol.on(target.session))
      }
    })

    const targetsInScope = (scope: Adapter.DeclarationScope) =>
      [...targets.values()].filter((target) =>
        target.page !== undefined && !target.ended && (target.kind === "page" || target.kind === "iframe") &&
        Declarations.covers(scope, placement(target.page))
      )

    const applyDeclaration = (declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) =>
      Effect.forEach(targetsInScope(scope), (target) => {
        const page = target.page!
        switch (declaration._tag) {
          case "InitScript":
            return applyScripts(target, page)
          case "Intercept":
            return applyIntercepts(target, page)
          case "Override":
            return applyOverride(
              target.session,
              declaration.override._tag,
              registry.overrides(placement(page)).get(declaration.override._tag)
            )
          case "FileChooser":
            return target.kind === "page"
              ? Page.setInterceptFileChooserDialog({ enabled: registry.fileChooser(placement(page)) }).pipe(
                Protocol.on(target.session)
              )
              : Effect.void
          case "Downloads":
          case "BodyCollection":
            // Chromium keeps response bodies on its own, so there is nothing to collect
            return Effect.void
        }
      }, { concurrency: "unbounded", discard: true })

    const applyDownloads = (context: ContextEntry) => {
      const behavior = registry.downloads(context.id)
      return BrowserCdp.setDownloadBehavior({
        behavior: behavior === undefined ? "default" : behavior._tag === "Allow" ? "allowAndName" : "deny",
        ...(behavior?._tag === "Allow" ? { downloadPath: behavior.directory } : {}),
        ...(context.browserContextId === undefined
          ? {}
          : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID }),
        eventsEnabled: true
      }).pipe(Protocol.on(client.root))
    }

    // ── Connecting ──

    let control!: ProtocolClient.FoldControl
    const client = yield* ProtocolClient.make(transport, CdpWire.wire, {
      fold: (c) => {
        control = c
        return makeFold(c)
      }
    })
    const defaultContext = ids.userContext()
    const failConnect = (error: Protocol.ProtocolError) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "handshake", hint: error.message }), "connect")
    const version = yield* BrowserCdp.getVersion().pipe(Protocol.on(client.root), Effect.catch(failConnect))
    defaultUserAgent = version.userAgent
    const info = new Browser.Info({
      product: version.product,
      version: version.product.split("/")[1] ?? version.product,
      protocol: "cdp",
      revision: version.protocolVersion
    })
    const contextIds = yield* Target.getBrowserContexts().pipe(Protocol.on(client.root), Effect.option)
    const defaultEntry: ContextEntry = {
      id: defaultContext,
      browserContextId: Option.isSome(contextIds) ? contextIds.value.defaultBrowserContextId : undefined,
      isDefault: true,
      removing: false
    }
    contexts.set(defaultContext, defaultEntry)
    if (defaultEntry.browserContextId !== undefined) contextsByCdp.set(defaultEntry.browserContextId, defaultEntry)
    yield* control.run(Effect.suspend(() => {
      emit({ _tag: "UserContextAdded", context: defaultContext, isDefault: true })
      return flush
    }))
    yield* applyDownloads(defaultEntry).pipe(Effect.ignore)
    yield* Target.setAutoAttach({
      autoAttach: true,
      waitForDebuggerOnStart: options.ownership === "launched",
      flatten: true,
      filter: [
        { type: "page" },
        { type: "service_worker" },
        { type: "shared_worker" },
        { exclude: true }
      ]
    }).pipe(Protocol.on(client.root), Effect.catch(failConnect))
    // Targets that existed before are attached by now; from here on, new pages were created
    yield* client.root.drainObserved
    attachedAtConnect = false
    const capabilitySet = yield* SubscriptionRef.make(capabilities(info, options.ownership))

    // ── Operations ──

    const pageOf = (id: L1Target.NavigableId) =>
      Effect.suspend(() => {
        const page = pages.get(id)
        return page === undefined || page.ended
          ? Effect.fail(foreign(id))
          : Effect.succeed(page)
      })

    const frameById = (id: L1Target.NavigableId) =>
      Effect.suspend(() => {
        const frame = navigables.get(id)
        return frame === undefined ? Effect.fail(foreign(id)) : Effect.succeed(frame)
      })

    const contextOf = (id: UserContext.Id) =>
      Effect.suspend(() => {
        const context = contexts.get(id)
        return context === undefined ? Effect.fail(foreign(id)) : Effect.succeed(context)
      })

    const protocol = <A, R>(effect: Effect.Effect<A, Protocol.ProtocolError, R>) =>
      Effect.mapError(effect, protocolError)

    const run = (facts: () => void) =>
      control.run(Effect.suspend(() => {
        facts()
        return flush
      }))

    const createUserContext = Effect.fnUntraced(function*(options: Adapter.UserContextOptions) {
      if (options.acceptInsecureCerts) {
        return yield* Effect.fail(
          unsupported("acceptInsecureCerts", "CDP ignores certificate errors browser-wide, not per context")
        )
      }
      const { browserContextId } = yield* protocol(
        Target.createBrowserContext({
          disposeOnDetach: true,
          ...(Option.isSome(options.proxy)
            ? { proxyServer: options.proxy.value.server, proxyBypassList: options.proxy.value.bypass.join(",") }
            : {})
        }).pipe(Protocol.on(client.root))
      )
      const entry: ContextEntry = { id: ids.userContext(), browserContextId, isDefault: false, removing: false }
      contexts.set(entry.id, entry)
      contextsByCdp.set(browserContextId, entry)
      yield* run(() => emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false }))
      yield* protocol(applyDownloads(entry))
      return entry.id
    })

    const removeUserContext = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      if (context.isDefault || context.browserContextId === undefined) {
        return yield* Effect.fail(
          unsupported("removeDefaultContext", "The default context exists for the whole connection")
        )
      }
      context.removing = true
      const inContext = [...pages.values()].filter((page) => page.context === context)
      yield* protocol(
        Target.disposeBrowserContext({ browserContextId: context.browserContextId as BrowserCdp.BrowserContextID })
          .pipe(
            Protocol.on(client.root)
          )
      )
      yield* Effect.forEach(inContext, (page) => page.target.session.ended, { discard: true })
      contexts.delete(id)
      contextsByCdp.delete(context.browserContextId)
      yield* run(() => emit({ _tag: "UserContextRemoved", context: id }))
    })

    const createPage = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      const { targetId } = yield* protocol(
        Target.createTarget({
          url: "about:blank",
          ...(context.isDefault || context.browserContextId === undefined
            ? {}
            : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID })
        }).pipe(Protocol.on(client.root))
      )
      // The target attached before the reply; its attach is folded once this returns
      yield* client.root.drainObserved
      const page = targetsById.get(targetId)?.page
      if (page === undefined) {
        return yield* Effect.fail(gone({ _tag: "Browser" }, { _tag: "PageClosed", by: "browser" }))
      }
      yield* Deferred.await(page.ready)
      return page.id
    })

    const closePage = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
        const page = yield* pageOf(id)
        if (options.runBeforeUnload) {
          yield* protocol(Page.close().pipe(Protocol.on(page.target.session)))
          return
        }
        page.closing = { _tag: "PageClosed", by: "command" }
        yield* protocol(
          Target.closeTarget({ targetId: page.targetId as Target.TargetID }).pipe(Protocol.on(client.root))
        )
      }
    )

    const expect = (frame: FrameEntry, url: string) => {
      const id = ids.navigation()
      frame.expected.push({ id, url })
      return id
    }

    // A command that never started a navigation: its id ends at once, with the browser's reason.
    const neverStarted = Effect.fnUntraced(
      function*(frame: FrameEntry, id: PageNavigation.Id, url: string, error: string) {
        yield* frame.owner.session.drainObserved
        const index = frame.expected.findIndex((expected) => expected.id === id)
        if (index < 0) return
        frame.expected.splice(index, 1)
        yield* run(() => {
          emit({ _tag: "NavigationStarted", navigation: id, navigable: frame.id, url, initiatedAs: "crossDocument" })
          emit({
            _tag: "NavigationEnded",
            navigation: id,
            outcome: { _tag: "Failed", error, errorDocument: Option.none() },
            evidence: "cdp:Page.navigate"
          })
        })
      }
    )

    const navigate = Effect.fnUntraced(function*(
      navigable: L1Target.NavigableId,
      url: string,
      options: { readonly referrer: Option.Option<string> }
    ) {
      const frame = yield* frameById(navigable)
      const id = expect(frame, url)
      const reply = yield* protocol(
        Page.navigate({
          url,
          frameId: frame.frameId as Page.FrameId,
          ...(Option.isSome(options.referrer) ? { referrer: options.referrer.value } : {})
        }).pipe(Protocol.on(frame.owner.session))
      ).pipe(Effect.tapError(() =>
        Effect.sync(() => {
          const index = frame.expected.findIndex((expected) => expected.id === id)
          if (index >= 0) frame.expected.splice(index, 1)
        })
      ))
      if (reply.errorText !== undefined && reply.loaderId === undefined) {
        yield* neverStarted(frame, id, url, reply.errorText)
      }
      return id
    })

    const reload = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: { readonly ignoreCache: boolean }) {
      const page = yield* pageOf(id)
      const frame = navigables.get(page.id)!
      const navigation = expect(frame, frame.document?.url ?? "")
      yield* protocol(Page.reload({ ignoreCache: options.ignoreCache }).pipe(Protocol.on(page.target.session)))
      return navigation
    })

    const traverse = Effect.fnUntraced(function*(id: L1Target.NavigableId, delta: number) {
      const page = yield* pageOf(id)
      const frame = navigables.get(page.id)!
      const history = yield* protocol(Page.getNavigationHistory().pipe(Protocol.on(page.target.session)))
      const entry = history.entries[history.currentIndex + delta]
      if (entry === undefined) return Option.none<PageNavigation.Id>()
      const navigation = expect(frame, entry.url)
      yield* protocol(Page.navigateToHistoryEntry({ entryId: entry.id }).pipe(Protocol.on(page.target.session)))
      return Option.some(navigation)
    })

    const realmFor = Effect.fnUntraced(function*(id: L1Target.DocumentId, world: Adapter.World) {
      const document = documents.get(id)
      if (document === undefined) return yield* Effect.fail(foreign(id))
      const existing = [...document.realms].find((realm) =>
        !realm.ended && realm.world._tag === world._tag &&
        (world._tag === "Main" || (realm.world._tag === "Isolated" && realm.world.name === world.name))
      )
      if (existing !== undefined) return existing.id
      if (world._tag === "Main") {
        return yield* Effect.fail(unsupported("mainWorld", "The document has no main-world realm yet"))
      }
      const frame = document.frame
      const { executionContextId } = yield* protocol(
        Page.createIsolatedWorld({ frameId: frame.frameId as Page.FrameId, worldName: world.name }).pipe(
          Protocol.on(frame.owner.session)
        )
      )
      yield* frame.owner.session.drainObserved
      const realm = realmsByContext.get(contextKey(frame.owner, executionContextId as number))
      if (realm === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id }, { _tag: "DocumentReplaced" }))
      }
      return realm.id
    })

    const evaluate = Effect.fnUntraced(function*(id: L1Target.RealmId, call: Adapter.EvaluationCall) {
      const realm = realms.get(id)
      if (realm === undefined || realm.ended) {
        return yield* Effect.fail(gone({ _tag: "Realm", id }, { _tag: "RealmDestroyed" }))
      }
      const reply = yield* protocol(
        Runtime.callFunctionOn({
          functionDeclaration: call.functionDeclaration,
          uniqueContextId: realm.uniqueId,
          arguments: call.arguments.map((argument) => toCallArgument(argument, handles)),
          awaitPromise: call.awaitPromise,
          userGesture: call.userActivation,
          returnByValue: false,
          serializationOptions: call.result === "value"
            ? { serialization: "deep", maxDepth: 64 }
            : { serialization: "idOnly" }
        }).pipe(Protocol.on(realm.target.session))
      )
      const documentOf = (loaderId: string) => documentsByLoader.get(loaderId)?.id
      const value = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
        if (call.result === "handle" && object.objectId !== undefined) {
          const handle = ids.handle()
          handles.set(handle, { target: realm.target, objectId: object.objectId })
          return {
            ...toRemoteValue(object.deepSerializedValue ?? { type: object.type }, documentOf),
            handle
          } as Adapter.RemoteValue
        }
        return object.deepSerializedValue !== undefined
          ? toRemoteValue(object.deepSerializedValue, documentOf)
          : toRemoteValue({ type: object.type as Runtime.DeepSerializedValueType, value: object.value }, documentOf)
      }
      if (reply.exceptionDetails !== undefined) {
        const details = reply.exceptionDetails
        return {
          _tag: "Exception",
          text: details.exception?.description ?? details.text,
          exception: details.exception === undefined ? { type: "undefined" } : value(details.exception),
          stack: Option.fromUndefinedOr(details.exception?.description)
        } satisfies Adapter.RemoteResult
      }
      return { _tag: "Value", value: value(reply.result) } satisfies Adapter.RemoteResult
    })

    const releaseHandles = (list: ReadonlyArray<Adapter.HandleId>) =>
      Effect.forEach(list, (id) => {
        const handle = handles.get(id)
        handles.delete(id)
        return handle === undefined || handle.target.ended
          ? Effect.void
          : Runtime.releaseObject({ objectId: handle.objectId as Runtime.RemoteObjectId }).pipe(
            Protocol.on(handle.target.session),
            Effect.ignore
          )
      }, { concurrency: "unbounded", discard: true })

    const dispatchInput = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, events: ReadonlyArray<Adapter.InputEvent>) {
        const page = yield* pageOf(id)
        const on = Protocol.on(page.target.session)
        for (const event of events) {
          switch (event._tag) {
            case "Mouse":
              yield* protocol(
                Input.dispatchMouseEvent({
                  type: event.type === "move" ? "mouseMoved" : event.type === "down" ? "mousePressed" : "mouseReleased",
                  x: event.x,
                  y: event.y,
                  button: event.button,
                  clickCount: event.clickCount,
                  modifiers: modifierBits(event.modifiers)
                }).pipe(on)
              )
              break
            case "Wheel":
              yield* protocol(
                Input.dispatchMouseEvent({
                  type: "mouseWheel",
                  x: event.x,
                  y: event.y,
                  deltaX: event.deltaX,
                  deltaY: event.deltaY,
                  modifiers: modifierBits(event.modifiers)
                }).pipe(on)
              )
              break
            case "Key": {
              const text = Option.getOrUndefined(event.text)
              const code = keyCode(event.key)
              yield* protocol(
                Input.dispatchKeyEvent({
                  type: event.type === "up" ? "keyUp" : text === undefined ? "rawKeyDown" : "keyDown",
                  key: event.key,
                  code: event.code,
                  modifiers: modifierBits(event.modifiers),
                  autoRepeat: event.autoRepeat,
                  ...(text === undefined ? {} : { text: Redacted.make(text), unmodifiedText: Redacted.make(text) }),
                  ...(code === undefined ? {} : { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
                }).pipe(on)
              )
              break
            }
            case "InsertText":
              yield* protocol(Input.insertText({ text: Redacted.make(event.text) }).pipe(on))
              break
            case "Touch":
              yield* protocol(
                Input.dispatchTouchEvent({
                  type: event.type === "start"
                    ? "touchStart"
                    : event.type === "move"
                    ? "touchMove"
                    : event.type === "end"
                    ? "touchEnd"
                    : "touchCancel",
                  touchPoints: event.points.map((point) => ({ x: point.x, y: point.y, id: point.id })),
                  modifiers: modifierBits(event.modifiers)
                }).pipe(on)
              )
              break
          }
        }
      }
    )

    const resolve = Effect.fnUntraced(function*(id: Adapter.ObligationId, decision: Adapter.Decision) {
      const obligation = obligations.get(id)
      if (obligation === undefined) return yield* Effect.fail(foreign(id))
      const on = Protocol.on(obligation.target.session)
      switch (obligation._tag) {
        case "PausedRequest": {
          const requestId = obligation.requestId as Fetch.RequestId
          const send = (() => {
            switch (decision._tag) {
              case "Continue": {
                const overrides = Option.getOrUndefined(decision.overrides)
                return obligation.phase === "response" && overrides === undefined
                  ? Fetch.continueResponse({ requestId }).pipe(on)
                  : Fetch.continueRequest({
                    requestId,
                    ...(overrides?.url === undefined ? {} : { url: overrides.url }),
                    ...(overrides?.method === undefined ? {} : { method: overrides.method }),
                    ...(overrides?.headers === undefined
                      ? {}
                      : { headers: Object.entries(overrides.headers).map(([name, value]) => ({ name, value })) }),
                    ...(overrides?.body === undefined ? {} : { postData: base64(overrides.body) })
                  }).pipe(on)
              }
              case "Fulfill":
                return Fetch.fulfillRequest({
                  requestId,
                  responseCode: decision.status,
                  responseHeaders: Object.entries(decision.headers).map(([name, value]) => ({ name, value })),
                  body: base64(decision.body)
                }).pipe(on)
              case "Fail":
                return Fetch.failRequest({ requestId, errorReason: failReasons[decision.error] as Network.ErrorReason })
                  .pipe(on)
              case "ProvideCredentials":
                return Fetch.continueWithAuth({
                  requestId,
                  authChallengeResponse: {
                    response: "ProvideCredentials",
                    username: decision.username,
                    password: Redacted.make(decision.password)
                  }
                }).pipe(on)
              case "DefaultAuth":
              case "CancelAuth":
                return Fetch.continueWithAuth({
                  requestId,
                  authChallengeResponse: { response: decision._tag === "DefaultAuth" ? "Default" : "CancelAuth" }
                }).pipe(on)
              default:
                return Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Unsupported({ method: `resolve ${decision._tag}` })
                  })
                )
            }
          })()
          yield* protocol(send)
          const key = requestKey(obligation.target, "")
          pausedRequests.set(key, Math.max(0, (pausedRequests.get(key) ?? 1) - 1))
          obligations.delete(id)
          yield* run(() => emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "cdp:Fetch" }))
          return
        }
        case "Prompt": {
          if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
            return yield* Effect.fail(unsupported(decision._tag, "A prompt is accepted or dismissed"))
          }
          yield* protocol(
            Page.handleJavaScriptDialog({
              accept: decision._tag === "Accept",
              ...(decision._tag === "Accept" && Option.isSome(decision.promptText)
                ? { promptText: decision.promptText.value }
                : {})
            }).pipe(on)
          )
          return
        }
        case "FileChooser": {
          obligations.delete(id)
          if (decision._tag === "SetFiles" && obligation.backendNodeId !== undefined) {
            yield* protocol(
              DOM.setFileInputFiles({
                files: [...decision.files],
                backendNodeId: obligation.backendNodeId as DOM.BackendNodeId
              }).pipe(on)
            )
          }
          yield* run(() =>
            emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "cdp:DOM.setFileInputFiles" })
          )
          return
        }
      }
    })

    const declare = Effect.fnUntraced(function*(scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
      const id = ids.registration()
      registry.add(scope, declaration, id)
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          registry.remove(id)
          return declaration._tag === "Downloads"
            ? Effect.forEach([...contexts.values()], (context) => applyDownloads(context).pipe(Effect.ignore), {
              discard: true
            })
            : applyDeclaration(declaration, scope).pipe(Effect.ignore)
        })
      )
      if (declaration._tag === "Downloads") {
        const affected = scope._tag === "UserContext"
          ? [contexts.get(scope.context)].filter((context) => context !== undefined)
          : [...contexts.values()]
        yield* protocol(Effect.forEach(affected, applyDownloads, { discard: true }))
      } else {
        yield* protocol(applyDeclaration(declaration, scope))
      }
      return id
    })

    const screenshot = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: Adapter.ScreenshotOptions) {
      const page = yield* pageOf(id)
      const on = Protocol.on(page.target.session)
      let clip = Option.getOrUndefined(options.clip)
      if (options.fullPage && clip === undefined) {
        const metrics = yield* protocol(Page.getLayoutMetrics().pipe(on))
        clip = { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height }
      }
      const { data } = yield* protocol(
        Page.captureScreenshot({
          format: options.format,
          ...(Option.isSome(options.quality) ? { quality: options.quality.value } : {}),
          ...(clip === undefined ? {} : { clip: { ...clip, scale: 1 }, captureBeyondViewport: true }),
          fromSurface: true
        }).pipe(on)
      )
      return fromBase64(data)
    })

    const pdf = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: Adapter.PdfOptions) {
      const page = yield* pageOf(id)
      const { data } = yield* protocol(
        Page.printToPDF({
          landscape: options.landscape,
          printBackground: options.printBackground,
          scale: options.scale,
          paperWidth: options.paperWidth,
          paperHeight: options.paperHeight,
          marginTop: options.margins.top,
          marginBottom: options.margins.bottom,
          marginLeft: options.margins.left,
          marginRight: options.margins.right,
          ...(Option.isSome(options.pageRanges) ? { pageRanges: options.pageRanges.value } : {})
        }).pipe(Protocol.on(page.target.session))
      )
      return fromBase64(data)
    })

    const contextParam = (context: ContextEntry) =>
      context.browserContextId === undefined
        ? {}
        : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID }

    const cookies = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      const { cookies } = yield* protocol(Storage.getCookies(contextParam(context)).pipe(Protocol.on(client.root)))
      return cookies.map((cookie): Adapter.Cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.session || cookie.expires < 0 ? Option.none() : Option.some(cookie.expires),
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === "Strict"
          ? Option.some("Strict" as const)
          : cookie.sameSite === "Lax"
          ? Option.some("Lax" as const)
          : cookie.sameSite === "None"
          ? Option.some("None" as const)
          : Option.none(),
        partitionKey: Option.fromUndefinedOr(cookie.partitionKey?.topLevelSite)
      }))
    })

    const setCookies = Effect.fnUntraced(function*(id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
      const context = yield* contextOf(id)
      yield* protocol(
        Storage.setCookies({
          ...contextParam(context),
          cookies: list.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            ...(Option.isSome(cookie.expires) ? { expires: cookie.expires.value } : {}),
            ...(Option.isSome(cookie.sameSite) ? { sameSite: cookie.sameSite.value } : {}),
            ...(Option.isSome(cookie.partitionKey)
              ? { partitionKey: { topLevelSite: cookie.partitionKey.value, hasCrossSiteAncestor: false } }
              : {})
          }))
        }).pipe(Protocol.on(client.root))
      )
    })

    const clearCookies = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      yield* protocol(Storage.clearCookies(contextParam(context)).pipe(Protocol.on(client.root)))
    })

    const grantPermissions = Effect.fnUntraced(function*(
      id: UserContext.Id,
      origin: Option.Option<string>,
      permissions: ReadonlyArray<string>
    ) {
      const context = yield* contextOf(id)
      // Web permission names, as the Permissions API writes them
      yield* protocol(Effect.forEach(permissions, (name) =>
        BrowserCdp.setPermission({
          ...contextParam(context),
          permission: { name },
          setting: "granted",
          ...(Option.isSome(origin) ? { origin: origin.value } : {})
        }).pipe(Protocol.on(client.root)), { discard: true }))
    })

    const resetPermissions = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      yield* protocol(BrowserCdp.resetPermissions(contextParam(context)).pipe(Protocol.on(client.root)))
    })

    const responseBody = Effect.fnUntraced(function*(hop: NetworkRequest.HopId) {
      const request = hops.get(hop)
      if (request === undefined) return yield* Effect.fail(foreign(hop))
      if (request.hop !== hop) {
        return yield* Effect.fail(unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
      }
      // The body is complete once the request has finished loading
      yield* Deferred.await(request.finished).pipe(
        Effect.mapError((error) => unsupported("body.failed", `The request failed (${error}), so it has no body`))
      )
      const { body, base64Encoded } = yield* protocol(
        Network.getResponseBody({ requestId: request.requestId as Network.RequestId }).pipe(
          Protocol.on(request.target.session)
        )
      )
      return base64Encoded ? fromBase64(body) : new TextEncoder().encode(body)
    })

    const setInputFiles = Effect.fnUntraced(function*(node: Adapter.NodeBinding, files: ReadonlyArray<string>) {
      const document = documents.get(node.document)
      if (document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      yield* protocol(
        DOM.setFileInputFiles({
          files: [...files],
          backendNodeId: Number(node.binding) as DOM.BackendNodeId
        }).pipe(Protocol.on(document.frame.owner.session))
      )
    })

    const downloadPath = (id: Download.Id) =>
      Effect.suspend(() => {
        const download = downloadsById.get(id)
        if (download === undefined) return Effect.fail(foreign(id))
        return Effect.succeed(
          download.directory === undefined
            ? Option.none<string>()
            : Option.some(`${download.directory}/${download.guid}`)
        )
      })

    return {
      info,
      capabilities: capabilitySet,
      pauseScope: options.ownership === "launched" ? "browser" : "related",
      defaultContext,
      closed: client.closed,
      createUserContext,
      removeUserContext,
      createPage,
      closePage,
      activatePage: (id) =>
        pageOf(id).pipe(Effect.flatMap((page) => protocol(Page.bringToFront().pipe(Protocol.on(page.target.session))))),
      navigate,
      reload,
      traverse,
      realm: realmFor,
      evaluate,
      releaseHandles,
      dispatchInput,
      resolve,
      declare,
      screenshot,
      pdf,
      cookies,
      setCookies,
      clearCookies,
      grantPermissions,
      resetPermissions,
      responseBody,
      setInputFiles,
      downloadPath
    } satisfies Adapter.AdapterConnection
  }
)

// URLs compared as the browser writes them: `http://a` and `http://a/` are one navigation.
const normalize = (url: string): string => {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

// NetworkConnection.Frame, without importing the module's runtime for its class alone.
import { Frame as NetworkConnectionFrame } from "../NetworkConnection.ts"
