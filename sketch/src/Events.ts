/**
 * Events (principles 5 and 16): one module per event type, never page members.
 *
 * Waits look forward; reads look back. `next` and `stream` subscribe by the time their effect returns, so
 * code order is subscription order. `history` reads a bounded log and never waits. Events report; handlers
 * decide (`Dialog.handle`, `FileChooser.handle`, `route`). Seeing an event acquires nothing: a popup belongs to
 * the scope that acquired its opener, a download's file to its context.
 *
 * A wait's deadline is the one in force at `next` (`Deadline.within` around `next`), because the latched
 * result is a `ReadonlyDeferred` that the library completes: with the match, with `TargetGone` as soon as the
 * owner ends, or with `Timeout`, which fails the deferred rather than interrupting it.
 */
import type { DateTime, Effect, Option, Scope, Stream } from "effect"
import type { Headers, HttpIncomingMessage, HttpMethod } from "effect/http"
import type {
  ConnectionId, DocumentId, DownloadId, FileName, HttpStatusCode, MonotonicInstant, NavigableId, NavigationId,
  RealmId, RequestHopId, Url, UrlPattern
} from "./Brand.ts"
import type {
  CloseReason, DeclarationError, DownloadError, EvaluationError, EventOverflow, NavigationError, ObserveError,
  ResponseError, TargetGone, Timeout
} from "./Errors.ts"
import type { Serialized } from "./Handle.ts"
import type { FileInput } from "./Locator.ts"
import type { HandlerRegistration, Initiator, ResourceType } from "./Network.ts"
import type { LoadState, ObservedPage, Page, ReadonlyPage } from "./Page.ts"
import type { ReadonlyDeferred } from "./upstream.ts"
import type { ObservedUserContext, UserContext } from "./UserContext.ts"
import type { Watchable } from "./Watchable.ts"

// ── The three verbs ───────────────────────────────────────────
/**
 * A caller predicate. The filter is data, applied before buffering; `where` runs after it, in the subscriber,
 * never on the ingestion path. It is a separate trailing argument so its parameter type is inferred from the
 * filter (a body decoder, say), which TypeScript can't do for a callback inside the same object.
 */
export type Where<A, PE, PR> = (event: A) => Effect.Effect<boolean, PE, PR>

export interface EventModule<T, A, F, E = never> {
  /** Subscribed when this returns; await the first match with `Deferred.await`. */
  next<PE = never, PR = never>(target: T, filter?: F, where?: Where<A, PE, PR>):
    Effect.Effect<ReadonlyDeferred<A, E | PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  /** Every match from now on; ends when the owner ends normally or the scope closes. */
  stream<PE = never, PR = never>(target: T, filter?: F, where?: Where<A, PE, PR>):
    Effect.Effect<Stream.Stream<A, E | PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  /** What already happened, from a bounded log (UserContextOptions.eventLog); never waits. A read, so no `where`. */
  history(target: T, filter?: F): Effect.Effect<EventHistory<A>>
}
export interface EventHistory<A> {
  readonly entries: ReadonlyArray<A>                    // oldest first
  readonly dropped: number                              // matches the cap discarded, so a truncated log doesn't look complete
}
type AnyPage = ObservedPage
type AnyPageOrContext = ObservedPage | ObservedUserContext

// ── PageNavigation ────────────────────────────────────────────
export type PageNavigation =                            // also the success value of goto, reload, back and forward
  | { readonly _tag: "Committed"; readonly id: NavigationId; readonly document: DocumentId; readonly response: Option.Option<NetworkResponse> }   // 404/500 is still a commit
  | { readonly _tag: "SameDocument"; readonly id: NavigationId; readonly document: DocumentId; readonly via: "fragment" | "historyApi" | "intercepted" }
  | { readonly _tag: "Restored"; readonly id: NavigationId; readonly document: DocumentId }    // back/forward cache
  | { readonly _tag: "Activated"; readonly id: NavigationId; readonly document: DocumentId }   // prerender
export interface NavigationFilter { readonly url?: UrlPattern | string }
export declare const PageNavigation: EventModule<AnyPage, PageNavigation, NavigationFilter, NavigationError> & {
  next<PE = never, PR = never>(target: AnyPage, filter?: NavigationFilter & { readonly waitUntil?: LoadState }, where?: Where<PageNavigation, PE, PR>):   // waitUntil default "commit"
    Effect.Effect<ReadonlyDeferred<PageNavigation, NavigationError | PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
}

// ── Popup: the result has the opener's access ─────────────────
export interface PopupFilter { readonly url?: UrlPattern | string }
export declare const Popup: {
  next<PE = never, PR = never>(target: Page, filter?: PopupFilter, where?: Where<Page, PE, PR>): Effect.Effect<ReadonlyDeferred<Page, PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  next<PE = never, PR = never>(target: AnyPage, filter?: PopupFilter, where?: Where<ObservedPage, PE, PR>): Effect.Effect<ReadonlyDeferred<ObservedPage, PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  stream<PE = never, PR = never>(target: Page, filter?: PopupFilter, where?: Where<Page, PE, PR>): Effect.Effect<Stream.Stream<Page, PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  stream<PE = never, PR = never>(target: AnyPage, filter?: PopupFilter, where?: Where<ObservedPage, PE, PR>): Effect.Effect<Stream.Stream<ObservedPage, PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  history(target: Page, filter?: PopupFilter): Effect.Effect<EventHistory<Page>>
  history(target: AnyPage, filter?: PopupFilter): Effect.Effect<EventHistory<ObservedPage>>
}

// ── NetworkRequest and NetworkResponse ────────────────────────
export interface NetworkRequest {                       // immutable; one redirect hop
  readonly hop: RequestHopId
  readonly method: HttpMethod.HttpMethod
  readonly url: Url
  readonly headers: Headers.Headers                     // Effect's Headers; classified values are redacted
  readonly resourceType: ResourceType
  readonly initiator: Initiator
  readonly servedBy: "network" | "cache" | "serviceWorker"
  readonly at: MonotonicInstant
}
export interface RequestFilter {
  readonly url?: UrlPattern | string
  readonly method?: HttpMethod.HttpMethod
  readonly resourceType?: ResourceType | ReadonlyArray<ResourceType>
}
export declare const NetworkRequest: {
  /** `url` is required: "any request" as a first match is a footgun. */
  next<PE = never, PR = never>(target: AnyPageOrContext, filter: RequestFilter & { readonly url: UrlPattern | string }, where?: Where<NetworkRequest, PE, PR>):
    Effect.Effect<ReadonlyDeferred<NetworkRequest, PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  stream<PE = never, PR = never>(target: AnyPageOrContext, filter?: RequestFilter, where?: Where<NetworkRequest, PE, PR>):
    Effect.Effect<Stream.Stream<NetworkRequest, PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  history(target: AnyPageOrContext, filter?: RequestFilter): Effect.Effect<EventHistory<NetworkRequest>>
  /** For replaying a captured request with effect/http's HttpClient. */
  toHttpClientRequest(request: NetworkRequest): import("effect/http").HttpClientRequest.HttpClientRequest
}

export interface NetworkResponse {                      // immutable; one redirect hop
  readonly hop: RequestHopId
  readonly url: Url
  readonly status: HttpStatusCode
  readonly headers: Headers.Headers
  readonly at: MonotonicInstant
}
/** A response whose body was collected: owned bytes that outlive the page, readable with Effect's decoders. */
export interface CapturedResponse<B> extends NetworkResponse, HttpIncomingMessage.HttpIncomingMessage<ResponseError> {
  readonly body: B                                      // what the subscription's body decoder produced
}
export interface ResponseFilter {
  readonly url?: UrlPattern | string
  readonly method?: HttpMethod.HttpMethod
  readonly status?: HttpStatusCode | number | ((status: HttpStatusCode) => boolean)
}
/** Effect's own decoders fit as they are: HttpIncomingMessage.schemaBodyJson(schema), .text, .arrayBuffer. */
type BodyDecoder<B, DE, DR> = (message: HttpIncomingMessage.HttpIncomingMessage<ResponseError>) => Effect.Effect<B, DE, DR>
export declare const NetworkResponse: {
  /** With `body`: collection is set up before this returns; needs inspect (a ReadonlyPage or a UserContext). */
  next<B, DE, DR, PE = never, PR = never>(target: ReadonlyPage | UserContext, filter: ResponseFilter & {
    readonly url: UrlPattern | string
    readonly body: BodyDecoder<B, DE, DR>               // e.g. HttpIncomingMessage.schemaBodyJson(Cart)
  }, where?: Where<CapturedResponse<B>, PE, PR>):
    Effect.Effect<ReadonlyDeferred<CapturedResponse<B>, DE | PE | ResponseError | TargetGone | Timeout>, ObserveError, Scope.Scope | DR | PR>
  /** Metadata only; `url` is required. */
  next<PE = never, PR = never>(target: AnyPageOrContext, filter: ResponseFilter & { readonly url: UrlPattern | string }, where?: Where<NetworkResponse, PE, PR>):
    Effect.Effect<ReadonlyDeferred<NetworkResponse, PE | ResponseError | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  stream<B, DE, DR, PE = never, PR = never>(target: ReadonlyPage | UserContext, filter: ResponseFilter & { readonly body: BodyDecoder<B, DE, DR> }, where?: Where<CapturedResponse<B>, PE, PR>):
    Effect.Effect<Stream.Stream<CapturedResponse<B>, DE | PE | ResponseError | EventOverflow | TargetGone>, ObserveError, Scope.Scope | DR | PR>
  stream<PE = never, PR = never>(target: AnyPageOrContext, filter?: ResponseFilter, where?: Where<NetworkResponse, PE, PR>):
    Effect.Effect<Stream.Stream<NetworkResponse, PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  history(target: AnyPageOrContext, filter?: ResponseFilter): Effect.Effect<EventHistory<NetworkResponse>>   // metadata only, never bodies
}

// ── ConsoleMessage and UncaughtException ──────────────────────
export type EventOrigin =
  | { readonly _tag: "Page"; readonly page: NavigableId }
  | { readonly _tag: "Worker"; readonly realm: RealmId }
export interface SourceLocation { readonly url: Url; readonly line: number; readonly column: number }
export interface ConsoleMessage {
  readonly level: "debug" | "log" | "info" | "warning" | "error"
  readonly text: string                                 // raw page content: capture policy applies before it leaves the process
  readonly location: Option.Option<SourceLocation>
  readonly source: EventOrigin
  readonly at: MonotonicInstant
}
export interface ConsoleFilter {
  readonly level?: ConsoleMessage["level"] | ReadonlyArray<ConsoleMessage["level"]>
  readonly text?: string | RegExp
}
export declare const ConsoleMessage: EventModule<AnyPageOrContext, ConsoleMessage, ConsoleFilter>

export interface UncaughtException {                    // thrown errors and unhandled rejections
  readonly kind: "thrown" | "unhandledRejection"
  readonly name: string
  readonly message: string
  readonly stack: Option.Option<string>
  readonly source: EventOrigin
  readonly at: MonotonicInstant
}
export interface UncaughtExceptionFilter { readonly message?: string | RegExp }
export declare const UncaughtException: EventModule<AnyPageOrContext, UncaughtException, UncaughtExceptionFilter>

// ── Dialog: events report, handle decides ─────────────────────
declare const DialogDecisionTypeId: unique symbol
export interface DialogDecision { readonly [DialogDecisionTypeId]: "DialogDecision" }
export type Dialog =                                    // each shape offers only the decisions valid for it
  | { readonly _tag: "Alert"; readonly message: string; readonly accept: DialogDecision }
  | { readonly _tag: "Confirm"; readonly message: string; readonly accept: DialogDecision; readonly dismiss: DialogDecision }
  | { readonly _tag: "Prompt"; readonly message: string; readonly defaultValue: string
      readonly accept: DialogDecision                   // answers with defaultValue
      respond(text: string): DialogDecision
      readonly dismiss: DialogDecision }
  | { readonly _tag: "BeforeUnload"; readonly leave: DialogDecision; readonly stay: DialogDecision }
export interface DialogFilter { readonly kind?: Dialog["_tag"] | ReadonlyArray<Dialog["_tag"]> }
export declare const Dialog: EventModule<AnyPage, Dialog, DialogFilter> & {
  /** A dialog blocks its page, so the handler is registered before the action that opens one. */
  handle<E, R>(page: Page, handler: (dialog: Dialog) => Effect.Effect<DialogDecision, E, R>): Effect.Effect<HandlerRegistration, DeclarationError, Scope.Scope | R>
  readonly acceptAll: (dialog: Dialog) => Effect.Effect<DialogDecision>   // Alert/Confirm/Prompt: accept; BeforeUnload: leave
  readonly dismissAll: (dialog: Dialog) => Effect.Effect<DialogDecision>  // Alert: accept; Confirm/Prompt: dismiss; BeforeUnload: stay
}

// ── FileChooser ───────────────────────────────────────────────
declare const FileChooserDecisionTypeId: unique symbol
export interface FileChooserDecision { readonly [FileChooserDecisionTypeId]: "FileChooserDecision" }
export type FileChooser =                               // doesn't pause the page; Cancel when no handler decides
  | { readonly _tag: "Single"; select(file: FileInput): FileChooserDecision; readonly cancel: FileChooserDecision }
  | { readonly _tag: "Multiple"; select(files: ReadonlyArray<FileInput>): FileChooserDecision; readonly cancel: FileChooserDecision }
export declare const FileChooser: EventModule<Page, FileChooser, {}> & {
  handle<E, R>(page: Page, handler: (chooser: FileChooser) => Effect.Effect<FileChooserDecision, E, R>): Effect.Effect<HandlerRegistration, DeclarationError, Scope.Scope | R>
  /** Selects `files`; a Single chooser given several fails the handler, so Cancel applies. */
  choose(files: FileInput | ReadonlyArray<FileInput>): (chooser: FileChooser) => Effect.Effect<FileChooserDecision, import("./Errors.ts").ActionError>
}

// ── Download ──────────────────────────────────────────────────
export type DownloadStatus =
  | { readonly _tag: "InProgress"; readonly received: number; readonly total: Option.Option<number> }
  | { readonly _tag: "Completed" } | { readonly _tag: "Canceled" } | { readonly _tag: "Failed"; readonly reason: string }
export interface Download {
  readonly id: DownloadId
  readonly url: Url                                     // fixed when the download begins
  readonly suggestedFilename: FileName                  // fixed when the download begins
  readonly status: Watchable<DownloadStatus>
  readonly finished: Effect.Effect<void, DownloadError | TargetGone | Timeout>   // status.waitFor(finished), under the deadline
  readonly stream: Stream.Stream<Uint8Array, DownloadError>
  saveAs(path: import("./Brand.ts").LocalPath | string): Effect.Effect<void, DownloadError>   // copies it out; transfers from a remote browser where supported
  readonly cancel: Effect.Effect<void, DownloadError>   // (new in the sketch)
  // the browser-side file is deleted when its context closes, unless the backend's download policy keeps it
}
export interface DownloadFilter { readonly url?: UrlPattern | string }
export declare const Download: EventModule<Page | UserContext, Download, DownloadFilter>

// ── AutoResolution: obligations decided by a default policy ───
export interface AutoResolution {
  readonly subject:
    | { readonly _tag: "Dialog"; readonly dialog: Dialog }
    | { readonly _tag: "FileChooser" }
    | { readonly _tag: "PausedRequest"; readonly request: NetworkRequest }
  readonly decision: string                             // e.g. "dismiss", "cancel", "continue"
  readonly policy: string                               // e.g. dialogs: "dismiss"
  readonly at: MonotonicInstant
}
export declare const AutoResolution: EventModule<Page | UserContext, AutoResolution, {}>

// ── BrowserWorker (new in the sketch) ─────────────────────────
export interface ObservedBrowserWorker {
  readonly realm: RealmId                               // fixed
  readonly kind: "dedicated" | "shared" | "service"     // fixed
  readonly url: Url                                     // fixed: a worker's script URL never changes
  readonly closed: Effect.Effect<CloseReason>
}
export interface BrowserWorker extends ObservedBrowserWorker {
  /** Workers have no isolated world, so evaluating in one needs control. */
  evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (...args: Args) => B | Promise<B>, ...args: Args):
    Effect.Effect<Serialized<B>, EvaluationError | TargetGone | Timeout>
}
export interface WorkerFilter { readonly url?: UrlPattern | string; readonly kind?: ObservedBrowserWorker["kind"] }
export declare const BrowserWorker: {
  next<PE = never, PR = never>(target: Page | UserContext, filter?: WorkerFilter, where?: Where<BrowserWorker, PE, PR>): Effect.Effect<ReadonlyDeferred<BrowserWorker, PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  next<PE = never, PR = never>(target: AnyPageOrContext, filter?: WorkerFilter, where?: Where<ObservedBrowserWorker, PE, PR>): Effect.Effect<ReadonlyDeferred<ObservedBrowserWorker, PE | TargetGone | Timeout>, ObserveError, Scope.Scope | PR>
  stream<PE = never, PR = never>(target: Page | UserContext, filter?: WorkerFilter, where?: Where<BrowserWorker, PE, PR>): Effect.Effect<Stream.Stream<BrowserWorker, PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  stream<PE = never, PR = never>(target: AnyPageOrContext, filter?: WorkerFilter, where?: Where<ObservedBrowserWorker, PE, PR>): Effect.Effect<Stream.Stream<ObservedBrowserWorker, PE | EventOverflow | TargetGone>, ObserveError, Scope.Scope | PR>
  history(target: Page | UserContext, filter?: WorkerFilter): Effect.Effect<EventHistory<BrowserWorker>>
  history(target: AnyPageOrContext, filter?: WorkerFilter): Effect.Effect<EventHistory<ObservedBrowserWorker>>
}

// ── NetworkConnection: WebSocket and EventOrigin (new in the sketch) ──
export type ConnectionFrame = {
  readonly direction: "sent" | "received"
  readonly payload: { readonly _tag: "Text"; readonly text: string } | { readonly _tag: "Binary"; readonly bytes: Uint8Array }
  readonly at: MonotonicInstant
}
export interface NetworkConnection {
  readonly id: ConnectionId
  readonly kind: "webSocket" | "eventSource"            // fixed at open
  readonly url: Url                                     // fixed at open
  readonly openedAt: DateTime.Utc                       // fixed at open
  /** Frames from now on; subscribed when this returns. A capability: BiDi has none (Unsupported). */
  readonly frames: Effect.Effect<Stream.Stream<ConnectionFrame, EventOverflow | TargetGone>, ObserveError, Scope.Scope>
  readonly closed: Effect.Effect<CloseReason>
}
export interface ConnectionFilter { readonly url?: UrlPattern | string; readonly kind?: NetworkConnection["kind"] }
export declare const NetworkConnection: EventModule<AnyPageOrContext, NetworkConnection, ConnectionFilter>
