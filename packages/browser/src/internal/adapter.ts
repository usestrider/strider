/**
 * The backend adapter contract (PROTOCOL.md, Backend adapters; review 08): what every backend gives L1.
 *
 * - **Facts.** The adapter's fold turns protocol events into facts: protocol-neutral observations about the
 *   model, in L1's ids, delivered to a sink in receive order, before the events are published. L1's fold
 *   applies them to its entities and never sees a protocol event.
 * - **Ids.** The adapter mints every id when it first correlates something, per connection, and keeps the
 *   tables that map them to protocol ids. An id from another connection is `Foreign`.
 * - **Operations.** Everything L1 asks of a backend, in L1's ids: contexts and pages, navigation, realms and
 *   evaluation, input, obligations, declarations, capture, storage, permissions, bodies and files.
 *
 * Remote values use WebDriver BiDi's serialization (`script.RemoteValue`), which CDP produces with deep
 * serialization and WebKit's patched protocol can be mapped onto.
 */
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import type * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Browser from "../Browser.ts"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Dialog from "../Dialog.ts"
import type * as Download from "../Download.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import type * as Protocol from "../protocol/Protocol.ts"
import type * as Transport from "../protocol/Transport.ts"
import type * as Route from "../Route.ts"
import type * as Target from "../Target.ts"
import type * as UncaughtException from "../UncaughtException.ts"
import type * as UserContext from "../UserContext.ts"

// ── Ids ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Id of an obligation: a paused request, a prompt or a file chooser that awaits one decision. */
export type ObligationId = string & { readonly ObligationId: unique symbol }

/** Id of a remote object a caller holds, released with its realm or by `releaseHandles`. */
export type HandleId = string & { readonly HandleId: unique symbol }

/** Id of a declaration's registration. */
export type RegistrationId = string & { readonly RegistrationId: unique symbol }

/** Mints a connection's ids: opaque, short, unique within the connection, and never a protocol id. */
export interface Ids {
  readonly userContext: () => UserContext.Id
  readonly navigable: () => Target.NavigableId
  readonly document: () => Target.DocumentId
  readonly realm: () => Target.RealmId
  readonly navigation: () => PageNavigation.Id
  readonly request: () => NetworkRequest.Id
  readonly hop: (request: NetworkRequest.Id, redirects: number) => NetworkRequest.HopId
  readonly prompt: () => Dialog.PromptId
  readonly download: () => Download.Id
  readonly connection: () => NetworkConnection.Id
  readonly obligation: () => ObligationId
  readonly handle: () => HandleId
  readonly registration: () => RegistrationId
}

/** A connection's ids: a counter per kind behind a prefix (`N3`, `D7`, `Q12.1`). */
export const makeIds = (): Ids => {
  const counters = new Map<string, number>()
  const next = <A extends string>(prefix: string) => (): A => {
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    return `${prefix}${n}` as A
  }
  return {
    userContext: next("U"),
    navigable: next("N"),
    document: next("D"),
    realm: next("R"),
    navigation: next("V"),
    request: next("Q"),
    hop: (request, redirects) => `${request}.${redirects}` as NetworkRequest.HopId,
    prompt: next("P"),
    download: next("DL"),
    connection: next("WS"),
    obligation: next("OB"),
    handle: next("H"),
    registration: next("REG")
  }
}

/** Now, on the live monotonic clock, in nanoseconds. */
export const now = (): MonotonicInstant.MonotonicInstant =>
  Math.round(performance.now() * 1e6) as MonotonicInstant.MonotonicInstant

// ── Facts ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A realm's world. */
export type World = { readonly _tag: "Main" } | { readonly _tag: "Isolated"; readonly name: string }

/** How a page came to exist. */
export type PageOrigin =
  | { readonly _tag: "Created" }
  | { readonly _tag: "Opened"; readonly opener: Option.Option<Target.NavigableId> }
  | { readonly _tag: "Adopted"; readonly opener: Option.Option<Target.NavigableId> }

/** What created a document. */
export type DocumentCreatedBy =
  | { readonly _tag: "InitialBlank" }
  | { readonly _tag: "Navigation"; readonly navigation: PageNavigation.Id }
  | { readonly _tag: "ErrorPage"; readonly navigation: PageNavigation.Id }
  | { readonly _tag: "Restored"; readonly navigation: PageNavigation.Id; readonly from: Target.DocumentId }
  | { readonly _tag: "Adopted" }

/** What kind of worker a realm runs. */
export type WorkerKind =
  | { readonly _tag: "Dedicated"; readonly owner: Option.Option<Target.RealmId> }
  | { readonly _tag: "Shared" }
  | { readonly _tag: "Service"; readonly scope: Option.Option<string> }

/** How a navigation started. */
export type InitiatedAs =
  | "crossDocument"
  | "fragment"
  | "historyApi"
  | "traversal"
  | "reload"
  | "javascriptUrl"
  | "prerenderActivation"

/** How a navigation ended, reported only with affirmative evidence (CONCEPTS.md §4). */
export type NavigationOutcome =
  | {
    readonly _tag: "Committed"
    readonly document: Target.DocumentId
    readonly response: Option.Option<NetworkRequest.HopId>
  }
  | {
    readonly _tag: "SameDocument"
    readonly document: Target.DocumentId
    readonly via: "fragment" | "historyApi" | "intercepted"
  }
  | { readonly _tag: "Restored"; readonly document: Target.DocumentId }
  | { readonly _tag: "Activated"; readonly document: Target.DocumentId }
  | { readonly _tag: "Download"; readonly download: Option.Option<Download.Id> }
  | { readonly _tag: "NoContent"; readonly status: 204 | 205 }
  | {
    readonly _tag: "Failed"
    readonly error: string
    readonly errorDocument: Option.Option<Target.DocumentId>
  }
  | { readonly _tag: "Superseded"; readonly by: PageNavigation.Id }
  | {
    readonly _tag: "Canceled"
    readonly reason: "beforeunload" | "navigateEvent" | "sandbox" | "unloading" | "traversalInProgress"
  }
  | { readonly _tag: "NoOp"; readonly reason: "javascriptNonString" | "noHistoryEntry" }

/** What an obligation is about. */
export type ObligationSubject =
  | {
    readonly _tag: "PausedRequest"
    readonly request: NetworkRequest.NetworkRequest
    readonly phase: "request" | "response" | "auth"
    readonly response: Option.Option<NetworkResponse.NetworkResponse>
    readonly challenge: Option.Option<{ readonly origin: string; readonly scheme: string; readonly realm: string }>
  }
  | {
    readonly _tag: "Prompt"
    readonly prompt: Dialog.PromptId
    readonly page: Target.NavigableId
    readonly kind: "alert" | "confirm" | "prompt" | "beforeunload"
    readonly message: string
    readonly defaultValue: string
  }
  | {
    readonly _tag: "FileChooser"
    readonly navigable: Target.NavigableId
    readonly multiple: boolean
    readonly element: Option.Option<NodeBinding>
  }

/** A node's binding: the backend's handle on it, valid within one document. */
export interface NodeBinding {
  readonly document: Target.DocumentId
  /** CDP's `backendNodeId`, BiDi's `sharedId`, WebKit's node id: correlation evidence, never shown. */
  readonly binding: string
}

/**
 * A protocol-neutral observation about the model, in L1's ids. Facts that interpret protocol traffic carry
 * `evidence`: the events behind them.
 */
export type Fact =
  | { readonly _tag: "UserContextAdded"; readonly context: UserContext.Id; readonly isDefault: boolean }
  | { readonly _tag: "UserContextRemoved"; readonly context: UserContext.Id }
  | {
    readonly _tag: "PageAdded"
    readonly page: Target.NavigableId
    readonly context: UserContext.Id
    readonly kind: "tab" | "popup"
    readonly origin: PageOrigin
    readonly url: string
  }
  | { readonly _tag: "PageReady"; readonly page: Target.NavigableId }
  | { readonly _tag: "PageInitializationFailed"; readonly page: Target.NavigableId; readonly description: string }
  | {
    readonly _tag: "FrameAdded"
    readonly frame: Target.NavigableId
    readonly parent: Target.NavigableId
    readonly page: Target.NavigableId
  }
  | {
    readonly _tag: "NavigableRemoved"
    readonly navigable: Target.NavigableId
    readonly reason: Target.CloseReason
    readonly evidence: string
  }
  | {
    readonly _tag: "DocumentCommitted"
    readonly document: Target.DocumentId
    readonly navigable: Target.NavigableId
    readonly url: string
    readonly origin: string
    readonly createdBy: DocumentCreatedBy
    /** The document it replaced, which ended with `DocumentReplaced`. */
    readonly replaced: Option.Option<Target.DocumentId>
    readonly evidence: string
  }
  | {
    readonly _tag: "DocumentUrlChanged"
    readonly document: Target.DocumentId
    readonly url: string
    readonly navigation: PageNavigation.Id
    readonly via: "fragment" | "historyApi"
  }
  | { readonly _tag: "DocumentOpened"; readonly document: Target.DocumentId; readonly generation: number }
  | {
    readonly _tag: "DocumentReadiness"
    readonly document: Target.DocumentId
    readonly readiness: "interactive" | "complete"
  }
  | {
    readonly _tag: "RealmAdded"
    readonly realm: Target.RealmId
    readonly origin: string
    readonly kind:
      | {
        readonly _tag: "Window"
        readonly navigable: Target.NavigableId
        readonly document: Target.DocumentId
        readonly world: World
      }
      | {
        readonly _tag: "Worker"
        readonly worker: WorkerKind
        readonly url: string
        readonly page: Option.Option<Target.NavigableId>
        /** The worker's context, when the backend says: a page's, or a shared or service worker's own. */
        readonly context: Option.Option<UserContext.Id>
      }
  }
  | { readonly _tag: "RealmDocumentAdded"; readonly realm: Target.RealmId; readonly document: Target.DocumentId }
  | { readonly _tag: "RealmRemoved"; readonly realm: Target.RealmId; readonly reason: Target.CloseReason }
  | {
    readonly _tag: "NavigationStarted"
    readonly navigation: PageNavigation.Id
    readonly navigable: Target.NavigableId
    readonly url: string
    readonly initiatedAs: InitiatedAs
  }
  | {
    readonly _tag: "NavigationEnded"
    readonly navigation: PageNavigation.Id
    readonly outcome: NavigationOutcome
    readonly evidence: string
  }
  | { readonly _tag: "RequestSent"; readonly request: NetworkRequest.NetworkRequest }
  | { readonly _tag: "ResponseReceived"; readonly response: NetworkResponse.NetworkResponse }
  | {
    readonly _tag: "RequestFinished"
    readonly hop: NetworkRequest.HopId
    readonly encodedBytes: number
    readonly at: MonotonicInstant.MonotonicInstant
  }
  | {
    readonly _tag: "RequestFailed"
    readonly hop: NetworkRequest.HopId
    readonly error: string
    readonly canceled: boolean
    readonly at: MonotonicInstant.MonotonicInstant
  }
  | {
    readonly _tag: "ConnectionOpened"
    readonly connection: NetworkConnection.Id
    readonly kind: NetworkConnection.Kind
    readonly url: string
    readonly navigable: Option.Option<Target.NavigableId>
  }
  | {
    readonly _tag: "ConnectionFrame"
    readonly connection: NetworkConnection.Id
    readonly frame: NetworkConnection.Frame
  }
  | { readonly _tag: "ConnectionClosed"; readonly connection: NetworkConnection.Id }
  | { readonly _tag: "ObligationOpened"; readonly obligation: ObligationId; readonly subject: ObligationSubject }
  | {
    readonly _tag: "ObligationEnded"
    readonly obligation: ObligationId
    readonly reason: "resolved" | "targetGone" | "connectionLost"
    readonly evidence: string
  }
  | {
    readonly _tag: "PromptClosed"
    readonly prompt: Dialog.PromptId
    readonly accepted: boolean
    readonly userText: Option.Option<string>
  }
  | {
    readonly _tag: "DownloadStarted"
    readonly download: Download.Id
    readonly page: Target.NavigableId
    readonly url: string
    readonly suggestedFilename: string
  }
  | {
    readonly _tag: "DownloadProgress"
    readonly download: Download.Id
    readonly receivedBytes: number
    readonly totalBytes: Option.Option<number>
  }
  | {
    readonly _tag: "DownloadEnded"
    readonly download: Download.Id
    readonly outcome:
      | { readonly _tag: "Completed"; readonly path: Option.Option<string> }
      | { readonly _tag: "Canceled" }
  }
  | { readonly _tag: "ConsoleMessage"; readonly realm: Target.RealmId; readonly message: ConsoleMessage.ConsoleMessage }
  | {
    readonly _tag: "UncaughtException"
    readonly realm: Option.Option<Target.RealmId>
    readonly exception: UncaughtException.UncaughtException
  }

/** Where an adapter delivers facts: called from its fold, in receive order. */
export type Sink = (fact: Fact) => Effect.Effect<void>

// ── Remote values (WebDriver BiDi, script.RemoteValue) ────────────────────────────────────────────────────

/** A value in a realm, serialized as WebDriver BiDi serializes it. */
export type RemoteValue =
  | { readonly type: "undefined" }
  | { readonly type: "null" }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number | "NaN" | "-0" | "Infinity" | "-Infinity" }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "bigint"; readonly value: string }
  | {
    readonly type: "array" | "set" | "nodelist" | "htmlcollection"
    readonly handle?: HandleId | undefined
    readonly value?: ReadonlyArray<RemoteValue> | undefined
  }
  | {
    readonly type: "object" | "map"
    readonly handle?: HandleId | undefined
    readonly value?: ReadonlyArray<readonly [RemoteValue | string, RemoteValue]> | undefined
  }
  | { readonly type: "regexp"; readonly value: { readonly pattern: string; readonly flags?: string | undefined } }
  | { readonly type: "date"; readonly value: string }
  | {
    readonly type: "node"
    readonly handle?: HandleId | undefined
    readonly node?: NodeBinding | undefined
    readonly value?: {
      readonly nodeType: number
      readonly nodeName?: string | undefined
      readonly localName?: string | undefined
      readonly childNodeCount?: number | undefined
      readonly attributes?: Readonly<Record<string, string>> | undefined
    } | undefined
  }
  | {
    readonly type:
      | "symbol"
      | "function"
      | "weakmap"
      | "weakset"
      | "generator"
      | "error"
      | "proxy"
      | "promise"
      | "typedarray"
      | "arraybuffer"
      | "window"
    readonly handle?: HandleId | undefined
  }

/** An argument for an evaluation: a value to serialize, or a handle the caller holds. */
export type LocalValue =
  | { readonly _tag: "Value"; readonly value: RemoteValue }
  | { readonly _tag: "Handle"; readonly handle: HandleId }

/** A function to call in a realm. */
export interface EvaluationCall {
  /** A function declaration, such as `(a, b) => a + b`. */
  readonly functionDeclaration: string
  readonly arguments: ReadonlyArray<LocalValue>
  /** Waits for a returned promise. */
  readonly awaitPromise: boolean
  /** `"value"` serializes the result; `"handle"` keeps objects as handles the caller must release. */
  readonly result: "value" | "handle"
  /** Grants transient user activation for the call. */
  readonly userActivation: boolean
}

/** What an evaluation produced. */
export type RemoteResult =
  | { readonly _tag: "Value"; readonly value: RemoteValue }
  | {
    readonly _tag: "Exception"
    readonly text: string
    readonly exception: RemoteValue
    readonly stack: Option.Option<string>
  }

// ── Declarations ──────────────────────────────────────────────────────────────────────────────────────────

/** Where a declaration applies. */
export type DeclarationScope =
  | { readonly _tag: "Browser" }
  | { readonly _tag: "UserContext"; readonly context: UserContext.Id }
  | { readonly _tag: "Page"; readonly page: Target.NavigableId }

/** One setting that changes what pages see. The most specific scope wins, then the most recent. */
export type Override =
  | {
    readonly _tag: "Viewport"
    readonly width: number
    readonly height: number
    readonly deviceScaleFactor: number
    readonly mobile: boolean
  }
  | { readonly _tag: "UserAgent"; readonly userAgent: string; readonly platform: Option.Option<string> }
  | { readonly _tag: "Locale"; readonly locale: string }
  | { readonly _tag: "TimeZone"; readonly timeZone: string }
  | {
    readonly _tag: "Geolocation"
    readonly position: Option.Option<
      { readonly latitude: number; readonly longitude: number; readonly accuracy: number }
    >
  }
  | {
    readonly _tag: "Media"
    readonly media: Option.Option<"screen" | "print">
    readonly features: Readonly<Record<string, string>>
  }
  | { readonly _tag: "Offline"; readonly offline: boolean }
  /** Throughput in bytes per second and latency in milliseconds; CDP's alone (review 17). */
  | {
    readonly _tag: "NetworkConditions"
    readonly download: number
    readonly upload: number
    readonly latency: number
  }
  /** A slowdown factor for the page's CPU, 1 for none; CDP's alone (review 17). */
  | { readonly _tag: "CpuThrottling"; readonly rate: number }
  | { readonly _tag: "ExtraHeaders"; readonly headers: Readonly<Record<string, string>> }
  | { readonly _tag: "JavaScriptEnabled"; readonly enabled: boolean }
  | { readonly _tag: "BypassCsp"; readonly enabled: boolean }
  | { readonly _tag: "Touch"; readonly enabled: boolean; readonly maxTouchPoints: number }
  | { readonly _tag: "FocusEmulation"; readonly enabled: boolean }
  | { readonly _tag: "CacheDisabled"; readonly disabled: boolean }

/** A registration: what it declares, where, and when it was made. */
export type Declaration =
  | {
    readonly _tag: "InitScript"
    readonly source: string
    readonly world: World
    /** `environment` scripts (library shims such as the page clock) run before `user` scripts. */
    readonly phase: "environment" | "user"
    readonly timing: "beforeAuthorScript" | "bestEffort"
    /**
     * Scripts this one depends on, by registration: it runs in a document only if each of them ran there
     * without throwing (review 17, candidate 4).
     */
    readonly after: ReadonlyArray<RegistrationId>
  }
  | {
    readonly _tag: "Intercept"
    /** URL patterns, as `*` globs over the whole URL. */
    readonly patterns: ReadonlyArray<string>
    readonly phases: ReadonlyArray<"request" | "response" | "auth">
  }
  | { readonly _tag: "Override"; readonly override: Override }
  | {
    readonly _tag: "Downloads"
    readonly behavior: { readonly _tag: "Allow"; readonly directory: string } | { readonly _tag: "Deny" }
  }
  | { readonly _tag: "FileChooser" }
  | {
    readonly _tag: "BodyCollection"
    /** Response bodies kept per request, at most; larger ones aren't kept. */
    readonly maxBytes: number
  }

/** A decision for an obligation. */
export type Decision =
  | {
    readonly _tag: "Continue"
    readonly overrides: Option.Option<{
      readonly url?: string | undefined
      readonly method?: string | undefined
      readonly headers?: Readonly<Record<string, string>> | undefined
      readonly body?: Uint8Array | undefined
    }>
  }
  | {
    readonly _tag: "Fulfill"
    readonly status: number
    readonly headers: Readonly<Record<string, string>>
    readonly body: Uint8Array
  }
  /**
   * The request fails. `failed` is what every backend can say; the other reasons are CDP's alone
   * (`interception.abortReason`, review 17).
   */
  | { readonly _tag: "Fail"; readonly error: Route.AbortReason }
  | { readonly _tag: "ProvideCredentials"; readonly username: string; readonly password: string }
  | { readonly _tag: "DefaultAuth" }
  | { readonly _tag: "CancelAuth" }
  | { readonly _tag: "Accept"; readonly promptText: Option.Option<string> }
  | { readonly _tag: "Dismiss" }
  | { readonly _tag: "SetFiles"; readonly files: ReadonlyArray<string> }
  | { readonly _tag: "Cancel" }

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Which modifier keys are held. */
export interface Modifiers {
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
}

/** One primitive input event, in CSS pixels relative to the page's viewport. */
export type InputEvent =
  | {
    readonly _tag: "Mouse"
    readonly type: "move" | "down" | "up"
    readonly x: number
    readonly y: number
    readonly button: "none" | "left" | "middle" | "right" | "back" | "forward"
    readonly clickCount: number
    readonly modifiers: Modifiers
    /**
     * The buttons held during the event, as `MouseEvent.buttons` counts them (left 1, right 2, middle 4): L1
     * keeps the page's input state, and adapters keep none of their own (review 16, candidate 1).
     */
    readonly buttons: number
  }
  | {
    readonly _tag: "Wheel"
    readonly x: number
    readonly y: number
    readonly deltaX: number
    readonly deltaY: number
    readonly modifiers: Modifiers
  }
  | {
    readonly _tag: "Key"
    readonly type: "down" | "up"
    /** The `KeyboardEvent.key` value. */
    readonly key: string
    /** The `KeyboardEvent.code` value. */
    readonly code: string
    /** The text the key inserts, if any. */
    readonly text: Option.Option<string>
    readonly modifiers: Modifiers
    readonly autoRepeat: boolean
  }
  | { readonly _tag: "InsertText"; readonly text: string }
  | {
    readonly _tag: "Touch"
    readonly type: "start" | "move" | "end" | "cancel"
    readonly points: ReadonlyArray<{ readonly x: number; readonly y: number; readonly id: number }>
    readonly modifiers: Modifiers
  }

// ── Capture and storage ───────────────────────────────────────────────────────────────────────────────────

/** Settings for a screenshot. */
export interface ScreenshotOptions {
  readonly format: "png" | "jpeg" | "webp"
  readonly quality: Option.Option<number>
  /** A region of the page in CSS pixels, captured even beyond the viewport, never by scrolling. */
  readonly clip: Option.Option<
    { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  >
  /** The whole page, beyond the viewport. */
  readonly fullPage: boolean
}

/** Settings for printing a page to PDF. */
export interface PdfOptions {
  readonly landscape: boolean
  readonly printBackground: boolean
  readonly scale: number
  /** Inches. */
  readonly paperWidth: number
  readonly paperHeight: number
  readonly margins: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
  readonly pageRanges: Option.Option<string>
}

/** A cookie, as every backend can read and write it. */
export interface Cookie {
  readonly name: string
  readonly value: Redacted.Redacted<string>
  readonly domain: string
  readonly path: string
  /** Seconds since the epoch; `None` for a session cookie. */
  readonly expires: Option.Option<number>
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: Option.Option<"Strict" | "Lax" | "None">
  /** The top-level site of a partitioned cookie. */
  readonly partitionKey: Option.Option<string>
}

/** Settings for a new user context. */
export interface UserContextOptions {
  readonly proxy: Option.Option<{ readonly server: string; readonly bypass: ReadonlyArray<string> }>
  readonly acceptInsecureCerts: boolean
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────

/** What a target was, for an error. */
export type TargetDescription = Target.Description

/** Why an adapter operation failed, beyond the protocol's own errors. */
export type AdapterErrorReason =
  | { readonly _tag: "Gone"; readonly target: TargetDescription; readonly reason: Target.CloseReason }
  | { readonly _tag: "Unsupported"; readonly capability: string; readonly hint: string }
  | { readonly _tag: "Foreign"; readonly id: string }
  | { readonly _tag: "Protocol"; readonly error: Protocol.ProtocolError }

/** An adapter operation's failure. */
export class AdapterError extends Data.TaggedError("AdapterError")<{ readonly reason: AdapterErrorReason }> {
  override get message(): string {
    const reason = this.reason
    switch (reason._tag) {
      case "Gone":
        return `${reason.target._tag} gone: ${reason.reason._tag}`
      case "Unsupported":
        return `Unsupported: ${reason.capability} (${reason.hint})`
      case "Foreign":
        return `${reason.id} wasn't minted by this connection`
      case "Protocol":
        return reason.error.message
    }
  }
}

/**
 * An adapter error for a protocol failure. A command the browser doesn't implement is `Unsupported`, named by
 * its method, as every missing capability is; anything else is `Protocol`.
 */
export const protocolError = (error: Protocol.ProtocolError): AdapterError =>
  new AdapterError({
    reason: error.reason._tag === "Unsupported"
      ? {
        _tag: "Unsupported",
        capability: error.reason.method,
        hint: "This browser doesn't implement it"
      }
      : { _tag: "Protocol", error }
  })

// ── The contract ──────────────────────────────────────────────────────────────────────────────────────────

/** How a backend pauses new targets before their scripts run (PROTOCOL.md, Pause-on-start granularity). */
export type PauseScope = "context" | "related" | "opener" | "browser"

/** Settings for connecting an adapter. */
export interface ConnectOptions {
  /** Where facts go. */
  readonly sink: Sink
  /**
   * Whether this connection owns the whole browser, as when it launched it. An owned browser pauses every new
   * page before its scripts run; an attached one pauses only frames and workers of pages it controls.
   */
  readonly ownership: "launched" | "attached"
}

/** One connected backend: what L1 asks of it. */
export interface AdapterConnection {
  readonly info: Browser.Info
  readonly capabilities: SubscriptionRef.SubscriptionRef<Browser.CapabilitySet>
  readonly pauseScope: PauseScope
  /** The default context: it exists for the whole connection. */
  readonly defaultContext: UserContext.Id
  /** Waits as long as the connection lives. */
  readonly closed: Effect.Effect<Transport.ConnectionLost>

  // Contexts and pages
  readonly createUserContext: (
    options: UserContextOptions
  ) => Effect.Effect<UserContext.Id, AdapterError>
  readonly removeUserContext: (context: UserContext.Id) => Effect.Effect<void, AdapterError>
  /** Creates a page and waits until it is ready: initialized, with the declarations in force. */
  readonly createPage: (context: UserContext.Id) => Effect.Effect<Target.NavigableId, AdapterError>
  readonly closePage: (
    page: Target.NavigableId,
    options: { readonly runBeforeUnload: boolean }
  ) => Effect.Effect<void, AdapterError>
  readonly activatePage: (page: Target.NavigableId) => Effect.Effect<void, AdapterError>

  // Navigation
  /** Starts a navigation and returns its id, minted before the command is sent. */
  readonly navigate: (
    navigable: Target.NavigableId,
    url: string,
    options: { readonly referrer: Option.Option<string> }
  ) => Effect.Effect<PageNavigation.Id, AdapterError>
  readonly reload: (
    page: Target.NavigableId,
    options: { readonly ignoreCache: boolean }
  ) => Effect.Effect<PageNavigation.Id, AdapterError>
  /** Moves through history by `delta` entries; `None` when there is no such entry. */
  readonly traverse: (
    page: Target.NavigableId,
    delta: number
  ) => Effect.Effect<Option.Option<PageNavigation.Id>, AdapterError>

  // Realms
  /** The realm of a document's world, created for an isolated world that doesn't exist yet. */
  readonly realm: (document: Target.DocumentId, world: World) => Effect.Effect<Target.RealmId, AdapterError>
  readonly evaluate: (realm: Target.RealmId, call: EvaluationCall) => Effect.Effect<RemoteResult, AdapterError>
  readonly releaseHandles: (handles: ReadonlyArray<HandleId>) => Effect.Effect<void>

  // Input
  readonly dispatchInput: (
    page: Target.NavigableId,
    events: ReadonlyArray<InputEvent>
  ) => Effect.Effect<void, AdapterError>

  // Obligations and declarations
  readonly resolve: (obligation: ObligationId, decision: Decision) => Effect.Effect<void, AdapterError>
  /** Registers a declaration for the scope: applied to every target in scope before this returns, and to new targets before their scripts run. */
  readonly declare: (
    scope: DeclarationScope,
    declaration: Declaration
  ) => Effect.Effect<RegistrationId, AdapterError, Scope.Scope>

  // Capture, storage, network, files
  readonly screenshot: (
    page: Target.NavigableId,
    options: ScreenshotOptions
  ) => Effect.Effect<Uint8Array, AdapterError>
  readonly pdf: (page: Target.NavigableId, options: PdfOptions) => Effect.Effect<Uint8Array, AdapterError>
  readonly cookies: (context: UserContext.Id) => Effect.Effect<ReadonlyArray<Cookie>, AdapterError>
  readonly setCookies: (context: UserContext.Id, cookies: ReadonlyArray<Cookie>) => Effect.Effect<void, AdapterError>
  readonly clearCookies: (context: UserContext.Id) => Effect.Effect<void, AdapterError>
  readonly grantPermissions: (
    context: UserContext.Id,
    origin: Option.Option<string>,
    permissions: ReadonlyArray<string>
  ) => Effect.Effect<void, AdapterError>
  readonly resetPermissions: (context: UserContext.Id) => Effect.Effect<void, AdapterError>
  readonly responseBody: (hop: NetworkRequest.HopId) => Effect.Effect<Uint8Array, AdapterError>
  /** The body of a paused request, as it was sent; `None` without one (review 17). */
  readonly requestBody: (obligation: ObligationId) => Effect.Effect<Option.Option<Uint8Array>, AdapterError>
  /**
   * The body of a response paused at the response phase; `Unsupported` where the protocol can't read it
   * (`interception.responseBody`, review 17).
   */
  readonly pausedResponseBody: (obligation: ObligationId) => Effect.Effect<Uint8Array, AdapterError>
  readonly setInputFiles: (
    node: NodeBinding,
    files: ReadonlyArray<string>
  ) => Effect.Effect<void, AdapterError>
  /** Where a download allowed to a directory is written, on the browser's host. */
  readonly downloadPath: (download: Download.Id) => Effect.Effect<Option.Option<string>, AdapterError>
  /** Cancels a download in progress; `Unsupported` where the protocol has no command for it. */
  readonly cancelDownload: (download: Download.Id) => Effect.Effect<void, AdapterError>
}

/** A backend: connects over a transport. */
export interface BackendAdapter {
  readonly connect: (
    transport: Transport.Transport,
    options: ConnectOptions
  ) => Effect.Effect<AdapterConnection, Browser.BrowserError, Scope.Scope>
}
