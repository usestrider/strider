/**
 * The WebKit adapter's tree of frames, documents and navigations, and how each ends: WebKit never reports an
 * execution context destroyed, so a document's realms end when another document commits in its frame, when the
 * frame goes, or with their target.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as PageNavigation from "../../PageNavigation.ts"
import type * as L1Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { forgetRealm } from "./evaluation.ts"
import {
  type ContextEntry,
  contextKey,
  type DocumentEntry,
  type FrameEntry,
  type NavigationEntry,
  type PageEntry,
  type RealmEntry,
  type State
} from "./state.ts"

// ── Ending things ─────────────────────────────────────────────────────────────────────────────────────────

export const removeRealm = (state: State, realm: RealmEntry, reason: L1Target.CloseReason) =>
  Kit.removeRealm(state.buffer, realm, reason, (realm) => {
    state.realms.delete(realm.id)
    if (realm.contextId !== undefined) state.realmsByContext.delete(contextKey(realm.target, realm.contextId))
    realm.document?.realms.delete(realm)
    // What the adapter made in it goes with it
    state.buffer.later(forgetRealm(state, realm.id))
  })

export const endNavigation = (
  state: State,
  navigation: NavigationEntry,
  outcome: Adapter.NavigationOutcome,
  evidence: string
) =>
  Kit.endNavigation(state.buffer, navigation, outcome, evidence, (navigation) => {
    navigation.frame.navigations.delete(navigation.loaderId)
    if (state.navigations.get(navigation.loaderId) === navigation) state.navigations.delete(navigation.loaderId)
  })

const dropDocument = (state: State, document: DocumentEntry, reason: L1Target.CloseReason) => {
  for (const realm of Array.from(document.realms)) removeRealm(state, realm, reason)
  state.documents.delete(document.id)
}

/** Ends a frame and everything below it, deepest first. */
export const removeFrame = (state: State, frame: FrameEntry, reason: L1Target.CloseReason, evidence: string) =>
  Kit.removeNavigable(state.buffer, frame, reason, evidence, (frame, reason) => {
    if (state.frames.get(frame.frameId) === frame) state.frames.delete(frame.frameId)
    state.navigables.delete(frame.id)
    if (frame.document !== undefined) dropDocument(state, frame.document, reason)
  })

export const endPage = (state: State, page: PageEntry, reason: L1Target.CloseReason, evidence: string) => {
  if (page.ended) return
  page.ended = true
  for (const [frameId, frame] of Array.from(state.frames)) {
    if (frame === page.main) state.frames.delete(frameId)
  }
  removeFrame(state, page.main, reason, evidence)
  state.pages.delete(page.id)
  state.endedPages.set(page.id, reason)
  state.pagesByProxy.delete(page.pageProxyId)
  for (const [id, obligation] of state.obligations) {
    const owner = obligation._tag === "Prompt" ? obligation.page : obligation.target.page
    if (owner === page) {
      state.obligations.delete(id)
      state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "targetGone", evidence })
    }
  }
  Deferred.doneUnsafe(page.ready, Effect.fail(Kit.gone({ _tag: "Page", id: page.id }, reason)))
}

// ── Documents ─────────────────────────────────────────────────────────────────────────────────────────────

export const commit = (
  state: State,
  frame: FrameEntry,
  snapshot: { readonly loaderId: string; readonly url: string; readonly origin: string },
  createdBy: Adapter.DocumentCreatedBy,
  evidence: string
): DocumentEntry => {
  // Children of the replaced document end with it
  for (const child of Array.from(frame.children)) {
    removeFrame(state, child, { _tag: "FrameDetached" }, "webkit: the parent's document was replaced")
  }
  const old = frame.document
  const document: DocumentEntry = {
    id: state.ids.document(),
    frame,
    loaderId: snapshot.loaderId,
    url: snapshot.url,
    realms: new Set(),
    interactive: false,
    complete: false,
    generation: 0
  }
  state.documents.set(document.id, document)
  frame.document = document
  state.buffer.emit({
    _tag: "DocumentCommitted",
    document: document.id,
    navigable: frame.id,
    url: snapshot.url,
    origin: snapshot.origin === "" ? "null" : snapshot.origin,
    createdBy,
    replaced: Option.fromUndefinedOr(old?.id),
    evidence
  })
  // WebKit never reports a context destroyed: the old document's realms end with it
  if (old !== undefined) dropDocument(state, old, { _tag: "RealmDestroyed" })
  return document
}

/**
 * Stock WebKit's error page is a load of its own, about:blank, after the failure (QUIRKS.md, Q199): the failed
 * navigation's document, never a navigation of its own. A load it refuses before any request, such as to a port
 * it blocks, shows only the error page: the goto it stands in for failed then.
 */
export const errorPage = (
  state: State,
  frame: FrameEntry,
  loaderId: string,
  url: string
): PageNavigation.Id | undefined => {
  const known = state.errorLoaders.get(loaderId)
  if (known !== undefined || Kit.normalize(url) !== "about:blank") return known
  const after = state.errorPageFor.get(frame)
  if (after !== undefined) {
    state.errorPageFor.delete(frame)
    state.errorLoaders.set(loaderId, after)
    return after
  }
  if (frame.expected.list.some((expected) => Kit.normalize(expected.url) === "about:blank")) return undefined
  const refused = frame.expected.list.shift()
  if (refused === undefined) return undefined
  const failed = startNavigationAs(
    state,
    frame,
    refused.id,
    `refused:${refused.id}`,
    refused.url,
    refused.initiatedAs,
    false
  )
  endNavigation(
    state,
    failed,
    {
      _tag: "Failed",
      error: "WebKit showed its error page instead: a load it refused, such as to a port it blocks",
      errorDocument: Option.none()
    },
    "webkit:Network.requestWillBeSent"
  )
  state.errorLoaders.set(loaderId, refused.id)
  return refused.id
}

export const startNavigation = (
  state: State,
  frame: FrameEntry,
  loaderId: string,
  url: string,
  type: Adapter.InitiatedAs,
  sameDocument: boolean
): NavigationEntry => {
  // A blank document takes only an expectation to about:blank: it's the error page, or a frame's first document
  const expected = Kit.normalize(url) === "about:blank" &&
      !frame.expected.list.some((expected) => Kit.normalize(expected.url) === "about:blank")
    ? undefined
    : Kit.take(frame.expected, url)
  return startNavigationAs(
    state,
    frame,
    expected?.id ?? state.ids.navigation(),
    loaderId,
    url,
    expected?.initiatedAs ?? type,
    sameDocument
  )
}

export const startNavigationAs = (
  state: State,
  frame: FrameEntry,
  id: PageNavigation.Id,
  loaderId: string,
  url: string,
  type: Adapter.InitiatedAs,
  sameDocument: boolean
): NavigationEntry => {
  const navigation: NavigationEntry = {
    id,
    frame,
    loaderId,
    url,
    sameDocument,
    documentHop: undefined,
    status: undefined,
    attachment: false,
    ended: false
  }
  if (!sameDocument) {
    // A frame has one cross-document navigation at a time: a new one replaces the one in flight
    for (const pending of Array.from(frame.navigations.values())) {
      if (!pending.sameDocument) {
        endNavigation(state, pending, { _tag: "Superseded", by: navigation.id }, "webkit:Network.requestWillBeSent")
      }
    }
  }
  frame.navigations.set(loaderId, navigation)
  state.navigations.set(loaderId, navigation)
  state.buffer.emit({
    _tag: "NavigationStarted",
    navigation: navigation.id,
    navigable: frame.id,
    url,
    initiatedAs: type
  })
  return navigation
}

// A load that failed: no content, or an error, by the response it got.
export const failLoad = (state: State, navigation: NavigationEntry, error: string, evidence: string) =>
  endNavigation(
    state,
    navigation,
    navigation.status === 204 || navigation.status === 205
      ? { _tag: "NoContent", status: navigation.status, response: Option.fromUndefinedOr(navigation.documentHop) }
      : { _tag: "Failed", error, errorDocument: Option.none() },
    evidence
  )

// ── Frames and contexts ───────────────────────────────────────────────────────────────────────────────────

/** A child frame, by its key (`frameKey`). */
export const addFrame = (state: State, frameId: string, parent: FrameEntry): FrameEntry => {
  const frame: FrameEntry = {
    frameId,
    id: state.ids.navigable(),
    page: parent.page,
    parent,
    children: new Set(),
    document: undefined,
    expected: Kit.makeExpectations(),
    navigations: new Map(),
    removed: false
  }
  parent.children.add(frame)
  state.frames.set(frameId, frame)
  state.navigables.set(frame.id, frame)
  state.buffer.emit({ _tag: "FrameAdded", frame: frame.id, parent: parent.id, page: parent.page.id })
  return frame
}

export const contextFor = (state: State, browserContextId: string): ContextEntry => {
  const known = state.contextsByWk.get(browserContextId)
  if (known !== undefined) return known
  const fallback = state.contexts.get(state.defaultContext)!
  if (fallback.browserContextId === undefined) {
    // Every context but the default one is created here, so a context nobody created is the default
    fallback.browserContextId = browserContextId
    state.contextsByWk.set(browserContextId, fallback)
    return fallback
  }
  const entry: ContextEntry = {
    id: state.ids.userContext(),
    browserContextId,
    isDefault: false,
    removing: false
  }
  state.contexts.set(entry.id, entry)
  state.contextsByWk.set(browserContextId, entry)
  state.buffer.emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false })
  return entry
}

// ── URLs ──────────────────────────────────────────────────────────────────────────────────────────────────

export const withoutFragment = (url: string): string => {
  const hash = url.indexOf("#")
  return hash < 0 ? url : url.slice(0, hash)
}

export const originOf = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return "null"
  }
}
