/**
 * What every L1 operation shares (CONCEPTS.md §9): an operation id, one deadline captured when it starts, the
 * diagnostic envelope its errors carry, and the mapping of an adapter's failures onto the public reasons. Since
 * review 26, an operation run through `named` keeps a record of what it did, from which its `Timeout` is built.
 */
import * as Context from "effect/Context"
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
import * as DeadlineClock from "./deadlineClock.ts"
import * as Spans from "./spans.ts"

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
  const start = (yield* Effect.service(DeadlineClock.CurrentClock)).now()
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

// ── Records (review 26, candidate 1) ──

/** Where an operation stopped. */
export type Phase = Deadline.Timeout["phase"]

/**
 * What an operation has done (CONCEPTS.md §2, `OperationRecord`): what it observed, and whether its input or call
 * may have reached the browser. An operation notes facts as they happen, and its `Timeout` takes its phase from
 * them, by the meanings `Deadline.Timeout` documents, instead of each place it can fail choosing one.
 */
export class Record {
  dispatch: Diagnostics.DispatchState = { _tag: "NotSent" }
  readonly history: Array<Diagnostics.ObservedValue> = []
  readonly progress: Array<Diagnostics.StepEvidence> = []
  readonly name: string
  readonly id: Diagnostics.OperationId
  readonly budget: Budget
  readonly clock: DeadlineClock.DeadlineClock
  constructor(name: string, id: Diagnostics.OperationId, budget: Budget, clock: DeadlineClock.DeadlineClock) {
    this.name = name
    this.id = id
    this.budget = budget
    this.clock = clock
  }

  /** Milliseconds left before the deadline, at least 0. */
  left(): number {
    return DeadlineClock.millisLeft(this.clock, this.budget.at)
  }

  /** Adds an observation to the history, unless it repeats the one before it. */
  observe(value: unknown): void {
    appendObservation(this.history, value)
  }

  /** From here, input or a call may have reached the browser. */
  markSent(): void {
    if (this.dispatch._tag === "NotSent") this.dispatch = { _tag: "MayHaveBeenSent" }
  }

  /** What was sent never reached the page: a gesture the guard stopped (review 16, candidate 5). */
  markNotSent(): void {
    this.dispatch = { _tag: "NotSent" }
  }

  /**
   * Where the operation stopped, from what it recorded: sent and unconfirmed, sent and confirmed with what it waits
   * for afterwards missing, never found (nothing observed, or only `NoMatch`), or found and never ready.
   */
  phase(): Phase {
    switch (this.dispatch._tag) {
      case "MayHaveBeenSent":
        return "dispatchedUnconfirmed"
      case "Acknowledged":
        return "postcondition"
      case "NotSent":
        return this.history.every((each) => isNoMatch(each.value)) ? "resolving" : "waitingForCondition"
    }
  }

  /** The diagnostic envelope of the operation's errors. */
  diagnostics(): Diagnostics.Diagnostics {
    return diagnostics(this.id, {
      dispatch: this.dispatch,
      progress: this.progress,
      last: Option.fromNullishOr(this.history.at(-1))
    })
  }

  /** The operation's `Timeout`, in the phase its record shows. */
  timeout(hint: Option.Option<string>): Deadline.Timeout {
    const last = Option.fromNullishOr(this.history.at(-1))
    return new Deadline.Timeout({
      operation: this.name,
      phase: this.phase(),
      budget: this.budget.budget,
      last,
      history: [...this.history],
      hint,
      diagnostics: this.diagnostics()
    })
  }

  /**
   * Waits for `self` no longer than the deadline, on the deadline's clock, and fails with the operation's `Timeout`,
   * its hint taken when it fires.
   */
  bound<A, E, R>(
    self: Effect.Effect<A, E, R>,
    hint: () => Option.Option<string>
  ): Effect.Effect<A, E | Deadline.Timeout, R> {
    return Effect.suspend(() =>
      Effect.raceFirst(
        self,
        Effect.andThen(this.clock.sleep(this.left()), Effect.suspend(() => Effect.fail(this.timeout(hint()))))
      )
    )
  }
}

const isNoMatch = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "NoMatch"

/** The record of the operation running, if any. */
export const Current: Context.Reference<Option.Option<Record>> = Context.Reference<Option.Option<Record>>(
  "@usestrider/browser/internal/Operation/Current",
  { defaultValue: () => Option.none() }
)

/** The running operation's record. Read outside `named`, it is a bug. */
export const record: Effect.Effect<Record> = Effect.flatMap(
  Effect.service(Current),
  Option.match({
    onNone: () => Effect.die(new Error("An operation's record was read outside the operation")),
    onSome: Effect.succeed
  })
)

/**
 * Runs `self` as an operation (review 26, candidate 1): mints its id, reads its deadline once, gives everything
 * inside that deadline and a record, and opens its span.
 */
export const named = (name: string, options: Spans.Options = {}) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const clock = yield* Effect.service(DeadlineClock.CurrentClock)
    const record = new Record(name, operationId(), yield* budget, clock)
    return yield* under(Effect.provideService(self, Current, Option.some(record)), record.budget.at)
  }).pipe(Spans.operation(name, options))
