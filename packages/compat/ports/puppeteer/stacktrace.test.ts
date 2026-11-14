/**
 * Puppeteer's `test/src/stacktrace.test.ts`: the stack an exception thrown by page code carries, and an unhandled
 * rejection with a value that isn't an `Error`.
 *
 * What the port changes:
 * - A thrown exception is `Page.PageError` with `Reason.EvaluationThrown`, whose `exception` carries the name, the
 *   message, and the stack (`Option`). The port reads those as the original reads `error.name`, `error.message`, and
 *   `error.stack`.
 * - Puppeteer's stacks name its own evaluation wrapper (`evaluate (evaluate at Context.<anonymous> …)`), which Strider
 *   doesn't run, so the frames the original checks after the header are the page's own functions, which is what the
 *   test is about. The port checks the header, and the names of the page's functions in the order they were called.
 * - Puppeteer's `page.evaluate` runs in the main world, so the thrower is `page.evaluateInMainWorld`. The handle tests
 *   use `page.evaluateHandle`, which runs in the isolated world; stock WebKit has none, so those two are `needsFeature`
 *   there in the ledger.
 * - The original's `parseStackTrace` rewrites this file's URL and line numbers. Strider's stacks name the evaluated
 *   code as `<anonymous>`, which the port doesn't rewrite: it checks the function names only.
 * - "should work for none error objects" is `UncaughtException.next`: an unhandled rejection with a value that isn't
 *   an `Error` is an uncaught exception Strider reports with its kind, as Puppeteer's `pageerror` event reports it.
 */
import { assert } from "@effect/vitest"
import { JSHandle, Page, Reason, UncaughtException } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/**
 * The exception a failed evaluation carries, as Puppeteer's rejected `error`. A page's evaluation fails with
 * `PageError`; a handle's `evaluate` fails with `JSHandleError`, whose reason is the same `EvaluationThrown`.
 */
const exceptionOf = Effect.fnUntraced(function*<A, R>(effect: Effect.Effect<A, unknown, R>) {
  const error = yield* failureOf(effect, "the evaluation")
  assert(
    error instanceof Page.PageError || error instanceof JSHandle.JSHandleError,
    "the evaluation failed with neither PageError nor JSHandleError"
  )
  assert.instanceOf(error.reason, Reason.EvaluationThrown)
  return error.reason.exception
})

/** The stack's lines after the header, each the function name and location of one frame. */
const framesOf = (stack: Option.Option<string>) => {
  assert.isTrue(Option.isSome(stack), "the exception carries no stack")
  const [header, ...frames] = Option.getOrThrow(stack).split("\n    at ")
  return { header, frames }
}

/** A frame's function name: `a (<anonymous>:3:9)` names `a`, and a frame without a name is its location. */
const nameOf = (frame: string) => frame.replace(/ \(.*$/, "")

upstream(import.meta.filename, {}, (test) => {
  test("Stack trace should work", ({ page }) =>
    Effect.gen(function*() {
      const exception = yield* exceptionOf(page.evaluateInMainWorld(() => {
        throw new Error("Test")
      }))
      assert.strictEqual(exception.name, "Error")
      assert.strictEqual(exception.message, "Test")
      const { header, frames } = framesOf(exception.stack)
      assert.strictEqual(header, "Error: Test")
      // Puppeteer's second line is its evaluation wrapper, which Strider doesn't run: the thrower's own frame is there
      assert.isAbove(frames.length, 0)
    }))

  test("Stack trace should work with handles", ({ page }) =>
    Effect.gen(function*() {
      const exception = yield* exceptionOf(page.evaluateHandle(() => {
        throw new Error("Test")
      }))
      assert.strictEqual(exception.name, "Error")
      assert.strictEqual(exception.message, "Test")
      assert.strictEqual(framesOf(exception.stack).header, "Error: Test")
    }))

  test("Stack trace should work with contiguous evaluation", ({ page }) =>
    Effect.gen(function*() {
      const thrower = yield* page.evaluateHandle(() => {
        return () => {
          throw new Error("Test")
        }
      })
      const exception = yield* exceptionOf(thrower.evaluate((thrower) => {
        thrower()
      }))
      assert.strictEqual(exception.name, "Error")
      assert.strictEqual(exception.message, "Test")
      // The thrower's frame and the evaluated function's frame both follow the header
      const { header, frames } = framesOf(exception.stack)
      assert.strictEqual(header, "Error: Test")
      assert.isAtLeast(frames.length, 2)
    }))

  test("Stack trace should work with nested function calls", ({ page }) =>
    Effect.gen(function*() {
      const exception = yield* exceptionOf(page.evaluateInMainWorld(() => {
        function a() {
          throw new Error("Test")
        }
        function b() {
          a()
        }
        function c() {
          b()
        }
        function d() {
          c()
        }
        d()
      }))
      assert.strictEqual(exception.name, "Error")
      assert.strictEqual(exception.message, "Test")
      const { header, frames } = framesOf(exception.stack)
      assert.strictEqual(header, "Error: Test")
      assert.deepStrictEqual(frames.slice(0, 4).map(nameOf), ["a", "b", "c", "d"])
    }))

  test("Stack trace should work for none error objects", ({ page }) =>
    Effect.gen(function*() {
      const uncaught = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        // This can happen when a 404 with HTML is returned
        void Promise.reject(new Response())
      })
      const error = yield* uncaught
      assert.isDefined(error)
    }))
})
