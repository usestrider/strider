/**
 * What every event module's filter shares: checking it, which fails `next`,
 * `stream` and `history` alike with `SubscriptionError` before any event, and matching it.
 *
 * - A filter that doesn't compile, such as a URL pattern, is `InvalidInput`.
 * - A filter that asks for events the backend can't report is `Unsupported`, naming the capability.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Reason from "../Reason.ts"
import * as Subscription from "../Subscription.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as UrlPattern from "./urlPattern.ts"

/** A filter that doesn't compile, or asks for something nothing could match. */
export const invalid = (operation: string, input: string, expected: string, hint: string) =>
  new Subscription.SubscriptionError({
    operation,
    reason: new Reason.InvalidInput({ input, expected, hint }),
    diagnostics: Operation.diagnosticsNow()
  })

/** A filter the backend can't serve. */
export const unsupported = (operation: string, capability: string, backend: string, hint: string) =>
  new Subscription.SubscriptionError({
    operation,
    reason: new Reason.Unsupported({ capability, backend, hint }),
    diagnostics: Operation.diagnosticsNow()
  })

/** A URL filter, compiled; `None` for none. */
export const url = (
  operation: string,
  pattern: string | undefined,
  input = "filter.url"
): Effect.Effect<Option.Option<(url: string) => boolean>, Subscription.SubscriptionError> =>
  pattern === undefined ? Effect.succeed(Option.none()) : Effect.try({
    try: () => Option.some(UrlPattern.compile(pattern)),
    catch: (error) => invalid(operation, input, "a URL, a glob or a URLPattern", String(error))
  })

/** Whether a URL matches a compiled filter, or there is none. */
export const urlMatches = (matches: Option.Option<(url: string) => boolean>, url: string): boolean =>
  Option.isNone(matches) || matches.value(url)

/** A text filter: a substring or a regular expression, or anything when there is none. */
export const text = (match: string | RegExp | undefined) => (value: string): boolean =>
  match === undefined ? true : typeof match === "string" ? value.includes(match) : new RegExp(match).test(value)

/** One value or several, or anything when there are none. */
export const among = <A>(wanted: A | ReadonlyArray<A> | undefined): (value: A) => boolean => {
  if (wanted === undefined) return () => true
  const set = new Set<A>(Array.isArray(wanted) ? wanted as ReadonlyArray<A> : [wanted as A])
  return (value: A) => set.has(value)
}

/** Fails when the backend reports a capability as unsupported, with its limitations as the hint. */
/** Whether the backend has a capability: one its table doesn't call unsupported. */
export const supported = (runtime: Runtime.Runtime, capability: string): Effect.Effect<boolean> =>
  Effect.map(SubscriptionRef.get(runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === capability)
    return entry === undefined || entry.status !== "unsupported"
  })

export const requires = (
  runtime: Runtime.Runtime,
  operation: string,
  capability: string
): Effect.Effect<void, Subscription.SubscriptionError> =>
  Effect.flatMap(SubscriptionRef.get(runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === capability)
    return entry === undefined || entry.status !== "unsupported"
      ? Effect.void
      : Effect.fail(
        unsupported(
          operation,
          capability,
          runtime.backend,
          entry.limitations.length > 0 ? entry.limitations.join("; ") : `${runtime.backend} can't report these`
        )
      )
  })
