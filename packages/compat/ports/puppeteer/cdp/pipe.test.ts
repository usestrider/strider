/**
 * Puppeteer's `test/src/cdp/pipe.test.ts`: a browser launched over a pipe, and the `fire "disconnected"` case.
 *
 * What the port changes:
 * - Strider's Chromium launches over a pipe by default, and there is no `pipe` setting to pass: the first test runs on
 *   the browser the harness launched, which is a pipe launch, and checks that a new page evaluates. Puppeteer's
 *   `browser.pages()` count and `wsEndpoint()` (empty over a pipe) aren't ported: Strider has no WebSocket endpoint to
 *   read, and its launch doesn't say how many tabs it opened.
 * - Puppeteer runs the test on Chromium only, since Firefox has no `--remote-debugging-pipe` argument, so the port runs
 *   it on Chromium, and the ledger marks Firefox and WebKit.
 * - "should support the pipe argument" passes `--remote-debugging-pipe` as an argument to a browser that Strider's
 *   launch already gives a pipe for; it is not ported (the ledger says why).
 * - "should fire disconnected when closing with pipe" waits for the browser's `disconnected` event, which Strider has no
 *   browser-level event for (`event-browser-disconnected`), so it is not ported.
 */
import { assert } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test(
    "Puppeteer.launch should support the pipe option",
    { browsers: ["chromium"], page: false },
    () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        assert.strictEqual(yield* page.evaluateInMainWorld(() => 11 * 11), 121)
      }))
  )
})
