/**
 * Playwright's `tests/library/shared-worker.spec.ts`: a page's shared worker answers again after the page that started
 * it closes and another page starts it.
 *
 * What the port changes:
 * - `page.evaluate('window.sharedWorkerResponsePromise')` awaits the promise in the page's main world, which is
 *   `page.evaluateInMainWorld`.
 * - The second page is a page of the same context, as the original's `context.newPage()` gives it.
 * - `page.goto` waits for `load` by default; the port asks for it, as the original does.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("WO-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/shared-worker/shared-worker.html", { waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as any).sharedWorkerResponsePromise),
        "echo:hello"
      )
      yield* page.close()

      const page2 = yield* page.context.newPage
      yield* page2.goto(server.PREFIX + "/shared-worker/shared-worker.html", { waitUntil: "load" })
      assert.strictEqual(
        yield* page2.evaluateInMainWorld(() => (window as any).sharedWorkerResponsePromise),
        "echo:hello"
      )
      yield* page2.close()
    }))
})
