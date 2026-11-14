/**
 * Playwright's `tests/page/jshandle-properties.spec.ts`: a handle's property, read by value.
 *
 * What the port changes:
 * - `handle.getProperty(name)` is `handle.evaluateHandle((value) => value[name])` (`method-jshandle-getproperty`). The
 *   result is a handle to the property's value, as the original's is.
 * - `handle.jsonValue()` is `handle.read`, which returns the value by value.
 * - JH-011 reads properties that are `undefined` and missing, which Strider's `Reflect.get` reads as Playwright's
 *   `getProperty` does.
 * - JH-012 checks `-0` with `Object.is`, since `strictEqual` can't tell it from `0`, and Jest's `toEqual` can.
 * - JH-013 through JH-017 call `handle.getProperties()`, which Strider has no equivalent of (`method-jshandle-getproperties`),
 *   so they're ledgered rather than ported.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("JH-010", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ({
        one: 1,
        two: 2,
        three: 3
      }))
      const twoHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "two"))
      assert.strictEqual(yield* twoHandle.read, 2)
    }))

  test("JH-011", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ({
        undefined: undefined,
        null: null
      }))
      const undefinedHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "undefined"))
      assert.strictEqual(String(yield* undefinedHandle.read), "undefined")
      const nullHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "null"))
      assert.strictEqual(yield* nullHandle.read, null)
      const emptyHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "empty"))
      assert.strictEqual(String(yield* emptyHandle.read), "undefined")
    }))

  test("JH-012", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ({
        infinity: Infinity,
        nInfinity: -Infinity,
        nan: NaN,
        nzero: -0
      }))
      const infinityHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "infinity"))
      assert.strictEqual(yield* infinityHandle.read, Infinity)
      const nInfinityHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "nInfinity"))
      assert.strictEqual(yield* nInfinityHandle.read, -Infinity)
      const nanHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "nan"))
      assert.strictEqual(String(yield* nanHandle.read), "NaN")
      const nzeroHandle = yield* aHandle.evaluateHandle((value) => Reflect.get(value, "nzero"))
      assert.isTrue(Object.is(yield* nzeroHandle.read, -0))
    }))
})
