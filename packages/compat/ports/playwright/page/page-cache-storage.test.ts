/**
 * Playwright's `tests/page/page-cache-storage.spec.ts`: a CacheStorage entry written by a page survives `page.reload()`.
 *
 * What the port changes:
 * - The original's `test.fail` on WebKit is not encoded: the port runs on every browser and asserts persistence as the
 *   original does, so on stock WebKit, where upstream expects the entry not to survive, the test fails and the failure
 *   is reported. The Android skip doesn't apply.
 * - `page.evaluate` runs in the page's main world, so each script is `page.evaluateInMainWorld`, which is where
 *   `caches` lives.
 * - `page.goto` and `page.reload` wait for `load`, as Playwright's do. Strider's `reload` returns at commit by default.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("ST-032", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        const cache = await caches.open("repro-cache")
        await cache.put("/meta", new Response("payload"))
      })

      yield* page.reload({ waitUntil: "load" })

      const after = yield* page.evaluateInMainWorld(async () => {
        const cache = await caches.open("repro-cache")
        const resp = await cache.match("/meta")
        return resp ? await resp.text() : null
      })
      assert.strictEqual(after, "payload")
    }))
})
