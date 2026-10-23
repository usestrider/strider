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
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Dialog from "../Dialog.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import type * as Target from "../Target.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"

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
  }
  | { readonly _tag: "Closed"; readonly reason: Target.CloseReason; readonly url: string }

export interface PageEntry {
  readonly id: Target.NavigableId
  readonly context: UserContext.Id
  readonly state: SubscriptionRef.SubscriptionRef<PageState>
  readonly closed: Deferred.Deferred<Target.CloseReason>
  /** Input to one page is serialized (CONCEPTS.md §5). */
  readonly input: Semaphore.Semaphore
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

/**
 * A model and its fold. The sink is installed before the adapter connects (`connect`), so the model is made
 * first and given its adapter after.
 */
export const make = Effect.fnUntraced(function*() {
  const scope = yield* Effect.scope
  const contexts = new Map<UserContext.Id, ContextEntry>()
  const pages = new Map<Target.NavigableId, PageEntry>()
  const documents = new Map<Target.DocumentId, DocumentEntry>()
  const navigations = new Map<PageNavigation.Id, NavigationEntry>()
  const navigationHops = new Set<NetworkRequest.HopId>()
  const responses = new Map<NetworkRequest.HopId, NetworkResponse.NetworkResponse>()
  const engineRealms = new Map<Target.DocumentId, Target.RealmId>()
  const realmDocuments = new Map<Target.RealmId, Target.DocumentId>()
  const prompts = new Map<Dialog.PromptId, Target.NavigableId>()
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
      policy: Option.none()
    }
    contexts.set(id, entry)
    return entry
  })

  const end = Effect.fnUntraced(function*(entry: ContextEntry, reason: Target.CloseReason) {
    contexts.delete(entry.id)
    yield* SubscriptionRef.update(entry.state, (state) => ({ ...state, closed: Option.some(reason) }))
    yield* Deferred.succeed(entry.closed, reason)
  })

  const setOpen = (page: PageEntry, change: (open: Extract<PageState, { _tag: "Open" }>) => PageState) =>
    SubscriptionRef.update(page.state, (state) => state._tag === "Open" ? change(state) : state)

  // The automatic decision for a dialog no handler claims, delivered apart from the fold
  const decide = Effect.fnUntraced(function*(
    obligation: Adapter.ObligationId,
    subject: Extract<Adapter.ObligationSubject, { _tag: "Prompt" }>
  ) {
    const page = pages.get(subject.page)
    const policy = page === undefined ? Option.none() : contexts.get(page.context)?.policy ?? Option.none()
    if (adapter === undefined || Option.isNone(policy) || policy.value === "leaveOpen") return
    const accept = policy.value === "accept" || subject.kind === "beforeunload"
    yield* adapter.resolve(
      obligation,
      accept ? { _tag: "Accept", promptText: Option.none() } : { _tag: "Dismiss" }
    ).pipe(Effect.ignore, Effect.forkIn(scope))
  })

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
          pages.set(fact.page, {
            id: fact.page,
            context: fact.context,
            state: yield* SubscriptionRef.make<PageState>({ _tag: "Opening", url: fact.url }),
            closed: yield* Deferred.make<Target.CloseReason>(),
            input: yield* Semaphore.make(1)
          })
          const owner = yield* context(fact.context, false)
          yield* SubscriptionRef.update(owner.state, (state) => ({ ...state, pages: [...state.pages, fact.page] }))
          return
        }
        case "NavigableRemoved": {
          const page = pages.get(fact.navigable)
          if (page !== undefined) yield* endPage(page, fact.reason)
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
              prompt: state._tag === "Open" ? state.prompt : Option.none()
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
          }
          yield* decide(fact.obligation, subject)
          return
        }
        case "PromptClosed": {
          const id = prompts.get(fact.prompt)
          prompts.delete(fact.prompt)
          const page = id === undefined ? undefined : pages.get(id)
          if (page !== undefined) yield* setOpen(page, (open) => ({ ...open, prompt: Option.none() }))
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
