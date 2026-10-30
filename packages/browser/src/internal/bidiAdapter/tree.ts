/**
 * The navigable tree as BiDi reports it: user contexts, navigables, documents, realms and navigations, added and
 * ended, with the facts each change makes. Firefox creates a new document's realm before `navigationCommitted`, so
 * a second main-world realm for a document is held, pending, for the next commit.
 */
import * as Option from "effect/Option"
import type * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import type * as L1Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type { ContextEntry, DocumentEntry, NavigableEntry, NavigationEntry, RealmEntry, State } from "./state.ts"

// ── Ending things ─────────────────────────────────────────────────────────────────────────────────────────

/** Removes a realm; one still pending, created and destroyed before its document committed, is never reported. */
export const removeRealm = (state: State, realm: RealmEntry, reason: L1Target.CloseReason) =>
  Kit.removeRealm(state.buffer, realm, reason, (realm) => {
    state.realms.delete(realm.bidi)
    state.realmsById.delete(realm.id)
    state.workerPages.delete(realm)
    realm.navigable?.document?.realms.delete(realm)
    const pending = realm.navigable?.pendingRealms.indexOf(realm) ?? -1
    if (pending >= 0) realm.navigable!.pendingRealms.splice(pending, 1)
  })

export const endNavigation = (
  state: State,
  navigation: NavigationEntry,
  outcome: Adapter.NavigationOutcome,
  evidence: string
) =>
  Kit.endNavigation(state.buffer, navigation, outcome, evidence, (navigation) => {
    navigation.navigable.navigations.delete(navigation.bidi)
    if (state.navigations.get(navigation.bidi) === navigation) state.navigations.delete(navigation.bidi)
  })

/**
 * Ends a navigable and everything below it, deepest first: frames end as their page does. A page takes the
 * prompts and file choosers of its contexts with it.
 */
export const removeNavigable = (
  state: State,
  navigable: NavigableEntry,
  reason: L1Target.CloseReason,
  evidence: string
) =>
  Kit.removeNavigable(state.buffer, navigable, reason, evidence, (navigable, reason) => {
    state.navigables.delete(navigable.bidi)
    state.navigablesById.delete(navigable.id)
    if (navigable.document !== undefined) {
      for (const realm of Array.from(navigable.document.realms)) removeRealm(state, realm, reason)
      state.documents.delete(navigable.document.id)
    }
    if (navigable.parent !== undefined) return
    state.endedPages.set(navigable.id, reason)
    for (const [id, obligation] of state.obligations) {
      if (obligation._tag !== "PausedRequest" && state.navigables.get(obligation.context) === undefined) {
        state.obligations.delete(id)
        state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "targetGone", evidence })
      }
    }
  })

// ── Documents and navigations ─────────────────────────────────────────────────────────────────────────────

export const commit = (
  state: State,
  navigable: NavigableEntry,
  url: string,
  origin: string,
  createdBy: Adapter.DocumentCreatedBy,
  navigation: string | undefined,
  evidence: string
): DocumentEntry => {
  const old = navigable.document
  const document: DocumentEntry = {
    id: state.ids.document(),
    navigable,
    url,
    generation: 0,
    navigation,
    realms: new Set(),
    hadMainRealm: false,
    complete: false
  }
  state.documents.set(document.id, document)
  navigable.document = document
  state.buffer.emit({
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
    state.documents.delete(old.id)
    navigable.past.set(old.url, old.id)
    // A realm that survived the commit hosts the new document: the initial about:blank's (probe 2)
    for (const realm of old.realms) {
      if (realm.ended) continue
      document.realms.add(realm)
      if (realm.world._tag === "Main") document.hadMainRealm = true
      state.buffer.emit({ _tag: "RealmDocumentAdded", realm: realm.id, document: document.id })
    }
  }
  // Realms created ahead of the commit, for this document
  for (const realm of navigable.pendingRealms.splice(0)) {
    if (realm.ended) continue
    addWindowRealm(state, realm, document)
  }
  return document
}

/** Reports a window's realm as its document's, then what it logged while it was pending. */
export const addWindowRealm = (state: State, realm: RealmEntry, document: DocumentEntry) => {
  document.realms.add(realm)
  if (realm.world._tag === "Main") document.hadMainRealm = true
  state.buffer.announce(realm, {
    _tag: "RealmAdded",
    realm: realm.id,
    origin: realm.origin,
    kind: { _tag: "Window", navigable: document.navigable.id, document: document.id, world: realm.world }
  })
}

export const startNavigation = (
  state: State,
  navigable: NavigableEntry,
  bidi: string,
  url: string,
  type: Adapter.InitiatedAs,
  sameDocument: boolean,
  /** A command's expectation, already taken; otherwise the first that matches is. */
  taken?: { readonly id: PageNavigation.Id; readonly initiatedAs: Adapter.InitiatedAs }
): NavigationEntry => {
  const expected = taken ?? Kit.take(navigable.expected, url)
  const initiatedAs = expected?.initiatedAs ?? type
  const navigation: NavigationEntry = {
    id: expected?.id ?? state.ids.navigation(),
    bidi,
    navigable,
    url,
    sameDocument,
    traversal: initiatedAs === "traversal",
    documentHop: undefined,
    status: undefined,
    ended: false
  }
  if (!sameDocument) {
    // A navigable has one cross-document navigation at a time: a new one replaces the one in flight
    for (const pending of Array.from(navigable.navigations.values())) {
      if (!pending.sameDocument) {
        endNavigation(
          state,
          pending,
          { _tag: "Superseded", by: navigation.id },
          "bidi:browsingContext.navigationStarted"
        )
      }
    }
  }
  navigable.navigations.set(bidi, navigation)
  state.navigations.set(bidi, navigation)
  state.buffer.emit({
    _tag: "NavigationStarted",
    navigation: navigation.id,
    navigable: navigable.id,
    url,
    initiatedAs
  })
  return navigation
}

// ── Contexts and navigables ───────────────────────────────────────────────────────────────────────────────

/** The user context BiDi names; one someone else created is added. */
export const contextFor = (state: State, bidi: string | null | undefined): ContextEntry => {
  const key = bidi ?? "default"
  const known = state.contextsByBidi.get(key)
  if (known !== undefined) return known
  // A user context someone else created
  const entry: ContextEntry = { id: state.ids.userContext(), bidi: key as ContextEntry["bidi"], removing: false }
  state.contexts.set(entry.id, entry)
  state.contextsByBidi.set(key, entry)
  state.buffer.emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
  return entry
}

export const addNavigable = (state: State, info: {
  readonly context: BrowsingContext.BrowsingContext
  readonly parent?: string | null | undefined
  readonly userContext: string | null
  readonly originalOpener: string | null
  readonly url: string
}, adopted: boolean): NavigableEntry | undefined => {
  const known = state.navigables.get(info.context)
  if (known !== undefined) return known
  // Firefox names no user context for a window's context as it goes (QUIRKS.md, Q178): one that never came
  // can't be placed, and isn't adopted
  if (info.userContext === null) return undefined
  const parent = info.parent === null || info.parent === undefined ? undefined : state.navigables.get(info.parent)
  if (info.parent !== null && info.parent !== undefined && parent === undefined) return undefined
  const context = contextFor(state, info.userContext)
  const navigable: NavigableEntry = {
    bidi: info.context,
    id: state.ids.navigable(),
    parent,
    children: new Set(),
    context,
    // A frame's page is its parent's; a page is its own
    get page() {
      return parent?.page ?? navigable
    },
    closing: undefined,
    document: undefined,
    pendingRealms: [],
    restoring: undefined,
    expected: Kit.makeExpectations(),
    past: new Map(),
    navigations: new Map(),
    removed: false
  }
  state.navigables.set(info.context, navigable)
  state.navigablesById.set(navigable.id, navigable)
  if (parent === undefined) {
    const opener = info.originalOpener === null ? undefined : state.navigables.get(info.originalOpener)
    const openerId = Option.fromUndefinedOr(opener?.page.id)
    state.buffer.emit({
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
    state.buffer.emit({ _tag: "FrameAdded", frame: navigable.id, parent: parent.id, page: navigable.page.id })
  }
  commit(
    state,
    navigable,
    info.url,
    "null",
    adopted && info.url !== "about:blank" ? { _tag: "Adopted" } : { _tag: "InitialBlank" },
    undefined,
    "bidi:browsingContext.contextCreated"
  )
  // BiDi scopes declarations natively, so a new page is ready as it appears
  if (parent === undefined) state.buffer.emit({ _tag: "PageReady", page: navigable.id })
  return navigable
}

/** Rebuilds from a fresh tree: contexts that are gone end, new ones are adopted. */
export const reconcile = (state: State, tree: BrowsingContext.GetTreeResult) => {
  const seen = new Set<string>()
  const visit = (info: BrowsingContext.Info) => {
    seen.add(info.context)
    addNavigable(state, info, true)
    for (const child of info.children ?? []) visit(child)
  }
  for (const info of tree.contexts) visit(info)
  for (const navigable of Array.from(state.navigables.values())) {
    if (navigable.parent === undefined && !seen.has(navigable.bidi)) {
      removeNavigable(state, navigable, { _tag: "ModelUnavailable" }, "bidi:browsingContext.getTree")
    }
  }
}
