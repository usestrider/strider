/**
 * Playwright's `tests/page/page-keyboard.spec.ts`: keys pressed and held, characters typed, what the page sees of each
 * key event, text inserted without key events, clipboard and undo shortcuts, and keys that reach a page's controls.
 *
 * What the port changes:
 * - Playwright's key strings are Strider's keys and modifiers. `"Shift+~"` is `press("~", { modifiers: ["Shift"] })`,
 *   and `"ControlOrMeta+KeyA"` is `press("a", { modifiers: [controlOrMeta] })`: Strider has no `"Control+A"` syntax,
 *   and a key's name is its key value (`"a"`, `"#"`, `" "`), not Playwright's physical `code` (`"KeyA"`, `"Digit3"`,
 *   `"Space"`). The `code` the page sees is the one the layout gives the key (`Digit3` for `#` on `us`).
 * - `ControlOrMeta` is `Meta` on macOS and `Control` elsewhere, by the host's platform, as Playwright chooses it.
 * - `keyboard.down(key)` and `keyboard.up(key)` are `keyboard.hold(key)` and the held key's `release` (`down` and `up`
 *   below), `mouse.down` and `mouse.up` the same for a button, and `keyboard.type` and `locator.type` are
 *   `pressSequentially`. A key still held when a test fails is released as the test's scope closes.
 * - `page.evaluate` runs in the page's main world, so the keyboard.html log (`getResult()`), the page's globals and
 *   listeners the test adds are read and set with `page.evaluateInMainWorld`. The listeners are the test's own, as
 *   the original's are; the page's scripts are not changed.
 * - `page.$eval` and `page.$` reads are `locator.readValue` and `locator.readText`. `readText` collapses whitespace
 *   where Playwright's `textContent` doesn't; the texts these tests compare have none to collapse.
 * - `expect.poll` is `Expect.that`, and the original's matchers are Strider's `Expect` matchers.
 * - Playwright's `it.info().annotations` (its issue links) are the file's references, not assertions, and are dropped.
 * - KB-033 and KB-040 run only on macOS in the original (`it.skip(platform !== 'darwin')`), and this harness runs on
 *   Linux, so they are not ported; the ledger records them as macOS-only.
 * - KB-049 types into a non-focusable element with `locator.pressSequentially`, as the original's `locator.type`, and
 *   the focused element stays the one focused before.
 * - KB-053's `dialog.evaluate(showModal)` is a page-state write in the main world, and `toHaveJSProperty('open', …)` is
 *   a poll of the dialog's `open` property there.
 * - KB-021 to KB-026 are not ported: they name keys by their physical code and location (`ControlRight`, `Numpad1`,
 *   `NumpadEnter`, `AudioVolumeMute`), which Strider's key values don't express (see the ledger).
 * - KB-037 (`keyIdentifier`) runs only on WebKit, as the original's `it.skip(browserName !== 'webkit')` does.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, Keyboard, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attachFrame, failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `ControlOrMeta`: Meta on macOS and Control elsewhere, by the platform the test runs on. */
const controlOrMeta: Keyboard.Modifier = process.platform === "darwin" ? "Meta" : "Control"

/** The text keyboard.html logged since it was last read: its `getResult()`. */
const keyLog = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { getResult(): string }).getResult())

/** A global of the page, read in its main world. */
const pageGlobal = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name: string) => (window as unknown as Record<string, unknown>)[name], name)

/** Playwright's `keyboard.down(key)`: holds the key until `up` releases it, or the test's scope closes. */
const down = (page: Page.Page, key: string) => page.keyboard.hold(key)

/** Playwright's `keyboard.up(key)` for a key `down` held. */
const up = (held: Keyboard.HeldKey) => held.release

/** The mouse button `down` holds, as Playwright's `mouse.down({ button })`, until `up` releases it. */
const holdButton = (page: Page.Page, button: "left" | "right" | "middle") => page.mouse.hold(button)

/** The `keydown` the test's own listener recorded last, as Playwright's `captureLastKeydown` handle reads it. */
interface LastKeydown {
  readonly repeat: boolean
  readonly location: number
  readonly code: string
  readonly key: string
  readonly metaKey: boolean
  readonly keyIdentifier: string | false
}

/** Installs the listener that records the last `keydown` on the document, as the original's `captureLastKeydown` does. */
const captureLastKeydown = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    const lastEvent = {
      repeat: false,
      location: -1,
      code: "",
      key: "",
      metaKey: false,
      keyIdentifier: "unsupported" as string | false
    }
    ;(window as unknown as { lastKeydown: unknown }).lastKeydown = lastEvent
    document.addEventListener("keydown", (e) => {
      lastEvent.repeat = e.repeat
      lastEvent.location = e.location
      lastEvent.key = e.key
      lastEvent.code = e.code
      lastEvent.metaKey = e.metaKey
      lastEvent.keyIdentifier = "keyIdentifier" in e &&
        typeof (e as unknown as { keyIdentifier: unknown }).keyIdentifier === "string" &&
        (e as unknown as { keyIdentifier: string }).keyIdentifier
    }, true)
  })

const lastKeydown = (page: Page.Page) => pageGlobal(page, "lastKeydown") as Effect.Effect<LastKeydown, never, never>

/** Polls `subject` until it holds `expected`, as Playwright's `expect.poll(…).toEqual(…)` does. */
const pollEqual = <A>(subject: Effect.Effect<A, unknown, never>, expected: A) =>
  Expect.that(
    subject,
    Condition.make(
      `equal ${JSON.stringify(expected)}`,
      (actual: A) => JSON.stringify(actual) === JSON.stringify(expected)
    )
  )

/** Installs a `click` listener on the element that records it on `window.actual`, as the original's handle does. */
const recordClicks = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld((selector: string) => {
    const actual = { clicked: false }
    ;(window as unknown as { actual: unknown }).actual = actual
    document.querySelector(selector)!.addEventListener("click", () => (actual.clicked = true))
  }, selector)

const clicked = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { actual: { clicked: boolean } }).actual.clicked)

/** The page the shadow-DOM tests load: a custom element whose shadow root holds `inner`. */
const shadowEditors = (inner: string) => `
    <html>
      <body>
        <shadow-element></shadow-element>
        <script>
          customElements.define('shadow-element', class extends HTMLElement {
            constructor() {
              super();
              this.attachShadow({ mode: 'open' });
            }

            connectedCallback() {
              this.shadowRoot.innerHTML = \`
                <style>
                  .editor { padding: 1rem; margin: 1rem; border: 1px solid #ccc; }
                </style>
                ${inner}
              \`;
            }
          });
        </script>
      </body>
    </html>
  `

// The file names its browsers so that the ledger's scan, which reads the first `browsers:` in a port, finds this one and
// not KB-037's.
upstream(import.meta.filename, { browsers: ["chromium", "firefox", "webkit"] }, (test) => {
  test("KB-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const textarea = document.createElement("textarea")
        document.body.appendChild(textarea)
        textarea.focus()
      })
      const text = "Hello world. I am the text that was typed!"
      yield* page.keyboard.pressSequentially(text)
      assert.strictEqual(yield* page.locator("textarea").readValue, text)
    }))

  test("KB-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").pressSequentially("Hello World!")
      assert.strictEqual(yield* page.locator("textarea").readValue, "Hello World!")
      for (let i = 0; i < "World!".length; i++) yield* page.keyboard.press("ArrowLeft")
      yield* page.keyboard.pressSequentially("inserted ")
      assert.strictEqual(yield* page.locator("textarea").readValue, "Hello inserted World!")
      const shift = yield* down(page, "Shift")
      for (let i = 0; i < "inserted ".length; i++) yield* page.keyboard.press("ArrowLeft")
      yield* up(shift)
      yield* page.keyboard.press("Backspace")
      assert.strictEqual(yield* page.locator("textarea").readValue, "Hello World!")
    }))

  test("KB-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      const textarea = page.locator("textarea")
      yield* textarea.press("a")
      assert.strictEqual(yield* textarea.readValue, "a")
      yield* page.evaluateInMainWorld(() => window.addEventListener("keydown", (e) => e.preventDefault(), true))
      yield* textarea.press("b")
      assert.strictEqual(yield* textarea.readValue, "a")
    }))

  test("KB-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      yield* page.keyboard.insertText("嗨")
      assert.strictEqual(yield* page.locator("textarea").readValue, "嗨")
      yield* page.evaluateInMainWorld(() => window.addEventListener("keydown", (e) => e.preventDefault(), true))
      yield* page.keyboard.insertText("a")
      assert.strictEqual(yield* page.locator("textarea").readValue, "嗨a")
    }))

  test("KB-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input><textarea></textarea><div contenteditable></div>`)
      for (const locator of [page.locator("input"), page.locator("textarea"), page.locator("div")]) {
        // Alt-chords type nothing, where Playwright's `Alt+KeyA`, `Alt+Digit1` and `Alt+Shift+KeyA` are keys by code
        yield* locator.press("a", { modifiers: ["Alt"] })
        yield* locator.press("1", { modifiers: ["Alt"] })
        yield* locator.press("a", { modifiers: ["Alt", "Shift"] })
        const alt = yield* down(page, "Alt")
        yield* page.keyboard.press("b")
        yield* up(alt)
        yield* locator.press("c")
      }
      yield* Expect.toHaveValue(page.locator("input"), "c")
      yield* Expect.toHaveValue(page.locator("textarea"), "c")
      yield* Expect.toHaveText(page.locator("div"), "c")
    }))

  test("KB-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      // Playwright's `page.on("console")` only logged what the page wrote, and is not ported
      yield* page.evaluateInMainWorld(() => {
        const events: Array<string> = []
        ;(window as unknown as { events: Array<string> }).events = events
        document.addEventListener("keydown", (e) => events.push(e.type))
        document.addEventListener("keyup", (e) => events.push(e.type))
        document.addEventListener("keypress", (e) => events.push(e.type))
        document.addEventListener("input", (e) => events.push(e.type))
      })
      yield* page.keyboard.insertText("hello world")
      assert.deepStrictEqual(yield* pageGlobal(page, "events"), ["input"])
    }))

  test("KB-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input>`)
      yield* page.evaluateInMainWorld(() => {
        const events: Array<string> = []
        ;(window as unknown as { events: Array<string> }).events = events
        for (const type of ["keydown", "keypress", "textInput", "input", "keyup"]) {
          document.querySelector("input")!.addEventListener(type, () => events.push(type))
        }
      })
      yield* page.locator("input").focus()
      yield* page.keyboard.press("f")
      assert.deepStrictEqual(yield* pageGlobal(page, "events"), ["keydown", "keypress", "textInput", "input", "keyup"])
    }))

  // Playwright skips this on Firefox over Juggler, which dispatches keydown and keypress in one task. Strider's Firefox
  // is WebDriver BiDi, so the skip doesn't apply and the test runs there.
  test("KB-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input>`)
      yield* page.evaluateInMainWorld(() => {
        const log: Array<string> = []
        ;(window as unknown as { log: Array<string> }).log = log
        const input = document.querySelector("input")!
        for (const type of ["keydown", "keypress"]) {
          input.addEventListener(type, () => {
            log.push(type)
            queueMicrotask(() => log.push("microtask-" + type))
          })
        }
        input.focus()
      })
      yield* page.keyboard.press("a")
      // A microtask scheduled in the keydown handler must run before keypress,
      // proving each event is delivered in its own task rather than synchronously.
      assert.deepStrictEqual(yield* pageGlobal(page, "log"), [
        "keydown",
        "microtask-keydown",
        "keypress",
        "microtask-keypress"
      ])
    }))

  test("KB-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      for (const modifierKey of ["Shift", "Alt", "Control"] as const) {
        const modifier = yield* down(page, modifierKey)
        assert.strictEqual(
          yield* keyLog(page),
          "Keydown: " + modifierKey + " " + modifierKey + "Left LEFT [" + modifierKey + "]"
        )
        const bang = yield* down(page, "!")
        // Shift+! will generate a keypress
        if (modifierKey === "Shift") {
          assert.strictEqual(
            yield* keyLog(page),
            "Keydown: ! Digit1 STANDARD [" + modifierKey + "]\nKeypress: ! Digit1 STANDARD 33 [" + modifierKey + "]"
          )
        } else {
          assert.strictEqual(yield* keyLog(page), "Keydown: ! Digit1 STANDARD [" + modifierKey + "]")
        }
        yield* up(bang)
        assert.strictEqual(yield* keyLog(page), "Keyup: ! Digit1 STANDARD [" + modifierKey + "]")
        yield* up(modifier)
        assert.strictEqual(yield* keyLog(page), "Keyup: " + modifierKey + " " + modifierKey + "Left LEFT []")
      }
    }))

  test("KB-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      const control = yield* down(page, "Control")
      assert.strictEqual(yield* keyLog(page), "Keydown: Control ControlLeft LEFT [Control]")
      const alt = yield* down(page, "Alt")
      assert.strictEqual(yield* keyLog(page), "Keydown: Alt AltLeft LEFT [Alt Control]")
      const semicolon = yield* down(page, ";")
      assert.strictEqual(yield* keyLog(page), "Keydown: ; Semicolon STANDARD [Alt Control]")
      yield* up(semicolon)
      assert.strictEqual(yield* keyLog(page), "Keyup: ; Semicolon STANDARD [Alt Control]")
      yield* up(control)
      assert.strictEqual(yield* keyLog(page), "Keyup: Control ControlLeft LEFT [Alt]")
      yield* up(alt)
      assert.strictEqual(yield* keyLog(page), "Keyup: Alt AltLeft LEFT []")
    }))

  test("KB-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      yield* page.keyboard.pressSequentially("!")
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: ! Digit1 STANDARD []",
          "Keypress: ! Digit1 STANDARD 33 []",
          "Keyup: ! Digit1 STANDARD []"
        ].join("\n")
      )
      yield* page.keyboard.pressSequentially("^")
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: ^ Digit6 STANDARD []",
          "Keypress: ^ Digit6 STANDARD 94 []",
          "Keyup: ^ Digit6 STANDARD []"
        ].join("\n")
      )
    }))

  test("KB-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      const shift = yield* down(page, "Shift")
      yield* page.keyboard.pressSequentially("~")
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: Shift ShiftLeft LEFT [Shift]",
          "Keydown: ~ Backquote STANDARD [Shift]",
          "Keypress: ~ Backquote STANDARD 126 [Shift]",
          "Keyup: ~ Backquote STANDARD [Shift]"
        ].join("\n")
      )
      yield* up(shift)
    }))

  test("KB-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener("keydown", (event) => {
          event.stopPropagation()
          event.stopImmediatePropagation()
          if (event.key === "l") event.preventDefault()
          if (event.key === "o") event.preventDefault()
        }, false)
      })
      yield* page.keyboard.pressSequentially("Hello World!")
      assert.strictEqual(yield* page.locator("textarea").readValue, "He Wrd!")
    }))

  test("KB-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      yield* page.keyboard.press("+")
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: + Equal STANDARD []",
          "Keypress: + Equal STANDARD 43 []",
          "Keyup: + Equal STANDARD []"
        ].join("\n")
      )
    }))

  test("KB-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      // Playwright's "Shift++" is the plus key with Shift held
      yield* page.keyboard.press("+", { modifiers: ["Shift"] })
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: Shift ShiftLeft LEFT [Shift]",
          "Keydown: + Equal STANDARD [Shift]",
          "Keypress: + Equal STANDARD 43 [Shift]",
          "Keyup: + Equal STANDARD [Shift]",
          "Keyup: Shift ShiftLeft LEFT []"
        ].join("\n")
      )
    }))

  test("KB-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      yield* page.keyboard.press("~", { modifiers: ["Shift"] })
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: Shift ShiftLeft LEFT [Shift]",
          "Keydown: ~ Backquote STANDARD [Shift]",
          "Keypress: ~ Backquote STANDARD 126 [Shift]",
          "Keyup: ~ Backquote STANDARD [Shift]",
          "Keyup: Shift ShiftLeft LEFT []"
        ].join("\n")
      )
    }))

  test("KB-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      yield* page.keyboard.press("~", { modifiers: ["Control", "Shift"] })
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: Control ControlLeft LEFT [Control]",
          "Keydown: Shift ShiftLeft LEFT [Control Shift]",
          "Keydown: ~ Backquote STANDARD [Control Shift]",
          "Keyup: ~ Backquote STANDARD [Control Shift]",
          "Keyup: Shift ShiftLeft LEFT [Control]",
          "Keyup: Control ControlLeft LEFT []"
        ].join("\n")
      )
    }))

  test("KB-018", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      // Playwright's "Shift+Digit3" names the key by its code, and the layout types that key as "#" with Shift held
      yield* page.keyboard.press("#", { modifiers: ["Shift"] })
      assert.strictEqual(
        yield* keyLog(page),
        [
          "Keydown: Shift ShiftLeft LEFT [Shift]",
          "Keydown: # Digit3 STANDARD [Shift]",
          "Keypress: # Digit3 STANDARD 35 [Shift]",
          "Keyup: # Digit3 STANDARD [Shift]",
          "Keyup: Shift ShiftLeft LEFT []"
        ].join("\n")
      )
    }))

  test("KB-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      yield* captureLastKeydown(page)
      const a = yield* down(page, "a")
      assert.strictEqual((yield* lastKeydown(page)).repeat, false)
      yield* page.keyboard.press("a")
      assert.strictEqual((yield* lastKeydown(page)).repeat, true)

      const b = yield* down(page, "b")
      assert.strictEqual((yield* lastKeydown(page)).repeat, false)
      // A second down of a key that is already held repeats it
      const bAgain = yield* down(page, "b")
      assert.strictEqual((yield* lastKeydown(page)).repeat, true)

      yield* up(a)
      const aAgain = yield* down(page, "a")
      assert.strictEqual((yield* lastKeydown(page)).repeat, false)
      yield* up(aAgain)
      yield* up(bAgain)
      yield* up(b)
    }))

  test("KB-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").focus()
      const text = "This text goes onto two lines.\nThis character is 嗨."
      yield* page.keyboard.pressSequentially(text)
      assert.strictEqual(yield* page.locator("textarea").readValue, text)
    }))

  test("KB-027", ({ page }) =>
    Effect.gen(function*() {
      const invalid = yield* failureOf(page.keyboard.press("NotARealKey"), "press('NotARealKey')")
      assert(Keyboard.isKeyboardError(invalid), "press('NotARealKey') fails with a KeyboardError")
      assert.strictEqual(invalid.reason._tag, "InvalidInput")
      assert.include(invalid.message, "NotARealKey")
      // Strider types a character the layout lacks as a key of its own, rather than failing; these two checks
      // expect Playwright's `Unknown key` failure.
      yield* failureOf(page.keyboard.press("ё"), "press('ё')")
      yield* failureOf(page.keyboard.press("😊"), "press('😊')")
    }))

  test("KB-028", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").pressSequentially("👹 Tokyo street Japan 🇯🇵")
      assert.strictEqual(yield* page.locator("textarea").readValue, "👹 Tokyo street Japan 🇯🇵")
    }))

  test("KB-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "emoji-test", server.PREFIX + "/input/textarea.html")
      yield* frame.locator("textarea").pressSequentially("👹 Tokyo street Japan 🇯🇵")
      assert.strictEqual(yield* frame.locator("textarea").readValue, "👹 Tokyo street Japan 🇯🇵")
    }))

  test("KB-030", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").pressSequentially("some text")
      const control = yield* down(page, controlOrMeta)
      yield* page.keyboard.press("a")
      yield* up(control)
      yield* page.keyboard.press("Backspace")
      assert.strictEqual(yield* page.locator("textarea").readValue, "")
    }))

  test("KB-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="text" value="hello world">`)
      const input = page.locator("input")
      yield* Expect.toHaveValue(input, "hello world")
      yield* input.focus()
      yield* page.keyboard.press("Meta")
      yield* Expect.toHaveValue(input, "hello world")
    }))

  test("KB-032", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").pressSequentially("some text")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("textarea")!.addEventListener("keydown", (event) => {
          if (event.key === "a" && (event.metaKey || event.ctrlKey)) event.preventDefault()
        }, false)
      })
      const control = yield* down(page, controlOrMeta)
      yield* page.keyboard.press("a")
      yield* up(control)
      yield* page.keyboard.press("Backspace")
      assert.strictEqual(yield* page.locator("textarea").readValue, "some tex")
    }))

  test("KB-034", ({ page }) =>
    Effect.gen(function*() {
      yield* captureLastKeydown(page)
      yield* page.keyboard.press("Meta")
      const last = yield* lastKeydown(page)
      assert.strictEqual(last.key, "Meta")
      assert.strictEqual(last.code, "MetaLeft")
      assert.strictEqual(last.metaKey, true)
    }))

  test("KB-035", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      yield* captureLastKeydown(page)
      yield* page.keyboard.press("a")
      assert.strictEqual((yield* lastKeydown(page)).key, "a")
    }))

  test("KB-036", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      yield* captureLastKeydown(page)
      yield* page.keyboard.press("a")
      assert.strictEqual((yield* lastKeydown(page)).key, "a")
    }))

  // Playwright runs this on WebKit only (`it.skip(browserName !== 'webkit')`): no other browser has `keyIdentifier`.
  test("KB-037", { browsers: ["webkit"] }, ({ page }) =>
    Effect.gen(function*() {
      yield* captureLastKeydown(page)
      const keyMap = {
        "ArrowUp": "Up",
        "ArrowDown": "Down",
        "ArrowLeft": "Left",
        "ArrowRight": "Right",
        "Backspace": "U+0008",
        "Tab": "U+0009",
        "Delete": "U+007F",
        "a": "U+0041",
        "b": "U+0042",
        "F12": "F12"
      }
      for (const [key, keyIdentifier] of Object.entries(keyMap)) {
        yield* page.keyboard.press(key)
        assert.strictEqual((yield* lastKeydown(page)).keyIdentifier, keyIdentifier)
      }
    }))

  test("KB-038", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      // A click is required for WebKit to send the event into the body.
      yield* page.locator("body").click()
      yield* page.keyboard.press("PageDown")
      // We can't wait for the scroll to finish, so just wait for it to start.
      yield* Expect.that(
        page.evaluateInMainWorld(() => window.scrollY),
        Condition.make("scrolled down", (y: number) => y > 0)
      )
    }))

  test("KB-039", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div contenteditable></div>`)
      yield* page.locator("div").focus()
      const modifier: Keyboard.Modifier = process.platform === "darwin" ? "Alt" : "Control"
      yield* page.keyboard.pressSequentially("Hello World")
      const held = yield* down(page, modifier)
      const shift = yield* down(page, "Shift")
      yield* page.keyboard.press("ArrowLeft")
      yield* up(shift)
      yield* up(held)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => window.getSelection()!.toString()),
        "World"
      )
    }))

  test("KB-041", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button type="button">a11y</button>`)
      yield* recordClicks(page, "button")
      yield* page.locator("button").focus()
      // Playwright's "Space" is the space key, whose value is " "
      yield* page.keyboard.press(" ")
      assert.strictEqual(yield* clicked(page), true)
    }))

  test("KB-042", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button type="button">a11y</button>`)
      yield* recordClicks(page, "button")
      yield* page.locator("button").focus()
      yield* page.keyboard.press("Enter")
      assert.strictEqual(yield* clicked(page), true)
    }))

  test("KB-043", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div contenteditable>123</div>`)
      yield* page.locator("div").focus()
      yield* page.keyboard.press("a", { modifiers: [controlOrMeta] })
      yield* page.keyboard.press("c", { modifiers: [controlOrMeta] })
      yield* page.keyboard.press("v", { modifiers: [controlOrMeta] })
      yield* page.keyboard.press("v", { modifiers: [controlOrMeta] })
      assert.strictEqual(yield* page.locator("div").readText, "123123")
    }))

  test("KB-044", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div contenteditable>123</div>`)
      yield* page.locator("div").focus()
      yield* page.keyboard.press("a", { modifiers: [controlOrMeta] })
      yield* page.keyboard.press("x", { modifiers: [controlOrMeta] })
      yield* page.keyboard.press("v", { modifiers: [controlOrMeta] })
      yield* page.keyboard.press("v", { modifiers: [controlOrMeta] })
      assert.strictEqual(yield* page.locator("div").readText, "123123")
    }))

  test("KB-045", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div contenteditable></div>`)
      const div = page.locator("div")
      yield* Expect.toHaveText(div, "")
      yield* div.pressSequentially("123")
      yield* Expect.toHaveText(div, "123")
      yield* page.keyboard.press("z", { modifiers: [controlOrMeta] })
      yield* Expect.toHaveText(div, "")
      yield* page.keyboard.press("z", { modifiers: ["Shift", controlOrMeta] })
      yield* Expect.toHaveText(div, "123")
    }))

  test("KB-046", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        shadowEditors(
          `<div class=editor contenteditable id=foo></div>
                <hr>
                <section>
                  <div class=editor contenteditable id=bar></div>
                </section>`
        )
      )
      const editor = page.locator("shadow-element > .editor").first
      yield* editor.pressSequentially("This is the first box.")
      const sectionEditor = page.locator("section .editor")
      yield* sectionEditor.pressSequentially("This is the second box.")
      assert.strictEqual(yield* editor.readText, "This is the first box.")
      assert.strictEqual(yield* sectionEditor.readText, "This is the second box.")
    }))

  test("KB-047", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        shadowEditors(
          `<div class=editor contenteditable id=foo><p>hello</p></div>
                <hr>
                <section>
                  <div class=editor contenteditable id=bar><p>world</p></div>
                </section>`
        )
      )
      const editor = page.locator("shadow-element > .editor").first
      yield* editor.pressSequentially("This is the first box: ")
      const sectionEditor = page.locator("section .editor")
      yield* sectionEditor.pressSequentially("This is the second box: ")
      assert.strictEqual(yield* editor.readText, "This is the first box: hello")
      assert.strictEqual(yield* sectionEditor.readText, "This is the second box: world")
    }))

  test("KB-048", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        shadowEditors(
          `<input class=editor id=foo>
                <hr>
                <section>
                  <input class=editor id=bar>
                </section>`
        )
      )
      const editor = page.locator("shadow-element > .editor").first
      yield* editor.pressSequentially("This is the first box.")
      const sectionEditor = page.locator("section .editor")
      yield* sectionEditor.pressSequentially("This is the second box.")
      assert.strictEqual(yield* editor.readValue, "This is the first box.")
      assert.strictEqual(yield* sectionEditor.readValue, "This is the second box.")
    }))

  test("KB-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div id="focusable" tabindex="0">focusable div</div>
    <div id="non-focusable-and-non-editable">non-editable, non-focusable</div>
  `)
      const activeId = page.evaluateInMainWorld(() => document.activeElement?.id)
      yield* page.locator("#focusable").focus()
      assert.strictEqual(yield* activeId, "focusable")
      yield* page.locator("#non-focusable-and-non-editable").pressSequentially("foo")
      assert.strictEqual(yield* activeId, "focusable")
    }))

  test("KB-050", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { contextMenuPromise: Promise<void> }).contextMenuPromise = new Promise<void>((x) => {
          window.addEventListener("contextmenu", () => x(), false)
        })
      })
      const box = Option.getOrUndefined(yield* page.locator("textarea").boundingBox)
      assert.isDefined(box)
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      yield* page.mouse.click({ x: cx, y: cy }, { button: "right" })
      yield* page.evaluateInMainWorld(() =>
        (window as unknown as { contextMenuPromise: Promise<void> }).contextMenuPromise
      )

      yield* page.keyboard.insertText("嗨")
      yield* Expect.toHaveValue(page.locator("textarea"), "嗨")
    }))

  test("KB-051", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const keys: Array<string> = []
        ;(window as unknown as { keys: Array<string> }).keys = keys
        window.addEventListener("keydown", (event) => keys.push(event.key))
        ;(window as unknown as { contextMenuPromise: Promise<void> }).contextMenuPromise = new Promise<void>((x) => {
          window.addEventListener("contextmenu", () => x(), false)
        })
      })

      yield* page.mouse.move({ x: 100, y: 100 })
      const button = yield* holdButton(page, "right")
      yield* page.evaluateInMainWorld(() =>
        (window as unknown as { contextMenuPromise: Promise<void> }).contextMenuPromise
      )

      const arrow = yield* down(page, "ArrowDown")
      yield* pollEqual(
        page.evaluateInMainWorld(() => (window as unknown as { keys: Array<string> }).keys),
        ["ArrowDown"]
      )
      yield* up(arrow)
      yield* button.release
    }))

  test("KB-052", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html", { waitUntil: "load" })
      yield* page.keyboard.press("Escape")
      assert.strictEqual(
        yield* keyLog(page),
        `
Keydown: Escape Escape STANDARD []
Keyup: Escape Escape STANDARD []
`.trim()
      )
    }))

  test("KB-053", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <dialog>
      <div contenteditable>Edit Me</div>
    </dialog>
  `)

      const dialog = page.locator("dialog")
      const widget = dialog.locator("[contenteditable]")
      yield* page.evaluateInMainWorld(() => document.querySelector("dialog")!.showModal())
      yield* Expect.that(
        page.evaluateInMainWorld(() => document.querySelector("dialog")!.open),
        Condition.make("open", (open: boolean) => open === true)
      )
      yield* Expect.toBeVisible(widget)

      yield* widget.press("Escape")
      yield* Expect.that(
        page.evaluateInMainWorld(() => document.querySelector("dialog")!.open),
        Condition.make("closed", (open: boolean) => open === false)
      )
      yield* Expect.toBeHidden(widget)
    }))
})
