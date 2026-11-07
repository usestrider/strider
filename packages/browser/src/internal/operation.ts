/**
 * What every L1 operation shares (CONCEPTS.md §9): an operation id, one deadline captured when it starts, the
 * diagnostic envelope its errors carry, and the mapping of an adapter's failures onto the public reasons. An
 * operation run through `named` keeps a record of what it did, from which its `Timeout` is built, and is provided as
 * `Operation.Current`, the public module's service, which the library reads where it is optional: an error built
 * inside an operation takes its diagnostics from the record there, and one built outside any has an id of its own.
 */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as References from "effect/References"
import * as Deadline from "../Deadline.ts"
import * as Diagnostics from "../Diagnostics.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as Operation from "../Operation.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import { AdapterError, now } from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Recorders from "./recorders.ts"
import * as Spans from "./spans.ts"

let operations = 0

/** A new operation id, unique within the process. */
const operationId = (): Diagnostics.OperationId => `OP${++operations}` as Diagnostics.OperationId

/** `Operation.Current`'s key, the public tag's runtime identity, which `Operation.ts` declares its class with. */
export const CurrentKey = "@usestrider/browser/Operation/Current"

/**
 * `Operation.Current`, by its key: the same slot in a context as the public class, which this module can't load,
 * since `Operation.ts` loads this one.
 */
const Current = Context.Service<Operation.Current, Operation.Operation>(CurrentKey)

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
 * The diagnostic envelope of an operation's error. Built inside the operation, what the options don't say comes from
 * its record, read from `Operation.Current` in the running fiber, so an error built by id carries what the operation
 * did.
 */
export const diagnostics = (
  id: Diagnostics.OperationId,
  options: {
    readonly dispatch?: Diagnostics.DispatchState | undefined
    readonly progress?: ReadonlyArray<Diagnostics.StepEvidence> | undefined
    readonly last?: Option.Option<Diagnostics.ObservedValue> | undefined
    readonly cleanup?: Diagnostics.CleanupState | undefined
  } = {}
): Diagnostics.Diagnostics => {
  const current = running()
  const record = current?.id === id ? current : undefined
  return new Diagnostics.Diagnostics({
    operationId: id,
    dispatch: options.dispatch ?? record?.dispatch ?? { _tag: "NotSent" },
    progress: options.progress ?? (record === undefined ? [] : [...record.progress]),
    lastObserved: options.last ?? Option.fromNullishOr(record?.history.at(-1)),
    cleanup: options.cleanup ?? record?.cleanup ?? { _tag: "NotNeeded" }
  })
}

/** A reply confirms only this call; interruption and arbitrary failures leave its delivery uncertain. */
export const answered = <A, E, R>(record: Record, call: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => record.beginDispatch()),
    () => call,
    (finish, exit) =>
      Effect.sync(() => {
        if (Exit.isSuccess(exit)) return finish({ _tag: "Acknowledged", result: "ok" })
        const reason = exit.cause.reasons.length === 1 ? exit.cause.reasons[0] : undefined
        const error = reason !== undefined && Cause.isFailReason(reason) ? reason.error : undefined
        finish(
          error instanceof AdapterError && error.reason._tag === "Protocol" &&
            error.reason.error.reason._tag === "Rejected"
            ? { _tag: "Acknowledged", result: "rejected" }
            : { _tag: "MayHaveBeenSent" }
        )
      })
  )

/** An unanswered member keeps an overlapping group's delivery uncertain; otherwise retain a known rejection. */
const combinedDispatch = (
  left: Diagnostics.DispatchState,
  right: Diagnostics.DispatchState
): Diagnostics.DispatchState => {
  if (left._tag === "MayHaveBeenSent" || right._tag === "MayHaveBeenSent") return { _tag: "MayHaveBeenSent" }
  if (left._tag === "NotSent") return right
  if (right._tag === "NotSent") return left
  return { _tag: "Acknowledged", result: left.result === "rejected" || right.result === "rejected" ? "rejected" : "ok" }
}

/**
 * A failure an operation reports: the shared reasons, through its module's error, or its target's end or its
 * deadline, as they are.
 */
export type Failure =
  | { readonly _tag: "Reason"; readonly reason: Reason.Unsupported | Reason.BackendFailure }
  | { readonly _tag: "Gone"; readonly error: Target.TargetGone }
  | { readonly _tag: "Timeout"; readonly error: Deadline.Timeout }

/**
 * Maps an adapter's failure: an ended target, a capability the browser lacks, or what the browser refused; or the
 * operation's `Timeout`, which a call the browser didn't answer before the deadline fails with
 * (`boundedAdapter.ts`).
 */
export const fromAdapter = (
  error: AdapterError | Deadline.Timeout,
  id: Diagnostics.OperationId,
  backend: string
): Failure => {
  if (Deadline.isTimeout(error)) return { _tag: "Timeout", error }
  const reason = error.reason
  switch (reason._tag) {
    case "BackendFailure":
      return { _tag: "Reason", reason }
    case "CaptureInvalidated":
      throw new Error("CaptureInvalidated must be mapped by the capture operation")
    case "ViewportMismatch":
      return {
        _tag: "Reason",
        reason: new Reason.BackendFailure({ kind: "Rejected", method: "emulation.viewport", hint: error.message })
      }
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
      // An id from another connection never reaches the adapter from L1: a bug. One of this connection's whose
      // target ended is `Gone` (`adapterKit.ts`, Ids), so a race with a target's end never lands here
      throw new Foreign({ id: reason.id })
    case "Protocol": {
      const cause = reason.error.reason
      return {
        _tag: "Reason",
        reason: new Reason.BackendFailure({
          kind: cause._tag === "Decode" ? "IncompatibleResponse" : "Rejected",
          method: "method" in cause && typeof cause.method === "string" ? cause.method : "unknown",
          hint: cause.message,
          cause: reason.error
        })
      }
    }
  }
}

/** Viewport application and page creation retain the structured mismatch measurements. */
export const fromViewportAdapter = (
  error: AdapterError | Deadline.Timeout,
  id: Diagnostics.OperationId,
  backend: string
): Failure | { readonly _tag: "Reason"; readonly reason: Reason.ViewportMismatch } =>
  !Deadline.isTimeout(error) && error.reason._tag === "ViewportMismatch"
    ? { _tag: "Reason", reason: new Reason.ViewportMismatch(error.reason) }
    : fromAdapter(error, id, backend)

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

/**
 * What an operation has done (CONCEPTS.md §2, `OperationRecord`): what it observed, whether its input or call may
 * have reached the browser, and its steps. An operation notes facts as they happen, and its `Timeout` takes its phase
 * from them, by the meanings `Deadline.Timeout` documents, instead of each place it can fail choosing one.
 */
export class Record implements Operation.Operation {
  readonly "~@usestrider/browser/Operation" = "~@usestrider/browser/Operation" as const
  private dispatchEvidence: Diagnostics.DispatchState = { _tag: "NotSent" }
  private readonly dispatches = new Set<object>()
  private readonly parents = new Set<Record>()
  private readonly manual = new Map<Record, Diagnostics.DispatchState>()
  private overlap: Diagnostics.DispatchState = { _tag: "NotSent" }
  private beforeOverlap: Diagnostics.DispatchState = { _tag: "NotSent" }
  private replyUncertain = false

  cleanup: Diagnostics.CleanupState = { _tag: "NotNeeded" }
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

  /** Active writes have no reply yet; merely running steps do not hold an overlap open. */
  get dispatch(): Diagnostics.DispatchState {
    return this.dispatches.size === 0 && this.manual.size === 0 ? this.dispatchEvidence : { _tag: "MayHaveBeenSent" }
  }

  set dispatch(dispatch: Diagnostics.DispatchState) {
    this.mark(dispatch)
  }

  private startDispatch(): void {
    if (this.dispatches.size === 0 && this.manual.size === 0) {
      this.beforeOverlap = this.dispatchEvidence
      this.overlap = { _tag: "NotSent" }
      this.replyUncertain = false
    }
  }

  private finishDispatch(dispatch: Diagnostics.DispatchState): void {
    this.overlap = combinedDispatch(this.overlap, dispatch)
    // An overlap made solely of canceled child sends contributes no new delivery evidence.
    this.dispatchEvidence = this.overlap._tag === "NotSent" ? this.beforeOverlap : this.overlap
    this.replyUncertain = this.dispatchEvidence._tag === "MayHaveBeenSent"
  }

  /** Manual sends have a lifetime too: a guard or answer ends only that source's send. */
  private mark(dispatch: Diagnostics.DispatchState, source: Record = this): void {
    if (dispatch._tag === "MayHaveBeenSent") {
      this.startDispatch()
      this.manual.set(source, dispatch)
    } else {
      if (!this.manual.has(source)) this.startDispatch()
      this.manual.delete(source)
      // A local guard replaces this record's own gesture evidence. In an enclosing record it cancels only
      // this child's send, so earlier writes remain evidence if the whole overlap was guarded.
      if (dispatch._tag === "NotSent" && source === this) this.beforeOverlap = { _tag: "NotSent" }
      this.finishDispatch(dispatch)
    }
    for (const parent of this.parents) parent.mark(dispatch, source)
  }

  /** Only actual writes join an overlap. Their evidence follows the step's enclosing operations. */
  beginDispatch(source: Record = this): (dispatch: Diagnostics.DispatchState) => void {
    this.startDispatch()
    // A tracked call takes over its caller's preparatory manual send annotation.
    this.manual.delete(source)
    const member = {}
    this.dispatches.add(member)
    const enclosing = Array.from(this.parents, (parent) => parent.beginDispatch(source))
    return (dispatch) => {
      this.dispatches.delete(member)
      this.finishDispatch(dispatch)
      for (const finish of enclosing) finish(dispatch)
    }
  }

  /** Ends a failed step's manual send without inferring a reply from its completion. */
  private endManual(source: Record = this): void {
    if (this.manual.delete(source)) this.finishDispatch({ _tag: "MayHaveBeenSent" })
    for (const parent of this.parents) parent.endManual(source)
  }

  /** Attaches evidence propagation while a step runs; read-only steps contribute no dispatch. */
  enclose(parent: Record): () => void {
    this.parents.add(parent)
    return () => {
      this.parents.delete(parent)
    }
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
    this.mark({ _tag: "MayHaveBeenSent" })
  }

  /** What was sent never reached the page: a gesture the guard stopped. */
  markNotSent(): void {
    this.mark({ _tag: "NotSent" })
  }

  /** The browser confirmed what was sent; what the operation waits for now is its outcome. */
  markConfirmed(result: "ok" | "rejected" = "ok"): void {
    this.mark({ _tag: "Acknowledged", result })
  }

  /** Summarizes cleanup owned by this operation; known failure takes precedence over unfinished work. */
  noteCleanup(cleanup: Diagnostics.CleanupState): void {
    const priority = { NotNeeded: 0, Completed: 1, Pending: 2, Failed: 3 }
    if (priority[cleanup._tag] > priority[this.cleanup._tag]) this.cleanup = cleanup
  }

  /**
   * Adds `step`, an operation that ran inside this one and has ended, to its steps, and takes its dispatch when
   * the step sent. A manually marked send can be confirmed by success; a known missing reply cannot. Its state is how far it got:
   * `ok` once it succeeded or the browser confirmed it, otherwise `unsent` or `uncertain` by whether it sent. A step
   * that repeats the one before it, in name and state, is kept once, as the history keeps observations.
   */
  addStep(step: Record, succeeded: boolean): Diagnostics.DispatchState {
    this.noteCleanup(step.cleanup)
    const dispatch: Diagnostics.DispatchState = succeeded && step.dispatch._tag === "MayHaveBeenSent" &&
        !step.replyUncertain && step.dispatches.size === 0
      ? { _tag: "Acknowledged", result: "ok" }
      : step.dispatch
    if (dispatch._tag === "Acknowledged" && step.dispatch._tag === "MayHaveBeenSent") {
      step.markConfirmed(dispatch.result)
    } else step.endManual()
    const state = succeeded
      ? "ok"
      : dispatch._tag === "NotSent"
      ? "unsent"
      : dispatch._tag === "MayHaveBeenSent"
      ? "uncertain"
      : dispatch.result
    const previous = this.progress.at(-1)
    if (previous === undefined || previous.step !== step.name || previous.state !== state) {
      this.progress.push({ step: step.name, state, at: now() })
    }
    return dispatch
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
      progress: [...this.progress],
      cleanup: this.cleanup,
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
   * The operation's `Timeout` for one a step ran out with: named for this operation, with its budget, its latest
   * dispatch and its steps, and the step's phase, history and hint, which say where it stopped.
   */
  adopt<T extends Deadline.Timeout>(step: T): T {
    return new Deadline.Timeout({
      operation: this.name,
      phase: step.phase,
      budget: this.budget.budget,
      last: step.last,
      history: step.history,
      hint: step.hint,
      diagnostics: this.diagnostics()
    }) as T
  }

  /**
   * Waits for `self` no longer than the deadline, on the browser's clock, and fails with the operation's `Timeout`,
   * its hint taken when it fires. The `Timeout` is built once `self` has been interrupted, so a step it was running
   * is among the steps.
   */
  bound<A, E, R>(
    self: Effect.Effect<A, E, R>,
    hint: () => Option.Option<string> = Option.none,
    phase?: Phase
  ): Effect.Effect<A, E | Deadline.Timeout, R> {
    // Not `Effect.timeoutOption`, which sleeps on the fiber's `Clock`: the deadline is on the browser's clock, which
    // `TestClock` doesn't move for a real browser (`browserClock.ts`)
    return Effect.suspend(() =>
      Effect.raceFirst(Effect.asSome(self), Effect.as(this.clock.sleep(this.left()), Option.none<A>()))
    ).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(this.timeout(hint(), phase)),
        onSome: Effect.succeed
      }))
    )
  }
}

const isNoMatch = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "NoMatch"

/** The record of the operation running, if any: `Operation.Current`, which the library reads where it is optional. */
export const current: Effect.Effect<Option.Option<Record>> = Effect.map(
  Effect.serviceOption(Current),
  Option.filter((each): each is Record => each instanceof Record)
)

/** The running operation's record. Read outside `named`, it is a bug. */
export const record: Effect.Effect<Record> = Effect.flatMap(
  current,
  Option.match({
    onNone: () => Effect.die(new Error("An operation's record was read outside the operation")),
    onSome: Effect.succeed
  })
)

/**
 * The diagnostic envelope for an error raised now: the running operation's, from its record, or, outside any
 * operation, one with an id of its own and nothing recorded.
 */
export const currentDiagnostics: Effect.Effect<Diagnostics.Diagnostics> = Effect.map(
  current,
  Option.match({ onNone: () => diagnostics(operationId()), onSome: (record) => record.diagnostics() })
)

/**
 * The same, read where no effect runs, such as as a channel ends: the operation running in the current fiber, if
 * any, else an id of its own.
 */
export const diagnosticsNow = (): Diagnostics.Diagnostics => {
  const record = running()
  return record === undefined ? diagnostics(operationId()) : record.diagnostics()
}

/** The id of the operation running in the current fiber, or, outside any operation, one of its own. */
export const idNow = (): Diagnostics.OperationId => running()?.id ?? operationId()

/** The record `Operation.Current` holds in the current fiber, read where no effect runs. */
const running = (): Record | undefined => {
  const fiber = Fiber.getCurrent()
  const operation = fiber === undefined ? undefined : Context.getOrUndefined(fiber.context, Current)
  return operation instanceof Record ? operation : undefined
}

/** The record `Operation.Current` holds, as the public members read it; one provided by hand is a defect. */
export const recordOf = (operation: Operation.Operation): Effect.Effect<Record> =>
  operation instanceof Record
    ? Effect.succeed(operation)
    : Effect.die(new Error("Operation.Current holds an operation that Operation.fn or Operation.named didn't start"))

/** A record for an operation starting now: its id, and the deadline in force, on the browser's clock. */
export const start = (name: string): Effect.Effect<Record> =>
  Effect.gen(function*() {
    const clock = yield* Effect.service(BrowserClock.CurrentClock)
    return new Record(name, operationId(), yield* budget, clock)
  })

/**
 * Makes `record`'s work, `self`, a step of the operation it runs in, if any: when `self` ends, `record` is added to
 * that operation's steps. An operation through `named` is one; so is an event wait, awaited where it was subscribed
 * or later.
 */
export const asStep = (record: Record) => <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(current, (enclosing) =>
    Option.isNone(enclosing) || enclosing.value === record
      ? self
      : Effect.acquireUseRelease(
        Effect.sync(() => record.enclose(enclosing.value)),
        () => self,
        (detach, exit) =>
          Effect.sync(() => {
            enclosing.value.addStep(record, Exit.isSuccess(exit))
            detach()
          })
      ))

const libraryDirectory = new URL("../", import.meta.url)
// Source maps can name src/ while this module runs from dist/. Keep both directory boundaries, not the package root.
const libraryPaths = /\/(?:src|dist)\/$/.test(libraryDirectory.pathname)
  ? ["../../src/", "../../dist/"].map((directory) => Recorders.filePath(new URL(directory, import.meta.url).href))
  : [Recorders.filePath(libraryDirectory.href)]

/** The first user location in a construction-time stack, formatted only when consumed. */
const namedCaller = (error: Error | undefined): (() => string | undefined) | undefined => {
  if (error === undefined) return undefined
  let call: string | undefined
  return () => {
    if (error === undefined) return call
    const captured = error
    // Release V8's structured call sites after the first read, including when no caller is available.
    error = undefined
    try {
      for (const line of captured.stack?.split("\n").slice(1) ?? []) {
        const location = Recorders.location(line)
        if (location === undefined) continue
        if (libraryPaths.some((directory) => location.file.startsWith(directory))) continue
        // Once execution has entered Effect, the immediate public call has already returned.
        if (/\/effect\/(?:src|dist)\//.test(location.file)) break
        call = line.trim()
        break
      }
    } catch {
      // A custom stack formatter may fail; caller capture remains optional.
    }
    return call
  }
}

/**
 * Runs `self` as an operation: mints its id, reads its deadline once, gives everything inside that deadline and a
 * record, and opens its span. Inside another operation, it is a step of it. A `Timeout` that leaves it is its own: one
 * a step ran out with becomes the operation's, with the step's phase, history and hint.
 */
const namedWith = (name: string, options: Spans.Options, fromFn: boolean) => {
  const limit = Error.stackTraceLimit
  let error: Error | undefined
  if (limit !== 0) {
    try {
      // Six frames: namedWith, named, up to three library wrappers, then the caller.
      // Locator.fill needs all six; TraceSources tests its preconstructed guarded caller.
      // Capture here so the formatting helper does not consume a caller frame.
      Error.stackTraceLimit = 6
      error = new Error()
    } catch {
      // Caller capture is optional when the runtime cannot supply a stack.
    } finally {
      Error.stackTraceLimit = limit
    }
  }
  const call = namedCaller(error)
  return <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Operation.Current>> =>
    Effect.gen(function*() {
      const record = yield* start(name)
      return yield* under(Effect.provideService(self, Current, record), record.budget.at).pipe(
        Effect.mapError((error) =>
          Deadline.isTimeout(error) && error.diagnostics.operationId !== record.id ? record.adopt(error) : error
        ),
        asStep(record)
      )
    }).pipe(
      Spans.operation(name, options),
      Effect.updateService(
        References.CurrentStackFrame,
        (parent) =>
          call === undefined || fromFn && Recorders.isFrame(parent) && parent?.name === name
            ? parent
            : Recorders.frame(name, call, parent)
      )
    )
}

/** Runs an operation constructed by a public wrapper or getter. */
export const named = (name: string, options: Spans.Options = {}) => namedWith(name, options, false)

/**
 * Runs `self` apart from the operation it is in, as an operation of its own named `name`, under a deadline of its
 * own, `budget` from when it starts, on the browser's clock: a handler's decision, whose budget is
 * `Deadline.DefaultBudget` as read at registration, or what an operation gathers to explain its failure once its own
 * deadline has passed.
 */
export const apart =
  (name: string, budget: Duration.Duration) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Operation.Current>> =>
    Effect.flatMap(
      BrowserClock.after(Duration.toMillis(budget)),
      (at) =>
        Effect.flatMap(under(start(name), at), (record) => under(Effect.provideService(self, Current, record), at))
    )

/**
 * Runs `self` apart from the operation that starts it: work that outlives the operation, such as a recording's fibers,
 * reads the deadline in force when it runs, not the operation's, which will have passed, and is no step of it.
 */
export const detached = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  self.pipe(
    Effect.updateContext((context: Context.Context<R>) => Context.omit(Current)(context) as Context.Context<R>),
    Effect.provideService(Deadline.CurrentDeadline, Option.none())
  )

/** The frame of whoever called the function that called `trace`. */
const caller = (error: Error | undefined): () => string | undefined => {
  let line: string | undefined
  return () => {
    if (line === undefined && error?.stack !== undefined) line = error.stack.split("\n")[3]?.trim()
    return line
  }
}

/**
 * An error made with room for three frames: `trace`, the function calling it, and that one's caller; none where
 * stack traces are off, as `Effect.fn` makes them.
 */
const trace = (): Error | undefined => {
  const limit = Error.stackTraceLimit
  if (limit === 0) return undefined
  Error.stackTraceLimit = 3
  const error = new Error()
  Error.stackTraceLimit = limit
  return error
}

/**
 * The stack frames `Effect.fn` gives what it runs, without its span: where the function was called, and where it
 * was defined, which a failure's rendering lists under the operation's name.
 */
const framed = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  name: string,
  call: Error | undefined,
  definition: () => string | undefined
): Effect.Effect<A, E, R> =>
  Effect.updateService(self, References.CurrentStackFrame, (parent) =>
    Recorders.frame(
      name,
      caller(call),
      { name: `${name} (definition)`, stack: definition, parent }
    ))

/**
 * `Effect.fn` as an operation: each call runs its body, then `pipeables`, with the first of them `named`, so the
 * operation's span and record cover the body and the rest wrap it; and its failures carry the frames of the call
 * and of the definition, as `Effect.fn`'s do.
 */
export const fnWith = (name: string, options: Spans.Options = {}) => {
  // The call made where the function is defined
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  return (body: Function, ...pipeables: Array<Function>): (...args: Array<any>) => Effect.Effect<any, any, any> => {
    const definition = caller(trace())
    const untraced = Effect.fnUntraced(
      body as never,
      (effect: Effect.Effect<unknown, unknown, unknown>) => namedWith(name, options, true)(effect),
      ...pipeables as []
    ) as (...args: Array<any>) => Effect.Effect<any, any, any>
    return function(this: unknown, ...args: Array<any>) {
      return framed(untraced.apply(this, args), name, trace(), definition)
    }
  }
}

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
  > => fnWith(name, options)(body) as never
