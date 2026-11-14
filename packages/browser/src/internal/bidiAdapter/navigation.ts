/**
 * Navigations on BiDi: the `browsingContext` domain's navigation events as L1's navigations and documents, and
 * the commands that start them. A navigation command whose reply is an error may still have started a
 * navigation, whose outcome the events report; one that never started ends at once.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import * as Script from "../../bidi-protocol/Script.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import type * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Kit from "../adapterKit.ts"
import * as ProtocolClient from "../protocolClient.ts"
import * as Urls from "../urls.ts"
import { errorPage, errorText, intended, originOf } from "./mapping.ts"
import {
  type Event,
  navigableById,
  type NavigableEntry,
  navigableOf,
  type NavigationEntry,
  type RealmEntry,
  type State
} from "./state.ts"
import { cancelRestoration, commit, endNavigation, startNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

const sameDocument = (
  state: State,
  context: string,
  bidi: string | null,
  url: string,
  via: "fragment" | "historyApi",
  received?: number
) => {
  const navigable = navigableOf(state, context)
  const document = navigable?.document
  if (navigable === undefined || document === undefined) return
  const known = bidi === null ? undefined : state.navigations.get(bidi)
  const bound = bidi === null ? undefined : navigable.commandNavigations.get(bidi)
  let expected: Kit.Expected | null = null
  // startNavigation consumes an exact reply binding itself. Only claim by URL when neither
  // live nor reply identity owns this event, so one observation cannot take two reservations.
  if (known === undefined && bound === undefined) {
    let index = navigable.expected.list.findIndex((expected) => Kit.normalize(expected.url) === Kit.normalize(url))
    // Traversal reservations have no destination URL. Only the surviving, unambiguous
    // traversal owner can claim them while its command is in flight; never take an older command.
    if (
      index < 0 && !navigable.restorationAmbiguous && navigable.restoring !== undefined &&
      navigable.traversalCommands.has(navigable.restoring.navigation) &&
      (received === undefined || navigable.restoring.sameDocumentThrough === undefined ||
        received < navigable.restoring.sameDocumentThrough)
    ) {
      index = navigable.expected.list.findIndex((expected) =>
        expected.id === navigable.restoring!.navigation && expected.initiatedAs === "traversal"
      )
    }
    if (index >= 0) expected = navigable.expected.list.splice(index, 1)[0]!
  }
  const navigation = known ??
    startNavigation(
      state,
      navigable,
      bidi ?? `same:${navigable.bidi}:${url}:${Math.random()}`,
      url,
      via,
      true,
      expected
    )
  document.url = url
  state.buffer.emit({
    _tag: "DocumentUrlChanged",
    document: document.id,
    url: Urls.reported(url),
    navigation: navigation.id,
    via
  })
  endNavigation(
    state,
    navigation,
    { _tag: "SameDocument", document: document.id, via },
    `bidi:browsingContext.${via === "fragment" ? "fragmentNavigated" : "historyUpdated"}`
  )
}

const readiness = (
  state: State,
  context: string,
  bidi: string | null,
  readiness: "interactive" | "complete",
  params: BrowsingContext.NavigationInfo
) => {
  const document = navigableOf(state, context)?.document
  if (document === undefined) return
  const navigation = bidi === null ? undefined : state.navigations.get(bidi)
  const startedAt = bidi === null ? undefined : navigation?.starts.get(bidi)
  if (navigation !== undefined && !navigation.ended && startedAt !== undefined && params.timestamp < startedAt) {
    // Firefox stamps a delayed old-document load with the current navigation's identity.
    // Its timestamp, not its arrival or a matching destination URL, proves it predates that start.
    if (
      readiness === "complete" && document.navigation !== bidi && params.url === document.url &&
      (document.committedAt === undefined || params.timestamp >= document.committedAt)
    ) {
      navigation.staleLoad = document.id
    }
    return
  }
  if (bidi !== null) {
    const documentStart = document.navigationStarts?.get(bidi)
    if (documentStart !== undefined && params.timestamp < documentStart) return
    // The same delayed load can arrive before the start of the identity it names: keep it for that start.
    if (
      navigation === undefined && documentStart === undefined && document.navigation !== bidi &&
      readiness === "complete" && params.url === document.url &&
      (document.committedAt === undefined || params.timestamp >= document.committedAt)
    ) {
      document.navigable.staleLoad = { bidi, timestamp: params.timestamp, document: document.id }
    }
    if (document.navigation !== undefined && document.navigation !== bidi && documentStart === undefined) return
  }
  if (readiness === "interactive" && document.complete) {
    // Loaded again after it was complete: `document.open()` replaced its tree (probe 17)
    document.generation++
    document.complete = false
    state.buffer.emit({ _tag: "DocumentOpened", document: document.id, generation: document.generation })
  }
  if (readiness === "complete") document.complete = true
  state.buffer.emit({ _tag: "DocumentReadiness", document: document.id, readiness })
}

const committed = (state: State, navigable: NavigableEntry, params: BrowsingContext.NavigationInfo) => {
  const url = params.url ?? ""
  const bidi = params.navigation ?? `committed:${navigable.bidi}:${url}`
  // A duplicate commit for the current document is not another document or outcome.
  if (navigable.document?.navigation === bidi) return
  navigable.staleLoad = undefined
  const isError = errorPage(url)
  const known = state.navigations.get(bidi)
  const bound = navigable.commandNavigations.has(bidi)
  const rejected = navigable.failedNavigation
  const identifiedFailure = rejected !== undefined &&
    (rejected.bidi === bidi || (bidi !== null && rejected.aliases?.has(bidi)) ||
      (rejected.bidi === undefined && navigable.navigationCommands.size === 0 &&
        Kit.normalize(rejected.url) === Kit.normalize(intended(url))))
  if (isError && known === undefined && !bound) {
    if (
      navigable.pendingTerminals.some((event) =>
        event.kind === "commit" && event.params.navigation === params.navigation
      )
    ) return
    // Observe the browser's document now. A command reply can establish provenance later, but cannot
    // change this immutable observation or commit the document a second time.
    const document = commit(
      state,
      navigable,
      url,
      originOf(url),
      identifiedFailure ? { _tag: "ErrorPage", navigation: rejected!.id } : { _tag: "UnattributedErrorPage" },
      bidi,
      "bidi:browsingContext.navigationCommitted"
    )
    if (identifiedFailure) navigable.failedNavigation = undefined
    else if (navigable.navigationCommands.size > 0) {
      navigable.pendingTerminals.push({ kind: "commit", params, document: document.id, rejected })
    }
    return
  }
  const navigation = known ??
    startNavigation(state, navigable, bidi, intended(url), "crossDocument", false, isError ? null : undefined)
  const document = commit(
    state,
    navigable,
    url,
    originOf(url),
    isError ? { _tag: "ErrorPage", navigation: navigation.id } : { _tag: "Navigation", navigation: navigation.id },
    bidi,
    "bidi:browsingContext.navigationCommitted"
  )
  document.committedAt = params.timestamp
  document.navigationStarts = new Map(navigation.starts)
  endNavigation(
    state,
    navigation,
    isError
      ? { _tag: "Failed", error: errorText(url), errorDocument: Option.some(document.id) }
      : { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
    "bidi:browsingContext.navigationCommitted"
  )
  if (isError || navigable.pendingTerminals.length === 0) navigable.failedNavigation = undefined
}

const failed = (state: State, navigable: NavigableEntry, params: BrowsingContext.NavigationInfo, aborted: boolean) => {
  const navigation = params.navigation === null ? undefined : state.navigations.get(params.navigation) ??
    (navigable.commandNavigations.has(params.navigation)
      ? startNavigation(state, navigable, params.navigation, intended(params.url ?? ""), "crossDocument", false, null)
      : undefined)
  if (navigation === undefined) return
  endNavigation(
    state,
    navigation,
    !aborted && (navigation.status === 204 || navigation.status === 205)
      ? { _tag: "NoContent", status: navigation.status, response: Option.fromUndefinedOr(navigation.documentHop) }
      : { _tag: "Failed", error: aborted ? "navigation aborted" : "navigation failed", errorDocument: Option.none() },
    `bidi:browsingContext.${aborted ? "navigationAborted" : "navigationFailed"}`
  )
}

const started = (state: State, navigable: NavigableEntry, params: BrowsingContext.NavigationInfo) => {
  const early = navigable.staleLoad
  navigable.staleLoad = undefined
  if (params.navigation === null || state.navigations.has(params.navigation)) return
  const pending = [...new Set(navigable.navigations.values())].filter((entry) => !entry.ended && !entry.sameDocument)
  // Delivery can lag behind a newer start or a commit; old starts cannot replace newer work.
  if (
    (navigable.document?.committedAt !== undefined && params.timestamp < navigable.document.committedAt) ||
    pending.some((entry) => [...entry.starts.values()].some((timestamp) => params.timestamp < timestamp))
  ) return
  const previous = pending.length === 1 ? pending[0] : undefined
  const staleDocument = previous?.staleLoad
  for (const entry of pending) entry.staleLoad = undefined
  if (
    previous !== undefined && staleDocument !== undefined && staleDocument === navigable.document?.id &&
    previous.documentHop !== undefined && navigable.expected.list.length === 0 &&
    navigable.commandNavigations.size === 0 && navigable.navigationCommands.size <= 1 &&
    (navigable.navigationCommands.size === 0 || navigable.navigationCommands.has(previous.id)) &&
    params.timestamp > Math.max(...previous.starts.values()) &&
    Kit.normalize(previous.url) === Kit.normalize(intended(params.url ?? ""))
  ) {
    // A delayed load can make Firefox allocate another wire identity without another document request.
    // Correlate provisionally: a distinct document request for this identity separates it again.
    previous.starts.set(params.navigation, params.timestamp)
    navigable.navigations.set(params.navigation, previous)
    state.navigations.set(params.navigation, previous)
    return
  }
  // Firefox leaves out the URL of the navigation that closing with promptUnload starts.
  const navigation = startNavigation(
    state,
    navigable,
    params.navigation,
    intended(params.url ?? ""),
    "crossDocument",
    false
  )
  navigation.starts.set(params.navigation, params.timestamp)
  if (
    early !== undefined && early.bidi === params.navigation && early.timestamp < params.timestamp &&
    early.document === navigable.document?.id
  ) navigation.staleLoad = early.document
}

/** Resolves attribution only; no deferred event can start a competing navigation or commit a document. */
const resolveTerminals = (state: State, navigable: NavigableEntry) => {
  for (let index = 0; !navigable.removed && index < navigable.pendingTerminals.length;) {
    const event = navigable.pendingTerminals[index]!
    const bidi = event.params.navigation
    const known = bidi === null ? undefined : state.navigations.get(bidi)
    const bound = bidi !== null && navigable.commandNavigations.has(bidi)
    const rejected = event.rejected ?? navigable.failedNavigation
    const matchesFailure = !bound && rejected !== undefined && (known === undefined || known.id === rejected.id) &&
      (rejected.bidi === bidi || (bidi !== null && rejected.aliases?.has(bidi)) ||
        (rejected.bidi === undefined && navigable.navigationCommands.size === 0 &&
          Kit.normalize(rejected.url) === Kit.normalize(intended(event.params.url ?? ""))))
    if (known === undefined && !bound && !matchesFailure && navigable.navigationCommands.size > 0) {
      index++
      continue
    }
    navigable.pendingTerminals.splice(index, 1)
    if (event.kind !== "commit") {
      failed(state, navigable, event.params, event.kind === "abort")
      continue
    }
    const navigation = known ?? (bound
      ? startNavigation(state, navigable, bidi!, intended(event.params.url ?? ""), "crossDocument", false, null)
      : undefined)
    if (navigation !== undefined && !navigation.ended) {
      // This existing outcome expresses the association without an extra fact.
      endNavigation(state, navigation, {
        _tag: "Failed",
        error: errorText(event.params.url ?? ""),
        errorDocument: Option.some(event.document!)
      }, "bidi:browsingContext.navigationCommitted (correlated)")
    } else if (matchesFailure) {
      // Its Failed(None) was already published: a second NavigationEnded would be a second outcome.
      state.buffer.emit({ _tag: "ErrorDocumentAttributed", document: event.document!, navigation: rejected!.id })
    }
    if (matchesFailure) navigable.failedNavigation = undefined
  }
  if (navigable.navigationCommands.size === 0 && navigable.pendingTerminals.length === 0) {
    for (const [bidi, navigation] of navigable.navigations) {
      if (!navigation.ended) continue
      navigable.navigations.delete(bidi)
      if (state.navigations.get(bidi) === navigation) state.navigations.delete(bidi)
      navigation.starts.clear()
      navigation.staleLoad = undefined
    }
  }
}

export const register = (handlers: Kit.Handlers<Event>) => {
  const terminal = (state: State, params: BrowsingContext.NavigationInfo, kind: "failure" | "abort") => {
    const navigable = navigableOf(state, params.context)
    if (navigable === undefined) return
    if (
      params.navigation !== null &&
      (state.navigations.has(params.navigation) || navigable.commandNavigations.has(params.navigation))
    ) {
      failed(state, navigable, params, kind === "abort")
    } else if (navigable.navigationCommands.size > 0) {
      navigable.pendingTerminals.push({ kind, params })
    }
    resolveTerminals(state, navigable)
  }
  return handlers
    .on(BrowsingContext.navigationStarted, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      if (navigable === undefined) return
      started(state, navigable, params)
      resolveTerminals(state, navigable)
    })
    .on(BrowsingContext.navigationCommitted, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      if (navigable === undefined) return
      committed(state, navigable, params)
      resolveTerminals(state, navigable)
    })
    .on(BrowsingContext.navigationFailed, (params, { state }) => terminal(state, params, "failure"))
    .on(BrowsingContext.navigationAborted, (params, { state }) => terminal(state, params, "abort"))
    .on(
      BrowsingContext.fragmentNavigated,
      (params, { state, received }) =>
        sameDocument(state, params.context, params.navigation, params.url ?? "", "fragment", received)
    )
    .on(
      BrowsingContext.historyUpdated,
      (params, { state, received }) =>
        sameDocument(state, params.context, null, params.url ?? "", "historyApi", received)
    )
    .on(
      BrowsingContext.domContentLoaded,
      (params, { state }) => readiness(state, params.context, params.navigation, "interactive", params)
    )
    .on(
      BrowsingContext.load,
      (params, { state }) => readiness(state, params.context, params.navigation, "complete", params)
    )
}

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Sends a navigation command whose navigation was expected as `id`. What the browser doesn't implement fails the
 * operation; any other error, the navigation, which ends at once unless the browser started it (Q233).
 */
const sendNavigation = (
  state: State,
  navigable: NavigableEntry,
  id: PageNavigation.Id,
  url: string,
  command: Effect.Effect<BrowsingContext.NavigateResult, Protocol.ProtocolError>
) =>
  Effect.suspend(() => {
    navigable.navigationCommands.add(id)
    return command.pipe(
      Effect.tap((reply) =>
        state.buffer.run(() => {
          if (navigable.removed || reply.navigation === null) return
          const index = navigable.expected.list.findIndex((expected) => expected.id === id)
          if (index < 0) return
          const [expected] = navigable.expected.list.splice(index, 1)
          navigable.commandNavigations.set(reply.navigation, expected!)
        })
      ),
      Effect.as(id),
      Effect.catch((error) =>
        error.reason._tag === "Unsupported"
          ? Effect.andThen(
            Effect.sync(() => Kit.unexpect(navigable.expected, id)),
            Effect.fail(Kit.protocolError(error))
          )
          : Effect.as(
            Effect.andThen(
              state.buffer.run(() => {
                const expected = navigable.expected.list.find((expected) => expected.id === id)
                if (expected !== undefined) navigable.failedNavigation = expected
              }),
              Kit.neverStarted(state.buffer, {
                drained: state.root().drainObserved,
                expectations: navigable.expected,
                navigable: navigable.id,
                navigation: id,
                url,
                error: error.message,
                evidence: "bidi:browsingContext.navigate"
              })
            ),
            id
          )
      ),
      Effect.onInterrupt(() =>
        state.buffer.run(() => {
          Kit.unexpect(navigable.expected, id)
        })
      ),
      Effect.ensuring(state.buffer.run(() => {
        navigable.navigationCommands.delete(id)
        resolveTerminals(state, navigable)
      }))
    )
  })

export const navigate = Effect.fnUntraced(function*(
  state: State,
  id: L1Target.NavigableId,
  url: string,
  options: { readonly referrer: Option.Option<string> }
) {
  const navigable = yield* navigableById(state, id)
  if (Option.isSome(options.referrer)) {
    return yield* Effect.fail(Kit.unsupported("navigation.referrer", "WebDriver BiDi's navigate takes no referrer"))
  }
  cancelRestoration(navigable)
  const navigation = Kit.expect(state.ids, navigable.expected, url)
  return yield* sendNavigation(
    state,
    navigable,
    navigation,
    url,
    state.send(BrowsingContext.navigate({ context: navigable.bidi, url, wait: "none" }))
  )
})

export const reload = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: { readonly ignoreCache: boolean }) {
    const navigable = yield* navigableById(state, id)
    const url = navigable.document?.url ?? ""
    cancelRestoration(navigable)
    const navigation = Kit.expect(state.ids, navigable.expected, url, "reload")
    return yield* sendNavigation(
      state,
      navigable,
      navigation,
      url,
      state.send(BrowsingContext.reload({
        context: navigable.bidi,
        // Firefox 158 refuses the argument whatever its value, so it is sent only to bypass the cache
        ...(options.ignoreCache ? { ignoreCache: true } : {}),
        wait: "none"
      }))
    )
  }
)

export const traverse = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId, delta: number) {
  const navigable = yield* navigableById(state, id)
  // An unannounced realm cannot distinguish overlapping traversals. Invalidated commands remain
  // in traversalCommands until their replies, so a third command cannot silently regain ownership.
  const ambiguous = navigable.restorationAmbiguous || navigable.restoring !== undefined ||
    navigable.traversalCommands.size > 0
  cancelRestoration(navigable)
  const navigation = Kit.expect(state.ids, navigable.expected, "", "traversal")
  if (ambiguous) Kit.unexpect(navigable.expected, navigation)
  let replied = false
  // The reply comes once the traversal is done. One still in flight then, with a new main-world realm and
  // no commit, restored its document from the back/forward cache, which Firefox reports no other way. It may
  // not even have started one (Firefox 158, leaving its JSON viewer): then the realm says where it is.
  const evidence = "bidi:browsingContext.traverseHistory replied with a new realm and no commit"
  const restore = (entry: NavigationEntry, realm: RealmEntry) => {
    const from = navigable.past.get(entry.url)
    const document = commit(
      state,
      navigable,
      entry.url,
      realm.origin,
      from === undefined
        ? { _tag: "Navigation", navigation: entry.id }
        : { _tag: "Restored", navigation: entry.id, from },
      entry.bidi,
      evidence
    )
    endNavigation(
      state,
      entry,
      from === undefined
        ? { _tag: "Committed", document: document.id, response: Option.none() }
        : { _tag: "Restored", document: document.id },
      evidence
    )
  }
  const pendingRealm = () => navigable.pendingRealms.find((pending) => !pending.ended && pending.world._tag === "Main")
  const restoration = {
    navigation,
    sameDocumentThrough: undefined as number | undefined,
    arrived: (realm: RealmEntry) => {
      if (replied) state.buffer.later(complete(realm))
    }
  }
  const valid = (realm: RealmEntry) =>
    navigable.restoring === restoration && !navigable.removed && !realm.ended && pendingRealm() === realm
  const complete = Effect.fnUntraced(function*(realm: RealmEntry) {
    if (!valid(realm)) return
    const entry = [...navigable.navigations.values()].find((pending) => pending.id === navigation)
    if (entry !== undefined) {
      yield* state.buffer.run(() => {
        if (valid(realm) && !entry.ended) restore(entry, realm)
      })
      return
    }
    const href = yield* state.send(Script.evaluate({
      expression: "location.href",
      target: { realm: realm.bidi },
      awaitPromise: false
    })).pipe(
      Effect.map((result) =>
        result.type === "success" && result.result.type === "string" ? result.result.value : undefined
      ),
      Effect.orElseSucceed(() => undefined)
    )
    yield* state.buffer.run(() => {
      if (!valid(realm)) return
      if (href === undefined) {
        cancelRestoration(navigable)
        return
      }
      const index = navigable.expected.list.findIndex((expected) => expected.id === navigation)
      if (index < 0) {
        const announced = [...navigable.navigations.values()].find((pending) => pending.id === navigation)
        if (announced !== undefined && !announced.ended) restore(announced, realm)
        return
      }
      const [taken] = navigable.expected.list.splice(index, 1)
      restore(startNavigation(state, navigable, `restored:${navigation}`, href, "traversal", false, taken), realm)
    })
  })
  // Install before sending: newer commands and events can invalidate this record while the reply
  // is pending. A late reply may use its own surviving record, but can never install one again.
  navigable.restoring = restoration
  navigable.traversalCommands.add(navigation)
  const release = (noHistory: boolean) =>
    state.buffer.run(() => {
      Kit.unexpect(navigable.expected, navigation)
      if (navigable.restoring !== restoration) return
      // Only this rejection proves the command did not traverse. Do not clear ambiguity that
      // already existed, or disregard a navigation the browser positively announced.
      if (noHistory && ![...navigable.navigations.values()].some((entry) => entry.id === navigation)) {
        navigable.restoring = undefined
      } else cancelRestoration(navigable)
    })
  return yield* Effect.gen(function*() {
    const exit = yield* Effect.exit(
      state.send(BrowsingContext.traverseHistory({ context: navigable.bidi, delta })).pipe(
        // Replies bypass the fold worker. Keep ownership until earlier observations are folded,
        // but fence it at receipt so events received later cannot claim it while the drain waits.
        Effect.provideService(ProtocolClient.ReplyReceived, (received) => {
          restoration.sameDocumentThrough = received
        }),
        Effect.tap(() => state.root().drainObserved),
        Effect.ensuring(Effect.sync(() => {
          navigable.traversalCommands.delete(navigation)
        }))
      )
    )
    if (exit._tag === "Failure") {
      const noHistory = Option.exists(
        Cause.findErrorOption(exit.cause),
        (error) =>
          error.reason._tag === "Rejected" && error.reason.method === "browsingContext.traverseHistory" &&
          error.reason.code === "no such history entry"
      )
      yield* release(noHistory)
      return Option.none<PageNavigation.Id>()
    }
    let realm: RealmEntry | undefined
    yield* state.buffer.run(() => {
      if (navigable.restoring !== restoration) return
      const entry = [...navigable.navigations.values()].find((pending) => pending.id === navigation)
      if (
        ambiguous || navigable.removed || (entry === undefined
          ? !navigable.expected.list.some((expected) => expected.id === navigation)
          : entry.ended)
      ) {
        cancelRestoration(navigable)
        return
      }
      replied = true
      realm = pendingRealm()
    })
    if (realm !== undefined) yield* complete(realm)
    return Option.some(navigation)
  }).pipe(Effect.onInterrupt(() => release(false)))
})
