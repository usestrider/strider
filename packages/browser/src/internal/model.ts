/**
 * L1's model (CONCEPTS.md §2; review 12, candidate 2): one per connection, folded from the adapter's facts. The
 * fold is the adapter's sink, so it runs in receive order, before the adapter publishes the event, and it is
 * the only writer of entity state. Each entity is its fixed fields, one `SubscriptionRef` and a `Deferred`
 * for its end.
 *
 * It folds what the built operations read: contexts, pages, their active documents and readiness, navigations,
 * the realms the engine is installed in, and the responses of navigation requests. Frames are folded only as
 * far as attribution needs: which page each belongs to.
 *
 * Events (reviews 13 and 14): the fold publishes every event kind to channels on its page and its context
 * (`events.ts`), so it keeps which page and context each navigable, realm and request belongs to (review 14,
 * candidate 1). A dialog or a file chooser is decided by the page's latest handler, or else by a policy, by a
 * resolver in the model's scope; a popup of an owned page is released with its opener's scope. Downloads,
 * workers and connections are entities of their own, whose handles the public modules make.
 */
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as BrowserWorker from "../BrowserWorker.ts"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Dialog from "../Dialog.ts"
import type * as Download from "../Download.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import type * as Target from "../Target.ts"
import type * as UncaughtException from "../UncaughtException.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
import * as Events from "./events.ts"
import * as Input from "./input.ts"

/** What happens to a dialog no handler claims (UserContext.Options.dialogs; CONCEPTS.md §5). */
export type DialogPolicy = "dismiss" | "accept" | "leaveOpen"

/** A page's state: opening until its first document commits, then open, then closed. */
export type PageState =
  | { readonly _tag: "Opening"; readonly url: string }
  | {
    readonly _tag: "Open"
    readonly url: string
    readonly document: Page.DocumentStatus
    readonly prompt: Option.Option<Page.Prompt>
    /** The open prompt, when nothing will decide it: no handler, and a `"leaveOpen"` policy (review 13). */
    readonly undecided: Option.Option<UndecidedPrompt>
  }
  | { readonly _tag: "Closed"; readonly reason: Target.CloseReason; readonly url: string }

/** A prompt nothing will decide, as `Reason.PromptBlocking` names it. */
export interface UndecidedPrompt {
  readonly kind: PromptEvent["kind"]
  readonly text: string
}

/** A popup, as its opener's channel has it; its URL arrives with its first navigation (review 13, candidate 4). */
export interface PopupEvent {
  readonly page: PageEntry
  url: Option.Option<string>
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

/** A registered handler, as the model asks it: `Dialog.handle` or `FileChooser.handle`. */
export interface Handler<A> {
  /**
   * Asks the handler, in its own scope, with its own budget: `None` when it failed, was interrupted or ran
   * out of time, so the policy decides.
   */
  readonly decide: (subject: A) => Effect.Effect<Option.Option<Adapter.Decision>>
}

/** A navigation of a page, when it ended (review 14, candidate 6). */
export interface NavigationEvent {
  readonly navigation: PageNavigation.Id
  /** Where it ended: the committed document's URL, or the one a same-document navigation set; else where it was going. */
  readonly url: string
  readonly outcome: Adapter.NavigationOutcome
}

/** How a request hop ended. */
export type HopEnd =
  | { readonly _tag: "Finished"; readonly encodedBytes: number }
  | { readonly _tag: "Failed"; readonly error: string }
  /** Dropped from the model while still in flight, past `maxHops`. */
  | { readonly _tag: "Forgotten" }

/** One redirect hop of a request, kept until it ends and then while there is room (`maxHops`). */
export interface HopEntry {
  readonly request: NetworkRequest.NetworkRequest
  response: Option.Option<NetworkResponse.NetworkResponse>
  readonly end: Deferred.Deferred<HopEnd>
  readonly page: Option.Option<PageEntry>
  readonly context: Option.Option<ContextEntry>
}

/** A response, with the hop it answers, so a body subscription can wait for the hop to end. */
export interface ResponseEvent {
  readonly response: NetworkResponse.NetworkResponse
  readonly hop: HopEntry
}

export interface DownloadEntry {
  readonly id: Download.Id
  readonly page: PageEntry
  readonly context: ContextEntry
  readonly url: string
  readonly suggestedFilename: string
  readonly status: SubscriptionRef.SubscriptionRef<Download.Status>
  /** Where the browser wrote it, once it completed. */
  path: Option.Option<string>
}

export interface WorkerEntry {
  readonly realm: Target.RealmId
  readonly kind: BrowserWorker.Kind
  readonly url: string
  readonly page: Option.Option<PageEntry>
  readonly context: Option.Option<ContextEntry>
  readonly closed: Deferred.Deferred<Target.CloseReason>
}

export interface ConnectionEntry {
  readonly id: NetworkConnection.Id
  readonly kind: NetworkConnection.Kind
  readonly url: string
  readonly openedAt: DateTime.Utc
  readonly page: PageEntry
  readonly frames: Events.Channel<NetworkConnection.Frame>
  readonly closed: Deferred.Deferred<Target.CloseReason>
}

/** The events of a page: one channel per kind (reviews 13 and 14). */
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

export interface PageEntry {
  readonly id: Target.NavigableId
  readonly context: UserContext.Id
  readonly state: SubscriptionRef.SubscriptionRef<PageState>
  readonly closed: Deferred.Deferred<Target.CloseReason>
  /** Input to one page is serialized (CONCEPTS.md §5). */
  readonly input: Semaphore.Semaphore
  /** The keys and buttons held and the pointer's position, which every gesture is built from (review 16). */
  readonly inputState: Input.State
  /**
   * The scope that releases the page, when the library owns it (CONCEPTS.md §3): its creator's, or for a popup,
   * its opener's. Set once, when the page is acquired or appears.
   */
  owner: Option.Option<Scope.Scope>
  readonly events: PageEvents
  /** `Dialog.handle` registrations, oldest first: the latest decides. */
  readonly promptHandlers: Array<Handler<PromptEvent>>
  /** `FileChooser.handle` registrations, oldest first: the latest decides. */
  readonly chooserHandlers: Array<Handler<FileChooserEvent>>
  /** Its dedicated workers. */
  readonly workers: SubscriptionRef.SubscriptionRef<ReadonlyArray<WorkerEntry>>
}

/** A context's state: its pages, until it ends. */
export interface ContextState {
  readonly pages: ReadonlyArray<Target.NavigableId>
  readonly closed: Option.Option<Target.CloseReason>
}

export interface ContextEntry {
  readonly id: UserContext.Id
  readonly isDefault: boolean
  readonly state: SubscriptionRef.SubscriptionRef<ContextState>
  readonly closed: Deferred.Deferred<Target.CloseReason>
  /**
   * Whether the library created it, so its policies apply: dialogs no handler claims are decided, and file
   * choosers no handler answers are canceled (CONCEPTS.md §5). Set once, when it is created.
   */
  owned: boolean
  /** `None` for a context nobody set a policy for, such as the default context: no automatic decision. */
  policy: Option.Option<DialogPolicy>
  /** Events retained per kind and target, for `history` (`UserContext.Options.eventLog`). */
  eventLog: number
  readonly events: ContextEvents
  /** Its workers: its pages' dedicated workers, and its shared and service workers. */
  readonly workers: SubscriptionRef.SubscriptionRef<ReadonlyArray<WorkerEntry>>
}

export interface DocumentEntry {
  readonly id: Target.DocumentId
  readonly navigable: Target.NavigableId
  readonly readiness: SubscriptionRef.SubscriptionRef<"loading" | "interactive" | "complete">
  readonly ended: Deferred.Deferred<Target.CloseReason>
  /** Its URL, which a same-document navigation changes. */
  url: string
}

/** A navigation's outcome, latched once. */
export interface NavigationEntry {
  readonly id: PageNavigation.Id
  readonly outcome: Deferred.Deferred<Adapter.NavigationOutcome>
}

export interface Model {
  readonly adapter: Adapter.AdapterConnection
  readonly contexts: Map<UserContext.Id, ContextEntry>
  /** A context's entry, made now if its fact hasn't arrived yet, as when its creation's reply comes first. */
  readonly context: (id: UserContext.Id) => Effect.Effect<ContextEntry>
  readonly pages: Map<Target.NavigableId, PageEntry>
  readonly documents: Map<Target.DocumentId, DocumentEntry>
  /** The navigation's entry, created by whichever comes first: its first fact, or the caller waiting for it. */
  readonly navigation: (id: PageNavigation.Id) => NavigationEntry
  /** Forgets a navigation once its caller has its outcome. */
  readonly forget: (id: PageNavigation.Id) => void
  /** The response of a navigation request, by hop. */
  readonly response: (hop: NetworkRequest.HopId) => Option.Option<NetworkResponse.NetworkResponse>
  /** The realm the engine is installed in, per document, until the realm or the document ends. */
  readonly engineRealms: Map<Target.DocumentId, Target.RealmId>
  /** Ends when the connection does. */
  readonly lost: Deferred.Deferred<void>
}

/** The most navigations remembered at once: a page's own navigations nobody waits for are dropped oldest first. */
const maxNavigations = 256

/** The most navigation responses remembered at once. */
const maxResponses = 256

/**
 * The most request hops remembered at once, for responses to find their request and bodies their end: finished
 * hops are dropped first, oldest first.
 */
export const maxHops = 1000

/** Events retained per kind and target when a context sets no `eventLog` (UserContext.Options.eventLog). */
const defaultEventLog = 100

/** How a target's end ends its event streams: normally when it was closed, or with `TargetGone` otherwise. */
const endOf = (reason: Target.CloseReason): Events.End => ({
  normal: reason._tag === "PageClosed" || reason._tag === "UserContextRemoved" ||
    reason._tag === "NetworkConnectionClosed",
  reason
})

/** A URL a popup reports before it navigates, which says nothing about where it was opened to (review 13, P1). */
const placeholder = (url: string) => url === "" || url === "about:blank"

const workerKinds = { Dedicated: "dedicated", Shared: "shared", Service: "service" } as const

/** Where an event from a realm belongs. */
interface Owner {
  readonly page: Option.Option<PageEntry>
  readonly context: Option.Option<ContextEntry>
}

const nobody: Owner = { page: Option.none(), context: Option.none() }

/**
 * A model and its fold. The sink is installed before the adapter connects (`connect`), so the model is made
 * first and given its adapter after.
 */
export const make = Effect.fnUntraced(function*() {
  const modelScope = yield* Effect.scope
  const contexts = new Map<UserContext.Id, ContextEntry>()
  const pages = new Map<Target.NavigableId, PageEntry>()
  // Frames, by the page they belong to (review 14, candidate 1)
  const frames = new Map<Target.NavigableId, PageEntry>()
  const documents = new Map<Target.DocumentId, DocumentEntry>()
  const navigations = new Map<PageNavigation.Id, NavigationEntry>()
  // A page's own navigations, from their start to their end: where they went, for the event
  const started = new Map<PageNavigation.Id, { readonly page: PageEntry; readonly url: string }>()
  const navigationHops = new Set<NetworkRequest.HopId>()
  const responses = new Map<NetworkRequest.HopId, NetworkResponse.NetworkResponse>()
  const hops = new Map<NetworkRequest.HopId, HopEntry>()
  const engineRealms = new Map<Target.DocumentId, Target.RealmId>()
  const realmDocuments = new Map<Target.RealmId, Target.DocumentId>()
  const realmOwners = new Map<Target.RealmId, Owner>()
  const workers = new Map<Target.RealmId, WorkerEntry>()
  const downloads = new Map<Download.Id, DownloadEntry>()
  const connections = new Map<NetworkConnection.Id, ConnectionEntry>()
  const prompts = new Map<Dialog.PromptId, Target.NavigableId>()
  // Popups whose URL is still unknown, until their first navigation starts
  const popupUrls = new Map<
    Target.NavigableId,
    { readonly channel: Events.Channel<PopupEvent>; readonly entry: Events.Entry<PopupEvent> }
  >()
  const lost = yield* Deferred.make<void>()
  let adapter: Adapter.AdapterConnection | undefined

  const navigation = (id: PageNavigation.Id): NavigationEntry => {
    const existing = navigations.get(id)
    if (existing !== undefined) return existing
    const entry: NavigationEntry = { id, outcome: Deferred.makeUnsafe<Adapter.NavigationOutcome>() }
    navigations.set(id, entry)
    if (navigations.size > maxNavigations) navigations.delete(navigations.keys().next().value!)
    return entry
  }

  /** The page a navigable belongs to: itself, or a frame's page. */
  const pageOf = (navigable: Target.NavigableId): Option.Option<PageEntry> =>
    Option.fromNullishOr(pages.get(navigable) ?? frames.get(navigable))

  const ownerOfPage = (page: Option.Option<PageEntry>): Owner =>
    Option.isNone(page)
      ? nobody
      : { page, context: Option.fromNullishOr(contexts.get(page.value.context)) }

  /** Publishes to the page's channel and its context's, whichever there are. */
  const publish = <A>(
    owner: Owner,
    value: A,
    pageChannel: (events: PageEvents) => Events.Channel<A>,
    contextChannel: (events: ContextEvents) => Events.Channel<A>
  ) => {
    if (Option.isSome(owner.page)) Events.publish(pageChannel(owner.page.value.events), value)
    if (Option.isSome(owner.context)) Events.publish(contextChannel(owner.context.value.events), value)
  }

  const endDocument = (id: Target.DocumentId, reason: Target.CloseReason) =>
    Effect.suspend(() => {
      const entry = documents.get(id)
      if (entry === undefined) return Effect.void
      documents.delete(id)
      engineRealms.delete(id)
      return Deferred.succeed(entry.ended, reason)
    })

  const endWorker = Effect.fnUntraced(function*(worker: WorkerEntry, reason: Target.CloseReason) {
    if (!workers.delete(worker.realm)) return
    realmOwners.delete(worker.realm)
    const without = (list: ReadonlyArray<WorkerEntry>) => list.filter((each) => each !== worker)
    if (Option.isSome(worker.page)) yield* SubscriptionRef.update(worker.page.value.workers, without)
    if (Option.isSome(worker.context)) yield* SubscriptionRef.update(worker.context.value.workers, without)
    yield* Deferred.succeed(worker.closed, reason)
  })

  const endConnection = Effect.fnUntraced(function*(connection: ConnectionEntry, reason: Target.CloseReason) {
    if (!connections.delete(connection.id)) return
    Events.end(connection.frames, endOf(reason))
    yield* Deferred.succeed(connection.closed, reason)
  })

  /** Ends a download its context took with it, unless it already ended (review 14, P3). */
  const cancelDownload = (download: DownloadEntry) =>
    SubscriptionRef.update(
      download.status,
      (status): Download.Status => status._tag === "InProgress" ? { _tag: "Canceled" } : status
    )

  const endPage = Effect.fnUntraced(function*(page: PageEntry, reason: Target.CloseReason) {
    pages.delete(page.id)
    popupUrls.delete(page.id)
    for (const [frame, owner] of frames) if (owner === page) frames.delete(frame)
    const how = endOf(reason)
    for (const channel of Object.values(page.events)) Events.end(channel as Events.Channel<unknown>, how)
    yield* SubscriptionRef.update(
      page.state,
      (state): PageState => state._tag === "Closed" ? state : { _tag: "Closed", reason, url: state.url }
    )
    yield* Deferred.succeed(page.closed, reason)
    const context = contexts.get(page.context)
    if (context !== undefined) {
      yield* SubscriptionRef.update(context.state, (state) => ({
        ...state,
        pages: state.pages.filter((id) => id !== page.id)
      }))
    }
    for (const document of Array.from(documents.values())) {
      if (document.navigable === page.id) yield* endDocument(document.id, reason)
    }
    for (const worker of Array.from(workers.values())) {
      if (Option.isSome(worker.page) && worker.page.value === page) yield* endWorker(worker, reason)
    }
    for (const connection of Array.from(connections.values())) {
      if (connection.page === page) yield* endConnection(connection, reason)
    }
  })

  const context = Effect.fnUntraced(function*(id: UserContext.Id, isDefault: boolean) {
    const existing = contexts.get(id)
    if (existing !== undefined) return existing
    const target: Target.Description = { _tag: "UserContext" }
    const cap = () => entry.eventLog
    const entry: ContextEntry = {
      id,
      isDefault,
      state: yield* SubscriptionRef.make<ContextState>({ pages: [], closed: Option.none() }),
      closed: yield* Deferred.make<Target.CloseReason>(),
      owned: false,
      policy: Option.none(),
      eventLog: defaultEventLog,
      events: {
        autoResolution: Events.make(target, cap),
        request: Events.make(target, cap),
        response: Events.make(target, cap),
        console: Events.make(target, cap),
        exception: Events.make(target, cap),
        download: Events.make(target, cap),
        worker: Events.make(target, cap),
        connection: Events.make(target, cap)
      },
      workers: yield* SubscriptionRef.make<ReadonlyArray<WorkerEntry>>([])
    }
    contexts.set(id, entry)
    return entry
  })

  const end = Effect.fnUntraced(function*(entry: ContextEntry, reason: Target.CloseReason) {
    contexts.delete(entry.id)
    const how = endOf(reason)
    for (const channel of Object.values(entry.events)) Events.end(channel as Events.Channel<unknown>, how)
    for (const worker of Array.from(workers.values())) {
      if (Option.isSome(worker.context) && worker.context.value === entry) yield* endWorker(worker, reason)
    }
    for (const download of Array.from(downloads.values())) {
      if (download.context === entry) {
        downloads.delete(download.id)
        yield* cancelDownload(download)
      }
    }
    yield* SubscriptionRef.update(entry.state, (state) => ({ ...state, closed: Option.some(reason) }))
    yield* Deferred.succeed(entry.closed, reason)
  })

  const setOpen = (page: PageEntry, change: (open: Extract<PageState, { _tag: "Open" }>) => PageState) =>
    SubscriptionRef.update(page.state, (state) => state._tag === "Open" ? change(state) : state)

  const resolve = (obligation: Adapter.ObligationId, decision: Adapter.Decision) =>
    adapter === undefined ? Effect.void : adapter.resolve(obligation, decision).pipe(Effect.ignore)

  /**
   * Decides a dialog (review 13, candidate 6), apart from the fold and from any handler's fiber: the page's
   * latest handler, chosen now; else, or if it doesn't decide, the context's policy, reported as an
   * `AutoResolution`; else nothing, and operations on the page fail with `PromptBlocking`.
   */
  const decide = Effect.fnUntraced(function*(obligation: Adapter.ObligationId, prompt: PromptEvent) {
    const page = pages.get(prompt.page)
    const handler = page?.promptHandlers.at(-1)
    if (handler !== undefined) {
      const decision = yield* handler.decide(prompt)
      if (Option.isSome(decision)) return yield* resolve(obligation, decision.value)
    }
    const context = page === undefined ? undefined : contexts.get(page.context)
    const policy = context?.policy ?? Option.none()
    if (page === undefined || context === undefined || Option.isNone(policy) || policy.value === "leaveOpen") {
      if (page !== undefined) {
        yield* setOpen(page, (open) =>
          Option.isSome(open.prompt) && open.prompt.value.id === prompt.prompt
            ? { ...open, undecided: Option.some({ kind: prompt.kind, text: prompt.message }) }
            : open)
      }
      return
    }
    // `beforeunload` is accepted under "dismiss", so closing never hangs (CONCEPTS.md §5)
    const accept = policy.value === "accept" || prompt.kind === "beforeunload"
    const resolution: AutoResolutionEvent = {
      _tag: "Dialog",
      prompt,
      decision: accept ? "accept" : "dismiss",
      policy: policy.value,
      at: Adapter.now()
    }
    Events.publish(page.events.autoResolution, resolution)
    Events.publish(context.events.autoResolution, resolution)
    yield* resolve(obligation, accept ? { _tag: "Accept", promptText: Option.none() } : { _tag: "Dismiss" })
  })

  /**
   * Decides a file chooser (review 14, candidate 9), as a dialog is decided: the page's latest handler, else
   * cancel, reported as an `AutoResolution`, in a context the library created. A chooser in another context is
   * left as the browser has it.
   */
  const decideChooser = Effect.fnUntraced(function*(obligation: Adapter.ObligationId, chooser: FileChooserEvent) {
    const page = pageOf(chooser.navigable)
    const handler = Option.isSome(page) ? page.value.chooserHandlers.at(-1) : undefined
    if (handler !== undefined) {
      const decision = yield* handler.decide(chooser)
      if (Option.isSome(decision)) return yield* resolve(obligation, decision.value)
    }
    const context = Option.isSome(page) ? contexts.get(page.value.context) : undefined
    if (Option.isNone(page) || context === undefined || !context.owned) return
    const resolution: AutoResolutionEvent = { _tag: "FileChooser", chooser, decision: "cancel", at: Adapter.now() }
    Events.publish(page.value.events.autoResolution, resolution)
    Events.publish(context.events.autoResolution, resolution)
    yield* resolve(obligation, { _tag: "Cancel" })
  })

  /** Closes a popup its opener's scope released, unless it already closed. */
  const release = (page: Target.NavigableId) =>
    Effect.suspend(() =>
      adapter === undefined || !pages.has(page)
        ? Effect.void
        : adapter.closePage(page, { runBeforeUnload: false }).pipe(Effect.ignore)
    )

  /** Keeps a hop, dropping the oldest finished one past `maxHops`, or else the oldest. */
  const keepHop = (id: NetworkRequest.HopId, hop: HopEntry) => {
    hops.set(id, hop)
    if (hops.size <= maxHops) return
    for (const [each, entry] of hops) {
      if (Deferred.isDoneUnsafe(entry.end)) {
        hops.delete(each)
        return
      }
    }
    const [oldest, entry] = hops.entries().next().value!
    hops.delete(oldest)
    Deferred.doneUnsafe(entry.end, Effect.succeed({ _tag: "Forgotten" }))
  }

  const endHop = (id: NetworkRequest.HopId, end: HopEnd) => {
    const hop = hops.get(id)
    if (hop !== undefined) Deferred.doneUnsafe(hop.end, Effect.succeed(end))
  }

  /** The URL a navigation ended at, by its outcome's document; else where it was going. */
  const endedAt = (outcome: Adapter.NavigationOutcome, url: string) => {
    switch (outcome._tag) {
      case "Committed":
      case "SameDocument":
      case "Restored":
      case "Activated":
        return documents.get(outcome.document)?.url ?? url
      default:
        return url
    }
  }

  const fold = (fact: Adapter.Fact): Effect.Effect<void> =>
    Effect.gen(function*() {
      switch (fact._tag) {
        case "UserContextAdded": {
          yield* context(fact.context, fact.isDefault)
          return
        }
        case "UserContextRemoved": {
          const context = contexts.get(fact.context)
          if (context === undefined) return
          contexts.delete(fact.context)
          for (const page of Array.from(pages.values())) {
            if (page.context === fact.context) yield* endPage(page, { _tag: "PageClosed", by: "userContextRemoved" })
          }
          yield* end(context, { _tag: "UserContextRemoved" })
          return
        }
        case "PageAdded": {
          if (pages.has(fact.page)) return
          const owner = yield* context(fact.context, false)
          const target: Target.Description = { _tag: "Page", id: fact.page }
          const cap = () => owner.eventLog
          const entry: PageEntry = {
            id: fact.page,
            context: fact.context,
            state: yield* SubscriptionRef.make<PageState>({ _tag: "Opening", url: fact.url }),
            closed: yield* Deferred.make<Target.CloseReason>(),
            input: yield* Semaphore.make(1),
            inputState: Input.make(),
            owner: Option.none(),
            events: {
              popup: Events.make(target, cap),
              dialog: Events.make(target, cap),
              fileChooser: Events.make(target, cap),
              autoResolution: Events.make(target, cap),
              navigation: Events.make(target, cap),
              request: Events.make(target, cap),
              response: Events.make(target, cap),
              console: Events.make(target, cap),
              exception: Events.make(target, cap),
              download: Events.make(target, cap),
              worker: Events.make(target, cap),
              connection: Events.make(target, cap)
            },
            promptHandlers: [],
            chooserHandlers: [],
            workers: yield* SubscriptionRef.make<ReadonlyArray<WorkerEntry>>([])
          }
          pages.set(fact.page, entry)
          // A popup is reported to its opener, when the backend names one (review 13, candidate 4); before the
          // context's pages change, so a caller woken by that change subscribes after it, as with every event
          const opener = fact.kind === "popup" && fact.origin._tag === "Opened"
            ? Option.flatMap(fact.origin.opener, (id) => Option.fromNullishOr(pages.get(id)))
            : Option.none()
          if (Option.isSome(opener)) {
            const event: PopupEvent = {
              page: entry,
              url: placeholder(fact.url) ? Option.none() : Option.some(fact.url)
            }
            const published = Events.publish(opener.value.events.popup, event)
            if (Option.isNone(event.url)) {
              popupUrls.set(fact.page, { channel: opener.value.events.popup, entry: published })
            }
            // Owned with its opener, released by the scope that acquired it (CONCEPTS.md §3); forked, since a
            // scope that already closed runs the release at once, and the fold must not wait on the browser
            if (Option.isSome(opener.value.owner)) {
              const scope = opener.value.owner.value
              entry.owner = Option.some(scope)
              yield* Scope.addFinalizer(scope, release(fact.page)).pipe(Effect.forkIn(modelScope))
            }
          }
          yield* SubscriptionRef.update(owner.state, (state) => ({ ...state, pages: [...state.pages, fact.page] }))
          return
        }
        case "FrameAdded": {
          const page = pageOf(fact.page)
          if (Option.isSome(page)) frames.set(fact.frame, page.value)
          return
        }
        case "NavigationStarted": {
          // A popup's first navigation says where it was opened to
          const pending = popupUrls.get(fact.navigable)
          if (pending !== undefined && !placeholder(fact.url)) {
            popupUrls.delete(fact.navigable)
            pending.entry.value.url = Option.some(fact.url)
            Events.revise(pending.channel, pending.entry)
          }
          // A page's own navigations are its events; a frame's wait for frames (review 14, candidate 6)
          const page = pages.get(fact.navigable)
          if (page !== undefined) {
            started.set(fact.navigation, { page, url: fact.url })
            if (started.size > maxNavigations) started.delete(started.keys().next().value!)
          }
          return
        }
        case "NavigableRemoved": {
          frames.delete(fact.navigable)
          const page = pages.get(fact.navigable)
          if (page !== undefined) {
            yield* endPage(page, fact.reason)
          }
          return
        }
        case "DocumentCommitted": {
          if (Option.isSome(fact.replaced)) yield* endDocument(fact.replaced.value, { _tag: "DocumentReplaced" })
          const page = pages.get(fact.navigable)
          // A frame's document: frames aren't folded yet
          if (page === undefined) return
          documents.set(fact.document, {
            id: fact.document,
            navigable: fact.navigable,
            readiness: yield* SubscriptionRef.make<"loading" | "interactive" | "complete">("loading"),
            ended: yield* Deferred.make<Target.CloseReason>(),
            url: fact.url
          })
          yield* SubscriptionRef.update(page.state, (state): PageState =>
            state._tag === "Closed" ? state : {
              _tag: "Open",
              url: fact.url,
              document: { id: fact.document, readiness: "loading", lifecycle: "active" },
              prompt: state._tag === "Open" ? state.prompt : Option.none(),
              undecided: state._tag === "Open" ? state.undecided : Option.none()
            })
          return
        }
        case "DocumentUrlChanged": {
          const document = documents.get(fact.document)
          if (document !== undefined) document.url = fact.url
          const page = document === undefined ? undefined : pages.get(document.navigable)
          if (page !== undefined) {
            yield* setOpen(page, (open) => open.document.id === fact.document ? { ...open, url: fact.url } : open)
          }
          return
        }
        // The page's status first, then the document's readiness: a wait woken by the readiness reads the status
        case "DocumentOpened": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* setOpen(page, (open) =>
              open.document.id === fact.document
                ? { ...open, document: { ...open.document, readiness: "loading" } }
                : open)
          }
          yield* SubscriptionRef.set(document.readiness, "loading")
          return
        }
        case "DocumentReadiness": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* setOpen(page, (open) =>
              open.document.id === fact.document
                ? { ...open, document: { ...open.document, readiness: fact.readiness } }
                : open)
          }
          yield* SubscriptionRef.set(document.readiness, fact.readiness)
          return
        }
        case "RealmAdded": {
          if (fact.kind._tag === "Window") {
            realmDocuments.set(fact.realm, fact.kind.document)
            realmOwners.set(fact.realm, ownerOfPage(pageOf(fact.kind.navigable)))
            return
          }
          // A worker: a dedicated one belongs to its page, a shared or service one to its context
          const page = Option.flatMap(fact.kind.page, pageOf)
          const context = Option.isSome(page)
            ? Option.fromNullishOr(contexts.get(page.value.context))
            : Option.flatMap(fact.kind.context, (id) => Option.fromNullishOr(contexts.get(id)))
          const worker: WorkerEntry = {
            realm: fact.realm,
            kind: workerKinds[fact.kind.worker._tag],
            url: fact.kind.url,
            page,
            context,
            closed: yield* Deferred.make<Target.CloseReason>()
          }
          workers.set(fact.realm, worker)
          realmOwners.set(fact.realm, { page, context })
          publish({ page, context }, worker, (events) => events.worker, (events) => events.worker)
          const add = (list: ReadonlyArray<WorkerEntry>) => [...list, worker]
          if (Option.isSome(page)) yield* SubscriptionRef.update(page.value.workers, add)
          if (Option.isSome(context)) yield* SubscriptionRef.update(context.value.workers, add)
          return
        }
        case "RealmRemoved": {
          const document = realmDocuments.get(fact.realm)
          realmDocuments.delete(fact.realm)
          if (document !== undefined && engineRealms.get(document) === fact.realm) engineRealms.delete(document)
          const worker = workers.get(fact.realm)
          if (worker !== undefined) yield* endWorker(worker, fact.reason)
          else realmOwners.delete(fact.realm)
          return
        }
        case "NavigationEnded": {
          // The event first, then the outcome: `goto` returns once the outcome is latched, and a `next` its caller
          // subscribes then must not see the navigation `goto` made (found by review 16's build)
          const start = started.get(fact.navigation)
          if (start !== undefined) {
            started.delete(fact.navigation)
            if (pages.has(start.page.id)) {
              Events.publish(start.page.events.navigation, {
                navigation: fact.navigation,
                url: endedAt(fact.outcome, start.url),
                outcome: fact.outcome
              })
            }
          }
          yield* Deferred.succeed(navigation(fact.navigation).outcome, fact.outcome)
          return
        }
        case "RequestSent": {
          const initiator = fact.request.initiator
          if (initiator._tag === "Document" && Option.isSome(initiator.navigation)) {
            navigationHops.add(fact.request.hop)
          }
          const owner = initiator._tag === "Document"
            ? ownerOfPage(pageOf(initiator.navigable))
            : initiator._tag === "Worker"
            ? realmOwners.get(initiator.realm) ?? nobody
            : nobody
          keepHop(fact.request.hop, {
            request: fact.request,
            response: Option.none(),
            end: Deferred.makeUnsafe<HopEnd>(),
            page: owner.page,
            context: owner.context
          })
          publish(owner, fact.request, (events) => events.request, (events) => events.request)
          return
        }
        case "ResponseReceived": {
          if (navigationHops.delete(fact.response.hop)) {
            responses.set(fact.response.hop, fact.response)
            if (responses.size > maxResponses) responses.delete(responses.keys().next().value!)
          }
          const hop = hops.get(fact.response.hop)
          if (hop === undefined) return
          hop.response = Option.some(fact.response)
          publish(
            hop,
            { response: fact.response, hop },
            (events) => events.response,
            (events) => events.response
          )
          return
        }
        case "RequestFinished": {
          endHop(fact.hop, { _tag: "Finished", encodedBytes: fact.encodedBytes })
          return
        }
        case "RequestFailed": {
          endHop(fact.hop, { _tag: "Failed", error: fact.error })
          return
        }
        case "ConsoleMessage": {
          const owner = realmOwners.get(fact.realm) ??
            (fact.message.origin._tag === "Page" ? ownerOfPage(pageOf(fact.message.origin.page)) : nobody)
          publish(owner, fact.message, (events) => events.console, (events) => events.console)
          return
        }
        case "UncaughtException": {
          const origin = fact.exception.origin
          const owner = Option.flatMap(fact.realm, (realm) => Option.fromNullishOr(realmOwners.get(realm))).pipe(
            Option.getOrElse(() => origin._tag === "Page" ? ownerOfPage(pageOf(origin.page)) : nobody)
          )
          publish(owner, fact.exception, (events) => events.exception, (events) => events.exception)
          return
        }
        case "ConnectionOpened": {
          const page = Option.flatMap(fact.navigable, pageOf)
          if (Option.isNone(page)) return
          const owner = ownerOfPage(page)
          const connection: ConnectionEntry = {
            id: fact.connection,
            kind: fact.kind,
            url: fact.url,
            openedAt: DateTime.nowUnsafe(),
            page: page.value,
            frames: Events.make({ _tag: "Page", id: page.value.id }, () =>
              Option.match(owner.context, {
                onNone: () => defaultEventLog,
                onSome: (context) => context.eventLog
              })),
            closed: yield* Deferred.make<Target.CloseReason>()
          }
          connections.set(fact.connection, connection)
          publish(owner, connection, (events) => events.connection, (events) => events.connection)
          return
        }
        case "ConnectionFrame": {
          const connection = connections.get(fact.connection)
          if (connection !== undefined) Events.publish(connection.frames, fact.frame)
          return
        }
        case "ConnectionClosed": {
          const connection = connections.get(fact.connection)
          if (connection !== undefined) yield* endConnection(connection, { _tag: "NetworkConnectionClosed" })
          return
        }
        case "DownloadStarted": {
          const page = pageOf(fact.page)
          const context = Option.flatMap(page, (page) => Option.fromNullishOr(contexts.get(page.context)))
          if (Option.isNone(page) || Option.isNone(context)) return
          const download: DownloadEntry = {
            id: fact.download,
            page: page.value,
            context: context.value,
            url: fact.url,
            suggestedFilename: fact.suggestedFilename,
            status: yield* SubscriptionRef.make<Download.Status>({
              _tag: "InProgress",
              received: 0,
              total: Option.none()
            }),
            path: Option.none()
          }
          downloads.set(fact.download, download)
          publish({ page, context }, download, (events) => events.download, (events) => events.download)
          return
        }
        case "DownloadProgress": {
          const download = downloads.get(fact.download)
          if (download === undefined) return
          yield* SubscriptionRef.update(download.status, (status): Download.Status =>
            status._tag === "InProgress"
              ? { _tag: "InProgress", received: fact.receivedBytes, total: fact.totalBytes }
              : status)
          return
        }
        case "DownloadEnded": {
          // What a backend reports after the download's context ended is ignored (review 14, P3)
          const download = downloads.get(fact.download)
          if (download === undefined) return
          downloads.delete(fact.download)
          if (fact.outcome._tag === "Completed") download.path = fact.outcome.path
          const outcome = fact.outcome
          yield* SubscriptionRef.update(download.status, (status): Download.Status =>
            status._tag !== "InProgress"
              ? status
              : outcome._tag === "Completed"
              ? { _tag: "Completed" }
              : { _tag: "Canceled" })
          return
        }
        case "ObligationOpened": {
          if (fact.subject._tag === "FileChooser") {
            const chooser = fact.subject
            const page = pageOf(chooser.navigable)
            if (Option.isSome(page)) Events.publish(page.value.events.fileChooser, chooser)
            yield* decideChooser(fact.obligation, chooser).pipe(Effect.forkIn(modelScope))
            return
          }
          if (fact.subject._tag !== "Prompt") return
          const subject = fact.subject
          prompts.set(subject.prompt, subject.page)
          const page = pages.get(subject.page)
          if (page !== undefined) {
            Events.publish(page.events.dialog, subject)
            yield* setOpen(page, (open) => ({
              ...open,
              prompt: Option.some({ id: subject.prompt, kind: subject.kind, blocking: "confirmed" })
            }))
          }
          yield* decide(fact.obligation, subject).pipe(Effect.forkIn(modelScope))
          return
        }
        case "PromptClosed": {
          const id = prompts.get(fact.prompt)
          prompts.delete(fact.prompt)
          const page = id === undefined ? undefined : pages.get(id)
          if (page !== undefined) {
            yield* setOpen(page, (open) => ({ ...open, prompt: Option.none(), undecided: Option.none() }))
          }
          return
        }
        default:
          return
      }
    })

  /** Ends everything the connection held, when it is lost. */
  const loseConnection = Effect.gen(function*() {
    const reason: Target.CloseReason = { _tag: "ConnectionLost" }
    for (const page of Array.from(pages.values())) yield* endPage(page, reason)
    for (const document of Array.from(documents.keys())) yield* endDocument(document, reason)
    for (const worker of Array.from(workers.values())) yield* endWorker(worker, reason)
    for (const connection of Array.from(connections.values())) yield* endConnection(connection, reason)
    for (const each of Array.from(contexts.values())) yield* end(each, reason)
    contexts.clear()
    for (const entry of navigations.values()) {
      yield* Deferred.succeed(entry.outcome, { _tag: "Failed", error: "connection lost", errorDocument: Option.none() })
    }
    for (const hop of hops.values()) {
      Deferred.doneUnsafe(hop.end, Effect.succeed({ _tag: "Failed", error: "connection lost" }))
    }
    yield* Deferred.succeed(lost, undefined)
  })

  /** Gives the model its adapter, once connected, and watches for the connection's loss. */
  const attach = (connected: Adapter.AdapterConnection): Effect.Effect<Model, never, Scope.Scope> =>
    Effect.gen(function*() {
      adapter = connected
      yield* connected.closed.pipe(Effect.andThen(loseConnection), Effect.forkScoped)
      return {
        adapter: connected,
        contexts,
        context: (id) => context(id, false),
        pages,
        documents,
        navigation,
        forget: (id) => void navigations.delete(id),
        response: (hop) => Option.fromNullishOr(responses.get(hop)),
        engineRealms,
        lost
      }
    })

  return { sink: fold, attach }
})
