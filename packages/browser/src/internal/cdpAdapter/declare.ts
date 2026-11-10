/**
 * Declarations on CDP: what the registry (`declarations.ts`) says each target gets, applied in its gate before
 * its scripts run and again to every target in scope when a registration comes or goes.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as BrowserCdp from "../../cdp/Browser.ts"
import * as Emulation from "../../cdp/Emulation.ts"
import * as Fetch from "../../cdp/Fetch.ts"
import * as Network from "../../cdp/Network.ts"
import * as Page from "../../cdp/Page.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import type * as Deadline from "../../Deadline.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Cleanup from "../declarationCleanup.ts"
import * as Declarations from "../declarations.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { contextLock } from "./state.ts"
import { type ContextEntry, type PageEntry, placement, type State, type TargetEntry } from "./state.ts"
import { installWebSocketGates } from "./targets.ts"
import * as WebSocketBridge from "./webSocketBridge.ts"

/** Initial commands are written before resume; their replies and state updates finish in the gate's scope. */
export interface Setup {
  readonly send: <M extends string, P, A>(
    command: Protocol.Command<M, P, A>,
    receive?: (result: A) => void
  ) => Effect.Effect<void, Protocol.ProtocolError>
}

type Send = <M extends string, P, A>(command: Protocol.Command<M, P, A>) => Effect.Effect<void, Protocol.ProtocolError>

/** A URL pattern no request matches: a scheme nothing uses. */
const nothing = "strider-intercepts-nothing:"

// Requests fail offline, and `navigator.onLine` says so. Throttling is the same command, so the two are applied
// together
const network = (
  session: ProtocolClient.Session,
  offline: boolean,
  conditions: Extract<Adapter.Override, { _tag: "NetworkConditions" }> | undefined,
  on: Send = (command) => command.pipe(Protocol.on(session), Effect.asVoid)
) => {
  const state = {
    offline,
    latency: conditions?.latency ?? 0,
    downloadThroughput: conditions?.download ?? -1,
    uploadThroughput: conditions?.upload ?? -1
  }
  return Effect.all([
    Network.emulateNetworkConditionsByRule({ matchedNetworkConditions: [{ urlPattern: "", ...state }] }).pipe(
      on
    ),
    Network.overrideNetworkState(state).pipe(on)
  ], { discard: true })
}

const dimensions = Effect.fnUntraced(function*(target: TargetEntry) {
  const on = Protocol.on(target.session)
  const { executionContextId } = yield* Page.createIsolatedWorld({
    frameId: (target.frame?.frameId ?? target.targetId) as Page.FrameId,
    worldName: "__strider_viewport"
  }).pipe(on)
  if (!Number.isFinite(executionContextId)) {
    return yield* Effect.fail(
      new Protocol.ProtocolError({
        reason: new Protocol.Decode({
          method: "Page.createIsolatedWorld",
          issue: "Expected a viewport measurement context"
        })
      })
    )
  }
  const { result } = yield* Runtime.evaluate({
    expression: "[innerWidth, innerHeight]",
    contextId: executionContextId,
    returnByValue: true
  }).pipe(on)
  const value = result.value
  if (
    !Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number" ||
    !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || value[0] <= 0 || value[1] <= 0
  ) {
    return yield* Effect.fail(
      new Protocol.ProtocolError({
        reason: new Protocol.Decode({ method: "Runtime.evaluate", issue: "Expected viewport dimensions" })
      })
    )
  }
  return { width: value[0], height: value[1] }
})

const viewport = (
  state: State,
  target: TargetEntry,
  effective: ReadonlyMap<Adapter.Override["_tag"], Adapter.Override>
) => {
  const lock = target.viewportLock ??= Semaphore.makeUnsafe(1)
  return lock.withPermits(1)(Effect.suspend(() => {
    const override = (target.page === undefined ? effective : state.registry.overrides(placement(target.page))).get(
      "Viewport"
    )
    if (override?._tag === "Viewport") {
      return Effect.gen(function*() {
        if (target.viewport === undefined) {
          target.viewport = yield* dimensions(target).pipe(
            Effect.match({ onFailure: () => null, onSuccess: (value) => value })
          )
        }
        yield* Emulation.setDeviceMetricsOverride({
          width: override.width,
          height: override.height,
          deviceScaleFactor: override.deviceScaleFactor,
          mobile: override.mobile
        }).pipe(Protocol.on(target.session))
      })
    }
    return Effect.gen(function*() {
      // Subscribe before clearing: a resize can precede the command's reply.
      const resized = yield* target.session.subscribe(Page.frameResized)
      const operation = yield* Operation.current
      if (Option.isSome(operation)) operation.value.markSent()
      yield* Emulation.clearDeviceMetricsOverride().pipe(Protocol.on(target.session))
      if (Option.isSome(operation)) operation.value.markConfirmed()
      const original = target.viewport
      if (original === undefined || original === null) {
        return yield* Effect.logWarning(
          "CDP viewport restoration could not be verified: original dimensions are unknown"
        ).pipe(
          Effect.annotateLogs("browser.page.id", target.page?.id)
        )
      }
      yield* Stream.concat(Stream.succeed(undefined), resized).pipe(
        Stream.mapEffect(() =>
          dimensions(target).pipe(Effect.tap((value) =>
            Effect.sync(() => {
              if (Option.isSome(operation)) operation.value.observe(value)
            })
          ))
        ),
        Stream.filter((value) => value.width === original.width && value.height === original.height),
        Stream.take(1),
        Stream.runDrain
      )
      target.viewport = undefined
    }).pipe(Effect.scoped)
  }))
}

const applyOverride = (
  state: State,
  target: TargetEntry,
  kind: Adapter.Override["_tag"],
  effective: ReadonlyMap<Adapter.Override["_tag"], Adapter.Override>,
  on: Send = (command) => command.pipe(Protocol.on(target.session), Effect.asVoid)
): Effect.Effect<void, Protocol.ProtocolError> => {
  const session = target.session
  const override = effective.get(kind)
  if (kind === "Offline" || kind === "NetworkConditions") {
    const offline = effective.get("Offline")
    const conditions = effective.get("NetworkConditions")
    return network(
      session,
      offline?._tag === "Offline" && offline.offline,
      conditions?._tag === "NetworkConditions" ? conditions : undefined,
      on
    )
  }
  if (kind === "UserAgent" || kind === "Locale") {
    const userAgent = effective.get("UserAgent")
    const locale = effective.get("Locale")
    const combined = Emulation.setUserAgentOverride({
      userAgent: userAgent?._tag === "UserAgent" ? userAgent.userAgent : state.defaultUserAgent,
      ...(userAgent?._tag === "UserAgent" && Option.isSome(userAgent.platform)
        ? { platform: userAgent.platform.value }
        : {}),
      ...(locale?._tag === "Locale" ? { acceptLanguage: locale.locale } : {})
    }).pipe(on)
    if (kind === "UserAgent") return combined
    const language = Emulation.setLocaleOverride(locale?._tag === "Locale" ? { locale: locale.locale } : {}).pipe(on)
    return locale === undefined
      ? combined.pipe(Effect.andThen(language))
      : language.pipe(Effect.andThen(combined))
  }
  if (override === undefined) {
    switch (kind) {
      case "Viewport":
        return viewport(state, target, effective)
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
      return viewport(state, target, effective)
    case "UserAgent":
    case "Locale":
      // Applied together, above
      return Effect.void
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

const applyScripts = Effect.fnUntraced(function*(state: State, target: TargetEntry, page: PageEntry, setup?: Setup) {
  const on = setup?.send ?? Protocol.on(target.session)
  const bundles = state.registry.bundles(placement(page))
  for (const [key, identifier] of Array.from(target.scripts)) {
    if (!bundles.has(key)) {
      target.scripts.delete(key)
      yield* Page.removeScriptToEvaluateOnNewDocument({ identifier: identifier as Page.ScriptIdentifier }).pipe(on)
    }
  }
  for (const [key, bundle] of bundles) {
    if (bundle.webSockets !== undefined) yield* WebSocketBridge.prepare(state, target, bundle.webSockets)
    const previous = target.scripts.get(key)
    if (previous !== undefined) {
      yield* Page.removeScriptToEvaluateOnNewDocument({ identifier: previous as Page.ScriptIdentifier }).pipe(on)
    }
    const command = Page.addScriptToEvaluateOnNewDocument({
      source: bundle.source,
      ...(bundle.world._tag === "Isolated" ? { worldName: bundle.world.name } : {})
    })
    if (setup === undefined) {
      const { identifier } = yield* command.pipe(Protocol.on(target.session))
      target.scripts.set(key, identifier)
    } else {
      yield* setup.send(command, ({ identifier }) => target.scripts.set(key, identifier))
    }
  }
})

const applyIntercepts = Effect.fnUntraced(function*(
  state: State,
  target: TargetEntry,
  page: PageEntry,
  on: Send = (command) => command.pipe(Protocol.on(target.session), Effect.asVoid)
) {
  const intercepts = state.registry.intercepts(placement(page))
  const proxyAuth = page.context.proxy?.credentials !== undefined
  const challenges = state.registry.challenges(placement(page))
  const key = JSON.stringify({ intercepts, challenges, proxyAuth })
  if (key === target.intercepts) return
  // A challenge is asked about only for a request intercepted as it starts: an auth pattern pauses there too, and
  // the request goes on at once unless a request-phase intercept wants it. Where challenges are paused, every
  // document is, a pause a page's load hardly notices; pausing every request would cost each of them a round trip
  // (QUIRKS.md, Q254)
  const patterns = [
    ...[...new Set([...intercepts.request, ...intercepts.auth])].map((urlPattern) => ({
      urlPattern,
      requestStage: "Request" as const
    })),
    ...(proxyAuth ? [{ urlPattern: "*", requestStage: "Request" as const }] : []),
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
  yield* Fetch.enable({
    patterns: effective,
    handleAuthRequests: intercepts.auth.length > 0 || challenges || proxyAuth
  }).pipe(on)
  target.intercepts = key
})

// Chromium keeps a response's body on its own, until the page moves on: where bodies are collected, it keeps them in
// the browser, past the next navigation (QUIRKS.md, Q160)
const keepBodies = (
  state: State,
  target: TargetEntry,
  page: PageEntry,
  on: Send = (command) => command.pipe(Protocol.on(target.session), Effect.asVoid)
) => {
  const limit = state.registry.bodyLimit(placement(page), "response")
  return Option.isNone(limit)
    ? Effect.void
    : Network.configureDurableMessages({
      maxTotalBufferSize: 10 * limit.value,
      maxResourceBufferSize: limit.value
    }).pipe(on)
}

// Read the registry only after acquiring the target's permit, and retain it across every command.
// Release can then confirm restoration only after earlier configuration has finished writing.
const withOverrides = <A, E, R>(target: TargetEntry, effect: Effect.Effect<A, E, R>) => {
  const lock = target.overrideLock ??= Semaphore.makeUnsafe(1)
  return lock.withPermits(1)(effect)
}

/** What a new page or frame gets before its scripts run: the declarations in force for its page. */
export const configureTarget = Effect.fnUntraced(
  function*(state: State, target: TargetEntry, page: PageEntry, setup?: Setup) {
    if (setup === undefined) {
      yield* Effect.all([
        withOverrides(
          target,
          Effect.suspend(() => {
            const overrides = state.registry.overrides(placement(page))
            return Effect.forEach(
              overrides,
              ([kind]) => kind === "Viewport" ? Effect.void : applyOverride(state, target, kind, overrides),
              {
                discard: true
              }
            )
          })
        ),
        // Viewport has its own permit and fresh registry read. Its renderer wait must not
        // hold up locale or other overrides, including when this target is still configuring.
        Effect.suspend(() => {
          const overrides = state.registry.overrides(placement(page))
          return overrides.has("Viewport") ? viewport(state, target, overrides) : Effect.void
        })
      ], { concurrency: "unbounded", discard: true })
    } else {
      yield* Effect.all([
        Effect.gen(function*() {
          yield* (target.overrideLock ??= Semaphore.makeUnsafe(1)).takeScoped(1)
          const overrides = state.registry.overrides(placement(page))
          yield* Effect.forEach(
            overrides,
            ([kind]) => kind === "Viewport" ? Effect.void : applyOverride(state, target, kind, overrides, setup.send),
            {
              discard: true
            }
          )
        }),
        Effect.gen(function*() {
          yield* (target.viewportLock ??= Semaphore.makeUnsafe(1)).takeScoped(1)
          const override = state.registry.overrides(placement(page)).get("Viewport")
          if (override?._tag !== "Viewport") {
            return
          }
          // The initial blank document has no scrollbars. Queue its dimensions before changing them, without
          // creating an isolated world whose identifier would require a renderer reply before resume.
          yield* setup.send(Page.getLayoutMetrics(), ({ cssLayoutViewport }) => {
            target.viewport = { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight }
          })
          yield* setup.send(Emulation.setDeviceMetricsOverride({
            width: override.width,
            height: override.height,
            deviceScaleFactor: override.deviceScaleFactor,
            mobile: override.mobile
          }))
        })
      ], { concurrency: "unbounded", discard: true })
    }
    yield* applyScripts(state, target, page, setup)
    yield* applyIntercepts(state, target, page, setup?.send)
    yield* keepBodies(state, target, page, setup?.send)
    if (state.registry.fileChooser(placement(page)) && target.kind === "page") {
      const command = Page.setInterceptFileChooserDialog({ enabled: true })
      yield* setup === undefined ? command.pipe(Protocol.on(target.session)) : setup.send(command)
    }
  }
)

const targetsInScope = (state: State, scope: Adapter.DeclarationScope) =>
  [...state.targets.values()].filter((target) =>
    target.page !== undefined && !target.ended && (target.kind === "page" || target.kind === "iframe") &&
    Declarations.covers(scope, placement(target.page))
  )

const applyToTarget = (state: State, declaration: Adapter.Declaration, target: TargetEntry) => {
  const page = target.page!
  switch (declaration._tag) {
    case "InitScript":
      return applyScripts(state, target, page)
    case "Intercept":
    case "Challenges":
      return applyIntercepts(state, target, page)
    case "Override":
      if (declaration.override._tag === "Viewport") {
        return viewport(state, target, state.registry.overrides(placement(page)))
      }
      return withOverrides(
        target,
        Effect.suspend(() =>
          applyOverride(state, target, declaration.override._tag, state.registry.overrides(placement(page)))
        )
      )
    case "FileChooser":
      return target.kind === "page"
        ? Page.setInterceptFileChooserDialog({ enabled: state.registry.fileChooser(placement(page)) }).pipe(
          Protocol.on(target.session)
        ) :
        Effect.void
    case "BodyCollection":
      return keepBodies(state, target, page)
    case "Downloads":
      return Effect.void
  }
}

const applyDeclaration = (state: State, declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) =>
  Effect.forEach(targetsInScope(state, scope), (target) => applyToTarget(state, declaration, target), {
    concurrency: "unbounded",
    discard: true
  })

const releaseDeclaration = (state: State, declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) =>
  Effect.forEach(targetsInScope(state, scope), (target) => {
    const applied = applyToTarget(state, declaration, target)
    return (declaration._tag === "Override" && declaration.override._tag === "Viewport"
      ? Effect.gen(function*() {
        const record = yield* Operation.record
        return yield* record.bound(
          applied.pipe(Effect.interruptible),
          () => Option.some("The renderer did not restore the viewport dimensions")
        )
      }).pipe(
        Operation.named("Adapter.restoreViewport", { attributes: { "browser.page.id": target.page!.id } }),
        Operation.detached
      )
      : applied).pipe(releaseErrors)
  }, { concurrency: "unbounded", discard: true })

/** A context's download behavior, as the declarations in force say. */
export const applyDownloads = (state: State, context: ContextEntry) =>
  contextLock(context).withPermits(1)(Effect.suspend(() => {
    if (context.disposed) return Effect.void
    const behavior = state.registry.downloads(context.id)
    return BrowserCdp.setDownloadBehavior({
      behavior: Option.isNone(behavior) ? "default" : behavior.value._tag === "Allow" ? "allowAndName" : "deny",
      ...(Option.isSome(behavior) && behavior.value._tag === "Allow" ? { downloadPath: behavior.value.directory } : {}),
      ...(context.browserContextId === undefined
        ? {}
        : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID }),
      eventsEnabled: true
    }).pipe(Protocol.on(state.root()))
  }))

const releaseErrors = <A>(effect: Effect.Effect<A, Protocol.ProtocolError | Deadline.Timeout>) =>
  effect.pipe(
    Effect.catchIf(
      (error) => error._tag === "ProtocolError" && error.reason._tag === "SessionEnded",
      () => Effect.void
    ),
    Effect.catch((error) =>
      Effect.gen(function*() {
        ;(yield* Cleanup.Unconfirmed)()
        yield* Effect.logWarning("Failed to release CDP declaration", error)
      })
    )
  )

export const declare = Effect.fnUntraced(function*(
  state: State,
  scope: Adapter.DeclarationScope,
  declaration: Adapter.Declaration
) {
  if (declaration._tag === "InitScript" && declaration.webSocket !== undefined && scope._tag === "UserContext") {
    const context = state.contexts.get(scope.context)
    if (context !== undefined) yield* installWebSocketGates(context, yield* Effect.scope, declaration.workers)
  }
  const id = state.ids.registration()
  state.registry.add(scope, declaration, id)
  const registrationContext = yield* Effect.context<never>()
  yield* Scope.addFinalizer(
    yield* Effect.scope,
    Effect.gen(function*() {
      const caller = yield* Operation.current
      const confirm = yield* Cleanup.Confirm
      const handoff = yield* Cleanup.Handoff
      const unconfirmed = yield* Cleanup.Unconfirmed
      // Registry removal is synchronous, before any caller stops waiting or prior settings are restored.
      state.registry.remove(id)
      const release = declaration._tag === "Downloads" && false && declaration.retiring?.() === true
        // The context is removed right after: restoring its download behavior would only add a round trip
        ? Effect.void
        : declaration._tag === "Downloads"
        ? Effect.forEach(
          scope._tag === "UserContext"
            ? [state.contexts.get(scope.context)].filter((context) => context !== undefined)
            : [...state.contexts.values()],
          (context) => applyDownloads(state, context).pipe(releaseErrors),
          { discard: true }
        )
        : releaseDeclaration(state, declaration, scope)
      const boundedRelease = handoff
        ? Effect.gen(function*() {
          const record = yield* Operation.record
          yield* record.bound(release.pipe(Effect.interruptible))
        }).pipe(
          Operation.apart("Browser.handoff.release", Duration.seconds(1)),
          Effect.catchCause((cause) =>
            Effect.sync(unconfirmed).pipe(
              Effect.andThen(Effect.logWarning("Handoff could not confirm CDP declaration release", cause))
            )
          )
        )
        : release
      const work = boundedRelease.pipe(
        Operation.detached,
        Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
        Effect.provideContext(registrationContext),
        Effect.provideService(Cleanup.Unconfirmed, unconfirmed),
        Effect.interruptible
      )
      // A connection already tearing down cannot own a new fiber; finish before its transport is released.
      if (state.cleanupScope.state._tag === "Closed") return yield* work
      const cleanup = yield* work.pipe(Effect.forkIn(state.cleanupScope))
      const joined = Fiber.await(cleanup).pipe(
        Effect.flatMap((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.sync(unconfirmed).pipe(
              Effect.andThen(Effect.logWarning("CDP declaration cleanup ended without confirmation", exit.cause))
            )
        )
      )
      if (confirm || Option.isNone(caller) || handoff) return yield* joined
      // The browser work survives this wait; expiration does not interrupt its connection-owned lifetime.
      yield* caller.value.bound(joined.pipe(Effect.interruptible)).pipe(
        Effect.catchTag("Timeout", () => Effect.void)
      )
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
