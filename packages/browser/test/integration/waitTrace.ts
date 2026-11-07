/** Test-only observations. Each instance captures its owner once; no cross-recorder registry. */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { connection } from "./failureTrace.ts"

export const waitTrace = (
  label: string,
  sink?: (kind: string, payload: unknown) => void
) => {
  let emit = sink ?? (() => {})
  if (sink === undefined) {
    try {
      emit = connection(label)
    } catch { /* Diagnostics cannot fail acquisition. */ }
  }
  let next = 0
  let activeCount = 0
  const active = new Map<number, { phase: string; hop?: string }>()
  const snapshot = () => ({ active: [...active.values()], omitted: activeCount - active.size })
  const event = (kind: string, fields: object = {}) => {
    try {
      emit(kind, { ...fields, ...snapshot() })
    } catch { /* Observation cannot change the program. */ }
  }
  const observe = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>, hop?: string): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const invocation = ++next
      activeCount++
      if (active.size < 16) active.set(invocation, { phase, ...(hop === undefined ? {} : { hop }) })
      event("stage-enter", { phase, invocation, hop })
      return effect.pipe(Effect.onExit((exit) =>
        Effect.sync(() => {
          active.delete(invocation)
          activeCount--
          event("stage-exit", {
            phase,
            invocation,
            hop,
            success: Exit.isSuccess(exit),
            failure: Exit.isFailure(exit) && Cause.hasFails(exit.cause),
            defect: Exit.isFailure(exit) && Cause.hasDies(exit.cause),
            interrupted: Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
          })
        })
      ))
    })
  const test = <A, E, R>(signal: AbortSignal, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      const abort = () => event("test-abort-observed")
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
      return observe("test-program", effect).pipe(
        Effect.ensuring(Effect.sync(() => signal.removeEventListener("abort", abort)))
      )
    })
  return { observe, event, snapshot, test }
}
