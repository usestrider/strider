/** Internal scope handoff. Other finalizers still run: only owned target destruction is suppressed. */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type * as Browser from "../experimental/Browser.ts"
import * as Reason from "../Reason.ts"

const eligible = new WeakSet<Scope.Scope>()
const observers = new WeakMap<Scope.Scope, Map<string, () => Browser.LastKnown>>()
export const observe = (scope: Scope.Scope, claim: string, read: () => Browser.LastKnown) => {
  const sets: Array<Map<string, () => Browser.LastKnown>> = []
  for (let current: Scope.Scope | undefined = scope; current !== undefined; current = current.parent) {
    let set = observers.get(current)
    if (set === undefined) observers.set(current, set = new Map())
    set.set(claim, read)
    sets.push(set)
  }
  return Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      for (const set of sets) if (set.get(claim) === read) set.delete(claim)
    })
  )
}
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
    const snapshots = Array.from(observers.get(scope)?.values() ?? [], (read) => read())
    retained.add(scope)
    return Effect.as(Scope.close(scope, Exit.void), snapshots)
  }).pipe(Effect.uninterruptible)
