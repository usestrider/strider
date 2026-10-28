/**
 * The WebDriver BiDi backend adapter (PROTOCOL.md, Backend adapters), for Firefox and any BiDi
 * endpoint. It keeps the tables from BiDi's ids to L1's, folds BiDi's events into facts, and carries out L1's
 * operations.
 *
 * - **One session.** Every event arrives on the connection's one session; the fold routes it by the context
 *   in its parameters.
 * - **No pause.** BiDi scopes declarations natively, by context or user context, so a new context needs no
 *   pause: preload scripts and overrides registered for its user context apply before its scripts run.
 * - **Realms come before commits.** Firefox creates a new document's realm before `navigationCommitted`, after
 *   destroying the old one. A main-world realm created for a context whose document already had one belongs
 *   to the next commit, and is held until then; one destroyed first is never reported.
 * - **Intercepts** are compiled to BiDi URL patterns that cover each glob, and the glob itself is checked here:
 *   a paused request no registration matches continues at once. BiDi can't scope an intercept to a user
 *   context, so one scoped to a user context intercepts browser-wide and filters here too.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as BrowserBidi from "../bidi-protocol/Browser.ts"
import * as BrowsingContext from "../bidi-protocol/BrowsingContext.ts"
import * as Emulation from "../bidi-protocol/Emulation.ts"
import * as Input from "../bidi-protocol/Input.ts"
import * as Log from "../bidi-protocol/Log.ts"
import * as Network from "../bidi-protocol/Network.ts"
import * as Permissions from "../bidi-protocol/Permissions.ts"
import * as Script from "../bidi-protocol/Script.ts"
import * as Session from "../bidi-protocol/Session.ts"
import * as Storage from "../bidi-protocol/Storage.ts"
import * as Browser from "../Browser.ts"
import * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Dialog from "../Dialog.ts"
import type * as Download from "../Download.ts"
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
import * as BidiWire from "./bidiWire.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Declarations from "./declarations.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"
import * as Retired from "./retired.ts"

// ── Tables ────────────────────────────────────────────────────────────────────────────────────────────────

interface ContextEntry {
  readonly id: UserContext.Id
  /** BiDi's id: `"default"` for the default context. */
  readonly bidi: string
  removing: boolean
}

interface NavigableEntry {
  readonly bidi: string
  readonly id: L1Target.NavigableId
  readonly parent: NavigableEntry | undefined
  readonly children: Set<NavigableEntry>
  readonly context: ContextEntry
  /** The page: itself for a top-level context. */
  page: NavigableEntry
  closing: L1Target.CloseReason | undefined
  document: DocumentEntry | undefined
  /** Main-world realms created for the next document, before it commits. */
  readonly pendingRealms: Array<RealmEntry>
  /**
   * A traversal that replied before its restored document's realm arrived, waiting for it: under load, Firefox
   * can reply first.
   */
  restoring: ((realm: RealmEntry) => void) | undefined
  /** Navigations started by a command that the browser hasn't announced yet, oldest first. */
  readonly expected: Array<
    { readonly id: PageNavigation.Id; readonly url: string; readonly initiatedAs: Adapter.InitiatedAs }
  >
  readonly navigations: Map<string, NavigationEntry>
  /** The documents it had, by URL: what a restore from the back/forward cache restores. */
  readonly past: Map<string, L1Target.DocumentId>
  removed: boolean
}

interface DocumentEntry {
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

interface RealmEntry {
  readonly id: L1Target.RealmId
  readonly bidi: string
  readonly navigable: NavigableEntry | undefined
  readonly world: Adapter.World
  readonly origin: string
  ended: boolean
  /** What it logged while it waited for its document's commit, reported after it. */
  readonly held: Array<Adapter.Fact>
}

interface NavigationEntry {
  readonly id: PageNavigation.Id
  readonly bidi: string
  readonly navigable: NavigableEntry
  readonly url: string
  readonly sameDocument: boolean
  /** A move through history, which may restore a document from the back/forward cache. */
  readonly traversal: boolean
  documentHop: NetworkRequest.HopId | undefined
  status: number | undefined
  ended: boolean
}

interface RequestEntry {
  readonly id: NetworkRequest.Id
  readonly bidi: string
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

type ObligationEntry =
  | {
    readonly _tag: "PausedRequest"
    readonly id: Adapter.ObligationId
    readonly request: string
    readonly phase: "request" | "response" | "auth"
    /** The headers it was sent with, which a new body's `Content-Length` replaces one of. */
    readonly headers: ReadonlyArray<Network.Header>
  }
  | {
    readonly _tag: "Prompt"
    readonly id: Adapter.ObligationId
    readonly prompt: Dialog.PromptId
    readonly context: string
  }
  | {
    readonly _tag: "FileChooser"
    readonly id: Adapter.ObligationId
    readonly context: string
    readonly element: string | undefined
  }

interface InterceptEntry {
  readonly registration: Adapter.RegistrationId
  readonly bidi: string
  readonly scope: Adapter.DeclarationScope
  readonly globs: ReadonlyArray<RegExp>
  readonly phases: ReadonlyArray<"request" | "response" | "auth">
}

// ── Mapping ───────────────────────────────────────────────────────────────────────────────────────────────

const destinations: Readonly<Record<string, NetworkRequest.ResourceType>> = {
  document: "document",
  iframe: "document",
  frame: "document",
  style: "stylesheet",
  script: "script",
  worker: "script",
  sharedworker: "script",
  serviceworker: "script",
  image: "image",
  font: "font",
  audio: "media",
  video: "media",
  track: "media",
  manifest: "manifest"
}

const resourceType = (request: Network.RequestData): NetworkRequest.ResourceType => {
  const known = destinations[request.destination]
  if (known !== undefined) return known
  switch (request.initiatorType) {
    case "fetch":
      return "fetch"
    case "xmlhttprequest":
      return "xhr"
    case "beacon":
      return "ping"
    default:
      return "other"
  }
}

const methods = new Set(NetworkRequest.Method.literals as ReadonlyArray<string>)

const bytesText = (value: Network.BytesValue): string =>
  value.type === "string" ? value.value : new TextDecoder().decode(fromBase64(value.value))

const headersOf = (headers: ReadonlyArray<Network.Header>): Headers.Headers =>
  Headers.fromInput(Object.fromEntries(headers.map((header) => [header.name, bytesText(header.value)])))

// Several cookies come as one value, a line each (routes.ts)
const bidiHeaders = (headers: Readonly<Record<string, string>>): Array<Network.Header> =>
  Object.entries(headers).flatMap(([name, value]) =>
    (name.toLowerCase() === "set-cookie" ? value.split("\n") : [value]).map((each) => ({
      name,
      value: { type: "string", value: each }
    }))
  )

const base64 = (bytes: Uint8Array): string => Encoding.encode(bytes)
const fromBase64 = (text: string): Uint8Array => {
  const decoded = Encoding.decode(text)
  return decoded._tag === "Success" ? decoded.success : new Uint8Array()
}

// The console method says what the page wrote; BiDi's level is coarser (`console.log` is `info`).
const consoleLevel = (method: string): ConsoleMessage.Level =>
  method === "error" || method === "assert"
    ? "error"
    : method === "warn"
    ? "warning"
    : method === "debug"
    ? "debug"
    : method === "info"
    ? "info"
    : "log"

// WebDriver's codes for keys whose value isn't the text they type.
const webdriverKeys: Readonly<Record<string, string>> = {
  Cancel: "\uE001",
  Help: "\uE002",
  Backspace: "\uE003",
  Tab: "\uE004",
  Clear: "\uE005",
  // WebDriver's Return; its Enter (U+E007) is the numpad's, which Firefox reports as `NumpadEnter`
  Enter: "\uE006",
  Shift: "\uE008",
  Control: "\uE009",
  Alt: "\uE00A",
  Pause: "\uE00B",
  Escape: "\uE00C",
  PageUp: "\uE00E",
  PageDown: "\uE00F",
  End: "\uE010",
  Home: "\uE011",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowRight: "\uE014",
  ArrowDown: "\uE015",
  Insert: "\uE016",
  Delete: "\uE017",
  F1: "\uE031",
  F2: "\uE032",
  F3: "\uE033",
  F4: "\uE034",
  F5: "\uE035",
  F6: "\uE036",
  F7: "\uE037",
  F8: "\uE038",
  F9: "\uE039",
  F10: "\uE03A",
  F11: "\uE03B",
  F12: "\uE03C",
  Meta: "\uE03D"
}

const keyValue = (key: string): string => webdriverKeys[key] ?? key

const buttons: Readonly<Record<string, number>> = { none: 0, left: 0, middle: 1, right: 2, back: 3, forward: 4 }

/** A `*` glob over a whole URL, as a regular expression. */
const globRegExp = (glob: string): RegExp =>
  new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)

/**
 * The BiDi pattern that covers a glob: its scheme, host and port when the glob spells them out with no
 * wildcard, or every URL.
 */
const coveringPattern = (glob: string): Network.UrlPattern | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/*:]+)(?::(\d+))?\//i.exec(glob)
  if (match === null) return undefined
  return {
    type: "pattern",
    protocol: match[1]!,
    hostname: match[2]!,
    ...(match[3] === undefined ? {} : { port: match[3] })
  } as Network.UrlPattern
}

const errorPage = (url: string) => url.startsWith("about:neterror") || url.startsWith("about:certerror")

/**
 * Where a navigation was going: an error page's `u` parameter, since Firefox starts a navigation it refuses at
 * once (a port browsers don't use, say) as its error page.
 */
const intended = (url: string) => {
  if (!errorPage(url)) return url
  try {
    return new URL(url).searchParams.get("u") ?? url
  } catch {
    return url
  }
}

/** The events the fold needs. */
const foldEvents: ReadonlyArray<Protocol.EventDef<string, any>> = [
  BrowsingContext.contextCreated,
  BrowsingContext.contextDestroyed,
  BrowsingContext.navigationStarted,
  BrowsingContext.navigationCommitted,
  BrowsingContext.navigationFailed,
  BrowsingContext.navigationAborted,
  BrowsingContext.fragmentNavigated,
  BrowsingContext.historyUpdated,
  BrowsingContext.domContentLoaded,
  BrowsingContext.load,
  BrowsingContext.downloadWillBegin,
  BrowsingContext.downloadEnd,
  BrowsingContext.userPromptOpened,
  BrowsingContext.userPromptClosed,
  Script.realmCreated,
  Script.realmDestroyed,
  Log.entryAdded,
  Network.beforeRequestSent,
  Network.responseStarted,
  Network.responseCompleted,
  Network.fetchError,
  Network.authRequired,
  Input.fileDialogOpened
]

// ── Remote values ─────────────────────────────────────────────────────────────────────────────────────────

const toLocalValue = (
  local: Adapter.LocalValue,
  handles: ReadonlyMap<Adapter.HandleId, { readonly handle: string }>
): Script.LocalValue => {
  if (local._tag === "Handle") return { handle: handles.get(local.handle)?.handle ?? "" } as Script.LocalValue
  // A shared id names a node in every realm of its document
  if (local._tag === "Node") return { sharedId: local.node.binding } as Script.LocalValue
  return localOf(local.value)
}

const localOf = (value: Adapter.RemoteValue): Script.LocalValue => {
  switch (value.type) {
    case "undefined":
    case "null":
      return { type: value.type } as Script.LocalValue
    case "string":
    case "boolean":
    case "bigint":
    case "date":
    case "number":
      return { type: value.type, value: value.value } as Script.LocalValue
    case "regexp":
      return { type: "regexp", value: value.value } as Script.LocalValue
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return {
        type: value.type === "set" ? "set" : "array",
        value: (value.value ?? []).map(localOf)
      } as Script.LocalValue
    case "object":
    case "map":
      return {
        type: value.type,
        value: (value.value ?? []).map(([key, item]) => [typeof key === "string" ? key : localOf(key), localOf(item)])
      } as Script.LocalValue
    case "node":
      return { sharedId: value.node?.binding ?? "" } as Script.LocalValue
    default:
      return { type: "undefined" } as Script.LocalValue
  }
}

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────────────

/** The backend's capabilities, for a browser it connected to; the documentation tools read them too. */
export const capabilities = (info: Browser.Info, ownership: Adapter.ConnectOptions["ownership"]) => {
  const evidence = `BiDi adapter static profile, ${info.product} ${info.version}`
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("userContexts", "supported"),
      entry("isolatedWorlds", "supported"),
      entry("pauseOnStart.frames", "supported", [
        "nothing is paused: WebDriver BiDi applies the context's scripts and settings to each new document itself"
      ]),
      entry("pauseOnStart.workers", "unsupported", ["preload scripts don't run in workers"]),
      entry("initScripts.workers", "unsupported", ["WebDriver BiDi's preload scripts run in documents only"]),
      entry("pauseOnStart.popups", "supported", [
        "nothing is paused: WebDriver BiDi applies the context's scripts and settings to each new popup itself"
      ]),
      entry("input.native", "unsupported", ["WebDriver actions, not native input"]),
      entry("input.webdriver", "supported"),
      entry("interception.request", "supported"),
      entry("interception.response", "supported"),
      entry("interception.auth", "supported"),
      entry("network.challenges", "supported"),
      entry("bodies", "supported", ["only with a body collection declared before the request"]),
      entry("console", "partial", [
        "a dedicated worker's messages are attributed to its page, and shared and service workers' aren't reported"
      ]),
      entry("prompts", "supported"),
      entry("prompts.kind", "supported"),
      entry("navigation.sameDocument", "supported"),
      entry("navigation.traverse", "supported"),
      entry("frames.contentFrame", "supported"),
      entry("screenshot.format", "supported"),
      entry("storageState.partitioned", "supported"),
      entry("popups.opener", "supported"),
      entry("network.headersSent", "supported"),
      entry("input.touch", "supported"),
      entry("close.runBeforeUnload", "supported"),
      entry(
        "fileChooser",
        "partial",
        ownership === "launched"
          ? ["the input gets a cancel event as the chooser opens, before any decision"]
          : [
            "an attached session leaves file choosers to the browser, since a session's prompt settings are the whole browser's and dismissing would cancel the user's own"
          ]
      ),
      entry("downloads", "supported"),
      entry("downloads.progress", "unsupported", ["WebDriver BiDi reports a download's start and end only"]),
      entry("downloads.cancel", "unsupported", ["WebDriver BiDi has no command to cancel a download"]),
      entry("screenshot", "supported"),
      entry("pdf", "supported"),
      entry("evaluation.userActivation", "supported"),
      entry("input.insertText", "partial", [
        "WebDriver BiDi has no command for it, so each character is typed as a key"
      ]),
      entry("input.pointerModifiers", "supported", ["modifiers are held as keys; a mouse event's flags are ignored"]),
      entry("input.keyboardLayout", "partial", [
        "WebDriver BiDi sends a key as its value: the code is Firefox's for that key on a US keyboard, and there is no AltGr or dead key"
      ]),
      entry("input.dragAndDrop", "unsupported", [
        "Firefox starts an HTML drag from WebDriver actions, and never drops it"
      ]),
      entry("webSocketFrames", "unsupported", ["WebDriver BiDi has no WebSocket frame events"]),
      entry("networkConnections", "unsupported", [
        "WebDriver BiDi reports a WebSocket's handshake as a request, and not its frames or its close"
      ]),
      entry("networkConnections.eventSource", "unsupported", ["WebDriver BiDi reports an EventSource as a request"]),
      entry("workers.shared", "unsupported", ["Firefox reports shared workers, but not whose context they are in"]),
      entry("workers.service", "unsupported", ["Firefox reports service workers, but not whose context they are in"]),
      entry("workers.evaluate", "unsupported", ["Firefox can't evaluate in a worker realm"]),
      entry("exceptions.kind", "partial", ["an unhandled rejection is reported as a throw, so its kind is unknown"]),
      entry("network.servedBy", "partial", [
        "a cache and a service worker look alike: both are cacheOrServiceWorker (Firefox's fromCache)"
      ]),
      entry("cookies", "supported"),
      entry("permissions", "supported", ["granted per origin; reset sets the ones granted here back to prompt"]),
      entry("permissions.anyOrigin", "unsupported", ["WebDriver BiDi grants a permission to one origin"]),
      entry("interception.responseBody", "unsupported", [
        "WebDriver BiDi has no body for a response paused as it starts"
      ]),
      entry("interception.responseFulfill", "unsupported", ["Firefox doesn't implement network.provideResponse there"]),
      entry("interception.responseHeaders", "supported"),
      entry("interception.continueUrl", "unsupported", ["Firefox aborts a request continued with a new URL"]),
      entry("interception.abortReason", "unsupported", ["WebDriver BiDi has one failure for every reason"]),
      entry("interception.redirects", "supported"),
      entry("emulation.viewport", "supported"),
      entry("emulation.viewport.mobile", "unsupported", ["WebDriver BiDi has no mobile viewport"]),
      entry("emulation.userAgent", "supported"),
      entry("emulation.locale", "supported"),
      entry("emulation.timezone", "supported"),
      entry("emulation.geolocation", "supported"),
      entry("emulation.geolocation.unavailable", "unsupported", ["Firefox rejects an unavailable position"]),
      entry("emulation.media", "unsupported", ["Firefox doesn't implement emulation.setMediaFeaturesOverride"]),
      entry("emulation.network.offline", "supported"),
      entry("emulation.network.throttling", "unsupported", ["WebDriver BiDi can only take a page offline"]),
      entry("emulation.cpuSlowdown", "unsupported", ["WebDriver BiDi has no CPU throttling"]),
      entry("emulation.javaScript", "unsupported", ["Firefox doesn't implement emulation.setScriptingEnabled"]),
      entry("emulation.touch", "unsupported", ["Firefox doesn't implement emulation.setTouchOverride"]),
      entry("emulation.focus", "unsupported", ["WebDriver BiDi has no focus emulation"]),
      entry("screenshot.cssScale", "unsupported", ["WebDriver BiDi captures device pixels only"]),
      entry("screenshot.omitBackground", "unsupported", ["WebDriver BiDi has no background override"]),
      entry("pdf.headerFooter", "unsupported", ["WebDriver BiDi prints no header or footer"]),
      entry("pdf.preferCssPageSize", "unsupported", ["WebDriver BiDi prints at the size it is given"]),
      entry("cookies.partitioned", "unsupported", ["Firefox doesn't say which partition a cookie is in"]),
      entry("snapshot.clickListeners", "unsupported", ["WebDriver BiDi can't list event listeners"]),
      entry("capability.axTree", "unsupported", ["WebDriver BiDi has no accessibility tree"]),
      entry("capability.screencast", "unsupported", [
        "Firefox's browsingContext.startScreencast records a WebM file on the browser's host, and streams no frames"
      ]),
      ownership === "launched"
        ? entry("capability.video", "supported", ["written where the page's context downloads to"])
        : entry("capability.video", "unsupported", [
          "Firefox writes the file on its own host, out of the program's reach"
        ])
    ]
  })
}

const gone = (target: L1Target.Description, reason: L1Target.CloseReason) =>
  new Adapter.AdapterError({ reason: { _tag: "Gone", target, reason } })

const foreign = (id: string) => new Adapter.AdapterError({ reason: { _tag: "Foreign", id } })

const protocolError = Adapter.protocolError

// How Firefox's text begins for a thrown value that isn't an object
const uncaughtValue = "uncaught exception: "

const unsupported = (capability: string, hint: string) =>
  new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability, hint } })

// URLs compared as the browser writes them: `http://a` and `http://a/` are one navigation.
const normalize = (url: string): string => {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

/** Settings for connecting the BiDi adapter. */
export interface ConnectOptions extends Adapter.ConnectOptions {
  /**
   * Whether to start a session with `session.new`, as a browser's `/session` endpoint needs, or use the one
   * the connection already has.
   *
   * @default "new"
   */
  readonly session?: "new" | "existing" | undefined
}

/**
 * Connects the BiDi adapter over a transport. The connection lives as long as the scope.
 */
export const connect: (
  transport: Transport.Transport,
  options: ConnectOptions
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(transport: Transport.Transport, options: ConnectOptions) {
    const ids = Adapter.makeIds()
    const registry = Declarations.make()
    const contexts = new Map<UserContext.Id, ContextEntry>()
    const contextsByBidi = new Map<string, ContextEntry>()
    const navigables = new Map<string, NavigableEntry>()
    const navigablesById = new Map<L1Target.NavigableId, NavigableEntry>()
    const documents = new Map<L1Target.DocumentId, DocumentEntry>()
    const realms = new Map<string, RealmEntry>()
    // The page of each dedicated worker, from its owner
    const workerPages = new Map<RealmEntry, NavigableEntry>()
    const realmsById = new Map<L1Target.RealmId, RealmEntry>()
    const navigations = new Map<string, NavigationEntry>()
    const requests = new Map<string, RequestEntry>()
    const hops = new Map<NetworkRequest.HopId, RequestEntry>()
    // Finished requests stay answerable while there is room (QUIRKS.md, Q177)
    const retire = Retired.make((key: string) => {
      const request = requests.get(key)
      if (request === undefined) return
      requests.delete(key)
      for (let hop = 0; hop <= request.redirects; hop++) hops.delete(ids.hop(request.id, hop))
    })
    const obligations = new Map<Adapter.ObligationId, ObligationEntry>()
    const downloads = new Map<string, { readonly id: Download.Id; path: string | undefined }>()
    const downloadsById = new Map<Download.Id, { readonly id: Download.Id; path: string | undefined }>()
    const handles = new Map<Adapter.HandleId, { readonly handle: string; readonly realm: string }>()
    const intercepts = new Map<Adapter.RegistrationId, InterceptEntry>()
    let adopting = true

    let out: Array<Adapter.Fact> = []
    const emit = (fact: Adapter.Fact): void => {
      out.push(fact)
    }
    const flush = Effect.suspend(() => {
      const facts = out
      out = []
      return Effect.forEach(facts, options.sink, { discard: true })
    })

    // ── Ending things ──

    const removeRealm = (realm: RealmEntry, reason: L1Target.CloseReason) => {
      if (realm.ended) return
      realm.ended = true
      realms.delete(realm.bidi)
      realmsById.delete(realm.id)
      emit({ _tag: "RealmRemoved", realm: realm.id, reason })
    }

    const endNavigation = (navigation: NavigationEntry, outcome: Adapter.NavigationOutcome, evidence: string) => {
      if (navigation.ended) return
      navigation.ended = true
      navigation.navigable.navigations.delete(navigation.bidi)
      if (navigations.get(navigation.bidi) === navigation) navigations.delete(navigation.bidi)
      emit({ _tag: "NavigationEnded", navigation: navigation.id, outcome, evidence })
    }

    const removeNavigable = (navigable: NavigableEntry, reason: L1Target.CloseReason, evidence: string) => {
      if (navigable.removed) return
      // Frames end as their page does, or as detached when only their own container went away
      for (const child of Array.from(navigable.children)) {
        removeNavigable(child, reason._tag === "FrameDetached" ? reason : reason, evidence)
      }
      navigable.removed = true
      navigable.parent?.children.delete(navigable)
      navigables.delete(navigable.bidi)
      navigablesById.delete(navigable.id)
      if (navigable.document !== undefined) {
        for (const realm of navigable.document.realms) removeRealm(realm, reason)
        documents.delete(navigable.document.id)
      }
      for (const navigation of navigable.navigations.values()) navigation.ended = true
      if (navigable.parent === undefined) {
        for (const [id, obligation] of obligations) {
          if (obligation._tag !== "PausedRequest" && navigables.get(obligation.context) === undefined) {
            obligations.delete(id)
            emit({ _tag: "ObligationEnded", obligation: id, reason: "targetGone", evidence })
          }
        }
      }
      emit({ _tag: "NavigableRemoved", navigable: navigable.id, reason, evidence })
    }

    // ── Documents and navigations ──

    const commit = (
      navigable: NavigableEntry,
      url: string,
      origin: string,
      createdBy: Adapter.DocumentCreatedBy,
      navigation: string | undefined,
      evidence: string
    ): DocumentEntry => {
      const old = navigable.document
      const document: DocumentEntry = {
        id: ids.document(),
        navigable,
        url,
        generation: 0,
        navigation,
        realms: new Set(),
        hadMainRealm: false,
        complete: false
      }
      documents.set(document.id, document)
      navigable.document = document
      emit({
        _tag: "DocumentCommitted",
        document: document.id,
        navigable: navigable.id,
        url,
        origin,
        createdBy,
        replaced: Option.fromUndefinedOr(old?.id),
        evidence
      })
      if (old !== undefined) {
        documents.delete(old.id)
        navigable.past.set(old.url, old.id)
        // A realm that survived the commit hosts the new document: the initial about:blank's (probe 2)
        for (const realm of old.realms) {
          if (realm.ended) continue
          document.realms.add(realm)
          if (realm.world._tag === "Main") document.hadMainRealm = true
          emit({ _tag: "RealmDocumentAdded", realm: realm.id, document: document.id })
        }
      }
      // Realms created ahead of the commit, for this document
      for (const realm of navigable.pendingRealms.splice(0)) {
        if (realm.ended) continue
        addWindowRealm(realm, document)
      }
      return document
    }

    const addWindowRealm = (realm: RealmEntry, document: DocumentEntry) => {
      document.realms.add(realm)
      if (realm.world._tag === "Main") document.hadMainRealm = true
      emit({
        _tag: "RealmAdded",
        realm: realm.id,
        origin: realm.origin,
        kind: { _tag: "Window", navigable: document.navigable.id, document: document.id, world: realm.world }
      })
      for (const fact of realm.held.splice(0)) emit(fact)
    }

    // What a realm logs is reported after the realm itself, which may be waiting for its document's commit.
    const emitFrom = (realm: RealmEntry, fact: Adapter.Fact) => {
      if (realm.navigable?.pendingRealms.includes(realm) === true) realm.held.push(fact)
      else emit(fact)
    }

    const startNavigation = (
      navigable: NavigableEntry,
      bidi: string,
      url: string,
      type: Adapter.InitiatedAs,
      sameDocument: boolean,
      /** A command's expectation, already taken; otherwise the first that matches is. */
      taken?: { readonly id: PageNavigation.Id; readonly initiatedAs: Adapter.InitiatedAs }
    ): NavigationEntry => {
      const normalized = normalize(url)
      const index = taken !== undefined
        ? -1
        : navigable.expected.findIndex((expected) => normalize(expected.url) === normalized)
      const expected = taken ?? (index >= 0 ? navigable.expected.splice(index, 1)[0] : navigable.expected.shift())
      const initiatedAs = expected?.initiatedAs ?? type
      const traversal = initiatedAs === "traversal"
      const navigation: NavigationEntry = {
        id: expected?.id ?? ids.navigation(),
        bidi,
        navigable,
        url,
        sameDocument,
        traversal,
        documentHop: undefined,
        status: undefined,
        ended: false
      }
      if (!sameDocument) {
        // A navigable has one cross-document navigation at a time: a new one replaces the one in flight
        for (const pending of navigable.navigations.values()) {
          if (!pending.sameDocument) {
            endNavigation(pending, { _tag: "Superseded", by: navigation.id }, "bidi:browsingContext.navigationStarted")
          }
        }
      }
      navigable.navigations.set(bidi, navigation)
      navigations.set(bidi, navigation)
      emit({
        _tag: "NavigationStarted",
        navigation: navigation.id,
        navigable: navigable.id,
        url,
        initiatedAs
      })
      return navigation
    }

    // ── Contexts ──

    const contextFor = (bidi: string | null | undefined): ContextEntry => {
      const key = bidi ?? "default"
      const known = contextsByBidi.get(key)
      if (known !== undefined) return known
      // A user context someone else created
      const entry: ContextEntry = { id: ids.userContext(), bidi: key, removing: false }
      contexts.set(entry.id, entry)
      contextsByBidi.set(key, entry)
      emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
      return entry
    }

    const addNavigable = (info: {
      readonly context: string
      readonly parent?: string | null | undefined
      readonly userContext: string | null
      readonly originalOpener: string | null
      readonly url: string
    }, adopted: boolean): NavigableEntry | undefined => {
      if (navigables.has(info.context)) return navigables.get(info.context)
      // Firefox names no user context for a window's context as it goes (QUIRKS.md, Q178): one that never came
      // can't be placed, and isn't adopted
      if (info.userContext === null) return undefined
      const parent = info.parent === null || info.parent === undefined ? undefined : navigables.get(info.parent)
      if (info.parent !== null && info.parent !== undefined && parent === undefined) return undefined
      const context = contextFor(info.userContext)
      const navigable: NavigableEntry = {
        bidi: info.context,
        id: ids.navigable(),
        parent,
        children: new Set(),
        context,
        page: undefined as unknown as NavigableEntry,
        closing: undefined,
        document: undefined,
        pendingRealms: [],
        restoring: undefined,
        expected: [],
        past: new Map(),
        navigations: new Map(),
        removed: false
      }
      navigable.page = parent?.page ?? navigable
      navigables.set(info.context, navigable)
      navigablesById.set(navigable.id, navigable)
      if (parent === undefined) {
        const opener = info.originalOpener === null ? undefined : navigables.get(info.originalOpener)
        const openerId = Option.fromUndefinedOr(opener?.page.id)
        emit({
          _tag: "PageAdded",
          page: navigable.id,
          context: context.id,
          kind: info.originalOpener === null ? "tab" : "popup",
          origin: adopted
            ? { _tag: "Adopted", opener: openerId }
            : info.originalOpener === null
            ? { _tag: "Created" }
            : { _tag: "Opened", opener: openerId },
          url: info.url
        })
      } else {
        parent.children.add(navigable)
        emit({ _tag: "FrameAdded", frame: navigable.id, parent: parent.id, page: navigable.page.id })
      }
      commit(
        navigable,
        info.url,
        "null",
        adopted && info.url !== "about:blank" ? { _tag: "Adopted" } : { _tag: "InitialBlank" },
        undefined,
        "bidi:browsingContext.contextCreated"
      )
      // BiDi scopes declarations natively, so a new page is ready as it appears
      if (parent === undefined) emit({ _tag: "PageReady", page: navigable.id })
      return navigable
    }

    // ── The fold ──

    const navigableOf = (context: string | null | undefined) =>
      context === null || context === undefined ? undefined : navigables.get(context)

    const requestInitiator = (
      event: Network.BeforeRequestSentParameters,
      navigation: NavigationEntry | undefined
    ): NetworkRequest.NetworkRequest["initiator"] => {
      const navigable = navigableOf(event.context)
      return navigable === undefined
        ? { _tag: "Unattributed" }
        : { _tag: "Document", navigable: navigable.id, navigation: Option.fromUndefinedOr(navigation?.id) }
    }

    const handlers: Record<string, (params: any) => void> = {
      [BrowsingContext.contextCreated.method]: (params: BrowsingContext.ContextCreatedParameters) => {
        addNavigable(params, adopting)
      },
      [BrowsingContext.contextDestroyed.method]: (params: BrowsingContext.Info) => {
        const navigable = navigables.get(params.context)
        if (navigable === undefined) return
        removeNavigable(
          navigable,
          navigable.parent !== undefined
            ? { _tag: "FrameDetached" }
            : navigable.closing ?? (navigable.context.removing
              ? { _tag: "PageClosed", by: "userContextRemoved" }
              : { _tag: "PageClosed", by: "script" }),
          "bidi:browsingContext.contextDestroyed"
        )
      },
      [BrowsingContext.navigationStarted.method]: (params: BrowsingContext.NavigationInfo) => {
        const navigable = navigableOf(params.context)
        if (navigable === undefined || params.navigation === null) return
        // Firefox leaves out the URL of the navigation that closing with promptUnload starts
        startNavigation(navigable, params.navigation, intended(params.url ?? ""), "crossDocument", false)
      },
      [BrowsingContext.navigationCommitted.method]: (params: BrowsingContext.NavigationInfo) => {
        const navigable = navigableOf(params.context)
        if (navigable === undefined) return
        const url = params.url ?? ""
        const bidi = params.navigation ?? `committed:${navigable.bidi}:${url}`
        const navigation = navigations.get(bidi) ??
          startNavigation(navigable, bidi, intended(url), "crossDocument", false)
        const failed = errorPage(url)
        const document = commit(
          navigable,
          url,
          originOf(url),
          failed ? { _tag: "ErrorPage", navigation: navigation.id } : { _tag: "Navigation", navigation: navigation.id },
          bidi,
          "bidi:browsingContext.navigationCommitted"
        )
        endNavigation(
          navigation,
          failed
            ? { _tag: "Failed", error: errorText(url), errorDocument: Option.some(document.id) }
            : { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
          "bidi:browsingContext.navigationCommitted"
        )
      },
      [BrowsingContext.navigationFailed.method]: (params: BrowsingContext.NavigationInfo) => {
        const navigation = params.navigation === null ? undefined : navigations.get(params.navigation)
        if (navigation === undefined) return
        endNavigation(
          navigation,
          navigation.status === 204 || navigation.status === 205
            ? { _tag: "NoContent", status: navigation.status, response: Option.fromUndefinedOr(navigation.documentHop) }
            : { _tag: "Failed", error: "navigation failed", errorDocument: Option.none() },
          "bidi:browsingContext.navigationFailed"
        )
      },
      [BrowsingContext.navigationAborted.method]: (params: BrowsingContext.NavigationInfo) => {
        const navigation = params.navigation === null ? undefined : navigations.get(params.navigation)
        if (navigation === undefined) return
        endNavigation(
          navigation,
          { _tag: "Failed", error: "navigation aborted", errorDocument: Option.none() },
          "bidi:browsingContext.navigationAborted"
        )
      },
      [BrowsingContext.fragmentNavigated.method]: (params: BrowsingContext.NavigationInfo) =>
        sameDocument(params.context, params.navigation, params.url ?? "", "fragment"),
      [BrowsingContext.historyUpdated.method]: (params: BrowsingContext.HistoryUpdatedParameters) =>
        sameDocument(params.context, null, params.url, "historyApi"),
      [BrowsingContext.domContentLoaded.method]: (params: BrowsingContext.NavigationInfo) =>
        readiness(params.context, params.navigation, "interactive"),
      [BrowsingContext.load.method]: (params: BrowsingContext.NavigationInfo) =>
        readiness(params.context, params.navigation, "complete"),
      [BrowsingContext.downloadWillBegin.method]: (params: BrowsingContext.DownloadWillBeginParams) => {
        const navigable = navigableOf(params.context)
        const download = { id: ids.download(), path: undefined as string | undefined }
        downloads.set(params.download, download)
        downloadsById.set(download.id, download)
        if (navigable !== undefined) {
          emit({
            _tag: "DownloadStarted",
            download: download.id,
            page: navigable.page.id,
            url: params.url,
            suggestedFilename: params.suggestedFilename
          })
        }
        const navigation = params.navigation === null ? undefined : navigations.get(params.navigation)
        if (navigation !== undefined) {
          endNavigation(
            navigation,
            { _tag: "Download", download: Option.some(download.id) },
            "bidi:browsingContext.downloadWillBegin"
          )
        }
      },
      [BrowsingContext.downloadEnd.method]: (params: BrowsingContext.DownloadEndParams) => {
        const download = downloads.get(params.download)
        if (download === undefined) return
        downloads.delete(params.download)
        if (params.status === "complete") {
          download.path = "filepath" in params && params.filepath !== null ? params.filepath : undefined
          emit({
            _tag: "DownloadEnded",
            download: download.id,
            outcome: { _tag: "Completed", path: Option.fromUndefinedOr(download.path) }
          })
        } else {
          emit({ _tag: "DownloadEnded", download: download.id, outcome: { _tag: "Canceled" } })
        }
      },
      [BrowsingContext.userPromptOpened.method]: (params: BrowsingContext.UserPromptOpenedParameters) => {
        const navigable = navigableOf(params.context)
        if (navigable === undefined) return
        const prompt = ids.prompt()
        const obligation = ids.obligation()
        obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, context: params.context })
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "Prompt",
            prompt,
            page: navigable.page.id,
            kind: params.type === "beforeunload"
              ? "beforeunload"
              : params.type === "alert"
              ? "alert"
              : params.type === "confirm"
              ? "confirm"
              : "prompt",
            message: params.message,
            defaultValue: params.defaultValue ?? ""
          }
        })
      },
      [BrowsingContext.userPromptClosed.method]: (params: BrowsingContext.UserPromptClosedParameters) => {
        for (const [id, obligation] of obligations) {
          if (obligation._tag !== "Prompt" || obligation.context !== params.context) continue
          obligations.delete(id)
          emit({
            _tag: "PromptClosed",
            prompt: obligation.prompt,
            accepted: params.accepted,
            userText: Option.fromUndefinedOr(params.userText)
          })
          emit({
            _tag: "ObligationEnded",
            obligation: id,
            reason: "resolved",
            evidence: "bidi:browsingContext.userPromptClosed"
          })
          return
        }
      },
      [Script.realmCreated.method]: (params: Script.RealmInfo) => {
        if (realms.has(params.realm)) return
        if (params.type === "window") {
          const navigable = navigableOf(params.context)
          if (navigable === undefined) return
          const realm: RealmEntry = {
            id: ids.realm(),
            bidi: params.realm,
            navigable,
            world: params.sandbox === undefined ? { _tag: "Main" } : { _tag: "Isolated", name: params.sandbox },
            origin: params.origin,
            ended: false,
            held: []
          }
          realms.set(realm.bidi, realm)
          realmsById.set(realm.id, realm)
          const document = navigable.document
          // A second main-world realm for a document belongs to the next one, which hasn't committed yet
          if (document === undefined || (realm.world._tag === "Main" && document.hadMainRealm)) {
            navigable.pendingRealms.push(realm)
            if (realm.world._tag === "Main") navigable.restoring?.(realm)
          } else {
            addWindowRealm(realm, document)
          }
          return
        }
        const realm: RealmEntry = {
          id: ids.realm(),
          bidi: params.realm,
          navigable: undefined,
          world: { _tag: "Main" },
          origin: params.origin,
          ended: false,
          held: []
        }
        realms.set(realm.bidi, realm)
        realmsById.set(realm.id, realm)
        // A dedicated worker belongs to its owner's page; BiDi names no context for shared and service workers
        const owner = params.type === "dedicated-worker" ? realms.get(params.owners[0] ?? "") : undefined
        const page = owner === undefined ? undefined : owner.navigable?.page ?? workerPages.get(owner)
        if (page !== undefined) workerPages.set(realm, page)
        emit({
          _tag: "RealmAdded",
          realm: realm.id,
          origin: params.origin,
          kind: {
            _tag: "Worker",
            worker: params.type === "dedicated-worker"
              ? { _tag: "Dedicated", owner: Option.fromUndefinedOr(owner?.id) }
              : params.type === "shared-worker"
              ? { _tag: "Shared" }
              : { _tag: "Service", scope: Option.none() },
            // A worker realm's origin is its script's URL
            url: params.origin,
            page: Option.fromUndefinedOr(page?.id),
            context: Option.fromUndefinedOr(page?.context.id)
          }
        })
      },
      [Script.realmDestroyed.method]: (params: Script.RealmDestroyedParameters) => {
        const realm = realms.get(params.realm)
        if (realm === undefined) return
        const pending = realm.navigable?.pendingRealms.indexOf(realm) ?? -1
        if (pending >= 0) {
          // Created and destroyed before its document committed: it never reached the model
          realm.navigable!.pendingRealms.splice(pending, 1)
          realm.ended = true
          realms.delete(realm.bidi)
          realmsById.delete(realm.id)
          return
        }
        for (const document of documents.values()) document.realms.delete(realm)
        removeRealm(realm, { _tag: "RealmDestroyed" })
      },
      [Log.entryAdded.method]: (params: Log.Entry) => {
        const realm = realms.get(params.source.realm)
        const navigable = navigableOf(params.source.context)
        const top = params.stackTrace?.callFrames[0]
        const location = top === undefined || top.url === ""
          ? Option.none()
          // BiDi's lines and columns are 0-based; a location is 1-based, as stack traces print it
          : Option.some({ url: top.url as Url.Url, line: top.lineNumber + 1, column: top.columnNumber + 1 })
        const origin: L1Target.EventOrigin = navigable !== undefined
          ? { _tag: "Page", page: navigable.page.id }
          : realm !== undefined
          ? { _tag: "Worker", realm: realm.id }
          : { _tag: "Page", page: "" as L1Target.NavigableId }
        if (params.type === "console") {
          if (realm === undefined) return
          emitFrom(realm, {
            _tag: "ConsoleMessage",
            realm: realm.id,
            message: new ConsoleMessage.ConsoleMessage({
              level: consoleLevel("method" in params ? params.method : "log"),
              // Firefox formats the call itself, `%f` as printf does (QUIRKS.md, Q33), and sends that text as the only
              // argument, so it is the text
              text: params.text ?? "",
              location,
              origin,
              at: Adapter.now()
            })
          })
          return
        }
        if (params.type === "javascript") {
          const text = params.text ?? ""
          // A thrown value that isn't an Error, such as a string, reads as an Error whose message is the value
          const primitive = text.startsWith(uncaughtValue)
          const colon = primitive ? -1 : text.indexOf(": ")
          const name = colon > 0 ? text.slice(0, colon) : "Error"
          const message = primitive ? text.slice(uncaughtValue.length) : colon > 0 ? text.slice(colon + 2) : text
          const frames = params.stackTrace?.callFrames ?? []
          const fact: Adapter.Fact = {
            _tag: "UncaughtException",
            realm: Option.fromUndefinedOr(realm?.id),
            exception: new UncaughtException.UncaughtException({
              // Firefox reports a rejection exactly as a throw
              kind: "unknown",
              name,
              message,
              stack: frames.length === 0 ? Option.none() : Option.some(
                [
                  `${name}: ${message}`,
                  ...frames.map((frame) =>
                    `    at ${frame.functionName === "" ? "<anonymous>" : frame.functionName} (${frame.url}:${
                      frame.lineNumber + 1
                    }:${frame.columnNumber + 1})`
                  )
                ].join("\n")
              ),
              origin,
              at: Adapter.now()
            })
          }
          if (realm === undefined) emit(fact)
          else emitFrom(realm, fact)
        }
      },
      [Network.beforeRequestSent.method]: (params: Network.BeforeRequestSentParameters) => {
        const data = params.request
        let request = requests.get(data.request)
        if (request !== undefined && params.redirectCount > request.redirects) {
          // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
          request.redirects = params.redirectCount
          request.hop = ids.hop(request.id, request.redirects)
          request.bodySizes[request.redirects] = data.bodySize
          hops.set(request.hop, request)
        } else if (request === undefined) {
          const navigation = params.navigation === null ? undefined : navigations.get(params.navigation)
          const id = ids.request()
          request = {
            id,
            bidi: data.request,
            redirects: params.redirectCount,
            hop: ids.hop(id, params.redirectCount),
            navigable: navigableOf(params.context),
            navigation: navigation !== undefined && resourceType(data) === "document" ? navigation : undefined,
            finished: Deferred.makeUnsafe(),
            fulfilled: false,
            bodySizes: []
          }
          request.bodySizes[params.redirectCount] = data.bodySize
          requests.set(data.request, request)
          hops.set(request.hop, request)
        }
        if (request.navigation !== undefined) request.navigation.documentHop = request.hop
        const snapshot = new NetworkRequest.NetworkRequest({
          hop: request.hop,
          method: (methods.has(data.method) ? data.method : "GET") as NetworkRequest.NetworkRequest["method"],
          url: data.url as Url.Url,
          headers: headersOf(data.headers),
          resourceType: resourceType(data),
          initiator: requestInitiator(params, request.navigation),
          at: Adapter.now()
        })
        emit({ _tag: "RequestSent", request: snapshot })
        // The headers the request event gives are the ones sent, cookies included
        emit({ _tag: "HopHeaders", hop: snapshot.hop, phase: "request", headers: snapshot.headers })
        if (params.isBlocked) pause(params, "request", snapshot, Option.none())
      },
      [Network.responseStarted.method]: (params: Network.ResponseStartedParameters) => {
        const request = requests.get(params.request.request)
        if (request === undefined) return
        if (request.navigation !== undefined) request.navigation.status = params.response.status
        const response = new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: params.response.url as Url.Url,
          status: Math.min(599, Math.max(100, params.response.status || 200)) as NetworkResponse.StatusCode,
          statusText: params.response.statusText,
          httpVersion: Option.fromUndefinedOr(params.response.protocol || undefined),
          headers: headersOf(params.response.headers),
          // BiDi says only whether the network served it: Firefox's fromCache is true for a service
          // worker's response too
          servedBy: request.fulfilled ? "route" : params.response.fromCache ? "cacheOrServiceWorker" : "network",
          at: Adapter.now()
        })
        emit({ _tag: "ResponseReceived", response })
        if (params.isBlocked) {
          pause(params, "response", requestSnapshot(params, request), Option.some(response))
        }
      },
      [Network.responseCompleted.method]: (params: Network.ResponseCompletedParameters) => {
        const request = requests.get(params.request.request)
        if (request === undefined) return
        emit({
          _tag: "RequestFinished",
          hop: request.hop,
          encodedBytes: params.response.bytesReceived,
          at: Adapter.now()
        })
        // A redirect's response completes its hop; the request goes on
        if (params.response.status < 300 || params.response.status >= 400) {
          Deferred.doneUnsafe(request.finished, Effect.void)
          retire(params.request.request)
        }
      },
      [Network.fetchError.method]: (params: Network.FetchErrorParameters) => {
        const request = requests.get(params.request.request)
        if (request === undefined) return
        emit({
          _tag: "RequestFailed",
          hop: request.hop,
          error: params.errorText,
          canceled: params.errorText.includes("ABORTED"),
          at: Adapter.now()
        })
        Deferred.doneUnsafe(request.finished, Effect.fail(params.errorText))
        retire(params.request.request)
        const navigation = request.navigation
        if (navigation === undefined || navigation.ended) return
        if (navigation.status === 204 || navigation.status === 205) {
          endNavigation(navigation, {
            _tag: "NoContent",
            status: navigation.status,
            response: Option.fromUndefinedOr(navigation.documentHop)
          }, "bidi:network.fetchError")
        } else if (!params.errorText.includes("ABORTED")) {
          // An error page may still commit for this navigation; it is reported as the document it created
          endNavigation(
            navigation,
            { _tag: "Failed", error: params.errorText, errorDocument: Option.none() },
            "bidi:network.fetchError"
          )
        }
      },
      [Network.authRequired.method]: (params: Network.AuthRequiredParameters) => {
        const request = requests.get(params.request.request)
        if (request === undefined || !params.isBlocked) return
        const challenge = params.response.authChallenges?.[0]
        pause(params, "auth", requestSnapshot(params, request), Option.none(), challenge)
      },
      [Input.fileDialogOpened.method]: (params: Input.FileDialogInfo) => {
        const navigable = navigableOf(params.context)
        if (navigable === undefined) return
        const obligation = ids.obligation()
        const element = params.element?.sharedId
        obligations.set(obligation, { _tag: "FileChooser", id: obligation, context: params.context, element })
        emit({
          _tag: "ObligationOpened",
          obligation,
          subject: {
            _tag: "FileChooser",
            navigable: navigable.id,
            multiple: params.multiple,
            element: element === undefined || navigable.document === undefined
              ? Option.none()
              : Option.some({ document: navigable.document.id, binding: element })
          }
        })
      }
    }

    const originOf = (url: string) => {
      try {
        return new URL(url).origin
      } catch {
        return "null"
      }
    }

    const errorText = (url: string) => {
      try {
        return new URL(url).searchParams.get("e") ?? "error page"
      } catch {
        return "error page"
      }
    }

    const sameDocument = (context: string, bidi: string | null, url: string, via: "fragment" | "historyApi") => {
      const navigable = navigableOf(context)
      const document = navigable?.document
      if (navigable === undefined || document === undefined) return
      const navigation = (bidi === null ? undefined : navigations.get(bidi)) ??
        startNavigation(navigable, bidi ?? `same:${navigable.bidi}:${url}:${Math.random()}`, url, via, true)
      document.url = url
      emit({ _tag: "DocumentUrlChanged", document: document.id, url, navigation: navigation.id, via })
      endNavigation(
        navigation,
        { _tag: "SameDocument", document: document.id, via },
        `bidi:browsingContext.${via === "fragment" ? "fragmentNavigated" : "historyUpdated"}`
      )
    }

    const readiness = (context: string, bidi: string | null, readiness: "interactive" | "complete") => {
      const document = navigableOf(context)?.document
      if (document === undefined) return
      if (document.navigation !== undefined && bidi !== null && document.navigation !== bidi) return
      if (readiness === "interactive" && document.complete) {
        // Loaded again after it was complete: `document.open()` replaced its tree (probe 17)
        document.generation++
        document.complete = false
        emit({ _tag: "DocumentOpened", document: document.id, generation: document.generation })
      }
      if (readiness === "complete") document.complete = true
      emit({ _tag: "DocumentReadiness", document: document.id, readiness })
    }

    const requestSnapshot = (
      params: { readonly request: Network.RequestData; readonly context: string | null },
      request: RequestEntry
    ) =>
      new NetworkRequest.NetworkRequest({
        hop: request.hop,
        method: (methods.has(params.request.method) ? params.request.method : "GET") as NetworkRequest.NetworkRequest[
          "method"
        ],
        url: params.request.url as Url.Url,
        headers: headersOf(params.request.headers),
        resourceType: resourceType(params.request),
        initiator: request.navigable === undefined
          ? { _tag: "Unattributed" }
          : {
            _tag: "Document",
            navigable: request.navigable.id,
            navigation: Option.fromUndefinedOr(request.navigation?.id)
          },
        at: Adapter.now()
      })

    // A blocked request becomes an obligation if a registration's glob matches it; otherwise it continues.
    const pause = (
      params: {
        readonly request: Network.RequestData
        readonly context: string | null
        readonly intercepts?: ReadonlyArray<string> | undefined
      },
      phase: "request" | "response" | "auth",
      request: NetworkRequest.NetworkRequest,
      response: Option.Option<NetworkResponse.NetworkResponse>,
      challenge?: Network.AuthChallenge
    ) => {
      const navigable = navigableOf(params.context)
      const placement = navigable === undefined ? undefined : { page: navigable.page.id, context: navigable.context.id }
      const wanted = [...intercepts.values()].some((intercept) =>
        (params.intercepts ?? []).includes(intercept.bidi) && intercept.phases.includes(phase) &&
        (placement === undefined
          ? intercept.scope._tag === "Browser"
          : Declarations.covers(intercept.scope, placement)) &&
        (intercept.globs.length === 0 || intercept.globs.some((glob) => glob.test(params.request.url)))
      )
      if (!wanted) {
        unwanted.push({ request: params.request.request, phase })
        return
      }
      const obligation = ids.obligation()
      obligations.set(obligation, {
        _tag: "PausedRequest",
        id: obligation,
        request: params.request.request,
        phase,
        headers: params.request.headers
      })
      emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "PausedRequest",
          request,
          phase,
          response,
          challenge: challenge === undefined
            ? Option.none()
            : Option.some({ origin: originOf(params.request.url), scheme: challenge.scheme, realm: challenge.realm })
        }
      })
    }

    // Requests paused that no registration wants, continued by the worker after the fold, never on it
    let unwanted: Array<{ readonly request: string; readonly phase: "request" | "response" | "auth" }> = []
    const continueUnwanted = Effect.suspend(() => {
      const list = unwanted
      unwanted = []
      const send = (
        phase: "request" | "response" | "auth",
        request: Network.Request
      ): Effect.Effect<void, Protocol.ProtocolError> =>
        phase === "auth"
          ? Network.continueWithAuth({ request, action: "default" } as Network.ContinueWithAuthParameters).pipe(on)
          : phase === "response"
          ? Network.continueResponse({ request }).pipe(on)
          : Network.continueRequest({ request }).pipe(on)
      return Effect.forEach(
        list,
        ({ phase, request }) => send(phase, request as Network.Request).pipe(Effect.ignore, Effect.forkDetach),
        { discard: true }
      )
    })

    const makeFold = (control: ProtocolClient.FoldControl): ProtocolClient.Fold => ({
      events: new Map(foldEvents.map((event) => [event.method, event])),
      apply: (_session, method, params) =>
        Effect.suspend(() => {
          handlers[method]?.(params)
          return Effect.andThen(flush, continueUnwanted)
        }),
      lost: (session) =>
        Effect.sync(() => {
          // Rebuild from a fresh tree: contexts that are gone end, new ones are adopted
          control.sync(
            session,
            snapshot.pipe(
              Effect.map(({ received, tree }) => ({
                through: received,
                apply: Effect.suspend(() => {
                  reconcile(tree)
                  return flush
                })
              }))
            )
          )
        }),
      ended: (_session, reason) =>
        Effect.suspend(() => {
          if (reason.why === "connectionLost" || reason.why === "modelUnavailable") {
            const why: L1Target.CloseReason = reason.why === "connectionLost"
              ? { _tag: "ConnectionLost" }
              : { _tag: "ModelUnavailable" }
            for (const navigable of Array.from(navigables.values())) {
              if (navigable.parent === undefined) {
                removeNavigable(navigable, why, `bidi: the session ended (${reason.why})`)
              }
            }
          }
          return flush
        })
    })

    let control!: ProtocolClient.FoldControl
    const client = yield* ProtocolClient.make(transport, BidiWire.wire, {
      fold: (c) => {
        control = c
        return makeFold(c)
      }
    })
    const on = Protocol.on(client.root)

    const snapshot = Effect.gen(function*() {
      const { result: tree, received } = yield* client.root.sendSequenced(BrowsingContext.getTree({}))
      return { tree, received }
    })

    const reconcile = (tree: BrowsingContext.GetTreeResult) => {
      const seen = new Set<string>()
      const visit = (info: BrowsingContext.Info) => {
        seen.add(info.context)
        addNavigable(info, true)
        for (const child of info.children ?? []) visit(child)
      }
      for (const info of tree.contexts) visit(info)
      for (const navigable of Array.from(navigables.values())) {
        if (navigable.parent === undefined && !seen.has(navigable.bidi)) {
          removeNavigable(navigable, { _tag: "ModelUnavailable" }, "bidi:browsingContext.getTree")
        }
      }
    }

    // ── Connecting ──

    const failConnect = (error: Protocol.ProtocolError) =>
      Launch.fail(
        new Browser.ConnectionFailed({
          stage: "handshake",
          hint: error.message.includes("Maximum number of active sessions")
            ? `${error.message}: Firefox allows one WebDriver BiDi session at a time, and another client holds it; a session ends with session.end, not when its connection closes, or with the browser`
            : error.message
        }),
        "connect"
      )
    let product = "WebDriver BiDi"
    let version = ""
    if ((options.session ?? "new") === "new") {
      const created = yield* Session.new_({
        capabilities: {
          alwaysMatch: {
            // A session's prompt settings are the whole browser's: an attached one leaves the user's file choosers
            // alone
            unhandledPromptBehavior: {
              default: "ignore",
              file: options.ownership === "launched" ? "dismiss" : "ignore"
            }
          }
        }
      } as Session.NewParameters).pipe(on, Effect.catch(failConnect))
      product = created.capabilities.browserName
      version = created.capabilities.browserVersion
      // Firefox keeps a session after its socket closes, and allows one: a session this connection started ends
      // with it, or every later client is refused until the browser restarts
      yield* Effect.addFinalizer(() =>
        Session.end().pipe(on, Effect.timeoutOption("1 second"), Effect.ignore, BrowserClock.onLive)
      )
    }
    const info = new Browser.Info({ product, version, protocol: "bidi", revision: version })
    // The default context is mapped before subscribing: Firefox reports the contexts that exist as the subscription
    // is answered, and a tab in `"default"` mapped before it would land in a context of its own
    const defaultContext = ids.userContext()
    const defaultEntry: ContextEntry = { id: defaultContext, bidi: "default", removing: false }
    contexts.set(defaultContext, defaultEntry)
    contextsByBidi.set("default", defaultEntry)
    emit({ _tag: "UserContextAdded", context: defaultContext, isDefault: true })
    yield* Session.subscribe({ events: ["browsingContext", "script", "network", "log", "input"] }).pipe(
      on,
      Effect.catch(failConnect)
    )
    const { tree, received } = yield* snapshot.pipe(Effect.catch(failConnect))
    void received
    yield* control.run(Effect.suspend(() => {
      reconcile(tree)
      adopting = false
      return flush
    }))
    const capabilitySet = yield* SubscriptionRef.make(capabilities(info, options.ownership))

    // ── Operations ──

    const protocol = <A, R>(effect: Effect.Effect<A, Protocol.ProtocolError, R>) =>
      Effect.mapError(effect, protocolError)

    const run = (facts: () => void) =>
      control.run(Effect.suspend(() => {
        facts()
        return flush
      }))

    const contextOf = (id: UserContext.Id) =>
      Effect.suspend(() => {
        const context = contexts.get(id)
        return context === undefined ? Effect.fail(foreign(id)) : Effect.succeed(context)
      })

    const navigableById = (id: L1Target.NavigableId) =>
      Effect.suspend(() => {
        const navigable = navigablesById.get(id)
        return navigable === undefined ? Effect.fail(foreign(id)) : Effect.succeed(navigable)
      })

    const scopeParams = (scope: Adapter.DeclarationScope) => {
      switch (scope._tag) {
        case "Browser":
          return {}
        case "UserContext":
          return { userContexts: [contexts.get(scope.context)?.bidi ?? "default"] }
        case "Page":
          return { contexts: [navigablesById.get(scope.page)?.bidi ?? ""] }
      }
    }

    const createUserContext = Effect.fnUntraced(function*(options: Adapter.UserContextOptions) {
      const { userContext } = yield* protocol(
        BrowserBidi.createUserContext({
          ...(options.acceptInsecureCerts ? { acceptInsecureCerts: true } : {}),
          ...(Option.isSome(options.proxy)
            ? {
              proxy: {
                proxyType: "manual",
                httpProxy: options.proxy.value.server,
                sslProxy: options.proxy.value.server,
                noProxy: [...options.proxy.value.bypass]
              }
            }
            : {})
        } as BrowserBidi.CreateUserContextParameters).pipe(on)
      )
      const entry: ContextEntry = { id: ids.userContext(), bidi: userContext, removing: false }
      contexts.set(entry.id, entry)
      contextsByBidi.set(userContext, entry)
      yield* run(() => emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false }))
      // Browser-wide viewports are set per user context, so a new one gets them too
      yield* applyKind("Viewport", { _tag: "Browser" }).pipe(Effect.ignore)
      return entry.id
    })

    const removeUserContext = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      if (context.bidi === "default") {
        return yield* Effect.fail(
          unsupported("removeDefaultContext", "The default context exists for the whole connection")
        )
      }
      context.removing = true
      yield* protocol(BrowserBidi.removeUserContext({ userContext: context.bidi as BrowserBidi.UserContext }).pipe(on))
      yield* client.root.drainObserved
      contexts.delete(id)
      contextsByBidi.delete(context.bidi)
      yield* run(() => emit({ _tag: "UserContextRemoved", context: id }))
    })

    const createPage = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      // A window of its own, as Chromium's pages are (QUIRKS.md, Q70): a tab behind another renders about once a
      // second, too seldom to act on, and a window keeps rendering whichever page came last (Q71)
      const created = yield* protocol(
        BrowsingContext.create({
          type: "window",
          userContext: context.bidi as BrowserBidi.UserContext
        }).pipe(on)
      )
      // The context was announced before the reply; it is folded once this returns
      yield* client.root.drainObserved
      const navigable = navigables.get(created.context)
      if (navigable === undefined) {
        return yield* Effect.fail(gone({ _tag: "Browser" }, { _tag: "PageClosed", by: "browser" }))
      }
      return navigable.id
    })

    const closePage = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
        const navigable = yield* navigableById(id)
        if (!options.runBeforeUnload) navigable.closing = { _tag: "PageClosed", by: "command" }
        yield* protocol(
          BrowsingContext.close({
            context: navigable.bidi as BrowsingContext.BrowsingContext,
            promptUnload: options.runBeforeUnload
          }).pipe(on, Effect.forkDetach, Effect.andThen(Effect.void))
        )
      }
    )

    const expect = (navigable: NavigableEntry, url: string, initiatedAs: Adapter.InitiatedAs = "crossDocument") => {
      const id = ids.navigation()
      navigable.expected.push({ id, url, initiatedAs })
      return id
    }

    const neverStarted = Effect.fnUntraced(
      function*(navigable: NavigableEntry, id: PageNavigation.Id, url: string, error: string) {
        yield* client.root.drainObserved
        // Taken and reported in one step: Firefox can report the start after its error reply, and the event's
        // handler then either takes the expectation first or finds it reported, never a gap between (Q233)
        yield* run(() => {
          const index = navigable.expected.findIndex((expected) => expected.id === id)
          if (index < 0) return
          navigable.expected.splice(index, 1)
          emit({
            _tag: "NavigationStarted",
            navigation: id,
            navigable: navigable.id,
            url,
            initiatedAs: "crossDocument"
          })
          emit({
            _tag: "NavigationEnded",
            navigation: id,
            outcome: { _tag: "Failed", error, errorDocument: Option.none() },
            evidence: "bidi:browsingContext.navigate"
          })
        })
      }
    )

    // A navigation command whose reply is an error may still have started a navigation, whose outcome the
    // events report; one that never started ends at once.
    const sendNavigation = Effect.fnUntraced(function*(
      navigable: NavigableEntry,
      id: PageNavigation.Id,
      url: string,
      command: Effect.Effect<unknown, Protocol.ProtocolError>
    ) {
      return yield* command.pipe(
        Effect.as(id),
        Effect.catch((error) =>
          // What the browser doesn't implement fails the operation; anything else, the navigation
          error.reason._tag === "Unsupported"
            ? Effect.andThen(
              Effect.sync(() => {
                const index = navigable.expected.findIndex((expected) => expected.id === id)
                if (index >= 0) navigable.expected.splice(index, 1)
              }),
              Effect.fail(protocolError(error))
            )
            : Effect.as(neverStarted(navigable, id, url, error.message), id)
        )
      )
    })

    const navigate = Effect.fnUntraced(function*(
      id: L1Target.NavigableId,
      url: string,
      options: { readonly referrer: Option.Option<string> }
    ) {
      const navigable = yield* navigableById(id)
      if (Option.isSome(options.referrer)) {
        return yield* Effect.fail(unsupported("navigation.referrer", "WebDriver BiDi's navigate takes no referrer"))
      }
      const navigation = expect(navigable, url)
      return yield* sendNavigation(
        navigable,
        navigation,
        url,
        BrowsingContext.navigate({ context: navigable.bidi as BrowsingContext.BrowsingContext, url, wait: "none" })
          .pipe(on)
      )
    })

    const reload = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: { readonly ignoreCache: boolean }) {
      const navigable = yield* navigableById(id)
      const url = navigable.document?.url ?? ""
      const navigation = expect(navigable, url, "reload")
      return yield* sendNavigation(
        navigable,
        navigation,
        url,
        BrowsingContext.reload({
          context: navigable.bidi as BrowsingContext.BrowsingContext,
          // Firefox 158 refuses the argument whatever its value, so it is sent only to bypass the cache
          ...(options.ignoreCache ? { ignoreCache: true } : {}),
          wait: "none"
        }).pipe(on)
      )
    })

    const traverse = Effect.fnUntraced(function*(id: L1Target.NavigableId, delta: number) {
      const navigable = yield* navigableById(id)
      const navigation = expect(navigable, "", "traversal")
      const exit = yield* Effect.exit(
        BrowsingContext.traverseHistory({ context: navigable.bidi as BrowsingContext.BrowsingContext, delta }).pipe(on)
      )
      if (exit._tag === "Failure") {
        const index = navigable.expected.findIndex((expected) => expected.id === navigation)
        if (index >= 0) navigable.expected.splice(index, 1)
        return Option.none<PageNavigation.Id>()
      }
      // The reply comes once the traversal is done. One still in flight then, with a new main-world realm and
      // no commit, restored its document from the back/forward cache, which Firefox reports no other way. It may
      // not even have started one (Firefox 158, leaving its JSON viewer): then the realm says where it is.
      const evidence = "bidi:browsingContext.traverseHistory replied with a new realm and no commit"
      const restore = (entry: NavigationEntry, realm: RealmEntry) => {
        const from = navigable.past.get(entry.url)
        const document = commit(
          navigable,
          entry.url,
          realm.origin,
          from === undefined
            ? { _tag: "Navigation", navigation: entry.id }
            : { _tag: "Restored", navigation: entry.id, from },
          entry.bidi,
          evidence
        )
        endNavigation(
          entry,
          from === undefined
            ? { _tag: "Committed", document: document.id, response: Option.none() }
            : { _tag: "Restored", document: document.id },
          evidence
        )
      }
      const pendingRealm = () =>
        navigable.pendingRealms.find((pending) => !pending.ended && pending.world._tag === "Main")
      let unannounced: RealmEntry | undefined
      yield* run(() => {
        const entry = [...navigable.navigations.values()].find((pending) => pending.id === navigation)
        const realm = pendingRealm()
        if (realm === undefined) {
          // Its realm hasn't arrived yet: restore when it does, unless the traversal has ended by then
          if (entry !== undefined && !entry.ended) {
            navigable.restoring = (arrived) => {
              navigable.restoring = undefined
              if (!entry.ended) restore(entry, arrived)
            }
          }
          return
        }
        if (entry !== undefined && !entry.ended) restore(entry, realm)
        else if (navigable.expected.some((expected) => expected.id === navigation)) unannounced = realm
      })
      if (unannounced !== undefined) {
        const realm = unannounced
        const href = yield* Script.evaluate({
          expression: "location.href",
          target: { realm: realm.bidi as Script.Realm },
          awaitPromise: false
        }).pipe(
          on,
          Effect.map((result) =>
            result.type === "success" && result.result.type === "string" ? String(result.result.value) : undefined
          ),
          Effect.orElseSucceed(() => undefined)
        )
        yield* run(() => {
          const index = navigable.expected.findIndex((expected) => expected.id === navigation)
          if (href === undefined || index < 0 || pendingRealm() !== realm) return
          const [taken] = navigable.expected.splice(index, 1)
          restore(startNavigation(navigable, `restored:${navigation}`, href, "traversal", false, taken), realm)
        })
      }
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
      // Evaluating in a context's world creates its realm
      const result = yield* protocol(
        Script.evaluate({
          expression: "0",
          target: {
            context: document.navigable.bidi as BrowsingContext.BrowsingContext,
            ...(world._tag === "Isolated" ? { sandbox: world.name } : {})
          },
          awaitPromise: false
        } as Script.EvaluateParameters).pipe(on)
      )
      yield* client.root.drainObserved
      const realm = realms.get(result.realm)
      if (realm === undefined || realm.ended) {
        return yield* Effect.fail(gone({ _tag: "Document", id }, { _tag: "DocumentReplaced" }))
      }
      return realm.id
    })

    const toRemote = (value: Script.RemoteValue, realm: RealmEntry, keep: boolean): Adapter.RemoteValue => {
      const raw = value as any
      const handle = keep && typeof raw.handle === "string"
        ? (() => {
          const id = ids.handle()
          handles.set(id, { handle: raw.handle, realm: realm.bidi })
          return id
        })()
        : undefined
      switch (raw.type) {
        case "array":
        case "set":
        case "nodelist":
        case "htmlcollection":
          return {
            type: raw.type,
            handle,
            value: raw.value?.map((item: Script.RemoteValue) => toRemote(item, realm, keep))
          }
        case "object":
        case "map":
          return {
            type: raw.type,
            handle,
            value: raw.value?.map(([key, item]: [string | Script.RemoteValue, Script.RemoteValue]) => [
              typeof key === "string" ? key : toRemote(key, realm, keep),
              toRemote(item, realm, keep)
            ])
          }
        case "node": {
          const document = realm.navigable?.document
          return {
            type: "node",
            handle,
            node: document !== undefined && typeof raw.sharedId === "string"
              ? { document: document.id, binding: raw.sharedId }
              : undefined,
            value: raw.value === undefined
              ? undefined
              : {
                nodeType: raw.value.nodeType,
                localName: raw.value.localName,
                childNodeCount: raw.value.childNodeCount,
                attributes: raw.value.attributes
              }
          }
        }
        case "undefined":
        case "null":
          return { type: raw.type }
        case "string":
        case "number":
        case "boolean":
        case "bigint":
        case "date":
        case "regexp":
          return { type: raw.type, value: raw.value } as Adapter.RemoteValue
        default:
          return { type: raw.type, handle } as Adapter.RemoteValue
      }
    }

    const evaluate = Effect.fnUntraced(function*(id: L1Target.RealmId, call: Adapter.EvaluationCall) {
      const realm = realmsById.get(id)
      if (realm === undefined || realm.ended) {
        return yield* Effect.fail(gone({ _tag: "Realm", id }, { _tag: "RealmDestroyed" }))
      }
      const keep = call.result === "handle"
      const reply = yield* protocol(
        Script.callFunction({
          functionDeclaration: call.functionDeclaration,
          awaitPromise: call.awaitPromise,
          target: { realm: realm.bidi as Script.Realm },
          arguments: call.arguments.map((argument) => toLocalValue(argument, handles)),
          resultOwnership: keep ? "root" : "none",
          serializationOptions: { maxObjectDepth: keep ? 0 : 64, maxDomDepth: 0 },
          userActivation: call.userActivation
        } as Script.CallFunctionParameters).pipe(on)
      )
      if (reply.type === "exception") {
        const details = reply.exceptionDetails
        return {
          _tag: "Exception",
          text: details.text,
          exception: toRemote(details.exception, realm, false),
          stack: Option.none()
        } satisfies Adapter.RemoteResult
      }
      return { _tag: "Value", value: toRemote(reply.result, realm, keep) } satisfies Adapter.RemoteResult
    })

    // A realm's handles go in one command (QUIRKS.md, Q132)
    const releaseHandles = (list: ReadonlyArray<Adapter.HandleId>) =>
      Effect.suspend(() => {
        const byRealm = new Map<string, Array<Script.Handle>>()
        for (const id of list) {
          const handle = handles.get(id)
          if (handle === undefined) continue
          handles.delete(id)
          byRealm.set(handle.realm, [...(byRealm.get(handle.realm) ?? []), handle.handle as Script.Handle])
        }
        return Effect.forEach(
          byRealm,
          ([realm, owned]) =>
            Script.disown({ handles: owned, target: { realm: realm as Script.Realm } }).pipe(on, Effect.ignore),
          { concurrency: "unbounded", discard: true }
        )
      })

    const dispatchInput = Effect.fnUntraced(
      function*(
        id: L1Target.NavigableId,
        events: ReadonlyArray<Adapter.InputEvent>,
        frame?: { readonly frame: L1Target.NavigableId; readonly origin: { readonly x: number; readonly y: number } }
      ) {
        const navigable = yield* navigableById(id)
        // Firefox doesn't deliver page coordinates into a cross-site frame, so input aimed inside a frame goes to
        // the frame's own context, in its own coordinates
        const target = frame === undefined ? undefined : navigablesById.get(frame.frame)
        const context = (target ?? navigable.page).bidi as BrowsingContext.BrowsingContext
        const dx = target === undefined || frame === undefined ? 0 : frame.origin.x
        const dy = target === undefined || frame === undefined ? 0 : frame.origin.y
        // Consecutive events of one kind go in one batch of actions, in order
        const batches: Array<{ kind: "pointer" | "key" | "wheel" | "touch"; actions: Array<unknown> }> = []
        const batch = (kind: "pointer" | "key" | "wheel" | "touch") => {
          const last = batches.at(-1)
          if (last?.kind === kind) return last.actions
          const next = { kind, actions: [] as Array<unknown> }
          batches.push(next)
          return next.actions
        }
        for (const event of events) {
          switch (event._tag) {
            case "Mouse": {
              const actions = batch("pointer")
              const button = buttons[event.button] ?? 0
              if (event.type === "move") {
                actions.push({ type: "pointerMove", x: Math.round(event.x - dx), y: Math.round(event.y - dy) })
              } else {
                actions.push({ type: "pointerMove", x: Math.round(event.x - dx), y: Math.round(event.y - dy) })
                actions.push({ type: event.type === "down" ? "pointerDown" : "pointerUp", button })
              }
              break
            }
            case "Wheel":
              batch("wheel").push({
                type: "scroll",
                x: Math.round(event.x - dx),
                y: Math.round(event.y - dy),
                deltaX: Math.round(event.deltaX),
                deltaY: Math.round(event.deltaY)
              })
              break
            case "Key":
              // WebDriver BiDi sends a key as its value alone: it has no AltGr or dead key, and the character a
              // layout's strokes type is sent as itself
              if (event.key === "AltGraph" || event.key === "Dead") break
              batch("key").push({
                type: event.type === "down" ? "keyDown" : "keyUp",
                value: Redacted.make(keyValue(event.key))
              })
              break
            case "InsertText":
              for (const character of event.text) {
                batch("key").push(
                  { type: "keyDown", value: Redacted.make(character) },
                  { type: "keyUp", value: Redacted.make(character) }
                )
              }
              break
            case "Touch": {
              const actions = batch("touch")
              for (const point of event.points) {
                if (event.type === "move" || event.type === "start") {
                  actions.push({ type: "pointerMove", x: Math.round(point.x - dx), y: Math.round(point.y - dy) })
                }
                if (event.type === "start") actions.push({ type: "pointerDown", button: 0 })
                if (event.type === "end" || event.type === "cancel") actions.push({ type: "pointerUp", button: 0 })
              }
              break
            }
          }
        }
        for (const { actions, kind } of batches) {
          const source = kind === "pointer"
            ? { type: "pointer", id: "strider-mouse", parameters: { pointerType: "mouse" }, actions }
            : kind === "touch"
            ? { type: "pointer", id: "strider-touch", parameters: { pointerType: "touch" }, actions }
            : kind === "wheel"
            ? { type: "wheel", id: "strider-wheel", actions }
            : { type: "key", id: "strider-keyboard", actions }
          yield* protocol(
            Input.performActions({ context, actions: [source] } as Input.PerformActionsParameters).pipe(on)
          )
        }
      }
    )

    const resolve = Effect.fnUntraced(function*(id: Adapter.ObligationId, decision: Adapter.Decision) {
      const obligation = obligations.get(id)
      if (obligation === undefined) return yield* Effect.fail(foreign(id))
      switch (obligation._tag) {
        case "PausedRequest": {
          const request = obligation.request as Network.Request
          const send = (() => {
            switch (decision._tag) {
              case "Continue": {
                const overrides = Option.getOrUndefined(decision.overrides)
                if (obligation.phase === "response") {
                  return overrides === undefined
                    ? Network.continueResponse({ request }).pipe(on)
                    : Network.continueResponse({
                      request,
                      ...(overrides.headers === undefined ? {} : { headers: bidiHeaders(overrides.headers) })
                    }).pipe(on)
                }
                // Firefox aborts a request continued with a new URL
                if (overrides?.url !== undefined) {
                  return Effect.fail(
                    new Protocol.ProtocolError({
                      reason: new Protocol.Unsupported({ method: "interception.continueUrl" })
                    })
                  )
                }
                // Firefox keeps the old Content-Length with a new body, which breaks the request
                const headers = overrides?.body === undefined
                  ? overrides?.headers === undefined ? undefined : bidiHeaders(overrides.headers)
                  : [
                    ...(overrides.headers === undefined ? obligation.headers : bidiHeaders(overrides.headers)).filter((
                      header
                    ) => header.name.toLowerCase() !== "content-length"),
                    { name: "content-length", value: { type: "string", value: String(overrides.body.length) } }
                  ]
                return Network.continueRequest({
                  request,
                  ...(overrides?.method === undefined ? {} : { method: overrides.method }),
                  ...(headers === undefined ? {} : { headers }),
                  ...(overrides?.body === undefined ? {} : { body: { type: "base64", value: base64(overrides.body) } })
                } as Network.ContinueRequestParameters).pipe(on)
              }
              case "ContinueResponse":
                return Network.continueResponse({
                  request,
                  ...(Option.isSome(decision.status) ? { statusCode: decision.status.value } : {}),
                  ...(Option.isSome(decision.headers) ? { headers: bidiHeaders(decision.headers.value) } : {})
                } as Network.ContinueResponseParameters).pipe(on)
              case "Fulfill": {
                // Firefox has no fulfill at the response phase, and leaves a refused one paused
                if (obligation.phase === "response") {
                  return Effect.fail(
                    new Protocol.ProtocolError({
                      reason: new Protocol.Unsupported({ method: "interception.responseFulfill" })
                    })
                  )
                }
                // Firefox reports what a route made as an ordinary response
                const entry = requests.get(obligation.request)
                if (entry !== undefined) entry.fulfilled = true
                return Network.provideResponse({
                  request,
                  statusCode: decision.status,
                  headers: bidiHeaders(decision.headers),
                  body: { type: "base64", value: base64(decision.body) }
                } as Network.ProvideResponseParameters).pipe(on)
              }
              case "Fail":
                // WebDriver BiDi has one failure for every reason
                return decision.error === "failed"
                  ? Network.failRequest({ request }).pipe(on)
                  : Effect.fail(
                    new Protocol.ProtocolError({
                      reason: new Protocol.Unsupported({ method: "interception.abortReason" })
                    })
                  )
              case "ProvideCredentials":
                return Network.continueWithAuth({
                  request,
                  action: "provideCredentials",
                  credentials: {
                    type: "password",
                    username: decision.username,
                    password: Redacted.make(decision.password)
                  }
                } as Network.ContinueWithAuthParameters).pipe(on)
              case "DefaultAuth":
              case "CancelAuth":
                return Network.continueWithAuth({
                  request,
                  action: decision._tag === "DefaultAuth" ? "default" : "cancel"
                } as Network.ContinueWithAuthParameters).pipe(on)
              default:
                return Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Unsupported({ method: `resolve ${decision._tag}` })
                  })
                )
            }
          })()
          yield* protocol(send)
          obligations.delete(id)
          // A request's collected body is kept until it is given up
          for (const collector of requestCollectors.values()) {
            yield* Network.disownData({ dataType: "request", collector, request } as Network.DisownDataParameters).pipe(
              on,
              Effect.ignore,
              Effect.forkDetach
            )
          }
          yield* run(() =>
            emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "bidi:network" })
          )
          return
        }
        case "Prompt": {
          if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
            return yield* Effect.fail(unsupported(decision._tag, "A prompt is accepted or dismissed"))
          }
          yield* protocol(
            BrowsingContext.handleUserPrompt({
              context: obligation.context as BrowsingContext.BrowsingContext,
              accept: decision._tag === "Accept",
              ...(decision._tag === "Accept" && Option.isSome(decision.promptText)
                ? { userText: decision.promptText.value }
                : {})
            }).pipe(on)
          )
          return
        }
        case "FileChooser": {
          obligations.delete(id)
          if (decision._tag === "SetFiles" && obligation.element !== undefined) {
            yield* protocol(
              Input.setFiles({
                context: obligation.context as BrowsingContext.BrowsingContext,
                element: { sharedId: obligation.element as Script.SharedId },
                files: [...decision.files]
              } as Input.SetFilesParameters).pipe(on)
            )
          }
          yield* run(() =>
            emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "bidi:input.setFiles" })
          )
          return
        }
      }
    })

    // ── Declarations ──

    // Preload scripts are registered for the scopes in order, environment phase first and broader scopes first;
    // any change registers them all again, which only affects documents created after it.
    let preloads: Array<string> = []
    /** Where a document's preload scripts keep which of them ran. */
    const ranKey = "@usestrider/browser/initScripts/ran"

    const applyScripts = Effect.fnUntraced(function*() {
      const entries = registry.all()
        .filter((
          entry
        ): entry is Declarations.Registered & { declaration: Extract<Adapter.Declaration, { _tag: "InitScript" }> } =>
          entry.declaration._tag === "InitScript"
        )
        .sort((a, b) =>
          (a.declaration.phase === b.declaration.phase ? 0 : a.declaration.phase === "environment" ? -1 : 1) ||
          (a.scope._tag === b.scope._tag
            ? 0
            : a.scope._tag === "Browser"
            ? -1
            : b.scope._tag === "Browser"
            ? 1
            : a.scope._tag === "UserContext"
            ? -1
            : 1) ||
          a.sequence - b.sequence
        )
      const previous = preloads
      const next: Array<string> = []
      for (const entry of entries) {
        // Each script is a preload of its own, so what ran is kept where the next can look: a script runs only
        // after what it comes after ran without throwing
        const ran = `(globalThis[Symbol.for(${JSON.stringify(ranKey)})] ??= new Set())`
        const body = `try { ${entry.declaration.source}\n;${ran}.add(${JSON.stringify(entry.id)}) } catch (error) { ` +
          `typeof reportError === "function" ? reportError(error) : console.error(error) }`
        const gated = entry.declaration.after.length === 0
          ? body
          : `if (${JSON.stringify(entry.declaration.after)}.every((id) => ${ran}.has(id))) { ${body} }`
        const { script } = yield* Script.addPreloadScript({
          functionDeclaration: `() => { ${gated} }`,
          ...(entry.declaration.world._tag === "Isolated" ? { sandbox: entry.declaration.world.name } : {}),
          ...scopeParams(entry.scope)
        } as Script.AddPreloadScriptParameters).pipe(on)
        next.push(script)
      }
      preloads = next
      yield* Effect.forEach(
        previous,
        (script) => Script.removePreloadScript({ script: script as Script.PreloadScript }).pipe(on, Effect.ignore),
        { discard: true }
      )
    })

    // Sets the value a scope declares for one kind of override, or clears it; BiDi layers scopes itself.
    const applyKind = (
      kind: Adapter.Override["_tag"],
      scope: Adapter.DeclarationScope
    ): Effect.Effect<void, Protocol.ProtocolError> => {
      const latest = registry.all()
        .filter((entry) =>
          entry.declaration._tag === "Override" && entry.declaration.override._tag === kind &&
          JSON.stringify(entry.scope) === JSON.stringify(scope)
        )
        .at(-1)
      const override = latest?.declaration._tag === "Override" ? latest.declaration.override : undefined
      const where = scopeParams(scope)
      switch (kind) {
        case "Viewport": {
          const viewport = override?._tag === "Viewport" ? { width: override.width, height: override.height } : null
          const ratio = override?._tag === "Viewport" ? override.deviceScaleFactor : null
          const targets = scope._tag === "Page"
            ? [{ context: navigablesById.get(scope.page)?.bidi }]
            : scope._tag === "UserContext"
            ? [where]
            : [{ userContexts: [...contexts.values()].map((context) => context.bidi) }]
          return Effect.forEach(
            targets,
            (target) =>
              BrowsingContext.setViewport(
                { ...target, viewport, devicePixelRatio: ratio } as BrowsingContext.SetViewportParameters
              ).pipe(on),
            { discard: true }
          )
        }
        case "UserAgent":
          return Emulation.setUserAgentOverride(
            {
              userAgent: override?._tag === "UserAgent" ? override.userAgent : null,
              ...where
            } as Emulation.SetUserAgentOverrideParameters
          ).pipe(on)
        case "Locale":
          return Emulation.setLocaleOverride(
            {
              locale: override?._tag === "Locale" ? override.locale : null,
              ...where
            } as Emulation.SetLocaleOverrideParameters
          ).pipe(on)
        case "TimeZone":
          return Emulation.setTimezoneOverride(
            {
              timezone: override?._tag === "TimeZone" ? override.timeZone : null,
              ...where
            } as Emulation.SetTimezoneOverrideParameters
          ).pipe(on)
        case "Geolocation":
          return Emulation.setGeolocationOverride(
            (override?._tag === "Geolocation"
              ? Option.match(override.position, {
                onNone: () => ({ error: { type: "positionUnavailable" }, ...where }),
                onSome: (position) => ({ coordinates: position, ...where })
              })
              : { coordinates: null, ...where }) as Emulation.SetGeolocationOverrideParameters
          ).pipe(on)
        case "Media":
          return Emulation.setMediaFeaturesOverride({
            features: override?._tag === "Media" ? override.features : null,
            ...where
          } as unknown as Emulation.SetMediaFeaturesOverrideParameters).pipe(on)
        case "Offline":
          return Emulation.setNetworkConditions({
            networkConditions: override?._tag === "Offline" && override.offline ? { type: "offline" } : null,
            ...where
          } as Emulation.SetNetworkConditionsParameters).pipe(on)
        case "ExtraHeaders":
          return Network.setExtraHeaders({
            headers: override?._tag === "ExtraHeaders" ? bidiHeaders(override.headers) : [],
            ...where
          } as Network.SetExtraHeadersParameters).pipe(on)
        case "JavaScriptEnabled":
          return Emulation.setScriptingEnabled(
            {
              enabled: override?._tag === "JavaScriptEnabled" && !override.enabled ? false : null,
              ...where
            } as Emulation.SetScriptingEnabledParameters
          ).pipe(on)
        case "BypassCsp":
          return BrowsingContext.setBypassCSP(
            {
              bypass: override?._tag === "BypassCsp" && override.enabled ? true : null,
              ...where
            } as BrowsingContext.SetBypassCSPParameters
          ).pipe(on)
        case "Touch":
          return Emulation.setTouchOverride(
            {
              maxTouchPoints: override?._tag === "Touch" && override.enabled ? override.maxTouchPoints : null,
              ...where
            } as Emulation.SetTouchOverrideParameters
          ).pipe(on)
        case "CacheDisabled":
          return Network.setCacheBehavior({
            cacheBehavior: override?._tag === "CacheDisabled" && override.disabled ? "bypass" : "default",
            ...(scope._tag === "Page" ? { contexts: where.contexts } : {})
          } as unknown as Network.SetCacheBehaviorParameters).pipe(on)
        case "FocusEmulation":
          return override === undefined
            ? Effect.void
            : Effect.fail(
              new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: "FocusEmulation" }) })
            )
        case "NetworkConditions":
        case "CpuThrottling":
          // Refused when declared
          return Effect.void
      }
    }

    const addIntercept = Effect.fnUntraced(function*(
      registration: Adapter.RegistrationId,
      scope: Adapter.DeclarationScope,
      declaration: Extract<Adapter.Declaration, { _tag: "Intercept" }>
    ) {
      const patterns = declaration.patterns.map(coveringPattern)
      const { intercept } = yield* Network.addIntercept({
        phases: declaration.phases.map((phase) =>
          phase === "request" ? "beforeRequestSent" : phase === "response" ? "responseStarted" : "authRequired"
        ),
        ...(patterns.length > 0 && patterns.every((pattern) => pattern !== undefined) ? { urlPatterns: patterns } : {}),
        ...(scope._tag === "Page" ? { contexts: [navigablesById.get(scope.page)?.bidi] } : {})
      } as unknown as Network.AddInterceptParameters).pipe(on)
      intercepts.set(registration, {
        registration,
        bidi: intercept,
        scope,
        globs: declaration.patterns.map(globRegExp),
        phases: declaration.phases
      })
    })

    const collectors = new Map<Adapter.RegistrationId, string>()
    /** A request data collector for each intercept with a request phase, so a route can read a body. */
    const requestCollectors = new Map<Adapter.RegistrationId, Network.Collector>()

    /** What Firefox can't do, refused before anything is declared. */
    const refusal = (declaration: Adapter.Declaration): Adapter.AdapterError | undefined => {
      if (declaration._tag !== "Override") return undefined
      const override = declaration.override
      switch (override._tag) {
        case "Viewport":
          return override.mobile
            ? unsupported("emulation.viewport.mobile", "WebDriver BiDi has no mobile viewport")
            : undefined
        case "Geolocation":
          return Option.isNone(override.position)
            ? unsupported("emulation.geolocation.unavailable", "Firefox rejects an unavailable position")
            : undefined
        // Firefox 158 doesn't implement these commands: refused under the capability that says so
        case "Media":
          return unsupported("emulation.media", "Firefox doesn't implement emulation.setMediaFeaturesOverride")
        case "Touch":
          return unsupported("emulation.touch", "Firefox doesn't implement emulation.setTouchOverride")
        case "JavaScriptEnabled":
          return override.enabled
            ? undefined
            : unsupported("emulation.javaScript", "Firefox doesn't implement emulation.setScriptingEnabled")
        case "FocusEmulation":
          return unsupported("emulation.focus", "WebDriver BiDi has no focus emulation")
        case "NetworkConditions":
          return unsupported("emulation.network.throttling", "WebDriver BiDi can only take a page offline")
        case "CpuThrottling":
          return unsupported("emulation.cpuSlowdown", "WebDriver BiDi has no CPU throttling")
        default:
          return undefined
      }
    }

    const declare = Effect.fnUntraced(function*(scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
      const refused = refusal(declaration)
      if (refused !== undefined) return yield* Effect.fail(refused)
      const id = ids.registration()
      registry.add(scope, declaration, id)
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          registry.remove(id)
          switch (declaration._tag) {
            case "InitScript":
              return applyScripts().pipe(Effect.ignore)
            case "Override":
              return applyKind(declaration.override._tag, scope).pipe(Effect.ignore)
            case "Intercept":
            case "Challenges": {
              const intercept = intercepts.get(id)
              intercepts.delete(id)
              const collector = requestCollectors.get(id)
              requestCollectors.delete(id)
              return Effect.all([
                intercept === undefined
                  ? Effect.void
                  : Network.removeIntercept({ intercept: intercept.bidi as Network.Intercept }).pipe(on, Effect.ignore),
                collector === undefined
                  ? Effect.void
                  : Network.removeDataCollector({ collector }).pipe(on, Effect.ignore)
              ], { discard: true })
            }
            case "BodyCollection": {
              const collector = collectors.get(id)
              collectors.delete(id)
              return collector === undefined
                ? Effect.void
                : Network.removeDataCollector({ collector: collector as Network.Collector }).pipe(on, Effect.ignore)
            }
            case "Downloads":
              return applyDownloads(scope).pipe(Effect.ignore)
            case "FileChooser":
              return Effect.void
          }
        })
      )
      switch (declaration._tag) {
        case "InitScript":
          yield* protocol(applyScripts())
          break
        case "Override":
          yield* protocol(applyKind(declaration.override._tag, scope))
          break
        case "Intercept":
          if (declaration.phases.includes("request")) {
            const { collector } = yield* protocol(
              Network.addDataCollector({
                dataTypes: ["request"],
                maxEncodedDataSize: 10 * 1024 * 1024,
                ...scopeParams(scope)
              } as Network.AddDataCollectorParameters).pipe(on)
            )
            requestCollectors.set(id, collector)
          }
          yield* protocol(addIntercept(id, scope, declaration))
          break
        case "Challenges":
          // An intercept at the challenge alone, for every URL, which pauses nothing else. WebDriver BiDi can't
          // scope one to a user context, so a context's is the session's, and a challenge in another context
          // goes on as the browser answers it
          yield* protocol(addIntercept(id, scope, { _tag: "Intercept", patterns: [], phases: ["auth"] }))
          break
        case "BodyCollection": {
          const { collector } = yield* protocol(
            Network.addDataCollector({
              dataTypes: [...declaration.bodies],
              maxEncodedDataSize: declaration.maxBytes,
              ...scopeParams(scope)
            } as Network.AddDataCollectorParameters).pipe(on)
          )
          collectors.set(id, collector)
          break
        }
        case "Downloads":
          yield* protocol(applyDownloads(scope))
          break
        case "FileChooser":
          // File dialogs are always reported, and dismissed so none stays open (unhandledPromptBehavior.file is
          // "dismiss"): the page sees `cancel` before the decision, and files set after it
          // still arrive
          break
      }
      return id
    })

    // An iframe's window proxy names its browsing context, which is the frame
    const contentFrame = Effect.fnUntraced(function*(node: Adapter.NodeBinding) {
      const document = [...navigablesById.values()].find((each) => each.document?.id === node.document)
      if (document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      const reply = yield* protocol(
        Script.callFunction({
          functionDeclaration: "(element) => element.contentWindow",
          target: { context: document.bidi, sandbox: "__strider_utility__" },
          arguments: [{ sharedId: node.binding }],
          awaitPromise: false,
          resultOwnership: "none"
        } as unknown as Script.CallFunctionParameters).pipe(on)
      )
      const result = reply as unknown as { type: string; result?: { type: string; value?: { context?: string } } }
      const context = result.type === "success" && result.result?.type === "window"
        ? result.result.value?.context
        : undefined
      const frame = context === undefined ? undefined : navigableOf(context)
      return Option.fromUndefinedOr(frame?.id)
    })

    const pausedRequestBody = Effect.fnUntraced(function*(id: Adapter.ObligationId) {
      const obligation = obligations.get(id)
      if (obligation?._tag !== "PausedRequest") return yield* Effect.fail(foreign(id))
      const data = yield* Network.getData(
        { dataType: "request", request: obligation.request } as Network.GetDataParameters
      )
        .pipe(
          on,
          Effect.map((result) => Option.some(result.bytes)),
          // A request without a body has no data to give
          Effect.catchIf(
            (error) =>
              error.reason._tag === "Rejected" &&
              /(no such|unavailable) network data|network data .* not found/i.test(error.message),
            () => Effect.succeedNone
          ),
          Effect.mapError(Adapter.protocolError)
        )
      return Option.map(
        data,
        (bytes) => bytes.type === "base64" ? fromBase64(bytes.value) : new TextEncoder().encode(bytes.value)
      )
    })

    const pausedResponseBody = (_id: Adapter.ObligationId) =>
      Effect.fail(
        unsupported("interception.responseBody", "WebDriver BiDi has no body for a response paused as it starts")
      )

    // A WebM file Firefox writes where the context downloads to, which a launched browser shares with the program
    const video = Effect.fnUntraced(function*(id: L1Target.NavigableId) {
      const navigable = yield* navigableById(id)
      if (options.ownership !== "launched") {
        return yield* Effect.fail(
          unsupported("capability.video", "Firefox writes the file on its own host, out of the program's reach")
        )
      }
      const behavior = registry.downloads(navigable.context.id)
      if (behavior === undefined || behavior._tag === "Deny") {
        return yield* Effect.fail(unsupported(
          "capability.video",
          behavior === undefined
            ? "The page's context declares no downloads directory, where the file would go"
            : "The page's context denies downloads, and the file would go where they do"
        ))
      }
      const started = yield* protocol(
        BrowsingContext.startScreencast({
          context: navigable.bidi as BrowsingContext.BrowsingContext,
          destinationFolder: behavior.directory
        }).pipe(on)
      )
      const written = Deferred.makeUnsafe<string, Adapter.AdapterError>()
      yield* Effect.addFinalizer(() =>
        protocol(BrowsingContext.stopScreencast({ screencast: started.screencast }).pipe(on)).pipe(
          Effect.map((stopped) => stopped.path),
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(written, exit))
        )
      )
      return Deferred.await(written)
    })

    const applyDownloads = (scope: Adapter.DeclarationScope) => {
      const context = scope._tag === "UserContext" ? scope.context : defaultContext
      const behavior = registry.downloads(context)
      return BrowserBidi.setDownloadBehavior({
        downloadBehavior: behavior === undefined
          ? null
          : behavior._tag === "Allow"
          ? { type: "allowed", destinationFolder: behavior.directory }
          : { type: "denied" },
        ...(scope._tag === "UserContext" ? scopeParams(scope) : {})
      } as BrowserBidi.SetDownloadBehaviorParameters).pipe(on)
    }

    const screenshot = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: Adapter.ScreenshotOptions) {
      const navigable = yield* navigableById(id)
      if (options.scale === "css") {
        return yield* Effect.fail(unsupported("screenshot.cssScale", "WebDriver BiDi captures device pixels only"))
      }
      if (options.omitBackground) {
        return yield* Effect.fail(unsupported("screenshot.omitBackground", "WebDriver BiDi has no background override"))
      }
      const clip = Option.getOrUndefined(options.clip)
      let origin: "document" | "viewport" = options.fullPage || clip !== undefined ? "document" : "viewport"
      let box = clip
      if (clip !== undefined && !options.fullPage) {
        // Firefox refuses a document clip beyond the root element's box, as on a short page in quirks mode, so a
        // clip inside the viewport is taken from the viewport, offset by the scroll position (QUIRKS.md, Q114)
        const view = yield* Script.evaluate({
          expression: "JSON.stringify([scrollX, scrollY, innerWidth, innerHeight])",
          target: { context: navigable.bidi as BrowsingContext.BrowsingContext, sandbox: "__strider_utility__" },
          awaitPromise: false
        } as Script.EvaluateParameters).pipe(
          on,
          Effect.map((result) =>
            result.type === "success" && result.result.type === "string"
              ? JSON.parse(String(result.result.value)) as [number, number, number, number]
              : undefined
          ),
          Effect.orElseSucceed(() => undefined)
        )
        if (view !== undefined) {
          const [x, y, width, height] = view
          if (clip.x >= x && clip.y >= y && clip.x + clip.width <= x + width && clip.y + clip.height <= y + height) {
            origin = "viewport"
            box = { ...clip, x: clip.x - x, y: clip.y - y }
          }
        }
      }
      const { data } = yield* protocol(
        BrowsingContext.captureScreenshot({
          context: navigable.bidi as BrowsingContext.BrowsingContext,
          origin,
          format: {
            type: `image/${options.format}`,
            ...(Option.isSome(options.quality) ? { quality: options.quality.value / 100 } : {})
          },
          ...(box === undefined ? {} : { clip: { type: "box", ...box } })
        } as BrowsingContext.CaptureScreenshotParameters).pipe(on)
      )
      return fromBase64(data)
    })

    const pdf = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: Adapter.PdfOptions) {
      const navigable = yield* navigableById(id)
      if (Option.isSome(options.header) || Option.isSome(options.footer)) {
        return yield* Effect.fail(unsupported("pdf.headerFooter", "WebDriver BiDi prints no header or footer"))
      }
      if (options.preferCssPageSize) {
        return yield* Effect.fail(unsupported("pdf.preferCssPageSize", "WebDriver BiDi prints at the size it is given"))
      }
      const cm = (inches: number) => inches * 2.54
      const { data } = yield* protocol(
        BrowsingContext.print({
          context: navigable.bidi as BrowsingContext.BrowsingContext,
          orientation: options.landscape ? "landscape" : "portrait",
          background: options.printBackground,
          scale: options.scale,
          page: { width: cm(options.paperWidth), height: cm(options.paperHeight) },
          margin: {
            top: cm(options.margins.top),
            bottom: cm(options.margins.bottom),
            left: cm(options.margins.left),
            right: cm(options.margins.right)
          },
          ...(Option.isSome(options.pageRanges) ? { pageRanges: options.pageRanges.value.split(",") } : {})
        } as BrowsingContext.PrintParameters).pipe(on)
      )
      return fromBase64(data)
    })

    const partition = (context: ContextEntry) => ({ type: "storageKey", userContext: context.bidi })

    const cookies = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      const { cookies } = yield* protocol(
        Storage.getCookies({ partition: partition(context) } as Storage.GetCookiesParameters).pipe(on)
      )
      return cookies.map((cookie): Adapter.Cookie => ({
        name: cookie.name,
        value: Redacted.make(bytesText(Redacted.value(cookie.value))),
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expiry === undefined ? Option.none() : Option.some(cookie.expiry),
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === "strict"
          ? Option.some("Strict" as const)
          : cookie.sameSite === "lax"
          ? Option.some("Lax" as const)
          : cookie.sameSite === "none"
          ? Option.some("None" as const)
          : Option.none(),
        partitionKey: Option.none(),
        priority: Option.none()
      }))
    })

    const setCookies = Effect.fnUntraced(function*(id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
      const context = yield* contextOf(id)
      if (list.some((cookie) => Option.isSome(cookie.partitionKey))) {
        return yield* Effect.fail(
          unsupported("cookies.partitioned", "Firefox doesn't say which partition a cookie is in")
        )
      }
      yield* protocol(Effect.forEach(list, (cookie) =>
        Storage.setCookie({
          cookie: {
            name: cookie.name,
            value: Redacted.make({ type: "string", value: Redacted.value(cookie.value) }),
            domain: cookie.domain,
            path: cookie.path,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            ...(Option.isSome(cookie.sameSite) ? { sameSite: cookie.sameSite.value.toLowerCase() } : {}),
            ...(Option.isSome(cookie.expires) ? { expiry: Math.round(cookie.expires.value) } : {})
          },
          partition: partition(context)
        } as Storage.SetCookieParameters).pipe(on), { discard: true }))
    })

    const clearCookies = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      yield* protocol(
        Storage.deleteCookies({ partition: partition(context) } as Storage.DeleteCookiesParameters).pipe(on)
      )
    })

    // BiDi has no reset, so grants are remembered and set back to "prompt"
    const granted = new Map<UserContext.Id, Set<string>>()

    const setPermission = (context: ContextEntry, origin: string, name: string, state: "granted" | "prompt") =>
      Permissions.setPermission({
        descriptor: { name },
        state,
        origin,
        ...(context.bidi === "default" ? {} : { userContext: context.bidi })
      }).pipe(on)

    const grantPermissions = Effect.fnUntraced(function*(
      id: UserContext.Id,
      origin: Option.Option<string>,
      permissions: ReadonlyArray<string>
    ) {
      const context = yield* contextOf(id)
      if (Option.isNone(origin)) {
        return yield* Effect.fail(
          unsupported("permissions.anyOrigin", "WebDriver BiDi grants a permission to one origin")
        )
      }
      for (const name of permissions) {
        yield* protocol(setPermission(context, origin.value, name, "granted"))
        const set = granted.get(id) ?? new Set()
        set.add(JSON.stringify([origin.value, name]))
        granted.set(id, set)
      }
    })

    const resetPermissions = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      for (const entry of granted.get(id) ?? []) {
        const [origin, name] = JSON.parse(entry) as [string, string]
        yield* protocol(setPermission(context, origin, name, "prompt"))
      }
      granted.delete(id)
    })

    const responseBody = Effect.fnUntraced(function*(hop: NetworkRequest.HopId) {
      const request = hops.get(hop)
      if (request === undefined) return yield* Effect.fail(foreign(hop))
      if (request.hop !== hop) {
        return yield* Effect.fail(unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
      }
      yield* Deferred.await(request.finished).pipe(
        Effect.mapError((error) => unsupported("body.failed", `The request failed (${error}), so it has no body`))
      )
      const { bytes } = yield* Network.getData({ dataType: "response", request: request.bidi as Network.Request }).pipe(
        on,
        Effect.mapError((error) =>
          error.reason._tag === "Rejected"
            ? unsupported(
              "body.notCollected",
              "Declare BodyCollection before the request starts; BiDi keeps no body otherwise"
            )
            : protocolError(error)
        )
      )
      return bytes.type === "base64" ? fromBase64(bytes.value) : new TextEncoder().encode(bytes.value)
    })

    const requestBody = Effect.fnUntraced(function*(hop: NetworkRequest.HopId) {
      const request = hops.get(hop)
      if (request === undefined) return yield* Effect.fail(foreign(hop))
      const size = request.bodySizes[ids.redirectsOf(hop)]
      if (size === 0) return Option.none<Uint8Array>()
      const { bytes } = yield* Network.getData({ dataType: "request", request: request.bidi as Network.Request }).pipe(
        on,
        Effect.mapError((error) =>
          error.reason._tag === "Rejected"
            ? unsupported(
              "body.notCollected",
              "Declare BodyCollection before the request starts; BiDi keeps no body otherwise"
            )
            : protocolError(error)
        )
      )
      return Option.some(bytes.type === "base64" ? fromBase64(bytes.value) : new TextEncoder().encode(bytes.value))
    })

    const setInputFiles = Effect.fnUntraced(function*(node: Adapter.NodeBinding, files: ReadonlyArray<string>) {
      const document = documents.get(node.document)
      if (document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      yield* protocol(
        Input.setFiles({
          context: document.navigable.bidi as BrowsingContext.BrowsingContext,
          element: { sharedId: node.binding as Script.SharedId },
          files: [...files]
        } as Input.SetFilesParameters).pipe(on)
      )
    })

    return {
      info,
      capabilities: capabilitySet,
      pauseScope: "context",
      defaultContext,
      closed: client.closed,
      createUserContext,
      removeUserContext,
      createPage,
      closePage,
      activatePage: (id) =>
        navigableById(id).pipe(
          Effect.flatMap((navigable) =>
            protocol(BrowsingContext.activate({ context: navigable.bidi as BrowsingContext.BrowsingContext }).pipe(on))
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
      pdf,
      accessibilityTree: () =>
        Effect.fail(unsupported("capability.axTree", "WebDriver BiDi has no accessibility tree")),
      screencast: () =>
        Effect.fail(
          unsupported(
            "capability.screencast",
            "Firefox's browsingContext.startScreencast records a WebM file on the browser's host, and streams no frames"
          )
        ),
      video,
      cookies,
      setCookies,
      clearCookies,
      grantPermissions,
      resetPermissions,
      responseBody,
      contentFrame,
      requestBody,
      pausedRequestBody,
      pausedResponseBody,
      setInputFiles,
      downloadPath: (id) =>
        Effect.suspend(() => {
          const download = downloadsById.get(id)
          return download === undefined
            ? Effect.fail(foreign(id))
            : Effect.succeed(Option.fromUndefinedOr(download.path))
        }),
      cancelDownload: (id) =>
        Effect.suspend(() =>
          downloadsById.has(id)
            ? Effect.fail(unsupported("downloads.cancel", "WebDriver BiDi has no command to cancel a download"))
            : Effect.fail(foreign(id))
        )
    } satisfies Adapter.AdapterConnection
  }
)
