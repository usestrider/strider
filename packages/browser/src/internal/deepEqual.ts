/**
 * Deep equality of values that come back from a page by value: Dates compare by time, RegExps by source and
 * flags, arrays, Maps and Sets by their entries, plain objects by their own enumerable keys, and NaN equals NaN.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b) || a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime())
  if (a instanceof RegExp) return a.source === (b as RegExp).source && a.flags === (b as RegExp).flags
  if (Array.isArray(a)) {
    const other = b as ReadonlyArray<unknown>
    return a.length === other.length && a.every((value, index) => deepEqual(value, other[index]))
  }
  if (a instanceof Map) {
    const other = b as Map<unknown, unknown>
    if (a.size !== other.size) return false
    // Object keys come back from the page as new objects, so they match by structure, each entry once
    const unmatched = [...other].filter(([key]) => typeof key === "object" && key !== null)
    for (const [key, value] of a) {
      if (typeof key !== "object" || key === null) {
        if (!other.has(key) || !deepEqual(value, other.get(key))) return false
        continue
      }
      const index = unmatched.findIndex(([candidate, entry]) => deepEqual(key, candidate) && deepEqual(value, entry))
      if (index === -1) return false
      unmatched.splice(index, 1)
    }
    return true
  }
  if (a instanceof Set) {
    const other = b as Set<unknown>
    if (a.size !== other.size) return false
    const unmatched = [...other]
    for (const value of a) {
      const index = unmatched.findIndex((candidate) => deepEqual(value, candidate))
      if (index === -1) return false
      unmatched.splice(index, 1)
    }
    return true
  }
  const keys = Object.keys(a)
  const other = b as Record<string, unknown>
  return keys.length === Object.keys(other).length &&
    keys.every((key) => Object.hasOwn(other, key) && deepEqual((a as Record<string, unknown>)[key], other[key]))
}
