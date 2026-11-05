import type * as Route from "../Route.ts"

// Keep phase selection independent of the handler, then explain incompatible decisions.
// Intersecting the message with the handler rejects the call without an Effect variance diagnostic.
export type DefaultPhaseDiagnostic<D extends Route.Phase, P extends Route.Phase> = [P] extends [D] ? unknown
  : D extends "response" ? "Response decisions need { phase: 'response' }"
  : D extends "auth" ? "Auth decisions need { phase: 'auth' }"
  : never
