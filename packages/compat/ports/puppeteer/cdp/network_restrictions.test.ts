/**
 * Puppeteer's `test/src/cdp/network_restrictions.test.ts`: the browser's URL blocklists and allowlists, set at launch or on
 * a running browser. Strider has neither, so 47 of the 48 tests are in the ledger, each naming the nearest matrix row.
 *
 * What the port changes:
 * - Only "no restrictions" is ported. It sets no list: it checks that a service worker's fetches during install succeed
 *   when nothing is restricted, the baseline the restriction tests compare against. It uses no restriction API, so Strider
 *   runs it as written, on the default page.
 * - `page.evaluate` reads the page's own `installFetchResultsPromise` in the main world, with `page.evaluateInMainWorld`,
 *   which waits for the promise as Puppeteer's `page.evaluate` does.
 * - The file runs on Chromium only, as Puppeteer's upstream expectations do: every test in it is SKIP on Firefox and on
 *   WebDriver BiDi, including this one.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test(
    "Network Restrictions no restrictions should not affect fetch requests made by a service worker during install",
    ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.goto(server.PREFIX + "/serviceworkers/fetch-on-install/sw.html", { waitUntil: "load" })
        const installFetchResults = yield* page.evaluateInMainWorld(() =>
          Reflect.get(window, "installFetchResultsPromise") as Promise<unknown>
        )
        assert.deepStrictEqual(installFetchResults, {
          "./blocked.json": "success",
          "./allowed.json": "success"
        })
      })
  )
})
