/**
 * Playwright's `tests/page/locator-click.spec.ts`: clicking, double-clicking, and clicking an element a page script
 * removes as the click arrives.
 *
 * What the port changes:
 * - `page.locator(…)` is Strider's locator, so LO-052 to LO-056 are the same calls.
 * - `page.evaluate` runs page code in the main world, so each read and setup is `page.evaluateInMainWorld`.
 * - `page.$eval(selector, fn)` runs `fn` on the element found, which is the element the page's listener is added to, so
 *   LO-055 and LO-056 add it inside `evaluateInMainWorld`.
 * - `it.info().annotations` links Playwright's issue; the issue is in the ledger's reason, not in the test.
 */
import { assert } from "@effect/vitest"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** A page global, read in the main world. */
const global = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name) => (window as unknown as Record<string, unknown>)[name], name)

upstream(import.meta.filename, {}, (test) => {
  test("LO-052", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("LO-053", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "Node")
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("LO-054", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const globals = window as unknown as Record<string, unknown>
        globals.double = false
        const button = document.querySelector("button") as HTMLButtonElement
        button.addEventListener("dblclick", () => {
          globals.double = true
        })
      })
      yield* page.locator("button").dblclick()
      assert.strictEqual(yield* global(page, "double"), true)
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("LO-055", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button id=clickme>Clickable</button>`)
      yield* page.evaluateInMainWorld(() => {
        const element = document.querySelector("#clickme") as HTMLElement
        element.addEventListener("pointerup", () => element.remove(), false)
      })
      yield* page.locator("#clickme").click()
    }))

  test("LO-056", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button id=clickme>Clickable</button>`)
      yield* page.evaluateInMainWorld(() => {
        const element = document.querySelector("#clickme") as HTMLElement
        element.addEventListener("pointerdown", () => element.remove(), false)
      })
      yield* page.locator("#clickme").click()
    }))
})
