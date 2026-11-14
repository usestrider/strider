/**
 * Playwright's `tests/page/page-evaluate-handle.spec.ts`: handles to values in the page, passed back into an evaluation
 * as arguments, alone and nested in objects and arrays.
 *
 * What the port changes:
 * - Playwright's `page.evaluateHandle` returns a `JSHandle` in the page's main world, and `page.evaluate` runs there. Strider's
 *   handles are isolated-world values (`page.evaluateHandle`), and `page.evaluate` runs in that world too, so the handle
 *   and the evaluation share a realm, as the original's do. Stock WebKit has no isolated world, so the tests that take a
 *   handle are ledgered `needsFeature` there, as the `page-evaluate` port's handle tests are.
 * - Strider's `JSHandle` isn't a serialized value: a handle argument arrives as the value it refers to, and the function's
 *   parameter is typed as the handle, hence the `unknown` parameters.
 * - Playwright's `page.evaluate` takes a handle nested in an object or array (EV-104 to EV-107). Strider's argument rules
 *   (`Page.evaluate`, API.md) say a handle passed as an argument crosses as itself, and its serializer recognizes a
 *   handle only as a top-level argument, so a nested one is walked as an ordinary object and fails with
 *   `NotSerializable`. The port passes the handles nested, as the original does, and those tests fail on Strider.
 * - EV-109's handle to `Infinity` loses the value when the handle is created on Chromium (it reads back as `NaN`), so it
 *   fails there too.
 * - Tests that pass no handle (EV-108, EV-110) run in the main world, as Playwright's `page.evaluate` does, through
 *   `page.evaluateInMainWorld`.
 * - `page.evaluate` returns `JSHandle.Serialized`, which is the value by value, the same as the original's result.
 * - EV-111's `window.FOO` is set and read in the isolated world: the handle, and both evaluations that read it, share one
 *   world, so the value the handle's function set is the one the later evaluation reads.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("EV-101", ({ page }) =>
    Effect.gen(function*() {
      const windowHandle = yield* page.evaluateHandle(() => window)
      assert.isOk(windowHandle)
    }))

  test("EV-102", ({ page }) =>
    Effect.gen(function*() {
      const navigatorHandle = yield* page.evaluateHandle(() => navigator)
      const text = yield* page.evaluate((e: unknown) => (e as Navigator).userAgent, navigatorHandle)
      assert.include(text, "Mozilla")
    }))

  test("EV-103", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => 5)
      const isFive = yield* page.evaluate((e: unknown) => Object.is(e, 5), aHandle)
      assert.isTrue(isFive)
    }))

  test("EV-104", ({ page }) =>
    Effect.gen(function*() {
      const foo = yield* page.evaluateHandle(() => ({ x: 1, y: "foo" }))
      const result = yield* page.evaluate(({ foo }: { foo: unknown }) => foo, { foo })
      assert.deepStrictEqual(result, { x: 1, y: "foo" })
    }))

  test("EV-105", ({ page }) =>
    Effect.gen(function*() {
      const foo = yield* page.evaluateHandle(() => window)
      const result = yield* page.evaluate(({ foo }: { foo: unknown }) => foo === window, { foo })
      assert.isTrue(result)
    }))

  test("EV-106", ({ page }) =>
    Effect.gen(function*() {
      const foo = yield* page.evaluateHandle(() => ({ x: 1, y: "foo" }))
      const bar = yield* page.evaluateHandle(() => 5)
      const baz = yield* page.evaluateHandle(() => ["baz"])
      const result = yield* page.evaluate((x: unknown) => JSON.stringify(x), {
        a1: { foo },
        a2: { bar, arr: [{ baz }] }
      })
      assert.deepStrictEqual(JSON.parse(result), {
        a1: { foo: { x: 1, y: "foo" } },
        a2: { bar: 5, arr: [{ baz: ["baz"] }] }
      })
    }))

  test("EV-107", ({ page }) =>
    Effect.gen(function*() {
      const foo = yield* page.evaluateHandle(() => 1)
      const result = yield* page.evaluate((x: unknown) => x, { foo, bar: [foo], baz: { foo } })
      assert.deepStrictEqual(result, { foo: 1, bar: [1], baz: { foo: 1 } })
    }))

  test("EV-108", ({ page }) =>
    Effect.gen(function*() {
      // A plain object, not a handle: the main world, as the original's `page.evaluate` runs
      const foo = { x: 1 }
      const result = yield* page.evaluateInMainWorld((x: unknown) => x, { foo, bar: [foo], baz: { foo } })
      assert.deepStrictEqual(result, { foo: { x: 1 }, bar: [{ x: 1 }], baz: { foo: { x: 1 } } })
    }))

  test("EV-109", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => Infinity)
      assert.isTrue(yield* page.evaluate((e: unknown) => Object.is(e, Infinity), aHandle))
    }))

  test("EV-110", ({ page }) =>
    Effect.gen(function*() {
      // The argument is a plain object, which the function may change, so it runs in the main world
      const result = yield* page.evaluateInMainWorld((arg: { foo?: number }) => {
        if (arg.foo !== 42) throw new Error("Not a 42")
        arg.foo = 17
        if (arg.foo !== 17) throw new Error("Not 17")
        delete arg.foo
        if (arg.foo === 17) throw new Error("Still 17")
        return arg
      }, { foo: 42 })
      assert.deepStrictEqual(result, {})
    }))

  test("EV-111", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => {
        ;(window as unknown as Record<string, unknown>)["FOO"] = 123
        return window
      })
      const value = yield* page.evaluate((e: unknown) => (e as Record<string, unknown>)["FOO"], aHandle)
      assert.strictEqual(value, 123)
    }))
})
