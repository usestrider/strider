/**
 * Navigations on BiDi: the `browsingContext` domain's navigation events as L1's navigations and documents, and
 * the commands that start them. A navigation command whose reply is an error may still have started a
 * navigation, whose outcome the events report; one that never started ends at once.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import * as Script from "../../bidi-protocol/Script.ts"
import type * as PageNavigation from "../../PageNavigation.ts"
import type * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Kit from "../adapterKit.ts"
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
import { commit, endNavigation, startNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

const sameDocument = (
  state: State,
  context: string,
  bidi: string | null,
  url: string,
  via: "fragment" | "historyApi"
) => {
  const navigable = navigableOf(state, context)
  const document = navigable?.document
  if (navigable === undefined || document === undefined) return
  const navigation = (bidi === null ? undefined : state.navigations.get(bidi)) ??
    startNavigation(state, navigable, bidi ?? `same:${navigable.bidi}:${url}:${Math.random()}`, url, via, true)
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

const readiness = (state: State, context: string, bidi: string | null, readiness: "interactive" | "complete") => {
  const document = navigableOf(state, context)?.document
  if (document === undefined) return
  if (document.navigation !== undefined && bidi !== null && document.navigation !== bidi) return
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
  const failed = errorPage(url)
  const rejected = navigable.failedNavigation
  if (
    failed && rejected !== undefined && (rejected.bidi === undefined
      ? Kit.normalize(rejected.url) === Kit.normalize(intended(url))
      : rejected.bidi === bidi) &&
    !state.navigations.has(bidi) && !navigable.commandNavigations.has(bidi)
  ) {
    commit(
      state,
      navigable,
      url,
      originOf(url),
      { _tag: "ErrorPage", navigation: rejected.id },
      bidi,
      "bidi:browsingContext.navigationCommitted"
    )
    navigable.failedNavigation = undefined
    return
  }
  if (!failed) navigable.failedNavigation = undefined
  // Unannounced error pages need command reply identity, never URL equality (ROOK-130).
  const navigation = state.navigations.get(bidi) ??
    startNavigation(
      state,
      navigable,
      bidi,
      intended(url),
      "crossDocument",
      false,
      failed ? null : undefined
    )
  const document = commit(
    state,
    navigable,
    url,
    originOf(url),
    failed ? { _tag: "ErrorPage", navigation: navigation.id } : { _tag: "Navigation", navigation: navigation.id },
    bidi,
    "bidi:browsingContext.navigationCommitted"
  )
  endNavigation(
    state,
    navigation,
    failed
      ? { _tag: "Failed", error: errorText(url), errorDocument: Option.some(document.id) }
      : { _tag: "Committed", document: document.id, response: Option.fromUndefinedOr(navigation.documentHop) },
    "bidi:browsingContext.navigationCommitted"
  )
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

const terminal = (state: State, params: BrowsingContext.NavigationInfo, aborted: boolean) => {
  const navigable = navigableOf(state, params.context)
  if (navigable === undefined) return
  if (
    params.navigation !== null && !state.navigations.has(params.navigation) &&
    !navigable.commandNavigations.has(params.navigation) && navigable.navigationCommands.size > 0
  ) {
    navigable.pendingNavigationEvents.push({ kind: aborted ? "abort" : "failure", params })
    return
  }
  flushNavigationEvents(state, navigable)
  failed(state, navigable, params, aborted)
}

const flushNavigationEvents = (state: State, navigable: NavigableEntry) => {
  for (const event of navigable.pendingNavigationEvents.splice(0)) {
    if (navigable.removed) continue
    if (event.kind === "commit") committed(state, navigable, event.params)
    else failed(state, navigable, event.params, event.kind === "abort")
  }
}

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(BrowsingContext.navigationStarted, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      if (navigable === undefined || params.navigation === null) return
      // Firefox leaves out the URL of the navigation that closing with promptUnload starts
      if (!state.navigations.has(params.navigation)) {
        startNavigation(state, navigable, params.navigation, intended(params.url ?? ""), "crossDocument", false)
      }
      flushNavigationEvents(state, navigable)
    })
    .on(BrowsingContext.navigationCommitted, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      if (navigable === undefined) return
      const bidi = params.navigation
      if (
        errorPage(params.url ?? "") && (bidi === null || !state.navigations.has(bidi)) &&
        (bidi === null || !navigable.commandNavigations.has(bidi)) && navigable.navigationCommands.size > 0
      ) {
        navigable.pendingNavigationEvents.push({ kind: "commit", params })
        return
      }
      flushNavigationEvents(state, navigable)
      committed(state, navigable, params)
    })
    .on(BrowsingContext.navigationFailed, (params, { state }) => terminal(state, params, false))
    .on(BrowsingContext.navigationAborted, (params, { state }) => terminal(state, params, true))
    .on(
      BrowsingContext.fragmentNavigated,
      (params, { state }) => sameDocument(state, params.context, params.navigation, params.url ?? "", "fragment")
    )
    .on(
      BrowsingContext.historyUpdated,
      (params, { state }) => sameDocument(state, params.context, null, params.url, "historyApi")
    )
    .on(
      BrowsingContext.domContentLoaded,
      (params, { state }) => readiness(state, params.context, params.navigation, "interactive")
    )
    .on(BrowsingContext.load, (params, { state }) => readiness(state, params.context, params.navigation, "complete"))

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
        if (navigable.navigationCommands.size === 0) flushNavigationEvents(state, navigable)
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
  const navigation = Kit.expect(state.ids, navigable.expected, "", "traversal")
  const exit = yield* Effect.exit(state.send(BrowsingContext.traverseHistory({ context: navigable.bidi, delta })))
  if (exit._tag === "Failure") {
    Kit.unexpect(navigable.expected, navigation)
    return Option.none<PageNavigation.Id>()
  }
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
  let unannounced: RealmEntry | undefined
  yield* state.buffer.run(() => {
    const entry = [...navigable.navigations.values()].find((pending) => pending.id === navigation)
    const realm = pendingRealm()
    if (realm === undefined) {
      // Its realm hasn't arrived yet: restore when it does, unless the traversal has ended by then
      if (entry !== undefined && !entry.ended) {
        navigable.restoring = (arrived) => {
          navigable.restoring = undefined
          if (!entry.ended) restore(entry, arrived)
        }
      }
      return
    }
    if (entry !== undefined && !entry.ended) restore(entry, realm)
    else if (navigable.expected.list.some((expected) => expected.id === navigation)) unannounced = realm
  })
  if (unannounced !== undefined) {
    const realm = unannounced
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
      if (href === undefined || pendingRealm() !== realm) return
      const index = navigable.expected.list.findIndex((expected) => expected.id === navigation)
      if (index < 0) return
      const [taken] = navigable.expected.list.splice(index, 1)
      restore(startNavigation(state, navigable, `restored:${navigation}`, href, "traversal", false, taken), realm)
    })
  }
  return Option.some(navigation)
})
