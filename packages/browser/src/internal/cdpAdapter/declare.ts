/**
 * Declarations on CDP: what the registry (`declarations.ts`) says each target gets, applied in its gate before
 * its scripts run and again to every target in scope when a registration comes or goes.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowserCdp from "../../cdp/Browser.ts"
import * as Emulation from "../../cdp/Emulation.ts"
import * as Fetch from "../../cdp/Fetch.ts"
import * as Network from "../../cdp/Network.ts"
import * as Page from "../../cdp/Page.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import { type ContextEntry, type PageEntry, placement, type State, type TargetEntry } from "./state.ts"

/** A URL pattern no request matches: a scheme nothing uses. */
const nothing = "strider-intercepts-nothing:"

// Requests fail offline, and `navigator.onLine` says so. Throttling is the same command, so the two are applied
// together
const network = (
  session: ProtocolClient.Session,
  offline: boolean,
  conditions: Extract<Adapter.Override, { _tag: "NetworkConditions" }> | undefined
) => {
  const state = {
    offline,
    latency: conditions?.latency ?? 0,
    downloadThroughput: conditions?.download ?? -1,
    uploadThroughput: conditions?.upload ?? -1
  }
  return Effect.all([
    Network.emulateNetworkConditionsByRule({ matchedNetworkConditions: [{ urlPattern: "", ...state }] }).pipe(
      Protocol.on(session)
    ),
    Network.overrideNetworkState(state).pipe(Protocol.on(session))
  ], { discard: true })
}

const applyOverride = (
  state: State,
  session: ProtocolClient.Session,
  kind: Adapter.Override["_tag"],
  effective: ReadonlyMap<Adapter.Override["_tag"], Adapter.Override>
): Effect.Effect<void, Protocol.ProtocolError> => {
  const on = Protocol.on(session)
  const override = effective.get(kind)
  if (kind === "Offline" || kind === "NetworkConditions") {
    const offline = effective.get("Offline")
    const conditions = effective.get("NetworkConditions")
    return network(
      session,
      offline?._tag === "Offline" && offline.offline,
      conditions?._tag === "NetworkConditions" ? conditions : undefined
    )
  }
  if (override === undefined) {
    switch (kind) {
      case "Viewport":
        return Emulation.clearDeviceMetricsOverride().pipe(on)
      case "UserAgent":
      case "Locale":
        return Emulation.setUserAgentOverride({ userAgent: state.defaultUserAgent }).pipe(
          on,
          Effect.andThen(kind === "Locale" ? Emulation.setLocaleOverride({}).pipe(on) : Effect.void)
        )
      case "TimeZone":
        return Emulation.setTimezoneOverride({ timezoneId: "" }).pipe(on)
      case "Geolocation":
        return Emulation.clearGeolocationOverride().pipe(on)
      case "Media":
        return Emulation.setEmulatedMedia({ media: "", features: [] }).pipe(on)
      case "CpuThrottling":
        return Emulation.setCPUThrottlingRate({ rate: 1 }).pipe(on)
      case "ExtraHeaders":
        return Network.setExtraHTTPHeaders({ headers: {} }).pipe(on)
      case "JavaScriptEnabled":
        return Emulation.setScriptExecutionDisabled({ value: false }).pipe(on)
      case "BypassCsp":
        return Page.setBypassCSP({ enabled: false }).pipe(on)
      case "Touch":
        return Emulation.setTouchEmulationEnabled({ enabled: false }).pipe(on)
      case "FocusEmulation":
        return Emulation.setFocusEmulationEnabled({ enabled: false }).pipe(on)
      case "CacheDisabled":
        return Network.setCacheDisabled({ cacheDisabled: false }).pipe(on)
    }
  }
  switch (override._tag) {
    case "Viewport":
      return Emulation.setDeviceMetricsOverride({
        width: override.width,
        height: override.height,
        deviceScaleFactor: override.deviceScaleFactor,
        mobile: override.mobile
      }).pipe(on)
    case "UserAgent":
      return Emulation.setUserAgentOverride({
        userAgent: override.userAgent,
        ...(Option.isSome(override.platform) ? { platform: override.platform.value } : {})
      }).pipe(on)
    case "Locale":
      return Emulation.setLocaleOverride({ locale: override.locale }).pipe(
        on,
        Effect.andThen(
          Emulation.setUserAgentOverride({ userAgent: state.defaultUserAgent, acceptLanguage: override.locale }).pipe(
            on
          )
        )
      )
    case "TimeZone":
      return Emulation.setTimezoneOverride({ timezoneId: override.timeZone }).pipe(on)
    case "Geolocation":
      return Option.match(override.position, {
        onNone: () => Emulation.setGeolocationOverride({}).pipe(on),
        onSome: (position) => Emulation.setGeolocationOverride(position).pipe(on)
      })
    case "Media":
      return Emulation.setEmulatedMedia({
        media: Option.getOrElse(override.media, () => ""),
        features: Object.entries(override.features).map(([name, value]) => ({ name, value }))
      }).pipe(on)
    case "Offline":
    case "NetworkConditions":
      // Applied together, above
      return Effect.void
    case "CpuThrottling":
      return Emulation.setCPUThrottlingRate({ rate: override.rate }).pipe(on)
    case "ExtraHeaders":
      return Network.setExtraHTTPHeaders({ headers: override.headers }).pipe(on)
    case "JavaScriptEnabled":
      return Emulation.setScriptExecutionDisabled({ value: !override.enabled }).pipe(on)
    case "BypassCsp":
      return Page.setBypassCSP({ enabled: override.enabled }).pipe(on)
    case "Touch":
      return Emulation.setTouchEmulationEnabled({
        enabled: override.enabled,
        maxTouchPoints: override.maxTouchPoints
      }).pipe(on)
    case "FocusEmulation":
      return Emulation.setFocusEmulationEnabled({ enabled: override.enabled }).pipe(on)
    case "CacheDisabled":
      return Network.setCacheDisabled({ cacheDisabled: override.disabled }).pipe(on)
  }
}

const applyScripts = Effect.fnUntraced(function*(state: State, target: TargetEntry, page: PageEntry) {
  const on = Protocol.on(target.session)
  const bundles = state.registry.bundles(placement(page))
  for (const [key, identifier] of Array.from(target.scripts)) {
    if (!bundles.has(key)) {
      target.scripts.delete(key)
      yield* Page.removeScriptToEvaluateOnNewDocument({ identifier: identifier as Page.ScriptIdentifier }).pipe(on)
    }
  }
  for (const [key, bundle] of bundles) {
    const previous = target.scripts.get(key)
    if (previous !== undefined) {
      yield* Page.removeScriptToEvaluateOnNewDocument({ identifier: previous as Page.ScriptIdentifier }).pipe(on)
    }
    const { identifier } = yield* Page.addScriptToEvaluateOnNewDocument({
      source: bundle.source,
      ...(bundle.world._tag === "Isolated" ? { worldName: bundle.world.name } : {})
    }).pipe(on)
    target.scripts.set(key, identifier)
  }
})

const applyIntercepts = Effect.fnUntraced(function*(state: State, target: TargetEntry, page: PageEntry) {
  const intercepts = state.registry.intercepts(placement(page))
  const challenges = state.registry.challenges(placement(page))
  const key = JSON.stringify({ intercepts, challenges })
  if (key === target.intercepts) return
  const on = Protocol.on(target.session)
  // A challenge is asked about only for a request intercepted as it starts: an auth pattern pauses there too, and
  // the request goes on at once unless a request-phase intercept wants it. Where challenges are paused, every
  // document is, a pause a page's load hardly notices; pausing every request would cost each of them a round trip
  // (QUIRKS.md, Q254)
  const patterns = [
    ...[...new Set([...intercepts.request, ...intercepts.auth])].map((urlPattern) => ({
      urlPattern,
      requestStage: "Request" as const
    })),
    ...(challenges
      ? [{ urlPattern: "*", resourceType: "Document" as const, requestStage: "Request" as const }]
      : []),
    ...intercepts.response.map((urlPattern) => ({ urlPattern, requestStage: "Response" as const }))
  ]
  // Enabled from the target's start and never disabled, with a pattern no request matches while nothing
  // intercepts. Enabled with no patterns, a page's first request after a route's Fetch.enable replied could go
  // past the route, about once in forty under load, apparently while the interceptor was installed again; with
  // the pattern kept, never in 160 (QUIRKS.md, Q46 and Q103). A request paused still has its decision to come.
  const effective = patterns.length > 0 ? patterns : [{ urlPattern: nothing, requestStage: "Request" as const }]
  yield* Fetch.enable({ patterns: effective, handleAuthRequests: intercepts.auth.length > 0 || challenges }).pipe(on)
  target.intercepts = key
})

// Chromium keeps a response's body on its own, until the page moves on: where bodies are collected, it keeps them in
// the browser, past the next navigation (QUIRKS.md, Q160)
const keepBodies = (state: State, target: TargetEntry, page: PageEntry) => {
  const limit = state.registry.bodyLimit(placement(page), "response")
  return limit === undefined
    ? Effect.void
    : Network.configureDurableMessages({ maxTotalBufferSize: 10 * limit, maxResourceBufferSize: limit }).pipe(
      Protocol.on(target.session)
    )
}

/** What a new page or frame gets before its scripts run: the declarations in force for its page. */
export const configureTarget = Effect.fnUntraced(function*(state: State, target: TargetEntry, page: PageEntry) {
  const overrides = state.registry.overrides(placement(page))
  yield* Effect.forEach(overrides, ([kind]) => applyOverride(state, target.session, kind, overrides), {
    concurrency: "unbounded",
    discard: true
  })
  yield* applyScripts(state, target, page)
  yield* applyIntercepts(state, target, page)
  yield* keepBodies(state, target, page)
  if (state.registry.fileChooser(placement(page)) && target.kind === "page") {
    yield* Page.setInterceptFileChooserDialog({ enabled: true }).pipe(Protocol.on(target.session))
  }
})

const targetsInScope = (state: State, scope: Adapter.DeclarationScope) =>
  [...state.targets.values()].filter((target) =>
    target.page !== undefined && !target.ended && (target.kind === "page" || target.kind === "iframe") &&
    Declarations.covers(scope, placement(target.page))
  )

const applyDeclaration = (state: State, declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) =>
  Effect.forEach(targetsInScope(state, scope), (target) => {
    const page = target.page!
    switch (declaration._tag) {
      case "InitScript":
        return applyScripts(state, target, page)
      case "Intercept":
      case "Challenges":
        return applyIntercepts(state, target, page)
      case "Override":
        return applyOverride(
          state,
          target.session,
          declaration.override._tag,
          state.registry.overrides(placement(page))
        )
      case "FileChooser":
        return target.kind === "page"
          ? Page.setInterceptFileChooserDialog({ enabled: state.registry.fileChooser(placement(page)) }).pipe(
            Protocol.on(target.session)
          )
          : Effect.void
      case "BodyCollection":
        return keepBodies(state, target, page)
      case "Downloads":
        return Effect.void
    }
  }, { concurrency: "unbounded", discard: true })

/** A context's download behavior, as the declarations in force say. */
export const applyDownloads = (state: State, context: ContextEntry) => {
  const behavior = state.registry.downloads(context.id)
  return BrowserCdp.setDownloadBehavior({
    behavior: behavior === undefined ? "default" : behavior._tag === "Allow" ? "allowAndName" : "deny",
    ...(behavior?._tag === "Allow" ? { downloadPath: behavior.directory } : {}),
    ...(context.browserContextId === undefined
      ? {}
      : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID }),
    eventsEnabled: true
  }).pipe(Protocol.on(state.root()))
}

export const declare = Effect.fnUntraced(function*(
  state: State,
  scope: Adapter.DeclarationScope,
  declaration: Adapter.Declaration
) {
  const id = state.ids.registration()
  state.registry.add(scope, declaration, id)
  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      state.registry.remove(id)
      return declaration._tag === "Downloads"
        ? Effect.forEach(
          [...state.contexts.values()],
          (context) => applyDownloads(state, context).pipe(Effect.ignore),
          {
            discard: true
          }
        )
        : applyDeclaration(state, declaration, scope).pipe(Effect.ignore)
    })
  )
  if (declaration._tag === "Downloads") {
    const affected = scope._tag === "UserContext"
      ? [state.contexts.get(scope.context)].filter((context) => context !== undefined)
      : [...state.contexts.values()]
    yield* Kit.protocol(Effect.forEach(affected, (context) => applyDownloads(state, context), { discard: true }))
  } else {
    yield* Kit.protocol(applyDeclaration(state, declaration, scope))
  }
  return id
})
