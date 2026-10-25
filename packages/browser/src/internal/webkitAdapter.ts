/**
 * The WebKit backend adapter, for Playwright's WebKit build (PROTOCOL.md, Backend adapters; review 08). It keeps
 * the correlation tables from WebKit's ids to L1's, folds WebKit's events into facts, configures every new target
 * before its scripts run, and carries out L1's operations.
 *
 * - **Pages are page proxies.** A page proxy (`Playwright.pageProxyCreated`) is the page: it outlives
 *   navigations, and takes input, dialogs and the viewport. Its inspector target is the page in a web process,
 *   which a cross-site navigation replaces: the new target is provisional until
 *   `Target.didCommitProvisionalTarget`, and its main frame has a new frame id, which this adapter maps onto the
 *   same navigable. Loader ids survive the swap, so a navigation is followed across it.
 * - **The gate.** Every target after the first page starts paused (`isPaused`). While it is, the adapter enables
 *   `Page`, `Network`, `Console` and `Worker`, takes the resource tree (the snapshot the session is synced with),
 *   enables `Runtime`, applies the declarations in force, and resumes it with `Target.resume`, in a finalizer.
 *   A worker waits the same way until `Worker.initialized`.
 * - **Realms** are execution contexts. WebKit never says one is destroyed: a document's realms end when another
 *   document commits in its frame, when the frame goes, or with their target.
 * - **Evaluation** runs through a helper installed in each realm (`webkitUtility.ts`), because WebKit calls
 *   functions only on objects and serializes only JSON. The helper returns WebDriver BiDi's `RemoteValue`.
 * - **Readiness.** WebKit can report a document's `load` before its `DOMContentLoaded`; a document is reported
 *   interactive, then complete, whichever arrives first. A complete document that loads again was reopened
 *   (`document.open()`), which WebKit reports no other way, so it starts a new generation.
 * - **Hazards** (PROBES.md, WebKit): `Playwright.navigate` with a frame id the page doesn't have, and
 *   `Dialog.handleJavaScriptDialog` with no dialog open, abort the browser. The adapter navigates only frames it
 *   has seen and not seen go, and answers only dialogs it has seen open and not seen close.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Browser from "../Browser.ts"
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
import * as Console from "../webkit-protocol/Console.ts"
import * as DialogWk from "../webkit-protocol/Dialog.ts"
import * as DOM from "../webkit-protocol/DOM.ts"
import * as Emulation from "../webkit-protocol/Emulation.ts"
import * as Input from "../webkit-protocol/Input.ts"
import * as Network from "../webkit-protocol/Network.ts"
import * as Page from "../webkit-protocol/Page.ts"
import * as Playwright from "../webkit-protocol/Playwright.ts"
import * as Runtime from "../webkit-protocol/Runtime.ts"
import * as Screencast from "../webkit-protocol/Screencast.ts"
import * as Target from "../webkit-protocol/Target.ts"
import * as Worker from "../webkit-protocol/Worker.ts"
import * as Adapter from "./adapter.ts"
import * as Declarations from "./declarations.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"
import * as Utility from "./webkitUtility.ts"
import * as WebKitWire from "./webkitWire.ts"

// ── Tables ────────────────────────────────────────────────────────────────────────────────────────────────

interface ContextEntry {
  readonly id: UserContext.Id
  /** WebKit's id; the default context's too, once a page in it reports it. */
  browserContextId: string | undefined
  readonly isDefault: boolean
  removing: boolean
  /** Permissions granted here, by origin (`*` for every origin), applied to each new page. */
  readonly permissions: Map<string, ReadonlyArray<string>>
}

interface PageEntry {
  readonly id: L1Target.NavigableId
  readonly pageProxyId: string
  readonly session: ProtocolClient.Session
  readonly context: ContextEntry
  readonly ready: Deferred.Deferred<void, Adapter.AdapterError>
  /** The committed target, and the one a cross-site navigation is loading in. */
  target: TargetEntry | undefined
  provisional: TargetEntry | undefined
  readonly main: FrameEntry
  /** Isolated worlds asked for, created in every target the page gets. */
  readonly worlds: Set<string>
  /** The open dialog's obligation, so that only an open dialog is answered. */
  dialog: Adapter.ObligationId | undefined
  closing: L1Target.CloseReason | undefined
  ended: boolean
}

interface TargetEntry {
  readonly targetId: string
  readonly session: ProtocolClient.Session
  readonly page: PageEntry
  /** The main frame's id in this target's process. */
  mainFrameId: string | undefined
  /** The intercepts last applied, so that a change is applied once. */
  intercepts: ReadonlyArray<{ readonly url: string; readonly stage: "request" | "response" }>
  /** The last message, which a repeat count update repeats. */
  lastConsole: Console.ConsoleMessage | undefined
  ended: boolean
}

interface WorkerEntry {
  readonly workerId: string
  readonly session: ProtocolClient.Session
  readonly target: TargetEntry
  readonly url: string
  realm: RealmEntry | undefined
  lastConsole: Console.ConsoleMessage | undefined
}

interface FrameEntry {
  /** The frame's id in its current target. */
  frameId: string
  readonly id: L1Target.NavigableId
  readonly page: PageEntry
  readonly parent: FrameEntry | undefined
  readonly children: Set<FrameEntry>
  document: DocumentEntry | undefined
  /** Navigations started by a command that the browser hasn't announced yet, oldest first. */
  readonly expected: Array<
    { readonly id: PageNavigation.Id; readonly url: string; readonly initiatedAs: Adapter.InitiatedAs }
  >
  readonly navigations: Map<string, NavigationEntry>
  removed: boolean
}

interface DocumentEntry {
  readonly id: L1Target.DocumentId
  readonly frame: FrameEntry
  loaderId: string
  url: string
  readonly realms: Set<RealmEntry>
  interactive: boolean
  complete: boolean
  generation: number
}

interface RealmEntry {
  readonly id: L1Target.RealmId
  /** The session evaluations go to: the target's, or the worker's. */
  readonly session: ProtocolClient.Session
  /** The execution context; `undefined` for a worker's global scope. */
  readonly contextId: number | undefined
  readonly target: TargetEntry
  readonly document: DocumentEntry | undefined
  readonly world: Adapter.World
  helper: Deferred.Deferred<string, Adapter.AdapterError> | undefined
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
  ended: boolean
}

interface RequestEntry {
  readonly id: NetworkRequest.Id
  readonly session: ProtocolClient.Session
  readonly requestId: string
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
  /** What its events called it: a pause doesn't say (review 17, P11). */
  readonly resourceType: NetworkRequest.ResourceType
  /** Its body, base64, as `Network.requestWillBeSent` carried it (review 17, P10). */
  readonly postData: string | undefined
}

type ObligationEntry =
  | {
    readonly _tag: "PausedRequest"
    readonly id: Adapter.ObligationId
    readonly target: TargetEntry
    readonly requestId: string
    readonly phase: "request" | "response"
    /** The request's body, base64, as WebKit sends it (review 17, P10). */
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
  | {
    readonly _tag: "FileChooser"
    readonly id: Adapter.ObligationId
    readonly target: TargetEntry
    readonly objectId: string
  }

interface DownloadEntry {
  readonly id: Download.Id
  readonly uuid: string
  readonly page: PageEntry | undefined
  readonly url: string
  readonly directory: string | undefined
  ended: boolean
}

interface HandleEntry {
  readonly session: ProtocolClient.Session
  readonly objectId: string
}

// ── Mapping ───────────────────────────────────────────────────────────────────────────────────────────────

const resourceTypes: Readonly<Record<string, NetworkRequest.ResourceType>> = {
  Document: "document",
  StyleSheet: "stylesheet",
  Image: "image",
  Font: "font",
  Script: "script",
  XHR: "xhr",
  Fetch: "fetch",
  Ping: "ping",
  Beacon: "ping",
  WebSocket: "webSocket",
  EventSource: "eventSource"
}

const methods = new Set(NetworkRequest.Method.literals as ReadonlyArray<string>)

const consoleLevel = (level: string): ConsoleMessage.Level =>
  level === "error" ? "error" : level === "warning" ? "warning" : level === "info" ? "info" : level === "debug"
    ? "debug" :
    "log"

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
    : value.value !== undefined && value.type !== "object"
    ? String(value.value)
    : value.description ?? value.type

// Windows virtual key codes, which WebKit needs to act on a key, as CDP does.
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

// Media features WebKit emulates, as user preferences, and the values each takes.
const preferences: Readonly<
  Record<string, { readonly name: Page.UserPreferenceName; readonly values: Readonly<Record<string, string>> }>
> = {
  "prefers-color-scheme": {
    name: "PrefersColorScheme",
    values: { light: "Light", dark: "Dark", "no-preference": "NoPreference" }
  },
  "prefers-reduced-motion": {
    name: "PrefersReducedMotion",
    values: { reduce: "Reduce", "no-preference": "NoPreference" }
  },
  "prefers-contrast": { name: "PrefersContrast", values: { more: "More", "no-preference": "NoPreference" } }
}

/** A `*` glob over the whole URL, as a regular expression. */
const globToRegex = (glob: string): string =>
  `^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join(".*")}$`

/** The events the fold needs. */
const foldEvents: ReadonlyArray<Protocol.EventDef<string, any>> = [
  Playwright.pageProxyCreated,
  Playwright.provisionalLoadFailed,
  Playwright.downloadCreated,
  Playwright.downloadFilenameSuggested,
  Playwright.downloadFinished,
  Target.targetCreated,
  Target.targetDestroyed,
  Target.didCommitProvisionalTarget,
  DialogWk.javascriptDialogOpening,
  DialogWk.javascriptDialogClosed,
  Page.frameAttached,
  Page.frameDetached,
  Page.frameNavigated,
  Page.navigatedWithinDocument,
  Page.domContentEventFired,
  Page.loadEventFired,
  Page.fileChooserOpened,
  Runtime.executionContextCreated,
  Console.messageAdded,
  Console.messageRepeatCountUpdated,
  Worker.workerCreated,
  Worker.workerTerminated,
  Network.requestWillBeSent,
  Network.responseReceived,
  Network.loadingFinished,
  Network.requestServedFromMemoryCache,
  Network.loadingFailed,
  Network.requestIntercepted,
  Network.responseIntercepted,
  Network.webSocketCreated,
  Network.webSocketFrameSent,
  Network.webSocketFrameReceived,
  Network.webSocketClosed
]

const base64 = (bytes: Uint8Array): string => Encoding.encode(bytes)
const fromBase64 = (text: string): Uint8Array => {
  const decoded = Encoding.decode(text)
  return decoded._tag === "Success" ? decoded.success : new Uint8Array()
}
const fromDataUrl = (url: string): Uint8Array => fromBase64(url.slice(url.indexOf(",") + 1))

// ── Remote values ─────────────────────────────────────────────────────────────────────────────────────────

/** The `RemoteValue` type of a WebKit remote object, for a value kept as a handle. */
const remoteType = (object: Runtime.RemoteObject): Adapter.RemoteValue["type"] => {
  switch (object.type) {
    case "undefined":
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "function":
      return object.type as Adapter.RemoteValue["type"]
  }
  switch (object.subtype) {
    case "null":
      return "null"
    case "array":
    case "node":
    case "regexp":
    case "date":
    case "error":
    case "map":
    case "set":
    case "weakmap":
    case "weakset":
    case "proxy":
      return object.subtype as Adapter.RemoteValue["type"]
    case "iterator":
      return "generator"
  }
  switch (object.className) {
    case "Promise":
      return "promise"
    case "Window":
      return "window"
    case "NodeList":
      return "nodelist"
    case "HTMLCollection":
      return "htmlcollection"
    case "ArrayBuffer":
      return "arraybuffer"
  }
  return object.className !== undefined && /^(Big)?(Int|Uint|Float)\d+(Clamped)?Array$/.test(object.className)
    ? "typedarray"
    : "object"
}

/** A primitive remote object's value. */
const primitive = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
  switch (object.type) {
    case "undefined":
      return { type: "undefined" }
    case "string":
      return { type: "string", value: String(object.value) }
    case "boolean":
      return { type: "boolean", value: Boolean(object.value) }
    case "number": {
      const description = object.description ?? String(object.value)
      return {
        type: "number",
        value: typeof object.value === "number" && !Object.is(object.value, -0)
          ? object.value
          : description === "-0" || description === "NaN" || description === "Infinity" || description === "-Infinity"
          ? description
          : Number(description)
      }
    }
    case "bigint":
      return { type: "bigint", value: (object.description ?? "0").replace(/n$/, "") }
    default:
      return object.subtype === "null" ? { type: "null" } : { type: remoteType(object) } as Adapter.RemoteValue
  }
}

// A serialized value from the helper: nodes carry their index in the batch, replaced by their binding here.
type Serialized = Adapter.RemoteValue & { readonly nodeIndex?: number }

const withBindings = (
  value: Serialized,
  binding: (index: number) => Adapter.NodeBinding | undefined
): Adapter.RemoteValue => {
  switch (value.type) {
    case "node": {
      const { nodeIndex, ...rest } = value as Serialized & { readonly type: "node" }
      const node = nodeIndex === undefined ? undefined : binding(nodeIndex)
      return node === undefined ? rest : { ...rest, node }
    }
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return value.value === undefined ? value : {
        ...value,
        value: value.value.map((item) => withBindings(item as Serialized, binding))
      }
    case "object":
    case "map":
      return value.value === undefined ? value : {
        ...value,
        value: value.value.map(([key, item]) =>
          [
            typeof key === "string" ? key : withBindings(key as Serialized, binding),
            withBindings(item as Serialized, binding)
          ] as const
        )
      }
    default:
      return value
  }
}

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────────────

const capabilities = (info: Browser.Info) => {
  const evidence = `WebKit adapter static profile, ${info.product} ${info.revision}`
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("userContexts", "supported"),
      entry("isolatedWorlds", "supported", [
        "created in every frame of the page; init scripts run in the main world only"
      ]),
      entry("pauseOnStart.frames", "supported", ["frames run in their page's process, which is paused"]),
      entry("pauseOnStart.workers", "supported"),
      entry("pauseOnStart.popups", "supported"),
      entry("input.native", "supported"),
      // Recorded: an intercept never sees the requests of a page a service worker controls, even those the
      // worker passes to the network
      entry("interception.request", "partial", ["a page a service worker controls sends its requests past it"]),
      entry("interception.response", "partial", ["a page a service worker controls sends its requests past it"]),
      entry("interception.auth", "unsupported", ["WebKit answers challenges from credentials set in advance"]),
      entry("bodies", "supported"),
      entry("console", "supported", ["a message with only primitive arguments is attributed to the main frame"]),
      entry("prompts", "supported"),
      entry("fileChooser", "supported"),
      entry("downloads", "supported"),
      entry("downloads.progress", "unsupported", ["Playwright's WebKit reports a download's start and end only"]),
      entry("downloads.cancel", "supported"),
      entry("screenshot", "supported"),
      entry("pdf", "unsupported", ["Playwright's WebKit has no print-to-PDF"]),
      entry("evaluation.userActivation", "supported"),
      entry("input.insertText", "supported"),
      entry("input.pointerModifiers", "unsupported", [
        "modifiers don't reach this build's mouse events, held or flagged"
      ]),
      entry("input.dragAndDrop", "unsupported", ["Playwright's WebKit protocol has no drag commands"]),
      entry("webSocketFrames", "supported"),
      entry("networkConnections", "partial", ["no EventSource connections: WebKit reports only their request"]),
      entry("networkConnections.eventSource", "unsupported", ["WebKit reports an EventSource as a request"]),
      entry("workers.shared", "unsupported", ["Playwright's WebKit doesn't report shared workers"]),
      entry("workers.service", "unsupported", ["Playwright's WebKit doesn't report service workers"]),
      entry("workers.evaluate", "supported"),
      entry("exceptions.kind", "supported"),
      entry("network.servedBy", "supported", [
        "a script or stylesheet reused from the memory cache within one document produces no request"
      ]),
      entry("cookies", "supported"),
      entry("permissions", "supported", ["granted per page; reset clears every grant in the context"]),
      entry("permissions.anyOrigin", "supported"),
      // Review 17
      entry("interception.responseBody", "unsupported", ["Playwright's WebKit can't read a response paused there"]),
      entry("interception.responseFulfill", "supported"),
      entry("interception.continueUrl", "supported"),
      entry("interception.abortReason", "unsupported", ["WebKit reports every reason as \"Blocked by Web Inspector\""]),
      entry("interception.redirects", "partial", ["only a redirect's first hop pauses"]),
      entry("emulation.viewport", "supported"),
      entry("emulation.viewport.mobile", "supported"),
      entry("emulation.userAgent", "supported", [
        "a document reads navigator.userAgent once; requests carry it at once"
      ]),
      entry("emulation.locale", "partial", ["per context, and only before its pages exist"]),
      entry("emulation.timezone", "supported"),
      entry("emulation.geolocation", "partial", ["per context"]),
      entry("emulation.geolocation.unavailable", "unsupported", ["WebKit ignores an unavailable position"]),
      entry("emulation.media", "supported"),
      entry("emulation.network.offline", "supported"),
      entry("emulation.network.throttling", "unsupported", ["Playwright's WebKit can only take a page offline"]),
      entry("emulation.cpuSlowdown", "unsupported", ["Playwright's WebKit has no CPU throttling"]),
      entry("emulation.javaScript", "supported", ["a document already loaded keeps running its scripts"]),
      entry("emulation.touch", "unsupported", ["WebKit's touch override changes nothing a page sees"]),
      entry("emulation.focus", "supported"),
      // Review 18
      entry("screenshot.cssScale", "supported"),
      entry("screenshot.omitBackground", "supported"),
      entry("pdf.headerFooter", "unsupported", ["Playwright's WebKit has no print-to-PDF"]),
      entry("pdf.preferCssPageSize", "unsupported", ["Playwright's WebKit has no print-to-PDF"]),
      entry("cookies.partitioned", "unsupported", ["Playwright's WebKit doesn't report partitioned cookies"]),
      entry("snapshot.clickListeners", "unsupported", ["Playwright's WebKit can't list event listeners"]),
      // Review 20
      entry("capability.axTree", "unsupported", ["Playwright's WebKit reads accessibility one node at a time"]),
      entry("capability.screencast", "supported", ["frames are the viewport's size when the screencast starts"])
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
 * Connects the WebKit adapter over a transport. The connection lives as long as the scope.
 */
export const connect: (
  transport: Transport.Transport,
  options: Adapter.ConnectOptions & { readonly revision?: string | undefined }
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(
    transport: Transport.Transport,
    options: Adapter.ConnectOptions & { readonly revision?: string | undefined }
  ) {
    const ids = Adapter.makeIds()
    const registry = Declarations.make()
    const contexts = new Map<UserContext.Id, ContextEntry>()
    const contextsByWk = new Map<string, ContextEntry>()
    const pages = new Map<L1Target.NavigableId, PageEntry>()
    const pagesByProxy = new Map<string, PageEntry>()
    const targets = new Map<ProtocolClient.Session, TargetEntry>()
    const workers = new Map<ProtocolClient.Session, WorkerEntry>()
    const frames = new Map<string, FrameEntry>()
    const navigables = new Map<L1Target.NavigableId, FrameEntry>()
    const documents = new Map<L1Target.DocumentId, DocumentEntry>()
    const realms = new Map<L1Target.RealmId, RealmEntry>()
    const realmsByContext = new Map<string, RealmEntry>()
    const navigations = new Map<string, NavigationEntry>()
    const requests = new Map<string, RequestEntry>()
    const hops = new Map<NetworkRequest.HopId, RequestEntry>()
    const obligations = new Map<Adapter.ObligationId, ObligationEntry>()
    const downloads = new Map<string, DownloadEntry>()
    const downloadsById = new Map<Download.Id, DownloadEntry>()
    const handles = new Map<Adapter.HandleId, HandleEntry>()
    const connections = new Map<string, NetworkConnection.Id>()
    // Loads that failed before the command that started them replied
    const failedLoads = new Map<string, string>()
    const pausedRequests = new Map<TargetEntry, number>()
    let attachedAtConnect = true
    // The view's size, scale before any viewport override: what releasing one restores
    let naturalViewport: readonly [number, number, number] | undefined

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
    const requestKey = (session: ProtocolClient.Session, requestId: string) => `${session.key ?? ""}|${requestId}`

    // ── Ending things ──

    const removeRealm = (realm: RealmEntry, reason: L1Target.CloseReason) => {
      if (realm.ended) return
      realm.ended = true
      realms.delete(realm.id)
      if (realm.contextId !== undefined) realmsByContext.delete(contextKey(realm.target, realm.contextId))
      realm.document?.realms.delete(realm)
      emit({ _tag: "RealmRemoved", realm: realm.id, reason })
    }

    const endNavigation = (navigation: NavigationEntry, outcome: Adapter.NavigationOutcome, evidence: string) => {
      if (navigation.ended) return
      navigation.ended = true
      navigation.frame.navigations.delete(navigation.loaderId)
      if (navigations.get(navigation.loaderId) === navigation) navigations.delete(navigation.loaderId)
      emit({ _tag: "NavigationEnded", navigation: navigation.id, outcome, evidence })
    }

    const dropDocument = (document: DocumentEntry, reason: L1Target.CloseReason) => {
      for (const realm of Array.from(document.realms)) removeRealm(realm, reason)
      documents.delete(document.id)
      wakeRealmWaiters(document.id)
    }

    // Ends a frame and everything below it, deepest first.
    const removeFrame = (frame: FrameEntry, reason: L1Target.CloseReason, evidence: string) => {
      if (frame.removed) return
      for (const child of Array.from(frame.children)) removeFrame(child, reason, evidence)
      frame.removed = true
      frame.parent?.children.delete(frame)
      if (frames.get(frame.frameId) === frame) frames.delete(frame.frameId)
      navigables.delete(frame.id)
      if (frame.document !== undefined) dropDocument(frame.document, reason)
      for (const navigation of frame.navigations.values()) navigation.ended = true
      emit({ _tag: "NavigableRemoved", navigable: frame.id, reason, evidence })
    }

    const endPage = (page: PageEntry, reason: L1Target.CloseReason, evidence: string) => {
      if (page.ended) return
      page.ended = true
      for (const [frameId, frame] of Array.from(frames)) {
        if (frame === page.main) frames.delete(frameId)
      }
      removeFrame(page.main, reason, evidence)
      pages.delete(page.id)
      pagesByProxy.delete(page.pageProxyId)
      for (const [id, obligation] of obligations) {
        const owner = obligation._tag === "Prompt" ? obligation.page : obligation.target.page
        if (owner === page) {
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
      createdBy: Adapter.DocumentCreatedBy,
      evidence: string
    ): DocumentEntry => {
      // Children of the replaced document end with it
      for (const child of Array.from(frame.children)) {
        removeFrame(child, { _tag: "FrameDetached" }, "webkit: the parent's document was replaced")
      }
      const old = frame.document
      const document: DocumentEntry = {
        id: ids.document(),
        frame,
        loaderId: snapshot.loaderId,
        url: snapshot.url,
        realms: new Set(),
        interactive: false,
        complete: false,
        generation: 0
      }
      documents.set(document.id, document)
      frame.document = document
      emit({
        _tag: "DocumentCommitted",
        document: document.id,
        navigable: frame.id,
        url: snapshot.url,
        origin: snapshot.origin === "" ? "null" : snapshot.origin,
        createdBy,
        replaced: Option.fromUndefinedOr(old?.id),
        evidence
      })
      // WebKit never reports a context destroyed: the old document's realms end with it
      if (old !== undefined) dropDocument(old, { _tag: "RealmDestroyed" })
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
      return startNavigationAs(
        frame,
        expected?.id ?? ids.navigation(),
        loaderId,
        url,
        expected?.initiatedAs ?? type,
        sameDocument
      )
    }

    const startNavigationAs = (
      frame: FrameEntry,
      id: PageNavigation.Id,
      loaderId: string,
      url: string,
      type: Adapter.InitiatedAs,
      sameDocument: boolean
    ): NavigationEntry => {
      const navigation: NavigationEntry = {
        id,
        frame,
        loaderId,
        url,
        sameDocument,
        documentHop: undefined,
        status: undefined,
        ended: false
      }
      if (!sameDocument) {
        // A frame has one cross-document navigation at a time: a new one replaces the one in flight
        for (const pending of Array.from(frame.navigations.values())) {
          if (!pending.sameDocument) {
            endNavigation(pending, { _tag: "Superseded", by: navigation.id }, "webkit:Network.requestWillBeSent")
          }
        }
      }
      frame.navigations.set(loaderId, navigation)
      navigations.set(loaderId, navigation)
      emit({ _tag: "NavigationStarted", navigation: navigation.id, navigable: frame.id, url, initiatedAs: type })
      return navigation
    }

    // A load that failed: no content, or an error, by the response it got.
    const failLoad = (navigation: NavigationEntry, error: string, evidence: string) =>
      endNavigation(
        navigation,
        navigation.status === 204 || navigation.status === 205
          ? { _tag: "NoContent", status: navigation.status, response: Option.fromUndefinedOr(navigation.documentHop) }
          : { _tag: "Failed", error, errorDocument: Option.none() },
        evidence
      )

    // ── Frames and pages ──

    const addFrame = (frameId: string, parent: FrameEntry): FrameEntry => {
      const frame: FrameEntry = {
        frameId,
        id: ids.navigable(),
        page: parent.page,
        parent,
        children: new Set(),
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

    const contextFor = (browserContextId: string): ContextEntry => {
      const known = contextsByWk.get(browserContextId)
      if (known !== undefined) return known
      const fallback = contexts.get(defaultContext)!
      if (fallback.browserContextId === undefined) {
        // Every context but the default one is created here, so a context nobody created is the default
        fallback.browserContextId = browserContextId
        contextsByWk.set(browserContextId, fallback)
        return fallback
      }
      const entry: ContextEntry = {
        id: ids.userContext(),
        browserContextId,
        isDefault: false,
        removing: false,
        permissions: new Map()
      }
      contexts.set(entry.id, entry)
      contextsByWk.set(browserContextId, entry)
      emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
      return entry
    }

    const pageProxyCreated = (params: Playwright.PageProxyCreatedParams) => {
      const session = control.session(WebKitWire.pageProxyKey(params.pageProxyId))
      if (session === undefined) return
      const context = contextFor(params.browserContextId)
      const opener = params.openerId === undefined ? undefined : pagesByProxy.get(params.openerId)
      const id = ids.navigable()
      const page: PageEntry = {
        id,
        pageProxyId: params.pageProxyId,
        session,
        context,
        ready: Deferred.makeUnsafe(),
        target: undefined,
        provisional: undefined,
        main: undefined as unknown as FrameEntry,
        worlds: new Set(),
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
        expected: [],
        navigations: new Map(),
        removed: false
      }
      ;(page as { main: FrameEntry }).main = main
      pages.set(id, page)
      pagesByProxy.set(params.pageProxyId, page)
      navigables.set(id, main)
      const openerId = Option.fromUndefinedOr(opener?.id)
      emit({
        _tag: "PageAdded",
        page: id,
        context: context.id,
        kind: params.openerId === undefined ? "tab" : "popup",
        origin: attachedAtConnect
          ? { _tag: "Adopted", opener: openerId }
          : params.openerId === undefined
          ? { _tag: "Created" }
          : { _tag: "Opened", opener: openerId },
        url: "about:blank"
      })
      control.sync(session, pageProxyGate(page))
    }

    const targetCreated = (page: PageEntry, params: Target.TargetCreatedParams) => {
      const info = params.targetInfo
      const session = control.session(WebKitWire.targetKey(page.pageProxyId, info.targetId))
      if (session === undefined || info.type !== "page") {
        if (session !== undefined) {
          control.sync(session, Effect.succeed({ through: 0, apply: Effect.void }))
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
      targets.set(session, target)
      const first = page.target === undefined && page.provisional === undefined
      if (info.isProvisional === true) page.provisional = target
      else page.target = target
      control.sync(session, gate(target, first, info.isPaused === true))
    }

    const ended = (session: ProtocolClient.Session, reason: Protocol.SessionEnded) => {
      const worker = workers.get(session)
      if (worker !== undefined) {
        workers.delete(session)
        if (worker.realm !== undefined) {
          removeRealm(worker.realm, reason.why === "connectionLost" ? closed() : { _tag: "RealmDestroyed" })
        }
        return
      }
      const target = targets.get(session)
      if (target !== undefined) {
        target.ended = true
        targets.delete(session)
        pausedRequests.delete(target)
        for (const realm of Array.from(realms.values())) {
          if (realm.target === target) {
            removeRealm(realm, reason.why === "connectionLost" ? closed() : { _tag: "RealmDestroyed" })
          }
        }
        const page = target.page
        if (page.provisional === target) {
          page.provisional = undefined
          if (target.mainFrameId !== undefined && frames.get(target.mainFrameId) === page.main) {
            frames.delete(target.mainFrameId)
          }
        }
        // The page keeps its ended target, which says why it ended when the page proxy reports it
        return
      }
      const page = [...pages.values()].find((page) => page.session === session)
      if (page === undefined) return
      const why: L1Target.CloseReason = reason.why === "connectionLost"
        ? closed()
        : reason.why === "modelUnavailable"
        ? { _tag: "ModelUnavailable" }
        : page.closing ??
          (page.context.removing
            ? { _tag: "PageClosed", by: "userContextRemoved" }
            : { _tag: "PageClosed", by: "script" })
      endPage(page, why, `webkit: the page proxy's session ended (${reason.why})`)
    }

    // The realm of a page's main frame, for what WebKit doesn't attribute to one.
    const mainRealmOf = (target: TargetEntry): RealmEntry | undefined =>
      [...(target.page.main.document?.realms ?? [])].find((realm) =>
        realm.world._tag === "Main" && realm.target === target
      )

    const realmOfObject = (target: TargetEntry, objectId: string | undefined): RealmEntry | undefined => {
      if (objectId === undefined) return undefined
      try {
        const parsed = JSON.parse(objectId) as { readonly injectedScriptId?: number }
        return parsed.injectedScriptId === undefined
          ? undefined
          : realmsByContext.get(contextKey(target, parsed.injectedScriptId))
      } catch {
        return undefined
      }
    }

    const consoleMessage = (
      message: Console.ConsoleMessage,
      target: TargetEntry,
      worker: WorkerEntry | undefined
    ) => {
      if (message.source === "javascript" && message.level === "error") {
        uncaught(message, target, worker)
        return
      }
      if (message.source !== "console-api") return
      const realm = worker?.realm ??
        realmOfObject(target, message.parameters?.find((parameter) => parameter.objectId !== undefined)?.objectId) ??
        mainRealmOf(target)
      if (realm === undefined) return
      emit({
        _tag: "ConsoleMessage",
        realm: realm.id,
        message: new ConsoleMessage.ConsoleMessage({
          level: consoleLevel(message.level),
          text: message.parameters !== undefined && message.parameters.length > 0
            ? message.parameters.map(textOf).join(" ")
            : message.text,
          location: message.url === undefined || message.url === "" || message.url === "undefined"
            ? Option.none()
            : Option.some({ url: message.url as Url.Url, line: message.line ?? 0, column: message.column ?? 0 }),
          origin: realm.document !== undefined
            ? { _tag: "Page", page: target.page.id }
            : { _tag: "Worker", realm: realm.id },
          at: Adapter.now()
        })
      })
    }

    const uncaught = (message: Console.ConsoleMessage, target: TargetEntry, worker: WorkerEntry | undefined) => {
      const rejection = message.text.startsWith("Unhandled Promise Rejection: ")
      const text = rejection ? message.text.slice("Unhandled Promise Rejection: ".length) : message.text
      const colon = text.indexOf(": ")
      const realm = worker?.realm ?? mainRealmOf(target)
      const frames = message.stackTrace?.callFrames ?? []
      emit({
        _tag: "UncaughtException",
        realm: Option.fromUndefinedOr(realm?.id),
        exception: new UncaughtException.UncaughtException({
          kind: rejection ? "unhandledRejection" : "thrown",
          name: colon > 0 && /^\w+$/.test(text.slice(0, colon)) ? text.slice(0, colon) : "Error",
          message: colon > 0 && /^\w+$/.test(text.slice(0, colon)) ? text.slice(colon + 2) : text,
          stack: frames.length === 0 ? Option.none() : Option.some(
            [
              text,
              ...frames.map((frame) =>
                `    at ${
                  frame.functionName === "" ? "<anonymous>" : frame.functionName
                } (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`
              )
            ].join("\n")
          ),
          origin: worker?.realm !== undefined
            ? { _tag: "Worker", realm: worker.realm.id }
            : { _tag: "Page", page: target.page.id },
          at: Adapter.now()
        })
      })
    }

    // ── The fold ──

    type Where = {
      readonly session: ProtocolClient.Session
      readonly page: PageEntry | undefined
      readonly target: TargetEntry | undefined
      readonly worker: WorkerEntry | undefined
    }

    const handlers: Record<string, (where: Where, params: any) => void> = {
      [Playwright.pageProxyCreated.method]: (_where, params: Playwright.PageProxyCreatedParams) =>
        pageProxyCreated(params),
      [Playwright.provisionalLoadFailed.method]: (_where, params: Playwright.ProvisionalLoadFailedParams) => {
        const navigation = navigations.get(params.loaderId)
        if (navigation === undefined) {
          failedLoads.set(params.loaderId, params.error)
          return
        }
        failLoad(navigation, params.error, "webkit:Playwright.provisionalLoadFailed")
      },
      [Playwright.downloadCreated.method]: (_where, params: Playwright.DownloadCreatedParams) => {
        const page = pagesByProxy.get(params.pageProxyId)
        const download: DownloadEntry = {
          id: ids.download(),
          uuid: params.uuid,
          page,
          url: params.url,
          directory: page === undefined ? undefined : downloadDirectory(page.context.id),
          ended: false
        }
        downloads.set(params.uuid, download)
        downloadsById.set(download.id, download)
        if (page === undefined) return
        // A navigation in flight in that page, to that URL, became this download
        for (const navigation of Array.from(navigations.values())) {
          if (
            navigation.frame.page === page && !navigation.sameDocument &&
            normalize(navigation.url) === normalize(params.url)
          ) {
            endNavigation(
              navigation,
              { _tag: "Download", download: Option.some(download.id) },
              "webkit:Playwright.downloadCreated"
            )
          }
        }
      },
      [Playwright.downloadFilenameSuggested.method]: (
        _where,
        params: Playwright.DownloadFilenameSuggestedParams
      ) => {
        const download = downloads.get(params.uuid)
        if (download?.page === undefined) return
        emit({
          _tag: "DownloadStarted",
          download: download.id,
          page: download.page.id,
          url: download.url,
          suggestedFilename: params.suggestedFilename
        })
      },
      [Playwright.downloadFinished.method]: (_where, params: Playwright.DownloadFinishedParams) => {
        const download = downloads.get(params.uuid)
        if (download === undefined || download.ended) return
        download.ended = true
        emit({
          _tag: "DownloadEnded",
          download: download.id,
          outcome: params.error === ""
            ? {
              _tag: "Completed",
              path: Option.fromUndefinedOr(
                download.directory === undefined ? undefined : `${download.directory}/${download.uuid}`
              )
            }
            : { _tag: "Canceled" }
        })
      },
      [Target.targetCreated.method]: (where, params: Target.TargetCreatedParams) => {
        if (where.page !== undefined) targetCreated(where.page, params)
      },
      [Target.targetDestroyed.method]: (where, params: Target.TargetDestroyedParams) => {
        const page = where.page
        if (page === undefined || !params.crashed || page.target?.targetId !== params.targetId) return
        endPage(page, { _tag: "PageCrashed" }, "webkit:Target.targetDestroyed")
      },
      [Target.didCommitProvisionalTarget.method]: (where, params: Target.DidCommitProvisionalTargetParams) => {
        const page = where.page
        const target = page?.provisional
        if (page === undefined || target === undefined || target.targetId !== params.newTargetId) return
        page.provisional = undefined
        page.target = target
        // The main frame is the same navigable under the new process's frame id
        const old = page.main.frameId
        if (target.mainFrameId !== undefined) {
          if (frames.get(old) === page.main && old !== target.mainFrameId) frames.delete(old)
          page.main.frameId = target.mainFrameId
          frames.set(target.mainFrameId, page.main)
        }
      },
      [DialogWk.javascriptDialogOpening.method]: (where, params: DialogWk.JavascriptDialogOpeningParams) => {
        const page = where.page
        if (page === undefined) return
        const prompt = ids.prompt()
        const obligation = ids.obligation()
        obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, page, answer: undefined })
        page.dialog = obligation
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
      [DialogWk.javascriptDialogClosed.method]: (where) => {
        const page = where.page
        const id = page?.dialog
        if (page === undefined || id === undefined) return
        page.dialog = undefined
        const obligation = obligations.get(id)
        if (obligation?._tag !== "Prompt") return
        obligations.delete(id)
        emit({
          _tag: "PromptClosed",
          prompt: obligation.prompt,
          accepted: obligation.answer?.accepted ?? false,
          userText: obligation.answer?.userText ?? Option.none()
        })
        emit({
          _tag: "ObligationEnded",
          obligation: id,
          reason: "resolved",
          evidence: "webkit:Dialog.javascriptDialogClosed"
        })
      },
      [Page.frameAttached.method]: (where, params: Page.FrameAttachedParams) => {
        if (where.target === undefined || frames.has(params.frameId)) return
        const parent = params.parentFrameId === undefined ? undefined : frames.get(params.parentFrameId)
        if (parent === undefined) return
        const frame = addFrame(params.frameId, parent)
        commit(
          frame,
          { loaderId: `initial:${params.frameId}`, url: "about:blank", origin: "null" },
          { _tag: "InitialBlank" },
          "webkit:Page.frameAttached"
        )
      },
      [Page.frameDetached.method]: (_where, params: Page.FrameDetachedParams) => {
        const frame = frames.get(params.frameId)
        if (frame === undefined || frame.parent === undefined) return
        removeFrame(frame, { _tag: "FrameDetached" }, "webkit:Page.frameDetached")
      },
      [Page.frameNavigated.method]: (where, params: Page.FrameNavigatedParams) => {
        if (where.target === undefined) return
        const f = params.frame
        let frame = frames.get(f.id)
        if (frame === undefined) {
          const parent = f.parentId === undefined ? undefined : frames.get(f.parentId)
          if (parent === undefined) return
          frame = addFrame(f.id, parent)
        }
        const navigation = navigations.get(f.loaderId) ??
          startNavigation(frame, f.loaderId, f.url, "crossDocument", false)
        const document = commit(
          frame,
          { loaderId: f.loaderId, url: f.url, origin: f.securityOrigin },
          { _tag: "Navigation", navigation: navigation.id },
          "webkit:Page.frameNavigated"
        )
        endNavigation(
          navigation,
          { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
          "webkit:Page.frameNavigated"
        )
      },
      [Page.navigatedWithinDocument.method]: (_where, params: Page.NavigatedWithinDocumentParams) => {
        const frame = frames.get(params.frameId)
        const document = frame?.document
        if (frame === undefined || document === undefined) return
        // WebKit doesn't say how: a URL that differs only after `#` changed by fragment
        const via = withoutFragment(params.url) === withoutFragment(document.url) && params.url.includes("#")
          ? "fragment"
          : "historyApi"
        const normalized = normalize(params.url)
        const index = frame.expected.findIndex((expected) => normalize(expected.url) === normalized)
        const id = index >= 0 ? frame.expected.splice(index, 1)[0]!.id : ids.navigation()
        const navigation = startNavigationAs(
          frame,
          id,
          `same:${frame.frameId}:${id}`,
          params.url,
          via,
          true
        )
        document.url = params.url
        emit({ _tag: "DocumentUrlChanged", document: document.id, url: params.url, navigation: navigation.id, via })
        endNavigation(
          navigation,
          { _tag: "SameDocument", document: document.id, via },
          "webkit:Page.navigatedWithinDocument"
        )
      },
      [Page.domContentEventFired.method]: (_where, params: Page.DomContentEventFiredParams) => {
        const document = frames.get(params.frameId)?.document
        if (document === undefined || document.interactive) return
        document.interactive = true
        emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
      },
      [Page.loadEventFired.method]: (_where, params: Page.LoadEventFiredParams) => {
        const document = frames.get(params.frameId)?.document
        if (document === undefined) return
        if (document.complete) {
          // A document that loads again was opened again: `document.open()` shows only this (probe 17)
          document.generation++
          document.interactive = false
          emit({ _tag: "DocumentOpened", document: document.id, generation: document.generation })
        }
        // WebKit can report load first: the document was interactive before it was complete
        if (!document.interactive) {
          document.interactive = true
          emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
        }
        document.complete = true
        emit({ _tag: "DocumentReadiness", document: document.id, readiness: "complete" })
      },
      [Page.fileChooserOpened.method]: (where, params: Page.FileChooserOpenedParams) => {
        const target = where.target
        const frame = frames.get(params.frameId)
        const objectId = params.element.objectId
        if (target === undefined || frame === undefined || objectId === undefined) return
        // Whether it takes several files is the element's to say, so the obligation opens once it's asked
        fileChooser(target, frame, objectId)
      },
      [Runtime.executionContextCreated.method]: (where, params: Runtime.ExecutionContextCreatedParams) => {
        const target = where.target
        // A provisional target's contexts are its empty first document's, which never commits in the page
        if (target === undefined || target.page.provisional === target) return
        const context = params.context
        if (context.type === "internal") return
        const frame = frames.get(context.frameId)
        const document = frame?.document
        if (frame === undefined || document === undefined) return
        const realm: RealmEntry = {
          id: ids.realm(),
          session: target.session,
          contextId: context.id as number,
          target,
          document,
          world: context.type === "normal" ? { _tag: "Main" } : { _tag: "Isolated", name: context.name },
          helper: undefined,
          ended: false
        }
        realms.set(realm.id, realm)
        realmsByContext.set(contextKey(target, realm.contextId!), realm)
        document.realms.add(realm)
        wakeRealmWaiters(document.id)
        emit({
          _tag: "RealmAdded",
          realm: realm.id,
          origin: originOf(document.url),
          kind: { _tag: "Window", navigable: frame.id, document: document.id, world: realm.world }
        })
      },
      [Console.messageAdded.method]: (where, params: Console.MessageAddedParams) => {
        const holder = where.worker ?? where.target
        if (holder === undefined) return
        holder.lastConsole = params.message
        consoleMessage(params.message, where.worker?.target ?? where.target!, where.worker)
      },
      [Console.messageRepeatCountUpdated.method]: (where) => {
        const holder = where.worker ?? where.target
        const message = holder?.lastConsole
        if (holder === undefined || message === undefined) return
        consoleMessage(message, where.worker?.target ?? where.target!, where.worker)
      },
      [Worker.workerCreated.method]: (where, params: Worker.WorkerCreatedParams) => {
        const target = where.target
        if (target === undefined) return
        const session = control.session(WebKitWire.workerKey(target.page.pageProxyId, target.targetId, params.workerId))
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
          id: ids.realm(),
          session,
          contextId: undefined,
          target,
          document: undefined,
          world: { _tag: "Main" },
          helper: undefined,
          ended: false
        }
        worker.realm = realm
        workers.set(session, worker)
        realms.set(realm.id, realm)
        emit({
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
        control.sync(session, workerGate(worker))
      },
      [Worker.workerTerminated.method]: () => {
        // The worker's session ends with it, and its end carries everything
      },
      [Network.requestWillBeSent.method]: (where, params: Network.RequestWillBeSentParams) => {
        const target = where.target
        if (target === undefined) return
        const key = requestKey(where.session, params.requestId)
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
          const frame = frames.get(params.frameId)
          let navigation: NavigationEntry | undefined
          if (params.type === "Document" && frame !== undefined) {
            navigation = navigations.get(params.loaderId)
            if (navigation === undefined && frame.document?.loaderId !== params.loaderId) {
              navigation = startNavigation(frame, params.loaderId, params.request.url, "crossDocument", false)
            }
          }
          const worker = params.targetId === undefined
            ? undefined
            : [...workers.values()].find((worker) => worker.workerId === params.targetId)
          const id = ids.request()
          request = {
            id,
            session: where.session,
            requestId: params.requestId,
            redirects: 0,
            hop: ids.hop(id, 0),
            responded: undefined,
            url: params.request.url,
            frame,
            navigation: navigation !== undefined && navigation.documentHop === undefined ? navigation : undefined,
            worker,
            finished: Deferred.makeUnsafe(),
            fulfilled: false,
            resourceType: resourceTypes[params.type ?? "Other"] ?? "other",
            postData: params.request.postData
          }
          requests.set(key, request)
          hops.set(request.hop, request)
        }
        if (request.navigation !== undefined) request.navigation.documentHop = request.hop
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
              : request.worker?.realm !== undefined
              ? { _tag: "Worker", realm: request.worker.realm.id }
              : { _tag: "Unattributed" },
            at: Adapter.now()
          })
        })
      },
      [Network.responseReceived.method]: (where, params: Network.ResponseReceivedParams) => {
        const request = requests.get(requestKey(where.session, params.requestId))
        if (request !== undefined) emitResponse(request, params.response)
      },
      [Network.loadingFinished.method]: (where, params: Network.LoadingFinishedParams) => {
        const request = requests.get(requestKey(where.session, params.requestId))
        if (request === undefined) return
        emit({
          _tag: "RequestFinished",
          hop: request.hop,
          encodedBytes: params.metrics?.responseBodyBytesReceived ?? 0,
          at: Adapter.now()
        })
        Deferred.doneUnsafe(request.finished, Effect.void)
      },
      [Network.requestServedFromMemoryCache.method]: (
        where,
        params: Network.RequestServedFromMemoryCacheParams
      ) => {
        // A request answered from the memory cache without a load: its request, response and end at once
        if (where.target === undefined) return
        const frame = frames.get(params.frameId)
        const resource = params.resource
        const id = ids.request()
        const request: RequestEntry = {
          id,
          session: where.session,
          requestId: params.requestId,
          redirects: 0,
          hop: ids.hop(id, 0),
          responded: undefined,
          url: resource.url,
          frame,
          navigation: undefined,
          worker: undefined,
          finished: Deferred.makeUnsafe(),
          fulfilled: false,
          resourceType: resourceTypes[resource.type] ?? "other",
          postData: undefined
        }
        requests.set(requestKey(where.session, params.requestId), request)
        hops.set(request.hop, request)
        emit({
          _tag: "RequestSent",
          request: new NetworkRequest.NetworkRequest({
            hop: request.hop,
            method: "GET",
            url: resource.url as Url.Url,
            headers: headersOf(resource.response?.requestHeaders),
            resourceType: resourceTypes[resource.type] ?? "other",
            initiator: frame !== undefined
              ? { _tag: "Document", navigable: frame.id, navigation: Option.none() }
              : { _tag: "Unattributed" },
            at: Adapter.now()
          })
        })
        request.responded = request.hop
        emit({
          _tag: "ResponseReceived",
          response: new NetworkResponse.NetworkResponse({
            hop: request.hop,
            url: resource.url as Url.Url,
            status: Math.min(599, Math.max(100, resource.response?.status || 200)) as NetworkResponse.StatusCode,
            headers: headersOf(resource.response?.headers),
            servedBy: "cache",
            at: Adapter.now()
          })
        })
        emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
        Deferred.doneUnsafe(request.finished, Effect.void)
      },
      [Network.loadingFailed.method]: (where, params: Network.LoadingFailedParams) => {
        const request = requests.get(requestKey(where.session, params.requestId))
        if (request === undefined) return
        emit({
          _tag: "RequestFailed",
          hop: request.hop,
          error: params.errorText,
          canceled: params.canceled ?? false,
          at: Adapter.now()
        })
        Deferred.doneUnsafe(request.finished, Effect.fail(params.errorText))
        // A document's load that failed after a 204 or 205 kept the old document
        const navigation = request.navigation
        if (navigation !== undefined && (navigation.status === 204 || navigation.status === 205)) {
          failLoad(navigation, params.errorText, "webkit:Network.loadingFailed")
        }
      },
      [Network.requestIntercepted.method]: (where, params: Network.RequestInterceptedParams) => {
        const target = where.target
        if (target === undefined) return
        const request = requests.get(requestKey(where.session, params.requestId))
        pausedRequests.set(target, (pausedRequests.get(target) ?? 0) + 1)
        const obligation = ids.obligation()
        obligations.set(obligation, {
          _tag: "PausedRequest",
          id: obligation,
          target,
          requestId: params.requestId,
          phase: "request",
          postData: params.request.postData ?? request?.postData
        })
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "PausedRequest",
            request: pausedRequest(request?.hop ?? ids.hop(ids.request(), 0), params.request, request, target),
            phase: "request",
            response: Option.none(),
            challenge: Option.none()
          }
        })
      },
      [Network.responseIntercepted.method]: (where, params: Network.ResponseInterceptedParams) => {
        const target = where.target
        if (target === undefined) return
        const request = requests.get(requestKey(where.session, params.requestId))
        pausedRequests.set(target, (pausedRequests.get(target) ?? 0) + 1)
        const obligation = ids.obligation()
        obligations.set(obligation, {
          _tag: "PausedRequest",
          id: obligation,
          target,
          requestId: params.requestId,
          phase: "response",
          postData: request?.postData
        })
        const hop = request?.hop ?? ids.hop(ids.request(), 0)
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "PausedRequest",
            request: pausedRequest(
              hop,
              { url: params.response.url, method: "GET", headers: {} as Network.Headers },
              request,
              target
            ),
            phase: "response",
            response: Option.some(
              new NetworkResponse.NetworkResponse({
                hop,
                url: params.response.url as Url.Url,
                status: Math.min(599, Math.max(100, params.response.status || 200)) as NetworkResponse.StatusCode,
                headers: headersOf(params.response.headers),
                servedBy: servedBy(request, params.response),
                at: Adapter.now()
              })
            ),
            challenge: Option.none()
          }
        })
      },
      [Network.webSocketCreated.method]: (where, params: Network.WebSocketCreatedParams) => {
        const id = ids.connection()
        connections.set(requestKey(where.session, params.requestId), id)
        emit({
          _tag: "ConnectionOpened",
          connection: id,
          kind: "webSocket",
          url: params.url,
          navigable: Option.fromUndefinedOr(where.page?.id)
        })
      },
      [Network.webSocketFrameSent.method]: (where, params: Network.WebSocketFrameSentParams) =>
        webSocketFrame(where.session, params.requestId, "sent", params.response),
      [Network.webSocketFrameReceived.method]: (where, params: Network.WebSocketFrameReceivedParams) =>
        webSocketFrame(where.session, params.requestId, "received", params.response),
      [Network.webSocketClosed.method]: (where, params: Network.WebSocketClosedParams) => {
        const key = requestKey(where.session, params.requestId)
        const id = connections.get(key)
        if (id === undefined) return
        connections.delete(key)
        emit({ _tag: "ConnectionClosed", connection: id })
      }
    }

    const emitResponse = (request: RequestEntry, response: Network.Response) => {
      if (request.responded === request.hop) return
      request.responded = request.hop
      if (request.navigation !== undefined && request.navigation.documentHop === request.hop) {
        request.navigation.status = response.status
      }
      emit({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: response.url as Url.Url,
          status: Math.min(599, Math.max(100, response.status || 200)) as NetworkResponse.StatusCode,
          headers: headersOf(response.headers),
          servedBy: servedBy(request, response),
          at: Adapter.now()
        })
      })
    }

    // What answered, from the response's source (review 09); a route's response is `inspector-override`
    const servedBy = (request: RequestEntry | undefined, response: Network.Response): NetworkResponse.ServedBy => {
      if (request?.fulfilled === true) return "route"
      switch (response.source) {
        case "network":
          return "network"
        case "memory-cache":
        case "disk-cache":
          return "cache"
        case "service-worker":
          return "serviceWorker"
        case "inspector-override":
          return "route"
        default:
          return "unknown"
      }
    }

    const webSocketFrame = (
      session: ProtocolClient.Session,
      requestId: string,
      direction: "sent" | "received",
      frame: Network.WebSocketFrame
    ) => {
      const id = connections.get(requestKey(session, requestId))
      // Control frames (close, ping, pong) aren't messages; WebKit reports the close handshake (review 14, P15)
      if (id === undefined || frame.opcode >= 8) return
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
      request: Pick<Network.Request, "url" | "method" | "headers">,
      entry: RequestEntry | undefined,
      target: TargetEntry
    ) =>
      new NetworkRequest.NetworkRequest({
        hop,
        method: (methods.has(request.method) ? request.method : "GET") as NetworkRequest.NetworkRequest["method"],
        url: request.url as Url.Url,
        headers: headersOf(request.headers),
        resourceType: entry?.resourceType ?? "other",
        initiator: entry?.frame !== undefined
          ? { _tag: "Document", navigable: entry.frame.id, navigation: Option.fromUndefinedOr(entry.navigation?.id) }
          : { _tag: "Document", navigable: target.page.id, navigation: Option.none() },
        at: Adapter.now()
      })

    // Opens a file chooser's obligation once the element says whether it takes several files.
    const fileChooser = (target: TargetEntry, frame: FrameEntry, objectId: string) =>
      Effect.runForkWith(services)(
        Runtime.callFunctionOn({
          objectId: objectId as Runtime.RemoteObjectId,
          functionDeclaration: "function() { return this.multiple === true }",
          returnByValue: true
        }).pipe(
          Protocol.on(target.session),
          Effect.map((reply) => reply.result.value === true),
          Effect.orElseSucceed(() => false),
          Effect.flatMap((multiple) =>
            run(() => {
              if (target.ended || frame.removed) return
              const obligation = ids.obligation()
              obligations.set(obligation, { _tag: "FileChooser", id: obligation, target, objectId })
              emit({
                _tag: "ObligationOpened",
                obligation,
                subject: {
                  _tag: "FileChooser",
                  navigable: frame.id,
                  multiple,
                  element: frame.document === undefined
                    ? Option.none()
                    : Option.some({ document: frame.document.id, binding: objectId })
                }
              })
            })
          )
        )
      )

    const whereOf = (session: ProtocolClient.Session): Where => {
      const worker = workers.get(session)
      if (worker !== undefined) {
        return { session, page: worker.target.page, target: worker.target, worker }
      }
      const target = targets.get(session)
      if (target !== undefined) return { session, page: target.page, target, worker: undefined }
      const key = session.key
      if (key === undefined) return { session, page: undefined, target: undefined, worker: undefined }
      const route = WebKitWire.route(key)
      return { session, page: pagesByProxy.get(route.pageProxyId), target: undefined, worker: undefined }
    }

    const makeFold = (control: ProtocolClient.FoldControl): ProtocolClient.Fold => ({
      events: new Map(foldEvents.map((event) => [event.method, event])),
      apply: (session, method, params) =>
        Effect.suspend(() => {
          handlers[method]?.(whereOf(session), params)
          return flush
        }),
      lost: (session) =>
        Effect.suspend(() => {
          // Rebuild the target's model from a fresh resource tree, as at initialization
          const target = targets.get(session)
          if (target !== undefined) {
            control.sync(session, snapshot(target, false, Effect.void))
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

    // Installs a resource tree: the documents it shows, which the events after it build on.
    const installTree = (target: TargetEntry, tree: Page.FrameResourceTree, first: boolean) => {
      const page = target.page
      target.mainFrameId = tree.frame.id
      if (page.provisional === target) {
        // The navigation it loads commits in the page's main frame, under this frame id
        frames.set(tree.frame.id, page.main)
        return
      }
      page.main.frameId = tree.frame.id
      frames.set(tree.frame.id, page.main)
      const visit = (node: Page.FrameResourceTree, frame: FrameEntry) => {
        if (frame.document?.loaderId !== node.frame.loaderId || frame.document === undefined) {
          const blank = node.frame.url === "" || node.frame.url === "about:blank"
          const navigation = navigations.get(node.frame.loaderId)
          const document = commit(
            frame,
            {
              loaderId: node.frame.loaderId === "" ? `initial:${node.frame.id}` : node.frame.loaderId,
              url: node.frame.url === "" ? "about:blank" : node.frame.url,
              origin: node.frame.securityOrigin
            },
            navigation !== undefined
              ? { _tag: "Navigation", navigation: navigation.id }
              : first && blank && !attachedAtConnect
              ? { _tag: "InitialBlank" }
              : { _tag: "Adopted" },
            "webkit:Page.getResourceTree"
          )
          if (navigation !== undefined) {
            endNavigation(
              navigation,
              { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
              "webkit:Page.getResourceTree"
            )
          }
        }
        for (const child of node.childFrames ?? []) {
          visit(child, frames.get(child.frame.id) ?? addFrame(child.frame.id, frame))
        }
      }
      visit(tree, page.main)
    }

    const snapshot = Effect.fnUntraced(function*(
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
      const failure = yield* configure.pipe(Effect.flip, Effect.option)
      const page = target.page
      return {
        through: received,
        apply: Effect.suspend(() => {
          installTree(target, result.frameTree, first)
          if (first) {
            if (failure._tag === "Some") {
              emit({ _tag: "PageInitializationFailed", page: page.id, description: failure.value.message })
              Deferred.doneUnsafe(
                page.ready,
                Effect.fail(failure.value._tag === "AdapterError" ? failure.value : protocolError(failure.value))
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

    const resume = (target: TargetEntry, paused: boolean) =>
      paused
        ? Target.resume({ targetId: target.targetId }).pipe(Protocol.on(target.page.session), Effect.ignore)
        : Effect.void

    const gate = (target: TargetEntry, first: boolean, paused: boolean) =>
      snapshot(
        target,
        first,
        first
          ? Effect.andThen(
            applyPageProxyOverride(target.page, "Viewport", registry.overrides(placement(target.page)).get("Viewport")),
            configureTarget(target)
          )
          : configureTarget(target)
      ).pipe(Effect.ensuring(resume(target, paused)))

    const workerGate = (worker: WorkerEntry) =>
      Effect.gen(function*() {
        const on = Protocol.on(worker.session)
        yield* Effect.all([Runtime.enable().pipe(on), Console.enable().pipe(on)], {
          concurrency: "unbounded",
          discard: true
        }).pipe(Effect.ignore)
        return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
      }).pipe(
        Effect.ensuring(
          Worker.initialized({ workerId: worker.workerId }).pipe(Protocol.on(worker.target.session), Effect.ignore)
        )
      )

    const pageProxyGate = Effect.fnUntraced(function*(page: PageEntry) {
      yield* DialogWk.enable().pipe(Protocol.on(page.session), Effect.ignore)
      yield* configurePageProxy(page).pipe(Effect.ignore)
      return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
    })

    // ── Declarations ──

    const placement = (page: PageEntry): Declarations.Placement => ({ page: page.id, context: page.context.id })

    const downloadDirectory = (context: UserContext.Id) => {
      const behavior = registry.downloads(context)
      return behavior?._tag === "Allow" ? behavior.directory : undefined
    }

    // Where each kind of override is applied: the page proxy, the context, or the target.
    const pageProxyKinds = new Set<Adapter.Override["_tag"]>(["Viewport", "JavaScriptEnabled", "FocusEmulation"])
    const contextKinds = new Set<Adapter.Override["_tag"]>(["Locale", "Geolocation"])

    const applyPageProxyOverride = (
      page: PageEntry,
      kind: Adapter.Override["_tag"],
      override: Adapter.Override | undefined
    ): Effect.Effect<void, Protocol.ProtocolError> => {
      const on = Protocol.on(page.session)
      switch (kind) {
        case "Viewport":
          // WebKit resizes the view, with nothing to clear: the size it had before is measured, to restore
          return Effect.gen(function*() {
            if (naturalViewport === undefined && page.target !== undefined && !page.target.ended) {
              naturalViewport = yield* Runtime.evaluate({
                expression: "[innerWidth, innerHeight, devicePixelRatio]",
                returnByValue: true,
                doNotPauseOnExceptionsAndMuteConsole: true
              }).pipe(
                Protocol.on(page.target.session),
                Effect.map((reply) => reply.result.value as readonly [number, number, number])
              )
            }
            const size = override?._tag === "Viewport"
              ? [override.width, override.height, override.deviceScaleFactor, override.mobile] as const
              : naturalViewport === undefined
              ? undefined
              : [...naturalViewport, false] as const
            if (size === undefined) return
            yield* Emulation.setDeviceMetricsOverride({
              width: Math.round(size[0]),
              height: Math.round(size[1]),
              fixedLayout: size[3],
              deviceScaleFactor: size[2]
            }).pipe(on)
          })
        case "JavaScriptEnabled":
          return Emulation.setJavaScriptEnabled({
            enabled: override?._tag === "JavaScriptEnabled" ? override.enabled : true
          }).pipe(on)
        case "FocusEmulation":
          return Emulation.setActiveAndFocused(
            override?._tag === "FocusEmulation" && override.enabled ? { active: true } : {}
          ).pipe(on)
        default:
          return Effect.void
      }
    }

    const applyTargetOverride = (
      target: TargetEntry,
      kind: Adapter.Override["_tag"],
      override: Adapter.Override | undefined
    ): Effect.Effect<void, Protocol.ProtocolError | Adapter.AdapterError> => {
      const on = Protocol.on(target.session)
      switch (kind) {
        case "UserAgent":
          return override?._tag === "UserAgent"
            ? Effect.all([
              Page.overrideUserAgent({ value: override.userAgent }).pipe(on),
              Option.isSome(override.platform)
                ? Page.overridePlatform({ value: override.platform.value }).pipe(on)
                : Page.overridePlatform({}).pipe(on)
            ], { discard: true })
            : Effect.all([Page.overrideUserAgent({}).pipe(on), Page.overridePlatform({}).pipe(on)], { discard: true })
        case "TimeZone":
          return Page.setTimeZone(override?._tag === "TimeZone" ? { timeZone: override.timeZone } : {}).pipe(on)
        case "Media": {
          const media = override?._tag === "Media" ? override : undefined
          return Effect.gen(function*() {
            const unknown = Object.keys(media?.features ?? {}).find((name) =>
              name !== "forced-colors" && preferences[name] === undefined
            )
            if (unknown !== undefined) {
              return yield* Effect.fail(unsupported(`override.Media.${unknown}`, "WebKit doesn't emulate this feature"))
            }
            yield* Page.setEmulatedMedia({ media: media === undefined ? "" : Option.getOrElse(media.media, () => "") })
              .pipe(on)
            for (const [feature, preference] of Object.entries(preferences)) {
              const value = media?.features[feature]
              const mapped = value === undefined ? undefined : preference.values[value]
              if (value !== undefined && mapped === undefined) {
                return yield* Effect.fail(
                  unsupported(`override.Media.${feature}`, `WebKit doesn't emulate ${feature}: ${value}`)
                )
              }
              yield* Page.overrideUserPreference({
                name: preference.name,
                ...(mapped === undefined ? {} : { value: mapped as Page.UserPreferenceValue })
              }).pipe(on)
            }
            const forced = media?.features["forced-colors"]
            yield* Page.setForcedColors(
              forced === undefined ? {} : { forcedColors: forced === "active" ? "Active" : "None" }
            ).pipe(on)
          })
        }
        case "Offline":
          return Network.setEmulateOfflineState({ offline: override?._tag === "Offline" && override.offline }).pipe(on)
        case "ExtraHeaders":
          return Network.setExtraHTTPHeaders({
            headers: (override?._tag === "ExtraHeaders" ? override.headers : {}) as Network.Headers
          }).pipe(on)
        case "BypassCsp":
          return Page.setBypassCSP({ enabled: override?._tag === "BypassCsp" && override.enabled }).pipe(on)
        case "Touch":
          return Page.setTouchEmulationEnabled({ enabled: override?._tag === "Touch" && override.enabled }).pipe(on)
        case "CacheDisabled":
          return Network.setResourceCachingDisabled({
            disabled: override?._tag === "CacheDisabled" && override.disabled
          }).pipe(on)
        default:
          return Effect.void
      }
    }

    const contextParam = (context: ContextEntry) =>
      context.isDefault || context.browserContextId === undefined
        ? {}
        : { browserContextId: context.browserContextId as Playwright.ContextID }

    const applyContextOverride = (
      context: ContextEntry,
      kind: Adapter.Override["_tag"],
      override: Adapter.Override | undefined
    ): Effect.Effect<void, Protocol.ProtocolError> => {
      const on = Protocol.on(client.root)
      switch (kind) {
        case "Locale":
          return Playwright.setLanguages({
            ...contextParam(context),
            languages: override?._tag === "Locale" ? [override.locale] : []
          }).pipe(on)
        case "Geolocation": {
          const position = override?._tag === "Geolocation" ? Option.getOrUndefined(override.position) : undefined
          return Playwright.setGeolocationOverride({
            ...contextParam(context),
            ...(position === undefined ? {} : { geolocation: { timestamp: Date.now(), ...position } })
          }).pipe(on)
        }
        default:
          return Effect.void
      }
    }

    // A context's overrides are whatever is in force for a page in it that no page-scoped declaration overrides.
    const contextPlacement = (context: ContextEntry): Declarations.Placement => ({
      page: "" as L1Target.NavigableId,
      context: context.id
    })

    const applyBootstrap = (target: TargetEntry) =>
      Effect.suspend(() => {
        const bundles = registry.bundles(placement(target.page))
        const main = bundles.get(Declarations.worldKey({ _tag: "Main" }))
        return Page.setBootstrapScript(main === undefined ? {} : { source: main.source }).pipe(
          Protocol.on(target.session)
        )
      })

    const applyIntercepts = Effect.fnUntraced(function*(target: TargetEntry) {
      const intercepts = registry.intercepts(placement(target.page))
      const wanted = [
        ...intercepts.request.map((glob) => ({ url: globToRegex(glob), stage: "request" as const })),
        ...intercepts.response.map((glob) => ({ url: globToRegex(glob), stage: "response" as const }))
      ]
      const key = (entry: { readonly url: string; readonly stage: string }) => `${entry.stage} ${entry.url}`
      const current = new Set(target.intercepts.map(key))
      const next = new Set(wanted.map(key))
      if (current.size === next.size && [...next].every((entry) => current.has(entry))) return
      const on = Protocol.on(target.session)
      for (const entry of target.intercepts) {
        if (!next.has(key(entry))) {
          yield* Network.removeInterception({ url: entry.url, stage: entry.stage, isRegex: true }).pipe(on)
        }
      }
      if (wanted.length > 0 && target.intercepts.length === 0) {
        yield* Network.setInterceptionEnabled({ enabled: true }).pipe(on)
      }
      for (const entry of wanted) {
        if (!current.has(key(entry))) {
          yield* Network.addInterception({ url: entry.url, stage: entry.stage, isRegex: true }).pipe(on)
        }
      }
      // Never disabled while a request is paused: its decision would have nowhere to go
      if (wanted.length === 0 && (pausedRequests.get(target) ?? 0) === 0) {
        yield* Network.setInterceptionEnabled({ enabled: false }).pipe(on)
      }
      target.intercepts = wanted
    })

    const configureTarget = Effect.fnUntraced(function*(target: TargetEntry) {
      const page = target.page
      const on = Protocol.on(target.session)
      const overrides = registry.overrides(placement(page))
      yield* Effect.forEach(
        [...overrides].filter(([kind]) => !pageProxyKinds.has(kind) && !contextKinds.has(kind)),
        ([kind, override]) => applyTargetOverride(target, kind, override),
        { concurrency: "unbounded", discard: true }
      )
      yield* applyBootstrap(target)
      yield* applyIntercepts(target)
      if (registry.fileChooser(placement(page))) {
        yield* Page.setInterceptFileChooserDialog({ enabled: true }).pipe(on)
      }
      for (const world of page.worlds) yield* Page.createUserWorld({ name: world }).pipe(on)
    })

    // The viewport waits for the page's first target, where its size before is measured
    const configurePageProxy = Effect.fnUntraced(function*(page: PageEntry) {
      const overrides = registry.overrides(placement(page))
      yield* Effect.forEach(
        [...overrides].filter(([kind]) => pageProxyKinds.has(kind) && kind !== "Viewport"),
        ([kind, override]) => applyPageProxyOverride(page, kind, override),
        { concurrency: "unbounded", discard: true }
      )
      for (const [origin, permissions] of page.context.permissions) {
        yield* Emulation.grantPermissions({ origin, permissions: [...permissions] }).pipe(Protocol.on(page.session))
      }
    })

    const pagesInScope = (scope: Adapter.DeclarationScope) =>
      [...pages.values()].filter((page) => !page.ended && Declarations.covers(scope, placement(page)))

    const targetsOf = (page: PageEntry) =>
      [page.target, page.provisional].filter((target): target is TargetEntry => target !== undefined && !target.ended)

    const contextsInScope = (scope: Adapter.DeclarationScope) =>
      scope._tag === "UserContext"
        ? [contexts.get(scope.context)].filter((context) => context !== undefined)
        : scope._tag === "Browser"
        ? [...contexts.values()]
        : []

    const applyDeclaration = (declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) => {
      switch (declaration._tag) {
        case "Override": {
          const kind = declaration.override._tag
          if (contextKinds.has(kind)) {
            return Effect.forEach(
              contextsInScope(scope),
              (context) => applyContextOverride(context, kind, registry.overrides(contextPlacement(context)).get(kind)),
              {
                discard: true
              }
            )
          }
          return Effect.forEach(pagesInScope(scope), (page) => {
            const override = registry.overrides(placement(page)).get(kind)
            return pageProxyKinds.has(kind)
              ? applyPageProxyOverride(page, kind, override)
              : Effect.forEach(targetsOf(page), (target) => applyTargetOverride(target, kind, override), {
                discard: true
              })
          }, { concurrency: "unbounded", discard: true })
        }
        case "InitScript":
          return Effect.forEach(pagesInScope(scope).flatMap(targetsOf), applyBootstrap, {
            concurrency: "unbounded",
            discard: true
          })
        case "Intercept":
          return Effect.forEach(pagesInScope(scope).flatMap(targetsOf), applyIntercepts, {
            concurrency: "unbounded",
            discard: true
          })
        case "FileChooser":
          return Effect.forEach(
            pagesInScope(scope),
            (page) =>
              Effect.forEach(
                targetsOf(page),
                (target) =>
                  Page.setInterceptFileChooserDialog({ enabled: registry.fileChooser(placement(page)) }).pipe(
                    Protocol.on(target.session)
                  ),
                { discard: true }
              ),
            { concurrency: "unbounded", discard: true }
          )
        case "Downloads":
          return Effect.forEach(contextsInScope(scope), applyDownloads, { discard: true })
        case "BodyCollection":
          // WebKit keeps response bodies on its own, so there is nothing to collect
          return Effect.void
      }
    }

    const applyDownloads = (context: ContextEntry) => {
      const behavior = registry.downloads(context.id)
      return Playwright.setDownloadBehavior({
        ...contextParam(context),
        ...(behavior === undefined
          ? {}
          : behavior._tag === "Allow"
          ? { behavior: "allow", downloadPath: behavior.directory }
          : { behavior: "deny" })
      }).pipe(Protocol.on(client.root))
    }

    // ── Connecting ──

    let control!: ProtocolClient.FoldControl
    const client = yield* ProtocolClient.make(transport, WebKitWire.wire, {
      fold: (c) => {
        control = c
        return makeFold(c)
      }
    })
    const services = yield* Effect.context<never>()
    const defaultContext = ids.userContext()
    contexts.set(defaultContext, {
      id: defaultContext,
      browserContextId: undefined,
      isDefault: true,
      removing: false,
      permissions: new Map()
    })
    const failConnect = (error: Protocol.ProtocolError) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "handshake", hint: error.message }), "connect")
    const { os } = yield* Playwright.getInfo().pipe(Protocol.on(client.root), Effect.catch(failConnect))
    const info = new Browser.Info({
      product: `Playwright WebKit (${os})`,
      version: options.revision ?? "unknown",
      protocol: "webkit",
      revision: options.revision ?? "unknown"
    })
    yield* control.run(Effect.suspend(() => {
      emit({ _tag: "UserContextAdded", context: defaultContext, isDefault: true })
      return flush
    }))
    // Pages that existed before are announced before the reply, and adopted
    yield* Playwright.enable().pipe(Protocol.on(client.root), Effect.catch(failConnect))
    yield* client.root.drainObserved
    attachedAtConnect = false
    const capabilitySet = yield* SubscriptionRef.make(capabilities(info))

    // ── Operations ──

    const run = (facts: () => void) =>
      control.run(Effect.suspend(() => {
        facts()
        return flush
      }))

    const pageOf = (id: L1Target.NavigableId) =>
      Effect.suspend(() => {
        const page = pages.get(id)
        return page === undefined || page.ended ? Effect.fail(foreign(id)) : Effect.succeed(page)
      })

    const frameById = (id: L1Target.NavigableId) =>
      Effect.suspend(() => {
        const frame = navigables.get(id)
        return frame === undefined || frame.removed ? Effect.fail(foreign(id)) : Effect.succeed(frame)
      })

    const contextOf = (id: UserContext.Id) =>
      Effect.suspend(() => {
        const context = contexts.get(id)
        return context === undefined ? Effect.fail(foreign(id)) : Effect.succeed(context)
      })

    const targetOf = (page: PageEntry) =>
      Effect.suspend(() =>
        page.target === undefined || page.target.ended
          ? Effect.fail(gone({ _tag: "Page", id: page.id }, page.closing ?? { _tag: "PageCrashed" }))
          : Effect.succeed(page.target)
      )

    const protocol = <A, R>(effect: Effect.Effect<A, Protocol.ProtocolError, R>) =>
      Effect.mapError(effect, protocolError)

    const createUserContext = Effect.fnUntraced(function*(options: Adapter.UserContextOptions) {
      const { browserContextId } = yield* protocol(
        Playwright.createContext(
          Option.isSome(options.proxy)
            ? { proxyServer: options.proxy.value.server, proxyBypassList: options.proxy.value.bypass.join(",") }
            : {}
        ).pipe(Protocol.on(client.root))
      )
      const entry: ContextEntry = {
        id: ids.userContext(),
        browserContextId,
        isDefault: false,
        removing: false,
        permissions: new Map()
      }
      contexts.set(entry.id, entry)
      contextsByWk.set(browserContextId, entry)
      yield* run(() => emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false }))
      if (options.acceptInsecureCerts) {
        yield* protocol(
          Playwright.setIgnoreCertificateErrors({ browserContextId, ignore: true }).pipe(Protocol.on(client.root))
        )
      }
      yield* protocol(applyDownloads(entry))
      // Browser-wide declarations that WebKit keeps per context
      for (const kind of contextKinds) {
        const override = registry.overrides(contextPlacement(entry)).get(kind)
        if (override !== undefined) yield* protocol(applyContextOverride(entry, kind, override))
      }
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
        Playwright.deleteContext({ browserContextId: context.browserContextId as Playwright.ContextID }).pipe(
          Protocol.on(client.root)
        )
      )
      yield* Effect.forEach(inContext, (page) => page.session.ended, { discard: true })
      contexts.delete(id)
      contextsByWk.delete(context.browserContextId)
      yield* run(() => emit({ _tag: "UserContextRemoved", context: id }))
    })

    const createPage = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      const { pageProxyId } = yield* protocol(
        Playwright.createPage(contextParam(context)).pipe(Protocol.on(client.root))
      )
      // The page proxy was announced before the reply; its announcement is folded once this returns
      yield* client.root.drainObserved
      const page = pagesByProxy.get(pageProxyId)
      if (page === undefined) {
        return yield* Effect.fail(gone({ _tag: "Browser" }, { _tag: "PageClosed", by: "browser" }))
      }
      yield* Deferred.await(page.ready)
      return page.id
    })

    const closePage = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
        const page = yield* pageOf(id)
        if (!options.runBeforeUnload) page.closing = { _tag: "PageClosed", by: "command" }
        yield* protocol(
          Playwright.closePage({
            pageProxyId: page.pageProxyId as Playwright.PageProxyID,
            runBeforeUnload: options.runBeforeUnload
          }).pipe(Protocol.on(client.root))
        )
      }
    )

    const expect = (frame: FrameEntry, url: string, initiatedAs: Adapter.InitiatedAs = "crossDocument") => {
      const id = ids.navigation()
      frame.expected.push({ id, url, initiatedAs })
      return id
    }

    const unexpect = (frame: FrameEntry, id: PageNavigation.Id) => {
      const index = frame.expected.findIndex((expected) => expected.id === id)
      if (index < 0) return false
      frame.expected.splice(index, 1)
      return true
    }

    const navigate = Effect.fnUntraced(function*(
      navigable: L1Target.NavigableId,
      url: string,
      options: { readonly referrer: Option.Option<string> }
    ) {
      const frame = yield* frameById(navigable)
      const page = frame.page
      const id = expect(frame, url)
      // Only a frame the page still has: an unknown frame id aborts the browser (PROBES.md, WebKit)
      const reply = yield* protocol(
        Playwright.navigate({
          url,
          pageProxyId: page.pageProxyId as Playwright.PageProxyID,
          ...(frame === page.main ? {} : { frameId: frame.frameId as Network.FrameId }),
          ...(Option.isSome(options.referrer) ? { referrer: options.referrer.value } : {})
        }).pipe(Protocol.on(client.root))
      ).pipe(Effect.tapError(() => Effect.sync(() => unexpect(frame, id))))
      const loaderId = reply.loaderId
      if (loaderId === undefined) return id
      // The load may have started, or failed, before the reply; if not, it starts now
      yield* run(() => {
        if (!unexpect(frame, id) || frame.removed) return
        const navigation = navigations.get(loaderId) ??
          startNavigationAs(frame, id, loaderId, url, "crossDocument", false)
        const failed = failedLoads.get(loaderId)
        if (failed !== undefined) {
          failedLoads.delete(loaderId)
          failLoad(navigation, failed, "webkit:Playwright.provisionalLoadFailed")
        }
      })
      return id
    })

    const reload = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: { readonly ignoreCache: boolean }) {
      const page = yield* pageOf(id)
      const target = yield* targetOf(page)
      const navigation = expect(page.main, page.main.document?.url ?? "", "reload")
      yield* protocol(Page.reload({ ignoreCache: options.ignoreCache }).pipe(Protocol.on(target.session))).pipe(
        Effect.tapError(() => Effect.sync(() => unexpect(page.main, navigation)))
      )
      return navigation
    })

    const traverse = Effect.fnUntraced(function*(id: L1Target.NavigableId, delta: number) {
      const page = yield* pageOf(id)
      const target = yield* targetOf(page)
      if (delta !== 1 && delta !== -1) {
        return yield* Effect.fail(unsupported("traverse.delta", "WebKit moves through history one entry at a time"))
      }
      const navigation = expect(page.main, "", "traversal")
      const moved = yield* (delta === -1 ? Page.goBack() : Page.goForward()).pipe(
        Protocol.on(target.session),
        Effect.as(true),
        // WebKit fails the command when there is no such entry
        Effect.catchIf(
          (error) => error.reason._tag === "Rejected",
          () => Effect.succeed(false)
        ),
        protocol
      )
      if (!moved) {
        unexpect(page.main, navigation)
        return Option.none<PageNavigation.Id>()
      }
      return Option.some(navigation)
    })

    /** Who waits for a document's next realm, or its end. */
    const realmWaiters = new Map<L1Target.DocumentId, Set<() => void>>()
    const addRealmWaiter = (id: L1Target.DocumentId, waiter: () => void) => {
      const set = realmWaiters.get(id) ?? new Set()
      set.add(waiter)
      realmWaiters.set(id, set)
    }
    const removeRealmWaiter = (id: L1Target.DocumentId, waiter: () => void) => {
      const set = realmWaiters.get(id)
      set?.delete(waiter)
      if (set?.size === 0) realmWaiters.delete(id)
    }
    function wakeRealmWaiters(id: L1Target.DocumentId) {
      for (const waiter of Array.from(realmWaiters.get(id) ?? [])) waiter()
    }

    const realmFor = Effect.fnUntraced(function*(id: L1Target.DocumentId, world: Adapter.World) {
      const document = documents.get(id)
      if (document === undefined) return yield* Effect.fail(foreign(id))
      const find = () =>
        [...document.realms].find((realm) =>
          !realm.ended && realm.world._tag === world._tag &&
          (world._tag === "Main" || (realm.world._tag === "Isolated" && realm.world.name === world.name))
        )
      const existing = find()
      if (existing !== undefined) return existing.id
      // The main world, and a world the page has already, come to each new document, reported a moment after it
      // commits; creating a world again fails (review 17's build), so wait for its report, or the document's end
      const page = document.frame.page
      if (world._tag === "Main" || page.worlds.has(world.name)) {
        yield* Effect.callback<void>((resume) => {
          const check = () => {
            if (find() !== undefined || !documents.has(id)) {
              removeRealmWaiter(id, check)
              resume(Effect.void)
            }
          }
          addRealmWaiter(id, check)
          check()
          return Effect.sync(() => removeRealmWaiter(id, check))
        })
        const arrived = find()
        if (arrived !== undefined) return arrived.id
        return yield* Effect.fail(gone({ _tag: "Document", id }, { _tag: "DocumentReplaced" }))
      }
      // A world is created in every frame of the page, now and in every target it gets
      page.worlds.add(world.name)
      const target = yield* targetOf(page)
      yield* protocol(Page.createUserWorld({ name: world.name }).pipe(Protocol.on(target.session)))
      yield* target.session.drainObserved
      const created = find()
      if (created === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id }, { _tag: "DocumentReplaced" }))
      }
      return created.id
    })

    // The realm's helper, installed on first use.
    const helperOf = (realm: RealmEntry) =>
      Effect.suspend(() => {
        if (realm.helper !== undefined) return Deferred.await(realm.helper)
        const helper = Deferred.makeUnsafe<string, Adapter.AdapterError>()
        realm.helper = helper
        return Runtime.evaluate({
          expression: Utility.source,
          ...(realm.contextId === undefined ? {} : { contextId: realm.contextId as Runtime.ExecutionContextId }),
          doNotPauseOnExceptionsAndMuteConsole: true
        }).pipe(
          Protocol.on(realm.session),
          Effect.mapError((error): Adapter.AdapterError =>
            error.reason._tag === "SessionEnded" || error.reason._tag === "Rejected"
              ? gone({ _tag: "Realm", id: realm.id }, { _tag: "RealmDestroyed" })
              : protocolError(error)
          ),
          Effect.flatMap((reply) =>
            reply.wasThrown === true || reply.result.objectId === undefined
              ? Effect.fail(gone({ _tag: "Realm", id: realm.id }, { _tag: "RealmDestroyed" }))
              : Effect.succeed(reply.result.objectId as string)
          ),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit)) realm.helper = undefined
              Deferred.doneUnsafe(helper, exit)
            })
          )
        )
      })

    const evaluate = Effect.fnUntraced(function*(id: L1Target.RealmId, call: Adapter.EvaluationCall) {
      const realm = realms.get(id)
      if (realm === undefined || realm.ended) {
        return yield* Effect.fail(gone({ _tag: "Realm", id }, { _tag: "RealmDestroyed" }))
      }
      const helper = yield* helperOf(realm)
      const on = Protocol.on(realm.session)
      const realmGone = (error: Protocol.ProtocolError): Adapter.AdapterError =>
        realm.ended || error.reason._tag === "SessionEnded"
          ? gone({ _tag: "Realm", id }, { _tag: "RealmDestroyed" })
          : protocolError(error)
      // A node crosses into this realm by its binding, an object of whichever world returned it (review 18,
      // candidate 1)
      const nodes = new Map<string, string>()
      for (const argument of call.arguments) {
        if (argument._tag !== "Node" || nodes.has(argument.node.binding)) continue
        const { object } = yield* DOM.resolveNode({
          objectId: argument.node.binding as Runtime.RemoteObjectId,
          ...(realm.contextId === undefined
            ? {}
            : { executionContextId: realm.contextId as Runtime.ExecutionContextId })
        }).pipe(on, Effect.mapError(realmGone))
        if (object.objectId !== undefined) nodes.set(argument.node.binding, object.objectId)
      }
      const released = Effect.forEach(
        nodes.values(),
        (objectId) => Runtime.releaseObject({ objectId: objectId as Runtime.RemoteObjectId }).pipe(on, Effect.ignore),
        { discard: true }
      )
      const reply = yield* Runtime.callFunctionOn({
        objectId: helper as Runtime.RemoteObjectId,
        functionDeclaration: Utility.call(call.functionDeclaration, call.result, call.awaitPromise),
        arguments: [
          { value: call.arguments.map((argument) => argument._tag === "Value" ? "v" : "h") },
          ...call.arguments.map((argument): Runtime.CallArgument => {
            if (argument._tag === "Value") return { value: argument.value }
            if (argument._tag === "Node") {
              return { objectId: (nodes.get(argument.node.binding) ?? "") as Runtime.RemoteObjectId }
            }
            const handle = handles.get(argument.handle)
            return { objectId: (handle?.objectId ?? "") as Runtime.RemoteObjectId }
          })
        ],
        awaitPromise: call.awaitPromise,
        returnByValue: false,
        emulateUserGesture: call.userActivation
      }).pipe(on, Effect.mapError(realmGone), Effect.ensuring(released))
      const document = realm.document
      const handleOf = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
        const type = remoteType(object)
        if (object.objectId === undefined || object.subtype === "null") return primitive(object)
        const handle = ids.handle()
        handles.set(handle, { session: realm.session, objectId: object.objectId })
        return type === "node"
          ? {
            type,
            handle,
            ...(document === undefined ? {} : { node: { document: document.id, binding: object.objectId } })
          }
          : { type, handle } as Adapter.RemoteValue
      }
      if (reply.wasThrown === true) {
        const thrown = reply.result
        const text = thrown.description ?? textOf(thrown)
        return {
          _tag: "Exception",
          text,
          exception: thrown.objectId === undefined
            ? primitive(thrown)
            : { type: remoteType(thrown) } as Adapter.RemoteValue,
          stack: Option.fromUndefinedOr(text.includes("\n") ? text : undefined)
        } satisfies Adapter.RemoteResult
      }
      if (call.result === "handle") {
        return { _tag: "Value", value: handleOf(reply.result) } satisfies Adapter.RemoteResult
      }
      const encoded = JSON.parse(String(reply.result.value)) as { readonly batch: number; readonly value: Serialized }
      if (encoded.batch === 0 || document === undefined) {
        return { _tag: "Value", value: withBindings(encoded.value, () => undefined) } satisfies Adapter.RemoteResult
      }
      // The nodes it holds, as remote objects: WebKit's handle on a node
      const batch = yield* Runtime.callFunctionOn({
        objectId: helper as Runtime.RemoteObjectId,
        functionDeclaration: Utility.takeNodes,
        arguments: [{ value: encoded.batch }]
      }).pipe(on, Effect.mapError(realmGone))
      const objectIds = new Map<number, string>()
      if (batch.result.objectId !== undefined) {
        const { properties } = yield* Runtime.getProperties({ objectId: batch.result.objectId, ownProperties: true })
          .pipe(on, Effect.mapError(realmGone))
        for (const property of properties) {
          const index = Number(property.name)
          if (Number.isInteger(index) && property.value?.objectId !== undefined) {
            objectIds.set(index, property.value.objectId)
          }
        }
        yield* Runtime.releaseObject({ objectId: batch.result.objectId }).pipe(on, Effect.ignore)
      }
      return {
        _tag: "Value",
        value: withBindings(encoded.value, (index) => {
          const objectId = objectIds.get(index)
          return objectId === undefined ? undefined : { document: document.id, binding: objectId }
        })
      } satisfies Adapter.RemoteResult
    })

    const releaseHandles = (list: ReadonlyArray<Adapter.HandleId>) =>
      Effect.forEach(list, (id) => {
        const handle = handles.get(id)
        handles.delete(id)
        return handle === undefined
          ? Effect.void
          : Runtime.releaseObject({ objectId: handle.objectId as Runtime.RemoteObjectId }).pipe(
            Protocol.on(handle.session),
            Effect.ignore
          )
      }, { concurrency: "unbounded", discard: true })

    // Page coordinates reach every frame (review 18, P1), so a frame changes nothing here
    const dispatchInput = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, events: ReadonlyArray<Adapter.InputEvent>, _frame?: unknown) {
        const page = yield* pageOf(id)
        const on = Protocol.on(page.session)
        for (const event of events) {
          switch (event._tag) {
            case "Mouse": {
              yield* protocol(
                Input.dispatchMouseEvent({
                  type: event.type,
                  x: Math.round(event.x),
                  y: Math.round(event.y),
                  button: event.button,
                  // What L1 says is held, across calls (review 16, P9)
                  buttons: event.buttons,
                  clickCount: event.clickCount,
                  modifiers: modifierBits(event.modifiers)
                }).pipe(on)
              )
              break
            }
            case "Wheel":
              yield* protocol(
                Input.dispatchWheelEvent({
                  x: Math.round(event.x),
                  y: Math.round(event.y),
                  deltaX: Math.round(event.deltaX),
                  deltaY: Math.round(event.deltaY),
                  modifiers: modifierBits(event.modifiers)
                }).pipe(on)
              )
              break
            case "Key": {
              const text = Option.getOrUndefined(event.text)
              const code = keyCode(event.key)
              yield* protocol(
                Input.dispatchKeyEvent({
                  type: event.type === "up" ? "keyUp" : "keyDown",
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
            case "InsertText": {
              const target = yield* targetOf(page)
              yield* protocol(Page.insertText({ text: Redacted.make(event.text) }).pipe(Protocol.on(target.session)))
              break
            }
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
                  touchPoints: event.points.map((point) => ({
                    x: Math.round(point.x),
                    y: Math.round(point.y),
                    id: point.id
                  })),
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
      switch (obligation._tag) {
        case "PausedRequest": {
          const on = Protocol.on(obligation.target.session)
          const requestId = obligation.requestId as Network.RequestId
          const send = (() => {
            switch (decision._tag) {
              case "Continue": {
                const overrides = Option.getOrUndefined(decision.overrides)
                return obligation.phase === "response" || overrides === undefined
                  ? Network.interceptContinue({ requestId, stage: obligation.phase }).pipe(on)
                  : Network.interceptWithRequest({
                    requestId,
                    ...(overrides.url === undefined ? {} : { url: overrides.url }),
                    ...(overrides.method === undefined ? {} : { method: overrides.method }),
                    ...(overrides.headers === undefined ? {} : { headers: overrides.headers as Network.Headers }),
                    ...(overrides.body === undefined ? {} : { postData: base64(overrides.body) })
                  }).pipe(on)
              }
              case "Fulfill": {
                const entry = requests.get(requestKey(obligation.target.session, obligation.requestId))
                if (entry !== undefined) entry.fulfilled = true
                const headers = decision.headers
                const mimeType = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]
                  ?.split(";")[0] ?? ""
                const response = {
                  requestId,
                  content: base64(decision.body),
                  base64Encoded: true,
                  mimeType,
                  status: decision.status,
                  statusText: "",
                  headers: headers as Network.Headers
                }
                return obligation.phase === "response"
                  ? Network.interceptWithResponse(response).pipe(on)
                  : Network.interceptRequestWithResponse(response).pipe(on)
              }
              case "Fail":
                return obligation.phase === "request"
                  ? decision.error === "failed"
                    ? Network.interceptRequestWithError({ requestId, errorType: "General" }).pipe(on)
                    // WebKit reports every reason as "Blocked by Web Inspector" (review 17, P4)
                    : Effect.fail(
                      new Protocol.ProtocolError({
                        reason: new Protocol.Unsupported({ method: "interception.abortReason" })
                      })
                    )
                  : Effect.fail(
                    new Protocol.ProtocolError({
                      reason: new Protocol.Unsupported({ method: "resolve Fail at the response stage" })
                    })
                  )
              default:
                return Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Unsupported({ method: `resolve ${decision._tag}` })
                  })
                )
            }
          })()
          yield* protocol(send)
          pausedRequests.set(obligation.target, Math.max(0, (pausedRequests.get(obligation.target) ?? 1) - 1))
          obligations.delete(id)
          yield* run(() =>
            emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "webkit:Network" })
          )
          return
        }
        case "Prompt": {
          if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
            return yield* Effect.fail(unsupported(decision._tag, "A prompt is accepted or dismissed"))
          }
          // Only the dialog that is open: answering none aborts the browser (PROBES.md, WebKit)
          if (obligation.page.dialog !== id || obligation.answer !== undefined) {
            return yield* Effect.fail(foreign(id))
          }
          const promptText = decision._tag === "Accept" ? Option.getOrUndefined(decision.promptText) : undefined
          obligation.answer = {
            accepted: decision._tag === "Accept",
            userText: Option.fromUndefinedOr(promptText)
          }
          yield* protocol(
            DialogWk.handleJavaScriptDialog({
              accept: decision._tag === "Accept",
              ...(promptText === undefined ? {} : { promptText })
            }).pipe(Protocol.on(obligation.page.session))
          )
          return
        }
        case "FileChooser": {
          obligations.delete(id)
          if (decision._tag === "SetFiles") {
            yield* setFiles(obligation.target, obligation.objectId, decision.files)
          }
          yield* run(() =>
            emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "webkit:DOM.setInputFiles" })
          )
          return
        }
      }
    })

    const setFiles = (target: TargetEntry, objectId: string, files: ReadonlyArray<string>) =>
      protocol(
        Effect.gen(function*() {
          // The web process reads the files only once the page may
          yield* Playwright.grantFileReadAccess({
            pageProxyId: target.page.pageProxyId as Playwright.PageProxyID,
            paths: [...files]
          }).pipe(Protocol.on(client.root), Effect.ignore)
          yield* DOM.setInputFiles({ objectId: objectId as Runtime.RemoteObjectId, paths: [...files] }).pipe(
            Protocol.on(target.session)
          )
        })
      )

    const declare = Effect.fnUntraced(function*(scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
      if (declaration._tag === "Override") {
        // What WebKit can't do, refused before anything is declared (review 17)
        const override = declaration.override
        const refused = override._tag === "Touch"
          ? unsupported("emulation.touch", "WebKit's touch override changes nothing a page sees")
          : override._tag === "Geolocation" && Option.isNone(override.position)
          ? unsupported("emulation.geolocation.unavailable", "WebKit ignores an unavailable position")
          : override._tag === "NetworkConditions"
          ? unsupported("emulation.network.throttling", "Playwright's WebKit can only take a page offline")
          : override._tag === "CpuThrottling"
          ? unsupported("emulation.cpuSlowdown", "Playwright's WebKit has no CPU throttling")
          : undefined
        if (refused !== undefined) return yield* Effect.fail(refused)
      }
      if (declaration._tag === "InitScript" && declaration.world._tag === "Isolated") {
        return yield* Effect.fail(
          unsupported("initScript.isolatedWorld", "WebKit runs init scripts in the main world only")
        )
      }
      if (declaration._tag === "Intercept" && declaration.phases.includes("auth")) {
        return yield* Effect.fail(
          unsupported("interception.auth", "WebKit answers challenges from credentials set in advance")
        )
      }
      if (
        declaration._tag === "Override" && contextKinds.has(declaration.override._tag) && scope._tag === "Page"
      ) {
        return yield* Effect.fail(
          unsupported(
            `override.${declaration.override._tag}.page`,
            "WebKit sets it per context, so it can't be scoped to one page"
          )
        )
      }
      if (
        declaration._tag === "Override" && declaration.override._tag === "Locale" && pagesInScope(scope).length > 0
      ) {
        return yield* Effect.fail(
          unsupported(
            "override.Locale.livePages",
            "WebKit gives a page its languages when its process starts, so declare the locale before creating pages"
          )
        )
      }
      const id = ids.registration()
      registry.add(scope, declaration, id)
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          registry.remove(id)
          return applyDeclaration(declaration, scope).pipe(Effect.ignore)
        })
      )
      yield* applyDeclaration(declaration, scope).pipe(
        Effect.mapError((error) => error._tag === "AdapterError" ? error : protocolError(error))
      )
      return id
    })

    // The viewport's or the page's size, from the page itself.
    const pageSize = (target: TargetEntry, fullPage: boolean) =>
      Runtime.evaluate({
        expression: fullPage
          ? "[Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)]"
          : "[innerWidth, innerHeight]",
        returnByValue: true,
        doNotPauseOnExceptionsAndMuteConsole: true
      }).pipe(
        Protocol.on(target.session),
        Effect.map((reply) => reply.result.value as [number, number])
      )

    const screenshot = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: Adapter.ScreenshotOptions) {
      const page = yield* pageOf(id)
      const target = yield* targetOf(page)
      const clip = Option.getOrUndefined(options.clip)
      const region = clip ?? (yield* protocol(pageSize(target, options.fullPage)).pipe(
        Effect.map(([width, height]) => ({ x: 0, y: 0, width, height }))
      ))
      const on = Protocol.on(target.session)
      if (options.omitBackground) {
        yield* protocol(Page.setDefaultBackgroundColorOverride({ color: { r: 0, g: 0, b: 0, a: 0 } }).pipe(on))
      }
      const { dataURL } = yield* protocol(
        Page.snapshotRect({
          x: Math.round(region.x),
          y: Math.round(region.y),
          width: Math.max(1, Math.round(region.width)),
          height: Math.max(1, Math.round(region.height)),
          coordinateSystem: clip !== undefined || options.fullPage ? "Page" : "Viewport",
          format: options.format,
          // A CSS pixel each (review 18, candidate 5)
          ...(options.scale === "css" ? { omitDeviceScaleFactor: true } : {}),
          ...(Option.isSome(options.quality) ? { quality: options.quality.value } : {})
        }).pipe(on)
      ).pipe(
        Effect.ensuring(
          options.omitBackground ? Page.setDefaultBackgroundColorOverride({}).pipe(on, Effect.ignore) : Effect.void
        )
      )
      return fromDataUrl(dataURL)
    })

    // Frames as WebKit paints them, through the page proxy, which outlives each process (review 20, P4)
    const screencast = Effect.fnUntraced(function*(id: L1Target.NavigableId) {
      const page = yield* pageOf(id)
      const target = yield* targetOf(page)
      const [width, height] = yield* protocol(pageSize(target, false))
      const on = Protocol.on(page.session)
      const frames = yield* page.session.subscribe(Screencast.screencastFrame)
      const { generation } = yield* protocol(
        Screencast.startScreencast({ width, height, toolbarHeight: 0, quality: 90 }).pipe(on)
      )
      yield* Effect.addFinalizer(() => Screencast.stopScreencast().pipe(on, Effect.ignore))
      return frames.pipe(
        Stream.mapError(protocolError),
        Stream.mapEffect((frame) => {
          const jpeg = fromBase64(frame.data)
          const at = Adapter.now()
          return Screencast.screencastFrameAck({ generation }).pipe(
            on,
            Effect.ignore,
            Effect.as({ at, ...Adapter.jpegSize(jpeg), jpeg } satisfies Adapter.ScreencastFrame)
          )
        })
      )
    })

    const cookies = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      const { cookies } = yield* protocol(
        Playwright.getAllCookies(contextParam(context)).pipe(Protocol.on(client.root))
      )
      return cookies.map((cookie): Adapter.Cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.session || cookie.expires < 0 ? Option.none() : Option.some(cookie.expires),
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: Option.some(cookie.sameSite as "Strict" | "Lax" | "None"),
        partitionKey: cookie.partitionKey === undefined || cookie.partitionKey === ""
          ? Option.none()
          : Option.some({ topLevelSite: cookie.partitionKey, crossSiteAncestor: Option.none() }),
        priority: Option.none()
      }))
    })

    const setCookies = Effect.fnUntraced(function*(id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
      const context = yield* contextOf(id)
      yield* protocol(
        Playwright.setCookies({
          ...contextParam(context),
          cookies: list.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            session: Option.isNone(cookie.expires),
            ...(Option.isSome(cookie.expires) ? { expires: cookie.expires.value } : {}),
            ...(Option.isSome(cookie.sameSite) ? { sameSite: cookie.sameSite.value } : {}),
            ...(Option.isSome(cookie.partitionKey) ? { partitionKey: cookie.partitionKey.value.topLevelSite } : {})
          }))
        }).pipe(Protocol.on(client.root))
      )
    })

    const clearCookies = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      yield* protocol(Playwright.deleteAllCookies(contextParam(context)).pipe(Protocol.on(client.root)))
    })

    const grantPermissions = Effect.fnUntraced(function*(
      id: UserContext.Id,
      origin: Option.Option<string>,
      permissions: ReadonlyArray<string>
    ) {
      const context = yield* contextOf(id)
      const key = Option.getOrElse(origin, () => "*")
      context.permissions.set(key, [...new Set([...(context.permissions.get(key) ?? []), ...permissions])])
      const granted = context.permissions.get(key)!
      yield* protocol(Effect.forEach(
        [...pages.values()].filter((page) => page.context === context && !page.ended),
        (page) =>
          Emulation.grantPermissions({ origin: key, permissions: [...granted] }).pipe(Protocol.on(page.session)),
        { discard: true }
      ))
    })

    const resetPermissions = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      context.permissions.clear()
      yield* protocol(Effect.forEach(
        [...pages.values()].filter((page) => page.context === context && !page.ended),
        (page) => Emulation.resetPermissions().pipe(Protocol.on(page.session)),
        { discard: true }
      ))
    })

    const requestBody = (id: Adapter.ObligationId) => {
      const obligation = obligations.get(id)
      if (obligation?._tag !== "PausedRequest") return Effect.fail(foreign(id))
      return Effect.succeed(
        obligation.postData === undefined ? Option.none<Uint8Array>() : Option.some(fromBase64(obligation.postData))
      )
    }

    const pausedResponseBody = (_id: Adapter.ObligationId) =>
      Effect.fail(unsupported("interception.responseBody", "Playwright's WebKit can't read a response paused there"))

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
          Protocol.on(request.session)
        )
      )
      return base64Encoded ? fromBase64(body) : new TextEncoder().encode(body)
    })

    // WebKit's description of an iframe names the frame it holds (review 18, P3)
    const contentFrame = Effect.fnUntraced(function*(node: Adapter.NodeBinding) {
      const document = documents.get(node.document)
      if (document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      const target = yield* targetOf(document.frame.page)
      const described = yield* protocol(
        DOM.describeNode({ objectId: node.binding as Runtime.RemoteObjectId }).pipe(Protocol.on(target.session))
      )
      const frame = described.contentFrameId === undefined ? undefined : frames.get(described.contentFrameId)
      return Option.fromUndefinedOr(frame?.id)
    })

    const setInputFiles = Effect.fnUntraced(function*(node: Adapter.NodeBinding, files: ReadonlyArray<string>) {
      const document = documents.get(node.document)
      if (document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      const target = yield* targetOf(document.frame.page)
      yield* setFiles(target, node.binding, files)
    })

    const downloadPath = (id: Download.Id) =>
      Effect.suspend(() => {
        const download = downloadsById.get(id)
        if (download === undefined) return Effect.fail(foreign(id))
        return Effect.succeed(
          download.directory === undefined
            ? Option.none<string>()
            : Option.some(`${download.directory}/${download.uuid}`)
        )
      })

    // Browser-wide declarations of the default context
    yield* applyDownloads(contexts.get(defaultContext)!).pipe(Effect.ignore)

    return {
      info,
      capabilities: capabilitySet,
      pauseScope: "browser",
      defaultContext,
      closed: client.closed,
      createUserContext,
      removeUserContext,
      createPage,
      closePage,
      activatePage: (id) =>
        pageOf(id).pipe(
          Effect.flatMap((page) =>
            protocol(Emulation.setActiveAndFocused({ active: true }).pipe(Protocol.on(page.session)))
          )
        ),
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
      pdf: () => Effect.fail(unsupported("pdf", "Playwright's WebKit has no print-to-PDF")),
      accessibilityTree: () =>
        Effect.fail(unsupported("capability.axTree", "Playwright's WebKit reads accessibility one node at a time")),
      screencast,
      cookies,
      setCookies,
      clearCookies,
      grantPermissions,
      resetPermissions,
      responseBody,
      contentFrame,
      requestBody,
      pausedResponseBody,
      setInputFiles,
      downloadPath,
      cancelDownload: (id: Download.Id) =>
        Effect.suspend(() => {
          const download = downloadsById.get(id)
          if (download === undefined) return Effect.fail(foreign(id))
          if (download.ended) return Effect.void
          return protocol(Playwright.cancelDownload({ uuid: download.uuid }).pipe(Protocol.on(client.root)))
        })
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

const withoutFragment = (url: string): string => {
  const hash = url.indexOf("#")
  return hash < 0 ? url : url.slice(0, hash)
}

const originOf = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return "null"
  }
}

// NetworkConnection.Frame, without importing the module's runtime for its class alone.
import { Frame as NetworkConnectionFrame } from "../NetworkConnection.ts"
