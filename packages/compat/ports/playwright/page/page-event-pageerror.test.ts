/**
 * Playwright's `tests/page/page-event-pageerror.spec.ts`: the uncaught errors a page throws, with their name, message,
 * and stack, and the page's history of them.
 *
 * What the port changes:
 * - `page.waitForEvent("pageerror")` is `UncaughtException.next(page)`, subscribed before the navigation or action that
 *   throws, as the original's `Promise.all` has it.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. Playwright's injected
 *   `window.builtins.setTimeout` is the page's own `window.setTimeout`, as in page-dialog.test.ts.
 * - An error's `stack` is Strider's `Option`, which is `none` where the browser gives no stack. The port asserts the
 *   value inside it, so a missing stack fails with the expected text.
 * - Strider drives Firefox over WebDriver BiDi, so ER-001 asserts the original's BiDi branch on Firefox; its non-BiDi
 *   branch doesn't apply. The Windows branch of ER-013 doesn't apply to the Linux runs.
 * - ER-001's Chromium branch for the cross-origin script reads the browser's major version from `Browser.info`, as the
 *   original reads `browserMajorVersion`.
 * - ER-003's `it.fail` for WebKit isn't carried over: the test runs everywhere, and WebKit's result is reported as it is.
 * - ER-011's `page.pageErrors()` is `UncaughtException.history(page)`, whose log keeps the last 100 errors by default.
 *   The page's own 2000 ms wait is kept as the original writes it.
 * - ER-007 and ER-008 assert `"[object Object]"` and `"[object Window]"` on every browser: Strider reads a thrown value
 *   that isn't an `Error` as its string, where the original's Chromium branch has the protocol's `"Object"` and `"Window"`.
 * - ER-009 and ER-012 aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, UncaughtException } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("ER-001", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const url = server.PREFIX + "/error.html"
      const thrown = yield* UncaughtException.next(page)
      yield* page.goto(url)
      const error = yield* thrown
      assert.strictEqual(error.name, "Error")
      assert.strictEqual(error.message, "Fancy error!")
      const stack = Option.getOrUndefined(error.stack)
      if (browserName === "chromium" || browserName === "firefox") {
        assert.strictEqual(
          stack,
          [
            "Error: Fancy error!",
            "    at c (myscript.js:14:11)",
            "    at b (myscript.js:10:5)",
            "    at a (myscript.js:6:5)",
            "    at myscript.js:3:1"
          ].join("\n")
        )
      } else if (browserName === "webkit") {
        assert.strictEqual(
          stack,
          [
            "Error: Fancy error!",
            `    at c (${url}:14:36)`,
            `    at b (${url}:10:6)`,
            `    at a (${url}:6:6)`,
            `    at global code (${url}:3:2)`
          ].join("\n")
        )
      }

      // The same script from another origin: Chromium reports it without an exception object,
      // so the stack is built from the CDP call frames, which are zero-based.
      const crossOriginUrl = server.CROSS_PROCESS_PREFIX + "/error.js"
      server.setRoute("/error.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript")
        // Same lines as error.html, so the stack has the same locations.
        res.end(`
console.error('Not a JS error');
a();

function a() {
    b();
}

function b() {
    c();
}

function c() {
    throw new Error('Fancy error!');
}
`)
      })
      server.setRoute("/cross-origin-error.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<script src="${crossOriginUrl}"></script>`)
      })
      const crossOrigin = yield* UncaughtException.next(page)
      yield* page.goto(server.PREFIX + "/cross-origin-error.html")
      const crossOriginError = yield* crossOrigin
      assert.strictEqual(crossOriginError.message, "Fancy error!")
      const major = Number((yield* Browser.Browser).info.version.split(".")[0])
      const crossOriginStack = Option.getOrUndefined(crossOriginError.stack)
      if (browserName === "chromium" && major >= 155) {
        assert.strictEqual(
          crossOriginStack,
          [
            "Uncaught Error: Fancy error!",
            `    at c (${crossOriginUrl}:14:11)`,
            `    at b (${crossOriginUrl}:10:5)`,
            `    at a (${crossOriginUrl}:6:5)`,
            `    at <anonymous> (${crossOriginUrl}:3:1)`
          ].join("\n")
        )
      } else if (browserName === "webkit") {
        assert.strictEqual(
          crossOriginStack,
          [
            "Error: Fancy error!",
            `    at c (${crossOriginUrl}:14:36)`,
            `    at b (${crossOriginUrl}:10:6)`,
            `    at a (${crossOriginUrl}:6:6)`,
            `    at global code (${crossOriginUrl}:3:2)`
          ].join("\n")
        )
      }
    }))

  test("ER-002", ({ page, server }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.goto(server.PREFIX + "/error.html")
      yield* thrown
      // The page's one console message is the script's own `console.error`; the uncaught error isn't one of them
      const messages = yield* ConsoleMessage.history(page)
      assert.strictEqual(messages.entries.length, 1)
    }))

  test("ER-003", ({ page, server }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.goto(server.PREFIX + "/error.html")
      const error = yield* thrown
      assert.include(Option.getOrUndefined(error.stack) ?? "", "myscript.js")
    }))

  test("ER-004", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          const error = new Error("my-message")
          error.name = "my-name"
          throw error
        }, 0)
      })
      const error = yield* thrown
      assert.strictEqual(error.name, "my-name")
      assert.strictEqual(error.message, "my-message")
    }))

  test("ER-005", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          const error = new Error("my-message")
          error.name = ""
          throw error
        }, 0)
      })
      const error = yield* thrown
      assert.strictEqual(error.name, "")
      assert.strictEqual(error.message, "my-message")
    }))

  test("ER-006", ({ page }) =>
    Effect.gen(function*() {
      const cases: Array<[unknown, string]> = [
        [null, "null"],
        [undefined, "undefined"],
        [0, "0"],
        ["", ""]
      ]
      for (const [value, message] of cases) {
        const thrown = yield* UncaughtException.next(page)
        yield* page.evaluateInMainWorld((value) => {
          window.setTimeout(() => {
            throw value
          }, 0)
        }, value as never)
        assert.strictEqual((yield* thrown).message, message)
      }
    }))

  test("ER-007", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          throw {}
        }, 0)
      })
      // Strider reads a thrown value that isn't an `Error` as its string on every browser, so Chromium's `"Object"` (the
      // description its protocol gives the original) isn't asserted.
      assert.strictEqual((yield* thrown).message, "[object Object]")
    }))

  test("ER-008", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          throw window
        }, 0)
      })
      // As in ER-007: the thrown value's string on every browser, where the original has Chromium's `"Window"`.
      assert.strictEqual((yield* thrown).message, "[object Window]")
    }))

  test("ER-010", ({ page }) =>
    Effect.gen(function*() {
      const thrown = yield* UncaughtException.next(page)
      yield* page.setContent(`
        <script>
          Promise.reject(new Error('sad :('));
        </script>
    `)
      assert.include((yield* thrown).message, "sad :(")
    }))

  test("ER-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(async () => {
        for (let i = 0; i < 301; i++) {
          window.setTimeout(() => {
            throw new Error("error" + i)
          }, 0)
        }
        // The original's own wait for the timers to fire, in the page
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2000))
      })

      const errors = yield* UncaughtException.history(page)
      const messages = errors.entries.map((error) => error.message)

      const expected: Array<string> = []
      for (let i = 201; i < 301; i++) expected.push("error" + i)

      assert.isAtLeast(messages.length, 100, "should be at least 100 errors")
      assert.deepStrictEqual(messages.slice(messages.length - expected.length), expected, "should return last errors")
    }))

  test("ER-013", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      server.setRoute("/error.html", (_req, res) => {
        res.end(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>vite-project</title>
        </head>
        <body>
          <div id="app"></div>
          <script >
            let a=10；//   !!!note: ； not ;
          </script>
        </body>
      </html>
    `)
      })
      const thrown = yield* UncaughtException.next(page)
      yield* page.goto(server.PREFIX + "/error.html")
      const error = yield* thrown
      if (browserName === "chromium") assert.include(error.message, "Invalid or unexpected token")
      else if (browserName === "webkit") assert.include(error.message, "Invalid character")
      else assert.include(error.message, "illegal character")
    }))
})
