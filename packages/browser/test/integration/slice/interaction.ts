/**
 * The fourth slice: interacting and asserting, through the public API on every backend's layer.
 * Call site 1 up to its storage state, every action, the guard on the first trusted event, held input released
 * with its scope, every read and matcher, the keyboard and the mouse, and two pages of one context.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Condition, Deadline, Expect, FileInput, Keyboard, Locator, Mouse } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

const fixture = Effect.fnUntraced(function*(html: (origin: string) => string) {
  const served = yield* site
  return { url: fixtureUrl(served.origin, html(served.origin)), origin: served.origin }
})

/** An element whose text a script writes, for asserting what happened. */
const out = `<p id="out">nothing yet</p>`
const say = (text: string) => `document.getElementById('out').textContent = ${text}`

export const interaction = (name: "Chromium" | "Firefox" | "WebKit", backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} interaction`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("runs call site 1 up to its storage state: fill, click, and expect", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<form onsubmit="event.preventDefault(); ${
              say("'Welcome ' + this.email.value + ' (' + this.password.value.length + ')'")
            }"><label>Email <input name="email"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.getByLabel("Email").fill("me@example.com")
            yield* page.getByLabel("Password").fill(Redacted.make("hunter2"))
            yield* page.getByRole("button", { name: "Sign in" }).click()
            yield* page.getByText("Welcome me@example.com (7)").pipe(Expect.toBeVisible)
            assert.strictEqual(yield* page.getByLabel("Email").readValue, "me@example.com")
          }))
        }), timeout)

      it.effect("fills, clears and types into every kind of field", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="name" value="old"><textarea id="notes"></textarea><div id="rich" contenteditable="true">old</div><input id="day" type="date"><input id="keys"><div id="plain">plain</div>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const field = page.locator("#name")
            yield* field.fill("Ada")
            assert.strictEqual(yield* field.readValue, "Ada")
            yield* field.clear()
            assert.strictEqual(yield* field.readValue, "")
            yield* page.locator("#notes").fill("one\ntwo")
            assert.strictEqual(yield* page.locator("#notes").readValue, "one\ntwo")
            yield* page.locator("#rich").fill("new text")
            assert.strictEqual(yield* page.locator("#rich").readText, "new text")
            yield* page.locator("#day").fill("2026-10-23")
            assert.strictEqual(yield* page.locator("#day").readValue, "2026-10-23")
            yield* page.locator("#day").clear()
            assert.strictEqual(yield* page.locator("#day").readValue, "")
            const refused = yield* page.locator("#day").fill("soon").pipe(Effect.flip)
            assert(Locator.isLocatorError(refused) && refused.reason._tag === "InvalidInput", String(refused))
            const plain = yield* page.locator("#plain").fill("x").pipe(Effect.flip)
            assert(Locator.isLocatorError(plain) && plain.reason._tag === "NotEditable", String(plain))
            const keys = page.locator("#keys")
            yield* keys.pressSequentially(Redacted.make("héllo"), { delay: "10 millis" })
            yield* keys.press("a", { modifiers: ["Shift"] })
            assert.strictEqual(yield* keys.readValue, "hélloA")
            yield* keys.press("Backspace")
            assert.strictEqual(yield* keys.readValue, "héllo")
            const unknown = yield* keys.press("NotAKey").pipe(Effect.flip)
            assert(Locator.isLocatorError(unknown) && unknown.reason._tag === "InvalidInput", String(unknown))
          }))
        }), timeout)

      // ROOK-119: browsers serialize valid values differently from their source spelling.
      for (
        const [type, value, expected] of [
          ["range", "42.0", "42"],
          ["range", "1e1", "10"],
          ["range", "0", "0"],
          ["range", "100", "100"],
          ["color", "#AbCd00", "#abcd00"],
          ["datetime-local", "2020-03-02T06:20:00", "2020-03-02T06:20"],
          ["datetime-local", "2020-03-02T06:20:01.123", "2020-03-02T06:20:01.123"],
          ["datetime-local", "", ""]
        ] as const
      ) {
        it.effect(`fills normalized ${type} value ${value}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="${type}" min="0" max="100" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              yield* page.locator("#field").fill(value)
              const actual = yield* page.locator("#field").readValue
              assert.strictEqual(
                type === "range" ? Number(actual) : actual,
                type === "range" ? Number(expected) : expected
              )
              assert.strictEqual(yield* page.locator("#events").readText, "input;change;")
            }))
          }), timeout)
      }

      for (
        const [type, initial, invalid] of [
          ["range", "25", "soon"],
          ["range", "25", "101"],
          ["range", "25", "-1"],
          ["range", "25", "42.5"],
          ["range", "25", ""],
          ["range", "25", "0x19"],
          ["range", "25", "Infinity"],
          ["color", "#123456", ""],
          ["color", "#123456", "#gggggg"],
          ["datetime-local", "2020-03-02T05:15", "2020-02-30T06:20"]
        ] as const
      ) {
        it.effect(`rejects invalid ${type} value ${invalid} without mutation or events`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="${type}" min="0" max="100" value="${initial}" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const refused = yield* page.locator("#field").fill(invalid).pipe(Effect.flip)
              assert(Locator.isLocatorError(refused) && refused.reason._tag === "InvalidInput", String(refused))
              const state = {
                value: yield* page.locator("#field").readValue,
                events: yield* page.locator("#events").readText
              }
              assert.deepStrictEqual(state, { value: initial, events: "" })
            }))
          }), timeout)
      }

      // ROOK-119: a focus handler runs between validation and assignment, and may change the constraints.
      it.effect("rejects a range value a focus handler's new max clamps, without events", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="field" type="range" min="0" max="100" value="25" onfocus="this.max = '10'; events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const result = yield* page.locator("#field").fill("42").pipe(Effect.result)
            const state = {
              refused: result._tag === "Failure" && Locator.isLocatorError(result.failure) &&
                result.failure.reason._tag === "InvalidInput",
              value: yield* page.locator("#field").readValue,
              events: yield* page.locator("#events").readText
            }
            // Stock WebKit doesn't focus a range here, so its handler never runs and the fill stands.
            assert.deepStrictEqual(
              state,
              state.events.startsWith("focus;")
                ? { refused: true, value: "10", events: "focus;" }
                : { refused: false, value: "42", events: "input;change;" }
            )
          }))
        }), timeout)

      it.effect("chooses options, checks boxes and sets files", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<select id="s" onchange="${
              say("'chose ' + this.value")
            }"><option value="a">Ay</option><option value="b">Bee</option></select><input id="c" type="checkbox"><input id="stuck" type="checkbox" onclick="event.preventDefault()"><input id="f" type="file" onchange="${
              say("this.files[0].name")
            }"><button id="go">Go</button><script>setTimeout(() => document.getElementById('s').add(new Option('Late', 'l')), 300)</script>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#s").selectOption({ label: "Bee" })
            yield* page.getByText("chose b").pipe(Expect.toBeVisible)
            // An option that arrives later is waited for
            yield* page.locator("#s").selectOption({ value: "l" })
            assert.strictEqual(yield* page.locator("#s").readValue, "l")
            const notSelect = yield* page.locator("#go").selectOption({ index: 0 }).pipe(Effect.flip)
            assert(Locator.isLocatorError(notSelect) && notSelect.reason._tag === "WrongElement", String(notSelect))
            const box = page.locator("#c")
            yield* box.check()
            assert.isTrue(yield* box.isChecked)
            yield* box.check()
            assert.isTrue(yield* box.isChecked)
            yield* box.uncheck()
            assert.isFalse(yield* box.isChecked)
            const stuck = yield* page.locator("#stuck").check().pipe(Effect.flip)
            assert(Locator.isLocatorError(stuck) && stuck.reason._tag === "StateUnchanged", String(stuck))
            const notBox = yield* page.locator("#go").check().pipe(Effect.flip)
            assert(Locator.isLocatorError(notBox) && notBox.reason._tag === "WrongElement", String(notBox))
            yield* page.locator("#f").setInputFiles(FileInput.local(import.meta.filename))
            yield* page.getByText("interaction.ts").pipe(Expect.toBeVisible)
            const missing = yield* page.locator("#f").setInputFiles(FileInput.local("/nowhere/at/all.txt")).pipe(
              Effect.flip
            )
            assert(Locator.isLocatorError(missing) && missing.reason._tag === "FileUnreadable", String(missing))
            const notFile = yield* page.locator("#go").setInputFiles(FileInput.local(import.meta.filename)).pipe(
              Effect.flip
            )
            assert(Locator.isLocatorError(notFile) && notFile.reason._tag === "WrongElement", String(notFile))
          }))
        }), timeout)

      it.effect("double-clicks, hovers, taps, and holds modifiers where the backend can", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<button id="d" ondblclick="${
              say("'double'")
            }">Twice</button><div id="h" style="width:100px;height:40px" onmouseover="${
              say("'hovered'")
            }">Hover</div><button id="t">Touch</button><script>document.getElementById('t').addEventListener('touchstart', (event) => { ${
              say("'touched'")
            } })</script><button id="m" onclick="${say("'shift ' + event.shiftKey")}">Modified</button>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#d").dblclick()
            yield* page.getByText("double").pipe(Expect.toBeVisible)
            yield* page.locator("#h").hover()
            yield* page.getByText("hovered").pipe(Expect.toBeVisible)
            const tapped = page.locator("#t").tap()
            if (yield* supports("input.touch")) {
              yield* tapped
              yield* page.getByText("touched").pipe(Expect.toBeVisible)
            } else {
              const error = yield* Effect.flip(tapped)
              assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "input.touch")
            }
            const modified = page.locator("#m").click({ modifiers: ["Shift"] })
            if (!(yield* supports("input.pointerModifiers"))) {
              const error = yield* Effect.flip(modified)
              assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "input.pointerModifiers")
            } else {
              yield* modified
              yield* page.getByText("shift true").pipe(Expect.toBeVisible)
            }
          }))
        }), timeout)

      it.effect("drags with pointer events, and with HTML drag where the backend can", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<div id="knob" style="position:absolute;left:0;top:100px;width:40px;height:40px;background:red" onpointerdown="window.dragging = true" onpointerup="if (window.dragging) ${
              say("'dropped at ' + Math.round(event.clientX)")
            }">K</div><div id="end" style="position:absolute;left:300px;top:100px;width:40px;height:40px;background:blue">E</div><div id="card" draggable="true" style="position:absolute;left:0;top:200px;width:40px;height:40px;background:green">C</div><div id="bin" style="position:absolute;left:300px;top:200px;width:40px;height:40px;background:gray" ondragover="event.preventDefault()" ondrop="event.preventDefault(); ${
              say("'binned'")
            }">B</div>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            // The knob's pointerup lands on the end box, which doesn't stop it: pointer events go where the pointer is
            yield* page.locator("#knob").dragTo(page.locator("#end"), { steps: 5, checks: { receivesPointer: false } })
            const html = page.locator("#card").dragTo(page.locator("#bin"), { steps: 5 })
            if (name === "Chromium") {
              yield* html
              yield* page.getByText("binned").pipe(Expect.toBeVisible)
            } else {
              const error = yield* Effect.flip(html)
              assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "input.dragAndDrop")
              assert.include(error.reason.hint, `html: "synthetic"`)
            }
          }))
        }), timeout)

      it.effect(
        "types on its context's keyboard layout: the layout's keys, Shift, AltGr and dead keys",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field"><p id="log"></p><script>
              const log = []
              document.getElementById("field").addEventListener("keydown", (event) => {
                log.push(event.key + ":" + event.code + (event.shiftKey ? "+S" : ""))
                document.getElementById("log").textContent = log.join(" ")
              })
            </script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* Browser.newContext({ keyboardLayout: "de" })
              const page = yield* context.newPage
              yield* page.goto(url)
              const field = page.locator("#field")
              if (!(yield* supports("input.keyboardLayout"))) {
                // A backend that types characters, not a layout's keys, refuses the keys only a layout has
                const error = yield* Effect.flip(field.pressSequentially("zY@ê"))
                assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
                assert.strictEqual(error.reason.capability, "input.keyboardLayout")
                return
              }
              yield* field.pressSequentially("zY@ê")
              yield* field.pipe(Expect.toHaveValue("zY@ê"))
              const log = yield* page.locator("#log").readText
              if (name === "Firefox") {
                // WebDriver BiDi sends each character as its value: Firefox gives it the code a US keyboard would
                // (input.keyboardLayout)
                assert.include(log, "z:KeyZ")
                assert.include(log, "ê:")
              } else {
                // WebKit's key events ignore the modifiers held, as its mouse events do (QUIRKS.md, Q188)
                const shift = name === "WebKit" ? "" : "+S"
                assert.strictEqual(
                  log,
                  `z:KeyY Shift:ShiftLeft${shift} Y:KeyZ${shift} AltGraph:AltRight @:KeyQ Dead:Backquote ê:KeyE`
                )
              }
              // A press is a character's strokes too
              yield* page.keyboard.press("@")
              yield* field.pipe(Expect.toHaveValue("zY@ê@"))
            }))
          }),
        timeout
      )

      it.effect("drags with HTML drag events the page dispatches, on every backend", () =>
        Effect.gen(function*() {
          const write = (id: string, text: string) => `document.getElementById('${id}').textContent = ${text}`
          const { url } = yield* fixture(() =>
            `<div id="card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', 'card-7'); event.dataTransfer.effectAllowed = 'move'" ondragend="${
              write("ended", "'ended ' + event.dataTransfer.dropEffect")
            }" style="position:absolute;left:0;top:100px;width:40px;height:40px;background:green">C</div><div id="bin" ondragenter="this.dataset.entered = 'yes'" ondragover="event.preventDefault(); event.dataTransfer.dropEffect = 'move'" ondrop="event.preventDefault(); ${
              write(
                "dropped",
                "'binned ' + event.dataTransfer.getData('text/plain') + ' ' + event.isTrusted + ' ' + this.dataset.entered + ' ' + event.shiftKey"
              )
            }" style="position:absolute;left:300px;top:100px;width:60px;height:60px;background:gray"><span>B</span></div><div id="wall" ondragleave="${
              write("dropped", "'refused'")
            }" style="position:absolute;left:300px;top:200px;width:40px;height:40px;background:black">W</div><p id="dropped">nothing yet</p><p id="ended">nothing yet</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#card").dragTo(page.locator("#bin"), { html: "synthetic", modifiers: ["Shift"] })
            yield* page.locator("#dropped").pipe(Expect.toHaveText("binned card-7 false yes true"))
            // Chromium and WebKit ignore a dropEffect set on a DataTransfer a script made (QUIRKS.md, Q186)
            yield* page.locator("#ended").pipe(Expect.toHaveText(name === "Firefox" ? "ended move" : "ended none"))
            // A target whose dragover nothing cancels gets no drop
            yield* page.locator("#card").dragTo(page.locator("#wall"), { html: "synthetic" })
            yield* page.locator("#dropped").pipe(Expect.toHaveText("refused"))
            yield* page.locator("#ended").pipe(Expect.toHaveText("ended none"))
          }))
        }), timeout)

      it.effect(
        "stops a click whose element was covered when the input arrived, and clicks again",
        () =>
          Effect.gen(function*() {
            // The overlay appears when the pointer moves over the button, after the checks passed
            const { url } = yield* fixture(() =>
              `<div style="position:relative"><button id="b" onclick="window.clicks = (window.clicks ?? 0) + 1; ${
                say("'clicked ' + window.clicks")
              }" onmousemove="if (!window.covered) { window.covered = true; const o = document.getElementById('o'); o.style.display = 'block'; setTimeout(() => o.style.display = 'none', 300) }">Pay</button><div id="o" onclick="${
                say("'overlay clicked'")
              }" style="display:none;position:absolute;inset:0;background:white">Saving</div></div>${out}`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              yield* page.locator("#b").click()
              yield* page.getByText("clicked 1").pipe(Expect.toBeVisible)
            }))
          }),
        timeout
      )

      it.effect("releases held keys and buttons when their scope closes, failing or not", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="i"><p id="ups"></p><script>const ups = document.getElementById('ups'); addEventListener('keyup', (e) => ups.textContent += e.key + ' '); addEventListener('mouseup', () => ups.textContent += 'mouse ')</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#i").focus()
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.keyboard.hold("Shift")
              yield* page.keyboard.press("a")
              return yield* Effect.fail("a failed step")
            })).pipe(Effect.ignore)
            yield* page.keyboard.press("b")
            assert.strictEqual(yield* page.locator("#i").readValue, "Ab")
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.mouse.move({ x: 5, y: 5 })
              const held = yield* page.mouse.hold("left")
              yield* held.release
              yield* held.release
            }))
            // Shift went up with the failed scope, and the button once, however often its release ran
            assert.strictEqual(yield* page.locator("#ups").readText, "A Shift b mouse")
            const unknown = yield* page.keyboard.press("NotAKey").pipe(Effect.flip)
            assert(Keyboard.isKeyboardError(unknown) && unknown.reason._tag === "InvalidInput", String(unknown))
          }))
        }), timeout)

      it.effect("reads one match at once: text, value, html, attributes, states", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<p id="p" data-state="ready">Hello <b>there</b></p><input id="v" value="typed" disabled><input id="c" type="checkbox" checked><p class="two">a</p><p class="two">b</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const p = page.locator("#p")
            assert.strictEqual(yield* p.readText, "Hello there")
            assert.strictEqual(yield* p.readHtml, `<p id="p" data-state="ready">Hello <b>there</b></p>`)
            assert.deepStrictEqual(yield* p.readAttribute("data-state"), Option.some("ready"))
            assert.deepStrictEqual(yield* p.readAttribute("nope"), Option.none())
            assert.strictEqual(yield* page.locator("#v").readValue, "typed")
            assert.isFalse(yield* page.locator("#v").isEnabled)
            assert.isTrue(yield* page.locator("#c").isChecked)
            const none = yield* page.locator("#absent").readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(none) && none.reason._tag === "NoMatch", String(none))
            const two = yield* page.locator(".two").readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(two) && two.reason._tag === "StrictViolation", String(two))
            const wrong = yield* p.readValue.pipe(Effect.flip)
            assert(Locator.isLocatorError(wrong) && wrong.reason._tag === "WrongElement", String(wrong))
          }))
        }), timeout)

      it.effect("expects what changes later, in the page, and fails with what it saw", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<title>Waiting</title><p id="status">Working</p><button id="b" disabled>Go</button><input id="c" type="checkbox"><input id="v"><ul><li>a</li></ul><p id="tag">Tag</p><script>setTimeout(() => { document.getElementById('status').textContent = 'Done for now'; document.getElementById('b').disabled = false; document.getElementById('c').checked = true; document.getElementById('v').value = 'set by script'; document.getElementById('v').focus(); document.getElementById('tag').dataset.state = 'ready'; document.querySelector('ul').innerHTML = '<li>a</li><li>b</li><li>c</li>'; document.title = 'Finished' }, 300)</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const status = page.locator("#status")
            yield* status.pipe(Expect.toHaveText("Done for now"))
            yield* Expect.toContainText(status, "for")
            yield* page.locator("#b").pipe(Expect.toBeEnabled)
            yield* page.locator("#c").pipe(Expect.toBeChecked)
            yield* page.locator("#v").pipe(Expect.toHaveValue("set by script"))
            yield* page.locator("#v").pipe(Expect.toBeFocused)
            yield* page.locator("#v").pipe(Expect.toBeEditable)
            yield* page.locator("#tag").pipe(Expect.toHaveAttribute("data-state", "ready"))
            yield* page.locator("#tag").pipe(Expect.toHaveAttribute("data-state"))
            yield* page.getByRole("listitem").pipe(Expect.toHaveCount(3))
            yield* page.getByRole("listitem").pipe(Expect.toHaveText(["a", "b", /c/]))
            yield* page.pipe(Expect.toHaveTitle("Finished"))
            yield* page.locator("#tag").pipe(Expect.toBeDisabled, Deadline.within("200 millis"), Effect.flip)
            const error = yield* status.pipe(Expect.toHaveText("Never"), Deadline.within("300 millis"), Effect.flip)
            assert(Expect.isExpectationFailed(error), String(error))
            assert.strictEqual(error.condition, `to have the text "Never"`)
            assert.deepStrictEqual(error.history.map((each) => each.value), ["Done for now"])
          }))
        }), timeout)

      it.effect(
        "expects a page's URL across a navigation, and anything with Expect.that",
        () =>
          Effect.gen(function*() {
            const { origin, url } = yield* fixture(() => `<a href="/orders">Orders</a>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              yield* page.getByRole("link", { name: "Orders" }).click()
              yield* page.pipe(Expect.toHaveURL(`${origin}/orders`))
              yield* Expect.that(
                page.status,
                Condition.make(
                  "complete",
                  (status) => status._tag === "Open" && status.document.readiness === "complete"
                )
              )
              yield* Expect.that(
                page.getByText("/orders").count,
                Condition.make("one match", (count) => count === 1)
              )
              const error = yield* Expect.that(
                page.getByText("/orders").count,
                Condition.because(Condition.make("two matches", (count: number) => count === 2), "there are two")
              ).pipe(Deadline.within("250 millis"), Effect.flip)
              // However slow a check is, the deadline ends the expectation, not the subject
              assert(Expect.isExpectationFailed(error), String(error))
              assert.strictEqual(error.condition, "two matches, because there are two")
              assert.isAtLeast(error.checks.count, 1)
              const hung = yield* Expect.that(
                Effect.as(Effect.sleep("1 hour"), 1),
                Condition.make("one", (value: number) => value === 1)
              ).pipe(Deadline.within("100 millis"), Effect.flip)
              assert(Expect.isExpectationFailed(hung), String(hung))
              assert.deepStrictEqual(hung.history.map((each) => each.value), [{
                error: "a check was still running at the deadline"
              }])
            }))
          }),
        timeout
      )

      it.effect("types, clicks and scrolls with the keyboard and the mouse", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="a"><input id="b"><button id="spot" style="position:absolute;left:0;top:200px;width:100px;height:50px" onclick="${
              say("'spot ' + event.detail")
            }">Spot</button><div style="height:3000px"></div>${out}<script>addEventListener('scroll', () => document.getElementById('scrolled').textContent = 'scrolled', { once: true })</script><p id="scrolled" style="position:fixed;top:0">not scrolled</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#a").focus()
            yield* page.keyboard.insertText("inserted")
            yield* page.keyboard.press("Tab")
            yield* page.keyboard.pressSequentially("typed")
            assert.strictEqual(yield* page.locator("#a").readValue, "inserted")
            assert.strictEqual(yield* page.locator("#b").readValue, "typed")
            yield* page.mouse.click({ x: 50, y: 225 }, { clickCount: 2 })
            yield* page.getByText("spot 2").pipe(Expect.toBeVisible)
            assert.deepStrictEqual(yield* page.mouse.position, { x: 50, y: 225 })
            yield* page.mouse.wheel({ x: 0, y: 500 })
            yield* page.locator("#scrolled").pipe(Expect.toHaveText("scrolled"))
            const modified = page.mouse.click({ x: 50, y: 225 }, { modifiers: ["Shift"] })
            if (!(yield* supports("input.pointerModifiers"))) {
              const error = yield* Effect.flip(modified)
              assert(Mouse.isMouseError(error) && error.reason._tag === "Unsupported", String(error))
            } else {
              yield* modified
            }
          }))
        }), timeout)

      it.effect("acts on a page after another opens in its context", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => `<button onclick="${say("'clicked'")}">Click me</button>${out}`)
          yield* Effect.scoped(Effect.gen(function*() {
            const first = yield* Browser.newPage()
            yield* first.goto(url)
            const second = yield* first.context.newPage
            yield* second.goto(url)
            // Each page is a window of its own, which keeps rendering behind another: a tab behind another
            // rendered about once a second in Firefox (QUIRKS.md, Q71)
            yield* first.getByRole("button", { name: "Click me" }).click().pipe(Deadline.within("5 seconds"))
            yield* first.getByText("clicked", { exact: true }).pipe(Expect.toBeVisible)
          }))
        }), timeout)
    })
  })
