/**
 * Playwright's `tests/page/locator-misc-1.spec.ts`: a locator's hover, fill, clear, check, select, focus, dispatch and file
 * actions, and what they do when the page has removed `window.Node`.
 *
 * What the port changes:
 * - `locator.hover`, `fill`, `clear`, `check`, `uncheck`, `focus`, `blur`, `dispatchEvent`, `selectOption`, and
 *   `setInputFiles` are the same methods. The reads that check what an action did are the page's own state read in the main world (`window.result`, which the
 *   fixture pages set, and the checkbox's `checked`).
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. The check that the hovered element is
 *   `button-6` is `document.querySelector("button:hover")`.
 * - `delete window['Node']` (LO-128, LO-130) is run in the main world as the original runs it. Strider's engine runs in
 *   its own world, so the removal doesn't reach it on Chromium and Firefox; on stock WebKit the engine has no isolated
 *   world at all. The port checks what the original checks.
 * - The `it.skip(!headless)` guards (LO-127, LO-128) never skip here: the harness runs headless, so the tests run.
 * - `locator.setChecked(true)` and `setChecked(false)` (LO-133) are `check()` and `uncheck()` on the branch the boolean
 *   selects, as the matrix row `method-locator-setchecked` says (Strider has no `setChecked` alias).
 * - `selectOption("blue")` (LO-135) is `selectOption({ value: "blue" })`: the string matches the option's value, which is
 *   the only match this select has.
 * - LO-137's strict-mode failure is a `LocatorError` whose reason is Strider's typed `StrictViolation`, asserted in place
 *   of the message's wording.
 * - `locator.dispatchEvent("click")` (LO-138) passes `eventClass: "MouseEvent"`: Playwright builds a `MouseEvent` for a
 *   mouse event name, where Strider's default is a plain `Event`. The init defaults match Playwright's.
 * - LO-139's `path.relative(process.cwd(), asset(...))` is the vendored file's absolute path (`assetPath`), since
 *   `FileInput.local` takes a path on the browser's host. The file's name is read from the input's `files` in the main
 *   world, where the original reads it through the element handle.
 * - LO-136 reports the button's focus and blur through listeners the test adds in the main world, which set two flags the
 *   test reads back, where the original adds listeners that call functions it exposed with `page.exposeFunction`. The
 *   exposed function is only the channel; what's checked, the events `focus()` and `blur()` cause and which element
 *   is active, is the same. `document.activeElement` is read in the main world, where the original reads it through
 *   `locator.evaluate`.
 */
import { assert } from "@effect/vitest"
import { FileInput, Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { assetPath, failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The `window.result` the fixture page sets, read in the main world: Playwright's `page.evaluate(() => window['result'])`. */
const pageResult = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { result: unknown }).result)

/** The checkbox's state, read in the main world: Playwright's `page.evaluate('checkbox.checked')`. */
const checked = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (document.getElementById("checkbox") as HTMLInputElement).checked)

upstream(import.meta.filename, {}, (test) => {
  test("LO-127", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-6").hover()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id), "button-6")
    }))

  test("LO-128", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        delete (window as unknown as Record<string, unknown>)["Node"]
      })
      yield* page.locator("#button-6").hover()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("button:hover")?.id), "button-6")
    }))

  test("LO-129", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* pageResult(page), "some value")
    }))

  test("LO-130", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        delete (window as unknown as Record<string, unknown>)["Node"]
      })
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* pageResult(page), "some value")
    }))

  test("LO-131", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      const handle = page.locator("input")
      yield* handle.fill("some value")
      assert.strictEqual(yield* pageResult(page), "some value")
      yield* handle.clear()
      assert.strictEqual(yield* pageResult(page), "")
    }))

  test("LO-132", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      const input = page.locator("input")
      yield* input.check()
      assert.isTrue(yield* checked(page))
    }))

  test("LO-133", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox'></input>`)
      const input = page.locator("input")
      // `setChecked(true)` is `check()`, and `setChecked(false)` is `uncheck()`: Strider has no `setChecked` (see the header)
      yield* input.check()
      assert.isTrue(yield* checked(page))
      yield* input.uncheck()
      assert.isFalse(yield* checked(page))
    }))

  test("LO-134", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' checked></input>`)
      const input = page.locator("input")
      yield* input.uncheck()
      assert.isFalse(yield* checked(page))
    }))

  test("LO-135", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/select.html", { waitUntil: "load" })
      yield* page.locator("select").selectOption({ value: "blue" })
      const onInput = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { result: { onInput: unknown } }).result.onInput
      )
      assert.deepStrictEqual(onInput, ["blue"])
      const onChange = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { result: { onChange: unknown } }).result.onChange
      )
      assert.deepStrictEqual(onChange, ["blue"])
    }))

  test("LO-136", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      const button = page.locator("button")
      const isActive = page.evaluateInMainWorld(() => document.activeElement === document.querySelector("button"))
      const events = page.evaluateInMainWorld(() => {
        const flags = window as unknown as { focused: boolean; blurred: boolean }
        return { focused: flags.focused, blurred: flags.blurred }
      })
      assert.isFalse(yield* isActive)

      yield* page.evaluateInMainWorld(() => {
        const flags = window as unknown as { focused: boolean; blurred: boolean }
        flags.focused = false
        flags.blurred = false
        const target = document.querySelector("button")!
        target.addEventListener("focus", () => {
          flags.focused = true
        })
        target.addEventListener("blur", () => {
          flags.blurred = true
        })
      })

      yield* button.focus()
      assert.deepStrictEqual(yield* events, { focused: true, blurred: false })
      assert.isTrue(yield* isActive)

      yield* button.blur()
      assert.deepStrictEqual(yield* events, { focused: true, blurred: true })
      assert.isFalse(yield* isActive)
    }))

  test("LO-137", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>A</div><div>B</div>")
      const failure = yield* failureOf(page.locator("div").focus(), "the focus")
      assert(Locator.isLocatorError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "StrictViolation")
    }))

  test("LO-138", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").dispatchEvent("click", { eventClass: "MouseEvent" })
      assert.strictEqual(yield* pageResult(page), "Clicked")
    }))

  test("LO-139", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      const input = page.locator("input[type=file]")
      yield* input.setInputFiles(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      const name = yield* page.evaluateInMainWorld(() =>
        (document.querySelector("input[type=file]") as HTMLInputElement).files![0]!.name
      )
      assert.strictEqual(name, "file-to-upload.txt")
    }))
})
