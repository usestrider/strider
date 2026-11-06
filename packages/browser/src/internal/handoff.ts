/** Internal scope handoff. Other finalizers still run: only owned target destruction is suppressed. */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Browser from "../experimental/Browser.ts"
import * as Reason from "../Reason.ts"
import type * as BoundedAdapter from "./boundedAdapter.ts"
import type * as Reports from "./claimReports.ts"
import * as Cleanup from "./declarationCleanup.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

const outcomes = new WeakMap<Model.PageEntry, typeof Reports.Handoff.Type>()
export const outcome = (page: Model.PageEntry) => outcomes.get(page)

const contextOwners = new WeakMap<Model.ContextEntry, Scope.Scope>()
export const contextOwner = (entry: Model.ContextEntry) => contextOwners.get(entry)
export const ownContext = (entry: Model.ContextEntry, scope: Scope.Scope) => {
  contextOwners.set(entry, scope)
}
const registrations = new Map<string, () => void>()
const eligible = new WeakSet<Scope.Scope>()
const observers = new WeakMap<Scope.Scope, Map<string, () => Browser.LastKnown>>()
export const observe = (scope: Scope.Scope, claim: string, read: () => Browser.LastKnown) => {
  registrations.get(claim)?.()
  const sets: Array<Map<string, () => Browser.LastKnown>> = []
  for (let current: Scope.Scope | undefined = scope; current !== undefined; current = current.parent) {
    let set = observers.get(current)
    if (set === undefined) observers.set(current, set = new Map())
    set.set(claim, read)
    sets.push(set)
  }
  const remove = () => {
    for (const set of sets) if (set.get(claim) === read) set.delete(claim)
    if (registrations.get(claim) === remove) registrations.delete(claim)
  }
  registrations.set(claim, remove)
  return Scope.addFinalizer(scope, Effect.sync(remove))
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
    const readers = Array.from(observers.get(scope)?.values() ?? [])
    const snapshots = readers.map((read) => read())
    retained.add(scope)
    let unconfirmed = false
    return Effect.map(
      Scope.close(scope, Exit.void).pipe(
        Effect.provideService(Cleanup.Handoff, true),
        Effect.provideService(Cleanup.Unconfirmed, () => {
          unconfirmed = true
        })
      ),
      () =>
        snapshots.map((snapshot, i) => ({
          ...snapshot,
          handoff: unconfirmed
            ? { _tag: "Unknown" as const, events: readers[i]!().handoff?.events ?? [] }
            : readers[i]!().handoff ?? { _tag: "Unknown" as const, events: [] }
        }))
    )
  }).pipe(Effect.uninterruptible)

/** Original-session dialog dismissal during planned handoff only. @default 1000 milliseconds */
export const dismiss = Effect.fnUntraced(function*(
  page: Model.PageEntry,
  claims: NonNullable<BoundedAdapter.Bounded["claims"]>
) {
  const events: Array<
    { readonly _tag: "DialogDismissed"; readonly kind: Model.PromptEvent["kind"]; readonly message: string }
  > = []
  const exit = yield* Effect.gen(function*() {
    const record = yield* Operation.record
    return yield* record.bound(
      Effect.gen(function*() {
        while (true) {
          const state = yield* page.state.get
          if (state.status._tag === "Closed" || Option.isNone(state.dialog)) return
          // Handler resolution (or its shutdown fallback) precedes finalizer intervention.
          if (state.status._tag !== "Open" || Option.isNone(state.status.undecided)) {
            yield* page.state.changes.pipe(
              Stream.filter((next) =>
                next.status._tag === "Closed" || Option.isNone(next.dialog) ||
                (next.status._tag === "Open" && Option.isSome(next.status.undecided))
              ),
              Stream.runHead
            )
            continue
          }
          const prompt = state.dialog.value
          const confirmed = yield* claims.dismiss(page.id, prompt.prompt)
          yield* page.state.changes.pipe(
            Stream.filter((next) => Option.isNone(next.dialog) || next.dialog.value.prompt !== prompt.prompt),
            Stream.runHead
          )
          if (confirmed) events.push({ _tag: "DialogDismissed", kind: prompt.kind, message: prompt.message })
        }
      }).pipe(Effect.interruptible)
    )
  }).pipe(Operation.apart("Browser.handoff.dismiss", Duration.seconds(1)), Effect.exit)
  outcomes.set(page, { _tag: Exit.isSuccess(exit) ? "Complete" : "Unknown", events })
  if (Exit.isFailure(exit)) yield* Effect.logWarning("Handoff could not confirm dialog dismissal", exit.cause)
})
