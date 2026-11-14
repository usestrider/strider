/**
 * Playwright's `tests/page/page-evaluate.spec.ts`: running a function in the page, what crosses the boundary in each
 * direction, and what a failed evaluation reports.
 *
 * What the port changes:
 * - Playwright's `page.evaluate` runs in the page's main world, so every evaluation here is
 *   `page.evaluateInMainWorld`, which is where the page's own globals are. Strider's `page.evaluate` is the isolated
 *   world, which stock WebKit lacks. The tests that take a handle, which only an isolated world makes
 *   (`page.evaluateHandle`), are the only ones that run there.
 * - Results come back as `JSHandle.Serialized<A>`, and a thrown exception is `PageError` with
 *   `Reason.EvaluationThrown`, whose `exception` carries the name and message. Playwright's `error.message` checks
 *   become checks on that exception, and `.catch(e => e)` is `reasonOf` below.
 * - What crosses is by value, as API.md, "Pages" states: primitives, `Date`, `RegExp`, `Map`, `Set`, bigints, arrays,
 *   and objects by their own enumerable string keys. Where Playwright's expectation is a Playwright-specific form
 *   (a Map as `{}`, a function inside an object failing with a message), the port asserts Strider's typed result,
 *   and says so where it does. A cycle in a result is `NotSerializable`. An `Error`, `URL`, `PerformanceMeasure`, and
 *   `Performance` in a result are asserted as `JSHandle.Serialized` types them, as data with their fields, which is
 *   what the original reads; they fail while the result doesn't carry them.
 * - Strings passed to `page.evaluate` (EV-015, EV-016, EV-030, EV-054, EV-074, EV-094 to EV-097) are functions here, since Strider's
 *   `evaluate` takes a function: where the string's expression is only a way to write the function, the port writes
 *   the function. EV-057 to EV-059, which test that a string is accepted, are `needsFeature`.
 * - Playwright's `evaluate` takes one argument and rejects a second with "Too many arguments" (EV-038, which is
 *   `notApplicable`). Strider's `evaluate(fn, ...args)` takes any number of arguments, so that call succeeds.
 * - `server.setCSP(path, value)` is `server.setExtraHeaders(path, { "Content-Security-Policy": value })`, the one
 *   header it sets.
 * - Playwright's `framenavigated` listener is `PageNavigation.next`: the listener's evaluation is started in a fiber
 *   when the navigation's wait ends, and awaited after the `goto`, as the original awaits its promise.
 * - `page.waitForNavigation()` is `PageNavigation.next`, subscribed before the call that navigates.
 * - Playwright's `waitForFunction` is `Expect.that` on the page's main-world value, as the file chooser port does; a
 *   wait's budget is `Deadline.within`, and a wait that runs out fails with `Expect.ExpectationFailed`.
 * - Playwright's evaluate runs with user activation, which `document.execCommand("copy")` needs. The one test that
 *   depends on that (EV-062) runs under `Page.withUserGesture`; the other evaluations don't, since nothing else in
 *   them checks for a gesture. Popups (EV-070) also run under it, since Strider keeps the browser's popup blocking.
 * - A released handle (EV-061) is a programming error in Strider, a defect, where Playwright's element is "disposed"
 *   and its evaluation rejects. The port checks the defect.
 * - `page.$`, `page.$eval`, and `page.$$eval` are element handles and `locator` reads; EV-060 and EV-061 hold their
 *   element as a handle from `page.evaluateHandle`, which Strider's isolated world makes.
 * - `window.builtins` is Playwright's own copy of the built-ins its utility script uses; EV-045 reads the page's own
 *   `performance`, which is what the original's copy is of.
 * - `page.goto` names `waitUntil: "load"`, Playwright's default, where Strider's is `commit`.
 * - The `it.skip` conditions on the Android platform and Playwright's `mode` fixture don't apply. EV-049's
 *   skip is for the other browsers' own serializers; Strider's depth limit is the same on every backend, so it
 *   runs on all of them. EV-099's skip for WebKit is Playwright's own WebKit, which isn't the stock browser, so it
 *   runs there too.
 *   EV-099's function is built with `new Function`, since the test transpiler lowers a `using` declaration written
 *   in the file to a helper that isn't in the page (the original skips Node before 24 for the same lowering).
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, Page, PageNavigation, Reason, Target } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { attachFrame, failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A condition that a value equals `expected`, for a poll. */
const equalTo = <A>(expected: A) => Condition.make(`equal to ${String(expected)}`, (value: A) => value === expected)

/** The fields of `performance.timing` that the original reads. */
const timingKeys = [
  "connectEnd",
  "connectStart",
  "domComplete",
  "domContentLoadedEventEnd",
  "domContentLoadedEventStart",
  "domInteractive",
  "domLoading",
  "domainLookupEnd",
  "domainLookupStart",
  "fetchStart",
  "loadEventEnd",
  "loadEventStart",
  "navigationStart",
  "redirectEnd",
  "redirectStart",
  "requestStart",
  "responseEnd",
  "responseStart",
  "secureConnectionStart",
  "unloadEventEnd",
  "unloadEventStart"
] as const

/** The data fields of a `URL`, which `JSHandle.Serialized<URL>` says a result carries. */
const urlKeys = [
  "href",
  "origin",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash"
] as const

const assertUrl = (actual: { readonly [K in (typeof urlKeys)[number]]: string }, expected: URL) => {
  for (const key of urlKeys) assert.strictEqual(actual[key], expected[key], key)
}

/**
 * The reason a page call fails with, for a call the original expects to throw (its `.catch(e => e)`). A call that
 * succeeds fails the test.
 */
const reasonOf = Effect.fnUntraced(function*<A, R>(effect: Effect.Effect<A, unknown, R>) {
  const error = yield* failureOf(effect, "the evaluation")
  assert.instanceOf(error, Page.PageError)
  return error.reason
})

upstream(import.meta.filename, {}, (test) => {
  test("EV-001", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => 7 * 3)
      assert.strictEqual(result, 21)
    }))

  test("EV-002", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => a, NaN)
      assert.isNaN(result)
    }))

  test("EV-003", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => a, -0)
      assert.isTrue(Object.is(result, -0))
    }))

  test("EV-004", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => a, Infinity)
      assert.isTrue(Object.is(result, Infinity))
    }))

  test("EV-005", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => a, -Infinity)
      assert.isTrue(Object.is(result, -Infinity))
    }))

  test("EV-006", ({ page }) =>
    Effect.gen(function*() {
      const value = {
        infinity: Infinity,
        nInfinity: -Infinity,
        nZero: -0,
        nan: NaN
      }
      const result = yield* page.evaluateInMainWorld((value) => value, value)
      assert.deepStrictEqual(result, value)
    }))

  test("EV-007", ({ page }) =>
    Effect.gen(function*() {
      assert.isNull(yield* page.evaluateInMainWorld((value) => Promise.resolve(value), null))
      assert.strictEqual(yield* page.evaluateInMainWorld((value) => Promise.resolve(value), Infinity), Infinity)
      assert.isTrue(Object.is(yield* page.evaluateInMainWorld((value) => Promise.resolve(value), -0), -0))
      assert.isUndefined(yield* page.evaluateInMainWorld((value) => Promise.resolve(value), undefined))
    }))

  test("EV-008", ({ page }) =>
    Effect.gen(function*() {
      const value = {
        infinity: Infinity,
        nInfinity: -Infinity,
        nZero: -0,
        nan: NaN
      }
      const result = yield* page.evaluateInMainWorld((value) => Promise.resolve(value), value)
      assert.deepStrictEqual(result, value)
    }))

  test("EV-009", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => a, [1, 2, 3])
      assert.deepStrictEqual(result, [1, 2, 3])
    }))

  test("EV-010", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => Array.isArray(a), [1, 2, 3])
      assert.isTrue(result)
    }))

  test("EV-011", ({ page }) =>
    Effect.gen(function*() {
      const testCases = [
        new Int8Array([1, 2, 3]),
        new Uint8Array([1, 2, 3]),
        new Uint8ClampedArray([1, 2, 3]),
        new Int16Array([1, 2, 3]),
        new Uint16Array([1, 2, 3]),
        new Int32Array([1, 2, 3]),
        new Uint32Array([1, 2, 3]),
        new Float32Array([1.1, 2.2, 3.3]),
        new Float64Array([1.1, 2.2, 3.3]),
        new BigInt64Array([1n, 2n, 3n]),
        new BigUint64Array([1n, 2n, 3n])
      ]
      for (const typedArray of testCases) {
        const result = yield* page.evaluateInMainWorld((a) => a, typedArray)
        // A typed array's class doesn't cross. Its own enumerable keys do, as an object: its indexed elements
        assert.deepStrictEqual(result, { ...typedArray } as unknown)
      }
    }))

  test("EV-012", ({ page }) =>
    Effect.gen(function*() {
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 42n), 42n)
      assert.strictEqual(yield* page.evaluateInMainWorld((a) => a, 17n), 17n)
    }))

  test("EV-013", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(
        (a) => a.x.constructor.name + " " + JSON.stringify(a.x),
        { x: new Map([[1, 2]]) }
      )
      // A Map arrives in the page as a Map, which JSON reads as an empty object; Playwright's sends it as `{}`
      assert.strictEqual(result, "Map {}")
      // A Map comes back as a Map, with its entries
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => new Map([[1, 2]])), new Map([[1, 2]]))
    }))

  test("EV-014", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(
        (a) => a.x.constructor.name + " " + JSON.stringify(a.x),
        { x: new Set([1, 2]) }
      )
      // A Set arrives in the page as a Set, which JSON reads as an empty object; Playwright's sends it as `{}`
      assert.strictEqual(result, "Set {}")
      // A Set comes back as a Set, with its members
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => new Set([1, 2])), new Set([1, 2]))
    }))

  test("EV-015", ({ page }) =>
    Effect.gen(function*() {
      // The original's second evaluation is the string `globalVar`, which is this function's body
      yield* page.evaluateInMainWorld(() => Reflect.set(window, "globalVar", 123))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "globalVar")), 123)
    }))

  test("EV-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/global-var.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "globalVar")), 123)
    }))

  test("EV-017", ({ page }) =>
    Effect.gen(function*() {
      // A symbol in an array keeps its place as `undefined`
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [Symbol("foo4")]), [undefined])
      // A symbol-keyed property is left out, as Serialized leaves symbols out
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => {
          const a: Record<symbol, number> = {}
          a[Symbol("foo4")] = 42
          return a
        }),
        {}
      )
      // A symbol-valued property inside an array of objects is left out of the object
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => {
          return { foo: [{ a: Symbol("foo4") }] }
        }),
        { foo: [{}] }
      )
    }))

  test("EV-018", ({ page }) =>
    Effect.gen(function*() {
      const a = {
        sum([a, b]: [number, number]) {
          return a + b
        },
        async mult([a, b]: [number, number]) {
          return a * b
        }
      }
      assert.strictEqual(yield* page.evaluateInMainWorld(a.sum, [1, 2]), 3)
      assert.strictEqual(yield* page.evaluateInMainWorld(a.mult, [2, 4]), 8)
    }))

  test("EV-019", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a) => a["中文字符"], { "中文字符": 42 })
      assert.strictEqual(result, 42)
    }))

  test("EV-020", ({ page }) =>
    Effect.gen(function*() {
      const expected = "x".repeat(40000)
      assert.strictEqual(yield* page.evaluateInMainWorld((data) => data, expected), expected)
    }))

  test("EV-021", ({ page }) =>
    Effect.gen(function*() {
      const expected = "🎭".repeat(10000)
      assert.strictEqual(yield* page.evaluateInMainWorld((data) => data, expected), expected)
    }))

  test("EV-022", ({ page }) =>
    Effect.gen(function*() {
      // The document ends during the call, which fails it with `TargetGone`, since the function may have run partly
      const error = yield* failureOf(
        page.evaluateInMainWorld(() => {
          location.reload()
          return new Promise(() => {})
        }),
        "the evaluation"
      )
      assert.isTrue(Target.isTargetGone(error))
    }))

  test("EV-023", ({ page }) =>
    Effect.gen(function*() {
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Promise.resolve(8 * 7)), 56)
    }))

  test("EV-024", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's listener runs at `framenavigated` and starts the evaluation there, and awaits it after the
      // navigation. The wait ends at the navigation's commit, so the evaluation starts then, in a fiber.
      const navigated = yield* PageNavigation.next(page)
      const evaluation = yield* startWaiting(
        Effect.gen(function*() {
          yield* navigated
          return yield* page.evaluateInMainWorld(() => 6 * 7)
        })
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* Fiber.join(evaluation.fiber), 42)
    }))

  test("EV-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const navigated = yield* PageNavigation.next(page)
      const evaluation = yield* startWaiting(
        Effect.gen(function*() {
          yield* navigated
          return yield* page.evaluateInMainWorld(() => 6 * 7)
        })
      )
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(yield* Fiber.join(evaluation.fiber), 42)
    }))

  test("EV-027", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(
        page.evaluateInMainWorld(() =>
          // @ts-expect-error: the object doesn't exist, which is what the evaluation throws
          not_existing_object.property
        )
      )
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, "not_existing_object")
    }))

  test("EV-028", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(page.evaluateInMainWorld(() => {
        throw "qwerty"
      }))
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, "qwerty")
    }))

  test("EV-029", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(page.evaluateInMainWorld(() => {
        throw 100500
      }))
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, "100500")
    }))

  test("EV-030", ({ page }) =>
    Effect.gen(function*() {
      // The original builds each throw from a string; here each is a function, since an evaluated function is
      // self-contained. Each one throws, and each promise rejects, with a falsy value.
      const cases: ReadonlyArray<
        { readonly label: string; readonly throws: () => never; readonly rejects: () => Promise<never> }
      > = [
        {
          label: "null",
          throws: () => {
            throw null
          },
          rejects: () => Promise.reject(null)
        },
        {
          label: "undefined",
          throws: () => {
            throw undefined
          },
          rejects: () => Promise.reject(undefined)
        },
        {
          label: "0",
          throws: () => {
            throw 0
          },
          rejects: () => Promise.reject(0)
        },
        {
          label: "''",
          throws: () => {
            throw ""
          },
          rejects: () => Promise.reject("")
        },
        {
          label: "false",
          throws: () => {
            throw false
          },
          rejects: () => Promise.reject(false)
        },
        {
          label: "NaN",
          throws: () => {
            throw NaN
          },
          rejects: () => Promise.reject(NaN)
        },
        {
          label: "-0",
          throws: () => {
            throw -0
          },
          rejects: () => Promise.reject(-0)
        },
        {
          label: "0n",
          throws: () => {
            throw 0n
          },
          rejects: () => Promise.reject(0n)
        }
      ]
      for (const { label, throws, rejects } of cases) {
        const thrown = yield* reasonOf(page.evaluateInMainWorld(throws))
        assert.instanceOf(thrown, Reason.EvaluationThrown, `throw ${label}`)
        const rejection = yield* reasonOf(page.evaluateInMainWorld(rejects))
        assert.instanceOf(rejection, Reason.EvaluationThrown, `Promise.reject(${label})`)
      }
    }))

  test("EV-031", ({ page }) =>
    Effect.gen(function*() {
      const rejection = yield* reasonOf(page.evaluateInMainWorld(() => Promise.reject(7)))
      assert.instanceOf(rejection, Reason.EvaluationThrown)
      assert.include(rejection.exception.message, "7")
      const thrown = yield* reasonOf(page.evaluateInMainWorld(() => {
        throw null
      }))
      assert.instanceOf(thrown, Reason.EvaluationThrown)
      assert.include(thrown.exception.message, "null")
    }))

  test("EV-032", ({ page }) =>
    Effect.gen(function*() {
      const object = { foo: "bar!" }
      const result = yield* page.evaluateInMainWorld((a) => a, object)
      assert.notStrictEqual(result, object)
      assert.deepStrictEqual(result, object)
    }))

  test("EV-033", ({ page }) =>
    Effect.gen(function*() {
      assert.isNaN(yield* page.evaluateInMainWorld(() => NaN))
    }))

  test("EV-034", ({ page }) =>
    Effect.gen(function*() {
      assert.isTrue(Object.is(yield* page.evaluateInMainWorld(() => -0), -0))
    }))

  test("EV-035", ({ page }) =>
    Effect.gen(function*() {
      assert.isTrue(Object.is(yield* page.evaluateInMainWorld(() => Infinity), Infinity))
    }))

  test("EV-036", ({ page }) =>
    Effect.gen(function*() {
      assert.isTrue(Object.is(yield* page.evaluateInMainWorld(() => -Infinity), -Infinity))
    }))

  test("EV-037", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const originalPromise = window.Promise
        class Promise2 {
          _promise: Promise<any>
          static all(arg: any) {
            return wrap(originalPromise.all(arg))
          }
          static race(arg: any) {
            return wrap(originalPromise.race(arg))
          }
          static resolve(arg: any) {
            return wrap(originalPromise.resolve(arg))
          }
          constructor(f: any) {
            this._promise = new originalPromise(f)
          }
          // oxlint-disable-next-line unicorn/no-thenable -- the test replaces the page's Promise with a thenable class
          then(f: any, r: any) {
            return wrap(this._promise.then(f, r))
          }
          catch(f: any) {
            return wrap(this._promise.catch(f))
          }
          finally(f: any) {
            return wrap(this._promise.finally(f))
          }
        }
        const wrap = (p: any) => {
          const result = new Promise2(() => {})
          result._promise = p
          return result
        }
        // @ts-ignore: the test replaces the page's Promise
        window.Promise = Promise2
        Reflect.set(window, "__Promise2", Promise2)
      })

      // Sanity check.
      assert.isTrue(
        yield* page.evaluateInMainWorld(() => {
          const p = Promise.all([Promise.race([]), new Promise(() => {}).then(() => {})])
          return p instanceof Reflect.get(window, "__Promise2")
        })
      )

      // Now, the new promise should be awaitable.
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Promise.resolve(42)), 42)
      // The original awaits a handle to a promise that resolves on a microtask
      const handle = yield* page.evaluateHandle(() => new Promise((f) => queueMicrotask(() => f(42))))
      assert.strictEqual(yield* handle.read, 42)
      // The original's `waitForFunction(() => false, { timeout: 500 })`: the condition never holds, so it times out
      const error = yield* Expect.that(
        page.evaluateInMainWorld(() => false),
        equalTo(true)
      ).pipe(Deadline.within("500 millis"), Effect.flip)
      assert.instanceOf(error, Expect.ExpectationFailed)
      yield* page.evaluateInMainWorld(() => Reflect.set(window, "__done", true))
      yield* Expect.that(
        page.evaluateInMainWorld(() => Reflect.get(window, "__done") === true),
        equalTo(true)
      )
    }))

  test("EV-039", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(
        ({ a, b }) => Object.is(a, undefined) && Object.is(b, "foo"),
        { a: undefined, b: "foo" }
      )
      assert.isTrue(result)
    }))

  test("EV-040", ({ page }) =>
    Effect.gen(function*() {
      // An `undefined` argument is a value that crosses, so the object keeps its key
      assert.deepStrictEqual(yield* page.evaluateInMainWorld((x) => ({ a: x }), undefined), { a: undefined })
    }))

  test("EV-041", ({ page }) =>
    Effect.gen(function*() {
      // An `undefined` field crosses as a field
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => ({ a: undefined })), { a: undefined })
    }))

  test("EV-042", ({ page }) =>
    Effect.gen(function*() {
      const value = yield* page.evaluateInMainWorld(() => ({ a: undefined }))
      assert.isTrue("a" in value)
    }))

  test("EV-043", ({ page }) =>
    Effect.gen(function*() {
      assert.isNull(yield* page.evaluateInMainWorld((x) => x, null))
    }))

  test("EV-044", ({ page }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => ({ a: null })), { a: null })
    }))

  test("EV-045", ({ page }) =>
    Effect.gen(function*() {
      // Playwright reads its own copy of `performance` (`window.builtins`); the page's own is the one a page reads
      const measures = yield* page.evaluateInMainWorld(() => {
        performance.mark("start")
        performance.mark("end")
        performance.measure("my-measure", "start", "end")
        return performance.getEntriesByType("measure")
      })
      // `JSHandle.Serialized` says a class instance arrives as plain data, so each measure's fields are read as the
      // original's `objectContaining` reads them
      assert.lengthOf(measures, 1)
      const measure = measures[0]
      if (measure === undefined) return assert.fail("no measure")
      assert.strictEqual(measure.entryType, "measure")
      assert.strictEqual(measure.name, "my-measure")
      assert.isNumber(measure.duration)
      assert.isNumber(measure.startTime)
    }))

  test("EV-046", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => performance)
      // As EV-045: the instance's fields, as `JSHandle.Serialized<Performance>` says they arrive
      assert.isNumber(result.timeOrigin)
      assert.strictEqual(result.navigation.redirectCount, 0)
      assert.isNumber(result.navigation.type)
      for (const key of timingKeys) assert.isNumber(result.timing[key], `timing.${key}`)
    }))

  test("EV-047", ({ page }) =>
    Effect.gen(function*() {
      // A function doesn't cross by value; Playwright returns `undefined` in its place
      const reason = yield* reasonOf(page.evaluateInMainWorld(() => function() {}))
      assert.instanceOf(reason, Reason.NotSerializable)
      assert.strictEqual(reason.path, "result")
    }))

  test("EV-048", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(page.evaluateInMainWorld((depth) => {
        const obj: Record<number, unknown> = {}
        let temp: Record<number, unknown> = obj
        for (let i = 0; i < depth; i++) {
          temp[i] = {}
          temp = temp[i] as Record<number, unknown>
        }
        return obj
      }, 1000))
      // Playwright's message is its own serializer's; Strider's typed reason is the same failure
      assert.instanceOf(reason, Reason.NotSerializable)
    }))

  test("EV-049", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(page.evaluateInMainWorld((depth) => {
        let node: Record<string, unknown> = {}
        for (let i = 0; i < depth; i++) node = { child: node }
        return node
      }, 200))
      assert.instanceOf(reason, Reason.NotSerializable)
    }))

  test("EV-050", ({ page }) =>
    Effect.gen(function*() {
      // A function argument doesn't cross, and the error names its position
      const reason = yield* reasonOf(page.evaluateInMainWorld((arg) => arg, () => {}))
      assert.instanceOf(reason, Reason.NotSerializable)
      assert.strictEqual(reason.path, "args[0]")
    }))

  test("EV-051", ({ page }) =>
    Effect.gen(function*() {
      // A function inside an object is left out of what crosses, as Serialized leaves functions out. The call
      // succeeds with the rest of the object, where Playwright's rejects with the function's position.
      const result = yield* page.evaluateInMainWorld((arg) => arg, { aProperty: () => {} })
      assert.deepStrictEqual(result as unknown, {})
    }))

  test("EV-052", ({ page }) =>
    Effect.gen(function*() {
      // As EV-051, one object deeper: the function is left out, and the call succeeds
      const result = yield* page.evaluateInMainWorld((arg) => arg, { a: { inner: { property: () => {} } } })
      assert.deepStrictEqual(result as unknown, { a: { inner: {} } })
    }))

  test("EV-053", ({ page }) =>
    Effect.gen(function*() {
      // As EV-051, inside an array: the object keeps its place in the array, and the function is left out of it
      const result = yield* page.evaluateInMainWorld(
        (arg) => arg,
        { a: { inner: ["firstValue", { property: () => {} }] } }
      )
      assert.deepStrictEqual(result as unknown, { a: { inner: ["firstValue", {}] } })
    }))

  test("EV-054", ({ page }) =>
    Effect.gen(function*() {
      // Window and Document are not values that cross, where Playwright returns their names. The first one fails
      const reason = yield* reasonOf(page.evaluateInMainWorld(() => [window, document, document.body]))
      assert.instanceOf(reason, Reason.NotSerializable)
      assert.strictEqual(reason.path, "result[0]")
    }))

  test("EV-055", ({ page }) =>
    Effect.gen(function*() {
      // A cycle doesn't cross by value, where Playwright's keeps the cycle: the result fails, naming the reference
      const reason = yield* reasonOf(page.evaluateInMainWorld(() => {
        const a: Record<string, unknown> = {}
        a.b = a
        return a
      }))
      assert.instanceOf(reason, Reason.NotSerializable)
      assert.strictEqual(reason.path, "result.b")
    }))

  test("EV-056", ({ page }) =>
    Effect.gen(function*() {
      // A window doesn't read back as a JSON value. Its read's message is the text the original throws
      const windowHandle = yield* page.evaluateHandle(() => window)
      const readFailure = yield* failureOf(windowHandle.read, "reading the window")
      const errorText = readFailure.message
      const reason = yield* reasonOf(page.evaluateInMainWorld((text) => {
        throw new Error(text)
      }, errorText))
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, errorText)
    }))

  test("EV-060", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>42</section>")
      // A handle is an isolated-world value, so the element and its read run in that world, as `page.evaluate` does.
      // A handle argument arrives as its element, which the signature types as the handle, hence the cast.
      const element = yield* page.evaluateHandle(() => document.querySelector("section"))
      const text = yield* page.evaluate((e) => (e as unknown as Element | null)?.textContent, element)
      assert.strictEqual(text, "42")
    }))

  test("EV-061", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>39</section>")
      const element = yield* page.evaluateHandle(() => document.querySelector("section"))
      // Releasing a handle ends its value; using a released handle is a programming error, a defect, where
      // Playwright's disposed element rejects its evaluation with "no object with guid"
      yield* element.release
      const exit = yield* Effect.exit(page.evaluate((e) => (e as unknown as Element | null)?.textContent, element))
      if (!Exit.isFailure(exit)) assert.fail("the evaluation succeeded, where Playwright's rejects")
      assert.isTrue(Cause.hasDies(exit.cause))
    }))

  test("EV-062", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's evaluate runs with user activation, which `execCommand("copy")` needs
      const result = yield* page.evaluateInMainWorld(() => {
        document.body.appendChild(document.createTextNode("test"))
        document.execCommand("selectAll")
        return document.execCommand("copy")
      }).pipe(Page.withUserGesture)
      assert.isTrue(result)
    }))

  test("EV-063", ({ page }) =>
    Effect.gen(function*() {
      // The navigation is subscribed before the evaluation that reloads the page, as the original's waitForNavigation
      const navigated = yield* PageNavigation.next(page)
      const error = yield* failureOf(
        page.evaluateInMainWorld(() =>
          new Promise((f) =>
            setTimeout(() => {
              window.location.reload()
              setTimeout(() => f(42), 1000)
            }, 0)
          )
        ),
        "the evaluation"
      )
      assert.isTrue(Target.isTargetGone(error))
      yield* navigated
    }))

  test("EV-064", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const result = yield* page.evaluateInMainWorld(() => {
        window.location.href = "/empty.html"
        return [42]
      })
      assert.deepStrictEqual(result, [42])
    }))

  test("EV-065", ({ page }) =>
    Effect.gen(function*() {
      // The page is about:blank, where a synchronous reload is what the original tests
      const result = yield* page.evaluateInMainWorld(() => {
        window.location.reload()
        return { a: 42 }
      })
      assert.deepStrictEqual(result, { a: 42 })
    }))

  test("EV-066", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        window.location.reload()
        return undefined
      })
      assert.isUndefined(result)
    }))

  test("EV-067", ({ page }) =>
    Effect.gen(function*() {
      // The original's own note: this is slow over a wire, and the port's budget is the same as the original's
      const a = yield* page.evaluateInMainWorld(() => Array(100 * 1024 * 1024 + 1).join("a"))
      assert.strictEqual(a.length, 100 * 1024 * 1024)
    }))

  test("EV-068", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(page.evaluateInMainWorld(() =>
        new Promise(() => {
          throw new Error("Error in promise")
        })
      ))
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, "Error in promise")
    }))

  test("EV-069", ({ page }) =>
    Effect.gen(function*() {
      // The page replaces its own JSON; the evaluations that follow still work
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(JSON, "stringify", null)
        Reflect.set(window, "JSON", null)
      })
      assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => ({ abc: 123 })), { abc: 123 })
    }))

  test("EV-070", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `window.open` runs from script here, which Strider's popup blocking stops unless it is a user gesture
      const result = yield* page.evaluateInMainWorld(() => {
        const win = window.open("about:blank") as unknown as { Promise: PromiseConstructor }
        return new win.Promise<number>((f) => f(42))
      }).pipe(Page.withUserGesture)
      assert.strictEqual(result, 42)
    }))

  test("EV-071", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `setCSP` sets this header
      server.setExtraHeaders("/empty.html", { "Content-Security-Policy": "script-src " + server.PREFIX })
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => new Function("return true")()))
    }))

  test("EV-072", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        // @ts-expect-error: an undeclared name, which a sloppy-mode function may assign
        y = 3.14
        // @ts-expect-error
        return y
      })
      assert.strictEqual(result, 3.14)
    }))

  test("EV-073", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(page.evaluateInMainWorld(() => {
        "use strict"
        // @ts-expect-error
        variableY = 3.14
        // @ts-expect-error
        return variableY
      }))
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, "variableY")
    }))

  test("EV-074", ({ page }) =>
    Effect.gen(function*() {
      // The original reads `this` at the top level of the page's script, which is the page's window. Here the
      // function's global is the same window.
      assert.isTrue(yield* page.evaluateInMainWorld(() => globalThis === window))
    }))

  test("EV-076", ({ page, server }) =>
    Effect.gen(function*() {
      server.setExtraHeaders("/empty.html", { "Content-Security-Policy": "script-src 'self'" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 2 + 2), 4)
    }))

  test("EV-077", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* page.evaluateInMainWorld(() =>
        (function functionOnStack() {
          return new Error("error message")
        })()
      )
      // `JSHandle.Serialized<Error>` is its name, message, and stack as data
      assert.strictEqual(error.message, "error message")
      assert.include(error.stack, "functionOnStack")
    }))

  test("EV-078", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* page.evaluateInMainWorld(() => {
        function innerFunction() {
          const e = new Error("error message")
          e.name = "foobar"
          return e
        }
        return innerFunction()
      })
      // The class doesn't cross by value, where the original's `toBeInstanceOf(Error)` holds. The data does.
      assert.strictEqual(error.message, "error message")
      assert.strictEqual(error.name, "foobar")
      assert.include(error.stack, "innerFunction")
    }))

  test("EV-079", ({ page }) =>
    Effect.gen(function*() {
      function innerFunction() {
        const e = new Error("error message")
        e.name = "foobar"
        return e
      }
      const received = yield* page.evaluateInMainWorld(
        (e) => ({ message: e.message, name: e.name, stack: e.stack }),
        innerFunction()
      )
      // An argument copies its own enumerable keys (API.md, "Pages"), so only the name reaches the page
      assert.deepStrictEqual(received as unknown, { message: undefined, name: "foobar", stack: undefined })
    }))

  test("EV-080", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => ({ date: new Date("2020-05-27T01:31:38.506Z") }))
      assert.deepStrictEqual(result, { date: new Date("2020-05-27T01:31:38.506Z") })
    }))

  test("EV-081", ({ page }) =>
    Effect.gen(function*() {
      const date = new Date("2020-05-27T01:31:38.506Z")
      const result = yield* page.evaluateInMainWorld((date) => date, date)
      assert.strictEqual(result.toUTCString(), date.toUTCString())
    }))

  test("EV-082", ({ page }) =>
    Effect.gen(function*() {
      const regex = /hello/im
      const result = yield* page.evaluateInMainWorld((regex) => regex, regex)
      assert.strictEqual(result.toString(), regex.toString())
    }))

  test("EV-083", ({ page }) =>
    Effect.gen(function*() {
      const resultHandle = yield* page.evaluateHandle(() => ({ date: new Date("2020-05-27T01:31:38.506Z") }))
      assert.deepStrictEqual(yield* resultHandle.read, { date: new Date("2020-05-27T01:31:38.506Z") })
    }))

  test("EV-084", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => ({ url: new URL("https://example.com") }))
      // `JSHandle.Serialized<URL>` is its data fields
      assertUrl(result.url, new URL("https://example.com"))
    }))

  test("EV-085", ({ page }) =>
    Effect.gen(function*() {
      const url = new URL("https://example.com")
      const result = yield* page.evaluateInMainWorld((url) => url, url)
      // As EV-084: the argument copies the URL's own enumerable keys, and it has none
      assert.deepStrictEqual(result as unknown, {})
    }))

  test("EV-086", ({ page }) =>
    Effect.gen(function*() {
      const resultHandle = yield* page.evaluateHandle(() => ({ url: new URL("https://example.com") }))
      assertUrl((yield* resultHandle.read).url, new URL("https://example.com"))
    }))

  test("EV-087", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => ({ toJSON: () => "string", data: "data" }))
      // A function doesn't cross, so `toJSON` is left out: the value arrives as its data
      assert.deepStrictEqual(result, { data: "data" })
    }))

  test("EV-088", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        Reflect.set(Array.prototype, "toJSON", () => "busted")
        return [1, 2, 3]
      })
      assert.deepStrictEqual(result, [1, 2, 3])
    }))

  test("EV-089", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => [])
      assert.isFalse(yield* page.evaluateInMainWorld(() => "toJSON" in []))
    }))

  test("EV-090", ({ page }) =>
    Effect.gen(function*() {
      const resultHandle = yield* page.evaluateHandle(() => ({ toJSON: () => "string", data: "data" }))
      // A handle's value is read as the evaluation reads it: the function isn't left in, and the data is
      assert.deepStrictEqual(yield* resultHandle.read, { data: "data" })
    }))

  test("EV-091", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        class Foo {
          toJSON(): never {
            throw new Error("Bad")
          }
        }
        class Bar {
          get toJSON(): never {
            throw new Error("Also bad")
          }
        }
        return { foo: new Foo(), bar: new Bar() }
      })
      assert.deepStrictEqual(result, { foo: {}, bar: {} })
    }))

  test("EV-093", ({ page, server }) =>
    Effect.gen(function*() {
      // The page is at the frame's site, so the page can read the frame's document to see the evaluation start; the
      // original's page is about:blank, which can't
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      // Strider has no `Frame.evaluate`: a frame is entered through its element, so the pending evaluation is the
      // frame's root element's, which never settles. It marks the frame's document when it starts, so the detach
      // comes after the call is pending, as the original's does.
      const pending = yield* startWaiting(
        failureOf(
          page.frame(page.locator("#frame1")).locator(":root").evaluate((root) => {
            root.setAttribute("data-pending", "")
            return new Promise<void>(() => {})
          }),
          "the evaluation"
        )
      )
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          const frame = document.getElementById("frame1")
          return frame instanceof HTMLIFrameElement &&
            frame.contentDocument?.documentElement.hasAttribute("data-pending") === true
        }),
        equalTo(true)
      )
      // Playwright's `detachFrame`
      yield* page.evaluateInMainWorld(() => document.getElementById("frame1")?.remove())
      const error = yield* Fiber.join(pending.fiber)
      assert.isTrue(Target.isTargetGone(error))
    }))

  test("EV-094", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/test", (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" })
        response.end(`<script>
    Object.create = null;
    Object.defineProperty = null;
    Object.getOwnPropertyDescriptor = null;
    Object.getOwnPropertyNames = null;
    Object.getPrototypeOf = null;
    Object.prototype.hasOwnProperty = null;
    </script>`)
      })
      yield* page.goto(server.PREFIX + "/test", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 2), 3)
    }))

  test("EV-095", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/test", (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" })
        response.end(`<script>
      Array.prototype.map = null;
      Array.prototype.push = null;
    </script>`)
      })
      yield* page.goto(server.PREFIX + "/test", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 2), 3)
      const handle = yield* page.evaluateHandle(() => 1 + 2)
      assert.strictEqual(yield* handle.read, 3)
    }))

  test("EV-096", ({ page, server }) =>
    Effect.gen(function*() {
      const testCases: ReadonlyArray<() => unknown> = [
        // @ts-ignore: replaces the global with an object
        () => globalThis.Window = {},
        // @ts-ignore
        () => globalThis.Document = {},
        // @ts-ignore
        () => globalThis.Node = {},
        // @ts-ignore: the same, with null
        () => globalThis.Window = null,
        // @ts-ignore
        () => globalThis.Document = null,
        // @ts-ignore
        () => globalThis.Node = null
      ]
      // Playwright's `it.step` labels each case with its source; a case that fails here fails the test
      for (const testCase of testCases) {
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(testCase)
        assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 2), 3)
        assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => ["foo"]), ["foo"])
      }
    }))

  test("EV-097", ({ page, server }) =>
    Effect.gen(function*() {
      const testCases: ReadonlyArray<() => unknown> = [
        // @ts-ignore: replaces the global with a string
        () => globalThis.URL = "foo",
        // @ts-ignore
        () => globalThis.RegExp = "foo",
        // @ts-ignore
        () => globalThis.Date = "foo"
      ]
      // As EV-096: each case is a step of the test, and a failure names it by its own error
      for (const testCase of testCases) {
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(testCase)
        assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 2), 3)
        assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => ({ a: 2023 })), { a: 2023 })
      }
    }))

  test("EV-098", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        const r = (str: string, amount: number) => Array.from(Array(amount)).map(() => str).join("")
        return r("([a-f0-9]{2})", 3)
      })
      assert.strictEqual(result, "([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})")
    }))

  test("EV-099", ({ page }) =>
    Effect.gen(function*() {
      // The original skips Node before 24, where the test's transpiler lowers `using` to a module-scope helper that
      // the page can't see. Vitest's transpiler lowers it here too, whatever the Node version, so the function is
      // made from source text instead: its `toString()` has the `using` declaration as written, which is what the
      // original sends.
      const evaluated = new Function(
        `let disposed = false;
        {
          using r = { [Symbol.dispose]: () => { disposed = true; } };
          void r;
        }
        return disposed;`
      ) as () => boolean
      const disposed = yield* page.evaluateInMainWorld(evaluated)
      assert.isTrue(disposed)
    }))

  test("EV-100", ({ page }) =>
    Effect.gen(function*() {
      // `__proto__` sets the literal's prototype, as in the original; TypeScript types it as a key the value lacks
      const input = {
        __proto__: { polluted: true },
        safeKey: "safeValue"
      } as { safeKey: string }
      const result = yield* page.evaluateInMainWorld((arg) => arg, input)
      // A key named `__proto__` in the page's own object literal sets a prototype, which isn't a key that crosses
      assert.deepStrictEqual(result, { safeKey: "safeValue" })
    }))
})
