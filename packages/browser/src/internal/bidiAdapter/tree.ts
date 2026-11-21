/**
 * The navigable tree as BiDi reports it: user contexts, navigables, documents, realms and navigations, added and
 * ended, with the facts each change makes. Firefox creates a new document's realm before `navigationCommitted`, so
 * a replacement main realm and its sandboxes are held for the next commit, which excludes the old realms.
 */
import * as Option from "effect/Option"
import type * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import * as L1Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import type { ContextEntry, DocumentEntry, NavigableEntry, NavigationEntry, RealmEntry, State } from "./state.ts"

// ── Ending things ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The id a navigable not yet known will take, so a popup listed before its opener can name it, held for as long as
 * a popup that names it is open.
 */
const reserveId = (state: State, context: string, popup: L1Target.NavigableId): L1Target.NavigableId => {
  const known = state.reservedIds.get(context)
  if (known !== undefined) {
    known.popups.add(popup)
    return known.id
  }
  const id = state.ids.navigable()
  state.reservedIds.set(context, { id, popups: new Set([popup]) })
  return id
}

/** Releases the ids a removed popup held for an opener that never came. */
const releaseReserved = (state: State, popup: L1Target.NavigableId) => {
  for (const [context, reserved] of state.reservedIds) {
    reserved.popups.delete(popup)
    if (reserved.popups.size === 0) state.reservedIds.delete(context)
  }
}

/**
 * Cancels the pending restoration: releases only the reservation it owns, and marks the navigable ambiguous, since
 * the cancelled traversal may still produce a realm that a later traversal could not tell from its own.
 */
export const cancelRestoration = (navigable: NavigableEntry) => {
  if (navigable.restoring === undefined) return
  navigable.restorationAmbiguous = true
  finishRestoration(navigable)
}

/**
 * Releases the pending restoration's reservation without marking the navigable ambiguous: for a restoration whose
 * own navigation ended in the same document, which has no realm left to produce. Every other ending cancels it, since
 * a failed navigation's error page may still commit.
 */
const finishRestoration = (navigable: NavigableEntry) => {
  if (navigable.restoring === undefined) return
  Kit.unexpect(navigable.expected, navigable.restoring.navigation)
  navigable.restoring = undefined
}

/** Removes a realm; one still pending, created and destroyed before its document committed, is never reported. */
export const removeRealm = (state: State, realm: RealmEntry, reason: L1Target.CloseReason) =>
  Kit.removeRealm(state.buffer, realm, reason, (realm) => {
    state.realms.delete(realm.bidi)
    state.realmsById.delete(realm.id)
    state.workerPages.delete(realm)
    realm.navigable?.document?.realms.delete(realm)
    const pending = realm.navigable?.pendingRealms.indexOf(realm) ?? -1
    if (pending >= 0) {
      cancelRestoration(realm.navigable!)
      realm.navigable!.pendingRealms.splice(pending, 1)
    }
  })

export const endNavigation = (
  state: State,
  navigation: NavigationEntry,
  outcome: Adapter.NavigationOutcome,
  evidence: string
) =>
  Kit.endNavigation(state.buffer, navigation, outcome, evidence, (navigation) => {
    if (navigation.navigable.restoring?.navigation === navigation.id) {
      if (outcome._tag === "SameDocument") finishRestoration(navigation.navigable)
      else cancelRestoration(navigation.navigable)
    }
    if (outcome._tag === "Failed" && Option.isNone(outcome.errorDocument)) {
      navigation.navigable.failedNavigation = {
        id: navigation.id,
        url: navigation.url,
        initiatedAs: "crossDocument",
        bidi: navigation.bidi,
        aliases: new Set(
          [...navigation.navigable.navigations].filter(([, entry]) => entry === navigation).map(([bidi]) => bidi)
        )
      }
    }
    navigation.starts.clear()
    navigation.staleLoad = undefined
    // Outstanding commands and their unresolved terminal correlations still need this identity.
    if (navigation.navigable.navigationCommands.size > 0 || navigation.navigable.pendingTerminals.length > 0) return
    for (const [bidi, entry] of navigation.navigable.navigations) {
      if (entry !== navigation) continue
      navigation.navigable.navigations.delete(bidi)
      if (state.navigations.get(bidi) === navigation) state.navigations.delete(bidi)
    }
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
    cancelRestoration(navigable)
    for (const [key, request] of state.requests) {
      if (request.navigable === navigable) navigable.context.proxyAttempts?.delete(key)
    }
    navigable.traversalCommands.clear()
    navigable.navigationCommands.clear()
    navigable.commandNavigations.clear()
    navigable.pendingTerminals.length = 0
    navigable.failedNavigation = undefined
    navigable.staleLoad = undefined
    navigable.expected.list.length = 0
    for (const [bidi, navigation] of navigable.navigations) {
      navigation.ended = true
      navigation.starts.clear()
      navigation.staleLoad = undefined
      if (state.navigations.get(bidi) === navigation) state.navigations.delete(bidi)
    }
    navigable.navigations.clear()
    state.navigables.delete(navigable.bidi)
    state.navigablesById.delete(navigable.id)
    state.mouseCapture.delete(navigable.id)
    state.touchCapture.delete(navigable.id)
    if (navigable.document !== undefined) {
      for (const realm of Array.from(navigable.document.realms)) removeRealm(state, realm, reason)
      state.documents.delete(navigable.document.id)
    }
    // Include pending realms and old-document realms whose destruction was delayed past replacement.
    for (const realm of Array.from(state.realms.values())) {
      if (realm.navigable === navigable) removeRealm(state, realm, reason)
    }
    if (navigable.parent !== undefined) return
    releaseReserved(state, navigable.id)
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
  cancelRestoration(navigable)
  navigable.restorationAmbiguous = false
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
    url: Urls.reported(url),
    origin,
    createdBy,
    replaced: Option.fromUndefinedOr(old?.id),
    evidence
  })
  if (old !== undefined) {
    state.documents.delete(old.id)
    navigable.past.set(old.url, old.id)
    // Pending realms prove replacement: old realms may remain live until after commit.
    // Without replacement evidence Firefox can reuse the initial about:blank's realms (probe 2).
    const replacement = navigable.pendingRealms.some((realm) => !realm.ended)
    for (const realm of old.realms) {
      if (realm.ended || replacement) continue
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
  /** A command's expectation, already taken; null means no match, undefined takes one here. */
  taken?: { readonly id: PageNavigation.Id; readonly initiatedAs: Adapter.InitiatedAs } | null
): NavigationEntry => {
  const bound = navigable.commandNavigations.get(bidi)
  navigable.commandNavigations.delete(bidi)
  const expected = bound ?? (taken === undefined ? Kit.take(navigable.expected, url) : taken)
  if (navigable.restoring?.navigation !== expected?.id) cancelRestoration(navigable)
  const initiatedAs = expected?.initiatedAs ?? type
  const navigation: NavigationEntry = {
    id: expected?.id ?? state.ids.navigation(),
    starts: new Map(),
    bidi,
    navigable,
    url,
    sameDocument,
    traversal: initiatedAs === "traversal",
    documentHop: undefined,
    status: undefined,
    ended: false
  }
  // An unannounced terminal event can be older than a navigation already in flight,
  // even when its command reply supplied an identity. Only a start supersedes that navigation.
  if (!sameDocument && taken !== null) {
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
    url: Urls.reported(url),
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
  context.proxyUsed = true
  const reserved = state.reservedIds.get(info.context)
  state.reservedIds.delete(info.context)
  const navigable: NavigableEntry = {
    bidi: info.context,
    id: reserved?.id ?? state.ids.navigable(),
    parent,
    children: new Set(),
    context,
    // A frame's page is its parent's; a page is its own
    get page() {
      return parent?.page ?? navigable
    },
    closing: undefined,
    closeRequested: false,
    document: undefined,
    pendingRealms: [],
    restoring: undefined,
    restorationAmbiguous: false,
    traversalCommands: new Set(),
    expected: Kit.makeExpectations(),
    navigationCommands: new Set(),
    commandNavigations: new Map(),
    pendingTerminals: [],
    failedNavigation: undefined,
    past: new Map(),
    navigations: new Map(),
    removed: false
  }
  state.navigables.set(info.context, navigable)
  state.navigablesById.set(navigable.id, navigable)
  if (parent === undefined) {
    const openerId = info.originalOpener === null
      ? Option.none<L1Target.NavigableId>()
      : Option.some(
        state.navigables.get(info.originalOpener)?.page.id ?? reserveId(state, info.originalOpener, navigable.id)
      )
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
      url: Urls.reported(info.url)
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
  // The tree each context is in, so a popup listed before the page or frame that opened it is added after that
  // page's tree, and names its page
  const trees = new Map<string, BrowsingContext.Info>()
  const index = (info: BrowsingContext.Info, top: BrowsingContext.Info) => {
    trees.set(info.context, top)
    for (const child of info.children ?? []) index(child, top)
  }
  for (const info of tree.contexts) index(info, info)
  const ordered = new Set<BrowsingContext.Info>()
  const visitTree = (top: BrowsingContext.Info) => {
    if (ordered.has(top)) return
    ordered.add(top)
    const opener = top.originalOpener === null ? undefined : trees.get(top.originalOpener)
    if (opener !== undefined) visitTree(opener)
    visit(top)
  }
  for (const info of tree.contexts) visitTree(info)
  for (const navigable of Array.from(state.navigables.values())) {
    if (navigable.parent === undefined && !seen.has(navigable.bidi)) {
      removeNavigable(state, navigable, new L1Target.ModelUnavailable({}), "bidi:browsingContext.getTree")
    }
  }
}
