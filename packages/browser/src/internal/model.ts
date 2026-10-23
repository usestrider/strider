/**
 * L1's model (CONCEPTS.md §2; review 12, candidate 2): one per connection, folded from the adapter's facts. The
 * fold is the adapter's sink, so it runs in receive order, before the adapter publishes the event, and it is
 * the only writer of entity state. Each entity is its fixed fields, one `SubscriptionRef` and a `Deferred`
 * for its end.
 *
 * The slice folds what its operations read: contexts, pages, their active documents and readiness,
 * navigations, the realms the engine is installed in, and the responses of navigation requests. Other facts
 * (frames' own documents, other requests, console, downloads) belong to the modules that consume them, which
 * aren't built.
 *
 * Events (review 13): the fold publishes popups, dialogs and the policy's automatic decisions to channels on
 * their pages and contexts (`events.ts`). A dialog is decided by the page's latest `Dialog.handle`, or else by
 * its context's policy, by a resolver in the model's scope; a popup of an owned page is released with its
 * opener's scope.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Dialog from "../Dialog.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import type * as Target from "../Target.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
import * as Events from "./events.ts"

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

/** A decision the context's policy made, because no handler did. */
export interface AutoResolutionEvent {
  readonly prompt: PromptEvent
  readonly decision: "accept" | "dismiss"
  readonly policy: DialogPolicy
  readonly at: MonotonicInstant.MonotonicInstant
}

/** A registered `Dialog.handle`, as the model asks it. */
export interface PromptHandler {
  /**
   * Asks the handler, in its own scope, with its own budget: `None` when it failed, was interrupted or ran
   * out of time, so the policy decides.
   */
  readonly decide: (prompt: PromptEvent) => Effect.Effect<Option.Option<Adapter.Decision>>
}

export interface PageEntry {
  readonly id: Target.NavigableId
  readonly context: UserContext.Id
  readonly state: SubscriptionRef.SubscriptionRef<PageState>
  readonly closed: Deferred.Deferred<Target.CloseReason>
  /** Input to one page is serialized (CONCEPTS.md §5). */
  readonly input: Semaphore.Semaphore
  /**
   * The scope that releases the page, when the library owns it (CONCEPTS.md §3): its creator's, or for a popup,
   * its opener's. Set once, when the page is acquired or appears.
   */
  owner: Option.Option<Scope.Scope>
  readonly events: {
    readonly popup: Events.Channel<PopupEvent>
    readonly dialog: Events.Channel<PromptEvent>
    readonly autoResolution: Events.Channel<AutoResolutionEvent>
  }
  /** `Dialog.handle` registrations, oldest first: the latest decides. */
  readonly promptHandlers: Array<PromptHandler>
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
  /** `None` for a context nobody set a policy for, such as the default context: no automatic decision. */
  policy: Option.Option<DialogPolicy>
  /** Events retained per kind and target, for `history` (`UserContext.Options.eventLog`). */
  eventLog: number
  readonly events: {
    readonly autoResolution: Events.Channel<AutoResolutionEvent>
  }
}

export interface DocumentEntry {
  readonly id: Target.DocumentId
  readonly navigable: Target.NavigableId
  readonly readiness: SubscriptionRef.SubscriptionRef<"loading" | "interactive" | "complete">
  readonly ended: Deferred.Deferred<Target.CloseReason>
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

/** Events retained per kind and target when a context sets no `eventLog` (UserContext.Options.eventLog). */
const defaultEventLog = 100

/** How a target's end ends its event streams: normally when it was closed, or with `TargetGone` otherwise. */
const endOf = (reason: Target.CloseReason): Events.End => ({
  normal: reason._tag === "PageClosed" || reason._tag === "UserContextRemoved",
  reason
})

/** A URL a popup reports before it navigates, which says nothing about where it was opened to (review 13, P1). */
const placeholder = (url: string) => url === "" || url === "about:blank"

/**
 * A model and its fold. The sink is installed before the adapter connects (`connect`), so the model is made
 * first and given its adapter after.
 */
export const make = Effect.fnUntraced(function*() {
  const modelScope = yield* Effect.scope
  const contexts = new Map<UserContext.Id, ContextEntry>()
  const pages = new Map<Target.NavigableId, PageEntry>()
  const documents = new Map<Target.DocumentId, DocumentEntry>()
  const navigations = new Map<PageNavigation.Id, NavigationEntry>()
  const navigationHops = new Set<NetworkRequest.HopId>()
  const responses = new Map<NetworkRequest.HopId, NetworkResponse.NetworkResponse>()
  const engineRealms = new Map<Target.DocumentId, Target.RealmId>()
  const realmDocuments = new Map<Target.RealmId, Target.DocumentId>()
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

  const endDocument = (id: Target.DocumentId, reason: Target.CloseReason) =>
    Effect.suspend(() => {
      const entry = documents.get(id)
      if (entry === undefined) return Effect.void
      documents.delete(id)
      engineRealms.delete(id)
      return Deferred.succeed(entry.ended, reason)
    })

  const endPage = Effect.fnUntraced(function*(page: PageEntry, reason: Target.CloseReason) {
    pages.delete(page.id)
    popupUrls.delete(page.id)
    const how = endOf(reason)
    Events.end(page.events.popup, how)
    Events.end(page.events.dialog, how)
    Events.end(page.events.autoResolution, how)
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
  })

  const context = Effect.fnUntraced(function*(id: UserContext.Id, isDefault: boolean) {
    const existing = contexts.get(id)
    if (existing !== undefined) return existing
    const entry: ContextEntry = {
      id,
      isDefault,
      state: yield* SubscriptionRef.make<ContextState>({ pages: [], closed: Option.none() }),
      closed: yield* Deferred.make<Target.CloseReason>(),
      policy: Option.none(),
      eventLog: defaultEventLog,
      events: { autoResolution: Events.make({ _tag: "UserContext" }, () => entry.eventLog) }
    }
    contexts.set(id, entry)
    return entry
  })

  const end = Effect.fnUntraced(function*(entry: ContextEntry, reason: Target.CloseReason) {
    contexts.delete(entry.id)
    Events.end(entry.events.autoResolution, endOf(reason))
    yield* SubscriptionRef.update(entry.state, (state) => ({ ...state, closed: Option.some(reason) }))
    yield* Deferred.succeed(entry.closed, reason)
  })

  const setOpen = (page: PageEntry, change: (open: Extract<PageState, { _tag: "Open" }>) => PageState) =>
    SubscriptionRef.update(page.state, (state) => state._tag === "Open" ? change(state) : state)

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
      prompt,
      decision: accept ? "accept" : "dismiss",
      policy: policy.value,
      at: Adapter.now()
    }
    Events.publish(page.events.autoResolution, resolution)
    Events.publish(context.events.autoResolution, resolution)
    yield* resolve(obligation, accept ? { _tag: "Accept", promptText: Option.none() } : { _tag: "Dismiss" })
  })

  const resolve = (obligation: Adapter.ObligationId, decision: Adapter.Decision) =>
    adapter === undefined ? Effect.void : adapter.resolve(obligation, decision).pipe(Effect.ignore)

  /** Closes a popup its opener's scope released, unless it already closed. */
  const release = (page: Target.NavigableId) =>
    Effect.suspend(() =>
      adapter === undefined || !pages.has(page)
        ? Effect.void
        : adapter.closePage(page, { runBeforeUnload: false }).pipe(Effect.ignore)
    )

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
            owner: Option.none(),
            events: {
              popup: Events.make(target, cap),
              dialog: Events.make(target, cap),
              autoResolution: Events.make(target, cap)
            },
            promptHandlers: []
          }
          pages.set(fact.page, entry)
          yield* SubscriptionRef.update(owner.state, (state) => ({ ...state, pages: [...state.pages, fact.page] }))
          // A popup is reported to its opener, when the backend names one (review 13, candidate 4)
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
          return
        }
        case "NavigableRemoved": {
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
            ended: yield* Deferred.make<Target.CloseReason>()
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
          const page = document === undefined ? undefined : pages.get(document.navigable)
          if (page !== undefined) {
            yield* setOpen(page, (open) => open.document.id === fact.document ? { ...open, url: fact.url } : open)
          }
          return
        }
        case "DocumentOpened": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          yield* SubscriptionRef.set(document.readiness, "loading")
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* setOpen(page, (open) =>
              open.document.id === fact.document
                ? { ...open, document: { ...open.document, readiness: "loading" } }
                : open)
          }
          return
        }
        case "DocumentReadiness": {
          const document = documents.get(fact.document)
          if (document === undefined) return
          yield* SubscriptionRef.set(document.readiness, fact.readiness)
          const page = pages.get(document.navigable)
          if (page !== undefined) {
            yield* setOpen(page, (open) =>
              open.document.id === fact.document
                ? { ...open, document: { ...open.document, readiness: fact.readiness } }
                : open)
          }
          return
        }
        case "RealmAdded": {
          if (fact.kind._tag === "Window") realmDocuments.set(fact.realm, fact.kind.document)
          return
        }
        case "RealmRemoved": {
          const document = realmDocuments.get(fact.realm)
          realmDocuments.delete(fact.realm)
          if (document !== undefined && engineRealms.get(document) === fact.realm) engineRealms.delete(document)
          return
        }
        case "NavigationEnded": {
          yield* Deferred.succeed(navigation(fact.navigation).outcome, fact.outcome)
          return
        }
        case "RequestSent": {
          const initiator = fact.request.initiator
          if (initiator._tag === "Document" && Option.isSome(initiator.navigation)) {
            navigationHops.add(fact.request.hop)
          }
          return
        }
        case "ResponseReceived": {
          if (!navigationHops.delete(fact.response.hop)) return
          responses.set(fact.response.hop, fact.response)
          if (responses.size > maxResponses) responses.delete(responses.keys().next().value!)
          return
        }
        case "ObligationOpened": {
          if (fact.subject._tag !== "Prompt") return
          const subject = fact.subject
          prompts.set(subject.prompt, subject.page)
          const page = pages.get(subject.page)
          if (page !== undefined) {
            yield* setOpen(page, (open) => ({
              ...open,
              prompt: Option.some({ id: subject.prompt, kind: subject.kind, blocking: "confirmed" })
            }))
            Events.publish(page.events.dialog, subject)
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
    for (const each of Array.from(contexts.values())) yield* end(each, reason)
    contexts.clear()
    for (const entry of navigations.values()) {
      yield* Deferred.succeed(entry.outcome, { _tag: "Failed", error: "connection lost", errorDocument: Option.none() })
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
