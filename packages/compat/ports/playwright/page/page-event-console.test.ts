/**
 * Playwright's `tests/page/page-event-console.spec.ts`: the console messages a page writes, what each one says and where
 * it was written, and how a page's history of them is read.
 *
 * What the port changes:
 * - Playwright's `page.on("console")` and `page.waitForEvent("console")` are `ConsoleMessage.next` and `ConsoleMessage.stream`,
 *   subscribed before the action that writes the message. The messages the page has reported are `ConsoleMessage.history`,
 *   read right after the action, as the original reads the list its listener collected, which holds every message before
 *   `page.evaluate` returns (CM-004's comment says the original relies on it). Strider's history never waits, so a test that
 *   reads it straight after an evaluation (CM-002, CM-017) fails where a message is still on its way.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`.
 * - A message is Strider's `ConsoleMessage`, with `text`, `level`, and `location` (an `Option`, with 1-based `line` and
 *   `column`, as stack traces count them). Its `level` is one of five: `debug`, `log`, `info`, `warning`, and `error`.
 * - Strider's `ConsoleMessage` has no `timestamp()`: its `at` is when Strider received the message, not the browser's time of
 *   it, so no timestamp test is ported (CM-014, CM-015, CM-016; see the ledger).
 * - CM-017's `m.page()` is the message's `origin`, which names its page.
 * - Playwright's `util.inspect` of a message gives its text: Strider's message is a data value, so there's nothing to inspect.
 * - WebKit's and Chromium's messages come from the browser's console formatter. The original's Firefox branch is its
 *   juggler's; Strider drives Firefox over WebDriver BiDi, so the port asserts the BiDi branch wherever the original tests
 *   `browserName !== "firefox" || isBidi`.
 * - The original's `line: 7` for `consolelog.html` is the 0-based line of its `console.log`, which is line 8 of the file;
 *   the port asserts Strider's 1-based line, 8.
 * - CM-008's platform skip (WebKit on Windows) doesn't apply
 *   to the Linux runs, so the port runs the test on every browser it runs on.
 * - CM-010 opens its popup from a script with `window.open`, a user gesture under Strider's popup blocking, so the page
 *   runs it with `Page.withUserGesture`.
 * - CM-012's Chromium branch checks that the error's text has a stack, where the original looks for Playwright's evaluation
 *   frame (`.evaluate`) in it; Strider's evaluation has no frame of that name.
 * - CM-013's `expect.poll` is the wait for the last message, `end`, followed by the history read, so the port checks
 *   the exact list once it has arrived.
 * - CM-001, CM-004, CM-005, CM-014, CM-015, CM-016, CM-018, CM-019, and CM-020 aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** The text of every console message the page has reported, in order. */
const consoleTexts = (page: Page.ObservedPage) =>
  ConsoleMessage.history(page).pipe(Effect.map((history) => history.entries.map((message) => message.text)))

upstream(import.meta.filename, {}, (test) => {
  test("CM-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        for (let i = 0; i < 2; ++i) console.log("hello")
      })
      assert.deepStrictEqual(yield* consoleTexts(page), ["hello", "hello"])
    }))

  test("CM-006", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => console.error(window))
      // Strider drives Firefox over BiDi, so the original's BiDi branch applies on every browser
      assert.strictEqual((yield* logged).text, "Window")
    }))

  test("CM-007", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() =>
        console.log({
          toString() {
            return {}
          },
          valueOf() {
            return {}
          }
        })
      )
      assert.match((yield* logged).text, /\{toString: (Function)?, valueOf: (Function)?\}/)
    }))

  test("CM-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto("about:blank")
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(async (url) => {
        await fetch(url).catch(() => {})
      }, server.EMPTY_PAGE)
      const message = yield* logged
      assert.match(message.text, /Access-Control-Allow-Origin|CORS/)
      assert.strictEqual(message.level, "error")
    }))

  test("CM-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const logged = yield* ConsoleMessage.next(
        page,
        undefined,
        (message) => Effect.succeed(message.text.startsWith("here:"))
      )
      yield* page.goto(server.PREFIX + "/consolelog.html")
      const message = yield* logged
      assert.strictEqual(message.level, "log")
      // The original's `line: 7` counts from 0; `console.log` is on line 8 of consolelog.html. The column isn't compared:
      // engines count it differently, as the original notes.
      const { url, line } = Option.getOrThrow(message.location)
      assert.deepStrictEqual({ url, line }, { url: server.PREFIX + "/consolelog.html", line: 8 })
    }))

  test("CM-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(async () => {
        // 1. Create a popup that Playwright is not connected to.
        const win = window.open("")
        ;(window as any)._popup = win
        if (window.document.readyState !== "complete") {
          await new Promise((f) => window.addEventListener("load", f))
        }
        // 2. In this popup, create an iframe that console.logs a message.
        win!.document.body.innerHTML = `<iframe src='/consolelog.html'></iframe>`
        const frame = win!.document.querySelector("iframe")!
        if (!frame.contentDocument || frame.contentDocument.readyState !== "complete") {
          await new Promise((f) => frame.addEventListener("load", f))
        }
        // 3. After that, remove the iframe.
        frame.remove()
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      // 4. Connect to the popup and make sure it doesn't throw.
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => 1 + 1), 2)
    }))

  test("CM-011", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => console.log([1, 2, 3], { a: 1 }, window))
      assert.strictEqual((yield* logged).text, "[1, 2, 3] {a: 1} Window")
    }))

  test("CM-012", ({ page, browserName }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => console.log(new Error("Exception")))
      const text = (yield* logged).text
      if (browserName === "firefox") assert.strictEqual(text, "Error")
      else if (browserName === "chromium") {
        // The original looks for Playwright's own evaluation frame in the stack; Strider's has none by that name, so the
        // port checks what the frame stands for: the text is the error and its stack
        assert.match(text, /^Error: Exception\n {4}at /)
      } else assert.strictEqual(text, "Error: Exception")
    }))

  test("CM-013", ({ page }) =>
    Effect.gen(function*() {
      const end = yield* ConsoleMessage.next(page, { text: "end" })
      yield* page.evaluateInMainWorld(() => {
        const fail = async () => Promise.reject(new Error("error"))
        console.log("begin")
        void fail()
        void fail()
        fail().catch(() => {
          console.log("end")
        })
      })
      yield* end
      assert.deepStrictEqual(yield* consoleTexts(page), ["begin", "end"])
    }))

  test("CM-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        for (let i = 0; i < 301; i++) console.log("message" + i)
      })
      const messages = (yield* ConsoleMessage.history(page)).entries
      // The original's `m.page()` is the message's origin, which names the page
      const objects = messages.map((message) => ({ text: message.text, level: message.level, origin: message.origin }))
      const expected: Array<(typeof objects)[number]> = []
      for (let i = 201; i < 301; i++) {
        expected.push({ text: "message" + i, level: "log" as const, origin: { _tag: "Page" as const, page: page.id } })
      }
      assert.isAtLeast(objects.length, 100, "should be at least 100 messages")
      assert.deepStrictEqual(objects.slice(objects.length - expected.length), expected, "should return last messages")
    }))
})
