/**
 * A time a browser reports since the Unix epoch, in its unit, as a `DateTime.Utc`.
 */
import { assert, describe, it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as EpochTime from "../src/internal/epochTime.ts"

describe("EpochTime", () => {
  it("reads milliseconds since the epoch, dropping a fraction of a millisecond", () => {
    assert.strictEqual(DateTime.toEpochMillis(EpochTime.fromMillis(1792531419869.452)), 1792531419869)
    assert.strictEqual(DateTime.toEpochMillis(EpochTime.fromMillis(1792531356515)), 1792531356515)
  })

  it("reads seconds since the epoch to the millisecond", () => {
    assert.strictEqual(DateTime.toEpochMillis(EpochTime.fromSeconds(1793065316.7090697)), 1793065316709)
    // 1.001 * 1000 is 1000.9999999999999 in floating point
    assert.strictEqual(DateTime.toEpochMillis(EpochTime.fromSeconds(1.001)), 1001)
    assert.strictEqual(DateTime.toEpochMillis(EpochTime.fromSeconds(1793065316)), 1793065316000)
  })
})
