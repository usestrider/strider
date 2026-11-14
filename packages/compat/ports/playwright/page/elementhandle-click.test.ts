/**
 * Playwright's `tests/page/elementhandle-click.spec.ts`: clicking, double-clicking, and force-clicking an element.
 *
 * What the port changes:
 * - Strider has no ElementHandle, and `page.$(…)` isn't a call. A handle that finds an element and then acts on it is
 *   the locator for that element, which re-resolves on each attempt, so EH-010, EH-011, EH-012, and EH-015 to EH-018
 *   click through `page.locator(…)`.
 * - EH-013 (a text node) and EH-014 (a removed node) hold a handle the test must stay bound to: a text node has no
 *   locator, and a removed node's click fails as a detached node, not a missing match. They are not ported (see the
 *   ledger).
 * - `page.evaluate` runs page code in the main world, so reads and writes of page globals are
 *   `page.evaluateInMainWorld`. EH-012's `clicked` is a global `let` of the page, which the function reads by name.
 * - EH-015 to EH-017 force a click (`forceChecks`, the harness's translation of `force: true`) on an element with no
 *   box to click. Playwright fails at once; Strider keeps waiting for a point until the deadline, so each click is
 *   bounded by three seconds, and the port asserts the typed reason the wait ends with. EH-015 and EH-016 expect
 *   `NotVisible`, as the original's message says: Playwright finds no box at all for a `display: none` element, where
 *   Strider's remaining `inViewport` check reports it as `OutsideViewport`. EH-017 (a box with no area) expects
 *   `OutsideViewport`, as the original's message does.
 */
import { assert } from "@effect/vitest"
import { Deadline, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf, forceChecks } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The page's `clicked` global, from the shadow fixture's script. */
declare const clicked: boolean

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The error of a force click that ends in a timeout, with the operation that timed out. */
const timeoutOf = (error: unknown): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, "Locator.click")
  return error
}

/** A page global, read in the main world. */
const global = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name) => (window as unknown as Record<string, unknown>)[name], name)

upstream(import.meta.filename, {}, (test) => {
  test("EH-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("EH-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "Node")
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")
    }))

  test("EH-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/shadow.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => clicked), true)
    }))

  test("EH-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.display = "none"
      })
      const error = yield* failureOf(
        page.locator("button").click({ checks: forceChecks }).pipe(Deadline.within("3 seconds")),
        "the forced click"
      )
      assert.strictEqual(reasonOf(timeoutOf(error))?._tag, "NotVisible")
    }))

  test("EH-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;((document.querySelector("button") as HTMLElement).parentElement as HTMLElement).style.display = "none"
      })
      const error = yield* failureOf(
        page.locator("button").click({ checks: forceChecks }).pipe(Deadline.within("3 seconds")),
        "the forced click"
      )
      assert.strictEqual(reasonOf(timeoutOf(error))?._tag, "NotVisible")
    }))

  test("EH-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("hello<br>goodbye")
      const error = yield* failureOf(
        page.locator("br").click({ checks: forceChecks }).pipe(Deadline.within("3 seconds")),
        "the forced click"
      )
      assert.strictEqual(reasonOf(timeoutOf(error))?._tag, "OutsideViewport")
    }))

  test("EH-018", ({ page, server }) =>
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
})
