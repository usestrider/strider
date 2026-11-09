/**
 * L1's model (CONCEPTS.md §2): one per connection, folded from the adapter's facts and the caller's commands.
 *
 * Each entity is its fixed fields, one state (`Readable`) and a `Deferred` for its end. The fold (`fold.ts`) is
 * the only writer of every entity's state and of the caller's settings: handlers, routes, a context's policy, a
 * page's owner, grants. The adapter's facts and the caller's commands reach it as one ordered stream, each applied
 * in full before the next, so a registration is ordered against the events: a dialog folded after a handler's
 * registration returned is the handler's to decide. Readers get entities by id and read their state through
 * `get` and `changes`; nothing outside the fold holds a ref it could write.
 *
 * What a decision needs from the browser happens apart from the fold: obligations (`obligations.ts`) are decided
 * by the handler the fold chose when they opened, and a page's release (`ownership.ts`) waits for its close.
 */
import type * as DateTime from "effect/DateTime"
import type * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import type * as Semaphore from "effect/Semaphore"
import type * as BrowserWorker from "../BrowserWorker.ts"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Download from "../Download.ts"
import type * as Keyboard from "../Keyboard.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import type * as Target from "../Target.ts"
import type * as UncaughtException from "../UncaughtException.ts"
import type * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as BoundedAdapter from "./boundedAdapter.ts"
import type * as Events from "./events.ts"
import * as Fold from "./fold.ts"
import type * as Input from "./input.ts"
import * as Obligations from "./obligations.ts"
import * as Ownership from "./ownership.ts"
import type { Readable } from "./readable.ts"

/** What happens to a dialog no handler claims (UserContext.Options.dialogs; CONCEPTS.md §5). */
export type DialogPolicy = "dismiss" | "accept" | "leaveOpen"

/** A page's status: opening until its first document commits, then open, then closed. */
export type PageStatus =
  | { readonly _tag: "Opening"; readonly url: Url.Url }
  | {
    readonly _tag: "Open"
    readonly url: Url.Url
    readonly document: Page.DocumentStatus
    readonly prompt: Option.Option<Page.Prompt>
    /** The open prompt, when nothing will decide it: no handler, and a `"leaveOpen"` policy. */
    readonly undecided: Option.Option<UndecidedPrompt>
  }
  | { readonly _tag: "Closed"; readonly reason: Target.CloseReason; readonly url: Url.Url }

/** A prompt nothing will decide, as `Reason.PromptBlocking` names it. */
export interface UndecidedPrompt {
  readonly kind: PromptEvent["kind"]
  readonly text: string
}

/** A popup, as its opener's channel has it; its URL arrives with its first navigation. */
export interface PopupEvent {
  readonly page: PageEntry
  readonly url: Readable<Option.Option<Url.Url>>
}

/** A dialog, as the adapter reported it. */
export type PromptEvent = Extract<Adapter.ObligationSubject, { readonly _tag: "Prompt" }>

/** A file chooser, as the adapter reported it. */
export type FileChooserEvent = Extract<Adapter.ObligationSubject, { readonly _tag: "FileChooser" }>

/** A decision a policy made, because no handler did. */
export type AutoResolutionEvent =
  | {
    readonly _tag: "Dialog"
    readonly prompt: PromptEvent
    readonly decision: "accept" | "dismiss"
    readonly policy: DialogPolicy
    readonly at: MonotonicInstant.MonotonicInstant
  }
  | {
    readonly _tag: "FileChooser"
    readonly chooser: FileChooserEvent
    readonly decision: "cancel"
    readonly at: MonotonicInstant.MonotonicInstant
  }
  | {
    readonly _tag: "PausedRequest"
    readonly request: NetworkRequest.NetworkRequest
    readonly decision: "continue"
    readonly at: MonotonicInstant.MonotonicInstant
  }

/** A registered handler, as the model asks it: `Dialog.handle` or `FileChooser.handle`. */
export interface Handler<A> {
  /**
   * Asks the handler, in its own scope, with its own budget: `None` when it failed, was interrupted or ran
   * out of time, so the policy decides.
   */
  readonly decide: (subject: A) => Effect.Effect<Option.Option<Adapter.Decision>>
}

/** A request paused for a decision. */
export type PausedRequestEvent = Extract<Adapter.ObligationSubject, { readonly _tag: "PausedRequest" }>

/** What a route said about a paused request. */
export type RouteAnswer =
  | { readonly _tag: "Decided"; readonly decision: Adapter.Decision }
  | { readonly _tag: "Fallthrough" }
  /** It failed, was interrupted, ran out of time or returned what isn't a decision; it logged why. */
  | { readonly _tag: "Failed" }

/** A route, as the model asks it. */
export interface RouteEntry {
  readonly phase: "request" | "response" | "auth"
  readonly matches: (url: string) => boolean
  /** Asks the route, in its own scope, with its own budget. */
  readonly ask: (obligation: Adapter.ObligationId, paused: PausedRequestEvent) => Effect.Effect<RouteAnswer>
}

/** A navigation of a page, when it ended. */
export interface NavigationEvent {
  readonly navigation: PageNavigation.Id
  /** The navigable it happened in: the page's own id, or a frame's. */
  readonly frame: Target.NavigableId
  /** Where it ended: the committed document's URL, or the one a same-document navigation set; else where it was going. */
  readonly url: Url.Url
  readonly outcome: Adapter.NavigationOutcome
}

/** How a request hop ended. */
export type HopEnd =
  | {
    readonly _tag: "Finished"
    readonly encodedBytes: number
    readonly at: MonotonicInstant.MonotonicInstant
    /** The protocol, where the backend says it only now (WebKit). */
    readonly httpVersion: Option.Option<string>
  }
  | {
    readonly _tag: "Failed"
    readonly error: string
    /** Canceled by a navigation or the page, which isn't a failure of the network (CLI.md, the digest). */
    readonly canceled: boolean
    readonly at: MonotonicInstant.MonotonicInstant
  }
  /** Dropped from the model while still in flight, past `maxHops`. */
  | { readonly _tag: "Forgotten" }

/** What a hop has received so far. */
export interface HopState {
  readonly response: Option.Option<NetworkResponse.NetworkResponse>
  /** The headers as the network sent them, where the backend reports them apart (`HopHeaders`). */
  readonly sent: Option.Option<Headers.Headers>
  /** The headers as the network received them, likewise. */
  readonly received: Option.Option<Headers.Headers>
}

/** One redirect hop of a request, kept until it ends and then while there is room (`maxHops`). */
export interface HopEntry {
  readonly request: NetworkRequest.NetworkRequest
  readonly state: Readable<HopState>
  /**
   * Done once the headers as sent are known, which every adapter reports, or once the hop ends without them
   * (`NetworkRequest.headersSent`).
   */
  readonly sentKnown: Deferred.Deferred<void>
  readonly end: Deferred.Deferred<HopEnd>
  /** Fixed: a request is its initiator's from its first fact. */
  readonly page: Option.Option<PageEntry>
  readonly context: Option.Option<ContextEntry>
}

/** A response, with the hop it answers, so a body subscription can wait for the hop to end. */
export interface ResponseEvent {
  readonly response: NetworkResponse.NetworkResponse
  readonly hop: HopEntry
}

/** A download's progress, and where the browser wrote it once it completed. */
export interface DownloadState {
  readonly status: Download.Status
  readonly path: Option.Option<string>
}

export interface DownloadEntry {
  readonly id: Download.Id
  /** Fixed: the page that started it, and its context. */
  readonly page: PageEntry
  readonly context: ContextEntry
  readonly url: Url.Url
  readonly suggestedFilename: string
  readonly state: Readable<DownloadState>
}

export interface WorkerEntry {
  readonly realm: Target.RealmId
  /** Fixed: a realm never changes kind, URL or owner. */
  readonly kind: BrowserWorker.Kind
  readonly url: Url.Url
  readonly page: Option.Option<PageEntry>
  readonly context: Option.Option<ContextEntry>
  readonly closed: Deferred.Deferred<Target.CloseReason>
}

export interface ConnectionEntry {
  readonly id: NetworkConnection.Id
  /** Fixed at open. */
  readonly kind: NetworkConnection.Kind
  readonly url: Url.Url
  readonly openedAt: DateTime.Utc
  readonly page: PageEntry
  readonly frames: Events.Channel<NetworkConnection.Frame>
  readonly closed: Deferred.Deferred<Target.CloseReason>
}

/** The events of a page: one channel per kind. */
export interface PageEvents {
  readonly popup: Events.Channel<PopupEvent>
  readonly dialog: Events.Channel<PromptEvent>
  readonly fileChooser: Events.Channel<FileChooserEvent>
  readonly autoResolution: Events.Channel<AutoResolutionEvent>
  readonly navigation: Events.Channel<NavigationEvent>
  readonly request: Events.Channel<NetworkRequest.NetworkRequest>
  readonly response: Events.Channel<ResponseEvent>
  readonly console: Events.Channel<ConsoleMessage.ConsoleMessage>
  readonly exception: Events.Channel<UncaughtException.UncaughtException>
  readonly download: Events.Channel<DownloadEntry>
  readonly worker: Events.Channel<WorkerEntry>
  readonly connection: Events.Channel<ConnectionEntry>
}

/** The events of a context: the kinds its modules take a context for. */
export interface ContextEvents {
  readonly autoResolution: Events.Channel<AutoResolutionEvent>
  readonly request: Events.Channel<NetworkRequest.NetworkRequest>
  readonly response: Events.Channel<ResponseEvent>
  readonly console: Events.Channel<ConsoleMessage.ConsoleMessage>
  readonly exception: Events.Channel<UncaughtException.UncaughtException>
  readonly download: Events.Channel<DownloadEntry>
  readonly worker: Events.Channel<WorkerEntry>
  readonly connection: Events.Channel<ConnectionEntry>
}

/** A frame of a page: where it is in the tree, and its current document, once one has committed. */
export interface FrameEntry {
  readonly id: Target.NavigableId
  readonly parent: Target.NavigableId
  readonly document: Option.Option<Target.DocumentId>
  readonly url: Url.Url
}

/** Everything about a page that changes: what the browser says of it, and the caller's settings for it. */
export interface PageState {
  /** Active dialog details, independent of the bounded event history. */
  readonly dialog: Option.Option<PromptEvent>
  readonly status: PageStatus
  /** Its frames, in the order they were added, as `page.frames` shows them under the page. */
  readonly frames: ReadonlyArray<FrameEntry>
  /** Its dedicated workers. */
  readonly workers: ReadonlyArray<WorkerEntry>
  /**
   * The scope that releases the page, when the library owns it (CONCEPTS.md §3): its creator's, or for a popup,
   * its opener's; a transfer moves it.
   */
  readonly owner: Option.Option<Scope.Scope>
  /** `Dialog.handle` registrations, oldest first: the latest decides. */
  readonly promptHandlers: ReadonlyArray<Handler<PromptEvent>>
  /** `FileChooser.handle` registrations, oldest first: the latest decides. */
  readonly chooserHandlers: ReadonlyArray<Handler<FileChooserEvent>>
  /** Its routes, oldest first: the most recent is asked first. */
  readonly routes: ReadonlyArray<RouteEntry>
  /**
   * How many times a handler answered the page's `beforeunload` prompt with stay, as the browser accepted: a
   * `close` that waits on the prompt fails once it grows.
   */
  readonly stayed: number
}

export interface PageEntry {
  readonly id: Target.NavigableId
  /** Fixed: a page never changes context. */
  readonly context: UserContext.Id
  readonly contextEntry: ContextEntry
  readonly state: Readable<PageState>
  readonly closed: Deferred.Deferred<Target.CloseReason>
  /** Input to one page is serialized (CONCEPTS.md §5). */
  readonly input: Semaphore.Semaphore
  /**
   * The keys and buttons held and the pointer's position, which every gesture is built from: written only by the
   * gesture holding `input`, the one state the fold doesn't write (CONCEPTS.md §5).
   */
  readonly inputState: Input.State
  readonly events: PageEvents
}

/** A context's settings, from the options it was created with (`UserContext.Options`). */
export interface ContextSettings {
  /**
   * Whether the library created it, so its policies apply: dialogs no handler claims are decided, and file
   * choosers no handler answers are canceled (CONCEPTS.md §5).
   */
  readonly owned: boolean
  /** Whether this context was created for recovery instead of disposal on disconnect. */
  readonly reclaimable: boolean
  /** `None` for a context nobody set a policy for, such as the default context: no automatic decision. */
  readonly policy: Option.Option<DialogPolicy>
  /** Events retained per kind and target, for `history` (`UserContext.Options.eventLog`). */
  readonly eventLog: number
  /** The layout its pages' keyboards type with (`UserContext.Options.keyboardLayout`). */
  readonly keyboardLayout: Keyboard.Layout
}

/** Permissions granted to a context, for an origin or every one, until the grant's scope closes. */
export interface GrantEntry {
  readonly origin: Option.Option<string>
  readonly permissions: ReadonlyArray<string>
}

/** Everything about a context that changes: its pages and workers, its end, and the caller's settings. */
export interface ContextState {
  readonly pages: ReadonlyArray<PageEntry>
  /** Its workers: its pages' dedicated workers, and its shared and service workers. */
  readonly workers: ReadonlyArray<WorkerEntry>
  readonly closed: Option.Option<Target.CloseReason>
  readonly settings: ContextSettings
  /** Its routes, oldest first: asked after a page's own. */
  readonly routes: ReadonlyArray<RouteEntry>
  /** The permission grants in force, oldest first, which a reset grants again (`grants.ts`). */
  readonly grants: ReadonlyArray<GrantEntry>
}

export interface ContextEntry {
  readonly id: UserContext.Id
  /** Fixed: the default context exists for the whole connection. */
  readonly isDefault: boolean
  readonly state: Readable<ContextState>
  readonly closed: Deferred.Deferred<Target.CloseReason>
  readonly events: ContextEvents
}

/** What changes about a document: its URL, which a same-document navigation changes, and its readiness. */
export interface DocumentState {
  readonly url: Url.Url
  readonly readiness: "loading" | "interactive" | "complete"
}

export interface DocumentEntry {
  readonly id: Target.DocumentId
  /** Fixed: no backend built activates a prerender, which is all that moves a document (CONCEPTS.md §4). */
  readonly navigable: Target.NavigableId
  readonly state: Readable<DocumentState>
  readonly ended: Deferred.Deferred<Target.CloseReason>
}

/** Where an event belongs: the page and the context whose channels it is published on, whichever there are. */
export interface Owner {
  readonly page: Option.Option<PageEntry>
  readonly context: Option.Option<ContextEntry>
}

/** A navigation's outcome, latched once. */
export interface NavigationEntry {
  readonly id: PageNavigation.Id
  readonly outcome: Deferred.Deferred<Adapter.NavigationOutcome>
}

export interface Model {
  /** Owns background cleanup until the connection ends. */
  readonly scope: Scope.Scope
  /** The adapter, its calls bounded by the operation they run in (`boundedAdapter.ts`). */
  readonly adapter: BoundedAdapter.Bounded

  // ── Reads: entities by id, and the state they hold ──

  /** Every page of the browser, in the order they were added. */
  readonly pages: Readable<ReadonlyArray<PageEntry>>
  /** A page the model keeps, by id. */
  readonly page: (id: Target.NavigableId) => Option.Option<PageEntry>
  /** A document the model keeps, by id, until it ends. */
  readonly document: (id: Target.DocumentId) => Option.Option<DocumentEntry>
  /** A page's or a frame's current document; `None` until one commits, and once it is gone. */
  readonly documentOf: (navigable: Target.NavigableId) => Effect.Effect<Option.Option<Target.DocumentId>>
  /** The response of a navigation request, by hop. */
  readonly response: (hop: NetworkRequest.HopId) => Option.Option<NetworkResponse.NetworkResponse>
  /** A hop the model still keeps, by id: its request, its response so far, and its end. */
  readonly hop: (hop: NetworkRequest.HopId) => Option.Option<HopEntry>
  /** Ends when the connection does. */
  readonly lost: Deferred.Deferred<void>

  // ── Commands: each applied by the fold, in order with the facts, before it returns ──

  /** A context's entry, made now if its fact hasn't arrived yet, as when its creation's reply comes first. */
  readonly context: (id: UserContext.Id) => Effect.Effect<ContextEntry>
  /** Sets a context's settings, as the library creates it. */
  readonly configure: (context: ContextEntry, settings: ContextSettings) => Effect.Effect<void>
  /** The navigation's entry, created by whichever comes first: its first fact, or the caller waiting for it. */
  readonly navigation: (id: PageNavigation.Id) => Effect.Effect<NavigationEntry>
  /** Forgets a navigation once its caller has its outcome. */
  readonly forget: (id: PageNavigation.Id) => Effect.Effect<void>
  /** Adds a `Dialog.handle` registration to a page for the scope: the latest decides. */
  readonly handlePrompts: (page: PageEntry, handler: Handler<PromptEvent>) => Effect.Effect<void, never, Scope.Scope>
  /** Adds a `FileChooser.handle` registration to a page for the scope: the latest decides. */
  readonly handleChoosers: (
    page: PageEntry,
    handler: Handler<FileChooserEvent>
  ) => Effect.Effect<void, never, Scope.Scope>
  /** Adds a route to a page or a context for the scope: the most recent is asked first. */
  readonly route: (owner: PageEntry | ContextEntry, route: RouteEntry) => Effect.Effect<void, never, Scope.Scope>
  /** Adds a permission grant in force to a context for the scope. */
  readonly grant: (context: ContextEntry, grant: GrantEntry) => Effect.Effect<void, never, Scope.Scope>

  // ── Ownership (CONCEPTS.md §3) ──

  /** Makes `scope` the page's owner, which releases it, and its popups, as it closes. */
  readonly own: (page: PageEntry, scope: Scope.Scope) => Effect.Effect<void>
  /**
   * Closes a page its owner's scope released, and waits for the page's end under the default budget; with `by`,
   * only while `by` still owns it.
   */
  readonly release: (page: Target.NavigableId, by?: Scope.Scope) => Effect.Effect<void>
  /**
   * Sends a page's close in a fiber of the model's scope, which runs to its own end however long its sender waits:
   * `Page.close` waits for the page's end instead.
   */
  readonly closeApart: (
    page: Target.NavigableId,
    options: { readonly runBeforeUnload: boolean }
  ) => Effect.Effect<Fiber.Fiber<void, Adapter.AdapterError>>
  /**
   * Removes a context its creator's scope released, and waits for its end, after its pages', under the default
   * budget.
   */
  readonly remove: (context: ContextEntry) => Effect.Effect<void>
  /** Moves a page's ownership to `to`, which then releases it (CONCEPTS.md §3, transfers). */
  readonly transfer: (page: Target.NavigableId, to: Scope.Scope) => Effect.Effect<void>
}

/**
 * The most request hops remembered at once, for responses to find their request and bodies their end: finished
 * hops are dropped first, oldest first.
 */
export const maxHops = Fold.maxHops

/**
 * A model and its fold. The fold is the adapter's sink, installed before the adapter connects (`connect`), so the
 * model is made first and given its adapter after: what needs the adapter, deciding obligations and releasing
 * pages, waits for it.
 */
export const make = Effect.fnUntraced(function*() {
  const modelScope = yield* Effect.scope
  const ownership = yield* Ownership.make()
  const fold = yield* Fold.make({ release: ownership.release })
  yield* Obligations.run({ fold, connected: ownership.connected }).pipe(Effect.forkIn(modelScope))

  /** Gives the model its adapter, once connected, and folds the connection's loss when it comes. */
  const attach = (connected: Adapter.AdapterConnection): Effect.Effect<Model, never, Scope.Scope> =>
    Effect.gen(function*() {
      const bounded = BoundedAdapter.make(connected)
      yield* ownership.attach(connected, bounded.claims)
      yield* connected.closed.pipe(Effect.andThen(fold.loseConnection), Effect.forkScoped)
      const release = (page: Target.NavigableId, by?: Scope.Scope) =>
        Effect.suspend(() => {
          const entry = fold.page(page)
          return Option.isNone(entry) ? Effect.void : ownership.release(entry.value, by)
        })
      const model: Model = {
        scope: modelScope,
        adapter: bounded,
        pages: fold.pages,
        page: fold.page,
        document: fold.document,
        documentOf: fold.documentOf,
        response: fold.response,
        hop: fold.hop,
        lost: fold.lost,
        context: (id) => fold.context(id, false),
        configure: fold.configure,
        navigation: fold.navigation,
        forget: fold.forget,
        handlePrompts: (page, handler) => fold.register(page, "promptHandlers", handler),
        handleChoosers: (page, handler) => fold.register(page, "chooserHandlers", handler),
        route: fold.route,
        grant: fold.grant,
        own: fold.own,
        release,
        closeApart: ownership.closeApart,
        remove: ownership.remove,
        transfer: (page, to) =>
          Effect.suspend(() => {
            const entry = fold.page(page)
            if (Option.isNone(entry)) return Effect.void
            return fold.own(entry.value, to).pipe(
              Effect.andThen(Scope.addFinalizer(to, ownership.release(entry.value, to)))
            )
          })
      }
      return model
    })

  return { sink: fold.sink, attach }
})
