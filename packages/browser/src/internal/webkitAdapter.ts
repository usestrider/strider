/**
 * The WebKit backend adapter, for stock WebKit (PROTOCOL.md, Backend adapters). It keeps the
 * correlation tables from WebKit's ids to L1's, folds WebKit's events into facts, configures every new target
 * before its scripts run, and carries out L1's operations. Attached, it looks through a browser's remote
 * inspector (`webkitStockTransport.ts`); launched, WebKit's Automation protocol drives it as well
 * (`webkitAutomation.ts`).
 *
 * - **Pages are page proxies.** The transport presents each page as one, in our envelope (`webkitEnvelope.ts`):
 *   it outlives navigations. Its inspector target is the page in a web process, which a cross-site navigation
 *   replaces: the new target is provisional until `Target.didCommitProvisionalTarget`, and its main frame has a new
 *   frame id, which this adapter maps onto the same navigable. Loader ids survive the swap, so a navigation is
 *   followed across it.
 * - **The gate.** A target starts paused once its page asks (`Target.setPauseOnStart`). While it is, the adapter
 *   enables `Page`, `Network`, `Console` and `Worker`, takes the resource tree (the snapshot the session is synced
 *   with), enables `Runtime`, applies the declarations in force, and resumes it with `Target.resume`, in a
 *   finalizer. A worker waits the same way until `Worker.initialized`.
 * - **Realms** are execution contexts, of the page's world only: stock WebKit's inspector makes no other
 *   (QUIRKS.md, Q194). WebKit never says one is destroyed: a document's realms end when another document commits in
 *   its frame, when the frame goes, or with their target.
 * - **Evaluation** runs through a helper installed in each realm (`webkitUtility.ts`), because WebKit calls
 *   functions only on objects and serializes only JSON. The helper returns WebDriver BiDi's `RemoteValue`.
 * - **Readiness.** WebKit can report a document's `load` before its `DOMContentLoaded`; a document is reported
 *   interactive, then complete, whichever arrives first. A complete document that loads again was reopened
 *   (`document.open()`), which WebKit reports no other way, so it starts a new generation.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Browser from "../Browser.ts"
import * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Dialog from "../Dialog.ts"
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
import * as Automation from "../webkit-automation-protocol/Automation.ts"
import * as Console from "../webkit-stock-protocol/Console.ts"
import * as Network from "../webkit-stock-protocol/Network.ts"
import * as Page from "../webkit-stock-protocol/Page.ts"
import * as Runtime from "../webkit-stock-protocol/Runtime.ts"
import * as Target from "../webkit-stock-protocol/Target.ts"
import * as Worker from "../webkit-stock-protocol/Worker.ts"
import * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as ConsoleFormat from "./consoleFormat.ts"
import * as Declarations from "./declarations.ts"
import * as Launch from "./launch.ts"
import * as Groups from "./objectGroups.ts"
import * as ProtocolClient from "./protocolClient.ts"
import * as Retired from "./retired.ts"
import type * as WebKitAutomation from "./webkitAutomation.ts"
import * as Envelope from "./webkitEnvelope.ts"
import * as Utility from "./webkitUtility.ts"
import * as WebKitWire from "./webkitWire.ts"

// ── Tables ────────────────────────────────────────────────────────────────────────────────────────────────

interface ContextEntry {
  readonly id: UserContext.Id
  /** WebKit's id; the default context's too, once a page in it reports it. */
  browserContextId: string | undefined
  readonly isDefault: boolean
  removing: boolean
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
  /** Whether its response asked to be saved, `Content-Disposition: attachment`. */
  attachment: boolean
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

type ObligationEntry =
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

interface HandleEntry {
  readonly session: ProtocolClient.Session
  readonly objectId: string
  /** The object group it was made in (Q132). */
  readonly group: string | undefined
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

/** A console argument, for the Console Standard's formatter (QUIRKS.md, Q33). */
const argumentOf = (value: Runtime.RemoteObject): ConsoleFormat.Argument => ({
  text: textOf(value),
  value: value.type === "string" || value.type === "number" ? value.value as string | number | undefined : undefined,
  string: value.type === "string"
})

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

/** The events the fold needs: the envelope's, and stock WebKit's inspector's. */
const events: ReadonlyArray<Protocol.EventDef<string, any>> = [
  Envelope.pageProxyCreated,
  Target.targetCreated,
  Target.didCommitProvisionalTarget,
  Page.frameDetached,
  Page.frameNavigated,
  Page.domContentEventFired,
  Page.loadEventFired,
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

/**
 * Stock WebKit's, attached: what its remote inspector serves. It has no `Input`, `Dialog`,
 * `Emulation` or `Screencast` domain, no navigate command, no worlds of its own and no `DOM.describeNode`, and no
 * events for a frame's attachment, a same-document navigation, a file chooser or a download.
 */
export const attachedCapabilities = (info: Browser.Info) => {
  const evidence = `WebKit adapter, attached, ${info.product} ${info.revision}`
  const noInput = "stock WebKit's inspector protocol has no Input domain"
  const noEmulation = "stock WebKit's inspector has no Emulation domain"
  const noDownloads = "stock WebKit's inspector reports no downloads"
  const noPdf = "WebKit has no print-to-PDF"
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("userContexts", "unsupported", [
        "stock WebKit's inspector makes no contexts or pages: the browser's own are observed"
      ]),
      entry("isolatedWorlds", "unsupported", [
        "stock WebKit's inspector makes no worlds, so Strider's engine runs in the page's own"
      ]),
      entry("pauseOnStart.frames", "supported", ["frames run in their page's process, which is paused"]),
      entry("pauseOnStart.workers", "supported"),
      entry("pauseOnStart.popups", "unsupported", [
        "a page the browser opens is found by reading the inspector's list"
      ]),
      entry("initScripts.workers", "supported", ["dedicated workers started after the script was declared"]),
      entry("input.native", "unsupported", [noInput]),
      entry("input.keyboardLayout", "unsupported", [noInput]),
      entry("input.insertText", "unsupported", [noInput]),
      entry("input.pointerModifiers", "unsupported", [noInput]),
      entry("input.dragAndDrop", "unsupported", [noInput]),
      entry("input.touch", "unsupported", [noInput]),
      // An intercept never sees the requests of a page a service worker controls, even those the worker passes to
      // the network
      entry("interception.request", "partial", ["a page a service worker controls sends its requests past it"]),
      entry("interception.response", "partial", ["a page a service worker controls sends its requests past it"]),
      entry("interception.auth", "unsupported", ["WebKit answers challenges from credentials set in advance"]),
      entry("interception.responseBody", "unsupported", ["WebKit can't read a response paused there"]),
      entry("interception.responseFulfill", "supported"),
      entry("interception.responseHeaders", "unsupported", [
        "WebKit can't read a response paused there, so it can't send it on with new headers"
      ]),
      entry("interception.continueUrl", "supported"),
      entry("interception.abortReason", "unsupported", ["WebKit reports every reason as \"Blocked by Web Inspector\""]),
      entry("interception.redirects", "partial", ["only a redirect's first hop pauses"]),
      entry("bodies", "supported"),
      entry("console", "supported", ["a message with only primitive arguments is attributed to the main frame"]),
      entry("prompts", "unsupported", [
        "stock WebKit's inspector has no Dialog domain: a dialog blocks the page unreported"
      ]),
      entry("prompts.kind", "unsupported", ["stock WebKit's inspector has no Dialog domain"]),
      entry("popups.opener", "unsupported", [
        "stock WebKit names no page's opener: a page another opens is reported as the browser's"
      ]),
      entry("close.runBeforeUnload", "unsupported", ["stock WebKit's inspector closes no pages"]),
      entry("navigation.referrer", "unsupported", [
        "stock WebKit navigates by script, with the document's own referrer"
      ]),
      entry("navigation.traverse", "unsupported", [
        "stock WebKit's inspector reports going back or forward under the old document's URL"
      ]),
      entry("navigation.sameDocument", "unsupported", [
        "stock WebKit's inspector reports no same-document navigation"
      ]),
      entry("frames.contentFrame", "unsupported", ["stock WebKit's inspector can't say which frame an iframe holds"]),
      entry("frames.readiness", "partial", [
        "a frame's load is reported for the page's main frame only"
      ]),
      entry("fileChooser", "unsupported", ["stock WebKit's inspector reports no file chooser"]),
      entry("downloads", "unsupported", [`${noDownloads}: a navigation that becomes one ends as BecameDownload`]),
      entry("downloads.progress", "unsupported", [noDownloads]),
      entry("downloads.cancel", "unsupported", [noDownloads]),
      entry("screenshot", "supported"),
      entry("screenshot.format", "partial", ["PNG only: stock WebKit's snapshotRect writes nothing else"]),
      entry("screenshot.cssScale", "unsupported", ["stock WebKit's snapshotRect captures device pixels, as PNG"]),
      entry("screenshot.omitBackground", "unsupported", ["stock WebKit's inspector has no background override"]),
      entry("pdf", "unsupported", [noPdf]),
      entry("pdf.headerFooter", "unsupported", [noPdf]),
      entry("pdf.preferCssPageSize", "unsupported", [noPdf]),
      entry("evaluation.userActivation", "supported"),
      entry("webSocketFrames", "supported"),
      entry("networkConnections", "partial", ["no EventSource connections: WebKit reports only their request"]),
      entry("networkConnections.eventSource", "unsupported", ["WebKit reports an EventSource as a request"]),
      entry("network.servedBy", "supported", [
        "a script or stylesheet reused from the memory cache within one document produces no request"
      ]),
      entry("network.headersSent", "partial", [
        "without the Cookie header, which WebKitGTK's network process doesn't report"
      ]),
      entry("workers.shared", "unsupported", ["WebKit doesn't report shared workers"]),
      entry("workers.service", "unsupported", ["WebKit doesn't report service workers"]),
      entry("workers.evaluate", "supported"),
      entry("exceptions.kind", "supported"),
      entry("cookies", "partial", [
        "a context's list is the cookies its pages' documents and resources are sent"
      ]),
      entry("cookies.partitioned", "unsupported", ["WebKit doesn't report partitioned cookies"]),
      entry("storageState.partitioned", "supported", [
        "stock WebKit keys a frame's storage by its top-level origin, port included: a state saved without one is restored at its site's default port"
      ]),
      entry("permissions", "unsupported", [noEmulation]),
      entry("permissions.anyOrigin", "unsupported", [noEmulation]),
      ...[
        "emulation.viewport",
        "emulation.viewport.mobile",
        "emulation.userAgent",
        "emulation.locale",
        "emulation.timezone",
        "emulation.geolocation",
        "emulation.geolocation.unavailable",
        "emulation.media",
        "emulation.network.offline",
        "emulation.network.throttling",
        "emulation.cpuSlowdown",
        "emulation.javaScript",
        "emulation.touch",
        "emulation.focus"
      ].map((name) => entry(name, "unsupported", [noEmulation])),
      entry("snapshot.clickListeners", "unsupported", ["WebKit can't list event listeners"]),
      entry("capability.axTree", "unsupported", ["WebKit reads accessibility one node at a time"]),
      entry("capability.screencast", "unsupported", ["stock WebKit's inspector has no Screencast domain"]),
      entry("capability.video", "unsupported", ["stock WebKit's inspector has no Screencast domain"])
    ]
  })
}

/** The capability an override is applied under, and refused under where it's unsupported. */
const overrideCapability = (override: Adapter.Override): string | undefined => {
  switch (override._tag) {
    case "Viewport":
      return override.mobile || override.deviceScaleFactor !== 1 ? "emulation.viewport.mobile" : "emulation.viewport"
    case "UserAgent":
      return "emulation.userAgent"
    case "Locale":
      return "emulation.locale"
    case "TimeZone":
      return "emulation.timezone"
    case "Geolocation":
      return Option.isNone(override.position) ? "emulation.geolocation.unavailable" : "emulation.geolocation"
    case "Media":
      return "emulation.media"
    case "Offline":
      return "emulation.network.offline"
    case "NetworkConditions":
      return "emulation.network.throttling"
    case "CpuThrottling":
      return "emulation.cpuSlowdown"
    case "JavaScriptEnabled":
      return "emulation.javaScript"
    case "Touch":
      return "emulation.touch"
    case "FocusEmulation":
      return "emulation.focus"
    default:
      return undefined
  }
}

/**
 * Stock WebKit launched in automation mode: the attached table, with what its Automation
 * session drives: contexts as browser processes, pages, trusted input, dialogs whose kind it doesn't say, the
 * window's size as the viewport, and file inputs. History traversal stays unsupported (`navigation.traverse`).
 */
export const launchedCapabilities = (info: Browser.Info) => {
  const evidence = `WebKit adapter, launched, ${info.product} ${info.revision}`
  const differ: Readonly<Record<string, readonly [Browser.CapabilityEntry["status"], ReadonlyArray<string>]>> = {
    userContexts: ["supported", ["each context is a browser process of its own"]],
    "pauseOnStart.popups": ["unsupported", [
      "a page a page opens is found when the browser lists it, and isn't paused"
    ]],
    "input.native": ["supported", ["Automation's simulated input, which the page trusts"]],
    "input.insertText": ["supported", []],
    "input.keyboardLayout": ["unsupported", [
      "Automation types characters and named keys, not a layout's physical keys"
    ]],
    "input.pointerModifiers": ["supported", []],
    "input.dragAndDrop": ["unsupported", ["untested with Automation's pointer"]],
    "input.touch": ["unsupported", ["WebKitGTK builds its Automation without touch"]],
    prompts: ["partial", ["a dialog's kind and default text aren't reported"]],
    "prompts.kind": ["unsupported", [
      "every dialog is Unknown: stock WebKit's Automation says one is open, not which kind"
    ]],
    "close.runBeforeUnload": ["unsupported", ["stock WebKit's Automation closes a page without asking it"]],
    fileChooser: ["unsupported", [
      "a chooser a click opens is cancelled by the browser, unreported; a file input's files are set (setInputFiles)"
    ]],
    "emulation.viewport": ["partial", ["the window is sized to it; no device scale or mobile viewport"]],
    "emulation.viewport.mobile": ["unsupported", ["no mobile viewport"]],
    "emulation.javaScript": ["supported", []],
    "emulation.media": ["supported", []],
    "emulation.focus": ["unsupported", ["each page is a window of its own"]],
    "emulation.timezone": ["unsupported", ["taken at launch, before a context's options reach it"]],
    "emulation.locale": ["unsupported", [
      "the MiniBrowser takes its language from nothing it's given"
    ]],
    "cookies": ["partial", [
      "a context's list is the cookies its open pages' documents and resources are sent, and a host's cookie is set as its domain's"
    ]],
    "frames.contentFrame": ["supported", [
      "found through Automation, by its document"
    ]]
  }
  const base = attachedCapabilities(info).entries
  const entries = base.map((entry) => {
    const different = differ[entry.name]
    return different === undefined
      ? { ...entry, evidence }
      : { ...entry, evidence, status: different[0], limitations: [...different[1]] }
  })
  for (const [name, [status, limitations]] of Object.entries(differ)) {
    if (!entries.some((entry) => entry.name === name)) {
      entries.push({ name, status, evidence, limitations: [...limitations] })
    }
  }
  return new Browser.CapabilitySet({ entries })
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
export interface Options extends Adapter.ConnectOptions {
  /** The browser's version, where the transport knows it: an attached browser's inspector doesn't say. */
  readonly revision?: string | undefined
  /**
   * Stock WebKit launched in automation mode: its browser processes, a context's each, whose Automation
   * sessions make and drive pages. Without it, the adapter is attached through the remote inspector, and only looks.
   */
  readonly automation?: WebKitAutomation.Group | undefined
}

export const connect: (
  transport: Transport.Transport,
  options: Options
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(
    transport: Transport.Transport,
    options: Options
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
    // Finished requests stay answerable while there is room (QUIRKS.md, Q177)
    const retire = Retired.make((key: string) => {
      const request = requests.get(key)
      if (request === undefined) return
      requests.delete(key)
      for (let hop = 0; hop <= request.redirects; hop++) hops.delete(ids.hop(request.id, hop))
    })
    const obligations = new Map<Adapter.ObligationId, ObligationEntry>()
    const handles = new Map<Adapter.HandleId, HandleEntry>()
    const groups = Groups.make()
    // Each object group's anchor, an object made in it, by the group's name (QUIRKS.md, Q132 and Q185)
    const anchors = new Map<string, Deferred.Deferred<string, Adapter.AdapterError>>()
    const connections = new Map<string, NetworkConnection.Id>()
    const pausedRequests = new Map<TargetEntry, number>()
    let attachedAtConnect = true

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

    // Stock WebKit's error page is a load of its own, about:blank, after the failure (QUIRKS.md, Q199): the failed
    // navigation's document, never a navigation of its own. A load it refuses before any request, such as to a port
    // it blocks, shows only the error page: the goto it stands in for failed then
    const errorPageFor = new Map<FrameEntry, PageNavigation.Id>()
    const errorLoaders = new Map<string, PageNavigation.Id>()
    const errorPage = (frame: FrameEntry, loaderId: string, url: string): PageNavigation.Id | undefined => {
      const known = errorLoaders.get(loaderId)
      if (known !== undefined || normalize(url) !== "about:blank") return known
      const after = errorPageFor.get(frame)
      if (after !== undefined) {
        errorPageFor.delete(frame)
        errorLoaders.set(loaderId, after)
        return after
      }
      if (frame.expected.some((expected) => normalize(expected.url) === "about:blank")) return undefined
      const refused = frame.expected.shift()
      if (refused === undefined) return undefined
      const failed = startNavigationAs(
        frame,
        refused.id,
        `refused:${refused.id}`,
        refused.url,
        refused.initiatedAs,
        false
      )
      endNavigation(
        failed,
        {
          _tag: "Failed",
          error: "WebKit showed its error page instead: a load it refused, such as to a port it blocks",
          errorDocument: Option.none()
        },
        "webkit:Network.requestWillBeSent"
      )
      errorLoaders.set(loaderId, refused.id)
      return refused.id
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
      const expected = index >= 0
        ? frame.expected.splice(index, 1)[0]
        : normalized === "about:blank"
        ? undefined
        : frame.expected.shift()
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
        attachment: false,
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
        removing: false
      }
      contexts.set(entry.id, entry)
      contextsByWk.set(browserContextId, entry)
      emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
      return entry
    }

    // Launched stock WebKit's pages being made, by context, so the page announced next in it is the one made
    const creating = new Map<string, number>()

    const pageProxyCreated = (params: Envelope.PageProxyCreatedParams) => {
      const session = control.session(WebKitWire.pageProxyKey(params.pageProxyId))
      if (session === undefined) return
      const context = contextFor(params.browserContextId)
      const id = ids.navigable()
      // Launched stock WebKit: a page the connection is making in this context, or one a page opened
      const pending = options.automation === undefined ? 0 : creating.get(params.browserContextId) ?? 0
      const launchedCreated = options.automation !== undefined && !attachedAtConnect && pending > 0
      const launchedPopup = options.automation !== undefined && !attachedAtConnect && pending === 0
      if (launchedCreated) creating.set(params.browserContextId, pending - 1)
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
        expected: [],
        navigations: new Map(),
        removed: false
      }
      ;(page as { main: FrameEntry }).main = main
      pages.set(id, page)
      pagesByProxy.set(params.pageProxyId, page)
      navigables.set(id, main)
      emit({
        _tag: "PageAdded",
        page: id,
        context: context.id,
        kind: launchedPopup ? "popup" : "tab",
        // Stock WebKit's pages are the browser's own when attached; launched, one the connection asked for is made
        // here, and any other was opened by a page, which stock WebKit doesn't name (QUIRKS.md, Q212)
        origin: attachedAtConnect || options.automation === undefined
          ? { _tag: "Adopted", opener: Option.none() }
          : launchedCreated
          ? { _tag: "Created" }
          : { _tag: "Opened", opener: Option.none() },
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
            ? ConsoleFormat.format(message.parameters.map(argumentOf))
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

    // A page's dialog, opened and closed, as stock WebKit's Automation says when asked (QUIRKS.md, Q206)
    const promptOpened = (
      page: PageEntry,
      kind: "alert" | "confirm" | "prompt" | "beforeunload" | "unknown",
      message: string,
      defaultValue: string
    ) => {
      const prompt = ids.prompt()
      const obligation = ids.obligation()
      obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, page, answer: undefined })
      page.dialog = obligation
      emit({
        _tag: "ObligationOpened",
        obligation,
        subject: { _tag: "Prompt", prompt, page: page.id, kind, message, defaultValue }
      })
    }

    const promptClosed = (page: PageEntry, evidence: string) => {
      const id = page.dialog
      if (id === undefined) return
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
      emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence })
    }

    const handlers: Record<string, (where: Where, params: any) => void> = {
      [Envelope.pageProxyCreated.method]: (_where, params: Envelope.PageProxyCreatedParams) => pageProxyCreated(params),
      [Target.targetCreated.method]: (where, params: Target.TargetCreatedParams) => {
        if (where.page !== undefined) targetCreated(where.page, params)
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
        const failed = navigations.has(f.loaderId) ? undefined : errorPage(frame, f.loaderId, f.url)
        if (failed !== undefined) {
          commit(
            frame,
            { loaderId: f.loaderId, url: f.url, origin: f.securityOrigin },
            { _tag: "ErrorPage", navigation: failed },
            "webkit:Page.frameNavigated"
          )
          return
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
      [Page.domContentEventFired.method]: (where) => {
        // Stock WebKit names no frame: its load events are the page's (QUIRKS.md, Q201)
        const document = frames.get(where.target?.mainFrameId ?? "")?.document
        if (document === undefined || document.interactive) return
        document.interactive = true
        emit({ _tag: "DocumentReadiness", document: document.id, readiness: "interactive" })
      },
      [Page.loadEventFired.method]: (where) => {
        const document = frames.get(where.target?.mainFrameId ?? "")?.document
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
          // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
          request.redirects++
          request.hop = ids.hop(request.id, request.redirects)
          request.url = params.request.url
          request.postData[request.redirects] = params.request.postData
          request.requestHeaders = params.request.headers
          hops.set(request.hop, request)
        } else {
          const frame = frames.get(params.frameId)
          let navigation: NavigationEntry | undefined
          if (params.type === "Document" && frame !== undefined) {
            navigation = navigations.get(params.loaderId)
            if (
              navigation === undefined && frame.document?.loaderId !== params.loaderId &&
              errorPage(frame, params.loaderId, params.request.url) === undefined
            ) {
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
            postData: [params.request.postData],
            requestHeaders: params.request.headers,
            kept: undefined
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
          at: Adapter.now(),
          httpVersion: params.metrics?.protocol
        })
        if (
          request.resourceType === "document" && request.frame !== undefined &&
          registry.bodyLimit(placement(request.frame.page), "response") !== undefined
        ) {
          const kept = Deferred.makeUnsafe<Uint8Array, Adapter.AdapterError>()
          request.kept = kept
          Effect.runForkWith(services)(Deferred.into(readBody(request), kept))
        }
        Deferred.doneUnsafe(request.finished, Effect.void)
        retire(requestKey(where.session, params.requestId))
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
          postData: [],
          requestHeaders: resource.response?.requestHeaders ?? ({} as Network.Headers),
          kept: undefined
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
        emit({
          _tag: "HopHeaders",
          hop: request.hop,
          phase: "request",
          headers: headersOf(resource.response?.requestHeaders)
        })
        request.responded = request.hop
        emit({
          _tag: "ResponseReceived",
          response: new NetworkResponse.NetworkResponse({
            hop: request.hop,
            url: resource.url as Url.Url,
            status: Math.min(599, Math.max(100, resource.response?.status || 200)) as NetworkResponse.StatusCode,
            statusText: resource.response?.statusText ?? "",
            httpVersion: Option.none(),
            headers: headersOf(resource.response?.headers),
            servedBy: "cache",
            at: Adapter.now()
          })
        })
        emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
        Deferred.doneUnsafe(request.finished, Effect.void)
        retire(requestKey(where.session, params.requestId))
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
        retire(requestKey(where.session, params.requestId))
        // A document's load that failed after a 204 or 205 kept the old document
        const navigation = request.navigation
        if (navigation !== undefined && (navigation.status === 204 || navigation.status === 205)) {
          failLoad(navigation, params.errorText, "webkit:Network.loadingFailed")
        } else if (navigation !== undefined && navigation.documentHop === request.hop) {
          // Stock WebKit reports neither a failed load nor a download: its document's request does (QUIRKS.md, Q198)
          if (navigation.attachment) {
            endNavigation(navigation, { _tag: "Download", download: Option.none() }, "webkit:Network.loadingFailed")
          } else {
            failLoad(navigation, params.errorText, "webkit:Network.loadingFailed")
            if (!params.canceled) errorPageFor.set(navigation.frame, navigation.id)
          }
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
          postData: params.request.postData ?? request?.postData[request.redirects]
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
          postData: request?.postData[request.redirects]
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
                statusText: params.response.statusText,
                httpVersion: Option.none(),
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
      // The headers sent, cookies included, come with the response: the request event's leave cookies out, and a
      // redirect's response has none (QUIRKS.md, Q181)
      const sent = response.requestHeaders
      emit({
        _tag: "HopHeaders",
        hop: request.hop,
        phase: "request",
        headers: headersOf(sent !== undefined && Object.keys(sent).length > 0 ? sent : request.requestHeaders)
      })
      if (request.navigation !== undefined && request.navigation.documentHop === request.hop) {
        request.navigation.status = response.status
        request.navigation.attachment = Object.entries(response.headers).some(([name, value]) =>
          name.toLowerCase() === "content-disposition" && /^\s*attachment/i.test(String(value))
        )
      }
      emit({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: response.url as Url.Url,
          status: Math.min(599, Math.max(100, response.status || 200)) as NetworkResponse.StatusCode,
          statusText: response.statusText,
          httpVersion: Option.none(),
          headers: headersOf(response.headers),
          servedBy: servedBy(request, response),
          at: Adapter.now()
        })
      })
    }

    // What answered, from the response's source; a route's response is `inspector-override`
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
      // Control frames (close, ping, pong) aren't messages; WebKit reports the close handshake
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
      events: new Map(events.map((event) => [event.method, event])),
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
          installTree(target, result.frameTree, first)
          const adopted = page.main.document
          if (adopted !== undefined && Option.isSome(readyState)) {
            if (readyState.value === "interactive" || readyState.value === "complete") {
              adopted.interactive = true
              emit({ _tag: "DocumentReadiness", document: adopted.id, readiness: "interactive" })
            }
            if (readyState.value === "complete") {
              adopted.complete = true
              emit({ _tag: "DocumentReadiness", document: adopted.id, readiness: "complete" })
            }
          }
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
      // The window's size is the viewport, set once the page is paired (`afterPairing`)
      snapshot(target, first, configureTarget(target)).pipe(Effect.ensuring(resume(target, paused)))

    const workerGate = (worker: WorkerEntry) =>
      Effect.gen(function*() {
        const on = Protocol.on(worker.session)
        yield* Effect.all([Runtime.enable().pipe(on), Console.enable().pipe(on)], {
          concurrency: "unbounded",
          discard: true
        }).pipe(Effect.ignore)
        // A new worker waits for `Worker.initialized`, so this runs before its own script
        const bundle = registry.workerBundle(placement(worker.target.page))
        if (bundle !== undefined) yield* Runtime.evaluate({ expression: bundle }).pipe(on, Effect.ignore)
        return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
      }).pipe(
        Effect.ensuring(
          Worker.initialized({ workerId: worker.workerId }).pipe(Protocol.on(worker.target.session), Effect.ignore)
        )
      )

    // Stock WebKit pauses a page's new targets when asked
    const pageProxyGate = Effect.fnUntraced(function*(page: PageEntry) {
      yield* Target.setPauseOnStart({ pauseOnStart: true }).pipe(Protocol.on(page.session), Effect.ignore)
      return { through: 0, apply: Effect.void } satisfies ProtocolClient.Synced
    })

    // ── Declarations ──

    const placement = (page: PageEntry): Declarations.Placement => ({ page: page.id, context: page.context.id })

    // Where each kind of override is applied: the page, or its targets. Stock WebKit has no Emulation domain: the
    // viewport is the window's size, launched, and JavaScript the page's own setting; any other the table says
    // stock WebKit can't apply is refused as it's declared
    const pageKinds = new Set<Adapter.Override["_tag"]>(["Viewport", "JavaScriptEnabled"])

    const applyPageOverride = (
      page: PageEntry,
      kind: Adapter.Override["_tag"],
      override: Adapter.Override | undefined
    ): Effect.Effect<void, Protocol.ProtocolError> => {
      switch (kind) {
        case "Viewport":
          return resizeWindow(page, override)
        case "JavaScriptEnabled":
          return page.target === undefined || page.target.ended
            ? Effect.void
            : Page.overrideSetting(
              override?._tag === "JavaScriptEnabled"
                ? { setting: "ScriptEnabled", value: override.enabled }
                : { setting: "ScriptEnabled" }
            ).pipe(Protocol.on(page.target.session))
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
        case "Media": {
          const media = override?._tag === "Media" ? override : undefined
          return Effect.gen(function*() {
            const unknown = Object.keys(media?.features ?? {}).find((name) => preferences[name] === undefined)
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
          })
        }
        case "ExtraHeaders":
          return Network.setExtraHTTPHeaders({
            headers: (override?._tag === "ExtraHeaders" ? override.headers : {}) as Network.Headers
          }).pipe(on)
        case "CacheDisabled":
          return Network.setResourceCachingDisabled({
            disabled: override?._tag === "CacheDisabled" && override.disabled
          }).pipe(on)
        default:
          return Effect.void
      }
    }

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
      const overrides = registry.overrides(placement(target.page))
      yield* Effect.forEach(
        [...overrides].filter(([kind]) => !pageKinds.has(kind)),
        ([kind, override]) => applyTargetOverride(target, kind, override),
        { concurrency: "unbounded", discard: true }
      )
      yield* applyBootstrap(target)
      yield* applyIntercepts(target)
    })

    const pagesInScope = (scope: Adapter.DeclarationScope) =>
      [...pages.values()].filter((page) => !page.ended && Declarations.covers(scope, placement(page)))

    const targetsOf = (page: PageEntry) =>
      [page.target, page.provisional].filter((target): target is TargetEntry => target !== undefined && !target.ended)

    const applyDeclaration = (declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) => {
      switch (declaration._tag) {
        case "Override": {
          const kind = declaration.override._tag
          return Effect.forEach(pagesInScope(scope), (page) => {
            const override = registry.overrides(placement(page)).get(kind)
            return pageKinds.has(kind)
              ? applyPageOverride(page, kind, override)
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
        // Refused as they're declared: stock WebKit reports no file chooser and no download
        case "FileChooser":
        case "Downloads":
        // WebKit keeps response bodies on its own, so there is nothing to collect
        case "BodyCollection":
          return Effect.void
      }
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
      removing: false
    })
    const failConnect = (error: Protocol.ProtocolError) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "handshake", hint: error.message }), "connect")
    // Launched, the session names the browser; attached, the inspector server says nothing of it, and
    // has no session of its own to ask (QUIRKS.md, Q203)
    const info = options.automation !== undefined
      ? new Browser.Info({
        product: `${options.automation.first.browserName} (stock WebKit)`,
        version: options.automation.first.browserVersion,
        protocol: "webkit",
        revision: `webkitgtk-${options.automation.first.browserVersion}`
      })
      : new Browser.Info({
        product: "WebKit (stock)",
        version: options.revision ?? "unknown",
        protocol: "webkit",
        revision: options.revision ?? "unknown"
      })
    yield* control.run(Effect.suspend(() => {
      emit({ _tag: "UserContextAdded", context: defaultContext, isDefault: true })
      return flush
    }))
    // Pages that existed before are announced before the reply, and adopted
    yield* Envelope.enable().pipe(Protocol.on(client.root), Effect.catch(failConnect))
    yield* client.root.drainObserved
    attachedAtConnect = false
    const capabilitySet = yield* SubscriptionRef.make(
      options.automation !== undefined ? launchedCapabilities(info) : attachedCapabilities(info)
    )

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

    const reload = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: { readonly ignoreCache: boolean }) {
      const page = yield* pageOf(id)
      const target = yield* targetOf(page)
      const navigation = expect(page.main, page.main.document?.url ?? "", "reload")
      yield* protocol(Page.reload({ ignoreCache: options.ignoreCache }).pipe(Protocol.on(target.session))).pipe(
        Effect.tapError(() => Effect.sync(() => unexpect(page.main, navigation)))
      )
      return navigation
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

    // The page's world only: stock WebKit's inspector makes no other (QUIRKS.md, Q194)
    const realmFor = Effect.fnUntraced(function*(id: L1Target.DocumentId, world: Adapter.World) {
      if (world._tag !== "Main") {
        return yield* Effect.fail(unsupported("isolatedWorlds", "stock WebKit's inspector makes no worlds"))
      }
      const document = documents.get(id)
      if (document === undefined) return yield* Effect.fail(foreign(id))
      const find = () => [...document.realms].find((realm) => !realm.ended && realm.world._tag === "Main")
      const existing = find()
      if (existing !== undefined) return existing.id
      // The page's world comes to each new document, reported a moment after it commits: its report is waited for,
      // or the document's end
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

    // WebKit puts what a call returns in the object group of the object it was called on, and its
    // `callFunctionOn` names no group: a group's handles come from calls on an object made in it
    const anchorOf = (realm: RealmEntry, group: string) =>
      Effect.suspend(() => {
        const found = anchors.get(group)
        if (found !== undefined) return Deferred.await(found)
        const anchor = Deferred.makeUnsafe<string, Adapter.AdapterError>()
        anchors.set(group, anchor)
        return Runtime.evaluate({
          expression: "({})",
          objectGroup: group,
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
              if (Exit.isFailure(exit)) anchors.delete(group)
              Deferred.doneUnsafe(anchor, exit)
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
      const anchor = call.result === "handle" && call.group !== undefined
        ? yield* anchorOf(realm, call.group)
        : undefined
      const on = Protocol.on(realm.session)
      const realmGone = (error: Protocol.ProtocolError): Adapter.AdapterError =>
        realm.ended || error.reason._tag === "SessionEnded"
          ? gone({ _tag: "Realm", id }, { _tag: "RealmDestroyed" })
          : protocolError(error)
      // A node crosses as its binding: stock WebKit has one world, the page's, whose object the binding already is,
      // and its `DOM.resolveNode` takes only a node id (QUIRKS.md, Q229)
      const reply = yield* Runtime.callFunctionOn({
        objectId: (anchor ?? helper) as Runtime.RemoteObjectId,
        functionDeclaration: anchor === undefined
          ? Utility.call(call.functionDeclaration, call.result, call.awaitPromise)
          : Utility.callBeside(call.functionDeclaration, call.result, call.awaitPromise),
        arguments: [
          ...(anchor === undefined ? [] : [{ objectId: helper as Runtime.RemoteObjectId }]),
          { value: call.arguments.map((argument) => argument._tag === "Value" ? "v" : "h") },
          ...call.arguments.map((argument): Runtime.CallArgument => {
            if (argument._tag === "Value") return { value: argument.value }
            if (argument._tag === "Node") return { objectId: argument.node.binding as Runtime.RemoteObjectId }
            const handle = handles.get(argument.handle)
            return { objectId: (handle?.objectId ?? "") as Runtime.RemoteObjectId }
          })
        ],
        awaitPromise: call.awaitPromise,
        returnByValue: false,
        emulateUserGesture: call.userActivation
      }).pipe(on, Effect.mapError(realmGone))
      const document = realm.document
      const handleOf = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
        const type = remoteType(object)
        if (object.objectId === undefined || object.subtype === "null") return primitive(object)
        const handle = ids.handle()
        handles.set(handle, { session: realm.session, objectId: object.objectId, group: call.group })
        if (call.group !== undefined) Groups.join(groups, call.group, handle)
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

    // A group given whole goes in one command, its anchor with it (QUIRKS.md, Q132)
    const releaseHandles = (list: ReadonlyArray<Adapter.HandleId>) =>
      Effect.forEach(Groups.release(groups, handles, list), (released) => {
        if (released._tag === "Group") anchors.delete(released.group)
        return (released._tag === "Group"
          ? Runtime.releaseObjectGroup({ objectGroup: released.group }).pipe(Protocol.on(released.first.session))
          : Runtime.releaseObject({ objectId: released.handle.objectId as Runtime.RemoteObjectId }).pipe(
            Protocol.on(released.handle.session)
          )).pipe(Effect.ignore)
      }, { concurrency: "unbounded", discard: true })

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
              case "ContinueResponse":
                return Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Unsupported({ method: "interception.responseHeaders" })
                  })
                )
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
                    // WebKit reports every reason as "Blocked by Web Inspector"
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
          // A dialog is reported, and answered, through Automation (QUIRKS.md, Q206); attached, none is reported
          if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
            return yield* Effect.fail(unsupported(decision._tag, "A dialog is accepted or dismissed"))
          }
          if (obligation.page.dialog !== id || obligation.answer !== undefined) return yield* Effect.fail(foreign(id))
          const handle = yield* handleOf(obligation.page)
          const process = yield* processOfContext(obligation.page.context)
          const promptText = decision._tag === "Accept" ? Option.getOrUndefined(decision.promptText) : undefined
          if (promptText !== undefined) {
            // Only a prompt takes text; Automation says so of any other dialog
            yield* automationOf(
              process,
              Automation.setUserInputForCurrentJavaScriptPrompt({
                browsingContextHandle: handle,
                userInput: promptText
              })
            ).pipe(
              Effect.mapError(() => unsupported("prompt.respond", "the dialog wasn't a prompt, so it takes no text"))
            )
          }
          obligation.answer = { accepted: decision._tag === "Accept", userText: Option.fromUndefinedOr(promptText) }
          yield* automationOf(
            process,
            decision._tag === "Accept"
              ? Automation.acceptCurrentJavaScriptDialog({ browsingContextHandle: handle })
              : Automation.dismissCurrentJavaScriptDialog({ browsingContextHandle: handle })
          )
          yield* run(() => promptClosed(obligation.page, "webkit:Automation.acceptCurrentJavaScriptDialog"))
          return
        }
      }
    })

    const declare = Effect.fnUntraced(function*(scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
      if (declaration._tag === "FileChooser") {
        return yield* Effect.fail(unsupported("fileChooser", "stock WebKit reports no file chooser"))
      }
      if (declaration._tag === "Downloads") {
        return yield* Effect.fail(unsupported("downloads", "stock WebKit reports no downloads"))
      }
      if (declaration._tag === "Override") {
        // Refused, under its capability, where the table says stock WebKit can't apply it, never ignored
        const override = declaration.override
        if (override._tag === "BypassCsp") {
          return yield* Effect.fail(
            unsupported(
              "override.BypassCsp",
              "stock WebKit's inspector can't set a page's Content Security Policy aside"
            )
          )
        }
        const capability = overrideCapability(override)
        const entry = capability === undefined
          ? undefined
          : (yield* SubscriptionRef.get(capabilitySet)).entries.find((each) => each.name === capability)
        if (capability !== undefined && entry?.status === "unsupported") {
          return yield* Effect.fail(unsupported(capability, entry.limitations.join("; ")))
        }
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

    // A request's body: stock WebKit's text, which it decoded as UTF-8 or else Latin-1 (QUIRKS.md, Q221)
    const bodyOf = (postData: string): Uint8Array => new TextEncoder().encode(postData)

    const requestBody = (hop: NetworkRequest.HopId) => {
      const request = hops.get(hop)
      if (request === undefined) return Effect.fail(foreign(hop))
      const sent = request.postData[ids.redirectsOf(hop)]
      return Effect.succeed(sent === undefined ? Option.none<Uint8Array>() : Option.some(bodyOf(sent)))
    }

    const pausedRequestBody = (id: Adapter.ObligationId) => {
      const obligation = obligations.get(id)
      if (obligation?._tag !== "PausedRequest") return Effect.fail(foreign(id))
      return Effect.succeed(
        obligation.postData === undefined ? Option.none<Uint8Array>() : Option.some(bodyOf(obligation.postData))
      )
    }

    const pausedResponseBody = (_id: Adapter.ObligationId) =>
      Effect.fail(unsupported("interception.responseBody", "WebKit can't read a response paused there"))

    const readBody = (request: RequestEntry) =>
      protocol(
        Network.getResponseBody({ requestId: request.requestId as Network.RequestId }).pipe(
          Protocol.on(request.session)
        )
      ).pipe(Effect.map(({ base64Encoded, body }) => base64Encoded ? fromBase64(body) : new TextEncoder().encode(body)))

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
      return yield* request.kept === undefined ? readBody(request) : Deferred.await(request.kept)
    })

    // ── Attached ──

    const refuse = (capability: string, hint: string) => () => Effect.fail(unsupported(capability, hint))

    // No navigate command: the frame's document goes by script, and its events report the navigation as any
    const navigateByScript = Effect.fnUntraced(function*(
      navigable: L1Target.NavigableId,
      url: string,
      options: { readonly referrer: Option.Option<string> }
    ) {
      if (Option.isSome(options.referrer)) {
        return yield* Effect.fail(
          unsupported("navigation.referrer", "stock WebKit navigates by script, with the document's own referrer")
        )
      }
      const frame = yield* frameById(navigable)
      // The page's document is known once its first snapshot is in
      yield* Deferred.await(frame.page.ready)
      if (frame.document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Frame", id: navigable }, { _tag: "DocumentReplaced" }))
      }
      // A fragment of the document it shows: a navigation stock WebKit wouldn't report, so none would be seen to end
      // (QUIRKS.md, Q200)
      if (url.includes("#") && withoutFragment(url) === withoutFragment(frame.document.url)) {
        return yield* Effect.fail(
          unsupported("navigation.sameDocument", "stock WebKit's inspector reports no same-document navigation")
        )
      }
      // A main frame's script runs in whatever document it shows, so a document the browser replaced meanwhile,
      // such as with an error page, doesn't fail it; a child frame's runs in its document's realm
      const where = frame.parent === undefined
        ? { session: (yield* targetOf(frame.page)).session, contextId: undefined }
        : yield* Effect.flatMap(realmFor(frame.document.id, { _tag: "Main" }), (id) => {
          const realm = realms.get(id)
          return realm === undefined ? Effect.fail(foreign(navigable)) : Effect.succeed(realm)
        })
      const id = expect(frame, url)
      yield* protocol(
        Runtime.evaluate({
          expression: `location.href = ${JSON.stringify(url)}; 0`,
          doNotPauseOnExceptionsAndMuteConsole: true,
          ...(where.contextId === undefined ? {} : { contextId: where.contextId as Runtime.ExecutionContextId })
        }).pipe(Protocol.on(where.session))
      ).pipe(Effect.tapError(() => Effect.sync(() => unexpect(frame, id))))
      return id
    })

    // A rectangle as PNG, at the device's scale: stock WebKit's `snapshotRect` takes nothing else
    const screenshot = Effect.fnUntraced(function*(id: L1Target.NavigableId, options: Adapter.ScreenshotOptions) {
      if (options.format !== "png") {
        return yield* Effect.fail(unsupported("screenshot.format", "stock WebKit's snapshotRect writes PNG only"))
      }
      if (options.scale === "css") {
        return yield* Effect.fail(
          unsupported("screenshot.cssScale", "stock WebKit's snapshotRect captures device pixels")
        )
      }
      if (options.omitBackground) {
        return yield* Effect.fail(
          unsupported("screenshot.omitBackground", "stock WebKit's inspector has no background override")
        )
      }
      const page = yield* pageOf(id)
      const target = yield* targetOf(page)
      const clip = Option.getOrUndefined(options.clip)
      const region = clip ?? (yield* protocol(pageSize(target, options.fullPage)).pipe(
        Effect.map(([width, height]) => ({ x: 0, y: 0, width, height }))
      ))
      const { dataURL } = yield* protocol(
        Page.snapshotRect({
          x: Math.round(region.x),
          y: Math.round(region.y),
          width: Math.max(1, Math.round(region.width)),
          height: Math.max(1, Math.round(region.height)),
          coordinateSystem: clip !== undefined || options.fullPage ? "Page" : "Viewport"
        }).pipe(Protocol.on(target.session))
      )
      return fromDataUrl(dataURL)
    })

    // The cookies every page's document can see, from each page's target, once each
    const cookiesAttached = Effect.fnUntraced(function*(_id: UserContext.Id) {
      const seen = new Map<string, Adapter.Cookie>()
      for (const page of pages.values()) {
        if (page.target === undefined || page.ended) continue
        const reply = yield* Page.getCookies().pipe(Protocol.on(page.target.session), Effect.option)
        if (reply._tag === "None") continue
        for (const cookie of reply.value.cookies) {
          seen.set(`${cookie.name}|${cookie.domain}|${cookie.path}`, {
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
          })
        }
      }
      return [...seen.values()]
    })

    const anyTarget = Effect.suspend(() => {
      const page = [...pages.values()].find((each) => each.target !== undefined && !each.ended)
      return page === undefined
        ? Effect.fail(unsupported("cookies", "stock WebKit sets cookies through a page, and none is open"))
        : Effect.succeed(page.target!)
    })

    const setCookiesAttached = Effect.fnUntraced(function*(_id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
      const target = yield* anyTarget
      for (const cookie of list) {
        yield* protocol(
          Page.setCookie({
            cookie: {
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              expires: Option.getOrElse(cookie.expires, () => -1),
              session: Option.isNone(cookie.expires),
              httpOnly: cookie.httpOnly,
              secure: cookie.secure,
              sameSite: Option.getOrElse(cookie.sameSite, () => "Lax")
            } as Page.Cookie
          }).pipe(Protocol.on(target.session))
        )
      }
    })

    const clearCookiesAttached = Effect.fnUntraced(function*(id: UserContext.Id) {
      const target = yield* anyTarget
      for (const cookie of yield* cookiesAttached(id)) {
        const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
        yield* protocol(
          Page.deleteCookie({
            cookieName: cookie.name,
            url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`
          }).pipe(Protocol.on(target.session))
        )
      }
    })

    // ── Launched ──

    const group = options.automation
    const adapterScope = yield* Effect.scope

    // A context's browser process, and the page's
    const processOfContext = (context: ContextEntry) =>
      Effect.suspend(() => {
        const process = group?.process(context.browserContextId ?? "default")
        return process === undefined
          ? Effect.fail(gone({ _tag: "UserContext" }, { _tag: "UserContextRemoved" }))
          : Effect.succeed(process)
      })
    const automationOf = <M extends string, P, A>(
      process: WebKitAutomation.Process,
      command: Protocol.Command<M, P, A>
    ) => protocol(command.pipe(Protocol.on(process.automation)))

    // A page's two names: Automation's handle and the inspector's target, paired by the document's time origin,
    // which both read and neither writes (QUIRKS.md, Q219)
    // Automation's result of a function, as JSON: one that threw is an empty result, not an error (QUIRKS.md, Q227)
    const resultOf = (result: string): Option.Option<unknown> => {
      try {
        return Option.some(JSON.parse(result))
      } catch {
        return Option.none()
      }
    }
    const pageHandles = new Map<PageEntry, Automation.BrowsingContextHandle>()
    const pairedHandles = new Set<string>()
    const pairing = yield* Semaphore.make(1)
    const timeOrigin = "function() { return performance.timeOrigin }"
    const pairOnce = Effect.fnUntraced(function*(page: PageEntry) {
      const known = pageHandles.get(page)
      if (known !== undefined) return Option.some(known)
      const process = yield* processOfContext(page.context)
      const target = page.target
      if (target === undefined || target.ended) return Option.none()
      const ours = yield* Runtime.evaluate({ expression: "performance.timeOrigin", returnByValue: true }).pipe(
        Protocol.on(target.session),
        Effect.map((reply) => reply.result.value as number),
        Effect.option
      )
      if (Option.isNone(ours)) return Option.none()
      const { contexts: listed } = yield* automationOf(process, Automation.getBrowsingContexts())
      for (const candidate of listed) {
        if (candidate.handle === process.anchor || pairedHandles.has(candidate.handle)) continue
        const theirs = yield* automationOf(
          process,
          Automation.evaluateJavaScriptFunction({
            browsingContextHandle: candidate.handle,
            function: timeOrigin,
            arguments: []
          })
        ).pipe(Effect.map(({ result }) => resultOf(result)), Effect.orElseSucceed(() => Option.none()))
        if (Option.isSome(theirs) && theirs.value === ours.value) {
          pageHandles.set(page, candidate.handle)
          pairedHandles.add(candidate.handle)
          yield* afterPairing(page, candidate.handle, process)
          return Option.some(candidate.handle)
        }
      }
      return Option.none()
    })
    const handleOf = Effect.fnUntraced(function*(page: PageEntry) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (page.ended) break
        const found = yield* pairing.withPermits(1)(pairOnce(page))
        if (Option.isSome(found)) return found.value
        yield* BrowserClock.live.sleep(50)
      }
      return yield* Effect.fail(
        gone({ _tag: "Page", id: page.id }, page.closing ?? { _tag: "PageClosed", by: "browser" })
      )
    })

    // Once paired: the page's declared viewport, and a watch for its dialogs
    const afterPairing = Effect.fnUntraced(function*(
      page: PageEntry,
      handle: Automation.BrowsingContextHandle,
      process: WebKitAutomation.Process
    ) {
      const viewport = registry.overrides(placement(page)).get("Viewport")
      if (viewport !== undefined) yield* resizeWindow(page, viewport).pipe(Effect.ignore)
      yield* watchDialogs(page, handle, process).pipe(Effect.forkIn(adapterScope))
    })

    // A dialog Automation says is open, reported with its message, unless it already is
    const reportDialog = Effect.fnUntraced(function*(
      page: PageEntry,
      handle: Automation.BrowsingContextHandle,
      process: WebKitAutomation.Process
    ) {
      const message = yield* Automation.messageOfCurrentJavaScriptDialog({ browsingContextHandle: handle }).pipe(
        Protocol.on(process.automation),
        Effect.map((reply) => reply.message),
        Effect.orElseSucceed(() => "")
      )
      yield* run(() => {
        if (page.dialog === undefined && !page.ended) promptOpened(page, "unknown", message, "")
      })
    })

    /**
     * Input that opens a dialog returns once the dialog is decided, as on every backend; Automation's returns as it
     * opens, so the adapter looks for one before the input returns (QUIRKS.md, Q224).
     */
    const settleDialog = Effect.fnUntraced(function*(
      page: PageEntry,
      handle: Automation.BrowsingContextHandle,
      process: WebKitAutomation.Process
    ) {
      const showing = yield* Automation.isShowingJavaScriptDialog({ browsingContextHandle: handle }).pipe(
        Protocol.on(process.automation),
        Effect.map(({ result }) => result),
        Effect.orElseSucceed(() => false)
      )
      if (!showing) return
      if (page.dialog === undefined) yield* reportDialog(page, handle, process)
      while (page.dialog !== undefined && !page.ended) yield* BrowserClock.live.sleep(20)
    })

    // Stock WebKit's Automation reports a dialog only when asked, and not its kind (QUIRKS.md, Q206)
    const watchDialogs = Effect.fnUntraced(function*(
      page: PageEntry,
      handle: Automation.BrowsingContextHandle,
      process: WebKitAutomation.Process
    ) {
      while (!page.ended) {
        yield* BrowserClock.live.sleep(100)
        const showing = yield* Automation.isShowingJavaScriptDialog({ browsingContextHandle: handle }).pipe(
          Protocol.on(process.automation),
          Effect.map(({ result }) => result),
          Effect.orElseSucceed(() => false)
        )
        if (showing && page.dialog === undefined) {
          yield* reportDialog(page, handle, process)
        } else if (!showing && page.dialog !== undefined) {
          yield* run(() => promptClosed(page, "webkit:Automation.isShowingJavaScriptDialog"))
        }
      }
    })

    // The window's size less the viewport's, measured once per process: its toolbar
    const chrome = new Map<string, { readonly width: number; readonly height: number }>()
    // Each page's window as it was before its first resize, to restore when the viewport is released
    const naturalWindows = new WeakMap<PageEntry, { readonly width: number; readonly height: number }>()
    const resizeWindow = (
      page: PageEntry,
      override: Adapter.Override | undefined
    ): Effect.Effect<void, Protocol.ProtocolError> =>
      Effect.gen(function*() {
        const handle = pageHandles.get(page)
        const process = group?.process(page.context.browserContextId ?? "default")
        if (handle === undefined || process === undefined) return
        const on = Protocol.on(process.automation)
        if (override?._tag !== "Viewport") {
          const natural = naturalWindows.get(page)
          if (natural === undefined) return
          naturalWindows.delete(page)
          return yield* Automation.setWindowFrameOfBrowsingContext({ handle, size: natural }).pipe(on)
        }
        if (!naturalWindows.has(page)) {
          const { context } = yield* Automation.getBrowsingContext({ handle }).pipe(on)
          naturalWindows.set(page, context.windowSize)
          if (!chrome.has(process.key)) {
            const { result } = yield* Automation.evaluateJavaScriptFunction({
              browsingContextHandle: handle,
              function: "function() { return [innerWidth, innerHeight] }",
              arguments: []
            }).pipe(on)
            const [width, height] = Option.getOrElse(resultOf(result), () => [0, 0]) as [number, number]
            chrome.set(process.key, {
              width: context.windowSize.width - width,
              height: context.windowSize.height - height
            })
          }
        }
        const frame = chrome.get(process.key)!
        yield* Automation.setWindowFrameOfBrowsingContext({
          handle,
          size: { width: override.width + frame.width, height: override.height + frame.height }
        }).pipe(on)
      })

    const createUserContextLaunched = Effect.fnUntraced(function*(options: Adapter.UserContextOptions) {
      if (Option.isSome(options.proxy)) {
        return yield* Effect.fail(unsupported("userContexts.proxy", "stock WebKit's automation session takes no proxy"))
      }
      const process = yield* group!.launch({ acceptInsecureCerts: options.acceptInsecureCerts }).pipe(
        Effect.mapError((error) =>
          new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability: "userContexts", hint: error.message } })
        )
      )
      const entry: ContextEntry = {
        id: ids.userContext(),
        browserContextId: process.key,
        isDefault: false,
        removing: false
      }
      contexts.set(entry.id, entry)
      contextsByWk.set(process.key, entry)
      yield* run(() => emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false }))
      return entry.id
    })

    const removeUserContextLaunched = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      if (context.isDefault) {
        return yield* Effect.fail(
          unsupported("removeDefaultContext", "The default context exists for the whole connection")
        )
      }
      context.removing = true
      const inContext = [...pages.values()].filter((page) => page.context === context)
      const process = yield* processOfContext(context)
      yield* process.close
      yield* Effect.forEach(inContext, (page) => page.session.ended, { discard: true })
      contexts.delete(id)
      if (context.browserContextId !== undefined) contextsByWk.delete(context.browserContextId)
      yield* run(() => emit({ _tag: "UserContextRemoved", context: id }))
    })

    const createPageLaunched = Effect.fnUntraced(function*(id: UserContext.Id) {
      const context = yield* contextOf(id)
      const process = yield* processOfContext(context)
      const key = context.browserContextId ?? "default"
      creating.set(key, (creating.get(key) ?? 0) + 1)
      const { handle } = yield* automationOf(process, Automation.createBrowsingContext({ presentationHint: "Window" }))
        .pipe(Effect.tapError(() => Effect.sync(() => creating.set(key, Math.max(0, (creating.get(key) ?? 1) - 1)))))
      // Its first document is still loading, and a navigation sent before it ends is lost (QUIRKS.md, Q211)
      yield* automationOf(
        process,
        Automation.waitForNavigationToComplete({ browsingContextHandle: handle, pageLoadStrategy: "Normal" })
      )
      for (let attempt = 0; attempt < 100; attempt++) {
        yield* client.root.drainObserved
        for (const page of pages.values()) {
          if (page.context !== context || page.ended || pageHandles.has(page)) continue
          yield* Deferred.await(page.ready)
          const paired = yield* pairing.withPermits(1)(pairOnce(page))
          if (Option.isSome(paired) && paired.value === handle) return page.id
        }
        yield* BrowserClock.live.sleep(50)
      }
      return yield* Effect.fail(gone({ _tag: "Browser" }, { _tag: "PageClosed", by: "browser" }))
    })

    const closePageLaunched = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
        const page = yield* pageOf(id)
        if (options.runBeforeUnload) {
          return yield* Effect.fail(
            unsupported("close.runBeforeUnload", "stock WebKit's Automation closes a page without asking it")
          )
        }
        const handle = yield* handleOf(page)
        const process = yield* processOfContext(page.context)
        page.closing = { _tag: "PageClosed", by: "command" }
        yield* automationOf(process, Automation.closeBrowsingContext({ handle }))
      }
    )

    const activatePageLaunched = Effect.fnUntraced(function*(id: L1Target.NavigableId) {
      const page = yield* pageOf(id)
      const handle = yield* handleOf(page)
      const process = yield* processOfContext(page.context)
      yield* automationOf(process, Automation.switchToBrowsingContext({ browsingContextHandle: handle }))
    })

    // A navigation the browser starts: Automation's, for a page; a child frame's by script
    const navigateLaunched = Effect.fnUntraced(function*(
      navigable: L1Target.NavigableId,
      url: string,
      options: { readonly referrer: Option.Option<string> }
    ) {
      const frame = yield* frameById(navigable)
      if (frame.parent !== undefined) return yield* navigateByScript(navigable, url, options)
      if (Option.isSome(options.referrer)) {
        return yield* Effect.fail(
          unsupported("navigation.referrer", "stock WebKit's Automation navigates with no referrer of the caller's")
        )
      }
      yield* Deferred.await(frame.page.ready)
      const document = frame.document
      if (document !== undefined && url.includes("#") && withoutFragment(url) === withoutFragment(document.url)) {
        return yield* Effect.fail(
          unsupported("navigation.sameDocument", "stock WebKit's inspector reports no same-document navigation")
        )
      }
      const handle = yield* handleOf(frame.page)
      const process = yield* processOfContext(frame.page.context)
      const id = expect(frame, url)
      yield* automationOf(process, Automation.navigateBrowsingContext({ handle, url, pageLoadStrategy: "None" })).pipe(
        Effect.tapError(() => Effect.sync(() => unexpect(frame, id)))
      )
      return id
    })

    // Input as Automation simulates it: each event a step of the input sources' states, trusted
    const virtualKeys: Readonly<Record<string, Automation.VirtualKey>> = {
      Shift: "Shift",
      Control: "Control",
      Alt: "Alternate",
      Meta: "Meta",
      Enter: "Enter",
      Tab: "Tab",
      Backspace: "Backspace",
      Escape: "Escape",
      ArrowLeft: "LeftArrow",
      ArrowRight: "RightArrow",
      ArrowUp: "UpArrow",
      ArrowDown: "DownArrow",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Delete: "Delete",
      Insert: "Insert",
      ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `Function${index + 1}`]))
    } as Readonly<Record<string, Automation.VirtualKey>>
    const heldKeys = (modifiers: Adapter.Modifiers): Array<Automation.VirtualKey> => [
      ...(modifiers.shift ? ["Shift" as const] : []),
      ...(modifiers.control ? ["Control" as const] : []),
      ...(modifiers.alt ? ["Alternate" as const] : []),
      ...(modifiers.meta ? ["Meta" as const] : [])
    ]
    const capitalized = (button: string) => (button.charAt(0).toUpperCase() + button.slice(1)) as Automation.MouseButton
    const heldButton = (buttons: number): Automation.MouseButton | undefined =>
      buttons & 1
        ? "Left"
        : buttons & 2
        ? "Right"
        : buttons & 4
        ? "Middle"
        : buttons & 8
        ? "Back"
        : buttons & 16
        ? "Forward"
        : undefined
    // Only sources WebKitGTK builds: touch isn't, and a touch source asserts (QUIRKS.md, Q214)
    const source = (kind: "Mouse" | "Keyboard" | "Wheel") =>
      ({ sourceId: kind.toLowerCase(), sourceType: kind }) as unknown as Automation.InputSource
    // A session's wheel scrolls by the difference between its states, which outlive a sequence: each process's
    // wheel state so far (QUIRKS.md, Q223)
    const wheelStates = new Map<string, { width: number; height: number }>()
    const dispatchInputLaunched = Effect.fnUntraced(
      function*(id: L1Target.NavigableId, events: ReadonlyArray<Adapter.InputEvent>, _frame?: unknown) {
        const page = yield* pageOf(id)
        // What Automation can't type is refused before anything is sent
        for (const event of events) {
          if (event._tag === "Touch") {
            return yield* Effect.fail(
              unsupported("input.touch", "WebKitGTK builds its Automation without touch (QUIRKS.md, Q214)")
            )
          }
          if (event._tag === "Key" && virtualKeys[event.key] === undefined && [...event.key].length !== 1) {
            return yield* Effect.fail(
              unsupported(
                "input.keyboardLayout",
                `stock WebKit's Automation types characters and named keys, not ${event.key}`
              )
            )
          }
        }
        const handle = yield* handleOf(page)
        const process = yield* processOfContext(page.context)
        let wheel = wheelStates.get(process.key)
        if (wheel === undefined) wheelStates.set(process.key, wheel = { width: 0, height: 0 })
        // The events up to text to insert, as one sequence: a sequence's end forgets a click, so a second click
        // in another is never a double click (QUIRKS.md, Q223)
        let steps: Array<ReadonlyArray<Record<string, unknown>>> = []
        const flush = Effect.suspend(() => {
          if (steps.length === 0) return Effect.void
          const sent = steps
          steps = []
          return automationOf(
            process,
            Automation.performInteractionSequence({
              handle,
              inputSources: (["Keyboard", "Mouse", "Wheel"] as const).map(source),
              steps: sent.map((states) => ({ states: states as unknown as Array<Automation.InputSourceState> }))
            })
          ).pipe(Effect.andThen(settleDialog(page, handle, process)))
        })
        const insert = (interactions: ReadonlyArray<Automation.KeyboardInteraction>) =>
          automationOf(process, Automation.performKeyboardInteractions({ handle, interactions: [...interactions] }))
            .pipe(Effect.andThen(settleDialog(page, handle, process)))
        for (const event of events) {
          switch (event._tag) {
            case "Mouse": {
              // A state makes an event only when it names its interaction; the button is the one it moves
              const button = event.button === "none" ? heldButton(event.buttons) : capitalized(event.button)
              steps.push([
                { sourceId: "keyboard", pressedVirtualKeys: heldKeys(event.modifiers) },
                {
                  sourceId: "mouse",
                  origin: "Viewport",
                  location: { x: Math.round(event.x), y: Math.round(event.y) },
                  mouseInteraction: event.type === "move" ? "Move" : event.type === "down" ? "Down" : "Up",
                  ...(button === undefined ? {} : { pressedButton: button })
                }
              ])
              break
            }
            case "Wheel":
              wheel.width += Math.round(event.deltaX)
              wheel.height += Math.round(event.deltaY)
              steps.push([
                { sourceId: "keyboard", pressedVirtualKeys: heldKeys(event.modifiers) },
                {
                  sourceId: "wheel",
                  origin: "Viewport",
                  location: { x: Math.round(event.x), y: Math.round(event.y) },
                  delta: { width: wheel.width, height: wheel.height }
                }
              ])
              break
            case "Key": {
              const named = virtualKeys[event.key]
              const held = heldKeys(event.modifiers)
              const pressed = event.type === "down"
              steps.push([{
                sourceId: "keyboard",
                pressedVirtualKeys: pressed && named !== undefined && !held.includes(named) ? [...held, named] : held,
                ...(pressed && named === undefined ? { pressedCharKey: event.key } : {})
              }])
              break
            }
            case "InsertText": {
              yield* flush
              // WebKitGTK types no newline: each is pressed as Enter (QUIRKS.md, Q223)
              const lines = event.text.split(/\r\n|\r|\n/)
              yield* insert(lines.flatMap((line, index): Array<Automation.KeyboardInteraction> => [
                ...(index === 0 ? [] : [{ type: "InsertByKey", key: "Enter" } as Automation.KeyboardInteraction]),
                ...(line === "" ? [] : [{ type: "InsertByKey", text: line } as Automation.KeyboardInteraction])
              ]))
              break
            }
          }
        }
        yield* flush
      }
    )

    // A context's cookies, through a page of its own: each context is a browser of its own
    const pagesIn = (id: UserContext.Id) =>
      [...pages.values()].filter((page) => page.context.id === id && page.target !== undefined && !page.ended)
    const cookiesLaunched = Effect.fnUntraced(function*(id: UserContext.Id) {
      const seen = new Map<string, Adapter.Cookie>()
      for (const page of pagesIn(id)) {
        const reply = yield* Page.getCookies().pipe(Protocol.on(page.target!.session), Effect.option)
        if (reply._tag === "None") continue
        for (const cookie of reply.value.cookies) {
          seen.set(`${cookie.name}|${cookie.domain}|${cookie.path}`, {
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
          })
        }
      }
      return [...seen.values()]
    })
    // Set through Automation, on the process's anchor window: the inspector's `setCookie` ends the Automation
    // session (QUIRKS.md, Q230), and a context with no page open has its cookies set at once
    const setCookiesLaunched = Effect.fnUntraced(function*(id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
      const process = yield* processOfContext(yield* contextOf(id))
      for (const cookie of list) {
        const expires = Option.getOrUndefined(cookie.expires)
        yield* automationOf(
          process,
          Automation.addSingleCookie({
            browsingContextHandle: process.anchor,
            cookie: {
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              expires: expires ?? 0,
              size: cookie.name.length + Redacted.value(cookie.value).length,
              httpOnly: cookie.httpOnly,
              secure: cookie.secure,
              session: expires === undefined,
              sameSite: Option.getOrElse(cookie.sameSite, () => "Lax")
            }
          })
        )
      }
    })
    // What the list shows, removed through a page: a context with none open lists none (QUIRKS.md, Q225)
    const clearCookiesLaunched = Effect.fnUntraced(function*(id: UserContext.Id) {
      const page = pagesIn(id)[0]
      if (page === undefined) return
      const target = page.target!
      for (const cookie of yield* cookiesLaunched(id)) {
        const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
        yield* protocol(
          Page.deleteCookie({
            cookieName: cookie.name,
            url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`
          }).pipe(Protocol.on(target.session))
        )
      }
    })

    // A frame's Automation handle: the main frame's is "", a child's found among its parent's children by its
    // document, as a page's is by its own (QUIRKS.md, Q219)
    const frameHandles = new WeakMap<FrameEntry, Automation.FrameHandle>()
    const mainFrameHandle = "" as Automation.FrameHandle
    const frameIdentity = "function() { return [performance.timeOrigin, location.href] }"

    /** What the inspector says of a frame's current document: its time origin and URL, in the page's world. */
    const identityOf = Effect.fnUntraced(function*(frame: FrameEntry) {
      const realm = pageWorldOf(frame)
      if (realm === undefined) return Option.none<string>()
      return yield* Runtime.evaluate({
        expression: `JSON.stringify((${frameIdentity})())`,
        contextId: realm.contextId as Runtime.ExecutionContextId,
        returnByValue: true,
        doNotPauseOnExceptionsAndMuteConsole: true
      }).pipe(
        Protocol.on(realm.session),
        Effect.map((reply) => reply.result.value as string),
        Effect.option
      )
    })

    /** What Automation says of a frame's document, by its handle. */
    const automationIdentityOf = (
      process: WebKitAutomation.Process,
      handle: Automation.BrowsingContextHandle,
      frameHandle: Automation.FrameHandle
    ) =>
      Automation.evaluateJavaScriptFunction({
        browsingContextHandle: handle,
        frameHandle,
        function: `function() { return JSON.stringify((${frameIdentity})()) }`,
        arguments: []
      }).pipe(
        Protocol.on(process.automation),
        Effect.map(({ result }) => resultOf(result) as Option.Option<string>),
        Effect.orElseSucceed(() => Option.none<string>())
      )

    /** The page's world of a frame's current document. */
    const pageWorldOf = (frame: FrameEntry) =>
      [...(frame.document?.realms ?? [])].find((each) =>
        each.world._tag === "Main" && !each.ended && each.contextId !== undefined
      )

    /**
     * Whether Automation's frame is `candidate`: a mark Automation leaves on the frame's window, which the inspector
     * looks for in the candidate's, removed at once. For two frames whose documents began at the same moment at
     * the same URL.
     */
    const isMarked = Effect.fnUntraced(function*(
      process: WebKitAutomation.Process,
      handle: Automation.BrowsingContextHandle,
      frameHandle: Automation.FrameHandle,
      candidate: FrameEntry
    ) {
      const realm = pageWorldOf(candidate)
      if (realm === undefined) return false
      const mark = JSON.stringify(`__strider_frame_${crypto.randomUUID().replaceAll("-", "")}`)
      const inFrame = (body: string) =>
        Automation.evaluateJavaScriptFunction({
          browsingContextHandle: handle,
          frameHandle,
          function: `function() { ${body} }`,
          arguments: []
        }).pipe(Protocol.on(process.automation))
      return yield* inFrame(`Object.defineProperty(window, ${mark}, { value: true, configurable: true })`).pipe(
        Effect.andThen(
          Runtime.evaluate({
            expression: `Object.hasOwn(window, ${mark})`,
            contextId: realm.contextId as Runtime.ExecutionContextId,
            returnByValue: true,
            doNotPauseOnExceptionsAndMuteConsole: true
          }).pipe(Protocol.on(realm.session))
        ),
        Effect.map((reply) => reply.result.value === true),
        Effect.orElseSucceed(() => false),
        Effect.ensuring(inFrame(`delete window[${mark}]`).pipe(Effect.ignore))
      )
    })

    /** Which of `candidates` holds the document Automation's frame shows: the one alike, or the one marked. */
    const matchFrame = Effect.fnUntraced(function*(
      process: WebKitAutomation.Process,
      handle: Automation.BrowsingContextHandle,
      frameHandle: Automation.FrameHandle,
      candidates: ReadonlyArray<FrameEntry>
    ) {
      const theirs = yield* automationIdentityOf(process, handle, frameHandle)
      if (Option.isNone(theirs)) return Option.none<FrameEntry>()
      const alike: Array<FrameEntry> = []
      for (const candidate of candidates) {
        if (candidate.removed) continue
        const ours = yield* identityOf(candidate)
        if (Option.isSome(ours) && ours.value === theirs.value) alike.push(candidate)
      }
      if (alike.length <= 1) return Option.fromUndefinedOr(alike[0])
      for (const candidate of alike) {
        if (yield* isMarked(process, handle, frameHandle, candidate)) return Option.some(candidate)
      }
      return Option.none<FrameEntry>()
    })

    /** A frame's Automation handle, found by its parent's, from the main frame down. */
    const frameHandleOf = (
      frame: FrameEntry,
      handle: Automation.BrowsingContextHandle,
      process: WebKitAutomation.Process
    ): Effect.Effect<Option.Option<Automation.FrameHandle>> =>
      Effect.gen(function*() {
        if (frame.parent === undefined) return Option.some(mainFrameHandle)
        const known = frameHandles.get(frame)
        if (known !== undefined) return Option.some(known)
        const parent = yield* frameHandleOf(frame.parent, handle, process)
        const ours = yield* identityOf(frame)
        if (Option.isNone(parent) || Option.isNone(ours)) return Option.none()
        // The parent's frames, as `window.frames` orders them, whose documents are alike
        const alike: Array<Automation.FrameHandle> = []
        for (let ordinal = 0; ordinal < 1000; ordinal++) {
          const child = yield* Automation.resolveChildFrameHandle({
            browsingContextHandle: handle,
            frameHandle: parent.value,
            ordinal
          }).pipe(Protocol.on(process.automation), Effect.map(({ result }) => result), Effect.option)
          // Past the last frame, Automation answers with the main frame's handle (QUIRKS.md, Q227)
          if (Option.isNone(child) || child.value === mainFrameHandle) break
          const theirs = yield* automationIdentityOf(process, handle, child.value)
          if (Option.isSome(theirs) && theirs.value === ours.value) alike.push(child.value)
        }
        for (const child of alike) {
          if (alike.length === 1 || (yield* isMarked(process, handle, child, frame))) {
            frameHandles.set(frame, child)
            return Option.some(child)
          }
        }
        return Option.none()
      })

    /** An element as Automation's node handle in its frame, found by its path from the inspector's object. */
    const nodeHandleOf = Effect.fnUntraced(function*(node: Adapter.NodeBinding) {
      const document = documents.get(node.document)
      if (document === undefined) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      const frame = document.frame
      const target = yield* targetOf(frame.page)
      const handle = yield* handleOf(frame.page)
      const process = yield* processOfContext(frame.page.context)
      const frameHandle = yield* frameHandleOf(frame, handle, process)
      if (Option.isNone(frameHandle)) {
        return yield* Effect.fail(gone({ _tag: "Document", id: node.document }, { _tag: "DocumentReplaced" }))
      }
      // WebKit's binding is the element's object id, in the page's world
      const { result } = yield* protocol(
        Runtime.callFunctionOn({
          objectId: node.binding as Runtime.RemoteObjectId,
          functionDeclaration:
            "function() { const steps = []; for (let e = this; e && e.parentElement; e = e.parentElement) { const same = [...e.parentElement.children].filter((c) => c.localName === e.localName); steps.unshift(e.localName + ':nth-of-type(' + (same.indexOf(e) + 1) + ')') } return ':root > ' + steps.join(' > ') }",
          returnByValue: true
        }).pipe(Protocol.on(target.session))
      )
      const found = yield* automationOf(
        process,
        Automation.evaluateJavaScriptFunction({
          browsingContextHandle: handle,
          frameHandle: frameHandle.value,
          function: "function(path) { return document.querySelector(path) }",
          arguments: [JSON.stringify(result.value)]
        })
      )
      const reference = Option.getOrNull(resultOf(found.result)) as Record<string, string> | null
      const nodeHandle = reference === null ? undefined : Object.values(reference)[0]
      if (nodeHandle === undefined) return yield* Effect.fail(foreign(node.document))
      return { frame, handle, process, frameHandle: frameHandle.value, nodeHandle: nodeHandle as Automation.NodeHandle }
    })

    // The frame an iframe holds, as Automation resolves it, then the inspector's frame showing the same document
    const contentFrameLaunched = Effect.fnUntraced(function*(node: Adapter.NodeBinding) {
      const { frame, frameHandle, handle, nodeHandle, process } = yield* nodeHandleOf(node)
      const child = yield* Automation.resolveChildFrameHandle({
        browsingContextHandle: handle,
        frameHandle,
        nodeHandle
      })
        .pipe(Protocol.on(process.automation), Effect.map(({ result }) => result), Effect.option)
      // An element that holds no frame, or one whose document hasn't loaded yet; the main frame's handle is
      // Automation's answer for no frame at all (QUIRKS.md, Q227)
      if (Option.isNone(child) || child.value === mainFrameHandle) return Option.none<L1Target.NavigableId>()
      const matched = yield* matchFrame(process, handle, child.value, [...frame.children])
      if (Option.isNone(matched)) return Option.none<L1Target.NavigableId>()
      frameHandles.set(matched.value, child.value)
      return Option.some(matched.value.id)
    })

    // A file input's files, through the element Automation finds by its path: nothing is clicked or marked
    const setInputFilesLaunched = Effect.fnUntraced(function*(node: Adapter.NodeBinding, files: ReadonlyArray<string>) {
      const { frameHandle, handle, nodeHandle, process } = yield* nodeHandleOf(node)
      yield* automationOf(
        process,
        Automation.setFilesForInputFileUpload({
          browsingContextHandle: handle,
          frameHandle,
          nodeHandle,
          filenames: [...files]
        })
      )
    })

    const noPages = "stock WebKit's inspector makes no contexts or pages, and closes none"
    const attached = {
      info,
      capabilities: capabilitySet,
      pauseScope: "browser",
      defaultContext,
      closed: client.closed,
      createUserContext: refuse("userContexts", noPages),
      removeUserContext: refuse("userContexts", noPages),
      createPage: refuse("userContexts", noPages),
      closePage: refuse("userContexts", noPages),
      activatePage: refuse("emulation.focus", "stock WebKit's inspector has no Emulation domain"),
      navigate: navigateByScript,
      reload,
      traverse: refuse(
        "navigation.traverse",
        "stock WebKit's inspector reports a traversal under the old document's URL, with no realm (QUIRKS.md, Q215)"
      ),
      realm: realmFor,
      evaluate,
      releaseHandles,
      dispatchInput: refuse("input.native", "stock WebKit's inspector protocol has no Input domain"),
      resolve,
      declare,
      screenshot,
      pdf: refuse("pdf", "WebKit has no print-to-PDF"),
      accessibilityTree: refuse("capability.axTree", "WebKit reads accessibility one node at a time"),
      screencast: refuse("capability.screencast", "stock WebKit's inspector has no Screencast domain"),
      video: refuse("capability.video", "stock WebKit's inspector has no Screencast domain"),
      cookies: cookiesAttached,
      setCookies: setCookiesAttached,
      clearCookies: clearCookiesAttached,
      grantPermissions: refuse("permissions", "stock WebKit's inspector has no Emulation domain"),
      resetPermissions: refuse("permissions", "stock WebKit's inspector has no Emulation domain"),
      responseBody,
      contentFrame: refuse("frames.contentFrame", "stock WebKit's inspector can't say which frame an iframe holds"),
      requestBody,
      pausedRequestBody,
      pausedResponseBody,
      setInputFiles: refuse("fileChooser", "stock WebKit's inspector can't set a file input's files"),
      downloadPath: refuse("downloads", "stock WebKit's inspector reports no downloads"),
      cancelDownload: refuse("downloads.cancel", "stock WebKit's inspector reports no downloads")
    } satisfies Adapter.AdapterConnection
    if (group === undefined) return attached
    return {
      ...attached,
      createUserContext: createUserContextLaunched,
      removeUserContext: removeUserContextLaunched,
      createPage: createPageLaunched,
      closePage: closePageLaunched,
      activatePage: activatePageLaunched,
      navigate: navigateLaunched,
      dispatchInput: dispatchInputLaunched,
      cookies: cookiesLaunched,
      setCookies: setCookiesLaunched,
      clearCookies: clearCookiesLaunched,
      setInputFiles: setInputFilesLaunched,
      contentFrame: contentFrameLaunched
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
