/**
 * Duration inputs checked before conversion: `Duration.fromInput` reads NaN as zero, in a number, a tuple's
 * field or an object's, and adds opposite infinities to zero, so a check on the converted duration alone lets them
 * through. A duration can also be finite and still too large for milliseconds as a number.
 */
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"

const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value)

/** The fields of a duration object that `Duration.fromInput` adds up. */
const fields = [
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
  "microseconds",
  "nanoseconds"
] as const

/** Whether every number the input is made of is finite, before any conversion. */
const finiteParts = (input: Duration.Input): boolean => {
  if (typeof input === "number") return Number.isFinite(input)
  if (typeof input === "bigint") return true
  if (typeof input === "string") return !/\bInfinity\b|\bNaN\b/.test(input)
  if (Duration.isDuration(input)) return Duration.isFinite(input)
  if (Array.isArray(input)) return input.length === 2 && input.every(finite)
  if (typeof input === "object" && input !== null) {
    // The fields the conversion reads, by property access as it does, inherited ones included; others are ignored
    const parts = input as Record<string, unknown>
    return fields.every((field) => parts[field] === undefined || finite(parts[field]))
  }
  return false
}

/**
 * A duration input as a finite number of milliseconds, or `None` when it isn't a duration, or any number in it,
 * or the milliseconds it converts to, isn't finite.
 */
export const toFiniteMillis = (input: Duration.Input): Option.Option<number> => {
  if (!finiteParts(input)) return Option.none()
  return Option.filter(
    Option.map(Option.filter(Duration.fromInput(input), Duration.isFinite), Duration.toMillis),
    Number.isFinite
  )
}
