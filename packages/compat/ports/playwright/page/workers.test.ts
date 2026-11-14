/**
 * Playwright's `tests/page/workers.spec.ts`: the workers a page starts (dedicated workers), their scripts, evaluation,
 * console messages and network activity.
 *
 * What the port changes:
 * - `page.workers()` is the `page.workers` watchable, read with `yield* page.workers`. Playwright's `waitForEvent("worker")`
 *   is `BrowserWorker.next(page)`, subscribed before the action that starts the worker, as the original does.
 * - `worker.evaluate(fn)` runs in the worker's global, as in the original. Strider's `evaluate` takes a function, so the
 *   string form WO-008 uses, `'1+1'`, is the function `() => 1 + 1`.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. A `new Worker(…)` isn't serializable, so
 *   the evaluated functions end without returning it, where the original's returns the Worker and discards it.
 * - Playwright's `worker.once("close")` is `worker.closed`, which Strider gives the reason the worker ended. Each wait
 *   is started before the action with `startWaiting`, which the original's promise is, and a close that has happened by
 *   the time the navigation completes is read from `done`, as the original checks `destroyed`.
 * - A rejected evaluation (WO-003) is Strider's `Target.TargetGone`, which the port asserts, where the original checks
 *   Playwright's message.
 * - Console messages are `ConsoleMessage.next` and `ConsoleMessage.history`. A message's text is what the port checks;
 *   the original's `page.on("console")` listener collects every message from the page's start, which `history` reads.
 * - `page.on("pageerror")` is `UncaughtException.next`.
 * - Network: `page.waitForRequest` and `waitForResponse` are `NetworkRequest.next` and `NetworkResponse.next`, subscribed
 *   before the action. A response's body is read by a decoder given to `NetworkResponse.next`, which also gives the
 *   response once it has finished. The original's `requestfinished` event is that moment: the port waits for a response
 *   whose body has been read. Each request and its response are the same network hop, compared by `hop`, where the
 *   original compares `response.request()` with the request.
 * - `response.ok()` is the status between 200 and 299. `request.allHeaders()` is `NetworkRequest.headersSent`, and
 *   `response.allHeaders()` is the response's headers.
 * - `request.redirectedTo()` is `NetworkRequest.redirects(page)` and its `to(request)`.
 * - `page.setExtraHTTPHeaders` is `page.emulate({ extraHTTPHeaders })`. `context.setOffline(true)` and `setOffline(false)`
 *   are `page.context.emulate({ network: "offline" })` in a scope, since emulation lasts for the caller's scope.
 * - `expect.poll` is `Expect.that` over the read, with a `Condition`. `expect.soft` is `assert`: Strider's assertions
 *   don't continue past a failure, so the first one stops the test.
 * - A worker's fetch that resolves to a `Response` isn't serializable, so WO-021 and WO-022 read nothing from it; the
 *   original doesn't assert on the value of the fetch either.
 * - WO-018 is `it.fixme` on Chromium, and the other fixmes and skips are the original's on the browsers it does not run
 *   on, so the port runs them as written; a failure is a finding for the run.
 * - A worker has no console subscription of its own (WO-009, WO-010): its messages are the page's and the context's, with
 *   the worker's realm as their `origin`, so the port subscribes there and keeps the messages whose origin is the worker.
 * - A header the original checks is truthy (`expect(headers['host']).toBeTruthy()`) is present and not empty.
 * - WO-002, WO-005, WO-007, and WO-014 aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import {
  BrowserWorker,
  Condition,
  ConsoleMessage,
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
import { HttpServerResponse } from "effect/http"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as fs from "node:fs"
import { assetPath, attachFrame, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The text of every console message the page has reported so far, in order. */
const consoleTexts = (page: Page.ObservedPage) =>
  ConsoleMessage.history(page).pipe(Effect.map((history) => history.entries.map((message) => message.text)))

/** Whether a header is there and not empty: the original's `expect(headers[name]).toBeTruthy()`. */
const hasValue = (header: Option.Option<string>) => Option.exists(header, (value) => value !== "")

/** How many dedicated workers the page has reported so far. */
const workerCount = (page: Page.ObservedPage) =>
  BrowserWorker.history(page).pipe(Effect.map((history) => history.entries.length))

/** The predicate for the messages a worker wrote: they carry its realm as their origin. */
const fromWorker = (worker: BrowserWorker.ObservedBrowserWorker) => (message: ConsoleMessage.ConsoleMessage) =>
  Effect.succeed(message.origin._tag === "Worker" && message.origin.realm === worker.realm)

upstream(import.meta.filename, {}, (test) => {
  test("WO-001", ({ page, server }) =>
    Effect.gen(function*() {
      const started = yield* BrowserWorker.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      yield* started
      const [worker] = yield* page.workers
      assert.isDefined(worker)
      assert.include(worker.url, "worker.js")

      assert.strictEqual(yield* worker.evaluate(() => (self as any).workerFunction()), "worker function result")

      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual((yield* page.workers).length, 0)
    }))

  test("WO-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(new Blob(["1"], { type: "application/javascript" })))
      })
      const worker = yield* created
      const closed = yield* startWaiting(worker.closed)
      const evaluating = yield* startWaiting(Effect.result(worker.evaluate(() => new Promise(() => {}))))
      yield* page.close()
      const failed = yield* Fiber.join(evaluating.fiber)
      assert(Result.isFailure(failed), "the evaluation completed, where Playwright's rejects when the page closes")
      assert(
        Target.isTargetGone(failed.failure),
        `the evaluation failed for another reason: ${String(failed.failure)}`
      )
      const reason = yield* Fiber.join(closed.fiber)
      assert.isString(reason._tag)
    }))

  test("WO-004", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(new Blob(["console.log(1)"], { type: "application/javascript" })))
      })
      assert.strictEqual((yield* logged).text, "1")
      // Firefox's juggler reported worker blob URLs as frame URLs; the page's URL stays its own
      assert.notInclude(yield* page.url, "blob")
    }))

  test("WO-006", ({ page }) =>
    Effect.gen(function*() {
      const first = yield* ConsoleMessage.next(page, { text: "1" })
      const second = yield* ConsoleMessage.next(page, { text: "2" })
      yield* page.evaluateInMainWorld(() => {
        void new Worker(
          URL.createObjectURL(new Blob(["console.log(1); console.log(2);"], { type: "application/javascript" }))
        )
      })
      yield* first
      yield* second
      // Every message the page reported, once: the original's listener collected the same list
      assert.deepStrictEqual(yield* consoleTexts(page), ["1", "2"])
      assert.notInclude(yield* page.url, "blob")
    }))

  test("WO-008", ({ page }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(new Blob(["console.log(1)"], { type: "application/javascript" })))
      })
      const worker = yield* created
      // The original's `worker.evaluate('1+1')`, a string, is a function in Strider
      assert.strictEqual(yield* worker.evaluate(() => 1 + 1), 2)
    }))

  test("WO-009", ({ page }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).worker = new Worker(URL.createObjectURL(new Blob(["42"], { type: "application/javascript" })))
      })
      const worker = yield* created
      // A worker has no console subscription of its own: its messages are the page's with the worker as their origin
      const onWorker = yield* ConsoleMessage.next(page, { text: "hello from worker" }, fromWorker(worker))
      const onPage = yield* ConsoleMessage.next(page)
      const onContext = yield* ConsoleMessage.next(page.context)
      yield* worker.evaluate(() => {
        console.log("hello from worker")
      })
      const message1 = yield* onWorker
      assert.strictEqual(message1.text, "hello from worker")
      // The original compares the message with `toBe`: one message, reported to the worker, its page, and its context
      assert.deepStrictEqual(message1, yield* onPage)
      assert.deepStrictEqual(message1, yield* onContext)
    }))

  test("WO-010", ({ page }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).worker = new Worker(URL.createObjectURL(new Blob(["42"], { type: "application/javascript" })))
      })
      const worker = yield* created
      // The page is the only place a worker's messages are reported to, so the page's subscription stands for the
      // worker's: the original's point, that the worker's own event doesn't need a page or context listener, is Playwright's
      const logged = yield* ConsoleMessage.next(page, { text: "hello from worker" }, fromWorker(worker))
      yield* worker.evaluate(() => {
        console.log("hello from worker")
      })
      assert.strictEqual((yield* logged).text, "hello from worker")
    }))

  test("WO-011", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(
          new Blob([
            `
    setTimeout(() => {
      // Do a console.log just to check that we do not confuse it with an error.
      console.log('hey');
      throw new Error('this is my error');
    })
  `
          ], { type: "application/javascript" })
        ))
      })
      const errorLog = yield* thrown
      assert.include(errorLog.message, "this is my error")
    }))

  test("WO-012", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(new Blob(["console.log(1)"], { type: "application/javascript" })))
      })
      const worker = yield* created
      assert.strictEqual((yield* page.workers).length, 1)
      const closed = yield* startWaiting(worker.closed)
      yield* page.goto(server.PREFIX + "/one-style.html")
      assert.isTrue(yield* closed.done)
      assert.strictEqual((yield* page.workers).length, 0)
    }))

  test("WO-013", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(new Blob(["console.log(1)"], { type: "application/javascript" })))
      })
      const worker = yield* created
      assert.strictEqual((yield* page.workers).length, 1)
      const closed = yield* startWaiting(worker.closed)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html")
      assert.isTrue(yield* closed.done)
      assert.strictEqual((yield* page.workers).length, 0)
    }))

  test("WO-015", ({ server, page }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      const url = server.PREFIX + "/one-style.css"
      const requested = yield* NetworkRequest.next(page, { url })
      const responded = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* worker.evaluate((url) => fetch(url).then((response) => response.text()).then(console.log), url)
      const request = yield* requested
      const response = yield* responded
      assert.strictEqual(request.url, url)
      // `response.request()` is the request: the same network hop
      assert.strictEqual(response.hop, request.hop)
      assert.isTrue(response.status >= 200 && response.status <= 299)
      assert.strictEqual(response.body, fs.readFileSync(assetPath("playwright", "one-style.css"), "utf8"))
    }))

  test("WO-016", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const url = server.PREFIX + "/one-style.css"
      const requested = yield* NetworkRequest.next(page, { url })
      const responded = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* page.evaluateInMainWorld((url) => {
        void new Worker(URL.createObjectURL(
          new Blob([`
    fetch("${url}").then(response => response.text()).then(console.log);
  `], { type: "application/javascript" })
        ))
      }, url)
      const request = yield* requested
      const response = yield* responded
      assert.strictEqual(request.url, url)
      assert.strictEqual(response.hop, request.hop)
      assert.isTrue(response.status >= 200 && response.status <= 299)
    }))

  test("WO-017", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const url = server.PREFIX + "/worker/worker.js"
      const requested = yield* NetworkRequest.next(page, { url })
      const finished = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).w = new Worker("/worker/worker.js")
      })
      const request = yield* requested
      const response = yield* finished
      assert.strictEqual(request.url, url)
      assert.strictEqual(response.hop, request.hop)
      assert.include(response.body, "console.log('hello from the worker');")
    }))

  test("WO-018", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      server.setRedirect("/worker.js", "/worker2.js")
      server.setRoute("/worker2.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript")
        res.end(`console.log('hello from the worker');`)
      })
      const redirects = yield* NetworkRequest.redirects(page)
      const requested = yield* NetworkRequest.next(page, { url: server.PREFIX + "/worker.js" })
      const redirected = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/worker2.js",
        body: (message) => message.text
      })
      const logged = yield* ConsoleMessage.next(page, { text: "hello from the worker" })
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).w = new Worker("/worker.js")
      })
      const request = yield* requested
      yield* logged
      assert.strictEqual(request.url, server.PREFIX + "/worker.js")
      const redirect = yield* redirects.to(request)
      assert(Option.isSome(redirect), "the worker script's request has no redirect")
      assert.strictEqual(redirect.value.url, server.PREFIX + "/worker2.js")
      const response = yield* redirected
      assert.strictEqual(response.hop, redirect.value.hop)
      assert.include(response.body, "console.log('hello from the worker');")
    }))

  test("WO-019", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const created = yield* BrowserWorker.next(page)
      yield* page.evaluateInMainWorld(() => {
        void new Worker(URL.createObjectURL(new Blob(["const x = 1;"], { type: "application/javascript" })))
      })
      yield* created
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.log("foo")
      })
      assert.strictEqual((yield* logged).text, "foo")
    }))

  test("WO-020", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.route("**/simple.json", () => Route.fulfill(HttpServerResponse.jsonUnsafe({ foo: "not bar" })))
      yield* page.goto(server.EMPTY_PAGE)
      const url = server.PREFIX + "/simple.json"
      const expected = ["{\"foo\":\"not bar\"}", "{\"foo\":\"not bar\"}"]
      yield* page.evaluateInMainWorld((url) => {
        void new Worker(URL.createObjectURL(
          new Blob([`
    fetch("${url}").then(response => response.text()).then(t => console.log(t.trim()));
  `], { type: "application/javascript" })
        ))
      }, url)
      yield* Expect.that(
        workerCount(page),
        Condition.make("one worker", (count: number) =>
          count === 1)
      )

      const [first] = (yield* BrowserWorker.history(page)).entries
      assert.isDefined(first)
      yield* first.evaluate((url) => {
        void new Worker(URL.createObjectURL(
          new Blob([`
    fetch("${url}").then(response => response.text()).then(t => console.log(t.trim()));
  `], {
            type: "application/javascript"
          })
        ))
      }, url)
      yield* Expect.that(workerCount(page), Condition.make("two workers", (count: number) => count === 2))

      yield* Expect.that(
        consoleTexts(page),
        Condition.make(
          `the messages ${JSON.stringify(expected)}`,
          (texts: ReadonlyArray<string>) => JSON.stringify(texts) === JSON.stringify(expected)
        )
      )
    }))

  test("WO-021", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const created = yield* BrowserWorker.next(page)
      const workerScript = yield* server.waitForRequest("/worker/worker.js")
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      const workerScriptRequest = yield* workerScript
      const stylesheet = yield* server.waitForRequest("/one-style.css")
      yield* worker.evaluate(async (url) => {
        await fetch(url)
      }, server.PREFIX + "/one-style.css")
      const stylesheetRequest = yield* stylesheet
      assert.strictEqual(workerScriptRequest.headers["foo"], "bar")
      assert.strictEqual(stylesheetRequest.headers["foo"], "bar")
    }))

  test("WO-022", ({ server, page }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page)
      const logged = yield* ConsoleMessage.next(page, { text: "hello from the worker" })
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      yield* logged
      yield* Effect.scoped(Effect.gen(function*() {
        // `setOffline(true)`: emulation lasts for the scope it's declared in
        yield* page.context.emulate({ network: "offline" })
        yield* Expect.that(
          worker.evaluate(() => navigator.onLine),
          Condition.make("offline", (online: boolean) => online === false)
        )
        assert.strictEqual(
          yield* worker.evaluate(() => fetch("/one-style.css").then(() => "fetched", () => "error")),
          "error"
        )
      }))
      // `setOffline(false)`: the scope closed, and the worker is online again
      yield* Expect.that(
        worker.evaluate(() => navigator.onLine),
        Condition.make("online", (online: boolean) => online === true)
      )
    }))

  test("WO-023", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const url = server.PREFIX + "/worker/worker.js"
      const requested = yield* NetworkRequest.next(page, { url })
      const finished = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* page.goto(server.PREFIX + "/worker/worker.html")
      const request = yield* requested
      const response = yield* finished
      assert.isTrue(
        hasValue(Headers.get(yield* NetworkRequest.headersSent(page, request), "host")),
        "the worker script's request has no host header"
      )
      assert.isTrue(hasValue(Headers.get(response.headers, "content-type")), "the response has no content-type header")
    }))

  test("WO-024", ({ server, page }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const url = server.PREFIX + "/worker/worker.js"
      const requested = yield* NetworkRequest.next(page, { url })
      const finished = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* attachFrame(page, "frame1", server.PREFIX + "/worker/worker.html")
      const request = yield* requested
      const response = yield* finished
      assert.isTrue(
        hasValue(Headers.get(yield* NetworkRequest.headersSent(page, request), "host")),
        "the worker script's request has no host header"
      )
      assert.isTrue(hasValue(Headers.get(response.headers, "content-type")), "the response has no content-type header")
    }))

  test("WO-025", ({ server, page }) =>
    Effect.gen(function*() {
      const url = server.PREFIX + "/worker/worker.js"
      const created = yield* BrowserWorker.next(page)
      const firstFinished = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* attachFrame(page, "frame1", server.PREFIX + "/worker/worker.html")
      const worker = yield* created
      yield* firstFinished
      const nestedFinished = yield* NetworkResponse.next(page, { url, body: (message) => message.text })
      yield* worker.evaluate((url) => {
        ;(self as any).w = new Worker(url)
      }, url)
      const response = yield* nestedFinished
      assert.isTrue(hasValue(Headers.get(response.headers, "content-type")), "the response has no content-type header")
    }))
})
