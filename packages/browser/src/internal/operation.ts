/**
 * What every L1 operation shares (CONCEPTS.md §9): an operation id, one deadline captured when it starts, the
 * diagnostic envelope its errors carry, and the mapping of an adapter's failures onto the public reasons.
 */
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Deadline from "../Deadline.ts"
import * as Diagnostics from "../Diagnostics.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import { type AdapterError, now } from "./adapter.ts"

let operations = 0

/** A new operation id, unique within the process. */
export const operationId = (): Diagnostics.OperationId => `OP${++operations}` as Diagnostics.OperationId

/** An operation's deadline: when it ends, and the budget it was given. */
export interface Budget {
  readonly at: MonotonicInstant.MonotonicInstant
  readonly budget: Duration.Duration
}

/** The deadline in force: the enclosing one, or `DefaultBudget` from now. */
export const budget: Effect.Effect<Budget> = Effect.gen(function*() {
  const enclosing = yield* Effect.service(Deadline.CurrentDeadline)
  const start = now()
  if (Option.isSome(enclosing)) {
    return { at: enclosing.value, budget: Duration.millis(Math.max(0, (enclosing.value - start) / 1e6)) }
  }
  const budget = yield* Effect.service(Deadline.DefaultBudget)
  return { at: (start + Duration.toMillis(budget) * 1e6) as MonotonicInstant.MonotonicInstant, budget }
})

/** Milliseconds left before `at`, at least 0. */
export const millisLeft = (at: MonotonicInstant.MonotonicInstant): number => Math.max(0, (at - now()) / 1e6)

/** Runs `self` under an operation's deadline, so the operations inside share it. */
export const under = <A, E, R>(self: Effect.Effect<A, E, R>, at: MonotonicInstant.MonotonicInstant) =>
  Effect.provideService(self, Deadline.CurrentDeadline, Option.some(at))

/** An observed value, now. */
export const observed = (value: unknown): Diagnostics.ObservedValue => ({ at: now(), value })

/** The diagnostic envelope of an operation's error. */
export const diagnostics = (
  id: Diagnostics.OperationId,
  options: {
    readonly dispatch?: Diagnostics.DispatchState | undefined
    readonly progress?: ReadonlyArray<Diagnostics.StepEvidence> | undefined
    readonly last?: Option.Option<Diagnostics.ObservedValue> | undefined
  } = {}
): Diagnostics.Diagnostics =>
  new Diagnostics.Diagnostics({
    operationId: id,
    dispatch: options.dispatch ?? { _tag: "NotSent" },
    progress: options.progress ?? [],
    lastObserved: options.last ?? Option.none(),
    cleanup: { _tag: "NotNeeded" }
  })

/** A failure an operation reports through its module's error: the shared reasons, or its target's end. */
export type Failure =
  | { readonly _tag: "Reason"; readonly reason: Reason.Unsupported | Reason.BackendFailure }
  | { readonly _tag: "Gone"; readonly error: Target.TargetGone }

/** Maps an adapter's failure: an ended target, a capability the browser lacks, or what the browser refused. */
export const fromAdapter = (error: AdapterError, id: Diagnostics.OperationId, backend: string): Failure => {
  const reason = error.reason
  switch (reason._tag) {
    case "Gone":
      return {
        _tag: "Gone",
        error: new Target.TargetGone({ target: reason.target, reason: reason.reason, diagnostics: diagnostics(id) })
      }
    case "Unsupported":
      return {
        _tag: "Reason",
        reason: new Reason.Unsupported({ capability: reason.capability, backend, hint: reason.hint })
      }
    case "Foreign":
      // An id from another connection never reaches the adapter from L1: a bug
      throw new Foreign({ id: reason.id })
    case "Protocol": {
      const cause = reason.error.reason
      return {
        _tag: "Reason",
        reason: new Reason.BackendFailure({
          kind: cause._tag === "Decode" ? "IncompatibleResponse" : "Rejected",
          method: "method" in cause && typeof cause.method === "string" ? cause.method : "unknown",
          metadata: {},
          hint: cause.message,
          cause: reason.error
        })
      }
    }
  }
}

/** An id from another connection reached an adapter: a bug in L1. */
export class Foreign extends Data.TaggedError("Foreign")<{ readonly id: string }> {
  override get message() {
    return `${this.id} was minted by another connection`
  }
}

/** A `Timeout` for an operation that ran out of budget in `phase`. */
export const timeout = (options: {
  readonly operation: string
  readonly id: Diagnostics.OperationId
  readonly phase: Deadline.Timeout["phase"]
  readonly budget: Duration.Duration
  readonly history: ReadonlyArray<Diagnostics.ObservedValue>
  readonly hint: Option.Option<string>
  readonly dispatch?: Diagnostics.DispatchState | undefined
}): Deadline.Timeout => {
  const last = Option.fromNullishOr(options.history.at(-1))
  return new Deadline.Timeout({
    operation: options.operation,
    phase: options.phase,
    budget: options.budget,
    last,
    history: options.history,
    hint: options.hint,
    diagnostics: diagnostics(options.id, { dispatch: options.dispatch, last })
  })
}

/** De-duplicated observations: a value equal to the one before it is dropped. */
export const appendObservation = (
  history: Array<Diagnostics.ObservedValue>,
  value: unknown
): void => {
  const previous = history.at(-1)
  if (previous !== undefined && JSON.stringify(previous.value) === JSON.stringify(value)) return
  history.push(observed(value))
}
