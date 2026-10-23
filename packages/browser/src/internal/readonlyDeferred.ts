/**
 * A `ReadonlyDeferred` at run time (review 13, candidate 3): Effect's own `Deferred`, carrying this package's
 * TypeId, so the types hand out only the read side and `Deferred.await` is Effect's.
 */
import * as Deferred from "effect/Deferred"

export const TypeId = "~@usestrider/browser/Deferred/ReadonlyDeferred"

const variance = { _A: (a: unknown) => a, _E: (e: unknown) => e }

/** A deferred the library completes, marked as one a caller may only read. */
export const make = <A, E>(): Deferred.Deferred<A, E> => {
  const deferred = Deferred.makeUnsafe<A, E>()
  Object.defineProperty(deferred, TypeId, { value: variance })
  return deferred
}
