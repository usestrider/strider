/**
 * Puppeteer's `test/src/console.test.ts`: the console messages a page writes, their text, level, and location, and the
 * frame and page that wrote them.
 *
 * What the port changes:
 * - `waitEvent(page, "console")` is `ConsoleMessage.next(page)`, subscribed before the action that logs, as the
 *   original's `Promise.all` subscribes. `page.on('console')` collecting messages is `ConsoleMessage.stream` (`collect`), awaited
 *   for the count of messages the test expects, since Strider's arrive after `evaluate` returns.
 * - `message.type()` is `message.level`. Strider's level has five values (debug, log, info, warning, error), so `warn`
 *   is `warning`, and a `trace`, `dir`, `timeEnd`, `startGroup`, or `endGroup` message is `log`. The port compares the
 *   level with the name Puppeteer gives, so those tests fail where Strider reports the level as `log`: that failure is the
 *   finding, not a loosened check.
 * - `message.text()` is `message.text`, which Strider writes as the browser describes an object (`Window`, `Promise`), not
 *   Puppeteer's `[object Window]` or `[promise Promise]`; those assertions match the object's name, as the worker port does.
 * - `message.args()` and the handles it returns are Strider-less (`method-consolemessage-args`): the tests whose point is
 *   the arguments are not ported. Where a test checks text and type as well as the argument count, the port keeps the
 *   text and type and drops the count, as the worker port does.
 * - `message.location()` is `message.location`, an `Option` of a line and column: a network log entry has no line, so the
 *   port checks its URL alone.
 * - `message.stackTrace()` and a `scriptId` are not in Strider's `ConsoleMessage` (`method-consolemessage-location`), so
 *   the tests that check them are not ported.
 * - `message.frame()`, `message.page()`, and `message.worker()` are the message's `origin`. A `Page`
 *   origin names the page that wrote it, so the main-frame test compares it with the page's frame tree. A `Worker`
 *   origin is a worker's realm. The origin names the page, never an iframe's frame, so the iframe test, whose point is
 *   the frame, isn't ported; the ledger says why.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`.
 * - `Popup.next(page)` waits for the popup, and `window.open` runs as a user gesture, since Strider keeps popup blocking on
 *   (`Page.withUserGesture`).
 * - The original's `fetch` to `http://wat` needs a name that doesn't resolve. The file's launch maps `wat` to
 *   `~NOTFOUND`, so the lookup fails in Chromium without the network, where the original relies on the network failing
 *   to resolve it. The `domain1.test` to `domain3.test` hosts are the runner's, as the other Puppeteer ports use.
 * - The `console.trace`, `console.dir`, timing, and group tests check the level the call has: the point of each is the
 *   message's type, so they're ported and fail where Strider reports a coarser level. The timing and group tests wait for
 *   their messages (`collect`), which arrive after the evaluation returns. The `console.trace` and `console.dir` tests
 *   check Strider's level, and the port's `typeOf` names the level as a
 *   string, since the Puppeteer name isn't one of Strider's `Level`s.
 * - Puppeteer's `console.log` of `Promise.resolve(...)` shows `[promise Promise]`; Strider's text says `Promise`, so the
 *   port checks that the message is about a promise and doesn't wait for its value.
 * - The tests that need arguments or a stack trace aren't ported; the ledger says why each is.
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { startWaiting } from "../harness/playwright.ts"
import { runnerChromiumArgs } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/**
 * The level Puppeteer names the message by, read from Strider's level as a string: the names Strider doesn't have (`trace`,
 * `dir`, `timeEnd`, `startGroup`, `endGroup`) are compared as Puppeteer writes them, and so fail where Strider reports `log`.
 */
const typeOf = (message: ConsoleMessage.ConsoleMessage): string => message.level

/**
 * The original's `page.on("console", …)` listener, which collects the first `count` messages from now on. Strider's
 * messages reach the event log after the evaluation returns, so the original's "every message is reported before
 * `evaluate` finishes" doesn't hold, and the port waits for the `count` messages (10 s at most) before it reads them.
 */
const collect = Effect.fnUntraced(function*(page: Page.Page, count: number) {
  const messages = yield* ConsoleMessage.stream(page)
  return yield* startWaiting(
    messages.pipe(Stream.take(count), Stream.runCollect, Effect.timeout("10 seconds"))
  )
})

/** The launch arguments: the runner's host rules, plus `wat`, which fails to resolve without the network. */
const chromiumArgs: ReadonlyArray<string> = [
  `${runnerChromiumArgs[0]},MAP wat ~NOTFOUND`,
  ...runnerChromiumArgs.slice(1)
]

upstream(import.meta.filename, { launch: { chromium: { args: chromiumArgs } } }, (test) => {
  test("console should work for Error instances", ({ page }) =>
    Effect.gen(function*() {
      // The original also checks that the message has one argument, which a ConsoleMessage doesn't carry
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.log(new Error("test error"))
      })
      const message = yield* logged
      assert.strictEqual(message.text, "Error: test error")
      assert.strictEqual(typeOf(message), "log")
    }))

  test("console should return the first line of the error message in text()", ({ page }) =>
    Effect.gen(function*() {
      // The original also checks that the message has one argument, which a ConsoleMessage doesn't carry
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.log(new Error("test error\nsecond line"))
      })
      const message = yield* logged
      assert.strictEqual(message.text, "Error: test error")
      assert.strictEqual(typeOf(message), "log")
    }))

  test("console should include null and undefined in text()", ({ page }) =>
    Effect.gen(function*() {
      // The original also checks that the message has three arguments, which a ConsoleMessage doesn't carry
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.log("hello", null, undefined)
      })
      const message = yield* logged
      assert.strictEqual(message.text, "hello null undefined")
    }))

  test("console should work on script call right after navigation", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.goto(
        // Firefox prints warn if <!DOCTYPE html> is not present
        `data:text/html,<!DOCTYPE html><script>console.log('SOME_LOG_MESSAGE');</script>`
      )
      const message = yield* logged
      assert.strictEqual(message.text, "SOME_LOG_MESSAGE")
    }))

  test("console should work for console.trace", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.trace("calling console.trace")
      })
      const message = yield* logged
      // Strider reports `trace` as `log`, so this fails where the original's type is `trace`
      assert.strictEqual(typeOf(message), "trace")
      assert.strictEqual(message.text, "calling console.trace")
    }))

  test("console should work for console.dir", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.dir("calling console.dir")
      })
      const message = yield* logged
      // Strider reports `dir` as `log`, so this fails where the original's type is `dir`
      assert.strictEqual(typeOf(message), "dir")
      assert.strictEqual(message.text, "calling console.dir")
    }))

  test("console should work for console.warn", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.warn("calling console.warn")
      })
      const message = yield* logged
      // Puppeteer's `warn` is Strider's `warning`
      assert.strictEqual(message.level, "warning")
      assert.strictEqual(message.text, "calling console.warn")
    }))

  test("console should work for console.error", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.error("calling console.error")
      })
      const message = yield* logged
      assert.strictEqual(message.level, "error")
      assert.strictEqual(message.text, "calling console.error")
    }))

  test("console should work for console.log with promise", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.log(Promise.resolve("should not wait until resolved!"))
      })
      const message = yield* logged
      assert.strictEqual(typeOf(message), "log")
      // Puppeteer writes a promise as `[promise Promise]`; Strider writes it as the browser describes it, `Promise`. The
      // point is the same: the message is about the promise and doesn't wait for it to resolve
      assert.match(message.text, /promise/i)
      assert.notInclude(message.text, "should not wait until resolved!")
    }))

  test("console should work for different console API calls with timing functions", ({ page }) =>
    Effect.gen(function*() {
      const collected = yield* collect(page, 1)
      yield* page.evaluateInMainWorld(() => {
        // A pair of time/timeEnd generates only one Console API call
        console.time("calling console.time")
        console.timeEnd("calling console.time")
      })
      // The original reads the messages right after `evaluate`; Strider's arrive after it returns, so the port waits for one
      const messages = yield* Fiber.join(collected.fiber)
      // Strider reports `timeEnd` as `log`, so this fails where the original's type is `timeEnd`
      assert.deepStrictEqual(messages.map(typeOf), ["timeEnd"])
      assert.include(messages[0]!.text, "calling console.time")
      // The pair makes one call: the log holds no other message
      assert.strictEqual((yield* ConsoleMessage.history(page)).entries.length, 1)
    }))

  test("console should work for different console API calls with group functions", ({ page }) =>
    Effect.gen(function*() {
      const collected = yield* collect(page, 2)
      yield* page.evaluateInMainWorld(() => {
        console.group("calling console.group")
        console.groupEnd()
      })
      // The original reads the messages right after `evaluate`; Strider's arrive after it returns, so the port waits for two
      const messages = yield* Fiber.join(collected.fiber)
      // Strider reports `startGroup` and `endGroup` as `log`, so this fails where the original's types are those
      assert.deepStrictEqual(messages.map(typeOf), ["startGroup", "endGroup"])
      // The original says Chromium reports the text, so the port checks the first message's text
      assert.include(messages[0]!.text, "calling console.group")
    }))

  test("console should not fail for window object", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.error(window)
      })
      const message = yield* logged
      // Puppeteer writes `[object Window]`; Strider writes the object as the browser describes it
      assert.match(message.text, /Window/)
    }))

  test("console should have location when fetch fails", ({ page, server }) =>
    Effect.gen(function*() {
      // The point of this test is to make sure that we report console messages from Log domain
      yield* page.goto(server.EMPTY_PAGE)
      const logged = yield* ConsoleMessage.next(page)
      yield* page.setContent(`<script>fetch('http://wat');</script>`)
      const message = yield* logged
      assert.include(message.text, "ERR_NAME_NOT_RESOLVED")
      assert.strictEqual(typeOf(message), "error")
      // A network log entry has no line, which Strider's location requires, so the port checks the URL alone
      assert.strictEqual(String(Option.getOrUndefined(message.location)?.url), "http://wat/")
    }))

  test("console should trigger correct Log", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(`http://domain1.test:${server.PORT}/empty.html`)
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(async (url: string) => {
        await fetch(url).catch(() => {})
      }, `http://domain2.test:${server.PORT}/empty.html`)
      const message = yield* logged
      assert.include(message.text, "Access-Control-Allow-Origin")
      // Chromium reports the blocked request as an error; Firefox reports it as a warning, which Puppeteer calls `warn`
      const expected: ConsoleMessage.Level = browserName === "chromium" ? "error" : "warning"
      assert.strictEqual(message.level, expected)
    }))

  test("console should not throw when there are console messages in detached iframes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      // 1. Create a popup that isn't connected to Strider's test page. 2. In this popup, create an iframe that logs a
      // message. 3. After that, remove the iframe.
      yield* page.evaluateInMainWorld(async () => {
        const win = window.open(
          window.location.href,
          "Title",
          "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=780,height=200,top=0,left=0"
        )!
        await new Promise<void>((resolve) => {
          win.onload = () => resolve()
        })
        win.document.body.innerHTML = `<iframe src='/consolelog.html'></iframe>`
        const frame = win.document.querySelector("iframe")!
        await new Promise<void>((resolve) => {
          frame.onload = () => resolve()
        })
        frame.remove()
      }).pipe(Page.withUserGesture)
      // 4. The popup is the page reported last. 5. Connecting to it doesn't throw, and it's not the same page
      const popup = yield* opened
      assert.notStrictEqual((yield* popup.frames).id, (yield* page.frames).id)
    }))

  test("console should report the originating frame and page for main frame logs", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        console.log("hello from main frame")
      })
      const message = yield* logged
      // The message's origin is the page, named by its main frame, and no worker
      assert.strictEqual(message.origin._tag, "Page")
      assert.strictEqual((message.origin as { readonly page: unknown }).page, (yield* page.frames).id)
    }))
})
