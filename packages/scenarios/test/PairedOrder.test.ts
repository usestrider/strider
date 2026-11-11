import { expect, it } from "vitest"
import { rotation } from "../src/benchmarks/paired.ts"

// Within a group a sample inherits the state the previous one left (caches, heat, the browser's
// garbage), so every role must follow every other role equally often across a full cycle.
it("balances which role immediately precedes each role", () => {
  const counts = new Map<string, number>()
  for (let i = 0; i < 4; i++) {
    const group = rotation(i)
    for (let j = 1; j < group.length; j++) {
      const key = `${group[j - 1]} -> ${group[j]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  expect(counts.get("base:strider -> head:strider")).toBe(1)
  expect(new Set(counts.values())).toEqual(new Set([1]))
})
