/**
 * Declarations on BiDi: native scopes for preload scripts, emulation, intercepts, data collectors and downloads.
 * Viewport precedence is resolved through the declaration registry rather than native scope layering.
 * What Firefox cannot do is refused before anything is declared.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as BrowserBidi from "../../bidi-protocol/Browser.ts"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import * as Emulation from "../../bidi-protocol/Emulation.ts"
import * as Network from "../../bidi-protocol/Network.ts"
import * as Script from "../../bidi-protocol/Script.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as DeclarationCleanup from "../declarationCleanup.ts"
import * as Declarations from "../declarations.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import * as Cleanup from "./cleanup.ts"
import { bidiHeaders, coveringPattern } from "./mapping.ts"
import { placement, scopeParams, type State } from "./state.ts"

/** Where a document's preload scripts keep which of them ran. */
const ranKey = "@usestrider/browser/initScripts/ran"

/**
 * Registers the preload scripts for the scopes in order, environment phase first and broader scopes first. Any
 * change registers them all again, which only affects documents created after it.
 */
const applyScripts = Effect.fnUntraced(function*(state: State) {
  const entries = state.registry.all()
    .filter((
      entry
    ): entry is Declarations.Registered & { declaration: Extract<Adapter.Declaration, { _tag: "InitScript" }> } =>
      entry.declaration._tag === "InitScript"
    )
    .sort((a, b) =>
      (a.declaration.phase === b.declaration.phase ? 0 : a.declaration.phase === "environment" ? -1 : 1) ||
      (a.scope._tag === b.scope._tag
        ? 0
        : a.scope._tag === "Browser"
        ? -1
        : b.scope._tag === "Browser"
        ? 1
        : a.scope._tag === "UserContext"
        ? -1
        : 1) ||
      a.sequence - b.sequence
    )
  const previous = state.preloads
  const next: Array<Script.PreloadScript> = []
  for (const entry of entries) {
    // Each script is a preload of its own, so what ran is kept where the next can look: a script runs only
    // after what it comes after ran without throwing
    const ran = `(globalThis[Symbol.for(${JSON.stringify(ranKey)})] ??= new Set())`
    const body = `try { ${entry.declaration.source}\n;${ran}.add(${JSON.stringify(entry.id)}) } catch (error) { ` +
      `typeof reportError === "function" ? reportError(error) : console.error(error) }`
    const gated = entry.declaration.after.length === 0
      ? body
      : `if (${JSON.stringify(entry.declaration.after)}.every((id) => ${ran}.has(id))) { ${body} }`
    const { script } = yield* state.send(Script.addPreloadScript({
      functionDeclaration: `() => { ${gated} }`,
      ...(entry.declaration.world._tag === "Isolated" ? { sandbox: entry.declaration.world.name } : {}),
      ...scopeParams(state, entry.scope)
    }))
    next.push(script)
  }
  state.preloads = next
  yield* Effect.forEach(
    previous,
    (script) => state.send(Script.removePreloadScript({ script })).pipe(Effect.ignore),
    { discard: true }
  )
})

/**
 * Updates viewport defaults for future pages, then resolves existing pages through the registry. BiDi's user
 * context command overwrites existing page settings, and clearing a page restores the browser default rather
 * than a surrounding declaration.
 */
const applyViewport = Effect.fnUntraced(function*<E>(
  state: State,
  scope: Adapter.DeclarationScope,
  apply: (
    command: Effect.Effect<unknown, Protocol.ProtocolError>,
    target: Parameters<typeof BrowsingContext.setViewport>[0]
  ) => Effect.Effect<unknown, E>
) {
  const set = (target: Parameters<typeof BrowsingContext.setViewport>[0], override: Adapter.Override | undefined) =>
    apply(
      state.send(BrowsingContext.setViewport({
        ...target,
        viewport: override?._tag === "Viewport" ? { width: override.width, height: override.height } : null,
        devicePixelRatio: override?._tag === "Viewport" ? override.deviceScaleFactor : null
      })),
      target
    )
  if (scope._tag !== "Page") {
    for (const context of state.contexts.values()) {
      if (context.removing || (scope._tag === "UserContext" && scope.context !== context.id)) continue
      yield* set({ userContexts: [context.bidi] }, state.registry.overrides({ context: context.id }).get("Viewport"))
    }
  }
  for (const page of state.navigables.values()) {
    if (
      page.parent !== undefined || page.removed || page.closing !== undefined || page.context.removing ||
      !Declarations.covers(scope, placement(page))
    ) continue
    const effective = state.registry.overrides(placement(page)).get("Viewport")
    // The user-context command already applied defaults. Only page overrides need restoring after it.
    if (scope._tag !== "Page" && effective === state.registry.overrides({ context: page.context.id }).get("Viewport")) {
      continue
    }
    yield* set({ context: page.bidi }, effective)
  }
})

/** Reconciles surviving resources after a close/removal failed, independently for each native target. */
export const recoverViewport = (state: State, scope: Adapter.DeclarationScope) =>
  Cleanup.owned(
    applyViewport(state, scope, (command, target) =>
      Cleanup.report(Cleanup.bounded(command), `BiDi viewport recovery could not restore ${JSON.stringify(target)}`))
      .pipe(Operation.detached, Effect.provideService(ProtocolClient.CommandDeadline, Option.none())),
    state.cleanupScope
  )

/** Sets or clears a kind at its scope; viewport precedence is resolved by the registry. */
export const applyKind = (
  state: State,
  kind: Adapter.Override["_tag"],
  scope: Adapter.DeclarationScope
): Effect.Effect<void, Protocol.ProtocolError> => {
  const latest = state.registry.all()
    .filter((entry) =>
      entry.declaration._tag === "Override" && entry.declaration.override._tag === kind &&
      JSON.stringify(entry.scope) === JSON.stringify(scope)
    )
    .at(-1)
  const override = latest?.declaration._tag === "Override" ? latest.declaration.override : undefined
  const where = scopeParams(state, scope)
  switch (kind) {
    case "Viewport":
      return applyViewport(state, scope, (command) => command)
    case "UserAgent":
      return state.send(Emulation.setUserAgentOverride({
        userAgent: override?._tag === "UserAgent" ? override.userAgent : null,
        ...where
      }))
    case "Locale":
      return state.send(Emulation.setLocaleOverride({
        locale: override?._tag === "Locale" ? override.locale : null,
        ...where
      }))
    case "TimeZone":
      return state.send(Emulation.setTimezoneOverride({
        timezone: override?._tag === "TimeZone" ? override.timeZone : null,
        ...where
      }))
    case "Geolocation":
      return state.send(Emulation.setGeolocationOverride(
        override?._tag === "Geolocation"
          ? Option.match(override.position, {
            onNone: () => ({ error: { type: "positionUnavailable" }, ...where }),
            onSome: (position) => ({ coordinates: position, ...where })
          })
          : { coordinates: null, ...where }
      ))
    case "Media":
      return state.send(Emulation.setMediaFeaturesOverride({
        features: override?._tag === "Media" ? override.features : null,
        ...where
      }))
    case "Offline":
      return state.send(Emulation.setNetworkConditions({
        networkConditions: override?._tag === "Offline" && override.offline ? { type: "offline" } : null,
        ...where
      }))
    case "ExtraHeaders":
      return state.send(Network.setExtraHeaders({
        headers: override?._tag === "ExtraHeaders" ? bidiHeaders(override.headers) : [],
        ...where
      }))
    case "JavaScriptEnabled":
      return state.send(Emulation.setScriptingEnabled({
        enabled: override?._tag === "JavaScriptEnabled" && !override.enabled ? false : null,
        ...where
      }))
    case "BypassCsp":
      return state.send(BrowsingContext.setBypassCSP({
        bypass: override?._tag === "BypassCsp" && override.enabled ? true : null,
        ...where
      }))
    case "Touch":
      return state.send(Emulation.setTouchOverride({
        maxTouchPoints: override?._tag === "Touch" && override.enabled ? override.maxTouchPoints : null,
        ...where
      }))
    case "CacheDisabled":
      return state.send(Network.setCacheBehavior({
        cacheBehavior: override?._tag === "CacheDisabled" && override.disabled ? "bypass" : "default",
        ...(where.contexts === undefined ? {} : { contexts: where.contexts })
      }))
    case "FocusEmulation":
      return override === undefined
        ? Effect.void
        : Effect.fail(new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: "FocusEmulation" }) }))
    case "NetworkConditions":
    case "CpuThrottling":
      // Refused when declared
      return Effect.void
  }
}

const addIntercept = Effect.fnUntraced(function*(
  state: State,
  registration: Adapter.RegistrationId,
  scope: Adapter.DeclarationScope,
  declaration: Extract<Adapter.Declaration, { _tag: "Intercept" }>
) {
  const patterns = declaration.patterns.map(coveringPattern)
  const covering = patterns.length > 0 && patterns.every((pattern) => pattern !== undefined) ? patterns : undefined
  const { intercept } = yield* state.send(Network.addIntercept({
    phases: declaration.phases.map((phase) =>
      phase === "request" ? "beforeRequestSent" : phase === "response" ? "responseStarted" : "authRequired"
    ),
    ...(covering === undefined ? {} : { urlPatterns: covering }),
    ...(scope._tag === "Page" ? { contexts: scopeParams(state, scope).contexts } : {})
  }))
  state.intercepts.set(registration, {
    registration,
    bidi: intercept,
    scope,
    globs: declaration.patterns.map(Declarations.glob),
    phases: declaration.phases
  })
})

/** What Firefox can't do, refused before anything is declared. */
const refusal = (declaration: Adapter.Declaration): Adapter.AdapterError | undefined => {
  if (declaration._tag !== "Override") return undefined
  const override = declaration.override
  switch (override._tag) {
    case "Viewport":
      return override.mobile
        ? Kit.unsupported("emulation.viewport.mobile", "WebDriver BiDi has no mobile viewport")
        : undefined
    case "Geolocation":
      return Option.isNone(override.position)
        ? Kit.unsupported("emulation.geolocation.unavailable", "Firefox rejects an unavailable position")
        : undefined
    // Firefox 158 doesn't implement these commands: refused under the capability that says so
    case "Media":
      return Kit.unsupported("emulation.media", "Firefox doesn't implement emulation.setMediaFeaturesOverride")
    case "Touch":
      return Kit.unsupported("emulation.touch", "Firefox doesn't implement emulation.setTouchOverride")
    case "JavaScriptEnabled":
      return override.enabled
        ? undefined
        : Kit.unsupported("emulation.javaScript", "Firefox doesn't implement emulation.setScriptingEnabled")
    case "FocusEmulation":
      return Kit.unsupported("emulation.focus", "WebDriver BiDi has no focus emulation")
    case "NetworkConditions":
      return Kit.unsupported("emulation.network.throttling", "WebDriver BiDi can only take a page offline")
    case "CpuThrottling":
      return Kit.unsupported("emulation.cpuSlowdown", "WebDriver BiDi has no CPU throttling")
    default:
      return undefined
  }
}

/** Where a scope's downloads go: a user context's, or the browser's, which is the default context's. */
export const applyDownloads = (state: State, scope: Adapter.DeclarationScope) => {
  const context = scope._tag === "UserContext" ? scope.context : state.defaultContext
  const behavior = state.registry.downloads(context)
  return state.send(BrowserBidi.setDownloadBehavior({
    downloadBehavior: Option.isNone(behavior)
      ? null
      : behavior.value._tag === "Allow"
      ? { type: "allowed", destinationFolder: behavior.value.directory }
      : { type: "denied" },
    ...(scope._tag === "UserContext" ? scopeParams(state, scope) : {})
  }))
}

/** Removes what a declaration added, once its scope closes. */
const releaseDeclaration = (
  state: State,
  id: Adapter.RegistrationId,
  scope: Adapter.DeclarationScope,
  declaration: Adapter.Declaration
): Effect.Effect<void> =>
  Effect.suspend(() => {
    switch (declaration._tag) {
      case "InitScript":
        return applyScripts(state).pipe(Effect.ignore)
      case "Override":
        return declaration.override._tag === "Viewport"
          ? applyViewport(state, scope, (command, target) =>
            Cleanup.report(
              Cleanup.bounded(command),
              `BiDi viewport release could not restore ${JSON.stringify(target)}`
            ))
          : applyKind(state, declaration.override._tag, scope).pipe(Effect.ignore)
      case "Intercept":
      case "Challenges": {
        const intercept = state.intercepts.get(id)
        state.intercepts.delete(id)
        const collector = state.requestCollectors.get(id)
        state.requestCollectors.delete(id)
        return Effect.all([
          intercept === undefined
            ? Effect.void
            : state.send(Network.removeIntercept({ intercept: intercept.bidi })).pipe(Effect.ignore),
          collector === undefined
            ? Effect.void
            : state.send(Network.removeDataCollector({ collector })).pipe(Effect.ignore)
        ], { discard: true })
      }
      case "BodyCollection": {
        const collector = state.collectors.get(id)
        state.collectors.delete(id)
        return collector === undefined
          ? Effect.void
          : state.send(Network.removeDataCollector({ collector })).pipe(Effect.ignore)
      }
      case "Downloads":
        return applyDownloads(state, scope).pipe(Effect.ignore)
      case "FileChooser":
        return Effect.void
    }
  })

export const declare = Effect.fnUntraced(
  function*(state: State, scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
    const refused = refusal(declaration)
    if (refused !== undefined) return yield* Effect.fail(refused)
    const id = state.ids.registration()
    state.registry.add(scope, declaration, id)
    const registrationContext = yield* Effect.context<never>()
    yield* Scope.addFinalizer(
      yield* Effect.scope,
      Effect.gen(function*() {
        // Recompute from the registry immediately, even if the caller cannot wait for native cleanup.
        state.registry.remove(id)
        const release = releaseDeclaration(state, id, scope, declaration)
        if (declaration._tag !== "Override" || declaration.override._tag !== "Viewport") {
          return yield* release.pipe(Effect.provideContext(registrationContext))
        }
        const unconfirmed = yield* DeclarationCleanup.Unconfirmed
        const work = release.pipe(
          Operation.detached,
          Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
          Effect.provideContext(registrationContext),
          Effect.provideService(DeclarationCleanup.Unconfirmed, unconfirmed),
          Effect.interruptible
        )
        yield* Cleanup.owned(work, state.cleanupScope)
      })
    )
    switch (declaration._tag) {
      case "InitScript":
        yield* Kit.protocol(applyScripts(state))
        break
      case "Override":
        yield* Kit.protocol(applyKind(state, declaration.override._tag, scope))
        break
      case "Intercept":
        if (declaration.phases.includes("request")) {
          const { collector } = yield* Kit.protocol(state.send(Network.addDataCollector({
            dataTypes: ["request"],
            maxEncodedDataSize: 10 * 1024 * 1024,
            ...scopeParams(state, scope)
          })))
          state.requestCollectors.set(id, collector)
        }
        yield* Kit.protocol(addIntercept(state, id, scope, declaration))
        break
      case "Challenges":
        // An intercept at the challenge alone, for every URL, which pauses nothing else. WebDriver BiDi can't
        // scope one to a user context, so a context's is the session's, and a challenge in another context
        // goes on as the browser answers it
        yield* Kit.protocol(addIntercept(state, id, scope, { _tag: "Intercept", patterns: [], phases: ["auth"] }))
        break
      case "BodyCollection": {
        const { collector } = yield* Kit.protocol(state.send(Network.addDataCollector({
          dataTypes: [...declaration.bodies],
          // Request binary data can be counted as base64 by Firefox; L1 enforces the decoded byte limit.
          maxEncodedDataSize: declaration.decodedRequestBytes === true
            ? Math.ceil(declaration.maxBytes / 3) * 4
            : declaration.maxBytes,
          ...scopeParams(state, scope)
        })))
        state.collectors.set(id, collector)
        break
      }
      case "Downloads":
        yield* Kit.protocol(applyDownloads(state, scope))
        break
      case "FileChooser":
        // File dialogs are always reported, and dismissed so none stays open (unhandledPromptBehavior.file is
        // "dismiss"): the page sees `cancel` before the decision, and files set after it still arrive
        break
    }
    return id
  }
)
