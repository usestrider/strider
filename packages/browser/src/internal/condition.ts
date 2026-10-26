/**
 * What a `Condition` is at run time: its predicate under the public TypeId, and its description, which
 * `ExpectationFailed` says, under a key of its own.
 */
import { pipeArguments } from "effect/Pipeable"
import type * as Condition from "../Condition.ts"

export const TypeId = "~@usestrider/browser/Condition"
const DescriptionKey = "~@usestrider/browser/Condition/description"

interface Impl<A> {
  readonly [TypeId]: (a: A) => boolean
  readonly [DescriptionKey]: string
}

// `pipe`, so `condition.pipe(Condition.because("…"))` reads as the handles do (QUIRKS.md, Q85)
const proto = {
  pipe() {
    return pipeArguments(this, arguments)
  }
}

export const make = <A>(description: string, predicate: (a: A) => boolean): Condition.Condition<A> => {
  const condition: Impl<A> = Object.assign(Object.create(proto), { [TypeId]: predicate, [DescriptionKey]: description })
  return condition as unknown as Condition.Condition<A>
}

export const holds = <A>(condition: Condition.Condition<A>, value: A): boolean =>
  (condition as unknown as Impl<A>)[TypeId](value)

export const describe = (condition: Condition.Condition<never>): string =>
  (condition as unknown as Impl<never>)[DescriptionKey] ?? "the condition"
