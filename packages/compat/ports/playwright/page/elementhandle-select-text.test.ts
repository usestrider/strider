/**
 * Playwright's `tests/page/elementhandle-select-text.spec.ts`: selecting an element's text, and waiting for the element
 * to be visible first.
 *
 * What the port changes:
 * - Strider has no ElementHandle. `page.$(selector)` is `page.locator(selector)`, and `handle.selectText()` is
 *   `locator.selectText()`, which waits for the element to be visible, as the original's does. Its timeout is
 *   `Deadline.within`.
 * - `handle.evaluate(…)` and `page.evaluate(…)` run in the main world, so they are `page.evaluateInMainWorld`, with the
 *   element found by its selector in the page. The text the selection holds is read with the same main-world read.
 * - EH-106's wait is a wait the original holds across steps (`const promise = …then(() => done = true)`): a child fiber
 *   started at once and joined where the original awaits it. Its `page.waitForTimeout(1000)` is the original's own
 *   fixed wait, so it's an `Effect.sleep` of the same length.
 * - EH-105's `error.message` contains "element is not visible". Strider's timeout names the operation and phase, and
 *   records the reason it last observed as `NotVisible`, which the port asserts, as the scroll-into-view port does.
 */
import { assert } from "@effect/vitest"
import { Deadline, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The text the page's selection holds, read in the main world as the original's `page.evaluate` reads it. */
const selectedText = (page: Page.Page) => page.evaluateInMainWorld(() => window.getSelection()!.toString())

/** Sets the `display` style of the element at `selector`, in the main world. */
const setDisplay = (page: Page.Page, selector: string, display: string) =>
  page.evaluateInMainWorld(
    (selector, display) => {
      ;(document.querySelector(selector) as HTMLElement).style.display = display
    },
    selector,
    display
  )

upstream(import.meta.filename, {}, (test) => {
  test("EH-102", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("textarea")!.value = "some value"
      })
      yield* page.locator("textarea").selectText()
      assert.strictEqual(yield* selectedText(page), "some value")
    }))

  test("EH-103", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("input")!.value = "some value"
      })
      yield* page.locator("input").selectText()
      assert.strictEqual(yield* selectedText(page), "some value")
    }))

  test("EH-104", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("div.plain").selectText()
      assert.strictEqual(yield* selectedText(page), "Plain div")
    }))

  test("EH-105", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* setDisplay(page, "textarea", "none")
      const error = yield* failureOf(
        page.locator("textarea").selectText().pipe(Deadline.within("3 seconds")),
        "the selection"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.selectText")
      // Strider's budget counts from when the selection starts: the three seconds less the moments before then
      assert.isAtMost(Duration.toMillis(error.budget), 3000)
      assert.isAbove(Duration.toMillis(error.budget), 2500)
      assert.strictEqual((Option.getOrUndefined(error.last)?.value as { _tag: string } | undefined)?._tag, "NotVisible")
    }))

  test("EH-106", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("textarea")!.value = "some value"
      })
      yield* setDisplay(page, "textarea", "none")
      const selection = yield* startWaiting(
        page.locator("textarea").selectText().pipe(Deadline.within("3 seconds"))
      )
      // Playwright's own fixed wait, after which the selection must still be waiting
      yield* Effect.sleep("1 second")
      assert.isFalse(yield* selection.done)
      yield* setDisplay(page, "textarea", "block")
      yield* Fiber.join(selection.fiber)
      assert.isTrue(yield* selection.done)
    }))
})
