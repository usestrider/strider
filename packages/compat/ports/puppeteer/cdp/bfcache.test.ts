/**
 * Puppeteer's `test/src/cdp/bfcache.test.ts`: navigating to and from a page in the back/forward cache, with a function
 * exposed to it, and with an out-of-process iframe and a worker.
 *
 * What the port changes:
 * - Puppeteer's `setupSeparateTestBrowserHooks({ acceptInsecureCerts: true })` is a context per test with
 *   `Browser.newContext({ acceptInsecureCerts: true })`. Chromium refuses that (the ledger marks it), so the two tests
 *   that use the HTTPS fixture are `needsFeature` there. Puppeteer's BiDi-only skip doesn't apply to Strider's Firefox.
 * - Strider keeps the back/forward cache on (API.md, "Launch profiles are values"), so a document it restores is
 *   reported `Restored`. The test asserts what the page shows after the traversal, which holds either way.
 * - `page.setDefaultTimeout(3000)` is `defaultTimeout("3 seconds")` over each test's body, as the harness does for
 *   Puppeteer's and Playwright's per-page default budgets.
 * - `page.waitForNavigation()` alongside a click is the navigation's `PageNavigation.next` subscription, made before the
 *   click; `page.goBack()` is `page.back`, which resolves with the traversal. `document.body.innerText` is read in the
 *   main world, as the original reads it.
 * - `waitEvent(page, PageEvent.WorkerCreated)` is `BrowserWorker.next(page)`, subscribed before the action that starts
 *   the worker.
 * - "can call a function exposed on a page restored from bfcache" needs `page.exposeFunction`, which Strider doesn't
 *   have (`method-page-exposefunction`), so it isn't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, BrowserWorker, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { defaultTimeout } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

const load = { waitUntil: "load" } as const

upstream(import.meta.filename, {}, (test) => {
  test(
    "BFCache can navigate to a BFCached page",
    { page: false },
    ({ server }) =>
      Effect.scoped(
        Effect.gen(function*() {
          const context = yield* Browser.newContext({ acceptInsecureCerts: true })
          const page = yield* context.newPage
          yield* page.goto(server.https.PREFIX + "/cached/bfcache/index.html", load)

          const navigated = yield* PageNavigation.next(page, load)
          yield* page.locator("a").click()
          yield* navigated
          assert.include(yield* page.url, "target.html")

          const traversal = yield* page.back(load)
          assert.isTrue(Option.isSome(traversal))
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() => document.body.innerText),
            "BFCachednext"
          )
        }).pipe(defaultTimeout("3 seconds"))
      )
  )

  test(
    "BFCache can navigate to a BFCached page containing an OOPIF and a worker",
    { page: false },
    ({ server }) =>
      Effect.scoped(
        Effect.gen(function*() {
          const context = yield* Browser.newContext({ acceptInsecureCerts: true })
          const page = yield* context.newPage
          const started = yield* BrowserWorker.next(page)
          yield* page.goto(server.https.PREFIX + "/cached/bfcache/worker-iframe-container.html", load)
          const worker1 = yield* started
          assert.strictEqual(yield* worker1.evaluate(() => 1 + 1), 2)

          const navigated = yield* PageNavigation.next(page, load)
          yield* page.locator("a").click()
          yield* navigated

          const restarted = yield* BrowserWorker.next(page)
          yield* page.back(load)
          const worker2 = yield* restarted
          assert.strictEqual(yield* worker2.evaluate(() => 1 + 1), 2)
        }).pipe(defaultTimeout("3 seconds"))
      )
  )
})
