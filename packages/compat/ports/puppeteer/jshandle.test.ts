/**
 * Puppeteer's `test/src/jshandle.test.ts`: handles to values in the page, created by `page.evaluateHandle`, passed back
 * into evaluations, read by value (`jsonValue`), and released.
 *
 * What the port changes:
 * - Puppeteer's `page.evaluateHandle` and `handle.evaluate` run in an isolated world here (Strider's handles are
 *   isolated-world values), and so does `page.evaluate` when it takes a handle. Stock WebKit has no isolated world, so
 *   every test that creates a handle is ledgered `needsFeature` for WebKit, as the `page-evaluate-handle` port is.
 * - `handle.getProperty(name)` is `handle.evaluateHandle(value => value[name])`, the recipe the matrix row for
 *   `getProperty` gives. The property is read in the page, so a getter runs and its failure stays visible.
 * - `handle.jsonValue()` is `handle.read`, which returns the value by value with Strider's serialization (a `Date`
 *   arrives as a `Date`).
 * - "should warn about recursive objects" asserts Strider's typed reason, `NotSerializable`, which is more specific than
 *   Puppeteer's message. The cyclic object is the argument, and it's rejected before the page sees it.
 * - "should accept object handle to unserializable value" and "should not throw for circular objects" are ported as
 *   written. Strider's known gaps: a handle to `Infinity` loses its value, and reading a cyclic object fails
 *   `NotSerializable` ("nested deeper than the browser serializes"), so these fail on Chromium.
 * - "should return the RemoteObject" is not applicable: `remoteObject()` returns the Chrome DevTools Protocol's
 *   `Runtime.RemoteObject`, a protocol detail that Strider's handles don't expose.
 * - `getProperties`, `asElement`, `toString`, `Symbol.dispose`, `Symbol.asyncDispose`, and `move` are ledgered: Strider
 *   has no property enumeration, element cast, string preview, JavaScript disposal protocol, or handle move.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import { failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** The reason of a failed call, as its typed `_tag`, when the failure carries one. */
const reasonOf = (error: unknown) =>
  Predicate.hasProperty(error, "reason") && Predicate.hasProperty(error.reason, "_tag") ? error.reason._tag : undefined

upstream(import.meta.filename, {}, (test) => {
  test("JSHandle Page.evaluateHandle should work", ({ page }) =>
    Effect.gen(function*() {
      const windowHandle = yield* page.evaluateHandle(() => window)
      assert.isOk(windowHandle)
    }))

  test("JSHandle Page.evaluateHandle should accept object handle as an argument", ({ page }) =>
    Effect.gen(function*() {
      const navigatorHandle = yield* page.evaluateHandle(() => navigator)
      const text = yield* page.evaluate((e: unknown) => (e as Navigator).userAgent, navigatorHandle)
      assert.include(text, "Mozilla")
    }))

  test("JSHandle Page.evaluateHandle should accept object handle to primitive types", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => 5)
      const isFive = yield* page.evaluate((e: unknown) => Object.is(e, 5), aHandle)
      assert.isTrue(isFive)
    }))

  test("JSHandle Page.evaluateHandle should warn about recursive objects", ({ page }) =>
    Effect.gen(function*() {
      const cyclic: { obj?: unknown } = {}
      cyclic.obj = cyclic
      const error = yield* failureOf(page.evaluateHandle((opts: unknown) => opts, cyclic))
      assert.strictEqual(reasonOf(error), "NotSerializable")
    }))

  test("JSHandle Page.evaluateHandle should accept object handle to unserializable value", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => Infinity)
      assert.isTrue(yield* page.evaluate((e: unknown) => Object.is(e, Infinity), aHandle))
    }))

  test("JSHandle Page.evaluateHandle should use the same JS wrappers", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => {
        ;(globalThis as unknown as Record<string, unknown>)["FOO"] = 123
        return window
      })
      const value = yield* page.evaluate((e: unknown) => (e as Record<string, unknown>)["FOO"], aHandle)
      assert.strictEqual(value, 123)
    }))

  test("JSHandle JSHandle.getProperty should work", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ({ one: 1, two: 2, three: 3 }))
      // Puppeteer's `getProperty("two")`: the property is read in the page, and the result is a handle of its own
      const twoHandle = yield* aHandle.evaluateHandle((value: unknown) => (value as Record<string, unknown>)["two"])
      assert.strictEqual(yield* twoHandle.read, 2)
    }))

  test("JSHandle JSHandle.jsonValue should work", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ({ foo: "bar" }))
      assert.deepStrictEqual(yield* aHandle.read, { foo: "bar" })
    }))

  test("JSHandle JSHandle.jsonValue works with jsonValues that are not objects", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => ["a", "b"])
      assert.deepStrictEqual(yield* aHandle.read, ["a", "b"])
    }))

  test("JSHandle JSHandle.jsonValue works with jsonValues that are primitives", ({ page }) =>
    Effect.gen(function*() {
      const aHandle = yield* page.evaluateHandle(() => "foo")
      assert.strictEqual(yield* aHandle.read, "foo")

      const bHandle = yield* page.evaluateHandle(() => undefined)
      assert.isUndefined(yield* bHandle.read)
    }))

  test("JSHandle JSHandle.jsonValue should work with dates", ({ page }) =>
    Effect.gen(function*() {
      const dateHandle = yield* page.evaluateHandle(() => new Date("2017-09-26T00:00:00.000Z"))
      const date = yield* dateHandle.read
      assert.instanceOf(date, Date)
      assert.strictEqual(date.toISOString(), "2017-09-26T00:00:00.000Z")
    }))

  test("JSHandle JSHandle.jsonValue should not throw for circular objects", ({ page }) =>
    Effect.gen(function*() {
      const handle = yield* page.evaluateHandle(() => {
        const t: { t?: unknown; g: number } = { g: 1 }
        t.t = t
        return t
      })
      yield* handle.read
    }))
})
