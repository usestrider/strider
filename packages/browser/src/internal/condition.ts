/**
 * What a `Condition` is at run time: its predicate under the public TypeId, and its description, which
 * `ExpectationFailed` says.
 */
import { pipeArguments } from "effect/Pipeable"
import type * as Condition from "../Condition.ts"

export const TypeId = "~@usestrider/browser/Condition"

class ConditionImpl<in A> implements Condition.Condition<A> {
  readonly [TypeId]: (a: A) => boolean
  readonly description: string
  constructor(description: string, predicate: (a: A) => boolean) {
    this[TypeId] = predicate
    this.description = description
  }
  // `pipe`, so `condition.pipe(Condition.because("…"))` reads as the handles do (QUIRKS.md, Q85)
  pipe() {
    return pipeArguments(this, arguments)
  }
}

export const make = <A>(description: string, predicate: (a: A) => boolean): Condition.Condition<A> =>
  new ConditionImpl(description, predicate)

export const holds = <A>(condition: Condition.Condition<A>, value: A): boolean => condition[TypeId](value)

export const describe = (condition: Condition.Condition<never>): string =>
  condition instanceof ConditionImpl ? condition.description : "the condition"
