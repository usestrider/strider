/** Internal scope handoff. Other finalizers still run: only owned target destruction is suppressed. */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Reason from "../Reason.ts"

const eligible = new WeakSet<Scope.Scope>()
const retained = new WeakSet<Scope.Scope>()
export const allow = (scope: Scope.Scope): void => {
  for (let current: Scope.Scope | undefined = scope; current !== undefined; current = current.parent) {
    eligible.add(current)
  }
}
export const leavesOpen = (scope: Scope.Scope): boolean => {
  for (let current: Scope.Scope | undefined = scope; current !== undefined; current = current.parent) {
    if (retained.has(current)) return true
  }
  return false
}
export const handoff = (scope: Scope.Closeable) =>
  Effect.suspend(() => {
    if (!eligible.has(scope)) {
      return Effect.fail(
        new Reason.Unsupported({
          capability: "claims.handoff",
          backend: "this connection",
          hint: "Handoff needs a Chromium claim or reclaimable context in this scope"
        })
      )
    }
    retained.add(scope)
    return Scope.close(scope, Exit.void)
  }).pipe(Effect.uninterruptible)
