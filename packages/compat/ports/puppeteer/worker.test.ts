/**
 * Puppeteer's `test/src/worker.test.ts`: the dedicated workers a page starts, their evaluation, their network requests,
 * console messages and errors, and the wait for a function in a worker.
 *
 * What the port changes:
 * - `page.workers()` is the `page.workers` watchable, read with `yield* page.workers`. Puppeteer's `workercreated` wait is
 *   `BrowserWorker.next(page)`, subscribed before the action that starts the worker, as the original's `waitEvent` is.
 * - Puppeteer's `waitEvent(page, "console", …)` is `ConsoleMessage.next`, and `pageerror` is `UncaughtException.next`.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. A `new Worker(…)` isn't serializable, so the
 *   evaluated functions end without returning it.
 * - `worker.evaluate` runs in the worker's global, as the original's does. Strider's `evaluate` takes a function, so the
 *   string form `'1+1'` is the function `() => 1 + 1`.
 * - Puppeteer's `waitForFunction` is `Expect.that` over a read in the worker (see `page-wait-for-function.test.ts`).
 *   Expect returns nothing, where the original's wait resolves with the value its predicate returned: the port keeps that
 *   value with `holding`, as the Playwright port does.
 * - A worker has no console subscription of its own. Its messages are the page's, with the worker's realm as their origin,
 *   so the port subscribes to the page and keeps the messages whose origin is the worker, as the Playwright port of
 *   `workers.spec.ts` does.
 * - `page.setRequestInterception(true)` with `request.continue()` is `page.route` handing every request to
 *   `Route.fallthrough`, which lets the browser send it.
 * - Puppeteer's `request.worker()` is the request's `Worker` initiator, compared with the worker's realm. A request from a
 *   worker has no frame, so `request.frame()` is `null` where the initiator is not a `Document`.
 * - A rejected evaluation is a `BrowserWorkerError` or a `Target.TargetGone`, which the port asserts, where the original's
 *   `rejects.toThrow()` accepts any error.
 * - `timeout: 50` on `waitForFunction` is `Deadline.within("50 millis")`. Strider's failure is an `ExpectationFailed`,
 *   not a message that says `Waiting failed`, and the port asserts that failure.
 * - "should emit created and destroyed events" keeps the destroyed event (`closed`) and the failed evaluation after it;
 *   the handle to the worker's `this` is Puppeteer's `evaluateHandle`, which Strider has no counterpart of.
 * - "should report each worker exception on the page exactly once" counts the page errors; Puppeteer's `exception`
 *   events, with their RemoteException, are Strider-less, so that count is dropped.
 * - "should retrieve body for main worker requests" reads the body through `NetworkResponse.next` with a body decoder;
 *   the `networkidle0` navigation, a wait for network quiet that Strider has no counterpart of, is dropped.
 * - The two Error-instance console tests check the text and level of the message; their count of the message's arguments
 *   is dropped, since a ConsoleMessage doesn't carry them.
 * - "should work for console.log with promise" asserts that the text names a promise and doesn't hold its value, not
 *   Puppeteer's `[promise Promise]`: Strider writes an object as the browser describes it, `Promise`.
 * - The `console.trace`, `console.dir`, timing, and group tests check the type Puppeteer names, which is the point of each,
 *   so they're ported and fail where Strider reports `log`. The timing and group tests wait for their messages (`collect`).
 * - The tests that need features Strider lacks aren't ported; the ledger says why each is.
 */
import { assert } from "@effect/vitest"
import {
  BrowserWorker,
  Condition,
  ConsoleMessage,
  Deadline,
  Expect,
  NetworkRequest,
  NetworkResponse,
  Page,
  Route,
  Target,
  UncaughtException
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { expectationFailure, failureOf, startWaiting } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** The predicate for the messages a worker wrote: they carry its realm as their origin. */
const fromWorker = (worker: BrowserWorker.ObservedBrowserWorker) => (message: ConsoleMessage.ConsoleMessage) =>
  Effect.succeed(message.origin._tag === "Worker" && message.origin.realm === worker.realm)

/**
 * The original's `worker.on("console", …)` listener, which collects the worker's first `count` messages from now on.
 * Strider's messages reach the event log after the evaluation returns, so the original's "every message is reported before
 * `evaluate` finishes" doesn't hold, and the port waits for the `count` messages (10 s at most) before it reads them.
 */
const collect = Effect.fnUntraced(
  function*(page: Page.Page, worker: BrowserWorker.ObservedBrowserWorker, count: number) {
    const messages = yield* ConsoleMessage.stream(page, undefined, fromWorker(worker))
    return yield* startWaiting(
      messages.pipe(Stream.take(count), Stream.runCollect, Effect.timeout("10 seconds"))
    )
  }
)

/** Starts a dedicated worker with `script` as its URL, and gives the worker. */
const startWorker = Effect.fnUntraced(function*(page: Page.Page, script: string) {
  const created = yield* BrowserWorker.next(page)
  yield* page.evaluateInMainWorld((script) => {
    void new Worker(script)
  }, script)
  return yield* created
})

/** A condition that also keeps the value it accepted. The original's wait resolves with that value, and Expect returns nothing. */
const holding = (description: string, predicate: (value: unknown) => boolean) => {
  const held: { value?: unknown } = {}
  const condition = Condition.make(description, (value: unknown) => {
    if (!predicate(value)) return false
    held.value = value
    return true
  })
  return { condition, held }
}

/** Puppeteer's `waitForFunction` predicate that is `true` once it holds, as a condition. */
const holds = Condition.make("to be true", (value: unknown) => value === true)

upstream(import.meta.filename, {}, (test) => {
  test("Workers Page.workers", ({ page, server }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      // The worker realm can exist before the worker script runs, so the wait is for the page's log of the worker's
      // `workerFunction`, as the original waits for its console message
      const logged = yield* ConsoleMessage.next(page, { text: "workerFunction" })
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      yield* created
      yield* logged
      const [worker] = yield* page.workers
      assert.isDefined(worker)
      assert.include(worker.url, "worker.js")

      assert.strictEqual(yield* worker.evaluate(() => (self as any).workerFunction()), "worker function result")

      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual((yield* page.workers).length, 0)
    }))

  test("Workers should report network requests", ({ page, server }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      // The fetch's Response isn't serializable, and the original doesn't read it either
      yield* worker.evaluate((url: string) => {
        void fetch(url)
      }, server.EMPTY_PAGE)
      const request = yield* requested

      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.strictEqual(request.initiator._tag, "Worker")
      assert.strictEqual((request.initiator as { realm: string }).realm, worker.realm)
      // A request from a worker names no frame: only a document's initiator does
      assert.notStrictEqual(request.initiator._tag, "Document")
    }))

  test("Workers should report network requests with request interception", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**", () => Route.fallthrough)
      const created = yield* BrowserWorker.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      const requested = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      // The fetch's Response isn't serializable, and the original doesn't read it either
      yield* worker.evaluate((url: string) => {
        void fetch(url)
      }, server.EMPTY_PAGE)
      const request = yield* requested

      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.strictEqual(request.initiator._tag, "Worker")
      assert.strictEqual((request.initiator as { realm: string }).realm, worker.realm)
      assert.notStrictEqual(request.initiator._tag, "Document")
    }))

  test("Workers should emit created and destroyed events", ({ page }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(globalThis as any).worker = new Worker("data:text/javascript,1")
      })
      const worker = yield* created
      // The original also holds a handle to the worker's `this` (`worker.evaluateHandle`), which Strider has no counterpart
      // of; the port keeps the destroyed event (`closed`, which is this worker's own) and the evaluation after it
      const ended = yield* startWaiting(worker.closed)
      yield* page.evaluateInMainWorld(() => {
        ;(globalThis as any).worker.terminate()
      })
      yield* Fiber.join(ended.fiber)

      // The original's `getProperty` on the destroyed realm rejects; an evaluation in the destroyed worker does here
      const failure = yield* failureOf(worker.evaluate(() => 1), "the evaluation")
      assert(
        BrowserWorker.isBrowserWorkerError(failure) || Target.isTargetGone(failure),
        `the evaluation failed for another reason: ${String(failure)}`
      )
    }))

  test("Workers should have an execution context", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,console.log(1)")
      assert.strictEqual(yield* worker.evaluate(() => 1 + 1), 2)
    }))

  test("Workers should report console logs", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker("data:text/javascript,console.log(1)")
      })
      const message = yield* logged

      assert.strictEqual(message.text, "1")
      // Strider's location has no scriptId, which Puppeteer adds for CDP only
      assert.deepStrictEqual(
        Option.map(message.location, (location) => ({
          url: String(location.url),
          lineNumber: location.line,
          columnNumber: location.column
        })),
        Option.some({ url: "", lineNumber: 0, columnNumber: 8 })
      )
    }))

  test("Workers should report errors", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker("data:text/javascript, throw new Error('this is my error');")
      })
      const errorLog = yield* thrown
      assert.include(errorLog.message, "this is my error")
    }))

  test("Workers should report each worker exception on the page exactly once", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      // The original also counts Puppeteer's `exception` events, which carry the RemoteException; Strider has no such event,
      // so the port counts the page errors (`UncaughtException`), the original's second count
      // The second exception is a barrier: a duplicate dispatch of the first one would arrive before it
      const barrier = yield* UncaughtException.next(page, { message: "second" })
      yield* worker.evaluate(() => {
        setTimeout(() => {
          throw new Error("first")
        })
        setTimeout(() => {
          throw new Error("second")
        })
      })
      yield* barrier
      const history = yield* UncaughtException.history(page)
      assert.strictEqual(history.entries.filter((exception) => exception.message.includes("first")).length, 1)
    }))

  test("Workers when the worker script does not load evaluate should reject if the script is not found", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const worker = yield* startWorker(page, "/does-not-exist.js")
      const failure = yield* failureOf(worker.evaluate(() => 1), "the evaluation")
      assert(
        BrowserWorker.isBrowserWorkerError(failure) || Target.isTargetGone(failure),
        `the evaluation failed for another reason: ${String(failure)}`
      )
    }))

  test(
    "Workers when the worker script does not load evaluate should reject if a static import of a module worker is not found",
    ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.goto(server.EMPTY_PAGE)
        const created = yield* BrowserWorker.next(page)
        // Puppeteer's `evaluate` waits for the worker's script to load, and fails if it doesn't. Strider reports the worker
        // when its realm exists and evaluates in it at once, so this evaluation can run before the import fails
        yield* page.evaluateInMainWorld(() => {
          void new Worker("/worker/worker-missing-import.js", { type: "module" })
        })
        const worker = yield* created
        const failure = yield* failureOf(worker.evaluate(() => (globalThis as any).loaded), "the evaluation")
        assert(
          BrowserWorker.isBrowserWorkerError(failure) || Target.isTargetGone(failure),
          `the evaluation failed for another reason: ${String(failure)}`
        )
      })
  )

  test("Workers should retrieve body for main worker requests", ({ page, server }) =>
    Effect.gen(function*() {
      const workerUrl = server.PREFIX + "/worker/worker.js"
      // The original reads the body from the response it collects in a `response` listener. Its `networkidle0` navigation is
      // a wait for the page to settle, which Strider has no counterpart of (the wait for the worker's creation is kept)
      const response = yield* NetworkResponse.next(page, { url: workerUrl, body: (message) => message.text })
      const created = yield* BrowserWorker.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      yield* created
      assert.include((yield* response).body, "hello from the worker")
    }))

  test("Workers console should work for Error instances", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.log(new Error("test error"))
      })
      const message = yield* logged
      // The original also checks that the message has one argument, which a ConsoleMessage doesn't carry
      assert.include(message.text, "Error: test error")
      assert.strictEqual(message.level, "log")
    }))

  test("Workers console should return the first line of the error message in text()", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.log(new Error("test error\nsecond line"))
      })
      const message = yield* logged
      // The original also checks that the message has one argument, which a ConsoleMessage doesn't carry
      assert.include(message.text, "Error: test error")
      assert.strictEqual(message.level, "log")
    }))

  test("Workers console should work for console.trace", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.trace("calling console.trace")
      })
      const message = yield* logged
      // Strider reports `trace` as `log`, so this fails where the original's type is `trace`
      assert.strictEqual(message.level as string, "trace")
      assert.strictEqual(message.text, "calling console.trace")
    }))

  test("Workers console should work for console.dir", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.dir("calling console.dir")
      })
      const message = yield* logged
      // Strider reports `dir` as `log`, so this fails where the original's type is `dir`
      assert.strictEqual(message.level as string, "dir")
      assert.strictEqual(message.text, "calling console.dir")
    }))

  test("Workers console should work for console.warn", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.warn("calling console.warn")
      })
      const message = yield* logged
      // Strider's level for a warning is `warning`, where Puppeteer's type is `warn`
      assert.strictEqual(message.level, "warning")
      assert.strictEqual(message.text, "calling console.warn")
    }))

  test("Workers console should work for console.error", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.error("calling console.error")
      })
      const message = yield* logged
      assert.strictEqual(message.level, "error")
      assert.strictEqual(message.text, "calling console.error")
    }))

  test("Workers console should work for console.log with promise", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const logged = yield* ConsoleMessage.next(page, undefined, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.log(Promise.resolve("should not wait until resolved!"))
      })
      const message = yield* logged
      assert.strictEqual(message.level, "log")
      // Puppeteer writes a promise as `[promise Promise]` (or `JSHandle@promise` on BiDi); Strider writes it as the browser
      // describes it, `Promise`. The point is the same: the message is about the promise and doesn't wait for it to resolve
      assert.match(message.text, /promise/i)
      assert.notInclude(message.text, "should not wait until resolved!")
    }))

  test("Workers console should work for different console API calls with timing functions", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const collected = yield* collect(page, worker, 1)
      yield* worker.evaluate(() => {
        // A pair of time/timeEnd generates only one Console API call
        console.time("calling console.time")
        console.timeEnd("calling console.time")
      })
      // The original reads the messages right after `evaluate`; Strider's arrive after it returns, so the port waits for one
      const messages = yield* Fiber.join(collected.fiber)
      // Strider reports `timeEnd` as `log`, so this fails where the original's type is `timeEnd`
      assert.deepStrictEqual(messages.map((message) => message.level as string), ["timeEnd"])
      assert.include(messages[0]!.text, "calling console.time")
    }))

  test("Workers console should work for different console API calls with group functions", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      const collected = yield* collect(page, worker, 2)
      yield* worker.evaluate(() => {
        console.group("calling console.group")
        console.groupEnd()
      })
      // The original reads the messages right after `evaluate`; Strider's arrive after it returns, so the port waits for two
      const messages = yield* Fiber.join(collected.fiber)
      // Strider reports `startGroup` and `endGroup` as `log`, so this fails where the original's types are those
      assert.deepStrictEqual(messages.map((message) => message.level as string), ["startGroup", "endGroup"])
      // The original says Chromium reports the text, so the port checks the first message's text
      assert.include(messages[0]!.text, "calling console.group")
    }))

  test("Workers waitForFunction should wait for a condition", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(
        page,
        `data:text/javascript,
          setTimeout(() => {
            self.foo = true;
          }, 500);
        `
      )
      yield* Expect.that(worker.evaluate(() => (self as any).foo === true), holds)
    }))

  test("Workers waitForFunction should timeout if condition is not met", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(page, "data:text/javascript,1")
      // The original's `timeout: 50` rejects with `Waiting failed`; Strider's wait fails with an ExpectationFailed
      const failure = yield* expectationFailure(
        Expect.that(worker.evaluate(() => false), holds).pipe(Deadline.within("50 millis"))
      )
      assert.strictEqual(failure.condition, "to be true")
    }))

  test("Workers waitForFunction should return a JSHandle to a string and parse it", ({ page }) =>
    Effect.gen(function*() {
      const worker = yield* startWorker(
        page,
        `data:text/javascript,
          setTimeout(() => {
            self.status = 'ready';
          }, 500);
        `
      )
      // The original's handle reads the value the wait resolved with. The port reads the value the wait held for.
      const { condition, held } = holding("truthy", (value) => Boolean(value))
      yield* Expect.that(
        worker.evaluate(() => {
          return (self as any).status === "ready" ? "Operation Success" : false
        }),
        condition
      )
      assert.strictEqual(held.value, "Operation Success")
    }))
})
