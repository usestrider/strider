/**
 * Playwright's `tests/page/locator-wait-for-function.spec.ts`: `locator.waitForFunction`, which polls a predicate that
 * takes the locator's element. LO-183, LO-184, and LO-188 are ported: each one's point is the condition the predicate
 * waits for, which Strider's matchers express. The other tests are `needsFeature` (see the ledger): their point is the
 * form or contract of `waitForFunction` itself.
 *
 * What the port changes:
 * - Strider has no `Locator.waitForFunction` (the matrix row `method-locator-waitforfunction` is missing). A predicate on
 *   the element is a check of the element's state, and Strider's matchers and reads express the checks these tests make:
 *   LO-183's `hasAttribute` is `Expect.toHaveAttribute` without a value, LO-184's `textContent` is `readText`, and LO-188's
 *   `textContent` after a rerender is `Expect.toHaveText`, which re-resolves the element on each attempt, as the
 *   original's wait does.
 * - The original's `window.builtins.setTimeout` is the page's own `setTimeout`: the page here runs no injected copy, as
 *   page-dialog's port notes.
 */
import { Condition, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("LO-183", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button id=toggle>Menu</button>")
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => document.querySelector("#toggle")!.setAttribute("aria-expanded", "true"), 1000)
      })
      // The predicate `element.hasAttribute("aria-expanded")`: the attribute's presence, with no value to match
      yield* page.locator("#toggle").pipe(Expect.toHaveAttribute("aria-expanded"))
    }))

  test("LO-184", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=target>yes</div>")
      // Expect returns nothing where the original resolves with undefined: the wait holds at its first check
      yield* Expect.that(
        page.locator("#target").readText,
        Condition.make("to be yes", (text: string) => text === "yes")
      )
    }))

  test("LO-188", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<span>nothing here</span>")
      yield* page.evaluateInMainWorld(() => {
        let count = 0
        let prev: Element | null = null
        const tick = () => {
          ++count
          const next = document.createElement("div")
          next.id = "target"
          next.textContent = String(count)
          if (prev) prev.remove()
          document.body.appendChild(next)
          prev = next
          if (count < 3) window.setTimeout(tick, 500)
        }
        window.setTimeout(tick, 500)
      })
      // The element is absent, then replaced twice: the matcher re-resolves `#target` on each attempt
      yield* page.locator("#target").pipe(Expect.toHaveText("3"))
    }))
})
