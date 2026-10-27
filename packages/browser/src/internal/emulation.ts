/**
 * Emulation: one registration per call, one override per field, each a capability
 * named for its public field. A field the backend can't apply fails the call before anything is applied.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Declaration from "../Declaration.ts"
import type * as Emulation from "../Emulation.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

/** One field's override, with the capability it needs. */
interface Field {
  readonly capability: string
  readonly override: Adapter.Override
}

const media = (value: string) => value === "noPreference" ? "no-preference" : value

/** The overrides an emulation declares, or why one of its values isn't valid. */
export const fields = (settings: Emulation.Emulation): ReadonlyArray<Field> | Reason.InvalidInput => {
  const list: Array<Field> = []
  const invalid = (input: string, expected: string, hint: string) => new Reason.InvalidInput({ input, expected, hint })
  if (settings.viewport !== undefined) {
    const { height, width } = settings.viewport
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
      return invalid("viewport", "a width and height in whole CSS pixels", `${width}×${height} isn't one`)
    }
    const mobile = settings.viewport.mobile ?? false
    list.push({
      capability: mobile ? "emulation.viewport.mobile" : "emulation.viewport",
      override: { _tag: "Viewport", width, height, deviceScaleFactor: settings.viewport.deviceScaleFactor ?? 1, mobile }
    })
  }
  if (settings.userAgent !== undefined) {
    list.push({
      capability: "emulation.userAgent",
      override: { _tag: "UserAgent", userAgent: settings.userAgent, platform: Option.none() }
    })
  }
  if (settings.locale !== undefined) {
    try {
      new Intl.Locale(settings.locale)
    } catch {
      return invalid("locale", "a BCP 47 language tag, such as de-DE", `${settings.locale} isn't one`)
    }
    list.push({ capability: "emulation.locale", override: { _tag: "Locale", locale: settings.locale } })
  }
  if (settings.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: settings.timezone })
    } catch {
      return invalid("timezone", "an IANA time zone, such as Asia/Tokyo", `${settings.timezone} isn't one`)
    }
    list.push({ capability: "emulation.timezone", override: { _tag: "TimeZone", timeZone: settings.timezone } })
  }
  if (settings.geolocation !== undefined) {
    const geolocation = settings.geolocation
    list.push(
      geolocation === "unavailable"
        ? {
          capability: "emulation.geolocation.unavailable",
          override: { _tag: "Geolocation", position: Option.none() }
        }
        : {
          capability: "emulation.geolocation",
          override: {
            _tag: "Geolocation",
            position: Option.some({
              latitude: geolocation.latitude,
              longitude: geolocation.longitude,
              accuracy: geolocation.accuracy ?? 0
            })
          }
        }
    )
  }
  if (settings.media !== undefined) {
    const features: Record<string, string> = {}
    if (settings.media.colorScheme !== undefined) features["prefers-color-scheme"] = media(settings.media.colorScheme)
    if (settings.media.reducedMotion !== undefined) {
      features["prefers-reduced-motion"] = media(settings.media.reducedMotion)
    }
    if (settings.media.forcedColors !== undefined) features["forced-colors"] = settings.media.forcedColors
    if (settings.media.contrast !== undefined) features["prefers-contrast"] = media(settings.media.contrast)
    list.push({
      capability: "emulation.media",
      override: { _tag: "Media", media: Option.fromUndefinedOr(settings.media.type), features }
    })
  }
  if (settings.network !== undefined) {
    const network = settings.network
    if (network === "offline") {
      list.push({ capability: "emulation.network.offline", override: { _tag: "Offline", offline: true } })
    } else {
      const latency = Duration.fromInput(network.latency)
      if (Option.isNone(latency) || network.download < 0 || network.upload < 0) {
        return invalid("network", "throughput in bytes per second, and a latency", "Throughput can't be negative")
      }
      list.push({
        capability: "emulation.network.throttling",
        override: {
          _tag: "NetworkConditions",
          download: network.download,
          upload: network.upload,
          latency: Duration.toMillis(latency.value)
        }
      })
    }
  }
  if (settings.cpuSlowdown !== undefined) {
    if (!(settings.cpuSlowdown >= 1)) {
      return invalid("cpuSlowdown", "a factor of 1 or more", `${settings.cpuSlowdown} isn't one`)
    }
    list.push({ capability: "emulation.cpuSlowdown", override: { _tag: "CpuThrottling", rate: settings.cpuSlowdown } })
  }
  if (settings.javaScript !== undefined) {
    list.push({
      capability: "emulation.javaScript",
      override: { _tag: "JavaScriptEnabled", enabled: settings.javaScript === "enabled" }
    })
  }
  if (settings.touch !== undefined) {
    list.push({
      capability: "emulation.touch",
      override: { _tag: "Touch", enabled: settings.touch, maxTouchPoints: settings.touch ? 5 : 0 }
    })
  }
  return list
}

export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly scope: Adapter.DeclarationScope
  /** `Page.emulate`, `UserContext.emulate` or `Browser.newContext`. */
  readonly operation: string
}

/** Declares a list of overrides as one registration, for the caller's scope. */
export const declare = (
  owner: Owner,
  overrides: ReadonlyArray<Field>,
  id: ReturnType<typeof Operation.operationId>
): Effect.Effect<Declaration.Registration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope> =>
  Effect.gen(function*() {
    const fail = (reason: Declaration.DeclarationErrorReason) =>
      new Declaration.DeclarationError({ declaration: owner.operation, reason, diagnostics: Operation.diagnostics(id) })
    const adapter = owner.runtime.model.adapter
    // A field the backend can't apply fails the call, before anything is applied
    const capabilities = yield* SubscriptionRef.get(adapter.capabilities)
    for (const field of overrides) {
      const entry = capabilities.entries.find((each) => each.name === field.capability)
      if (entry !== undefined && entry.status === "unsupported") {
        return yield* Effect.fail(fail(
          new Reason.Unsupported({
            capability: field.capability,
            backend: owner.runtime.backend,
            hint: entry.limitations.join("; ") || `${owner.runtime.backend} can't emulate it`
          })
        ))
      }
    }
    const scope = yield* Scope.fork(yield* Effect.scope)
    yield* Effect.forEach(
      overrides,
      (field) => adapter.declare(owner.scope, { _tag: "Override", override: field.override }),
      {
        discard: true
      }
    ).pipe(
      Scope.provide(scope),
      Effect.mapError((error) => {
        const mapped = Operation.fromAdapter(error, id, owner.runtime.backend)
        // A target that went is TargetGone, as for every operation on it (QUIRKS.md, Q143)
        return mapped._tag === "Gone" ? mapped.error : fail(mapped.reason)
      }),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    return { remove: Scope.close(scope, Exit.void) } satisfies Declaration.Registration
  })

/** `emulate`: the settings' fields, as one registration. */
export const emulate = (owner: Owner, settings: Emulation.Emulation) =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const overrides = fields(settings)
    if (!Array.isArray(overrides)) {
      return yield* Effect.fail(
        new Declaration.DeclarationError({
          declaration: owner.operation,
          reason: overrides as Reason.InvalidInput,
          diagnostics: Operation.diagnostics(id)
        })
      )
    }
    return yield* declare(owner, overrides, id)
  }).pipe(Operation.named(owner.operation, {
    attributes: { ...Spans.scopeAttributes(owner.scope), "browser.emulation": Object.keys(settings).join(",") }
  }))
