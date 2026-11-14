/**
 * Playwright's `tests/page/jshandle-json-value.spec.ts`: a handle's value, read as data.
 *
 * What the port changes:
 * - `handle.jsonValue()` is `handle.read`, which crosses the value by value under Strider's serialization. A `Date`
 *   arrives as a `Date`, where Playwright's JSON form is its ISO string, so JH-008 compares the same instant.
 * - `page.evaluateHandle` runs in the isolated world, which Strider's handles are in (main-world handles aren't a
 *   Strider feature, see the matrix row for them). The values the originals build are the same in either world.
 * - JH-009 builds the circular object in a function, since Strider evaluates functions and not source strings. Its
 *   expectation is the original's: the read returns the cyclic object.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("JH-007", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ({ foo: "bar" }))
      const json = yield* aHandle.read
      assert.deepEqual(json, { foo: "bar" })
    }))

  test("JH-008", ({ page }) =>
    Effect.gen(function*() {
      const dateHandle = yield* page.evaluateHandle(() => new Date("2017-09-26T00:00:00.000Z"))
      const date = yield* dateHandle.read
      assert.strictEqual(date.toJSON(), "2017-09-26T00:00:00.000Z")
    }))

  test("JH-009", ({ page }) =>
    Effect.gen(function*() {
      const handle = yield* page.evaluateHandle(() => {
        const a: { b?: unknown } = {}
        a.b = a
        return a
      })
      const a: { b?: unknown } = {}
      a.b = a
      assert.deepEqual(yield* handle.read, a)
    }))
})
