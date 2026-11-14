/**
 * Playwright's `tests/page/page-select-option.spec.ts`: choosing the options of a `<select>` by value, label, or index,
 * the events a choice fires, the waits for an option or an enabled select, and the errors for a non-select.
 *
 * What the port changes:
 * - `page.selectOption(selector, choice)` is `page.locator(selector).selectOption(choice)`. Strider's choice is one of
 *   `{ value }`, `{ label }`, or `{ index }`, or an array of them. Playwright's bare string, which matches a value and
 *   falls back to a label, is `{ value }` here. SO-003's fallback to a label has no Strider form, since a choice names
 *   its attribute and nothing falls back, so SO-003 selects by `{ label: "Blue" }`: the option and the events are
 *   Playwright's, but the call doesn't try a value first, so the fallback itself isn't what it checks.
 * - `null` in SO-021 means "unselect", which Strider's `[]` does; Strider's choices take no `null`.
 * - Strider's `selectOption` returns nothing, where Playwright's returns the values it selected. SO-016 to SO-019 check
 *   only that return, so they aren't ported (see the ledger). In SO-021, SO-026 to SO-028 the return is one check
 *   among others, so those tests check the page's selected options in its place, which is what the return reports.
 * - `page.evaluate` runs in the main world, where the fixture's `result` and `makeMultiple` are, so those reads and
 *   calls are `page.evaluateInMainWorld`. The listeners SO-029 adds are added in the main world too, so they see the
 *   events the page fires.
 * - `page.waitForNavigation()` is `PageNavigation.next`, subscribed before the selection and run with it, with
 *   `waitUntil: "load"` as Playwright's default. `expect(page.url()).toContain(…)` is `Expect.toHaveURL` on the exact URL
 *   the page navigated to.
 * - `timeout` is `Deadline.within`. A wait that gives up is an operation timeout, which the test doesn't need to tell
 *   apart from Playwright's timeout error.
 * - `new Promise(f => setTimeout(f, 1000))` is a fixed wait the original makes itself, so it is `Effect.sleep` for the
 *   same second. The `selectPromise` the original holds across steps is `startWaiting`.
 * - SO-015 checks Strider's typed `WrongElement` for a `<select>` expectation. Its message is not checked.
 * - SO-029 has an `it.info()` annotation linking Playwright's issue 28726. The port drops the annotation and keeps the
 *   test.
 * - SO-031 and SO-032 wait for a disabled option or optgroup to be enabled. Strider's select action checks the select,
 *   not the options, so the first selection succeeds where Playwright's times out. The test is ported as written, and
 *   fails on that first call.
 * - SO-010 selects from a single `<select>` an array of values, where Playwright chooses only the first. Strider's
 *   apply selects every listed option in document order, so the last of them stays selected. Ported as written.
 * - SO-023 deselects every option of a single select with `[]`. Setting every option unselected lets the browser pick
 *   the first option again, where Playwright's `selectedIndex = -1` leaves none selected. Ported as written.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, Locator, type Page, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import { rafraf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The page's own globals in `input/select.html`, read or called in the main world. */
interface SelectPage {
  readonly result: Record<"onInput" | "onChange" | "onBubblingInput" | "onBubblingChange", unknown>
  makeMultiple(): void
}

const fixture = (page: Page.Page, server: { readonly PREFIX: string }) =>
  page.goto(server.PREFIX + "/input/select.html", { waitUntil: "load" })

const recorded = (page: Page.Page, name: keyof SelectPage["result"]) =>
  page.evaluateInMainWorld((name) => (window as unknown as SelectPage).result[name], name)

const makeMultiple = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as SelectPage).makeMultiple())

/** The values of the options the page's `<select>` has selected, in document order. */
const selectedValues = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    Array.from((document.querySelector("select") as HTMLSelectElement).selectedOptions).map((option) => option.value)
  )

/** Adds the `scarlet` option, as Playwright's wait tests do: `<option value="scarlet">Scarlet</option>`. */
const addScarlet = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    const select = document.querySelector("select") as HTMLSelectElement
    const option = document.createElement("option")
    option.value = "scarlet"
    option.textContent = "Scarlet"
    select.appendChild(option)
  })

/** The error of a call that Playwright's test expects to fail; one that succeeds fails the test. */
const failureOf = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the call succeeded, where Playwright's call fails")
  return result.failure
})

/** Playwright's `page.selectOption` over `input/select.html` and the page's `result` events. */
const expectEvents = Effect.fnUntraced(function*(
  page: Page.Page,
  input: ReadonlyArray<string>,
  change: ReadonlyArray<string>
) {
  assert.deepEqual(yield* recorded(page, "onInput"), input)
  assert.deepEqual(yield* recorded(page, "onChange"), change)
})

upstream(import.meta.filename, {}, (test) => {
  test("SO-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      // Playwright's bare string is the value, tried first
      yield* page.locator("select").selectOption({ value: "blue" })
      yield* expectEvents(page, ["blue"], ["blue"])
    }))

  test("SO-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* page.locator("select").selectOption({ value: "blue" })
      yield* expectEvents(page, ["blue"], ["blue"])
    }))

  test("SO-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      // Playwright's bare `"Blue"` matches no value and falls back to the label; Strider has no fallback, so it names
      // the label
      yield* page.locator("select").selectOption({ label: "Blue" })
      yield* expectEvents(page, ["blue"], ["blue"])
    }))

  test("SO-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* page.locator("select").selectOption({ label: "Indigo" })
      yield* expectEvents(page, ["indigo"], ["indigo"])
    }))

  test("SO-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      // The option's label is `&nbsp;HTML`, and its text collapses to `HTML`
      yield* page.locator("select").selectOption({ label: "HTML" })
      yield* expectEvents(page, ["html"], ["html"])
    }))

  test("SO-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* page.locator("select").selectOption({ index: 2 })
      yield* expectEvents(page, ["brown"], ["brown"])
    }))

  test("SO-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      // Playwright chooses only the first of these on a select without `multiple`; see the header
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "green" }, { value: "red" }])
      yield* expectEvents(page, ["blue"], ["blue"])
    }))

  test("SO-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("select") as HTMLSelectElement).addEventListener(
          "input",
          () => window.location.href = "/empty.html"
        )
      })
      // Playwright's `waitForNavigation` waits for `load`
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* Effect.all([
        page.locator("select").selectOption({ value: "blue" }),
        navigated
      ], { concurrency: "unbounded" })
      yield* Expect.toHaveURL(page, server.PREFIX + "/empty.html")
    }))

  test("SO-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* makeMultiple(page)
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "green" }, { value: "red" }])
      yield* expectEvents(page, ["blue", "green", "red"], ["blue", "green", "red"])
    }))

  test("SO-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* makeMultiple(page)
      yield* page.locator("select").selectOption([{ value: "blue" }, { label: "Green" }, { index: 4 }])
      yield* expectEvents(page, ["blue", "gray", "green"], ["blue", "gray", "green"])
    }))

  test("SO-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* page.locator("select").selectOption({ value: "blue" })
      assert.deepEqual(yield* recorded(page, "onBubblingInput"), ["blue"])
      assert.deepEqual(yield* recorded(page, "onBubblingChange"), ["blue"])
    }))

  test("SO-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      // Playwright's `selectOption("body", "")` takes a selector; Strider's choice is typed, and `{ value }` is the
      // choice that the element check is made against
      const error = yield* failureOf(page.locator("body").selectOption({ value: "" }))
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason._tag === "WrongElement", error.reason._tag)
      assert.strictEqual(error.reason.expected, "a <select>")
    }))

  test("SO-021", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* makeMultiple(page)
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "black" }, { value: "magenta" }])
      assert.deepEqual(yield* selectedValues(page), ["black", "blue", "magenta"])
      // Playwright's `selectOption(…, null)` unselects; Strider's choices take no `null`, and `[]` unselects
      yield* page.locator("select").selectOption([])
      assert.deepEqual(yield* selectedValues(page), [])
    }))

  test("SO-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* makeMultiple(page)
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "black" }, { value: "magenta" }])
      yield* page.locator("select").selectOption([])
      assert.deepEqual(yield* selectedValues(page), [])
    }))

  test("SO-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* page.locator("select").selectOption([{ value: "blue" }, { value: "black" }, { value: "magenta" }])
      yield* page.locator("select").selectOption([])
      assert.deepEqual(yield* selectedValues(page), [])
    }))

  test("SO-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      // Playwright's `window.Event = null`: the page's own `Event` is replaced in the main world
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { Event: unknown }).Event = null
      })
      yield* page.locator("select").selectOption({ value: "blue" })
      yield* expectEvents(page, ["blue"], ["blue"])
    }))

  test("SO-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      const selection = yield* startWaiting(page.locator("select").selectOption({ value: "scarlet" }))
      yield* rafraf(page, 5)
      assert.isFalse(yield* selection.done)
      yield* addScarlet(page)
      yield* Fiber.join(selection.fiber)
      // Playwright also checks the values the call returned; Strider's call returns nothing, so the page's selection is
      // checked, which the returned values were
      assert.deepEqual(yield* selectedValues(page), ["scarlet"])
    }))

  test("SO-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      const length = yield* page.evaluateInMainWorld(() =>
        (document.querySelector("select") as HTMLSelectElement).options.length
      )
      const selection = yield* startWaiting(page.locator("select").selectOption({ index: length }))
      yield* rafraf(page, 5)
      assert.isFalse(yield* selection.done)
      yield* addScarlet(page)
      yield* Fiber.join(selection.fiber)
      assert.deepEqual(yield* selectedValues(page), ["scarlet"])
    }))

  test("SO-028", ({ page, server }) =>
    Effect.gen(function*() {
      yield* fixture(page, server)
      yield* makeMultiple(page)
      const selection = yield* startWaiting(
        page.locator("select").selectOption([{ value: "green" }, { value: "scarlet" }])
      )
      yield* rafraf(page, 5)
      assert.isFalse(yield* selection.done)
      yield* addScarlet(page)
      yield* Fiber.join(selection.fiber)
      assert.deepEqual(yield* selectedValues(page), ["green", "scarlet"])
    }))

  test("SO-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<body><script>
  const div = document.createElement('div');
  const shadowRoot = div.attachShadow({mode: 'open'});
  shadowRoot.innerHTML = \`<select>
    <option value="black">Black</option>
    <option value="blue">Blue</option>
  </select>\`;
  document.body.appendChild(div);
</script></body>`)
      // The listeners are added in the main world, where the page fires its events; the select sits in the shadow root
      yield* page.evaluateInMainWorld(() => {
        const globals = window as unknown as { firedBodyEvents: Array<string>; firedEvents: Array<string> }
        globals.firedBodyEvents = []
        globals.firedEvents = []
        for (const event of ["input", "change"]) {
          document.body.addEventListener(event, (e) => globals.firedBodyEvents.push(e.type + ":" + e.composed), false)
        }
        const host = document.querySelector("div") as HTMLDivElement
        const select = (host.shadowRoot as ShadowRoot).querySelector("select") as HTMLSelectElement
        for (const event of ["input", "change"]) {
          select.addEventListener(event, (e) => globals.firedEvents.push(e.type + ":" + e.composed), false)
        }
      })
      yield* page.locator("select").selectOption({ value: "blue" })
      assert.deepEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { firedEvents: unknown }).firedEvents),
        [
          "input:true",
          "change:false"
        ]
      )
      assert.deepEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { firedBodyEvents: unknown }).firedBodyEvents),
        [
          "input:true"
        ]
      )
    }))

  test("SO-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select disabled>
      <option>one</option>
      <option>two</option>
    </select>

    <script>
    function hydrate() {
      const select = document.querySelector('select');
      select.removeAttribute('disabled');
      select.addEventListener('change', () => {
        window['result'] = select.value;
      });
    }
    </script>
  `)
      const selection = yield* startWaiting(page.locator("select").selectOption({ value: "two" }))
      // Playwright's fixed one-second wait, as written
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => (window as unknown as { hydrate(): void }).hydrate())
      yield* Fiber.join(selection.fiber)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { result: unknown }).result),
        "two"
      )
      yield* Expect.toHaveValue(page.locator("select"), "two")
    }))

  test("SO-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select>
      <option>one</option>
      <option disabled id=myoption>two</option>
    </select>

    <script>
    function hydrate() {
      const option = document.querySelector('#myoption');
      option.removeAttribute('disabled');
      const select = document.querySelector('select');
      select.addEventListener('change', () => {
        window['result'] = select.value;
      });
    }
    </script>
  `)
      // Playwright's call times out on the disabled option. Strider's select check looks at the select alone, so the
      // call succeeds here, and the test fails on this first call, as the header says
      const error = yield* failureOf(
        page.locator("select").selectOption({ value: "two" }).pipe(Deadline.within("1 second"))
      )
      assert(Deadline.isTimeout(error), String(error))
      const selection = yield* startWaiting(page.locator("select").selectOption({ value: "two" }))
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => (window as unknown as { hydrate(): void }).hydrate())
      yield* Fiber.join(selection.fiber)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { result: unknown }).result),
        "two"
      )
      yield* Expect.toHaveValue(page.locator("select"), "two")
    }))

  test("SO-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select>
      <option>one</option>
      <optgroup label="Group" disabled id=mygroup>
        <option>two</option>
      </optgroup>
    </select>

    <script>
    function hydrate() {
      const group = document.querySelector('#mygroup');
      group.removeAttribute('disabled');
      const select = document.querySelector('select');
      select.addEventListener('change', () => {
        window['result'] = select.value;
      });
    }
    </script>
  `)
      // As SO-031: the option sits in a disabled optgroup, which Strider's select check doesn't look at
      const error = yield* failureOf(
        page.locator("select").selectOption({ value: "two" }).pipe(Deadline.within("1 second"))
      )
      assert(Deadline.isTimeout(error), String(error))
      const selection = yield* startWaiting(page.locator("select").selectOption({ value: "two" }))
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => (window as unknown as { hydrate(): void }).hydrate())
      yield* Fiber.join(selection.fiber)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { result: unknown }).result),
        "two"
      )
      yield* Expect.toHaveValue(page.locator("select"), "two")
    }))

  test("SO-033", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <select disabled>
      <option>one</option>
      <option>two</option>
    </select>

    <script>
    function hydrate() {
      const select = document.querySelector('select');
      select.remove();

      const newSelect = document.createElement('select');
      const option1 = document.createElement('option');
      option1.textContent = 'one';
      newSelect.appendChild(option1);
      const option2 = document.createElement('option');
      option2.textContent = 'two';
      newSelect.appendChild(option2);

      document.body.appendChild(newSelect);

      newSelect.addEventListener('change', () => {
        window['result'] = newSelect.value;
      });
    }
    </script>
  `)
      const selection = yield* startWaiting(page.locator("select").selectOption({ value: "two" }))
      yield* Effect.sleep("1 second")
      yield* page.evaluateInMainWorld(() => (window as unknown as { hydrate(): void }).hydrate())
      yield* Fiber.join(selection.fiber)
      yield* Expect.toHaveValue(page.locator("select"), "two")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { result: unknown }).result),
        "two"
      )
    }))
})
