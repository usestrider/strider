/**
 * Declarations on CDP: what the registry (`declarations.ts`) says each target gets, applied in its gate before
 * its scripts run and again to every target in scope when a registration comes or goes. A context that is about
 * to be removed skips the release of its own file chooser, challenge, credential, download and override
 * declarations; if the removal is refused, `restoreContext` reconciles its targets with the declarations that remain.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
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
import type * as Target from "../../cdp/Target.ts"
import type * as Deadline from "../../Deadline.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Cleanup from "../declarationCleanup.ts"
import * as Declarations from "../declarations.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { contextLock, downloadDirectory, forgetRetiredFrames } from "./state.ts"
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
  // Chromium refuses the device-metrics commands on any target that isn't top-level: an out-of-process iframe takes
  // its size from its frame in the parent page.
  // Measuring needs a running renderer too, and an iframe waiting for the debugger has none until its setup ends.
  if (target.kind !== "page") return Effect.void
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
        // A tab in a context that emulates focus for its life renders only with it
        return Emulation.setFocusEmulationEnabled({ enabled: target.page?.context.focusEmulated === true }).pipe(on)
      case "CacheDisabled":
        return sendCache(target, cacheDisabled(state, target, effective), on)
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
      return Emulation.setFocusEmulationEnabled({
        enabled: override.enabled || target.page?.context.focusEmulated === true
      }).pipe(on)
    case "CacheDisabled":
      return sendCache(target, cacheDisabled(state, target, effective), on)
  }
}

/**
 * Whether a target's HTTP cache is off: where the `CacheDisabled` override says so, or a request- or
 * response-phase intercept is in force for its page. Chromium looks in its HTTP cache after the request-stage
 * pause, so a request an intercept continues would be answered from the cache, never reaching the server.
 */
const cacheDisabled = (
  state: State,
  target: TargetEntry,
  effective: ReadonlyMap<Adapter.Override["_tag"], Adapter.Override>
) => {
  const override = effective.get("CacheDisabled")
  if (override?._tag === "CacheDisabled" && override.disabled) return true
  if (target.page === undefined) return false
  const intercepts = state.registry.intercepts(placement(target.page))
  return intercepts.request.length > 0 || intercepts.response.length > 0
}

const sendCache = (target: TargetEntry, disabled: boolean, on: Send) =>
  Effect.suspend(() => {
    if (target.cacheDisabled !== "unknown" && disabled === (target.cacheDisabled ?? false)) return Effect.void
    target.cacheDisabled = disabled
    return Network.setCacheDisabled({ cacheDisabled: disabled }).pipe(on)
  })

/** Whether a cross-document navigation is under way in a frame the target owns, or about to be. */
const navigationPending = (state: State, target: TargetEntry) =>
  [...state.frames.values()].some((frame) =>
    frame.owner === target &&
    (frame.expected.list.length > 0 || [...frame.navigations.values()].some((navigation) => !navigation.sameDocument))
  )

/**
 * The cache setting a declaration or its release changes, sent to a live target and confirmed, except while a
 * navigation is under way in it. The renderer answers the command, and Chromium holds the reply while a
 * cross-process navigation is under way, until the new document commits: a route declared while the navigation
 * waits on its server, which may wait on the caller, would never return. So the wait for the reply ends once a
 * navigation is pending in the target; the command, written before, reaches the new document at its commit. The
 * reply is awaited apart from the declaration, under the connection's own deadline for a command: one that fails
 * or never comes leaves the setting unknown, so the next change sends it again. A declaration that wants the value
 * a command still unanswered sent waits for that reply, by the same rule, rather than sending it again.
 */
const applyCache = (state: State, target: TargetEntry) => {
  // Until the navigation is pending in the target, or the reply comes
  const until = (confirmed: Fiber.Fiber<void, Protocol.ProtocolError>) =>
    Effect.raceFirst(
      Fiber.join(confirmed),
      state.buffer.waitFor(() => navigationPending(state, target) || undefined)
    )
  return withOverrides(
    target,
    Effect.suspend(() => {
      const wanted = cacheDisabled(state, target, state.registry.overrides(placement(target.page!)))
      // A declaration that wants the value an unconfirmed command sent waits for that command's reply too
      const outstanding = target.cacheConfirmation
      if (outstanding !== undefined && outstanding.disabled === wanted && target.cacheDisabled === wanted) {
        return Effect.succeed(until(outstanding.fiber))
      }
      let confirmation: Effect.Effect<void, Protocol.ProtocolError> = Effect.void
      return sendCache(
        target,
        wanted,
        (command) =>
          Effect.gen(function*() {
            // A connection already tearing down sets nothing more
            if (state.cleanupScope.state._tag === "Closed") return
            const reply = yield* target.session.start(command, state.cleanupScope).pipe(
              Operation.detached,
              Effect.provideService(ProtocolClient.CommandDeadline, Option.none())
            )
            const entry: { readonly disabled: boolean; fiber: Fiber.Fiber<void, Protocol.ProtocolError> } = {
              disabled: wanted,
              fiber: undefined!
            }
            entry.fiber = yield* reply.pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  target.cacheDisabled = "unknown"
                }).pipe(
                  Effect.andThen(
                    error.reason._tag === "SessionEnded"
                      ? Effect.void
                      : Effect.logWarning("Failed to confirm the CDP cache setting", error)
                  )
                )
              ),
              Effect.asVoid,
              Effect.ensuring(Effect.sync(() => {
                if (target.cacheConfirmation === entry) target.cacheConfirmation = undefined
              })),
              Effect.forkIn(state.cleanupScope)
            )
            if (entry.fiber.pollUnsafe() === undefined) target.cacheConfirmation = entry
            confirmation = until(entry.fiber)
          })
      ).pipe(Effect.map(() => confirmation))
    })
  ).pipe(
    Effect.flatten,
    Effect.catchIf(
      (error) => error._tag === "ProtocolError" && error.reason._tag === "SessionEnded",
      () => Effect.void
    )
  )
}

// Two applications that overlap on a target would both remove the same identifier, which Chromium rejects the
// second time, and the identifier one of them added would be overwritten, its script left to run in every later
// document. So the registry is read under the target's permit, held until each identifier is recorded: in a new
// target's gate, until the gate's scope closes, after the replies.
//
// Outside a gate, the write runs to its end in a fiber the connection owns, apart from the operation that asked for
// it: each command waits for its reply under `Protocol.CommandTimeout`, not the operation's deadline, and the caller
// waits for the write only until its own deadline. A removal that gets no reply even then may or may not have taken
// effect, so its identifier is kept as unconfirmed, and each later write removes it again; for that identifier alone,
// Chromium's "Script not found" settles it as removed. An add that gets no reply has no identifier to keep: if its
// reply comes late, the protocol client's late-reply handler removes the script it installed; if none ever comes,
// the script stays until the target ends, as Chromium has no command that lists a target's scripts. In a gate, a
// reply the gate's scope abandons goes to the same late-reply handler.
const scriptLock = (target: TargetEntry) => target.scriptLock ??= Semaphore.makeUnsafe(1)

const applyScripts = Effect.fnUntraced(function*(state: State, target: TargetEntry, page: PageEntry) {
  const write = scriptLock(target).withPermits(1)(writeScripts(state, target, page)).pipe(
    Operation.detached,
    Effect.provideService(ProtocolClient.CommandDeadline, Option.none())
  )
  // A connection already tearing down cannot own a new fiber; its commands end with its transport.
  if (state.cleanupScope.state._tag === "Closed") return yield* write
  return yield* Fiber.join(yield* write.pipe(Effect.forkIn(state.cleanupScope)))
})

/** Whether a removal failed without an answer, so may still have taken effect. */
const unanswered = (cause: Cause.Cause<Protocol.ProtocolError>) =>
  Cause.hasInterrupts(cause) ||
  Option.exists(Cause.findErrorOption(cause), (error) => error.reason._tag === "NoReply")

const scriptNotFound = (error: Protocol.ProtocolError) =>
  error.reason._tag === "Rejected" && error.reason.description === "Script not found"

/**
 * Removes an init script, recorded under `key` or unconfirmed, and updates the record by the answer. A removal waits
 * for its reply, so it is never staged: a new target's gate, a page with WebSocket routes included, starts with nothing
 * recorded or unconfirmed, and sends none.
 */
const removeScript = (target: TargetEntry, identifier: string, key?: string) => {
  const unconfirmed = target.unconfirmedScripts ??= new Set()
  const settled = Effect.sync(() => {
    unconfirmed.delete(identifier)
    if (key !== undefined) target.scripts.delete(key)
  })
  return Page.removeScriptToEvaluateOnNewDocument({ identifier: identifier as Page.ScriptIdentifier }).pipe(
    Protocol.on(target.session),
    Effect.catchIf((error) => unconfirmed.has(identifier) && scriptNotFound(error), () => Effect.void),
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? settled
        : unanswered(exit.cause)
        ? Effect.sync(() => {
          unconfirmed.add(identifier)
          if (key !== undefined) target.scripts.delete(key)
        })
        : Effect.void
    )
  )
}

const writeScripts = Effect.fnUntraced(function*(state: State, target: TargetEntry, page: PageEntry, setup?: Setup) {
  const bundles = state.registry.bundles(placement(page))
  for (const identifier of Array.from(target.unconfirmedScripts ?? [])) yield* removeScript(target, identifier)
  for (const [key, identifier] of Array.from(target.scripts)) {
    if (!bundles.has(key)) yield* removeScript(target, identifier, key)
  }
  for (const [key, bundle] of bundles) {
    if (bundle.webSockets !== undefined) {
      // The bridge's bindings go before its capture script, which calls them; a paused page queues them with the
      // rest of its setup, so they reach the page before it resumes.
      const bindings = yield* WebSocketBridge.prepare(state, target, bundle.webSockets, setup === undefined)
      if (setup !== undefined) { for (const binding of bindings) yield* setup.send(binding) }
    }
    const previous = target.scripts.get(key)
    if (previous !== undefined) yield* removeScript(target, previous, key)
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

/**
 * The kinds a new target is configured with: those declared for its page, focus emulation where its context
 * holds it for its life, even when no declaration of it remains, and the cache setting where an intercept turns
 * the cache off.
 */
const kindsFor = (
  state: State,
  page: PageEntry,
  overrides: ReadonlyMap<Adapter.Override["_tag"], Adapter.Override>
) => {
  const kinds = [...overrides.keys()]
  if (page.context.focusEmulated === true && !overrides.has("FocusEmulation")) kinds.push("FocusEmulation")
  if (!overrides.has("CacheDisabled")) {
    const intercepts = state.registry.intercepts(placement(page))
    if (intercepts.request.length > 0 || intercepts.response.length > 0) kinds.push("CacheDisabled")
  }
  return kinds
}

/** The browser window that holds a page target, read once and kept. */
const windowOf = (state: State, target: TargetEntry) =>
  target.windowId !== undefined
    ? Effect.succeed(target.windowId)
    : BrowserCdp.getWindowForTarget({ targetId: target.targetId as Target.TargetID }).pipe(
      Protocol.on(state.root()),
      Effect.map(({ windowId }) => {
        target.windowId = windowId
        return windowId
      })
    )

type Dimensions = { readonly width: number; readonly height: number }

/**
 * A popup's original dimensions, decided at its gate, or undefined for a page with no opener, which measures its
 * own. Chromium starts a tab's renderer at its opener's layout, which is the override's while the opener emulates a
 * viewport, and lays it out at its window's size only once the override is cleared, so a popup's gate measures a
 * size it may never return to. Only a page of its window says what that size is: a window that `window.open` opens
 * as a popup holds no tabs, so a popup that shares its window with another page of its context is a tab, and tabs
 * in one window have one size. It takes that page's recorded dimensions. A popup alone in its window, beside no page
 * with recorded dimensions, or whose window can't be read has unknown dimensions (null), so its restore clears the
 * override without confirming it.
 */
const popupBaseline = Effect.fnUntraced(function*(
  state: State,
  target: TargetEntry,
  page: PageEntry
): Effect.fn.Return<Dimensions | null | undefined> {
  if (page.openerId === undefined) return undefined
  const own = yield* windowOf(state, target).pipe(Effect.option)
  if (Option.isNone(own)) return null
  const others = [...state.targets.values()].filter((other) =>
    other !== target && other.kind === "page" && !other.ended && other.page !== undefined &&
    other.page.context === page.context && other.viewport !== undefined && other.viewport !== null
  )
  const windows = yield* Effect.forEach(
    others,
    (other) => windowOf(state, other).pipe(Effect.option),
    { concurrency: "unbounded" }
  )
  const mate = others.find((_, index) => {
    const window = windows[index]!
    return Option.isSome(window) && window.value === own.value
  })
  return mate?.viewport ?? null
})

/** What a new page or frame gets before its scripts run: the declarations in force for its page. */
/**
 * The cache setting a dedicated worker starts with, written before it resumes, with the replies of its other
 * domains: by the rule a page's follows.
 */
export const workerCache = (state: State, target: TargetEntry, on: Send) =>
  Effect.suspend(() =>
    target.page === undefined
      ? Effect.void
      : sendCache(target, cacheDisabled(state, target, state.registry.overrides(placement(target.page))), on)
  )

export const configureTarget = Effect.fnUntraced(
  function*(state: State, target: TargetEntry, page: PageEntry, setup?: Setup) {
    if (setup === undefined) {
      yield* Effect.all([
        withOverrides(
          target,
          Effect.suspend(() => {
            const overrides = state.registry.overrides(placement(page))
            return Effect.forEach(
              kindsFor(state, page, overrides),
              (kind) => kind === "Viewport" ? Effect.void : applyOverride(state, target, kind, overrides),
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
            kindsFor(state, page, overrides),
            (kind) => kind === "Viewport" ? Effect.void : applyOverride(state, target, kind, overrides, setup.send),
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
          const baseline = yield* popupBaseline(state, target, page)
          if (baseline !== undefined) {
            target.viewport = baseline
          } else {
            // The initial blank document has no scrollbars. Queue its dimensions before changing them, without
            // creating an isolated world whose identifier would require a renderer reply before resume.
            yield* setup.send(Page.getLayoutMetrics(), ({ cssLayoutViewport }) => {
              target.viewport = { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight }
            })
          }
          yield* setup.send(Emulation.setDeviceMetricsOverride({
            width: override.width,
            height: override.height,
            deviceScaleFactor: override.deviceScaleFactor,
            mobile: override.mobile
          }))
        })
      ], { concurrency: "unbounded", discard: true })
    }
    if (setup === undefined) yield* applyScripts(state, target, page)
    else {
      yield* scriptLock(target).takeScoped(1)
      yield* writeScripts(state, target, page, setup)
    }
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
    target.page !== undefined && !target.ended &&
    (target.kind === "page" || target.kind === "iframe" || target.kind === "worker") &&
    Declarations.covers(scope, placement(target.page))
  )

const applyToTarget = (state: State, declaration: Adapter.Declaration, target: TargetEntry) => {
  const page = target.page!
  // A dedicated worker keeps a cache setting of its own, and takes no other declaration through here
  if (target.kind === "worker") {
    return declaration._tag === "Intercept" ||
        (declaration._tag === "Override" && declaration.override._tag === "CacheDisabled")
      ? applyCache(state, target)
      : Effect.void
  }
  switch (declaration._tag) {
    case "InitScript":
      return applyScripts(state, target, page)
    case "Intercept":
      return applyIntercepts(state, target, page).pipe(Effect.andThen(applyCache(state, target)))
    case "Challenges":
      return applyIntercepts(state, target, page)
    case "Override":
      if (declaration.override._tag === "Viewport") {
        return viewport(state, target, state.registry.overrides(placement(page)))
      }
      if (declaration.override._tag === "CacheDisabled") return applyCache(state, target)
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

// A page in its initial sync discards the events received before the frame tree's reply, so a declaration writes
// to it only once that reply is in: one sent before could pause a request that no one continues, which also keeps
// Chromium from answering the tree. It doesn't wait for the rest of the sync, which can be held up by a dialog or
// the renderer. A release doesn't wait at all, since what it sends causes no events the model needs.
const applyDeclaration = (state: State, declaration: Adapter.Declaration, scope: Adapter.DeclarationScope) =>
  Effect.forEach(targetsInScope(state, scope), (target) => {
    const read = target.page!.treeRead
    return Deferred.isDoneUnsafe(read)
      ? applyToTarget(state, declaration, target)
      : Deferred.await(read).pipe(
        Effect.andThen(Effect.suspend(() => target.ended ? Effect.void : applyToTarget(state, declaration, target)))
      )
  }, {
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

/** Notes an override whose release was skipped because its context was to be removed, for `restoreContext`. */
const retire = (state: State, scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) => {
  if (declaration._tag !== "Override" || scope._tag !== "UserContext") return
  const context = state.contexts.get(scope.context)
  if (context !== undefined) (context.retiredOverrides ??= new Map()).set(declaration.override._tag, declaration)
}

/**
 * What the declarations in force say, sent again to a context's targets, after a removal the browser refused left
 * in place a context whose declarations' releases were skipped because it was to go. Each target's interception,
 * cache setting and file chooser are reset on their own, and each override whose release was skipped is released
 * as it would have been: a reset that fails is logged and the others still run.
 */
export const restoreContext = (state: State, context: ContextEntry) => {
  const scope: Adapter.DeclarationScope = { _tag: "UserContext", context: context.id }
  const overrides = [...(context.retiredOverrides?.values() ?? [])]
  context.retiredOverrides = undefined
  return Effect.all([
    Effect.forEach(
      targetsInScope(state, scope),
      (target) =>
        // Each reset stands alone: one that fails is logged and leaves the others to run
        Effect.all([
          target.kind === "worker" ? Effect.void : applyIntercepts(state, target, target.page!).pipe(releaseErrors),
          applyCache(state, target).pipe(releaseErrors),
          target.kind === "page"
            ? Page.setInterceptFileChooserDialog({
              enabled: state.registry.fileChooser(placement(target.page!))
            }).pipe(Protocol.on(target.session), releaseErrors)
            : Effect.void
        ], { discard: true }),
      { concurrency: "unbounded", discard: true }
    ),
    Effect.forEach(overrides, (declaration) => releaseDeclaration(state, declaration, scope), { discard: true })
  ], { concurrency: "unbounded", discard: true })
}

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
  const downloadsIn = () =>
    scope._tag === "UserContext"
      ? [state.contexts.get(scope.context)].filter((context) => context !== undefined)
      : [...state.contexts.values()]
  if (declaration._tag === "Downloads" && declaration.behavior._tag === "Allow") {
    for (const context of downloadsIn()) {
      if (!context.isDefault) context.keepsEndedFrames = true
    }
  }
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
      const retiring = "retiring" in declaration && declaration.retiring?.() === true
      // A context left open no longer needs its ended frames once no declaration gives its downloads a directory,
      // whatever the browser's reset below comes to; one retiring keeps them until it is removed
      if (declaration._tag === "Downloads" && !retiring) {
        for (const context of downloadsIn()) {
          if (Option.isNone(downloadDirectory(state, context.id))) forgetRetiredFrames(state, context)
        }
      }
      const release = retiring
        // The context is removed right after: undoing the declaration would only add a round trip, or for a
        // viewport a wait on a renderer that may never report its size again
        ? Effect.sync(() => retire(state, scope, declaration))
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
