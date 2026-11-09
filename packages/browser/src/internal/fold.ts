/**
 * The fold (CONCEPTS.md §2): the only writer of the model. The adapter's facts and the caller's commands are one
 * ordered stream: each input is applied in full, one at a time, in the order it arrived, with the model's context.
 * A fact is the adapter's sink, so it is folded in receive order, before the adapter publishes the event; a
 * command is how a caller's setting reaches the model, such as a handler's registration, so it is ordered against
 * the facts: a dialog folded after a registration returned is that handler's to decide.
 *
 * A step never waits on the browser or on a caller, so the stream never stalls: what a decision needs from the
 * browser happens apart (`obligations.ts`, `ownership.ts`), and comes back as a command for what it writes.
 *
 * Each entity's state is a `SubscriptionRef` only the fold holds; the entity carries its read side
 * (`readable.ts`). The fold's tables, which find an entity by id, are its own, and its indexes of requests and
 * navigations are bounded (`networkIndex.ts`).
 */
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Dialog from "../Dialog.ts"
import type * as Download from "../Download.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
import * as Events from "./events.ts"
import * as Input from "./input.ts"
import type * as Model from "./model.ts"
import * as NetworkIndex from "./networkIndex.ts"
import type * as Obligations from "./obligations.ts"
import * as Readable from "./readable.ts"
import * as Urls from "./urls.ts"

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

/** A context's settings until the library sets them: none of its policies, as for a context it didn't create. */
const defaultSettings: Model.ContextSettings = {
  owned: false,
  reclaimable: false,
  policy: Option.none(),
  eventLog: defaultEventLog,
  keyboardLayout: "us"
}

/** How a target's end ends its event streams: normally when it was closed, or with `TargetGone` otherwise. */
const endOf = (reason: Target.CloseReason): Events.End => ({
  normal: reason._tag === "PageClosed" || reason._tag === "UserContextRemoved" ||
    reason._tag === "NetworkConnectionClosed",
  reason
})

/** A URL a popup reports before it navigates, which says nothing about where it was opened to. */
const placeholder = (url: string) => url === "" || url === "about:blank"

const workerKinds = { Dedicated: "dedicated", Shared: "shared", Service: "service" } as const

const nobody: Model.Owner = { page: Option.none(), context: Option.none() }

/** The fold, as the model and the deciders use it. */
export interface Fold {
  /** The adapter's sink: folds a fact, and returns once it is applied. */
  readonly sink: Adapter.Sink
  /** Obligations as they open, with who decides each, for the deciders (`obligations.ts`). */
  readonly obligations: Queue.Dequeue<Obligations.Obligation>

  // Reads
  readonly pages: Readable.Readable<ReadonlyArray<Model.PageEntry>>
  readonly page: (id: Target.NavigableId) => Option.Option<Model.PageEntry>
  readonly document: (id: Target.DocumentId) => Option.Option<Model.DocumentEntry>
  readonly documentOf: (navigable: Target.NavigableId) => Effect.Effect<Option.Option<Target.DocumentId>>
  readonly response: (hop: NetworkRequest.HopId) => Option.Option<NetworkResponse.NetworkResponse>
  readonly hop: (hop: NetworkRequest.HopId) => Option.Option<Model.HopEntry>
  readonly lost: Deferred.Deferred<void>

  // Commands
  readonly context: (id: UserContext.Id, isDefault: boolean) => Effect.Effect<Model.ContextEntry>
  readonly configure: (context: Model.ContextEntry, settings: Model.ContextSettings) => Effect.Effect<void>
  readonly navigation: (id: PageNavigation.Id) => Effect.Effect<Model.NavigationEntry>
  readonly forget: (id: PageNavigation.Id) => Effect.Effect<void>
  readonly register: <K extends "promptHandlers" | "chooserHandlers">(
    page: Model.PageEntry,
    key: K,
    handler: Model.PageState[K][number]
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly route: (
    owner: Model.PageEntry | Model.ContextEntry,
    route: Model.RouteEntry
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly grant: (context: Model.ContextEntry, grant: Model.GrantEntry) => Effect.Effect<void, never, Scope.Scope>
  readonly own: (page: Model.PageEntry, scope: Scope.Scope) => Effect.Effect<void>
  /** A handler's stay at the page's `beforeunload` prompt, which the browser accepted. */
  readonly stayed: (page: Model.PageEntry) => Effect.Effect<void>
  /** The page's open prompt, which nothing will decide: operations on the page fail with `PromptBlocking`. */
  readonly undecided: (page: Model.PageEntry, prompt: Model.PromptEvent) => Effect.Effect<void>
  /** Publishes a decision a policy or the default made, on the page's and the context's channels. */
  readonly autoResolved: (owner: Model.Owner, event: Model.AutoResolutionEvent) => Effect.Effect<void>
  /** Ends everything the connection held, when it is lost. */
  readonly loseConnection: Effect.Effect<void>
}

/** One input: a step of the fold, and who waits for it to be applied. */
interface Input {
  readonly step: Effect.Effect<unknown>
  readonly done: Deferred.Deferred<unknown>
}

export const make = Effect.fnUntraced(function*(options: {
  /** Releases a popup its opener's owner releases (`ownership.ts`). */
  readonly release: (page: Model.PageEntry, by: Scope.Scope) => Effect.Effect<void>
}) {
  const modelScope = yield* Effect.scope

  // ── The stream ──

  // Every step runs with the model's context, whoever applies it: what it forks carries no caller's operation,
  // deadline or span
  const context = yield* Effect.context<never>()
  const inbox: Array<Input> = []
  let busy = false
  /** Applies what arrived while a step ran, in arrival order; idle once there is nothing left. */
  const drain: Effect.Effect<void> = Effect.suspend(() => {
    const next = inbox.shift()
    if (next === undefined) {
      busy = false
      return Effect.void
    }
    return Effect.exit(Effect.provideContext(next.step, context)).pipe(
      Effect.flatMap((exit) => Deferred.done(next.done, exit)),
      Effect.andThen(drain)
    )
  })
  /**
   * Applies a step in its turn and returns once it is applied. An input that finds the fold idle is applied at once,
   * on its caller's fiber, and then whatever arrived meanwhile; one that finds a step running waits in the inbox
   * for the fiber applying it. So a protocol event's facts, which the adapter delivers back to back, are applied
   * back to back, and no reader sees half of one.
   */
  const apply = <A>(step: Effect.Effect<A>): Effect.Effect<A> =>
    Effect.suspend((): Effect.Effect<A> => {
      if (busy) {
        const done = Deferred.makeUnsafe<A>()
        inbox.push({ step, done: done as Deferred.Deferred<unknown> })
        return Deferred.await(done)
      }
      busy = true
      return Effect.uninterruptible(
        Effect.flatMap(Effect.exit(Effect.provideContext(step, context)), (exit) => Effect.as(drain, exit))
      ).pipe(Effect.flatten)
    })

  // ── State: the refs behind every entity's `Readable`, which only the fold holds ──

  const refs = new WeakMap<Readable.Readable<any>, SubscriptionRef.SubscriptionRef<any>>()
  const cell = <S>(initial: S) =>
    Effect.map(SubscriptionRef.make(initial), (ref) => {
      const readable = Readable.of(ref)
      refs.set(readable, ref)
      return readable
    })
  const update = <S>(state: Readable.Readable<S>, f: (state: S) => S) =>
    SubscriptionRef.update(refs.get(state) as SubscriptionRef.SubscriptionRef<S>, f)

  const contexts = new Map<UserContext.Id, Model.ContextEntry>()
  const pages = new Map<Target.NavigableId, Model.PageEntry>()
  // Every page of the browser, in the order they were added
  const pageList = yield* cell<ReadonlyArray<Model.PageEntry>>([])
  // Frames, by the page they belong to
  const frames = new Map<Target.NavigableId, Model.PageEntry>()
  const documents = new Map<Target.DocumentId, Model.DocumentEntry>()
  const navigations = NetworkIndex.bounded<PageNavigation.Id, Model.NavigationEntry>(maxNavigations)
  // A page's navigations and its frames', from their start to their end: where they went, for the event
  const started = NetworkIndex.bounded<
    PageNavigation.Id,
    { readonly page: Model.PageEntry; readonly frame: Target.NavigableId; readonly url: Url.Url }
  >(maxNavigations)
  const navigationHops = new Set<NetworkRequest.HopId>()
  const responses = NetworkIndex.bounded<NetworkRequest.HopId, NetworkResponse.NetworkResponse>(maxResponses)
  const hops = NetworkIndex.hops<Model.HopEntry, Model.HopEnd>(maxHops, { _tag: "Forgotten" }, (hop) => {
    if (Option.isSome(hop.context)) hop.context.value.timings?.delete(hop.request.hop)
    Deferred.doneUnsafe(hop.sentKnown, Effect.void)
  })
  const realmDocuments = new Map<Target.RealmId, Target.DocumentId>()
  const realmOwners = new Map<Target.RealmId, Model.Owner>()
  const workers = new Map<Target.RealmId, Model.WorkerEntry>()
  const downloads = new Map<Download.Id, Model.DownloadEntry>()
  const connections = new Map<NetworkConnection.Id, Model.ConnectionEntry>()
  const prompts = new Map<Dialog.PromptId, Target.NavigableId>()
  // Popups whose URL is still unknown, until their first navigation starts
  const popupUrls = new Map<
    Target.NavigableId,
    {
      readonly channel: Events.Channel<Model.PopupEvent>
      readonly entry: Events.Entry<Model.PopupEvent>
      readonly url: Model.PopupEvent["url"]
    }
  >()
  const lost = yield* Deferred.make<void>()
  const obligations = yield* Queue.unbounded<Obligations.Obligation>()

  // ── Reads ──

  /** The page a navigable belongs to: itself, or a frame's page. */
  const pageOf = (navigable: Target.NavigableId): Option.Option<Model.PageEntry> =>
    Option.fromNullishOr(pages.get(navigable) ?? frames.get(navigable))

  const documentOf = (navigable: Target.NavigableId): Effect.Effect<Option.Option<Target.DocumentId>> =>
    Effect.gen(function*() {
      const page = pages.get(navigable)
      if (page !== undefined) {
        const { status } = yield* page.state.get
        return status._tag === "Open" ? Option.some(status.document.id) : Option.none()
      }
      const owner = frames.get(navigable)
      if (owner === undefined) return Option.none()
      const frame = (yield* owner.state.get).frames.find((each) => each.id === navigable)
      return Option.flatMap(Option.fromNullishOr(frame), (each) => each.document).pipe(
        Option.filter((document) => documents.has(document))
      )
    })

  const ownerOfPage = (page: Option.Option<Model.PageEntry>): Model.Owner =>
    Option.isNone(page) ? nobody : { page, context: Option.some(page.value.contextEntry) }

  /** Publishes to the page's channel and its context's, whichever there are. */
  const publish = <A>(
    owner: Model.Owner,
    value: A,
    pageChannel: (events: Model.PageEvents) => Events.Channel<A>,
    contextChannel: (events: Model.ContextEvents) => Events.Channel<A>
  ) => {
    if (Option.isSome(owner.page)) Events.publish(pageChannel(owner.page.value.events), value)
    if (Option.isSome(owner.context)) Events.publish(contextChannel(owner.context.value.events), value)
  }

  const updateOpen = (
    page: Model.PageEntry,
    change: (open: Extract<Model.PageStatus, { _tag: "Open" }>) => Model.PageStatus
  ) => update(page.state, (state) => state.status._tag === "Open" ? { ...state, status: change(state.status) } : state)

  /** The navigation's entry, made now if it isn't there yet. */
  const navigation = (id: PageNavigation.Id): Model.NavigationEntry =>
    Option.getOrElse(navigations.get(id), () => {
      const entry: Model.NavigationEntry = { id, outcome: Deferred.makeUnsafe<Adapter.NavigationOutcome>() }
      navigations.set(id, entry)
      return entry
    })

  // ── Ending things ──

  const endDocument = (id: Target.DocumentId, reason: Target.CloseReason) =>
    Effect.suspend(() => {
      const entry = documents.get(id)
      if (entry === undefined) return Effect.void
      documents.delete(id)
      return Deferred.succeed(entry.ended, reason)
    })

  /** Removes a frame and the frames inside it, and ends their documents. */
  const removeFrame = Effect.fnUntraced(function*(page: Model.PageEntry, id: Target.NavigableId) {
    const list = (yield* page.state.get).frames
    const gone = new Set([id])
    for (let grew = true; grew;) {
      grew = false
      for (const frame of list) {
        if (!gone.has(frame.id) && gone.has(frame.parent)) {
          gone.add(frame.id)
          grew = true
        }
      }
    }
    for (const hop of hops.values()) {
      const initiator = hop.request.initiator
      if (initiator._tag === "Document" && gone.has(initiator.navigable)) {
        if (Option.isSome(hop.context)) hop.context.value.timings?.delete(hop.request.hop)
        Deferred.doneUnsafe(hop.sentKnown, Effect.void)
      }
    }
    for (const frame of gone) frames.delete(frame)
    yield* update(page.state, (state) => ({ ...state, frames: state.frames.filter((frame) => !gone.has(frame.id)) }))
    for (const document of Array.from(documents.values())) {
      if (gone.has(document.navigable)) yield* endDocument(document.id, new Target.FrameDetached({}))
    }
  })

  const endWorker = Effect.fnUntraced(function*(worker: Model.WorkerEntry, reason: Target.CloseReason) {
    if (!workers.delete(worker.realm)) return
    realmOwners.delete(worker.realm)
    for (const hop of hops.values()) {
      const initiator = hop.request.initiator
      if (initiator._tag === "Worker" && initiator.realm === worker.realm) {
        if (Option.isSome(hop.context)) hop.context.value.timings?.delete(hop.request.hop)
        Deferred.doneUnsafe(hop.sentKnown, Effect.void)
      }
    }
    const without = <S extends { readonly workers: ReadonlyArray<Model.WorkerEntry> }>(state: S): S => ({
      ...state,
      workers: state.workers.filter((each) => each !== worker)
    })
    if (Option.isSome(worker.page)) yield* update(worker.page.value.state, without)
    if (Option.isSome(worker.context)) yield* update(worker.context.value.state, without)
    yield* Deferred.succeed(worker.closed, reason)
  })

  const endConnection = Effect.fnUntraced(function*(connection: Model.ConnectionEntry, reason: Target.CloseReason) {
    if (!connections.delete(connection.id)) return
    Events.end(connection.frames, endOf(reason))
    yield* Deferred.succeed(connection.closed, reason)
  })

  /** Ends a download its context took with it, unless it already ended. */
  const cancelDownload = (download: Model.DownloadEntry) =>
    update(
      download.state,
      (state): Model.DownloadState =>
        state.status._tag === "InProgress" ? { ...state, status: { _tag: "Canceled" } } : state
    )

  const endPage = Effect.fnUntraced(function*(page: Model.PageEntry, reason: Target.CloseReason) {
    if (page.contextEntry.timings !== undefined) {
      for (const hop of hops.values()) {
        if (Option.getOrUndefined(hop.page) === page) page.contextEntry.timings.delete(hop.request.hop)
      }
    }
    pages.delete(page.id)
    yield* update(pageList, (list) => list.filter((each) => each !== page))
    popupUrls.delete(page.id)
    for (const [frame, owner] of frames) if (owner === page) frames.delete(frame)
    const how = endOf(reason)
    for (const channel of Object.values(page.events)) Events.end(channel as Events.Channel<unknown>, how)
    yield* update(page.state, (state): Model.PageState => ({
      ...state,
      status: state.status._tag === "Closed" ? state.status : { _tag: "Closed", reason, url: state.status.url },
      frames: []
    }))
    // Out of its context's pages before its end is told, so whoever waits for the end, as `Page.close` does, finds
    // it gone from the context too
    yield* update(page.contextEntry.state, (state) => ({
      ...state,
      pages: state.pages.filter((each) => each !== page)
    }))
    // A removed page can leave requests without terminal network events. Settle their header waits with
    // what is already known; do not invent a network failure or attribute still-ambiguous ExtraInfo.
    for (const hop of hops.values()) {
      if (Option.isSome(hop.page) && hop.page.value === page) Deferred.doneUnsafe(hop.sentKnown, Effect.void)
    }
    yield* Deferred.succeed(page.closed, reason)
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

  const ensureContext = Effect.fnUntraced(function*(id: UserContext.Id, isDefault: boolean) {
    const existing = contexts.get(id)
    if (existing !== undefined) return existing
    const target: Target.Description = { _tag: "UserContext" }
    const state = yield* cell<Model.ContextState>({
      pages: [],
      workers: [],
      closed: Option.none(),
      settings: defaultSettings,
      routes: [],
      grants: []
    })
    const cap = () => state.getUnsafe().settings.eventLog
    const entry: Model.ContextEntry = {
      id,
      isDefault,
      state,
      closed: yield* Deferred.make<Target.CloseReason>(),
      events: {
        autoResolution: Events.make(target, cap),
        request: Events.make(target, cap),
        response: Events.make(target, cap),
        console: Events.make(target, cap),
        exception: Events.make(target, cap),
        download: Events.make(target, cap),
        worker: Events.make(target, cap),
        connection: Events.make(target, cap)
      }
    }
    contexts.set(id, entry)
    return entry
  })

  const endContext = Effect.fnUntraced(function*(entry: Model.ContextEntry, reason: Target.CloseReason) {
    entry.timings?.clear()
    contexts.delete(entry.id)
    for (const hop of hops.values()) {
      if (Option.isSome(hop.context) && hop.context.value === entry) Deferred.doneUnsafe(hop.sentKnown, Effect.void)
    }
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
    yield* update(entry.state, (state) => ({ ...state, closed: Option.some(reason) }))
    yield* Deferred.succeed(entry.closed, reason)
  })

  const endHop = (id: NetworkRequest.HopId, end: Model.HopEnd) => {
    const hop = hops.get(id)
    if (Option.isNone(hop)) return
    Deferred.doneUnsafe(hop.value.end, Effect.succeed(end))
    Deferred.doneUnsafe(hop.value.sentKnown, Effect.void)
  }

  /** The URL a navigation ended at, by its outcome's document; else where it was going. */
  const endedAt = (outcome: Adapter.NavigationOutcome, url: Url.Url) => {
    switch (outcome._tag) {
      case "Committed":
      case "SameDocument":
      case "Restored":
      case "Activated": {
        const document = documents.get(outcome.document)
        return document === undefined ? url : document.state.getUnsafe().url
      }
      default:
        return url
    }
  }

  /** Where an event from a request belongs: its document's page, or its worker's owner. */
  const ownerOfRequest = (request: NetworkRequest.NetworkRequest | Model.PausedRequestEvent["request"]) => {
    const initiator = request.initiator
    return initiator._tag === "Document"
      ? ownerOfPage(pageOf(initiator.navigable))
      : initiator._tag === "Worker"
      ? realmOwners.get(initiator.realm) ?? nobody
      : nobody
  }

  // ── Facts ──

  const fold = (fact: Adapter.Fact): Effect.Effect<void> =>
    Effect.gen(function*() {
      switch (fact._tag) {
        case "UserContextAdded": {
          const entry = yield* ensureContext(fact.context, fact.isDefault)
          if (fact.requestTiming) entry.timings ??= new Map()
          return
        }
        case "UserContextRemoved": {
          const context = contexts.get(fact.context)
          if (context === undefined) return
          contexts.delete(fact.context)
          for (const page of Array.from(pages.values())) {
            if (page.context === fact.context) yield* endPage(page, new Target.PageClosed({ by: "userContextRemoved" }))
          }
          yield* endContext(context, new Target.UserContextRemoved({}))
          return
        }
        case "PageAdded": {
          if (pages.has(fact.page)) return
          const context = yield* ensureContext(fact.context, false)
          const target: Target.Description = { _tag: "Page", id: fact.page }
          const cap = () => context.state.getUnsafe().settings.eventLog
          const opener = fact.kind === "popup" && fact.origin._tag === "Opened"
            ? Option.flatMap(fact.origin.opener, (id) => Option.fromNullishOr(pages.get(id)))
            : Option.none()
          // Owned with its opener, released by the scope that acquired it (CONCEPTS.md §3)
          const owner = Option.flatMap(opener, (page) => page.state.getUnsafe().owner)
          const entry: Model.PageEntry = {
            id: fact.page,
            context: fact.context,
            contextEntry: context,
            state: yield* cell<Model.PageState>({
              dialog: Option.none(),
              status: { _tag: "Opening", url: fact.url },
              frames: [],
              workers: [],
              owner,
              promptHandlers: [],
              chooserHandlers: [],
              routes: [],
              stayed: 0
            }),
            closed: yield* Deferred.make<Target.CloseReason>(),
            input: yield* Semaphore.make(1),
            inputState: Input.make(),
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
            }
          }
          pages.set(fact.page, entry)
          // A popup is reported to its opener, when the backend names one; before the
          // context's pages change, so a caller woken by that change subscribes after it, as with every event
          if (Option.isSome(opener)) {
            const known = placeholder(fact.url) ? Option.none<Url.Url>() : Option.some(fact.url)
            const event: Model.PopupEvent = { page: entry, url: yield* cell(known) }
            const published = Events.publish(opener.value.events.popup, event)
            if (Option.isNone(known)) {
              popupUrls.set(fact.page, { channel: opener.value.events.popup, entry: published, url: event.url })
            }
          }
          // Forked, since a scope that already closed runs the release at once, and the fold must not wait on the
          // browser
          if (Option.isSome(owner)) {
            yield* Scope.addFinalizer(owner.value, options.release(entry, owner.value)).pipe(Effect.forkIn(modelScope))
          }
          yield* update(context.state, (state) => ({ ...state, pages: [...state.pages, entry] }))
          yield* update(pageList, (list) => [...list, entry])
          return
        }
        case "FrameAdded": {
          const page = pageOf(fact.page)
          if (Option.isNone(page)) return
          frames.set(fact.frame, page.value)
          const frame: Model.FrameEntry = {
            id: fact.frame,
            parent: fact.parent,
            document: Option.none(),
            url: Urls.reported("about:blank")
          }
          yield* update(page.value.state, (state) => ({
            ...state,
            frames: [...state.frames.filter((each) => each.id !== fact.frame), frame]
          }))
          return
        }
        case "NavigationStarted": {
          // A popup's first navigation says where it was opened to
          const pending = popupUrls.get(fact.navigable)
          if (pending !== undefined && !placeholder(fact.url)) {
            popupUrls.delete(fact.navigable)
            yield* update(pending.url, () => Option.some(fact.url))
            Events.revise(pending.channel, pending.entry)
          }
          // A page's navigations are its events, and its frames' too, each naming its navigable
          const page = pageOf(fact.navigable)
          if (Option.isSome(page)) {
            started.set(fact.navigation, { page: page.value, frame: fact.navigable, url: fact.url })
          }
          return
        }
        case "NavigableRemoved": {
          const owner = frames.get(fact.navigable)
          if (owner !== undefined) yield* removeFrame(owner, fact.navigable)
          const page = pages.get(fact.navigable)
          if (page !== undefined) yield* endPage(page, fact.reason)
          return
        }
        case "DocumentCommitted": {
          if (Option.isSome(fact.replaced)) yield* endDocument(fact.replaced.value, new Target.DocumentReplaced({}))
          const page = pages.get(fact.navigable)
          const owner = frames.get(fact.navigable)
          if (page === undefined && owner === undefined) return
          documents.set(fact.document, {
            id: fact.document,
            navigable: fact.navigable,
            state: yield* cell<Model.DocumentState>({ url: fact.url, readiness: "loading" }),
            ended: yield* Deferred.make<Target.CloseReason>()
          })
          if (page === undefined) {
            // A frame's document: the frame's entry follows it
            yield* update(owner!.state, (state) => ({
              ...state,
              frames: state.frames.map((frame) =>
                frame.id === fact.navigable ? { ...frame, document: Option.some(fact.document), url: fact.url } : frame
              )
            }))
            return
          }
          yield* update(page.state, (state): Model.PageState =>
            state.status._tag === "Closed" ? state : {
              ...state,
              status: {
                _tag: "Open",
                url: fact.url,
                document: { id: fact.document, readiness: "loading", lifecycle: "active" },
                prompt: state.status._tag === "Open" ? state.status.prompt : Option.none(),
                undecided: state.status._tag === "Open" ? state.status.undecided : Option.none()
              }
            })
          return
        }
        case "DocumentUrlChanged": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          yield* update(document.state, (state) => ({ ...state, url: fact.url }))
          const owner = frames.get(document.navigable)
          if (owner !== undefined) {
            yield* update(owner.state, (state) => ({
              ...state,
              frames: state.frames.map((frame) =>
                Option.contains(frame.document, fact.document) ? { ...frame, url: fact.url } : frame
              )
            }))
          }
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* updateOpen(page, (open) => open.document.id === fact.document ? { ...open, url: fact.url } : open)
          }
          return
        }
        // The page's status first, then the document's readiness: a wait woken by the readiness reads the status
        case "DocumentOpened": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* updateOpen(page, (open) =>
              open.document.id === fact.document
                ? { ...open, document: { ...open.document, readiness: "loading" } }
                : open)
          }
          yield* update(document.state, (state) => ({ ...state, readiness: "loading" as const }))
          return
        }
        case "DocumentReadiness": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* updateOpen(page, (open) =>
              open.document.id === fact.document
                ? { ...open, document: { ...open.document, readiness: fact.readiness } }
                : open)
          }
          yield* update(document.state, (state) => ({ ...state, readiness: fact.readiness }))
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
            ? Option.some(page.value.contextEntry)
            : Option.flatMap(fact.kind.context, (id) => Option.fromNullishOr(contexts.get(id)))
          const worker: Model.WorkerEntry = {
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
          const add = <S extends { readonly workers: ReadonlyArray<Model.WorkerEntry> }>(state: S): S => ({
            ...state,
            workers: [...state.workers, worker]
          })
          if (Option.isSome(page)) yield* update(page.value.state, add)
          if (Option.isSome(context)) yield* update(context.value.state, add)
          return
        }
        case "RealmRemoved": {
          realmDocuments.delete(fact.realm)
          const worker = workers.get(fact.realm)
          if (worker !== undefined) yield* endWorker(worker, fact.reason)
          else realmOwners.delete(fact.realm)
          return
        }
        case "ErrorDocumentAttributed": {
          // Provenance only: the original observation already changed the document tree. In particular,
          // late attribution of an ended document must not revive it or reset the current page's readiness.
          return
        }
        case "NavigationEnded": {
          // The event first, then the outcome: `goto` returns once the outcome is latched, and a `next` its caller
          // subscribes then must not see the navigation `goto` made
          const start = started.get(fact.navigation)
          if (Option.isSome(start)) {
            started.delete(fact.navigation)
            if (pages.has(start.value.page.id)) {
              Events.publish(start.value.page.events.navigation, {
                navigation: fact.navigation,
                frame: start.value.frame,
                url: endedAt(fact.outcome, start.value.url),
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
          const owner = ownerOfRequest(fact.request)
          hops.keep(fact.request.hop, {
            request: fact.request,
            state: yield* cell<Model.HopState>({
              response: Option.none(),
              sent: Option.none(),
              received: Option.none()
            }),
            sentKnown: Deferred.makeUnsafe<void>(),
            end: Deferred.makeUnsafe<Model.HopEnd>(),
            page: owner.page,
            context: owner.context
          })
          publish(owner, fact.request, (events) => events.request, (events) => events.request)
          return
        }
        case "HopTiming": {
          const found = hops.get(fact.hop)
          if (Option.isSome(found) && Option.isSome(found.value.context)) {
            const context = found.value.context.value
            const current = ownerOfRequest(found.value.request)
            if (
              Option.getOrUndefined(current.context) !== context ||
              Option.getOrUndefined(current.page) !== Option.getOrUndefined(found.value.page)
            ) return
            if (
              !Deferred.isDoneUnsafe(context.closed) &&
              !Option.exists(found.value.page, (page) => Deferred.isDoneUnsafe(page.closed))
            ) {
              context.timings?.set(fact.hop, fact.timing)
            }
          }
          return
        }
        case "ResponseReceived": {
          if (navigationHops.delete(fact.response.hop)) responses.set(fact.response.hop, fact.response)
          const hop = hops.get(fact.response.hop)
          if (Option.isNone(hop)) return
          yield* update(hop.value.state, (state) => ({ ...state, response: Option.some(fact.response) }))
          publish(
            hop.value,
            { response: fact.response, hop: hop.value },
            (events) => events.response,
            (events) => events.response
          )
          return
        }
        case "HopHeaders": {
          const hop = hops.get(fact.hop)
          if (Option.isNone(hop)) return
          if (fact.phase === "request") {
            yield* update(hop.value.state, (state) => ({ ...state, sent: Option.some(fact.headers) }))
            Deferred.doneUnsafe(hop.value.sentKnown, Effect.void)
          } else {
            yield* update(hop.value.state, (state) => ({ ...state, received: Option.some(fact.headers) }))
          }
          return
        }
        case "RequestFinished": {
          endHop(fact.hop, {
            _tag: "Finished",
            encodedBytes: fact.encodedBytes,
            at: fact.at,
            httpVersion: Option.fromUndefinedOr(fact.httpVersion)
          })
          return
        }
        case "RequestFailed": {
          endHop(fact.hop, { _tag: "Failed", error: fact.error, canceled: fact.canceled, at: fact.at })
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
          const context = page.value.contextEntry
          const connection: Model.ConnectionEntry = {
            id: fact.connection,
            kind: fact.kind,
            url: fact.url,
            openedAt: DateTime.nowUnsafe(),
            page: page.value,
            frames: Events.make({ _tag: "Page", id: page.value.id }, () => context.state.getUnsafe().settings.eventLog),
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
          if (connection !== undefined) yield* endConnection(connection, new Target.NetworkConnectionClosed({}))
          return
        }
        case "DownloadStarted": {
          const page = pageOf(fact.page)
          if (Option.isNone(page) || !contexts.has(page.value.context)) return
          const context = page.value.contextEntry
          const download: Model.DownloadEntry = {
            id: fact.download,
            page: page.value,
            context,
            url: fact.url,
            suggestedFilename: fact.suggestedFilename,
            state: yield* cell<Model.DownloadState>({
              status: { _tag: "InProgress", received: 0, total: Option.none() },
              path: Option.none()
            })
          }
          downloads.set(fact.download, download)
          publish(
            { page, context: Option.some(context) },
            download,
            (events) => events.download,
            (events) => events.download
          )
          return
        }
        case "DownloadProgress": {
          const download = downloads.get(fact.download)
          if (download === undefined) return
          yield* update(download.state, (state): Model.DownloadState =>
            state.status._tag === "InProgress"
              ? { ...state, status: { _tag: "InProgress", received: fact.receivedBytes, total: fact.totalBytes } }
              : state)
          return
        }
        case "DownloadEnded": {
          // What a backend reports after the download's context ended is ignored
          const download = downloads.get(fact.download)
          if (download === undefined) return
          downloads.delete(fact.download)
          const outcome = fact.outcome
          yield* update(download.state, (state): Model.DownloadState =>
            state.status._tag !== "InProgress" ? state : outcome._tag === "Completed"
              ? { status: { _tag: "Completed" }, path: outcome.path }
              : { ...state, status: { _tag: "Canceled" } })
          return
        }
        case "ObligationOpened": {
          // Who decides is chosen now, in order with the registrations folded before it
          if (fact.subject._tag === "PausedRequest") {
            const paused = fact.subject
            const owner = ownerOfRequest(paused.request)
            const routes = [
              ...(Option.isSome(owner.page) ? [...owner.page.value.state.getUnsafe().routes].reverse() : []),
              ...(Option.isSome(owner.context) ? [...owner.context.value.state.getUnsafe().routes].reverse() : [])
            ].filter((route) =>
              route.phase === paused.phase && route.matches(paused.request.url)
            )
            Queue.offerUnsafe(obligations, {
              _tag: "PausedRequest",
              obligation: fact.obligation,
              paused,
              owner,
              routes
            })
            return
          }
          if (fact.subject._tag === "FileChooser") {
            const chooser = fact.subject
            const page = pageOf(chooser.navigable)
            if (Option.isSome(page)) Events.publish(page.value.events.fileChooser, chooser)
            const context = Option.map(page, (page) => page.contextEntry)
            Queue.offerUnsafe(obligations, {
              _tag: "FileChooser",
              obligation: fact.obligation,
              chooser,
              page,
              handler: Option.flatMap(page, (page) =>
                Option.fromUndefinedOr(page.state.getUnsafe().chooserHandlers.at(-1))),
              context,
              owned: Option.exists(context, (context) =>
                context.state.getUnsafe().settings.owned)
            })
            return
          }
          if (fact.subject._tag !== "Prompt") {
            return
          }
          const prompt = fact.subject
          prompts.set(prompt.prompt, prompt.page)
          const page = Option.fromNullishOr(pages.get(prompt.page))
          if (Option.isSome(page)) {
            Events.publish(page.value.events.dialog, prompt)
            yield* update(page.value.state, (state) => ({ ...state, dialog: Option.some(prompt) }))
            yield* updateOpen(page.value, (open) => ({
              ...open,
              prompt: Option.some({ id: prompt.prompt, kind: prompt.kind, blocking: "confirmed" })
            }))
          }
          const context = Option.map(page, (page) =>
            page.contextEntry)
          Queue.offerUnsafe(obligations, {
            _tag: "Prompt",
            obligation: fact.obligation,
            prompt,
            page,
            handler: Option.flatMap(
              page,
              (page) => Option.fromUndefinedOr(page.state.getUnsafe().promptHandlers.at(-1))
            ),
            context,
            policy: Option.flatMap(context, (context) => context.state.getUnsafe().settings.policy)
          })
          return
        }
        case "PromptClosed": {
          const id = prompts.get(fact.prompt)
          prompts.delete(fact.prompt)
          const page = id === undefined ? undefined : pages.get(id)
          if (page !== undefined) {
            yield* update(page.state, (state) => ({ ...state, dialog: Option.none() }))
            yield* updateOpen(page, (open) => ({ ...open, prompt: Option.none(), undecided: Option.none() }))
          }
          return
        }
        default:
          return
      }
    })

  const loseConnection = Effect.gen(function*() {
    const reason: Target.CloseReason = new Target.ConnectionLost({})
    for (const page of Array.from(pages.values())) yield* endPage(page, reason)
    for (const document of Array.from(documents.keys())) yield* endDocument(document, reason)
    for (const worker of Array.from(workers.values())) yield* endWorker(worker, reason)
    for (const connection of Array.from(connections.values())) yield* endConnection(connection, reason)
    for (const each of Array.from(contexts.values())) yield* endContext(each, reason)
    contexts.clear()
    for (const entry of navigations.values()) {
      yield* Deferred.succeed(entry.outcome, { _tag: "Failed", error: "connection lost", errorDocument: Option.none() })
    }
    for (const hop of hops.values()) {
      Deferred.doneUnsafe(hop.sentKnown, Effect.void)
      Deferred.doneUnsafe(
        hop.end,
        Effect.succeed({ _tag: "Failed", error: "connection lost", canceled: false, at: Adapter.now() })
      )
    }
    yield* Deferred.succeed(lost, undefined)
  })

  // ── Commands ──

  /** A registration for the scope: added as a command, and removed as one when the scope closes. */
  const scoped = (add: Effect.Effect<void>, remove: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope> =>
    Effect.acquireRelease(apply(add), () => apply(remove))

  const self: Fold = {
    sink: (fact) => apply(fold(fact)),
    obligations,
    pages: pageList,
    page: (id) => Option.fromNullishOr(pages.get(id)),
    document: (id) => Option.fromNullishOr(documents.get(id)),
    documentOf,
    response: (hop) => responses.get(hop),
    hop: (hop) => hops.get(hop),
    lost,
    context: (id, isDefault) => apply(ensureContext(id, isDefault)),
    configure: (context, settings) => apply(update(context.state, (state) => ({ ...state, settings }))),
    navigation: (id) => apply(Effect.sync(() => navigation(id))),
    forget: (id) => apply(Effect.sync(() => void navigations.delete(id))),
    register: (page, key, handler) =>
      scoped(
        update(page.state, (state) => ({ ...state, [key]: [...state[key], handler] })),
        update(page.state, (state) => ({ ...state, [key]: state[key].filter((each) => each !== handler) }))
      ),
    route: (owner, route) => {
      const state = owner.state as Readable.Readable<{ readonly routes: ReadonlyArray<Model.RouteEntry> }>
      return scoped(
        update(state, (state) => ({ ...state, routes: [...state.routes, route] })),
        update(state, (state) => ({ ...state, routes: state.routes.filter((each) => each !== route) }))
      )
    },
    grant: (context, grant) =>
      scoped(
        update(context.state, (state) => ({ ...state, grants: [...state.grants, grant] })),
        update(context.state, (state) => ({ ...state, grants: state.grants.filter((each) => each !== grant) }))
      ),
    own: (page, scope) => apply(update(page.state, (state) => ({ ...state, owner: Option.some(scope) }))),
    stayed: (page) => apply(update(page.state, (state) => ({ ...state, stayed: state.stayed + 1 }))),
    undecided: (page, prompt) =>
      apply(updateOpen(page, (open) =>
        Option.isSome(open.prompt) && open.prompt.value.id === prompt.prompt
          ? { ...open, undecided: Option.some({ kind: prompt.kind, text: prompt.message }) }
          : open)),
    autoResolved: (owner, event) =>
      apply(
        Effect.sync(() => publish(owner, event, (events) => events.autoResolution, (events) => events.autoResolution))
      ),
    loseConnection: apply(loseConnection)
  }
  return self
})
