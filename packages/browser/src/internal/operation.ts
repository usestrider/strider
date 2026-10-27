/**
 * What every L1 operation shares (CONCEPTS.md §9): an operation id, one deadline captured when it starts, the
 * diagnostic envelope its errors carry, and the mapping of an adapter's failures onto the public reasons. An
 * operation run through `named` keeps a record of what it did, from which its `Timeout` is built.
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
import * as BrowserClock from "./browserClock.ts"
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
  const start = (yield* Effect.service(BrowserClock.CurrentClock)).now()
  if (Option.isSome(enclosing)) {
    return { at: enclosing.value, budget: Duration.millis(Math.max(0, (enclosing.value - start) / 1e6)) }
  }
  const budget = yield* Effect.service(Deadline.DefaultBudget)
  return { at: (start + Duration.toMillis(budget) * 1e6) as MonotonicInstant.MonotonicInstant, budget }
})

/** Runs `self` under an operation's deadline, so the operations inside share it. */
export const under = <A, E, R>(self: Effect.Effect<A, E, R>, at: MonotonicInstant.MonotonicInstant) =>
  Effect.provideService(self, Deadline.CurrentDeadline, Option.some(at))

/** An observed value, now. */
export const observed = (value: unknown): Diagnostics.ObservedValue => ({ at: now(), value })

/**
 * The diagnostic envelope of an operation's error. While the operation runs through `named`, what the options don't
 * say comes from its record, so an error built by id carries what the operation did.
 */
export const diagnostics = (
  id: Diagnostics.OperationId,
  options: {
    readonly dispatch?: Diagnostics.DispatchState | undefined
    readonly progress?: ReadonlyArray<Diagnostics.StepEvidence> | undefined
    readonly last?: Option.Option<Diagnostics.ObservedValue> | undefined
  } = {}
): Diagnostics.Diagnostics => {
  const record = running.get(id)
  return new Diagnostics.Diagnostics({
    operationId: id,
    dispatch: options.dispatch ?? record?.dispatch ?? { _tag: "NotSent" },
    progress: options.progress ?? record?.progress ?? [],
    lastObserved: options.last ?? Option.fromNullishOr(record?.history.at(-1)),
    cleanup: { _tag: "NotNeeded" }
  })
}

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

/** De-duplicated observations: a value equal to the one before it is dropped. */
export const appendObservation = (
  history: Array<Diagnostics.ObservedValue>,
  value: unknown
): void => {
  const previous = history.at(-1)
  if (previous !== undefined && JSON.stringify(previous.value) === JSON.stringify(value)) return
  history.push(observed(value))
}

// ── Records ──

/** Where an operation stopped. */
export type Phase = Deadline.Timeout["phase"]

/** The records of the operations running, by id, so an error built by id finds its operation's. */
const running = new Map<Diagnostics.OperationId, Record>()

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
  readonly clock: BrowserClock.BrowserClock
  constructor(name: string, id: Diagnostics.OperationId, budget: Budget, clock: BrowserClock.BrowserClock) {
    this.name = name
    this.id = id
    this.budget = budget
    this.clock = clock
  }

  /** Milliseconds left before the deadline, at least 0. */
  left(): number {
    return BrowserClock.millisLeft(this.clock, this.budget.at)
  }

  /** Adds an observation to the history, unless it repeats the one before it. */
  observe(value: unknown): void {
    appendObservation(this.history, value)
  }

  /** From here, input or a call may have reached the browser. */
  markSent(): void {
    if (this.dispatch._tag === "NotSent") this.dispatch = { _tag: "MayHaveBeenSent" }
  }

  /** What was sent never reached the page: a gesture the guard stopped. */
  markNotSent(): void {
    this.dispatch = { _tag: "NotSent" }
  }

  /** The browser confirmed what was sent; what the operation waits for now is its outcome. */
  markConfirmed(): void {
    this.dispatch = { _tag: "Acknowledged", result: "ok" }
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

  /**
   * The operation's `Timeout`, in the phase its record shows, or in `phase` where what it waits for isn't its own
   * doing: an event wait's `waitingForEvent`.
   */
  timeout(hint: Option.Option<string>, phase?: Phase): Deadline.Timeout {
    const last = Option.fromNullishOr(this.history.at(-1))
    return new Deadline.Timeout({
      operation: this.name,
      phase: phase ?? this.phase(),
      budget: this.budget.budget,
      last,
      history: [...this.history],
      hint,
      diagnostics: this.diagnostics()
    })
  }

  /**
   * Waits for `self` no longer than the deadline, on the browser's clock, and fails with the operation's `Timeout`,
   * its hint taken when it fires.
   */
  bound<A, E, R>(
    self: Effect.Effect<A, E, R>,
    hint: () => Option.Option<string> = Option.none,
    phase?: Phase
  ): Effect.Effect<A, E | Deadline.Timeout, R> {
    return Effect.suspend(() =>
      Effect.raceFirst(
        self,
        Effect.andThen(this.clock.sleep(this.left()), Effect.suspend(() => Effect.fail(this.timeout(hint(), phase))))
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

/** A record for an operation starting now: its id, and the deadline in force, on the browser's clock. */
export const start = (name: string): Effect.Effect<Record> =>
  Effect.gen(function*() {
    const clock = yield* Effect.service(BrowserClock.CurrentClock)
    return new Record(name, operationId(), yield* budget, clock)
  })

/**
 * Runs `self` as an operation: mints its id, reads its deadline once, gives everything
 * inside that deadline and a record, and opens its span.
 */
export const named = (name: string, options: Spans.Options = {}) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const record = yield* start(name)
    running.set(record.id, record)
    return yield* under(Effect.provideService(self, Current, Option.some(record)), record.budget.at).pipe(
      Effect.ensuring(Effect.sync(() => running.delete(record.id)))
    )
  }).pipe(Spans.operation(name, options))

/**
 * Runs `self` as a handler's decision: apart from the operation that registered it, under a deadline of its own,
 * `budget` from when it starts (`Deadline.DefaultBudget` as read at registration), on the browser's clock.
 */
export const deciding = (budget: Duration.Duration) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.flatMap(BrowserClock.after(Duration.toMillis(budget)), (at) =>
    self.pipe(
      Effect.provideService(Current, Option.none()),
      Effect.provideService(Deadline.CurrentDeadline, Option.some(at))
    ))

/**
 * Runs `self` apart from the operation that starts it: work that outlives the operation, such as a handler's fiber
 * or a recording's, reads the deadline in force when it runs, not the operation's, which will have passed.
 */
export const detached = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  self.pipe(
    Effect.provideService(Current, Option.none()),
    Effect.provideService(Deadline.CurrentDeadline, Option.none())
  )

/** `Effect.fn` as an operation: each call runs its body through `named`, with the operation's span and record. */
export const fn =
  (name: string, options: Spans.Options = {}) =>
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>>(
    body: (...args: Args) => Generator<Eff, AEff, never>
  ): (
    ...args: Args
  ) => Effect.Effect<
    AEff,
    [Eff] extends [never] ? never
      : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>] ? E
      : never,
    [Eff] extends [never] ? never
      : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>] ? R
      : never
  > => {
    const untraced = Effect.fnUntraced(body)
    return (...args) => named(name, options)(untraced(...args))
  }
