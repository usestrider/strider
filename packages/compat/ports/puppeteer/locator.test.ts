/**
 * Puppeteer's `test/src/locator.test.ts`, in file order: the first 27 tests, from "should work with a frame" through
 * "should work for checkboxes", then the rest, from "should fill readonly color inputs" to "FunctionLocator should work
 * with actions". Not ported: "should work with element handles" needs what Strider lacks, "Locator.scroll should work"
 * needs an offset scroll, "should work with a custom typing threshold" tests Puppeteer's own fill strategy, the
 * `map`, `filter` and `FunctionLocator` tests take JS predicates, `waitHandle` returns a handle, and `clone` copies a
 * locator that Strider's values don't need copying. The ledger says why each one is
 * (`ledger/expectations/puppeteer/locator.json`).
 *
 * What the port changes:
 * - `page.setViewport({ width: 500, height: 500 })` is `page.emulate({ viewport })`, held by the test's scope. The harness
 *   page is 1280x720, where the element at `margin-top: 600px` is already in view, so the tests that depend on the
 *   viewport set 500x500 first, as the original does.
 * - Puppeteer's `html` template is `html(body)` in `harness/puppeteer.ts`.
 * - `page.mainFrame().locator(…)` is `page.locator(…)`: a Strider page is its own main frame.
 * - `page.$(selector)` handles, read with `handle.evaluate(el => el.innerText)`, are locators read with `readText`. A
 *   locator finds the element again on each read, where a handle keeps the element it found. `readText` is the text
 *   content, not `innerText`; each test reads an element whose two agree at the point it checks.
 * - `page.evaluate(() => document.querySelector(…)?.value === …)` reads are `readValue`, `isChecked` and `readText`:
 *   non-evaluating reads of the same state.
 * - "should work for multiple selectors" clicks `::-p-text(test), ::-p-xpath(/button)`: a selector list of which only
 *   the text half finds the button (`/button` matches nothing in a document). Strider has no XPath or `::-p-` syntax, so
 *   the port keeps the list and the unmatched alternative with a CSS list, `article, button`. What it drops is the XPath
 *   and text-pseudo-class syntax, which is Puppeteer's own.
 * - Puppeteer's `.on(LocatorEvent.Action, listener)` is an observer Puppeteer adds to its own locators; Strider has no
 *   counterpart. The tests that registered one still assert the page's own effect of the same action, which is what the
 *   listener was there to show happened. The flags the listeners set (`willClick`, `hovered`, `filled`) are not checked,
 *   so these tests check less than the original by exactly those flags.
 * - Puppeteer's precondition toggles (`setEnsureElementIsInTheViewport`, `setVisibility`, `setWaitForEnabled`,
 *   `setWaitForStableBoundingBox`) are Strider's `checks` (`Locator.Checks`). "should work without preconditions" turns
 *   every check off, as `forceChecks` does, and turns `inViewport` off too, which `forceChecks` keeps on. Its
 *   `setTimeout(0)` removes Puppeteer's per-call timeout; with the checks off nothing waits, so the port sets no deadline.
 * - Puppeteer's `page.setDefaultTimeout(5000)` and its sinon fake clock: the timeouts run in real time under
 *   `defaultTimeout("5 seconds")`. A `Deadline.Timeout` is asserted on its typed fields (operation, budget, phase).
 *   Strider's `message` names the operation and phase, where Puppeteer's says `Timed out after waiting 5000ms`.
 * - "can be aborted": Puppeteer's `signal` option has no Strider form. Strider's counterpart is interrupting the
 *   operation's fiber (`option-page-dblclick-signal`), and the port does that after 2 seconds of real time, where the
 *   original advances its fake clock by 2000 ms. It asserts the click was interrupted and that the button was not
 *   clicked. An interruption is an Effect interruption, not an error whose message says "aborted".
 * - "should work with a OOPIF": the frame is found in the page's frame tree once `setContent` has loaded it, where
 *   Puppeteer waits for it with `waitForFrame`. The data-URL frame is in-process here; the test is about the locator
 *   entering the frame, and the port keeps that.
 * - "should work for selects" and "should work for checkboxes": Puppeteer's `fill` on a `select` chooses an option by its
 *   value, and its `fill(true | false)` on a checkbox sets it. Strider's `fill` takes text; its `selectOption`, `check`
 *   and `uncheck` are the counterparts, and the port uses them and reads the same state back.
 * - The test's own changes to the page (an element's `display`, its `disabled`) are made with `evaluateInMainWorld`,
 *   as the original makes them through `ElementHandle.evaluate`, which runs in the main world.
 *
 * What the second half changes:
 * - `Locator.race([a, b]).click()` waits for whichever locator matches first and clicks that one, interrupting the
 *   other. The port races `Expect.toBeAttached` over the locators, each returning its locator, and clicks the winner:
 *   the same order of events. Its `setTimeout` is `defaultTimeout`, and its `signal` is fiber interruption, as for click.
 * - "should time out when all locators do not match" fails as Strider's `Expect` does at its deadline, an
 *   `ExpectationFailed` whose `elapsed` is the budget, where Puppeteer's says `Timed out after waiting 5000ms`.
 * - "should fill readonly color inputs" and "range": the original expects the fill to succeed, since `readonly` doesn't
 *   apply to these types. The port uses Strider's default checks, which treat the attribute as read-only (`fill` waits
 *   for a read-only element, and a timeout reports `ReadOnly`), so these two fail on that difference. Readonly text
 *   inputs are refused by both: the reject tests wait out the timeout and assert Strider's `ReadOnly` observation.
 * - Dropped variants: the original runs the reject tests at typing thresholds 100 and 0 (the date markup at 100 only) and
 *   the number "preserve" test at both. The port runs threshold 100 only, so four variants are not run: the reject
 *   tests for the input, textarea and number markups at threshold 0, and "preserve number" at threshold 0. The
 *   threshold is Puppeteer's fill strategy (typing below it, setting the value above), which Strider's fill has no
 *   option for, so they would call the same `fill` again; the ledger is per key, so the gap is recorded here.
 * - "should preserve … on rejected values": Strider refuses a malformed number, date or time with `InvalidInput`
 *   before it focuses the input, where Puppeteer waits out its timeout. The refusal is documented in `fill`'s Details
 *   (a malformed value fails with `InvalidInput` without changing the value). The port asserts that refusal and that the
 *   input keeps its value, then fills the accepted value.
 * - "should preserve the selection if no option matches the value": Puppeteer's fill on a `<select>` chooses by value,
 *   and Strider's counterpart is `selectOption`. It waits for the option, and its timeout is `NoSuchOption`.
 * - ARIA checkables: `fill(true)` and `fill(false)` are `check` and `uncheck`. The port reads `aria-checked` back with
 *   `readAttribute`, which asserts the exact token ("true", "false") as the original does, and `check` clicks a "mixed"
 *   checkable to "true" as Puppeteer's toggle does.
 * - "Locator.prototype.wait should work": the original doesn't await its `setContent`, so the port starts it with
 *   `startWaiting` and joins it at the end. Puppeteer's `wait()` is `Expect.toBeAttached`.
 * - Puppeteer's `Locator.prototype.clone` copies a mutable builder, so its `setTimeout` doesn't change the original.
 *   Strider's locators are values with no timeout property; both clone tests are `notApplicable`.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, Locator, type Page, Reason } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { defaultTimeout, expectationFailure, failureOf, forceChecks, startWaiting } from "../harness/playwright.ts"
import { flatten, html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/** Puppeteer's `page.setViewport({ width: 500, height: 500 })`, held for the test by its scope. */
const smallViewport = (page: Page.Page) => page.emulate({ viewport: { width: 500, height: 500 } })

/**
 * Puppeteer's `ensureElementIsInTheViewport`, `visibility`, `waitForEnabled` and `waitForStableBoundingBox` all off:
 * `forceChecks`, with the viewport check off too.
 */
const noPreconditions: Locator.Checks = { ...forceChecks, inViewport: false }

/**
 * An action that waits past its budget fails with a `Timeout` of that operation, its budget (counted from when the action
 * starts, so at most the budget and not much less) and its phase.
 */
const timedOut = (error: unknown, budget: number, operation = "Locator.click") => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, operation)
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  assert.strictEqual(error.phase, "waitingForCondition")
}

/** The `_tag` of each observation a timed-out action waited on, such as `ReadOnly` or `NoSuchOption`. */
const waitedOn = (error: Deadline.Timeout) =>
  error.history.map((observed) => (observed.value as { readonly _tag?: string })._tag)

/**
 * Puppeteer's `Locator.race`: each locator waits for its match, the first to match wins, and the others are
 * interrupted. The winner is the locator the Effect race hands back, so the action runs on the locator that matched.
 */
const firstMatch = (...locators: ReadonlyArray<Locator.Locator>) =>
  Effect.raceAll(locators.map((locator) => Expect.toBeAttached(locator).pipe(Effect.as(locator))))

upstream(import.meta.filename, {}, (test) => {
  test("Locator should work with a frame", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
      <button onclick="this.innerText = 'clicked';">test</button>
    `))
      // Puppeteer's `page.mainFrame()` is the page itself, which is its own main frame here
      yield* page.locator("button").click()
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator should work without preconditions", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
      <button onclick="this.innerText = 'clicked';">test</button>
    `))
      yield* page.locator("button").click({ checks: noPreconditions })
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button onclick="this.innerText = 'clicked';">test</button>
      `))
      yield* page.locator("button").click()
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work for multiple selectors", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button onclick="this.innerText = 'clicked';">test</button>
      `))
      // Puppeteer's `::-p-text(test), ::-p-xpath(/button)`: one alternative finds the button, the other finds nothing
      yield* page.locator("article, button").click()
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work if the element is out of viewport", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button
          style="margin-top: 600px;"
          onclick="this.innerText = 'clicked';"
        >
          test
        </button>
      `))
      yield* page.locator("button").click()
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work if the element becomes visible later", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button
          style="display: none;"
          onclick="this.innerText = 'clicked';"
          >test</button
        >
      `))
      const result = yield* startWaiting(page.locator("button").click())
      assert.strictEqual(yield* page.locator("button").readText, "test")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLElement).style.display = "block"
      })
      yield* Fiber.join(result.fiber)
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work if the element becomes enabled later", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button
          disabled
          onclick="this.innerText = 'clicked';"
          >test</button
        >
      `))
      const result = yield* startWaiting(page.locator("button").click())
      assert.strictEqual(yield* page.locator("button").readText, "test")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("button") as HTMLButtonElement).disabled = false
      })
      yield* Fiber.join(result.fiber)
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work if multiple conditions are satisfied later", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button
          style="margin-top: 600px;"
          style="display: none;"
          disabled
          onclick="this.innerText = 'clicked';"
        >
          test
        </button>
      `))
      const result = yield* startWaiting(page.locator("button").click())
      assert.strictEqual(yield* page.locator("button").readText, "test")
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button") as HTMLButtonElement
        button.disabled = false
        button.style.display = "block"
      })
      yield* Fiber.join(result.fiber)
      assert.strictEqual(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should time out", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
          <button
            style="display: none;"
            onclick="this.innerText = 'clicked';"
          >
            test
          </button>
        `))
      // Puppeteer's `TimeoutError('Timed out after waiting 5000ms')`, as Strider's typed `Timeout` with that budget
      const error = yield* failureOf(defaultTimeout("5 seconds")(page.locator("button").click()), "the click")
      timedOut(error, 5000)
    }))

  test("Locator Locator.click should retry clicks on errors", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
          <button
            style="display: none;"
            onclick="this.innerText = 'clicked';"
          >
            test
          </button>
        `))
      // The original's body is the same as "should time out"'s, so the port is too: a click on a hidden button times out.
      const error = yield* failureOf(defaultTimeout("5 seconds")(page.locator("button").click()), "the click")
      timedOut(error, 5000)
    }))

  test("Locator Locator.click can be aborted", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
          <button
            style="display: none;"
            onclick="this.innerText = 'clicked';"
          >
            test
          </button>
        `))
      const click = yield* startWaiting(defaultTimeout("5 seconds")(page.locator("button").click()))
      // The original's fake clock advances 2000 ms before it aborts; this waits 2 s of real time.
      yield* Effect.sleep("2 seconds")
      assert.isFalse(yield* click.done)
      yield* Fiber.interrupt(click.fiber)
      const exit = yield* Effect.exit(Fiber.join(click.fiber))
      assert.isTrue(Exit.hasInterrupts(exit))
      assert.notInclude(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.click should work with a OOPIF", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <iframe
          src="data:text/html,<button onclick=&quot;this.innerText = 'clicked';&quot;>test</button>"
        ></iframe>
      `))
      // Puppeteer's `waitForFrame(url starts with data)`: the frame is in the tree once the page's load has waited for it
      const dataFrame = flatten(yield* page.frames).find((frame) => String(frame.url).startsWith("data"))
      assert.isDefined(dataFrame, "the page's frame tree has no data: frame")
      const frame = page.frame(page.locator("iframe"))
      yield* frame.locator("button").click()
      assert.strictEqual(yield* frame.locator("button").readText, "clicked")
    }))

  test("Locator Locator.hover should work", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button onmouseenter="this.innerText = 'hovered';">test</button>
      `))
      yield* page.locator("button").hover()
      assert.strictEqual(yield* page.locator("button").readText, "hovered")
    }))

  test("Locator Locator.fill should work for textarea", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <textarea></textarea> `))
      yield* page.locator("textarea").fill("test")
      assert.strictEqual(yield* page.locator("textarea").readValue, "test")
    }))

  test("Locator Locator.fill should work for selects", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <select>
          <option value="value1">Option 1</option>
          <option value="value2">Option 2</option>
        </select>
      `))
      // Puppeteer's `fill` on a select chooses the option with that value; Strider's `selectOption` does the same
      yield* page.locator("select").selectOption({ value: "value2" })
      assert.strictEqual(yield* page.locator("select").readValue, "value2")
    }))

  test("Locator Locator.fill should work for inputs", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<input />`))
      yield* page.locator("input").fill("test")
      assert.strictEqual(yield* page.locator("input").readValue, "test")
    }))

  test("Locator Locator.fill should work if the input becomes enabled later", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <input disabled /> `))
      const result = yield* startWaiting(page.locator("input").fill("test"))
      assert.strictEqual(yield* page.locator("input").readValue, "")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).disabled = false
      })
      yield* Fiber.join(result.fiber)
      assert.strictEqual(yield* page.locator("input").readValue, "test")
    }))

  test("Locator Locator.fill should work for contenteditable", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <div contenteditable="true"></div> `))
      yield* page.locator("div").fill("test")
      assert.strictEqual(yield* page.locator("div").readText, "test")
    }))

  test("Locator Locator.fill should work for pre-filled inputs", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <input value="te" /> `))
      yield* page.locator("input").fill("test")
      assert.strictEqual(yield* page.locator("input").readValue, "test")
    }))

  test("Locator Locator.fill should override pre-filled inputs", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <input value="wrong prefix" /> `))
      yield* page.locator("input").fill("test")
      assert.strictEqual(yield* page.locator("input").readValue, "test")
    }))

  test("Locator Locator.fill should work for non-text inputs", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <input type="color" /> `))
      yield* page.locator("input").fill("#333333")
      assert.strictEqual(yield* page.locator("input").readValue, "#333333")
    }))

  test("Locator Locator.fill should work for large text", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <textarea></textarea> `))
      yield* page.locator("textarea").fill("a".repeat(1000))
      assert.strictEqual((yield* page.locator("textarea").readValue).length, 1000)
    }))

  test("Locator Locator.fill should work for large text in contenteditable", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(` <div contenteditable="true"></div> `))
      yield* page.locator("div").fill("a".repeat(1000))
      assert.strictEqual((yield* page.locator("div").readText).length, 1000)
    }))

  test("Locator Locator.fill should work for checkboxes", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<input type="checkbox" />`))
      // Puppeteer's `fill(true)` and `fill(false)` on a checkbox are Strider's `check` and `uncheck`
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("input").isChecked)
      yield* page.locator("input").uncheck()
      assert.isFalse(yield* page.locator("input").isChecked)
    }))

  test("Locator Locator.fill should work for radio buttons", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<input type="radio" />`))
      // Puppeteer's `fill(true)` on a radio is Strider's `check`
      yield* page.locator("input").check()
      assert.isTrue(yield* page.locator("input").isChecked)
    }))

  test("Locator Locator.fill should work for custom ARIA checkboxes", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <div
          role="checkbox"
          style="width: 100px; height: 100px;"
          onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') !== 'true')"
          aria-checked="false"
        ></div>
      `))
      const checkbox = page.locator("[role=\"checkbox\"]")
      yield* checkbox.check()
      assert.strictEqual(Option.getOrUndefined(yield* checkbox.readAttribute("aria-checked")), "true")
      yield* checkbox.uncheck()
      assert.strictEqual(Option.getOrUndefined(yield* checkbox.readAttribute("aria-checked")), "false")
    }))

  test("Locator Locator.fill should work for custom ARIA radio buttons", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <div
          role="radio"
          style="width: 100px; height: 100px;"
          onclick="this.setAttribute('aria-checked', 'true')"
          aria-checked="false"
        ></div>
      `))
      yield* page.locator("[role=\"radio\"]").check()
      assert.strictEqual(
        Option.getOrUndefined(yield* page.locator("[role=\"radio\"]").readAttribute("aria-checked")),
        "true"
      )
    }))

  test("Locator Locator.fill should work for custom ARIA switches", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <div
          role="switch"
          style="width: 100px; height: 100px;"
          onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') !== 'true')"
          aria-checked="false"
        ></div>
      `))
      const toggle = page.locator("[role=\"switch\"]")
      yield* toggle.check()
      // Verify the ARIA attribute was updated by the fill command
      assert.strictEqual(Option.getOrUndefined(yield* toggle.readAttribute("aria-checked")), "true")
      yield* toggle.uncheck()
      assert.strictEqual(Option.getOrUndefined(yield* toggle.readAttribute("aria-checked")), "false")
    }))

  test("Locator Locator.fill should work for custom ARIA mixed checkboxes", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <div
          role="checkbox"
          style="width: 100px; height: 100px;"
          onclick="const next = {'mixed': 'true', 'true': 'false', 'false': 'true'}; this.setAttribute('aria-checked', next[this.getAttribute('aria-checked')])"
          aria-checked="mixed"
        ></div>
      `))
      // A mixed checkable reads as unchecked, so `check` clicks it to "true", and `uncheck` clicks it to "false"
      const checkbox = page.locator("[role=\"checkbox\"]")
      yield* checkbox.check()
      assert.strictEqual(Option.getOrUndefined(yield* checkbox.readAttribute("aria-checked")), "true")
      yield* checkbox.uncheck()
      assert.strictEqual(Option.getOrUndefined(yield* checkbox.readAttribute("aria-checked")), "false")
    }))

  for (
    const { type, value, newValue } of [
      { type: "color", value: "#000000", newValue: "#ff0000" },
      { type: "range", value: "25", newValue: "75" }
    ]
  ) {
    test(
      "Locator Locator.fill should fill readonly ${type} inputs",
      { variant: type },
      ({ page }) =>
        Effect.gen(function*() {
          yield* page.setContent(html(`<input type="${type}" readonly value="${value}" />`))
          // The original expects this fill to succeed within its `setTimeout(500)`. The port keeps Strider's default
          // checks, so a refusal of the readonly input shows as this test's failure
          yield* defaultTimeout(500)(page.locator("input").fill(newValue))
          assert.strictEqual(yield* page.locator("input").readValue, newValue)
        })
    )
  }

  for (
    const { markup, selector, value, newValue } of [
      { markup: "<input readonly value=\"fixed\" />", selector: "input", value: "fixed", newValue: "changed" },
      { markup: "<textarea readonly>fixed</textarea>", selector: "textarea", value: "fixed", newValue: "changed" },
      { markup: "<input type=\"number\" readonly value=\"7\" />", selector: "input", value: "7", newValue: "9" },
      {
        markup: "<input type=\"date\" readonly value=\"2020-01-01\" />",
        selector: "input",
        value: "2020-01-01",
        newValue: "2021-02-03"
      }
    ]
  ) {
    // The original runs each markup at typing thresholds 100 and 0; see the header for why the port runs 100 only
    test(
      "Locator Locator.fill should reject ${markup} with typing threshold ${typingThreshold}",
      { variant: markup },
      ({ page }) =>
        Effect.gen(function*() {
          yield* page.setContent(html(markup))
          const error = yield* failureOf(
            defaultTimeout(500)(page.locator(selector).fill(newValue)),
            "the fill"
          )
          timedOut(error, 500, "Locator.fill")
          assert(Deadline.isTimeout(error))
          assert.include(waitedOn(error), "ReadOnly")
          assert.strictEqual(yield* page.locator(selector).readValue, value)
        })
    )
  }

  for (
    const { type, value, newValue, acceptedValue } of [
      { type: "number", value: "7", newValue: "abc", acceptedValue: "12" },
      { type: "date", value: "2020-01-01", newValue: "next tuesday", acceptedValue: "2021-02-03" },
      { type: "time", value: "10:30", newValue: "noon", acceptedValue: "12:30" }
    ]
  ) {
    test(
      "Locator Locator.fill should preserve ${type} inputs on rejected values with typing threshold ${typingThreshold}",
      { variant: type },
      ({ page }) =>
        Effect.gen(function*() {
          yield* page.setContent(html(`<input type="${type}" value="${value}" />`))
          // Strider refuses a malformed value before it focuses the input, as `InvalidInput`, where Puppeteer waits out
          // its timeout. The port asserts that refusal, which is more specific than the original's timeout.
          const error = yield* failureOf(
            defaultTimeout(500)(page.locator("input").fill(newValue)),
            "the fill"
          )
          assert(Locator.isLocatorError(error))
          assert.instanceOf(error.reason, Reason.InvalidInput)
          assert.strictEqual(yield* page.locator("input").readValue, value)

          yield* page.locator("input").fill(acceptedValue)
          assert.strictEqual(yield* page.locator("input").readValue, acceptedValue)
        })
    )
  }

  test("Locator Locator.fill should work if the input becomes writable later", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<input readonly value="fixed" />`))
      const result = yield* startWaiting(page.locator("input").fill("test"))
      assert.strictEqual(yield* page.locator("input").readValue, "fixed")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).readOnly = false
      })
      yield* Fiber.join(result.fiber)
      assert.strictEqual(yield* page.locator("input").readValue, "test")
    }))

  test("Locator Locator.fill should preserve the selection if no option matches the value", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <select>
          <option value="a">Option A</option>
          <option
            value="b"
            selected
            >Option B</option
          >
        </select>
      `))
      // Puppeteer's fill on a select chooses by value; Strider's counterpart is `selectOption`, which waits for the
      // option and times out with `NoSuchOption`
      const error = yield* failureOf(
        defaultTimeout(500)(page.locator("select").selectOption({ value: "zzz" })),
        "the selection"
      )
      timedOut(error, 500, "Locator.selectOption")
      assert(Deadline.isTimeout(error))
      assert.include(waitedOn(error), "NoSuchOption")
      assert.strictEqual(yield* page.locator("select").readValue, "b")
    }))

  test("Locator Locator.race races multiple locators", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
        <button onclick="window.count++;">test</button>
      `))
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { count: number }).count = 0
      })
      const winner = yield* firstMatch(page.locator("button"), page.locator("button"))
      yield* winner.click()
      const count = yield* page.evaluateInMainWorld(() => (window as unknown as { count: number }).count)
      assert.strictEqual(count, 1)
    }))

  test("Locator Locator.race can be aborted", ({ page }) =>
    Effect.gen(function*() {
      yield* smallViewport(page)
      yield* page.setContent(html(`
          <button
            style="display: none;"
            onclick="this.innerText = 'clicked';"
          >
            test
          </button>
        `))
      const click = yield* startWaiting(
        defaultTimeout("5 seconds")(
          firstMatch(page.locator("button"), page.locator("button")).pipe(
            Effect.flatMap((locator) => locator.click())
          )
        )
      )
      // The original's fake clock advances 2000 ms before it aborts; this waits 2 s of real time.
      yield* Effect.sleep("2 seconds")
      assert.isFalse(yield* click.done)
      yield* Fiber.interrupt(click.fiber)
      const exit = yield* Effect.exit(Fiber.join(click.fiber))
      assert.isTrue(Exit.hasInterrupts(exit))
      assert.notInclude(yield* page.locator("button").readText, "clicked")
    }))

  test("Locator Locator.race should time out when all locators do not match", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<button>test</button>`))
      // Puppeteer's `TimeoutError('Timed out after waiting 5000ms')`: Strider's `Expect` fails at its deadline, with the
      // time it waited as `elapsed`
      const failure = yield* expectationFailure(
        defaultTimeout("5 seconds")(
          firstMatch(page.locator("not-found"), page.locator("not-found")).pipe(
            Effect.flatMap((locator) => locator.click())
          )
        )
      )
      assert.isAtLeast(Duration.toMillis(failure.elapsed), 4500)
      assert.isAtMost(Duration.toMillis(failure.elapsed), 5500)
    }))

  test("Locator Locator.race should not time out when one of the locators matches", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<button>test</button>`))
      const winner = yield* firstMatch(page.locator("not-found"), page.locator("button"))
      yield* winner.click()
    }))

  test("Locator Locator.prototype.wait should work", ({ page }) =>
    Effect.gen(function*() {
      // The original doesn't await this `setContent`: the script's div is added 50 ms after the page loads, and the wait is
      // for it
      const load = yield* startWaiting(page.setContent(html(`
        <script>
          setTimeout(() => {
            const element = document.createElement('div');
            element.innerText = 'test2';
            document.body.append(element);
          }, 50);
        </script>
      `)))
      // This shouldn't throw.
      yield* Expect.toBeAttached(page.locator("div"))
      yield* Fiber.join(load.fiber)
    }))
})
