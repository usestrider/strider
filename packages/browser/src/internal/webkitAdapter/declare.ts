/**
 * Declarations on stock WebKit: overrides, init scripts and intercepts, applied to each target as its gate runs and
 * to every target in scope as they change. What stock WebKit can't apply, the capability table says, and it's
 * refused as it's declared, never ignored.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Network from "../../webkit-stock-protocol/Network.ts"
import * as Page from "../../webkit-stock-protocol/Page.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import { pageHandleOf, processOfContext, resizeWindow } from "./automation.ts"
import { overrideCapability } from "./capabilities.ts"
import { type PageEntry, placement, type State, type TargetEntry } from "./state.ts"
import * as Viewport from "./viewport.ts"
import * as WebSocketBridge from "./webSocketBridge.ts"

// ── Mapping ───────────────────────────────────────────────────────────────────────────────────────────────

// Media features WebKit emulates, as user preferences, and the values each takes.
const preferences: Readonly<
  Record<string, { readonly name: Page.UserPreferenceName; readonly values: Readonly<Record<string, string>> }>
> = {
  "prefers-color-scheme": {
    name: "PrefersColorScheme",
    values: { light: "Light", dark: "Dark", "no-preference": "NoPreference" }
  },
  "prefers-reduced-motion": {
    name: "PrefersReducedMotion",
    values: { reduce: "Reduce", "no-preference": "NoPreference" }
  },
  "prefers-contrast": { name: "PrefersContrast", values: { more: "More", "no-preference": "NoPreference" } }
}

// ── Applying ──────────────────────────────────────────────────────────────────────────────────────────────

// Where each kind of override is applied: the page, or its targets. Stock WebKit has no Emulation domain: the
// viewport is the window's size, launched, and JavaScript the page's own setting; any other the table says
// stock WebKit can't apply is refused as it's declared
const pageKinds = new Set<Adapter.Override["_tag"]>(["Viewport", "JavaScriptEnabled"])

const applyPageOverride = (
  state: State,
  page: PageEntry,
  kind: Adapter.Override["_tag"],
  override: Adapter.Override | undefined
): Effect.Effect<void, Protocol.ProtocolError | Adapter.AdapterError> => {
  switch (kind) {
    case "Viewport":
      return Effect.gen(function*() {
        const handle = yield* pageHandleOf(state, page)
        const process = yield* processOfContext(state, page.context)
        yield* resizeWindow(state, page, override)
        if (override?._tag === "Viewport") yield* Viewport.confirm(process, handle, override)
        else {
          // Restoration without an override uses the saved original viewport.
          const natural = state.naturalViewports.get(page)
          if (natural !== undefined) yield* Viewport.confirm(process, handle, natural)
        }
      })
    case "JavaScriptEnabled":
      return page.target === undefined || page.target.ended
        ? Effect.void
        : Page.overrideSetting(
          override?._tag === "JavaScriptEnabled"
            ? { setting: "ScriptEnabled", value: override.enabled }
            : { setting: "ScriptEnabled" }
        ).pipe(Protocol.on(page.target.session))
    default:
      return Effect.void
  }
}

const applyTargetOverride = (
  target: TargetEntry,
  kind: Adapter.Override["_tag"],
  override: Adapter.Override | undefined
): Effect.Effect<void, Protocol.ProtocolError | Adapter.AdapterError> => {
  const on = Protocol.on(target.session)
  switch (kind) {
    case "Media": {
      const media = override?._tag === "Media" ? override : undefined
      return Effect.gen(function*() {
        const unknown = Object.keys(media?.features ?? {}).find((name) => preferences[name] === undefined)
        if (unknown !== undefined) {
          return yield* Effect.fail(Kit.unsupported(`override.Media.${unknown}`, "WebKit doesn't emulate this feature"))
        }
        yield* Page.setEmulatedMedia({ media: media === undefined ? "" : Option.getOrElse(media.media, () => "") })
          .pipe(on)
        for (const [feature, preference] of Object.entries(preferences)) {
          const value = media?.features[feature]
          const mapped = value === undefined ? undefined : preference.values[value]
          if (value !== undefined && mapped === undefined) {
            return yield* Effect.fail(
              Kit.unsupported(`override.Media.${feature}`, `WebKit doesn't emulate ${feature}: ${value}`)
            )
          }
          yield* Page.overrideUserPreference({
            name: preference.name,
            ...(mapped === undefined ? {} : { value: mapped as Page.UserPreferenceValue })
          }).pipe(on)
        }
      })
    }
    case "ExtraHeaders":
      return Network.setExtraHTTPHeaders({
        headers: (override?._tag === "ExtraHeaders" ? override.headers : {}) as Network.Headers
      }).pipe(on)
    case "CacheDisabled":
      return Network.setResourceCachingDisabled({
        disabled: override?._tag === "CacheDisabled" && override.disabled
      }).pipe(on)
    default:
      return Effect.void
  }
}

const applyBootstrap = Effect.fnUntraced(function*(state: State, target: TargetEntry) {
  const bundles = state.registry.bundles(placement(target.page))
  const main = bundles.get(Declarations.worldKey({ _tag: "Main" }))
  if (main?.webSockets !== undefined) {
    yield* WebSocketBridge.prepare(state, target, main.webSockets)
  }
  return yield* Page.setBootstrapScript(main === undefined ? {} : { source: main.source }).pipe(
    Protocol.on(target.session)
  )
})

const applyIntercepts = Effect.fnUntraced(function*(state: State, target: TargetEntry) {
  const intercepts = state.registry.intercepts(placement(target.page))
  const wanted = [
    ...intercepts.request.map((glob) => ({ url: Declarations.globSource(glob), stage: "request" as const })),
    ...intercepts.response.map((glob) => ({ url: Declarations.globSource(glob), stage: "response" as const }))
  ]
  const key = (entry: { readonly url: string; readonly stage: string }) => `${entry.stage} ${entry.url}`
  const current = new Set(target.intercepts.map(key))
  const next = new Set(wanted.map(key))
  if (current.size === next.size && [...next].every((entry) => current.has(entry))) return
  const on = Protocol.on(target.session)
  for (const entry of target.intercepts) {
    if (!next.has(key(entry))) {
      yield* Network.removeInterception({ url: entry.url, stage: entry.stage, isRegex: true }).pipe(on)
    }
  }
  if (wanted.length > 0 && target.intercepts.length === 0) {
    yield* Network.setInterceptionEnabled({ enabled: true }).pipe(on)
  }
  for (const entry of wanted) {
    if (!current.has(key(entry))) {
      yield* Network.addInterception({ url: entry.url, stage: entry.stage, isRegex: true }).pipe(on)
    }
  }
  // Never disabled while a request is paused: its decision would have nowhere to go
  if (wanted.length === 0 && (state.pausedRequests.get(target) ?? 0) === 0) {
    yield* Network.setInterceptionEnabled({ enabled: false }).pipe(on)
  }
  target.intercepts = wanted
})

export const configureTarget = Effect.fnUntraced(function*(state: State, target: TargetEntry) {
  const overrides = state.registry.overrides(placement(target.page))
  yield* Effect.forEach(
    [...overrides].filter(([kind]) => !pageKinds.has(kind)),
    ([kind, override]) => applyTargetOverride(target, kind, override),
    { concurrency: "unbounded", discard: true }
  )
  yield* applyBootstrap(state, target)
  yield* applyIntercepts(state, target)
})

const pagesInScope = (state: State, scope: Adapter.DeclarationScope) =>
  [...state.pages.values()].filter((page) => !page.ended && Declarations.covers(scope, placement(page)))

const targetsOf = (page: PageEntry) =>
  [page.target, page.provisional].filter((target): target is TargetEntry => target !== undefined && !target.ended)

const applyDeclaration = (
  state: State,
  declaration: Adapter.Declaration,
  scope: Adapter.DeclarationScope,
  restoring = false
) => {
  switch (declaration._tag) {
    case "Override": {
      const kind = declaration.override._tag
      return Effect.forEach(pagesInScope(state, scope), (page) => {
        const override = state.registry.overrides(placement(page)).get(kind)
        const applying = pageKinds.has(kind)
          ? applyPageOverride(state, page, kind, override)
          : Effect.forEach(targetsOf(page), (target) => applyTargetOverride(target, kind, override), {
            discard: true
          })
        return restoring ?
          applying.pipe(
            Effect.catch((error) => page.ended || Viewport.isGone(error) ? Effect.void : Effect.fail(error))
          ) :
          applying
      }, { concurrency: "unbounded", discard: true })
    }
    case "InitScript":
      return Effect.forEach(pagesInScope(state, scope).flatMap(targetsOf), (target) => applyBootstrap(state, target), {
        concurrency: "unbounded",
        discard: true
      })
    case "Intercept":
      return Effect.forEach(pagesInScope(state, scope).flatMap(targetsOf), (target) => applyIntercepts(state, target), {
        concurrency: "unbounded",
        discard: true
      })
    // Refused as they're declared: stock WebKit reports no file chooser and no download, and pauses no challenge
    case "FileChooser":
    case "Downloads":
    case "Challenges":
    // WebKit keeps response bodies on its own, so there is nothing to collect
    case "BodyCollection":
      return Effect.void
  }
}

// ── Declaring ─────────────────────────────────────────────────────────────────────────────────────────────

export const declare = Effect.fnUntraced(
  function*(state: State, scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
    if (declaration._tag === "FileChooser") {
      return yield* Effect.fail(Kit.unsupported("fileChooser", "stock WebKit reports no file chooser"))
    }
    if (declaration._tag === "Downloads") {
      return yield* Effect.fail(Kit.unsupported("downloads", "stock WebKit reports no downloads"))
    }
    if (declaration._tag === "Override") {
      // Refused, under its capability, where the table says stock WebKit can't apply it, never ignored
      const override = declaration.override
      if (override._tag === "BypassCsp") {
        return yield* Effect.fail(
          Kit.unsupported(
            "override.BypassCsp",
            "stock WebKit's inspector can't set a page's Content Security Policy aside"
          )
        )
      }
      const capability = overrideCapability(override)
      const entry = capability === undefined
        ? undefined
        : (yield* SubscriptionRef.get(state.capabilities)).entries.find((each) => each.name === capability)
      if (capability !== undefined && entry?.status === "unsupported") {
        return yield* Effect.fail(Kit.unsupported(capability, entry.limitations.join("; ")))
      }
    }
    if (declaration._tag === "InitScript" && declaration.world._tag === "Isolated") {
      return yield* Effect.fail(
        Kit.unsupported("initScript.isolatedWorld", "WebKit runs init scripts in the main world only")
      )
    }
    if (declaration._tag === "Intercept" && declaration.phases.includes("auth")) {
      return yield* Effect.fail(
        Kit.unsupported("interception.auth", "WebKit answers challenges from credentials set in advance")
      )
    }
    if (declaration._tag === "Challenges") {
      return yield* Effect.fail(
        Kit.unsupported(
          "network.challenges",
          "a challenge waits on the MiniBrowser, and neither the inspector nor Automation can answer it"
        )
      )
    }
    // Pair before registering a page override, so afterPairing cannot apply this new setting twice.
    if (declaration._tag === "Override" && declaration.override._tag === "Viewport") {
      yield* Effect.forEach(pagesInScope(state, scope), (page) => pageHandleOf(state, page), { discard: true })
    }
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function*() {
        const id = state.ids.registration()
        state.registry.add(scope, declaration, id)
        const remove = Effect.suspend(() => {
          if (Option.isNone(state.registry.remove(id))) return Effect.void
          return declaration._tag === "BodyCollection"
            ? state.buffer.run(() => {})
            : applyDeclaration(state, declaration, scope, true)
        })
        const viewport = declaration._tag === "Override" && declaration.override._tag === "Viewport"
        yield* Effect.addFinalizer(() =>
          viewport
            ? Viewport.reportCleanup(Viewport.cleanup(remove), "WebKit viewport release could not confirm restoration")
            : remove.pipe(Effect.ignore)
        )
        yield* applyDeclaration(state, declaration, scope).pipe(
          restore,
          Effect.mapError((error) => error._tag === "AdapterError" ? error : Kit.protocolError(error)),
          Effect.onError(() =>
            viewport
              ? Viewport.cleanup(remove).pipe(
                Effect.catch((error) => Effect.die(new Error("WebKit viewport restoration failed", { cause: error })))
              )
              : Effect.void
          )
        )
        return id
      })
    )
  }
)

// The viewport's or the page's size, from the page itself.
