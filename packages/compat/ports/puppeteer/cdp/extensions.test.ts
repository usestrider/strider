/**
 * Puppeteer's `test/src/cdp/extensions.test.ts`: Chromium extensions installed while the browser runs, their service
 * workers, their pages, and the console messages those pages and workers log. Chromium only.
 *
 * What the port changes:
 * - Puppeteer's extensions are installed and removed by the browser's own `Extensions` commands
 *   (`browser.installExtension`, `uninstallExtension`, `extensions()`, `extension.triggerAction`). Strider has no
 *   extension management, and the port doesn't rebuild one over raw CDP: it loads the extension at launch, as Playwright's
 *   `chromium/extensions.spec.ts` does (`--load-extension` and `--disable-extensions-except` in `launch.args`), and
 *   observes it through Strider: the extension's service worker is the context's worker of kind `service`
 *   (`BrowserWorker.history` / `BrowserWorker.next`), and its script runs with `BrowserWorker.evaluate`.
 * - Ported: "service_worker target type should be available" (the service worker of the loaded extension is reported),
 *   without its tail, which uninstalls the extension and checks that no worker is reported, and "can evaluate in the
 *   service worker". Each launches its own browser, as the original's `setupSeparateTestBrowserHooks` does.
 * - Not ported, in the ledger: every test that installs, uninstalls, re-installs, lists, or triggers an extension at run
 *   time, that lists an extension's pages, that reads a worker's console messages (`Worker.console`), or that evaluates
 *   in a content script's realm.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, BrowserWorker, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { backend } from "../../harness/browsers.ts"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Runs `body` in a Chromium that loads Puppeteer's simple extension at launch, with the browser's default context
 * controlled for the body. The browser closes when the body ends.
 */
const withSimpleExtension = <A, E, R>(body: (context: UserContext.UserContext) => Effect.Effect<A, E, R>) => {
  const directory = assetPath("puppeteer", "simple-extension")
  const run = Effect.fnUntraced(function*() {
    const browser = yield* Browser.Browser
    return yield* Effect.scoped(browser.defaultContext.control.pipe(Effect.flatMap(body)))
  })
  return run().pipe(
    Effect.provide(Layer.mergeAll(
      NodeSocket.layerWebSocketConstructor,
      backend("chromium", {
        chromium: { args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] }
      })
    ))
  )
}

/**
 * The extension's service worker: the context's, if it has one already, else the next one that starts, as the original's
 * `browser.waitForTarget(target => target.type() === 'service_worker')` finds the existing target or waits for one.
 */
const serviceWorkerOf = Effect.fnUntraced(function*(context: UserContext.UserContext) {
  const existing = (yield* BrowserWorker.history(context, { kind: "service" })).entries
  if (existing.length > 0) return existing[0]!
  const started = yield* BrowserWorker.next(context, { kind: "service" })
  return yield* started
})

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test(
    "extensions service_worker target type should be available",
    { page: false },
    () =>
      withSimpleExtension((context) =>
        Effect.gen(function*() {
          const worker = yield* serviceWorkerOf(context)
          assert.match(String(worker.url), /^chrome-extension:\/\/[a-p]{32}\/index\.js$/)
          assert.strictEqual(worker.kind, "service")
        })
      )
  )

  test(
    "extensions can evaluate in the service worker",
    { page: false },
    () =>
      withSimpleExtension((context) =>
        Effect.gen(function*() {
          const worker = yield* serviceWorkerOf(context)
          const result = yield* worker.evaluate(() => (globalThis as unknown as { MAGIC: number }).MAGIC)
          assert.strictEqual(result, 42)
        })
      )
  )
})
