import type * as Effect from "effect/Effect"
import type * as Route from "../Route.ts"

// The ordinary overloads preserve generic forwarding and explicit type arguments.
// This fallback explains invalid calls by requiring a handler to also be a string literal.
export type Handler<E, R, P extends Route.Phase, D extends Route.Phase> =
  & ((intercepted: Route.Intercepted<P>) => Effect.Effect<Route.Decision<D>, E, R>)
  & DefaultPhaseDiagnostic<D, P>

type DefaultPhaseDiagnostic<D extends Route.Phase, P extends Route.Phase> = [P] extends [D] ? unknown
  : D extends "response" ? "Response decisions need { phase: 'response' }"
  : D extends "auth" ? "Auth decisions need { phase: 'auth' }"
  : D extends "request" ? `Request decisions cannot run at { phase: '${Exclude<P, "request">}' }`
  : never
