/**
 * The span every operation opens. One helper, so `Browser.SpanNameGenerator` names each
 * span and `Browser.TracerDisabledWhen` can suppress it, attributes are written as OpenTelemetry writes them
 * (`browser.operation`, `url.full` under the diagnostics preset, and `error.type` when the operation fails), and
 * recordings learn of each operation.
 */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Diagnostics from "../Diagnostics.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Recorders from "./recorders.ts"
import * as Redaction from "./redaction.ts"
import * as Tracing from "./tracing.ts"

/** An operation's span settings, as `Effect.withSpan` takes them. */
export interface Options {
  readonly attributes?: Readonly<Record<string, unknown>> | undefined
}

/** The target an operation's attributes name: its page, its context or its realm, or the browser. */
const targetOf = (attributes: Options["attributes"]): Target.Description => {
  const page = attributes?.["browser.page.id"]
  if (typeof page === "string") return { _tag: "Page", id: page as Target.NavigableId }
  const realm = attributes?.["browser.realm.id"]
  if (typeof realm === "string") return { _tag: "Realm", id: realm as Target.RealmId }
  if (attributes?.["browser.context.id"] !== undefined) return { _tag: "UserContext" }
  return { _tag: "Browser" }
}

/** The attribute that names a declaration's scope, from which its span's target is read. */
export const scopeAttributes = (scope: Adapter.DeclarationScope): Readonly<Record<string, string>> =>
  scope._tag === "Page"
    ? { "browser.page.id": scope.page }
    : scope._tag === "UserContext"
    ? { "browser.context.id": scope.context }
    : {}

/** A URL as the preset shows it (`redaction.ts`). */
export const redactUrl = Redaction.url

/**
 * OpenTelemetry's `error.type` for a failure: its tag, then its reason's where it has one, as
 * `LocatorError.StrictViolation`; `_OTHER`, OpenTelemetry's fallback, for a failure without a tag.
 */
export const errorType = (error: unknown): string => {
  const tag = Predicate.hasProperty(error, "_tag") && typeof error._tag === "string" ? error._tag : "_OTHER"
  const reason = Predicate.hasProperty(error, "reason") && Predicate.hasProperty(error.reason, "_tag")
    ? error.reason._tag
    : undefined
  return typeof reason === "string" ? `${tag}.${reason}` : tag
}

/** Wraps an operation in its span. */
export const operation = (name: string, options: Options = {}) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const operation: Tracing.Operation = { name, target: targetOf(options.attributes) }
    const raw = options.attributes ?? {}
    if ((yield* Tracing.TracerDisabledWhen)(operation)) return yield* Recorders.observe(name, raw, false, self)
    const preset = yield* Diagnostics.CurrentPreset
    const attributes: Record<string, unknown> = { "browser.operation": name }
    for (const [key, value] of Object.entries(options.attributes ?? {})) {
      attributes[key] = typeof value === "string" && (key === "url.full" || key === "browser.endpoint")
        ? redactUrl(value, preset)
        : value
    }
    return yield* Effect.withSpan(
      Recorders.observe(name, raw, true, self).pipe(
        Effect.tapError((error) => Effect.annotateCurrentSpan("error.type", errorType(error)))
      ),
      (yield* Tracing.SpanNameGenerator)(operation),
      { attributes }
    )
  })
