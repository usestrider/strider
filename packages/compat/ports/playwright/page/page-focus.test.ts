/**
 * Playwright's `tests/page/page-focus.spec.ts`: focusing elements, the focus and blur events, and focus moving with Tab
 * within a page and between a page and its iframes.
 *
 * What the port changes:
 * - `page.focus(sel)` is `page.locator(sel).focus()`, and `page.keyboard.type` is `page.keyboard.pressSequentially`.
 *   `Shift+Tab`, `Alt+Tab`, and `Alt+Shift+Tab` are `press("Tab")` with the modifiers held, as Strider takes them.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A frame's element is read through
 *   `document.querySelector("iframe").contentDocument`, the frame being same-origin.
 * - FO-002 and FO-003 count the events through `page.exposeFunction` in the original, which Strider doesn't have. The
 *   port installs the same listeners in the page's main world, and each one sets a `window` flag the test reads back,
 *   as the exposed function's callback did. The events are the browser's: Strider's focus only fires them.
 * - `expect(locator).toBeFocused()` is `Expect.toBeFocused`. The original's `frameLocator(…).evaluate(e => e ===
 *   document.activeElement)` is a read of the frame's active element, so it's a main-world read of the iframe's document.
 * - `expect.soft` in FO-010 doesn't stop at a failed check, so the port collects each mismatch and fails the test at
 *   the end with all of them, as the original reports them.
 * - `page.goto(url)` returns at commit in Strider, so the navigation waits for `load`, which is Playwright's default.
 * - FO-006 is `browsers: ["webkit"]`: Playwright runs it on macOS WebKit only, where the setting it checks is on. The
 *   harness can't name the platform, so the port runs on whichever stock WebKit it is given.
 * - FO-007 to FO-009's `it.skip` and `it.fixme` on browsers other than the one they are written for are ported too, as
 *   the browsers' differences are what they measure.
 */
import { assert } from "@effect/vitest"
import { Expect, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** Whether the input in the page's iframe is the iframe document's active element. */
const innerFrameFocused = (page: Page.Page) =>
  page.evaluateInMainWorld(() => document.querySelector("iframe")!.contentDocument!.activeElement?.id === "inner")

upstream(import.meta.filename, {}, (test) => {
  test("FO-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id=d1 tabIndex=0></div>`)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.nodeName), "BODY")
      yield* page.locator("#d1").focus()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "d1")
    }))

  test("FO-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id=d1 tabIndex=0></div>`)
      // The exposed function's callback in the original: the test's own listener sets the flag
      yield* page.evaluateInMainWorld(() => {
        document.getElementById("d1")!.addEventListener("focus", () => Reflect.set(window, "focused", true))
      })
      yield* page.locator("#d1").focus()
      assert.isTrue(yield* page.evaluateInMainWorld(() => Reflect.get(window, "focused") === true))
    }))

  test("FO-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id=d1 tabIndex=0>DIV1</div><div id=d2 tabIndex=0>DIV2</div>`)
      yield* page.locator("#d1").focus()
      yield* page.evaluateInMainWorld(() => {
        document.getElementById("d1")!.addEventListener("blur", () => Reflect.set(window, "blurred", true))
        document.getElementById("d2")!.addEventListener("focus", () => Reflect.set(window, "focused", true))
      })
      yield* page.locator("#d2").focus()
      assert.isTrue(yield* page.evaluateInMainWorld(() => Reflect.get(window, "focused") === true))
      assert.isTrue(yield* page.evaluateInMainWorld(() => Reflect.get(window, "blurred") === true))
    }))

  test("FO-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id="i1"><input id="i2">`)
      yield* page.evaluateInMainWorld(() => {
        document.getElementById("i2")!.addEventListener("focus", () => Reflect.set(window, "focused", true))
      })
      yield* page.locator("#i1").focus()
      yield* page.keyboard.pressSequentially("First")
      yield* page.keyboard.press("Tab")
      yield* page.keyboard.pressSequentially("Last")

      assert.isTrue(yield* page.evaluateInMainWorld(() => Reflect.get(window, "focused") === true))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (document.getElementById("i1") as HTMLInputElement).value),
        "First"
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (document.getElementById("i2") as HTMLInputElement).value),
        "Last"
      )
    }))

  test("FO-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input value="1"><input value="2"><input value="3">`)
      const activeValue = () => page.evaluateInMainWorld(() => (document.activeElement as HTMLInputElement).value)
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* activeValue(), "1")
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* activeValue(), "2")
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* activeValue(), "3")
      yield* page.keyboard.press("Tab", { modifiers: ["Shift"] })
      assert.strictEqual(yield* activeValue(), "2")
      yield* page.keyboard.press("Tab", { modifiers: ["Shift"] })
      assert.strictEqual(yield* activeValue(), "1")
    }))

  test("FO-006", { browsers: ["webkit"] }, ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id="input-1">
    <button id="button">button</button>
    <a href id="link">link</a>
    <input id="input-2">
  `)
      const activeId = () => page.evaluateInMainWorld(() => document.activeElement?.id)
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* activeId(), "input-1")
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* activeId(), "input-2")
      yield* page.keyboard.press("Tab", { modifiers: ["Shift"] })
      assert.strictEqual(yield* activeId(), "input-1")
      yield* page.keyboard.press("Tab", { modifiers: ["Alt"] })
      assert.strictEqual(yield* activeId(), "button")
      yield* page.keyboard.press("Tab", { modifiers: ["Alt"] })
      assert.strictEqual(yield* activeId(), "link")
      yield* page.keyboard.press("Tab", { modifiers: ["Alt"] })
      assert.strictEqual(yield* activeId(), "input-2")
      yield* page.keyboard.press("Tab", { modifiers: ["Alt", "Shift"] })
      assert.strictEqual(yield* activeId(), "link")
      yield* page.keyboard.press("Tab", { modifiers: ["Alt", "Shift"] })
      assert.strictEqual(yield* activeId(), "button")
      yield* page.keyboard.press("Tab", { modifiers: ["Alt", "Shift"] })
      assert.strictEqual(yield* activeId(), "input-1")
    }))

  test("FO-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=checkbox></input>`)
      yield* page.locator("input").click()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.nodeName), "INPUT")
    }))

  test("FO-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label for="input1">input1</label>
    <input id="input1">
    <script>
    {
      window.focusEvents = [];
      const input = document.getElementById('input1');
      input.addEventListener('blur', () => focusEvents.push('blur'));
      input.addEventListener('focus', () => focusEvents.push('focus'));
    }
    </script>`)
      const focusEvents = () =>
        page.evaluateInMainWorld(() => (window as unknown as { focusEvents: Array<string> }).focusEvents)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.tagName), "BODY")
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "input1")
      assert.deepStrictEqual(yield* focusEvents(), ["focus"])
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.tagName), "BODY")
      assert.deepStrictEqual(yield* focusEvents(), ["focus", "blur"])
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "input1")
      assert.deepStrictEqual(yield* focusEvents(), ["focus", "blur", "focus"])
    }))

  test("FO-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id="input1">
    <input id="input2">
    <script>
      window.focusEvents = [];
      {
        const input = document.getElementById('input1');
        input.addEventListener('blur', () => focusEvents.push('blur1'));
        input.addEventListener('focus', () => focusEvents.push('focus1'));
      }
      {
        const input = document.getElementById('input2');
        input.addEventListener('blur', () => focusEvents.push('blur2'));
        input.addEventListener('focus', () => focusEvents.push('focus2'));
      }
    </script>`)
      const focusEvents = () =>
        page.evaluateInMainWorld(() => (window as unknown as { focusEvents: Array<string> }).focusEvents)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.tagName), "BODY")
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "input1")
      assert.deepStrictEqual(yield* focusEvents(), ["focus1"])
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "input2")
      assert.deepStrictEqual(yield* focusEvents(), ["focus1", "blur1", "focus2"])
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.tagName), "BODY")
      assert.deepStrictEqual(yield* focusEvents(), ["focus1", "blur1", "focus2", "blur2"])
      yield* page.keyboard.press("Tab")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "input1")
      assert.deepStrictEqual(yield* focusEvents(), ["focus1", "blur1", "focus2", "blur2", "focus1"])
    }))

  test("FO-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <div id="focusable" tabindex="0">focusable</div>
      <div id="non-focusable">not focusable</div>
      <script>
        window.eventLog = [];

        const focusable = document.getElementById("focusable");

        focusable.addEventListener('blur', () => window.eventLog.push('blur focusable'));
        focusable.addEventListener('focus', () => window.eventLog.push('focus focusable'));

        const nonFocusable = document.getElementById("non-focusable");
        nonFocusable.addEventListener('blur', () => window.eventLog.push('blur non-focusable'));
        nonFocusable.addEventListener('focus', () => window.eventLog.push('focus non-focusable'));
      </script>
    `)
      // The original's `expect.soft` checks all keep going after a mismatch, so each one is collected
      const mismatches: Array<string> = []
      const check = (what: string, actual: unknown, expected: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          mismatches.push(`${what}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
        }
      }
      yield* page.locator("#focusable").click()
      check(
        "focused after click",
        yield* page.evaluateInMainWorld(() => document.activeElement?.id),
        "focusable"
      )
      yield* page.locator("#non-focusable").focus()
      check(
        "focused after focusing a non-focusable element",
        yield* page.evaluateInMainWorld(() => document.activeElement?.id),
        "focusable"
      )
      check(
        "event log",
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "eventLog")),
        ["focus focusable"]
      )
      assert.deepStrictEqual(mismatches, [])
    }))

  test("FO-011", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frame.html", (_request, response) => {
        response.setHeader("content-type", "text/html")
        response.end(`<input id=inner>`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<iframe src="${server.PREFIX}/frame.html"></iframe><input id=outer>`)
      const inner = page.frame(page.locator("iframe")).locator("#inner")
      yield* inner.focus()
      assert.isTrue(yield* innerFrameFocused(page))
      yield* page.evaluateInMainWorld(() => (document.getElementById("outer") as HTMLInputElement).focus())
      yield* Expect.toBeFocused(page.locator("#outer"))
      assert.isFalse(yield* innerFrameFocused(page))
    }))

  test("FO-012", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frame.html", (_request, response) => {
        response.setHeader("content-type", "text/html")
        response.end(`<input id=inner>`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<iframe src="${server.PREFIX}/frame.html"></iframe><input id=outer>`)
      yield* page.frame(page.locator("iframe")).locator("#inner").click()
      assert.isTrue(yield* innerFrameFocused(page))
      yield* page.keyboard.press("Tab")
      yield* Expect.toBeFocused(page.locator("#outer"))
    }))

  test("FO-013", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frame.html", (_request, response) => {
        response.setHeader("content-type", "text/html")
        response.end(`<input id=inner>`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<iframe src="${server.PREFIX}/frame.html"></iframe><input id=outer>`)
      yield* page.locator("#outer").focus()
      yield* Expect.toBeFocused(page.locator("#outer"))
      // Call native focus() exactly once, locator.focus() would hide the bug by calling it twice.
      yield* page.evaluateInMainWorld(() =>
        (document.querySelector("iframe")!.contentDocument!.querySelector("input") as HTMLInputElement).focus()
      )
      yield* Expect.toBeFocused(page.locator("iframe"))
      yield* Expect.toBeFocused(page.frame(page.locator("iframe")).locator("#inner"))
    }))
})
