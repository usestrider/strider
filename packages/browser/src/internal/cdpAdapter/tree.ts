/**
 * The navigable tree as CDP reports it: frames, documents, realms and navigations, added and ended, with the facts
 * each change makes. CDP creates realms after commit, the initial `about:blank` realm survives into the first
 * same-origin document, and children of a replaced document end without a CDP event.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as L1Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import { releaseDocument } from "./responses.ts"
import {
  ContextEntry,
  contextKey,
  type DocumentEntry,
  type FrameEntry,
  type NavigationEntry,
  type PageEntry,
  type RealmEntry,
  type State,
  type TargetEntry
} from "./state.ts"

// ── Ending things ─────────────────────────────────────────────────────────────────────────────────────────

export const removeRealm = (state: State, realm: RealmEntry, reason: L1Target.CloseReason) =>
  Kit.removeRealm(state.buffer, realm, reason, (realm) => {
    state.realms.delete(realm.id)
    state.realmsByContext.delete(contextKey(realm.target, realm.contextId))
    state.realmsByUnique.delete(realm.uniqueId)
    if (realm.target.realm === realm) realm.target.realm = undefined
    forgetHandles(state, realm)
  })

/** The handles a realm made go with it: a later use of one fails as `Gone`, its realm's end. */
const forgetHandles = (state: State, realm: RealmEntry) => {
  for (const [id, handle] of state.handles) {
    if (handle.realm !== realm) continue
    state.handles.delete(id)
    if (handle.group === undefined) continue
    const members = state.groups.get(handle.group)
    members?.delete(id)
    if (members?.size === 0) state.groups.delete(handle.group)
  }
}

export const endNavigation = (
  state: State,
  navigation: NavigationEntry,
  outcome: Adapter.NavigationOutcome,
  evidence: string
) => {
  if (navigation.ended) return
  Kit.endNavigation(state.buffer, navigation, outcome, evidence, (navigation) => {
    releaseDocument(state, navigation)
    navigation.frame.navigations.delete(navigation.loaderId)
    // A later commit under the same loader id, such as a restore, mustn't find this one
    if (state.navigations.get(navigation.loaderId) === navigation) state.navigations.delete(navigation.loaderId)
  })
  // Realms held for a document the traversal didn't produce belong to the one that stayed
  const frame = navigation.frame
  if (frame.document !== undefined) adoptPending(state, frame, frame.document)
}

/** Reports the realms held for a frame's next document as the given document's, then what they logged. */
export const adoptPending = (state: State, frame: FrameEntry, document: DocumentEntry) => {
  for (const realm of frame.pendingRealms.splice(0)) {
    if (realm.ended) continue
    document.realms.add(realm)
    state.buffer.announce(realm, {
      _tag: "RealmAdded",
      realm: realm.id,
      origin: realm.origin,
      kind: { _tag: "Window", navigable: frame.id, document: document.id, world: realm.world }
    })
  }
}

/** Ends a frame and everything below it, deepest first. */
export const removeFrame = (state: State, frame: FrameEntry, reason: L1Target.CloseReason, evidence: string) =>
  Kit.removeNavigable(state.buffer, frame, reason, evidence, (frame, reason) => {
    if (frame.page.context.requestTiming !== undefined) {
      for (const [hop, timing] of frame.page.context.requestTiming) {
        if (timing.owner === frame.id) frame.page.context.requestTiming.delete(hop)
      }
    }
    if (frame.page.context.requestSizes !== undefined) {
      for (const [hop, timing] of frame.page.context.requestSizes) {
        if (timing.owner === frame.id) frame.page.context.requestSizes.delete(hop)
      }
    }
    state.frames.delete(frame.frameId)
    state.navigables.delete(frame.id)
    if (frame.document !== undefined) {
      for (const realm of frame.document.realms) removeRealm(state, realm, reason)
      state.documents.delete(frame.document.id)
      if (frame.document.loaderId !== undefined) state.documentsByLoader.delete(frame.document.loaderId)
    }
  })

/** Ends a page: its frames, its obligations, its input state, and a wait for it to be ready. */
export const endPage = (state: State, page: PageEntry, reason: L1Target.CloseReason, evidence: string) => {
  if (page.ended) return
  page.ended = true
  state.endedPages.set(page.id, reason)
  const main = state.frames.get(page.targetId)
  if (main !== undefined) removeFrame(state, main, reason, evidence)
  for (const [key, pending] of state.pendingAttribution) {
    if (pending.target.page === page || pending.target === page.target) state.pendingAttribution.delete(key)
  }
  state.pages.delete(page.id)
  state.heldButtons.delete(page.id)
  state.drags.delete(page.id)
  state.interceptingDrags.delete(page.id)
  for (const [id, obligation] of state.obligations) {
    if (obligation.target.page === page) {
      state.obligations.delete(id)
      state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "targetGone", evidence })
    }
  }
  Deferred.doneUnsafe(page.ready, Effect.fail(Kit.gone({ _tag: "Page", id: page.id }, reason)))
}

// ── Documents and navigations ─────────────────────────────────────────────────────────────────────────────

export const commit = (
  state: State,
  frame: FrameEntry,
  snapshot: { readonly loaderId: string; readonly url: string; readonly origin: string },
  createdBy: (navigation: NavigationEntry | undefined) => Adapter.DocumentCreatedBy,
  navigation: NavigationEntry | undefined,
  evidence: string
): DocumentEntry => {
  releaseDocument(state, navigation)
  // Children of the document being replaced end with it: CDP doesn't say so (probe 8)
  for (const child of Array.from(frame.children)) {
    removeFrame(state, child, new L1Target.FrameDetached({}), "cdp: the parent's document was replaced")
  }
  const old = frame.document
  const document: DocumentEntry = {
    id: state.ids.document(),
    frame,
    loaderId: snapshot.loaderId,
    url: snapshot.url,
    generation: 0,
    realms: new Set()
  }
  state.documents.set(document.id, document)
  state.documentsByLoader.set(snapshot.loaderId, document)
  frame.document = document
  state.buffer.emit({
    _tag: "DocumentCommitted",
    document: document.id,
    navigable: frame.id,
    url: Urls.reported(snapshot.url),
    origin: snapshot.origin,
    createdBy: createdBy(navigation),
    replaced: Option.fromUndefinedOr(old?.id),
    evidence
  })
  if (old !== undefined) {
    state.documents.delete(old.id)
    // A realm that survived the commit hosts the new document: the initial about:blank's (probe 2)
    for (const realm of old.realms) {
      if (realm.ended) continue
      document.realms.add(realm)
      state.buffer.emit({ _tag: "RealmDocumentAdded", realm: realm.id, document: document.id })
    }
  }
  // Realms created ahead of the commit: a restored document's, which Chromium creates first
  adoptPending(state, frame, document)
  return document
}

export const startNavigation = (
  state: State,
  frame: FrameEntry,
  loaderId: string,
  url: string,
  type: Adapter.InitiatedAs,
  sameDocument: boolean
): NavigationEntry => {
  const expected = Kit.take(frame.expected, url)
  const navigation: NavigationEntry = {
    id: expected?.id ?? state.ids.navigation(),
    frame,
    loaderId,
    url,
    sameDocument,
    traversal: type === "traversal",
    documentHop: undefined,
    status: undefined,
    failed: undefined,
    ended: false
  }
  if (!sameDocument) {
    // A frame has one cross-document navigation at a time: a new one replaces the one in flight
    for (const pending of frame.navigations.values()) {
      if (!pending.sameDocument) {
        endNavigation(state, pending, { _tag: "Superseded", by: navigation.id }, "cdp:Page.frameStartedNavigating")
      }
    }
  }
  frame.navigations.set(loaderId, navigation)
  state.navigations.set(loaderId, navigation)
  state.buffer.emit({
    _tag: "NavigationStarted",
    navigation: navigation.id,
    navigable: frame.id,
    url: Urls.reported(url),
    initiatedAs: type
  })
  return navigation
}

// ── Frames and contexts ───────────────────────────────────────────────────────────────────────────────────

/** A frame entry, not yet in the tables. */
export const newFrame = (options: {
  readonly frameId: string
  readonly id: L1Target.NavigableId
  readonly page: PageEntry
  readonly parent: FrameEntry | undefined
  readonly owner: TargetEntry
}): FrameEntry => ({
  ...options,
  children: new Set(),
  document: undefined,
  expected: Kit.makeExpectations(),
  navigations: new Map(),
  failed: new Map(),
  pendingRealms: [],
  unpainted: new Set(),
  removed: false
})

export const addFrame = (state: State, frameId: string, parent: FrameEntry, owner: TargetEntry): FrameEntry => {
  const frame = newFrame({ frameId, id: state.ids.navigable(), page: parent.page, parent, owner })
  parent.children.add(frame)
  state.frames.set(frameId, frame)
  state.navigables.set(frame.id, frame)
  state.buffer.emit({ _tag: "FrameAdded", frame: frame.id, parent: parent.id, page: parent.page.id })
  return frame
}

/** The context a target's `browserContextId` names: the default one, or one someone else created. */
export const contextFor = (state: State, browserContextId: string | undefined): ContextEntry => {
  const fallback = state.contexts.get(state.defaultContext)!
  if (browserContextId === undefined) return fallback
  const known = state.contextsByCdp.get(browserContextId)
  if (known !== undefined) return known
  if (fallback.browserContextId === undefined && state.attachedAtConnect) {
    fallback.browserContextId = browserContextId
    state.contextsByCdp.set(browserContextId, fallback)
    return fallback
  }
  // A context someone else created
  const entry = new ContextEntry(state.ids.userContext(), browserContextId, false)
  state.contexts.set(entry.id, entry)
  state.contextsByCdp.set(browserContextId, entry)
  state.buffer.emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
  return entry
}

/** A realm the fold learned of, in the tables but not yet reported. */
export const addRealm = (
  state: State,
  realm: Omit<RealmEntry, "ended" | "pending" | "held" | "id">
): RealmEntry => {
  const entry: RealmEntry = { ...realm, id: state.ids.realm(), ended: false, pending: false, held: [] }
  state.realms.set(entry.id, entry)
  state.realmsByContext.set(contextKey(entry.target, entry.contextId), entry)
  state.realmsByUnique.set(entry.uniqueId, entry)
  return entry
}
