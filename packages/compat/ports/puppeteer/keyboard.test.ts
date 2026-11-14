/**
 * Puppeteer's `test/src/keyboard.test.ts`: text typed and inserted, keys pressed and held, the modifiers and key codes
 * a page sees for each key, key repeat, canceled key events, emoji, and an unknown key's error.
 *
 * What the port changes:
 * - Puppeteer's `page.keyboard.down(key)` and `up(key)` are `keyboard.hold(key)` and the handle's `release`. A held key
 *   is released as the test's scope closes, so a failing test never leaves Shift down.
 * - `page.keyboard.type` and `page.type(selector, text)` are `keyboard.pressSequentially` and `locator.pressSequentially`.
 *   `ElementHandle.press` and `textarea.type` are `locator.press` and `locator.pressSequentially`, and `page.$` and
 *   `$eval` reads are locator reads or `evaluateInMainWorld`.
 * - Puppeteer's `keyboard.sendCharacter` is `keyboard.insertText`: text without key events. Strider's `insertText` is
 *   the same on Chromium; the Firefox gap is in the ledger.
 * - Strider's keys are key values (`" "`, `"Shift"`), not Puppeteer's names (`"Space"`). The `code` a page sees is the one the
 *   layout gives the key (`Digit1` for `!` on `us`), as the original's log shows.
 * - `page.evaluate` runs in the main world, so the page's own globals (`getResult`, `result`, `textarea`) and the test's
 *   listeners are read and set with `page.evaluateInMainWorld`. The listeners are the test's own, as the original's are.
 * - The iframe tests enter the frame by its element: `page.frame(...)` for the one-level frame, and a nested
 *   `frame(...)` for the srcdoc frame inside it, where Puppeteer's `frame.focus` and `frame.$eval` are frame locators.
 *   Their counters are read from the frame's window in the main world, the frame's own globals.
 * - "should throw on unknown keys" checks Strider's `InvalidInput` reason and that its message names the key. The
 *   original checks Puppeteer's wording, `Unknown key: "NotARealKey"`.
 * - "should specify repeat property" holds and presses keys that are already held, as the original does. Where the
 *   original's `down` of a held key is a key repeat, the port's `hold` is the same gesture.
 * - Puppeteer's `keyboard.press('a', { commands })`, `ElementHandle.press`'s `text`, and key codes or locations
 *   (`Digit5`, `NumpadEnter`) aren't Strider's, so those tests are in the ledger rather than ported.
 * - "should press the meta key" runs only on macOS in the original (it returns at once elsewhere), so it isn't ported.
 */
import { assert } from "@effect/vitest"
import { Keyboard, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { attachFrame, failureOf } from "../harness/playwright.ts"
import { flatten } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/** The text `textarea.html` holds, read in the page's main world, as the original's `page.evaluate` reads it. */
const valueOf = (page: Page.Page) => page.evaluateInMainWorld(() => document.querySelector("textarea")!.value)

/** The log `keyboard.html` keeps, read and cleared, as the original's `getResult()` does. */
const resultOf = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (globalThis as unknown as { getResult(): string }).getResult())

/** The counters the test's listeners keep on a window, as the original's `globalThis.inputCount` and `keyDownCount`. */
interface Counters {
  inputCount: number
  keyDownCount: number
}

upstream(import.meta.filename, {}, (test) => {
  test("Keyboard should type into a textarea", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const textarea = document.createElement("textarea")
        document.body.appendChild(textarea)
        textarea.focus()
      })
      const text = "Hello world. I am the text that was typed!"
      yield* page.keyboard.pressSequentially(text)
      assert.strictEqual(yield* valueOf(page), text)
    }))

  test("Keyboard should move with the arrow keys", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("textarea").pressSequentially("Hello World!")
      assert.strictEqual(yield* valueOf(page), "Hello World!")
      for (const _ of "World!") {
        yield* page.keyboard.press("ArrowLeft")
      }
      yield* page.keyboard.pressSequentially("inserted ")
      assert.strictEqual(yield* valueOf(page), "Hello inserted World!")
      const shift = yield* page.keyboard.hold("Shift")
      for (const _ of "inserted ") {
        yield* page.keyboard.press("ArrowLeft")
      }
      yield* shift.release
      yield* page.keyboard.press("Backspace")
      assert.strictEqual(yield* valueOf(page), "Hello World!")
    }))

  // The original sends editing commands (`{ commands: ["SelectAll"] }`) with its shortcuts. Strider's press takes modifiers
  // and no commands, so the shortcuts' effects aren't requested, and the test is in the ledger.

  test("Keyboard should send a character with ElementHandle.press", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      const textarea = page.locator("textarea")
      yield* textarea.press("a")
      assert.strictEqual(yield* valueOf(page), "a")
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener(
          "keydown",
          (event) => event.preventDefault(),
          true
        )
      })
      yield* textarea.press("b")
      assert.strictEqual(yield* valueOf(page), "a")
    }))

  test("Keyboard should press the Space key", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      // Puppeteer names the key "Space"; Strider's key is the space character itself
      yield* page.locator("textarea").press(" ")
      assert.strictEqual(yield* valueOf(page), " ")
    }))

  test("Keyboard should send a character with sendCharacter", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("textarea").focus()
      yield* page.evaluateInMainWorld(() => {
        const counters = globalThis as unknown as { inputCount: number; keyDownCount: number }
        counters.inputCount = 0
        counters.keyDownCount = 0
        window.addEventListener("input", () => counters.inputCount += 1, true)
        window.addEventListener("keydown", () => counters.keyDownCount += 1, true)
      })
      // `insertText` is Puppeteer's `sendCharacter`: the text goes in with no key events
      yield* page.keyboard.insertText("嗨")
      const first = yield* page.evaluateInMainWorld(() => {
        const counters = globalThis as unknown as Counters
        return {
          value: document.querySelector("textarea")!.value,
          inputs: counters.inputCount,
          keyDowns: counters.keyDownCount
        }
      })
      assert.deepStrictEqual(first, { value: "嗨", inputs: 1, keyDowns: 0 })

      yield* page.keyboard.insertText("a")
      const second = yield* page.evaluateInMainWorld(() => {
        const counters = globalThis as unknown as Counters
        return {
          value: document.querySelector("textarea")!.value,
          inputs: counters.inputCount,
          keyDowns: counters.keyDownCount
        }
      })
      assert.deepStrictEqual(second, { value: "嗨a", inputs: 2, keyDowns: 0 })
    }))

  test("Keyboard should send a character with sendCharacter in iframe", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<iframe srcdoc=\"<iframe name='test' srcdoc='<textarea></textarea>'></iframe>\"></iframe>"
      )
      // The original waits for the frame whose element is named "test". The frame tree has no frame names (`name` is always
      // none), so the port waits for the nested frame to attach, and enters it by the element named "test" below.
      yield* page.frames.waitFor((tree) => flatten(tree).some((frame) => frame.children.length > 0 && frame !== tree))
      const outer = page.frame(page.locator("iframe"))
      const inner = outer.frame(outer.locator("iframe[name='test']"))
      yield* inner.locator("textarea").focus()
      yield* page.evaluateInMainWorld(() => {
        const frame = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow!.document
          .querySelector<HTMLIFrameElement>("iframe[name='test']")!.contentWindow! as unknown as Window & Counters
        frame.inputCount = 0
        frame.keyDownCount = 0
        frame.addEventListener("input", () => frame.inputCount += 1, true)
        frame.addEventListener("keydown", () => frame.keyDownCount += 1, true)
      })
      const read = () =>
        page.evaluateInMainWorld(() => {
          const frame = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow!.document
            .querySelector<HTMLIFrameElement>("iframe[name='test']")!.contentWindow! as unknown as Counters & Window
          return {
            value: frame.document.querySelector("textarea")!.value,
            inputs: frame.inputCount,
            keyDowns: frame.keyDownCount
          }
        })
      yield* page.keyboard.insertText("嗨")
      assert.deepStrictEqual(yield* read(), { value: "嗨", inputs: 1, keyDowns: 0 })
      yield* page.keyboard.insertText("a")
      assert.deepStrictEqual(yield* read(), { value: "嗨a", inputs: 2, keyDowns: 0 })
    }))

  test("Keyboard should report modifiers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html")
      const keyboard = page.keyboard

      // Shift modifier
      const shift = yield* keyboard.hold("Shift")
      assert.strictEqual(yield* resultOf(page), "Keydown: Shift ShiftLeft [Shift]")
      const bang = yield* keyboard.hold("!")
      // Shift + ! produces an input event.
      assert.strictEqual(yield* resultOf(page), `Keydown: ! Digit1 [Shift]\n` + `input: ! insertText false`)
      yield* bang.release
      assert.strictEqual(yield* resultOf(page), "Keyup: ! Digit1 [Shift]")
      yield* shift.release
      assert.strictEqual(yield* resultOf(page), "Keyup: Shift ShiftLeft []")

      // Alt modifier
      const alt = yield* keyboard.hold("Alt")
      assert.strictEqual(yield* resultOf(page), "Keydown: Alt AltLeft [Alt]")
      // Alt + ! should NOT produce an input event in Puppeteer for cross-platform consistency.
      const altBang = yield* keyboard.hold("!")
      assert.strictEqual(yield* resultOf(page), "Keydown: ! Digit1 [Alt]")
      yield* altBang.release
      assert.strictEqual(yield* resultOf(page), "Keyup: ! Digit1 [Alt]")
      yield* alt.release
      assert.strictEqual(yield* resultOf(page), "Keyup: Alt AltLeft []")

      // Control modifier
      const control = yield* keyboard.hold("Control")
      assert.strictEqual(yield* resultOf(page), "Keydown: Control ControlLeft [Control]")
      // Control + ! should NOT produce an input event.
      const controlBang = yield* keyboard.hold("!")
      assert.strictEqual(yield* resultOf(page), "Keydown: ! Digit1 [Control]")
      yield* controlBang.release
      assert.strictEqual(yield* resultOf(page), "Keyup: ! Digit1 [Control]")
      yield* control.release
      assert.strictEqual(yield* resultOf(page), "Keyup: Control ControlLeft []")
    }))

  test("Keyboard should report multiple modifiers", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html")
      const keyboard = page.keyboard
      const control = yield* keyboard.hold("Control")
      assert.strictEqual(yield* resultOf(page), "Keydown: Control ControlLeft [Control]")
      const alt = yield* keyboard.hold("Alt")
      assert.strictEqual(yield* resultOf(page), "Keydown: Alt AltLeft [Alt Control]")
      const semicolon = yield* keyboard.hold(";")
      assert.strictEqual(yield* resultOf(page), "Keydown: ; Semicolon [Alt Control]")
      yield* semicolon.release
      assert.strictEqual(yield* resultOf(page), "Keyup: ; Semicolon [Alt Control]")
      yield* control.release
      assert.strictEqual(yield* resultOf(page), "Keyup: Control ControlLeft [Alt]")
      yield* alt.release
      assert.strictEqual(yield* resultOf(page), "Keyup: Alt AltLeft []")
    }))

  test("Keyboard should send proper codes while typing", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html")
      yield* page.keyboard.pressSequentially("!")
      assert.strictEqual(
        yield* resultOf(page),
        ["Keydown: ! Digit1 []", "input: ! insertText false", "Keyup: ! Digit1 []"].join("\n")
      )
      yield* page.keyboard.pressSequentially("^")
      assert.strictEqual(
        yield* resultOf(page),
        ["Keydown: ^ Digit6 []", "input: ^ insertText false", "Keyup: ^ Digit6 []"].join("\n")
      )
    }))

  test("Keyboard should send proper codes while typing with shift", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/keyboard.html")
      const shift = yield* page.keyboard.hold("Shift")
      yield* page.keyboard.pressSequentially("~")
      assert.strictEqual(
        yield* resultOf(page),
        [
          "Keydown: Shift ShiftLeft [Shift]",
          "Keydown: ~ Backquote [Shift]",
          "input: ~ insertText false",
          "Keyup: ~ Backquote [Shift]"
        ].join("\n")
      )
      yield* shift.release
    }))

  // The original checks the `code` of Enter and NumpadEnter with `ElementHandle.press`, and the `location` of each key
  // (`Digit5`, `ControlLeft`, `ControlRight`, `NumpadSubtract`). Strider's key values name no numpad key and no location,
  // so the test is in the ledger.

  test("Keyboard should not type canceled events", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("textarea").focus()
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener(
          "keydown",
          (event) => {
            event.stopPropagation()
            event.stopImmediatePropagation()
            if (event.key === "l") event.preventDefault()
            if (event.key === "o") event.preventDefault()
          },
          false
        )
      })
      yield* page.keyboard.pressSequentially("Hello World!")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          (globalThis as unknown as { textarea: HTMLTextAreaElement }).textarea.value
        ),
        "He Wrd!"
      )
    }))

  test("Keyboard should specify repeat property", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("textarea").focus()
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("textarea")!.addEventListener(
          "keydown",
          (event) => (globalThis as unknown as { lastEvent: KeyboardEvent }).lastEvent = event,
          true
        )
      })
      const lastRepeat = () =>
        page.evaluateInMainWorld(() => (globalThis as unknown as { lastEvent: KeyboardEvent }).lastEvent.repeat)

      const a = yield* page.keyboard.hold("a")
      assert.isFalse(yield* lastRepeat())
      yield* page.keyboard.press("a")
      assert.isTrue(yield* lastRepeat())

      const b = yield* page.keyboard.hold("b")
      assert.isFalse(yield* lastRepeat())
      // A second hold of a key that's held is a key repeat, as the original's second `down("b")` is
      const repeated = yield* page.keyboard.hold("b")
      assert.isTrue(yield* lastRepeat())

      yield* a.release
      const again = yield* page.keyboard.hold("a")
      assert.isFalse(yield* lastRepeat())
      yield* again.release
      yield* repeated.release
      yield* b.release
    }))

  test("Keyboard should type all kinds of characters", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("textarea").focus()
      const text = "This text goes onto two lines.\nThis character is 嗨."
      yield* page.keyboard.pressSequentially(text)
      // textarea.html's `result` is the textarea's value, set by its input listener
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (globalThis as unknown as { result: string }).result),
        text
      )
    }))

  test("Keyboard should throw on unknown keys", ({ page }) =>
    Effect.gen(function*() {
      const failure = yield* failureOf(page.keyboard.press("NotARealKey"), "pressing an unknown key")
      assert(Keyboard.isKeyboardError(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "InvalidInput")
      // Puppeteer's wording is `Unknown key: "NotARealKey"`; Strider's reason names the input and says what it expected
      assert.include(failure.reason.hint, "NotARealKey")
    }))

  test("Keyboard should type emoji", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html")
      yield* page.locator("textarea").pressSequentially("👹 Tokyo street Japan 🇯🇵")
      assert.strictEqual(yield* valueOf(page), "👹 Tokyo street Japan 🇯🇵")
    }))

  test("Keyboard should type emoji into an iframe", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const frame = yield* attachFrame(page, "emoji-test", server.PREFIX + "/input/textarea.html")
      yield* frame.locator("textarea").pressSequentially("👹 Tokyo street Japan 🇯🇵")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          (document.getElementById("emoji-test") as HTMLIFrameElement).contentWindow!.document
            .querySelector("textarea")!.value
        ),
        "👹 Tokyo street Japan 🇯🇵"
      )
    }))
})
