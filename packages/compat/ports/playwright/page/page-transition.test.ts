/**
 * Playwright's `tests/page/page-transition.spec.ts`: toggling a filter transition on many elements doesn't crash the page.
 *
 * What the port changes:
 * - The original's `it.fixme` for WebKit is Playwright's own expectation, not ours: the port runs on every browser, so
 *   a WebKit crash is reported as a failure.
 * - `page.on('crash', …)` has no Strider counterpart. A crash ends the page, and Strider reports that as the page's
 *   `closed` reason, a `PageCrashed`. The port watches `page.closed` from before the loop and asserts it didn't end, and
 *   the loop stops at the crash, as the original's `!crashed` does.
 * - `page.evaluate` runs in the page's main world, so the script is `page.evaluateInMainWorld`. The original's
 *   `.catch(() => {})` is `Effect.ignore`.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("PA-038", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      div { transition: filter 0.1s; }
      .dim { filter: brightness(0.95); }
    </style>
    ${"<div>hello</div>".repeat(10)}
  `)
      // `page.on('crash', () => crashed = true)`: the page's close, started before the loop, reports a crash
      const closed = yield* startWaiting(page.closed)
      for (let i = 0; i < 10 && !(yield* closed.done); i++) {
        yield* page.evaluateInMainWorld(async () => {
          const divs = [...document.querySelectorAll("div")]
          const settled = () =>
            Promise.all(
              divs.map((div) =>
                new Promise((resolve) => div.addEventListener("transitionend", resolve, { once: true }))
              )
            )
          let promise = settled()
          divs.forEach((div) => div.classList.add("dim"))
          await promise
          promise = settled()
          divs.forEach((div) => div.classList.remove("dim"))
          await promise
        }).pipe(Effect.ignore)
      }
      assert.isFalse(yield* closed.done, "the page crashed, where Playwright's page doesn't")
    }))
})
