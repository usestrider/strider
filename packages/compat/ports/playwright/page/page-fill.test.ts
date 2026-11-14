/**
 * Playwright's `tests/page/page-fill.spec.ts`: filling inputs, textareas, and contenteditable elements, and the waits
 * and refusals around that.
 *
 * What the port changes:
 * - `page.fill(selector, value)` is `page.locator(selector).fill(value)`. Playwright's `page.$eval` reads and writes
 *   are the page's own DOM, which the port reaches through `page.evaluateInMainWorld`. A read Strider has a locator
 *   for (`readValue`, `readText`, `readAttribute`) is that read.
 * - Playwright's `page.evaluate` runs in the main world, so the page's `window.result` and the other page globals are
 *   read with `evaluateInMainWorld`. Strider has no `innerText` reader; FI-015 reads the page's own `innerText` in the
 *   main world.
 * - A refusal is a `LocatorError` whose typed reason is asserted, not its message: FI-003 and FI-018 are `NotEditable`,
 *   FI-019 and FI-029 are `InvalidInput`.
 * - FI-036's timeout is a `Deadline.Timeout` naming `Locator.fill`, whose reason is in `last`, as the click timeout
 *   ports assert it. The original's message check on `Timeout 1000ms exceeded` is the timeout's budget, which the port
 *   asserts; its "element is inert" check is the `Inert` reason in `last`, since Strider's message doesn't repeat it.
 * - `giveItAChanceToFill` is `rafraf(page, 5)`. A fill the original holds across steps is `startWaiting`, joined when
 *   the original awaits it.
 * - `expect(locator).toHaveText` and `toHaveValue` wait five seconds, Playwright's `expect` timeout, under
 *   `Deadline.within`.
 * - FI-009 is one test per input type, each a `variant`. The original skips month and week everywhere but Chromium,
 *   so those two variants run on Chromium only (`browsers`). The other five variants of the key run on every browser,
 *   so the report counts the key as run on each, and no ledger entry is needed.
 * - FI-003, FI-004 loop over input types inside one test, as the original does. Each case runs, and the one failure
 *   names every case that failed, so one type doesn't hide another.
 * - Playwright's `it.fixme` on Firefox without BiDi (FI-015, FI-016) doesn't apply: Strider drives Firefox over BiDi.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, Locator, type Page, PageNavigation } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, rafraf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The `window.result` the test page's script sets on each input. */
const result = (page: Page.Page) => page.evaluateInMainWorld(() => (window as unknown as { result: string }).result)

/** The reason of a locator operation's typed failure. */
const reasonOf = (error: unknown) => {
  assert(Locator.isLocatorError(error), String(error))
  return error.reason
}

/**
 * Runs each case of an upstream loop, then fails once, naming each case that failed and its first error line, so one
 * failing case doesn't hide the rest.
 */
const eachCase = <T, R>(
  cases: ReadonlyArray<T>,
  name: (value: T) => string,
  run: (value: T) => Effect.Effect<void, unknown, R>
): Effect.Effect<void, unknown, R> =>
  Effect.gen(function*() {
    const failed: Array<string> = []
    for (const value of cases) {
      const exit = yield* Effect.exit(run(value))
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        const line = error instanceof Error ? error.message.split("\n")[0] : String(error)
        failed.push(`${name(value)}: ${line}`)
      }
    }
    assert.deepStrictEqual(failed, [], "the cases that failed")
  })

const setInputType = (page: Page.Page, type: string) =>
  page.evaluateInMainWorld((type) => {
    document.querySelector("input")!.setAttribute("type", type)
  }, type)

upstream(import.meta.filename, {}, (test) => {
  test("FI-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").fill("some value")
      assert.strictEqual(yield* result(page), "some value")
    }))

  test("FI-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* result(page), "some value")
    }))

  test("FI-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      const types = ["button", "checkbox", "file", "image", "radio", "reset", "submit"]
      yield* eachCase(types, (type) => type, (type) =>
        Effect.gen(function*() {
          yield* setInputType(page, type)
          const error = yield* failureOf(page.locator("input").fill(""), `the fill of ${type}`)
          // Playwright's message says the type can't be filled; Strider's reason is the typed refusal
          assert.strictEqual(reasonOf(error)._tag, "NotEditable")
        }))
    }))

  test("FI-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      const types = ["password", "search", "tel", "text", "url", "invalid-type"]
      yield* eachCase(types, (type) => type, (type) =>
        Effect.gen(function*() {
          yield* setInputType(page, type)
          yield* page.locator("input").fill("text " + type)
          assert.strictEqual(yield* result(page), "text " + type)
        }))
    }))

  test("FI-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=range min=0 max=100 value=50>")
      yield* page.locator("input").fill("42")
      assert.strictEqual(yield* page.locator("input").readValue, "42")
      // Valid numbers that the browser may serialize differently.
      for (const [value, expected] of [["42.0", 42], ["1e1", 10]] as const) {
        yield* page.locator("input").fill(value)
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() => (document.querySelector("input") as HTMLInputElement).valueAsNumber),
          expected
        )
      }
    }))

  test("FI-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=color value=\"#e66465\">")
      yield* page.locator("input").fill("#aaaaaa")
      assert.strictEqual(yield* page.locator("input").readValue, "#aaaaaa")
    }))

  test("FI-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=color value=\"#e66465\">")
      yield* page.locator("input").fill("#AbCd00")
      // Playwright's WebKit-on-Windows branch doesn't apply here: the value is lowercased
      assert.strictEqual(yield* page.locator("input").readValue, "#abcd00")
    }))

  test("FI-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=date>")
      yield* page.locator("input").click()
      yield* page.locator("input").fill("2020-03-02")
      assert.strictEqual(yield* page.locator("input").readValue, "2020-03-02")
    }))

  // Playwright skips month and week on every browser but Chromium
  const shadowTypes: ReadonlyArray<readonly [type: string, value: string, browsers?: ReadonlyArray<"chromium">]> = [
    ["color", "#aaaaaa"],
    ["date", "2020-03-02"],
    ["time", "13:15"],
    ["datetime-local", "2020-03-02T13:15:30"],
    ["month", "2020-03", ["chromium"]],
    ["range", "42"],
    ["week", "2020-W50", ["chromium"]]
  ]
  for (const [type, value, browsers] of shadowTypes) {
    test("FI-009", { variant: type, browsers }, ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.setContent(`<body><script>
    const div = document.createElement('div');
    const shadowRoot = div.attachShadow({mode: 'open'});
    shadowRoot.innerHTML = '<input type=${type}></input>';
    document.body.appendChild(div);
  </script></body>`)
        // Playwright adds these listeners in the main world: one on the body, one on the input in the shadow root
        yield* page.evaluateInMainWorld(() => {
          const state = window as unknown as { firedEvents: Array<string>; firedBodyEvents: Array<string> }
          state.firedBodyEvents = []
          for (const event of ["input", "change"]) {
            document.body.addEventListener(event, (e) => state.firedBodyEvents.push(`${e.type}:${e.composed}`), false)
          }
          state.firedEvents = []
          const input = document.querySelector("div")!.shadowRoot!.querySelector("input")!
          for (const event of ["input", "change"]) {
            input.addEventListener(event, (e) => state.firedEvents.push(`${e.type}:${e.composed}`), false)
          }
        })
        yield* page.locator("input").fill(value)
        const events = yield* page.evaluateInMainWorld(() => {
          const state = window as unknown as { firedEvents: Array<string>; firedBodyEvents: Array<string> }
          return { input: state.firedEvents, body: state.firedBodyEvents }
        })
        assert.deepStrictEqual(events.input, ["input:true", "change:false"])
        assert.deepStrictEqual(events.body, ["input:true"])
      }))
  }

  test("FI-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=time>")
      yield* page.locator("input").fill("13:15")
      assert.strictEqual(yield* page.locator("input").readValue, "13:15")
    }))

  test("FI-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=month>")
      yield* page.locator("input").fill("2020-07")
      assert.strictEqual(yield* page.locator("input").readValue, "2020-07")
    }))

  test("FI-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=week>")
      yield* page.locator("input").fill("2020-W50")
      assert.strictEqual(yield* page.locator("input").readValue, "2020-W50")
    }))

  test("FI-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=datetime-local>")
      yield* page.locator("input").fill("2020-03-02T05:15")
      assert.strictEqual(yield* page.locator("input").readValue, "2020-03-02T05:15")
      // The browser omits zero seconds
      yield* page.locator("input").fill("2020-03-02T06:20:00")
      assert.strictEqual(yield* page.locator("input").readValue, "2020-03-02T06:20")
    }))

  test("FI-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("div[contenteditable]").fill("some value")
      assert.strictEqual(yield* page.locator("div[contenteditable]").readText, "some value")
    }))

  test("FI-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<div contenteditable="true"></div>`)
      yield* page.locator("div[contenteditable]").fill("John\nDoe")
      // innerText depends on layout, so Strider has no reader for it; the page's own is read in the main world
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          (document.querySelector("div[contenteditable]") as HTMLElement).innerText
        ),
        "John\nDoe"
      )
    }))

  test("FI-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div id="editor" contenteditable="true"></div>
    <script>
      const editor = document.getElementById('editor');
      editor.addEventListener('beforeinput', (event) => {
        event.preventDefault();
        editor.textContent = event.data;
      });
    </script>
  `)
      yield* page.locator("#editor").fill("Playwright")
      yield* page.locator("#editor").pipe(Expect.toHaveText("Playwright"), Deadline.within("5 seconds"))
    }))

  test("FI-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).value = "value one"
      })
      yield* page.locator("input").fill("another value")
      assert.strictEqual(yield* result(page), "another value")

      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input") as HTMLInputElement
        input.selectionStart = 1
        input.selectionEnd = 2
      })
      yield* page.locator("input").fill("maybe this one")
      assert.strictEqual(yield* result(page), "maybe this one")

      yield* page.evaluateInMainWorld(() => {
        const div = document.querySelector("div[contenteditable]")!
        div.innerHTML = "some text <span>some more text<span> and even more text"
        const range = document.createRange()
        range.selectNodeContents(div.querySelector("span")!)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
      })
      yield* page.locator("div[contenteditable]").fill("replace with this")
      assert.strictEqual(yield* page.locator("div[contenteditable]").readText, "replace with this")
    }))

  test("FI-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<select><option>value1</option></select>`)
      const error = yield* failureOf(page.locator("select").fill(""), "the fill")
      assert.strictEqual(reasonOf(error)._tag, "NotEditable")
    }))

  test("FI-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      // @ts-expect-error Deliberate caller validation: fill only accepts string values
      const error = yield* failureOf(page.locator("textarea").fill(123), "the fill")
      assert.strictEqual(reasonOf(error)._tag, "InvalidInput")
    }))

  test("FI-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).disabled = true
      })
      const waiting = yield* startWaiting(page.locator("input").fill("some value"))
      yield* rafraf(page, 5)
      assert.isFalse(yield* waiting.done)
      assert.strictEqual(yield* result(page), "")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).disabled = false
      })
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* result(page), "some value")
    }))

  test("FI-021", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("textarea") as HTMLTextAreaElement).readOnly = true
      })
      const waiting = yield* startWaiting(page.locator("textarea").fill("some value"))
      yield* rafraf(page, 5)
      assert.isFalse(yield* waiting.done)
      assert.strictEqual(yield* result(page), "")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("textarea") as HTMLTextAreaElement).readOnly = false
      })
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* result(page), "some value")
    }))

  test("FI-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).style.display = "none"
      })
      const waiting = yield* startWaiting(page.locator("input").fill("some value"))
      yield* rafraf(page, 5)
      assert.isFalse(yield* waiting.done)
      assert.strictEqual(yield* result(page), "")
      yield* page.evaluateInMainWorld(() => {
        ;(document.querySelector("input") as HTMLInputElement).style.display = "inline"
      })
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* result(page), "some value")
    }))

  test("FI-023", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<body contentEditable="true"></body>`)
      yield* page.locator("body").fill("some value")
      assert.strictEqual(yield* page.locator("body").readText, "some value")
    }))

  test("FI-024", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input style='position: fixed;' />`)
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* page.locator("input").readValue, "some value")
    }))

  test("FI-025", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div contentEditable="true"></div>
    <iframe srcdoc="<body contenteditable><p>old</p></body>"></iframe>
  `)
      yield* page.locator("iframe").focus()
      yield* page.locator("div").fill("some value")
      assert.strictEqual(yield* page.locator("div").readText, "some value")
      const paragraph = page.frame(page.locator("iframe")).locator("p")
      yield* paragraph.fill("new")
      yield* paragraph.pipe(Expect.toHaveText("new"), Deadline.within("5 seconds"))
    }))

  test("FI-026", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id="input" type="number"></input>`)
      yield* page.locator("input").fill("42")
      assert.strictEqual(yield* page.locator("input").readValue, "42")
    }))

  test("FI-027", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id="input" type="number"></input>`)
      yield* page.locator("input").fill("-10e5")
      assert.strictEqual(yield* page.locator("input").readValue, "-10e5")
    }))

  test("FI-028", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id="input" type="number" value="123"></input>`)
      yield* page.locator("input").fill("")
      assert.strictEqual(yield* page.locator("input").readValue, "")
    }))

  test("FI-029", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id="input" type="number"></input>`)
      const error = yield* failureOf(page.locator("input").fill("abc"), "the fill")
      // Strider's typed refusal: text is not a number, which Playwright's message calls "text into input[type=number]"
      assert.strictEqual(reasonOf(error)._tag, "InvalidInput")
    }))

  test("FI-030", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("input").fill("some value")
      assert.strictEqual(yield* result(page), "some value")
      yield* page.locator("input").fill("")
      assert.strictEqual(yield* result(page), "")
    }))

  test("FI-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.setContent("<input type=date>")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("input")!.addEventListener("input", () => {
          window.location.href = "/empty.html"
        })
      })
      // The navigation is watched before the fill starts, as Playwright's waitForNavigation is
      const navigation = yield* PageNavigation.next(page)
      yield* page.locator("input").fill("2020-03-02")
      yield* navigation
      assert.include(yield* page.url, "empty.html")
    }))

  test("FI-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id="one"></input><input id="two"></input>`)
      yield* page.locator("#one").fill("first value")
      yield* page.locator("#two").fill("second value")
      yield* page.locator("#one").pipe(Expect.toHaveValue("first value"), Deadline.within("5 seconds"))
      yield* page.locator("#two").pipe(Expect.toHaveValue("second value"), Deadline.within("5 seconds"))
    }))

  test("FI-033", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div contenteditable="true">initial text</div>
    <script>
      const editor = document.querySelector('[contenteditable]');
      editor.addEventListener('focus', () => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0)
          selection.collapseToEnd();
      });
    </script>
  `)
      yield* page.locator("div[contenteditable]").fill("some value")
      assert.strictEqual(yield* page.locator("div[contenteditable]").readText, "some value")
    }))

  test("FI-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div inert id=container>
      <input id=target>
    </div>
    <input id=outside>
  `)
      yield* page.locator("#outside").focus()
      const waiting = yield* startWaiting(page.locator("#target").fill("some value"))
      yield* rafraf(page, 5)
      assert.isFalse(yield* waiting.done)
      assert.strictEqual(yield* page.locator("#target").readValue, "")
      assert.strictEqual(yield* page.locator("#outside").readValue, "")
      yield* page.evaluateInMainWorld(() => document.getElementById("container")!.removeAttribute("inert"))
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* page.locator("#target").readValue, "some value")
      assert.strictEqual(yield* page.locator("#outside").readValue, "")
    }))

  test("FI-035", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id=target>
    <dialog id=dialog><input id=inside></dialog>
    <script>
      document.getElementById('dialog').showModal();
    </script>
  `)
      yield* page.locator("#inside").fill("inside value")
      assert.strictEqual(yield* page.locator("#inside").readValue, "inside value")
      const waiting = yield* startWaiting(page.locator("#target").fill("some value"))
      yield* rafraf(page, 5)
      assert.isFalse(yield* waiting.done)
      assert.strictEqual(yield* page.locator("#target").readValue, "")
      yield* page.evaluateInMainWorld(() => (document.getElementById("dialog") as HTMLDialogElement).close())
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* page.locator("#target").readValue, "some value")
    }))

  test("FI-036", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div inert><input></div>`)
      const timeout = yield* failureOf(
        page.locator("input").fill("some value").pipe(Deadline.within("1 second")),
        "the fill"
      )
      assert(Deadline.isTimeout(timeout), String(timeout))
      assert.strictEqual(timeout.operation, "Locator.fill")
      // Playwright's "Timeout 1000ms exceeded": the budget is the one given, counted from when the fill starts
      assert.isAtMost(Duration.toMillis(timeout.budget), 1000)
      assert.isAbove(Duration.toMillis(timeout.budget), 500)
      const last = Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as { _tag: string }))
      assert.strictEqual(last?._tag, "Inert")
      // Playwright's "element is inert" is the reason the timeout's `last` carries; the message names only the operation
    }))
})
