/**
 * The span every operation opens (review 20, candidate 1). One helper, so `Browser.SpanNameGenerator` names each
 * span and `Browser.TracerDisabledWhen` can suppress it, attributes are written as OpenTelemetry writes them
 * (`browser.operation`, and `url.full` under the diagnostics preset), and recordings learn of each operation.
 */
import * as Effect from "effect/Effect"
import * as Diagnostics from "../Diagnostics.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Recorders from "./recorders.ts"
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

/**
 * A URL as the preset shows it: whole under `"local"`; under `"strict"`, its origin and path, each query value
 * `REDACTED`, credentials and fragment dropped.
 */
export const redactUrl = (url: string, preset: Diagnostics.Preset): string => {
  if (preset === "local") return url
  try {
    const parsed = new URL(url)
    parsed.username = ""
    parsed.password = ""
    parsed.hash = ""
    for (const key of new Set(parsed.searchParams.keys())) parsed.searchParams.set(key, "REDACTED")
    return parsed.href
  } catch {
    return "REDACTED"
  }
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
      Recorders.observe(name, raw, true, self),
      (yield* Tracing.SpanNameGenerator)(operation),
      { attributes }
    )
  })

/** `Effect.fn` with the operation's span: a function whose effect opens it. */
export const fn =
  (name: string, options: Options = {}) =>
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>>(
    body: (...args: Args) => Generator<Eff, AEff, never>
  ): (
    ...args: Args
  ) => Effect.Effect<
    AEff,
    [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>] ? E : never,
    [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>] ? R : never
  > => {
    const untraced = Effect.fnUntraced(body)
    return (...args) => operation(name, options)(untraced(...args))
  }
