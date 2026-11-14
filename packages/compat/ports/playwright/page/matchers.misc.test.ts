/**
 * Playwright's `tests/page/matchers.misc.spec.ts`: expectations that outlive a navigation (EX-327). EX-328 checks the
 * failures of six matchers over a missing element, one of them `toHaveJSProperty`, which Strider doesn't have, so it
 * is `needsFeature` in the ledger and not ported.
 *
 * What the port changes:
 * - The navigation Playwright starts with `setTimeout(…, 1000)` is a fiber of the test, forked after one second
 *   (`Effect.sleep`, the original's own wait), and its failure is ignored as the original's `.catch` does.
 * - `page.goto` waits for `load`, as Playwright's default does.
 * - `page.locator('.box').first` is the locator's `first`, and `toBeEmpty` is `Expect.toBeEmpty`, which retries
 *   through the navigation as the original's does.
 */
import { Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("EX-327", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original navigates from a timer it doesn't await; the test's fiber does the same, a second later
      yield* Effect.sleep("1 second").pipe(
        Effect.andThen(page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })),
        Effect.ignore,
        Effect.forkScoped
      )
      yield* Expect.toBeEmpty(page.locator(".box").first)
    }))
})
